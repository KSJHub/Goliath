'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require('discord.js');

const fetch = require('node-fetch');
const security = require('../security/securityCore');
const guildManager = require('../guild/guildManager');
const { createServerBackup } = require('../security/serverBackup');

const COPY_PREFIX = 'duplicator-copy';
const BUILD_PREFIX = 'duplicator-build';
const SESSION_TTL_MS = 20 * 60 * 1000;
const copySessions = new Map();
const buildSessions = new Map();

const COPY_OPTIONS = Object.freeze({
  roles: 'Roles',
  categories: 'Categories',
  channels: 'Channels',
  permissions: 'Channel Permissions',
  serverSettings: 'Server Settings + Branding',
  emojis: 'Emojis',
  stickers: 'Stickers',
  scheduledEvents: 'Scheduled Events',
  webhooks: 'Webhooks',
  automod: 'AutoMod Rules',
});

const ACTIVE_OPTIONS = new Set(['roles', 'categories', 'channels', 'permissions', 'serverSettings', 'emojis']);
const FUTURE_OPTIONS = new Set(['stickers', 'scheduledEvents', 'webhooks', 'automod']);

const CONFLICT_MODES = Object.freeze({
  skip: 'Skip Existing',
  rename: 'Rename Duplicates',
  replace: 'Replace Destination',
});

const REQUIRED_BOT_PERMISSIONS = [
  ['ManageGuild', PermissionFlagsBits.ManageGuild],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ManageEmojisAndStickers', PermissionFlagsBits.ManageEmojisAndStickers],
  ['ManageWebhooks', PermissionFlagsBits.ManageWebhooks],
  ['ViewAuditLog', PermissionFlagsBits.ViewAuditLog],
];

const DANGEROUS_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageEmojisAndStickers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

function splitIds(value) {
  return String(value || '').split(',').map((entry) => entry.trim()).filter((entry) => /^\d{16,25}$/.test(entry));
}

function ownerIds() {
  return [...new Set([
    ...splitIds(process.env.DUPLICATOR_OWNER_IDS),
    ...splitIds(process.env.SERVER_COPY_OWNER_IDS),
    ...splitIds(process.env.OWNER_ID),
    ...splitIds(process.env.OWNER_IDS),
    ...splitIds(process.env.BOT_OWNER_ID),
    ...splitIds(process.env.BOT_OWNER_IDS),
    ...(security.getBotOwnerIds?.() || []),
  ])];
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function moduleConfig(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  return modules.duplicator || modules.serverCopy || {};
}

function assertAccess(interaction) {
  if (!interaction?.guild) return { allowed: false, reason: 'This command can only be used inside a server.' };
  if (!ownerIds().includes(String(interaction.user?.id))) return { allowed: false, reason: 'This command is restricted to the bot owner.' };
  if (moduleConfig(interaction.guild.id).enabled === false) return { allowed: false, reason: 'Duplicator is disabled for this guild.' };
  return { allowed: true };
}

function embed(title, description, color = 0x5865f2) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp(new Date());
}

function guildById(client, id) {
  return client.guilds.cache.get(String(id || '').trim()) || null;
}

async function fetchGuildState(guild) {
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  await guild.members.fetchMe().catch(() => null);
}

function guildChoices(client, selectedId = null) {
  return [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 25).map((guild) => ({
    label: guild.name.slice(0, 100),
    description: guild.id,
    value: guild.id,
    default: guild.id === selectedId,
  }));
}

function componentId(prefix, sessionId, action) {
  return `${prefix}:${sessionId}:${action}`;
}

function parseComponentId(customId, prefix) {
  const parts = String(customId || '').split(':');
  if (parts[0] !== prefix || !parts[1] || !parts[2]) return null;
  return { sessionId: parts[1], action: parts.slice(2).join(':') };
}

function cleanupSessions(map) {
  const current = Date.now();
  for (const [id, session] of map.entries()) {
    if (!session || session.expiresAt <= current) map.delete(id);
  }
}

function getSession(map, interaction, sessionId) {
  cleanupSessions(map);
  const session = map.get(sessionId);
  if (!session || session.ownerId !== interaction.user?.id) return null;
  return session;
}

