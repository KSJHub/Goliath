'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildAuditEmbed, buildUserIntelligenceEmbed, buildUserIntelligenceControls, buildCommandCenterHome } = require('./auditEmbeds');
const { buildReport } = require('./userIntelligence');
const auditStore = require('./auditStore');
const security = require('../../core/security/protection/core');

const MAX_CATEGORY_CHILDREN = 50;
const SUMMARY_REFRESH_MS = 60000;
const LIVE_PROBE_COOLDOWN_MS = 15000;
const REMOTE_LIVE_PROBE_WAIT_MS = 8000;
const REMOTE_LIVE_PROBE_POLL_MS = 250;
const summaryRefresh = new Map();
const liveProbeCooldown = new Map();
const REPORT_ROUTE_CHANNELS = {
  members: { name: 'member-events', label: 'Member Events' },
  moderation: { name: 'moderation', label: 'Moderation' },
  security: { name: 'security-automod', label: 'Security / AutoMod' },
  messages: { name: 'messages-reactions', label: 'Messages / Reactions' },
  voice: { name: 'voice-activity', label: 'Voice Activity' },
  roles: { name: 'roles-permissions', label: 'Roles / Permissions' },
  goliath: { name: 'goliath-actions', label: 'Goliath Actions' },
};

function slug(value, fallback = 'item') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}
function getOwnerAuditGuildId() { return String(auditStore.getConfig().commandCenter?.guildId || '').trim(); }
function autoProvisionEnabled() { return auditStore.getConfig().autoProvision !== false; }
function privateOverwrites(ownerGuild) {
  const ownerId = security.getBotOwnerId();
  const botId = ownerGuild.members.me?.id;
  const overwrites = [{ id: ownerGuild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  if (ownerId) overwrites.push({ id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  if (botId) overwrites.push({ id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] });
  return overwrites;
}
function guildMarker(sourceGuild) { return `GOLIATH_AUDIT_GUILD:${sourceGuild.id}`; }
function userMarker(sourceGuild, userId) { return `GOLIATH_AUDIT_USER:${sourceGuild.id}:${userId}`; }
function profileMarker(messageId) { return `GOLIATH_AUDIT_PROFILE:${messageId}`; }
function reportRouteMarker(sourceGuild, routeKey) { return `GOLIATH_AUDIT_ROUTE:${sourceGuild.id}:${routeKey}`; }
function reportFeedMarker(sourceGuild, routeKey) { return `GOLIATH_AUDIT_FEED:${sourceGuild.id}:${routeKey}`; }
function categoryBaseName(sourceGuild) { return `audit-${slug(sourceGuild.name, 'guild').slice(0, 70)}-${String(sourceGuild.id).slice(-6)}`.slice(0, 100); }
function categoryName(sourceGuild, page = 1) { const base = categoryBaseName(sourceGuild); return page <= 1 ? base : `${base}-${page}`.slice(0, 100); }
function categoryChildCount(ownerGuild, categoryId) { return ownerGuild.channels.cache.filter((channel) => channel.parentId === categoryId).size; }
function findCommandCenterChannel(guild) {
  return guild?.channels?.cache?.find((channel) => channel.type === ChannelType.GuildText && String(channel.topic || '').includes('GOLIATH_COMMAND_CENTER')) || null;
}
async function getOwnerGuild(client) {
  const ownerGuildId = getOwnerAuditGuildId();
  if (!ownerGuildId || !client?.guilds?.cache) return null;
  return client.guilds.cache.get(ownerGuildId) || await client.guilds.fetch(ownerGuildId).catch(() => null);
}

async function ensureCommandCenter(client, ownerGuild = null) {
  const config = auditStore.getConfig();
  const guildId = String(ownerGuild?.id || config.commandCenter?.guildId || '');
  if (!guildId) return null;
  const guild = ownerGuild || client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  let channel = config.commandCenter?.channelId ? guild.channels.cache.get(config.commandCenter.channelId) : null;
  if (!channel && config.commandCenter?.channelId) channel = await guild.channels.fetch(config.commandCenter.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) channel = findCommandCenterChannel(guild);
  let category = channel?.parent?.type === ChannelType.GuildCategory ? channel.parent : null;
  if (!channel || channel.type !== ChannelType.GuildText) {
    category = config.commandCenter?.categoryId ? guild.channels.cache.get(config.commandCenter.categoryId) : null;
    if (!category && config.commandCenter?.categoryId) category = await guild.channels.fetch(config.commandCenter.categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) category = guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === 'GOLIATH CONTROL') || null;
    if (!category) category = await guild.channels.create({ name: 'GOLIATH CONTROL', type: ChannelType.GuildCategory, permissionOverwrites: privateOverwrites(guild), reason: 'Goliath private owner command center' });
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.parentId === category.id && item.name === 'command-center') || null;
    if (!channel) channel = await guild.channels.create({ name: 'command-center', type: ChannelType.GuildText, parent: category.id, topic: 'GOLIATH_COMMAND_CENTER • Private owner control plane'.slice(0, 1024), permissionOverwrites: privateOverwrites(guild), reason: 'Goliath private owner command center' });
  }
  category = channel.parent?.type === ChannelType.GuildCategory ? channel.parent : null;
  const nextConfig = auditStore.updateConfig({ commandCenter: { guildId: guild.id, categoryId: category?.id || null, channelId: channel.id } });
  const homePayload = buildCommandCenterHome(client, guild, nextConfig);
  let message = nextConfig.commandCenter?.messageId ? await channel.messages.fetch(nextConfig.commandCenter.messageId).catch(() => null) : null;
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    message = recent?.find((item) => item.author?.id === client.user?.id && item.embeds?.some((embed) => String(embed.footer?.text || '').includes('Goliath Command Center'))) || null;
  }
  if (message) await message.edit(homePayload).catch(() => null); else message = await channel.send(homePayload);
  auditStore.updateConfig({ commandCenter: { guildId: guild.id, categoryId: category?.id || null, channelId: channel.id, messageId: message.id } });
  await message.pin('Goliath Command Center').catch(() => null);
  return { guild, category, channel, message };
}

