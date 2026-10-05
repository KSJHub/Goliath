'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');

const SECTIONS = new Set(['home','roles','security','intelligence','flow','messages','logs','settings']);
const ROLE_TYPES = ['pending','verifying','verified','auto','bot','bypass','quarantine','staff'];
const SECURITY = [
  ['simple','Simple Verify'],['captcha','CAPTCHA'],['minigame','Mini Games'],['accountAge','Account Age'],
  ['discordScreening','Discord Screening'],['botProtection','Bot Protection'],['staffApproval','Staff Approval'],
  ['oneTimeChallenge','One-Time Challenge'],['riskBased','Risk-Based Security'],['rejoinHistory','Rejoin History'],
];
const LOG_TYPES = ['join','intelligence','attempt','failure','success','roles','bot','raid','quarantine','staff','error'];
const sessions = new Map();

function row(...items){ return new ActionRowBuilder().addComponents(...items.filter(Boolean)); }
function button(id,label,style=ButtonStyle.Secondary,disabled=false){ return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function toggleButton(id,label,on){ return button(id,`${on?'🟢':'🔴'} ${label}`,on?ButtonStyle.Success:ButtonStyle.Danger); }
function requestedBy(i){ return i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User'; }
function stateFor(i){ const key=`${i.guildId}:${i.user.id}`; const value=sessions.get(key)||{roleType:'pending',logType:'join'}; sessions.set(key,value); return value; }
function status(guildId){ return verificationManager.getVerificationStatus(guildId); }
function settings(guildId){ return status(guildId).settings || verificationStore.defaultSettings(); }
function save(guildId, patch, actorId){ return verificationManager.updateVerificationSettings(guildId, patch, {actorId,action:'verification_admin_update'}); }
function embed(title,lines,who,color=0x5865F2){ return new EmbedBuilder().setColor(color).setTitle(title).setDescription(lines.filter(Boolean).join('\n').slice(0,4096)).setFooter({text:`Requested by ${who}`}).setTimestamp(); }
function roleText(guild,ids=[]){ return ids.length ? ids.map(id=>guild.roles.cache.has(id)?`<@&${id}>`:`Unknown (${id})`).join(', ') : '`Not set`'; }
function channelText(id){ return id?`<#${id}>`:'`Not set`'; }
function finalNav(back='home'){ return row(button(`admin:verification:page:${back}`,'◀ Back'),button('admin:verification:page:settings','⚙️ Settings')); }
function pageButtons(){ return [
  row(button('admin:verification:page:roles','🎭 Roles'),button('admin:verification:page:security','🛡️ Security'),button('admin:verification:page:intelligence','🧠 Intelligence'),button('admin:verification:page:flow','🚪 Flow')),
  row(button('admin:verification:page:messages','💬 Messages'),button('admin:verification:page:logs','📋 Logs'),button('admin:verification:page:settings','⚙️ Settings')),
]; }

function homePage(guild,who){ const s=status(guild.id), c=s.settings; const enabled=guildManager.isModuleEnabled(guild.id,'verification'); const methods=(c.flow?.orderedSecurity||[]).join(' → ')||'Simple Verify'; return {embeds:[embed('🛡️ Verification · Front Door',[
  '**Universal, modular server verification and entry security.**','',
  `**Module:** ${enabled?'Enabled ✅':'Disabled ❌'}`,
  `**Journey:** NEW MEMBER → PENDING → VERIFYING → VERIFIED → SERVER`,
  `**Security Flow:** ${methods}`,
  `**Intelligence:** ${c.intelligence?.enabled?'Enabled 🧠':'Disabled'}`,
  `**Failed attempts before action:** ${c.security?.maximumFailedAttempts ?? 5}`,
  `**Verified:** ${s.analytics?.verified||0} · **Failed:** ${s.analytics?.failed||0} · **Quarantined:** ${s.analytics?.quarantined||0}`,
],who,enabled?0x57F287:0x5865F2)],components:pageButtons()}; }

function rolesPage(guild,who,st){ const c=settings(guild.id), type=ROLE_TYPES.includes(st.roleType)?st.roleType:'pending'; const menu=new StringSelectMenuBuilder().setCustomId('admin:verification:roleType').setPlaceholder('Choose role category').addOptions(ROLE_TYPES.map(x=>({label:x[0].toUpperCase()+x.slice(1),value:x,default:x===type}))); const selector=new RoleSelectMenuBuilder().setCustomId(`admin:verification:roles:${type}`).setPlaceholder(`Select ${type} role(s)`).setMinValues(0).setMaxValues(10); const lines=ROLE_TYPES.map(x=>`**${x[0].toUpperCase()+x.slice(1)}:** ${roleText(guild,c.roles?.[x]||[])}`); return {embeds:[embed('🎭 Verification · Roles',lines,who)],components:[row(menu),row(selector),finalNav()]}; }

function securityPage(guild,who){ const c=settings(guild.id), sec=c.security||{}; const enabled=SECURITY.filter(([k])=>sec[k]===true).map(([,n])=>n); return {embeds:[embed('🛡️ Verification · Security',[
  'Enable one security method or stack multiple methods. Flow controls their execution order.','',
  `**Active:** ${enabled.join(' · ')||'None ⚠️'}`,
  `**Maximum failed attempts:** ${sec.maximumFailedAttempts??5}`,
  `**Cooldown:** ${sec.attemptCooldownSeconds??10}s`,
  `**Quarantine at limit:** ${sec.quarantineOnLimit!==false?'Yes ✅':'No'}`,
],who)],components:[
  row(...SECURITY.slice(0,5).map(([k,n])=>toggleButton(`admin:verification:security:${k}`,n,sec[k]===true))),
  row(...SECURITY.slice(5,10).map(([k,n])=>toggleButton(`admin:verification:security:${k}`,n,sec[k]===true))),
  finalNav(),
]}; }

function intelligencePage(guild,who){ const c=settings(guild.id), intel=c.intelligence||{}; return {embeds:[embed('🧠 Verification · Intelligence',[
  'Intelligence is the optional Auto Scan layer. It observes and flags; enforcement remains configurable.','',
  `**Auto Scan:** ${intel.enabled?'ON ✅':'OFF'}`,
  `**Initial scan:** ${intel.initialScan?'ON':'OFF'}`,
  `**Continuous scan:** ${intel.continuousScan?'ON':'OFF'}`,
  `**Rescan interval:** ${intel.rescanMinutes||1440} minutes`,
  `**Flag logging:** ${intel.logFlags!==false?'ON':'OFF'}`,
],who)],components:[
  row(toggleButton('admin:verification:intelligence:enabled','Auto Scan',intel.enabled),toggleButton('admin:verification:intelligence:initialScan','Initial Scan',intel.initialScan),toggleButton('admin:verification:intelligence:continuousScan','Continuous Scan',intel.continuousScan)),
  row(toggleButton('admin:verification:intelligence:logFlags','Flag Logs',intel.logFlags!==false),toggleButton('admin:verification:intelligence:logErrors','Error Logs',intel.logErrors!==false)),
  finalNav(),
]}; }

function flowPage(guild,who){ const c=settings(guild.id), flow=c.flow||{}, order=flow.orderedSecurity||[]; const options=SECURITY.map(([key,name])=>({label:name,value:key,default:order.includes(key)})); const menu=new StringSelectMenuBuilder().setCustomId('admin:verification:flowSecurity').setPlaceholder('Choose security layers used by this guild').setMinValues(1).setMaxValues(options.length).addOptions(options); return {embeds:[embed('🚪 Verification · Flow',[
  '**Lifecycle:** NEW MEMBER → PENDING → VERIFYING → VERIFIED → SERVER','',
  `**Required security:** ${order.length?order.map((x,i)=>`${i+1}. ${SECURITY.find(([k])=>k===x)?.[1]||x}`).join(' → '):'None ⚠️'}`,
  `**Fail closed:** ${flow.failClosed!==false?'Yes ✅':'No ⚠️'}`,
  `**Reset active journey on leave:** ${flow.resetActiveSessionOnLeave!==false?'Yes':'No'}`,
  `**Retain security history:** ${flow.retainSecurityHistory!==false?'Yes':'No'}`,
  '', 'Selected layers execute in the stored order. Security settings remain independent and modular.',
],who)],components:[row(menu),row(toggleButton('admin:verification:flow:failClosed','Fail Closed',flow.failClosed!==false),toggleButton('admin:verification:flow:resetActiveSessionOnLeave','Reset Journey On Leave',flow.resetActiveSessionOnLeave!==false),toggleButton('admin:verification:flow:retainSecurityHistory','Retain History',flow.retainSecurityHistory!==false)),finalNav()]}; }

function messagesPage(guild,who){ const m=status(guild.id).messages||{}; return {embeds:[embed('💬 Verification · Messages',[
  'Verification owns its own member-facing messages. Embed Studio is not used by this module.','',
  `**Start:** ${m.start||'Not set'}`,
  `**Success:** ${m.success||'Not set'}`,
  `**Failure:** ${m.failed||'Not set'}`,
  `**Retry:** ${m.retry||'Not set'}`,
  `**Quarantine:** ${m.quarantined||'Not set'}`,
  '', 'Message editing controls will remain inside Verification.',
],who)],components:[row(button('admin:verification:resetMessages','↺ Reset Verification Messages',ButtonStyle.Danger)),finalNav()]}; }

function logsPage(guild,who,st){ const c=settings(guild.id), type=LOG_TYPES.includes(st.logType)?st.logType:'join'; const menu=new StringSelectMenuBuilder().setCustomId('admin:verification:logType').setPlaceholder('Choose log category').addOptions(LOG_TYPES.map(x=>({label:x[0].toUpperCase()+x.slice(1),value:x,default:x===type}))); const channel=new ChannelSelectMenuBuilder().setCustomId(`admin:verification:logChannel:${type}`).setPlaceholder(`Choose ${type} log channel`).setMinValues(0).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement); return {embeds:[embed('📋 Verification · Logs',[
  'Each Verification event can use its own channel or several categories can share one destination.','',
  ...LOG_TYPES.map(x=>`**${x[0].toUpperCase()+x.slice(1)}:** ${channelText(c.logs?.[`${x}ChannelId`])}`),
],who)],components:[row(menu),row(channel),finalNav()]}; }

function settingsPage(guild,who){ const c=settings(guild.id), enabled=guildManager.isModuleEnabled(guild.id,'verification'); return {embeds:[embed('⚙️ Verification · Settings',[
  `**Module:** ${enabled?'Enabled ✅':'Disabled ❌'}`,
  `**Re-verification:** ${c.security?.allowReverification!==false?'Allowed':'Disabled'}`,
  `**Maximum failed attempts:** ${c.security?.maximumFailedAttempts??5}`,
  `**Attempt cooldown:** ${c.security?.attemptCooldownSeconds??10}s`,
  `**Raid protection:** ${c.raid?.enabled!==false?'Enabled':'Disabled'}`,
  `**Quarantine:** ${c.quarantine?.enabled!==false?'Enabled':'Disabled'}`,
  `**Test mode:** ${c.health?.testMode?'Enabled':'Disabled'}`,
],who)],components:[
  row(enabled?button('admin:verification:disable','🔴 Disable Verification',ButtonStyle.Danger):button('admin:verification:enable','🟢 Enable Verification',ButtonStyle.Success),button('admin:verification:test','🩺 Health Check',ButtonStyle.Primary)),
  row(toggleButton('admin:verification:settings:raid','Raid Protection',c.raid?.enabled!==false),toggleButton('admin:verification:settings:quarantine','Quarantine',c.quarantine?.enabled!==false),toggleButton('admin:verification:settings:testMode','Test Mode',c.health?.testMode===true)),
  finalNav('home'),
]}; }

function buildVerificationAdminPanel(guild,who='Unknown User',section='home',state={}){ const page=SECTIONS.has(section)?section:'home'; if(page==='roles')return rolesPage(guild,who,state); if(page==='security')return securityPage(guild,who); if(page==='intelligence')return intelligencePage(guild,who); if(page==='flow')return flowPage(guild,who); if(page==='messages')return messagesPage(guild,who); if(page==='logs')return logsPage(guild,who,state); if(page==='settings')return settingsPage(guild,who); return homePage(guild,who); }
async function respond(i,payload){ if(i.deferred||i.replied)return i.editReply(payload); return i.update(payload); }

async function handleVerificationAdminInteraction(i){
  const id=String(i.customId||''); if(!id.startsWith('admin:verification:'))return false;
  const who=requestedBy(i), st=stateFor(i);
  try{
    if(id.startsWith('admin:verification:page:')){ const page=id.slice('admin:verification:page:'.length); return await respond(i,buildVerificationAdminPanel(i.guild,who,page,st)),true; }
    if(id==='admin:verification:roleType'){ st.roleType=i.values?.[0]||'pending'; return await respond(i,rolesPage(i.guild,who,st)),true; }
    if(id.startsWith('admin:verification:roles:')){ const type=id.slice('admin:verification:roles:'.length); if(!ROLE_TYPES.includes(type))throw new Error('Unknown Verification role category.'); const c=settings(i.guildId), roles={...(c.roles||{}),[type]:[...new Set(i.values||[])]}; save(i.guildId,{roles},i.user.id); st.roleType=type; return await respond(i,rolesPage(i.guild,who,st)),true; }
    if(id.startsWith('admin:verification:security:')){ const key=id.slice('admin:verification:security:'.length); if(!SECURITY.some(([k])=>k===key))throw new Error('Unknown security method.'); const c=settings(i.guildId), security={...(c.security||{}),[key]:!(c.security?.[key]===true)}; save(i.guildId,{security},i.user.id); return await respond(i,securityPage(i.guild,who)),true; }
    if(id.startsWith('admin:verification:intelligence:')){ const key=id.slice('admin:verification:intelligence:'.length); const c=settings(i.guildId), intelligence={...(c.intelligence||{}),[key]:!(c.intelligence?.[key]===true)}; save(i.guildId,{intelligence},i.user.id); return await respond(i,intelligencePage(i.guild,who)),true; }
    if(id==='admin:verification:flowSecurity'){ const c=settings(i.guildId); const selected=[...new Set(i.values||[])]; const flow={...(c.flow||{}),orderedSecurity:selected}; const security={...(c.security||{})}; for(const [key] of SECURITY) security[key]=selected.includes(key); save(i.guildId,{flow,security},i.user.id); return await respond(i,flowPage(i.guild,who)),true; }
    if(id.startsWith('admin:verification:flow:')){ const key=id.slice('admin:verification:flow:'.length), c=settings(i.guildId), flow={...(c.flow||{}),[key]:!(c.flow?.[key]===true)}; save(i.guildId,{flow},i.user.id); return await respond(i,flowPage(i.guild,who)),true; }
    if(id==='admin:verification:logType'){ st.logType=i.values?.[0]||'join'; return await respond(i,logsPage(i.guild,who,st)),true; }
    if(id.startsWith('admin:verification:logChannel:')){ const type=id.slice('admin:verification:logChannel:'.length); if(!LOG_TYPES.includes(type))throw new Error('Unknown log category.'); const c=settings(i.guildId), logs={...(c.logs||{}),[`${type}ChannelId`]:i.values?.[0]||null}; save(i.guildId,{logs},i.user.id); st.logType=type; return await respond(i,logsPage(i.guild,who,st)),true; }
    if(id==='admin:verification:enable'||id==='admin:verification:disable'){ guildManager.setModuleEnabled(i.guildId,'verification',id.endsWith(':enable'),{actorId:i.user.id,action:'verification_admin_toggle'}); return await respond(i,settingsPage(i.guild,who)),true; }
    if(id==='admin:verification:settings:raid'){ const c=settings(i.guildId); save(i.guildId,{raid:{...(c.raid||{}),enabled:c.raid?.enabled===false}},i.user.id); return await respond(i,settingsPage(i.guild,who)),true; }
    if(id==='admin:verification:settings:quarantine'){ const c=settings(i.guildId); save(i.guildId,{quarantine:{...(c.quarantine||{}),enabled:c.quarantine?.enabled===false}},i.user.id); return await respond(i,settingsPage(i.guild,who)),true; }
    if(id==='admin:verification:settings:testMode'){ const c=settings(i.guildId); save(i.guildId,{health:{...(c.health||{}),testMode:!(c.health?.testMode===true)}},i.user.id); return await respond(i,settingsPage(i.guild,who)),true; }
    if(id==='admin:verification:test'){ const report=await verificationManager.buildHealthReport(i.guild); await i.reply({content:report.warnings?.length?`⚠️ Verification health:\n${report.warnings.map(x=>`• ${x}`).join('\n')}`:'✅ Verification setup looks healthy.',flags:64}); return true; }
    if(id==='admin:verification:resetMessages'){ verificationManager.updateVerificationMessages(i.guildId,verificationStore.defaultMessages(),{actorId:i.user.id,action:'verification_messages_reset'}); return await respond(i,messagesPage(i.guild,who)),true; }
    return false;
  }catch(error){ const payload={content:`❌ Verification setup failed: ${error.message}`,flags:64}; if(i.deferred||i.replied)await i.followUp(payload).catch(()=>null); else await i.reply(payload).catch(()=>null); return true; }
}

module.exports={buildVerificationAdminPanel,handleVerificationAdminInteraction};