function makeSession(interaction, type) {
  const session = {
    id: `${interaction.user.id}-${Date.now().toString(36)}`,
    ownerId: interaction.user.id,
    controlGuildId: interaction.guild.id,
    sourceGuildId: null,
    destinationGuildId: interaction.options?.getString?.('destination_server') || interaction.guild.id,
    templateId: null,
    selectedOptions: [...ACTIVE_OPTIONS],
    conflictMode: 'skip',
    dryRun: false,
    pendingConfirm: false,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  (type === 'build' ? buildSessions : copySessions).set(session.id, session);
  return session;
}

function channelTemplate(id, name, type, parentId, position) {
  return { id, name, type, parentId, position, topic: null, nsfw: false, rateLimitPerUser: 0, bitrate: null, userLimit: 0, rtcRegion: null, videoQualityMode: null, defaultAutoArchiveDuration: null, defaultThreadRateLimitPerUser: 0, availableTags: [], permissionOverwrites: [] };
}

function makeTemplate(templateId, name, description, roleDefs, categoryDefs) {
  const roles = roleDefs.map(([roleName, color], index) => ({ id: `template:${templateId}:role:${slugify(roleName)}`, name: roleName, color, hoist: index < 3, mentionable: false, permissions: '0', position: index + 1 }));
  const channels = [];
  let position = 0;
  for (const [categoryName, children] of categoryDefs) {
    const categoryId = `template:${templateId}:category:${slugify(categoryName)}`;
    channels.push(channelTemplate(categoryId, categoryName, ChannelType.GuildCategory, null, position++));
    for (const [channelName, type] of children) channels.push(channelTemplate(`template:${templateId}:channel:${slugify(channelName)}`, channelName, type, categoryId, position++));
  }
  return { meta: { id: templateId, name, description, version: '1.0.0', createdAt: 'system-default', updatedAt: 'system-default', createdBy: 'Goliath', updatedBy: 'Goliath', sourceGuildId: `template:${templateId}`, sourceGuildName: name, environment: 'DEFAULT', schemaVersion: 2, defaultTemplate: true }, snapshot: { sourceGuild: { id: `template:${templateId}`, name }, options: ['roles', 'categories', 'channels', 'permissions'], settings: null, roles, channels, emojis: [], future: {}, stats: { roles: roles.length, categories: channels.filter((channel) => channel.type === ChannelType.GuildCategory).length, channels: channels.filter((channel) => channel.type !== ChannelType.GuildCategory).length, permissionOverwrites: 0, emojis: 0 } } };
}

const DEFAULT_TEMPLATES = Object.freeze({
  'basic-gaming': makeTemplate('basic-gaming', 'Basic Gaming', 'Starter gaming community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Moderator', 0x3b82f6], ['Member', 0x22c55e]], [['INFORMATION', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['announcements', ChannelType.GuildAnnouncement]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['clips-and-media', ChannelType.GuildText], ['looking-for-group', ChannelType.GuildText], ['General Voice', ChannelType.GuildVoice]]], ['SUPPORT', [['open-a-ticket', ChannelType.GuildText], ['staff-chat', ChannelType.GuildText]]]]),
  'community-server': makeTemplate('community-server', 'Community Server', 'Clean public community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Staff', 0x3b82f6], ['Member', 0x22c55e]], [['START HERE', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['server-info', ChannelType.GuildText]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['introductions', ChannelType.GuildText], ['media', ChannelType.GuildText], ['Community Voice', ChannelType.GuildVoice]]], ['STAFF', [['staff-chat', ChannelType.GuildText], ['mod-logs', ChannelType.GuildText]]]]),
  'business-support': makeTemplate('business-support', 'Business Support', 'Simple support and client workspace layout.', [['Owner', 0xffc107], ['Manager', 0x6366f1], ['Support Team', 0x3b82f6], ['Client', 0x22c55e]], [['BUSINESS INFO', [['welcome', ChannelType.GuildText], ['announcements', ChannelType.GuildAnnouncement], ['faq', ChannelType.GuildText]]], ['SUPPORT', [['support-desk', ChannelType.GuildText], ['ticket-updates', ChannelType.GuildText], ['Support Voice', ChannelType.GuildVoice]]], ['INTERNAL', [['team-chat', ChannelType.GuildText], ['admin-logs', ChannelType.GuildText]]]]),
  'creator-streamer': makeTemplate('creator-streamer', 'Creator / Streamer', 'Creator community layout for streams, content and announcements.', [['Creator', 0xffc107], ['Admin', 0xef4444], ['Moderator', 0x3b82f6], ['Subscriber', 0xa855f7], ['Community', 0x22c55e]], [['START HERE', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['stream-announcements', ChannelType.GuildAnnouncement]]], ['CONTENT', [['clips', ChannelType.GuildText], ['youtube', ChannelType.GuildText], ['socials', ChannelType.GuildText]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['suggestions', ChannelType.GuildText], ['Stream Room', ChannelType.GuildVoice]]]]),
});

function serializeChannel(channel) {
  return { id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null, position: channel.rawPosition ?? channel.position ?? 0, topic: channel.topic || null, nsfw: Boolean(channel.nsfw), rateLimitPerUser: channel.rateLimitPerUser || 0, bitrate: channel.bitrate || null, userLimit: channel.userLimit || 0, rtcRegion: channel.rtcRegion || null, videoQualityMode: channel.videoQualityMode || null, defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration || null, defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser || 0, availableTags: Array.isArray(channel.availableTags) ? channel.availableTags.map((tag) => ({ name: tag.name, moderated: Boolean(tag.moderated), emojiId: tag.emojiId || null, emojiName: tag.emojiName || null })) : [], permissionOverwrites: channel.permissionOverwrites?.cache ? channel.permissionOverwrites.cache.map((overwrite) => ({ id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() })) : [] };
}

