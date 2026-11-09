import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';
import {CustomProviders,customProviderUrl,customModelId} from '../src/custom-providers.mjs';import {streamReply,validateSettings,setCustomProviderLookup} from '../src/backend.mjs';import {ChatService} from '../src/chat-service.mjs';
const encrypt=s=>Buffer.from(s).map(x=>x^42),decrypt=b=>Buffer.from(b).map(x=>x^42).toString();
async function store(t,fetchImpl){const directory=await mkdtemp(join(tmpdir(),'gratis-custom-'));t.after(()=>rm(directory,{recursive:true,force:true}));const make=()=>new CustomProviders({directory,encrypt,decrypt,fetchImpl}).init();return{directory,make};}
const bot={name:'Helper',instructions:'Be concise'};
async function collect(settings){let s='';for await(const chunk of streamReply({settings,bot,messages:[{role:'user',content:'Hi'}],signal:new AbortController().signal}))s+=chunk;return s;}

test('custom provider addresses need HTTPS (or this computer) and no embedded secrets',()=>{
 assert.equal(customProviderUrl('https://api.commandcode.ai/provider/v1/'),'https://api.commandcode.ai/provider/v1');
 assert.equal(customProviderUrl('https://api.example.com/v1/chat/completions'),'https://api.example.com/v1');
 assert.equal(customProviderUrl('http://127.0.0.1:8080/v1'),'http://127.0.0.1:8080/v1');
 for(const bad of ['http://api.example.com/v1','https://user:pass@api.example.com/v1','https://api.example.com/v1?key=secret','ftp://api.example.com','not a url'])assert.throws(()=>customProviderUrl(bad));
 for(const id of ['auto:default','deepseek/deepseek-v4-flash','gpt-4.1','qwen3@latest'])assert.ok(customModelId(id),id);
 for(const id of ['','../x','a b','x'.repeat(201)])assert.equal(customModelId(id),false,id);
});
test('keys are encrypted at rest, kept on update and never included in snapshots',async t=>{
 const s=await store(t);const providers=await s.make();
 await assert.rejects(providers.add({label:'Command Code',baseUrl:'https://api.commandcode.ai/provider/v1'}),/API key/);
 const added=await providers.add({label:'Command Code',baseUrl:'https://api.commandcode.ai/provider/v1',apiKey:'secret-key-123'});
 assert.deepEqual(Object.keys(added).sort(),['baseUrl','hasKey','id','label']);assert.equal(added.hasKey,true);
 assert.equal(JSON.stringify(providers.snapshot()).includes('secret-key-123'),false);
 assert.equal((await readFile(join(s.directory,'custom-providers.secure'))).includes(Buffer.from('secret-key-123')),false);
 await assert.rejects(providers.add({label:'command code',baseUrl:'https://other.example/v1',apiKey:'k'}),/already have/);
 await providers.update({id:added.id,label:'CMD',apiKey:''});const reopened=await s.make();
 assert.equal(reopened.get(added.id).apiKey,'secret-key-123');assert.equal(reopened.snapshot()[0].label,'CMD');
 await assert.rejects(reopened.update({id:added.id,baseUrl:'https://elsewhere.example/v1'}),/key again/);
 await reopened.remove({id:added.id});assert.deepEqual(reopened.snapshot(),[]);assert.throws(()=>reopened.get(added.id),/removed/);
});
test('model lists send the key, put routing aliases first and explain rejected keys',async t=>{
 let auth='',status=200;const fetchImpl=async(url,options)=>{auth=options.headers.Authorization;assert.equal(url,'https://free.example/v1/models');return new Response(JSON.stringify({data:[{id:'qwen3'},{id:'auto:default'},{id:'bad id'},{id:'qwen3'},{id:'gemini-flash'}]}),{status,headers:{'content-type':'application/json'}});};
 const s=await store(t,fetchImpl);const providers=await s.make();const p=await providers.add({label:'FreeLLMAPI',baseUrl:'https://free.example/v1',apiKey:'k1'});
 assert.deepEqual((await providers.models(p.id)).map(m=>m.id),['auto:default','gemini-flash','qwen3']);assert.equal(auth,'Bearer k1');
 status=401;await assert.rejects(providers.models(p.id,{force:true}),/rejected the API key/);
});
test('chat replies stream from the chosen custom provider with its key',async t=>{
 const seen=[];const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{seen.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(body)});res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');setTimeout(()=>{res.end('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n');},20);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();setCustomProviderLookup(null);});
 const id='11111111-2222-4333-8444-555555555555';setCustomProviderLookup(lookup=>{assert.equal(lookup,id);return{label:'Test provider',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'k2'};});
 const settings=validateSettings({provider:'custom',customProviderId:id,model:'auto:default',baseUrl:'http://127.0.0.1:11434/v1'});
 assert.equal(settings.customProviderId,id);assert.equal(await collect(settings),'Hello');
 assert.equal(seen[0].url,'/v1/chat/completions');assert.equal(seen[0].auth,'Bearer k2');assert.equal(seen[0].body.model,'auto:default');assert.equal(seen[0].body.messages[0].content,'Be concise');
 assert.throws(()=>validateSettings({provider:'custom',model:'x',baseUrl:'http://127.0.0.1:11434/v1'}),/custom provider/);
});
test('custom provider errors name the provider and never echo the key',async t=>{
 const server=createServer((req,res)=>{res.writeHead(req.url.includes('limited')?429:401);res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();setCustomProviderLookup(null);});
 const id='11111111-2222-4333-8444-555555555555';let path='v1';setCustomProviderLookup(()=>({label:'Command Code',baseUrl:`http://127.0.0.1:${server.address().port}/${path}`,apiKey:'never-shown'}));
 const settings={provider:'custom',customProviderId:id,model:'m',baseUrl:'http://127.0.0.1:11434/v1'};
 await assert.rejects(collect(settings),e=>/Command Code rejected the API key/.test(e.message)&&!e.message.includes('never-shown'));
 path='limited';await assert.rejects(collect(settings),/rate limiting/);
 setCustomProviderLookup(()=>{const error=new Error('This custom provider was removed. Choose another provider in Settings.');throw error;});await assert.rejects(collect(settings),/removed/);
});
test('each custom provider remembers its own last model when switching providers',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-custom-switch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const service=new ChatService({dataDir:directory,runtimeFactory:async()=>({}),backend:async function*(){yield 'ok';}});await service.init();t.after(()=>service.close?.());
 const a='11111111-2222-4333-8444-555555555555',b='66666666-7777-4888-9999-aaaaaaaaaaaa',base=service.state.settings;
 await service.updateSettings({...base,provider:'custom',customProviderId:a,model:'auto:quick'});
 await service.updateSettings({...service.state.settings,provider:'custom',customProviderId:b,model:'claude-fable-5'});
 await service.updateSettings({...service.state.settings,customProviderId:undefined,provider:'claude',model:'opus'});
 const remembered=service.state.settings.providerDefaults;
 assert.equal(remembered[`custom:${a}`].model,'auto:quick');assert.equal(remembered[`custom:${b}`].model,'claude-fable-5');assert.equal(remembered.claude.model,'opus');
 assert.equal(service.state.settings.customProviderId,undefined);
});
