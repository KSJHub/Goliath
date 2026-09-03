'use strict';

const http = require('node:http');
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

const fetch = global.fetch;
const security = require('../../core/security/protection/core');
const guildManager = require('../../core/guild/guildManager');
const { createServerBackup } = require('../../core/security/restoreBackup/backup');

const COPY_PREFIX = 'duplicator-copy';
const BUILD_PREFIX = 'duplicator-build';
const ANALYSE_PREFIX = 'duplicator-analyse';
const SESSION_TTL_MS = 20 * 60 * 1000;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORTS = Object.freeze({ DEV: 3002, BETA: 3012, PRODUCTION: 3022 });
const copySessions = new Map();
const buildSessions = new Map();
const analyseSessions = new Map();
let bridgeServer = null;
let bridgeClient = null;

const COPY_OPTIONS = Object.freeze({
  roles: 'Roles', categories: 'Categories', channels: 'Channels', permissions: 'Channel Permissions',
  serverSettings: 'Server Settings + Branding', emojis: 'Emojis', stickers: 'Stickers',
  scheduledEvents: 'Scheduled Events', webhooks: 'Webhooks', automod: 'AutoMod Rules',
});
const ACTIVE_OPTIONS = new Set(['roles', 'categories', 'channels', 'permissions', 'serverSettings', 'emojis']);
const FUTURE_OPTIONS = new Set(['stickers', 'scheduledEvents', 'webhooks', 'automod']);
const CONFLICT_MODES = Object.freeze({ skip: 'Skip Existing', rename: 'Rename Duplicates', replace: 'Replace Destination' });
const REQUIRED_BOT_PERMISSIONS = [
  ['ManageGuild', PermissionFlagsBits.ManageGuild], ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels], ['ManageEmojisAndStickers', PermissionFlagsBits.ManageEmojisAndStickers],
  ['ManageWebhooks', PermissionFlagsBits.ManageWebhooks],
];
const DANGEROUS_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ManageEmojisAndStickers,
  PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers,
];

function mode() { return String(process.env.BOT_MODE || 'DEV').trim().toUpperCase(); }
function splitIds(value) { return String(value || '').split(',').map((v) => v.trim()).filter((v) => /^\d{16,25}$/.test(v)); }
function ownerIds() {
  return [...new Set([
    ...splitIds(process.env.DUPLICATOR_OWNER_IDS), ...splitIds(process.env.SERVER_COPY_OWNER_IDS),
    ...splitIds(process.env.OWNER_ID), ...splitIds(process.env.OWNER_IDS),
    ...splitIds(process.env.BOT_OWNER_ID), ...splitIds(process.env.BOT_OWNER_IDS), ...(security.getBotOwnerIds?.() || []),
  ])];
}
function slugify(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function moduleConfig(guildId) { const modules = guildManager.getGuildSection(guildId, 'modules', {}); return modules.duplicator || modules.serverCopy || {}; }
function assertAccess(interaction) {
  if (!interaction?.guild) return { allowed: false, reason: 'This command can only be used inside a server.' };
  if (!ownerIds().includes(String(interaction.user?.id))) return { allowed: false, reason: 'This command is restricted to the bot owner.' };
  if (moduleConfig(interaction.guild.id).enabled === false) return { allowed: false, reason: 'Duplicator is disabled for this guild.' };
  return { allowed: true };
}
function embed(title, description, color = 0x5865f2) { return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp(new Date()); }
function guildById(client, id) { return client.guilds.cache.get(String(id || '').trim()) || null; }
async function fetchGuildById(client, id) {
  const guildId = String(id || '').trim();
  if (!/^\d{16,25}$/.test(guildId)) return { guild: null, reason: 'invalid' };
  const cached = guildById(client, guildId); if (cached) return { guild: cached, reason: null };
  try { return { guild: await client.guilds.fetch(guildId), reason: null }; }
  catch (error) { return { guild: null, reason: 'unavailable', error }; }
}
async function fetchGuildState(guild) {
  await guild.roles.fetch().catch(() => null); await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null); await guild.members.fetchMe().catch(() => null);
}
function localGuildDirectory(client) {
  return [...client.guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name, environment: mode() }));
}
function bridgePort(environment) { return Number(process.env[`DUPLICATOR_BRIDGE_PORT_${environment}`] || BRIDGE_PORTS[environment]); }
function bridgeSecret() { return String(process.env.DUPLICATOR_BRIDGE_SECRET || '').trim(); }
function bridgeRequest(environment, method, path, payload = null, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const headers = { accept: 'application/json' };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = String(body.length); }
    if (bridgeSecret()) headers['x-goliath-duplicator-secret'] = bridgeSecret();
    const req = http.request({ host: BRIDGE_HOST, port: bridgePort(environment), method, path, headers }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => {
        let data = {}; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data); else reject(new Error(data.error || `Bridge ${environment} returned ${res.statusCode}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Bridge ${environment} timed out`)));
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
async function getGuildDirectory(client) {
  const byId = new Map();
  for (const item of localGuildDirectory(client)) byId.set(item.id, { ...item, environments: [item.environment] });
  await Promise.all(Object.keys(BRIDGE_PORTS).filter((env) => env !== mode()).map(async (environment) => {
    try {
      const response = await bridgeRequest(environment, 'GET', '/guilds', null, 1200);
      for (const item of response.guilds || []) {
        const existing = byId.get(item.id);
        if (existing) {
          existing.environments = [...new Set([...(existing.environments || [existing.environment]), item.environment || environment])];
          if (existing.environment !== mode()) existing.environment = item.environment || environment;
        } else byId.set(item.id, { ...item, environment: item.environment || environment, environments: [item.environment || environment] });
      }
    } catch (error) { console.warn(`[Duplicator] ${environment} bridge unavailable: ${error.message}`); }
  }));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async function refreshSessionDirectory(client, session) { session.guildDirectory = await getGuildDirectory(client); return session.guildDirectory; }
function directoryGuild(session, id) { return (session.guildDirectory || []).find((item) => item.id === String(id || '')) || null; }
function guildDisplay(session, client, id) {
  if (!id) return '`Not selected`';
  const local = guildById(client, id); if (local) return `${local.name} · ${mode()}`;
  const found = directoryGuild(session, id); return found ? `${found.name} · ${(found.environments || [found.environment]).join('/')}` : id;
}
function guildChoices(session, selectedId = null) {
  let all = session.guildDirectory || [];
  if (selectedId && !all.some((g) => g.id === selectedId)) {
    const selected = directoryGuild(session, selectedId); if (selected) all = [selected, ...all];
  }
  return all.slice(0, 25).map((guild) => ({
    label: guild.name.slice(0, 100), description: `${(guild.environments || [guild.environment]).join('/')} • ${guild.id}`.slice(0, 100),
    value: guild.id, default: guild.id === selectedId,
  }));
}
async function resolveGuildRoute(client, guildId, session = null) {
  if (guildById(client, guildId)) return { environment: mode(), local: true, id: guildId };
  const directory = session?.guildDirectory?.length ? session.guildDirectory : await getGuildDirectory(client);
  const item = directory.find((entry) => entry.id === String(guildId));
  if (!item) return null;
  const environments = item.environments || [item.environment];
  if (environments.includes(mode())) return { environment: mode(), local: true, id: guildId };
  return { environment: environments[0] || item.environment, local: false, id: guildId };
}
function componentId(prefix, sessionId, action) { return `${prefix}:${sessionId}:${action}`; }
function parseComponentId(customId, prefix) { const parts = String(customId || '').split(':'); return parts[0] === prefix && parts[1] && parts[2] ? { sessionId: parts[1], action: parts.slice(2).join(':') } : null; }
function cleanupSessions(map) { const now = Date.now(); for (const [id, session] of map.entries()) if (!session || session.expiresAt <= now) map.delete(id); }
function getSession(map, interaction, sessionId) { cleanupSessions(map); const session = map.get(sessionId); return session?.ownerId === interaction.user?.id ? session : null; }
function makeSession(interaction, type) {
  const session = { id: `${interaction.user.id}-${Date.now().toString(36)}`, ownerId: interaction.user.id, controlGuildId: interaction.guild.id,
    sourceGuildId: null, destinationGuildId: interaction.options?.getString?.('destination_server') || interaction.guild.id, templateId: null,
    selectedOptions: [...ACTIVE_OPTIONS], conflictMode: 'skip', dryRun: false, pendingConfirm: false, guildDirectory: [], expiresAt: Date.now() + SESSION_TTL_MS };
  (type === 'build' ? buildSessions : copySessions).set(session.id, session); return session;
}

function makeAnalyseSession(interaction) {
  const session = {
    id: `${interaction.user.id}-${Date.now().toString(36)}`,
    ownerId: interaction.user.id,
    controlGuildId: interaction.guild.id,
    sourceGuildId: null,
    destinationGuildId: interaction.guild.id,
    guildDirectory: [],
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  analyseSessions.set(session.id, session);
  return session;
}

async function analysePanel(interaction, session) {
  if (!session.guildDirectory?.length) await refreshSessionDirectory(interaction.client, session);
  return {
    embeds: [embed('🔎 Server Duplicator — Analyse', [
      `**Source:** ${guildDisplay(session, interaction.client, session.sourceGuildId)}`,
      `**Destination:** ${guildDisplay(session, interaction.client, session.destinationGuildId)}`,
      '',
      'Choose the source and destination servers from Goliath’s connected guilds, then press **Analyse Servers**.',
    ].join('\n'))],
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'source')).setPlaceholder('Source server').addOptions(guildChoices(session, session.sourceGuildId))),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(session, session.destinationGuildId))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'start')).setLabel('Analyse Servers').setEmoji('🔎').setStyle(ButtonStyle.Primary).setDisabled(!session.sourceGuildId || !session.destinationGuildId || session.sourceGuildId === session.destinationGuildId),
        new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'refresh')).setLabel('Refresh Guilds').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger)
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