function snapshot(guild, selectedOptions = [...ACTIVE_OPTIONS]) {
  const selected = new Set(selectedOptions);
  const channels = selected.has('categories') || selected.has('channels') || selected.has('permissions') ? guild.channels.cache.filter((channel) => selected.has('channels') || channel.type === ChannelType.GuildCategory).sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0)).map(serializeChannel) : [];
  const roles = selected.has('roles') || selected.has('permissions') ? guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed).sort((a, b) => a.position - b.position).map((role) => ({ id: role.id, name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions.bitfield.toString(), position: role.position })) : [];
  const emojis = selected.has('emojis') ? guild.emojis.cache.map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated, url: typeof emoji.imageURL === 'function' ? emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png' }) : emoji.url })) : [];
  const settings = selected.has('serverSettings') ? { name: guild.name, description: guild.description || null, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, defaultMessageNotifications: guild.defaultMessageNotifications, afkTimeout: guild.afkTimeout, iconURL: guild.iconURL({ extension: 'png', size: 1024 }) || null, bannerURL: guild.bannerURL({ extension: 'png', size: 2048 }) || null, splashURL: guild.splashURL({ extension: 'png', size: 2048 }) || null } : null;
  const future = {};
  for (const key of FUTURE_OPTIONS) if (selected.has(key)) future[key] = { requested: true, supported: false, reason: 'Reserved for Duplicator API expansion.' };
  return { sourceGuild: { id: guild.id, name: guild.name }, options: [...selected], settings, roles, channels, emojis, future, stats: { roles: roles.length, categories: channels.filter((channel) => channel.type === ChannelType.GuildCategory).length, channels: channels.filter((channel) => channel.type !== ChannelType.GuildCategory).length, permissionOverwrites: channels.reduce((total, channel) => total + (channel.permissionOverwrites?.length || 0), 0), emojis: emojis.length } };
}

function readTemplates(guildId) {
  const config = moduleConfig(guildId);
  return config.templates && typeof config.templates === 'object' && !Array.isArray(config.templates) ? config.templates : {};
}

function saveTemplates(guildId, templates, guildOrMeta = {}) {
  guildManager.updateGuildSection(guildId, 'modules', (modules) => ({ ...modules, duplicator: { ...(modules.duplicator || {}), enabled: modules.duplicator?.enabled ?? true, hidden: true, ownerOnly: true, templates } }), {}, guildOrMeta);
  return templates;
}

function templates(guildId, guildOrMeta = {}) {
  const stored = readTemplates(guildId);
  if (Object.keys(stored).length) return stored;
  return saveTemplates(guildId, JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)), guildOrMeta);
}

function templateList(guildId) {
  return Object.entries(templates(guildId)).filter(([, template]) => template?.snapshot).map(([id, template]) => ({ id, ...template })).sort((a, b) => String(a.meta?.name || a.id).localeCompare(String(b.meta?.name || b.id)));
}

function templateChoices(guildId, selectedId = null) {
  const all = templateList(guildId);
  if (!all.length) return [{ label: 'No templates saved yet', description: 'Use /server action: export first', value: 'none' }];
  return all.slice(0, 25).map((template) => ({ label: String(template.meta?.name || template.id).slice(0, 100), description: `ID: ${template.id} | v${template.meta?.version || '1.0.0'}`.slice(0, 100), value: template.id, default: selectedId === template.id }));
}

function conflictChoices(selected = 'skip') {
  return Object.entries(CONFLICT_MODES).map(([value, label]) => ({ label, value, default: selected === value }));
}

function copyOptionChoices(selectedOptions = []) {
  const selected = new Set(selectedOptions);
  return Object.entries(COPY_OPTIONS).map(([value, label]) => ({ label, value, default: selected.has(value) }));
}

function confirmText(session, label) {
  if (session.dryRun) return '🧪 Dry run is ON. No changes will be made.';
  if (session.pendingConfirm) return `⚠️ FINAL CONFIRMATION: press **Confirm ${label}** to modify the destination.`;
  return '⚠️ First press arms final confirmation. No changes happen until the red confirm button is pressed.';
}

function copyPanel(interaction, session) {
  return { embeds: [embed('🛠️ Server Duplicator — Copy', [`**Source:** ${session.sourceGuildId ? guildById(interaction.client, session.sourceGuildId)?.name || session.sourceGuildId : '`Not selected`'}`, `**Destination:** ${session.destinationGuildId ? guildById(interaction.client, session.destinationGuildId)?.name || session.destinationGuildId : '`Not selected`'}`, `**Conflict:** \`${session.conflictMode}\``, `**Dry run:** \`${session.dryRun ? 'ON' : 'OFF'}\``, '', session.selectedOptions.map((key) => `• ${COPY_OPTIONS[key] || key}`).join('\n'), '', confirmText(session, 'Copy')].join('\n'))], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'source')).setPlaceholder('Source server').addOptions(guildChoices(interaction.client, session.sourceGuildId))), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(interaction.client, session.destinationGuildId))), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'options')).setPlaceholder('What to copy').setMinValues(1).setMaxValues(Object.keys(COPY_OPTIONS).length).addOptions(copyOptionChoices(session.selectedOptions))), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'conflict')).setPlaceholder('Conflict mode').addOptions(conflictChoices(session.conflictMode))), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'start')).setLabel(session.pendingConfirm && !session.dryRun ? 'Confirm Copy' : session.dryRun ? 'Run Dry-Run' : 'Start Copy').setStyle(session.pendingConfirm && !session.dryRun ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(!session.sourceGuildId || !session.destinationGuildId || session.sourceGuildId === session.destinationGuildId), new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'dryrun')).setLabel(session.dryRun ? 'Dry Run: ON' : 'Dry Run: OFF').setStyle(session.dryRun ? ButtonStyle.Primary : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger))], flags: MessageFlags.Ephemeral };
}

