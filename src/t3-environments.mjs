import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {T3Connection,t3Endpoint} from './t3-connection.mjs';

// Several T3 environments (for example a laptop and a VPS), each with its own
// connection, OAuth tokens and encrypted file. Bot bindings name the environment,
// because project and thread IDs only exist on the host that created them.
export const LEGACY_ENVIRONMENT='legacy';
const LEGACY_FILE='t3-connection.secure',REGISTRY='t3-environments.secure',ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fileFor=id=>id===LEGACY_ENVIRONMENT?LEGACY_FILE:'t3-connection-'+id+'.secure';
const defaultLabel=endpoint=>{try{return new URL(endpoint).hostname.split('.')[0]||'T3';}catch{return 'T3';}};
function cleanLabel(value,fallback){const label=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';if(label.length>60)throw new Error('Use an environment name under 60 characters.');return label||fallback;}
function removed(){const error=new Error('This T3 environment was removed. Add it again to continue its tasks.');error.retryable=false;return error;}

export class T3Environments {
 constructor({directory,encrypt,decrypt,openExternal,onState=()=>{},busy=()=>false,connectionFactory=options=>new T3Connection(options)}){
  Object.assign(this,{directory,encrypt,decrypt,openExternal,onState,busy,connectionFactory});this.items=new Map();this.bindings={};this.persist=Promise.resolve();
 }
 async open(id,label){const connection=await this.connectionFactory({directory:this.directory,encrypt:this.encrypt,decrypt:this.decrypt,openExternal:this.openExternal,file:fileFor(id),onState:()=>this.onState(this.snapshot())}).init();const item={id,label,connection};this.items.set(id,item);return item;}
 async init(){
  let saved=null;
  try{saved=JSON.parse(this.decrypt(await readFile(join(this.directory,REGISTRY))));}catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock saved T3 environments.');}
  if(saved){
   for(const e of saved.environments||[])if(e?.id===LEGACY_ENVIRONMENT||ID.test(e?.id||''))await this.open(e.id,cleanLabel(e.label,'T3'));
   for(const [botId,b] of Object.entries(saved.bindings||{}))if(this.items.has(b?.environmentId)&&typeof b.projectId==='string')this.bindings[botId]=b;
   return this;
  }
  // First run after upgrading: the original single connection becomes the first environment
  // and keeps its file, tokens and bot bindings.
  const legacy=await this.open(LEGACY_ENVIRONMENT,'T3');
  if(!legacy.connection.data.endpoint){this.items.delete(LEGACY_ENVIRONMENT);await this.save();return this;}
  legacy.label=legacy.connection.data.local?'This computer':defaultLabel(legacy.connection.data.endpoint);
  for(const [botId,b] of Object.entries(legacy.connection.data.bindings||{}))if(typeof b?.projectId==='string')this.bindings[botId]={...b,environmentId:LEGACY_ENVIRONMENT};
  await this.save();
  if(legacy.connection.data.bindings){delete legacy.connection.data.bindings;await legacy.connection.save();}
  return this;
 }
 async save(){const body=JSON.stringify({version:1,environments:[...this.items.values()].map(({id,label})=>({id,label})),bindings:this.bindings});const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.t3-environments-'+randomUUID());await writeFile(tmp,this.encrypt(body),{mode:0o600});await rename(tmp,join(this.directory,REGISTRY));};this.persist=this.persist.then(write,write);return this.persist;}
 snapshot(){return[...this.items.values()].map(({id,label,connection})=>({id,label,...connection.snapshot()}));}
 item(id){const item=this.items.get(id||LEGACY_ENVIRONMENT);if(!item)throw removed();return item;}
 get(id){return this.item(id).connection;}
 find(id){return this.items.get(id||LEGACY_ENVIRONMENT)?.connection;}
 label(id){return this.items.get(id||LEGACY_ENVIRONMENT)?.label||'';}
 duplicate(endpoint,except){if([...this.items.values()].some(e=>e.id!==except&&e.connection.data.endpoint===endpoint))throw new Error('This T3 environment is already added.');}
 async add({endpoint,label}={}){
  const normalized=t3Endpoint(endpoint);this.duplicate(normalized);
  const item=await this.open(randomUUID(),cleanLabel(label,defaultLabel(normalized)));await this.save();
  await item.connection.connect({endpoint:normalized});return{id:item.id,label:item.label,...item.connection.snapshot()};
 }
 async reconnect({id,endpoint}={}){
  const item=this.item(id);
  if(endpoint){const normalized=t3Endpoint(endpoint);if(normalized!==item.connection.data.endpoint){this.duplicate(normalized,item.id);this.clearBindings(item.id);await this.save();}}
  await item.connection.connect({endpoint});return{id:item.id,label:item.label,...item.connection.snapshot()};
 }
 async local({endpoint,local,token}){
  let item=[...this.items.values()].find(e=>e.connection.data.local);
  if(!item){item=await this.open(randomUUID(),'This computer');await this.save();}
  await item.connection.connectLocal({endpoint,local,token});return item.id;
 }
 async rename({id,label}){const item=this.item(id);item.label=cleanLabel(label,item.label);await this.save();this.onState(this.snapshot());return this.snapshot();}
 async remove({id}){
  const item=this.item(id);if(this.busy(item.id))throw new Error('Stop or finish this environment’s T3 tasks before removing it.');
  await item.connection.disconnect();await rm(join(this.directory,fileFor(item.id)),{force:true});
  this.items.delete(item.id);this.clearBindings(item.id);await this.save();this.onState(this.snapshot());return this.snapshot();
 }
 binding(botId){const b=this.bindings[botId];return b&&this.items.has(b.environmentId)?b:null;}
 async setBinding(botId,binding){if(!binding){delete this.bindings[botId];}else{this.item(binding.environmentId);this.bindings[botId]=binding;}await this.save();return this.binding(botId);}
 clearBindings(id){for(const [botId,b] of Object.entries(this.bindings))if(b.environmentId===id)delete this.bindings[botId];}
 async close(){await Promise.all([...this.items.values()].map(e=>e.connection.close()));await this.persist;}
}
