const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, PermissionFlagsBits,
} = require('discord.js');

const guildManager = require('../../guild/guildManager');
const panelNav = require('../../ui/panelNavigation');
const restoreRequestManager = require('../../security/restoreRequestManager');
const security = require('../../security/securityCore');
const { createServerBackup, listServerBackups, readServerBackup, validateServerBackup } = require('../../security/serverBackup');

const PANEL_COLOR = '#5865F2';
const ENABLED_COLOR = '#57F287';
const DISABLED_COLOR = '#ED4245';

const LOG_TYPES = {
  automodlog: { key:'automod', customId:'admin:setautomodlog', selectId:'admin:selectautomodlog', title:'🤖 Set AutoMod Log Channel', label:'🤖 AutoMod Log' },
  adminlog: { key:'admin', customId:'admin:setadminlog', selectId:'admin:selectadminlog', title:'👑 Set Admin Log Channel', label:'👑 Admin Log' },
  modlog: { key:'moderation', customId:'admin:setmodlog', selectId:'admin:selectmodlog', title:'📌 Set Mod Log Channel', label:'📌 Mod Log' },
  logs: { key:'general', customId:'admin:setlogs', selectId:'admin:selectlogs', title:'📋 Set General Logs Channel', label:'📋 General Logs' },
  memberlog: { key:'member', customId:'admin:setmemberlog', selectId:'admin:selectmemberlog', title:'👥 Set Member Log Channel', label:'👥 Member Log' },
};
const LOG_SELECT_TO_TYPE = Object.fromEntries(Object.entries(LOG_TYPES).map(([k,v]) => [v.selectId,k]));
const LOG_BUTTON_TO_TYPE = Object.fromEntries(Object.entries(LOG_TYPES).map(([k,v]) => [v.customId,k]));

const AUTOMOD_RULES = {
  antiSpam: { label:'🚫 Spam', title:'🚫 Spam Protection', editLabel:'⏱️ Limits', defaults:{ enabled:false, maxMessages:5, intervalSeconds:10, actions:['delete'] } },
  antiLinks: { label:'🔗 Links', title:'🔗 Link Protection', editLabel:'🌐 Domains', defaults:{ enabled:false, allowStaff:true, allowedDomains:[], deniedDomains:[], actions:['delete'] } },
  badWords: { label:'🤬 Bad Words', title:'🤬 Bad Word Filter', editLabel:'📝 Word List', defaults:{ enabled:false, words:[], actions:['delete'] } },
  caps: { label:'🔠 Caps', title:'🔠 Caps Protection', editLabel:'📏 Thresholds', defaults:{ enabled:false, percent:70, minLength:12, actions:['warn'] } },
  mentions: { label:'📣 Mentions', title:'📣 Mention Protection', editLabel:'📣 Limit', defaults:{ enabled:false, maxMentions:5, actions:['warn'] } },
};
const AUTOMOD_RULE_KEYS = Object.keys(AUTOMOD_RULES);
const AUTOMOD_ACTIONS = ['dm','delete','warn','timeout','kick','ban'];
const ACTION_LABELS = { dm:'DM User', delete:'Delete Message', warn:'Warn User', timeout:'Timeout User', kick:'Kick User', ban:'Ban User' };
const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  badWords: '⚠️ **{server} AutoMod**\nBad Word Filter triggered: {reason}',
  caps: '⚠️ **{server} AutoMod**\nCaps Protection triggered: {reason}',
  mentions: '⚠️ **{server} AutoMod**\nMention Protection triggered: {reason}',
};

