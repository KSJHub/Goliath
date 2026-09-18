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
const security = require('../../../core/security/protection/core');
const guildManager = require('../../../core/guild/guildManager');
const { createServerBackup } = require('../../../core/security/restoreBackup/backup');

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
let bridgeUnavailable = false;

const COPY_OPTIONS = Object.freeze({
  roles: 'Roles', categories: 'Categories', channels: 'Channels', permissions: 'Channel Permissions',
  serverSettings: 'Server Settings + Branding', emojis: 'Emojis', stickers: 'Stickers',
  scheduledEvents: 'Scheduled Events', webhooks: 'Webhooks', automod: 'AutoMod Rules',
});
const ACTIVE_OPTIONS = new Set(['roles', 'categories', 'channels', 'permissions', 'serverSettings', 'emojis']);
const FUTURE_OPTIONS = new Set(['stickers', 'scheduledEvents', 'webhooks', 'automod']);
const CONFLICT_MODES = Object.freeze({ skip: 'Skip Existing', rename: 'Rename Duplicates', replace: 'Replace Destination' });

// These are operation permissions, not an Administrator requirement. Optional feature
// permissions are checked only when that feature is actually requested.
const BASE_REQUIRED_PERMISSIONS = Object.freeze([
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
]);

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
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  await guild.emojis.fetch().catch(() => null);
  await guild.members.fetchMe().catch(() => null);
}
function localGuildDirectory(client) { return [...client.guilds.cache.values()].map((guild) => ({ id: guild.id, name: guild.name, environment: mode() })); }
function bridgePort(environment) { return Number(process.env[`DUPLICATOR_BRIDGE_PORT_${environment}`] || BRIDGE_PORTS[environment]); }
const LEGACY_BRIDGE_PORTS = Object.freeze({ DEV: 3002, BETA: 3004, PRODUCTION: 3006 });
const resolvedBridgePorts = new Map();
function bridgePortCandidates(environment) {
  return [...new Set([
    Number(process.env[`DUPLICATOR_BRIDGE_PORT_${environment}`] || 0),
    Number(resolvedBridgePorts.get(environment) || 0),
    Number(BRIDGE_PORTS[environment] || 0),
    Number(LEGACY_BRIDGE_PORTS[environment] || 0),
  ].filter((value) => Number.isFinite(value) && value > 0))];
}
function bridgeSecret() { return String(process.env.DUPLICATOR_BRIDGE_SECRET || '').trim(); }
function bridgeRequestAtPort(environment, port, method, path, payload = null, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const body = payload == null ? null : Buffer.from(JSON.stringify(payload));
    const headers = { accept: 'application/json' };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = String(body.length); }
    if (bridgeSecret()) headers['x-goliath-duplicator-secret'] = bridgeSecret();
    const req = http.request({ host: BRIDGE_HOST, port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) { resolvedBridgePorts.set(environment, port); resolve(data); }
        else { const error = new Error(data.error || `Bridge ${environment} returned ${res.statusCode}`); error.bridgeHttp = true; error.statusCode = res.statusCode; reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => { const error = new Error(`Bridge ${environment} timed out on ${port}`); error.bridgeNetwork = true; req.destroy(error); });
    req.on('error', (error) => { if (!error.bridgeHttp) error.bridgeNetwork = true; reject(error); });
    if (body) req.write(body);
    req.end();
  });
}
async function bridgeRequest(environment, method, path, payload = null, timeoutMs = 2500) {
  let lastError = null;
  for (const port of bridgePortCandidates(environment)) {
    try { return await bridgeRequestAtPort(environment, port, method, path, payload, timeoutMs); }
    catch (error) { lastError = error; if (error.bridgeHttp) throw error; }
  }
  throw lastError || new Error(`Bridge ${environment} has no configured port.`);
}
async function getGuildDirectory(client) {
  const byId = new Map();
  const bridgeStatus = {};
  for (const item of localGuildDirectory(client)) byId.set(item.id, { ...item, environments: [item.environment] });
  await Promise.all(Object.keys(BRIDGE_PORTS).filter((env) => env !== mode()).map(async (environment) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await bridgeRequest(environment, 'GET', '/guilds', null, 3500);
        bridgeStatus[environment] = { ok: true, guilds: (response.guilds || []).length, port: resolvedBridgePorts.get(environment) || null };
        for (const item of response.guilds || []) {
          const existing = byId.get(item.id);
          if (existing) existing.environments = [...new Set([...(existing.environments || [existing.environment]), item.environment || environment])];
          else byId.set(item.id, { ...item, environment: item.environment || environment, environments: [item.environment || environment] });
        }
        return;
      } catch (error) { lastError = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    bridgeStatus[environment] = { ok: false, error: lastError?.message || 'unavailable' };
    console.warn('[Duplicator] ' + environment + ' bridge unavailable after retry: ' + (lastError?.message || 'unknown error'));
  }));
  const guilds = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  Object.defineProperty(guilds, 'bridgeStatus', { value: bridgeStatus, enumerable: false });
  return guilds;
}
async function refreshSessionDirectory(client, session) { session.guildDirectory = await getGuildDirectory(client); session.bridgeStatus = session.guildDirectory.bridgeStatus || {}; return session.guildDirectory; }
function directoryGuild(session, id) { return (session.guildDirectory || []).find((item) => item.id === String(id || '')) || null; }
function guildDisplay(session, client, id) {
  if (!id) return '`Not selected`';
  const local = guildById(client, id); if (local) return `${local.name} · ${mode()}`;
  const found = directoryGuild(session, id); return found ? `${found.name} · ${(found.environments || [found.environment]).join('/')}` : id;
}
function guildChoices(session, selectedId = null) {
  return (session.guildDirectory || []).slice(0, 25).map((guild) => ({
    label: guild.name.slice(0, 100),
    description: `${(guild.environments || [guild.environment]).join('/')} • ${guild.id}`.slice(0, 100),
    value: guild.id,
    default: guild.id === selectedId,
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
    guildDirectory: [],
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  (type === 'build' ? buildSessions : copySessions).set(session.id, session);
  return session;
}
function makeAnalyseSession(interaction) {
  const session = { id: `${interaction.user.id}-${Date.now().toString(36)}`, ownerId: interaction.user.id, controlGuildId: interaction.guild.id, sourceGuildId: null, destinationGuildId: interaction.guild.id, guildDirectory: [], expiresAt: Date.now() + SESSION_TTL_MS };
  analyseSessions.set(session.id, session);
  return session;
}

function channelTemplate(id, name, type, parentId, position) { return { id, name, type, parentId, position, topic: null, nsfw: false, rateLimitPerUser: 0, bitrate: null, userLimit: 0, rtcRegion: null, videoQualityMode: null, defaultAutoArchiveDuration: null, defaultThreadRateLimitPerUser: 0, availableTags: [], permissionOverwrites: [] }; }
function makeTemplate(templateId, name, description, roleDefs, categoryDefs) {
  const roles = roleDefs.map(([roleName, color], index) => ({ id: `template:${templateId}:role:${slugify(roleName)}`, name: roleName, color, hoist: index < 3, mentionable: false, permissions: '0', position: index + 1 }));
  const channels = []; let position = 0;
  for (const [categoryName, children] of categoryDefs) {
    const categoryId = `template:${templateId}:category:${slugify(categoryName)}`;
    channels.push(channelTemplate(categoryId, categoryName, ChannelType.GuildCategory, null, position++));
    for (const [channelName, type] of children) channels.push(channelTemplate(`template:${templateId}:channel:${slugify(channelName)}`, channelName, type, categoryId, position++));
  }
  return { meta: { id: templateId, name, description, version: '1.0.0', createdAt: 'system-default', updatedAt: 'system-default', createdBy: 'Goliath', updatedBy: 'Goliath', sourceGuildId: `template:${templateId}`, sourceGuildName: name, environment: 'DEFAULT', schemaVersion: 2, defaultTemplate: true }, snapshot: { sourceGuild: { id: `template:${templateId}`, name }, options: ['roles', 'categories', 'channels', 'permissions'], settings: null, roles, managedRoles: [], channels, emojis: [], future: {}, stats: { roles: roles.length, managedRoles: 0, categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length, channels: channels.filter((c) => c.type !== ChannelType.GuildCategory).length, permissionOverwrites: 0, emojis: 0 } } };
}
const DEFAULT_TEMPLATES = Object.freeze({
  'basic-gaming': makeTemplate('basic-gaming', 'Basic Gaming', 'Starter gaming community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Moderator', 0x3b82f6], ['Member', 0x22c55e]], [['INFORMATION', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['announcements', ChannelType.GuildAnnouncement]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['clips-and-media', ChannelType.GuildText], ['looking-for-group', ChannelType.GuildText], ['General Voice', ChannelType.GuildVoice]]]]),
  'community-server': makeTemplate('community-server', 'Community Server', 'Clean public community layout.', [['Owner', 0xffc107], ['Admin', 0xef4444], ['Staff', 0x3b82f6], ['Member', 0x22c55e]], [['START HERE', [['welcome', ChannelType.GuildText], ['rules', ChannelType.GuildText], ['server-info', ChannelType.GuildText]]], ['COMMUNITY', [['general', ChannelType.GuildText], ['introductions', ChannelType.GuildText], ['Community Voice', ChannelType.GuildVoice]]]]),
});