function channelTemplate(id, name, type, parentId, position) { return { id, name, type, parentId, position, topic: null, nsfw: false, rateLimitPerUser: 0, bitrate: null, userLimit: 0, rtcRegion: null, videoQualityMode: null, defaultAutoArchiveDuration: null, defaultThreadRateLimitPerUser: 0, availableTags: [], permissionOverwrites: [] }; }
function makeTemplate(templateId, name, description, roleDefs, categoryDefs) {
  const roles = roleDefs.map(([roleName, color], index) => ({ id: `template:${templateId}:role:${slugify(roleName)}`, name: roleName, color, hoist: index < 3, mentionable: false, permissions: '0', position: index + 1 }));
  const channels = []; let position = 0;
  for (const [categoryName, children] of categoryDefs) {
    const categoryId = `template:${templateId}:category:${slugify(categoryName)}`; channels.push(channelTemplate(categoryId, categoryName, ChannelType.GuildCategory, null, position++));
    for (const [channelName, type] of children) channels.push(channelTemplate(`template:${templateId}:channel:${slugify(channelName)}`, channelName, type, categoryId, position++));
  }
  return { meta: { id: templateId, name, description, version: '1.0.0', createdAt: 'system-default', updatedAt: 'system-default', createdBy: 'Goliath', updatedBy: 'Goliath', sourceGuildId: `template:${templateId}`, sourceGuildName: name, environment: 'DEFAULT', schemaVersion: 2, defaultTemplate: true }, snapshot: { sourceGuild: { id: `template:${templateId}`, name }, options: ['roles', 'categories', 'channels', 'permissions'], settings: null, roles, channels, emojis: [], future: {}, stats: { roles: roles.length, categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length, channels: channels.filter((c) => c.type !== ChannelType.GuildCategory).length, permissionOverwrites: 0, emojis: 0 } } };
}
const DEFAULT_TEMPLATES = Object.freeze({
  'basic-gaming': makeTemplate('basic-gaming', 'Basic Gaming', 'Starter gaming community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Moderator', 0x3b82f6], ['Member', 0x22c55e]], [['INFORMATION', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['announcements', ChannelType.GuildAnnouncement]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['clips-and-media', ChannelType.GuildText], ['looking-for-group', ChannelType.GuildText], ['General Voice', ChannelType.GuildVoice]]], ['SUPPORT', [['open-a-ticket', ChannelType.GuildText], ['staff-chat', ChannelType.GuildText]]]]),
  'community-server': makeTemplate('community-server', 'Community Server', 'Clean public community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Staff', 0x3b82f6], ['Member', 0x22c55e]], [['START HERE', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['server-info', ChannelType.GuildText]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['introductions', ChannelType.GuildText], ['media', ChannelType.GuildText], ['Community Voice', ChannelType.GuildVoice]]], ['STAFF', [['staff-chat', ChannelType.GuildText], ['mod-logs', ChannelType.GuildText]]]]),
  'business-support': makeTemplate('business-support', 'Business Support', 'Simple support and client workspace layout.', [['Owner', 0xffc107], ['Manager', 0x6366f1], ['Support Team', 0x3b82f6], ['Client', 0x22c55e]], [['BUSINESS INFO', [['welcome', ChannelType.GuildText], ['announcements', ChannelType.GuildAnnouncement], ['faq', ChannelType.GuildText]]], ['SUPPORT', [['support-desk', ChannelType.GuildText], ['ticket-updates', ChannelType.GuildText], ['Support Voice', ChannelType.GuildVoice]]], ['INTERNAL', [['team-chat', ChannelType.GuildText], ['admin-logs', ChannelType.GuildText]]]]),
  'creator-streamer': makeTemplate('creator-streamer', 'Creator / Streamer', 'Creator community layout for streams, content and announcements.', [['Creator', 0xffc107], ['Admin', 0xef4444], ['Moderator', 0x3b82f6], ['Subscriber', 0xa855f7], ['Community', 0x22c55e]], [['START HERE', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['stream-announcements', ChannelType.GuildAnnouncement]]], ['CONTENT', [['clips', ChannelType.GuildText], ['youtube', ChannelType.GuildText], ['socials', ChannelType.GuildText]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['suggestions', ChannelType.GuildText], ['Stream Room', ChannelType.GuildVoice]]]]),
});
function serializeChannel(channel) { return { id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null, position: channel.rawPosition ?? channel.position ?? 0, topic: channel.topic || null, nsfw: Boolean(channel.nsfw), rateLimitPerUser: channel.rateLimitPerUser || 0, bitrate: channel.bitrate || null, userLimit: channel.userLimit || 0, rtcRegion: channel.rtcRegion || null, videoQualityMode: channel.videoQualityMode || null, defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration || null, defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser || 0, availableTags: Array.isArray(channel.availableTags) ? channel.availableTags.map((tag) => ({ name: tag.name, moderated: Boolean(tag.moderated), emojiId: tag.emojiId || null, emojiName: tag.emojiName || null })) : [], permissionOverwrites: channel.permissionOverwrites?.cache ? channel.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) : [] }; }
function snapshot(guild, selectedOptions = [...ACTIVE_OPTIONS]) {
  const selected = new Set(selectedOptions);
  const channels = selected.has('categories') || selected.has('channels') || selected.has('permissions') ? guild.channels.cache.filter((c) => selected.has('channels') || c.type === ChannelType.GuildCategory).sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0)).map(serializeChannel) : [];
  const roles = selected.has('roles') || selected.has('permissions') ? guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => a.position - b.position).map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position })) : [];
  const emojis = selected.has('emojis') ? guild.emojis.cache.map((e) => ({ id: e.id, name: e.name, animated: e.animated, url: typeof e.imageURL === 'function' ? e.imageURL({ extension: e.animated ? 'gif' : 'png' }) : e.url })) : [];
  const settings = selected.has('serverSettings') ? { name: guild.name, description: guild.description || null, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, defaultMessageNotifications: guild.defaultMessageNotifications, afkTimeout: guild.afkTimeout, iconURL: guild.iconURL({ extension: 'png', size: 1024 }) || null, bannerURL: guild.bannerURL({ extension: 'png', size: 2048 }) || null, splashURL: guild.splashURL({ extension: 'png', size: 2048 }) || null } : null;
  const future = {}; for (const key of FUTURE_OPTIONS) if (selected.has(key)) future[key] = { requested: true, supported: false, reason: 'Reserved for Duplicator API expansion.' };
  return { sourceGuild: { id: guild.id, name: guild.name }, options: [...selected], settings, roles, channels, emojis, future, stats: { roles: roles.length, categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length, channels: channels.filter((c) => c.type !== ChannelType.GuildCategory).length, permissionOverwrites: channels.reduce((total, c) => total + (c.permissionOverwrites?.length || 0), 0), emojis: emojis.length } };
}
function readTemplates(guildId) { const cfg = moduleConfig(guildId); return cfg.templates && typeof cfg.templates === 'object' && !Array.isArray(cfg.templates) ? cfg.templates : {}; }
function saveTemplates(guildId, value, guildOrMeta = {}) { guildManager.updateGuildSection(guildId, 'modules', (modules) => ({ ...modules, duplicator: { ...(modules.duplicator || {}), enabled: modules.duplicator?.enabled ?? true, hidden: true, ownerOnly: true, templates: value } }), {}, guildOrMeta); return value; }
function templates(guildId, guildOrMeta = {}) { const stored = readTemplates(guildId); return Object.keys(stored).length ? stored : saveTemplates(guildId, JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)), guildOrMeta); }
function templateList(guildId) { return Object.entries(templates(guildId)).filter(([, t]) => t?.snapshot).map(([id, t]) => ({ id, ...t })).sort((a, b) => String(a.meta?.name || a.id).localeCompare(String(b.meta?.name || b.id))); }
function templateChoices(guildId, selectedId = null) { const all = templateList(guildId); if (!all.length) return [{ label: 'No templates saved yet', description: 'Use /server action: export first', value: 'none' }]; return all.slice(0, 25).map((t) => ({ label: String(t.meta?.name || t.id).slice(0, 100), description: `ID: ${t.id} | v${t.meta?.version || '1.0.0'}`.slice(0, 100), value: t.id, default: selectedId === t.id })); }
function conflictChoices(selected = 'skip') { return Object.entries(CONFLICT_MODES).map(([value, label]) => ({ label, value, default: selected === value })); }
function copyOptionChoices(selectedOptions = []) { const selected = new Set(selectedOptions); return Object.entries(COPY_OPTIONS).map(([value, label]) => ({ label, value, default: selected.has(value) })); }
function confirmText(session, label) { if (session.dryRun) return '🧪 Dry run is ON. No changes will be made.'; if (session.pendingConfirm) return `⚠️ FINAL CONFIRMATION: press **Confirm ${label}** to modify the destination.`; return '⚠️ First press arms final confirmation. No changes happen until the red confirm button is pressed.'; }
async function copyPanel(interaction, session) {
  if (!session.guildDirectory?.length) await refreshSessionDirectory(interaction.client, session);
  const sourceChoices = guildChoices(session, session.sourceGuildId);
  const destinationChoices = guildChoices(session, session.destinationGuildId);
  return { embeds: [embed('🛠️ Server Duplicator — Copy', [`**Source:** ${guildDisplay(session, interaction.client, session.sourceGuildId)}`, `**Destination:** ${guildDisplay(session, interaction.client, session.destinationGuildId)}`, `**Conflict:** \`${session.conflictMode}\``, `**Dry run:** \`${session.dryRun ? 'ON' : 'OFF'}\``, '', session.selectedOptions.map((key) => `• ${COPY_OPTIONS[key] || key}`).join('\n'), '', confirmText(session, 'Copy')].join('\n'))], components: [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'source')).setPlaceholder('Source server').addOptions(sourceChoices)),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(destinationChoices)),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'options')).setPlaceholder('What to copy').setMinValues(1).setMaxValues(Object.keys(COPY_OPTIONS).length).addOptions(copyOptionChoices(session.selectedOptions))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'conflict')).setPlaceholder('Conflict mode').addOptions(conflictChoices(session.conflictMode))),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'start')).setLabel(session.pendingConfirm && !session.dryRun ? 'Confirm Copy' : session.dryRun ? 'Run Dry-Run' : 'Start Copy').setStyle(session.pendingConfirm && !session.dryRun ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(!session.sourceGuildId || !session.destinationGuildId || session.sourceGuildId === session.destinationGuildId), new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'refresh')).setLabel('Refresh Guilds').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'dryrun')).setLabel(session.dryRun ? 'Dry Run: ON' : 'Dry Run: OFF').setStyle(session.dryRun ? ButtonStyle.Primary : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger)),
  ], flags: MessageFlags.Ephemeral };
}
async function buildPanel(interaction, session) {
  if (!session.guildDirectory?.length) await refreshSessionDirectory(interaction.client, session);
  const chosen = session.templateId ? templates(session.controlGuildId, interaction.guild)[session.templateId] : null;
  return { embeds: [embed('🏗️ Server Duplicator — Build', [`**Templates available:** \`${templateList(session.controlGuildId).length}\``, `**Template:** ${chosen ? `**${chosen.meta?.name || session.templateId}** \`(${session.templateId})\`` : '`Not selected`'}`, `**Destination:** ${guildDisplay(session, interaction.client, session.destinationGuildId)}`, `**Conflict:** \`${session.conflictMode}\``, `**Dry run:** \`${session.dryRun ? 'ON' : 'OFF'}\``, chosen ? `Roles \`${chosen.snapshot?.stats?.roles || 0}\` • Channels \`${chosen.snapshot?.stats?.channels || 0}\` • Emojis \`${chosen.snapshot?.stats?.emojis || 0}\`` : '', '', confirmText(session, 'Build')].join('\n'))], components: [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'template')).setPlaceholder('Choose template').addOptions(templateChoices(session.controlGuildId, session.templateId))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(session, session.destinationGuildId))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'conflict')).setPlaceholder('Conflict mode').addOptions(conflictChoices(session.conflictMode))),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'start')).setLabel(session.pendingConfirm && !session.dryRun ? 'Confirm Build' : session.dryRun ? 'Run Dry-Run' : 'Build Server').setStyle(session.pendingConfirm && !session.dryRun ? ButtonStyle.Danger : ButtonStyle.Success).setDisabled(!session.templateId || !session.destinationGuildId), new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'refresh')).setLabel('Refresh Guilds').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'dryrun')).setLabel(session.dryRun ? 'Dry Run: ON' : 'Dry Run: OFF').setStyle(session.dryRun ? ButtonStyle.Primary : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(componentId(BUILD_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger)),
  ], flags: MessageFlags.Ephemeral };
}

