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
  { key: 'mod.scan.history', label: 'View Member Scan History', group: 'Member Scan' },
  { key: 'mod.scan.compare', label: 'Compare Member Scans', group: 'Member Scan' },
  { key: 'mod.scan.suspectedAccounts', label: 'View Suspected Accounts', group: 'Member Scan' },
  { key: 'mod.scan.network', label: 'View Member Network', group: 'Member Scan' },
  { key: 'mod.scan.notes', label: 'Manage Member Scan Notes', group: 'Member Scan' },
  { key: 'mod.scan.watch', label: 'Manage Member Watchlist', group: 'Member Scan' },
  { key: 'mod.scan.links', label: 'Manage Member Links', group: 'Member Scan' },
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
  if (isBotOwner(interaction)) return { source: 'goliathOwner', bypass: true, tiers: ['administrator'], profiles: [], configured: true };
  if (isGuildOwner(interaction)) return { source: 'guildOwner', bypass: true, tiers: ['administrator'], profiles: [], configured: true };
  const config = getAuthorityConfig(interaction.guild?.id); const profiles = getMatchedAuthorityProfiles(interaction, config); const tiers = [...new Set(profiles.map((profile) => profile.tier))];
  if (!config.configured) return { source: 'discordFallback', bypass: false, tiers: [], profiles: [], configured: false };
  return { source: 'configuredRoles', bypass: false, tiers, profiles, configured: true };
}
function hasDiscordPermission(interaction, permission) { try { return Boolean(interaction.memberPermissions?.has?.(permission)); } catch { return false; } }
function hasGuildPermission(interaction, permissionKey) {
  const context = getAuthorityContext(interaction); if (context.bypass) return true;
  if (!context.configured) {
    if (permissionKey === 'admin.dashboard.view') return hasDiscordPermission(interaction, PermissionFlagsBits.ManageGuild) || hasDiscordPermission(interaction, PermissionFlagsBits.Administrator);
    if (permissionKey.startsWith('admin.')) return hasDiscordPermission(interaction, PermissionFlagsBits.Administrator);
    return hasDiscordPermission(interaction, PermissionFlagsBits.ManageMessages) || hasDiscordPermission(interaction, PermissionFlagsBits.ModerateMembers) || hasDiscordPermission(interaction, PermissionFlagsBits.Administrator);
  }
  return context.profiles.some((profile) => profile.permissions?.[permissionKey] === true);
}
function hasAnyStudioAccess(interaction) { const context = getAuthorityContext(interaction); if (context.bypass || !context.configured) return true; return context.profiles.some((profile) => profile.permissions?.['admin.modules.manage'] || Object.keys(profile.permissions || {}).some((key) => key.startsWith('studio.') && profile.permissions[key])); }
function hasAnyModuleAccess(interaction) { const context = getAuthorityContext(interaction); if (context.bypass || !context.configured) return true; return context.profiles.some((profile) => profile.permissions?.['admin.modules.manage'] || Object.keys(profile.permissions || {}).some((key) => key.startsWith('module.') && profile.permissions[key])); }
function canManageStudio(interaction, studioKey) { return hasGuildPermission(interaction, 'admin.modules.manage') || hasGuildPermission(interaction, studioPermissionKey(studioKey)); }
function canManageModule(interaction, moduleKey) { const module = MODULE_BY_KEY[moduleKey]; return hasGuildPermission(interaction, 'admin.modules.manage') || (module && hasGuildPermission(interaction, studioPermissionKey(module.studio))) || hasGuildPermission(interaction, modulePermissionKey(moduleKey)); }

function deny(interaction, message = '❌ You do not have permission to use this control.') { if (interaction.deferred || interaction.replied) return interaction.followUp({ content: message, flags: 64 }); return interaction.reply({ content: message, flags: 64 }); }
function updatePanel(interaction, payload, route) { const withNav = applyNavigationUI(interaction, payload, canonicalState(route)); if (interaction.deferred || interaction.replied) return interaction.editReply(withNav); return interaction.update(withNav); }
function canonicalState(route) { return panelNav.normalize({ route, history: ['admin:home'] }); }
function buildBackButton(route = 'admin:home') { return row(button(`admin:nav:open:${route}`, '⬅ Back', ButtonStyle.Secondary)); }
function appendBack(payload, route = 'admin:home') { return { ...payload, components: [...(payload.components || []), buildBackButton(route)] }; }
function applyNavigationUI(interaction, payload, state) { return panelNav.applyNavigationUI(payload, state, { isOwner: isBotOwner(interaction), canAccessAdmin: hasGuildPermission(interaction, 'admin.dashboard.view') }); }