function findSystemChannel(ownerGuild, sourceGuild) {
  const marker = guildMarker(sourceGuild);
  return ownerGuild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && String(channel.topic || '').includes(marker) && !String(channel.topic || '').includes('GOLIATH_AUDIT_USER:')) || null;
}
function findUserChannels(ownerGuild, sourceGuild) {
  const marker = `GOLIATH_AUDIT_USER:${sourceGuild.id}:`;
  return ownerGuild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText && String(channel.topic || '').includes(marker));
}
function findReportRouteChannel(ownerGuild, sourceGuild, routeKey) {
  const marker = reportRouteMarker(sourceGuild, routeKey);
  return ownerGuild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && String(channel.topic || '').includes(marker)) || null;
}
function findGuildCategories(ownerGuild, sourceGuild) {
  const base = categoryBaseName(sourceGuild);
  return ownerGuild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory && (channel.name === base || channel.name.startsWith(`${base}-`))).sort((a, b) => a.rawPosition - b.rawPosition);
}
async function ensureGuildCategory(ownerGuild, sourceGuild, preferredPage = 1) {
  const existing = findGuildCategories(ownerGuild, sourceGuild);
  const preferred = existing.find((category) => category.name === categoryName(sourceGuild, preferredPage));
  if (preferred) return preferred;
  if (!autoProvisionEnabled()) return existing.first?.() || null;
  return ownerGuild.channels.create({ name: categoryName(sourceGuild, preferredPage), type: ChannelType.GuildCategory, permissionOverwrites: privateOverwrites(ownerGuild), reason: `Goliath audit category for ${sourceGuild.name}` });
}
async function ensureSystemChannel(ownerGuild, sourceGuild, category) {
  const existing = findSystemChannel(ownerGuild, sourceGuild);
  if (existing) return existing;
  if (!autoProvisionEnabled()) return null;
  return ownerGuild.channels.create({ name: 'guild-events', type: ChannelType.GuildText, parent: category?.id || null, topic: `${guildMarker(sourceGuild)} • ${sourceGuild.name} • ${sourceGuild.id} • Guild/system audit events`.slice(0, 1024), permissionOverwrites: category ? undefined : privateOverwrites(ownerGuild), reason: `Goliath guild audit stream for ${sourceGuild.name}` });
}
async function ensureAuditContext(client, sourceGuild) {
  const ownerGuild = await getOwnerGuild(client);
  if (!ownerGuild) return null;
  let systemChannel = findSystemChannel(ownerGuild, sourceGuild);
  let category = systemChannel?.parent?.type === ChannelType.GuildCategory ? systemChannel.parent : null;
  if (!systemChannel) {
    category = await ensureGuildCategory(ownerGuild, sourceGuild, 1);
    systemChannel = await ensureSystemChannel(ownerGuild, sourceGuild, category);
  }
  return { ownerGuild, category, systemChannel };
}
async function resolveTextChannel(ownerGuild, channelId) {
  if (!channelId) return null;
  const channel = ownerGuild.channels.cache.get(String(channelId)) || await ownerGuild.channels.fetch(String(channelId)).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}
