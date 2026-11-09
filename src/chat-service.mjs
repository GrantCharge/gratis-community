import {avatarShape as defaultAvatarShape} from './avatar.mjs';
import {TeamCoordinator} from './team-coordinator.mjs';
import {continuationContext,computerObservation} from './computer-checkpoint.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from './store.mjs';
import { streamReply, validateSettings } from './backend.mjs';
import { userPrompt } from './claude-backend.mjs';
import { generateBotPrompt } from './auto-prompt.mjs';

const COLORS = ['#496e57', '#806549', '#635f9a', '#397c89', '#a05765'];
const text = (value, label, max, allowEmpty = false) => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label} must be ${allowEmpty ? '' : 'non-empty '}text under ${max} characters.`);
  return value;
};
const id = value => text(value, 'ID', 100);
export class ChatService {
  constructor({ dataDir, onChange = () => {}, backend = streamReply, promptGenerator = generateBotPrompt, runtimeFactory, workspaceFiles, memory, onGroupMembersChanging=async()=>{} }) {
    this.store = new JsonStore(dataDir); this.onChange = onChange; this.backend = backend; this.promptGenerator = promptGenerator; this.tasks = new Map(); this.promptTasks = new Map(); this.deletingBots = new Set(); this.deletingThreads=new Set();this.runtimeFactory = runtimeFactory; this.approvals = new Map(); this.closing = false; this.closed = false; this.computerPauseTasks = new Map(); this.teams=new TeamCoordinator(this);this.workspaceFiles=workspaceFiles;this.memory=memory;
    this.changingThreads=new Set();this.onGroupMembersChanging=onGroupMembersChanging;
  }
  async init() {
    this.state = await this.store.load();
    let interrupted = false;
    for(const [index,bot] of this.state.bots.entries()){if(!bot.avatarSeed){bot.avatarSeed=bot.name;interrupted=true;}if(!bot.avatarDefaultShape){bot.avatarDefaultShape=index===0?'sphere':defaultAvatarShape(bot.avatarSeed);interrupted=true;}if(!bot.avatarDefaultColor){bot.avatarDefaultColor=index===0?'black':'brown';interrupted=true;}}
    for (const c of this.state.conversations) for (const m of c.messages) if (m.status === 'streaming') { m.status = 'cancelled'; for(const activity of m.activities||[])if(['running','approval'].includes(activity.status))activity.status='cancelled'; m.error = 'Response interrupted when the app closed.'; c.claudeSession = null; c.codexSession=null; interrupted = true; }
    for(const c of this.state.conversations)if(c.queue?.length&&!c.queuePaused){c.queuePaused=true;interrupted=true;}
    if (interrupted) await this.store.save(this.state);
    this.memory?.bind(this);
    return this.snapshot();
  }
  snapshot() { return {...structuredClone(this.state),...(this.memory?{memory:this.memory.summary()}: {})}; }
  promptMessages(c){return this.memory?this.memory.messages(c):c.messages;}
  _ready() { if (!this.state || this.closed) throw new Error('Workspace is not available.'); }
  _conversation(value) { this._ready(); const c = this.state.conversations.find(c => c.id === id(value)); if (!c) throw new Error('Conversation not found.'); return c; }
  _bot(value) { this._ready(); const b = this.state.bots.find(b => b.id === id(value)); if (!b) throw new Error('Bot not found.'); if (this.deletingBots.has(b.id)) throw new Error('This bot is being deleted.'); return b; }
  async _changed() { this.teams.syncReplies();await this.store.save(this.state); try { this.onChange(this.snapshot()); } catch {} return this.snapshot(); }
  _newConversation(botId) {
    const now = Date.now(), c = { id: randomUUID(), botId, title: 'New conversation', draft: '', messages: [], createdAt: now, updatedAt: now };
    this.state.conversations.push(c); this.state.activeBotId = botId; this.state.activeConversationId = c.id; return c;
  }
  async createBot({ name, instructions = '', userPromptTemplate = '{{message}}', avatarShape, avatarColor, promptMode } = {}) {
    this._ready(); name = text(name, 'Bot name', 255).trim(); instructions = text(instructions, 'Instructions', 16_000, true);
    const auto = promptMode === 'auto' || (promptMode === undefined && !instructions.trim());
    if (promptMode !== undefined && !['auto','manual'].includes(promptMode)) throw new Error('Invalid prompt mode.');
    this._validateCharacter(avatarShape, avatarColor);
    userPromptTemplate = text(userPromptTemplate, 'User prompt template', 16_000, true) || '{{message}}';
    userPrompt(userPromptTemplate, '');
    const b = { id: randomUUID(), name, avatarSeed:name, avatarDefaultShape:defaultAvatarShape(name), avatarDefaultColor:'brown', instructions, userPromptTemplate, promptMode: auto ? 'auto' : 'manual', promptGenerated: !auto, ...(avatarShape ? {avatarShape} : {}), ...(avatarColor ? {avatarColor} : {}), color: COLORS[this.state.bots.length % COLORS.length], avatarDataUrl: null, createdAt: Date.now() };
    this.state.bots.push(b); const c = this._newConversation(b.id);
    if (promptMode === 'auto') {
      c.messages.push({id:randomUUID(),role:'assistant',kind:'onboarding',status:'complete',createdAt:Date.now(),content:`Hi, I'm ${name}. Glad to meet you. Tell me what you'd like help with, and I'll get set up for it.`});
      c.messages.push({id:randomUUID(),role:'assistant',kind:'onboarding',status:'complete',createdAt:Date.now(),content:'What would you like me to help with first?',question:{options:['Research and information','Planning and organization','Writing and content'],custom:true}});
    }
    return this._changed();
  }
  _validateCharacter(shape, color) {
    if (shape !== undefined && !['blob','cloud','square','sparkle','clover','heart','flower','teardrop','tablet','wedge','house','star','hex','sphere','capsule','pebble','squircle','heartChubby','starFlower','star6'].includes(shape)) throw new Error('Choose a supported avatar shape.');
    if (color !== undefined && !['black','brown','red','orange','yellow','green','cyan','blue','violet','magenta','gray'].includes(color)) throw new Error('Choose a supported avatar color.');
  }
  async _prepareBotPrompt(b, intention, settings, workspaceDir, signal, source) {
    if (b.promptMode !== 'auto' || b.promptGenerated) return;
    let pending = this.promptTasks.get(b.id);
    if (!pending) {
      pending = (async () => {
        const instructions = await this.promptGenerator({name:b.name,intention,settings,workspaceDir:join(workspaceDir,'setup'),signal});
        signal.throwIfAborted();
        if (b.promptMode === 'auto' && !b.promptGenerated) { b.instructions = text(instructions,'Generated instructions',16000); b.promptGenerated=true; b.promptGeneratedAt=Date.now(); if(source)b.promptSource=source; await this._changed(); }
      })();
      this.promptTasks.set(b.id,pending);
      pending.finally(()=>{if(this.promptTasks.get(b.id)===pending)this.promptTasks.delete(b.id);}).catch(()=>{});
    }
    await pending;
  }
  async selectBot({ id: botId } = {}) {
    const b = this._bot(botId); this.state.activeBotId = b.id;
    const c = this.state.conversations.filter(c => c.botId === b.id&&!c.parentThreadId&&c.kind!=='group').sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (c) this.state.activeConversationId = c.id; else this._newConversation(b.id);
    return this._changed();
  }
  async deleteBot({ id: botId } = {}) {
    const bot = this._bot(botId);
    this.deletingBots.add(bot.id);
    try {
      const ownedRoots=new Set(this.state.conversations.filter(c=>c.botId===bot.id).map(c=>c.id));
      const conversations = this.state.conversations.filter(c => c.botId === bot.id||ownedRoots.has(c.parentThreadId));
      const tasks = conversations.map(c => this.tasks.get(c.id)).filter(Boolean);
      for (const task of tasks) task.controller.abort(new DOMException('Bot deleted', 'AbortError'));
      await Promise.all(tasks.map(async task => { await task.ready; await task.promise; }));
      this.state.bots = this.state.bots.filter(b => b.id !== bot.id);
      this.state.conversations = this.state.conversations.filter(c => c.botId !== bot.id&&!ownedRoots.has(c.parentThreadId));
      for(const c of this.state.conversations)if(c.participantIds)c.participantIds=c.participantIds.filter(id=>id!==bot.id);
      if (this.state.activeBotId === bot.id) {
        const next = this.state.bots[0];
        this.state.activeBotId = next?.id ?? null;
        this.state.activeConversationId = null;
        if (next) {
          const conversation = this.state.conversations.filter(c => c.botId === next.id).sort((a,b) => b.updatedAt-a.updatedAt)[0];
          if (conversation) this.state.activeConversationId = conversation.id;
          else this._newConversation(next.id);
        }
      }
      return await this._changed();
    } finally { this.deletingBots.delete(bot.id); }
  }
  async createThread(value){return this.teams.create(value);}
  async renameThread(value){return this.teams.rename(value);}
  async updateThreadMembers(value){return this.teams.updateMembers(value);}
  async pinThread({conversationId,pinned}={}){const c=this._conversation(conversationId);this._threadOpen(c);if(c.kind!=='group'||c.parentThreadId||typeof pinned!=='boolean')throw new Error('Choose a group chat and a pin setting.');c.pinned=pinned;return this._changed();}
  _threadOpen(c){if(this.deletingThreads.has(c.parentThreadId||c.id))throw new Error('This chat is being deleted.');if(this.changingThreads.has(c.parentThreadId||c.id))throw new Error('This chat’s members are being updated. Try again in a moment.');if(c.inactiveTeamMember)throw new Error('This bot is no longer active in this group.');}
  async deleteThread({conversationId}={}){
    const root=this._conversation(conversationId);this._threadOpen(root);
    if(root.kind!=='group'||root.parentThreadId)throw new Error('Choose a group chat to delete.');
    const removed=this.state.conversations.filter(c=>c.id===root.id||c.parentThreadId===root.id),ids=new Set(removed.map(c=>c.id));
    this.deletingThreads.add(root.id);
    try{
      for(const c of removed){c.queue=[];c.queuePaused=true;}
      await this.stop({conversationId:root.id});
      await this.memory?.deleteConversations([...ids]);
      this.state.conversations=this.state.conversations.filter(c=>!ids.has(c.id));
      for(const id of ids){this.teams.active.delete(id);this.teams.chains.delete(id);}
      if(ids.has(this.state.activeConversationId)){
        const next=this.state.conversations.filter(c=>!c.parentThreadId).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
        if(next){this.state.activeConversationId=next.id;this.state.activeBotId=next.botId;}
        else this._newConversation(this._bot(root.botId).id);
      }
      return await this._changed();
    }finally{this.deletingThreads.delete(root.id);}
  }
  async newConversation({ botId } = {}) { const b = this._bot(botId); this._newConversation(b.id); return this._changed(); }
  async selectConversation({ id: conversationId } = {}) { const c = this._conversation(conversationId); this._bot(c.botId); this.state.activeConversationId = c.id; this.state.activeBotId = c.botId; return this._changed(); }
  async setDraft({ conversationId, text: draft } = {}) { const c = this._conversation(conversationId); c.draft = text(draft, 'Draft', 100_000, true); return this._changed(); }
  async updateSettings(value) { this._ready(); const old=this.state.settings;const next=validateSettings(value && { displayName:old.displayName,profileAvatarDataUrl:old.profileAvatarDataUrl,appearance:old.appearance,...value });const remember=s=>({[s.provider]:{model:s.model,effort:s.effort},...(s.provider==='custom'&&s.customProviderId?{[`custom:${s.customProviderId}`]:{model:s.model,effort:s.effort}}:{})});next.providerDefaults={...old.providerDefaults,...remember(old),...remember(next)};this.state.settings=next;return this._changed(); }
  async updateBot({ id: botId, name, instructions, userPromptTemplate, avatarDataUrl, avatarShape, avatarColor, capabilities, model, codexModel, pinned, memory, memoryProfileAccess } = {}) {
    const b = this._bot(botId), patch = {};
    if (name !== undefined) {patch.name = text(name, 'Bot name', 255).trim();if(!b.avatarSeed)patch.avatarSeed=b.name;}
    if (instructions !== undefined && instructions !== b.instructions) { patch.instructions = text(instructions, 'Instructions', 16_000, true); patch.promptMode='manual'; patch.promptGenerated=true;patch.promptSource=null; }
    this._validateCharacter(avatarShape,avatarColor);
    if(avatarShape!==undefined)patch.avatarShape=avatarShape;
    if(avatarColor!==undefined)patch.avatarColor=avatarColor;
    if (userPromptTemplate !== undefined) {
      patch.userPromptTemplate = text(userPromptTemplate, 'User prompt template', 16_000, true) || '{{message}}';
      userPrompt(patch.userPromptTemplate, '');
    }
    if (avatarDataUrl !== undefined) {
      if (avatarDataUrl !== null && (typeof avatarDataUrl !== 'string' || avatarDataUrl.length > 2_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatarDataUrl))) throw new Error('Avatar must be a PNG data URL.');
      patch.avatarDataUrl = avatarDataUrl;
    }
    if(capabilities!==undefined){if(!capabilities||Object.entries(capabilities).some(([k,v])=>!['web','files','computer','connections'].includes(k)||typeof v!=='boolean'))throw new Error('Invalid bot capabilities.');patch.capabilities={...b.capabilities,...capabilities};}
    if(codexModel!==undefined){if(typeof codexModel!=='string'||(codexModel!==''&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(codexModel)))throw new Error('Choose a supported Codex model.');patch.codexModel=codexModel;}
    if(model!==undefined){if(!['','haiku','sonnet','opus'].includes(model))throw new Error('Choose a supported model.');patch.model=model;}
    if(pinned!==undefined){if(typeof pinned!=='boolean')throw new Error('Invalid pin setting.');patch.pinned=pinned;}
    if(memoryProfileAccess!==undefined){if(typeof memoryProfileAccess!=='boolean')throw new Error('Choose a memory access setting.');patch.memoryProfileAccess=memoryProfileAccess;}
    if(memory!==undefined)patch.memory=text(memory,'Bot memory',16000,true);
    Object.assign(b, patch);if(memoryProfileAccess===false&&this.memory)await this.memory.restrictBot(b.id); return this._changed();
  }
  async duplicateBot({id:botId}={}){
    const source=this._bot(botId);const state=await this.createBot({name:`${source.name} copy`,instructions:source.instructions,userPromptTemplate:source.userPromptTemplate,avatarShape:source.avatarShape,avatarColor:source.avatarColor,promptMode:source.promptMode});
    const copy=this._bot(state.activeBotId);Object.assign(copy,{model:source.model||'',codexModel:source.codexModel||'',capabilities:structuredClone(source.capabilities||{}),memory:source.memory||'',memoryProfileAccess:source.memoryProfileAccess!==false,avatarDataUrl:source.avatarDataUrl});return this._changed();
  }
  async respondApproval({id:approvalId,allow}={}){const pending=this.approvals.get(approvalId);if(!pending||typeof allow!=='boolean')throw new Error('This approval is no longer pending.');pending(allow);return this.snapshot();}
  async _approve(assistant,name,input,signal){
    const approvalId=randomUUID();const activity={id:approvalId,name,input,status:'approval',startedAt:Date.now()};(assistant.activities??=[]).push(activity);
    return new Promise(resolve=>{
      const finish=allow=>{if(!this.approvals.has(approvalId))return;this.approvals.delete(approvalId);signal.removeEventListener('abort',cancel);activity.status=allow?'approved':'denied';activity.finishedAt=Date.now();void this._changed().catch(()=>{});resolve(allow);};
      const cancel=()=>finish(false);this.approvals.set(approvalId,finish);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();else void this._changed().catch(()=>{});
    });
  }
  async send({ conversationId, text: input } = {}) {
    const c = this._conversation(conversationId); input = text(input, 'Message', 100_000).trim();
    this._threadOpen(c);
    this._bot(c.botId);
    const attachments=c.draftAttachments||[];
    if(this.teams.busy(c)||c.queuePaused||(c.teamExchanges||[]).some(e=>e.deferred&&e.status==='waiting_for_user')){
      if((c.queue?.length||0)>=20)throw new Error('This chat already has 20 queued messages.');
      (c.queue??=[]).push({id:randomUUID(),text:input,attachments,createdAt:Date.now()});c.draft='';c.draftAttachments=[];return this._changed();
    }
    c.draftAttachments=[];
    return this._deliver(c,input,attachments);
  }
  async _deliver(c,input,attachments=[],setup={}) {
    this._threadOpen(c);
    const scheduleContext=setup.scheduled?'Automated scheduled run: '+setup.scheduled.title+'. Complete only the saved task below using current evidence and connected tools. Do not create or modify schedules during this run. Do not treat the timer as new user authorization for unrelated external actions. Return the result in this chat.\n\n':'';
    const modelContent = scheduleContext+userPrompt(this._bot(c.botId).userPromptTemplate, input)+(attachments.length?'\n\nAttached files in your private workspace:\n'+attachments.map(f=>`${f.name}: ${f.path}`).join('\n'):'');
    delete c.pendingComputerHelp;delete c.computerPause;delete c.pendingTeamResults;
    c.draftAttachments=[];
    c.messages.push({ id: randomUUID(), role: 'user', content: input, ...(setup.scheduled?{kind:'scheduled-task',sourceScheduleTitle:setup.scheduled.title,sourceScheduleId:setup.scheduled.id,sourceScheduleRunId:setup.scheduled.runId,scheduledFor:setup.scheduled.scheduledFor}:{}), ...(setup.intention?{setupIntention:setup.intention,setupSource:setup.source}:{}), ...(attachments.length?{attachments}:{}), ...(modelContent !== input ? { modelContent } : {}), status: 'complete', createdAt: Date.now() });
    c.draft = '';if(c.kind==='group'&&c.generatedTitle){c.title=input.replace(/\s+/g,' ').slice(0,72);delete c.generatedTitle;} if (c.title === 'New conversation') c.title = input.replace(/\s+/g, ' ').slice(0, 64);
    return this._route(c);
  }
  async _route(c){
    if(c.kind!=='group'||c.parentThreadId||this.teams.recipients(c).includes(c.botId))return this._begin(c);
    // A directly addressed teammate answers in its isolated SDK session; no
    // empty coordinator bubble and no accidental extra primary response.
    const controller=new AbortController(),task={controller,ready:Promise.resolve()};
    this.tasks.set(c.id,task);
    task.promise=this.teams.respondSelected(c,null,controller.signal).finally(async()=>{
      this.tasks.delete(c.id);c.updatedAt=Date.now();await this._changed();await this.teams.drain(c);
    });
    await this._changed();return this.snapshot();
  }
  async updateQueue({conversationId,id:queueId,action}={}){
    const c=this._conversation(conversationId);this._bot(c.botId);
    if(c.computerPause&&['pause','resume'].includes(action))c.computerPause.queueWasPaused=action==='pause';
    if(action==='remove')c.queue=(c.queue||[]).filter(item=>item.id!==queueId);
    else if(action==='pause')c.queuePaused=true;
    else if(action==='resume'){
      c.queuePaused=false;
      if(!this.teams.busy(c)&&!this.teams.waiting(c)&&c.queue?.length){const next=c.queue.shift();await this._deliver(c,next.text,next.attachments);}
    }else throw new Error('Unknown queue action.');
    return this._changed();
  }
  async retry({ conversationId,messageId } = {}) {
    const c = this._conversation(conversationId), last = messageId?c.messages.find(m=>m.id===messageId):c.messages.at(-1);
    this._threadOpen(c);
    if(messageId&&(!last||c.messages.indexOf(last)<c.messages.findLastIndex(m=>m.role==='user')))throw new Error('Retry a reply from the latest turn, or send a new message.');
    this._bot(c.botId);
    if (this.teams.busy(c)) throw new Error('This conversation is already receiving a response.');
    if(last?.kind==='team-reply'&&last.sourceConversationId){const exchange=(c.teamExchanges||[]).find(e=>e.id===last.sourceExchangeId);if(exchange?.origin==='group-message'){this._threadOpen(this._conversation(last.sourceConversationId));exchange.status='working';delete exchange.error;return this.retry({conversationId:last.sourceConversationId,messageId:exchange.childReplyId});}}
    if(c.computerPause&&last?.pauseReason==='computer')throw new Error('Use Give control back to resume this task from your browser changes.');
    if(c.kind==='group'&&last?.botId&&last.botId!==c.botId&&last.kind!=='team-reply')throw new Error('Send a new message to the current group to continue this earlier reply.');
    if(last?.memoryBlocked)throw new Error('Send a new request after clearing this chat’s memory context.');
    if (!last || last.role !== 'assistant' || !['error', 'cancelled'].includes(last.status)) throw new Error('There is no failed or stopped response to retry.');
    if(last.computerContinuation||c.kind==='group'||c.parentThreadId||last.activities?.some(a=>a.result||a.status==='complete')){
      return this._begin(c,{resumeMessage:last,continuation:continuationContext(last,last.computerContinuation,'retry')});
    }
    c.messages.pop(); return this._begin(c);
  }
  async requestComputerHelp(c,assistant,input,signal){
    signal.throwIfAborted();const reason=text(input.reason,'Help request',2000).trim();
    c.pendingComputerHelp={assistantId:assistant.id,reason,requestedAt:Date.now(),userMessageId:c.messages.findLast(m=>m.role==='user')?.id};
    await this._changed();return {status:'needs_user',message:'The user can now Take control and Give control back. End this reply briefly. Your unfinished task and current page will resume automatically.'};
  }
  async pauseForComputer({conversationId}={}) {
    const c=this._conversation(conversationId);
    if(this.computerPauseTasks.has(c.id)){await this.computerPauseTasks.get(c.id);return this.snapshot();}
    if(c.computerPause)return this.snapshot();
    const active=this.tasks.get(c.id),assistant=c.messages.find(m=>m.id===(active?.assistantId||c.pendingComputerHelp?.assistantId))||c.messages.at(-1);
    const awaitingHelp=!!c.pendingComputerHelp&&c.pendingComputerHelp.assistantId===assistant?.id&&c.pendingComputerHelp.userMessageId===c.messages.findLast(m=>m.role==='user')?.id;
    if(assistant?.role!=='assistant'||(!this.tasks.has(c.id)&&!awaitingHelp))return this.snapshot();
    c.computerPause={assistantId:assistant.id,queueWasPaused:!!c.queuePaused,pausedAt:Date.now()};
    assistant.pauseReason='computer';
    const pending=(async()=>{
      await this.stop({conversationId:c.id,forComputer:true});
      if(awaitingHelp&&assistant.status==='complete')assistant.status='cancelled';
      if(assistant.status==='cancelled'){assistant.error='Paused while you control the computer.';await this._changed();}
      else {delete c.computerPause;delete assistant.pauseReason;await this._changed();}
    })();
    this.computerPauseTasks.set(c.id,pending);
    try{await pending;}finally{if(this.computerPauseTasks.get(c.id)===pending)this.computerPauseTasks.delete(c.id);}
    return this.snapshot();
  }
  async resumeAfterComputer({conversationId,computerState}={}) {
    const c=this._conversation(conversationId);await this.computerPauseTasks.get(c.id);
    const checkpoint=c.computerPause;if(!checkpoint)return this.snapshot();
    // Consume this handoff before starting work, so duplicate UI events cannot replay it.
    delete c.computerPause;delete c.pendingComputerHelp;
    const assistant=c.messages.find(m=>m.id===checkpoint.assistantId);
    if(this.tasks.has(c.id)||assistant?.id!==checkpoint.assistantId||assistant.status!=='cancelled'||assistant.pauseReason!=='computer')return this._changed();
    c.queuePaused=checkpoint.queueWasPaused;
    assistant.computerContinuation=computerObservation(computerState);
    const continuation=continuationContext(assistant,computerState);
    return this._begin(c,{resumeMessage:assistant,continuation});
  }
  async _begin(c,{resumeMessage,continuation}={}) {
    this._threadOpen(c);
    const priorContent=resumeMessage?.content||'';
    const controller = new AbortController(), assistant = resumeMessage || { id: randomUUID(), role: 'assistant', content: '', status: 'streaming', createdAt: Date.now(), provider: this.state.settings.provider };
    const history = this.promptMessages(c).filter(m => m.kind !== 'onboarding' && (!continuation||m.id!==resumeMessage?.id) && (m.role === 'user' || (m.role === 'assistant' && m.status === 'complete'))).map(({ role, content, modelContent,botId }) => ({ role, content: role === 'user' ? modelContent ?? content : botId?'['+(this.state.bots.find(b=>b.id===botId)?.name||'Teammate')+'] '+content:content }));
    if(continuation){if(priorContent)history.push({role:'assistant',content:priorContent});history.push({role:'user',content:continuation,internalContinuation:true});}
    assistant.status='streaming';assistant.provider=this.state.settings.provider;delete assistant.error;delete assistant.pauseReason;
    let bot = structuredClone(this._bot(c.botId)); const settings = {...structuredClone(this.state.settings),...(this.state.settings.provider==='claude'&&bot.model?{model:bot.model}:this.state.settings.provider==='codex'&&bot.codexModel?{model:bot.codexModel}:{})};
    if(!resumeMessage)c.messages.push(assistant); c.updatedAt = Date.now();
    const task = { controller, promise: null, assistantId:assistant.id }; task.ready = new Promise(resolve => { task.started = resolve; }); this.tasks.set(c.id, task);
    try { await this._changed(); }
    catch (error) { this.tasks.delete(c.id); task.started(); assistant.status = 'error'; assistant.error = error.message; throw error; }
    let broadcast;const respondAll=()=>{if(!resumeMessage&&!broadcast&&c.kind==='group'&&!c.parentThreadId&&!controller.signal.aborted)broadcast=this.teams.respondSelected(c,assistant,controller.signal);};
    task.promise = (async () => {
      try {
        controller.signal.throwIfAborted();
        const workspaceDir = join(this.store.directory, 'claude-workspaces', createHash('sha256').update(c.id).digest('hex'));
        if (bot.promptMode === 'auto' && !bot.promptGenerated) {
          assistant.phase='setup'; await this._changed();
          const firstUser=this.promptMessages(c).find(m=>m.role==='user');
          await this._prepareBotPrompt(this._bot(c.botId),firstUser?.setupIntention||firstUser?.content||'',settings,workspaceDir,controller.signal,firstUser?.setupSource||{conversationId:c.id,messageId:firstUser?.id});
          bot=structuredClone(this._bot(c.botId));delete assistant.phase;await this._changed();
        }
        const onActivity = activity => {const entries=assistant.activities??=[];let current=entries.find(a=>a.id===activity.id);if(current)Object.assign(current,activity);else if(activity.name)entries.push(activity);else return;if((activity.name||current?.name)==='recall_memory'&&activity.result?.ids)assistant.memoryRefs=[...new Set([...(assistant.memoryRefs||[]),...activity.result.ids])];void this._changed().catch(()=>{});};
        await this.memory?.checkpoint(c,assistant,'working');
        const memoryPacket=this.memory?await this.memory.contextPacket(c.id,history.findLast(m=>m.role==='user')?.content||''):{context:'',ids:[]};assistant.memoryRefs=memoryPacket.ids;
        if(memoryPacket.ids.length)onActivity({id:'memory-'+assistant.id,name:'recall_memory',status:'complete',startedAt:Date.now(),finishedAt:Date.now(),result:{count:memoryPacket.ids.length,ids:memoryPacket.ids},input:{automatic:true}});
        const memoryTools=this.memory?{recall:input=>this.memory.search(c.id,input),learn:input=>this.memory.learn(c.id,{...input,messageId:this.promptMessages(c).findLast(m=>m.role==='user')?.id})}:undefined;
        const runtime=this.runtimeFactory&&['claude','codex'].includes(settings.provider)?await this.runtimeFactory({bot,conversationId:c.id,sourceMessageId:this.promptMessages(c).findLast(m=>m.role==='user')?.id,signal:controller.signal,onActivity,memory:memoryTools,collaboration:this.teams.forConversation(c,bot,controller.signal),requestComputerHelp:input=>this.requestComputerHelp(c,assistant,input,controller.signal),approve:(name,input)=>this._approve(assistant,name,input,controller.signal)}):undefined;
        const onMetadata = value => { if(value.codexSession!==undefined)c.codexSession=value.codexSession; if (value.claudeSession !== undefined) c.claudeSession = value.claudeSession; if (value.usage) assistant.usage = value.usage; if(value.activity)onActivity(value.activity); };
        let continuationStarted=false;
        for await (const chunk of this.backend({ settings, bot, messages: history, signal: controller.signal, workspaceDir, claudeSession: c.claudeSession, codexSession:c.codexSession, onMetadata, runtime,turnContext:memoryPacket.context,contextEpoch:memoryPacket.epoch })) {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (typeof chunk !== 'string') throw new Error('Backend returned a non-text response chunk.');
          if(resumeMessage&&priorContent&&!continuationStarted&&chunk){assistant.content+='\n\n';continuationStarted=true;}
          assistant.content += chunk;if(chunk)respondAll();
          if (assistant.content.length > 1_000_000) throw new Error('Response exceeded the local size limit.');
          await this._changed();
        }
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!assistant.content) throw new Error('Backend returned an empty response.');
        assistant.status = 'complete';
        for(const activity of assistant.activities||[])if(activity.status==='running'){activity.status='cancelled';activity.detail='No completion receipt was received; inspect the result before retrying.';}
      } catch (error) {
        if (settings.provider === 'claude') c.claudeSession = null; if(settings.provider==='codex')c.codexSession=null;
        assistant.status = controller.signal.aborted ? 'cancelled' : 'error';
        assistant.error = controller.signal.aborted ? 'Response stopped.' : String(error?.message ?? error);
      } finally {
        respondAll();if(broadcast&&!(controller.signal.aborted&&c.computerPause))await broadcast;
        for(const activity of assistant.activities||[])if(activity.status==='running'||activity.status==='approval')activity.status='cancelled';
        c.updatedAt = Date.now(); this.tasks.delete(c.id);
        if(assistant.status!=='complete'&&c.queue?.length)c.queuePaused=true;
        await this._changed().catch(() => {});
        await this.memory?.checkpoint(c,assistant,assistant.status==='complete'?'complete':c.computerPause?'paused':'stopped').catch(()=>{});
        await this.memory?.enqueue(c,assistant).catch(()=>{});
        await this.teams.onFinished(c,assistant).catch(()=>{});
        if(assistant.status==='complete'&&!this.teams.busy(c)&&!this.teams.waiting(c)&&!c.pendingComputerHelp&&!c.pendingTeamResults&&!this.tasks.has(c.id)&&!c.queuePaused&&!this.closing&&!this.deletingBots.has(c.botId)&&c.queue?.length){const next=c.queue.shift();await this._deliver(c,next.text,next.attachments);}
      }
    })();
    task.started();
    return this.snapshot();
  }
  async stop({ conversationId, forComputer=false } = {}) {
    const c = this._conversation(conversationId), task = this.tasks.get(c.id);
    if(!forComputer){delete c.pendingComputerHelp;delete c.pendingTeamResults;this.teams.cancelDeferred(c.id);}
    const clearPause=!!c.computerPause&&!forComputer;if(clearPause){delete c.computerPause;for(const m of c.messages)if(m.pauseReason==='computer'){delete m.pauseReason;m.error='Response stopped.';}}
    if(c.queue?.length)c.queuePaused=true;
    if(task)task.controller.abort(new DOMException('Stopped', 'AbortError'));
    if(!forComputer&&!c.parentThreadId)await this.teams.stopChildren(c.id);
    if (task) { await task.ready; await task.promise; }
    return this._changed();
  }
  async whenIdle() { while(this.tasks.size)await Promise.all([...this.tasks.values()].map(async t => { await t.ready; await t.promise; })); await this.store.flush(); }
  async close() { this.closing=true; for (const task of this.tasks.values()) task.controller.abort(new DOMException('App closed', 'AbortError')); await this.whenIdle(); await this.memory?.close();this.closed = true; }
}