function buildPanel(interaction, session) {
  const chosen = session.templateId ? templates(session.controlGuildId, interaction.guild)[session.templateId] : null;
  return { embeds: [embed('🏗️ Server Duplicator — Build', [`**Templates available:** \`${templateList(session.controlGuildId).length}\``, `**Template:** ${chosen ? `**${chosen.meta?.name || session.templateId}** \`(${session.templateId})\`` : '`Not selected`'}`, `**Destination:** ${session.destinationGuildId ? guildById(interaction.client, session.destinationGuildId)?.name || session.destinationGuildId : '`Not selected`'}`, `**Conflict:** \`${session.conflictMode}\``, `**Dry run:** \`${session.dryRun ? 'ON' : 'OFF'}\``, chosen ? `\nRoles \`${chosen.snapshot?.stats?.roles || 0}\` • Channels \`${chosen.snapshot?.stats?.channels || 0}\` • Emojis \`${chosen.snapshot?.stats?.emojis || 0}\`` : '', '', confirmText(session, 'Build')].join('\n'))], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'template')).setPlaceholder('Choose template').addOptions(templateChoices(session.controlGuildId, session.templateId))), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(interaction.client, session.destinationGuildId))), new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'conflict')).setPlaceholder('Conflict mode').addOptions(conflictChoices(session.conflictMode))), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'start')).setLabel(session.pendingConfirm && !session.dryRun ? 'Confirm Build' : session.dryRun ? 'Run Dry-Run' : 'Build Server').setStyle(session.pendingConfirm && !session.dryRun ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(!session.templateId || !session.destinationGuildId), new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'dryrun')).setLabel(session.dryRun ? 'Dry Run: ON' : 'Dry Run: OFF').setStyle(session.dryRun ? ButtonStyle.Primary : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger))], flags: MessageFlags.Ephemeral };
}

function existingRole(guild, name) {
  return guild.roles.cache.find((role) => role.name.toLowerCase() === String(name).toLowerCase() && role.id !== guild.id);
}

function existingChannel(guild, channel) {
  return guild.channels.cache.find((item) => item.type === channel.type && item.name.toLowerCase() === String(channel.name).toLowerCase());
}

function uniqueName(existingNames, baseName, maxLength = 100) {
  const base = String(baseName || 'copy').slice(0, maxLength - 8);
  let candidate = `${base}-copy`;
  let index = 2;
  while (existingNames.has(candidate.toLowerCase())) candidate = `${base}-copy-${index++}`.slice(0, maxLength);
  existingNames.add(candidate.toLowerCase());
  return candidate;
}