function channelDeliveryState(channel, ownerGuild) {
  if (!channel?.isTextBased?.() || !ownerGuild) return { exists: Boolean(channel), view: false, send: false, history: false, healthy: false };
  const botMember = ownerGuild.members.me || null;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  const view = permissions?.has(PermissionFlagsBits.ViewChannel) ?? false;
  const send = permissions?.has(PermissionFlagsBits.SendMessages) ?? false;
  const history = permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false;
  return { exists: true, view, send, history, healthy: view && send && history };
}
async function repairManagedChannelPermissions(channel, ownerGuild, reason) {
  if (!channel?.isTextBased?.() || !ownerGuild?.members?.me) return false;
  const state = channelDeliveryState(channel, ownerGuild);
  if (state.healthy) return true;
  const botId = ownerGuild.members.me.id;
  await channel.permissionOverwrites.edit(botId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason }).catch((error) => console.warn('[Audit Intelligence] managed route permission repair failed:', error?.message || error));
  return channelDeliveryState(channel, ownerGuild).healthy;
}
async function ensureReportFeedHeader(channel, sourceGuild, routeKey, label) {
  if (!channel?.isTextBased?.() || !sourceGuild?.id) return null;
  const marker = reportFeedMarker(sourceGuild, routeKey);
  const delivery = channelDeliveryState(channel, channel.guild);
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  let message = pinned?.find((item) => item.author?.bot && String(item.content || '').includes(marker)) || null;
  const content = [
    `${delivery.healthy ? '🟢' : '🟠'} **Goliath Audit Feed ${delivery.healthy ? 'Live' : 'Needs Attention'} — ${label}**`,
    '',
    `**Source Guild:** ${sourceGuild.name || 'Unknown Guild'}`,
    `**Guild ID:** \`${sourceGuild.id}\``,
    `**Feed:** ${label}`,
    `**Status:** ${delivery.healthy ? 'Active — monitored events are delivered here automatically.' : 'Permission issue detected — check the feed health below.'}`,
    `**Goliath Permissions:** View ${delivery.view ? '🟢' : '🔴'} • Send ${delivery.send ? '🟢' : '🔴'} • History ${delivery.history ? '🟢' : '🔴'}`,
    '',
    'Manage this feed from **Goliath Command Center → Routing**. Renaming or moving this channel is safe; Goliath tracks managed feeds by internal markers.',
    '',
    `\`${marker}\``,
  ].join('\n');
  if (message) {
    if (message.content !== content) await message.edit({ content, allowedMentions: { parse: [] } }).catch(() => null);
    return message;
  }
  message = await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  if (message) await message.pin('Goliath Audit feed status').catch(() => null);
  return message;
}
async function ensureReportRoutes(client, sourceGuild) {
  if (!sourceGuild?.id) return null;
  const context = await ensureAuditContext(client, sourceGuild);
  if (!context?.ownerGuild || !context.systemChannel) return null;
  const { ownerGuild, category, systemChannel } = context;
  const current = auditStore.getConfig();
  const existing = current.guilds?.[String(sourceGuild.id)] || {};
  const routes = { ...(existing.routes || {}) };
  if (!await resolveTextChannel(ownerGuild, routes.guild)) routes.guild = systemChannel.id;
  if (!await resolveTextChannel(ownerGuild, routes.default)) routes.default = systemChannel.id;
  await repairManagedChannelPermissions(systemChannel, ownerGuild, `Repair Goliath guild audit route for ${sourceGuild.name}`).catch(() => false);
  await ensureReportFeedHeader(systemChannel, sourceGuild, 'guild', 'Guild / System Events').catch(() => null);
  for (const [routeKey, definition] of Object.entries(REPORT_ROUTE_CHANNELS)) {
    let channel = await resolveTextChannel(ownerGuild, routes[routeKey]);
    if (!channel) channel = findReportRouteChannel(ownerGuild, sourceGuild, routeKey);
    if (!channel && autoProvisionEnabled()) {
      channel = await ownerGuild.channels.create({ name: definition.name, type: ChannelType.GuildText, parent: category?.id || null, topic: `${reportRouteMarker(sourceGuild, routeKey)} • ${sourceGuild.name} • ${definition.label} audit reports`.slice(0, 1024), permissionOverwrites: category ? undefined : privateOverwrites(ownerGuild), reason: `Goliath ${definition.label} audit route for ${sourceGuild.name}` });
    }
    if (channel?.isTextBased?.()) {
      routes[routeKey] = channel.id;
      if (String(channel.topic || '').includes(reportRouteMarker(sourceGuild, routeKey))) {
        await repairManagedChannelPermissions(channel, ownerGuild, `Repair Goliath ${definition.label} audit route for ${sourceGuild.name}`).catch(() => false);
        await ensureReportFeedHeader(channel, sourceGuild, routeKey, definition.label).catch(() => null);
      }
    }
  }
  const saved = auditStore.updateConfig({ guilds: { [String(sourceGuild.id)]: { ...existing, enabled: existing.enabled !== false, mode: 'custom', routes } } });
  return { ownerGuildId: ownerGuild.id, categoryId: category?.id || null, routes: saved.guilds?.[String(sourceGuild.id)]?.routes || routes };
}

