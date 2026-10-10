'use strict';

const { Events, MessageFlags } = require('discord.js');

function optionalRequire(label, modulePath, fallback = {}) {
  try { return require(modulePath); }
  catch (error) {
    console.warn(`[InteractionCreate] Optional handler unavailable: ${label}`);
    console.warn(error?.stack || error?.message || error);
    return fallback;
  }
}

const guildManager = optionalRequire('guild manager', '../../core/guild/guildManager');
const panelNavigation = optionalRequire('panel navigation', '../../core/ui/panelNavigation');
const verificationManager = optionalRequire('verification manager', '../../modules/securityStudio/verificationManager');
const verificationFlowContinuation = optionalRequire('verification flow continuation', '../../modules/securityStudio/verificationFlowContinuation');
const verificationChallengeInteractions = optionalRequire('verification challenge interactions', '../../modules/securityStudio/verificationChallengeInteractions');
const ticketInteractionHandler = optionalRequire('tickets', '../../modules/feedbackStudio/tickets/tickets');
const pollsInteractions = optionalRequire('polls', '../../modules/communityStudio/polls/pollsInteractions');
const tempVoiceInteractionHandler = optionalRequire('temp voice', '../../modules/utilityStudio/tempVoice/tempVoiceInteractionHandler');
const suggestionsInteractions = optionalRequire('suggestions', '../../modules/feedbackStudio/suggestions/suggestionsInteractions');
const giveawaysInteractionHandler = optionalRequire('giveaways', '../../modules/communityStudio/giveaways/giveawaysInteractionHandler');
const formsInteractions = optionalRequire('forms', '../../modules/feedbackStudio/forms/formsInteractions');
const faqInteractions = optionalRequire('faq', '../../modules/feedbackStudio/faq/faqInteractions');
const embedStudio = optionalRequire('embed studio', '../../modules/messageStudio/embed/embed');
const duplicator = optionalRequire('duplicator', '../../owner/dev/duplicator');
const permissionsStudioInteractions = optionalRequire('permissions studio', './permissionsStudio');
const adminPanel = optionalRequire('admin panel', '../../core/administration/admin/panel');
const adminCommand = optionalRequire('admin security controls', '../../core/administration/admin/command');
const automodPanel = optionalRequire('automod panel', '../../core/administration/automod/panel');
const modInteractions = optionalRequire('mod interactions', '../../core/administration/mod/interactions');
const restoreRequestManager = optionalRequire('restore requests', '../../core/security/restoreBackup/requests');
const statsAdminPanel = optionalRequire('stats admin', '../../modules/utilityStudio/stats/statsPanel');
const reactionRolesAdminPanel = optionalRequire('reaction roles admin', '../../modules/roleStudio/reactionRoles/reactionRolesPanel');
const temporaryRolesPanel = optionalRequire('temporary roles admin', '../../modules/roleStudio/temporaryRoles/temporaryRolesPanel');
const giveawaysAdminPanel = optionalRequire('giveaways admin', '../../modules/communityStudio/giveaways/giveawaysAdminPanel');
const starboardPanel = optionalRequire('starboard admin', '../../modules/messageStudio/starboard/starboardPanel');
const stickyAdminPanel = optionalRequire('sticky admin', '../../modules/messageStudio/sticky/stickyAdminPanel');
const levelingInteractions = optionalRequire('leveling', '../../modules/communityStudio/leveling/levelingInteractions');
const socialAdminPanel = optionalRequire('social admin', '../../modules/socialStudio/socialAlerts/socialStudioPanel');
const socialCreatorActionCompat = optionalRequire('social creator actions', '../../modules/socialStudio/socialAlerts/socialStudioCreatorActionCompat');
const schedulePanel = optionalRequire('schedule admin', '../../modules/utilityStudio/schedule/schedulePanel');
const scheduleDeployment = optionalRequire('schedule RSVP', '../../modules/utilityStudio/schedule/scheduleDeployment');
const verificationAdminPanel = optionalRequire('verification admin', '../../modules/securityStudio/verificationPanel');
const autorolesPanel = optionalRequire('auto roles', '../../modules/roleStudio/autoRoles/autoRolesPanel');
const timedRolesPanel = optionalRequire('timed roles', '../../modules/roleStudio/timedRoles/timedRolesPanel');
const welcomePanel = optionalRequire('welcome', '../../modules/messageStudio/welcome/welcomePanel');
const goodbyePanel = optionalRequire('goodbye', '../../modules/messageStudio/goodbye/goodbyePanel');
const moduleAdminPanels = optionalRequire('generic module admin', '../../core/administration/admin/modules');
const userPanelInteractions = optionalRequire('user panel', '../../core/administration/user/interactions');
const roleSelectorPanel = optionalRequire('role selector', '../../modules/roleStudio/roleSelector/roleSelectorPanel');
const roleStudioPanel = optionalRequire('role studio panel', '../../modules/roleStudio/roleStudioPanel');
const privateRoomsPanel = optionalRequire('private rooms panel', '../../modules/utilityStudio/privateRooms/privateRoomsPanel');
const birthdaysPanel = optionalRequire('birthdays panel', '../../modules/communityStudio/birthdays/birthdaysPanel');

