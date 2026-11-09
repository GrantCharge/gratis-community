import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MobileProviders} from '../src/mobile-providers.mjs';
import {ChatService} from '../src/chat-service.mjs';
import {mobileCommand} from '../src/mobile-bridge.mjs';
import {mobileSnapshot} from '../src/mobile-projection.mjs';
const options={claudeStatus:async()=>({signedIn:true}),codexStatus:async()=>({signedIn:true}),codexModels:async()=>[{id:'test-codex',name:'Test Codex',defaultEffort:'low',efforts:['low','medium']}]};
test('phone model selection uses existing subscriptions and persists desktop settings without exporting credentials',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-provider-test-')),service=new ChatService({dataDir:directory,backend:async function*(){yield 'reply';}});
 try{
  await service.init();const providers=new MobileProviders(options),conversationId=service.state.activeConversationId;
  await providers.select(service,{conversationId,provider:'claude',model:'haiku'});
  assert.equal(service.state.settings.provider,'claude');assert.equal(service._bot(service.state.activeBotId).model,'haiku');
  await providers.select(service,{conversationId,provider:'codex',model:'test-codex'});
  assert.equal(service.state.settings.provider,'codex');assert.equal(service.state.settings.effort,'low');
  assert.equal(service._bot(service.state.activeBotId).codexModel,'test-codex');
  const projection=mobileSnapshot(service,conversationId,providers.snapshot());assert.equal(projection.selected.model,'test-codex');
  assert.equal(projection.providers.length,2);assert.doesNotMatch(JSON.stringify(projection),/token|apiKey|authMethod|sessionId/);
  await assert.rejects(providers.select(service,{conversationId,provider:'codex',model:'not-in-catalog'}),/not available/);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
test('missing subscription rejects a phone selection without changing the workspace',async()=>{
 const providers=new MobileProviders({...options,claudeStatus:async()=>({signedIn:false})});
 let changed=false;const service={_conversation:()=>({}),teams:{busy:()=>false},updateSettings:()=>{changed=true;}};
 await assert.rejects(providers.select(service,{conversationId:'chat',provider:'claude',model:'sonnet'}),/Sign in/);assert.equal(changed,false);
});
test('the phone protocol accepts only bounded provider choices',()=>{
 assert.equal(mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:'claude',model:'haiku'}).model,'haiku');
 assert.throws(()=>mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:'evil',model:'x'}));
 assert.throws(()=>mobileCommand({kind:'send',seq:1,conversationId:'chat',text:'hi',provider:'claude'}));
 assert.throws(()=>mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:'claude',model:'haiku',apiKey:'secret'}));
});
test('the phone can choose a custom provider and its model without ever receiving the key',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-provider-test-')),service=new ChatService({dataDir:directory,backend:async function*(){yield 'reply';}});
 const id='11111111-2222-4333-8444-555555555555',many=[{id:'auto',name:'auto'},{id:'auto:quick',name:'auto:quick'},...Array.from({length:60},(_,i)=>({id:`model-${String(i).padStart(2,'0')}`,name:`Model ${i}`}))];
 const customProviders={snapshot:()=>[{id,label:'FreeLLMAPI',baseUrl:'https://free.example/v1',hasKey:true,apiKey:'never-exported'}],models:async()=>many};
 try{
  await service.init();const providers=new MobileProviders({...options,customProviders,settings:()=>service.state.settings}),conversationId=service.state.activeConversationId;
  const catalog=await providers.refresh(true),entry=catalog.find(p=>p.id===`custom:${id}`);
  assert.equal(entry.name,'FreeLLMAPI');assert.equal(entry.models.length,30);assert.equal(entry.more,32);
  await providers.select(service,{conversationId,provider:`custom:${id}`,model:'auto:quick'});
  assert.equal(service.state.settings.provider,'custom');assert.equal(service.state.settings.customProviderId,id);assert.equal(service.state.settings.model,'auto:quick');
  await providers.select(service,{conversationId,provider:`custom:${id}`,model:'model-59'});assert.equal(service.state.settings.model,'model-59');
  const projection=mobileSnapshot(service,conversationId,await providers.refresh(true));
  assert.equal(projection.selected.provider,`custom:${id}`);assert.equal(projection.selected.model,'model-59');assert.ok(projection.providers.find(p=>p.custom).models.some(m=>m.id==='model-59'));
  assert.doesNotMatch(JSON.stringify(projection),/never-exported|apiKey|free\.example/);
  await providers.select(service,{conversationId,provider:'claude',model:'haiku'});assert.equal(service.state.settings.provider,'claude');assert.equal(service.state.settings.customProviderId,undefined);
  await assert.rejects(providers.select(service,{conversationId,provider:'custom:99999999-2222-4333-8444-555555555555',model:'auto'}),/removed/);
  assert.equal(mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:`custom:${id}`,model:'deepseek/deepseek-v4:free'}).model,'deepseek/deepseek-v4:free');
  assert.throws(()=>mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:'custom:not-a-uuid',model:'auto'}));
  assert.throws(()=>mobileCommand({kind:'model',seq:1,conversationId:'chat',provider:'claude',model:'auto:quick'}));
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
