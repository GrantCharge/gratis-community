const { contextBridge, ipcRenderer } = require('electron');
const api = {};
async function invoke(channel, value) {
  try { return await ipcRenderer.invoke(channel, value); }
  catch (error) { throw new Error(String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')); }
}
for (const name of ['snapshot','createBot','deleteBot','selectBot','newConversation','selectConversation','setDraft',
  'createThread','renameThread','updateThreadMembers','pinThread','deleteThread','updateSettings','updateBot','duplicateBot','respondApproval', 'updateQueue','send','stop','retry']) api[name] = value => invoke('orbit:' + name, value);
api.edition = () => invoke('orbit:edition');
api.pickImage = options => invoke('orbit:pick-image', options);
api.openExternal = value => invoke('orbit:open-external', value);
api.copyText = value => invoke('orbit:copy-text', value);
api.botMenu = value => invoke('orbit:bot-menu', value);
api.threadMenu = value => invoke('orbit:thread-menu', value);
api.exportImage = data => invoke('orbit:export-image', data);
api.exportData = kind => invoke('orbit:export-data', kind);
api.workspaceFullscreen = enabled=>invoke('orbit:workspace-fullscreen',enabled);
api.onWorkspaceFullscreen = cb=>{const listener=(_e,value)=>cb(value);ipcRenderer.on('orbit:workspace-fullscreen',listener);return()=>ipcRenderer.removeListener('orbit:workspace-fullscreen',listener);};
api.watchComputer = value=>invoke('orbit:computer-watch',value);
api.computerControl = value=>invoke('orbit:computer-control',value);
api.codexStatus = () => invoke('orbit:codex-status');
api.codexModels = () => invoke('orbit:codex-models');
api.claudeStatus = () => invoke('orbit:claude-status');
api.microphonePermission = () => invoke('orbit:microphone-permission');
api.transcribeAudio = value => invoke('orbit:transcribe-audio', value);
api.cancelTranscription = () => invoke('orbit:cancel-transcription');
api.onVoiceProgress = cb => { const listener = (_e, value) => cb(value); ipcRenderer.on('orbit:voice-progress', listener); return () => ipcRenderer.removeListener('orbit:voice-progress', listener); };
api.systemDark = () => invoke('orbit:theme');
api.onState = cb => { const listener = (_e, value) => cb(value); ipcRenderer.on('orbit:state', listener); return () => ipcRenderer.removeListener('orbit:state', listener); };
for(const name of ['view','search','add','edit','confirm','forget','retry','enable','export'])api['memory'+name[0].toUpperCase()+name.slice(1)]=value=>invoke('orbit:memory-'+name,value);
api.onMemoryChanged=cb=>{const listener=(_e,value)=>cb(value);ipcRenderer.on('orbit:memory-changed',listener);return()=>ipcRenderer.removeListener('orbit:memory-changed',listener);};
api.onTheme = cb => { const listener = (_e, value) => cb(value); ipcRenderer.on('orbit:theme', listener); return () => ipcRenderer.removeListener('orbit:theme', listener); };
api.onClosing = cb => { ipcRenderer.on('orbit:closing', cb); };
api.readyToClose = () => invoke('orbit:ready-to-close');
for(const [name,channel] of Object.entries({signInStart:'signin-start',signInState:'signin-state',signInCancel:'signin-cancel',signInOpen:'signin-open',connections:'connections',configureConnections:'configure-connections',connectionCatalog:'connection-catalog',connectApp:'connect-app',cloudHealth:'cloud-health',computerFrame:'computer-frame',computerState:'computer-state',startComputer:'computer-start',computerAction:'computer-action',stopComputer:'computer-stop',files:'files',attachFiles:'attach-files',removeAttachment:'remove-attachment',exportFile:'export-file'}))api[name]=value=>invoke('orbit:'+channel,value);
api.onComputerFrame=cb=>{const listener=(_e,value)=>cb(value);ipcRenderer.on('orbit:computer-frame',listener);return()=>ipcRenderer.removeListener('orbit:computer-frame',listener);};



api.onComputerState=cb=>{const listener=(_e,value)=>cb(value);ipcRenderer.on('orbit:computer-state',listener);return()=>ipcRenderer.removeListener('orbit:computer-state',listener);};
api.onSignInState=cb=>{const listener=(_e,value)=>cb(value);ipcRenderer.on('orbit:signin-state',listener);return()=>ipcRenderer.removeListener('orbit:signin-state',listener);};
api.onConnectionsChanged=cb=>{const listener=()=>cb();ipcRenderer.on('orbit:connections-changed',listener);return()=>ipcRenderer.removeListener('orbit:connections-changed',listener);};
for(const name of ['view','connect','rename','remove','local','options','threads','project','bind','submit','refresh','retry','stop','send','open'])api['t3'+name[0].toUpperCase()+name.slice(1)]=value=>invoke('orbit:t3-'+name,value);
api.onT3Changed=cb=>{const listener=()=>cb();ipcRenderer.on('orbit:t3-changed',listener);return()=>ipcRenderer.removeListener('orbit:t3-changed',listener);};
for(const name of ['view','create','update','remove','run'])api['schedules'+name[0].toUpperCase()+name.slice(1)]=value=>invoke('orbit:schedules-'+name,value);
api.onSchedulesChanged=cb=>{const listener=()=>cb();ipcRenderer.on('orbit:schedules-changed',listener);return()=>ipcRenderer.removeListener('orbit:schedules-changed',listener);};
for(const name of ['status','configure','connect','confirm','disconnect','qr'])api[name==='qr'?'mobileQR':'mobile'+name[0].toUpperCase()+name.slice(1)]=value=>invoke('orbit:mobile-'+name,value);
api.onMobileChanged=cb=>{const listener=()=>cb();ipcRenderer.on('orbit:mobile-changed',listener);return()=>ipcRenderer.removeListener('orbit:mobile-changed',listener);};
contextBridge.exposeInMainWorld('orbit', api);
