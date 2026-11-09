import {validatePhoneComputer,validatePhoneSettings} from '../../../src/mobile-controls.mjs';
export interface MobileCommand {
  settings?:{displayName?:string;profileAvatarDataUrl?:string|null;appearance?:"system"|"dark"|"light"};
  computer?:{operation:"open"|"keepalive"|"close"|"refresh"|"restart"|"stop"|"control"|"input";human?:boolean;revision?:number;inputs?:{name:string;args:Record<string,unknown>}[]};
  seq: number;
  kind: "select" | "new" | "send" | "stop" | "model" | "providers" | "voice" | "voice-cancel" | "profile" | "edit-bot" | "create-bot" | "attach" | "preferences" | "delete-bot" | "delete-thread" | "computer" | "user-settings";
  conversationId?: string;
  text?: string;
  provider?: string;
  model?: string;
  audioBase64?: string;
  mimeType?: string;
  requestId?: string;
  send?: boolean;
  botId?: string;
  profile?: {name?:string;avatarShape?:string;avatarColor?:string;avatarDataUrl?:string|null;pinned?:boolean};
  file?: {name:string;base64:string};
  preferences?: {appearance:"system"|"light"|"dark"};
}
export function parseMobileCommand(raw: unknown): MobileCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid mobile command");
  const v = raw as Record<string, unknown>;
  const unknown = Object.keys(v).find(k => !["seq", "kind", "conversationId", "text", "provider", "model", "audioBase64", "mimeType", "requestId", "send", "profile", "botId", "file", "preferences", "computer", "settings"].includes(k));
  if (unknown) throw new Error("Unknown command field: " + unknown.slice(0,60));
  if (!Number.isSafeInteger(v.seq) || Number(v.seq) < 1 || Number(v.seq) >= Number.MAX_SAFE_INTEGER) throw new Error("Invalid command sequence");
  if (!["select", "new", "send", "stop", "model", "providers", "voice", "voice-cancel", "profile", "edit-bot", "create-bot", "attach", "preferences", "delete-bot", "delete-thread", "computer", "user-settings"].includes(String(v.kind))) throw new Error("Unsupported mobile command");
  if (v.conversationId !== undefined && (typeof v.conversationId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(v.conversationId))) throw new Error("Invalid conversation");
  if (v.text !== undefined && (typeof v.text !== "string" || !v.text.trim() || v.text.length > 6000)) throw new Error("Invalid message");
  if (!["new","create-bot"].includes(String(v.kind)) && !v.conversationId) throw new Error("Choose a conversation");
  if (v.kind === "send" && !v.text) throw new Error("Enter a message");
  if(v.kind === "model") {
    const custom=/^custom:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(String(v.provider));
    if((!["claude","codex"].includes(String(v.provider))&&!custom) || typeof v.model !== "string" || !(custom?/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/:/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/).test(v.model)) throw new Error("Choose a valid provider model");
  } else if(v.provider !== undefined || v.model !== undefined) throw new Error("Unexpected model settings");
  if(v.kind === "voice" || v.kind === "voice-cancel") {
    if(typeof v.requestId !== "string" || !/^[-a-f0-9]{36}$/i.test(v.requestId)) throw new Error("Invalid recording");
    if(v.kind === "voice" && (typeof v.audioBase64 !== "string" || !v.audioBase64.length || v.audioBase64.length > 1400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.audioBase64) || typeof v.mimeType !== "string" || !/^audio\/(mp4|webm|ogg|wav)(;.*)?$/.test(v.mimeType) || typeof v.send !== "boolean")) throw new Error("Use a shorter recording");
  } else if(v.audioBase64 !== undefined || v.mimeType !== undefined || v.requestId !== undefined || v.send !== undefined) throw new Error("Unexpected recording fields");
  if(v.profile!==undefined){
    if(!["edit-bot","create-bot"].includes(String(v.kind))||!v.profile||typeof v.profile!=="object"||Array.isArray(v.profile))throw new Error("Invalid agent profile");
    const p=v.profile as Record<string,unknown>;
    if(Object.keys(p).some(k=>!["name","avatarShape","avatarColor","avatarDataUrl","pinned"].includes(k)))throw new Error("Invalid profile field");
    if(p.pinned!==undefined&&typeof p.pinned!=="boolean")throw new Error("Invalid pin setting");
    if(p.name!==undefined&&(typeof p.name!=="string"||!p.name.trim()||p.name.length>120))throw new Error("Enter an agent name");
    if(p.avatarShape!==undefined&&!["blob","cloud","square","sparkle","clover","heart","flower","teardrop","tablet","wedge","house","star","hex","sphere","capsule","pebble","squircle","heartChubby","starFlower","star6"].includes(String(p.avatarShape)))throw new Error("Invalid shape");
    if(p.avatarColor!==undefined&&!["black","brown","red","orange","yellow","green","cyan","blue","violet","magenta","gray"].includes(String(p.avatarColor)))throw new Error("Invalid color");
    if(p.avatarDataUrl!==undefined&&p.avatarDataUrl!==null&&(typeof p.avatarDataUrl!=="string"||p.avatarDataUrl.length>1400000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.avatarDataUrl)))throw new Error("Invalid photo");
  }else if(["edit-bot","create-bot"].includes(String(v.kind)))throw new Error("Enter an agent profile");
  if(v.botId!==undefined&&(v.kind!=="new"||typeof v.botId!=="string"||!/^[-a-f0-9]{36}$/i.test(v.botId)))throw new Error("Invalid agent");
  if(v.kind==="attach"){
    const f=v.file as Record<string,unknown>;
    if(!f||typeof f!=="object"||Object.keys(f).some(k=>!["name","base64"].includes(k))||typeof f.name!=="string"||f.name.length>120||typeof f.base64!=="string"||f.base64.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64))throw new Error("Use a file under 1 MB");
  }else if(v.file!==undefined)throw new Error("Unexpected attachment");
  if(v.kind==="preferences"){const p=v.preferences as Record<string,unknown>;if(!p||Object.keys(p).some(k=>k!=="appearance")||!["system","light","dark"].includes(String(p.appearance)))throw new Error("Invalid preferences");}else if(v.preferences!==undefined)throw new Error("Unexpected preferences");
  if(v.kind==="computer")validatePhoneComputer(v.computer);else if(v.computer!==undefined)throw new Error("Unexpected computer control");
  if(v.kind==="user-settings")validatePhoneSettings(v.settings);else if(v.settings!==undefined)throw new Error("Unexpected settings");
  return {...(v.computer?{computer:v.computer as MobileCommand["computer"]}:{}),...(v.settings?{settings:v.settings as MobileCommand["settings"]}:{}),...(v.preferences?{preferences:v.preferences as MobileCommand["preferences"]}:{}),...(v.botId?{botId:v.botId as string}:{}),...(v.profile?{profile:v.profile as MobileCommand["profile"]}:{}),...(v.file?{file:v.file as MobileCommand["file"]}:{}),seq: Number(v.seq), kind: v.kind as MobileCommand["kind"], ...(typeof v.conversationId === "string" ? {conversationId: v.conversationId} : {}), ...(typeof v.text === "string" ? {text: v.text.trim()} : {}), ...(v.kind === "model" ? {provider:v.provider as string, model:v.model as string}: {}), ...((v.kind === "voice" || v.kind === "voice-cancel") ? {requestId:v.requestId as string}: {}), ...(v.kind === "voice" ? {audioBase64:v.audioBase64 as string,mimeType:v.mimeType as string,send:v.send as boolean}: {})};
}
export const mobileCommandSchema = { parse: parseMobileCommand };
export interface MobileBot {id:string;name:string;avatarShape:string;avatarColor:string;choiceShape:string;choiceColor:string;photo:boolean;pinned:boolean}
export interface MobileSnapshot {
  userProfile?:{name:string};
  avatars?: Record<string,string>;
  preferences?:{appearance:string};
  home?: MobileSnapshot["conversations"];
  bots?: MobileBot[];
  conversations: { id: string; botId?: string; title: string; status: string; provider: string; avatarShape?: string; avatarColor?: string; botName?: string; preview?: string; pinned?:boolean;choiceColor?:string;group?: boolean;members?:MobileBot[] }[];
  providers?: {id:string;name:string;signedIn:boolean;models:{id:string;name:string;isDefault?:boolean;defaultEffort?:string;efforts?:string[]}[]}[];
  voice?: {id:string;phase:string;text?:string;error?:string;send?:boolean};
  selected?: { computerView?:{state:{status:string;control:string;controlRevision:number;error?:string;live?:boolean};frame?:{dataUrl:string;width:number;height:number;at:number};clipboard?:string|null};botId?:string;bot?:MobileBot;attachments?:{name:string;bytes:number}[];details?:{files:{name:string;bytes:number;path:string}[];routines:{id:string;title:string;enabled:boolean;nextRunAt?:number}[];computer:string};id: string; title: string; status: string; provider: string; model?: string; messages: { id: string; role: string; content: string; question?: {options:string[];custom:boolean}; provider?: string; model?: string; createdAt?: number; status?: string; speaker?: string }[]; queued: number; computer: boolean; group?: boolean; truncated?: boolean; browserUrl?: string };
}
export interface MobileStatus {
  paired: boolean; claimed: boolean; confirmed: boolean; inviteUrl?: string; error?: string;
}
export interface MobileReceipt { seq: number; ok: boolean; detail: string }
export interface MobileExchange { claimed: boolean; confirmed: boolean; revoked?: boolean; needsSnapshot?: boolean; command?: MobileCommand }