function eventUserId(event) { const id = event?.user?.id; return id ? String(id) : null; }
function eventUserLabel(event, userId) { return event?.user?.displayName || event?.user?.globalName || event?.user?.username || `user-${String(userId).slice(-6)}`; }
function findUserChannel(ownerGuild, sourceGuild, userId) {
  const marker = userMarker(sourceGuild, userId);
  return ownerGuild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && String(channel.topic || '').includes(marker)) || null;
}
async function chooseUserCategory(ownerGuild, sourceGuild, firstCategory) {
  const categories = findGuildCategories(ownerGuild, sourceGuild);
  if (firstCategory && !categories.has(firstCategory.id)) categories.set(firstCategory.id, firstCategory);
  const available = categories.find((category) => categoryChildCount(ownerGuild, category.id) < MAX_CATEGORY_CHILDREN);
  if (available) return available;
  if (!autoProvisionEnabled()) return firstCategory || categories.first?.() || null;
  return ensureGuildCategory(ownerGuild, sourceGuild, Math.max(1, categories.size + 1));
}
function profileMessageId(channel) { return String(channel?.topic || '').match(/GOLIATH_AUDIT_PROFILE:(\d+)/)?.[1] || null; }
async function findProfileMessage(channel, userId) {
  const knownId = profileMessageId(channel);
  if (knownId) { const known = await channel.messages.fetch(knownId).catch(() => null); if (known) return known; }
  const pinned = await channel.messages.fetchPinned().catch(() => null);
  return pinned?.find((message) => message.embeds?.some((embed) => String(embed.footer?.text || '') === `Goliath User Intelligence • ${userId}`)) || null;
}
async function refreshUserSummary(client, sourceGuild, channel, userId, force = false) {
  if (!channel?.isTextBased?.() || !userId) return false;
  const now = Date.now();
  if (!force && now - Number(summaryRefresh.get(channel.id) || 0) < SUMMARY_REFRESH_MS) return true;
  summaryRefresh.set(channel.id, now);
  try {
    const report = await buildReport(client, userId);
    const payload = { embeds: [buildUserIntelligenceEmbed(report, sourceGuild)], components: buildUserIntelligenceControls(), allowedMentions: { parse: [] } };
    let message = await findProfileMessage(channel, userId);
    if (message) { await message.edit(payload); return true; }
    message = await channel.send(payload);
    await message.pin('Goliath User Intelligence summary').catch(() => null);
    const baseTopic = String(channel.topic || '').replace(/\s*•?\s*GOLIATH_AUDIT_PROFILE:\d+/g, '').trim();
    const nextTopic = `${baseTopic} • ${profileMarker(message.id)}`.slice(0, 1024);
    if (nextTopic !== channel.topic) await channel.setTopic(nextTopic, 'Track Goliath User Intelligence summary').catch(() => null);
    return true;
  } catch (error) { console.warn('[Audit Intelligence] user summary refresh failed:', error?.message || error); return false; }
}
async function ensureUserAuditChannel(client, sourceGuild, event) {
  const userId = eventUserId(event);
  if (!userId) return null;
  const context = await ensureAuditContext(client, sourceGuild);
  if (!context) return null;
  const existing = findUserChannel(context.ownerGuild, sourceGuild, userId);
  if (existing) { await refreshUserSummary(client, sourceGuild, existing, userId).catch(() => null); return existing; }
  if (!autoProvisionEnabled()) return context.systemChannel;
  const category = await chooseUserCategory(context.ownerGuild, sourceGuild, context.category);
  const label = eventUserLabel(event, userId);
  const channel = await context.ownerGuild.channels.create({ name: `user-${slug(label, 'user').slice(0, 70)}-${userId.slice(-6)}`.slice(0, 100), type: ChannelType.GuildText, parent: category?.id || null, topic: `${userMarker(sourceGuild, userId)} • ${label} • ${userId} • Individual user audit history`.slice(0, 1024), permissionOverwrites: category ? undefined : privateOverwrites(context.ownerGuild), reason: `Goliath user audit stream for ${label} in ${sourceGuild.name}` });
  await refreshUserSummary(client, sourceGuild, channel, userId, true).catch(() => null);
  return channel;
}
async function ensureAuditChannel(client, sourceGuild) { return (await ensureAuditContext(client, sourceGuild))?.systemChannel || null; }

