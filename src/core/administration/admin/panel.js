'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const guildManager = require('../../guild/guildManager');
const panelNav = require('../../ui/panelNavigation');
const restoreRequestManager = require('../../security/restoreBackup/requests');
const security = require('../../security/protection/core');
const { createServerBackup, listServerBackups, readServerBackup, validateServerBackup } = require('../../security/restoreBackup/backup');
const automodPanel = require('../automod/panel');
const modPanel = require('../mod/panel');
const moduleAdminPanels = require('./modules');

const PANEL_COLOR = '#5865F2';
const AUTHORITY_SECTION = 'goliathAuthority';
const AUTHORITY_VERSION = 6;
const AUTHORITY_PER_PAGE = 10;

const LOG_TYPES = {
  automodlog: { key: 'automod', customId: 'admin:setautomodlog', selectId: 'admin:selectautomodlog', title: '🤖 Set AutoMod Log Channel', label: '🤖 AutoMod Log' },
  adminlog: { key: 'admin', customId: 'admin:setadminlog', selectId: 'admin:selectadminlog', title: '👑 Set Admin Log Channel', label: '👑 Admin Log' },
  modlog: { key: 'moderation', customId: 'admin:setmodlog', selectId: 'admin:selectmodlog', title: '📌 Set Mod Log Channel', label: '📌 Mod Log' },
  logs: { key: 'general', customId: 'admin:setlogs', selectId: 'admin:selectlogs', title: '📋 Set General Logs Channel', label: '📋 General Logs' },
  memberlog: { key: 'member', customId: 'admin:setmemberlog', selectId: 'admin:selectmemberlog', title: '👥 Set Member Log Channel', label: '👥 Member Log' },
};

const AUTHORITY_TIERS = {
  administrator: { label: 'Administrator', emoji: '👑', rank: 300, description: 'Guild administrators who can manage the Goliath systems explicitly granted below.' },
  moderator: { label: 'Moderator', emoji: '🛡️', rank: 200, description: 'Moderators with configurable moderation and limited administration access.' },
  juniorModerator: { label: 'Junior Moderator', emoji: '🔰', rank: 100, description: 'Restricted or trial moderators with only explicitly granted capabilities.' },
};
const AUTHORITY_TIER_ORDER = Object.keys(AUTHORITY_TIERS).sort((a, b) => AUTHORITY_TIERS[b].rank - AUTHORITY_TIERS[a].rank);

const CORE_GUILD_PERMISSIONS = [
  { key: 'admin.dashboard.view', label: 'View Admin Hub', group: 'Administration' },
  { key: 'admin.automod.manage', label: 'Manage AutoMod', group: 'Administration' },
  { key: 'admin.modules.manage', label: 'Manage All Studios & Modules', group: 'Administration' },
  { key: 'admin.logs.manage', label: 'Manage Log Channels', group: 'Administration' },
  { key: 'admin.backups.view', label: 'View Backups', group: 'Administration' },
  { key: 'admin.backups.create', label: 'Create Backups', group: 'Administration' },
  { key: 'admin.backups.requestRestore', label: 'Request Restore', group: 'Administration' },
  { key: 'admin.purge', label: 'Purge Messages', group: 'Administration' },
  { key: 'mod.panel.view', label: 'View Moderation Hub', group: 'Moderation' },
  { key: 'mod.warn', label: 'Warn Members', group: 'Moderation' },
  { key: 'mod.timeout', label: 'Timeout Members', group: 'Moderation' },
  { key: 'mod.timeout.remove', label: 'Remove Timeouts', group: 'Moderation' },
  { key: 'mod.kick', label: 'Kick Members', group: 'Moderation' },
  { key: 'mod.ban', label: 'Ban Members', group: 'Moderation' },
  { key: 'mod.unban', label: 'Unban Members', group: 'Moderation' },
  { key: 'mod.cases.view', label: 'View Cases', group: 'Cases' },
  { key: 'mod.cases.search', label: 'Search Cases', group: 'Cases' },
  { key: 'mod.cases.export', label: 'Export Cases', group: 'Cases' },
  { key: 'mod.cases.manage', label: 'Manage Cases', group: 'Cases' },
  { key: 'mod.proceeding.manage', label: 'Build Detailed Case Files', group: 'Cases' },
  { key: 'mod.proceeding.review', label: 'Review & Decide Cases', group: 'Cases' },
  { key: 'mod.proceeding.publish', label: 'Publish Case Decisions', group: 'Cases' },
  { key: 'mod.proceeding.close', label: 'Close / Reopen Cases', group: 'Cases' },
  { key: 'mod.proceeding.delete', label: 'Permanently Delete Cases', group: 'Cases' },
  { key: 'mod.evidence.manage', label: 'Manage Evidence', group: 'Cases' },
  { key: 'mod.appeals.view', label: 'View Appeal Queue', group: 'Cases' },
  { key: 'mod.appeals.decide', label: 'Decide Appeals', group: 'Cases' },
  { key: 'mod.presets.manage', label: 'Manage Moderation Presets', group: 'Moderation' },
  { key: 'mod.bulk', label: 'Bulk Moderation', group: 'Moderation' },
  { key: 'mod.analytics.view', label: 'View Moderation Analytics', group: 'Moderation' },
  { key: 'mod.scan.run', label: 'Run Member Scan', group: 'Member Scan' },
  { key: 'mod.scan.history', label: 'View Scan History', group: 'Member Scan' },
  { key: 'mod.scan.compare', label: 'Compare Accounts', group: 'Member Scan' },
  { key: 'mod.scan.suspectedAccounts', label: 'View Suspected Accounts', group: 'Member Scan' },
  { key: 'mod.scan.network', label: 'View Network Intelligence', group: 'Member Scan' },
  { key: 'mod.scan.notes', label: 'Manage Investigation Notes', group: 'Member Scan' },
  { key: 'mod.scan.watch', label: 'Manage Watch Status', group: 'Member Scan' },
  { key: 'mod.scan.links', label: 'View Link Evidence', group: 'Member Scan' },
];

const studioPermissionKey = (studioKey) => `studio.${studioKey}.manage`;
const modulePermissionKey = (moduleKey) => `module.${moduleKey}.manage`;
const STUDIO_PERMISSION_CATALOG = (moduleAdminPanels.STUDIO_CATALOG || []).map((studio) => ({ key: studioPermissionKey(studio.key), label: `Manage ${studio.title.replace(/^\S+\s*/, '')}`, group: 'Studios' }));
const MODULE_PERMISSION_CATALOG = (moduleAdminPanels.MODULE_CATALOG || []).map((module) => ({ key: modulePermissionKey(module.key), label: `Manage ${module.title.replace(/^\S+\s*/, '')}`, group: module.studio.replace(/Studio$/, ' Studio') }));
const GUILD_PERMISSION_CATALOG = [...CORE_GUILD_PERMISSIONS, ...STUDIO_PERMISSION_CATALOG, ...MODULE_PERMISSION_CATALOG];
const GUILD_PERMISSION_KEYS = new Set(GUILD_PERMISSION_CATALOG.map((entry) => entry.key));