function serializeChannel(channel) {
  return {
    id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null,
    position: channel.rawPosition ?? channel.position ?? 0, topic: channel.topic || null, nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser || 0, bitrate: channel.bitrate || null, userLimit: channel.userLimit || 0,
    rtcRegion: channel.rtcRegion || null, videoQualityMode: channel.videoQualityMode || null,
    defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration || null,
    defaultThreadRateLimitPerUser: channel.defaultThreadRateLimitPerUser || 0,
    availableTags: Array.isArray(channel.availableTags) ? channel.availableTags.map((tag) => ({ name: tag.name, moderated: Boolean(tag.moderated), emojiId: tag.emojiId || null, emojiName: tag.emojiName || null })) : [],
    permissionOverwrites: channel.permissionOverwrites?.cache ? channel.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) : [],
  };
}
function serializeManagedRole(role) {
  const tags = role.tags || {};
  return { id: role.id, name: role.name, managed: true, permissions: role.permissions.bitfield.toString(), position: role.position, tags: { botId: tags.botId || null, integrationId: tags.integrationId || null, subscriptionListingId: tags.subscriptionListingId || null } };
}
function snapshot(guild, selectedOptions = [...ACTIVE_OPTIONS]) {
  const selected = new Set(selectedOptions);
  const channels = selected.has('categories') || selected.has('channels') || selected.has('permissions') ? guild.channels.cache.filter((c) => selected.has('channels') || c.type === ChannelType.GuildCategory).sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0)).map(serializeChannel) : [];
  const normalRoleObjects = selected.has('roles') || selected.has('permissions') ? guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => a.position - b.position).map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield.toString(), position: r.position })) : [];
  const sourceBotRoleIds = new Set(guild.members.me?.roles?.cache?.keys?.() || []);
  const remapOnlyIds = selected.has('permissions') ? new Set(normalRoleObjects.filter((r) => sourceBotRoleIds.has(r.id) && /(^|\W)goliath($|\W)/i.test(String(r.name || ''))).map((r) => r.id)) : new Set();
  const roles = normalRoleObjects.filter((r) => !remapOnlyIds.has(r.id));
  const managedRoles = selected.has('permissions') ? [
    ...guild.roles.cache.filter((r) => r.id !== guild.id && r.managed).sort((a, b) => a.position - b.position).map(serializeManagedRole),
    ...normalRoleObjects.filter((r) => remapOnlyIds.has(r.id)).map((r) => ({ ...r, managed: true, remapOnly: true, tags: { botId: guild.client.user?.id || null, integrationId: null, subscriptionListingId: null } })),
  ] : [];
  const emojis = selected.has('emojis') ? guild.emojis.cache.map((e) => ({ id: e.id, name: e.name, animated: e.animated, url: typeof e.imageURL === 'function' ? e.imageURL({ extension: e.animated ? 'gif' : 'png' }) : e.url })) : [];
  const settings = selected.has('serverSettings') ? { name: guild.name, description: guild.description || null, verificationLevel: guild.verificationLevel, explicitContentFilter: guild.explicitContentFilter, defaultMessageNotifications: guild.defaultMessageNotifications, afkTimeout: guild.afkTimeout, iconURL: guild.iconURL({ extension: 'png', size: 1024 }) || null, bannerURL: guild.bannerURL({ extension: 'png', size: 2048 }) || null, splashURL: guild.splashURL({ extension: 'png', size: 2048 }) || null } : null;
  const future = {}; for (const key of FUTURE_OPTIONS) if (selected.has(key)) future[key] = { requested: true, supported: false, reason: 'Reserved for Duplicator API expansion.' };
  return { sourceGuild: { id: guild.id, name: guild.name, botUserId: guild.client.user?.id || null }, options: [...selected], settings, roles, managedRoles, channels, emojis, future, stats: { roles: roles.length, managedRoles: managedRoles.length, categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length, channels: channels.filter((c) => c.type !== ChannelType.GuildCategory).length, permissionOverwrites: channels.reduce((total, c) => total + (c.permissionOverwrites?.length || 0), 0), emojis: emojis.length } };
}

function readTemplates(guildId) { const cfg = moduleConfig(guildId); return cfg.templates && typeof cfg.templates === 'object' && !Array.isArray(cfg.templates) ? cfg.templates : {}; }
function saveTemplates(guildId, value, guildOrMeta = {}) { guildManager.updateGuildSection(guildId, 'modules', (modules) => ({ ...modules, duplicator: { ...(modules.duplicator || {}), enabled: modules.duplicator?.enabled ?? true, hidden: true, ownerOnly: true, templates: value } }), {}, guildOrMeta); return value; }
function templates(guildId, guildOrMeta = {}) { const stored = readTemplates(guildId); return Object.keys(stored).length ? stored : saveTemplates(guildId, JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)), guildOrMeta); }
function templateList(guildId) { return Object.entries(templates(guildId)).filter(([, t]) => t?.snapshot).map(([id, t]) => ({ id, ...t })).sort((a, b) => String(a.meta?.name || a.id).localeCompare(String(b.meta?.name || b.id))); }

