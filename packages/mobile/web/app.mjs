import {setupMobileComputer} from './computer.mjs';
import {setupPhoneSettings} from './settings.mjs';
import {setupChatSearch} from './chat-search.mjs';
import {setupAgentNotifications} from './notifications.mjs';
import {createBotTile} from '../../../src/bot-tile.mjs';
import {resolveTheme} from '../../../src/theme.mjs';
import {setupProfile} from './profile.mjs';
import {setupMobileVoice} from './voice.mjs';
import {renderIcon} from '../../../src/assets/icons.mjs';
import {marked} from 'marked';import DOMPurify from 'dompurify';import {avatarColor} from '../../../src/avatar.mjs';
import {animatedAvatar} from '../../../src/avatar-motion.mjs';
const $=id=>document.getElementById(id),KEY='gratis.mobile.v1',PENDING='gratis.mobile.pending';let auth,snapshot,online=false,nextSeq=1,revision,selected=null,protocol=1,busy=false,timer,posting=false,lastRetry=0,showList=true,messageKey='',listKey='';
try{auth=JSON.parse(localStorage.getItem(KEY)||'null');if(auth){selected=localStorage.getItem('gratis.mobile.selected');showList=localStorage.getItem('gratis.mobile.view')!=='chat';}}catch{}
document.querySelectorAll('[data-icon]').forEach(node=>renderIcon(node,node.dataset.icon));
let keyboardHeldHeight=null,keyboardReleaseTimer,mobileVoice,profileUI,notifications,chatSearch,computerUI,settingsUI,lastCommandKind,lastReceipt,allChats=false;
const notice=text=>{$('notice').textContent=text;$('notice').hidden=!text;};
function resize(){
 const editing=document.activeElement?.matches('textarea,input')||keyboardHeldHeight!==null;
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 document.body.classList.toggle('editing',!!editing);document.body.classList.toggle('standalone',!!standalone);
 const height=editing?(keyboardHeldHeight??window.visualViewport?.height??innerHeight):standalone?screen.height:null;
 document.documentElement.style.setProperty('--height',height?height+'px':'100dvh');if(window.scrollY||window.scrollX)window.scrollTo(0,0);
}
window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);window.addEventListener('pageshow',resize);document.addEventListener('focusin',event=>{if(event.target.matches('textarea,input')){clearTimeout(keyboardReleaseTimer);keyboardHeldHeight=null;queueMicrotask(resize);}});document.addEventListener('focusout',event=>{if(event.target.matches('textarea,input')){keyboardHeldHeight=$('app').getBoundingClientRect().height;clearTimeout(keyboardReleaseTimer);keyboardReleaseTimer=setTimeout(()=>{keyboardHeldHeight=null;resize();},250);}});resize();
async function request(action,body={},token=auth?.token,room=auth?.roomId){const r=await fetch('/api/'+room+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const value=await r.json();if(!r.ok)throw new Error(value.error||'Connection failed');return value;}
function saveAuth(value){auth=value;if(value)localStorage.setItem(KEY,JSON.stringify(value));else{localStorage.removeItem(KEY);localStorage.removeItem(PENDING);}}
function pairingLink(value){const u=new URL(value,location.origin);if(u.origin!==location.origin||!/^#[a-f0-9]{32}\.[a-f0-9]{64}$/.test(u.hash))throw new Error('Use the current pairing link from your computer.');return u.hash.slice(1).split('.');}
async function claim(value){try{const [roomId,invite]=pairingLink(value);history.replaceState(null,'','/');$('pair-link').value='';$('pair-status').textContent='Connecting to your computer…';const result=await request('claim',{},invite,roomId);localStorage.removeItem(PENDING);posting=false;saveAuth({roomId,token:result.token});selected=null;showList=true;localStorage.removeItem('gratis.mobile.selected');localStorage.removeItem('gratis.mobile.view');snapshot=undefined;messageKey='';listKey='';revision=undefined;poll();}catch(e){$('pair-status').textContent=e.message;}}
function connection(value){online=value;$('connection-status').textContent=value?'Connected to your computer':'Computer offline';$('status-dot').dataset.online=String(value);$('connection-status').parentElement.classList.toggle('offline',!value);$('send').disabled=!value||posting||!$('prompt').value.trim();$('new-chat').disabled=!value;mobileVoice?.sync();}
function avatarView(bot,key,mode='idle'){if(bot?.members?.length){const stack=document.createElement('span');stack.className='group-avatar';bot.members.slice(0,2).forEach((member,i)=>stack.append(avatarView(member,key+'-'+i,mode)));return stack;}return animatedAvatar(key,{name:bot?.name||bot?.botName||bot?.title,color:avatarColor(bot?.choiceColor||bot?.avatarColor,document.documentElement.dataset.theme||'dark'),shape:bot?.avatarShape,photo:snapshot?.avatars?.[bot?.botId||bot?.id]||null,mode,follow:'global'});}
let providerChoiceKey='';
function renderProviderChoices(){
 const providers=snapshot?.providers||[],chat=snapshot?.selected;
 const current=providers.find(p=>p.id===chat?.provider),model=current?.models.find(m=>m.id===chat?.model);
 $('current-model-label').textContent=current?current.name+' · '+(model?.name||chat.model):chat?.provider==='demo'?'Local demo · choose a subscription':'Choose provider and model';
 const key=JSON.stringify({protocol,providers,provider:chat?.provider,model:chat?.model,online,posting,busy:chat?.status==='working'});if(key===providerChoiceKey)return;providerChoiceKey=key;
 const choices=providers.map(provider=>{const section=document.createElement('section');section.className='provider-group';const heading=document.createElement('h3');if(!provider.custom){const logo=document.createElement('img');logo.src='/'+(provider.id==='claude'?'claude':'openai')+'.svg';logo.alt='';heading.append(logo);}heading.append(document.createTextNode(provider.name));section.append(heading);const status=document.createElement('p');status.className='provider-status';status.textContent=provider.custom?(provider.signedIn?'API key saved on your desktop · chat only'+(provider.more?` · ${provider.models.length} of ${provider.models.length+provider.more} models shown`:''):'Not reachable from your desktop'):provider.signedIn?'Subscription connected':'Sign in on your desktop';section.append(status);for(const item of provider.models){const button=document.createElement('button');button.type='button';button.className='model-option';button.dataset.provider=provider.id;button.dataset.model=item.id;button.disabled=protocol<2||!online||posting||!provider.signedIn||chat?.status==='working';const label=document.createElement('span');label.textContent=item.name;button.append(label);if(chat?.provider===provider.id&&chat?.model===item.id){const check=document.createElement('span');renderIcon(check,'check');button.append(check);button.classList.add('selected');}button.onclick=()=>void command('model',selected,undefined,{provider:provider.id,model:item.id});section.append(button);}return section;});
 if(!choices.length){const waiting=document.createElement('p');waiting.className='model-note';waiting.textContent='Checking desktop connections…';choices.push(waiting);}
 $('provider-choices').replaceChildren(...choices);$('refresh-providers').disabled=protocol<2||!online||posting;$('model-picker-status').textContent=posting&&(pending()?.kind==='model'||pending()?.kind==='providers')?'Updating from your desktop…':protocol<2?'Updating the connection. Model controls will be ready shortly.':'';
}
function openModels(){$('menu').hidden=true;closeTools();renderProviderChoices();$('model-picker-error').hidden=true;if(!$('model-dialog').open)$('model-dialog').showModal();}
function views(){
 $('account-button').hidden=!showList||allChats;const profilePhoto=snapshot?.avatars?.__profile;if(profilePhoto&&$('account-button').dataset.photo!==profilePhoto){const photo=document.createElement('img');photo.src=profilePhoto;photo.alt=snapshot?.userProfile?.name||'Your profile';$('account-button').replaceChildren(photo);$('account-button').dataset.photo=profilePhoto;}
 for(const id of ['menu-profile','menu-find','menu-share','menu-delete'])$(id).hidden=showList;for(const id of ['menu-new','menu-all-chats','choose-model'])$(id).hidden=!showList;
 $('menu-button').hidden=showList&&!allChats;
 if(showList){chatSearch?.close();void computerUI?.close();}
 $('list-view').hidden=!showList;$('chat-view').hidden=showList;$('back').hidden=showList&&!allChats;$('new-chat').hidden=!showList;
 document.body.dataset.view=showList?'list':'chat';document.body.classList.toggle('all-chats',allChats);
 const current=snapshot?.conversations.find(c=>c.id===selected);
 $('heading').textContent=showList?(allChats?'Chats':'Gratis'):(current?.group?current?.title:current?.botName)||current?.title||'Conversation';
 $('heading-avatar').hidden=showList;
 if(!showList){$('heading-avatar').replaceChildren(avatarView(current,'mobile-heading'));$('prompt').placeholder='Ask '+(current?.botName||'your assistant');}
}
function openChat(id){if(id!==selected)void computerUI?.close();selected=id;localStorage.setItem('gratis.mobile.selected',id);localStorage.setItem('gratis.mobile.view','chat');showList=false;views();$('prompt').value=localStorage.getItem('gratis.draft.'+id)||'';if(snapshot?.selected?.id!==id){$('messages').replaceChildren();$('chat-hint').textContent='';$('stop').hidden=true;void command('select',id);}messageKey='';renderMessages();mobileVoice?.sync();requestAnimationFrame(()=>{$('messages').scrollTop=$('messages').scrollHeight;$('jump').hidden=true;});}
function renderList(){const query=$('search').value.toLowerCase(),roots=allChats?(snapshot?.conversations||[]):(snapshot?.home||snapshot?.conversations||[]),rows=roots.filter(c=>(c.title+' '+c.botName+' '+c.preview).toLowerCase().includes(query)),key=JSON.stringify([rows,snapshot?.avatars,allChats]);if(key===listKey)return;listKey=key;$('empty').hidden=rows.length>0;
 const pinned=allChats?[]:rows.filter(c=>c.pinned&&!c.group);const grid=document.createElement('div');grid.className='mobile-pinned';for(const row of pinned){const bot=snapshot.bots.find(b=>b.id===row.botId);const tile=createBotTile({...bot,avatarColor:bot.choiceColor,avatarDataUrl:snapshot.avatars?.[bot.id]},{primary:bot.id===snapshot.bots[0]?.id,surface:'phone-pinned',status:row.status==='working'?'busy':'ready',onSelect:()=>openChat(row.id)});tile.dataset.conversationId=row.id;tile.classList.add('chat-row');grid.append(tile);}
 $('conversations').replaceChildren(...(pinned.length?[grid]:[]),...rows.filter(c=>!pinned.includes(c)).map(c=>{const b=document.createElement('button');b.className='chat-row';b.dataset.conversationId=c.id;b.type='button';const img=document.createElement('span');img.className='avatar';img.append(avatarView(c,'mobile-row-'+c.id,c.status==='working'?'streaming':'idle'));const copy=document.createElement('span');copy.className='row-copy';const title=document.createElement('strong');title.textContent=allChats||c.group?c.title:c.botName;const detail=document.createElement('small');detail.textContent=c.status==='working'?'Working…':c.preview||c.botName||'Ready';copy.append(title,detail);b.append(img,copy);b.onclick=()=>openChat(c.id);return b;}));}
function renderMessages(){
 renderProviderChoices();
 const chat=snapshot?.selected;if(!chat||chat.id!==selected)return;
 const {computerView,...transcript}=chat;const key=JSON.stringify([transcript,snapshot?.avatars]);if(key===messageKey)return;messageKey=key;
 const target=$('messages'),atBottom=target.scrollHeight-target.scrollTop-target.clientHeight<100,oldTop=target.scrollTop;
 target.classList.toggle('group-chat',!!chat.group);
 const items=chat.messages.filter(m=>(m.content||m.question||m.status==='error')&&(!m.question||!localStorage.getItem('gratis.dismissed.'+m.id))).map(m=>{
  const item=document.createElement('article');item.className='message '+m.role;item.dataset.messageId=m.id;
  const speaker=document.createElement('div');speaker.className='speaker';speaker.textContent=m.speaker||'Assistant';
  const content=document.createElement('div');content.className='content';
  if(m.question){
    content.classList.add('question-content');const title=document.createElement('h3');title.textContent=m.content;
    const dismiss=document.createElement('button');dismiss.className='dismiss-question';dismiss.type='button';dismiss.setAttribute('aria-label','Dismiss question');renderIcon(dismiss,'close');dismiss.onclick=()=>{localStorage.setItem('gratis.dismissed.'+m.id,'1');messageKey='';renderMessages();};
    const choices=document.createElement('div');choices.className='question-choices';const options=[...m.question.options,...(m.question.custom?['Something else']:[])];
    options.forEach((label,index)=>{const choice=document.createElement('button');choice.type='button';choice.className='question-choice';const key=document.createElement('span');key.className='choice-key';key.textContent=String.fromCharCode(65+index);const text=document.createElement('span');text.textContent=label;choice.append(key,text);choice.onclick=()=>{if(m.question.custom&&index===options.length-1){$('prompt').focus();return;}void command('send',selected,label);};choices.append(choice);});content.append(title,dismiss,choices);
  }else if(m.role==='user')content.textContent=m.content;
  else if(m.content){content.innerHTML=DOMPurify.sanitize(marked.parse(m.content),{FORBID_TAGS:['img','video','audio','iframe','form','input','button']});content.querySelectorAll('a').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer';});}
  else{content.textContent='•••';content.classList.add('typing');}
  item.append(speaker,content);if(m.question){const hint=document.createElement('div');hint.className='question-hint';hint.textContent='Or answer in the chat below';item.append(hint);}

  if(['error','cancelled'].includes(m.status)){const note=document.createElement('small');note.className='message-status';note.textContent=m.status==='error'?'This reply failed. Open the desktop to retry.':'This reply was stopped.';item.append(note);}
  return item;
 });
 if(chat.messages[0]?.createdAt){const date=document.createElement('div');date.className='date-label';const when=new Date(chat.messages[0].createdAt),today=new Date();const days=Math.round((new Date(today.getFullYear(),today.getMonth(),today.getDate())-new Date(when.getFullYear(),when.getMonth(),when.getDate()))/86400000);date.textContent=(days===0?'Today':days===1?'Yesterday':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(when))+' '+new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(when);items.unshift(date);}
 if(!items.length){const item=document.createElement('article');item.className='message assistant';const content=document.createElement('div');content.className='content';content.textContent='What would you like to work on?';item.append(content);items.push(item);}
 if(chat.status==='working'){const waiting=document.createElement('span');waiting.className='waiting-avatar';waiting.setAttribute('aria-label','Working');waiting.append(avatarView(snapshot.conversations.find(c=>c.id===selected),'mobile-working-'+selected,'streaming'));items.push(waiting);}
 target.replaceChildren(...items);chatSearch?.refresh();const attachments=chat.attachments||[];$('attachment-tray').hidden=!attachments.length;$('attachment-tray').replaceChildren(...attachments.map(file=>{const chip=document.createElement('span');chip.textContent=file.name;return chip;}));
 $('stop').hidden=chat.status!=='working';$('chat-hint').textContent=chat.truncated?'Showing recent messages. Full history is on your computer.':chat.queued?chat.queued+' message queued':'';
 if(atBottom)target.scrollTop=target.scrollHeight;else target.scrollTop=oldTop;$('jump').hidden=atBottom;views();
}
function pending(){try{return JSON.parse(localStorage.getItem(PENDING)||'null');}catch{return null;}}
async function poll(){if(busy||!auth||document.hidden)return;busy=true;try{const result=await request('poll',{revision});nextSeq=result.nextSeq;protocol=result.protocol||1;
 if(!result.confirmed){$('pair-screen').hidden=false;$('app').hidden=true;$('pair-status').textContent='One last step: choose “Trust this phone” on your computer.';return;}
 $('pair-screen').hidden=true;$('app').hidden=false;connection(result.online);if(result.snapshot){snapshot=result.snapshot;revision=result.revision;applyAppearance();renderProviderChoices();if(!selected||!snapshot.conversations.some(c=>c.id===selected))selected=snapshot.selected?.id;renderList();renderMessages();mobileVoice?.update(snapshot.voice);profileUI?.update();computerUI?.update();settingsUI?.update();void notifications?.update(snapshot);}
 const p=pending();posting=!!p;if(p&&p.seq===result.nextSeq&&online&&Date.now()-lastRetry>3000){lastRetry=Date.now();void request('command',p).catch(()=>{});}if(p&&result.receipt?.seq===p.seq){posting=false;lastReceipt=result.receipt;lastCommandKind=p.kind;if(result.receipt.ok){localStorage.removeItem(PENDING);if(p.kind==='send'){if(selected!==p.conversationId||$('prompt').value.trim()===p.text){localStorage.removeItem('gratis.draft.'+p.conversationId);if(selected===p.conversationId)$('prompt').value='';}$('delivery-status').textContent='Delivered to your desktop';}else if(['new','create-bot'].includes(p.kind)&&snapshot?.selected)openChat(snapshot.selected.id);else if(p.kind==='model')$('model-dialog').close();else if(['delete-bot','delete-thread'].includes(p.kind)){showList=true;allChats=false;localStorage.setItem('gratis.mobile.view','list');views();}notice('');profileUI?.update();}else{localStorage.removeItem(PENDING);notice(result.receipt.detail+(p.kind==='send'?' Your draft was kept.':''));if(p.kind==='voice')mobileVoice?.rejected(result.receipt.detail);profileUI?.rejected(result.receipt.detail);if($('model-dialog').open){$('model-picker-error').hidden=false;$('model-picker-error').textContent=result.receipt.detail;}}}
 if(!posting&&selected&&snapshot?.selected?.id!==selected&&snapshot?.conversations.some(c=>c.id===selected))void command('select',selected);
 for(const id of ['new-chat','menu-profile','tools-file','tools-media','tools-camera','menu-delete','profile-delete'])$(id).disabled=protocol<4||!online||posting;renderProviderChoices();applyAppearance();computerUI?.update();settingsUI?.update();if(!result.online)$('delivery-status').textContent='Keep your computer awake and Gratis running';else if(!pending())$('send').disabled=!$('prompt').value.trim();
 }catch(e){connection(false);$('delivery-status').textContent='Reconnecting…';if(/revoked|authorization|unavailable/i.test(e.message)){$('pair-screen').hidden=false;$('app').hidden=true;$('pair-status').textContent=e.message+' Create a new code on your computer.';saveAuth(null);snapshot=undefined;}}
 finally{busy=false;clearTimeout(timer);if(auth&&!document.hidden)timer=setTimeout(poll,computerUI?.visible?160:900);}}
async function command(kind,conversationId,text,fields={}){if(posting||!online)return false;lastReceipt=null;lastCommandKind=kind;const value={seq:nextSeq,kind,...(conversationId?{conversationId}:{}),...(text?{text}:{}),...fields};posting=true;localStorage.setItem(PENDING,JSON.stringify(value));profileUI?.update();applyAppearance();renderProviderChoices();$('send').disabled=true;$('delivery-status').textContent='Sending…';try{await request('command',value);revision=undefined;poll();return true;}catch(e){const uncertain=/fetch|network|timed|aborted|load failed/i.test(e.message);posting=uncertain;notice(e.message+' Your text has been kept.');if(!uncertain)localStorage.removeItem(PENDING);if(kind==='model'||kind==='providers'){$('model-picker-error').textContent=e.message;$('model-picker-error').hidden=false;}if(kind==='voice')mobileVoice?.rejected(e.message);profileUI?.rejected(e.message);profileUI?.update();applyAppearance();return uncertain;}}
$('pair-form').onsubmit=e=>{e.preventDefault();void claim($('pair-link').value);};$('search').oninput=()=>{listKey='';renderList();};$('back').onclick=()=>{if(showList&&allChats){allChats=false;listKey='';renderList();}showList=true;localStorage.setItem('gratis.mobile.view','list');views();};$('menu-button').onclick=()=>{$('menu').hidden=!$('menu').hidden;$('menu-button').setAttribute('aria-expanded',String(!$('menu').hidden));};$('new-chat').onclick=()=>profileUI?.edit(true);$('stop').onclick=()=>void command('stop',selected);$('jump').onclick=()=>{$('messages').scrollTop=$('messages').scrollHeight;$('jump').hidden=true;};
$('prompt').oninput=()=>{if(selected)localStorage.setItem('gratis.draft.'+selected,$('prompt').value);$('send').disabled=!online||posting||!$('prompt').value.trim();$('prompt').style.height='auto';$('prompt').style.height=Math.min(130,$('prompt').scrollHeight)+'px';mobileVoice?.sync();};$('composer').onsubmit=e=>{e.preventDefault();const text=$('prompt').value.trim();if(text){void command('send',selected,text);$('prompt').blur();}};
$('disconnect').onclick=async()=>{try{await request('forget');saveAuth(null);localStorage.removeItem(PENDING);location.reload();}catch(e){notice(e.message);}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();else{clearTimeout(timer);void computerUI?.close();}});window.addEventListener('online',()=>void poll());
if(location.hash)void claim(location.href);else if(auth)void poll();
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

function closeTools(){$('composer-tools').hidden=true;$('compose-menu').setAttribute('aria-expanded','false');}
$('compose-menu').onclick=()=>{const open=$('composer-tools').hidden;$('composer-tools').hidden=!open;$('compose-menu').setAttribute('aria-expanded',String(open));};
$('tools-new').onclick=()=>{closeTools();void command('new',undefined,undefined,{botId:snapshot?.selected?.botId});};
$('tools-chats').onclick=()=>{closeTools();allChats=true;showList=true;listKey='';renderList();views();};
$('tools-connection').onclick=()=>{closeTools();$('menu').hidden=false;$('menu-button').setAttribute('aria-expanded','true');};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#composer-tools,#compose-menu'))closeTools();if(!event.target.closest('#menu,#menu-button,#account-button,#tools-connection')){$('menu').hidden=true;$('menu-button').setAttribute('aria-expanded','false');}});

$('choose-model').onclick=openModels;
$('tools-model').onclick=openModels;
$('close-model').onclick=()=>$('model-dialog').close();
$('refresh-providers').onclick=()=>void command('providers',selected||snapshot?.selected?.id);
// Retain the send gesture while iOS adjusts the focused viewport.
let sendGesture;
$('send').addEventListener('pointerdown',event=>{if(event.button!==0||$('send').disabled)return;sendGesture={id:event.pointerId,x:event.clientX,y:event.clientY};$('send').setPointerCapture(event.pointerId);});
$('send').addEventListener('pointerup',event=>{const gesture=sendGesture;sendGesture=null;if(!gesture||gesture.id!==event.pointerId)return;event.preventDefault();if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<16)$('composer').requestSubmit();});
$('send').addEventListener('pointercancel',()=>{sendGesture=null;});
$('send').addEventListener('click',event=>{event.preventDefault();if(event.detail===0)$('composer').requestSubmit();});

mobileVoice=setupMobileVoice({command,getContext:()=>({id:selected,online,protocol,busy:snapshot?.selected?.status==='working'}),notice});

function profileContext(){const chat=snapshot?.selected,row=snapshot?.conversations.find(c=>c.id===selected);return {...chat,posting,online,protocol,bot:chat?.group?{...row,name:row.title,id:row.id}:chat?.bot,photo:snapshot?.avatars?.[snapshot?.selected?.botId],receipt:lastReceipt,lastKind:lastCommandKind,pendingOperation:pending()?.computer?.operation};}
profileUI=setupProfile({command,context:profileContext,avatarView,notice,openModels,openConnections:openModels,notifications:{paint:()=>notifications?.paint()},openComputer:()=>computerUI.open()});
$('open-profile').onclick=()=>{if(!showList)profileUI.show();};$('menu-profile').onclick=()=>{$('menu').hidden=true;profileUI.show();};$('menu-new').onclick=()=>{$('menu').hidden=true;void command('new',undefined,undefined,{botId:snapshot?.selected?.botId});};
chatSearch=setupChatSearch({root:$('messages'),input:$('chat-query'),count:$('chat-match-count'),previous:$('search-previous'),next:$('search-next'),done:$('close-chat-search'),bar:$('chat-search'),menu:$('menu')});
$('menu-find').onclick=chatSearch.open;
$('menu-share').onclick=()=>{$('menu').hidden=true;profileUI.share();};
$('account-button').onclick=()=>settingsUI.open();
$('menu-all-chats').onclick=()=>{$('menu').hidden=true;allChats=true;showList=true;listKey='';renderList();views();};
computerUI=setupMobileComputer({command,context:()=>({id:selected,bot:snapshot?.selected?.bot,computer:snapshot?.selected?.computerView,working:snapshot?.selected?.status==='working',online,posting,protocol,receipt:lastReceipt,lastKind:lastCommandKind,pendingOperation:pending()?.computer?.operation}),avatarView,notice});
settingsUI=setupPhoneSettings({context:()=>({...snapshot,id:selected,posting,online,receipt:lastReceipt}),command,openModels,openChats:()=>{$('menu-all-chats').click();},openComputer:()=>{if(selected)openChat(selected);return computerUI.open();},notice});
notifications=setupAgentNotifications({context:profileContext,notice,scope:()=>auth?.roomId});
for(const [button,input]of [['tools-media','attach-media'],['tools-camera','attach-camera'],['tools-file','attach-file']]){$(button).onclick=()=>{closeTools();$(input).click();};$(input).onchange=async()=>{const file=$(input).files[0];if(!file)return;try{let blob=file,name=file.name;if(file.type.startsWith('image/')){const image=await createImageBitmap(file),scale=Math.min(1,1400/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));name=name.replace(/\.[^.]+$/,'')+'.jpg';image.close();}if(!blob||blob.size>1000000)throw new Error('Choose a file smaller than 1 MB.');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});await command('attach',selected,undefined,{file:{name,base64}});}catch(error){notice(error.message);}$(input).value='';};}

var systemAppearance=matchMedia('(prefers-color-scheme: dark)');function applyAppearance(){const choice=snapshot?.preferences?.appearance||'dark';const theme=resolveTheme(choice,systemAppearance.matches);if(document.documentElement.dataset.theme!==theme){document.documentElement.dataset.theme=theme;document.querySelector('meta[name=theme-color]').content=theme==='light'?'#fcfcfc':'#131313';listKey='';messageKey='';} $('mobile-appearance').value=choice;$('mobile-appearance').disabled=protocol<5||!online||posting;}systemAppearance.addEventListener('change',()=>{applyAppearance();if(snapshot){renderList();renderMessages();profileUI.update();}});$('mobile-appearance').onchange=()=>void command('preferences',selected,undefined,{preferences:{appearance:$('mobile-appearance').value}});