function routeKeyForEvent(event) {
  const category = String(event?.category || '').toLowerCase(); const type = String(event?.type || '').toLowerCase();
  if (category === 'moderation' || /^member\.(ban|unban|kick|timeout|prune)/.test(type)) return 'moderation';
  if (category === 'automod' || category === 'security') return 'security';
  if (category === 'message' || type.startsWith('reaction.')) return 'messages';
  if (category === 'role' || type === 'member.roles' || type.includes('permission')) return 'roles';
  if (category === 'goliath' || type.startsWith('goliath.')) return 'goliath';
  if (category === 'voice' || type.startsWith('voice.')) return 'voice';
  if (category === 'member' || type.startsWith('member.')) return 'members';
  return 'guild';
}
function monitorKeyForEvent(event) { return routeKeyForEvent(event) === 'guild' ? 'guild' : routeKeyForEvent(event); }
function monitoringEnabled(sourceGuild, event) {
  const guildConfig = auditStore.getConfig().guilds?.[String(sourceGuild?.id || '')] || {};
  if (guildConfig.enabled === false) return false;
  const monitoring = guildConfig.monitoring && typeof guildConfig.monitoring === 'object' ? guildConfig.monitoring : {};
  return monitoring[monitorKeyForEvent(event)] !== false;
}
function preferredRemoteProbeMode(sourceGuild) {
  const guildId = String(sourceGuild?.id || '');
  const registryEntry = sourceGuild?.environments ? sourceGuild : (auditStore.getGuildRegistry?.() || []).find((entry) => String(entry?.guildId || '') === guildId);
  const currentMode = auditStore.runtimeMode?.() || String(process.env.BOT_MODE || 'DEV').toUpperCase();
  const candidates = Object.entries(registryEntry?.environments || {}).filter(([mode]) => String(mode).toUpperCase() !== String(currentMode).toUpperCase()).map(([mode, info]) => ({ mode: String(mode).toUpperCase(), observedAt: info?.observedAt || null, liveScore: info?.observedAt ? 1 : 0 })).sort((a, b) => b.liveScore - a.liveScore || String(b.observedAt || '').localeCompare(String(a.observedAt || '')));
  return candidates[0]?.mode || null;
}
function probeWait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function runLocalEndToEndProbe(client, sourceGuild) {
  const guildId = String(sourceGuild?.id || '');
  if (!guildId || !client?.guilds?.cache) return { started: false, reason: 'invalid-guild' };
  const liveGuild = client.guilds.cache.get(guildId) || null;
  if (!liveGuild) return { started: false, reason: 'registry-only' };
  const now = Date.now();
  if (now - Number(liveProbeCooldown.get(guildId) || 0) < LIVE_PROBE_COOLDOWN_MS) return { started: false, reason: 'cooldown' };
  const botMember = liveGuild.members.me || null;
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageChannels)) return { started: false, reason: 'missing-manage-channels' };
  liveProbeCooldown.set(guildId, now);
  const probeName = `goliath-e2e-${now.toString(36).slice(-7)}`.slice(0, 100);
  const permissionOverwrites = [{ id: liveGuild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }];
  const channel = await liveGuild.channels.create({ name: probeName, type: ChannelType.GuildText, topic: `GOLIATH_AUDIT_E2E_PROBE • Temporary hidden channel used to verify real Discord event capture and routing • ${new Date(now).toISOString()}`.slice(0, 1024), permissionOverwrites, reason: 'Goliath Audit Intelligence live end-to-end routing probe' }).catch((error) => { console.warn('[Audit Intelligence] live end-to-end probe channel create failed:', error?.message || error); return null; });
  if (!channel) { liveProbeCooldown.delete(guildId); return { started: false, reason: 'create-failed' }; }
  setTimeout(() => { channel.delete('Goliath Audit Intelligence live end-to-end routing probe complete').catch((error) => console.warn('[Audit Intelligence] live end-to-end probe cleanup failed:', error?.message || error)); }, 1800);
  return { started: true, channelId: channel.id, channelName: channel.name, routeKey: 'guild' };
}
async function runLiveEndToEndProbe(client, sourceGuild) {
  const guildId = String(sourceGuild?.id || '');
  if (!guildId || !client?.guilds?.cache) return { started: false, reason: 'invalid-guild' };
  if (client.guilds.cache.has(guildId)) return runLocalEndToEndProbe(client, sourceGuild);
  const targetMode = preferredRemoteProbeMode(sourceGuild);
  if (!targetMode) return { started: false, reason: 'registry-only' };
  const request = auditStore.createLiveProbeRequest?.(guildId, targetMode, security.getBotOwnerId?.() || null);
  if (!request?.id) return { started: false, reason: 'registry-only' };
  const terminalResult = (current) => {
    const status = String(current?.status || '').toLowerCase();
    const environment = current?.completedBy || current?.failedBy || current?.claimedBy || targetMode;
    if (status === 'completed') {
      const result = current.result && typeof current.result === 'object' ? current.result : { started: false, reason: 'create-failed' };
      return { ...result, remote: true, environment, requestId: request.id, lifecycleStatus: status, channelName: result.started && result.channelName ? `${result.channelName} (${environment})` : result.channelName };
    }
    if (status === 'failed') {
      const result = current.result && typeof current.result === 'object' ? current.result : { started: false, reason: 'remote-failed' };
      return { ...result, started: false, reason: result.reason || 'remote-failed', remote: true, environment, requestId: request.id, lifecycleStatus: status };
    }
    if (status === 'expired') return { started: false, reason: 'expired', remote: true, environment, requestId: request.id, lifecycleStatus: status };
    return null;
  };
  const deadline = Date.now() + REMOTE_LIVE_PROBE_WAIT_MS;
  while (Date.now() < deadline) {
    const current = auditStore.getLiveProbeRequest?.(request.id);
    const terminal = terminalResult(current);
    if (terminal) return terminal;
    await probeWait(REMOTE_LIVE_PROBE_POLL_MS);
  }
  const current = auditStore.getLiveProbeRequest?.(request.id);
  const terminal = terminalResult(current);
  if (terminal) return terminal;
  return { started: false, reason: 'remote-timeout', remote: true, environment: current?.claimedBy || targetMode, requestId: request.id, lifecycleStatus: current?.status || 'pending' };
}
async function configuredRouteChannel(client, sourceGuild, event) {
  if (String(event?.type || '').startsWith('test.')) await runLiveEndToEndProbe(client, sourceGuild).catch(() => null);
  const guildConfig = auditStore.getConfig().guilds?.[String(sourceGuild?.id || '')] || {};
  const routes = guildConfig.routes && typeof guildConfig.routes === 'object' ? guildConfig.routes : {};
  const key = routeKeyForEvent(event);
  const ownerGuild = await getOwnerGuild(client);
  if (!ownerGuild) return null;
  const configuredId = routes[key] || routes.default || null;
  const configuredChannel = await resolveTextChannel(ownerGuild, configuredId);
  if (configuredChannel) return configuredChannel;
  if (key === 'guild') return findSystemChannel(ownerGuild, sourceGuild);
  return findReportRouteChannel(ownerGuild, sourceGuild, key);
}