function sameNameRoles(guild, name) { return [...guild.roles.cache.values()].filter((r) => !r.managed && r.id !== guild.id && r.name.toLowerCase() === String(name).toLowerCase()); }
function existingRole(guild, name) { const matches = sameNameRoles(guild, name); return matches.length === 1 ? matches[0] : null; }
function duplicatorCreateChannelType(guild, type) {
  const numeric = Number(type);
  const supported = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia]);
  if (!supported.has(numeric)) return ChannelType.GuildText;
  if (numeric === ChannelType.GuildAnnouncement && !new Set(guild?.features || []).has('COMMUNITY')) return ChannelType.GuildText;
  return numeric;
}
function existingChannel(guild, channel, parentId = undefined) {
  const type = duplicatorCreateChannelType(guild, channel.type);
  return guild.channels.cache.find((c) => c.type === type && c.name.toLowerCase() === String(channel.name).toLowerCase() && (parentId === undefined || (c.parentId || null) === (parentId || null)));
}
function uniqueName(existingNames, baseName, maxLength = 100) { const base = String(baseName || 'copy').slice(0, maxLength - 8); let candidate = `${base}-copy`; let index = 2; while (existingNames.has(candidate.toLowerCase())) candidate = `${base}-copy-${index++}`.slice(0, maxLength); existingNames.add(candidate.toLowerCase()); return candidate; }
async function bufferFromUrl(url) { if (!url) return null; const response = await fetch(url); if (!response.ok) throw new Error(`Failed to fetch asset: ${response.status}`); return Buffer.from(await response.arrayBuffer()); }
function errorLabel(error) { return `${error?.code ? `Discord ${error.code}` : 'Error'}: ${error?.message || String(error)}`; }
function pushError(log, stage, error) { const message = `[${stage}] ${errorLabel(error)}`; log.errors.push(message); console.error(`[Duplicator] ${message}`, error); }
function hasBotPermission(guild, bit) { return Boolean(guild.members.me?.permissions?.has(bit)); }
function permissionNamesFromBits(value) { try { return new PermissionsBitField(BigInt(value || 0)).toArray(); } catch { return []; } }
function permissionGapNames(guild, value) { return permissionNamesFromBits(value).filter((name) => { const bit = PermissionFlagsBits[name]; return bit && !hasBotPermission(guild, bit); }); }
function copyablePermissionBits(guild, value) {
  let bits = 0n;
  for (const name of permissionNamesFromBits(value)) {
    const bit = PermissionFlagsBits[name];
    if (bit && hasBotPermission(guild, bit)) bits |= bit;
  }
  return bits;
}
function namesForBits(bits) { try { return new PermissionsBitField(BigInt(bits || 0)).toArray(); } catch { return []; } }
function addDeferred(log, entry) {
  log.deferredPermissions ||= [];
  const key = `${entry.scope}:${entry.sourceId || ''}:${entry.targetId || ''}:${entry.kind || ''}`;
  const existing = log.deferredPermissions.find((item) => item.key === key);
  const missingNames = [...new Set(entry.missing || [])].sort();
  if (existing) existing.missing = [...new Set([...(existing.missing || []), ...missingNames])].sort();
  else log.deferredPermissions.push({ key, ...entry, missing: missingNames });
}
function requestedOperationPermissions(snap) {
  const required = [...BASE_REQUIRED_PERMISSIONS];
  const options = new Set(snap.options || []);
  if (options.has('serverSettings')) required.push(['ManageGuild', PermissionFlagsBits.ManageGuild]);
  if (options.has('emojis')) required.push(['ManageEmojisAndStickers', PermissionFlagsBits.ManageEmojisAndStickers]);
  return required;
}
function missingOperationPermissions(guild, snap) { return requestedOperationPermissions(snap).filter(([, bit]) => !hasBotPermission(guild, bit)).map(([name]) => name); }
function transferCapabilityGaps(guild, snap) {
  const missing = new Set();
  for (const role of snap.roles || []) for (const name of permissionGapNames(guild, role.permissions)) missing.add(name);
  for (const channel of snap.channels || []) for (const overwrite of channel.permissionOverwrites || []) {
    for (const name of permissionGapNames(guild, overwrite.allow)) missing.add(name);
    for (const name of permissionGapNames(guild, overwrite.deny)) missing.add(name);
  }
  return [...missing].sort();
}
function recordCapabilityDeferrals(guild, snap, log) {
  for (const role of snap.roles || []) {
    const missing = permissionGapNames(guild, role.permissions);
    if (missing.length) addDeferred(log, { scope: 'role', sourceId: role.id, kind: 'base', missing });
  }
  for (const channel of snap.channels || []) {
    for (const overwrite of channel.permissionOverwrites || []) {
      const allowMissing = permissionGapNames(guild, overwrite.allow);
      const denyMissing = permissionGapNames(guild, overwrite.deny);
      if (allowMissing.length) addDeferred(log, { scope: 'overwrite', sourceId: channel.id, targetId: overwrite.id, kind: 'allow', missing: allowMissing });
      if (denyMissing.length) addDeferred(log, { scope: 'overwrite', sourceId: channel.id, targetId: overwrite.id, kind: 'deny', missing: denyMissing });
    }
  }
}
function referencedPermissionRoleIds(snap) {
  const ids = new Set();
  for (const channel of snap.channels || []) for (const overwrite of channel.permissionOverwrites || []) if (Number(overwrite.type) === 0 && overwrite.id !== snap.sourceGuild?.id) ids.add(String(overwrite.id));
  return ids;
}
function referencedPermissionMemberIds(snap) {
  const ids = new Set();
  for (const channel of snap.channels || []) for (const overwrite of channel.permissionOverwrites || []) if (Number(overwrite.type) === 1) ids.add(String(overwrite.id));
  return ids;
}
function resolveManagedRoleTarget(guild, snap, sourceRole) {
  const sourceBotId = sourceRole.tags?.botId || null;
  const destinationBotRoleIds = new Set(guild.members.me?.roles?.cache?.keys?.() || []);
  if (sourceRole.remapOnly) {
    const sameNameCustom = [...guild.roles.cache.values()].filter((role) => !role.managed && destinationBotRoleIds.has(role.id) && role.name.toLowerCase() === String(sourceRole.name || '').toLowerCase());
    if (sameNameCustom.length === 1) return sameNameCustom[0];
    const operatorRoles = [...guild.roles.cache.values()].filter((role) => !role.managed && destinationBotRoleIds.has(role.id) && /(^|\W)goliath($|\W)/i.test(String(role.name || '')));
    if (operatorRoles.length === 1) return operatorRoles[0];
  }
  const destinationManaged = [...guild.roles.cache.values()].filter((role) => role.managed);
  if (sourceBotId && sourceBotId === snap.sourceGuild?.botUserId) { const own = destinationManaged.find((role) => role.tags?.botId === guild.client.user?.id); if (own) return own; }
  if (sourceBotId) { const sameBot = destinationManaged.find((role) => role.tags?.botId === sourceBotId); if (sameBot) return sameBot; }
  const sameName = destinationManaged.filter((role) => role.name.toLowerCase() === String(sourceRole.name || '').toLowerCase());
  return sameName.length === 1 ? sameName[0] : null;
}
async function exactPermissionPreflight(guild, snap, conflictMode) {
  const issues = [];
  const operationMissing = missingOperationPermissions(guild, snap);
  if (operationMissing.length) issues.push('Goliath is missing required operation permissions: ' + operationMissing.join(', '));
  const roleRefs = referencedPermissionRoleIds(snap);
  const memberRefs = referencedPermissionMemberIds(snap);
  const sourceNormal = new Map((snap.roles || []).map((role) => [String(role.id), role]));
  const sourceManaged = new Map((snap.managedRoles || []).map((role) => [String(role.id), role]));
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  for (const sourceRole of snap.roles || []) {
    const sameName = sameNameRoles(guild, sourceRole.name);
    if (conflictMode === 'skip' && sameName.length > 1) issues.push('Role ' + sourceRole.name + ' has ' + sameName.length + ' same-name destination roles. Goliath refuses to guess or create another duplicate; resolve the duplicate roles first.');
    const found = sameName.length === 1 ? sameName[0] : null;
    if (found && conflictMode === 'skip' && found.permissions.bitfield !== BigInt(sourceRole.permissions || 0) && (!found.editable || found.position >= botHighest)) issues.push('Role ' + found.name + ' already exists but cannot be safely merged because it is at/above Goliath or otherwise not editable. Goliath refuses to create a duplicate role; move Goliath above it or align the existing role manually.');
  }
  for (const sourceId of roleRefs) {
    const managedSource = sourceManaged.get(sourceId);
    if (managedSource) {
      const target = resolveManagedRoleTarget(guild, snap, managedSource);
      if (!target) issues.push('Managed permission role ' + managedSource.name + ' has no matching bot/operator role in the destination.');
      else if (target.position >= botHighest) issues.push('Managed/operator permission role ' + target.name + ' is at/above Goliath. Exact overwrite reproduction is impossible while preserving hierarchy, so Goliath refuses the transfer instead of duplicating or moving the role.');
      continue;
    }
    const normalSource = sourceNormal.get(sourceId);
    if (!normalSource) { issues.push('Source permission role ' + sourceId + ' is not present in the role snapshot.'); continue; }
    const sameName = sameNameRoles(guild, normalSource.name);
    if (sameName.length > 1 && conflictMode === 'skip') { issues.push('Permission role ' + normalSource.name + ' has multiple same-name destination roles. Goliath refuses to guess or add another duplicate.'); continue; }
    const target = sameName.length === 1 ? sameName[0] : null;
    if (target && target.position >= botHighest) issues.push('Permission role ' + target.name + ' is at/above Goliath. Exact overwrite reproduction is impossible while preserving hierarchy, so Goliath refuses the transfer instead of duplicating or moving the role.');
  }
  for (const memberId of memberRefs) {
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
    if (!member) issues.push('Member-specific permission target ' + memberId + ' is not a member of the destination server.');
  }
  return [...new Set(issues)];
}
function hierarchyWarning(guild) { const highest = guild.members.me?.roles?.highest; return !highest || Number(highest.position || 0) <= 1 ? 'Goliath role is too low. Move it above roles it needs to create/manage.' : null; }
function runLog(session, snap) {
  return {
    status: session.dryRun ? 'dry-run' : 'running', dryRun: Boolean(session.dryRun), conflictMode: session.conflictMode,
    sourceGuildId: snap.sourceGuild?.id || null, destinationGuildId: session.destinationGuildId || null, rollbackBackupId: null,
    snapshotStats: snap.stats, copied: { serverSettings: 0, roles: 0, categories: 0, channels: 0, permissionOverwrites: 0, emojis: 0 },
    deleted: { roles: 0, channels: 0 }, skipped: [], errors: [], notes: [], deferredPermissions: [], verification: null,
  };
}
function dryRunPlan(guild, snap, conflictMode) {
  const plan = { create: { serverSettings: snap.settings ? 1 : 0, roles: 0, categories: 0, channels: 0, permissionOverwrites: 0, emojis: 0 }, rename: { roles: 0, categories: 0, channels: 0, emojis: 0 }, skip: { roles: 0, categories: 0, channels: 0, emojis: 0 }, delete: { roles: 0, channels: 0 } };
  for (const role of snap.roles || []) {
    const found = existingRole(guild, role.name);
    if (!found) plan.create.roles += 1;
    else if (conflictMode === 'skip') plan.skip.roles += 1;
    else if (conflictMode === 'rename') { plan.rename.roles += 1; plan.create.roles += 1; }
    else { plan.delete.roles += 1; plan.create.roles += 1; }
  }
  for (const channel of snap.channels || []) {
    const found = existingChannel(guild, channel);
    const key = channel.type === ChannelType.GuildCategory ? 'categories' : 'channels';
    if (!found) plan.create[key] += 1;
    else if (conflictMode === 'skip') plan.skip[key] += 1;
    else if (conflictMode === 'rename') { plan.rename[key] += 1; plan.create[key] += 1; }
    else { plan.delete.channels += 1; plan.create[key] += 1; }
  }
  plan.create.permissionOverwrites = (snap.channels || []).reduce((total, channel) => total + (channel.permissionOverwrites?.length || 0), 0);
  plan.create.emojis = (snap.emojis || []).length;
  return plan;
}
function applyDryRunPlan(log, plan) {
  log.copied = { ...log.copied, ...plan.create };
  log.deleted = { ...log.deleted, ...plan.delete };
  log.notes.push('Dry run only — no changes were made.');
}