const MODULE_STUDIO_PREFIXES = [
  ['communityStudio', ['admin:birthdays', 'birthdays:user:', 'admin:invites', 'invites:', 'admin:giveaways', 'giveaways:', 'admin:leveling', 'leveling:', 'admin:polls', 'poll_vote:']],
  ['feedbackStudio', ['admin:faq', 'faq:', 'admin:forms', 'forms:', 'admin:suggestions', 'suggestions:', 'admin:tickets', 'tickets:']],
  ['messageStudio', ['admin:embed', 'embed:', 'admin:goodbye', 'goodbye:', 'admin:starboard', 'starboard:', 'admin:sticky', 'sticky:', 'admin:welcome', 'welcome:']],
  ['roleStudio', ['admin:autoRoles', 'autoroles:', 'admin:reactionRoles', 'reactionRoles:', 'admin:temporaryRoles', 'temporaryRoles:', 'admin:timedRoles', 'timedRoles:']],
  ['securityStudio', ['admin:verification', 'verification:']],
  ['socialStudio', ['admin:social', 'social:']],
  ['utilityStudio', ['admin:schedule', 'schedule:', 'admin:stats', 'stats:', 'admin:translation', 'translation:', 'admin:tempVoice', 'tempVoice:']],
];

const ADMIN_MODULE_PREFIXES = Object.freeze([
  ['birthdays', 'admin:birthdays'], ['giveaways', 'admin:giveaways'], ['invites', 'admin:invites'], ['leveling', 'admin:leveling'], ['polls', 'admin:polls'],
  ['faq', 'admin:faq'], ['forms', 'admin:forms'], ['suggestions', 'admin:suggestions'], ['tickets', 'admin:tickets'],
  ['goodbye', 'admin:goodbye'], ['embed', 'admin:embed'], ['starboard', 'admin:starboard'], ['sticky', 'admin:sticky'], ['welcome', 'admin:welcome'],
  ['autoRoles', 'admin:autoRoles'], ['reactionRoles', 'admin:reactionRoles'], ['temporaryRoles', 'admin:temporaryRoles'], ['timedRoles', 'admin:timedRoles'],
  ['verification', 'admin:verification'], ['social', 'admin:social'],
  ['emojis', 'admin:module:emojis'], ['privateRooms', 'admin:privateRooms'], ['schedule', 'admin:schedule'], ['stats', 'admin:stats'], ['tempVoice', 'admin:tempVoice'], ['translation', 'admin:translation'],
]);

function resolveAdminModuleKey(customId) {
  const id = String(customId || '');
  const generic = id.match(/^admin:module:([a-zA-Z0-9_-]+)/);
  if (generic) return generic[1];
  const catalogMatch = (moduleAdminPanels.MODULE_CATALOG || []).find((module) => id === module.route || id.startsWith(`${module.route}:`));
  if (catalogMatch) return catalogMatch.key;
  return ADMIN_MODULE_PREFIXES.find(([, prefix]) => id === prefix || id.startsWith(`${prefix}:`))?.[0] || null;
}