function existingRole(guild, name) { return guild.roles.cache.find((r) => r.name.toLowerCase() === String(name).toLowerCase() && r.id !== guild.id); }
function existingChannel(guild, channel) { return guild.channels.cache.find((c) => c.type === channel.type && c.name.toLowerCase() === String(channel.name).toLowerCase()); }
function uniqueName(existingNames, baseName, maxLength = 100) { const base = String(baseName || 'copy').slice(0, maxLength - 8); let candidate = `${base}-copy`; let index = 2; while (existingNames.has(candidate.toLowerCase())) candidate = `${base}-copy-${index++}`.slice(0, maxLength); existingNames.add(candidate.toLowerCase()); return candidate; }
async function bufferFromUrl(url) { if (!url) return null; const response = await fetch(url); if (!response.ok) throw new Error(`Failed to fetch asset: ${response.status}`); return Buffer.from(await response.arrayBuffer()); }
function runLog(session, snap) { return { status: session.dryRun ? 'dry-run' : 'running', dryRun: Boolean(session.dryRun), conflictMode: session.conflictMode, rollbackBackupId: null, snapshotStats: snap.stats, copied: { serverSettings: 0, roles: 0, categories: 0, channels: 0, permissionOverwrites: 0, emojis: 0 }, deleted: { roles: 0, channels: 0 }, skipped: [], errors: [], notes: [] }; }
function dryRunPlan(guild, snap, conflictMode) {
  const plan = {
    create: { serverSettings: 0, roles: 0, categories: 0, channels: 0, permissionOverwrites: 0, emojis: 0 },
    rename: { roles: 0, categories: 0, channels: 0, emojis: 0 },
    skip: { roles: 0, categories: 0, channels: 0, emojis: 0 },
    delete: { roles: 0, channels: 0 },
  };

  if (snap.settings) {
    const source = snap.settings;
    const current = {
      name: guild.name,
      description: guild.description || null,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkTimeout: guild.afkTimeout,
    };
    plan.create.serverSettings = Object.entries(current).reduce((total, [key, value]) => total + (source[key] !== undefined && source[key] !== value ? 1 : 0), 0);
    if (source.iconURL) plan.create.serverSettings += 1;
    if (source.bannerURL) plan.create.serverSettings += 1;
    if (source.splashURL) plan.create.serverSettings += 1;
  }

  for (const role of snap.roles || []) {
    const found = existingRole(guild, role.name);
    if (!found) { plan.create.roles += 1; continue; }
    if (conflictMode === 'skip') plan.skip.roles += 1;
    else if (conflictMode === 'rename') { plan.rename.roles += 1; plan.create.roles += 1; }
    else if (conflictMode === 'replace') { plan.delete.roles += 1; plan.create.roles += 1; }
  }

  for (const channel of snap.channels || []) {
    const found = existingChannel(guild, channel);
    const key = channel.type === ChannelType.GuildCategory ? 'categories' : 'channels';
    if (!found) { plan.create[key] += 1; continue; }
    if (conflictMode === 'skip') plan.skip[key] += 1;
    else if (conflictMode === 'rename') { plan.rename[key] += 1; plan.create[key] += 1; }
    else if (conflictMode === 'replace') { plan.delete.channels += 1; plan.create[key] += 1; }
  }

  plan.create.permissionOverwrites = (snap.channels || []).reduce((total, channel) => total + (channel.permissionOverwrites?.length || 0), 0);

  const emojiNames = new Set(guild.emojis.cache.map((emoji) => String(emoji.name || '').toLowerCase()));
  for (const emoji of snap.emojis || []) {
    const exists = emojiNames.has(String(emoji.name || '').toLowerCase());
    if (!exists) { plan.create.emojis += 1; continue; }
    if (conflictMode === 'skip') plan.skip.emojis += 1;
    else if (conflictMode === 'rename') { plan.rename.emojis += 1; plan.create.emojis += 1; }
    else if (conflictMode === 'replace') plan.create.emojis += 1;
  }

  return plan;
}
function applyDryRunPlan(log, plan) {
  log.copied = { ...log.copied, ...plan.create };
  log.deleted = { ...log.deleted, ...plan.delete };
  const renameTotal = Object.values(plan.rename).reduce((a, b) => a + b, 0);
  const skipTotal = Object.values(plan.skip).reduce((a, b) => a + b, 0);
  if (renameTotal) log.notes.push(`Would rename: roles ${plan.rename.roles}, categories ${plan.rename.categories}, channels ${plan.rename.channels}, emojis ${plan.rename.emojis}`);
  if (skipTotal) log.notes.push(`Would skip existing: roles ${plan.skip.roles}, categories ${plan.skip.categories}, channels ${plan.skip.channels}, emojis ${plan.skip.emojis}`);
  if (plan.delete.roles || plan.delete.channels) log.notes.push(`Would replace/delete first: roles ${plan.delete.roles}, channels/categories ${plan.delete.channels}`);
  log.notes.push('Dry run only — no changes were made.');
}
function errorLabel(error) { return `${error?.code ? `Discord ${error.code}` : 'Error'}: ${error?.message || String(error)}`; }
function pushError(log, stage, error) { const message = `[${stage}] ${errorLabel(error)}`; log.errors.push(message); console.error(`[Duplicator] ${message}`, error); }
function hasBotPermission(guild, bit) { return Boolean(guild.members.me?.permissions?.has(bit)); }
function missingPermissions(guild) { return REQUIRED_BOT_PERMISSIONS.filter(([, bit]) => !hasBotPermission(guild, bit)).map(([name]) => name); }
function hierarchyWarning(guild) { const highest = guild.members.me?.roles?.highest; return !highest || Number(highest.position || 0) <= 1 ? 'Goliath role is too low. Move it above all roles it needs to copy/manage.' : null; }
function safeRolePermissions(guild, raw, roleName, log) { const permissions = new PermissionsBitField(BigInt(raw || 0)); for (const bit of DANGEROUS_ROLE_PERMISSIONS) if (permissions.has(bit) && !hasBotPermission(guild, bit)) { permissions.remove(bit); log.notes.push(`Stripped unsafe permission from ${roleName}: ${new PermissionsBitField(bit).toArray()[0] || String(bit)}`); } if (permissions.has(PermissionFlagsBits.Administrator) && !hasBotPermission(guild, PermissionFlagsBits.Administrator)) permissions.remove(PermissionFlagsBits.Administrator); return permissions; }
async function clearDestination(guild, log) { for (const channel of [...guild.channels.cache.values()].sort((a, b) => b.position - a.position)) try { await channel.delete('Goliath duplicator: replace destination'); log.deleted.channels += 1; } catch (error) { pushError(log, `Delete channel ${channel.name}`, error); } const botHighest = guild.members.me?.roles?.highest?.position ?? 0; const roles = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.editable && r.position < botHighest).sort((a, b) => b.position - a.position); for (const role of roles.values()) try { await role.delete('Goliath duplicator: replace roles'); log.deleted.roles += 1; } catch (error) { pushError(log, `Delete role ${role.name}`, error); } }
async function applySettings(guild, snap, log) { if (!snap.settings) return; const s = snap.settings; const payload = {}; if (s.name) payload.name = s.name; if (s.description !== undefined) payload.description = s.description || null; if (Number.isFinite(s.verificationLevel)) payload.verificationLevel = s.verificationLevel; if (Number.isFinite(s.explicitContentFilter)) payload.explicitContentFilter = s.explicitContentFilter; if (Number.isFinite(s.defaultMessageNotifications)) payload.defaultMessageNotifications = s.defaultMessageNotifications; if (Number.isFinite(s.afkTimeout)) payload.afkTimeout = s.afkTimeout; if (s.iconURL) payload.icon = await bufferFromUrl(s.iconURL).catch(() => null); if (s.bannerURL) payload.banner = await bufferFromUrl(s.bannerURL).catch(() => null); if (s.splashURL) payload.splash = await bufferFromUrl(s.splashURL).catch(() => null); if (Object.keys(payload).length) { await guild.edit(payload, 'Goliath duplicator: settings'); log.copied.serverSettings = Object.keys(payload).length; } }
async function applyRoles(guild, snap, maps, log, conflictMode) { const names = new Set(guild.roles.cache.map((r) => r.name.toLowerCase())); const botHighest = guild.members.me?.roles?.highest?.position ?? 0; for (const role of [...(snap.roles || [])].sort((a, b) => a.position - b.position)) { try { const found = existingRole(guild, role.name); if (found && conflictMode === 'skip') { maps.roles.set(role.id, found.id); log.skipped.push(`Role exists: ${role.name}`); continue; } if (found && conflictMode === 'replace') { if (found.editable && found.position < botHighest) { await found.delete('Goliath duplicator: replace role'); log.deleted.roles += 1; } else { maps.roles.set(role.id, found.id); log.skipped.push(`Role not editable due to Discord hierarchy: ${role.name}`); continue; } } const name = found && conflictMode === 'rename' ? uniqueName(names, role.name, 100) : role.name; const created = await guild.roles.create({ name, colors: { primaryColor: Number(role.color || 0) }, hoist: Boolean(role.hoist), mentionable: Boolean(role.mentionable), permissions: safeRolePermissions(guild, role.permissions, role.name, log), reason: 'Goliath duplicator: role' }); maps.roles.set(role.id, created.id); names.add(created.name.toLowerCase()); log.copied.roles += 1; } catch (error) { pushError(log, `Role ${role.name}`, error); log.skipped.push(`Role failed: ${role.name}`); } } }
function channelPayload(channel, parentId = null, name = null) { const payload = { name: name || channel.name, type: channel.type, reason: 'Goliath duplicator: channel' }; if (parentId) payload.parent = parentId; if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) { payload.topic = channel.topic || undefined; payload.nsfw = channel.nsfw; payload.rateLimitPerUser = channel.rateLimitPerUser || 0; } if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) { payload.bitrate = channel.bitrate || undefined; payload.userLimit = channel.userLimit || 0; payload.rtcRegion = channel.rtcRegion || undefined; payload.videoQualityMode = channel.videoQualityMode || undefined; } if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(channel.type)) { payload.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration || undefined; payload.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser || 0; if (channel.availableTags?.length) payload.availableTags = channel.availableTags; } return payload; }
async function applyChannels(guild, snap, maps, log, conflictMode) { const names = new Set(guild.channels.cache.map((c) => c.name.toLowerCase())); const categories = (snap.channels || []).filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position); const channels = (snap.channels || []).filter((c) => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position); for (const category of categories) { try { const found = existingChannel(guild, category); if (found && conflictMode === 'skip') { maps.channels.set(category.id, found.id); log.skipped.push(`Category exists: ${category.name}`); continue; } if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace category'); log.deleted.channels += 1; } const name = found && conflictMode === 'rename' ? uniqueName(names, category.name, 100) : category.name; const created = await guild.channels.create(channelPayload(category, null, name)); maps.channels.set(category.id, created.id); names.add(created.name.toLowerCase()); log.copied.categories += 1; } catch (error) { pushError(log, `Category ${category.name}`, error); log.skipped.push(`Category failed: ${category.name}`); } } for (const channel of channels) { try { const found = existingChannel(guild, channel); if (found && conflictMode === 'skip') { maps.channels.set(channel.id, found.id); log.skipped.push(`Channel exists: ${channel.name}`); continue; } if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace channel'); log.deleted.channels += 1; } const parentId = channel.parentId ? maps.channels.get(channel.parentId) : null; const name = found && conflictMode === 'rename' ? uniqueName(names, channel.name, 100) : channel.name; const created = await guild.channels.create(channelPayload(channel, parentId, name)); maps.channels.set(channel.id, created.id); names.add(created.name.toLowerCase()); log.copied.channels += 1; } catch (error) { pushError(log, `Channel ${channel.name}`, error); log.skipped.push(`Channel failed: ${channel.name}`); } } }
async function applyPermissions(guild, snap, maps, log) { for (const sourceChannel of snap.channels || []) { try { const targetId = maps.channels.get(sourceChannel.id); if (!targetId) continue; const channel = guild.channels.cache.get(targetId) || await guild.channels.fetch(targetId).catch(() => null); if (!channel?.permissionOverwrites?.set) continue; const overwrites = []; for (const overwrite of sourceChannel.permissionOverwrites || []) { const mappedId = overwrite.id === snap.sourceGuild?.id ? guild.id : maps.roles.get(overwrite.id); if (!mappedId) continue; overwrites.push({ id: mappedId, type: overwrite.type, allow: new PermissionsBitField(BigInt(overwrite.allow || 0)), deny: new PermissionsBitField(BigInt(overwrite.deny || 0)) }); } await channel.permissionOverwrites.set(overwrites, 'Goliath duplicator: permissions'); log.copied.permissionOverwrites += overwrites.length; } catch (error) { pushError(log, `Permissions ${sourceChannel.name}`, error); log.skipped.push(`Permissions failed: ${sourceChannel.name}`); } } }
async function applyEmojis(guild, snap, log, conflictMode) { const names = new Set(guild.emojis.cache.map((e) => e.name.toLowerCase())); for (const emoji of snap.emojis || []) { try { if (!emoji.url || !emoji.name) continue; if (names.has(emoji.name.toLowerCase()) && conflictMode === 'skip') { log.skipped.push(`Emoji exists: ${emoji.name}`); continue; } const name = names.has(emoji.name.toLowerCase()) && conflictMode === 'rename' ? uniqueName(names, emoji.name, 32).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) : emoji.name; await guild.emojis.create({ attachment: emoji.url, name, reason: 'Goliath duplicator: emoji' }); names.add(name.toLowerCase()); log.copied.emojis += 1; } catch (error) { pushError(log, `Emoji ${emoji.name}`, error); log.skipped.push(`Emoji failed: ${emoji.name}`); } } }
function resultEmbed(title, guild, log) { return embed(title, [`**Destination:** ${guild.name}`, `**Status:** \`${log.status}\``, `**Conflict:** \`${log.conflictMode}\``, `**Rollback:** \`${log.rollbackBackupId || (log.dryRun ? 'dry-run' : 'none')}\``, '', `Settings \`${log.copied.serverSettings}\` • Roles \`${log.copied.roles}\` • Categories \`${log.copied.categories}\` • Channels \`${log.copied.channels}\` • Permissions \`${log.copied.permissionOverwrites}\` • Emojis \`${log.copied.emojis}\``, log.deleted.roles || log.deleted.channels ? `Deleted: roles \`${log.deleted.roles}\`, channels \`${log.deleted.channels}\`` : '', log.skipped.length ? `Skipped:\n${log.skipped.slice(0, 8).map((i) => `• ${i}`).join('\n')}` : '', log.notes.length ? `Notes:\n${log.notes.slice(0, 8).map((i) => `• ${i}`).join('\n')}` : '', log.errors.length ? `Warnings/Errors:\n${log.errors.slice(0, 8).map((e) => `⚠️ ${e}`).join('\n')}` : ''].filter(Boolean).join('\n'), log.errors.length ? 0xf59e0b : 0x22c55e); }
function dryRunFollowupPayload(session) {
  const last = session.lastDryRun;
  if (!last) return { embeds: [embed('❌ Dry Run Unavailable', 'The previous dry-run result is no longer available.', 0xef4444)], components: [] };
  return {
    embeds: [resultEmbed('🧪 Copy Dry-Run Complete', last.guildInfo, last.log)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'proceed')).setLabel('Run Copy').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'edit')).setLabel('Edit Options').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger)
    )],
  };
}
function copyFinalConfirmPayload(interaction, session) {
  return {
    embeds: [embed('⚠️ Final Copy Confirmation', [
      `**Source:** ${guildDisplay(session, interaction.client, session.sourceGuildId)}`,
      `**Destination:** ${guildDisplay(session, interaction.client, session.destinationGuildId)}`,
      `**Conflict:** \`${session.conflictMode}\``,
      '',
      '**The dry run is complete.** Press the red **Confirm Copy** button to apply these exact settings to the destination.',
      '',
      ...session.selectedOptions.map((key) => `• ${COPY_OPTIONS[key] || key}`),
    ].join('\n'), 0xf59e0b)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'confirm')).setLabel('Confirm Copy').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'back-dryrun')).setLabel('Back').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )],
  };
}
function analyseResultComponents(session) {
  if (!session?.id) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'dryrun')).setLabel('Run Copy Dry-Run').setEmoji('🧪').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'copy')).setLabel('Continue to Copy').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'back')).setLabel('Analyse Again').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  )];
}
function copySessionFromAnalyse(interaction, analyseSession, dryRun = false) {
  const session = makeSession(interaction, 'copy');
  session.sourceGuildId = analyseSession.sourceGuildId;
  session.destinationGuildId = analyseSession.destinationGuildId;
  session.guildDirectory = [...(analyseSession.guildDirectory || [])];
  session.selectedOptions = [...ACTIVE_OPTIONS];
  session.conflictMode = 'skip';
  session.dryRun = dryRun;
  session.pendingConfirm = false;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}