const baseModeratorPermissions = {
  'admin.dashboard.view': false, 'admin.automod.manage': false, 'admin.modules.manage': false, 'admin.logs.manage': false,
  'admin.backups.view': false, 'admin.backups.create': false, 'admin.backups.requestRestore': false, 'admin.purge': false,
  'mod.panel.view': true, 'mod.warn': true, 'mod.timeout': true, 'mod.timeout.remove': true, 'mod.kick': true,
  'mod.ban': false, 'mod.unban': false, 'mod.cases.view': true, 'mod.cases.search': true, 'mod.cases.export': false,
  'mod.cases.manage': true, 'mod.proceeding.manage': true, 'mod.proceeding.review': false, 'mod.proceeding.publish': false, 'mod.proceeding.close': false, 'mod.proceeding.delete': false, 'mod.evidence.manage': true, 'mod.appeals.view': true, 'mod.appeals.decide': false,
  'mod.presets.manage': true, 'mod.bulk': false, 'mod.analytics.view': true, 'mod.scan.run': true, 'mod.scan.history': true,
  'mod.scan.compare': true, 'mod.scan.suspectedAccounts': true, 'mod.scan.network': true, 'mod.scan.notes': true,
  'mod.scan.watch': true, 'mod.scan.links': true,
};
const baseJuniorPermissions = {
  'admin.dashboard.view': false, 'admin.automod.manage': false, 'admin.modules.manage': false, 'admin.logs.manage': false,
  'admin.backups.view': false, 'admin.backups.create': false, 'admin.backups.requestRestore': false, 'admin.purge': false,
  'mod.panel.view': true, 'mod.warn': true, 'mod.timeout': true, 'mod.timeout.remove': false, 'mod.kick': false,
  'mod.ban': false, 'mod.unban': false, 'mod.cases.view': true, 'mod.cases.search': true, 'mod.cases.export': false,
  'mod.cases.manage': false, 'mod.proceeding.manage': false, 'mod.proceeding.review': false, 'mod.proceeding.publish': false, 'mod.proceeding.close': false, 'mod.proceeding.delete': false, 'mod.evidence.manage': false, 'mod.appeals.view': false, 'mod.appeals.decide': false,
  'mod.presets.manage': false, 'mod.bulk': false, 'mod.analytics.view': false, 'mod.scan.run': true, 'mod.scan.history': true,
  'mod.scan.compare': true, 'mod.scan.suspectedAccounts': false, 'mod.scan.network': false, 'mod.scan.notes': false,
  'mod.scan.watch': false, 'mod.scan.links': false,
};
for (const entry of [...STUDIO_PERMISSION_CATALOG, ...MODULE_PERMISSION_CATALOG]) { baseModeratorPermissions[entry.key] = false; baseJuniorPermissions[entry.key] = false; }
const DEFAULT_TIER_PERMISSIONS = {
  administrator: Object.fromEntries(GUILD_PERMISSION_CATALOG.map(({ key }) => [key, true])),
  moderator: baseModeratorPermissions,
  juniorModerator: baseJuniorPermissions,
};

const LOG_SELECT_TO_TYPE = Object.fromEntries(Object.entries(LOG_TYPES).map(([key, value]) => [value.selectId, key]));
const LOG_BUTTON_TO_TYPE = Object.fromEntries(Object.entries(LOG_TYPES).map(([key, value]) => [value.customId, key]));
const MODULE_ROUTES = new Set((moduleAdminPanels.MODULE_CATALOG || []).map((entry) => entry.route));
const MODULE_BY_ROUTE = Object.fromEntries((moduleAdminPanels.MODULE_CATALOG || []).map((entry) => [entry.route, entry]));
const MODULE_BY_KEY = Object.fromEntries((moduleAdminPanels.MODULE_CATALOG || []).map((entry) => [entry.key, entry]));
const STUDIO_BY_KEY = Object.fromEntries((moduleAdminPanels.STUDIO_CATALOG || []).map((entry) => [entry.key, entry]));

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Primary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const getMemberDisplayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
const getGuildSection = (guildId, section, fallback) => guildManager.getGuildSection(guildId, section, fallback);
const replaceGuildSection = (guildId, section, data) => guildManager.replaceGuildSection(guildId, section, data);
const getRoleConfig = (guildId, section) => getGuildSection(guildId, section, { roleIds: [] });
const getAutoRolesConfig = (guildId) => getGuildSection(guildId, 'autoRoles', { enabled: false, roleIds: [] });
const isBotOwner = (interaction) => Boolean(interaction?.user?.id && security.isBotOwner(interaction.user.id));
const isGuildOwner = (interaction) => Boolean(interaction?.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id);
const normalizeBackupId = (backup) => typeof backup === 'string' ? backup : backup?.backupId;
const formatRoleList = (ids) => { const values = [...new Set((ids || []).filter(Boolean))]; return values.length ? values.map((id) => `<@&${id}>`).join(', ') : 'None'; };

