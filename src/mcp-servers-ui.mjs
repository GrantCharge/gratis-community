// "Your own apps" in Connections: add, test, pause and remove MCP servers.
// Tokens go in once and never come back to this screen.
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function setupMcpServersUI({api}){
  const status=text=>{$('mcp-status').textContent=text||'';};
  const button=(label,onclick)=>{const b=el('button','quiet-button',label);b.type='button';b.onclick=onclick;return b;};
  async function act(work){try{await work();}catch(error){status(String(error?.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}}
  async function paint(){
    const servers=await api.mcpServers();
    $('mcp-server-list').replaceChildren(...servers.map(s=>{
      const row=el('div','custom-provider-row mcp-server-row');
      const name=el('strong',null,s.label+(s.enabled?'':' · paused'));
      const detail=el('span','custom-provider-address',`${s.url}${s.hasToken?' · token saved':''} · ${s.ask?'asks before each action':'runs actions without asking'}`);
      const actions=el('div','mcp-server-actions');
      actions.append(
        button('Test',()=>act(async()=>{status(`Checking ${s.label}…`);const r=await api.testMcpServer({id:s.id});status(r.ok?`${s.label} works · ${r.count} tool${r.count===1?'':'s'}${r.tools.length?': '+r.tools.join(', ')+(r.count>r.tools.length?'…':''):''}`:r.error);})),
        button(s.ask?'Stop asking':'Ask first',()=>act(async()=>{if(s.ask&&!confirm(`Let bots use ${s.label} without asking each time? Only do this for apps that cannot send, buy or delete anything.`))return;await api.updateMcpServer({id:s.id,ask:!s.ask});await paint();})),
        button(s.enabled?'Pause':'Resume',()=>act(async()=>{await api.updateMcpServer({id:s.id,enabled:!s.enabled});await paint();})),
        button('Remove',()=>act(async()=>{if(!confirm(`Remove ${s.label}? Its saved token is deleted from this computer.`))return;await api.removeMcpServer({id:s.id});status('');await paint();})));
      row.append(name,detail,actions);return row;
    }));
    $('mcp-empty').hidden=servers.length>0;
  }
  $('mcp-add-button').onclick=()=>act(async()=>{
    const added=await api.addMcpServer({label:$('mcp-label').value,url:$('mcp-url').value,token:$('mcp-token').value,ask:$('mcp-ask').checked});
    $('mcp-label').value='';$('mcp-url').value='';$('mcp-token').value='';$('mcp-ask').checked=true;$('mcp-add').open=false;await paint();
    status(`Checking ${added.label}…`);const r=await api.testMcpServer({id:added.id});status(r.ok?`${added.label} added · ${r.count} tool${r.count===1?'':'s'} available`:`${added.label} was saved, but: ${r.error}`);
  });
  return {refresh:()=>act(async()=>{status('');await paint();})};
}