async function executeStage(name, log, fn) { console.log(`[Duplicator] Stage start: ${name}`); try { await fn(); console.log(`[Duplicator] Stage complete: ${name}`); } catch (error) { pushError(log, name, error); } }
async function executeSnapshotOnGuild(guild, session, snap, title, actorId = 'bridge') {
  await fetchGuildState(guild); const log = runLog(session, snap); const missing = missingPermissions(guild); if (missing.length) log.errors.push(`Preflight missing permissions: ${missing.join(', ')}`); const hierarchy = hierarchyWarning(guild); if (hierarchy) log.errors.push(`Preflight hierarchy warning: ${hierarchy} Discord does not allow bots to bypass role hierarchy.`); for (const [key, item] of Object.entries(snap.future || {})) if (item?.requested && !item.supported) log.notes.push(`${COPY_OPTIONS[key] || key}: ${item.reason}`); if (session.dryRun) { applyDryRunPlan(log, dryRunPlan(guild, snap, session.conflictMode)); log.status = 'dry-run'; return log; }
  try { const rollback = await createServerBackup(guild, { createdBy: `duplicator:${actorId}`, requestedBy: actorId, reason: `Rollback before ${title}`, type: 'rollback' }); log.rollbackBackupId = rollback.backupId; } catch (error) { pushError(log, 'Rollback backup', error); }
  if (session.conflictMode === 'replace') await executeStage('Replace destination', log, async () => { await clearDestination(guild, log); await fetchGuildState(guild); });
  const maps = { roles: new Map([[snap.sourceGuild?.id, guild.id]]), channels: new Map() };
  await executeStage('Server settings', log, () => applySettings(guild, snap, log)); await executeStage('Roles', log, () => applyRoles(guild, snap, maps, log, session.conflictMode)); await executeStage('Channels', log, () => applyChannels(guild, snap, maps, log, session.conflictMode)); await executeStage('Permissions', log, () => applyPermissions(guild, snap, maps, log)); await executeStage('Emojis', log, () => applyEmojis(guild, snap, log, session.conflictMode)); log.status = log.errors.length ? 'completed-with-warnings' : 'success'; return log;
}
async function snapshotForGuild(client, guildId, selectedOptions, session = null) { const route = await resolveGuildRoute(client, guildId, session); if (!route) throw new Error('Source server is unavailable to every Goliath environment.'); if (route.local) { const result = await fetchGuildById(client, guildId); if (!result.guild) throw new Error('Source server is unavailable.'); await fetchGuildState(result.guild); return snapshot(result.guild, selectedOptions); } const response = await bridgeRequest(route.environment, 'POST', '/snapshot', { guildId, selectedOptions }, 10000); return response.snapshot; }
async function executeSnapshot(interaction, session, snap, title) {
  const route = await resolveGuildRoute(interaction.client, session.destinationGuildId, session);
  if (!route) throw new Error('Destination server is unavailable to every Goliath environment.');
  let guildInfo;
  let log;
  if (route.local) {
    const result = await fetchGuildById(interaction.client, session.destinationGuildId);
    if (!result.guild) throw new Error('Destination server is unavailable.');
    guildInfo = { id: result.guild.id, name: result.guild.name };
    log = await executeSnapshotOnGuild(result.guild, session, snap, title, interaction.user.id);
  } else {
    const response = await bridgeRequest(route.environment, 'POST', '/apply', { guildId: session.destinationGuildId, session: { dryRun: session.dryRun, conflictMode: session.conflictMode }, snapshot: snap, title, actorId: interaction.user.id }, 120000);
    guildInfo = response.guild;
    log = response.log;
  }
  if (log.status === 'dry-run') {
    session.lastDryRun = { guildInfo, log };
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return interaction.editReply(dryRunFollowupPayload(session));
  }
  return interaction.editReply({ embeds: [resultEmbed(`✅ ${title} Complete`, guildInfo, log)], components: [] });
}