const LEGACY_PERMISSION_SCOPE = String.fromCharCode(99, 111, 117, 114, 116);
function normalizeAuthorityPermissionKey(key) {
  const raw = String(key || '');
  const legacyPrefix = `mod.${LEGACY_PERMISSION_SCOPE}.`;
  return raw.startsWith(legacyPrefix) ? `mod.proceeding.${raw.slice(legacyPrefix.length)}` : raw;
}
function normalizePermissionMap(source, defaults) {
  const permissions = { ...defaults };
  for (const [key, value] of Object.entries(source || {})) {
    const normalizedKey = normalizeAuthorityPermissionKey(key);
    if (GUILD_PERMISSION_KEYS.has(normalizedKey)) permissions[normalizedKey] = Boolean(value);
  }
  return permissions;
}
function createDefaultAuthorityConfig() {
  return { version: AUTHORITY_VERSION, configured: false, tiers: Object.fromEntries(AUTHORITY_TIER_ORDER.map((key) => [key, { roleIds: [], permissions: { ...DEFAULT_TIER_PERMISSIONS[key] } }])), roleProfiles: {} };
}
function normalizeAuthorityConfig(raw) {
  const defaults = createDefaultAuthorityConfig(); const source = raw && typeof raw === 'object' ? raw : {}; const tiers = {}; const seenRoles = new Set();
  for (const tierKey of AUTHORITY_TIER_ORDER) {
    const tier = source.tiers?.[tierKey] || {};
    const roleIds = [...new Set((tier.roleIds || []).map(String).filter((id) => /^\d{15,25}$/.test(id) && !seenRoles.has(id)))];
    roleIds.forEach((id) => seenRoles.add(id));
    tiers[tierKey] = { roleIds, permissions: normalizePermissionMap(tier.permissions, DEFAULT_TIER_PERMISSIONS[tierKey]) };
  }
  const roleProfiles = {};
  for (const tierKey of AUTHORITY_TIER_ORDER) for (const roleId of tiers[tierKey].roleIds) {
    const existing = source.roleProfiles?.[roleId]; const sameTier = existing?.tier === tierKey;
    roleProfiles[roleId] = { tier: tierKey, permissions: normalizePermissionMap(sameTier ? existing.permissions : null, tiers[tierKey].permissions) };
  }
  return { ...defaults, version: AUTHORITY_VERSION, configured: source.configured === true || seenRoles.size > 0, tiers, roleProfiles };
}
function getAuthorityConfig(guildId) { return normalizeAuthorityConfig(getGuildSection(guildId, AUTHORITY_SECTION, createDefaultAuthorityConfig())); }
function saveAuthorityConfig(guildId, config) { return replaceGuildSection(guildId, AUTHORITY_SECTION, normalizeAuthorityConfig(config)); }
function getMemberRoleIds(interaction) { if (!interaction?.member?.roles) return []; const cache = interaction.member.roles.cache; if (cache?.keys) return [...cache.keys()]; return Array.isArray(interaction.member.roles) ? interaction.member.roles.map(String) : []; }
function getMatchedAuthorityProfiles(interaction, config = null) {
  if (!interaction?.guild) return []; const authority = config || getAuthorityConfig(interaction.guild.id);
  return getMemberRoleIds(interaction).map((roleId) => ({ roleId, ...(authority.roleProfiles?.[roleId] || {}) })).filter((profile) => AUTHORITY_TIERS[profile.tier] && profile.permissions).sort((a, b) => AUTHORITY_TIERS[b.tier].rank - AUTHORITY_TIERS[a.tier].rank);
}
function getMatchedAuthorityTiers(interaction, config = null) { return [...new Set(getMatchedAuthorityProfiles(interaction, config).map((profile) => profile.tier))]; }
function getAuthorityContext(interaction) {
  if (isBotOwner(interaction)) return { source: 'goliathOwner', highestTier: null, profiles: [], permissions: new Set(GUILD_PERMISSION_KEYS) };
  if (isGuildOwner(interaction)) return { source: 'guildOwner', highestTier: 'guildOwner', profiles: [], permissions: new Set(GUILD_PERMISSION_KEYS) };
  if (!interaction?.guild || !interaction?.member) return { source: 'none', highestTier: null, profiles: [], permissions: new Set() };
  const authority = getAuthorityConfig(interaction.guild.id); if (!authority.configured) return { source: 'legacy', highestTier: null, profiles: [], permissions: new Set() };
  const profiles = getMatchedAuthorityProfiles(interaction, authority); const permissions = new Set();
  for (const profile of profiles) for (const [key, allowed] of Object.entries(profile.permissions || {})) if (allowed === true && GUILD_PERMISSION_KEYS.has(key)) permissions.add(key);
  return { source: 'configured', highestTier: profiles[0]?.tier || null, profiles, permissions };
}
function hasGuildPermission(interaction, permissionKey) {
  if (!GUILD_PERMISSION_KEYS.has(permissionKey)) return false;
  if (isBotOwner(interaction) || isGuildOwner(interaction)) return true;
  if (!interaction?.guild || !interaction?.member) return false;
  const authority = getAuthorityConfig(interaction.guild.id);
  if (!authority.configured) {
    if (permissionKey.startsWith('admin.') || permissionKey.startsWith('studio.') || permissionKey.startsWith('module.')) return Boolean(interaction.member.permissions?.has(PermissionFlagsBits.Administrator));
    return security.hasPermission(interaction, 'mod');
  }
  return getMatchedAuthorityProfiles(interaction, authority).some((profile) => profile.permissions[permissionKey] === true);
}
function canManageGuildAuthority(interaction) { return isBotOwner(interaction) || isGuildOwner(interaction); }
function canUseAdminPanel(interaction) { return hasGuildPermission(interaction, 'admin.dashboard.view') || isBotOwner(interaction) || isGuildOwner(interaction); }
function hasAnyModulePermission(interaction) { return hasGuildPermission(interaction, 'admin.modules.manage') || [...STUDIO_PERMISSION_CATALOG, ...MODULE_PERMISSION_CATALOG].some((entry) => hasGuildPermission(interaction, entry.key)); }
function canManageStudio(interaction, studioKey) { return hasGuildPermission(interaction, 'admin.modules.manage') || hasGuildPermission(interaction, studioPermissionKey(studioKey)) || (moduleAdminPanels.MODULE_CATALOG || []).some((module) => module.studio === studioKey && hasGuildPermission(interaction, modulePermissionKey(module.key))); }
function canManageModule(interaction, moduleKey) { const module = MODULE_BY_KEY[moduleKey]; return Boolean(module && (hasGuildPermission(interaction, 'admin.modules.manage') || hasGuildPermission(interaction, studioPermissionKey(module.studio)) || hasGuildPermission(interaction, modulePermissionKey(module.key)))); }
function resolveModuleFromControl(id) {
  if (MODULE_BY_ROUTE[id]) return MODULE_BY_ROUTE[id];
  const match = String(id || '').match(/^admin:module:([a-zA-Z0-9_-]+)/); if (match && MODULE_BY_KEY[match[1]]) return MODULE_BY_KEY[match[1]];
  if (id === 'admin:embed') return MODULE_BY_KEY.embed || null; if (id === 'admin:tickets') return MODULE_BY_KEY.tickets || null; if (id.startsWith('admin:autoRoles')) return MODULE_BY_KEY.autoRoles || null;
  return null;
}

function createEmbed(title, description, memberDisplayName, color = PANEL_COLOR) { const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp(); if (description) embed.setDescription(description); if (memberDisplayName) embed.setFooter({ text: `Requested by ${memberDisplayName}` }); return embed; }
function buttonRows(items, size = 3) { const rows = []; for (let index = 0; index < items.length; index += size) rows.push(row(...items.slice(index, index + size).map(([id, label, style, disabled]) => button(id, label, style, disabled)))); return rows; }
function getLogChannelId(guildId, type) { return typeof guildManager.getLogChannelId === 'function' ? guildManager.getLogChannelId(guildId, type) : getGuildSection(guildId, 'logs', { channels: {} })?.channels?.[type] || null; }
function setLogChannelId(guildId, type = 'general', channelId = null) { if (typeof guildManager.setLogChannelId === 'function') return guildManager.setLogChannelId(guildId, type, channelId); const logs = getGuildSection(guildId, 'logs', { enabled: true, channels: {}, events: {} }); return replaceGuildSection(guildId, 'logs', { ...logs, channels: { ...(logs.channels || {}), [type]: channelId } }); }
function canonicalState(route = 'admin:home') { const home = ['admin:home']; if (route === 'admin:home') return { history: home }; if (route === 'admin:automod') return { history: [...home, route] }; if (route === 'admin:automod:configure' || route.startsWith('admin:automod:rule:')) return { history: [...home, 'admin:automod', route] }; if (route === 'admin:channel:automodlog') return { history: [...home, 'admin:automod', 'admin:automod:configure', route] }; if (route === 'admin:authority') return { history: [...home, 'admin:adminpanel', route] }; if (route.startsWith('admin:authority:')) return { history: [...home, 'admin:adminpanel', 'admin:authority', route] }; if (['admin:staffroles', 'admin:modroles'].includes(route)) return { history: [...home, 'admin:adminpanel', route] }; if (route === 'admin:autoRoles' || MODULE_ROUTES.has(route)) return { history: [...home, 'admin:modules', route] }; return { history: [...home, route] }; }
function routeLabel(route) { const labels = { 'admin:home': 'Administration', 'admin:automod': 'Security & AutoMod', 'admin:automod:configure': 'Settings', 'admin:modules': 'Studios', 'admin:logs': 'Logs & Audit', 'admin:backups': 'Backup & Recovery', 'admin:adminpanel': 'Staff & Permissions', 'admin:modpanel': 'Moderation Hub', 'admin:authority': 'Authority Control', 'admin:staffroles': 'Staff Roles', 'admin:modroles': 'Mod Roles', 'admin:autoRoles': 'Join Roles' }; if (route?.startsWith('admin:automod:rule:')) return automodPanel.AUTOMOD_RULES?.[route.split(':').pop()]?.title || 'AutoMod Rule'; if (route?.startsWith('admin:authority:profile:')) return 'Role Profile'; return labels[route] || String(route || 'admin:home').replace('admin:', '').replaceAll(':', ' › '); }
function applyNavigationUI(interaction, panel, state = canonicalState()) { if (!panel?.embeds?.[0]) return panel; return { ...panel, embeds: [EmbedBuilder.from(panel.embeds[0]).setFooter({ text: `Navigation: ${(state.history || ['admin:home']).slice(-4).map(routeLabel).join(' › ')}` })] }; }
const backButton = (route) => button(panelNav.buildCustomId(canonicalState(route), 'back'), '⬅️ Back', ButtonStyle.Secondary);

