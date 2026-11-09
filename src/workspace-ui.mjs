import {isBlankComputerFrame,computerNotice} from './computer-preview.mjs';
import {setupSchedulesUI} from './schedules-ui.mjs';
import {setupT3UI} from './t3-ui.mjs';
import {setupMemoryUI} from './memory-ui.mjs';
import {setupMcpServersUI} from './mcp-servers-ui.mjs';
import {setupXray} from './xray.mjs';
import {setupComputerInput} from './computer-input.mjs';
import {setupWorkspaceLayout,computerPoint} from './workspace-layout.mjs';
const $=id=>document.getElementById(id);
export function setupWorkspace({api,getState,run,avatar,onOpenSource}){
  let tab=null,refreshing=false,refreshAgain=false,catalog=[],frame=null,searchTimer,linked=false,cursor=null,catalogSequence=0,lastRefresh=0,lastConversation;
  let watchId=null,livePreview=false,viewEpoch=0,previewGeneration=0,lastComputerState=null;
  let humanControl=false,controlRevision=-1,handingBack=false,changingControl=false;
  let selectedSeat=null,sourceRoot=null;
  const state=()=>{const value=getState(),seat=selectedSeat&&value?.conversations.find(c=>c.id===selectedSeat&&!c.inactiveTeamMember&&(c.id===value.activeConversationId||c.parentThreadId===value.activeConversationId));return seat?{...value,activeConversationId:seat.id,activeBotId:seat.botId}:value;},bot=()=>state()?.bots.find(b=>b.id===state().activeBotId);
  const input=setupComputerInput({image:$('computer-screen'),sink:$('computer-keyboard'),context:()=>({id:state()?.activeConversationId,human:humanControl,blocked:changingControl||handingBack||tab!=='computer'||humanControl&&!livePreview}),send:(name,args,id)=>api.computerAction({conversationId:id,name,args}),takeControl:()=>control(true),onError:showError});
  const layout=setupWorkspaceLayout({api,onError:error=>showError(error)});
  const schedulesUI=setupSchedulesUI({api,getState});
  const t3UI=setupT3UI({api,getState});
  const memoryUI=setupMemoryUI({container:$('workspace-memory'),api,getState,onOpenSource,onChange:()=>{}});
  let memoryRefresh;api.onMemoryChanged?.(value=>{$('show-memory').classList.toggle('has-update',value.learning===false);if(tab==='memory'){clearTimeout(memoryRefresh);memoryRefresh=setTimeout(()=>void memoryUI.refresh(),100);}});
  const xray=setupXray({container:$('workspace-xray'),getState,avatar,onOpenComputer:id=>openComputerFor(id),onApproval:(id,allow)=>api.respondApproval({id,allow})});
  function showError(error){$('workspace-error').textContent=error.message||String(error);$('workspace-error').hidden=false;}
  async function refresh(){
    if(!tab||!bot())return;if(refreshing){refreshAgain=true;return;}const requestedTab=tab,requestedId=state()?.activeConversationId,requestedEpoch=viewEpoch;const current=()=>tab===requestedTab&&state()?.activeConversationId===requestedId&&viewEpoch===requestedEpoch;refreshing=true;$('workspace-error').hidden=true;
    try{
      if(tab==='memory'){await memoryUI.refresh();return;}
      if(tab==='t3'){await t3UI.refresh();return;}
      if(tab==='schedules'){await schedulesUI.refresh();return;}
      if(tab==='xray'){xray.render();return;}
      if(tab==='files'){
        const owner=bot().id,files=await api.files({botId:owner});if(owner!==bot()?.id||tab!=='files'){refreshAgain=true;return;}$('workspace-file-list').replaceChildren(...files.map(file=>{const row=document.createElement('div');row.className='workspace-file';const label=document.createElement('span');label.textContent=file.path;const meta=document.createElement('small');meta.textContent=file.bytes<1024?`${file.bytes} B`:`${Math.ceil(file.bytes/1024)} KB`;const save=document.createElement('button');save.textContent='Save';save.onclick=()=>api.exportFile({botId:bot().id,path:file.path}).catch(showError);row.append(label,meta,save);return row;}));$('workspace-files-empty').hidden=files.length>0;
      }else{
        const connection=await api.connections();if(!current())return;$('computer-disconnected').hidden=connection.cloud;$('computer-controls').hidden=!connection.cloud;
        if(connection.cloud){const id=state().activeConversationId,snapshot=await api.computerState({conversationId:id});if(tab!=='computer'||id!==state().activeConversationId)return;draw(snapshot.frame);renderComputerState(snapshot.state);}
      }
    }catch(error){if(current())showError(error);}finally{refreshing=false;if(refreshAgain){refreshAgain=false;void refresh();}}
  }
  function draw(next){
    if(next&&next.conversationId!==state()?.activeConversationId)return;
    if(isBlankComputerFrame(next))return;
    if(!next){previewGeneration++;frame=null;$('computer-screen').removeAttribute('src');$('computer-screen').hidden=true;$('computer-placeholder').hidden=false;$('computer-current-url').textContent='Your private cloud computer';return;}
    if(frame?.at>next.at)return;
    const caption=()=>{$('computer-current-url').textContent=next.url?.endsWith('/start')?'Your computer':next.url||next.title||'Cloud computer';};
    if(frame?.dataUrl===next.dataUrl){frame=next;caption();return;}
    const generation=++previewGeneration,id=next.conversationId,image=new Image();
    image.onload=()=>{if(generation!==previewGeneration||id!==state()?.activeConversationId||tab!=='computer')return;frame=next;$('computer-screen').src=next.dataUrl;$('computer-screen').hidden=false;$('computer-placeholder').hidden=true;caption();if(lastComputerState)renderComputerState(lastComputerState);};
    image.onerror=()=>{if(generation===previewGeneration&&id===state()?.activeConversationId&&tab==='computer')showError(new Error('The latest computer preview could not be displayed. Try Refresh.'));};
    image.src=next.dataUrl;
  }
  function renderComputerState(value){
    if(value.conversationId!==state()?.activeConversationId)return;lastComputerState=value;
    if(value.controlRevision!==undefined&&value.controlRevision<controlRevision)return;
    if(value.controlRevision!==undefined)controlRevision=value.controlRevision;
    if(value.control)humanControl=value.control==='human';input.sync();
    livePreview=!!value.live;
    const status=value.status,loading=['starting','stopping'].includes(status),busy=loading||status==='working';
    $('computer-take-control').disabled=changingControl||handingBack||loading||!frame;$('computer-take-control').textContent=handingBack?'Resuming…':changingControl?'Pausing…':humanControl?'Give control back':'Take control';$('computer-take-control').setAttribute('aria-pressed',String(humanControl));$('computer-control-hint').textContent=humanControl?'You have control. Click, scroll, or type in the browser.':livePreview?'Live view · Take control to use the mouse and keyboard.':'Take control to use its mouse and keyboard.';$('computer-screen').dataset.control=humanControl?'human':'bot';
    $('computer-start').disabled=busy;$('computer-start').textContent=status==='starting'?'Starting…':status==='stopping'?'Stopping…':status==='ready'||status==='attention'?'Restart browser':status==='error'?'Retry start':'Start computer';
    $('computer-state').textContent=({idle:'Not started',starting:'Starting your computer…',ready:'Ready',working:'Bot is using the computer',stopping:'Stopping…',stopped:'Stopped',attention:'Needs attention',error:'Could not start'})[status]||'Not started';
    if(humanControl&&value.live)$('computer-state').textContent='You have control';
    if(humanControl&&!value.live&&['connecting','reconnecting'].includes(value.liveStatus))$('computer-state').textContent='Reconnecting controls…';
    const visibleNotice=computerNotice(value.notice,frame);
    if(visibleNotice){$('computer-state').textContent='Page partially loaded';$('workspace-error').textContent=visibleNotice;$('workspace-error').hidden=false;}else if(!value.error)$('workspace-error').hidden=true;
    $('computer-placeholder').textContent=status==='starting'?'Starting your computer. This can take a moment.':status==='error'?(value.error||'Could not start. Try again.'):status==='ready'?'Your computer is ready. Open a website or ask your bot to browse.':'Start your computer to browse and work with your bot.';
    $('computer-placeholder').classList.toggle('is-starting',status==='starting');
    // A ready browser can navigate before its first useful preview arrives.
    $('computer-go').disabled=busy||!['ready','attention'].includes(status);
    for(const id of ['computer-type','computer-refresh'])$(id).disabled=busy||!frame;
    $('computer-stop').disabled=status==='stopping'||['idle','stopped'].includes(status);
    if((status==='error'||status==='attention')&&value.error)showError(new Error(value.error));
  }
  async function openComputerFor(id,{takeControl=false}={}){
    const epoch=viewEpoch;try{
      await input.flush();if(epoch!==viewEpoch)return;if(humanControl&&!await control(false))return;if(epoch!==viewEpoch)return;
      selectedSeat=id;controlRevision=-1;humanControl=false;input.sync();draw(null);
      if(tab!=='computer')await open('computer');else {syncWatch();await refresh();}
      if(epoch!==viewEpoch)return;await refresh();if(epoch!==viewEpoch)return;if(takeControl){if(!frame)await startComputer();if(frame)await control(true);}
    }catch(error){showError(error);}
  }
  async function startComputer({restart=false}={}){
    const id=state()?.activeConversationId;if(!id)return;
    $('workspace-error').hidden=true;renderComputerState({conversationId:id,status:'starting'});
    try{const snapshot=await api.startComputer({conversationId:id,restart});if(id===state()?.activeConversationId){draw(snapshot.frame);renderComputerState(snapshot.state);}}
    catch(error){if(id===state()?.activeConversationId)renderComputerState({conversationId:id,status:frame?'attention':'error',error:error.message});}
  }
  async function ensureComputer(){
    if(!bot()||bot().capabilities?.computer===false)return;
    const id=state().activeConversationId,connection=await api.connections();if(!connection.cloud||id!==state()?.activeConversationId)return;
    const snapshot=await api.computerState({conversationId:id});if(tab!=='computer'||id!==state()?.activeConversationId)return;
    if(snapshot.state.status==='idle')await startComputer();
  }
  async function action(name,args={},conversationId=state().activeConversationId){
    if(conversationId!==state().activeConversationId)return;
    $('computer-go').disabled=true;
    try{const result=await api.computerAction({conversationId,name,args});if(!result?.live&&conversationId===state().activeConversationId)await refresh();}
    catch(error){if(conversationId===state().activeConversationId){showError(error);$('computer-state').textContent='Needs attention';}}
    finally{if(conversationId===state().activeConversationId)$('computer-go').disabled=false;}
  }
  async function control(human){
    const id=state().activeConversationId;changingControl=true;$('computer-take-control').disabled=true;
    try{if(!human){handingBack=true;$('computer-take-control').textContent='Resuming…';await input.flush();}const snapshot=await api.computerControl({conversationId:id,human});if(id===state().activeConversationId){draw(snapshot.frame);renderComputerState(snapshot.state);if(human)input.focus();}return true;}
    catch(error){showError(error);await refresh();return false;}
    finally{handingBack=false;changingControl=false;$('computer-take-control').disabled=!frame;$('computer-take-control').textContent=humanControl?'Give control back':'Take control';input.sync();}
  }
  $('computer-take-control').onclick=()=>void control(!humanControl);
  async function flushInput(){try{await input.flush();return true;}catch(error){showError(error);return false;}}
  async function open(next){const epoch=viewEpoch;if(!await flushInput()||epoch!==viewEpoch)return;if(tab==='computer'&&humanControl&&!await control(false))return;if(epoch!==viewEpoch)return;await layout.exit();if(epoch!==viewEpoch)return;previewGeneration++;lastComputerState=null;$('workspace-error').hidden=true;tab=tab===next?null:next;layout.sync(!!tab,tab||'computer');$('work-panel').hidden=!tab;document.querySelector('main').classList.toggle('workspace-open',!!tab);$('workspace-title').textContent=tab==='files'?'Files':tab==='xray'?'X-ray':tab==='memory'?'Memory':tab==='t3'?'Tasks':tab==='schedules'?'Scheduled tasks':'Computer';$('workspace-files').hidden=tab!=='files';$('workspace-computer').hidden=tab!=='computer';$('workspace-xray').hidden=tab!=='xray';$('workspace-memory').hidden=tab!=='memory';$('workspace-t3').hidden=tab!=='t3';$('workspace-schedules').hidden=tab!=='schedules';$('show-t3').setAttribute('aria-pressed',String(tab==='t3'));if(tab==='memory')$('show-memory').classList.remove('has-update');$('show-memory').setAttribute('aria-pressed',String(tab==='memory'));$('workspace-agent-row').hidden=['xray','memory','t3','schedules'].includes(tab)||!(getState()?.conversations.find(c=>c.id===getState().activeConversationId)?.participantIds?.length>1);$('show-files').setAttribute('aria-pressed',String(tab==='files'));$('show-computer').setAttribute('aria-pressed',String(tab==='computer'));$('show-xray').setAttribute('aria-pressed',String(tab==='xray'));syncWatch();void refresh();if(tab==='computer')void ensureComputer();}
  $('show-t3').onclick=()=>open('t3');
  $('show-memory').onclick=()=>open('memory');$('show-files').onclick=()=>open('files');$('show-xray').onclick=()=>open('xray');$('show-computer').onclick=()=>open('computer');$('close-workspace').onclick=()=>open(tab);$('refresh-workspace').onclick=refresh;
  $('computer-go').onclick=()=>{if(handingBack)return;const input=$('computer-url').value.trim();if(!input)return;const url=/^https?:\/\//i.test(input)?input:input.includes('.')&&!input.includes(' ')?'https://'+input:'https://www.google.com/search?q='+encodeURIComponent(input);void action('browse_url',{url});};
  $('computer-start').onclick=()=>startComputer({restart:!!frame});
  $('computer-url').onkeydown=e=>{if(e.key==='Enter')$('computer-go').click();};
  $('computer-refresh').onclick=()=>{if(!handingBack)return action('capture_screen');};
  $('computer-stop').onclick=async()=>{try{await api.stopComputer({conversationId:state().activeConversationId});draw(null);$('computer-state').textContent='Stopped';}catch(error){showError(error);}};
  $('computer-type').onclick=()=>{if(handingBack)return;const text=$('computer-input').value;if(text)void action('type_text',{text});};
  api.onComputerState(value=>{if(tab==='computer')renderComputerState(value);});
  api.onComputerFrame(next=>{if(tab==='computer')draw(next);});
  function renderSignIn(value){
    const busy=['opening','waiting','configuring'].includes(value.status);
    $('composio-signin').disabled=busy;
    $('composio-signin').textContent=value.status==='opening'?'Opening sign-in…':value.status==='waiting'?'Waiting for sign-in…':value.status==='configuring'?'Connecting your account…':value.status==='error'?'Retry connection':linked?'Sign in again':'Sign in to Composio';
    $('composio-signin-cancel').hidden=!busy&&value.status!=='error';$('composio-signin-cancel').textContent=value.status==='error'?'Start over':'Cancel sign-in';$('composio-signin-open').hidden=value.status!=='waiting';
    if(busy)$('composio-status').textContent=value.status==='waiting'?'Finish signing in in your browser. This window will update automatically.':'Connecting to Composio…';
    else $('composio-status').textContent=linked?'Signed in. Choose an app below to connect its account.':'Sign in to browse and connect your apps.';
    if(value.status==='error'){$('connection-error').textContent=value.error||'Could not finish sign-in. Try again.';$('connection-error').hidden=false;}
    else $('connection-error').hidden=true;
  }
  async function beginSignIn(){
    $('connection-error').hidden=true;
    try{renderSignIn(await api.signInStart());}catch(error){renderSignIn({status:'error',error:error.message});}
  }
  const ownApps=setupMcpServersUI({api});
  async function connections({signIn=false}={}){
    void ownApps.refresh();const status=await api.connections();linked=status.composio;
    $('cloud-status').textContent=status.cloud?'Cloud computer connected':'Cloud computer not connected';$('cloud-endpoint').value=status.cloudEndpoint;$('connection-error').hidden=true;
    if(!$('connections-dialog').open)$('connections-dialog').showModal();renderSignIn(await api.signInState());
    if(linked)void loadCatalog();
    if(signIn)await beginSignIn();
  }
  async function loadCatalog(append=false){
    if(!linked){$('app-catalog-status').textContent='Sign in to browse and connect apps.';return;}
    const sequence=++catalogSequence,search=$('app-search').value;
    $('app-catalog-status').textContent='Loading apps…';
    try{const result=await api.connectionCatalog({search,...(append===true&&cursor?{cursor}:{})});if(sequence!==catalogSequence)return;
      const items=Array.isArray(result)?result:result.items;catalog=append===true?[...catalog,...items]:items;cursor=result.cursor||null;paintCatalog();
      $('apps-more').hidden=!cursor;$('app-catalog-status').textContent=catalog.length?`${catalog.length} apps${cursor?' · more available':''}`:'No matching apps.';
    }catch(error){if(sequence!==catalogSequence)return;$('app-catalog-status').textContent='Apps could not be loaded.';$('connection-error').textContent=error.message;$('connection-error').hidden=false;}
  }
  function paintCatalog(){
    $('app-catalog').replaceChildren(...catalog.map(item=>{
      const row=document.createElement('div');row.className='connected-app';const label=document.createElement('span');label.textContent=item.name;
      const button=document.createElement('button');button.className='quiet-button';button.textContent=item.connected?'Connected':item.noAuth?'Ready':'Connect';button.disabled=item.noAuth;
      if(item.connected)button.title='Reconnect this account';
      button.onclick=async()=>{button.disabled=true;button.textContent='Opening sign-in…';try{await api.connectApp(item.slug);button.textContent='Awaiting sign-in…';}catch(error){button.disabled=false;button.textContent=item.connected?'Connected':'Connect';$('connection-error').textContent=error.message;$('connection-error').hidden=false;}};
      row.append(label,button);return row;
    }));
  }
  $('open-connections').onclick=()=>connections();$('computer-connect').onclick=()=>connections();
  $('app-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadCatalog(),300);};$('refresh-apps').onclick=()=>loadCatalog();$('apps-more').onclick=()=>loadCatalog(true);
  $('composio-signin').onclick=beginSignIn;$('composio-signin-cancel').onclick=async()=>renderSignIn(await api.signInCancel());$('composio-signin-open').onclick=()=>api.signInOpen();
  api.onSignInState(value=>{if(value.status==='connected'){linked=true;if($('connections-dialog').open)void loadCatalog();}renderSignIn(value);});
  api.onConnectionsChanged(()=>{if($('connections-dialog').open)void loadCatalog();});
  window.addEventListener('focus',()=>{if(linked&&$('connections-dialog').open)void loadCatalog();});
  $('connections-form').onsubmit=async e=>{e.preventDefault();const value={};if($('composio-key').value)value.composioKey=$('composio-key').value;if($('cloud-token').value){value.cloudEndpoint=$('cloud-endpoint').value;value.cloudToken=$('cloud-token').value;}try{await api.configureConnections(value);$('composio-key').value='';$('cloud-token').value='';$('connections-dialog').close();await connections();}catch(error){$('connection-error').textContent=error.message;$('connection-error').hidden=false;}};
  $('test-cloud').onclick=async()=>{try{const result=await api.cloudHealth();$('cloud-status').textContent=result.ok?'Cloud computer is online':'Cloud computer unavailable';}catch(error){$('cloud-status').textContent=error.message;}};
  $('workspace-agent').onchange=async()=>{if(!await flushInput())return;if(humanControl&&!await control(false))return;selectedSeat=$('workspace-agent').value;lastConversation=null;controlRevision=-1;humanControl=false;input.sync();draw(null);syncWatch();await refresh();if(tab==='computer')void ensureComputer();};
  function syncWatch(){const id=tab==='computer'?state()?.activeConversationId:null;if(id===watchId)return;if(watchId)void api.watchComputer?.({conversationId:watchId,visible:false}).catch(()=>{});watchId=id;if(id)void api.watchComputer?.({conversationId:id,visible:true}).catch(()=>{});}
  function hideForHome(){
    viewEpoch++;if(!tab)return;void input.flush().catch(()=>{});document.activeElement?.blur();tab=null;
    $('work-panel').hidden=true;document.querySelector('main').classList.remove('workspace-open');
    for(const id of ['show-computer','show-files','show-xray','show-memory','show-t3'])$(id).setAttribute('aria-pressed','false');
    layout.sync(false);void layout.exit();syncWatch();draw(null);
  }
  return {hideForHome,async beforeNavigate(){if(!await flushInput())return false;if(humanControl)return control(false);return true;},openConnections:connections,openSchedules(){if(tab!=='schedules')void open('schedules');else void schedulesUI.refresh();},openT3(){if(tab!=='t3')void open('t3');else void t3UI.refresh();},openComputerFor,openXray({reset=false}={}){if(reset)xray.reset();if(tab!=='xray')void open('xray');else xray.render();},openComputer({start=false}={}){if(tab!=='computer')open('computer');else void ensureComputer();if(start)void startComputer();},sync(){t3UI.sync();schedulesUI.sync();const raw=getState();if(sourceRoot!==raw?.activeConversationId){sourceRoot=raw?.activeConversationId;selectedSeat=null;}const root=raw?.conversations.find(c=>c.id===raw.activeConversationId);const members=root?.participantIds||[];$('workspace-agent-row').hidden=['xray','memory','t3','schedules'].includes(tab)||members.length<2;const picker=$('workspace-agent');const choices=members.map(id=>{const bot=raw.bots.find(b=>b.id===id),c=id===root.botId?root:raw.conversations.find(c=>c.parentThreadId===root.id&&c.botId===id&&!c.inactiveTeamMember);return {id:c?.id,name:bot?.name};}).filter(v=>v.id);if(JSON.stringify(choices)!==picker.dataset.choices){picker.dataset.choices=JSON.stringify(choices);picker.replaceChildren(...choices.map(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.name;return o;}));}picker.value=state()?.activeConversationId;if(tab==='xray')xray.render();if(tab==='memory')void memoryUI.refresh();syncWatch();const contextKey=state()?`${state().activeConversationId}/${state().activeBotId}`:null,changed=lastConversation!==contextKey;lastConversation=contextKey;if(changed){controlRevision=-1;humanControl=false;input.sync();draw(null);if(watchId){void api.watchComputer?.({conversationId:watchId,visible:false}).catch(()=>{});watchId=null;}syncWatch();}if(!bot()){tab=null;$('work-panel').hidden=true;document.querySelector('main').classList.remove('workspace-open');layout.sync(false);}if(tab&&(changed||Date.now()-lastRefresh>1500)){lastRefresh=Date.now();void refresh();}}};
}
