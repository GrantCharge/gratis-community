import {renderMarkdown} from './markdown.mjs';
const $=id=>document.getElementById(id),labels={submitting:'Starting',queued:'Queued',running:'Working',completed:'Finished',failed:'Failed',interrupted:'Interrupted',cancelled:'Stopped',cancel_requested:'Stopping',needs_input:'Needs your input',needs_review:'Check in T3',disconnected:'Reconnecting',idle:'Ready'};
const environmentStatus={connected:'Connected',saved:'Saved',connecting:'Connecting…',authorizing:'Approve Gratis in the T3 sign-in page.',error:'Needs attention',disconnected:'Not connected'};
const usable=env=>env.connected||env.status==='saved';
export function setupT3UI({api,getState,onOpenConnections}){
 let state=null,projects=[],providers=[],threads=[],loadedEnvironment=null,refreshing=false,refreshAgain=false,scopeId=null,saving=false,layoutInitialized=false,renaming=null;
 const context=()=>({conversationId:getState()?.activeConversationId});
 const button=(label,action,klass='quiet-button')=>{const b=document.createElement('button');b.type='button';b.className=klass;b.textContent=label;b.onclick=()=>void action().catch(error);return b;};
 const error=e=>{$('t3-error').textContent=e.message||String(e);$('t3-error').hidden=false;};
 const selectedModel=()=>{const value=$('t3-model').value;if(!value)return undefined;const [instanceId,model]=JSON.parse(value);return{instanceId,model};};
 // The bot's bound environment wins; otherwise the picker's choice, then the first usable environment.
 const environmentId=()=>{const envs=state?.environments||[];const bound=state?.binding?.environmentId;if(bound&&envs.some(e=>e.id===bound))return bound;const picked=$('t3-environment').value;if(picked&&envs.some(e=>e.id===picked))return picked;return envs.find(usable)?.id||'';};
 const bindingHere=()=>state?.binding?.environmentId===environmentId()?state.binding:null;
 function options(select,items,value){select.replaceChildren(...items.map(([id,label])=>{const o=document.createElement('option');o.value=id;o.textContent=label;return o;}));select.value=value||'';}
 async function loadOptions(){const id=context().conversationId,env=environmentId();if(!env){projects=[];providers=[];loadedEnvironment=null;paintBinding();return;}const next=await api.t3Options({...context(),environmentId:env});if(context().conversationId!==id||environmentId()!==env)return;projects=next.projects;providers=next.providers;loadedEnvironment=env;paintBinding();await loadThreads();}
 async function loadThreads(){const projectId=$('t3-project').value;if(!projectId){threads=[];paintThreads();return;}threads=await api.t3Threads({...context(),environmentId:environmentId(),projectId});paintThreads();}
 function paintThreads(){options($('t3-thread'),[['','Start a new thread'],...threads.map(t=>[t.threadId,t.title])],bindingHere()?.threadId);}
 function paintBinding(){const binding=bindingHere();options($('t3-project'),[['','Choose a project'],...projects.map(p=>[p.id,p.title||p.name||p.workspaceRoot])],binding?.projectId);options($('t3-model'),[['','Use T3 project default'],...providers.filter(p=>p.canRunChildTask).flatMap(p=>p.models.map(m=>[JSON.stringify([p.providerInstanceId,m.id]),p.displayName+' · '+(m.label||m.id)]))],binding?.modelSelection?JSON.stringify([binding.modelSelection.instanceId,binding.modelSelection.model]):'');}
 async function saveBinding(){if(saving)return;saving=true;try{state.binding=await api.t3Bind({...context(),environmentId:environmentId(),projectId:$('t3-project').value,threadId:$('t3-thread').value,modelSelection:selectedModel()});$('t3-run').disabled=!state.binding?.projectId;}finally{saving=false;}}
 function renderEnvironments(){
  const list=$('t3-environment-list');list.replaceChildren();
  for(const env of state.environments){
   const row=document.createElement('div');row.className='t3-environment';row.dataset.environmentId=env.id;
   const name=document.createElement('strong');name.textContent=env.label;const status=document.createElement('span');status.className='t3-status';status.dataset.status=env.connected?'completed':env.status;status.textContent=environmentStatus[env.status]||env.status;
   const address=document.createElement('span');address.className='t3-environment-address';address.textContent=env.endpoint;row.append(name,status,address);
   if(env.error){const note=document.createElement('p');note.className='t3-task-error';note.textContent=env.error;row.append(note);}
   if(renaming===env.id){const form=document.createElement('form');form.className='t3-environment-rename';const input=document.createElement('input');input.value=env.label;input.maxLength=60;input.setAttribute('aria-label','Rename '+env.label);const save=button('Save',async()=>{});save.type='submit';form.append(input,save,button('Cancel',async()=>{renaming=null;render();}));form.onsubmit=async e=>{e.preventDefault();try{await api.t3Rename({environmentId:env.id,label:input.value});renaming=null;await refresh();}catch(e){error(e);}};row.append(form);queueMicrotask(()=>input.focus());}
   else{const actions=document.createElement('div');actions.className='t3-task-actions';
    if(!env.connected&&!['connecting','authorizing'].includes(env.status))actions.append(button('Reconnect',async()=>{$('t3-error').hidden=true;await api.t3Connect({environmentId:env.id});await refresh();}));
    actions.append(button('Rename',async()=>{renaming=env.id;render();}),button('Remove',async()=>{if(!confirm('Remove '+env.label+' from Gratis? Its T3 work keeps running on that machine.'))return;await api.t3Remove({environmentId:env.id});loadedEnvironment=null;await refresh();}));row.append(actions);}
   list.append(row);
  }
 }
 function render(){if(!state)return;const envs=state.environments,ready=envs.filter(usable),pending=envs.find(e=>['connecting','authorizing'].includes(e.status));
  $('t3-project-area').hidden=!ready.length;
  $('t3-connection-status').textContent=state.installing?state.installing:pending?(pending.status==='authorizing'?'Approve Gratis in the T3 sign-in page for '+pending.label+'.':'Connecting to '+pending.label+'…'):ready.length?'Connected to '+ready.map(e=>e.label).join(', '):'Run tasks in T3';
  $('t3-local').disabled=!!state.installing||!!pending;$('t3-connect').disabled=!!pending;
  renderEnvironments();
  const current=environmentId();options($('t3-environment'),envs.filter(e=>usable(e)||e.id===state.binding?.environmentId).map(e=>[e.id,e.label]),current);
  $('t3-run').disabled=!bindingHere()?.projectId||saving;if(!layoutInitialized){$('t3-environments').open=!ready.length;$('t3-project-settings').open=!state.binding?.projectId;$('t3-new-task').open=!state.jobs.length;layoutInitialized=true;}
  const list=$('t3-task-list'),drafts=new Map([...list.querySelectorAll('.t3-followup')].map(form=>[form.dataset.jobId,form.querySelector('input').value]));
  const focused=document.activeElement?.closest('.t3-followup')?.dataset.jobId,selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;list.replaceChildren();
  for(const job of state.jobs){const card=document.createElement('article');card.className='t3-task';const head=document.createElement('div');head.className='t3-task-heading';const title=document.createElement('strong');title.textContent=job.title;if(job.environmentLabel){const tag=document.createElement('span');tag.className='t3-environment-tag';tag.textContent=job.environmentLabel;title.append(tag);}const status=document.createElement('span');status.className='t3-status';status.dataset.status=job.status;status.textContent=labels[job.status]||job.status;head.append(title,status);card.append(head);
   const goal=document.createElement('p');goal.className='t3-task-goal';goal.textContent=job.prompt;card.append(goal);
   if(job.error){const note=document.createElement('p');note.className='t3-task-error';note.textContent=job.error;card.append(note);}
   const result=job.result||job.items?.filter(i=>i.text&&/assistant|agent_message|response/i.test(i.type)).map(i=>i.text).join('\n\n');if(result){const body=document.createElement('div');body.className='markdown t3-result';body.append(renderMarkdown(result));card.append(body);}
   const actions=document.createElement('div');actions.className='t3-task-actions';actions.append(button('Refresh',()=>api.t3Refresh({...context(),id:job.id}).then(refresh)));
   if(job.link)actions.append(button('Open in T3',()=>api.t3Open({...context(),id:job.id})));
   if(['disconnected','needs_review'].includes(job.status))actions.append(button('Retry',()=>api.t3Retry({...context(),id:job.id}).then(refresh)));
   if(job.threadId&&!['completed','cancelled','interrupted','failed'].includes(job.status))actions.append(button('Stop task',()=>api.t3Stop({...context(),id:job.id}).then(refresh)));
   card.append(actions);
   if(job.threadId){const form=document.createElement('form');form.className='t3-followup';form.dataset.jobId=job.id;const input=document.createElement('input');input.value=drafts.get(job.id)||'';input.placeholder='Follow up in this thread…';input.setAttribute('aria-label','Follow up on '+job.title);const send=button('Send',async()=>{});send.type='submit';form.append(input,send);form.onsubmit=async e=>{e.preventDefault();if(!input.value.trim())return;send.disabled=true;try{await api.t3Send({...context(),id:job.id,message:input.value});input.value='';await refresh();}catch(e){error(e);}finally{send.disabled=false;}};card.append(form);}
   list.append(card);
  }
  if(focused){const input=[...list.querySelectorAll('.t3-followup')].find(f=>f.dataset.jobId===focused)?.querySelector('input');input?.focus({preventScroll:true});if(input&&selection)input.setSelectionRange(...selection);}
  $('t3-empty').hidden=state.jobs.length>0;
 }
 async function refresh(){if(!context().conversationId)return;if(refreshing){refreshAgain=true;return;}refreshing=true;const id=context().conversationId;try{const next=await api.t3View(context());if(id!==context().conversationId)return;state=next;render();const env=environmentId();if(env&&state.environments.some(e=>e.id===env&&usable(e))&&loadedEnvironment!==env)await loadOptions();}catch(e){error(e);}finally{refreshing=false;if(refreshAgain){refreshAgain=false;void refresh();}}}
 $('t3-local').onclick=async()=>{try{$('t3-error').hidden=true;$('t3-local').disabled=true;await api.t3Local();loadedEnvironment=null;await refresh();}catch(e){error(e);$('t3-local').disabled=false;}};
 $('t3-add-environment').onsubmit=async e=>{e.preventDefault();try{$('t3-error').hidden=true;await api.t3Connect({endpoint:$('t3-endpoint').value,label:$('t3-environment-label').value});$('t3-endpoint').value='';$('t3-environment-label').value='';await refresh();}catch(e){error(e);}};
 $('t3-environment').onchange=async()=>{try{const next=$('t3-environment').value;if(state.binding&&state.binding.environmentId!==next){state.binding=await api.t3Bind({...context(),environmentId:next,projectId:''});$('t3-environment').value=next;}projects=[];threads=[];loadedEnvironment=null;await loadOptions();$('t3-run').disabled=true;}catch(e){error(e);}};
 $('t3-refresh-projects').onclick=()=>void loadOptions().catch(error);
 $('t3-add-project').onclick=async()=>{try{const project=await api.t3Project({...context(),environmentId:environmentId()});if(project){await loadOptions();$('t3-project').value=project.id;await loadThreads();await saveBinding();}}catch(e){error(e);}};
 $('t3-project').onchange=async()=>{try{state.binding=null;await loadThreads();await saveBinding();}catch(e){error(e);}};
 $('t3-thread').onchange=()=>void saveBinding().catch(error);$('t3-model').onchange=()=>void saveBinding().catch(error);
 $('t3-task-form').onsubmit=async e=>{e.preventDefault();if(!$('t3-prompt').value.trim())return;$('t3-run').disabled=true;try{await api.t3Submit({...context(),prompt:$('t3-prompt').value,title:$('t3-title').value});$('t3-prompt').value='';$('t3-title').value='';$('t3-new-task').open=false;$('t3-project-settings').open=false;await refresh();}catch(e){error(e);}finally{$('t3-run').disabled=!bindingHere()?.projectId;}};
 api.onT3Changed?.(()=>{if(!$('workspace-t3').hidden)void refresh();});
 return{refresh,sync(){if(scopeId!==context().conversationId){scopeId=context().conversationId;state=null;loadedEnvironment=null;layoutInitialized=false;renaming=null;if(!$('workspace-t3').hidden)void refresh();}}};
}
