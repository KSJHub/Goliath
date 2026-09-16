'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const auditStore = require('../../owner/auditIntelligence/auditStore');
const sentinel = require('../../owner/sentinel/eventPipeline');
const security = require('../../core/security/protection/core');

const PREFIX = 'owner:sentinel:';
const sessions = new Map();
const FAMILIES = Object.freeze({ guild:'Guild / System', members:'Members', moderation:'Moderation', security:'Security / AutoMod', messages:'Messages / Reactions', voice:'Voice', roles:'Roles / Permissions', goliath:'Goliath Actions' });
function stateFor(interaction) { const key = `${interaction.guildId}:${interaction.user.id}`; if (!sessions.has(key)) sessions.set(key, { guildId:null, notice:null }); return sessions.get(key); }
function knownGuilds(client) {
  const destination = String(auditStore.getConfig().commandCenter?.guildId || ''); const merged = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) { const id = String(item.guildId || ''); if (id && id !== destination) merged.set(id, { id, name:item.name || id, environments:Object.keys(item.environments || {}) }); }
  for (const guild of client.guilds.cache.values()) if (guild.id !== destination) merged.set(guild.id, { ...(merged.get(guild.id) || {}), id:guild.id, name:guild.name, liveHere:true });
  return [...merged.values()].sort((a,b) => a.name.localeCompare(b.name)).slice(0,25);
}
function guildConfig(guildId) { const cfg = auditStore.getConfig(); const item = cfg.guilds?.[guildId] || {}; return { enabled:item.enabled !== false, monitoring:{ guild:true,members:true,moderation:true,security:true,messages:true,voice:true,roles:true,goliath:true,...(item.monitoring || {}) }, routes:item.routes || {}, mode:item.mode || 'default' }; }
function eventCount(guildId) { try { return auditStore.getGuildEvents(guildId, { limit:500 }).length; } catch { return 0; } }
function payload(client, interaction) {
  const state = stateFor(interaction); const guilds = knownGuilds(client); if (!state.guildId && guilds.length) state.guildId = guilds[0].id; const selected = guilds.find((x) => x.id === state.guildId) || null;
  const diag = sentinel.diagnostics(); const cfg = selected ? guildConfig(selected.id) : null; const enabledFamilies = cfg ? Object.entries(FAMILIES).filter(([key]) => cfg.monitoring[key] !== false).length : 0;
  const embed = new EmbedBuilder().setColor(diag.counters.errors ? 0xFEE75C : 0x57F287).setTitle('📹 SENTINEL CCTV • CONTROL CENTER')
    .setDescription(['Sentinel is Goliath’s permanent evidence collector. **Reporting controls only change what is mirrored into Discord — they never switch Sentinel collection off.**', state.notice ? `\n**Result:** ${state.notice}` : null].filter(Boolean).join('\n'))
    .addFields(
      { name:'Pipeline', value:`**v${diag.pipelineVersion}** • **${diag.environment}**\nBoundary ${diag.installed ? '🟢 installed' : '🔴 missing'}`, inline:true },
      { name:'Evidence Processing', value:`Accepted **${diag.counters.accepted}**\nDeduplicated **${diag.counters.deduplicated}**\nCorrelated **${diag.counters.correlated}**`, inline:true },
      { name:'Evidence Health', value:`Audit evidence **${diag.counters.auditEvidence}**\nErrors **${diag.counters.errors}**\nCorrelation window **${Math.round(diag.correlationWindowMs/1000)}s**`, inline:true },
      { name:'Declared CCTV Surface', value:`**${diag.coverage.declaredActionCount}** actions across **${diag.coverage.groupCount}** taxonomy groups.\nFamilies: ${diag.coverage.families.map((x) => `**${x}**`).join(', ')}`, inline:false },
    );
  if (selected) embed.addFields(
    { name:'Selected Guild', value:`**${selected.name}**\n\`${selected.id}\`\n${selected.liveHere ? '🟢 Live on this collector' : `🌐 Registry: ${(selected.environments || []).join(' / ') || 'remote'}`}`, inline:true },
    { name:'Discord Mirroring', value:`Guild reporting **${cfg.enabled ? '🟢 ON' : '⏸️ PAUSED'}**\nFamilies enabled **${enabledFamilies}/${Object.keys(FAMILIES).length}**\nStored recent evidence **${eventCount(selected.id)}**`, inline:true },
    { name:'Family Controls', value:Object.entries(FAMILIES).map(([key,label]) => `${cfg.monitoring[key] !== false ? '🟢' : '⚫'} **${label}**`).join('\n').slice(0,1024), inline:false },
  );
  embed.setFooter({ text:'Goliath Command Center • Sentinel CCTV • Owner only' }).setTimestamp();
  const rows=[];
  if (guilds.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}guild`).setPlaceholder('Select monitored guild').addOptions(guilds.map((item) => ({ label:item.name.slice(0,100), value:item.id, description:`${(item.environments || []).join(' • ') || 'Live'} • ${item.id}`.slice(0,100), default:item.id === state.guildId })))));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}selftest`).setLabel('Run CCTV Self-Test').setEmoji('🧪').setStyle(ButtonStyle.Primary).setDisabled(!selected?.liveHere),
    new ButtonBuilder().setCustomId(`${PREFIX}refresh`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}routing`).setLabel('Routing').setEmoji('🧭').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}guildcontrols`).setLabel('Guild Controls').setEmoji('🎛️').setStyle(ButtonStyle.Secondary),
  ));
  return { embeds:[embed], components:rows, allowedMentions:{ parse:[] } };
}
async function handle(client, interaction) {
  const id=String(interaction.customId || ''); if (!id.startsWith(PREFIX)) return false; const cfg=auditStore.getConfig(); if (String(interaction.guildId || '') !== String(cfg.commandCenter?.guildId || '')) return false;
  if (!security.isBotOwner(interaction.user?.id)) { await interaction.reply({ content:'❌ Owner-only control.', flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  const action=id.slice(PREFIX.length); const state=stateFor(interaction); state.notice=null;
  if (action === 'open') { await interaction.reply({ ...payload(client,interaction), flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  if (action === 'guild' && interaction.isStringSelectMenu?.()) state.guildId=interaction.values[0];
  else if (action === 'selftest') {
    const guild=client.guilds.cache.get(String(state.guildId || '')); if (!guild) state.notice='Self-test requires a guild connected to this DEV collector.';
    else { await interaction.deferUpdate().catch(()=>null); const result=await sentinel.selfTest(client,guild).catch((error)=>({ ok:false, reason:error.message })); state.notice=result.ok ? `Self-test passed. Persistence exercised${result.duplicateSuppressed ? ' and duplicate suppression confirmed' : ''}.` : `Self-test failed: ${result.reason || 'unknown error'}.`; await interaction.editReply(payload(client,interaction)).catch(()=>null); return true; }
  } else if (action === 'routing') { await interaction.reply({ content:'Use **Command Center → Routing** to configure per-guild report destinations. Sentinel evidence collection remains independent of those routes.', flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  else if (action === 'guildcontrols') { await interaction.reply({ content:'Use **Command Center → Guild Controls** for per-guild reporting families and maintenance/restart announcement controls. Sentinel itself remains always-on.', flags:MessageFlags.Ephemeral }).catch(()=>null); return true; }
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload(client,interaction)).catch(()=>null); else await interaction.update(payload(client,interaction)).catch(()=>null); return true;
}
async function ensureHomeButton(client) {
  const cfg=auditStore.getConfig(); const channelId=cfg.commandCenter?.channelId; const messageId=cfg.commandCenter?.messageId; if (!channelId || !messageId) return false;
  const channel=await client.channels.fetch(channelId).catch(()=>null); const message=channel ? await channel.messages.fetch(messageId).catch(()=>null) : null; if (!message) return false;
  const rows=message.components.map((row)=>ActionRowBuilder.from(row)); if (rows.some((row)=>row.components.some((component)=>component.data?.custom_id === `${PREFIX}open`))) return true;
  const button=new ButtonBuilder().setCustomId(`${PREFIX}open`).setLabel('Sentinel CCTV').setEmoji('📹').setStyle(ButtonStyle.Primary); let row=rows.find((item)=>item.components.length < 5); if (row) row.addComponents(button); else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button)); else return false;
  await message.edit({ components:rows }).catch(()=>null); return true;
}
module.exports={ name:Events.ClientReady, once:true, async execute(client) { await ensureHomeButton(client).catch((error)=>console.warn('[Sentinel CCTV UI] home button:',error?.message || error)); client.on(Events.InteractionCreate,(interaction)=>{ handle(client,interaction).catch((error)=>console.warn('[Sentinel CCTV UI]',error?.stack || error)); }); client.prependListener(Events.InteractionCreate,(interaction)=>{ const id=String(interaction.customId || ''); if (!id.startsWith('owner:commandcenter:') && !id.startsWith('owner:observatory:')) return; const timer=setTimeout(()=>ensureHomeButton(client).catch(()=>null),500); timer.unref?.(); }); console.log('[Sentinel CCTV UI] Command Center diagnostics online.'); } };