function viewState(channel, ownerGuild) {
  if (!channel) return null;
  const everyone = channel.permissionsFor(ownerGuild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ?? true;
  const ownerId = security.getBotOwnerId();
  const owner = ownerId ? channel.permissionsFor(ownerId)?.has(PermissionFlagsBits.ViewChannel) ?? false : false;
  const bot = ownerGuild.members.me ? channel.permissionsFor(ownerGuild.members.me)?.has(PermissionFlagsBits.ViewChannel) ?? false : false;
  return { everyone, owner, bot };
}
async function inspectReportFeeds(client, sourceGuild) {
  const ownerGuild = await getOwnerGuild(client);
  if (!ownerGuild || !sourceGuild?.id) return null;
  const config = auditStore.getConfig();
  const routes = config.guilds?.[String(sourceGuild.id)]?.routes || {};
  const keys = ['guild', ...Object.keys(REPORT_ROUTE_CHANNELS), 'default'];
  const feeds = [];
  for (const key of keys) {
    let channel = await resolveTextChannel(ownerGuild, routes[key]);
    if (!channel && key === 'guild') channel = findSystemChannel(ownerGuild, sourceGuild);
    if (!channel && REPORT_ROUTE_CHANNELS[key]) channel = findReportRouteChannel(ownerGuild, sourceGuild, key);
    if (!channel && key === 'default') channel = await resolveTextChannel(ownerGuild, routes.default || routes.guild) || findSystemChannel(ownerGuild, sourceGuild);
    const delivery = channelDeliveryState(channel, ownerGuild);
    feeds.push({ key, label: key === 'guild' ? 'Guild / System Events' : key === 'default' ? 'Fallback / All Other Events' : REPORT_ROUTE_CHANNELS[key]?.label || key, channelId: channel?.id || routes[key] || null, channelName: channel?.name || null, configured: Boolean(routes[key]), ...delivery });
  }
  return { sourceGuildId: String(sourceGuild.id), destinationGuildId: ownerGuild.id, healthy: feeds.every((feed) => feed.healthy), feeds };
}
async function inspectStructure(client, sourceGuild) {
  const ownerGuild = await getOwnerGuild(client);
  if (!ownerGuild || !sourceGuild) return null;
  const systemChannel = findSystemChannel(ownerGuild, sourceGuild);
  const userChannels = findUserChannels(ownerGuild, sourceGuild);
  const parents = new Map();
  for (const channel of [systemChannel, ...userChannels.values()].filter(Boolean)) if (channel.parent?.type === ChannelType.GuildCategory) parents.set(channel.parent.id, channel.parent);
  const config = auditStore.getConfig();
  const routes = config.guilds?.[sourceGuild.id]?.routes || {};
  const routeStates = Object.entries(routes).map(([key, channelId]) => { const channel = ownerGuild.channels.cache.get(String(channelId)) || null; const delivery = channelDeliveryState(channel, ownerGuild); return { key, channelId, ...delivery }; });
  const systemPermissions = viewState(systemChannel, ownerGuild);
  const insecureUsers = userChannels.filter((channel) => viewState(channel, ownerGuild)?.everyone).size;
  const issues = [];
  if (!systemChannel) issues.push('Missing guild-events audit channel');
  if (systemPermissions?.everyone) issues.push('Guild audit channel is visible to @everyone');
  if (systemChannel && (!systemPermissions?.owner || !systemPermissions?.bot)) issues.push('Owner or Goliath cannot view guild audit channel');
  if (insecureUsers) issues.push(`${insecureUsers} user audit channel(s) visible to @everyone`);
  const missingRoutes = routeStates.filter((route) => !route.exists);
  const unhealthyRoutes = routeStates.filter((route) => route.exists && !route.healthy);
  if (missingRoutes.length) issues.push(`${missingRoutes.length} configured route channel(s) missing`);
  if (unhealthyRoutes.length) issues.push(`${unhealthyRoutes.length} configured route channel(s) missing required Goliath permissions`);
  return { sourceGuildId: sourceGuild.id, sourceGuildName: sourceGuild.name, destinationGuildId: ownerGuild.id, systemChannel: systemChannel ? { id: systemChannel.id, name: systemChannel.name, parentId: systemChannel.parentId || null } : null, categoryCount: parents.size, categories: [...parents.values()].map((category) => ({ id: category.id, name: category.name, childCount: categoryChildCount(ownerGuild, category.id) })), userChannelCount: userChannels.size, insecureUserChannelCount: insecureUsers, routeStates, missingRouteCount: missingRoutes.length, unhealthyRouteCount: unhealthyRoutes.length, permissions: systemPermissions, healthy: issues.length === 0, issues };
}
async function repairStructure(client, sourceGuild) {
  if (!sourceGuild) return null;
  const before = await inspectStructure(client, sourceGuild);
  await ensureAuditContext(client, sourceGuild);
  const ownerGuild = await getOwnerGuild(client);
  if (ownerGuild) {
    const current = auditStore.getConfig();
    const existing = current.guilds?.[sourceGuild.id] || {};
    const routes = { ...(existing.routes || {}) };
    let changed = false;
    for (const [key, channelId] of Object.entries(routes)) if (!ownerGuild.channels.cache.get(String(channelId))) { delete routes[key]; changed = true; }
    if (changed) auditStore.updateConfig({ guilds: { [sourceGuild.id]: { ...existing, routes, mode: Object.keys(routes).length ? 'custom' : 'auto' } } });
    await ensureReportRoutes(client, sourceGuild).catch((error) => console.warn('[Audit Intelligence] report route self-repair failed:', error?.message || error));
  }
  return { before, after: await inspectStructure(client, sourceGuild) };
}

function registryEnvironmentNames(entry) { return Object.keys(entry?.environments || {}).filter(Boolean); }
function registryEntryForGuild(registry, guildId) { return registry.find((entry) => String(entry?.guildId || '') === String(guildId || '')) || null; }

async function inspectHealth(client) {
  const config = auditStore.getConfig();
  const commandCenter = config.commandCenter || {};
  const issues = [];
  const ownerGuild = await getOwnerGuild(client);
  let commandChannel = null;
  let commandMessage = null;
  let commandPermissions = null;
  let privateCommandRegistered = false;
  let globalCommandLeaked = false;
  if (!commandCenter.guildId) issues.push('Command Center destination is not configured');
  if (!ownerGuild) issues.push('Command Center destination guild is unavailable to Goliath');
  if (ownerGuild) {
    commandChannel = commandCenter.channelId ? ownerGuild.channels.cache.get(String(commandCenter.channelId)) || await ownerGuild.channels.fetch(String(commandCenter.channelId)).catch(() => null) : findCommandCenterChannel(ownerGuild);
    if (!commandChannel?.isTextBased?.()) issues.push('Command Center channel is missing or unavailable');
    if (commandChannel) {
      commandPermissions = viewState(commandChannel, ownerGuild);
      if (commandPermissions.everyone) issues.push('Command Center channel is visible to @everyone');
      if (!commandPermissions.owner) issues.push('Goliath owner cannot view the Command Center channel');
      if (!commandPermissions.bot) issues.push('Goliath cannot view the Command Center channel');
      commandMessage = commandCenter.messageId ? await commandChannel.messages.fetch(String(commandCenter.messageId)).catch(() => null) : null;
      if (!commandMessage) issues.push('Persistent Command Center panel message is missing');
    }
    const privateCommands = await ownerGuild.commands.fetch().catch(() => null);
    privateCommandRegistered = Boolean(privateCommands?.find((command) => command.name === 'commandcenter'));
    if (!privateCommandRegistered) issues.push('/commandcenter is not registered in the private destination guild');
  }
  if (client?.application?.commands) {
    const globalCommands = await client.application.commands.fetch().catch(() => null);
    globalCommandLeaked = Boolean(globalCommands?.find((command) => command.name === 'commandcenter'));
    if (globalCommandLeaked) issues.push('/commandcenter is accidentally registered globally');
  }
  const registry = auditStore.getGuildRegistry?.() || [];
  const guildReports = [];
  const configuredGuilds = config.guilds && typeof config.guilds === 'object' ? config.guilds : {};
  for (const [guildId, guildConfig] of Object.entries(configuredGuilds)) {
    const liveGuild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId)).catch(() => null);
    const registryEntry = registryEntryForGuild(registry, guildId);
    const environments = registryEnvironmentNames(registryEntry);
    const sourceGuild = liveGuild || (registryEntry ? { ...registryEntry, id: String(guildId), name: registryEntry.name || String(guildId) } : null);
    const monitoring = guildConfig.monitoring && typeof guildConfig.monitoring === 'object' ? guildConfig.monitoring : {};
    const disabledFamilies = Object.entries(monitoring).filter(([, enabled]) => enabled === false).map(([family]) => family);
    if (!sourceGuild) {
      guildReports.push({ guildId, guildName: null, available: false, liveAccess: false, registryKnown: false, environments: [], enabled: guildConfig.enabled !== false, disabledFamilies, structure: null, healthy: false, issues: ['Guild is unavailable to every known Goliath collector'] });
      issues.push(`Configured monitored guild ${guildId} is unavailable to every known Goliath collector`);
      continue;
    }
    const structure = await inspectStructure(client, sourceGuild);
    const guildIssues = [];
    if (guildConfig.enabled === false) guildIssues.push('Guild monitoring is paused');
    if (disabledFamilies.length) guildIssues.push(`${disabledFamilies.length} monitoring family/families disabled`);
    if (!structure?.healthy) guildIssues.push(...(structure?.issues || ['Audit structure is unavailable']));
    guildReports.push({ guildId: String(sourceGuild.id), guildName: sourceGuild.name || String(guildId), available: true, liveAccess: Boolean(liveGuild), registryKnown: Boolean(registryEntry), registryOnly: !liveGuild && Boolean(registryEntry), environments, lastSeenAt: registryEntry?.lastSeenAt || null, enabled: guildConfig.enabled !== false, disabledFamilies, mode: guildConfig.mode || 'auto', structure, healthy: guildIssues.length === 0, issues: guildIssues });
  }
  const structuralFailures = guildReports.filter((report) => report.available && report.structure && !report.structure.healthy).length;
  const unavailableGuilds = guildReports.filter((report) => !report.available).length;
  const registryOnlyGuilds = guildReports.filter((report) => report.registryOnly).length;
  const pausedGuilds = guildReports.filter((report) => report.enabled === false).length;
  const partiallyDisabledGuilds = guildReports.filter((report) => report.disabledFamilies.length > 0).length;
  return { checkedAt: new Date().toISOString(), environment: String(process.env.BOT_MODE || 'dev').toUpperCase(), destination: ownerGuild ? { id: ownerGuild.id, name: ownerGuild.name } : null, commandCenter: { configured: Boolean(commandCenter.guildId), channelId: commandChannel?.id || commandCenter.channelId || null, channelName: commandChannel?.name || null, messagePresent: Boolean(commandMessage), permissions: commandPermissions, privateCommandRegistered, globalCommandLeaked }, guilds: guildReports, counts: { configured: guildReports.length, healthy: guildReports.filter((report) => report.healthy).length, structuralFailures, unavailable: unavailableGuilds, registryOnly: registryOnlyGuilds, paused: pausedGuilds, partiallyDisabled: partiallyDisabledGuilds }, healthy: issues.length === 0 && structuralFailures === 0 && unavailableGuilds === 0, issues };
}