const MODULES = [
  ['admin:embed','🎨 Embed','🎨 Embed Studio','Create and send custom embeds'],
  ['admin:autoRoles','🎭 Join Roles','🎭 Join Roles','Auto roles when members join'],
  ['admin:stats','📊 Stats','📊 Stats','Server stats counters'],
  ['admin:sticky','📌 Sticky Notes','📌 Sticky Notes','Persistent channel notes'],
  ['admin:suggestions','💡 Suggestions','💡 Suggestions','Suggestion system'],
  ['admin:tickets','🎟️ Tickets','🎟️ Tickets','Support ticket system'],
  ['admin:giveaways','🎉 Giveaways','🎉 Giveaways','Giveaway tools'],
  ['admin:fun','🎮 Fun','🎮 Fun','Fun commands and extras'],
  ['admin:polls','📊 Polls','📊 Polls','Poll system'],
];
const COMING_SOON = Object.fromEntries(MODULES.slice(2).filter(([id]) => id !== 'admin:tickets').map(([id,,title,desc]) => [id,[title,`${desc} are coming soon.`]]));

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id,label,style=ButtonStyle.Primary,disabled=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
function createEmbed(title, description, memberDisplayName, color=PANEL_COLOR) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (description) embed.setDescription(description);
  if (memberDisplayName) embed.setFooter({ text:`Requested by ${memberDisplayName}` });
  return embed;
}
function buttonRows(items,size=3){ const out=[]; for(let i=0;i<items.length;i+=size) out.push(row(...items.slice(i,i+size).map(([id,l,s,d])=>button(id,l,s,d)))); return out; }
const getMemberDisplayName = i => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const getGuildSection = (gid,s,d) => guildManager.getGuildSection(gid,s,d);
const replaceGuildSection = (gid,s,d) => guildManager.replaceGuildSection(gid,s,d);
const getRoleConfig = (gid,s) => getGuildSection(gid,s,{roleIds:[]});
const getAutoRolesConfig = gid => getGuildSection(gid,'autoRoles',{enabled:false,roleIds:[]});
const isBotOwner = i => security.isBotOwner(i.user.id);
const isGuildOwner = i => i.guild?.ownerId === i.user.id;
const canUseAdminPanel = i => isBotOwner(i) || isGuildOwner(i) || i.member?.permissions?.has(PermissionFlagsBits.Administrator);
const status = v => v ? 'Enabled ✅' : 'Disabled ❌';
function normalizeActions(value,fallback=['delete']) { const a=[...new Set((Array.isArray(value)?value:value?[value]:fallback).map(v=>String(v).toLowerCase()).filter(v=>AUTOMOD_ACTIONS.includes(v)))]; const clean=a.includes('ban')?a.filter(v=>v!=='kick'):a; return clean.length?clean:[...fallback]; }
const formatActions = a => normalizeActions(a).map(v=>ACTION_LABELS[v]).join(', ');
function defaults(){ return { enabled:false, dmUser:true, dmMessages:{...DEFAULT_DM_MESSAGES}, ...Object.fromEntries(AUTOMOD_RULE_KEYS.map(k=>[k,{...AUTOMOD_RULES[k].defaults}])), ignoredRoles:[], ignoredChannels:[] }; }
function getAutomodConfig(gid){ const cur=getGuildSection(gid,'automod',{}), d=defaults(), out={...d,...cur}; for(const k of AUTOMOD_RULE_KEYS){ const e=cur[k]||{}; out[k]={...d[k],...e,actions:normalizeActions(e.actions||e.action,d[k].actions)}; delete out[k].action; } out.antiLinks.allowedDomains=Array.isArray(out.antiLinks.allowedDomains)?out.antiLinks.allowedDomains:[]; out.antiLinks.deniedDomains=Array.isArray(out.antiLinks.deniedDomains)?out.antiLinks.deniedDomains:[]; out.dmMessages={...DEFAULT_DM_MESSAGES,...(cur.dmMessages||{})}; out.ignoredRoles=Array.isArray(cur.ignoredRoles)?cur.ignoredRoles:[]; out.ignoredChannels=Array.isArray(cur.ignoredChannels)?cur.ignoredChannels:[]; return out; }
const saveAutomodConfig = (gid,c) => replaceGuildSection(gid,'automod',c);
function getLogChannelId(gid,type){ return typeof guildManager.getLogChannelId==='function' ? guildManager.getLogChannelId(gid,type) : getGuildSection(gid,'logs',{channels:{}})?.channels?.[type]||null; }
function setLogChannelId(gid,type='general',cid=null){ if(typeof guildManager.setLogChannelId==='function') return guildManager.setLogChannelId(gid,type,cid); const logs=getGuildSection(gid,'logs',{enabled:true,channels:{},events:{}}); return replaceGuildSection(gid,'logs',{...logs,channels:{...(logs.channels||{}),[type]:cid}}); }
const formatRoleList = ids => { const a=[...new Set((ids||[]).filter(Boolean))]; return a.length?a.map(id=>`<@&${id}>`).join(', '):'None'; };
const normalizeBackupId = b => typeof b==='string'?b:b?.backupId;

