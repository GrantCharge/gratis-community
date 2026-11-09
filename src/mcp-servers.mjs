import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Your own apps that speak MCP over HTTP, such as n8n or a self-hosted tool on a VPS.
// Tokens stay in the encrypted file and only travel to that server, from the main
// process. The renderer, the phone relay and error messages never see them.
const FILE='mcp-servers.secure',ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,LOOPBACK=['127.0.0.1','localhost','[::1]'];
// Names Gratis already uses for its own tool servers.
const RESERVED=new Set(['gratis','composio']);
export function mcpServerUrl(value){
 let url;try{url=new URL(String(value||'').trim());}catch{throw new Error('Enter the app’s MCP address, for example https://n8n.example.com/mcp-server/http.');}
 if(url.username||url.password||url.hash)throw new Error('Enter the MCP address without a password. Put the token in the token field.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&LOOPBACK.includes(url.hostname)))throw new Error('Apps must use HTTPS, or HTTP on this computer only.');
 return url.href.replace(/\/+$/,'');
}
function cleanLabel(value){const label=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';if(!label||label.length>40)throw new Error('Give the app a name under 40 characters.');return label;}
function cleanToken(value){if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>4000||/\s/.test(value.trim()))throw new Error('Paste the access token exactly as the app shows it.');return value.trim();}
// A short, stable name for tool prefixes: mcp__<key>__<tool> must stay readable and unique.
export function serverKey(item){const slug=item.label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20)||'app';return (RESERVED.has(slug)?'app_'+slug:slug)+'_'+item.id.slice(0,4);}
const headersFor=item=>item.token?{Authorization:'Bearer '+item.token}:{};

export class McpServers {
 constructor({directory,encrypt,decrypt,createClient=()=>new Client({name:'gratis',version:'1.0.0'}),onChange=()=>{}}){Object.assign(this,{directory,encrypt,decrypt,createClient,onChange});this.items=[];this.persist=Promise.resolve();}
 async init(){
  try{const saved=JSON.parse(this.decrypt(await readFile(join(this.directory,FILE))));this.items=(saved.servers||[]).filter(s=>ID.test(s?.id||'')&&typeof s.label==='string'&&typeof s.url==='string').map(s=>({id:s.id,label:s.label,url:s.url,token:typeof s.token==='string'?s.token:'',enabled:s.enabled!==false,ask:s.ask!==false}));}
  catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock saved apps.');}
  return this;
 }
 save(){const body=JSON.stringify({version:1,servers:this.items});const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.mcp-servers-'+randomUUID());await writeFile(tmp,this.encrypt(body),{mode:0o600});await rename(tmp,join(this.directory,FILE));};this.persist=this.persist.then(write,write);return this.persist;}
 snapshot(){return this.items.map(({id,label,url,token,enabled,ask})=>({id,label,url,hasToken:!!token,enabled,ask}));}
 get(id){const item=this.items.find(s=>s.id===id);if(!item)throw new Error('This app was removed.');return item;}
 async add({label,url,token,ask=true}={}){
  const item={id:randomUUID(),label:cleanLabel(label),url:mcpServerUrl(url),token:cleanToken(token),enabled:true,ask:ask!==false};
  if(this.items.some(s=>s.label.toLowerCase()===item.label.toLowerCase()))throw new Error('You already have an app with this name.');
  if(this.items.length>=20)throw new Error('You can connect up to 20 apps.');
  this.items.push(item);await this.save();this.onChange();return this.snapshot().find(s=>s.id===item.id);
 }
 // An empty token keeps the saved one, so it never has to travel back to the screen.
 async update({id,label,url,token,enabled,ask}={}){
  const item=this.get(id),next={...item,label:label===undefined?item.label:cleanLabel(label),url:url===undefined?item.url:mcpServerUrl(url)};
  const key=cleanToken(token);if(key)next.token=key;else if(next.url!==item.url&&item.token)throw new Error('Enter the token again when changing the address.');
  if(enabled!==undefined)next.enabled=!!enabled;if(ask!==undefined)next.ask=!!ask;
  if(this.items.some(s=>s.id!==id&&s.label.toLowerCase()===next.label.toLowerCase()))throw new Error('You already have an app with this name.');
  Object.assign(item,next);await this.save();this.onChange();return this.snapshot().find(s=>s.id===id);
 }
 async remove({id}={}){this.get(id);this.items=this.items.filter(s=>s.id!==id);await this.save();this.onChange();return this.snapshot();}
 // Connects once and lists the tools, so the person can see the address and token work.
 async test(id,{timeoutMs=15000}={}){
  const item=this.get(id),client=this.createClient(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
   await client.connect(new StreamableHTTPClientTransport(new URL(item.url),{requestInit:{headers:headersFor(item),signal:controller.signal,redirect:'error'}}));
   const tools=[];let cursor;do{const page=await client.listTools(cursor?{cursor}:{});tools.push(...page.tools.map(t=>t.title||t.name));cursor=page.nextCursor;}while(cursor&&tools.length<500);
   return {ok:true,count:tools.length,tools:tools.slice(0,12)};
  }catch(error){const text=String(error?.message||error);return {ok:false,error:[401,403].includes(error?.code)||/\b40[13]\b|unauthori[sz]ed|forbidden/i.test(text)?`${item.label} rejected the token.`:controller.signal.aborted?`${item.label} did not answer in time.`:`Could not connect to ${item.label}. Check the address and that its MCP option is turned on.`};}
  finally{clearTimeout(timer);await client.close().catch(()=>{});}
 }
 // What a chat run receives: tool-server configs keyed by a short name, plus who to ask.
 runtime(){const servers={},apps=[];for(const item of this.items.filter(s=>s.enabled)){const key=serverKey(item);servers[key]={type:'http',url:item.url,headers:headersFor(item)};apps.push({key,label:item.label,ask:item.ask});}return {servers,apps};}
 async close(){await this.persist;}
}
