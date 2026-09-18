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
function pinnedItems(result) { return result?.items || result || null; }
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
  const pinnedResult = await channel.messages.fetchPins().catch(() => null);
  const pinned = pinnedItems(pinnedResult);
  let message = pinned?.find?.((item) => item.author?.bot && item.system !== true && String(item.content || '').includes(marker)) || null;
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
  if (knownId) { const known = await channel.messages.fetch(knownId).catch(() => null); if (known && known.system !== true && known.editable !== false) return known; }
  const pinnedResult = await channel.messages.fetchPins().catch(() => null);
  const pinned = pinnedItems(pinnedResult);
  return pinned?.find?.((message) => message.author?.id === channel.client.user?.id && message.system !== true && message.editable !== false && message.embeds?.some((embed) => String(embed.footer?.text || '') === `Goliath User Intelligence • ${userId}`)) || null;
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

async function deliver(client, sourceGuild, event) {
  const context = await ensureAuditContext(client, sourceGuild);
  if (!context) return false;
  const cfg = auditStore.getConfig().guilds?.[String(sourceGuild.id)] || {};
  if (cfg.enabled === false) return false;
  const routeKey = routeKeyForEvent(event);
  const routeId = cfg.routes?.[routeKey] || cfg.routes?.default || context.systemChannel?.id;
  let channel = await resolveTextChannel(context.ownerGuild, routeId);
  if (!channel) channel = context.systemChannel;
  if (!channel?.isTextBased?.()) return false;
  if (String(channel.topic || '').includes('GOLIATH_AUDIT_ROUTE:') || String(channel.topic || '').includes('GOLIATH_AUDIT_GUILD:')) await repairManagedChannelPermissions(channel, context.ownerGuild, `Repair Goliath audit delivery route for ${sourceGuild.name}`).catch(() => false);
  const embed = buildAuditEmbed(event, sourceGuild);
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  await channel.send(payload);
  const userChannel = await ensureUserAuditChannel(client, sourceGuild, event);
  if (userChannel?.id && userChannel.id !== channel.id) await userChannel.send(payload).catch(() => null);
  return true;
}

module.exports = { ensureCommandCenter, ensureAuditContext, ensureAuditChannel, ensureReportRoutes, deliver, refreshUserSummary };