async function readBridgeBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); if (!chunks.length) return {}; return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function bridgeAuthorized(req) { const configured = bridgeSecret(); return !configured || req.headers['x-goliath-duplicator-secret'] === configured; }
function bridgeJson(res, status, value) { const body = Buffer.from(JSON.stringify(value)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(body.length) }); res.end(body); }
function initializeBridge(client) {
  bridgeClient = client;
  if (bridgeServer) return bridgeServer;
  const port = Number(process.env.BOT_API_PORT || bridgePort(mode()));
  bridgeServer = http.createServer(async (req, res) => {
    try {
      if (!bridgeAuthorized(req)) return bridgeJson(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && req.url === '/guilds') return bridgeJson(res, 200, { environment: mode(), guilds: localGuildDirectory(bridgeClient) });
      if (req.method === 'POST' && req.url === '/snapshot') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); await fetchGuildState(result.guild); return bridgeJson(res, 200, { snapshot: snapshot(result.guild, body.selectedOptions || [...ACTIVE_OPTIONS]) }); }
      if (req.method === 'POST' && req.url === '/apply') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); const log = await executeSnapshotOnGuild(result.guild, body.session || { dryRun: true, conflictMode: 'skip' }, body.snapshot, body.title || 'Copy', body.actorId || 'bridge'); return bridgeJson(res, 200, { guild: { id: result.guild.id, name: result.guild.name }, log }); }
      return bridgeJson(res, 404, { error: 'Not found' });
    } catch (error) { console.error('[Duplicator Bridge]', error); return bridgeJson(res, 500, { error: error.message || String(error) }); }
  });
  bridgeServer.on('error', (error) => { console.error(`[Duplicator] Bridge failed on ${BRIDGE_HOST}:${port}:`, error); bridgeServer = null; });
  bridgeServer.listen(port, BRIDGE_HOST, () => console.log(`[Duplicator] ${mode()} bridge listening on ${BRIDGE_HOST}:${port}`));
  bridgeServer.unref?.(); return bridgeServer;
}

