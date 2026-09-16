'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
  PermissionFlagsBits, StringSelectMenuBuilder,
} = require('discord.js');
const auditStore = require('../auditIntelligence/auditStore');
const observatory = require('../auditIntelligence/guildObservatory');
const security = require('../../core/security/protection/core');

const CHANNEL_NAME = '🚨・goliath-status';
const CHANNEL_TOPIC = 'GOLIATH_TEMP_MAINTENANCE_STATUS:v1';
const RECOVERY_DELETE_DELAY_MS = 5 * 60 * 1000;
const CONTROL_PREFIX = 'owner:commandcenter:guildcontrols:';
const REPORT_FAMILIES = Object.freeze({
  guild: 'Guild / System', members: 'Members', moderation: 'Moderation', security: 'Security / AutoMod',
  messages: 'Messages / Reactions', voice: 'Voice', roles: 'Roles / Permissions', goliath: 'Goliath Actions',
});
const DEFAULT_NOTICE_SETTINGS = Object.freeze({ paused: false, maintenance: true, restart: true, recovery: true });
const activeTimers = new Map();
const controlSessions = new Map();
let shutdownInProgress = false;
let commandCenterWired = false;

function noticeSettings(guildId) {
  const saved = auditStore.getConfig().guilds?.[String(guildId || '')]?.operationalNotices || {};
  return { ...DEFAULT_NOTICE_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
}
function updateGuildConfig(guildId, patch = {}) {
  const id = String(guildId || '').trim();
  if (!id) return null;
  const config = auditStore.getConfig();
  const existing = config.guilds?.[id] || {};
  const next = { ...existing, ...patch };
  auditStore.updateConfig({ guilds: { [id]: next } });
  return next;
}
function updateNoticeSettings(guildId, patch = {}) {
  const existing = auditStore.getConfig().guilds?.[String(guildId || '')] || {};
  const operationalNotices = { ...DEFAULT_NOTICE_SETTINGS, ...(existing.operationalNotices || {}), ...patch };
  updateGuildConfig(guildId, { operationalNotices });
  return operationalNotices;
}
function noticeAllowed(guildId, kind = 'maintenance') {
  const settings = noticeSettings(guildId);
  return !settings.paused && settings[kind] !== false;
}
function unixSeconds(value = Date.now()) { return Math.floor(Number(value) / 1000); }
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60); const seconds = total % 60;
  return minutes < 1 ? `${seconds} second${seconds === 1 ? '' : 's'}` : `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'}`;
}
function maintenanceEmbed(startedAt = Date.now(), reason = 'Scheduled maintenance') {
  return new EmbedBuilder().setColor(0xED4245).setTitle('🚨 GOLIATH SYSTEM NOTICE')
    .setDescription('**MAINTENANCE IN PROGRESS**\n\nGoliath is going offline for maintenance.\nCommands, automations and other Goliath services may be temporarily unavailable.')
    .addFields(
      { name: '🔴 Status', value: 'Offline / Maintenance', inline: true }, { name: '🤖 Service', value: 'Goliath', inline: true },
      { name: '🛠️ Reason', value: String(reason || 'Scheduled maintenance').slice(0, 1024) },
      { name: '🕒 Started', value: `<t:${unixSeconds(startedAt)}:F>\n<t:${unixSeconds(startedAt)}:R>` },
    ).setFooter({ text: 'Goliath System Status • Automated Notice • No action is required' }).setTimestamp(startedAt);
}
function operationalEmbed(startedAt = Date.now(), restoredAt = Date.now()) {
  return new EmbedBuilder().setColor(0x57F287).setTitle('✅ GOLIATH SYSTEM NOTICE')
    .setDescription('**ALL SYSTEMS OPERATIONAL**\n\nGoliath has successfully restarted and services have been restored.\nThis temporary status channel will remove itself automatically.')
    .addFields(
      { name: '🟢 Status', value: 'Online', inline: true }, { name: '🤖 Service', value: 'Goliath', inline: true },
      { name: '⏱️ Downtime', value: formatDuration(restoredAt - startedAt) },
      { name: '🕒 Restored', value: `<t:${unixSeconds(restoredAt)}:F>\n<t:${unixSeconds(restoredAt)}:R>` },
    ).setFooter({ text: 'Goliath System Status • Automated Recovery Notice' }).setTimestamp(restoredAt);
}
function isMaintenanceChannel(channel) { return Boolean(channel && channel.type === ChannelType.GuildText && (channel.topic === CHANNEL_TOPIC || channel.name === CHANNEL_NAME)); }
function findMaintenanceChannel(guild) { return guild?.channels?.cache?.find?.((channel) => isMaintenanceChannel(channel)) || null; }
function buildPermissionOverwrites(guild) {
  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  if (guild.ownerId) overwrites.push({ id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.roles.everyone.id || !role.permissions.has(PermissionFlagsBits.Administrator)) continue;
    overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
  }
  const me = guild.members.me;
  if (me?.id) overwrites.push({ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] });
  return overwrites;
}
async function ensureMaintenanceChannel(guild) {
  let channel = findMaintenanceChannel(guild); if (channel) return channel;
  channel = await guild.channels.create({ name: CHANNEL_NAME, type: ChannelType.GuildText, topic: CHANNEL_TOPIC, reason: 'Goliath maintenance status channel', permissionOverwrites: buildPermissionOverwrites(guild) });
  await channel.setPosition(0, { reason: 'Keep Goliath maintenance notice visible near the top' }).catch(() => null); return channel;
}
async function findStatusMessage(channel) {
  const pinned = await channel.messages.fetchPinned().catch(() => null); const pinnedMessage = pinned?.find?.((message) => message.author?.id === channel.client.user?.id);
  if (pinnedMessage) return pinnedMessage;
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null); return recent?.find?.((message) => message.author?.id === channel.client.user?.id) || null;
}
async function beginGuildMaintenance(guild, options = {}) {
  const kind = options.kind === 'restart' ? 'restart' : 'maintenance';
  if (options.force !== true && !noticeAllowed(guild.id, kind)) return { ok: true, skipped: true, guildId: guild.id, reason: 'operational-notices-disabled' };
  const startedAt = Number(options.startedAt || Date.now()); const reason = options.reason || 'Scheduled maintenance'; const channel = await ensureMaintenanceChannel(guild);
  let message = await findStatusMessage(channel); if (message) await message.edit({ embeds: [maintenanceEmbed(startedAt, reason)] }); else message = await channel.send({ embeds: [maintenanceEmbed(startedAt, reason)] });
  await message.pin().catch(() => null); return { ok: true, guildId: guild.id, channelId: channel.id, messageId: message.id, startedAt };
}
async function beginMaintenanceForAll(client, options = {}) {
  const startedAt = Number(options.startedAt || Date.now()); const results = [];
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    try { results.push(await beginGuildMaintenance(guild, { ...options, startedAt })); }
    catch (error) { console.warn(`[MaintenanceStatus] Could not start maintenance notice in ${guild?.id}:`, error?.message || error); results.push({ ok: false, guildId: guild?.id || null, error: error?.message || String(error) }); }
  } return results;
}
function scheduleChannelDeletion(channel, delayMs = RECOVERY_DELETE_DELAY_MS) {
  const existing = activeTimers.get(channel.id); if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => { activeTimers.delete(channel.id); if (!isMaintenanceChannel(channel)) return; await channel.delete('Goliath maintenance completed').catch(() => null); }, Math.max(1000, Number(delayMs || RECOVERY_DELETE_DELAY_MS)));
  timer.unref?.(); activeTimers.set(channel.id, timer);
}
async function recoverGuild(guild, options = {}) {
  const channel = findMaintenanceChannel(guild); if (!channel) return { ok: true, guildId: guild.id, found: false };
  if (options.force !== true && !noticeAllowed(guild.id, 'recovery')) { scheduleChannelDeletion(channel, 5000); return { ok: true, guildId: guild.id, found: true, skipped: true, reason: 'recovery-notice-disabled', channelId: channel.id }; }
  const restoredAt = Number(options.restoredAt || Date.now()); let message = await findStatusMessage(channel); const startedAt = message?.createdTimestamp || restoredAt;
  if (message) await message.edit({ embeds: [operationalEmbed(startedAt, restoredAt)] }); else { message = await channel.send({ embeds: [operationalEmbed(startedAt, restoredAt)] }); await message.pin().catch(() => null); }
  scheduleChannelDeletion(channel, options.deleteDelayMs); return { ok: true, guildId: guild.id, found: true, channelId: channel.id, messageId: message.id };
}
async function recoverAll(client, options = {}) { const results = []; for (const guild of client?.guilds?.cache?.values?.() || []) { try { results.push(await recoverGuild(guild, options)); } catch (error) { results.push({ ok: false, guildId: guild?.id || null, error: error?.message || String(error) }); } } return results; }
async function completeGuildMaintenance(guild, options = {}) { return recoverGuild(guild, options); }
async function deleteGuildMaintenanceChannel(guild) {
  const channel = findMaintenanceChannel(guild); if (!channel) return { ok: true, found: false, guildId: guild.id };
  const timer = activeTimers.get(channel.id); if (timer) clearTimeout(timer); activeTimers.delete(channel.id); await channel.delete('Goliath maintenance channel manually cleared');
  return { ok: true, found: true, guildId: guild.id, channelId: channel.id };
}
function guildOptions(client) {
  const destination = String(auditStore.getConfig().commandCenter?.guildId || ''); const merged = new Map();
  for (const item of auditStore.getGuildRegistry?.() || []) { const id = String(item.guildId || ''); if (!id || id === destination) continue; merged.set(id, { id, name: item.name || id, environments: Object.keys(item.environments || {}), live: client.guilds.cache.has(id) }); }
  for (const guild of client.guilds.cache.values()) { if (guild.id === destination) continue; const current = merged.get(guild.id) || { environments: [] }; merged.set(guild.id, { ...current, id: guild.id, name: guild.name, live: true, environments: current.environments.length ? current.environments : [String(process.env.BOT_MODE || 'DEV').toUpperCase()] }); }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25);
}
function collectorFor(item) {
  const envs = item?.environments || []; const current = String(process.env.BOT_MODE || 'DEV').toUpperCase();
  if (item?.live) return current === 'PROD' ? 'PRODUCTION' : current;
  for (const candidate of ['BETA', 'PRODUCTION', 'PROD', 'DEV']) if (envs.includes(candidate)) return candidate === 'PROD' ? 'PRODUCTION' : candidate;
  return envs[0] || 'DEV';
}
function session(interaction) { const key = `${interaction.guildId}:${interaction.user.id}`; if (!controlSessions.has(key)) controlSessions.set(key, { guildId: null, family: 'goliath', scan: null }); return controlSessions.get(key); }
function setSession(interaction, patch) { const current = session(interaction); Object.assign(current, patch); return current; }
function reportingSettings(guildId) { const cfg = auditStore.getConfig().guilds?.[String(guildId || '')] || {}; return { enabled: cfg.enabled !== false, monitoring: cfg.monitoring && typeof cfg.monitoring === 'object' ? cfg.monitoring : {} }; }
function updateReporting(guildId, patch = {}) { const current = auditStore.getConfig().guilds?.[String(guildId || '')] || {}; updateGuildConfig(guildId, { ...patch, monitoring: patch.monitoring || current.monitoring || {} }); }
function scanSummary(scan) {
  if (!scan) return 'No stored Observatory baseline yet. Press **Scan Guild**.';
  if (!scan.ok) return `🔴 Scan failed: ${scan.reason || scan.error || 'unknown error'}`;
  const members = scan.members?.length ?? scan.counts?.members ?? 0; const bots = scan.members?.filter?.((x) => x.bot)?.length ?? scan.counts?.bots ?? 0;
  const channels = scan.channels?.length ?? scan.counts?.channels ?? 0; const categories = scan.channels?.filter?.((x) => x.type === ChannelType.GuildCategory)?.length ?? 0;
  return [`🟢 **${scan.remote ? 'Remote ' : ''}Observatory baseline stored** • ${scan.durationMs ?? '?'}ms`, `Collector **${scan.collectorMode || 'Unknown'}** • Members **${members}** • Bots **${bots}** • Roles **${scan.roles?.length ?? scan.counts?.roles ?? 0}**`, `Channels **${channels}** • Categories **${categories}**`, `Bans **${scan.bans?.length ?? scan.counts?.bans ?? 0}** • Invites **${scan.invites?.length ?? scan.counts?.invites ?? 0}** • AutoMod **${scan.automod?.length ?? scan.counts?.automod ?? 0}**`, `Audit entries **${scan.auditLogs?.length ?? scan.counts?.auditLogs ?? 0}** • Scan gaps **${scan.errors?.length ?? 0}**`, scan.scannedAt ? `Scanned <t:${unixSeconds(Date.parse(scan.scannedAt))}:R>` : null].filter(Boolean).join('\n');
}
function guildControlPayload(client, interaction, notice = null) {
  const state = session(interaction); const options = guildOptions(client); if (!state.guildId && options.length) state.guildId = options[0].id;
  const selected = options.find((item) => item.id === state.guildId) || null; const notices = selected ? noticeSettings(selected.id) : DEFAULT_NOTICE_SETTINGS;
  const reporting = selected ? reportingSettings(selected.id) : { enabled: true, monitoring: {} }; const liveGuild = selected ? client.guilds.cache.get(selected.id) : null;
  const statusChannel = liveGuild ? findMaintenanceChannel(liveGuild) : null; const familyEnabled = reporting.monitoring[state.family] !== false;
  const latest = selected ? (state.scan || observatory.getLatest(selected.id)) : null; const reportLines = Object.entries(REPORT_FAMILIES).map(([key, label]) => `${reporting.monitoring[key] === false ? '🔴' : '🟢'} ${label}`).join('\n');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎛️ GOLIATH COMMAND CENTER • GUILD CONTROLS')
    .setDescription(['Central owner controls for every guild known to DEV, BETA and PRODUCTION.', '', '**Sentinel collection is locked ON.** These controls change Discord reporting and operational notices only; they never stop evidence collection.', notice ? `\n**Result:** ${notice}` : null].filter(Boolean).join('\n'))
    .addFields(
      { name: 'Selected Guild', value: selected ? `**${selected.name}**\n\`${selected.id}\`` : 'No guild selected', inline: true },
      { name: 'Collector', value: selected ? `${collectorFor(selected)}\n${liveGuild ? '🟢 Live here' : '🌐 Remote'}` : '—', inline: true },
      { name: 'Sentinel Collection', value: '🔒 **ALWAYS ON — EVERYTHING**', inline: true },
      { name: 'Observatory', value: scanSummary(latest).slice(0, 1024), inline: false },
      { name: 'Operational Notices', value: selected ? `${notices.paused ? '🔕 PAUSED' : '🔔 ACTIVE'}\n${notices.maintenance ? '🟢' : '🔴'} Maintenance • ${notices.restart ? '🟢' : '🔴'} Restart/Offline • ${notices.recovery ? '🟢' : '🔴'} Recovery\nStatus channel: ${statusChannel ? `<#${statusChannel.id}>` : liveGuild ? 'None' : 'Remote collector'}` : 'Select a guild.', inline: false },
      { name: 'Discord Reporting', value: selected ? `${reporting.enabled ? '▶️ Delivery active' : '⏸️ ALL delivery paused'}\n${reportLines}` : 'Select a guild.', inline: false },
      { name: 'Selected Report Family', value: `${REPORT_FAMILIES[state.family]} • ${familyEnabled ? '🟢 Sent' : '🔴 Suppressed'}`, inline: false },
    ).setFooter({ text: 'Goliath Command Center • Collection ≠ Delivery • Owner only' }).setTimestamp();
  const rows = [];
  if (options.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${CONTROL_PREFIX}guild`).setPlaceholder('Select any known guild').addOptions(options.map((item) => ({ label: item.name.slice(0, 100), value: item.id, description: `${item.environments.join(' • ') || 'Registry'} • ${item.id}`.slice(0, 100), default: item.id === state.guildId })))));
  if (selected) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}pause`).setLabel(notices.paused ? 'Resume Notices' : 'Pause Notices').setEmoji(notices.paused ? '🔔' : '🔕').setStyle(notices.paused ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}maintenance`).setLabel('Maintenance').setStyle(notices.maintenance ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}restart`).setLabel('Restart').setStyle(notices.restart ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}recovery`).setLabel('Recovery').setStyle(notices.recovery ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}scan`).setLabel('Scan Guild').setEmoji('🔎').setStyle(ButtonStyle.Primary),
    ));
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${CONTROL_PREFIX}family`).setPlaceholder('Choose Discord report family').addOptions(Object.entries(REPORT_FAMILIES).map(([value, label]) => ({ label, value, default: value === state.family })))));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}family-toggle`).setLabel(familyEnabled ? 'Stop Selected Feed' : 'Send Selected Feed').setStyle(familyEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}reporting-toggle`).setLabel(reporting.enabled ? 'Pause ALL Reporting' : 'Resume ALL Reporting').setStyle(reporting.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}all-on`).setLabel('Enable All Feeds').setStyle(ButtonStyle.Secondary),
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}start`).setLabel('Send Maintenance Now').setEmoji('🚨').setStyle(ButtonStyle.Danger).setDisabled(!liveGuild),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}restore`).setLabel('Restore / Clear').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!liveGuild),
      new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}refresh`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
async function handleControlInteraction(client, interaction) {
  const id = String(interaction.customId || ''); if (!id.startsWith(CONTROL_PREFIX)) return false;
  const config = auditStore.getConfig(); if (String(interaction.guildId || '') !== String(config.commandCenter?.guildId || '')) return false;
  if (!security.isBotOwner(interaction.user?.id)) { await interaction.reply({ content: '❌ Owner-only control.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  const action = id.slice(CONTROL_PREFIX.length); const state = session(interaction); let notice = null;
  if (action === 'open') { await interaction.reply({ ...guildControlPayload(client, interaction), flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  if (action === 'guild' && interaction.isStringSelectMenu?.()) setSession(interaction, { guildId: interaction.values[0], scan: null });
  else if (action === 'family' && interaction.isStringSelectMenu?.()) setSession(interaction, { family: interaction.values[0] });
  else if (!state.guildId) { await interaction.reply({ content: 'Select a guild first.', flags: MessageFlags.Ephemeral }).catch(() => null); return true; }
  else if (action === 'pause') { const n = noticeSettings(state.guildId); const next = updateNoticeSettings(state.guildId, { paused: !n.paused }); notice = next.paused ? 'Operational notices paused for this guild.' : 'Operational notices resumed for this guild.'; }
  else if (['maintenance', 'restart', 'recovery'].includes(action)) { const n = noticeSettings(state.guildId); const next = updateNoticeSettings(state.guildId, { [action]: !n[action] }); notice = `${action[0].toUpperCase()}${action.slice(1)} notices ${next[action] ? 'enabled' : 'disabled'} for this guild.`; }
  else if (action === 'family-toggle') { const r = reportingSettings(state.guildId); updateReporting(state.guildId, { monitoring: { ...r.monitoring, [state.family]: r.monitoring[state.family] === false } }); notice = `${REPORT_FAMILIES[state.family]} reporting updated.`; }
  else if (action === 'reporting-toggle') { const r = reportingSettings(state.guildId); updateReporting(state.guildId, { enabled: !r.enabled }); notice = `Discord reporting ${r.enabled ? 'paused' : 'resumed'} for this guild. Sentinel collection remains on.`; }
  else if (action === 'all-on') { updateReporting(state.guildId, { enabled: true, monitoring: Object.fromEntries(Object.keys(REPORT_FAMILIES).map((key) => [key, true])) }); notice = 'All Discord report feeds enabled for this guild.'; }
  else if (action === 'scan') {
    await interaction.deferUpdate().catch(() => null);
    const selected = guildOptions(client).find((item) => item.id === state.guildId); const collector = collectorFor(selected);
    const result = await observatory.requestScan(client, state.guildId, collector, interaction.user.id, 20000); setSession(interaction, { scan: result });
    notice = result.ok ? `${result.remote ? 'Remote ' : ''}${result.collectorMode || collector} Observatory scan completed and baseline stored.` : `Observatory scan failed: ${result.reason || result.error || 'unknown error'}.`;
    await interaction.editReply(guildControlPayload(client, interaction, notice)).catch(() => null); return true;
  } else if (action === 'start') { const guild = client.guilds.cache.get(state.guildId); if (guild) { await beginGuildMaintenance(guild, { force: true, reason: 'Started manually from Goliath Command Center' }); notice = 'Maintenance notice sent manually.'; } }
  else if (action === 'restore') { const guild = client.guilds.cache.get(state.guildId); if (guild) { await recoverGuild(guild, { force: true }); notice = 'Recovery/clear action completed.'; } }
  if (interaction.isMessageComponent?.()) await interaction.update(guildControlPayload(client, interaction, notice)).catch(async () => { await interaction.reply({ ...guildControlPayload(client, interaction, notice), flags: MessageFlags.Ephemeral }).catch(() => null); });
  return true;
}
async function ensureCommandCenterControls(client) {
  if (String(process.env.BOT_MODE || 'DEV').toUpperCase() !== 'DEV') return false;
  const config = auditStore.getConfig(); const guild = client.guilds.cache.get(String(config.commandCenter?.guildId || '')); if (!guild) return false;
  let channel = config.commandCenter?.channelId ? guild.channels.cache.get(String(config.commandCenter.channelId)) : null; if (!channel?.isTextBased?.()) channel = guild.channels.cache.find((item) => item.isTextBased?.() && item.name === 'command-center') || null; if (!channel) return false;
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null); if (!messages) return false;
  const message = messages.find((item) => item.author?.id === client.user?.id && item.embeds?.some((embed) => String(embed.title || '').includes('GOLIATH COMMAND CENTER'))); if (!message) return false;
  const rows = message.components.map((row) => ActionRowBuilder.from(row)); const exists = message.components.some((row) => row.components.some((component) => component.customId === `${CONTROL_PREFIX}open`)); if (exists) return true;
  const button = new ButtonBuilder().setCustomId(`${CONTROL_PREFIX}open`).setLabel('Guild Controls').setEmoji('🎛️').setStyle(ButtonStyle.Primary); const last = rows[rows.length - 1];
  if (last && last.components.length < 5) last.addComponents(button); else if (rows.length < 5) rows.push(new ActionRowBuilder().addComponents(button)); else return false;
  await message.edit({ components: rows }); return true;
}
function wireCommandCenterControls(client) {
  if (commandCenterWired) return false; commandCenterWired = true;
  client.on('interactionCreate', (interaction) => { handleControlInteraction(client, interaction).catch((error) => console.warn('[CommandCenter Guild Controls]', error?.stack || error?.message || error)); const id = String(interaction.customId || ''); if (id.startsWith('owner:commandcenter:') && !id.startsWith(CONTROL_PREFIX)) setTimeout(() => ensureCommandCenterControls(client).catch(() => null), 750).unref?.(); }); return true;
}
function wireProcessHandlers(client, options = {}) {
  const server = options.server || null; const exitAfterMs = Number(options.exitAfterMs || 8000);
  const shutdown = async (signal) => {
    if (shutdownInProgress) return; shutdownInProgress = true; console.log(`[MaintenanceStatus] ${signal} received. Publishing permitted maintenance notices before shutdown.`);
    const forceTimer = setTimeout(() => process.exit(0), exitAfterMs); forceTimer.unref?.();
    try { await beginMaintenanceForAll(client, { kind: 'restart', reason: signal === 'SIGTERM' ? 'Goliath service restart / maintenance' : 'Goliath maintenance shutdown' }); } catch (error) { console.error('[MaintenanceStatus] Shutdown notice failed:', error?.stack || error?.message || error); }
    try { if (server?.listening) await new Promise((resolve) => server.close(() => resolve())); } catch {} try { client?.destroy?.(); } catch {}
    clearTimeout(forceTimer); process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); }); process.once('SIGINT', () => { void shutdown('SIGINT'); }); return shutdown;
}
module.exports = {
  CHANNEL_NAME, CHANNEL_TOPIC, RECOVERY_DELETE_DELAY_MS, DEFAULT_NOTICE_SETTINGS,
  noticeSettings, updateNoticeSettings, noticeAllowed, findMaintenanceChannel,
  beginGuildMaintenance, beginMaintenanceForAll, completeGuildMaintenance, deleteGuildMaintenanceChannel,
  recoverGuild, recoverAll, wireProcessHandlers, wireCommandCenterControls, ensureCommandCenterControls, handleControlInteraction,
};