async function enforceAdminModuleAuthority(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:')) return false;
  const studio = id.match(/^admin:studio:([a-zA-Z0-9_-]+)$/);
  if (studio) {
    if (typeof adminPanel.canManageStudio !== 'function' || adminPanel.canManageStudio(interaction, studio[1])) return false;
  } else {
    const moduleKey = resolveAdminModuleKey(id);
    if (!moduleKey) return false;
    if (typeof adminPanel.canManageModule !== 'function' || adminPanel.canManageModule(interaction, moduleKey)) return false;
  }
  const payload = { content: '❌ Your guild authority profile does not permit this Studio or module.', flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.reply(payload);
  return true;
}

let invitesAdminPanel = null;
let invitesAdminPanelError = null;
function loadInvitesAdminPanel() {
  if (invitesAdminPanel?.buildInviteStudioPayload && invitesAdminPanel?.handleInviteStudioInteraction) return invitesAdminPanel;
  try {
    const modulePath = require.resolve('../../modules/communityStudio/invites/invitesAdminPanel');
    delete require.cache[modulePath];
    invitesAdminPanel = require(modulePath);
    invitesAdminPanelError = null;
    return invitesAdminPanel;
  } catch (error) {
    invitesAdminPanel = null;
    invitesAdminPanelError = error;
    console.error('[InteractionCreate] Invite Studio load failed:', error?.stack || error?.message || error);
    return null;
  }
}

const verificationLocks = new Map();
const handledInteractions = new WeakSet();
const legacyRoleSelections = new Map();
const LEGACY_ROLE_PAGE_SIZE = 25;
const LEGACY_ROLE_TTL_MS = 30 * 60 * 1000;

async function callHandler(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return false;
  return Boolean(await target[method](...args));
}
function isValidHttpUrl(value) {
  try { const parsed = new URL(String(value || '').trim()); return parsed.protocol === 'http:' || parsed.protocol === 'https:'; }
  catch { return false; }
}
function sanitizeEmbedData(embed) {
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : { ...embed };
  if (!data || typeof data !== 'object') return data;
  const sanitized = { ...data };
  if (sanitized.footer?.icon_url && !isValidHttpUrl(sanitized.footer.icon_url)) { sanitized.footer = { ...sanitized.footer }; delete sanitized.footer.icon_url; }
  if (sanitized.author?.icon_url && !isValidHttpUrl(sanitized.author.icon_url)) { sanitized.author = { ...sanitized.author }; delete sanitized.author.icon_url; }
  if (sanitized.author?.url && !isValidHttpUrl(sanitized.author.url)) { sanitized.author = { ...sanitized.author }; delete sanitized.author.url; }
  if (sanitized.thumbnail?.url && !isValidHttpUrl(sanitized.thumbnail.url)) delete sanitized.thumbnail;
  if (sanitized.image?.url && !isValidHttpUrl(sanitized.image.url)) delete sanitized.image;
  return sanitized;
}
function resolveParentStudio(customId) {
  const id = String(customId || '');
  for (const [studioKey, prefixes] of MODULE_STUDIO_PREFIXES) if (prefixes.some((prefix) => id === prefix || id.startsWith(prefix))) return studioKey;
  return null;
}
function normalizeBackComponent(component, interaction) {
  const data = typeof component?.toJSON === 'function' ? component.toJSON() : { ...component };
  const customId = data?.custom_id || data?.customId || null;
  const parentStudio = resolveParentStudio(interaction?.customId);
  if (!parentStudio || customId !== 'admin:modules') return data;
  return { ...data, custom_id: `admin:studio:${parentStudio}`, label: 'Back', emoji: { name: '⬅️' } };
}
function componentId(component) { return component?.custom_id || component?.customId || null; }

function pruneLegacyRoleSelections() { const cutoff = Date.now() - LEGACY_ROLE_TTL_MS; for (const [key, value] of legacyRoleSelections.entries()) if (Number(value?.touchedAt || 0) < cutoff) legacyRoleSelections.delete(key); }
function legacyRoleKey(interaction, baseId) { return `${interaction?.guildId || interaction?.guild?.id || 'noguild'}:${interaction?.user?.id || 'nouser'}:${baseId}`; }
function parseLegacyRoleId(customId) { const match = String(customId || '').match(/^(.*)\|grole\|select\|(\d+)$/); return match ? { baseId: match[1], page: Math.max(0, Number.parseInt(match[2], 10) || 0) } : null; }
function legacyRoleCustomId(baseId, page) { const suffix = `|grole|select|${Math.max(0, Number(page) || 0)}`; return `${String(baseId || 'role').slice(0, Math.max(1, 100 - suffix.length))}${suffix}`; }
function guildRolesByHierarchy(guild) { if (typeof panelNavigation.guildRolesByHierarchy === 'function') return panelNavigation.guildRolesByHierarchy(guild); if (!guild?.roles?.cache) return []; return [...guild.roles.cache.values()].filter((role) => role.id !== guild.id).sort((a,b)=>Number(b.rawPosition??b.position??0)-Number(a.rawPosition??a.position??0)); }
function rolePageCount(guild) { return Math.max(1, Math.ceil(guildRolesByHierarchy(guild).length / LEGACY_ROLE_PAGE_SIZE)); }
function roleIdsOnLegacyPage(guild, page) { const roles=guildRolesByHierarchy(guild); const count=Math.max(1,Math.ceil(roles.length/LEGACY_ROLE_PAGE_SIZE)); const safePage=Math.min(Math.max(0,Number(page)||0),count-1); return roles.slice(safePage*LEGACY_ROLE_PAGE_SIZE,(safePage+1)*LEGACY_ROLE_PAGE_SIZE).map((role)=>role.id); }
function legacyRoleState(interaction, baseId, defaults=null) { pruneLegacyRoleSelections(); const key=legacyRoleKey(interaction,baseId); let state=legacyRoleSelections.get(key); const isSameSource=interaction?.__goliathLegacyRoleBase===baseId; if(Array.isArray(defaults)&&defaults.length) state={ids:new Set(defaults.map(String)),maxValues:state?.maxValues||null,touchedAt:Date.now()}; else if(!state||(!isSameSource&&Array.isArray(defaults))) state={ids:new Set(),maxValues:state?.maxValues||null,touchedAt:Date.now()}; else state.touchedAt=Date.now(); legacyRoleSelections.set(key,state); return state; }
function nativeRoleDefaults(component) { return Array.isArray(component?.default_values)?component.default_values.filter((entry)=>entry?.type==='role'||entry?.type===1).map((entry)=>String(entry.id)).filter(Boolean):[]; }
function roleOptionDescription(role) { if(role.managed)return 'Managed by Discord / integration'; return `Hierarchy position ${Number(role.rawPosition??role.position??0)}`.slice(0,100); }
function convertRoleComponent(component, interaction, requestedPage) { const marked=parseLegacyRoleId(componentId(component)); const native=Number(component?.type)===6; if(!native&&!marked)return component; const baseId=marked?.baseId||componentId(component); if(!baseId||!interaction?.guild)return component; const pageCount=rolePageCount(interaction.guild); const page=Math.min(Math.max(0,Number(requestedPage??marked?.page)||0),pageCount-1); const defaults=native?nativeRoleDefaults(component):null; const state=legacyRoleState(interaction,baseId,defaults); const roles=guildRolesByHierarchy(interaction.guild).slice(page*LEGACY_ROLE_PAGE_SIZE,(page+1)*LEGACY_ROLE_PAGE_SIZE); const maxRequested=Math.max(1,Number(component?.max_values??state.maxValues??1)||1); if(native||!state.maxValues)state.maxValues=maxRequested; const maxValues=Math.max(1,Math.min(maxRequested,roles.length||1)); const minRequested=Math.max(0,Number(component?.min_values??1)||0); const minValues=Math.min(minRequested,maxValues); const rawPlaceholder=String(component?.placeholder||'Choose a role').replace(/ · Page \d+\/\d+$/,''); return {type:3,custom_id:legacyRoleCustomId(baseId,page),placeholder:`${rawPlaceholder}${pageCount>1?` · Page ${page+1}/${pageCount}`:''}`.slice(0,150),min_values:minValues,max_values:maxValues,disabled:Boolean(component?.disabled||!roles.length),options:roles.length?roles.map((role)=>({label:String(role.name||'Unnamed role').slice(0,100),value:role.id,description:roleOptionDescription(role),default:state.ids.has(role.id)})):[{label:'No roles available',value:'__none__'}]}; }
function paginationButton(customId,label,disabled=false){return{type:2,style:2,custom_id:customId,label,disabled};}
function normalizeLegacyRoleRows(rows,interaction){if(!interaction?.guild||!Array.isArray(rows))return rows;const requestedPage=Math.max(0,Number(interaction.__goliathLegacyRolePage)||0);let found=false;let nextRows=rows.map((rowData)=>({...rowData,components:(rowData.components||[]).filter((component)=>{const id=componentId(component);return !String(id||'').startsWith('grole:page:')&&!String(id||'').startsWith('grole:info:');}).map((component)=>{const converted=convertRoleComponent(component,interaction,requestedPage);if(converted!==component)found=true;return converted;})})).filter((rowData)=>rowData.components.length);if(!found)return nextRows;const pageCount=rolePageCount(interaction.guild);if(pageCount<=1)return nextRows;const page=Math.min(requestedPage,pageCount-1);const controls=[paginationButton(`grole:page:${Math.max(0,page-1)}`,'⬅️ Previous',page<=0),paginationButton(`grole:page:${Math.min(pageCount-1,page+1)}`,'Next ➡️',page>=pageCount-1)];let target=-1;for(let index=nextRows.length-1;index>=0;index-=1){const components=nextRows[index]?.components||[];if(components.length<=3&&components.every((component)=>Number(component.type)===2)){target=index;break;}}if(target>=0)nextRows[target]={...nextRows[target],components:[...nextRows[target].components,...controls]};else if(nextRows.length<5)nextRows.push({type:1,components:controls});return nextRows;}
function isModernRolePaginationButton(component){const id=String(componentId(component)||'');return Number(component?.type)===2&&(id.includes('|rp|page|')||id.includes('|rpinfo|'));}
function compactModernRolePaginationRows(rows){if(!Array.isArray(rows))return rows;const controls=[];const nextRows=[];for(const rowData of rows){const components=Array.isArray(rowData?.components)?rowData.components:[];if(components.length&&components.every(isModernRolePaginationButton)){for(const component of components)if(String(componentId(component)||'').includes('|rp|page|'))controls.push(component);continue;}nextRows.push(rowData);}if(!controls.length)return rows;const paging=controls.slice(0,2);for(let index=nextRows.length-1;index>=0;index-=1){const components=nextRows[index]?.components||[];if(components.length<=3&&components.every((component)=>Number(component.type)===2)){nextRows[index]={...nextRows[index],components:[...components,...paging]};return nextRows;}}if(nextRows.length<5)nextRows.push({type:1,components:paging});return nextRows;}
function prepareLegacyRoleInteraction(interaction){const parsed=parseLegacyRoleId(interaction?.customId);if(!parsed||!interaction?.guild)return false;const rows=interaction.message?.components||[];let sourceComponent=null;for(const actionRow of rows){const rowData=typeof actionRow?.toJSON==='function'?actionRow.toJSON():actionRow;sourceComponent=(rowData?.components||[]).find((component)=>componentId(component)===interaction.customId);if(sourceComponent)break;}const state=legacyRoleState(interaction,parsed.baseId,null);const maxValues=Math.max(1,Number(state.maxValues??sourceComponent?.max_values??1)||1);const selectedNow=(interaction.values||[]).filter((id)=>id!=='__none__').map(String);if(maxValues<=1)state.ids=new Set(selectedNow.slice(0,1));else{const visible=new Set(roleIdsOnLegacyPage(interaction.guild,parsed.page));for(const id of visible)state.ids.delete(id);for(const id of selectedNow)state.ids.add(id);}state.touchedAt=Date.now();const ordered=guildRolesByHierarchy(interaction.guild).map((role)=>role.id).filter((id)=>state.ids.has(id));const limited=ordered.slice(0,maxValues);state.ids=new Set(limited);legacyRoleSelections.set(legacyRoleKey(interaction,parsed.baseId),state);interaction.values=limited;interaction.__goliathLegacyRolePage=parsed.page;interaction.__goliathLegacyRoleBase=parsed.baseId;try{Object.defineProperty(interaction,'isRoleSelectMenu',{value:()=>true,configurable:true});}catch{interaction.isRoleSelectMenu=()=>true;}return true;}
async function handleLegacyRolePage(interaction){const match=String(interaction?.customId||'').match(/^grole:page:(\d+)$/);if(!match||!interaction?.message)return false;interaction.__goliathLegacyRolePage=Math.max(0,Number.parseInt(match[1],10)||0);const components=interaction.message.components.map((actionRow)=>typeof actionRow?.toJSON==='function'?actionRow.toJSON():actionRow);await interaction.update({components});return true;}

function sanitizeComponentPayload(payload,interaction){if(!payload||typeof payload!=='object')return payload;const sanitizedPayload={...payload,...(Array.isArray(payload.embeds)?{embeds:payload.embeds.map(sanitizeEmbedData)}:{})};if(!Array.isArray(payload.components))return sanitizedPayload;const seen=new Set();const rows=[];for(const actionRow of payload.components){const rowData=typeof actionRow?.toJSON==='function'?actionRow.toJSON():actionRow;const components=Array.isArray(rowData?.components)?rowData.components.map((component)=>normalizeBackComponent(component,interaction)).filter((component)=>{const customId=componentId(component);if(!customId)return true;if(seen.has(customId))return false;seen.add(customId);return true;}):[];if(components.length)rows.push({...rowData,components});}const roleRows=normalizeLegacyRoleRows(rows,interaction);return{...sanitizedPayload,components:compactModernRolePaginationRows(roleRows)};}
function wrapInteractionResponses(interaction){if(!interaction||interaction.__goliathResponsesWrapped)return;interaction.__goliathResponsesWrapped=true;const originals={};for(const methodName of ['reply','update','editReply','followUp'])if(typeof interaction[methodName]==='function')originals[methodName]=interaction[methodName].bind(interaction);for(const methodName of Object.keys(originals)){interaction[methodName]=(payload,...args)=>{const sanitized=sanitizeComponentPayload(payload,interaction);const isPanelPayload=Array.isArray(sanitized?.embeds)||Array.isArray(sanitized?.components);const canReuseModalSource=methodName==='reply'&&interaction.isModalSubmit?.()&&interaction.isFromMessage?.()&&!interaction.deferred&&!interaction.replied&&isPanelPayload&&typeof originals.update==='function';if(canReuseModalSource){const updatePayload={...sanitized};delete updatePayload.ephemeral;delete updatePayload.flags;return originals.update(updatePayload,...args);}return originals[methodName](sanitized,...args);};}}
const startsWith=(interaction,prefix)=>String(interaction?.customId||'').startsWith(prefix);
function isVerificationMemberInteraction(interaction){if(!interaction?.isButton?.())return false;return typeof verificationManager?.parseVerifyCustomId==='function'&&Boolean(verificationManager.parseVerifyCustomId(interaction.customId));}
async function safeInteractionError(interaction,error=null){const detail=error?.message?`\n\`${String(error.message).slice(0,300)}\``:'';const payload={content:`❌ Interaction failed.${detail}`,flags:MessageFlags.Ephemeral};try{if(interaction?.isAutocomplete?.()){await interaction.respond([]).catch(()=>null);return;}if(interaction?.deferred||interaction?.replied){if(interaction.isMessageComponent?.()&&!interaction.isModalSubmit?.()){await interaction.followUp(payload).catch(()=>null);}else{await interaction.editReply(payload).catch(()=>interaction.followUp(payload).catch(()=>null));}return;}await interaction?.reply?.(payload).catch(()=>null);}catch{}}
async function fetchFreshMember(interaction){const guild=interaction?.guild;const userId=interaction?.user?.id;if(!guild||!userId)return null;return guild.members.fetch({user:userId,force:true}).catch(()=>guild.members.fetch(userId).catch(()=>null));}
async function handleVerificationMemberInteraction(interaction){
  if(typeof verificationManager?.verifyMember!=='function')throw new Error('Verification handler is unavailable.');
  if(!interaction.deferred&&!interaction.replied)await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const lockKey=`${interaction.guildId}:${interaction.user.id}`;
  const previous=verificationLocks.get(lockKey);
  if(previous)await previous.catch(()=>null);
  const operation=(async()=>{
    const member=await fetchFreshMember(interaction);
    if(!member)return{ok:false,message:'Member not found. Please try again.'};
    const initial=await verificationManager.verifyMember({guild:interaction.guild,guildId:interaction.guildId,member,user:interaction.user,customId:interaction.customId,channelId:interaction.channelId||interaction.channel?.id,messageId:interaction.message?.id||interaction.messageId});
    if(!initial?.pendingSecurity)return initial;
    if(typeof verificationFlowContinuation?.resumeVerification!=='function')return initial;
    return verificationFlowContinuation.resumeVerification({guild:interaction.guild,guildId:interaction.guildId,member,user:interaction.user});
  })();
  verificationLocks.set(lockKey,operation);
  try{
    const result=await operation;
    if(result?.challenge&&typeof verificationChallengeInteractions?.memberChallengePayload==='function'){
      const payload=verificationChallengeInteractions.memberChallengePayload(interaction.user.id,result.challenge);
      await interaction.editReply({content:result.message||'Continue Verification.',...payload});
    }else await interaction.editReply({content:result?.ok?`✅ ${result.message}`:`❌ ${result?.message||'Verification could not continue.'}`});
  }finally{if(verificationLocks.get(lockKey)===operation)verificationLocks.delete(lockKey);}
  return true;
}

module.exports={
  name:Events.InteractionCreate,
  async execute(interaction,client){
    if(interaction&&handledInteractions.has(interaction))return;
    if(interaction)handledInteractions.add(interaction);
    try{
      wrapInteractionResponses(interaction);
      if(interaction?.isAutocomplete?.()){const command=client.commands?.get?.(interaction.commandName);if(command?.autocomplete)await command.autocomplete(interaction,client);else await interaction.respond([]).catch(()=>null);return;}
      if(!interaction?.customId&&!interaction?.isChatInputCommand?.())return;
      if(interaction.isChatInputCommand?.()){const command=client.commands?.get?.(interaction.commandName);if(!command)return;await command.execute(interaction,client);return;}
      if(await handleLegacyRolePage(interaction))return;
      prepareLegacyRoleInteraction(interaction);
      const customId=String(interaction.customId||'');
      if (interaction.__goliathPermissionsStudioHandled) return;
      if (customId.startsWith('admin:security-hub') || customId.startsWith('admin:server-security') || customId.startsWith('admin:security-isolation')) {
        const method = customId.startsWith('admin:security-hub') ? 'handleSecurityHubInteraction'
          : customId.startsWith('admin:server-security') ? 'handleServerSecurityInteraction'
            : 'handleSecurityIsolationInteraction';
        if (!await callHandler(adminCommand, method, interaction)) throw new Error(`Admin security control did not handle ${customId}.`);
        return;
      }
      if(customId.startsWith('permstudio:')||customId.startsWith('permedit:')||customId.startsWith('permbulk:')||customId.startsWith('permpreset:')||customId.startsWith('permsync:')||customId.startsWith('permaccess:')||customId.startsWith('permfinder:')||customId.startsWith('permaudit:')||customId.startsWith('permrestore:')){await permissionsStudioInteractions.execute(interaction,client);return;}
      if(customId.startsWith('mod_')||customId.startsWith('mod:')){if(!await callHandler(modInteractions,'handleModInteraction',interaction))throw new Error(`Mod did not handle ${customId}.`);return;}
      if(isVerificationMemberInteraction(interaction)){await handleVerificationMemberInteraction(interaction);return;}
      if(await enforceAdminModuleAuthority(interaction))return;
      if(customId==='admin:studio:roleStudio'){if(!roleStudioPanel||typeof roleStudioPanel.buildRoleStudioPanel!=='function')throw new Error('Role Studio panel is unavailable.');if(!interaction.deferred&&!interaction.replied)await interaction.deferUpdate();const payload=await roleStudioPanel.buildRoleStudioPanel(interaction.guild,interaction.member?.displayName||interaction.user?.username||'Unknown User');await interaction.editReply(payload);return;}
      if(customId.startsWith('admin:roleSelector')||customId.startsWith('roleSelector:')||customId.startsWith('admin:colourRoles')||customId.startsWith('colourRoles:')){if(!await callHandler(roleSelectorPanel,'handleRoleSelectorInteraction',interaction))throw new Error(`Role Selector did not handle ${customId}.`);return;}
      if(customId.startsWith('admin:privateRooms')||customId.startsWith('user:privateRooms:')||customId.startsWith('privateRooms:')){const handler=customId.startsWith('admin:privateRooms')?'handleAdminInteraction':customId.startsWith('user:privateRooms:')?'handleUserInteraction':'handleInteraction';if(!await callHandler(privateRoomsPanel,handler,interaction))throw new Error(`Private Rooms did not handle ${customId}.`);return;}
      const isTicketRuntimeInteraction=customId.startsWith('ticket_')||customId.startsWith('goliath_ticket_');
      if(isTicketRuntimeInteraction&&interaction.guildId&&guildManager.isModuleEnabled?.(interaction.guildId,'tickets')===false){await interaction.reply({content:'❌ Tickets is currently disabled for this server.',flags:MessageFlags.Ephemeral});return;}
      if(await callHandler(userPanelInteractions,'handleUserPanelInteraction',interaction))return;
      if(await callHandler(restoreRequestManager,'handleRestoreButton',interaction))return;
      if (customId === 'admin:embed' || customId.startsWith('embed:')) {
        if (!embedStudio || typeof embedStudio.handleInteraction !== 'function') throw new Error('Embed Studio interaction handler is unavailable.');
        if (!await callHandler(embedStudio, 'handleInteraction', interaction)) throw new Error(`Embed Studio did not handle ${customId}.`);
        return;
      }
      if(await callHandler(verificationAdminPanel,'handleVerificationAdminInteraction',interaction))return;
      if(await callHandler(automodPanel,'handleAutomodInteraction',interaction))return;
      if(startsWith(interaction,'admin:birthdays')){if(!await callHandler(birthdaysPanel,'handleAdmin',interaction))throw new Error(`Birthdays administration did not handle ${customId}.`);return;}
      if(startsWith(interaction,'birthdays:user:')){if(!await callHandler(birthdaysPanel,'handleUser',interaction))throw new Error(`Birthdays member controls did not handle ${customId}.`);return;}
      if(startsWith(interaction,'admin:invites')||startsWith(interaction,'invites:')){const invites=loadInvitesAdminPanel();if(!invites)throw invitesAdminPanelError||new Error('Invite Studio handler unavailable.');await invites.handleInviteStudioInteraction(interaction);return;}
      if((startsWith(interaction,'admin:social')||startsWith(interaction,'social:'))&&await callHandler(socialAdminPanel,'handleInteraction',interaction))return;
      if(startsWith(interaction,'social:creator:')){if(!await callHandler(socialCreatorActionCompat,'handle',interaction))throw new Error(`Social creator controls did not handle ${customId}.`);return;}
      if(startsWith(interaction,'admin:autoRoles')&&await callHandler(autorolesPanel,'handleAutoRolesInteraction',interaction))return;
      if(startsWith(interaction,'admin:temporaryRoles')&&await callHandler(temporaryRolesPanel,'handleTemporaryRolesInteraction',interaction))return;
      if(startsWith(interaction,'admin:timedRoles')&&await callHandler(timedRolesPanel,'handleTimedRolesInteraction',interaction))return;
      if(startsWith(interaction,'admin:welcome')&&await callHandler(welcomePanel,'handleWelcomeInteraction',interaction))return;
      if(startsWith(interaction,'admin:goodbye')&&await callHandler(goodbyePanel,'handleGoodbyeInteraction',interaction))return;
      if(startsWith(interaction,'admin:reactionRoles')&&await callHandler(reactionRolesAdminPanel,'handleReactionRolesAdminInteraction',interaction))return;
      if(startsWith(interaction,'admin:schedule')&&await callHandler(schedulePanel,'handleScheduleAdminInteraction',interaction))return;
      if(startsWith(interaction,'schedule:rsvp:')&&await callHandler(scheduleDeployment,'handleMemberInteraction',interaction))return;
      if(await callHandler(statsAdminPanel,'handleStatsAdminInteraction',interaction))return;
      if(await callHandler(suggestionsInteractions,'handleSuggestionsAdminInteraction',interaction))return;
      if(await callHandler(giveawaysAdminPanel,'handleGiveawaysAdminInteraction',interaction))return;
      if(await callHandler(formsInteractions,'handleFormsAdminInteraction',interaction))return;
      if(await callHandler(pollsInteractions,'handlePollsInteraction',interaction))return;
      if(await callHandler(starboardPanel,'handleStarboardAdminInteraction',interaction))return;
      if(await callHandler(stickyAdminPanel,'handleStickyAdminInteraction',interaction))return;
      if(await callHandler(levelingInteractions,'handleLevelingInteraction',interaction))return;
      if(await callHandler(moduleAdminPanels,'handleModuleAdminInteraction',interaction))return;
      if(await callHandler(adminPanel,'handleAdminNavigation',interaction))return;
      if(await callHandler(duplicator,'handleInteraction',interaction))return;
      if(interaction.isButton?.()&&await callHandler(tempVoiceInteractionHandler,'handleTempVoiceInteraction',interaction,client))return;
      if(await callHandler(faqInteractions,'handleFaqInteraction',interaction))return;
      if(await callHandler(formsInteractions,'handleFormsInteraction',interaction))return;
      if(await callHandler(suggestionsInteractions,'handleSuggestionsInteraction',interaction))return;
      if(await callHandler(giveawaysInteractionHandler,'handleGiveawayInteraction',interaction))return;
      if(await callHandler(ticketInteractionHandler,'handleTicketInteraction',interaction,client))return;
      // An unrecognised component must receive a response instead of silently
      // expiring. Commands and autocomplete are handled separately above.
      if(interaction.isMessageComponent?.()||interaction.isModalSubmit?.()){
        console.warn(`[InteractionCreate] Unhandled component: ${customId}`);
        await safeInteractionError(interaction,new Error('This control is no longer available or its handler is missing.'));
        return;
      }
    }catch(error){console.error('[InteractionCreate] Failed to handle interaction:',error);await safeInteractionError(interaction,error);}
  },
};