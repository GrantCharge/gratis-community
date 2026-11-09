import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {UnauthorizedError} from '@modelcontextprotocol/sdk/client/auth.js';

export function t3Endpoint(value){
 const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Enter a T3 address without credentials or query parameters.');
 if(url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Remote T3 connections require HTTPS.');
 const pathname=url.pathname.replace(/\/+$/,'');url.pathname=pathname.endsWith('/mcp')?pathname:pathname+'/mcp';return url.href;
}
export const t3Error=error=>String(error?.message||error).replace(/(?:Bearer\s+|(?:access_token|refresh_token|code_verifier)[=:]\s*)[^\s,"}]+/gi,'[credential redacted]').replace(/https?:\/\/[^\s]+/g,'[T3 address]').slice(0,500);
export function t3Payload(result){
 let value=result.structuredContent;
 if(!value){const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n');try{value=JSON.parse(text);}catch{if(result.isError){const error=new Error(text||'T3 rejected this request.');error.retryable=false;throw error;}throw new Error('T3 returned an unexpected response. Check its version and reconnect.');}}
 if(result.isError||value?._tag==='Failure'||value?._tag==='OrchestratorMcpFailure'||value?.error&& !value?.thread&&!value?.threadId){const error=new Error(typeof value.error==='string'?value.error:value.message||'T3 rejected this request.');error.code=value.code;error.retryable=false;throw error;}
 return value;
}
export class T3Connection {
 // file: each environment keeps its own encrypted connection file; the default is the original single-connection file.
 constructor({directory,encrypt,decrypt,openExternal,onState=()=>{},file='t3-connection.secure',clientFactory=()=>new Client({name:'Gratis',version:'0.12.0'}),transportFactory=(url,options)=>new StreamableHTTPClientTransport(new URL(url),options)}){
  if(!/^t3-connection(?:-[a-f0-9-]{36})?\.secure$/.test(file))throw new Error('Invalid T3 connection file.');
  Object.assign(this,{directory,encrypt,decrypt,openExternal,onState,file,clientFactory,transportFactory});this.data={};this.current={status:'disconnected',connected:false};this.persist=Promise.resolve();this.clientPromise=null;this.authJob=null;this.epoch=0;
 }
 async init(){try{this.data=JSON.parse(this.decrypt(await readFile(join(this.directory,this.file))));}catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock the saved T3 connection.');}if(this.data.endpoint&&!this.data.identity){this.data.identity=randomUUID();await this.save();}this.current={status:this.data.endpoint?'saved':'disconnected',connected:false};return this;}
 snapshot(){return{...this.current,endpoint:this.data.endpoint||'',local:this.data.local||null};}
 update(status,error){this.current={status,connected:status==='connected',...(error?{error:t3Error(error)}:{})};this.onState(this.snapshot());return this.snapshot();}
 async save(){const value=JSON.stringify(this.data);const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.t3-'+randomUUID());await writeFile(tmp,this.encrypt(value),{mode:0o600});await rename(tmp,join(this.directory,this.file));};this.persist=this.persist.then(write,write);return this.persist;}
 provider(flow){const owner=this;return{
  get redirectUrl(){return owner.data.redirectUrl;},
  get clientMetadata(){return{client_name:'Gratis',redirect_uris:[owner.data.redirectUrl||'http://127.0.0.1/t3/callback'],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'};},
  state:()=>flow?.state||randomUUID(),
  clientInformation:()=>owner.data.clientInformation,
  saveClientInformation:async value=>{owner.data.clientInformation=value;await owner.save();},
  tokens:()=>owner.data.tokens,
  saveTokens:async value=>{owner.data.tokens=value;await owner.save();},
  saveCodeVerifier:async value=>{owner.data.verifier=value;await owner.save();},
  codeVerifier:()=>owner.data.verifier,
  redirectToAuthorization:async url=>{if(!flow)throw new Error('Reconnect T3 in Connections to renew access.');const parsed=new URL(url);if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw new Error('T3 returned an insecure sign-in page.');owner.update('authorizing');await owner.openExternal(url.href);},
  invalidateCredentials:async scope=>{if(scope==='all'||scope==='client')delete owner.data.clientInformation;if(scope==='all'||scope==='tokens')delete owner.data.tokens;if(scope==='all'||scope==='verifier')delete owner.data.verifier;await owner.save();},
 };}
 async establish(flow){
  if(!this.data.endpoint)throw new Error('Connect a T3 environment first.');
  let transport=this.transportFactory(this.data.endpoint,{authProvider:this.provider(flow),reconnectionOptions:{maxRetries:0}}),client=this.clientFactory();
  try{await client.connect(transport,{timeout:20000});}
  catch(error){
   if(!flow||!(error instanceof UnauthorizedError)){await client.close().catch(()=>{});throw error;}
   try{const code=await flow.code;await transport.finishAuth(code);}finally{await client.close().catch(()=>{});}
   transport=this.transportFactory(this.data.endpoint,{authProvider:this.provider(flow),reconnectionOptions:{maxRetries:0}});client=this.clientFactory();await client.connect(transport,{timeout:20000});
  }
  const listed=await client.listTools({}, {timeout:20000});
  if(!listed.tools.some(t=>t.name==='t3_thread_launch')||!listed.tools.some(t=>t.name==='t3_thread_read')){await client.close();throw new Error('This T3 version does not expose the required thread tools. Update T3 and reconnect.');}
  this.toolNames=new Set(listed.tools.map(t=>t.name));this.update('connected');return client;
 }
 async client(){if(!this.clientPromise){this.clientPromise=this.establish().catch(error=>{this.clientPromise=null;this.update('error',error);throw error;});}return this.clientPromise;}
 async connectLocal({endpoint,local,token}){await this.close();const normalized=t3Endpoint(endpoint),bindings=normalized===this.data.endpoint?this.data.bindings:undefined;this.data={identity:randomUUID(),endpoint:normalized,local,bindings,tokens:{access_token:token,token_type:'Bearer'}};await this.save();await this.client();return this.snapshot();}
 async connect({endpoint,local}={}){
  if(this.authJob)return this.snapshot();const normalized=t3Endpoint(endpoint||this.data.endpoint);await this.close();
  if(normalized!==this.data.endpoint)this.data={endpoint:normalized,identity:randomUUID()};else this.data.endpoint=normalized;
  this.data.identity ||= randomUUID();
  if(local)this.data.local=local;await this.save();this.update('connecting');
  const flow={state:randomUUID()},epoch=++this.epoch;let rejectCode;
  flow.code=new Promise((resolve,reject)=>{flow.resolve=resolve;rejectCode=reject;});flow.code.catch(()=>{});
  const server=createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');const incoming=Buffer.from(url.searchParams.get('state')||''),expected=Buffer.from(flow.state);
   const valid=incoming.length===expected.length&&timingSafeEqual(incoming,expected);
   if(req.method!=='GET'||url.pathname!=='/t3/callback'||!valid){res.writeHead(400);res.end('This sign-in does not belong to Gratis.');return;}
   if(url.searchParams.get('error')){rejectCode(new Error('T3 sign-in was declined.'));res.end('Sign-in cancelled. Return to Gratis.');return;}
   const code=url.searchParams.get('code');if(!code){res.writeHead(400);res.end('Missing authorization code.');return;}
   flow.resolve(code);res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.end('<!doctype html><title>Gratis</title><p>Authorization received. You can return to Gratis.</p>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const redirect='http://127.0.0.1:'+server.address().port+'/t3/callback';
  // A new callback URI requires a fresh OAuth client registration. Access tokens
  // remain reusable, so ordinary app restarts never open a sign-in page.
  if(this.data.redirectUrl!==redirect){delete this.data.clientInformation;delete this.data.verifier;}this.data.redirectUrl=redirect;await this.save();
  const timer=setTimeout(()=>rejectCode(new Error('T3 sign-in expired. Reconnect to try again.')),300000);timer.unref?.();
  const job={server,reject:rejectCode,promise:null};this.authJob=job;
  job.promise=this.establish(flow).then(client=>{if(epoch!==this.epoch){void client.close();return;}this.clientPromise=Promise.resolve(client);}).catch(error=>{if(epoch===this.epoch){this.clientPromise=null;this.update('error',error);}}).finally(()=>{clearTimeout(timer);server.close();if(this.authJob===job)this.authJob=null;});
  return this.snapshot();
 }
 async call(name,args={}){
  const client=await this.client();try{return t3Payload(await client.callTool({name,arguments:args},undefined,{timeout:30000}));}
  catch(error){if(error.retryable!==false){this.clientPromise=null;await client.close().catch(()=>{});}if(error instanceof UnauthorizedError)this.update('error',new Error('T3 access expired. Reconnect in Tasks.'));throw error;}
 }
 async disconnect(){await this.close();this.data={};await this.save();return this.update('disconnected');}
 async close(){this.epoch++;if(this.authJob){this.authJob.reject(new Error('Sign-in cancelled.'));this.authJob.server.close();await this.authJob.promise;}const current=this.clientPromise;this.clientPromise=null;if(current)try{await(await current).close();}catch{};}
}
