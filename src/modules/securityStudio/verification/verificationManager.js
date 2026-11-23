'use strict';

const { ActionRowBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { navigationButton } = require('../../../core/guild/goliathNavigation');
const verificationStore = require('./verificationStore');
const guildManager = require('../../../core/guild/guildManager');
const guildVariables = require('../../../core/guild/guildVariables');
const testDevOverride = require('../../../owner/dev/DevOverrideManager');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
const { buildVerificationNotice } = require('../../../core/ui/systemNotices');

const CUSTOM_ID_PREFIX='verify', SCREENING_FEATURE='MEMBER_VERIFICATION_GATE_ENABLED', MODULE='verification';
const BUTTON_STYLES={primary:ButtonStyle.Primary,secondary:ButtonStyle.Secondary,success:ButtonStyle.Success,danger:ButtonStyle.Danger};
const DEFAULT_HELPERS=guildVariables.HELPERS;
const locks=new Set();
const cleanId=v=>{const id=String(v||'').replace(/[<@&#!>]/g,'').trim();return /^\d{15,25}$/.test(id)?id:null;};
const cleanIds=v=>[...new Set((Array.isArray(v)?v:v?[v]:[]).map(cleanId).filter(Boolean))];
const unique=a=>[...new Set(a.filter(Boolean))];
const now=()=>new Date().toISOString();
function canManageVerification(m){return Boolean(m?.permissions?.has(PermissionFlagsBits.Administrator)||m?.permissions?.has(PermissionFlagsBits.ManageGuild));}
function getBotMember(g){return g?.members?.me||g?.members?.cache?.get(g.client.user.id)||null;}
function isDevOwnerTestMember(m){return testDevOverride.isDevOwnerHierarchyOverride({guild:m?.guild,member:m,user:m?.user,userId:m?.id});}
function canBotManageMember(m){const b=getBotMember(m?.guild);if(!b||!m||m.id===b.id)return false;if(isDevOwnerTestMember(m))return true;const {isBotOwner}=require('../../../core/security/protection/core');return !isBotOwner(m.id);}
function canBotManageRole(g,r){const b=getBotMember(g);return Boolean(b&&r&&!r.managed&&r.id!==g.id&&b.permissions.has(PermissionFlagsBits.ManageRoles)&&b.roles.highest.position>r.position);}
function hasDiscordScreening(g){return Boolean(g?.features?.includes?.(SCREENING_FEATURE));}
function buildVerifyCustomId(id){return `${CUSTOM_ID_PREFIX}:button:${id}`;}
function parseVerifyCustomId(v=''){const [p,a,id]=String(v).split(':');return p===CUSTOM_ID_PREFIX&&a==='button'&&id?{panelId:id}:null;}
function renderTemplate(t,m=null,g=null,v={}){return guildVariables.renderVerificationTemplate(t,m,g,v);}
function renderMessage(t,m,v={}){return renderTemplate(t,m,m?.guild||null,v);}
function buildVerificationEmbed(p={},g=null,m=null,v={}){const e=new EmbedBuilder().setColor(renderTemplate(p.color||'#5865f2',m,g,v)).setDescription(renderTemplate(p.description||'Press the button below to begin verification.',m,g,v));if(p.showHeader!==false&&p.title)e.setTitle(renderTemplate(p.title,m,g,v));if(p.showFooter!==false&&p.footer)e.setFooter({text:renderTemplate(p.footer,m,g,v)});if(p.showTimestamp!==false)e.setTimestamp();const th=renderTemplate(p.thumbnailUrl||'',m,g,v),im=renderTemplate(p.imageUrl||'',m,g,v);if(/^https?:\/\//i.test(th))e.setThumbnail(th);if(/^https?:\/\//i.test(im))e.setImage(im);return e;}
function buildVerificationRows(p={},g=null,m=null,v={}){const b=navigationButton(buildVerifyCustomId(p.panelId||p.id), renderTemplate(p.buttonLabel||'Verify',m,g,v).slice(0,80), BUTTON_STYLES[p.buttonStyle]||ButtonStyle.Success);const emoji=renderTemplate(p.buttonEmoji||'',m,g,v).trim();if(emoji)b.setEmoji(emoji);return [new ActionRowBuilder().addComponents(b)];}
async function resolvePayload(g,p){return g?.client?emojiPayload.resolveMessagePayload(g.client,g.id,p,'verification'):p;}
function getEffectiveVerificationSection(id){const s=verificationStore.getVerificationSection(id);return {...s,enabled:guildManager.isModuleEnabled(id,MODULE),settings:verificationStore.normalizeSettings(s.settings||{})};}
function getVerificationStatus(id){return getEffectiveVerificationSection(id);}
function setVerificationEnabled(id,en=true,meta={}){guildManager.setModuleEnabled(id,MODULE,en===true,meta);return getEffectiveVerificationSection(id);}
function toggleVerification(id,meta={}){return setVerificationEnabled(id,!guildManager.isModuleEnabled(id,MODULE),{action:'verification_toggle',...meta});}
function updateVerificationSettings(id,s={},meta={}){return verificationStore.updateConfiguration(id,x=>({...x,settings:verificationStore.normalizeSettings({...x.settings,...s}),updatedAt:now()}),{action:'verification_settings_update',...meta});}
function updateVerificationMessages(id,m={},meta={}){return verificationStore.updateMessages(id,m,{action:'verification_messages_update',...meta});}
function updatePanelTemplate(id,t={},meta={}){return verificationStore.updatePanelTemplate(id,t,{action:'verification_panel_template_update',...meta});}
async function fetchRole(g,id){return !g||!id?null:g.roles.cache.get(id)||g.roles.fetch(id).catch(()=>null);}
async function fetchRoles(g,ids=[]){return (await Promise.all(cleanIds(ids).map(id=>fetchRole(g,id)))).filter(Boolean);}
function roleMentions(r=[]){return r.map(x=>`<@&${x.id}>`).join(', ');}
function roleSet(r=[]){return [...new Map(r.filter(Boolean).map(x=>[x.id,x])).values()];}
async function applyRoleTransition(m,adds=[],removes=[],reason='Goliath verification role transition'){const g=m.guild,a=roleSet(adds),r=roleSet(removes).filter(x=>!a.some(y=>y.id===x.id));if(!canBotManageMember(m))throw new Error('Goliath cannot manage this member.');for(const role of [...a,...r])if(!canBotManageRole(g,role)&&((a.includes(role)&&!m.roles.cache.has(role.id))||(r.includes(role)&&m.roles.cache.has(role.id))))throw new Error(`Goliath cannot manage the ${role.name} role.`);const added=[],removed=[];try{for(const role of a)if(!m.roles.cache.has(role.id)){await m.roles.add(role,reason);added.push(role);}for(const role of r)if(m.roles.cache.has(role.id)){await m.roles.remove(role,reason);removed.push(role);}const member=await g.members.fetch({user:m.id,force:true});return {member,added,removed};}catch(e){const failures=[];for(const role of added.reverse())try{await m.roles.remove(role,'Goliath verification rollback');}catch(error){failures.push({roleId:role.id,action:'remove',error:String(error?.message||error)});}for(const role of removed.reverse())try{await m.roles.add(role,'Goliath verification rollback');}catch(error){failures.push({roleId:role.id,action:'restore',error:String(error?.message||error)});}if(failures.length){history(g.id,m.id,'verification_role_rollback_failed',{failures});throw new Error('Verification role transition failed and rollback was incomplete. Staff intervention required.');}throw e;}}
function roleIds(s,key){return cleanIds(s.roles?.[key]||[]);}
function enabledSecurity(s){const sec=s.security||{},map={simple:'simple',captcha:'captcha',minigame:'minigame',account_age:'accountAge',discord_screening:'discordScreening',bot_protection:'botProtection',staff_approval:'staffApproval',one_time_challenge:'oneTimeChallenge',risk_based:'riskBased',rejoin_history:'rejoinHistory'};const ordered=Array.isArray(s.flow?.orderedSecurity)?s.flow.orderedSecurity:[];return unique([...ordered.filter(k=>map[k]&&sec[map[k]]===true),...Object.keys(map).filter(k=>sec[map[k]]===true)]);}
function hasAnyRole(m,ids){return cleanIds(ids).some(id=>m.roles.cache.has(id));}
function isBypass(m,s){return hasAnyRole(m,roleIds(s,'bypass'))||(s.allowStaffBypass&&canManageVerification(m));}
async function logEvent(g,section,type,content,subjectUserId=null){
  if(!content)return false;
  const threadMode=section.settings?.threadLogging?.mode;
  // A member security passport has exactly one destination in threaded mode.
  // Category-specific routes are exclusively for standard channel logging.
  const configured=threadMode==='threaded'||threadMode==='hybrid'
    ?section.settings?.threadLogging?.channelId
    :section.settings?.logs?.[`${type}ChannelId`]||section.settings?.logChannelId;
  const c=configured?(g.channels.cache.get(configured)||await g.channels.fetch(configured).catch(()=>null)):null;
  const raw=String(content).trim();
  const styles={
    join:{emoji:'⏳',title:'Verification Pending',color:0xfefefe,status:'Unverified',access:'Restricted'},
    attempt:{emoji:'🔐',title:'Verification Activity',color:0x5865f2,status:'In progress',access:'Restricted'},
    success:{emoji:'✅',title:'Verification Successful',color:0x2ecc71,status:'Verified',access:'Granted'},
    failure:{emoji:'❌',title:'Verification Failed',color:0xe74c3c,status:'Failed',access:'Restricted'},
    roles:{emoji:'🛡️',title:'Verification Roles Confirmed',color:0x2ecc71,status:'Confirmed',access:'Granted'},
    quarantine:{emoji:'🚨',title:'Member Quarantined',color:0xe74c3c,status:'Quarantined',access:'Restricted'},
    error:{emoji:'⚠️',title:'Verification Error',color:0xe74c3c,status:'Action required'},
    bot:{emoji:'🤖',title:'Bot Verification Event',color:0x95a5a6,status:'Recorded'},
    staff:{emoji:'🛡️',title:'Verification Staff Decision',color:0x5865f2,status:'Recorded'},
    intelligence:{emoji:'🧠',title:'Verification Intelligence',color:0x5865f2,status:'Recorded'},
    raid:{emoji:'🚨',title:'Verification Raid Event',color:0xe74c3c,status:'Recorded'}
  };
  let style=styles[type]||{emoji:'📋',title:'Verification Event',color:0x5865f2,status:'Recorded'};
  const method=raw.match(/(?:started |incorrect )(captcha|minigame|one time challenge|one_time_challenge|staff approval|staff_approval)/i)?.[1];
  const methodLabel=method?({'captcha':'CAPTCHA','minigame':'Mini-game','one time challenge':'One-time Challenge','staff approval':'Staff Approval'}[method.toLowerCase().replace(/_/g,' ')]||'Security Check'):null;
  if(type==='attempt'&&methodLabel)style={...style,title:methodLabel+' Started'};
  if(type==='attempt'&&raw.includes('completed Discord Membership Screening'))style={...style,title:'Membership Screening Complete',status:'Screening passed',emoji:'✅'};
  if(type==='attempt'&&raw.includes('Goliath security challenges: not started.'))style={...style,title:'Discord Entry State Observed',status:'Unverified',emoji:'📋',color:0xfefefe};
  if(type==='attempt'&&(raw.includes('Pending role assignment confirmed by Discord.')||raw.includes('Pending role check: no Pending roles configured.')))style={...style,title:'Pending Access Confirmed',status:'Unverified',emoji:'🛡️',color:0xfefefe};
  if(type==='failure'&&raw.includes('Challenge remains active.'))style={...style,title:'Incorrect '+(methodLabel||'Security')+' Answer',status:'Retry available'};
  const mention=raw.match(/<@!?(\d{15,25})>/);
  const userId=mention?.[1]||(/^[0-9]{15,25}$/.test(String(subjectUserId||''))?String(subjectUserId):null);
  const member=userId?(g.members?.cache?.get(userId)||await g.members?.fetch?.(userId).catch(()=>null)):null;
  const username=member?.user?.username||null;
  let details=raw.replace(/^(?:🚪|🔐|✅|❌|⚠️|🚨|🤖|📋)\s*/u,'').trim();
  const isDefaultJoin=type==='join'&&userId&&/^<@!?\d{15,25}> entered Verification\.?$/i.test(details);
  if(isDefaultJoin)details='Member is awaiting the required Goliath security checks.';
  const timestamp=Math.floor(Date.now()/1000);
  const joinedAt=member?.joinedTimestamp||null;
  const joinedSeconds=Number.isFinite(joinedAt)&&joinedAt>0?Math.floor(joinedAt/1000):null;
  // A visible, identical section divider establishes a shared natural embed width.
  const sectionRule='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  const embed=new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({name:`${g.name||'Server'} • Security`,...(g.iconURL?.({size:128})?{iconURL:g.iconURL({size:128})}:{})})
    .setTitle(`${style.emoji} ${style.title}`)
    .setDescription(sectionRule)
    .addFields(
      {name:'👤 Member',value:userId?`<@${userId}>`:'Not applicable',inline:false},
      {name:'🏷️ Discord Username',value:username?`\`${username.replace(/`/g,'').slice(0,32)}\``:'Unavailable',inline:true},
      {name:'🆔 User ID',value:userId?`\`${userId}\``:'Not applicable',inline:true},
      {name:'🔐 Status',value:style.status,inline:true},
      {name:'🛡️ Access',value:style.access||'Not applicable',inline:true},
      {name:'📅 Joined Server',value:joinedSeconds?`<t:${joinedSeconds}:d>`:'Unavailable',inline:true},
      {name:'🕒 Event Time',value:`<t:${timestamp}:t> • <t:${timestamp}:R>`,inline:true},
      {name:'📋 Event Details',value:(details||'No additional details.').slice(0,1024),inline:false}
    )
    .setFooter({text:'Goliath Verification'})
    .setTimestamp();
  const options={embeds:[embed],allowedMentions:{parse:[],users:[],roles:[]}};
  const t=section.settings?.threadLogging;
  if(t?.mode!=='standard'&&t?.channelId&&userId&&!['raid','bot'].includes(type)){
    try{
      if(await deliverVerificationThread(g,userId,username,t,type,embed,options,style))return true;
    }catch(error){console.error('[Verification] Thread delivery fallback:',error?.message||error);}
  }
  try{
    if(threadMode==='threaded'||threadMode==='hybrid')return false;
    if(!c?.send)return false;
    await c.send(options);
    return true;
  }catch(error){
    console.error('[Verification] Log embed delivery failed:',error?.message||error);
    return false;
  }
}
const verificationThreadQueues=new Map();
async function deliverVerificationThread(g,userId,username,t,type,embed,options,style){
  const key=g.id+':'+userId;
  const previous=verificationThreadQueues.get(key)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
    const session=verificationStore.getSession(g.id,userId);
    if(!session)return false;
    const parent=g.channels.cache.get(t.channelId)||await g.channels.fetch(t.channelId).catch(()=>null);
    if(!parent?.threads||parent.type!==0||parent.permissionsFor(g.roles.everyone)?.has('ViewChannel')!==false)return false;
    const subject=await g.members.fetch(userId).catch(()=>null);
    if(subject&&parent.permissionsFor(subject)?.has('ViewChannel')!==false)return false;
    const botMember=g.members.me;
    if(!botMember||!parent.permissionsFor(botMember)?.has(['ViewChannel','SendMessages','CreatePublicThreads','SendMessagesInThreads']))return false;
    let thread=session.logThreadSessionId===session.sessionId&&session.logThreadId?await g.channels.fetch(session.logThreadId).catch(()=>null):null;
    if(thread?.parentId!==parent.id)thread=null;
    if(verificationStore.getSession(g.id,userId)?.sessionId!==session.sessionId)return false;
    if(thread?.locked)return false;
    let summaryId=thread?session.logSummaryId:null;
    // Threaded/hybrid mode: keep the parent as a compact case index.
    // The detailed identity, event history and evidence stay inside the thread.
    const caseSummaryOptions=threadId=>{
      const card=EmbedBuilder.from(embed);
      card.setColor(0xfefefe);
      card.setTitle('🧵 Verification • '+(username||userId).slice(0,48));
      card.setDescription(`**Member:** <@${userId}>\n**Status:** ${style.status||'Pending'}\n**Activity:** ${threadId?`[Open member case](https://discord.com/channels/${g.id}/${threadId})`:'Creating member case…'}`);
      card.setFields([]);
      return {embeds:[card],allowedMentions:{parse:[],users:[],roles:[]}};
    };
    if(!thread){
      const name=('Verification • '+(t.naming==='id'?userId:t.naming==='username'?(username||userId):(username||'Member')+' • '+userId)).slice(0,100);
      // Starting the thread from its parent case card avoids a second,
      // disconnected thread-start notification and keeps the case discoverable.
      const summary=await parent.send(caseSummaryOptions(null));
      summaryId=summary.id;
      thread=await summary.startThread({name,autoArchiveDuration:10080});
      if(verificationStore.getSession(g.id,userId)?.sessionId!==session.sessionId)return false;
      setSession(g.id,userId,{logThreadId:thread.id,logThreadSessionId:session.sessionId,logSummaryId:summaryId});
    }
    // A staff-locked case must not be reopened by automated logging.
    if(thread.locked)return false;
    if(thread.archived)await thread.setArchived(false);
    if(verificationStore.getSession(g.id,userId)?.sessionId!==session.sessionId)return false;
    await thread.send(options);
    if(!summaryId){
      const summary=await parent.send(caseSummaryOptions(thread.id));
      summaryId=summary.id;
      if(verificationStore.getSession(g.id,userId)?.sessionId===session.sessionId)setSession(g.id,userId,{logSummaryId:summaryId});
    }else{
      try{const summary=await parent.messages.fetch(summaryId);await summary.edit(caseSummaryOptions(thread.id));}
      catch(error){console.error('[Verification] Case summary update failed:',error?.message||error);}
    }
    if(verificationStore.getSession(g.id,userId)?.sessionId!==session.sessionId)return true;
    if(type==='roles'&&verificationStore.getSession(g.id,userId)?.state==='verified'){
      try{if(t.lockOnSuccess)await thread.setLocked(true);if(t.archiveOnSuccess)await thread.setArchived(true);}catch(error){console.error('[Verification] Thread closure failed:',error?.message||error);}
    }
    const state=verificationStore.getSession(g.id,userId)?.state;
    if((type==='failure'&&['failed','rejected','timed_out'].includes(state)&&t.archiveOnFailure)||(type==='quarantine'&&state==='quarantined'&&t.archiveOnQuarantine)){
      try{await thread.setArchived(true);}catch(error){console.error('[Verification] Case archive failed:',error?.message||error);}
    }
    return true;
  });
  verificationThreadQueues.set(key,work);
  try{return await work;}finally{if(verificationThreadQueues.get(key)===work)verificationThreadQueues.delete(key);}
}
function setSession(gid,uid,patch){return verificationStore.upsertSession(gid,uid,patch);}
function history(gid,uid,type,data={}){verificationStore.addSecurityHistory(gid,uid,{type,...data});}
function accountAgeDays(m){return (Date.now()-Number(m?.user?.createdTimestamp||Date.now()))/86400000;}
function attemptBlock(section,m){const s=section.settings.security||{},a=verificationStore.effectiveAttempts(section.attempts?.[m.id],s);const max=Number(s.maximumFailedAttempts||0);if(max>0&&Number(a.failed||0)>=max)return {key:'limit',failed:Number(a.failed||0),max};const cd=Number(s.attemptCooldownSeconds||0);if(cd>0&&a.lastAttemptAt){const rem=Math.ceil((cd*1000-(Date.now()-new Date(a.lastAttemptAt).getTime()))/1000);if(rem>0)return {key:'cooldown',remaining:rem};}return null;}
async function quarantineMember(m,section,reason='Verification attempt limit reached'){const s=section.settings,roles=await fetchRoles(m.guild,roleIds(s,'quarantine')),remove=await fetchRoles(m.guild,unique([...roleIds(s,'pending'),...roleIds(s,'verifying')]));if(!roles.length||roles.length!==roleIds(s,'quarantine').length||remove.length!==unique([...roleIds(s,'pending'),...roleIds(s,'verifying')]).length)throw new Error('Quarantine requires all configured roles to exist.');const t=await applyRoleTransition(m,roles,remove,'Goliath verification quarantine');const confirmed=await m.guild.members.fetch({user:m.id,force:true}).catch(()=>null);if(!confirmed||!roles.every(role=>confirmed.roles.cache.has(role.id))||remove.some(role=>confirmed.roles.cache.has(role.id)))throw new Error('Quarantine role transition could not be confirmed.');setSession(m.guild.id,m.id,{state:'quarantined',quarantinedAt:now()});history(m.guild.id,m.id,'quarantined',{reason});verificationStore.incrementAnalytics(m.guild.id,{quarantined:1,lastQuarantineAt:now()});await logEvent(m.guild,section,'quarantine',renderMessage(section.messages.quarantineLog||section.messages.quarantined,t.member,{attempts:section.attempts?.[m.id]?.failed||0,reason}));return t;}
async function recordFailure(m,section,step,reason){const a=verificationStore.recordAttempt(m.guild.id,m.id,{failed:true,step,reason});verificationStore.incrementAnalytics(m.guild.id,{failed:1,lastFailedAt:now()});setSession(m.guild.id,m.id,{state:'verifying',failedAttempts:Number(a?.failed||0)});history(m.guild.id,m.id,'security_failed',{step,reason,failed:Number(a?.failed||0)});await logEvent(m.guild,section,'failure',renderMessage(section.messages.failureLog,m,{reason}));const limit=Number(section.settings.security?.maximumFailedAttempts??5);if(section.settings.security?.quarantineOnLimit!==false&&section.settings.quarantine?.enabled!==false&&limit>0&&Number(a?.failed||0)>=limit){await quarantineMember(m,getEffectiveVerificationSection(m.guild.id),reason);return {ok:false,quarantined:true,message:renderMessage(section.messages.quarantined,m,{attempts:a.failed})};}return {ok:false,message:renderMessage(section.messages.retry||section.messages.failed,m,{reason,attemptsRemaining:Math.max(0,limit-Number(a?.failed||0))})};}
async function assignPendingRoles(m,reason='Goliath pending verification role assigned'){const section=getEffectiveVerificationSection(m.guild.id);if(!section.enabled)return {assigned:[],failed:[],skipped:true};const markFailure=async message=>{history(m.guild.id,m.id,'role_error',{stage:'pending',reason:message});setSession(m.guild.id,m.id,{state:'review',activeSecurityMethod:null,activeChallenge:null});await logEvent(m.guild,section,'error',`⚠️ Verification Pending-role assignment failed for ${m.user?.tag||m.id}: ${message}`);return {assigned:[],failed:[{reason:message}],review:true,skipped:false};};const ids=roleIds(section.settings,'pending');const roles=await fetchRoles(m.guild,ids);if(ids.length!==roles.length)return markFailure('Configured Pending roles are missing');if(!roles.length){history(m.guild.id,m.id,'pending_roles_not_configured',{});await logEvent(m.guild,section,'attempt',`<@${m.id}> Pending role check: no Pending roles configured. Verified access remains locked until Goliath security completes.`,m.id);return {assigned:[],failed:[],skipped:true};}try{const t=await applyRoleTransition(m,roles,[],reason);if(!roles.every(role=>t.member.roles.cache.has(role.id)))return markFailure('Pending role assignment could not be confirmed');history(m.guild.id,m.id,'pending_roles_confirmed',{roleIds:roles.map(role=>role.id)});await logEvent(m.guild,section,'attempt',`<@${m.id}> Pending role assignment confirmed by Discord. Assigned roles: ${roles.map(role=>role.name).join(', ')}. Verified access remains locked.`,m.id);return {assigned:t.added,failed:[],skipped:false};}catch(e){return markFailure(String(e?.message||e));}}
async function assignArrivalRoles(m){return assignPendingRoles(m,'Goliath pending verification role assigned');}
async function handleMemberJoin(m){const section=getEffectiveVerificationSection(m.guild.id);if(!section.enabled)return {handled:false,assigned:[]};const s=section.settings;if(m.user?.bot){const roles=await fetchRoles(m.guild,roleIds(s,'bot'));if(s.botPolicy?.allowConfiguredBots===false){history(m.guild.id,m.id,'bot_role_assignment_skipped',{reason:'Configured bot roles disabled by policy'});await logEvent(m.guild,section,'bot',`🤖 ${m.user.tag||m.id} joined; Verification bot-role assignment was skipped by policy.`);return {handled:true,bot:true,skipped:true,assigned:[]};}try{const t=roles.length?await applyRoleTransition(m,roles,[],'Goliath approved bot role'): {added:[]};history(m.guild.id,m.id,'bot_joined',{assigned:t.added.map(r=>r.id)});return {handled:true,bot:true,assigned:t.added};}catch(e){history(m.guild.id,m.id,'bot_role_error',{reason:e.message});return {handled:true,bot:true,assigned:[],failed:[{reason:e.message}]};}}
const bypass=isBypass(m,s),required=bypass?[]:enabledSecurity(s);const verifiedIds=roleIds(s,'verified');const alreadyVerified=bypass;verificationStore.resetActiveSession(m.guild.id,m.id);setSession(m.guild.id,m.id,{state:alreadyVerified?'verified':'pending',pendingLogSent:false,requiredSecurity:required,completedSecurity:[],startedAt:null,verifiedAt:alreadyVerified?now():null,flags:[],activeChallenge:null,activeSecurityMethod:null,staffApprovalContinuationPending:false,staffActionProcessingPending:false,raidPressure:false,securityConfigRevision:section.configRevision});history(m.guild.id,m.id,'member_joined',{bypass,alreadyVerified,requiredSecurity:required});if(!bypass){await logVerificationPending(m,section);history(m.guild.id,m.id,'discord_screening_initial_state',{pending:m.pending===true,known:m.pending===true||m.pending===false});await logEvent(m.guild,section,'attempt',`<@${m.id}> joined. Discord membership screening: ${m.pending===true?'Pending Discord screening/application clearance':m.pending===false?'Member admitted; no pending screening flag at join. Discord application approval actor/event not available to Goliath':'Status unavailable'}. Goliath security challenges: not started.`,m.id);}if(!bypass){await reconcileDiscordScreening(m,section,'member_join');if(!(hasDiscordScreening(m.guild)&&(s.security?.discordScreening===true||s.flow?.discordScreeningGate===true))&&m.pending!==true)await logVerificationPending(m,section);}if(bypass)return {handled:true,bypass:true,alreadyVerified,assigned:[]};return assignPendingRoles(m,'Goliath pending verification role assigned on join');}
async function logVerificationPending(m,section){
  const session=verificationStore.getSession(m.guild.id,m.id);
  if(!session||session.state==='verified'||session.pendingLogSent===true)return;
  setSession(m.guild.id,m.id,{pendingLogSent:true});
  const delivered=await logEvent(m.guild,section,'join',`🚪 ${m} entered Verification.`);
  if(!delivered)setSession(m.guild.id,m.id,{pendingLogSent:false});
}
async function reconcileDiscordScreening(m,section,source,observedTransition=false){
  if(!m?.guild?.id||m.user?.bot||!section.enabled||m.pending!==false)return {handled:false};
  // A non-pending member is not evidence of a completed screening transition.
  // Only a witnessed Discord pending:true -> pending:false update proves clearance.
  if(!observedTransition)return {handled:false};
  const gid=m.guild.id,uid=m.id,session=verificationStore.getSession(gid,uid);
  if(!session||session.screeningLoggedSessionId===session.sessionId)return {handled:false};
  const sessionId=session.sessionId;
  setSession(gid,uid,{screeningLoggedSessionId:sessionId});
  history(gid,uid,'discord_screening_completed',{source});
  verificationStore.incrementAnalytics(gid,{screeningCompleted:1,lastScreeningCompletedAt:now()});
  await logEvent(m.guild,section,'attempt',`<@${uid}> completed Discord Membership Screening. Discord confirmed the pending flag was cleared. Approving administrator: not provided by Discord.`,uid);
  await logVerificationPending(m,section);
  return {handled:true,screeningCompleted:true};
}
async function handleMemberUpdate(oldM,newM){if(!newM?.guild?.id||newM.user?.bot||!(oldM?.pending===true&&newM.pending===false))return {handled:false};return reconcileDiscordScreening(newM,getEffectiveVerificationSection(newM.guild.id),'member_update',true);}

function getRequestedPanelId(i){return i?.panelId?String(i.panelId):parseVerifyCustomId(i?.customId)?.panelId||null;}
function getActivePanel(gid,id,ctx={}){const s=verificationStore.getVerificationSection(gid),p=s.panels?.[id];if(!id||s.activePanelId!==id||!p||p.enabled===false||p.deletedAt||p.retiredAt)return null;const mid=cleanId(ctx.messageId||ctx.message?.id),cid=cleanId(ctx.channelId||ctx.channel?.id);if(p.messageId&&mid!==p.messageId)return null;if(p.channelId&&cid!==p.channelId)return null;return p;}
async function verifyMember(i){const g=i?.guild,gid=i?.guildId||g?.id,uid=i?.user?.id||i?.member?.id;if(!g||!gid||!uid)return {ok:false,message:'Server unavailable.'};const panel=getActivePanel(gid,getRequestedPanelId(i),i);if(!panel)return {ok:false,message:'This verification panel is no longer active. Please use the current verification panel.'};const key=`${gid}:${uid}`;if(locks.has(key))return {ok:false,message:'Verification is already processing. Please wait.'};locks.add(key);try{let section=getEffectiveVerificationSection(gid);const m=await g.members.fetch({user:uid,force:true}).catch(()=>null);if(!m||!section.enabled)return {ok:false,message:renderMessage(section.messages.unavailable,m)};const s=section.settings;if(m.user?.bot)return {ok:false,message:renderMessage(section.messages.botBlocked,m)};await reconcileDiscordScreening(m,section,'verify_button');require('./verificationChallengeRuntime').recover(gid,uid);let existing=verificationStore.getSession(gid,uid);if(existing?.state==='timed_out')return {ok:false,message:'Your Verification session has timed out. Contact server staff to restart verification.'};if(existing?.state==='quarantined'||existing?.state==='review')return {ok:false,quarantined:true,message:renderMessage(section.messages.quarantined,m)};if(existing?.state==='rejected')return {ok:false,rejected:true,message:'Verification was rejected by staff. Contact server staff.'};if(existing?.state==='verified'){const assigned=roleIds(s,'verified');if(assigned.length&&assigned.every(id=>m.roles.cache.has(id)))return {ok:true,complete:true,message:'You are already verified.'};const pending=roleIds(s,'pending'),quarantine=roleIds(s,'quarantine');const mismatchReason=!assigned.length?'No Verified role is configured.':hasAnyRole(m,quarantine)?'Your account is restricted by quarantine.':hasAnyRole(m,assigned)?'Only some required Verified roles are assigned.':s.security?.allowReverification===false||s.allowReverification===false?'Repeat verification is disabled in server settings.':!pending.length?'No Unverified role is configured.':!hasAnyRole(m,pending)?'Your required Unverified role is missing.':null;if(mismatchReason){history(gid,uid,'verified_session_reconciliation_blocked',{reason:mismatchReason});return {ok:false,message:mismatchReason+' Please contact server staff.'};}verificationStore.resetActiveSession(gid,uid);existing=setSession(gid,uid,{state:'pending',requiredSecurity:enabledSecurity(s),completedSecurity:[],activeChallenge:null,activeSecurityMethod:null,staffApprovalContinuationPending:false,staffActionProcessingPending:false,securityConfigRevision:section.configRevision});history(gid,uid,'verified_session_reconciled',{reason:'pending_role_present_verified_roles_absent'});}if(!isBypass(m,s)){const pendingIds=roleIds(s,'pending');const verifyingIds=roleIds(s,'verifying');const continuing=existing?.state==='verifying'&&verifyingIds.length>0&&hasAnyRole(m,verifyingIds);if((s.requirePendingRole===true||pendingIds.length>0)&&!hasAnyRole(m,pendingIds)&&!continuing){history(gid,uid,'pending_role_required',{configuredPendingRoles:pendingIds.length});return {ok:false,message:renderMessage(section.messages.pendingRoleRequired,m)};}}if(isBypass(m,s))return completeVerification(m,section,true);const block=attemptBlock(section,m);if(block?.key==='cooldown')return {ok:false,message:renderMessage(section.messages.cooldown,m,{cooldownSeconds:block.remaining})};if(block?.key==='limit'){if(s.security?.quarantineOnLimit!==false&&s.quarantine?.enabled!==false){await quarantineMember(m,section,'Maximum failed attempts reached');return {ok:false,quarantined:true,message:renderMessage(section.messages.quarantined,m,{attempts:block.failed})};}return {ok:false,message:renderMessage(section.messages.failed,m,{reason:'Maximum failed attempts reached'})};}
for(const group of ['verified','verifying','pending','auto']){const ids=roleIds(s,group),resolved=await fetchRoles(g,ids);if(ids.length!==resolved.length)return {ok:false,message:renderMessage(section.messages.unavailable,m,{reason:`Configured ${group} roles are missing.`})};}if(!roleIds(s,'verified').length)return {ok:false,message:renderMessage(section.messages.unavailable,m)};const verifying=await fetchRoles(g,roleIds(s,'verifying')),pending=await fetchRoles(g,roleIds(s,'pending'));if(verifying.length){if(verifying.length!==roleIds(s,'verifying').length||pending.length!==roleIds(s,'pending').length)return {ok:false,message:renderMessage(section.messages.unavailable,m)};await applyRoleTransition(m,verifying,pending,'Goliath verification started');const confirmed=await g.members.fetch({user:uid,force:true}).catch(()=>null);if(!confirmed||!verifying.every(role=>confirmed.roles.cache.has(role.id))||pending.some(role=>confirmed.roles.cache.has(role.id)))return {ok:false,message:'Verification starting roles could not be confirmed. Contact server staff.'};}setSession(gid,uid,{state:'verifying',startedAt:verificationStore.getSession(gid,uid)?.startedAt||now()});return {ok:true,pendingSecurity:true,message:'Continuing the configured verification security checks.'};}catch(e){console.error('[Verification] Verification execution failed',{guildId:gid,userId:uid,error:e});const section=getEffectiveVerificationSection(gid);history(gid,uid,'verification_error',{reason:e.message});await logEvent(g,section,'error',`⚠️ Verification error for <@${uid}>: ${e.message}`);return {ok:false,message:renderMessage(section.messages.unavailable,i.member,{reason:e.message})};}finally{locks.delete(key);}}
async function completeVerification(m,section,bypass=false){if(!bypass||!isBypass(m,section.settings)){history(m.guild.id,m.id,'verification_completion_blocked',{reason:'unauthorised_legacy_completion'});return {ok:false,message:'Verification security checks must be completed before roles can be granted.'};}const s=section.settings,verified=await fetchRoles(m.guild,roleIds(s,'verified')),auto=await fetchRoles(m.guild,roleIds(s,'auto')),remove=await fetchRoles(m.guild,unique([...roleIds(s,'pending'),...roleIds(s,'verifying'),...roleIds(s,'quarantine')]));if(!verified.length||verified.length!==roleIds(s,'verified').length||auto.length!==roleIds(s,'auto').length||remove.length!==unique([...roleIds(s,'pending'),...roleIds(s,'verifying'),...roleIds(s,'quarantine')]).length)return {ok:false,message:renderMessage(section.messages.unavailable,m,{reason:'One or more configured roles are missing.'})};const t=await applyRoleTransition(m,[...verified,...auto],remove,'Goliath verification completed');const confirmed=await m.guild.members.fetch({user:m.id,force:true}).catch(()=>null);if(!confirmed||![...verified,...auto].every(role=>confirmed.roles.cache.has(role.id))||remove.some(role=>confirmed.roles.cache.has(role.id)))return {ok:false,message:'Verification role assignment could not be confirmed. Contact server staff.'};verificationStore.clearAttempts(m.guild.id,m.id);verificationStore.incrementAnalytics(m.guild.id,{verified:1,lastVerificationAt:now()});setSession(m.guild.id,m.id,{state:'verified',verifiedAt:now(),completedSecurity:bypass?[]:enabledSecurity(s)});history(m.guild.id,m.id,'verified',{bypass,roles:t.added.map(r=>r.id)});try{await require('../../roleStudio/autoRoles/autoRoles').releaseDeferredJoinRoles(confirmed);}catch(error){console.error('[Verification] Deferred Auto Roles release failed:',error);verificationStore.addSecurityHistory(m.guild.id,m.id,{type:'verification_deferred_release_failed',integration:'auto_roles',reason:String(error?.message||error).slice(0,300)});}try{const inviteRelease=await require('../../communityStudio/invites/invites').releaseDeferredInviteRoles(confirmed);if(Array.isArray(inviteRelease?.failed)&&inviteRelease.failed.length)verificationStore.addSecurityHistory(m.guild.id,m.id,{type:'verification_deferred_release_incomplete',integration:'invite_roles',failedRoleIds:inviteRelease.failed.map(String).slice(0,50)});}catch(error){console.error('[Verification] Deferred Invite Studio roles release failed:',error);verificationStore.addSecurityHistory(m.guild.id,m.id,{type:'verification_deferred_release_failed',integration:'invite_roles',reason:String(error?.message||error).slice(0,300)});}try{await require('../../messageStudio/welcome/welcome').releaseDeferredWelcome(confirmed);}catch(error){console.error('[Verification] Deferred Instant Welcome release failed:',error);verificationStore.addSecurityHistory(m.guild.id,m.id,{type:'verification_deferred_release_failed',integration:'welcome',reason:String(error?.message||error).slice(0,300)});}await logEvent(m.guild,section,'success',renderMessage(section.messages.successLog,t.member,{verifiedRoles:roleMentions(verified)}));if(s.dmOnVerify)await t.member.send(buildVerificationNotice({guild:m.guild,member:t.member,type:'success',roles:verified,values:{verifiedRoles:roleMentions(verified)}})).catch(()=>null);return {ok:true,message:renderMessage(section.messages.success,t.member,{verifiedRoles:roleMentions(verified)})};}
function configureVerification(id,input={},meta={}){if(typeof input.enabled==='boolean')guildManager.setModuleEnabled(id,MODULE,input.enabled,meta);verificationStore.updateVerificationSection(id,x=>({...x,settings:verificationStore.normalizeSettings({...x.settings,...(input.settings||{})}),messages:input.messages?verificationStore.normalizeMessages({...x.messages,...input.messages}):x.messages,updatedAt:now()}),meta);return getEffectiveVerificationSection(id);}
async function fetchPanelMessage(g,p){if(!g||!p?.channelId||!p?.messageId)return null;const c=g.channels.cache.get(p.channelId)||await g.channels.fetch(p.channelId).catch(()=>null);return c?.messages?.fetch?c.messages.fetch(p.messageId).catch(()=>null):null;}
function snapshotMessagePayload(m){return m?{embeds:(m.embeds||[]).map(e=>e.toJSON()),components:(m.components||[]).map(c=>c.toJSON())}:null;}
const panelOperationLocks=new Map();
async function withPanelOperation(gid,operation){const previous=panelOperationLocks.get(gid)||Promise.resolve();let release;const current=new Promise(resolve=>{release=resolve;});panelOperationLocks.set(gid,current);await previous;try{return await operation();}finally{release();if(panelOperationLocks.get(gid)===current)panelOperationLocks.delete(gid);}}
function assertPanelRevision(gid,meta){if(meta.expectedConfigRevision!=null&&Number(meta.expectedConfigRevision)!==Number(verificationStore.getVerificationSection(gid).configRevision))throw new Error('Verification configuration changed. Reload before saving.');}
async function deployVerificationPanel(c,input={},meta={}){if(!c?.guild?.id)throw new Error('A sendable channel is required.');return withPanelOperation(c.guild.id,()=>deployVerificationPanelUnlocked(c,input,meta));}
async function deployVerificationPanelUnlocked(c,input={},meta={}){assertPanelRevision(c.guild.id,meta);if(!c?.guild?.id||!c?.send)throw new Error('A sendable channel is required.');const g=c.guild,gid=g.id,s=getEffectiveVerificationSection(gid);if(!s.enabled)throw new Error('Verification module is disabled.');if(!roleIds(s.settings,'verified').length)throw new Error('Choose at least one Verified role before deploying Verification.');const old=input.panelId?verificationStore.getPanel(gid,input.panelId):null,id=old?.panelId||input.panelId||verificationStore.createId('verify_panel'),template=verificationStore.normalizePanelTemplate({...s.panelTemplate,...old,...input}),candidate={...old,...template,panelId:id,id,channelId:c.id,messageId:old?.messageId||null,createdBy:input.createdBy||old?.createdBy,createdAt:old?.createdAt||now()},payload=await resolvePayload(g,{embeds:[buildVerificationEmbed(candidate,g)],components:buildVerificationRows(candidate,g)}),existing=old?await fetchPanelMessage(g,old):null;if(existing?.editable&&old?.channelId===c.id){const rollback=snapshotMessagePayload(existing),message=await existing.edit(payload);try{return verificationStore.savePanel(gid,{...candidate,messageId:message.id,lastDeployedAt:now()},meta);}catch(e){if(rollback)await message.edit(rollback).catch(()=>null);throw e;}}const message=await c.send(payload);let saved;try{saved=verificationStore.savePanel(gid,{...candidate,messageId:message.id,enabled:true,lastDeployedAt:now()},meta);}catch(e){if(message.deletable)await message.delete().catch(()=>null);throw e;}if(existing&&existing.id!==message.id){try{if(existing.deletable)await existing.delete();else throw new Error('Old panel message cannot be deleted.');}catch(error){try{await existing.edit({components:[]});}catch(disableError){console.error('[Verification] Old panel cleanup failed:',disableError?.message||disableError);throw new Error('New panel deployed, but the old panel could not be disabled. Remove the old message manually.');}console.warn('[Verification] Old panel could not be deleted; its Verify button was disabled:',error?.message||error);}}return saved;}
async function refreshVerificationPanel(g,id,input={},meta={}){return withPanelOperation(g.id,()=>refreshVerificationPanelUnlocked(g,id,input,meta));}
async function refreshVerificationPanelUnlocked(g,id,input={},meta={}){assertPanelRevision(g.id,meta);const p=verificationStore.getPanel(g.id,id);if(!p)throw new Error('Verification panel not found.');const c=g.channels.cache.get(input.channelId||p.channelId)||await g.channels.fetch(input.channelId||p.channelId).catch(()=>null);if(!c?.send)throw new Error('Panel channel is unavailable.');return deployVerificationPanelUnlocked(c,{...p,...input,panelId:id},meta);}
async function restoreMissingVerificationPanel(g,id,meta={}){const p=verificationStore.getPanel(g.id,id);if(!p)throw new Error('Verification panel not found.');if(await fetchPanelMessage(g,p))return p;const c=g.channels.cache.get(p.channelId)||await g.channels.fetch(p.channelId).catch(()=>null);if(!c?.send)throw new Error('Panel channel is unavailable.');return deployVerificationPanel(c,{...p,panelId:id,messageId:null},meta);}
async function deleteVerificationPanel(g,id,meta={}){return withPanelOperation(g.id,()=>deleteVerificationPanelUnlocked(g,id,meta));}
async function deleteVerificationPanelUnlocked(g,id,meta={}){assertPanelRevision(g.id,meta);const s=getEffectiveVerificationSection(g.id),p=verificationStore.getPanel(g.id,id);if(!p)throw new Error('Verification panel not found.');const m=await fetchPanelMessage(g,p);if(m&&!m.deletable)throw new Error('Verification panel message cannot be deleted.');if(meta.expectedConfigRevision!=null&&Number(meta.expectedConfigRevision)!==Number(verificationStore.getVerificationSection(g.id).configRevision))throw new Error('Verification configuration changed. Reload before deleting.');const saved=verificationStore.deletePanel(g.id,id,meta);if(m){try{await m.delete();}catch(error){try{await m.edit({components:[]});}catch(disableError){console.error('[Verification] Deleted panel message cleanup failed:',disableError?.message||disableError);throw new Error('Panel configuration removed; the old message could not be removed or disabled. Remove it manually.');}console.warn('[Verification] Deleted panel message disabled after deletion failed:',error?.message||error);}}return saved;}
async function getPanelHealth(g,p){if(!p)return {ok:false,status:'Missing panel record'};if(!p.channelId)return {ok:false,status:'Missing channel'};const m=await fetchPanelMessage(g,p);return m?{ok:true,status:'Healthy'}:{ok:false,status:'Missing message'};}
async function buildHealthReport(g){const s=getEffectiveVerificationSection(g.id),settings=s.settings,panels=Object.values(s.panels||{}),groups={};for(const k of ['pending','verifying','verified','auto','bot','bypass','quarantine','staff'])groups[k]=await fetchRoles(g,roleIds(settings,k));const warnings=[];if(!s.enabled)warnings.push('Verification is disabled.');if(!roleIds(settings,'verified').length)warnings.push('No Verified role is configured.');for(const [k,roles] of Object.entries(groups)){const ids=roleIds(settings,k);if(ids.length!==roles.length)warnings.push(`One or more ${k} roles are missing.`);if(roles.some(r=>!canBotManageRole(g,r))&&!['bypass','staff'].includes(k))warnings.push(`Goliath cannot manage one or more ${k} roles.`);}const steps=enabledSecurity(settings);if(settings.security?.discordScreening&& !hasDiscordScreening(g))warnings.push('Discord Membership Screening is enabled in Verification but is not enabled for this guild.');if(settings.security?.riskBased&&settings.intelligence?.enabled!==true)warnings.push('Risk-Based Security is enabled while Intelligence is disabled.');if(settings.quarantine?.enabled!==false&&!roleIds(settings,'quarantine').length)warnings.push('Quarantine is enabled but no Quarantine role is configured.');const ph=await Promise.all(panels.map(async p=>({panelId:p.panelId,...await getPanelHealth(g,p)})));for(const p of ph)if(!p.ok)warnings.push(`${p.panelId}: ${p.status}`);const active=s.activePanelId&&s.panels?.[s.activePanelId];if(s.enabled&&(!active||active.enabled===false||!active.channelId||!active.messageId))warnings.push('No active Verification panel is deployed. Publish a member-facing panel under Verification → Panel.');else if(s.enabled){const health=ph.find(p=>p.panelId===s.activePanelId);if(!health?.ok)warnings.push('The active Verification panel message is unavailable.');const channel=g.channels.cache.get(active.channelId)||await g.channels.fetch(active.channelId).catch(()=>null);if(!channel)warnings.push('The active Verification panel channel is unavailable.');else{for(const id of roleIds(settings,'pending')){const role=g.roles.cache.get(id)||await g.roles.fetch(id).catch(()=>null);if(role&&!channel.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel))warnings.push('A Pending role cannot view the active Verification channel.');}}}return {enabled:s.enabled,screeningEnabled:hasDiscordScreening(g),securitySteps:steps,roles:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),panels:ph,warnings};}

module.exports={logEvent,CUSTOM_ID_PREFIX,SCREENING_FEATURE,DEFAULT_HELPERS,canManageVerification,canBotManageRole,canBotManageMember,hasDiscordScreening,buildVerifyCustomId,parseVerifyCustomId,buildVerificationEmbed,buildVerificationRows,configureVerification,setVerificationEnabled,toggleVerification,getVerificationStatus,updateVerificationSettings,updateVerificationMessages,updatePanelTemplate,assignPendingRoles,assignArrivalRoles,handleMemberJoin,handleMemberUpdate,deployVerificationPanel,refreshVerificationPanel,restoreMissingVerificationPanel,deleteVerificationPanel,getPanelHealth,buildHealthReport,verifyMember,renderMessage,renderTemplate};
