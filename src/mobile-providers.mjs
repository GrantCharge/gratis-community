import {getClaudeStatus} from './claude-backend.mjs';
import {getCodexStatus,getCodexModels} from './codex-client.mjs';

const claudeModels = ['haiku','sonnet','opus'].map(id=>({id,name:id[0].toUpperCase()+id.slice(1),defaultEffort:'medium'}));
// Custom providers can list hundreds of models; the phone gets a short, stable list:
// the routing aliases and the models already chosen first, then the rest alphabetically.
const PHONE_CUSTOM_MODELS=30;
export const phoneProviderId=settings=>settings.provider==='custom'?`custom:${settings.customProviderId}`:settings.provider;
export class MobileProviders {
  constructor({claudeStatus=getClaudeStatus,codexStatus=getCodexStatus,codexModels=getCodexModels,customProviders=null,settings=()=>({}),onChange=()=>{}}={}) {
    Object.assign(this,{claudeStatus,codexStatus,codexModels,customProviders,settings,onChange});
    this.catalog=[];this.updated=0;this.pending=null;
  }
  snapshot(){if(Date.now()-this.updated>300000)void this.refresh().catch(()=>{});return this.catalog;}
  async customCatalog(force){
    if(!this.customProviders)return [];
    const settings=this.settings()||{},remembered=settings.providerDefaults||{};
    return Promise.all(this.customProviders.snapshot().map(async p=>{
      const keep=new Set([remembered[`custom:${p.id}`]?.model,settings.provider==='custom'&&settings.customProviderId===p.id?settings.model:undefined].filter(Boolean));
      try{const all=await this.customProviders.models(p.id,{force});const picked=[...all.filter(m=>keep.has(m.id)),...all.filter(m=>!keep.has(m.id))].slice(0,PHONE_CUSTOM_MODELS);
        return{id:`custom:${p.id}`,name:p.label,custom:true,signedIn:true,models:picked.map(m=>({id:m.id,name:m.name,defaultEffort:'medium'})),...(all.length>picked.length?{more:all.length-picked.length}:{})};}
      catch{return{id:`custom:${p.id}`,name:p.label,custom:true,signedIn:false,models:[]};}
    }));
  }
  async refresh(force=false){
    if(this.pending)return this.pending;
    if(!force&&Date.now()-this.updated<300000)return this.catalog;
    this.pending=(async()=>{
      const [claude,codex,custom]=await Promise.all([this.claudeStatus(),this.codexStatus(),this.customCatalog(force)]);
      let models=[];
      if(codex.signedIn)try{models=await this.codexModels();}catch{}
      this.catalog=[{id:'claude',name:'Claude',signedIn:!!claude.signedIn,models:claudeModels},
        {id:'codex',name:'Codex',signedIn:!!codex.signedIn,models:models.map(m=>({id:m.id,name:m.name,isDefault:m.isDefault,defaultEffort:m.defaultEffort,efforts:m.efforts}))},...custom];
      this.updated=Date.now();this.onChange();return this.catalog;
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async select(service,{conversationId,provider,model}){
    const c=service._conversation(conversationId);
    if(c.parentThreadId)throw new Error('Choose the main conversation.');
    if(service.teams.busy(c))throw new Error('Wait for this reply to finish before changing models.');
    const available=(await this.refresh(true)).find(p=>p.id===provider);
    if(!available)throw new Error('This provider was removed on your desktop. Reopen the model picker to refresh it.');
    if(!available.signedIn)throw new Error(available.custom?`${available.name} is not reachable from your desktop right now.`:`Sign in to ${provider==='claude'?'Claude Code':'Codex'} on your desktop first.`);
    let chosen=available.models.find(m=>m.id===model);
    // A model trimmed from the phone list is still valid if the provider offers it.
    if(!chosen&&available.custom)chosen=(await this.customProviders.models(provider.slice(7))).find(m=>m.id===model);
    if(!chosen)throw new Error('This model is not available. Reopen the model picker to refresh it.');
    if(available.custom){
      const {customProviderId,...rest}=service.state.settings;
      await service.updateSettings({...rest,provider:'custom',customProviderId:provider.slice(7),model,effort:'medium'});
      return c.id;
    }
    const remembered=service.state.settings.providerDefaults?.[provider]?.effort;
    const effort=provider==='claude'?'medium':chosen.efforts?.includes(remembered)?remembered:chosen.defaultEffort||'medium';
    const {customProviderId,...rest}=service.state.settings;
    await service.updateSettings({...rest,provider,model,effort});
    await service.updateBot({id:c.botId,...(provider==='claude'?{model}:{codexModel:model})});
    return c.id;
  }
}
