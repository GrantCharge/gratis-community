import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {McpServers,mcpServerUrl,serverKey} from '../src/mcp-servers.mjs';import {createCodexBridge} from '../src/codex-mcp.mjs';import {agentRuntime} from '../src/agent-tools.mjs';import {claudeSystemPrompt} from '../src/claude-backend.mjs';
const encrypt=s=>Buffer.from(s).map(x=>x^42),decrypt=b=>Buffer.from(b).map(x=>x^42).toString();
async function store(t){const directory=await mkdtemp(join(tmpdir(),'gratis-mcp-'));t.after(()=>rm(directory,{recursive:true,force:true}));return{directory,make:()=>new McpServers({directory,encrypt,decrypt}).init()};}
// A small synthetic app on this computer that needs a bearer token, like n8n or OpenSEO.
async function fakeApp(t,token='app-token-123'){
 const calls=[];
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  const mcp=new McpServer({name:'fake',version:'1.0.0'});
  mcp.registerTool('run_workflow',{title:'Run workflow',description:'Runs a workflow',inputSchema:{name:z.string()}},async({name})=>{calls.push(name);return{content:[{type:'text',text:'ran '+name}]};});
  mcp.registerTool('list_workflows',{description:'Lists workflows',inputSchema:{}},async()=>({content:[{type:'text',text:'a, b'}]}));
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});res.on('close',()=>{void transport.close();void mcp.close();});
  await mcp.connect(transport);await transport.handleRequest(req,res,body?JSON.parse(body):undefined);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 return {url:`http://127.0.0.1:${server.address().port}/mcp`,token,calls};
}

test('app addresses need HTTPS (or this computer) and no embedded passwords',()=>{
 assert.equal(mcpServerUrl('https://n8n.example.com/mcp-server/http/'),'https://n8n.example.com/mcp-server/http');
 assert.equal(mcpServerUrl('http://localhost:5678/mcp'),'http://localhost:5678/mcp');
 for(const bad of ['http://n8n.example.com/mcp','https://u:p@n8n.example.com/mcp','ftp://x.example','nope'])assert.throws(()=>mcpServerUrl(bad));
});
test('tokens are encrypted at rest, kept on update and never in snapshots',async t=>{
 const s=await store(t);const apps=await s.make();
 const added=await apps.add({label:'n8n',url:'https://n8n.example.com/mcp-server/http',token:'secret-token-1'});
 assert.deepEqual(Object.keys(added).sort(),['ask','enabled','hasToken','id','label','url']);assert.equal(added.ask,true);
 assert.doesNotMatch(await readFile(join(s.directory,'mcp-servers.secure'),'latin1'),/secret-token-1/);
 await assert.rejects(apps.add({label:'N8N',url:'https://other.example.com/mcp'}),/already/);
 await apps.update({id:added.id,label:'Automations',enabled:false});
 await assert.rejects(apps.update({id:added.id,url:'https://n8n2.example.com/mcp'}),/token again/);
 const reopened=await s.make();assert.equal(reopened.get(added.id).token,'secret-token-1');assert.equal(reopened.snapshot()[0].label,'Automations');
 assert.deepEqual(reopened.runtime(),{servers:{},apps:[]},'paused apps are not offered to bots');
 await reopened.update({id:added.id,enabled:true,ask:false});const {servers,apps:list}=reopened.runtime(),key=serverKey(reopened.get(added.id));
 assert.match(key,/^automations_[a-f0-9]{4}$/);assert.deepEqual(servers[key],{type:'http',url:'https://n8n.example.com/mcp-server/http',headers:{Authorization:'Bearer secret-token-1'}});assert.deepEqual(list,[{key,label:'Automations',ask:false}]);
 assert.notEqual(serverKey({label:'Composio',id:'abcd0000'}).split('_')[0],'composio');
 await reopened.remove({id:added.id});assert.deepEqual((await s.make()).snapshot(),[]);
});
test('testing an app lists its tools and explains a wrong token without echoing it',async t=>{
 const app=await fakeApp(t),s=await store(t),apps=await s.make();
 const good=await apps.add({label:'Fake',url:app.url,token:app.token}),bad=await apps.add({label:'Wrong',url:app.url,token:'nope-wrong-token'});
 const ok=await apps.test(good.id);assert.equal(ok.ok,true);assert.equal(ok.count,2);assert.deepEqual(ok.tools.sort(),['Run workflow','list_workflows']);
 const no=await apps.test(bad.id);assert.equal(no.ok,false);assert.match(no.error,/rejected the token/);assert.doesNotMatch(JSON.stringify(no),/nope-wrong-token/);
});
test('bots get apps only when Connected apps is on, and Claude is told what they are',async t=>{
 const s=await store(t),apps=await s.make();await apps.add({label:'OpenSEO',url:'https://openseo.example.com/mcp',token:'tok-12345'});
 const base={conversationId:'c',files:{root:()=>'/tmp/x'},cloud:{},connections:{status:()=>({composio:false,cloud:false})},signal:new AbortController().signal,onActivity(){},approve:async()=>true,apps};
 const on=await agentRuntime({...base,bot:{id:'b',capabilities:{web:false,files:false,computer:false,connections:true}}});
 const key=on.apps[0].key;assert.equal(on.mcpServers[key].url,'https://openseo.example.com/mcp');assert.match(claudeSystemPrompt({instructions:''},on),new RegExp(`OpenSEO \\(tools prefixed ${key}\\)`));
 const off=await agentRuntime({...base,bot:{id:'b',capabilities:{web:false,files:false,computer:false,connections:false}}});
 assert.deepEqual(off.apps,[]);assert.equal(Object.keys(off.mcpServers).length,0);
});
test('Codex reaches apps through the bridge and asks before each action',async t=>{
 const app=await fakeApp(t),asked=[];let allow=false;
 const key='fake_abcd',runtime={definitions:[],mcpServers:{[key]:{type:'http',url:app.url,headers:{Authorization:'Bearer '+app.token}},missing_0000:{type:'http',url:'http://127.0.0.1:9/mcp',headers:{}}},apps:[{key,label:'Fake',ask:true},{key:'missing_0000',label:'Offline',ask:true}],approve:async name=>{asked.push(name);return allow;},onActivity(){}};
 const bridge=await createCodexBridge(runtime);t.after(()=>bridge.close());
 const client=new Client({name:'test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:'Bearer '+bridge.token}}}));t.after(()=>client.close());
 const names=(await client.listTools()).tools.map(t=>t.name).sort();assert.deepEqual(names,['fake_abcd_list_workflows','fake_abcd_run_workflow'],'an offline app is skipped, not fatal');
 const denied=await client.callTool({name:'fake_abcd_run_workflow',arguments:{name:'send-invoices'}});assert.equal(denied.isError,true);assert.deepEqual(app.calls,[]);assert.deepEqual(asked,['Fake: run_workflow']);
 allow=true;const ran=await client.callTool({name:'fake_abcd_run_workflow',arguments:{name:'daily-report'}});assert.equal(ran.content[0].text,'ran daily-report');assert.deepEqual(app.calls,['daily-report']);
});