function buildAdminPanel(guild, name = 'Goliath', interaction = null) {
  const title = `${name} Administration`;
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(title).setDescription('Manage Goliath configuration, modules, moderation, security, backups, and server operations.');
  const controls = [
    row(button('admin:adminpanel', '⚙️ Admin Panel'), button('admin:modpanel', '🛡️ Mod Panel', ButtonStyle.Secondary)),
    row(button('admin:authority', '👑 Authority'), button('admin:logs', '📋 Logs', ButtonStyle.Secondary), button('admin:backups', '💾 Backups', ButtonStyle.Secondary)),
    row(button('admin:embed', '📝 Embed Studio', ButtonStyle.Secondary), button('admin:tickets', '🎫 Tickets', ButtonStyle.Secondary)),
  ];
  return applyNavigationUI(interaction, { embeds: [embed], components: controls }, canonicalState('admin:home'));
}

function buildAdminControlsPanel(guild, name = 'Goliath', interaction = null) {
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} Admin Controls`).setDescription('Configure administration modules and server controls.');
  return applyNavigationUI(interaction, { embeds: [embed], components: [row(button('admin:automod', '🤖 AutoMod'), button('admin:modules', '🧩 Modules', ButtonStyle.Secondary)), buildBackButton('admin:home')] }, canonicalState('admin:adminpanel'));
}

function buildAuthorityPanel(guild, name = 'Goliath', interaction = null) {
  const config = getAuthorityConfig(guild.id); const context = interaction ? getAuthorityContext(interaction) : { source: 'unknown', tiers: [] };
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle('👑 Goliath Authority').setDescription('Configure which Discord roles can access Goliath administration and moderation features.').addFields(
    { name: 'Status', value: config.configured ? '🟢 Configured' : '🟡 Not configured — Discord permission fallback is active.', inline: false },
    ...AUTHORITY_TIER_ORDER.map((tierKey) => ({ name: `${AUTHORITY_TIERS[tierKey].emoji} ${AUTHORITY_TIERS[tierKey].label}`, value: formatRoleList(config.tiers[tierKey].roleIds), inline: false })),
    { name: 'Your Access', value: context.bypass ? `Full access (${context.source})` : context.tiers.length ? context.tiers.map((tier) => AUTHORITY_TIERS[tier].label).join(', ') : config.configured ? 'No configured Goliath authority role.' : 'Discord permission fallback.', inline: false },
  );
  const controls = AUTHORITY_TIER_ORDER.map((tierKey) => row(button(`admin:authority:roles:${tierKey}`, `${AUTHORITY_TIERS[tierKey].emoji} ${AUTHORITY_TIERS[tierKey].label} Roles`), button(`admin:authority:permissions:${tierKey}:0`, 'Permissions', ButtonStyle.Secondary)));
  controls.push(buildBackButton('admin:home'));
  return applyNavigationUI(interaction, { embeds: [embed], components: controls }, canonicalState('admin:authority'));
}

function buildAuthorityRolePanel(guild, tierKey, name = 'Goliath', interaction = null) {
  const tier = AUTHORITY_TIERS[tierKey]; const config = getAuthorityConfig(guild.id); const selected = config.tiers[tierKey].roleIds;
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${tier.emoji} ${tier.label} Roles`).setDescription(`${tier.description}\n\nSelected: ${formatRoleList(selected)}`);
  const selector = new RoleSelectMenuBuilder().setCustomId(`admin:authority:roles:select:${tierKey}`).setPlaceholder(`Select ${tier.label} roles`).setMinValues(0).setMaxValues(10);
  const controls = [row(selector), row(button(`admin:authority:roles:clear:${tierKey}`, 'Clear Roles', ButtonStyle.Danger), button(`admin:authority:permissions:${tierKey}:0`, 'Permissions', ButtonStyle.Secondary)), buildBackButton('admin:authority')];
  return applyNavigationUI(interaction, { embeds: [embed], components: controls }, canonicalState(`admin:authority:roles:${tierKey}`));
}