async function clearDestination(guild, log) {
  for (const channel of [...guild.channels.cache.values()].sort((a, b) => b.position - a.position)) {
    try { await channel.delete('Goliath duplicator: replace destination'); log.deleted.channels += 1; } catch (error) { pushError(log, `Delete channel ${channel.name}`, error); }
  }
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  const roles = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed && r.editable && r.position < botHighest).sort((a, b) => b.position - a.position);
  for (const role of roles.values()) { try { await role.delete('Goliath duplicator: replace roles'); log.deleted.roles += 1; } catch (error) { pushError(log, `Delete role ${role.name}`, error); } }
}
async function applySettings(guild, snap, log) {
  if (!snap.settings) return;
  if (!hasBotPermission(guild, PermissionFlagsBits.ManageGuild)) { log.notes.push('Server settings skipped: Goliath lacks ManageGuild.'); return; }
  const s = snap.settings; const payload = {};
  if (s.name) payload.name = s.name;
  if (s.description !== undefined) payload.description = s.description || null;
  if (Number.isFinite(s.verificationLevel)) payload.verificationLevel = s.verificationLevel;
  if (Number.isFinite(s.explicitContentFilter)) payload.explicitContentFilter = s.explicitContentFilter;
  if (Number.isFinite(s.defaultMessageNotifications)) payload.defaultMessageNotifications = s.defaultMessageNotifications;
  if (Number.isFinite(s.afkTimeout)) payload.afkTimeout = s.afkTimeout;
  if (s.iconURL) payload.icon = await bufferFromUrl(s.iconURL).catch(() => null);
  if (s.bannerURL) payload.banner = await bufferFromUrl(s.bannerURL).catch(() => null);
  if (s.splashURL) payload.splash = await bufferFromUrl(s.splashURL).catch(() => null);
  if (Object.keys(payload).length) { await guild.edit(payload, 'Goliath duplicator: settings'); log.copied.serverSettings = Object.keys(payload).length; }
}
async function applyManagedRoleMappings(guild, snap, maps, log) {
  for (const sourceRole of snap.managedRoles || []) {
    const target = resolveManagedRoleTarget(guild, snap, sourceRole);
    if (target) { maps.roles.set(sourceRole.id, target.id); log.notes.push('Managed/operator role remapped: ' + sourceRole.name + ' -> ' + target.name + '.'); }
    else log.notes.push('Managed/operator role not transferable: ' + sourceRole.name + '. Matching bot/operator role is absent from destination.');
  }
}
async function applyRoles(guild, snap, maps, log, conflictMode) {
  const names = new Set(guild.roles.cache.map((r) => r.name.toLowerCase()));
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  if (!hasBotPermission(guild, PermissionFlagsBits.ManageRoles)) { log.errors.push('Cannot create/map normal roles: Goliath lacks ManageRoles.'); return; }
  for (const role of [...(snap.roles || [])].sort((a, b) => a.position - b.position)) {
    let staged = null;
    try {
      const sourceRequested = BigInt(role.permissions || 0);
      const found = existingRole(guild, role.name);
      let requested = sourceRequested;
      const deferRoleFallback = () => {
        const missing = permissionGapNames(guild, sourceRequested);
        if (missing.length) addDeferred(log, { scope: 'role', sourceId: role.id, targetId: found?.id || staged?.id || null, kind: 'base', missing });
        requested = copyablePermissionBits(guild, sourceRequested);
        return requested;
      };
      if (found && conflictMode === 'skip') {
        let verified = await guild.roles.fetch(found.id).catch(() => found);
        const originalPosition = verified.position;
        const neededMerge = verified.permissions.bitfield !== requested;
        if (neededMerge) {
          if (!verified.editable || verified.position >= botHighest) throw new Error('Existing role ' + role.name + ' cannot be repaired to exact permissions because it is at/above Goliath.');
          try {
            await verified.setPermissions(requested, 'Goliath duplicator: exact role permission repair');
          } catch (error) {
            if (Number(error?.code) !== 50013) throw error;
            deferRoleFallback();
            await verified.setPermissions(requested, 'Goliath duplicator: permission-safe role permission fallback');
          }
          verified = await guild.roles.fetch(found.id).catch(() => null);
        }
        if (!verified || verified.permissions.bitfield !== requested) throw new Error('Existing role permission verification mismatch for ' + role.name);
        maps.roles.set(role.id, verified.id);
        if (neededMerge) log.notes.push('Merged source role into existing destination role without creating a duplicate: ' + role.name + '. Destination hierarchy position preserved at ' + originalPosition + '.');
        else log.skipped.push('Role exists and already matches exactly; reused without duplication: ' + role.name);
        continue;
      }
      if (found && conflictMode === 'replace') {
        if (found.editable && found.position < botHighest) { await found.delete('Goliath duplicator: replace role'); log.deleted.roles += 1; }
        else throw new Error('Role ' + role.name + ' cannot be replaced because it is not editable below Goliath.');
      }
      const name = found && conflictMode === 'rename' ? uniqueName(names, role.name, 100) : role.name;
      try {
        staged = await guild.roles.create({ name, color: Number(role.color || 0), hoist: Boolean(role.hoist), mentionable: Boolean(role.mentionable), permissions: requested, reason: 'Goliath duplicator: exact role copy' });
      } catch (error) {
        if (Number(error?.code) !== 50013) throw error;
        deferRoleFallback();
        staged = await guild.roles.create({ name, color: Number(role.color || 0), hoist: Boolean(role.hoist), mentionable: Boolean(role.mentionable), permissions: 0n, reason: 'Goliath duplicator: stage role before permission-safe fallback' });
        try { await staged.setPermissions(requested, 'Goliath duplicator: apply permission-safe role fallback'); } catch (setError) { await staged.delete('Goliath duplicator: remove incomplete staged role').catch(() => null); staged = null; throw setError; }
      }
      let verified = staged ? await guild.roles.fetch(staged.id).catch(() => null) : null;
      if (!verified || verified.guild.id !== guild.id) throw new Error('Role create verification failed for ' + role.name);
      if (verified.permissions.bitfield !== requested) { await verified.setPermissions(requested, 'Goliath duplicator: transferable permission verification repair'); verified = await guild.roles.fetch(verified.id).catch(() => null); }
      if (!verified || verified.permissions.bitfield !== requested) { await verified?.delete('Goliath duplicator: remove role with mismatched permissions').catch(() => null); throw new Error('Role permission verification mismatch for ' + role.name); }
      maps.roles.set(role.id, verified.id); maps.createdRoles.add(verified.id); maps.rolePositions.set(verified.id, Number(role.position || 0)); names.add(verified.name.toLowerCase());
    } catch (error) { pushError(log, 'Role ' + role.name, error); log.skipped.push('Role failed: ' + role.name); }
  }
  for (const [roleId, position] of maps.rolePositions.entries()) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null); if (!role) continue;
    try { await role.setPosition(Math.min(Math.max(1, position), Math.max(1, botHighest - 1)), 'Goliath duplicator: role order'); } catch (error) { log.notes.push('Role order not fully restored for ' + role.name + ': ' + error.message); }
  }
}
function channelPayload(guild, channel, parentId = null, name = null) {
  const type = duplicatorCreateChannelType(guild, channel.type);
  const payload = { name: name || channel.name, type, reason: 'Goliath duplicator: channel' };
  if (parentId) payload.parent = parentId;
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) { payload.topic = channel.topic || undefined; payload.nsfw = Boolean(channel.nsfw); payload.rateLimitPerUser = channel.rateLimitPerUser || 0; }
  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(type)) { payload.bitrate = channel.bitrate || undefined; payload.userLimit = channel.userLimit || 0; payload.rtcRegion = channel.rtcRegion || undefined; payload.videoQualityMode = channel.videoQualityMode || undefined; }
  if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) { payload.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration || undefined; payload.defaultThreadRateLimitPerUser = channel.defaultThreadRateLimitPerUser || 0; if (channel.availableTags?.length) payload.availableTags = channel.availableTags; }
  return payload;
}
async function applyChannels(guild, snap, maps, log, conflictMode) {
  if (!hasBotPermission(guild, PermissionFlagsBits.ManageChannels)) { log.errors.push('Cannot create channels/categories: Goliath lacks ManageChannels.'); return; }
  const names = new Set(guild.channels.cache.map((c) => c.name.toLowerCase()));
  const categories = (snap.channels || []).filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const channels = (snap.channels || []).filter((c) => c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const category of categories) {
    try {
      const found = existingChannel(guild, category, null);
      if (found && conflictMode === 'skip') { maps.channels.set(category.id, found.id); log.skipped.push(`Category exists/reused: ${category.name}`); continue; }
      if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace category'); log.deleted.channels += 1; }
      const name = found && conflictMode === 'rename' ? uniqueName(names, category.name, 100) : category.name;
      const created = await guild.channels.create(channelPayload(guild, category, null, name));
      const verified = await guild.channels.fetch(created.id).catch(() => null);
      if (!verified || verified.guild.id !== guild.id) throw new Error(`Category create verification failed for ${category.name}`);
      maps.channels.set(category.id, verified.id); maps.createdCategories.add(verified.id); maps.channelPositions.set(verified.id, Number(category.position || 0)); names.add(verified.name.toLowerCase());
    } catch (error) { pushError(log, `Category ${category.name}`, error); }
  }
  for (const channel of channels) {
    try {
      const parentId = channel.parentId ? maps.channels.get(channel.parentId) || null : null;
      const found = existingChannel(guild, channel, parentId);
      if (found && conflictMode === 'skip') { maps.channels.set(channel.id, found.id); log.skipped.push(`Channel exists/reused: ${channel.name}`); continue; }
      if (found && conflictMode === 'replace' && found.deletable) { await found.delete('Goliath duplicator: replace channel'); log.deleted.channels += 1; }
      const name = found && conflictMode === 'rename' ? uniqueName(names, channel.name, 100) : channel.name;
      const created = await guild.channels.create(channelPayload(guild, channel, parentId, name));
      const verified = await guild.channels.fetch(created.id).catch(() => null);
      if (!verified || verified.guild.id !== guild.id) throw new Error(`Channel create verification failed for ${channel.name}`);
      maps.channels.set(channel.id, verified.id); maps.createdChannels.add(verified.id); maps.channelPositions.set(verified.id, Number(channel.position || 0)); names.add(verified.name.toLowerCase());
    } catch (error) { pushError(log, `Channel ${channel.name}`, error); }
  }
}
async function buildExactOverwrites(guild, snap, sourceChannel, maps, log, permissionSafeFallback = false) {
  const overwrites = [];
  const botHighest = guild.members.me?.roles?.highest?.position ?? 0;
  for (const overwrite of sourceChannel.permissionOverwrites || []) {
    const type = Number(overwrite.type);
    let mappedId = null;
    if (overwrite.id === snap.sourceGuild?.id) mappedId = guild.id;
    else if (type === 0) mappedId = maps.roles.get(overwrite.id);
    else if (type === 1) { const member = guild.members.cache.get(overwrite.id) || await guild.members.fetch(overwrite.id).catch(() => null); if (member) mappedId = member.id; }
    if (!mappedId) throw new Error('Permission target ' + overwrite.id + ' on ' + sourceChannel.name + ' is not mapped/present in the destination.');
    if (type === 0 && mappedId !== guild.id) {
      const targetRole = guild.roles.cache.get(mappedId) || await guild.roles.fetch(mappedId).catch(() => null);
      if (!targetRole) throw new Error('Permission role ' + mappedId + ' on ' + sourceChannel.name + ' is missing in the destination.');
      if (targetRole.position >= botHighest) throw new Error('Permission role ' + targetRole.name + ' on ' + sourceChannel.name + ' is at/above Goliath hierarchy.');
    }
    if (permissionSafeFallback) {
      const allowMissing = permissionGapNames(guild, overwrite.allow);
      const denyMissing = permissionGapNames(guild, overwrite.deny);
      if (allowMissing.length) addDeferred(log, { scope: 'overwrite', sourceId: sourceChannel.id, targetId: overwrite.id, kind: 'allow', missing: allowMissing });
      if (denyMissing.length) addDeferred(log, { scope: 'overwrite', sourceId: sourceChannel.id, targetId: overwrite.id, kind: 'deny', missing: denyMissing });
    }
    overwrites.push({
      id: mappedId,
      type,
      allow: permissionSafeFallback ? copyablePermissionBits(guild, overwrite.allow) : BigInt(overwrite.allow || 0),
      deny: permissionSafeFallback ? copyablePermissionBits(guild, overwrite.deny) : BigInt(overwrite.deny || 0),
    });
  }
  return overwrites;
}
async function verifyOverwrites(channel, expected, sourceChannelName) {
  const refreshed = await channel.guild.channels.fetch(channel.id).catch(() => null);
  if (!refreshed) throw new Error('Permission verification failed for ' + sourceChannelName);
  const expectedIds = new Set(expected.map((item) => String(item.id)));
  const actualIds = new Set(refreshed.permissionOverwrites.cache.map((item) => String(item.id)));
  if (actualIds.size !== expectedIds.size || [...actualIds].some((id) => !expectedIds.has(id))) throw new Error('Permission overwrite set mismatch after copy on ' + sourceChannelName + ': expected ' + expectedIds.size + ', found ' + actualIds.size + '.');
  let verifiedCount = 0;
  for (const item of expected) {
    const actual = refreshed.permissionOverwrites.cache.get(item.id);
    if (!actual) throw new Error('Permission overwrite missing after copy on ' + sourceChannelName + ': ' + item.id);
    if (actual.allow.bitfield !== BigInt(item.allow) || actual.deny.bitfield !== BigInt(item.deny)) throw new Error('Permission overwrite mismatch after copy on ' + sourceChannelName + ': ' + item.id);
    verifiedCount += 1;
  }
  return verifiedCount;
}
async function applyPermissions(guild, snap, maps, log) {
  if (!hasBotPermission(guild, PermissionFlagsBits.ManageRoles)) { log.errors.push('Channel/category overwrites cannot be copied: Goliath lacks ManageRoles.'); return; }
  for (const sourceChannel of snap.channels || []) {
    try {
      const targetId = maps.channels.get(sourceChannel.id); if (!targetId) throw new Error('Destination channel mapping is missing for ' + sourceChannel.name + '.');
      const channel = guild.channels.cache.get(targetId) || await guild.channels.fetch(targetId).catch(() => null);
      if (!channel?.permissionOverwrites?.set) throw new Error('Destination channel ' + targetId + ' cannot accept permission overwrites.');
      let overwrites = await buildExactOverwrites(guild, snap, sourceChannel, maps, log, false);
      try {
        await channel.permissionOverwrites.set(overwrites, 'Goliath duplicator: exact channel/category permissions');
      } catch (error) {
        if (Number(error?.code) !== 50013) throw error;
        overwrites = await buildExactOverwrites(guild, snap, sourceChannel, maps, log, true);
        await channel.permissionOverwrites.set(overwrites, 'Goliath duplicator: permission-safe channel/category fallback');
        log.notes.push('Discord rejected one or more exact overwrite permission bits on ' + sourceChannel.name + '; only those rejected capabilities were deferred.');
      }
      log.copied.permissionOverwrites += await verifyOverwrites(channel, overwrites, sourceChannel.name);
    } catch (error) { pushError(log, 'Permissions ' + sourceChannel.name, error); }
  }
}
async function applyEmojis(guild, snap, maps, log, conflictMode) {
  if (!(snap.emojis || []).length) return;
  if (!hasBotPermission(guild, PermissionFlagsBits.ManageEmojisAndStickers)) { log.notes.push('Emojis skipped: Goliath lacks ManageEmojisAndStickers.'); return; }
  const names = new Set(guild.emojis.cache.map((e) => e.name.toLowerCase()));
  for (const emoji of snap.emojis || []) {
    try {
      if (!emoji.url || !emoji.name) continue;
      if (names.has(emoji.name.toLowerCase()) && conflictMode === 'skip') continue;
      const name = names.has(emoji.name.toLowerCase()) && conflictMode === 'rename' ? uniqueName(names, emoji.name, 32).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32) : emoji.name;
      const created = await guild.emojis.create({ attachment: emoji.url, name, reason: 'Goliath duplicator: emoji' });
      const verified = await guild.emojis.fetch(created.id).catch(() => null); if (!verified) throw new Error(`Emoji create verification failed for ${emoji.name}`);
      maps.createdEmojis.add(verified.id); names.add(verified.name.toLowerCase());
    } catch (error) { pushError(log, `Emoji ${emoji.name}`, error); }
  }
}
async function verifyCopyResult(guild, snap, maps, log) {
  await fetchGuildState(guild);
  if (String(guild.id) !== String(log.destinationGuildId)) throw new Error('Destination verification mismatch: expected ' + log.destinationGuildId + ', got ' + guild.id);
  const roleIds = [...maps.createdRoles], categoryIds = [...maps.createdCategories], channelIds = [...maps.createdChannels], emojiIds = [...maps.createdEmojis];
  const verifiedRoles = roleIds.filter((id) => guild.roles.cache.has(id));
  const verifiedCategories = categoryIds.filter((id) => guild.channels.cache.has(id));
  const verifiedChannels = channelIds.filter((id) => guild.channels.cache.has(id));
  const verifiedEmojis = emojiIds.filter((id) => guild.emojis.cache.has(id));
  log.copied.roles = verifiedRoles.length; log.copied.categories = verifiedCategories.length; log.copied.channels = verifiedChannels.length; log.copied.emojis = verifiedEmojis.length;
  const referencedManaged = referencedPermissionRoleIds(snap);
  const expectedRoleSources = [...(snap.roles || []), ...(snap.managedRoles || []).filter((role) => referencedManaged.has(String(role.id)))];
  const missingRoleMappings = expectedRoleSources.filter((role) => { const targetId = maps.roles.get(role.id); return !targetId || !guild.roles.cache.has(targetId); });
  const missingStructure = (snap.channels || []).filter((source) => { const targetId = maps.channels.get(source.id); return !targetId || !guild.channels.cache.has(targetId); });
  const permissionExpected = (snap.channels || []).reduce((sum, channel) => sum + (channel.permissionOverwrites || []).length, 0);
  log.verification = { destinationGuildId: guild.id, destinationGuildName: guild.name, rolesCreated: verifiedRoles.length, categoriesCreated: verifiedCategories.length, channelsCreated: verifiedChannels.length, emojisCreated: verifiedEmojis.length, roleMappingsExpected: expectedRoleSources.length, roleMappingsVerified: expectedRoleSources.length - missingRoleMappings.length, structureExpected: (snap.channels || []).length, structureMapped: (snap.channels || []).length - missingStructure.length, permissionOverwritesExpected: permissionExpected, permissionOverwritesVerified: log.copied.permissionOverwrites, deferredPermissions: log.deferredPermissions.length };
  if (verifiedRoles.length !== roleIds.length) log.errors.push('Post-copy verification: ' + (roleIds.length - verifiedRoles.length) + ' created role(s) missing.');
  if (verifiedCategories.length !== categoryIds.length) log.errors.push('Post-copy verification: ' + (categoryIds.length - verifiedCategories.length) + ' created category(s) missing.');
  if (verifiedChannels.length !== channelIds.length) log.errors.push('Post-copy verification: ' + (channelIds.length - verifiedChannels.length) + ' created channel(s) missing.');
  if (missingRoleMappings.length) log.errors.push('Role mapping verification failed for: ' + missingRoleMappings.slice(0, 10).map((role) => role.name).join(', ') + (missingRoleMappings.length > 10 ? ' …' : ''));
  if (missingStructure.length) log.errors.push('Structure mapping verification failed for: ' + missingStructure.slice(0, 10).map((channel) => channel.name).join(', ') + (missingStructure.length > 10 ? ' …' : ''));
  if (log.copied.permissionOverwrites !== permissionExpected) log.errors.push('Permission verification incomplete: ' + log.copied.permissionOverwrites + '/' + permissionExpected + ' overwrites verified exactly.');
}
function resultEmbed(title, guild, log) {
  const deferredNames = [...new Set((log.deferredPermissions || []).flatMap((item) => item.missing || []))].sort();
  return embed(title, [
    `**Destination:** ${guild.name} (${guild.id || log.destinationGuildId})`,
    `**Source ID:** \`${log.sourceGuildId || 'unknown'}\``,
    `**Status:** \`${log.status}\``,
    `**Conflict:** \`${log.conflictMode}\``,
    `**Rollback:** \`${log.rollbackBackupId || (log.dryRun ? 'dry-run' : 'none')}\``,
    '',
    `Verified: Settings \`${log.copied.serverSettings}\` • Roles \`${log.copied.roles}\` • Categories \`${log.copied.categories}\` • Channels \`${log.copied.channels}\` • Permissions \`${log.copied.permissionOverwrites}\` • Emojis \`${log.copied.emojis}\``,
    deferredNames.length ? `Deferred permission bits (${deferredNames.length}): ${deferredNames.join(', ')}` : '',
    log.notes.length ? `Notes:\n${log.notes.slice(0, 8).map((i) => `• ${i}`).join('\n')}` : '',
    log.errors.length ? `Warnings/Errors:\n${log.errors.slice(0, 8).map((e) => `⚠️ ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n'), log.errors.length || deferredNames.length ? 0xf59e0b : 0x22c55e);
}
async function executeStage(name, log, fn) { console.log(`[Duplicator] Stage start: ${name}`); try { await fn(); console.log(`[Duplicator] Stage complete: ${name}`); } catch (error) { pushError(log, name, error); } }
async function executeSnapshotOnGuild(guild, session, snap, title, actorId = 'bridge') {
  await fetchGuildState(guild);
  await guild.members.fetch().catch(() => null);
  const log = runLog(session, snap);
  const capabilityGaps = transferCapabilityGaps(guild, snap);
  if (capabilityGaps.length) log.notes.push('Potential destination capability gaps: ' + capabilityGaps.join(', ') + '. Goliath will attempt the exact copy first and defer a bit only if Discord rejects it.');
  const preflightIssues = await exactPermissionPreflight(guild, snap, session.conflictMode);
  const hierarchy = hierarchyWarning(guild); if (hierarchy) preflightIssues.push(hierarchy);
  for (const [key, item] of Object.entries(snap.future || {})) if (item?.requested && !item.supported) log.notes.push((COPY_OPTIONS[key] || key) + ": " + item.reason);
  if (session.dryRun) {
    applyDryRunPlan(log, dryRunPlan(guild, snap, session.conflictMode));
    if (preflightIssues.length) log.errors.push(...preflightIssues.map((issue) => '[Preflight] ' + issue));
    log.status = preflightIssues.length ? 'dry-run-blocked' : 'dry-run';
    return log;
  }
  if (preflightIssues.length) {
    log.errors.push(...preflightIssues.map((issue) => '[Preflight] ' + issue));
    log.status = 'blocked-preflight';
    return log;
  }
  try { const rollback = await createServerBackup(guild, { createdBy: 'duplicator:' + actorId, requestedBy: actorId, reason: 'Rollback before ' + title, type: 'rollback' }); log.rollbackBackupId = rollback.backupId; } catch (error) { pushError(log, 'Rollback backup', error); }
  if (session.conflictMode === 'replace' && hasBotPermission(guild, PermissionFlagsBits.ManageChannels) && hasBotPermission(guild, PermissionFlagsBits.ManageRoles)) await executeStage('Replace destination', log, async () => { await clearDestination(guild, log); await fetchGuildState(guild); });
  if (String(guild.id) !== String(session.destinationGuildId)) throw new Error('Destination mismatch before copy: expected ' + session.destinationGuildId + ', got ' + guild.id);
  const maps = { roles: new Map([[snap.sourceGuild?.id, guild.id]]), channels: new Map(), createdRoles: new Set(), createdCategories: new Set(), createdChannels: new Set(), createdEmojis: new Set(), rolePositions: new Map(), channelPositions: new Map() };
  await executeStage('Server settings', log, () => applySettings(guild, snap, log));
  await executeStage('Managed role remap', log, () => applyManagedRoleMappings(guild, snap, maps, log));
  await executeStage('Roles', log, () => applyRoles(guild, snap, maps, log, session.conflictMode));
  await executeStage('Channels', log, () => applyChannels(guild, snap, maps, log, session.conflictMode));
  await executeStage('Permissions', log, () => applyPermissions(guild, snap, maps, log));
  await executeStage('Emojis', log, () => applyEmojis(guild, snap, maps, log, session.conflictMode));
  await executeStage('Verify destination', log, () => verifyCopyResult(guild, snap, maps, log));
  log.transferObjects = { createdRoleIds: [...maps.createdRoles], createdCategoryIds: [...maps.createdCategories], createdChannelIds: [...maps.createdChannels], createdEmojiIds: [...maps.createdEmojis], roleMap: Object.fromEntries(maps.roles), channelMap: Object.fromEntries(maps.channels) };
  if (log.errors.length) log.status = log.copied.categories + log.copied.channels + log.copied.roles + log.copied.permissionOverwrites > 0 ? 'partial' : 'failed';
  else if (log.deferredPermissions.length) log.status = 'partial';
  else log.status = 'success';
  return log;
}

async function snapshotForGuild(client, guildId, selectedOptions, session = null) {
  const route = await resolveGuildRoute(client, guildId, session); if (!route) throw new Error('Source server is unavailable to every Goliath environment.');
  if (route.local) { const result = await fetchGuildById(client, guildId); if (!result.guild) throw new Error('Source server is unavailable.'); await fetchGuildState(result.guild); return snapshot(result.guild, selectedOptions); }
  const response = await bridgeRequest(route.environment, 'POST', '/snapshot', { guildId, selectedOptions }, 10000); return response.snapshot;
}
async function executeSnapshot(interaction, session, snap, title) {
  const route = await resolveGuildRoute(interaction.client, session.destinationGuildId, session); if (!route) throw new Error('Destination server is unavailable to every Goliath environment.');
  let guildInfo, log;
  if (route.local) {
    const result = await fetchGuildById(interaction.client, session.destinationGuildId); if (!result.guild) throw new Error('Destination server is unavailable.');
    guildInfo = { id: result.guild.id, name: result.guild.name };
    log = await executeSnapshotOnGuild(result.guild, session, snap, title, interaction.user.id);
  } else {
    const response = await bridgeRequest(route.environment, 'POST', '/apply', { guildId: session.destinationGuildId, session: { dryRun: session.dryRun, conflictMode: session.conflictMode, destinationGuildId: session.destinationGuildId }, snapshot: snap, title, actorId: interaction.user.id }, 120000);
    guildInfo = response.guild; log = response.log;
  }
  if (String(log.status || '').startsWith('dry-run')) { session.lastDryRun = { guildInfo, log }; session.expiresAt = Date.now() + SESSION_TTL_MS; }
  return log;
}

async function inspectUndoObjects(guild, payload = {}) {
  await fetchGuildState(guild);
  await guild.members.fetch().catch(() => null);
  const channelIds = [...new Set([...(payload.createdChannelIds || []), ...(payload.createdCategoryIds || [])].map(String))];
  const roleIds = [...new Set((payload.createdRoleIds || []).map(String))];
  const channelSet = new Set(channelIds);
  const channels = [];
  for (const id of channelIds) {
    const channel = guild.channels.cache.get(id) || null;
    channels.push(channel
      ? { id, name: channel.name, type: channel.type, state: channel.deletable === false ? 'unsafe' : 'present', reason: channel.deletable === false ? 'Channel is not deletable.' : null }
      : { id, name: null, type: null, state: 'missing', reason: 'Already missing.' });
  }
  const roles = [];
  for (const id of roleIds) {
    const role = guild.roles.cache.get(id) || null;
    if (!role) { roles.push({ id, name: null, state: 'missing', reason: 'Already missing.' }); continue; }
    let reason = null;
    if (role.managed || !role.editable) reason = 'Role is managed or not editable.';
    else if (role.members?.size) reason = `Role is assigned to ${role.members.size} member(s).`;
    else {
      const externalUse = [...guild.channels.cache.values()].find((channel) => !channelSet.has(channel.id) && channel.permissionOverwrites?.cache?.has?.(id));
      if (externalUse) reason = `Role is used by #${externalUse.name} outside this transfer.`;
    }
    roles.push({ id, name: role.name, state: reason ? 'unsafe' : 'present', reason });
  }
  const all = [...channels, ...roles];
  return {
    guild: { id: guild.id, name: guild.name }, channels, roles,
    counts: {
      total: all.length,
      present: all.filter((item) => item.state === 'present').length,
      missing: all.filter((item) => item.state === 'missing').length,
      unsafe: all.filter((item) => item.state === 'unsafe').length,
    },
  };
}

async function applyUndoObjects(guild, payload = {}, actorId = 'bridge') {
  const before = await inspectUndoObjects(guild, payload);
  const channelIds = new Set(before.channels.filter((item) => item.state === 'present').map((item) => item.id));
  const channels = [...guild.channels.cache.values()].filter((channel) => channelIds.has(channel.id));
  const ordered = [
    ...channels.filter((channel) => channel.type !== ChannelType.GuildCategory).sort((a, b) => b.position - a.position),
    ...channels.filter((channel) => channel.type === ChannelType.GuildCategory).sort((a, b) => b.position - a.position),
  ];
  const deletedChannels = [], failedChannels = [];
  for (const channel of ordered) {
    try {
      const id = channel.id, name = channel.name;
      await channel.delete(`Goliath Duplicator undo by ${actorId}`);
      const stillThere = await guild.channels.fetch(id).catch(() => null);
      if (stillThere) throw new Error('Post-delete verification found the channel still present.');
      deletedChannels.push({ id, name, type: channel.type });
    } catch (error) { failedChannels.push({ id: channel.id, name: channel.name, error: error.message || String(error) }); }
  }
  await fetchGuildState(guild);
  await guild.members.fetch().catch(() => null);
  const roleIds = new Set((payload.createdRoleIds || []).map(String));
  const deletedRoles = [], failedRoles = [], skippedRoles = [];
  for (const id of roleIds) {
    const role = guild.roles.cache.get(id) || null;
    if (!role) { skippedRoles.push({ id, state: 'missing', reason: 'Already missing.' }); continue; }
    let reason = null;
    if (role.managed || !role.editable) reason = 'Role is managed or not editable.';
    else if (role.members?.size) reason = `Role is assigned to ${role.members.size} member(s).`;
    else {
      const externalUse = [...guild.channels.cache.values()].find((channel) => channel.permissionOverwrites?.cache?.has?.(id));
      if (externalUse) reason = `Role is still used by #${externalUse.name}.`;
    }
    if (reason) { skippedRoles.push({ id, name: role.name, state: 'unsafe', reason }); continue; }
    try {
      const name = role.name;
      await role.delete(`Goliath Duplicator undo by ${actorId}`);
      const stillThere = await guild.roles.fetch(id).catch(() => null);
      if (stillThere) throw new Error('Post-delete verification found the role still present.');
      deletedRoles.push({ id, name });
    } catch (error) { failedRoles.push({ id, name: role.name, error: error.message || String(error) }); }
  }
  const failed = [...failedChannels, ...failedRoles];
  const removed = deletedChannels.length + deletedRoles.length;
  const requested = before.counts.total;
  const remainingUnsafe = skippedRoles.filter((item) => item.state === 'unsafe').length + before.channels.filter((item) => item.state === 'unsafe').length;
  const outcome = failed.length ? (removed ? 'partial' : 'failed') : remainingUnsafe ? (removed ? 'partial' : 'failed') : removed ? 'undone' : 'no-changes';
  return { before, requested, removed, outcome, deletedChannels, deletedRoles, failedChannels, failedRoles, skippedRoles };
}

async function readBridgeBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
function bridgeAuthorized(req) { const configured = bridgeSecret(); return !configured || req.headers['x-goliath-duplicator-secret'] === configured; }
function bridgeJson(res, status, value) { const body = Buffer.from(JSON.stringify(value)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(body.length) }); res.end(body); }
function initializeBridge(client) {
  bridgeClient = client;
  if (bridgeServer) return bridgeServer;
  if (bridgeUnavailable) return null;
  const port = Number(process.env.BOT_API_PORT || bridgePort(mode()));
  bridgeServer = http.createServer(async (req, res) => {
    try {
      if (!bridgeAuthorized(req)) return bridgeJson(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET' && req.url === '/guilds') return bridgeJson(res, 200, { environment: mode(), guilds: localGuildDirectory(bridgeClient) });
      if (req.method === 'POST' && req.url === '/snapshot') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); await fetchGuildState(result.guild); return bridgeJson(res, 200, { snapshot: snapshot(result.guild, body.selectedOptions || [...ACTIVE_OPTIONS]) }); }
      if (req.method === 'POST' && req.url === '/undo-inspect') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); return bridgeJson(res, 200, await inspectUndoObjects(result.guild, body.objects || {})); }
      if (req.method === 'POST' && req.url === '/undo-apply') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); return bridgeJson(res, 200, await applyUndoObjects(result.guild, body.objects || {}, body.actorId || 'bridge')); }
      if (req.method === 'POST' && req.url === '/apply') { const body = await readBridgeBody(req); const result = await fetchGuildById(bridgeClient, body.guildId); if (!result.guild) return bridgeJson(res, 404, { error: 'Guild unavailable' }); const bridgeSession = { dryRun: true, conflictMode: 'skip', ...(body.session || {}), destinationGuildId: body.guildId }; const log = await executeSnapshotOnGuild(result.guild, bridgeSession, body.snapshot, body.title || 'Copy', body.actorId || 'bridge'); return bridgeJson(res, 200, { guild: { id: result.guild.id, name: result.guild.name }, log }); }
      return bridgeJson(res, 404, { error: 'Not found' });
    } catch (error) { console.error('[Duplicator Bridge]', error); return bridgeJson(res, 500, { error: error.message || String(error) }); }
  });
  bridgeServer.on('error', (error) => {
    bridgeServer = null;
    bridgeUnavailable = true;
    if (error?.code === 'EADDRINUSE') {
      void bridgeRequestAtPort(mode(), port, 'GET', '/guilds', null, 1500)
        .then((response) => {
          if (String(response?.environment || '').toUpperCase() === mode()) {
            resolvedBridgePorts.set(mode(), port);
            console.log(`[Duplicator] ${mode()} bridge already active on ${BRIDGE_HOST}:${port}; reusing the existing endpoint.`);
          } else {
            console.warn(`[Duplicator] Bridge port ${BRIDGE_HOST}:${port} is occupied by another process; local bridge disabled for this process.`);
          }
        })
        .catch(() => console.warn(`[Duplicator] Bridge port ${BRIDGE_HOST}:${port} is occupied by another process; local bridge disabled for this process.`));
      return;
    }
    console.error(`[Duplicator] Bridge failed on ${BRIDGE_HOST}:${port}:`, error?.message || error);
  });
  bridgeServer.listen(port, BRIDGE_HOST, () => console.log(`[Duplicator] ${mode()} bridge listening on ${BRIDGE_HOST}:${port}`));
  bridgeServer.unref?.();
  return bridgeServer;
}

