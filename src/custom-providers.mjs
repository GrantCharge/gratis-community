import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// OpenAI-compatible chat providers that need an address and an API key, such as
// FreeLLMAPI, Command Code or DeepSeek. Keys stay in the encrypted file and never
// reach the renderer, the phone relay or error messages.
const FILE='custom-providers.secure',ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,LOOPBACK=['127.0.0.1','localhost','[::1]'];
export const CUSTOM_PROVIDER_PRESETS=Object.freeze([
 {label:'FreeLLMAPI',baseUrl:'',note:'Your FreeLLMAPI address ending in /v1, and a key from its Keys page.'},
 {label:'Command Code',baseUrl:'https://api.commandcode.ai/provider/v1',note:'A key from Command Code Studio → API Keys.'},
 {label:'DeepSeek',baseUrl:'https://api.deepseek.com/v1',note:'A key from the DeepSeek platform. Billed per use.'},
]);
export const customModelId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(value);
export function customProviderUrl(value){
 let url;try{url=new URL(String(value||'').trim());}catch{throw new Error('Enter the provider’s API address, for example https://api.example.com/v1.');}
 if(url.username||url.password||url.search||url.hash)throw new Error('Enter the API address without credentials or query parameters. Put the key in the API key field.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&LOOPBACK.includes(url.hostname)))throw new Error('Custom providers must use HTTPS, or HTTP on this computer only.');
 url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');return url.href.replace(/\/+$/,'');
}
function cleanLabel(value){const label=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';if(!label||label.length>60)throw new Error('Give the provider a name under 60 characters.');return label;}
function cleanKey(value){if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>1000||/\s/.test(value.trim()))throw new Error('Paste the API key exactly as the provider shows it.');return value.trim();}
function removed(){const error=new Error('This custom provider was removed. Choose another provider in Settings.');error.retryable=false;return error;}
export const authHeaders=provider=>provider.apiKey?{Authorization:'Bearer '+provider.apiKey}:{};

export class CustomProviders {
 constructor({directory,encrypt,decrypt,fetchImpl=(...args)=>fetch(...args),onChange=()=>{}}){Object.assign(this,{directory,encrypt,decrypt,fetchImpl,onChange});this.items=[];this.cache=new Map();this.persist=Promise.resolve();}
 async init(){
  try{const saved=JSON.parse(this.decrypt(await readFile(join(this.directory,FILE))));this.items=(saved.providers||[]).filter(p=>ID.test(p?.id||'')&&typeof p.label==='string'&&typeof p.baseUrl==='string').map(p=>({id:p.id,label:p.label,baseUrl:p.baseUrl,apiKey:typeof p.apiKey==='string'?p.apiKey:''}));}
  catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock saved custom providers.');}
  return this;
 }
 save(){const body=JSON.stringify({version:1,providers:this.items});const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.custom-providers-'+randomUUID());await writeFile(tmp,this.encrypt(body),{mode:0o600});await rename(tmp,join(this.directory,FILE));};this.persist=this.persist.then(write,write);return this.persist;}
 snapshot(){return this.items.map(({id,label,baseUrl,apiKey})=>({id,label,baseUrl,hasKey:!!apiKey}));}
 get(id){const item=this.items.find(p=>p.id===id);if(!item)throw removed();return item;}
 async add({label,baseUrl,apiKey}={}){
  const item={id:randomUUID(),label:cleanLabel(label),baseUrl:customProviderUrl(baseUrl),apiKey:cleanKey(apiKey)};
  if(!item.apiKey&&!LOOPBACK.includes(new URL(item.baseUrl).hostname))throw new Error('Add the provider’s API key.');
  if(this.items.some(p=>p.label.toLowerCase()===item.label.toLowerCase()))throw new Error('You already have a provider with this name.');
  this.items.push(item);await this.save();this.onChange();return this.snapshot().find(p=>p.id===item.id);
 }
 // An empty key keeps the saved one, so the key never has to travel back to the screen.
 async update({id,label,baseUrl,apiKey}={}){
  const item=this.get(id),next={...item,label:label===undefined?item.label:cleanLabel(label),baseUrl:baseUrl===undefined?item.baseUrl:customProviderUrl(baseUrl)};
  const key=cleanKey(apiKey);if(key)next.apiKey=key;else if(next.baseUrl!==item.baseUrl)throw new Error('Enter the API key again when changing the address.');
  if(this.items.some(p=>p.id!==id&&p.label.toLowerCase()===next.label.toLowerCase()))throw new Error('You already have a provider with this name.');
  Object.assign(item,next);this.cache.delete(id);await this.save();this.onChange();return this.snapshot().find(p=>p.id===id);
 }
 async remove({id}={}){this.get(id);this.items=this.items.filter(p=>p.id!==id);this.cache.delete(id);await this.save();this.onChange();return this.snapshot();}
 async models(id,{force=false}={}){
  const item=this.get(id),cached=this.cache.get(id);if(!force&&cached&&Date.now()-cached.at<300000)return cached.models;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);timer.unref?.();
  let response;try{response=await this.fetchImpl(item.baseUrl+'/models',{headers:{Accept:'application/json',...authHeaders(item)},redirect:'error',signal:controller.signal});}
  catch{throw new Error(`Could not reach ${item.label}. Check its address and your connection.`);}finally{clearTimeout(timer);}
  if(response.status===401||response.status===403)throw new Error(`${item.label} rejected the API key.`);
  if(!response.ok)throw new Error(`${item.label} returned HTTP ${response.status} for its model list.`);
  let payload;try{payload=await response.json();}catch{throw new Error(`${item.label} returned an unreadable model list.`);}
  const list=Array.isArray(payload?.data)?payload.data:Array.isArray(payload)?payload:[];
  const seen=new Set(),models=[];for(const m of list){const modelId=typeof m==='string'?m:m?.id;if(!customModelId(modelId)||seen.has(modelId))continue;seen.add(modelId);models.push({id:modelId,name:typeof m?.name==='string'&&m.name.length<=120?m.name:modelId});if(models.length>=500)break;}
  // Routing aliases (FreeLLMAPI's auto:* chains) first, then the rest alphabetically.
  models.sort((a,b)=>(b.id.startsWith('auto')-a.id.startsWith('auto'))||a.id.localeCompare(b.id));
  this.cache.set(id,{at:Date.now(),models});return models;
 }
 async close(){await this.persist;}
}