async function startCopy(interaction) { const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral }); initializeBridge(interaction.client); const session = makeSession(interaction, 'copy'); await refreshSessionDirectory(interaction.client, session); return interaction.reply(await copyPanel(interaction, session)); }
async function startBuild(interaction) { const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral }); initializeBridge(interaction.client); templates(interaction.guild.id, interaction.guild); const session = makeSession(interaction, 'build'); await refreshSessionDirectory(interaction.client, session); return interaction.reply(await buildPanel(interaction, session)); }
async function exportTemplate(interaction) { const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral }); initializeBridge(interaction.client); const name = interaction.options.getString('name'); if (!name) return interaction.reply({ content: '❌ Export needs `name`.', flags: MessageFlags.Ephemeral }); const sourceGuildId = interaction.options.getString('source_server') || interaction.guild.id; await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const directory = await getGuildDirectory(interaction.client); const snap = await snapshotForGuild(interaction.client, sourceGuildId, [...ACTIVE_OPTIONS], { guildDirectory: directory }); const sourceEntry = directory.find((g) => g.id === sourceGuildId) || { id: sourceGuildId, name: snap.sourceGuild?.name || sourceGuildId, environment: mode() }; const templateId = slugify(interaction.options.getString('template_id') || name); const all = templates(interaction.guild.id, interaction.guild); const existing = all[templateId]; all[templateId] = { meta: { id: templateId, name, description: interaction.options.getString('description') || '', version: interaction.options.getString('version') || '2.0.0', sourceGuildId, sourceGuildName: sourceEntry.name, createdAt: existing?.meta?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: existing?.meta?.createdBy || interaction.user.id, updatedBy: interaction.user.id, environment: sourceEntry.environment || mode(), schemaVersion: 2, defaultTemplate: false }, snapshot: snap }; saveTemplates(interaction.guild.id, all, interaction.guild); return interaction.editReply({ embeds: [embed('✅ Template Exported', `**Template:** ${name}\n**ID:** \`${templateId}\`\n**Saved:** \`modules.duplicator.templates.${templateId}\`\n\nRoles \`${snap.stats.roles}\` • Channels \`${snap.stats.channels}\` • Emojis \`${snap.stats.emojis}\``, 0x22c55e)] }); }
async function performAnalyse(interaction, sourceGuildId, destinationGuildId, session = null) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  initializeBridge(interaction.client);
  if (!/^\d{16,25}$/.test(String(sourceGuildId || '')) || !/^\d{16,25}$/.test(String(destinationGuildId || ''))) return interaction.reply({ content: '❌ Source and destination must be valid Discord servers.', flags: MessageFlags.Ephemeral });
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const directory = session?.guildDirectory?.length ? session.guildDirectory : await getGuildDirectory(interaction.client);
  const routeSession = { guildDirectory: directory };
  const snap = await snapshotForGuild(interaction.client, sourceGuildId, [...ACTIVE_OPTIONS], routeSession);
  const destinationRoute = await resolveGuildRoute(interaction.client, destinationGuildId, routeSession);
  if (!destinationRoute) return interaction.editReply({ content: '❌ Destination server is unavailable to every Goliath environment.', embeds: [], components: [] });
  const buttons = analyseResultComponents(session);
  if (!destinationRoute.local) {
    const response = await bridgeRequest(destinationRoute.environment, 'POST', '/apply', { guildId: destinationGuildId, session: { dryRun: true, conflictMode: 'skip' }, snapshot: snap, title: 'Analyse', actorId: interaction.user.id }, 120000);
    return interaction.editReply({ embeds: [embed('🔎 Duplicator Analyse', [
      `**Source:** ${snap.sourceGuild?.name || sourceGuildId}`,
      `**Destination:** ${response.guild?.name || guildDisplay(routeSession, interaction.client, destinationGuildId)}`,
      '',
      `Would create: roles \`${response.log.copied.roles}\`, categories \`${response.log.copied.categories}\`, channels \`${response.log.copied.channels}\`, permissions \`${response.log.copied.permissionOverwrites}\`, emojis \`${response.log.copied.emojis}\``,
      response.log.notes?.length ? `Notes:\n${response.log.notes.slice(0, 6).map((n) => `• ${n}`).join('\n')}` : '',
      response.log.errors?.length ? `Warnings:\n${response.log.errors.slice(0, 6).map((e) => `⚠️ ${e}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'), response.log.errors?.length ? 0xf59e0b : 0x22c55e)], components: buttons });
  }
  const result = await fetchGuildById(interaction.client, destinationGuildId);
  const destinationGuild = result.guild;
  await fetchGuildState(destinationGuild);
  const destRoles = new Set(destinationGuild.roles.cache.map((r) => r.name.toLowerCase()));
  const destChannels = new Set(destinationGuild.channels.cache.map((c) => `${c.type}:${c.name.toLowerCase()}`));
  const destEmojis = new Set(destinationGuild.emojis.cache.map((e) => e.name.toLowerCase()));
  const permissionLines = REQUIRED_BOT_PERMISSIONS.map(([name, bit]) => `${destinationGuild.members.me?.permissions?.has(bit) ? '✅' : '❌'} ${name}`).join('\n');
  return interaction.editReply({ embeds: [embed('🔎 Duplicator Analyse', `**Source:** ${snap.sourceGuild?.name}\n**Destination:** ${destinationGuild.name}\n\nMissing roles: \`${snap.roles.filter((r) => !destRoles.has(r.name.toLowerCase())).length}\`\nMissing channels: \`${snap.channels.filter((c) => !destChannels.has(`${c.type}:${c.name.toLowerCase()}`)).length}\`\nMissing emojis: \`${snap.emojis.filter((e) => !destEmojis.has(e.name.toLowerCase())).length}\`\n\n**Bot permissions:**\n${permissionLines}\n\n**Hierarchy:** ${hierarchyWarning(destinationGuild) ? `⚠️ ${hierarchyWarning(destinationGuild)}` : '✅ Goliath role has usable hierarchy.'}`, 0x22c55e)], components: buttons });
}


async function analyse(interaction) {
  const access = assertAccess(interaction);
  if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  initializeBridge(interaction.client);
  const sourceGuildId = String(interaction.options.getString('source_server') || '').trim();
  const destinationGuildId = String(interaction.options.getString('destination_server') || '').trim();
  if (sourceGuildId && destinationGuildId) return performAnalyse(interaction, sourceGuildId, destinationGuildId);
  const session = makeAnalyseSession(interaction);
  await refreshSessionDirectory(interaction.client, session);
  return interaction.reply(await analysePanel(interaction, session));
}

async function run(interaction) { const action = interaction.options.getString('action', true); if (action === 'copy') return startCopy(interaction); if (action === 'analyse') return analyse(interaction); if (action === 'export') return exportTemplate(interaction); if (action === 'build') return startBuild(interaction); return interaction.reply({ content: '❌ Unknown server action.', flags: MessageFlags.Ephemeral }); }
async function handleCopy(interaction, data) {
  initializeBridge(interaction.client);
  const session = getSession(copySessions, interaction, data.sessionId);
  if (!session) return interaction.reply({ content: '❌ Copy session expired or you do not own it.', flags: MessageFlags.Ephemeral }).catch(() => null);
  const reset = () => { session.pendingConfirm = false; session.lastDryRun = null; session.expiresAt = Date.now() + SESSION_TTL_MS; };
  if (data.action === 'source') { session.sourceGuildId = interaction.values?.[0]; reset(); }
  else if (data.action === 'destination') { session.destinationGuildId = interaction.values?.[0]; reset(); }
  else if (data.action === 'options') { session.selectedOptions = interaction.values || [...ACTIVE_OPTIONS]; reset(); }
  else if (data.action === 'conflict') { session.conflictMode = interaction.values?.[0] || 'skip'; reset(); }
  else if (data.action === 'refresh') { await refreshSessionDirectory(interaction.client, session); reset(); }
  else if (data.action === 'dryrun') { session.dryRun = !session.dryRun; reset(); }
  else if (data.action === 'cancel') { copySessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Copy Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'edit') { session.dryRun = true; session.pendingConfirm = false; return interaction.update(await copyPanel(interaction, session)); }
  else if (data.action === 'proceed') { session.dryRun = false; session.pendingConfirm = true; session.expiresAt = Date.now() + SESSION_TTL_MS; return interaction.update(copyFinalConfirmPayload(interaction, session)); }
  else if (data.action === 'back-dryrun') { session.dryRun = true; session.pendingConfirm = false; return interaction.update(dryRunFollowupPayload(session)); }
  else if (data.action === 'confirm') {
    session.dryRun = false;
    session.pendingConfirm = true;
    const snap = await snapshotForGuild(interaction.client, session.sourceGuildId, session.selectedOptions, session);
    await interaction.update({ embeds: [embed('🚧 Copy Running', 'Working...', 0x5865f2)], components: [] });
    await executeSnapshot(interaction, session, snap, 'Copy');
    copySessions.delete(session.id);
    return true;
  }
  else if (data.action === 'start') {
    if (!session.dryRun && !session.pendingConfirm) { session.pendingConfirm = true; return interaction.update(await copyPanel(interaction, session)); }
    const wasDryRun = session.dryRun;
    const snap = await snapshotForGuild(interaction.client, session.sourceGuildId, session.selectedOptions, session);
    await interaction.update({ embeds: [embed(wasDryRun ? '🧪 Dry Run Running' : '🚧 Copy Running', 'Working...', 0x5865f2)], components: [] });
    await executeSnapshot(interaction, session, snap, 'Copy');
    if (!wasDryRun) copySessions.delete(session.id);
    return true;
  }
  return interaction.update(await copyPanel(interaction, session));
}

async function handleBuild(interaction, data) { initializeBridge(interaction.client); const session = getSession(buildSessions, interaction, data.sessionId); if (!session) return interaction.reply({ content: '❌ Build session expired or you do not own it.', flags: MessageFlags.Ephemeral }).catch(() => null); if (data.action === 'template') { session.templateId = interaction.values?.[0] === 'none' ? null : interaction.values?.[0]; session.pendingConfirm = false; } else if (data.action === 'destination') { session.destinationGuildId = interaction.values?.[0]; session.pendingConfirm = false; } else if (data.action === 'conflict') { session.conflictMode = interaction.values?.[0] || 'skip'; session.pendingConfirm = false; } else if (data.action === 'refresh') { await refreshSessionDirectory(interaction.client, session); session.pendingConfirm = false; } else if (data.action === 'dryrun') { session.dryRun = !session.dryRun; session.pendingConfirm = false; } else if (data.action === 'cancel') { buildSessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Build Cancelled', 'No changes were made.', 0xef4444)], components: [] }); } else if (data.action === 'start') { if (!session.dryRun && !session.pendingConfirm) { session.pendingConfirm = true; return interaction.update(await buildPanel(interaction, session)); } const template = templates(session.controlGuildId)[session.templateId]; if (!template?.snapshot) return interaction.update({ content: '❌ Template not found.', embeds: [], components: [] }); await interaction.update({ embeds: [embed('🏗️ Build Running', 'Working...', 0x5865f2)], components: [] }); await executeSnapshot(interaction, session, template.snapshot, 'Build'); buildSessions.delete(session.id); return true; } return interaction.update(await buildPanel(interaction, session)); }
async function handleAnalyse(interaction, data) {
  initializeBridge(interaction.client);
  const session = getSession(analyseSessions, interaction, data.sessionId);
  if (!session) return interaction.reply({ content: '❌ Analyse session expired or you do not own it.', flags: MessageFlags.Ephemeral }).catch(() => null);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  if (data.action === 'source') session.sourceGuildId = interaction.values?.[0];
  else if (data.action === 'destination') session.destinationGuildId = interaction.values?.[0];
  else if (data.action === 'refresh') await refreshSessionDirectory(interaction.client, session);
  else if (data.action === 'back') return interaction.update(await analysePanel(interaction, session));
  else if (data.action === 'cancel') { analyseSessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Analyse Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'copy') {
    const copySession = copySessionFromAnalyse(interaction, session, false);
    analyseSessions.delete(session.id);
    return interaction.update(await copyPanel(interaction, copySession));
  }
  else if (data.action === 'dryrun') {
    const copySession = copySessionFromAnalyse(interaction, session, true);
    analyseSessions.delete(session.id);
    const snap = await snapshotForGuild(interaction.client, copySession.sourceGuildId, copySession.selectedOptions, copySession);
    await interaction.update({ embeds: [embed('🧪 Dry Run Running', 'Working...', 0x5865f2)], components: [] });
    await executeSnapshot(interaction, copySession, snap, 'Copy');
    return true;
  }
  else if (data.action === 'start') {
    await interaction.update({ embeds: [embed('🔎 Analysing Servers', 'Working...', 0x5865f2)], components: [] });
    await performAnalyse(interaction, session.sourceGuildId, session.destinationGuildId, session);
    return true;
  }
  return interaction.update(await analysePanel(interaction, session));
}


async function handleInteraction(interaction) {
  if (!interaction?.customId) return false;
  const analyseData = parseComponentId(interaction.customId, ANALYSE_PREFIX);
  if (analyseData) { await handleAnalyse(interaction, analyseData); return true; }
  const copy = parseComponentId(interaction.customId, COPY_PREFIX);
  if (copy) { await handleCopy(interaction, copy); return true; }
  const build = parseComponentId(interaction.customId, BUILD_PREFIX);
  if (build) { await handleBuild(interaction, build); return true; }
  return false;
}

module.exports = { run, handleInteraction, assertAccess, snapshot, templates, templateList, DEFAULT_TEMPLATES, initializeBridge, getGuildDirectory };
