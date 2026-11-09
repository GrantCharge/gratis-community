import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {t3Error} from './t3-connection.mjs';
const terminal=new Set(['completed','failed','cancelled','interrupted']);
const text=(v,label,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`Enter ${label} under ${max} characters.`);return v.trim();};
export const t3TaskActive=job=>!terminal.has(job.status)&&job.status!=='needs_review'||terminal.has(job.status)&&!job.delivered;
export class T3Tasks {
 // environments routes each job to the T3 host it was created on; a single connection is still accepted.
 constructor({directory,encrypt,decrypt,environments,connection,onChange=()=>{},onResult=async()=>{},interval=5000}){Object.assign(this,{directory,encrypt,decrypt,environments:environments||{get:()=>connection},onChange,onResult,interval});this.jobs=[];this.locks=new Map();this.persist=Promise.resolve();this.closed=false;}
 async init(){try{const data=JSON.parse(this.decrypt(await readFile(join(this.directory,'t3-tasks.secure'))));this.jobs=data.jobs||[];}catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock saved T3 tasks.');}return this;}
 snapshot(conversationId){return this.jobs.filter(j=>!conversationId||j.conversationId===conversationId).map(({operation,...job})=>structuredClone(job)).sort((a,b)=>b.createdAt-a.createdAt);}
 async save(){const body=JSON.stringify({version:1,jobs:this.jobs});const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.t3-tasks-'+randomUUID());await writeFile(tmp,this.encrypt(body),{mode:0o600});await rename(tmp,join(this.directory,'t3-tasks.secure'));};this.persist=this.persist.then(write,write);await this.persist;this.onChange(this.snapshot());}
 start(){this.timer=setInterval(()=>void this.refresh().catch(()=>{}),this.interval);this.timer.unref?.();void this.refresh().catch(()=>{});}
 get(id,conversationId){const j=this.jobs.find(j=>j.id===id&&(!conversationId||j.conversationId===conversationId));if(!j)throw new Error('This T3 task is not part of this chat.');return j;}
 async submit({environmentId,conversationId,botId,projectId,title,prompt,threadId,modelSelection,sourceMessageId}){
  if(this.closed)throw new Error('T3 is closing.');projectId=text(projectId,'a project',256);prompt=text(prompt,'a task',100000);title=text(title||prompt.slice(0,80),'a title',255);
  const connection=this.environments.get(environmentId);if(!connection.data.endpoint)throw new Error('Connect T3 first.');
  const existing=sourceMessageId&&this.jobs.find(j=>j.environmentId===environmentId&&j.conversationId===conversationId&&j.sourceMessageId===sourceMessageId&&j.projectId===projectId&&j.prompt===prompt&&j.targetThreadId===threadId);
  if(existing)return this.snapshot(conversationId).find(j=>j.id===existing.id);
  const requestId=randomUUID(),args=threadId?{threadId,message:prompt,mode:'queue',clientRequestId:requestId}:{projectId,title,message:prompt,clientRequestId:requestId,...(modelSelection?{modelSelection}:{})};
  const job={id:randomUUID(),...(environmentId?{environmentId}:{}),conversationId,botId,projectId,title,prompt,sourceMessageId,targetThreadId:threadId,endpoint:connection.data.endpoint,connectionId:connection.data.identity,requestId,operation:{name:threadId?'t3_thread_send':'t3_thread_launch',args},...(threadId?{threadId}:{}),status:'submitting',createdAt:Date.now(),updatedAt:Date.now(),attempts:0,items:[]};
  this.jobs.push(job);await this.save();void this.run(job).catch(()=>{});return this.snapshot(conversationId).find(j=>j.id===job.id);
 }
 async followup({id,conversationId,message}){const original=this.get(id,conversationId);if(!original.threadId)throw new Error('Wait for T3 to confirm the original thread.');return this.submit({environmentId:original.environmentId,conversationId:original.conversationId,botId:original.botId,projectId:original.projectId,title:original.title,prompt:message,threadId:original.threadId});}
 async run(job){
  if(this.closed||this.locks.has(job.id))return;
  const promise=this.step(job).catch(async error=>{if(this.closed)return;job.error=t3Error(error);job.status=error.retryable===false?'failed':'disconnected';job.rejected=error.retryable===false;job.updatedAt=Date.now();job.nextAttempt=Date.now()+Math.min(30000,1000*2**Math.min(job.attempts||0,5));await this.save();if(job.rejected){await this.onResult(structuredClone(job));job.delivered=true;await this.save();}}).finally(()=>this.locks.delete(job.id));this.locks.set(job.id,promise);return promise;
 }
 async step(job){
  const connection=this.environments.get(job.environmentId);
  if(job.endpoint!==connection.data.endpoint)throw new Error('This task belongs to another T3 environment. Reconnect that environment to refresh it.');
  if(terminal.has(job.status)&&(job.rejected||!job.operation)){if(!job.delivered){await this.onResult(structuredClone(job));job.delivered=true;await this.save();}return;}
  if(job.operation){
   if(job.connectionId&&connection.data.identity!==job.connectionId){job.status='needs_review';job.error='T3 access changed before the request was confirmed. Check this task in T3 before submitting it again.';await this.save();return;}
   job.attempts++;job.status='submitting';await this.save();
   const result=await connection.call(job.operation.name,job.operation.args);if(this.closed)return;
   if(!result.threadId)throw new Error('T3 did not confirm a thread. Retrying will reuse the same request ID.');
   job.threadId=result.threadId;job.runId=result.runId;job.link=result.link;delete job.operation;job.status=result.status||'running';delete job.error;job.updatedAt=Date.now();await this.save();
  }
  if(!job.threadId)return;
  const result=await connection.call('t3_thread_wait',{threadId:job.threadId,...(job.runId?{runId:job.runId}:{}),timeoutMs:0,untilDelegatedWorkSettled:true});
  let view=await connection.call('t3_thread_read',{threadId:job.threadId,view:'messages',limit:100,maxCharsPerItem:20000});
  if(view.thread.itemCount>100)view=await connection.call('t3_thread_read',{threadId:job.threadId,view:'messages',afterPosition:view.thread.itemCount-101,limit:100,maxCharsPerItem:20000});
  const runId=result.resultRun?.runId||job.runId||result.runId;
  if(this.closed)return;
  job.items=(view.items||[]).filter(item=>!runId||item.runId===runId).map(({itemId,type,text,status,textTruncated})=>({itemId,type,text,status,truncated:!!textTruncated}));
  job.status=result.timedOut?'running':result.resultRun?.status||result.status;
  if(view.thread.pendingRequestCount&&!terminal.has(job.status))job.status='needs_input';
  job.runId=job.runId||result.runId;job.resultRunId=result.resultRun?.runId;job.link=view.thread.link||job.link;job.updatedAt=Date.now();delete job.error;delete job.nextAttempt;
  if(terminal.has(job.status)){
   job.completedAt=job.completedAt||Date.now();job.result=job.items.filter(item=>item.text&&/assistant|agent_message|response/i.test(item.type)).map(item=>item.text).join('\n\n');
   if(!job.result)job.result=job.items.filter(item=>item.text&&!/user|input|tool/i.test(item.type)).map(item=>item.text).join('\n\n');
  }
  await this.save();if(terminal.has(job.status)&&!job.delivered){await this.onResult(structuredClone(job));job.delivered=true;await this.save();}
 }
 async refresh({id,conversationId}={}){const jobs=id?[this.get(id,conversationId)]:this.jobs.filter(j=>t3TaskActive(j)&&(terminal.has(j.status)||!j.nextAttempt||j.nextAttempt<=Date.now()));await Promise.all(jobs.map(j=>this.run(j)));return this.snapshot(conversationId);}
 async retry({id,conversationId}){const job=this.get(id,conversationId);if(job.status==='needs_review'||job.rejected)throw new Error(job.error);delete job.nextAttempt;await this.run(job);return this.snapshot(conversationId);}
 async cancel({id,conversationId}){const job=this.get(id,conversationId);if(!job.threadId)throw new Error('T3 has not confirmed a thread yet. Refresh it before stopping.');const requestId=job.cancelRequestId||randomUUID();job.cancelRequestId=requestId;await this.save();await this.environments.get(job.environmentId).call('t3_thread_interrupt',{threadId:job.threadId,...(job.runId?{runId:job.runId}:{}),clientRequestId:requestId});job.status='cancel_requested';await this.save();return this.snapshot(conversationId);}
 async close(){this.closed=true;clearInterval(this.timer);await this.persist;}
}