function canonicalState(route='admin:home'){ const h=['admin:home']; if(route==='admin:home')return{history:h}; if(route==='admin:automod')return{history:[...h,route]}; if(route==='admin:automod:configure'||route.startsWith('admin:automod:rule:'))return{history:[...h,'admin:automod',route]}; if(route==='admin:channel:automodlog')return{history:[...h,'admin:automod','admin:automod:configure',route]}; if(['admin:staffroles','admin:modroles','admin:adminsettings'].includes(route))return{history:[...h,'admin:adminpanel',route]}; if(route==='admin:autoRoles'||MODULES.some(([id])=>id===route))return{history:[...h,'admin:modules',route]}; return{history:[...h,route]}; }
function routeLabel(r){ if(r?.startsWith('admin:automod:rule:')) return AUTOMOD_RULES[r.split(':').pop()]?.title||'AutoMod Rule'; return ({'admin:home':'Admin Hub','admin:automod':'AutoMod','admin:automod:configure':'Settings','admin:modules':'Modules','admin:logs':'Logs','admin:backups':'Backups','admin:adminpanel':'Admin Panel','admin:modpanel':'Mod Panel','admin:staffroles':'Staff Roles','admin:modroles':'Mod Roles','admin:autoRoles':'Join Roles'})[r]||String(r||'admin:home').replace('admin:','').replaceAll(':',' › '); }
function applyNavigationUI(interaction,panel,state=canonicalState()){ if(!panel?.embeds?.[0])return panel; return {...panel,embeds:[EmbedBuilder.from(panel.embeds[0]).setFooter({text:`Navigation: ${(state.history||['admin:home']).slice(-4).map(routeLabel).join(' › ')}`})]}; }
const backButton = route => button(panelNav.buildCustomId(canonicalState(route),'back'),'⬅️ Back',ButtonStyle.Secondary);
const navRow = (route,nextId,settingsId=null) => row(backButton(route),...(settingsId?[button(settingsId,'⚙️ Settings',ButtonStyle.Primary)]:[]),button(nextId,'Next ➡️',ButtonStyle.Secondary));