async function repairHealth(client) {
  const before = await inspectHealth(client);
  const actions = [];
  const ownerGuild = await getOwnerGuild(client);
  if (ownerGuild) {
    const commandBefore = before.commandCenter || {};
    const needsCommandCenterRepair = !commandBefore.channelId || !commandBefore.messagePresent || commandBefore.permissions?.everyone || !commandBefore.permissions?.owner || !commandBefore.permissions?.bot;
    if (needsCommandCenterRepair) {
      const repaired = await ensureCommandCenter(client, ownerGuild).catch((error) => { console.warn('[Audit Intelligence] Command Center health repair failed:', error?.message || error); return null; });
      actions.push({ type: 'command-center', repaired: Boolean(repaired) });
    }
  }
  for (const report of before.guilds || []) {
    if (!report.available || !report.structure || report.structure.healthy) continue;
    const sourceGuild = client.guilds.cache.get(String(report.guildId)) || (auditStore.getGuildRegistry?.() || []).find((entry) => String(entry?.guildId || '') === String(report.guildId));
    if (!sourceGuild) { actions.push({ type: 'guild-structure', guildId: report.guildId, repaired: false, reason: 'unavailable' }); continue; }
    const result = await repairStructure(client, { ...sourceGuild, id: String(report.guildId), name: sourceGuild.name || report.guildName || String(report.guildId) }).catch((error) => { console.warn('[Audit Intelligence] health structure repair failed:', error?.message || error); return null; });
    actions.push({ type: 'guild-structure', guildId: String(report.guildId), guildName: report.guildName || null, repaired: Boolean(result?.after?.healthy), beforeIssues: result?.before?.issues || [], afterIssues: result?.after?.issues || [] });
  }
  const after = await inspectHealth(client);
  return { before, after, actions, repaired: !before.healthy && after.healthy, improved: (after.issues?.length || 0) < (before.issues?.length || 0) || (after.counts?.structuralFailures || 0) < (before.counts?.structuralFailures || 0) };
}