async function bufferFromUrl(url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch asset: ${response.status}`);
  return response.buffer();
}

function runLog(session, snap) {
  return { status: session.dryRun ? 'dry-run' : 'running', dryRun: Boolean(session.dryRun), conflictMode: session.conflictMode, rollbackBackupId: null, snapshotStats: snap.stats, copied: { serverSettings: 0, roles: 0, categories: 0, channels: 0, permissionOverwrites: 0, emojis: 0 }, deleted: { roles: 0, channels: 0 }, skipped: [], errors: [], notes: [] };
}

function errorLabel(error) {
  return `${error?.code ? `Discord ${error.code}` : 'Error'}: ${error?.message || String(error)}`;
}

function pushError(log, stage, error) {
  const message = `[${stage}] ${errorLabel(error)}`;
  log.errors.push(message);
  console.error(`[Duplicator] ${message}`, error);
}

function hasBotPermission(guild, bit) {
  return Boolean(guild.members.me?.permissions?.has(bit));
}

function missingPermissions(guild) {
  return REQUIRED_BOT_PERMISSIONS.filter(([, bit]) => !hasBotPermission(guild, bit)).map(([name]) => name);
}

function hierarchyWarning(guild) {
  const highest = guild.members.me?.roles?.highest;
  if (!highest || Number(highest.position || 0) <= 1) return 'Goliath role is too low. Move it above all roles it needs to copy/manage.';
  return null;
}

function safeRolePermissions(guild, raw, roleName, log) {
  const permissions = new PermissionsBitField(BigInt(raw || 0));
  for (const bit of DANGEROUS_ROLE_PERMISSIONS) {
    if (permissions.has(bit) && !hasBotPermission(guild, bit)) {
      permissions.remove(bit);
      log.notes.push(`Stripped unsafe permission from ${roleName}: ${new PermissionsBitField(bit).toArray()[0] || String(bit)}`);
    }
  }
  if (permissions.has(PermissionFlagsBits.Administrator) && !hasBotPermission(guild, PermissionFlagsBits.Administrator)) permissions.remove(PermissionFlagsBits.Administrator);
  return permissions;
}

async function clearDestination(guild, log) {
  for (const channel of [...guild.channels.cache.values()].sort((a, b) => b.position - a.position)) {
    try { await channel.delete('Goliath duplicator: replace destination'); log.deleted.channels += 1; } catch (error) { pushError(log, `Delete channel ${channel.name}`, error); }
  }
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  const roles = guild.roles.cache.filter((role) => role.id !== guild.id && !role.managed && role.editable && role.position < botHighest).sort((a, b) => b.position - a.position);
  for (const role of roles.values()) {
    try { await role.delete('Goliath duplicator: replace roles'); log.deleted.roles += 1; } catch (error) { pushError(log, `Delete role ${role.name}`, error); }
  }
}

async function applySettings(guild, snap, log) {
  if (!snap.settings) return;
  const settings = snap.settings;
  const payload = {};
  if (settings.name) payload.name = settings.name;
  if (settings.description !== undefined) payload.description = settings.description || null;
  if (Number.isFinite(settings.verificationLevel)) payload.verificationLevel = settings.verificationLevel;
  if (Number.isFinite(settings.explicitContentFilter)) payload.explicitContentFilter = settings.explicitContentFilter;
  if (Number.isFinite(settings.defaultMessageNotifications)) payload.defaultMessageNotifications = settings.defaultMessageNotifications;
  if (Number.isFinite(settings.afkTimeout)) payload.afkTimeout = settings.afkTimeout;
  if (settings.iconURL) payload.icon = await bufferFromUrl(settings.iconURL).catch(() => null);
  if (settings.bannerURL) payload.banner = await bufferFromUrl(settings.bannerURL).catch(() => null);
  if (settings.splashURL) payload.splash = await bufferFromUrl(settings.splashURL).catch(() => null);
  if (!Object.keys(payload).length) return;
  await guild.edit(payload, 'Goliath duplicator: settings');
  log.copied.serverSettings = Object.keys(payload).length;
}

async function applyRoles(guild, snap, maps, log, conflictMode) {
  const names = new Set(guild.roles.cache.map((role) => role.name.toLowerCase()));
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  for (const role of [...(snap.roles || [])].sort((a, b) => a.position - b.position)) {
    try {
      const found = existingRole(guild, role.name);
      if (found && conflictMode === 'skip') { maps.roles.set(role.id, found.id); log.skipped.push(`Role exists: ${role.name}`); continue; }
      if (found && conflictMode === 'replace') {
        if (found.editable && found.position < botHighest) { await found.delete('Goliath duplicator: replace role'); log.deleted.roles += 1; }
        else { maps.roles.set(role.id, found.id); log.skipped.push(`Role not editable due to Discord hierarchy: ${role.name}`); continue; }
      }
      const name = found && conflictMode === 'rename' ? uniqueName(names, role.name, 100) : role.name;
      const created = await guild.roles.create({ name, colors: { primaryColor: Number(role.color || 0) }, hoist: Boolean(role.hoist), mentionable: Boolean(role.mentionable), permissions: safeRolePermissions(guild, role.permissions, role.name, log), reason: 'Goliath duplicator: role' });
      maps.roles.set(role.id, created.id);
      names.add(created.name.toLowerCase());
      log.copied.roles += 1;
    } catch (error) {
      pushError(log, `Role ${role.name}`, error);
      log.skipped.push(`Role failed: ${role.name}`);
    }
  }
}

function channelPayload(channel, parentId = null, name = null) {
  const payload = { name: name || channel.name, type: channel.type, reason: 'Goliath duplicator: channel' };
  if (parentId) payload.parent = parentId;
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) { payload.topic = channel.topic || undefined; payload.nsfw = channel.nsfw; payload.rateLimitPerUser = channel.rateLimitPerUser || 0; }
  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) { payload.bitrate = channel.bitrate || undefined; payload.userLimit = channel.userLimit || 0; payload.rtcRegion = channel.rtcRegion || undefined; payload.videoQualityMode = channel.videoQualityMode || undefined; }
  if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) { payload.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration || undefined; payload.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser || 0; if (channel.availableTags?.length) payload.availableTags = channel.availableTags; }
  return payload;
}

async function applyChannels(guild, snap, maps, log, conflictMode) {
  const names = new Set(guild.channels.cache.map((channel) => channel.name.toLowerCase()));
  const categories = (snap.channels || []).filter((channel) => channel.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const channels = (snap.channels || []).filter((channel) => channel.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const category of categories) {
    try {
      const found = existingChannel(guild, category);
      if (found && conflictMode === 'skip') { maps.channels.set(category.id, found.id); log.skipped.push(`Category exists: ${category.name}`); continue; }
      if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace category'); log.deleted.channels += 1; }
      const name = found && conflictMode === 'rename' ? uniqueName(names, category.name, 100) : category.name;
      const created = await guild.channels.create(channelPayload(category, null, name));
      maps.channels.set(category.id, created.id);
      names.add(created.name.toLowerCase());
      log.copied.categories += 1;
    } catch (error) { pushError(log, `Category ${category.name}`, error); log.skipped.push(`Category failed: ${category.name}`); }
  }
  for (const channel of channels) {
    try {
      const found = existingChannel(guild, channel);
      if (found && conflictMode === 'skip') { maps.channels.set(channel.id, found.id); log.skipped.push(`Channel exists: ${channel.name}`); continue; }
      if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace channel'); log.deleted.channels += 1; }
      const parentId = channel.parentId ? maps.channels.get(channel.parentId) : null;
      const name = found && conflictMode === 'rename' ? uniqueName(names, channel.name, 100) : channel.name;
      const created = await guild.channels.create(channelPayload(channel, parentId, name));
      maps.channels.set(channel.id, created.id);
      names.add(created.name.toLowerCase());
      log.copied.channels += 1;
    } catch (error) { pushError(log, `Channel ${channel.name}`, error); log.skipped.push(`Channel failed: ${channel.name}`); }
  }
}

async function applyPermissions(guild, snap, maps, log) {
  for (const sourceChannel of snap.channels || []) {
    try {
      const targetId = maps.channels.get(sourceChannel.id);
      if (!targetId) continue;
      const channel = guild.channels.cache.get(targetId) || await guild.channels.fetch(targetId).catch(() => null);
      if (!channel?.permissionOverwrites?.set) continue;
      const overwrites = [];
      for (const overwrite of sourceChannel.permissionOverwrites || []) {
        const mappedId = overwrite.id === snap.sourceGuild?.id ? guild.id : maps.roles.get(overwrite.id);
        if (!mappedId) continue;
        overwrites.push({ id: mappedId, type: overwrite.type, allow: new PermissionsBitField(BigInt(overwrite.allow || 0)), deny: new PermissionsBitField(BigInt(overwrite.deny || 0)) });
      }
      await channel.permissionOverwrites.set(overwrites, 'Goliath duplicator: permissions');
      log.copied.permissionOverwrites += overwrites.length;
    } catch (error) { pushError(log, `Permissions ${sourceChannel.name}`, error); log.skipped.push(`Permissions failed: ${sourceChannel.name}`); }
  }
}

async function applyEmojis(guild, snap, log, conflictMode) {
  const names = new Set(guild.emojis.cache.map((emoji) => emoji.name.toLowerCase()));
  for (const emoji of snap.emojis || []) {
    try {
      if (!emoji.url || !emoji.name) continue;
      if (names.has(emoji.name.toLowerCase()) && conflictMode === 'skip') { log.skipped.push(`Emoji exists: ${emoji.name}`); continue; }
      const name = names.has(emoji.name.toLowerCase()) && conflictMode === 'rename' ? uniqueName(names, emoji.name, 32).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) : emoji.name;
      await guild.emojis.create({ attachment: emoji.url, name, reason: 'Goliath duplicator: emoji' });
      names.add(name.toLowerCase());
      log.copied.emojis += 1;
    } catch (error) { pushError(log, `Emoji ${emoji.name}`, error); log.skipped.push(`Emoji failed: ${emoji.name}`); }
  }
}

function resultEmbed(title, guild, log) {
  return embed(title, [`**Destination:** ${guild.name}`, `**Status:** \`${log.status}\``, `**Conflict:** \`${log.conflictMode}\``, `**Rollback:** \`${log.rollbackBackupId || (log.dryRun ? 'dry-run' : 'none')}\``, '', `Settings \`${log.copied.serverSettings}\` • Roles \`${log.copied.roles}\` • Categories \`${log.copied.categories}\` • Channels \`${log.copied.channels}\` • Permissions \`${log.copied.permissionOverwrites}\` • Emojis \`${log.copied.emojis}\``, log.deleted.roles || log.deleted.channels ? `\nDeleted: roles \`${log.deleted.roles}\`, channels \`${log.deleted.channels}\`` : '', log.skipped.length ? `\nSkipped:\n${log.skipped.slice(0, 8).map((item) => `• ${item}`).join('\n')}` : '', log.notes.length ? `\nNotes:\n${log.notes.slice(0, 8).map((item) => `• ${item}`).join('\n')}` : '', log.errors.length ? `\nWarnings/Errors:\n${log.errors.slice(0, 8).map((error) => `⚠️ ${error}`).join('\n')}` : ''].filter(Boolean).join('\n'), log.errors.length ? 0xf59e0b : 0x22c55e);
}

