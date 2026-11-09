import {retainSubmitGesture} from './submit-gesture.mjs';
import {renderIcon} from '../../../src/assets/icons.mjs';
export function setupPhoneSettings({context,command,openModels,openChats,openComputer,notifications,notice}){
 const $=id=>document.getElementById(id);let editing=false,photo,changedPhoto=false,saving=false;
 retainSubmitGesture($('settings-save'),$('settings-profile-form'));
 function update(){const s=context();$('settings-name').textContent=s.userProfile?.name||'Your profile';$('settings-subscription').textContent=(n=>n.length>2?n.slice(0,-1).join(', ')+' and '+n.at(-1):n.join(' and '))(s.providers?.filter(p=>p.signedIn).map(p=>p.name)||[])||'Sign in on your computer';$('settings-computer-state').textContent=s.connections?.cloud?'Connected':'Not connected';
  for(const id of ['settings-photo','settings-edit-photo']){const el=$(id);if(editing&&id==='settings-edit-photo')continue;const src=s.avatars?.__profile;el.replaceChildren();if(src){const img=document.createElement('img');img.src=src;img.alt='Your profile';el.append(img);}else renderIcon(el,'person');}
  $('settings-version').textContent='Gratis '+(s.appVersion||'');$('settings-save').disabled=s.posting||!s.online;
  for(const button of $('appearance-options').querySelectorAll('button')){button.disabled=s.posting||!s.online;button.setAttribute('aria-pressed',String(button.dataset.appearance===(s.preferences?.appearance||'dark')));}
  $('settings-appearance-label').textContent=({system:'Follow System',light:'Light',dark:'Dark'})[s.preferences?.appearance||'dark'];
  if(saving&&!s.posting&&s.receipt){saving=false;if(s.receipt.ok){editing=false;$('settings-profile-view').hidden=true;}else{$('settings-error').textContent=s.receipt.detail;$('settings-error').hidden=false;}}
 }
 function open(){$('phone-settings').hidden=false;update();}
 function close(){editing=false;saving=false;$('phone-settings').hidden=true;$('settings-profile-view').hidden=true;$('appearance-view').hidden=true;$('settings-connections-view').hidden=true;}
 $('settings-close').onclick=close;
 $('settings-profile').onclick=()=>{editing=true;changedPhoto=false;photo=context().avatars?.__profile||null;$('settings-profile-name').value=context().userProfile?.name||'';$('settings-error').hidden=true;$('settings-profile-view').hidden=false;drawPhoto();};
 function drawPhoto(){const el=$('settings-edit-photo');el.replaceChildren();if(photo){const img=document.createElement('img');img.src=photo;img.alt='Your profile';el.append(img);}else renderIcon(el,'person');}
 $('settings-edit-photo').onclick=()=>$('settings-photo-file').click();$('settings-remove-photo').onclick=()=>{photo=null;changedPhoto=true;drawPhoto();};
 $('settings-photo-file').onchange=async()=>{const file=$('settings-photo-file').files[0];if(!file)return;try{const image=await createImageBitmap(file),canvas=document.createElement('canvas');canvas.width=canvas.height=256;const side=Math.min(image.width,image.height);canvas.getContext('2d').drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,256,256);photo=canvas.toDataURL('image/png');image.close();changedPhoto=true;drawPhoto();}catch{notice('Choose a supported photo.');}$('settings-photo-file').value='';};
 $('settings-profile-back').onclick=()=>{editing=false;$('settings-profile-view').hidden=true;};
 $('settings-profile-form').onsubmit=async e=>{e.preventDefault();saving=true;const settings={displayName:$('settings-profile-name').value.trim(),...(changedPhoto?{profileAvatarDataUrl:photo}:{})};if(!await command('user-settings',context().id,undefined,{settings})){saving=false;$('settings-error').textContent='Your changes could not be saved. Try again.';$('settings-error').hidden=false;}};
 $('settings-models').onclick=openModels;$('settings-chats').onclick=()=>{close();openChats();};$('settings-computer').onclick=()=>{close();openComputer();};
 $('settings-appearance').onclick=()=>{$('appearance-view').hidden=false;update();};$('appearance-back').onclick=()=>$('appearance-view').hidden=true;
 for(const button of $('appearance-options').querySelectorAll('button'))button.onclick=()=>void command('preferences',context().id,undefined,{preferences:{appearance:button.dataset.appearance}});
 $('settings-connections').onclick=()=>{const s=context();$('connection-summary').textContent=[...(s.providers||[]).map(p=>p.name+': '+(p.custom?(p.signedIn?'API key saved on your computer':'not reachable from your computer'):p.signedIn?'subscription connected':'sign in on your computer')),'Cloud computer: '+(s.connections?.cloud?'connected':'not connected'),'Connected apps: '+(s.connections?.composio?'Composio connected':'connect Composio on your computer')].join('\n');$('settings-connections-view').hidden=false;};$('connections-back').onclick=()=>$('settings-connections-view').hidden=true;
 return{open,close,update};
}
