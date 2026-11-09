import {toolResultCheckpoint,traceValue} from './computer-checkpoint.mjs';
import {createSdkMcpServer,tool} from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {COMPUTER_ACTIONS} from './cloud-computer.mjs';
import {searchWeb,readWebpage,publicURL} from './web-tools.mjs';

export const defaultCapabilities={web:true,files:true,computer:true,connections:true};
export async function agentRuntime({bot,conversationId,files,cloud,connections,signal,onActivity,approve,collaboration,memory,t3,schedules,requestComputerHelp,apps:appServers,canUseComputer=()=>true}) {
  const capabilities={...defaultCapabilities,...bot.capabilities},tools=[],definitions=[],mcpServers={};
  const register=(name,description,schema,handler)=>{const wrapped=async input=>{
    const id=crypto.randomUUID();onActivity({id,name,input:name.endsWith('_memory')?{scope:input.scope,query:input.query,manual:true}:traceValue(input),status:'running',startedAt:Date.now()});
    try{signal.throwIfAborted();if(['computer','save_cloud_file'].includes(name)&&!canUseComputer())throw new Error('The user has control of the computer. Wait for them to give control back.');const result=await handler(input);onActivity({id,name,status:result.isError?'error':'complete',result:toolResultCheckpoint(result),finishedAt:Date.now()});const {checkpoint,...response}=result;return response;}
    catch(error){onActivity({id,name,status:signal.aborted?'cancelled':'error',detail:String(error.message).slice(0,500),finishedAt:Date.now()});return {isError:true,content:[{type:'text',text:String(error.message)}]};}
  };tools.push(tool(name,description,schema,wrapped));definitions.push({name,description,schema:z.object(schema),handler:wrapped});};
  const text=value=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
  if(schedules){
    const timing=z.object({kind:z.enum(['weekly','interval']),timezone:z.string(),time:z.string().optional(),days:z.array(z.number().int().min(0).max(6)).optional(),minutes:z.number().int().min(15).max(10080).optional()});
    register('list_schedules','List recurring tasks in this chat, including next run, timezone and recent results.',{},async()=>text(schedules.list()));
    register('create_schedule','Create a recurring task only when the user explicitly requests it. Weekly uses local HH:mm and days 0=Sunday to 6=Saturday (all seven for daily); interval uses minutes (minimum 15). Use an IANA timezone (this Mac: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'). The bot runs with its current memory and connected apps and posts results here. Requires Gratis running and the Mac awake. Closing its window keeps enabled schedules running; quitting stops them until reopen. Do not promise background cloud execution. Report the saved next run and timezone.',{title:z.string().max(120),prompt:z.string().max(16000),timing},async input=>text(await schedules.create(input)));
    register('update_schedule','Edit or pause/resume an existing schedule in this chat only on the user’s request. Read its ID with list_schedules first.',{id:z.string(),enabled:z.boolean().optional(),title:z.string().max(120).optional(),prompt:z.string().max(16000).optional(),timing:timing.optional()},async input=>text(await schedules.update(input)));
    register('delete_schedule','Delete a recurring task only when the user asks to remove it. Does not delete earlier results.',{id:z.string()},async input=>text(await schedules.remove(input)));
  }
  if(t3&&capabilities.connections){
    register('start_t3_task','Delegate a concrete task to the T3 project chosen for this bot. Work continues independently when Gratis closes. Returns a saved job ID immediately; do not start duplicates or repeatedly poll. The task result will be delivered to this chat. Include all necessary instructions, constraints and verification criteria; private chat history is not sent automatically.',{title:z.string().min(1).max(255),prompt:z.string().min(1).max(100000)},async input=>text(await t3.submit(input)));
    register('read_t3_task','Check an existing T3 job from this chat. Use its saved ID. Do not poll repeatedly; results are delivered automatically.',{id:z.string()},async({id})=>text(await t3.read(id)));
    register('send_t3_message','Send a follow-up to the same T3 thread. Busy threads queue the message. Does not start a replacement thread.',{id:z.string(),message:z.string().min(1).max(100000)},async({id,message})=>text(await t3.send(id,message)));
    register('stop_t3_task','Interrupt this chat’s T3 task while preserving its thread and files. Use only when the user asks to stop it.',{id:z.string()},async({id})=>text(await t3.stop(id)));
  }
  if(capabilities.web){
    register('search_web','Search the public web. Returns real source URLs and snippets; open sources before drawing conclusions.',{query:z.string()},async({query})=>text(await searchWeb(query,signal)));
    register('read_webpage','Read a public HTTPS webpage. Returns its title, source URL and text.',{url:z.string()},async({url})=>{
      publicURL(url);
      try{return text(await readWebpage(url,signal));}
      catch(error){if(!canUseComputer()||error.code==='URL_BLOCKED'||!capabilities.computer||!connections.status().cloud)throw error;
        const result=await cloud.execute({botId:bot.id,conversationId,name:'browse_url',args:{url},signal,finishStarted:true});return text({url,output:result.output,observation:result.observation});}
    });
  }
  if(capabilities.files){
    register('list_files','List files in this bot’s private workspace. Paths are relative.',{},async()=>text(await files.list(bot.id)));
    register('read_file','Read a text file, PDF or image in this bot’s workspace. Use this to inspect attached files.',{path:z.string()},async({path})=>files.content(bot.id,path));
    register('write_file','Create or replace a UTF-8 text file in this bot’s workspace. Use this for deliverables and memory notes.',{path:z.string(),content:z.string()},async({path,content})=>text(await files.write(bot.id,path,content)));
  }
  if(capabilities.computer&&connections.status().cloud){
    if(requestComputerHelp)register('request_control','Pause an unfinished browser task for the user to sign in, complete verification or interact personally. Call this before ending your reply when human help is needed. The app offers Take control and automatically resumes from the changed page after Give control back.',{reason:z.string().min(1).max(2000)},async input=>text(await requestComputerHelp(input)));
    if(capabilities.files)register('save_cloud_file','Save a UTF-8 file from the cloud computer to the bot’s local Files panel so the user can download it.',{path:z.string(),saveAs:z.string()},async({path,saveAs})=>{const result=await cloud.execute({botId:bot.id,conversationId,name:'read_file',args:{path},signal,finishStarted:true});return text(await files.write(bot.id,saveAs,result.output));});
    register('computer','Operate your isolated cloud Linux computer and browser. browse_url uses {url}; inspect_page uses {mode:"both",limit:40}; interact using fresh element refs with click_element {ref}, fill_field {ref,text}, press_key {key}, scroll_page {direction,amount}. capture_screen uses {}. wait_for uses {condition:"text_visible",value:"text",timeout_ms:5000}; supported conditions are text_visible, text_hidden, url_contains, page_changed, element_visible, element_hidden, value_equals. run_command uses {command}. Navigation may return a partial page; inspect again to see freshly loaded controls. This computer is separate from the user’s Mac. Refresh observations after navigation. Do not submit external messages, purchases, or destructive changes without approval.',{action:z.enum(COMPUTER_ACTIONS),args:z.record(z.string(),z.unknown()).default({}),externalEffect:z.boolean().default(false)},async({action,args,externalEffect})=>{
      if(externalEffect&&!await approve('External action on cloud computer',{action,...args}))return text('The user declined this action.');
      const result=await cloud.execute({botId:bot.id,conversationId,name:action,args,signal,finishStarted:true});
      return {checkpoint:{receiptId:result.receiptId,output:result.output,outcome:result.outcome,url:result.observation?.url,title:result.observation?.title},content:[{type:'text',text:JSON.stringify({output:result.output,observation:result.observation,outcome:result.outcome})},...(result.image?[{type:'image',data:result.image,mimeType:'image/png'}]:[])]};
    });
  }
  if(memory){
    register('recall_memory','Find authorised memories from this bot, chat and permitted personal profile. Use this for earlier preferences, decisions and events; provide at as an ISO date only for historical questions. Missing facts are unknown.',{query:z.string().max(2000),at:z.string().optional()},async input=>{const rows=await memory.recall(input);return{checkpoint:{count:rows.length,ids:rows.map(r=>r.id)},...text(rows)};});
    register('learn_memory','Save a memory supported by an exact quote from the current user message. Personal profile is only for enduring facts the person explicitly states; one-off task constraints belong to thread scope. Inferences remain proposals. Never store secrets.',{key:z.string().max(120),title:z.string().max(120),content:z.string().max(4000),quote:z.string().max(2000),scope:z.enum(['profile','bot','thread']).default('thread'),category:z.enum(['about','preferences','work','projects','constraint','fact']).default('fact'),stated:z.boolean().default(false)},async input=>{const result=await memory.learn(input);return{checkpoint:{status:result.status,id:result.id},...text(result)};});
  }
  if(collaboration){
    const peers=collaboration.members.filter(m=>m.id!==bot.id);
    register('ask_agent','Ask another participant in this group thread to do a concrete part of the task. Their reply and tool activity are visible in the group X-ray. Do not delegate back into an active chain. Available teammates: '+peers.map(p=>`${p.name} (${p.id}): ${p.instructions.slice(0,200)}`).join('; '),{toBotId:z.enum(peers.map(p=>p.id)),message:z.string().min(1).max(16000)},async input=>text(await collaboration.ask(input)));
    if(capabilities.files&&collaboration.share)register('share_file','Copy a file from your workspace to another selected teammate. Returns the actual recipient path to include in ask_agent. Use this before asking a teammate to review a document or image; their private Files are separate.',{toBotId:z.enum(peers.map(p=>p.id)),path:z.string()},async input=>text(await collaboration.share(input)));
  }
  if(tools.length)mcpServers.gratis=createSdkMcpServer({name:'gratis',version:'1.0.0',tools});
  if(capabilities.connections&&connections.status().composio)mcpServers.composio=await connections.mcp();
  // Your own MCP apps follow the same per-bot "connected apps" switch as Composio.
  const own=capabilities.connections&&appServers?appServers.runtime():{servers:{},apps:[]};Object.assign(mcpServers,own.servers);
  return {mcpServers,apps:own.apps,definitions,onActivity,collaboration,memory,t3,schedules,web:capabilities.web,capabilities,workspaceRoot:files.root(bot.id),approve,signature:JSON.stringify({capabilities,apps:own.apps,participants:collaboration?.members.map(m=>m.id),memory:!!memory,schedules:!!schedules,cloud:connections.status().cloud,composio:connections.status().composio,t3:t3?.binding})};
}