function buildAdminPanel(guild,name='Unknown User'){ return { embeds:[createEmbed('🛠️ Admin Hub','Control your server systems from one place.',name).addFields({name:'🤖 AutoMod',value:'Auto Protection',inline:true},{name:'🔏 Admin',value:'Admin tools',inline:true},{name:'🔐 Mod Panel',value:'Moderation tools',inline:true},{name:'🧩 Modules',value:'Embeds, tickets, fun, etc.',inline:true},{name:'📋 Logs',value:`${Object.values(LOG_TYPES).filter(v=>getLogChannelId(guild.id,v.key)).length}/5 configured`,inline:true},{name:'🧱 Backups',value:'Disaster recovery',inline:true},{name:'🧹 Purge',value:'Bulk delete messages',inline:true})], components:buttonRows([['admin:automod','⚙️ AutoMod',ButtonStyle.Primary],['admin:adminpanel','🔏 Admin',ButtonStyle.Primary],['admin:modpanel','🔐 Mod Panel',ButtonStyle.Primary],['admin:modules','🧩 Modules',ButtonStyle.Primary],['admin:logs','📋 Logs',ButtonStyle.Primary],['admin:backups','🧱 Backups',ButtonStyle.Secondary],['admin:purge','🧹 Purge',ButtonStyle.Danger]])}; }
function buildAutomodPanel(guild,name='Unknown User'){ const c=getAutomodConfig(guild.id), n=AUTOMOD_RULE_KEYS.filter(k=>c[k].enabled).length, buttons=AUTOMOD_RULE_KEYS.map(k=>[k,AUTOMOD_RULES[k].label,c[k].enabled?ButtonStyle.Success:ButtonStyle.Secondary]); return { embeds:[createEmbed('🤖 AutoMod Protection',[`**System:** ${status(c.enabled)}`,`**Protection rules:** ${n}/${AUTOMOD_RULE_KEYS.length} enabled`,'',...AUTOMOD_RULE_KEYS.map(k=>`**${AUTOMOD_RULES[k].label}:** ${status(c[k].enabled)}`),'','Select a protection rule, or open system settings.'].join('\n'),name,c.enabled?ENABLED_COLOR:DISABLED_COLOR)], components:[row(...buttons.slice(0,3).map(([k,l,s])=>button(`admin:automod:rule:${k}`,l,s))),row(...buttons.slice(3).map(([k,l,s])=>button(`admin:automod:rule:${k}`,l,s))),navRow('admin:automod','admin:adminpanel','admin:automod:configure')]}; }
function buildAutomodConfigurePanel(guild,name='Unknown User'){ const c=getAutomodConfig(guild.id); return { embeds:[createEmbed('⚙️ AutoMod Settings',[`**AutoMod:** ${status(c.enabled)}`,`**DM users:** ${status(c.dmUser!==false)}`,'','Configure AutoMod status and the DM sent for each infraction. AutoMod logging is managed from Global Logs.'].join('\n'),name,c.enabled?ENABLED_COLOR:DISABLED_COLOR)],components:[row(button('admin:automod:toggle',c.enabled?'Disable AutoMod':'Enable AutoMod',c.enabled?ButtonStyle.Danger:ButtonStyle.Success),button('admin:automod:dm',c.dmUser!==false?'Disable DMs':'Enable DMs',c.dmUser!==false?ButtonStyle.Danger:ButtonStyle.Success),button('admin:automod:dmmessage','✉️ DM Message',ButtonStyle.Primary)),row(button('admin:automod:reset','♻️ Reset',ButtonStyle.Danger)),navRow('admin:automod:configure','admin:automod:rule:antiSpam')]}; }
function ruleSummary(k,r){ if(k==='antiSpam')return`**Maximum messages:** ${r.maxMessages}\n**Window:** ${r.intervalSeconds} seconds\n**Actions:** ${formatActions(r.actions)}`; if(k==='antiLinks')return`**Staff bypass:** ${r.allowStaff?'Yes':'No'}\n**Allowed domains:** ${r.allowedDomains?.length||0}\n**Denied domains:** ${r.deniedDomains?.length||0}\n**Actions:** ${formatActions(r.actions)}`; if(k==='badWords')return`**Blocked words:** ${r.words?.length||0}\n**Actions:** ${formatActions(r.actions)}`; if(k==='caps')return`**Caps threshold:** ${r.percent}%\n**Minimum length:** ${r.minLength}\n**Actions:** ${formatActions(r.actions)}`; return`**Maximum mentions:** ${r.maxMentions}\n**Actions:** ${formatActions(r.actions)}`; }
function nextRuleId(k){ const i=AUTOMOD_RULE_KEYS.indexOf(k); return i===AUTOMOD_RULE_KEYS.length-1?'admin:automod':`admin:automod:rule:${AUTOMOD_RULE_KEYS[i+1]}`; }
function buildActionSelect(k,r){ return new StringSelectMenuBuilder().setCustomId(`admin:automod:rule:${k}:actions`).setPlaceholder('Select one or more actions').setMinValues(1).setMaxValues(AUTOMOD_ACTIONS.length).addOptions(AUTOMOD_ACTIONS.map(v=>({label:ACTION_LABELS[v],value:v,default:normalizeActions(r.actions).includes(v)}))); }
function buildAutomodRulePanel(guild,k,name='Unknown User'){ const c=getAutomodConfig(guild.id), meta=AUTOMOD_RULES[k], r=c[k], route=`admin:automod:rule:${k}`; return {embeds:[createEmbed(meta.title,[`**Status:** ${status(r.enabled)}`,'',ruleSummary(k,r),'','Choose the exact settings and select every action that should run when this rule triggers.'].join('\n'),name,r.enabled?ENABLED_COLOR:DISABLED_COLOR)],components:[row(button(`${route}:toggle`,r.enabled?'Disable':'Enable',r.enabled?ButtonStyle.Danger:ButtonStyle.Success),button(`${route}:edit`,meta.editLabel)),row(buildActionSelect(k,r)),navRow(route,nextRuleId(k),`${route}:edit`)]}; }
function textInput(id,label,value,{placeholder='',required=true,style=TextInputStyle.Short,maxLength=null}={}){ const input=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required); const val=String(value??'').trim(); if(val) input.setValue(val); if(placeholder) input.setPlaceholder(placeholder); if(maxLength) input.setMaxLength(maxLength); return row(input); }
function buildRuleModal(k,r){ const m=new ModalBuilder().setCustomId(`admin:automod:rule:${k}:modal`).setTitle(`${AUTOMOD_RULES[k].title} Settings`); if(k==='antiSpam')m.addComponents(textInput('maxMessages','Maximum messages',r.maxMessages),textInput('intervalSeconds','Time window in seconds',r.intervalSeconds)); if(k==='antiLinks')m.addComponents(textInput('allowStaff','Allow staff? true or false',r.allowStaff),textInput('allowedDomains','Allowed domains, comma separated',(r.allowedDomains||[]).join(', '),{placeholder:'trusted.example, discord.com',required:false,style:TextInputStyle.Paragraph}),textInput('deniedDomains','Denied domains, comma separated',(r.deniedDomains||[]).join(', '),{placeholder:'blocked.example, scam.example',required:false,style:TextInputStyle.Paragraph})); if(k==='badWords')m.addComponents(textInput('words','Blocked words, comma separated',(r.words||[]).join(', '),{placeholder:'word1, word2',required:false,style:TextInputStyle.Paragraph})); if(k==='caps')m.addComponents(textInput('percent','Capital letter percentage',r.percent),textInput('minLength','Minimum message length',r.minLength)); if(k==='mentions')m.addComponents(textInput('maxMentions','Maximum mentions',r.maxMentions)); return m; }
function buildDmMessagesModal(config){ const m=new ModalBuilder().setCustomId('admin:automod:dmmessage:modal').setTitle('AutoMod DM Messages'); for(const key of AUTOMOD_RULE_KEYS){ m.addComponents(textInput(`dm_${key}`,AUTOMOD_RULES[key].title.replace(/^\S+\s/,''),config.dmMessages[key],{required:false,style:TextInputStyle.Paragraph,maxLength:1000})); } return m; }
const parsePositive=(v,f,min=1,max=1000)=>{const n=Number.parseInt(String(v),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):f;};
const parseList=v=>[...new Set(String(v||'').split(',').map(x=>x.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'')).filter(Boolean))].slice(0,100);

