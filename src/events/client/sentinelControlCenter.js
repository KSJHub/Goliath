'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const sentinel = require('../../owner/sentinel/eventPipeline');
const security = require('../../core/security/protection/core');

const PREFIX = 'owner:sentinel:';
const sessions = new Map();
const FAMILIES = Object.freeze({ guild:'Guild / System', members:'Members', moderation:'Moderation', security:'Security / AutoMod', messages:'Messages / Reactions', voice:'Voice', roles:'Roles / Permissions', goliath:'Goliath Actions' });
const ROUTES = Object.freeze(['guild','members','moderation','security','messages','voice','roles','goliath']);
const STALE_MS = 5 * 60 * 1000;
function stateFor(interaction) { const key=`${interaction.guildId}:${interaction.user.id}`; if (!sessions.has(key)) sessions.set(key,{ guildId:null, notice:null }); return sessions.get(key); }
function ageLabel(value) { const at=Date.parse(value || ''); if (!at) return 'never'; const seconds=Math.max(0,Math.floor((Date.now()-at)/1000)); if (seconds<60) return `${seconds}s ago`; if (seconds<3600) return `${Math.floor(seconds/60)}m ago`; if (seconds<86400) return `${Math.floor(seconds/3600)}h ago`; return `${Math.floor(seconds/86400)}d ago`; }
function collectorState(environments={}) { const rows=[]; for (const [mode,item] of Object.entries(environments)) { const at=Date.parse(item?.observedAt || '') || 0; const configuredOnly=!at; const stale=at && Date.now()-at>STALE_MS; rows.push({ mode, state:configuredOnly?'configured':stale?'stale':'live', observedAt:item?.observedAt || null }); } return rows; }
function knownGuilds(client) {
  const destination=String(auditStore.getConfig().commandCenter?.guildId || ''); const merged=new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) { const id=String(item.guildId || ''); if (id && id!==destination) merged.set(id,{ id,name:item.name || id,environments:item.environments || {},lastSeenAt:item.lastSeenAt || null }); }
  for (const guild of client.guilds.cache.values()) if (guild.id!==destination) { const current=merged.get(guild.id) || {}; merged.set(guild.id,{ ...current,id:guild.id,name:guild.name,liveHere:true,environments:current.environments || {} }); }
  return [...merged.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(0,25);
}
function guildConfig(guildId) { const cfg=auditStore.getConfig(); const item=cfg.guilds?.[guildId] || {}; return { enabled:item.enabled!==false, monitoring:{ guild:true,members:true,moderation:true,security:true,messages:true,voice:true,roles:true,goliath:true,...(item.monitoring || {}) },routes:item.routes || {},mode:item.mode || 'default' }; }
function saveGuild(guildId, patch) { const config=auditStore.getConfig(); const existing=config.guilds?.[guildId] || {}; return auditStore.updateConfig({ guilds:{ [guildId]:{ ...existing,...patch,monitoring:patch.monitoring ? { ...(existing.monitoring || {}),...patch.monitoring } : existing.monitoring,routes:patch.routes ? { ...(existing.routes || {}),...patch.routes } : existing.routes } } }); }
function recentEvents(guildId,limit=500) { try { return auditStore.getGuildEvents(guildId,{ limit }) || []; } catch { return []; } }
function persistedHealth(guildId) { const events=recentEvents(guildId,500); const sentinelEvents=events.filter((e)=>e?.metadata?.sentinel); const latest=events.at?.(-1) || events[events.length-1] || null; return { count:events.length,sentinelCount:sentinelEvents.length,latestAt:latest?.timestamp || null,provenanceRate:events.length ? Math.round((sentinelEvents.length/events.length)*100) : 100 }; }
function routeHealth(client,cfg) {
  const ownerGuild=client.guilds.cache.get(String(auditStore.getConfig().commandCenter?.guildId || '')); const bot=ownerGuild?.members?.me; const results=[];
  for (const key of ROUTES) { const id=cfg.routes?.[key] || (key==='guild' ? cfg.routes?.default : null); const channel=id ? ownerGuild?.channels?.cache?.get(String(id)) : null; let status='missing'; if (channel?.isTextBased?.()) { const perms=bot ? channel.permissionsFor(bot) : null; const ok=Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages) && perms?.has(PermissionFlagsBits.ReadMessageHistory)); status=ok?'healthy':'permissions'; } results.push({ key,id:id || null,status }); }
  return results;
}
function actualCoverage(guildId) { const events=recentEvents(guildId,500); const seen=new Set(events.map((e)=>String(e.category || '')).filter(Boolean)); const expected=['guild','member','members','moderation','security','message','messages','voice','role','roles','goliath']; const normalized=new Set([...seen].map((x)=>x==='member'?'members':x==='message'?'messages':x==='role'?'roles':x)); return { observed:[...normalized], observedFamilies:Object.keys(FAMILIES).filter((x)=>normalized.has(x)), expected, eventTypes:new Set(events.map((e)=>e.type).filter(Boolean)).size };
}
function payload(client,interaction) {
  const state=stateFor(interaction); const guilds=knownGuilds(client); if (!state.guildId && guilds.length) state.guildId=guilds[0].id; const selected=guilds.find((x)=>x.id===state.guildId) || null; const diag=sentinel.diagnostics(); const cfg=selected?guildConfig(selected.id):null; const enabledFamilies=cfg?Object.keys(FAMILIES).filter((key)=>cfg.monitoring[key]!==false).length:0; const persistence=selected?persistedHealth(selected.id):null; const routes=cfg?routeHealth(client,cfg):[]; const coverage=selected?actualCoverage(selected.id):null; const collectors=selected?collectorState(selected.environments):[];
  const embed=new EmbedBuilder().setColor(diag.counters.errors || routes.some((r)=>r.status!=='healthy') ? 0xFEE75C : 0x57F287).setTitle('📹 SENTINEL CCTV • CONTROL CENTER').setDescription(['Sentinel collection is **always on**. These controls change private Discord mirroring only.',state.notice?`\n**Result:** ${state.notice}`:null].filter(Boolean).join('\n')).addFields(
    { name:'Pipeline',value:`**v${diag.pipelineVersion} • ${diag.environment}**\nBoundary ${diag.installed?'🟢 installed':'🔴 missing'}\nErrors **${diag.counters.errors}**`,inline:true },
    { name:'Processing',value:`Accepted **${diag.counters.accepted}**\nDeduplicated **${diag.counters.deduplicated}**\nCorrelated **${diag.counters.correlated}**\nAudit evidence **${diag.counters.auditEvidence}**`,inline:true },
    { name:'Declared Surface',value:`**${diag.coverage.declaredActionCount}** actions / **${diag.coverage.groupCount}** groups\nCorrelation window **${Math.round(diag.correlationWindowMs/1000)}s**`,inline:true },
  );
  if (selected) {
    const collectorText=selected.liveHere?'🟢 **DEV local collector live**':collectors.length?collectors.map((c)=>`${c.state==='live'?'🟢':c.state==='stale'?'🟠':'⚪'} **${c.mode}** ${c.state} • ${ageLabel(c.observedAt)}`).join('\n'):'🔴 No collector registry evidence';
    const routeText=routes.map((r)=>`${r.status==='healthy'?'🟢':r.status==='permissions'?'🟠':'🔴'} **${FAMILIES[r.key] || r.key}** — ${r.status}`).join('\n').slice(0,1024);
    embed.addFields(
      { name:'Selected Guild',value:`**${selected.name}**\n\`${selected.id}\`\n${collectorText}`,inline:false },
      { name:'Persistent Evidence',value:`Stored sample **${persistence.count}**\nSentinel provenance **${persistence.provenanceRate}%**\nLast evidence **${ageLabel(persistence.latestAt)}**\nObserved event types **${coverage.eventTypes}**`,inline:true },
      { name:'Discord Mirroring',value:`Reporting **${cfg.enabled?'🟢 ON':'⏸️ PAUSED'}**\nFamilies **${enabledFamilies}/${Object.keys(FAMILIES).length}**\n${Object.entries(FAMILIES).map(([key,label])=>`${cfg.monitoring[key]!==false?'🟢':'⚫'} ${label}`).join('\n')}`.slice(0,1024),inline:true },
      { name:'Actual Observed Coverage',value:coverage.observedFamilies.length?coverage.observedFamilies.map((key)=>`🟢 **${FAMILIES[key]}**`).join('\n'):'⚪ No persisted event families observed yet. Declared taxonomy is not treated as proof of live coverage.',inline:true },
      { name:'Route Health',value:routeText || '🔴 No routes configured',inline:false },
    );
  }
  embed.setFooter({ text:'Goliath Command Center • Sentinel CCTV • Owner only' }).setTimestamp();
  const rows=[];
  if (guilds.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}guild`).setPlaceholder('Select monitored guild').addOptions(guilds.map((item)=>({ label:item.name.slice(0,100),value:item.id,description:`${item.liveHere?'Local DEV':Object.keys(item.environments || {}).join(' • ') || 'Remote'} • ${item.id}`.slice(0,100),default:item.id===state.guildId })))));
  if (selected) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}family`).setPlaceholder('Toggle a reporting family').addOptions(Object.entries(FAMILIES).map(([key,label])=>({ label:`${cfg.monitoring[key]!==false?'ON':'OFF'} • ${label}`.slice(0,100),value:key,description:'Toggle Discord mirroring only — Sentinel keeps collecting'.slice(0,100) })))));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}pause`).setLabel(cfg?.enabled?'Pause Reports':'Resume Reports').setEmoji(cfg?.enabled?'⏸️':'▶️').setStyle(cfg?.enabled?ButtonStyle.Danger:ButtonStyle.Success).setDisabled(!selected),
    new ButtonBuilder().setCustomId(`${PREFIX}all`).setLabel('Enable All Families').setEmoji('🟢').setStyle(ButtonStyle.Success).setDisabled(!selected),
    new ButtonBuilder().setCustomId(`${PREFIX}selftest`).setLabel('Full Self-Test').setEmoji('🧪').setStyle(ButtonStyle.Primary).setDisabled(!selected?.liveHere),
    new ButtonBuilder().setCustomId(`${PREFIX}repair`).setLabel('Repair Routes').setEmoji('🛠️').setStyle(ButtonStyle.Secondary).setDisabled(!selected?.liveHere),
    new ButtonBuilder().setCustomId(`${PREFIX}refresh`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds:[embed],components:rows,allowedMentions:{ parse:[] } };
}
async function fullSelfTest(client,guild) {
  const before=guildConfig(guild.id); const beforeCount=persistedHealth(guild.id).count; const result=await sentinel.selfTest(client,guild); const afterCount=persistedHealth(guild.id).count; const configAfter=guildConfig(guild.id);
  return { ...result,persisted:afterCount>=beforeCount,configSurvived:before.enabled===configAfter.enabled && JSON.stringify(before.monitoring)===JSON.stringify(configAfter.monitoring),provenance:persistedHealth(guild.id).provenanceRate };
}
async function handle(client,interaction) {
  const id=String(interaction.customId || ''); if (!id.startsWith(PREFIX)) return false; const root=auditStore.getConfig(); if (String(interaction.guildId || '')!==String(root.commandCenter?.guildId || '')) return false;
  if (!security.isBotOwner(interaction.user?.id)) { await interaction.reply({ content:'❌ Owner-only control.',flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  const action=id.slice(PREFIX.length); const state=stateFor(interaction); state.notice=null;
  if (action==='open') { await interaction.reply({ ...payload(client,interaction),flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  if (action==='guild' && interaction.isStringSelectMenu?.()) state.guildId=interaction.values[0];
  else if (action==='family' && interaction.isStringSelectMenu?.()) { const family=interaction.values[0]; const cfg=guildConfig(state.guildId); const next=cfg.monitoring[family]===false; saveGuild(state.guildId,{ monitoring:{ [family]:next } }); state.notice=`${FAMILIES[family]} reporting ${next?'enabled':'disabled'}. Sentinel collection was not changed.`; }
  else if (action==='pause') { const cfg=guildConfig(state.guildId); saveGuild(state.guildId,{ enabled:!cfg.enabled }); state.notice=`Discord reporting ${cfg.enabled?'paused':'resumed'} for this guild. Sentinel remains collecting.`; }
  else if (action==='all') { const monitoring={}; for (const key of Object.keys(FAMILIES)) monitoring[key]=true; saveGuild(state.guildId,{ enabled:true,monitoring }); state.notice='All reporting families enabled. Sentinel collection remains unchanged.'; }
  else if (action==='selftest') { const guild=client.guilds.cache.get(String(state.guildId || '')); if (!guild) state.notice='Full self-test requires this collector to host the guild.'; else { await interaction.deferUpdate().catch(()=>null); const result=await fullSelfTest(client,guild).catch((error)=>({ ok:false,reason:error.message })); state.notice=result.ok?`Full self-test passed • persistence ${result.persisted?'OK':'CHECK'} • config ${result.configSurvived?'survived':'changed'} • provenance ${result.provenance}%${result.duplicateSuppressed?' • dedupe OK':''}.`:`Self-test failed: ${result.reason || 'unknown error'}.`; await interaction.editReply(payload(client,interaction)).catch(()=>null); return true; } }
  else if (action==='repair') { const guild=client.guilds.cache.get(String(state.guildId || '')); if (!guild) state.notice='Route repair requires this collector to host the guild.'; else { const router=require('../../owner/auditIntelligence/auditRouter'); await interaction.deferUpdate().catch(()=>null); const repaired=await router.ensureReportRoutes(client,guild).catch(()=>null); state.notice=repaired?'Managed report routes checked/repaired.':'Route repair failed or owner audit context is unavailable.'; await interaction.editReply(payload(client,interaction)).catch(()=>null); return true; } }
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload(client,interaction)).catch(()=>null); else await interaction.update(payload(client,interaction)).catch(()=>null); return true;
}
async function ensureHomeButton(client) {
  const cfg=auditStore.getConfig(); const channelId=cfg.commandCenter?.channelId; const messageId=cfg.commandCenter?.messageId; if (!channelId || !messageId) return false; const channel=await client.channels.fetch(channelId).catch(()=>null); const message=channel?await channel.messages.fetch(messageId).catch(()=>null):null; if (!message) return false;
  const rows=message.components.map((row)=>ActionRowBuilder.from(row)); if (rows.some((row)=>row.components.some((component)=>component.data?.custom_id===`${PREFIX}open`))) return true; const button=new ButtonBuilder().setCustomId(`${PREFIX}open`).setLabel('Sentinel CCTV').setEmoji('📹').setStyle(ButtonStyle.Primary); let row=rows.find((item)=>item.components.length<5); if (row) row.addComponents(button); else if (rows.length<5) rows.push(new ActionRowBuilder().addComponents(button)); else return false; await message.edit({ components:rows }).catch(()=>null); return true;
}
module.exports={ name:Events.ClientReady,once:true,async execute(client) { await ensureHomeButton(client).catch((error)=>console.warn('[Sentinel CCTV UI] home button:',error?.message || error)); client.on(Events.InteractionCreate,(interaction)=>{ handle(client,interaction).catch((error)=>console.warn('[Sentinel CCTV UI]',error?.stack || error)); }); client.prependListener(Events.InteractionCreate,(interaction)=>{ const id=String(interaction.customId || ''); if (!id.startsWith('owner:commandcenter:') && !id.startsWith('owner:observatory:')) return; const timer=setTimeout(()=>ensureHomeButton(client).catch(()=>null),500); timer.unref?.(); }); console.log('[Sentinel CCTV UI] Full controls, health, recovery and diagnostics online.'); } };