function buildAuthorityPermissionsPanel(guild, tierKey, page = 0, name = 'Goliath', interaction = null) {
  const tier = AUTHORITY_TIERS[tierKey]; const config = getAuthorityConfig(guild.id); const permissions = config.tiers[tierKey].permissions; const perPage = AUTHORITY_PER_PAGE; const pages = Math.max(1, Math.ceil(GUILD_PERMISSION_CATALOG.length / perPage)); const safePage = Math.max(0, Math.min(Number(page) || 0, pages - 1)); const entries = GUILD_PERMISSION_CATALOG.slice(safePage * perPage, safePage * perPage + perPage);
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${tier.emoji} ${tier.label} Permissions`).setDescription(`Page ${safePage + 1}/${pages}\nToggle the capabilities granted to every role in this tier.`).addFields(entries.map((entry) => ({ name: `${permissions[entry.key] ? '🟢' : '🔴'} ${entry.label}`, value: `${entry.group} • \`${entry.key}\``, inline: false })));
  const controls = entries.map((entry, index) => row(button(`admin:authority:toggle:${tierKey}:${safePage * perPage + index}:${safePage}`, permissions[entry.key] ? `Disable ${entry.label}` : `Enable ${entry.label}`, permissions[entry.key] ? ButtonStyle.Danger : ButtonStyle.Success)));
  controls.push(row(button(`admin:authority:permissions:${tierKey}:${Math.max(0, safePage - 1)}`, '◀ Previous', ButtonStyle.Secondary, safePage === 0), button(`admin:authority:permissions:${tierKey}:${Math.min(pages - 1, safePage + 1)}`, 'Next ▶', ButtonStyle.Secondary, safePage >= pages - 1)), buildBackButton('admin:authority'));
  return applyNavigationUI(interaction, { embeds: [embed], components: controls }, canonicalState(`admin:authority:permissions:${tierKey}:${safePage}`));
}

function buildAuthorityProfilePanel(guild, roleId, page = 0, name = 'Goliath', interaction = null) {
  const config = getAuthorityConfig(guild.id); const profile = config.roleProfiles?.[roleId]; if (!profile) return buildAuthorityPanel(guild, name, interaction); const tier = AUTHORITY_TIERS[profile.tier]; const perPage = AUTHORITY_PER_PAGE; const pages = Math.max(1, Math.ceil(GUILD_PERMISSION_CATALOG.length / perPage)); const safePage = Math.max(0, Math.min(Number(page) || 0, pages - 1)); const entries = GUILD_PERMISSION_CATALOG.slice(safePage * perPage, safePage * perPage + perPage);
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`🎯 Role Profile • ${tier.label}`).setDescription(`<@&${roleId}>\nPage ${safePage + 1}/${pages}\nOverride individual permissions for this role.`).addFields(entries.map((entry) => ({ name: `${profile.permissions[entry.key] ? '🟢' : '🔴'} ${entry.label}`, value: `${entry.group} • \`${entry.key}\``, inline: false })));
  const controls = entries.map((entry, index) => row(button(`admin:authority:profile:toggle:${roleId}:${safePage * perPage + index}:${safePage}`, profile.permissions[entry.key] ? `Disable ${entry.label}` : `Enable ${entry.label}`, profile.permissions[entry.key] ? ButtonStyle.Danger : ButtonStyle.Success)));
  controls.push(row(button(`admin:authority:profile:${roleId}:${Math.max(0, safePage - 1)}`, '◀ Previous', ButtonStyle.Secondary, safePage === 0), button(`admin:authority:profile:${roleId}:${Math.min(pages - 1, safePage + 1)}`, 'Next ▶', ButtonStyle.Secondary, safePage >= pages - 1)), row(button(`admin:authority:profile:reset:${roleId}:${safePage}`, 'Reset to Tier', ButtonStyle.Danger)), buildBackButton(`admin:authority:roles:${profile.tier}`));
  return applyNavigationUI(interaction, { embeds: [embed], components: controls }, canonicalState(`admin:authority:profile:${roleId}:${safePage}`));
}

