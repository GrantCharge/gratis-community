import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {decodeAudio,pcmInfo,sameTranscriptWords,transcribeAudio} from '../src/voice.mjs';
function wav({silent=false,seconds=1}={}){
 const result=Buffer.alloc(44+32000*seconds);result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WAVEfmt ',8);result.writeUInt32LE(16,16);result.writeUInt16LE(1,20);result.writeUInt16LE(1,22);result.writeUInt32LE(16000,24);result.writeUInt32LE(32000,28);result.writeUInt16LE(2,32);result.writeUInt16LE(16,34);result.write('data',36);result.writeUInt32LE(result.length-44,40);if(!silent)for(let i=44;i<result.length;i+=2)result.writeInt16LE(Math.round(Math.sin(i/15)*1000),i);return result;
}
const audio={mimeType:'audio/wav',audioBase64:wav().toString('base64')};
test('audio validation rejects unsupported, malformed and silent input',()=>{
 assert.equal(decodeAudio(audio).format,'wav');assert.throws(()=>decodeAudio({...audio,mimeType:'text/plain'}),/supported/);assert.throws(()=>decodeAudio({...audio,audioBase64:'!'}),/supported/);
 assert.throws(()=>decodeAudio({...audio,mimeType:'audio/webm'}),/valid/);assert.throws(()=>pcmInfo(wav({silent:true})),/silent/);assert.throws(()=>pcmInfo(wav({seconds:122})),/two minutes/);
});
test('punctuation cleanup preserves words and fails back to local transcript',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'gratis-voice-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const run=async(_file,args)=>{if(args.includes('-i'))await writeFile(args.at(-1),wav());else await writeFile(join(dirname(args[0]),'speech.json'),JSON.stringify({text:'hello world',language:'en'}));};
 const base={dataDir,settings:{voiceCleanup:true},signal:new AbortController().signal,tools:async()=>({ffmpeg:'fake',whisper:'fake',env:{},model:'base.en',modelDir:'fake'}),run};
 let request;
 const cleaned=await transcribeAudio(audio,{...base,clean:async function*(r){request=r;yield 'Hello, world!';}});
 assert.equal(cleaned.text,'Hello, world!');assert.equal(request.settings.model,'haiku');assert.equal(request.persistSession,false);
 const changed=await transcribeAudio(audio,{...base,clean:async function*(){yield 'Goodbye, world!';}});assert.equal(changed.text,'hello world');assert.equal(changed.cleaned,false);
 const unavailable=await transcribeAudio(audio,{...base,clean:async function*(){throw new Error('Unavailable');}});assert.equal(unavailable.text,'hello world');assert.equal(unavailable.cleaned,false);
 assert.deepEqual(await readdir(join(dataDir,'voice-tmp')),[]);
 assert.equal(sameTranscriptWords('Do not buy it.','Do buy it.'),false);
});
test('cancelled transcription removes temporary audio',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'gratis-voice-cancel-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));const controller=new AbortController();
 await assert.rejects(transcribeAudio(audio,{dataDir,settings:{},signal:controller.signal,tools:async()=>({ffmpeg:'fake',env:{}}),run:async()=>{controller.abort();throw controller.signal.reason;}}),{name:'AbortError'});
 assert.deepEqual(await readdir(join(dataDir,'voice-tmp')),[]);
});
test('an online provider transcribes first and this Mac takes over when it fails',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'gratis-voice-online-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const id='11111111-2222-4333-8444-555555555555',provider={label:'FreeLLMAPI',baseUrl:'https://free.example/v1',apiKey:'k-voice'};
 let localRuns=0,seen;const run=async(_file,args)=>{localRuns++;if(args.includes('-i'))await writeFile(args.at(-1),wav());else await writeFile(join(dirname(args[0]),'speech.json'),JSON.stringify({text:'local words',language:'en'}));};
 const base={dataDir,settings:{voiceEngine:`custom:${id}`,voiceModel:'auto',voiceLanguage:'en'},signal:new AbortController().signal,tools:async()=>({ffmpeg:'fake',whisper:'fake',env:{},model:'base.en',modelDir:'fake'}),run,lookup:got=>{assert.equal(got,id);return provider;},clean:async function*(r){yield JSON.parse(r.messages[0].content).transcript;}};
 const online=await transcribeAudio(audio,{...base,fetchImpl:async(url,options)=>{seen={url,auth:options.headers.Authorization,model:options.body.get('model'),language:options.body.get('language'),file:options.body.get('file')};return new Response(JSON.stringify({text:' Please ask Gratis. '}),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(online.text,'Please ask Gratis.');assert.equal(online.engine,'FreeLLMAPI');assert.equal(localRuns,0);
 assert.equal(seen.url,'https://free.example/v1/audio/transcriptions');assert.equal(seen.auth,'Bearer k-voice');assert.equal(seen.model,'auto');assert.equal(seen.language,'en');assert.equal(seen.file.name,'recording.wav');
 const fallback=await transcribeAudio(audio,{...base,fetchImpl:async()=>new Response('{}',{status:503})});
 assert.equal(fallback.text,'local words');assert.equal(fallback.engine,'This Mac');assert.equal(fallback.fallback,true);assert.match(fallback.warning,/FreeLLMAPI was unavailable \(FreeLLMAPI returned HTTP 503/);assert.ok(localRuns>0);
 const offline=await transcribeAudio(audio,{...base,fetchImpl:async()=>{throw new TypeError('fetch failed');}});assert.equal(offline.text,'local words');assert.doesNotMatch(offline.warning,/k-voice/);
 await assert.rejects(transcribeAudio(audio,{...base,fetchImpl:async()=>new Response('{}',{status:503}),tools:async()=>{throw new Error('Voice input needs whisper installed on this computer.');}}),/FreeLLMAPI was unavailable .*Voice input needs whisper/);
 const removed=await transcribeAudio(audio,{...base,lookup:()=>{throw new Error('This custom provider was removed.');}});assert.equal(removed.text,'local words');
 assert.deepEqual(await readdir(join(dataDir,'voice-tmp')),[]);
});
