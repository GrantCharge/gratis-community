import {traceValue,toolResultCheckpoint} from './computer-checkpoint.mjs';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
export async function createCodexBridge(runtime){
  const token=randomBytes(32).toString('hex'),transports=new Set(),clients=[];
  const definitions=[...runtime.definitions];
  // Codex reaches remote tool servers through this bridge: Composio, then the user's own apps.
  const remotes=[...(runtime.mcpServers.composio?[{key:'composio',prefix:'composio_',config:runtime.mcpServers.composio,ask:name=>!['COMPOSIO_SEARCH_TOOLS','COMPOSIO_GET_TOOL_SCHEMAS'].includes(name),label:name=>name}]:[]),
    ...(runtime.apps||[]).map(app=>({key:app.key,prefix:app.key+'_',config:runtime.mcpServers[app.key],ask:()=>app.ask,label:name=>`${app.label}: ${name}`}))];
  try{
    for(const remote of remotes){
      const client=new Client({name:'gratis-codex',version:'1.0.0'});
      try{await client.connect(new StreamableHTTPClientTransport(new URL(remote.config.url),{requestInit:{headers:remote.config.headers||{}}}));}
      catch(error){await client.close().catch(()=>{});if(remote.key==='composio')throw error;continue;}
      clients.push(client);let cursor;
      do{const page=await client.listTools(cursor?{cursor}:{});for(const t of page.tools)definitions.push({name:(remote.prefix+t.name).slice(0,64),description:t.description||t.name,schema:z.fromJSONSchema(t.inputSchema),handler:async input=>{
        const id=randomUUID(),name=remote.prefix+t.name;runtime.onActivity?.({id,name,input:traceValue(input),status:'running',startedAt:Date.now()});
        try{if(remote.ask(t.name)&&!await runtime.approve(remote.label(t.name),input)){runtime.onActivity?.({id,name,status:'denied',finishedAt:Date.now()});return {isError:true,content:[{type:'text',text:'The user declined this action.'}]};}
        const result=await client.callTool({name:t.name,arguments:input});runtime.onActivity?.({id,name,status:result.isError?'error':'complete',result:toolResultCheckpoint(result),finishedAt:Date.now()});return result;}catch(error){runtime.onActivity?.({id,name,status:'error',detail:String(error.message),finishedAt:Date.now()});throw error;}
      }});cursor=page.nextCursor;}while(cursor);
    }
    const server=createServer(async(req,res)=>{
      const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||req.headers.origin){res.writeHead(401).end();return;}
      if(req.method!=='POST'||req.url!=='/mcp'){res.writeHead(405).end();return;}
      let transport,mcp;try{
        let body='';for await(const chunk of req){body+=chunk;if(body.length>2_000_000)throw new Error('Request too large');}
        mcp=new McpServer({name:'gratis',version:'1.0.0'});
        for(const tool of definitions)mcp.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema},tool.handler);
        transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});transports.add(transport);res.on('close',()=>{transports.delete(transport);void transport.close();void mcp.close();});
        await mcp.connect(transport);await transport.handleRequest(req,res,JSON.parse(body));
      }catch{if(!res.headersSent)res.writeHead(500);res.end();await transport?.close();await mcp?.close();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    return {url:`http://127.0.0.1:${server.address().port}/mcp`,token,close:async()=>{await Promise.allSettled([...transports].map(t=>t.close()));await Promise.allSettled(clients.map(c=>c.close()));server.closeAllConnections();await new Promise(r=>server.close(r));}};
  }catch(error){await Promise.allSettled(clients.map(c=>c.close()));throw error;}
}