function buildAdminToolsPanel(guild,name='Unknown User'){ return {embeds:[createEmbed('👑 Admin Panel',`**Staff Roles**\n${formatRoleList(getRoleConfig(guild.id,'staffRoles').roleIds)}\n\n**Mod Roles**\n${formatRoleList(getRoleConfig(guild.id,'modRoles').roleIds)}`,name)],components:[...buttonRows([['admin:setadminlog','🔏 Set Admin Log'],['admin:staffroles','👥 Staff Roles'],['admin:modroles','🔐 Mod Roles'],['admin:adminsettings','⚙️ Settings']]),row(backButton('admin:adminpanel'))]}; }
function buildModulesPanel(guild,name='Unknown User'){ return {embeds:[createEmbed('🧩 Modules',MODULES.map(([, ,t,d])=>`**${t}**\n${d}`).join('\n\n'),name)],components:[...buttonRows(MODULES.map(([id,l])=>[id,l,ButtonStyle.Primary])),row(backButton('admin:modules'))]}; }
function buildLogsPanel(guild,name='Unknown User'){ return {embeds:[createEmbed('📋 Log Channels',Object.values(LOG_TYPES).map(v=>`**${v.label}:** ${getLogChannelId(guild.id,v.key)?`<#${getLogChannelId(guild.id,v.key)}>`:'Not set'}`).join('\n'),name)],components:[...buttonRows(Object.values(LOG_TYPES).map(v=>[v.customId,v.label,ButtonStyle.Primary])),row(backButton('admin:logs'))]}; }
function buildBackupsPanel(guild,name='Unknown User'){ const b=listServerBackups(guild.id), latest=normalizeBackupId(b[0]); return {embeds:[createEmbed('🧱 Server Backups',`**Backups found:** ${b.length}\n**Latest:** \`${latest||'None'}\``,name)],components:[...buttonRows([['admin:backup:create','⚡ Create Backup',ButtonStyle.Success],['admin:backup:list','📦 View Backups'],['admin:backup:preview','🔍 Preview Latest',ButtonStyle.Secondary],['admin:backup:download','💾 Download Backup',ButtonStyle.Secondary],['admin:backup:requestrestore','🚨 Request Restore',ButtonStyle.Danger]],2),row(backButton('admin:backups'))]}; }
function buildRolePanel(guild,section,title,selectId,clearId,name,route){ const c=getRoleConfig(guild.id,section); return {embeds:[createEmbed(title,`**Selected roles:**\n${formatRoleList(c.roleIds)}`,name)],components:[row(new RoleSelectMenuBuilder().setCustomId(selectId).setPlaceholder('Select roles').setMinValues(0).setMaxValues(10)),row(button(clearId,'Clear Roles',ButtonStyle.Danger),backButton(route))]}; }
const buildStaffRolesPanel=(g,n='Unknown User')=>buildRolePanel(g,'staffRoles','👥 Staff Roles','admin:staffroles:select','admin:staffroles:clear',n,'admin:staffroles');
const buildModRolesPanel=(g,n='Unknown User')=>buildRolePanel(g,'modRoles','🔐 Mod Roles','admin:modroles:select','admin:modroles:clear',n,'admin:modroles');
function buildAutoRolesPanel(guild,name='Unknown User'){ const c=getAutoRolesConfig(guild.id); return {embeds:[createEmbed('🎭 Join Roles',`**Status:** ${status(c.enabled)}\n**Roles:** ${formatRoleList(c.roleIds)}\n\n⚠️ The bot role must be above selected roles.`,name)],components:[row(new RoleSelectMenuBuilder().setCustomId('admin:autoRoles:select').setPlaceholder('Select join roles').setMinValues(0).setMaxValues(10)),row(button('admin:autoRoles:toggle',c.enabled?'Disable':'Enable',c.enabled?ButtonStyle.Danger:ButtonStyle.Success),backButton('admin:autoRoles'))]}; }
function buildChannelPanel(type='logs'){ const s=LOG_TYPES[type]||LOG_TYPES.logs, route=type==='automodlog'?'admin:channel:automodlog':`admin:channel:${type}`; return {embeds:[createEmbed(s.title,'Select the text channel where these logs should be sent.')],components:[row(new ChannelSelectMenuBuilder().setCustomId(s.selectId).setPlaceholder('Choose a text channel').addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement)),row(backButton(route))]}; }
const buildComingSoonPanel=(t,d,r)=>({embeds:[createEmbed(t,d)],components:[row(backButton(r))]});
const buildPurgeModal=()=>new ModalBuilder().setCustomId('admin:purgeModal').setTitle('Purge Messages').addComponents(textInput('amount','Amount (1-100)','',{placeholder:'25'}));

async function updatePanel(i,p,route='admin:home'){ const payload=applyNavigationUI(i,p,canonicalState(route)); if(i.deferred||i.replied)await i.editReply(payload); else await i.update(payload); return true; }
function panelForRoute(r,i,n){ if(r==='admin:home')return buildAdminPanel(i.guild,n); if(r==='admin:automod')return buildAutomodPanel(i.guild,n); if(r==='admin:automod:configure')return buildAutomodConfigurePanel(i.guild,n); if(r?.startsWith('admin:automod:rule:'))return buildAutomodRulePanel(i.guild,r.split(':').pop(),n); if(r==='admin:adminpanel')return buildAdminToolsPanel(i.guild,n); if(r==='admin:modules')return buildModulesPanel(i.guild,n); if(r==='admin:logs')return buildLogsPanel(i.guild,n); if(r==='admin:backups')return buildBackupsPanel(i.guild,n); if(r==='admin:staffroles')return buildStaffRolesPanel(i.guild,n); if(r==='admin:modroles')return buildModRolesPanel(i.guild,n); if(r==='admin:autoRoles')return buildAutoRolesPanel(i.guild,n); if(r==='admin:modpanel')return buildComingSoonPanel('🔐 Mod Panel','Moderation tools will live here.',r); if(r==='admin:adminsettings')return buildComingSoonPanel('⚙️ Admin Settings','Admin settings will live here.',r); if(COMING_SOON[r])return buildComingSoonPanel(...COMING_SOON[r],r); return buildAdminPanel(i.guild,n); }
const openRoute=(i,r,n)=>updatePanel(i,panelForRoute(r,i,n),r);
async function handleAutomodModal(i){
  if(i.customId==='admin:automod:dmmessage:modal'){
    const c=getAutomodConfig(i.guild.id), dmMessages={...c.dmMessages};
    for(const key of AUTOMOD_RULE_KEYS){ const value=i.fields.getTextInputValue(`dm_${key}`).trim(); dmMessages[key]=value||DEFAULT_DM_MESSAGES[key]; }
    saveAutomodConfig(i.guild.id,{...c,dmMessages});
    await i.reply({content:'✅ AutoMod DM messages saved.',flags:64});
    return true;
  }
  const m=i.customId.match(/^admin:automod:rule:([^:]+):modal$/); if(!m||!AUTOMOD_RULES[m[1]])return false;
  const k=m[1],c=getAutomodConfig(i.guild.id),r={...c[k]};
  if(k==='antiSpam'){r.maxMessages=parsePositive(i.fields.getTextInputValue('maxMessages'),r.maxMessages,2,100);r.intervalSeconds=parsePositive(i.fields.getTextInputValue('intervalSeconds'),r.intervalSeconds,1,3600);}
  if(k==='antiLinks'){r.allowStaff=i.fields.getTextInputValue('allowStaff').trim().toLowerCase()!=='false';r.allowedDomains=parseList(i.fields.getTextInputValue('allowedDomains'));r.deniedDomains=parseList(i.fields.getTextInputValue('deniedDomains'));}
  if(k==='badWords')r.words=parseList(i.fields.getTextInputValue('words'));
  if(k==='caps'){r.percent=parsePositive(i.fields.getTextInputValue('percent'),r.percent,1,100);r.minLength=parsePositive(i.fields.getTextInputValue('minLength'),r.minLength,1,500);}
  if(k==='mentions')r.maxMentions=parsePositive(i.fields.getTextInputValue('maxMentions'),r.maxMentions,1,100);
  saveAutomodConfig(i.guild.id,{...c,[k]:r}); await i.reply({content:`✅ ${AUTOMOD_RULES[k].title} settings saved.`,flags:64}); return true;
}
async function handleAdminNavigation(i){
  if(!i.guild)return false;
  const nav=panelNav.parseCustomId(i.customId);
  if(!String(i.customId||'').startsWith('admin:')&&!nav)return false;
  if(!canUseAdminPanel(i)){ await i.reply({content:'❌ Only the Goliath Owner, Guild Owner, or Administrators can use the Admin Panel.',flags:64}); return true; }
  const n=getMemberDisplayName(i);
  if(i.isModalSubmit())return handleAutomodModal(i);
  if(nav?.action==='back'){const s=panelNav.back(nav.state),r=panelNav.current(s);return openRoute(i,r,n);}
  if(i.isRoleSelectMenu()){const map={'admin:staffroles:select':'staffRoles','admin:modroles:select':'modRoles','admin:autoRoles:select':'autoRoles'},sec=map[i.customId];if(!sec)return false;const cur=sec==='autoRoles'?getAutoRolesConfig(i.guild.id):getRoleConfig(i.guild.id,sec);replaceGuildSection(i.guild.id,sec,{...cur,roleIds:[...new Set(i.values||[])]});return openRoute(i,sec==='staffRoles'?'admin:staffroles':sec==='modRoles'?'admin:modroles':'admin:autoRoles',n);}
  if(i.isStringSelectMenu()){const m=i.customId.match(/^admin:automod:rule:([^:]+):actions$/);if(!m||!AUTOMOD_RULES[m[1]])return false;const k=m[1],c=getAutomodConfig(i.guild.id),r={...c[k],actions:normalizeActions(i.values,c[k].actions)};saveAutomodConfig(i.guild.id,{...c,[k]:r});return openRoute(i,`admin:automod:rule:${k}`,n);}
  if(i.isChannelSelectMenu()){const t=LOG_SELECT_TO_TYPE[i.customId];if(!t)return false;setLogChannelId(i.guild.id,LOG_TYPES[t].key,i.values?.[0]||null);return openRoute(i,t==='automodlog'?'admin:automod:configure':'admin:logs',n);}
  if(!i.isButton())return false;
  const id=i.customId;
  if(id==='admin:purge'){await i.showModal(buildPurgeModal());return true;}
  if(id==='admin:automod:dmmessage'){await i.showModal(buildDmMessagesModal(getAutomodConfig(i.guild.id)));return true;}
  if(id==='admin:automod:toggle'||id==='admin:automod:dm'){const c=getAutomodConfig(i.guild.id);saveAutomodConfig(i.guild.id,{...c,...(id.endsWith(':toggle')?{enabled:!c.enabled}:{dmUser:c.dmUser===false})});return openRoute(i,'admin:automod:configure',n);}
  if(id==='admin:automod:reset'){saveAutomodConfig(i.guild.id,defaults());return openRoute(i,'admin:automod:configure',n);}
  const rm=id.match(/^admin:automod:rule:([^:]+)(?::(toggle|edit))?$/);
  if(rm&&AUTOMOD_RULES[rm[1]]){const k=rm[1],a=rm[2];if(!a)return openRoute(i,`admin:automod:rule:${k}`,n);const c=getAutomodConfig(i.guild.id),r={...c[k]};if(a==='edit'){await i.showModal(buildRuleModal(k,r));return true;}r.enabled=!r.enabled;saveAutomodConfig(i.guild.id,{...c,[k]:r});return openRoute(i,`admin:automod:rule:${k}`,n);}
  if(LOG_BUTTON_TO_TYPE[id])return updatePanel(i,buildChannelPanel(LOG_BUTTON_TO_TYPE[id]),LOG_BUTTON_TO_TYPE[id]==='automodlog'?'admin:channel:automodlog':`admin:channel:${LOG_BUTTON_TO_TYPE[id]}`);
  if(id==='admin:embed'){const {buildEmbedPanel}=require('../../../modules/messageStudio/embed/embedPanel');return updatePanel(i,buildEmbedPanel(i,n),'admin:embed');}
  if(id==='admin:tickets'){const {sendSetupPanel}=require('../../../modules/feedbackStudio/tickets/ticketsPanel');return sendSetupPanel(i);}
  if(id==='admin:autoRoles:toggle'){const c=getAutoRolesConfig(i.guild.id);replaceGuildSection(i.guild.id,'autoRoles',{...c,enabled:!c.enabled,roleIds:c.roleIds||[]});return openRoute(i,'admin:autoRoles',n);}
  if(id==='admin:staffroles:clear'||id==='admin:modroles:clear'){const r=id.includes('staffroles')?'admin:staffroles':'admin:modroles';replaceGuildSection(i.guild.id,r==='admin:staffroles'?'staffRoles':'modRoles',{roleIds:[]});return openRoute(i,r,n);}
  if(id==='admin:backup:create'){await i.deferUpdate();await createServerBackup(i.guild,{createdBy:i.user.id,reason:'Manual backup from admin panel'});return i.editReply(applyNavigationUI(i,buildBackupsPanel(i.guild,n),canonicalState('admin:backups')));}
  if(id==='admin:backup:list'){const b=listServerBackups(i.guild.id).map(normalizeBackupId).filter(Boolean);await i.reply({content:b.length?`📦 **Backups:**\n${b.slice(0,10).map(x=>`\`${x}\``).join('\n')}`:'📦 No backups found.',flags:64});return true;}
  if(id==='admin:backup:preview'){const l=normalizeBackupId(listServerBackups(i.guild.id)[0]),b=l?readServerBackup(i.guild.id,l):null,v=b?validateServerBackup(b,{guildId:i.guild.id}):null;await i.reply({content:b?`🔍 **Latest Backup**\nID: \`${l}\`\nValid: ${v?.valid?'YES ✅':'NO ❌'}`:'🔍 No backups found.',flags:64});return true;}
  if(id==='admin:backup:download'){const l=normalizeBackupId(listServerBackups(i.guild.id)[0]),b=l?readServerBackup(i.guild.id,l):null;if(!b){await i.reply({content:'❌ No backups found.',flags:64});return true;}await i.reply({content:`💾 Backup: ${l}`,files:[{attachment:Buffer.from(JSON.stringify(b,null,2)),name:`${l}.json`}],flags:64});return true;}
  if(id==='admin:backup:requestrestore')return restoreRequestManager.createRestoreRequest(i,{cooldownMs:1800000});
  if(['admin:backup:restore','admin:backup:restore:real'].includes(id)){await i.reply({content:'❌ Direct restores are disabled. Use the centralized restore approval system.',flags:64});return true;}
  const routes=['admin:home','admin:automod','admin:automod:configure','admin:adminpanel','admin:modules','admin:logs','admin:backups','admin:modpanel','admin:staffroles','admin:modroles','admin:autoRoles','admin:adminsettings'];
  if(routes.includes(id)||COMING_SOON[id])return openRoute(i,id,n);
  return false;
}

module.exports={LOG_TYPES,buildAdminPanel,buildAutomodPanel,buildAutomodConfigurePanel,buildAutomodRulePanel,buildAdminToolsPanel,buildBackupsPanel,buildStaffRolesPanel,buildModRolesPanel,buildModulesPanel,buildLogsPanel,buildAutoRolesPanel,buildChannelPanel,buildComingSoonPanel,buildPurgeModal,getLogChannelId,setLogChannelId,handleAdminNavigation,updatePanel,openExternalAdminPanel:async(i,p)=>{await i.update(applyNavigationUI(i,p,canonicalState('admin:home')));return true;},applyNavigationUI,getCurrentRoute:()=> 'admin:home',setCurrentRoute:()=>true,pushHistory:()=>true,popHistory:()=> 'admin:home',getBreadcrumb:()=> 'Admin Hub'};