function conflictChoices(selected = 'skip') { return Object.entries(CONFLICT_MODES).map(([value, label]) => ({ label, value, default: selected === value })); }
function copyOptionChoices(selectedOptions = []) { const selected = new Set(selectedOptions); return Object.entries(COPY_OPTIONS).map(([value, label]) => ({ label, value, default: selected.has(value) })); }
async function copyPanel(interaction, session) {
  if (!session.guildDirectory?.length) await refreshSessionDirectory(interaction.client, session);
  const unavailable = Object.entries(session.bridgeStatus || {}).filter(([, state]) => !state?.ok).map(([environment]) => environment);
  const directoryNote = unavailable.length ? 'Visible servers: **' + session.guildDirectory.length + '**. Bridge unavailable: **' + unavailable.join(', ') + '** — use **Refresh Guilds** after those bot environments are online.' : 'Visible servers across Goliath environments: **' + session.guildDirectory.length + '**.';
  const description = ['Source: ' + guildDisplay(session, interaction.client, session.sourceGuildId), 'Destination: ' + guildDisplay(session, interaction.client, session.destinationGuildId), 'Conflict: ' + session.conflictMode, 'Dry run: **' + (session.dryRun ? 'ON' : 'OFF') + '**', '', directoryNote, '', 'Safety preflight blocks only structural/operation failures. Permission bits Goliath cannot grant on the destination are deferred, the rest of the transfer continues, and every deferred bit is recorded.'].join('\n');
  return { embeds: [embed('🛠️ Server Duplicator — Copy', description)], components: [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'source')).setPlaceholder('Source server').addOptions(guildChoices(session, session.sourceGuildId))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(session, session.destinationGuildId))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'options')).setPlaceholder('What to copy').setMinValues(1).setMaxValues(Object.keys(COPY_OPTIONS).length).addOptions(copyOptionChoices(session.selectedOptions))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'conflict')).setPlaceholder('Conflict mode').addOptions(conflictChoices(session.conflictMode))),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'start')).setLabel('Start Copy').setStyle(ButtonStyle.Success).setDisabled(!session.sourceGuildId || !session.destinationGuildId || session.sourceGuildId === session.destinationGuildId),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'refresh')).setLabel('Refresh Guilds').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'dryrun')).setLabel('Dry Run: ' + (session.dryRun ? 'ON' : 'OFF')).setStyle(session.dryRun ? ButtonStyle.Primary : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(componentId(COPY_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ], flags: MessageFlags.Ephemeral };
}
async function analysePanel(interaction, session) {
  if (!session.guildDirectory?.length) await refreshSessionDirectory(interaction.client, session);
  const unavailable = Object.entries(session.bridgeStatus || {}).filter(([, state]) => !state?.ok).map(([environment]) => environment);
  const directoryNote = unavailable.length ? 'Visible servers: **' + session.guildDirectory.length + '**. Bridge unavailable: **' + unavailable.join(', ') + '**.' : 'Visible servers across Goliath environments: **' + session.guildDirectory.length + '**.';
  return { embeds: [embed('🔎 Server Duplicator — Analyse', ['Choose the source and destination from the shared Goliath server directory — no server IDs required.', '', directoryNote].join('\n'))], components: [
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'source')).setPlaceholder('Source server').addOptions(guildChoices(session, session.sourceGuildId))),
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'destination')).setPlaceholder('Destination server').addOptions(guildChoices(session, session.destinationGuildId))),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'start')).setLabel('Analyse Servers').setStyle(ButtonStyle.Primary).setDisabled(!session.sourceGuildId || !session.destinationGuildId || session.sourceGuildId === session.destinationGuildId),
      new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'refresh')).setLabel('Refresh Guilds').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(componentId(ANALYSE_PREFIX, session.id, 'cancel')).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ),
  ], flags: MessageFlags.Ephemeral };
}
async function startCopy(interaction) { const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral }); initializeBridge(interaction.client); const session = makeSession(interaction, 'copy'); await refreshSessionDirectory(interaction.client, session); return interaction.reply(await copyPanel(interaction, session)); }
async function startBuild(interaction) { const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral }); return interaction.reply({ content: '🏗️ Build remains available through saved templates; selective Copy is the recommended DEV workflow.', flags: MessageFlags.Ephemeral }); }
async function exportTemplate(interaction) {
  const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  initializeBridge(interaction.client);
  const name = interaction.options.getString('name'); if (!name) return interaction.reply({ content: '❌ Export needs `name`.', flags: MessageFlags.Ephemeral });
  const sourceGuildId = interaction.options.getString('source_server') || interaction.guild.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const directory = await getGuildDirectory(interaction.client);
  const snap = await snapshotForGuild(interaction.client, sourceGuildId, [...ACTIVE_OPTIONS], { guildDirectory: directory });
  const templateId = slugify(interaction.options.getString('template_id') || name);
  const all = templates(interaction.guild.id, interaction.guild);
  all[templateId] = { meta: { id: templateId, name, description: interaction.options.getString('description') || '', version: interaction.options.getString('version') || '2.0.0', sourceGuildId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: interaction.user.id, updatedBy: interaction.user.id, environment: mode(), schemaVersion: 2, defaultTemplate: false }, snapshot: snap };
  saveTemplates(interaction.guild.id, all, interaction.guild);
  return interaction.editReply({ embeds: [embed('✅ Template Exported', `**Template:** ${name}\n**ID:** \`${templateId}\``)] });
}
async function analyse(interaction) {
  const access = assertAccess(interaction); if (!access.allowed) return interaction.reply({ content: `❌ ${access.reason}`, flags: MessageFlags.Ephemeral });
  initializeBridge(interaction.client);
  const sourceGuildId = String(interaction.options.getString('source_server') || '').trim();
  const destinationGuildId = String(interaction.options.getString('destination_server') || '').trim();
  if (!sourceGuildId || !destinationGuildId) { const session = makeAnalyseSession(interaction); await refreshSessionDirectory(interaction.client, session); return interaction.reply(await analysePanel(interaction, session)); }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const directory = await getGuildDirectory(interaction.client);
  const snap = await snapshotForGuild(interaction.client, sourceGuildId, [...ACTIVE_OPTIONS], { guildDirectory: directory });
  const route = await resolveGuildRoute(interaction.client, destinationGuildId, { guildDirectory: directory });
  if (!route) return interaction.editReply('❌ Destination unavailable.');
  let response;
  if (route.local) { const result = await fetchGuildById(interaction.client, destinationGuildId); const session = { dryRun: true, conflictMode: 'skip', destinationGuildId }; response = { guild: { id: result.guild.id, name: result.guild.name }, log: await executeSnapshotOnGuild(result.guild, session, snap, 'Analyse', interaction.user.id) }; }
  else response = await bridgeRequest(route.environment, 'POST', '/apply', { guildId: destinationGuildId, session: { dryRun: true, conflictMode: 'skip', destinationGuildId }, snapshot: snap, title: 'Analyse', actorId: interaction.user.id }, 120000);
  return interaction.editReply({ embeds: [resultEmbed('🔎 Duplicator Analyse', response.guild, response.log)] });
}
async function run(interaction) { const action = interaction.options.getString('action', true); if (action === 'copy') return startCopy(interaction); if (action === 'analyse') return analyse(interaction); if (action === 'export') return exportTemplate(interaction); if (action === 'build') return startBuild(interaction); return interaction.reply({ content: '❌ Unknown server action.', flags: MessageFlags.Ephemeral }); }
async function handleCopy(interaction, data) {
  const session = getSession(copySessions, interaction, data.sessionId); if (!session) return false;
  if (data.action === 'source') session.sourceGuildId = interaction.values?.[0];
  else if (data.action === 'destination') session.destinationGuildId = interaction.values?.[0];
  else if (data.action === 'options') session.selectedOptions = interaction.values || [...ACTIVE_OPTIONS];
  else if (data.action === 'conflict') session.conflictMode = interaction.values?.[0] || 'skip';
  else if (data.action === 'refresh') { await refreshSessionDirectory(interaction.client, session); session.expiresAt = Date.now() + SESSION_TTL_MS; }
  else if (data.action === 'dryrun') session.dryRun = !session.dryRun;
  else if (data.action === 'cancel') { copySessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Copy Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'start') {
    const snap = await snapshotForGuild(interaction.client, session.sourceGuildId, session.selectedOptions, session);
    await interaction.update({ embeds: [embed('🚧 Copy Running', 'Working...')], components: [] });
    const log = await executeSnapshot(interaction, session, snap, 'Copy');
    const destination = directoryGuild(session, session.destinationGuildId) || { id: session.destinationGuildId, name: session.destinationGuildId };
    copySessions.delete(session.id);
    return interaction.editReply({ embeds: [resultEmbed('✅ Copy Complete', destination, log)], components: [] });
  }
  return interaction.update(await copyPanel(interaction, session));
}
async function handleAnalyse(interaction, data) {
  const session = getSession(analyseSessions, interaction, data.sessionId); if (!session) return false;
  if (data.action === 'source') session.sourceGuildId = interaction.values?.[0];
  else if (data.action === 'destination') session.destinationGuildId = interaction.values?.[0];
  else if (data.action === 'refresh') { await refreshSessionDirectory(interaction.client, session); session.expiresAt = Date.now() + SESSION_TTL_MS; }
  else if (data.action === 'cancel') { analyseSessions.delete(session.id); return interaction.update({ embeds: [embed('❌ Analyse Cancelled', 'No changes were made.', 0xef4444)], components: [] }); }
  else if (data.action === 'start') {
    await interaction.update({ embeds: [embed('🔎 Analysing Servers', 'Working...')], components: [] });
    const snap = await snapshotForGuild(interaction.client, session.sourceGuildId, [...ACTIVE_OPTIONS], session);
    const route = await resolveGuildRoute(interaction.client, session.destinationGuildId, session);
    let response;
    if (route.local) { const result = await fetchGuildById(interaction.client, session.destinationGuildId); response = { guild: { id: result.guild.id, name: result.guild.name }, log: await executeSnapshotOnGuild(result.guild, { dryRun: true, conflictMode: 'skip', destinationGuildId: session.destinationGuildId }, snap, 'Analyse', interaction.user.id) }; }
    else response = await bridgeRequest(route.environment, 'POST', '/apply', { guildId: session.destinationGuildId, session: { dryRun: true, conflictMode: 'skip', destinationGuildId: session.destinationGuildId }, snapshot: snap, title: 'Analyse', actorId: interaction.user.id }, 120000);
    analyseSessions.delete(session.id);
    return interaction.editReply({ embeds: [resultEmbed('🔎 Duplicator Analyse', response.guild, response.log)], components: [] });
  }
  return interaction.update(await analysePanel(interaction, session));
}
async function handleInteraction(interaction) {
  if (!interaction?.customId) return false;
  const analyseData = parseComponentId(interaction.customId, ANALYSE_PREFIX); if (analyseData) { await handleAnalyse(interaction, analyseData); return true; }
  const copyData = parseComponentId(interaction.customId, COPY_PREFIX); if (copyData) { await handleCopy(interaction, copyData); return true; }
  return false;
}

module.exports = {
  run,
  handleInteraction,
  assertAccess,
  snapshot,
  templates,
  templateList,
  DEFAULT_TEMPLATES,
  initializeBridge,
  getGuildDirectory,
};