async function executeStage(name, log, fn) {
  console.log(`[Duplicator] Stage start: ${name}`);
  try { await fn(); console.log(`[Duplicator] Stage complete: ${name}`); } catch (error) { pushError(log, name, error); }
}

async function executeSnapshot(interaction, session, snap, title) {
  const guild = guildById(interaction.client, session.destinationGuildId);
  if (!guild) throw new Error('Destination server is not available to Goliath.');
  await fetchGuildState(guild);
  const log = runLog(session, snap);
  const missing = missingPermissions(guild);
  if (missing.length) log.errors.push(`Preflight missing permissions: ${missing.join(', ')}`);
  const hierarchy = hierarchyWarning(guild);
  if (hierarchy) log.errors.push(`Preflight hierarchy warning: ${hierarchy} Discord does not allow bots to bypass role hierarchy.`);
  for (const [key, item] of Object.entries(snap.future || {})) if (item?.requested && !item.supported) log.notes.push(`${COPY_OPTIONS[key] || key}: ${item.reason}`);
  if (session.dryRun) { log.status = 'dry-run'; return interaction.editReply({ embeds: [resultEmbed(`🧪 ${title} Dry-Run Complete`, guild, log)], components: [] }); }
  try { const rollback = await createServerBackup(guild, { createdBy: `duplicator:${interaction.user.id}`, requestedBy: interaction.user.id, reason: `Rollback before ${title}`, type: 'rollback' }); log.rollbackBackupId = rollback.backupId; } catch (error) { pushError(log, 'Rollback backup', error); }
  if (session.conflictMode === 'replace') await executeStage('Replace destination', log, async () => { await clearDestination(guild, log); await fetchGuildState(guild); });
  const maps = { roles: new Map([[snap.sourceGuild?.id, guild.id]]), channels: new Map() };
  await executeStage('Server settings', log, () => applySettings(guild, snap, log));
  await executeStage('Roles', log, () => applyRoles(guild, snap, maps, log, session.conflictMode));
  await executeStage('Channels', log, () => applyChannels(guild, snap, maps, log, session.conflictMode));
  await executeStage('Permissions', log, () => applyPermissions(guild, snap, maps, log));
  await executeStage('Emojis', log, () => applyEmojis(guild, snap, log, session.conflictMode));
  log.status = log.errors.length ? 'completed-with-warnings' : 'success';
  return interaction.editReply({ embeds: [resultEmbed(`✅ ${title} Complete`, guild, log)], components: [] });
}