function buildAdminPanel(guild, name = 'Unknown User', interaction = null) {
  const can = (key) => !interaction || hasGuildPermission(interaction, key);
  const fields = [];
  const actions = [];

  if (!interaction || canManageGuildAuthority(interaction)) {
    fields.push({ name: '👥 Staff & Permissions', value: 'Map guild roles to Goliath authority and control exact powers', inline: true });
    actions.push(['admin:adminpanel', '👥 Permissions', ButtonStyle.Primary]);
  }
  if (can('admin.automod.manage')) {
    fields.push({ name: '🛡️ Security & AutoMod', value: 'Protection rules and automated enforcement', inline: true });
    actions.push(['admin:automod', '🛡️ Security', ButtonStyle.Primary]);
  }
  if (!interaction || hasAnyModulePermission(interaction)) {
    fields.push({ name: '🧩 Goliath Studios', value: 'Configure only the Studios assigned to your Goliath authority profile', inline: true });
    actions.push(['admin:modules', '🧩 Studios', ButtonStyle.Primary]);
  }
  if (can('admin.logs.manage')) {
    fields.push({ name: '📋 Logs & Audit', value: `${Object.values(LOG_TYPES).filter((value) => getLogChannelId(guild.id, value.key)).length}/5 log channels configured`, inline: true });
    actions.push(['admin:logs', '📋 Logs', ButtonStyle.Primary]);
  }
  if (can('admin.backups.view')) {
    fields.push({ name: '🧱 Backup & Recovery', value: 'Server backup visibility and recovery requests', inline: true });
    actions.push(['admin:backups', '🧱 Backups', ButtonStyle.Primary]);
  }
  if (can('mod.panel.view')) {
    fields.push({ name: '🔐 Moderation Hub', value: 'Moderation cases, actions and tooling', inline: true });
    actions.push(['admin:modpanel', '🔐 Moderation', ButtonStyle.Primary]);
  }
  if (can('admin.purge')) {
    fields.push({ name: '🧹 Server Utilities', value: 'Controlled server maintenance actions', inline: true });
    actions.push(['admin:purge', '🧹 Purge', ButtonStyle.Danger]);
  }

  const embed = createEmbed('🛠️ Goliath Administration', 'Choose an administration area. Only controls assigned to your Goliath authority profile are shown.', name);
  if (fields.length) embed.addFields(fields);
  else embed.setDescription('No guild-manageable administration controls are currently assigned to your roles.');
  return { embeds: [embed], components: buttonRows(actions, 3) };
}
function buildAdminToolsPanel(guild, name = 'Unknown User', interaction = null) { const authority = getAuthorityConfig(guild.id); const description = ['**Guild Authority Control**', authority.configured ? 'Status: **Configured ✅**' : 'Status: **Legacy access fallback ⚠️**', '', ...Object.entries(AUTHORITY_TIERS).map(([key, tier]) => `${tier.emoji} **${tier.label}** — ${formatRoleList(authority.tiers[key].roleIds)}`), '', 'Each mapped role has its own permission profile. Authority tiers provide defaults and hierarchy only.', 'Guild authority controls Goliath access only. Goliath-owner/root authority is separate and is never exposed here.'].join('\n'); const components = canManageGuildAuthority(interaction) ? [...buttonRows([['admin:authority', '⚙️ Authority Control', ButtonStyle.Success], ['admin:setadminlog', '📋 Set Admin Log', ButtonStyle.Secondary]], 2), row(backButton('admin:adminpanel'))] : [row(backButton('admin:adminpanel'))]; return { embeds: [createEmbed('👥 Staff & Permissions', description, name)], components }; }
function buildAuthorityPanel(guild, name = 'Unknown User') { const config = getAuthorityConfig(guild.id); const embed = createEmbed('⚙️ Guild Authority Control', ['Map this guild’s Discord roles to Goliath authority tiers. Role names do not matter.', '', '**Guild Owner** — implicit full guild authority; cannot be removed here.', ...Object.entries(AUTHORITY_TIERS).map(([key, tier]) => `${tier.emoji} **${tier.label}:** ${formatRoleList(config.tiers[key].roleIds)}`), '', '**How it works** — tiers define hierarchy and starting templates; every mapped Discord role receives its own independent permission profile.', 'Studio and module permissions are individually configurable. Granting a Studio grants all modules inside it; individual module permissions can be granted without the whole Studio.', '', config.configured ? 'Configured role mappings are active. Goliath now resolves guild access from these mappings.' : 'No mappings yet. Existing Discord Administrator/Moderator fallback remains active until you configure roles.', '', '🔒 Goliath-owner/root permissions are not part of this system.'].join('\n'), name); return { embeds: [embed], components: [row(button('admin:authority:roles:administrator', '👑 Admin Roles'), button('admin:authority:roles:moderator', '🛡️ Mod Roles'), button('admin:authority:roles:juniorModerator', '🔰 Junior Mod Roles')), row(button('admin:authority:permissions:administrator:0', '👑 Admin Template', ButtonStyle.Secondary), button('admin:authority:permissions:moderator:0', '🛡️ Mod Template', ButtonStyle.Secondary), button('admin:authority:permissions:juniorModerator:0', '🔰 Junior Template', ButtonStyle.Secondary)), row(backButton('admin:authority'))] }; }
function buildAuthorityRolesPanel(guild, tierKey, name = 'Unknown User') { const tier = AUTHORITY_TIERS[tierKey]; if (!tier) return buildAuthorityPanel(guild, name); const config = getAuthorityConfig(guild.id); const mapped = config.tiers[tierKey].roleIds; const components = [row(new RoleSelectMenuBuilder().setCustomId(`admin:authority:roles:select:${tierKey}`).setPlaceholder(`Select ${tier.label} roles`).setMinValues(0).setMaxValues(10))]; if (mapped.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:authority:profile:select:${tierKey}`).setPlaceholder('Edit a mapped role permission profile').addOptions(mapped.slice(0, 25).map((roleId) => ({ label: String(guild.roles?.cache?.get(roleId)?.name || `Role ${roleId}`).slice(0, 100), value: roleId, description: `${tier.label} role profile`.slice(0, 100) }))))); components.push(row(button(`admin:authority:roles:clear:${tierKey}`, 'Clear Roles', ButtonStyle.Danger), backButton(`admin:authority:roles:${tierKey}`))); return { embeds: [createEmbed(`${tier.emoji} ${tier.label} Roles`, `${tier.description}\n\n**Mapped roles:**\n${formatRoleList(mapped)}\n\nSelect roles for this hierarchy tier. Every mapped role gets an independent permission profile initialized from the ${tier.label} template.`, name)], components }; }
function buildAuthorityPermissionsPanel(guild, tierKey, page = 0, name = 'Unknown User') { const tier = AUTHORITY_TIERS[tierKey]; if (!tier) return buildAuthorityPanel(guild, name); const config = getAuthorityConfig(guild.id); const totalPages = Math.max(1, Math.ceil(GUILD_PERMISSION_CATALOG.length / AUTHORITY_PER_PAGE)); const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1)); const start = safePage * AUTHORITY_PER_PAGE; const entries = GUILD_PERMISSION_CATALOG.slice(start, start + AUTHORITY_PER_PAGE); const permissionMap = config.tiers[tierKey].permissions; const embed = createEmbed(`${tier.emoji} ${tier.label} Permission Template`, `${tier.description}\n\nStarting template for newly mapped ${tier.label} roles. Page **${safePage + 1}/${totalPages}**.`, name).addFields(entries.map((entry) => ({ name: `${permissionMap[entry.key] ? '✅' : '❌'} ${entry.label}`, value: `${entry.group} · \`${entry.key}\``, inline: true }))); const toggleRows = []; for (let index = 0; index < entries.length; index += 5) toggleRows.push(row(...entries.slice(index, index + 5).map((entry, offset) => { const absolute = start + index + offset; const enabled = permissionMap[entry.key] === true; return button(`admin:authority:toggle:${tierKey}:${absolute}:${safePage}`, `${enabled ? '✅' : '❌'} ${entry.label}`.slice(0, 80), enabled ? ButtonStyle.Success : ButtonStyle.Secondary); }))); const nav = []; if (safePage > 0) nav.push(button(`admin:authority:permissions:${tierKey}:${safePage - 1}`, '⬅️ Previous', ButtonStyle.Secondary)); nav.push(backButton(`admin:authority:permissions:${tierKey}:${safePage}`)); if (safePage < totalPages - 1) nav.push(button(`admin:authority:permissions:${tierKey}:${safePage + 1}`, 'Next ➡️', ButtonStyle.Secondary)); return { embeds: [embed], components: [...toggleRows, row(...nav)].slice(0, 5) }; }
function buildAuthorityRoleProfilePanel(guild, roleId, page = 0, name = 'Unknown User') { const config = getAuthorityConfig(guild.id); const profile = config.roleProfiles?.[roleId]; if (!profile || !AUTHORITY_TIERS[profile.tier]) return buildAuthorityPanel(guild, name); const tier = AUTHORITY_TIERS[profile.tier]; const roleName = guild.roles?.cache?.get(roleId)?.name || roleId; const totalPages = Math.max(1, Math.ceil(GUILD_PERMISSION_CATALOG.length / AUTHORITY_PER_PAGE)); const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1)); const start = safePage * AUTHORITY_PER_PAGE; const entries = GUILD_PERMISSION_CATALOG.slice(start, start + AUTHORITY_PER_PAGE); const embed = createEmbed(`🎛️ ${roleName} — Goliath Permissions`, `Hierarchy: ${tier.emoji} **${tier.label}**\nRole: <@&${roleId}>\n\nThese permissions apply only to this Discord role. Page **${safePage + 1}/${totalPages}**.`, name).addFields(entries.map((entry) => ({ name: `${profile.permissions[entry.key] ? '✅' : '❌'} ${entry.label}`, value: `${entry.group} · \`${entry.key}\``, inline: true }))); const toggleRows = []; for (let index = 0; index < entries.length; index += 5) toggleRows.push(row(...entries.slice(index, index + 5).map((entry, offset) => { const absolute = start + index + offset; const enabled = profile.permissions[entry.key] === true; return button(`admin:authority:profile:toggle:${roleId}:${absolute}:${safePage}`, `${enabled ? '✅' : '❌'} ${entry.label}`.slice(0, 80), enabled ? ButtonStyle.Success : ButtonStyle.Secondary); }))); const nav = []; if (safePage > 0) nav.push(button(`admin:authority:profile:${roleId}:${safePage - 1}`, '⬅️ Previous', ButtonStyle.Secondary)); nav.push(button(`admin:authority:profile:reset:${roleId}:${safePage}`, '↩️ Reset Template', ButtonStyle.Danger)); if (safePage < totalPages - 1) nav.push(button(`admin:authority:profile:${roleId}:${safePage + 1}`, 'Next ➡️', ButtonStyle.Secondary)); return { embeds: [embed], components: [...toggleRows, row(...nav), row(backButton(`admin:authority:roles:${profile.tier}`))].slice(0, 5) }; }

