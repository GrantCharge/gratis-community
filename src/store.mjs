import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DEFAULT_SETTINGS = Object.freeze({ provider: 'demo', baseUrl: 'http://127.0.0.1:11434/v1', model: '', effort: 'medium', voiceCleanup: true, voiceLanguage: 'en', displayName: '', profileAvatarDataUrl: null });
export function initialState() {
  const now = Date.now(), botId = randomUUID(), conversationId = randomUUID();
  return { version: 1, bots: [{ id: botId, name: 'Gratis', instructions: 'Be helpful, clear, and concise.', userPromptTemplate: '{{message}}', promptMode: 'auto', promptGenerated: false, color: '#496e57', avatarDataUrl: null, createdAt: now }], conversations: [{ id: conversationId, botId, title: 'New conversation', draft: '', messages: [], createdAt: now, updatedAt: now }], activeBotId: botId, activeConversationId: conversationId, settings: { ...DEFAULT_SETTINGS } };
}
function validState(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.bots) || !Array.isArray(s.conversations) || !s.settings || !['demo', 'local', 'claude', 'codex', 'custom'].includes(s.settings.provider) || typeof s.settings.baseUrl !== 'string' || typeof s.settings.model !== 'string') return false;
  if (s.settings.customProviderId !== undefined && (typeof s.settings.customProviderId !== 'string' || s.settings.customProviderId.length > 64)) return false;
  if(s.settings.appearance!==undefined&&!['system','light','dark'].includes(s.settings.appearance))return false;
  if (s.settings.profileAvatarDataUrl !== undefined && s.settings.profileAvatarDataUrl !== null && (typeof s.settings.profileAvatarDataUrl !== 'string' || s.settings.profileAvatarDataUrl.length > 2_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s.settings.profileAvatarDataUrl))) return false;
  if (s.settings.displayName !== undefined && (typeof s.settings.displayName !== 'string' || s.settings.displayName.length > 80)) return false;
  if (s.settings.effort !== undefined && !['minimal','low', 'medium', 'high','xhigh','max','ultra','persistent'].includes(s.settings.effort)) return false;
  if (s.settings.voiceCleanup !== undefined && typeof s.settings.voiceCleanup !== 'boolean') return false;
  if (s.settings.voiceLanguage !== undefined && !['en', 'auto'].includes(s.settings.voiceLanguage)) return false;
  const bots = new Set(), conversations = new Set();
  for (const b of s.bots) {
    if (!b || typeof b.id !== 'string' || bots.has(b.id) || typeof b.name !== 'string' || typeof b.instructions !== 'string' || typeof b.color !== 'string' || !(b.avatarDataUrl === null || typeof b.avatarDataUrl === 'string') || !Number.isFinite(b.createdAt)) return false;
    bots.add(b.id);
    if (b.model !== undefined && !['','haiku','sonnet','opus'].includes(b.model)) return false;
    if(b.codexModel!==undefined&&(typeof b.codexModel!=='string'||(b.codexModel!==''&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(b.codexModel))))return false;
    if (b.pinned !== undefined && typeof b.pinned !== 'boolean') return false;
    if(b.memoryProfileAccess!==undefined&&typeof b.memoryProfileAccess!=='boolean')return false;
    if (b.memory !== undefined && (typeof b.memory !== 'string' || b.memory.length>16000)) return false;
    if (b.capabilities !== undefined && (!b.capabilities || Object.entries(b.capabilities).some(([k,v])=>!['web','files','computer','connections'].includes(k)||typeof v!=='boolean'))) return false;
    if (b.promptMode !== undefined && !['auto','manual'].includes(b.promptMode)) return false;
    if(b.avatarDefaultShape!==undefined&&typeof b.avatarDefaultShape!=='string')return false;if(b.avatarDefaultColor!==undefined&&typeof b.avatarDefaultColor!=='string')return false;
    if(b.avatarSeed!==undefined&&(typeof b.avatarSeed!=='string'||b.avatarSeed.length>255))return false;
    if (b.avatarShape !== undefined && typeof b.avatarShape !== 'string') return false;
    if (b.avatarColor !== undefined && typeof b.avatarColor !== 'string') return false;
    if (b.userPromptTemplate !== undefined && (typeof b.userPromptTemplate !== 'string' || b.userPromptTemplate.length > 16_000)) return false;
  }
  for (const c of s.conversations) {
    if (!c || typeof c.id !== 'string' || conversations.has(c.id) || !bots.has(c.botId) || typeof c.title !== 'string' || typeof c.draft !== 'string' || !Array.isArray(c.messages) || !Number.isFinite(c.createdAt) || !Number.isFinite(c.updatedAt)) return false;
    if(c.pinned!==undefined&&typeof c.pinned!=='boolean')return false;
    if(c.computerPause!==undefined&&(!c.computerPause||typeof c.computerPause.assistantId!=='string'||typeof c.computerPause.queueWasPaused!=='boolean'||!Number.isFinite(c.computerPause.pausedAt)))return false;
    if(c.pendingComputerHelp!==undefined&&(!c.pendingComputerHelp||typeof c.pendingComputerHelp.assistantId!=='string'||typeof c.pendingComputerHelp.reason!=='string'||!Number.isFinite(c.pendingComputerHelp.requestedAt)))return false;
    if(c.queue!==undefined&&(!Array.isArray(c.queue)||c.queue.length>20||c.queue.some(q=>!q||typeof q.id!=='string'||typeof q.text!=='string'||q.text.length>100000)))return false;
    if(c.queuePaused!==undefined&&typeof c.queuePaused!=='boolean')return false;
    if(c.participantIds!==undefined&&(!Array.isArray(c.participantIds)||!c.participantIds.length||c.participantIds.length>6||new Set(c.participantIds).size!==c.participantIds.length||c.participantIds.some(id=>!bots.has(id))||c.participantIds[0]!==c.botId))return false;
    if(c.inactiveTeamMember!==undefined&&(typeof c.inactiveTeamMember!=='boolean'||!c.parentThreadId))return false;
    if(c.parentThreadId!==undefined&&!s.conversations.some(root=>root.id===c.parentThreadId&&(c.inactiveTeamMember===true||root.participantIds?.includes(c.botId))))return false;
    conversations.add(c.id);
    const ids = new Set();
    for (const m of c.messages) {
      if (!m || typeof m.id !== 'string' || ids.has(m.id) || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !['complete', 'streaming', 'error', 'cancelled'].includes(m.status) || !Number.isFinite(m.createdAt)) return false;
      ids.add(m.id);
      if (m.modelContent !== undefined && typeof m.modelContent !== 'string') return false;
    }
  }
  if (!bots.size) return s.conversations.length === 0 && s.activeBotId === null && s.activeConversationId === null;
  return bots.has(s.activeBotId) && s.conversations.some(c => c.id === s.activeConversationId && c.botId === s.activeBotId);
}

export class JsonStore {
  constructor(dataDir) {
    if (typeof dataDir !== 'string' || !dataDir) throw new Error('An explicit data directory is required.');
    this.directory = resolve(dataDir);
    this.path = join(this.directory, 'workspace.json');
    this.queue = Promise.resolve();
  }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let raw;
    try { raw = await readFile(this.path, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; const state = initialState(); await this.save(state); return state; }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('Saved workspace is unreadable. The existing file has been preserved.'); }
    if (!validState(state)) throw new Error('Saved workspace has an unsupported format. The existing file has been preserved.');
    return state;
  }
  save(state) {
    if (!validState(state)) return Promise.reject(new Error('Refusing to persist invalid workspace data.'));
    const json = JSON.stringify(state, null, 2) + '\n';
    const task = this.queue.then(async () => {
      const temp = join(this.directory, `.workspace-${randomUUID()}.tmp`);
      try { await writeFile(temp, json, { flag: 'wx', mode: 0o600 }); await rename(temp, this.path); }
      finally { await unlink(temp).catch(() => {}); }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async flush() { await this.queue; }
}