async function startCopy(interaction) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  return interaction.reply(copyPanel(interaction, makeSession(interaction, 'copy')));
}

async function startBuild(interaction) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  templates(interaction.guild.id, interaction.guild);
  return interaction.reply(buildPanel(interaction, makeSession(interaction, 'build')));
}

async function exportTemplate(interaction) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  const name = interaction.options.getString('name');
  if (!name) return interaction.reply({ content: '❌ Export needs `name`.', flags: MessageFlags.Ephemeral });
  const sourceGuildId = interaction.options.getString('source_server') || interaction.guild.id;
  const sourceGuild = guildById(interaction.client, sourceGuildId);
  if (!sourceGuild) return interaction.reply({ content: '❌ Goliath must be in the source server before it can export it.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await fetchGuildState(sourceGuild);
  const templateId = slugify(interaction.options.getString('template_id') || name);
  const all = templates(interaction.guild.id, interaction.guild);
  const existing = all[templateId];
  const snap = snapshot(sourceGuild, [...ACTIVE_OPTIONS]);
  all[templateId] = { meta: { id: templateId, name, description: interaction.options.getString('description') || '', version: interaction.options.getString('version') || '2.0.0', sourceGuildId: sourceGuild.id, sourceGuildName: sourceGuild.name, createdAt: existing?.meta?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: existing?.meta?.createdBy || interaction.user.id, updatedBy: interaction.user.id, environment: String(process.env.BOT_MODE || 'DEV').toUpperCase(), schemaVersion: 2, defaultTemplate: false }, snapshot: snap };
  saveTemplates(interaction.guild.id, all, interaction.guild);
  return interaction.editReply({ embeds: [embed('✅ Template Exported', `**Template:** ${name}\n**ID:** \`${templateId}\`\n**Saved:** \`modules.duplicator.templates.${templateId}\`\n\nRoles \`${snap.stats.roles}\` • Channels \`${snap.stats.channels}\` • Emojis \`${snap.stats.emojis}\``, 0x22c55e)] });
}

async function analyse(interaction) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  const sourceGuild = guildById(interaction.client, interaction.options.getString('source_server'));
  const destinationGuild = guildById(interaction.client, interaction.options.getString('destination_server'));
  if (!sourceGuild || !destinationGuild) return interaction.reply({ content: '❌ Analyse needs valid `source_server` and `destination_server` IDs.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await fetchGuildState(sourceGuild);
  await fetchGuildState(destinationGuild);
  const snap = snapshot(sourceGuild, [...ACTIVE_OPTIONS]);
  const destRoles = new Set(destinationGuild.roles.cache.map((role) => role.name.toLowerCase()));
  const destChannels = new Set(destinationGuild.channels.cache.map((channel) => `${channel.type}:${channel.name.toLowerCase()}`));
  const destEmojis = new Set(destinationGuild.emojis.cache.map((emoji) => emoji.name.toLowerCase()));
  const permissionLines = REQUIRED_BOT_PERMISSIONS.map(([name, bit]) => `${destinationGuild.members.me?.permissions?.has(bit) ? '✅' : '❌'} ${name}`).join('\n');
  return interaction.editReply({ embeds: [embed('🔎 Duplicator Analyse', `**Source:** ${sourceGuild.name}\n**Destination:** ${destinationGuild.name}\n\nMissing roles: \`${snap.roles.filter((role) => !destRoles.has(role.name.toLowerCase())).length}\`\nMissing channels: \`${snap.channels.filter((channel) => !destChannels.has(`${channel.type}:${channel.name.toLowerCase()}`)).length}\`\nMissing emojis: \`${snap.emojis.filter((emoji) => !destEmojis.has(emoji.name.toLowerCase())).length}\`\n\n**Bot permissions:**\n${permissionLines}\n\n**Hierarchy:** ${hierarchyWarning(destinationGuild) ? `⚠️ ${hierarchyWarning(destinationGuild)}` : '✅ Goliath role has usable hierarchy.'}`, 0x22c55e)] });
}

async function run(interaction) {
  const action = interaction.options.getString('action', true);
  if (action === 'copy') return startCopy(interaction);
  if (action === 'analyse') return analyse(interaction);
  if (action === 'export') return exportTemplate(interaction);
  if (action === 'build') return startBuild(interaction);
  return interaction.reply({ content: '❌ Unknown server action.', flags: MessageFlags.Ephemeral });
}

async function handleCopy(interaction, data) {
  const session = getSession(copySessions, interaction, data.sessionId);
  if (!session) return interaction.reply({ content: '❌ Copy session expired or you do not own it.', flags: MessageFlags.Ephemeral }).catch(() => null);
  if (data.action === 'source') { session.sourceGuildId = interaction.values?.[0]; session.pendingConfirm = false; }
  else if (data.action === 'destination') { session.destinationGuildId = interaction.values?.[0]; session.pendingConfirm = false; }
  else if (data.action === 'options') { session.selectedOptions = interaction.values || [...ACTIVE_OPTIONS]; session.pendingConfirm = false; }
  else if (data.action === 'conflict') { session.conflictMode = interaction.values?.[0] || 'skip'; session.pendingConfirm = false; }
  else if (data.action === 'dryrun') { session.dryRun = !session.dryRun; session.pendingConfirm = false; }
  else if (data.action === 'cancel') { copySessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Copy Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'start') {
    if (!session.dryRun && !session.pendingConfirm) { session.pendingConfirm = true; return interaction.update(copyPanel(interaction, session)); }
    const sourceGuild = guildById(interaction.client, session.sourceGuildId);
    if (!sourceGuild) return interaction.update({ content: '❌ Source server is unavailable.', embeds: [], components: [] });
    await fetchGuildState(sourceGuild);
    const snap = snapshot(sourceGuild, session.selectedOptions);
    await interaction.update({ embeds: [embed('🚧 Copy Running', 'Working...', 0x5865f2)], components: [] });
    await executeSnapshot(interaction, session, snap, 'Copy');
    copySessions.delete(session.id);
    return true;
  }
  return interaction.update(copyPanel(interaction, session));
}

async function handleBuild(interaction, data) {
  const session = getSession(buildSessions, interaction, data.sessionId);
  if (!session) return interaction.reply({ content: '❌ Build session expired or you do not own it.', flags: MessageFlags.Ephemeral }).catch(() => null);
  if (data.action === 'template') { session.templateId = interaction.values?.[0] === 'none' ? null : interaction.values?.[0]; session.pendingConfirm = false; }
  else if (data.action === 'destination') { session.destinationGuildId = interaction.values?.[0]; session.pendingConfirm = false; }
  else if (data.action === 'conflict') { session.conflictMode = interaction.values?.[0] || 'skip'; session.pendingConfirm = false; }
  else if (data.action === 'dryrun') { session.dryRun = !session.dryRun; session.pendingConfirm = false; }
  else if (data.action === 'cancel') { buildSessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Build Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'start') {
    if (!session.dryRun && !session.pendingConfirm) { session.pendingConfirm = true; return interaction.update(buildPanel(interaction, session)); }
    const template = templates(session.controlGuildId)[session.templateId];
    if (!template?.snapshot) return interaction.update({ content: '❌ Template not found.', embeds: [], components: [] });
    await interaction.update({ embeds: [embed('🏗️ Build Running', 'Working...', 0x5865f2)], components: [] });
    await executeSnapshot(interaction, session, template.snapshot, 'Build');
    buildSessions.delete(session.id);
    return true;
  }
  return interaction.update(buildPanel(interaction, session));
}

async function handleInteraction(interaction) {
  if (!interaction?.customId) return false;
  const copy = parseComponentId(interaction.customId, COPY_PREFIX);
  if (copy) { await handleCopy(interaction, copy); return true; }
  const build = parseComponentId(interaction.customId, BUILD_PREFIX);
  if (build) { await handleBuild(interaction, build); return true; }
  return false;
}

module.exports = { run, handleInteraction, assertAccess, snapshot, templates, templateList, DEFAULT_TEMPLATES };