function buildModulesPanel(guild, name = 'Unknown User', interaction = null) { if (!interaction) return moduleAdminPanels.buildModuleListPanel(name); const studios = (moduleAdminPanels.STUDIO_CATALOG || []).filter((studio) => canManageStudio(interaction, studio.key)); const embed = createEmbed('🧩 Goliath Studios', studios.length ? 'Select a Studio. Only Studios assigned to your guild authority profile are shown.' : 'No Studio or module permissions are assigned to your roles.', name); const rows = buttonRows(studios.map((studio) => [`admin:studio:${studio.key}`, studio.label, ButtonStyle.Primary]), 4); return { embeds: [embed], components: [...rows, row(backButton('admin:modules'))].slice(0, 5) }; }
function buildFilteredStudioPanel(interaction, studioKey, name) { const studio = STUDIO_BY_KEY[studioKey]; if (!studio) return null; const modules = (moduleAdminPanels.MODULE_CATALOG || []).filter((module) => module.studio === studioKey && canManageModule(interaction, module.key)); const embed = createEmbed(studio.title, modules.length ? `${studio.summary}\n\nSelect a module. Only modules assigned to your role are shown.` : `${studio.summary}\n\nNo modules in this Studio are assigned to your role.`, name); const rows = buttonRows(modules.map((module) => [module.route || `admin:module:${module.key}:main:0`, module.label, ButtonStyle.Primary]), 4); return { embeds: [embed], components: [...rows, row(button('admin:modules', '⬅️ Back to Studios', ButtonStyle.Secondary))].slice(0, 5) }; }
function buildLogsPanel(guild, name = 'Unknown User') { return { embeds: [createEmbed('📋 Log Channels', Object.values(LOG_TYPES).map((value) => `**${value.label}:** ${getLogChannelId(guild.id, value.key) ? `<#${getLogChannelId(guild.id, value.key)}>` : 'Not set'}`).join('\n'), name)], components: [...buttonRows(Object.values(LOG_TYPES).map((value) => [value.customId, value.label, ButtonStyle.Primary])), row(backButton('admin:logs'))] }; }
function buildBackupsPanel(guild, name = 'Unknown User', interaction = null) { const backups = listServerBackups(guild.id); const latest = normalizeBackupId(backups[0]); const actions = []; if (!interaction || hasGuildPermission(interaction, 'admin.backups.create')) actions.push(['admin:backup:create', '⚡ Create Backup', ButtonStyle.Success]); actions.push(['admin:backup:list', '📦 View Backups'], ['admin:backup:preview', '🔍 Preview Latest', ButtonStyle.Secondary], ['admin:backup:download', '💾 Download Backup', ButtonStyle.Secondary]); if (!interaction || hasGuildPermission(interaction, 'admin.backups.requestRestore')) actions.push(['admin:backup:requestrestore', '🚨 Request Restore', ButtonStyle.Danger]); return { embeds: [createEmbed('🧱 Server Backups', `**Backups found:** ${backups.length}\n**Latest:** \`${latest || 'None'}\``, name)], components: [...buttonRows(actions, 2), row(backButton('admin:backups'))].slice(0, 5) }; }
function buildRolePanel(guild, section, title, selectId, clearId, name, route) { const config = getRoleConfig(guild.id, section); return { embeds: [createEmbed(title, `**Selected roles:**\n${formatRoleList(config.roleIds)}`, name)], components: [row(new RoleSelectMenuBuilder().setCustomId(selectId).setPlaceholder('Select roles').setMinValues(0).setMaxValues(10)), row(button(clearId, 'Clear Roles', ButtonStyle.Danger), backButton(route))] }; }
const buildStaffRolesPanel = (guild, name = 'Unknown User') => buildRolePanel(guild, 'staffRoles', '👥 Staff Roles', 'admin:staffroles:select', 'admin:staffroles:clear', name, 'admin:staffroles');
const buildModRolesPanel = (guild, name = 'Unknown User') => buildRolePanel(guild, 'modRoles', '🔐 Mod Roles', 'admin:modroles:select', 'admin:modroles:clear', name, 'admin:modroles');
function buildAutoRolesPanel(guild, name = 'Unknown User') { const config = getAutoRolesConfig(guild.id); return { embeds: [createEmbed('🎭 Join Roles', `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}\n**Roles:** ${formatRoleList(config.roleIds)}\n\n⚠️ The bot role must be above selected roles.`, name)], components: [row(new RoleSelectMenuBuilder().setCustomId('admin:autoRoles:select').setPlaceholder('Select join roles').setMinValues(0).setMaxValues(10)), row(button('admin:autoRoles:toggle', config.enabled ? 'Disable' : 'Enable', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success), backButton('admin:autoRoles'))] }; }
function buildChannelPanel(type = 'logs') { const settings = LOG_TYPES[type] || LOG_TYPES.logs; const route = type === 'automodlog' ? 'admin:channel:automodlog' : `admin:channel:${type}`; return { embeds: [createEmbed(settings.title, 'Select the text channel where these logs should be sent.')], components: [row(new ChannelSelectMenuBuilder().setCustomId(settings.selectId).setPlaceholder('Choose a text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)), row(backButton(route))] }; }
const buildComingSoonPanel = (title, description, route) => ({ embeds: [createEmbed(title, description)], components: [row(backButton(route))] });
const buildPurgeModal = () => new ModalBuilder().setCustomId('admin:purgeModal').setTitle('Purge Messages').addComponents(row(new TextInputBuilder().setCustomId('amount').setLabel('Amount (1-100)').setStyle(TextInputStyle.Short).setPlaceholder('25').setRequired(true)));
async function deny(interaction, message = '❌ You do not have permission to use this control.') { const payload = { content: message, flags: 64 }; if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.reply(payload); return true; }
async function executePurge(interaction) { if (!hasGuildPermission(interaction, 'admin.purge')) return deny(interaction); const raw = interaction.fields?.getTextInputValue?.('amount')?.trim() || ''; const amount = /^\d+$/.test(raw) ? Number(raw) : NaN; if (!Number.isInteger(amount) || amount < 1 || amount > 100) { await interaction.reply({ content: '❌ Purge amount must be a whole number from 1 to 100.', flags: 64 }); return true; } if (!interaction.channel?.bulkDelete) { await interaction.reply({ content: '❌ This channel does not support bulk message deletion.', flags: 64 }); return true; } try { const deleted = await interaction.channel.bulkDelete(amount, true); await interaction.reply({ content: `🧹 Deleted **${deleted?.size ?? 0}** message${deleted?.size === 1 ? '' : 's'}. Messages older than 14 days are skipped by Discord.`, flags: 64 }); } catch (error) { console.error('❌ Admin purge failed:', error); await interaction.reply({ content: '❌ Failed to purge messages. Check the bot permissions and channel history.', flags: 64 }); } return true; }
async function updatePanel(interaction, panel, route = 'admin:home') { const payload = applyNavigationUI(interaction, panel, canonicalState(route)); if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
function panelForRoute(route, interaction, name) { if (route === 'admin:home') return buildAdminPanel(interaction.guild, name, interaction); if (route === 'admin:automod') return automodPanel.buildAutomodPanel(interaction.guild, name); if (route === 'admin:automod:configure') return automodPanel.buildAutomodConfigurePanel(interaction.guild, name); if (route?.startsWith('admin:automod:rule:')) return automodPanel.buildAutomodRulePanel(interaction.guild, route.split(':').pop(), name); if (route === 'admin:adminpanel') return buildAdminToolsPanel(interaction.guild, name, interaction); if (route === 'admin:authority') return buildAuthorityPanel(interaction.guild, name); const authorityRoles = route.match(/^admin:authority:roles:(administrator|moderator|juniorModerator)$/); if (authorityRoles) return buildAuthorityRolesPanel(interaction.guild, authorityRoles[1], name); const authorityPermissions = route.match(/^admin:authority:permissions:(administrator|moderator|juniorModerator):(\d+)$/); if (authorityPermissions) return buildAuthorityPermissionsPanel(interaction.guild, authorityPermissions[1], Number(authorityPermissions[2]), name); const authorityProfile = route.match(/^admin:authority:profile:(\d{15,25}):(\d+)$/); if (authorityProfile) return buildAuthorityRoleProfilePanel(interaction.guild, authorityProfile[1], Number(authorityProfile[2]), name); if (route === 'admin:modules') return buildModulesPanel(interaction.guild, name, interaction); if (route === 'admin:logs') return buildLogsPanel(interaction.guild, name); if (route === 'admin:backups') return buildBackupsPanel(interaction.guild, name, interaction); if (route === 'admin:staffroles') return buildStaffRolesPanel(interaction.guild, name); if (route === 'admin:modroles') return buildModRolesPanel(interaction.guild, name); if (route === 'admin:autoRoles') return buildAutoRolesPanel(interaction.guild, name); return buildAdminPanel(interaction.guild, name, interaction); }
const openRoute = (interaction, route, name) => updatePanel(interaction, panelForRoute(route, interaction, name), route);

async function handleAdminNavigation(interaction) {
  if (!interaction.guild) return false; const nav = panelNav.parseCustomId(interaction.customId); if (!String(interaction.customId || '').startsWith('admin:') && !nav) return false; const id = String(interaction.customId || '');
  const authorityControl = id.startsWith('admin:authority') || id === 'admin:adminpanel'; if (authorityControl && !canManageGuildAuthority(interaction)) return deny(interaction, '❌ Only the Guild Owner can change this guild’s Goliath authority configuration.');
  if (!canUseAdminPanel(interaction) && !hasGuildPermission(interaction, 'mod.panel.view') && !hasAnyModulePermission(interaction)) return deny(interaction, '❌ Your guild roles are not authorized to use this Goliath control.');
  if (id.startsWith('admin:automod') && !hasGuildPermission(interaction, 'admin.automod.manage')) return deny(interaction);
  if (id === 'admin:modules' && !hasAnyModulePermission(interaction)) return deny(interaction);
  const studioMatch = id.match(/^admin:studio:([a-zA-Z0-9_-]+)$/); if (studioMatch && !canManageStudio(interaction, studioMatch[1])) return deny(interaction);
  const moduleTarget = resolveModuleFromControl(id); if (moduleTarget && !canManageModule(interaction, moduleTarget.key)) return deny(interaction);
  if ((id === 'admin:logs' || LOG_BUTTON_TO_TYPE[id] || LOG_SELECT_TO_TYPE[id]) && !hasGuildPermission(interaction, 'admin.logs.manage')) return deny(interaction);
  if (id.startsWith('admin:backup') && !hasGuildPermission(interaction, 'admin.backups.view')) return deny(interaction);
  if (await automodPanel.handleAutomodInteraction(interaction)) return true;
  const name = getMemberDisplayName(interaction);
  if (id === 'admin:modules') return updatePanel(interaction, buildModulesPanel(interaction.guild, name, interaction), 'admin:modules');
  if (studioMatch && interaction.isButton?.()) return updatePanel(interaction, buildFilteredStudioPanel(interaction, studioMatch[1], name), id);
  if (await moduleAdminPanels.handleModuleAdminInteraction(interaction)) return true;
  if (interaction.isModalSubmit?.() && id === 'admin:purgeModal') return executePurge(interaction);
  if (nav?.action === 'back') { const state = panelNav.back(nav.state); return openRoute(interaction, panelNav.current(state), name); }
  if (interaction.isRoleSelectMenu?.()) {
    const authorityRoleSelect = id.match(/^admin:authority:roles:select:(administrator|moderator|juniorModerator)$/);
    if (authorityRoleSelect) { const tierKey = authorityRoleSelect[1]; const config = getAuthorityConfig(interaction.guild.id); const selected = [...new Set((interaction.values || []).map(String))]; for (const otherTier of AUTHORITY_TIER_ORDER) config.tiers[otherTier].roleIds = config.tiers[otherTier].roleIds.filter((roleId) => !selected.includes(roleId)); config.tiers[tierKey].roleIds = selected; for (const [roleId, profile] of Object.entries(config.roleProfiles || {})) if (profile.tier === tierKey && !selected.includes(roleId)) delete config.roleProfiles[roleId]; for (const roleId of selected) { const existing = config.roleProfiles?.[roleId]; config.roleProfiles[roleId] = existing?.tier === tierKey ? existing : { tier: tierKey, permissions: { ...config.tiers[tierKey].permissions } }; } config.configured = Object.values(config.tiers).some((tier) => tier.roleIds.length > 0); saveAuthorityConfig(interaction.guild.id, config); return openRoute(interaction, `admin:authority:roles:${tierKey}`, name); }
    const map = { 'admin:staffroles:select': 'staffRoles', 'admin:modroles:select': 'modRoles', 'admin:autoRoles:select': 'autoRoles' }; const section = map[id]; if (!section) return false; const current = section === 'autoRoles' ? getAutoRolesConfig(interaction.guild.id) : getRoleConfig(interaction.guild.id, section); replaceGuildSection(interaction.guild.id, section, { ...current, roleIds: [...new Set(interaction.values || [])] }); return openRoute(interaction, section === 'staffRoles' ? 'admin:staffroles' : section === 'modRoles' ? 'admin:modroles' : 'admin:autoRoles', name);
  }
  if (interaction.isStringSelectMenu?.()) { const profileSelect = id.match(/^admin:authority:profile:select:(administrator|moderator|juniorModerator)$/); if (profileSelect) { const roleId = String(interaction.values?.[0] || ''); const config = getAuthorityConfig(interaction.guild.id); if (!config.roleProfiles?.[roleId] || config.roleProfiles[roleId].tier !== profileSelect[1]) return openRoute(interaction, `admin:authority:roles:${profileSelect[1]}`, name); return openRoute(interaction, `admin:authority:profile:${roleId}:0`, name); } }
  if (interaction.isChannelSelectMenu?.()) { const type = LOG_SELECT_TO_TYPE[id]; if (!type) return false; setLogChannelId(interaction.guild.id, LOG_TYPES[type].key, interaction.values?.[0] || null); return openRoute(interaction, 'admin:logs', name); }
  if (!interaction.isButton?.()) return false;
  const authorityRoleOpen = id.match(/^admin:authority:roles:(administrator|moderator|juniorModerator)$/); if (authorityRoleOpen) return openRoute(interaction, id, name);
  const authorityRoleClear = id.match(/^admin:authority:roles:clear:(administrator|moderator|juniorModerator)$/); if (authorityRoleClear) { const tierKey = authorityRoleClear[1]; const config = getAuthorityConfig(interaction.guild.id); for (const roleId of config.tiers[tierKey].roleIds) delete config.roleProfiles[roleId]; config.tiers[tierKey].roleIds = []; config.configured = Object.values(config.tiers).some((tier) => tier.roleIds.length > 0); saveAuthorityConfig(interaction.guild.id, config); return openRoute(interaction, `admin:authority:roles:${tierKey}`, name); }
  const authorityPermissionOpen = id.match(/^admin:authority:permissions:(administrator|moderator|juniorModerator):(\d+)$/); if (authorityPermissionOpen) return openRoute(interaction, id, name);
  const authorityToggle = id.match(/^admin:authority:toggle:(administrator|moderator|juniorModerator):(\d+):(\d+)$/); if (authorityToggle) { const [, tierKey, permissionIndexRaw, pageRaw] = authorityToggle; const entry = GUILD_PERMISSION_CATALOG[Number(permissionIndexRaw)]; if (!entry) return openRoute(interaction, `admin:authority:permissions:${tierKey}:${Number(pageRaw) || 0}`, name); const config = getAuthorityConfig(interaction.guild.id); config.tiers[tierKey].permissions[entry.key] = !config.tiers[tierKey].permissions[entry.key]; saveAuthorityConfig(interaction.guild.id, config); return openRoute(interaction, `admin:authority:permissions:${tierKey}:${Number(pageRaw) || 0}`, name); }
  const authorityProfileOpen = id.match(/^admin:authority:profile:(\d{15,25}):(\d+)$/); if (authorityProfileOpen) return openRoute(interaction, id, name);
  const authorityProfileToggle = id.match(/^admin:authority:profile:toggle:(\d{15,25}):(\d+):(\d+)$/); if (authorityProfileToggle) { const [, roleId, permissionIndexRaw, pageRaw] = authorityProfileToggle; const entry = GUILD_PERMISSION_CATALOG[Number(permissionIndexRaw)]; const config = getAuthorityConfig(interaction.guild.id); const profile = config.roleProfiles?.[roleId]; if (!entry || !profile) return openRoute(interaction, 'admin:authority', name); profile.permissions[entry.key] = !profile.permissions[entry.key]; saveAuthorityConfig(interaction.guild.id, config); return openRoute(interaction, `admin:authority:profile:${roleId}:${Number(pageRaw) || 0}`, name); }
  const authorityProfileReset = id.match(/^admin:authority:profile:reset:(\d{15,25}):(\d+)$/); if (authorityProfileReset) { const [, roleId, pageRaw] = authorityProfileReset; const config = getAuthorityConfig(interaction.guild.id); const profile = config.roleProfiles?.[roleId]; if (!profile || !config.tiers[profile.tier]) return openRoute(interaction, 'admin:authority', name); profile.permissions = { ...config.tiers[profile.tier].permissions }; saveAuthorityConfig(interaction.guild.id, config); return openRoute(interaction, `admin:authority:profile:${roleId}:${Number(pageRaw) || 0}`, name); }
  if (id === 'admin:purge') { if (!hasGuildPermission(interaction, 'admin.purge')) return deny(interaction); await interaction.showModal(buildPurgeModal()); return true; }
  if (id === 'admin:modpanel') { if (!hasGuildPermission(interaction, 'mod.panel.view')) return deny(interaction); await interaction.deferUpdate(); await modPanel.openModPanel(interaction); return true; }
  if (LOG_BUTTON_TO_TYPE[id]) return updatePanel(interaction, buildChannelPanel(LOG_BUTTON_TO_TYPE[id]), `admin:channel:${LOG_BUTTON_TO_TYPE[id]}`);
  if (id === 'admin:embed') { const { buildEmbedPanel } = require('../../../modules/messageStudio/embed/embedPanel'); return updatePanel(interaction, buildEmbedPanel(interaction, name), 'admin:embed'); }
  if (id === 'admin:tickets') { const { sendSetupPanel } = require('../../../modules/feedbackStudio/tickets/ticketsPanel'); return sendSetupPanel(interaction); }
  if (id === 'admin:autoRoles:toggle') { const current = getAutoRolesConfig(interaction.guild.id); replaceGuildSection(interaction.guild.id, 'autoRoles', { ...current, enabled: !current.enabled, roleIds: current.roleIds || [] }); return openRoute(interaction, 'admin:autoRoles', name); }
  if (id === 'admin:staffroles:clear' || id === 'admin:modroles:clear') { const route = id.includes('staffroles') ? 'admin:staffroles' : 'admin:modroles'; replaceGuildSection(interaction.guild.id, route === 'admin:staffroles' ? 'staffRoles' : 'modRoles', { roleIds: [] }); return openRoute(interaction, route, name); }
  if (id === 'admin:backup:create') { if (!hasGuildPermission(interaction, 'admin.backups.create')) return deny(interaction); await interaction.deferUpdate(); await createServerBackup(interaction.guild, { createdBy: interaction.user.id, reason: 'Manual backup from admin panel' }); return interaction.editReply(applyNavigationUI(interaction, buildBackupsPanel(interaction.guild, name, interaction), canonicalState('admin:backups'))); }
  if (id === 'admin:backup:list') { const backups = listServerBackups(interaction.guild.id).map(normalizeBackupId).filter(Boolean); await interaction.reply({ content: backups.length ? `📦 **Backups:**\n${backups.slice(0, 10).map((value) => `\`${value}\``).join('\n')}` : '📦 No backups found.', flags: 64 }); return true; }
  if (id === 'admin:backup:preview') { const latest = normalizeBackupId(listServerBackups(interaction.guild.id)[0]); const backup = latest ? readServerBackup(interaction.guild.id, latest) : null; const validation = backup ? validateServerBackup(backup, { guildId: interaction.guild.id }) : null; await interaction.reply({ content: backup ? `🔍 **Latest Backup**\nID: \`${latest}\`\nValid: ${validation?.valid ? 'YES ✅' : 'NO ❌'}` : '🔍 No backups found.', flags: 64 }); return true; }
  if (id === 'admin:backup:download') { const latest = normalizeBackupId(listServerBackups(interaction.guild.id)[0]); const backup = latest ? readServerBackup(interaction.guild.id, latest) : null; if (!backup) { await interaction.reply({ content: '❌ No backups found.', flags: 64 }); return true; } await interaction.reply({ content: `💾 Backup: ${latest}`, files: [{ attachment: Buffer.from(JSON.stringify(backup, null, 2)), name: `${latest}.json` }], flags: 64 }); return true; }
  if (id === 'admin:backup:requestrestore') { if (!hasGuildPermission(interaction, 'admin.backups.requestRestore')) return deny(interaction); return restoreRequestManager.createRestoreRequest(interaction, { cooldownMs: 1800000 }); }
  if (['admin:backup:restore', 'admin:backup:restore:real'].includes(id)) { await interaction.reply({ content: '❌ Direct restores are disabled. Use the centralized restore approval system.', flags: 64 }); return true; }
  const routes = ['admin:home', 'admin:adminpanel', 'admin:authority', 'admin:logs', 'admin:backups', 'admin:staffroles', 'admin:modroles', 'admin:autoRoles']; if (routes.includes(id)) return openRoute(interaction, id, name); return false;
}

module.exports = { LOG_TYPES, AUTHORITY_TIERS, GUILD_PERMISSION_CATALOG, buildAdminPanel, buildAdminToolsPanel, buildAuthorityPanel, buildAuthorityRolesPanel, buildAuthorityPermissionsPanel, buildAuthorityRoleProfilePanel, buildBackupsPanel, buildStaffRolesPanel, buildModRolesPanel, buildModulesPanel, buildLogsPanel, buildAutoRolesPanel, buildChannelPanel, buildComingSoonPanel, buildPurgeModal, getAuthorityConfig, saveAuthorityConfig, getMatchedAuthorityProfiles, getMatchedAuthorityTiers, getAuthorityContext, hasGuildPermission, canManageGuildAuthority, canManageStudio, canManageModule, getLogChannelId, setLogChannelId, handleAdminNavigation, updatePanel, openExternalAdminPanel: async (interaction, panel) => { await interaction.update(applyNavigationUI(interaction, panel, canonicalState('admin:home'))); return true; }, applyNavigationUI, getCurrentRoute: () => 'admin:home', setCurrentRoute: () => true, pushHistory: () => true, popHistory: () => 'admin:home', getBreadcrumb: () => 'Admin Hub' };