async function deliver(client, sourceGuild, event) {
  if (!sourceGuild || sourceGuild.id === getOwnerAuditGuildId() || !monitoringEnabled(sourceGuild, event)) return false;
  const userId = eventUserId(event);
  let routedChannel = await configuredRouteChannel(client, sourceGuild, event);
  if (routedChannel && !channelDeliveryState(routedChannel, routedChannel.guild).healthy && autoProvisionEnabled()) { await ensureReportRoutes(client, sourceGuild).catch((error) => console.warn('[Audit Intelligence] unhealthy report route repair failed:', error?.message || error)); routedChannel = await configuredRouteChannel(client, sourceGuild, event); }
  if (!routedChannel && autoProvisionEnabled()) { await ensureReportRoutes(client, sourceGuild).catch((error) => console.warn('[Audit Intelligence] automatic report route provisioning failed:', error?.message || error)); routedChannel = await configuredRouteChannel(client, sourceGuild, event); }
  const primary = userId ? await ensureUserAuditChannel(client, sourceGuild, event) : (routedChannel || await ensureAuditChannel(client, sourceGuild));
  if (!primary?.isTextBased?.()) return false;
  const payload = { embeds: [buildAuditEmbed(event)], allowedMentions: { parse: [] } };
  let primaryMessage = await primary.send(payload).catch((error) => { console.warn('[Audit Intelligence] primary report delivery failed:', error?.message || error); return null; });
  if (!primaryMessage) {
    const fallback = await ensureAuditChannel(client, sourceGuild);
    if (!fallback?.isTextBased?.() || fallback.id === primary.id) return false;
    primaryMessage = await fallback.send(payload).catch((error) => { console.warn('[Audit Intelligence] fallback report delivery failed:', error?.message || error); return null; });
    if (!primaryMessage) return false;
  }
  if (userId && routedChannel?.isTextBased?.() && routedChannel.id !== primary.id) await routedChannel.send(payload).catch(() => null);
  if (userId) refreshUserSummary(client, sourceGuild, primary, userId).catch(() => null);
  return true;
}

module.exports = {
  deliver,
  ensureAuditChannel,
  ensureUserAuditChannel,
  ensureReportRoutes,
  refreshUserSummary,
  getOwnerAuditGuildId,
  ensureCommandCenter,
  routeKeyForEvent,
  monitorKeyForEvent,
  monitoringEnabled,
  configuredRouteChannel,
  runLocalEndToEndProbe,
  runLiveEndToEndProbe,
  channelDeliveryState,
  inspectReportFeeds,
  inspectStructure,
  repairStructure,
  inspectHealth,
  repairHealth,
};