function buildLogPanel(guild, name = 'Goliath', interaction = null) { const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} Log Channels`).setDescription('Configure destination channels for Goliath operational logs.'); return applyNavigationUI(interaction, { embeds: [embed], components: [...Object.entries(LOG_TYPES).map(([key, entry]) => row(button(entry.customId, entry.label, ButtonStyle.Secondary))), buildBackButton('admin:home')] }, canonicalState('admin:logs')); }
function getLogChannelId(guildId, key) { return getGuildSection(guildId, 'logs', {})?.[key] || null; }
function buildChannelPanel(type, guild, name = 'Goliath', interaction = null) { const entry = LOG_TYPES[type]; const current = getLogChannelId(guild.id, entry.key); const selector = new ChannelSelectMenuBuilder().setCustomId(entry.selectId).setPlaceholder(`Select ${entry.label} channel`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(entry.title).setDescription(`Current: ${current ? `<#${current}>` : 'Not configured'}`); return appendBack(applyNavigationUI(interaction, { embeds: [embed], components: [row(selector)] }, canonicalState(`admin:channel:${type}`)), 'admin:logs'); }
function buildBackupPanel(guild, name = 'Goliath', interaction = null) { const backups = listServerBackups(guild.id); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} Backups`).setDescription(backups.length ? backups.slice(0, 10).map((backup) => `• \`${normalizeBackupId(backup)}\``).join('\n') : 'No backups found.'); return applyNavigationUI(interaction, { embeds: [embed], components: [row(button('admin:backup:create', 'Create Backup'), button('admin:backup:restore', 'Restore Backup', ButtonStyle.Danger, !backups.length)), buildBackButton('admin:home')] }, canonicalState('admin:backups')); }
function buildRolePanel(guild, section, title, name = 'Goliath', interaction = null) { const config = getRoleConfig(guild.id, section); const selector = new RoleSelectMenuBuilder().setCustomId(`admin:${section}:select`).setPlaceholder(`Select ${title}`).setMinValues(0).setMaxValues(10); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} • ${title}`).setDescription(formatRoleList(config.roleIds)); return appendBack(applyNavigationUI(interaction, { embeds: [embed], components: [row(selector), row(button(`admin:${section}:clear`, 'Clear', ButtonStyle.Danger))] }, canonicalState(`admin:${section}`)), 'admin:home'); }
function buildAutoRolesPanel(guild, name = 'Goliath', interaction = null) { const config = getAutoRolesConfig(guild.id); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} Auto Roles`).setDescription(`Status: ${config.enabled ? 'Enabled' : 'Disabled'}\nRoles: ${formatRoleList(config.roleIds)}`); return appendBack(applyNavigationUI(interaction, { embeds: [embed], components: [row(button('admin:autoRoles:toggle', config.enabled ? 'Disable' : 'Enable', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success))] }, canonicalState('admin:autoRoles')), 'admin:home'); }
function buildRestorePanel(guild, name = 'Goliath', interaction = null) { const backups = listServerBackups(guild.id); const options = backups.slice(0, 25).map((backup) => ({ label: String(normalizeBackupId(backup)).slice(0, 100), value: String(normalizeBackupId(backup)).slice(0, 100) })); const selector = new StringSelectMenuBuilder().setCustomId('admin:backup:restore:select').setPlaceholder('Select a backup').addOptions(options); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${name} Restore Backup`).setDescription('Choose a backup to request restore.'); return appendBack(applyNavigationUI(interaction, { embeds: [embed], components: [row(selector)] }, canonicalState('admin:backup:restore')), 'admin:backups'); }

function openRoute(interaction, route, name) {
  if (!interaction?.guild) return false;
  if (route === 'admin:home') return updatePanel(interaction, buildAdminPanel(interaction.guild, name, interaction), route);
  if (route === 'admin:adminpanel') { if (!hasGuildPermission(interaction, 'admin.dashboard.view')) return deny(interaction); return updatePanel(interaction, buildAdminControlsPanel(interaction.guild, name, interaction), route); }
  if (route === 'admin:authority') { if (!getAuthorityContext(interaction).bypass) return deny(interaction, '❌ Only the Goliath owner or Discord server owner can manage Goliath Authority.'); return updatePanel(interaction, buildAuthorityPanel(interaction.guild, name, interaction), route); }
  if (route === 'admin:logs') { if (!hasGuildPermission(interaction, 'admin.logs.manage')) return deny(interaction); return updatePanel(interaction, buildLogPanel(interaction.guild, name, interaction), route); }
  if (route === 'admin:backups') { if (!hasGuildPermission(interaction, 'admin.backups.view')) return deny(interaction); return updatePanel(interaction, buildBackupPanel(interaction.guild, name, interaction), route); }
  if (route === 'admin:staffroles') return updatePanel(interaction, buildRolePanel(interaction.guild, 'staffRoles', 'Staff Roles', name, interaction), route);
  if (route === 'admin:modroles') return updatePanel(interaction, buildRolePanel(interaction.guild, 'modRoles', 'Moderator Roles', name, interaction), route);
  if (route === 'admin:autoRoles') return updatePanel(interaction, buildAutoRolesPanel(interaction.guild, name, interaction), route);
  if (MODULE_ROUTES.has(route)) { const module = MODULE_BY_ROUTE[route]; if (!canManageModule(interaction, module?.key)) return deny(interaction); return moduleAdminPanels.openRoute(interaction, route, name); }
  return false;
}

async function handleAdminInteraction(interaction, name = 'Goliath') {
  const id = String(interaction?.customId || ''); if (!id.startsWith('admin:')) return false;
  if (id.startsWith('admin:nav:open:')) return openRoute(interaction, id.slice('admin:nav:open:'.length), name);
  if (id.startsWith('admin:authority:')) { if (!getAuthorityContext(interaction).bypass) return deny(interaction, '❌ Only the Goliath owner or Discord server owner can manage Goliath Authority.'); const parts=id.split(':'); if(parts[2]==='roles'&&parts[3]==='select'){ const tier=parts[4],config=getAuthorityConfig(interaction.guild.id),roleIds=[...new Set(interaction.values||[])]; config.tiers[tier].roleIds=roleIds; config.roleProfiles={}; for(const tierKey of AUTHORITY_TIER_ORDER) for(const roleId of config.tiers[tierKey].roleIds) config.roleProfiles[roleId]={tier:tierKey,permissions:{...config.tiers[tierKey].permissions}}; saveAuthorityConfig(interaction.guild.id,config); return updatePanel(interaction,buildAuthorityRolePanel(interaction.guild,tier,name,interaction),`admin:authority:roles:${tier}`);} if(parts[2]==='roles'&&parts[3]==='clear'){ const tier=parts[4],config=getAuthorityConfig(interaction.guild.id); config.tiers[tier].roleIds=[]; config.roleProfiles={}; for(const tierKey of AUTHORITY_TIER_ORDER) for(const roleId of config.tiers[tierKey].roleIds) config.roleProfiles[roleId]={tier:tierKey,permissions:{...config.tiers[tierKey].permissions}}; saveAuthorityConfig(interaction.guild.id,config); return updatePanel(interaction,buildAuthorityRolePanel(interaction.guild,tier,name,interaction),`admin:authority:roles:${tier}`);} if(parts[2]==='permissions'){ return updatePanel(interaction,buildAuthorityPermissionsPanel(interaction.guild,parts[3],parts[4],name,interaction),id);} if(parts[2]==='toggle'){ const tier=parts[3],index=Number(parts[4]),page=Number(parts[5]||0),config=getAuthorityConfig(interaction.guild.id),entry=GUILD_PERMISSION_CATALOG[index]; if(entry){ config.tiers[tier].permissions[entry.key]=!config.tiers[tier].permissions[entry.key]; for(const roleId of config.tiers[tier].roleIds){ if(config.roleProfiles[roleId]?.tier===tier) config.roleProfiles[roleId].permissions[entry.key]=config.tiers[tier].permissions[entry.key]; } saveAuthorityConfig(interaction.guild.id,config);} return updatePanel(interaction,buildAuthorityPermissionsPanel(interaction.guild,tier,page,name,interaction),`admin:authority:permissions:${tier}:${page}`);} }
  if (LOG_SELECT_TO_TYPE[id]) { const type=LOG_SELECT_TO_TYPE[id], logs=getGuildSection(interaction.guild.id,'logs',{}); logs[LOG_TYPES[type].key]=interaction.values?.[0]||null; replaceGuildSection(interaction.guild.id,'logs',logs); return updatePanel(interaction,buildChannelPanel(type,interaction.guild,name,interaction),`admin:channel:${type}`); }
  if (id === 'admin:backup:create') { if (!hasGuildPermission(interaction,'admin.backups.create')) return deny(interaction); await createServerBackup(interaction.guild); return updatePanel(interaction,buildBackupPanel(interaction.guild,name,interaction),'admin:backups'); }
  if (id === 'admin:backup:restore') { if (!hasGuildPermission(interaction,'admin.backups.requestRestore')) return deny(interaction); return updatePanel(interaction,buildRestorePanel(interaction.guild,name,interaction),'admin:backup:restore'); }
  if (id === 'admin:backup:restore:select') { if (!hasGuildPermission(interaction,'admin.backups.requestRestore')) return deny(interaction); const backupId=interaction.values?.[0]; const backup=readServerBackup(interaction.guild.id,backupId); const validation=backup?validateServerBackup(backup):{valid:false,errors:['Backup not found']}; if(!validation.valid)return deny(interaction,`❌ Backup invalid: ${validation.errors.join(', ')}`); await restoreRequestManager.createRestoreRequest(interaction, backupId); return true; }
  if (id === 'admin:modpanel') { if (!hasGuildPermission(interaction,'mod.panel.view')) return deny(interaction); return updatePanel(interaction,modPanel.buildModPanel(interaction.guild,name,interaction),'mod:home'); }
  if (id === 'admin:automod') { if (!hasGuildPermission(interaction,'admin.automod.manage')) return deny(interaction); return updatePanel(interaction,automodPanel.buildAdminPanel(interaction.guild,name,interaction),'admin:automod'); }
  if (id === 'admin:modules') { if (!hasAnyStudioAccess(interaction)&&!hasAnyModuleAccess(interaction)) return deny(interaction); return moduleAdminPanels.openRoute(interaction,'admin:modules',name); }
  if (id === 'admin:embed') { const embedStudio = require('../../../modules/messageStudio/embed/embed'); return updatePanel(interaction, embedStudio.panel.buildEmbedPanel(interaction, name), 'admin:embed'); }
  if (id === 'admin:tickets') { const { sendSetupPanel } = require('../../../modules/feedbackStudio/tickets/ticketsPanel'); return sendSetupPanel(interaction); }
  if (id === 'admin:autoRoles:toggle') { const current = getAutoRolesConfig(interaction.guild.id); replaceGuildSection(interaction.guild.id, 'autoRoles', { ...current, enabled: !current.enabled, roleIds: current.roleIds || [] }); return openRoute(interaction, 'admin:autoRoles', name); }
  if (id === 'admin:staffroles:clear' || id === 'admin:modroles:clear') { const route = id.includes('staffroles') ? 'admin:staffroles' : 'admin:modroles'; replaceGuildSection(interaction.guild.id, route === 'admin:staffroles' ? 'staffRoles' : 'modRoles', { roleIds: [] }); return openRoute(interaction, route, name); }
  const routes = ['admin:home', 'admin:adminpanel', 'admin:authority', 'admin:logs', 'admin:backups', 'admin:staffroles', 'admin:modroles', 'admin:autoRoles']; if (routes.includes(id)) return openRoute(interaction, id, name); return false;
}

module.exports = { buildAdminPanel, handleAdminInteraction, getAuthorityConfig, hasGuildPermission, getAuthorityContext, canManageGuildAuthority: (interaction) => Boolean(getAuthorityContext(interaction).bypass), GUILD_PERMISSION_CATALOG };