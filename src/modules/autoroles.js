'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../core/guild/moduleSectionManager');
const guildManager = require('../core/guild/guildManager');

const MODULE = 'autoRoles';

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanRoleIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanDiscordId).filter(Boolean))];
}

function cleanCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultAnalytics() {
  return {
    assigned: 0,
    failed: 0,
    skipped: 0,
    membersProcessed: 0,
    botsProcessed: 0,
    lastAssignedAt: null,
    lastFailedAt: null,
    lastProcessedAt: null,
  };
}

function defaultAutoRolesSection() {
  return {
    enabled: true,
    joinRoles: [],
    botRoles: [],
    settings: {
      applyToBots: false,
      auditLog: true,
      reapplyOnStartup: false,
      ignoreExistingRoles: true,
    },
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAnalytics(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...defaultAnalytics(),
    ...clone(source),
    assigned: cleanCount(source.assigned),
    failed: cleanCount(source.failed),
    skipped: cleanCount(source.skipped),
    membersProcessed: cleanCount(source.membersProcessed),
    botsProcessed: cleanCount(source.botsProcessed),
    lastAssignedAt: cleanDate(source.lastAssignedAt),
    lastFailedAt: cleanDate(source.lastFailedAt),
    lastProcessedAt: cleanDate(source.lastProcessedAt),
  };
}

function normalizeAutoRolesSection(section = {}) {
  const base = defaultAutoRolesSection();
  const source = section && typeof section === 'object' ? section : {};
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled !== false,
    joinRoles: cleanRoleIds(source.joinRoles || source.roleIds || source.roles),
    botRoles: cleanRoleIds(source.botRoles),
    settings: {
      ...base.settings,
      ...(source.settings && typeof source.settings === 'object' ? clone(source.settings) : {}),
      applyToBots: source.settings?.applyToBots === true,
      auditLog: source.settings?.auditLog !== false,
      reapplyOnStartup: source.settings?.reapplyOnStartup === true,
      ignoreExistingRoles: source.settings?.ignoreExistingRoles !== false,
    },
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getAutoRolesSection(guildId) {
  return normalizeAutoRolesSection(getModuleSection(guildId, MODULE, defaultAutoRolesSection()));
}

function saveAutoRolesSection(guildId, section, meta = {}) {
  return normalizeAutoRolesSection(saveModuleSection(guildId, MODULE, normalizeAutoRolesSection(section), meta));
}

function updateAutoRolesSection(guildId, updater, meta = {}) {
  return normalizeAutoRolesSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeAutoRolesSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeAutoRolesSection(next);
    },
    defaultAutoRolesSection(),
    meta
  ));
}

function setEnabled(guildId, enabled = true, meta = {}) {
  return updateAutoRolesSection(guildId, (section) => ({ ...section, enabled: enabled !== false, updatedAt: now() }), meta);
}

function setJoinRoles(guildId, roleIds = [], meta = {}) {
  return updateAutoRolesSection(guildId, (section) => ({ ...section, joinRoles: cleanRoleIds(roleIds), updatedAt: now() }), meta);
}

function addJoinRole(guildId, roleId, meta = {}) {
  const safeRoleId = cleanDiscordId(roleId);
  if (!safeRoleId) throw new Error('A valid role ID is required.');
  return updateAutoRolesSection(guildId, (section) => ({ ...section, joinRoles: [...new Set([...(section.joinRoles || []), safeRoleId])], updatedAt: now() }), meta);
}

function removeJoinRole(guildId, roleId, meta = {}) {
  const safeRoleId = cleanDiscordId(roleId);
  if (!safeRoleId) throw new Error('A valid role ID is required.');
  return updateAutoRolesSection(guildId, (section) => ({ ...section, joinRoles: (section.joinRoles || []).filter((id) => id !== safeRoleId), updatedAt: now() }), meta);
}

function setBotRoles(guildId, roleIds = [], meta = {}) {
  return updateAutoRolesSection(guildId, (section) => ({ ...section, botRoles: cleanRoleIds(roleIds), updatedAt: now() }), meta);
}

function addBotRole(guildId, roleId, meta = {}) {
  const safeRoleId = cleanDiscordId(roleId);
  if (!safeRoleId) throw new Error('A valid role ID is required.');
  return updateAutoRolesSection(guildId, (section) => ({ ...section, botRoles: [...new Set([...(section.botRoles || []), safeRoleId])], updatedAt: now() }), meta);
}

function removeBotRole(guildId, roleId, meta = {}) {
  const safeRoleId = cleanDiscordId(roleId);
  if (!safeRoleId) throw new Error('A valid role ID is required.');
  return updateAutoRolesSection(guildId, (section) => ({ ...section, botRoles: (section.botRoles || []).filter((id) => id !== safeRoleId), updatedAt: now() }), meta);
}

function updateSettings(guildId, settings = {}, meta = {}) {
  const input = settings && typeof settings === 'object' ? settings : {};
  return updateAutoRolesSection(guildId, (section) => ({
    ...section,
    settings: {
      ...(section.settings || {}),
      ...input,
      applyToBots: typeof input.applyToBots === 'boolean' ? input.applyToBots : section.settings?.applyToBots === true,
      auditLog: typeof input.auditLog === 'boolean' ? input.auditLog : section.settings?.auditLog !== false,
      reapplyOnStartup: typeof input.reapplyOnStartup === 'boolean' ? input.reapplyOnStartup : section.settings?.reapplyOnStartup === true,
      ignoreExistingRoles: typeof input.ignoreExistingRoles === 'boolean' ? input.ignoreExistingRoles : section.settings?.ignoreExistingRoles !== false,
    },
    updatedAt: now(),
  }), meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateAutoRolesSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = {
      ...analytics,
      assigned: cleanCount(analytics.assigned + cleanCount(increments.assigned)),
      failed: cleanCount(analytics.failed + cleanCount(increments.failed)),
      skipped: cleanCount(analytics.skipped + cleanCount(increments.skipped)),
      membersProcessed: cleanCount(analytics.membersProcessed + cleanCount(increments.membersProcessed)),
      botsProcessed: cleanCount(analytics.botsProcessed + cleanCount(increments.botsProcessed)),
      lastProcessedAt: timestamp,
    };
    if (cleanCount(increments.assigned) > 0) next.lastAssignedAt = timestamp;
    if (cleanCount(increments.failed) > 0) next.lastFailedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

function resetAutoRolesSection(guildId, meta = {}) {
  return saveAutoRolesSection(guildId, defaultAutoRolesSection(), { action: 'auto_roles_reset', ...meta });
}

function canManageAutoRoles(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator)
    || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    || member?.permissions?.has(PermissionFlagsBits.ManageRoles)
  );
}

function getBotMember(guild) {
  return guild?.members?.me || guild?.members?.cache?.get(guild.client.user.id) || null;
}

function canBotManageRole(guild, role) {
  const botMember = getBotMember(guild);
  if (!botMember || !role || role.managed || role.id === guild.id) return false;
  return Boolean(botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position);
}

function canBotManageMember(member) {
  const botMember = getBotMember(member?.guild);
  if (!botMember || !member || member.id === botMember.id || member.guild?.ownerId === member.id) return false;
  return botMember.roles.highest.position > member.roles.highest.position;
}

async function fetchRole(guild, roleId) {
  if (!guild || !roleId) return null;
  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

async function validateManageableRole(guild, roleId) {
  const role = await fetchRole(guild, roleId);
  if (!role) throw new Error('Role not found.');
  if (!canBotManageRole(guild, role)) throw new Error('I cannot manage that role. Move my role above it and make sure I have Manage Roles.');
  return role;
}

function isAutoRolesEnabled(guildId) {
  const section = getAutoRolesSection(guildId);
  return guildManager.isModuleEnabled(guildId, MODULE) && section.enabled !== false;
}

async function applyAutoRoles(member, options = {}) {
  const guild = member?.guild;
  if (!guild?.id || !member?.id || !isAutoRolesEnabled(guild.id)) return [];

  const section = getAutoRolesSection(guild.id);
  if (member.user?.bot && section.settings?.applyToBots !== true) return [];
  if (!canBotManageMember(member)) {
    incrementAnalytics(guild.id, { failed: 1, botsProcessed: member.user?.bot ? 1 : 0, membersProcessed: member.user?.bot ? 0 : 1 });
    return [];
  }

  const roleIds = member.user?.bot ? section.botRoles || [] : section.joinRoles || [];
  const uniqueRoleIds = cleanRoleIds(roleIds);
  if (!uniqueRoleIds.length) {
    incrementAnalytics(guild.id, { skipped: 1, botsProcessed: member.user?.bot ? 1 : 0, membersProcessed: member.user?.bot ? 0 : 1 });
    return [];
  }

  const addedRoles = [];
  let failed = 0;
  let skipped = 0;

  for (const roleId of uniqueRoleIds) {
    const role = await fetchRole(guild, roleId);
    if (!role) {
      failed += 1;
      continue;
    }
    if (member.roles.cache.has(role.id)) {
      skipped += 1;
      continue;
    }
    if (!canBotManageRole(guild, role)) {
      failed += 1;
      continue;
    }
    try {
      await member.roles.add(role, options.reason || 'Goliath Auto Roles');
      addedRoles.push(role);
    } catch {
      failed += 1;
    }
  }

  incrementAnalytics(guild.id, {
    assigned: addedRoles.length,
    failed,
    skipped,
    membersProcessed: member.user?.bot ? 0 : 1,
    botsProcessed: member.user?.bot ? 1 : 0,
  });
  return addedRoles;
}

function configureAutoRoles(guildId, input = {}, meta = {}) {
  if (typeof input.enabled === 'boolean') guildManager.setModuleEnabled(guildId, MODULE, input.enabled, meta);
  return updateAutoRolesSection(guildId, (section) => ({
    ...section,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : section.enabled,
    joinRoles: Array.isArray(input.joinRoles) ? cleanRoleIds(input.joinRoles) : section.joinRoles,
    botRoles: Array.isArray(input.botRoles) ? cleanRoleIds(input.botRoles) : section.botRoles,
    settings: { ...section.settings, ...(input.settings && typeof input.settings === 'object' ? input.settings : {}) },
    updatedAt: now(),
  }), meta);
}

function setAutoRolesEnabled(guildId, enabled = true, meta = {}) {
  const nextEnabled = enabled !== false;
  guildManager.setModuleEnabled(guildId, MODULE, nextEnabled, meta);
  return setEnabled(guildId, nextEnabled, meta);
}

async function addAutoRole(guild, roleId, options = {}, meta = {}) {
  if (!guild?.id) throw new Error('Guild is required.');
  const role = await validateManageableRole(guild, roleId);
  const section = options.bot === true ? addBotRole(guild.id, role.id, meta) : addJoinRole(guild.id, role.id, meta);
  return { role, section };
}

function removeAutoRole(guildId, roleId, options = {}, meta = {}) {
  return options.bot === true ? removeBotRole(guildId, roleId, meta) : removeJoinRole(guildId, roleId, meta);
}

function setApplyToBots(guildId, applyToBots = false, meta = {}) {
  return updateSettings(guildId, { applyToBots: applyToBots === true }, meta);
}

function getAutoRoleAnalytics(guildId) {
  return getAutoRolesSection(guildId).analytics || defaultAnalytics();
}

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const section = getAutoRolesSection(guild.id);
  const registryEnabled = guildManager.isModuleEnabled(guild.id, MODULE);
  const botMember = getBotMember(guild);
  const roleIds = [...new Set([...(section.joinRoles || []), ...(section.botRoles || [])])];
  const roles = [];

  for (const roleId of roleIds) {
    const role = await fetchRole(guild, roleId);
    roles.push({ roleId, exists: Boolean(role), manageable: Boolean(role && canBotManageRole(guild, role)), name: role?.name || null });
  }

  const warnings = [
    section.enabled === false ? 'Auto Roles is disabled in its module configuration.' : null,
    registryEnabled === false ? 'Auto Roles is disabled in the central module registry.' : null,
    !botMember?.permissions?.has(PermissionFlagsBits.ManageRoles) ? 'Goliath is missing Manage Roles.' : null,
    section.joinRoles.length === 0 && (!section.settings.applyToBots || section.botRoles.length === 0) ? 'No automatic roles are configured.' : null,
    ...roles.filter((role) => !role.exists).map((role) => `Role ${role.roleId} no longer exists.`),
    ...roles.filter((role) => role.exists && !role.manageable).map((role) => `${role.name || role.roleId} is above Goliath or managed by an integration.`),
  ].filter(Boolean);

  return {
    enabled: registryEnabled && section.enabled !== false,
    registryEnabled,
    configEnabled: section.enabled !== false,
    hasManageRoles: Boolean(botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)),
    joinRoles: section.joinRoles.length,
    botRoles: section.botRoles.length,
    roles,
    warnings,
    healthy: warnings.length === 0,
  };
}

async function repairConfiguration(guild, meta = {}) {
  const section = getAutoRolesSection(guild.id);
  const validJoinRoles = [];
  const validBotRoles = [];

  for (const roleId of section.joinRoles || []) {
    const role = await fetchRole(guild, roleId);
    if (role && canBotManageRole(guild, role)) validJoinRoles.push(roleId);
  }
  for (const roleId of section.botRoles || []) {
    const role = await fetchRole(guild, roleId);
    if (role && canBotManageRole(guild, role)) validBotRoles.push(roleId);
  }

  return updateAutoRolesSection(guild.id, (current) => ({
    ...current,
    joinRoles: validJoinRoles,
    botRoles: validBotRoles,
    updatedAt: now(),
  }), { action: 'auto_roles_repair', ...meta });
}

async function reapplyToGuild(guild, options = {}) {
  if (!guild?.members?.fetch) throw new Error('Guild members are unavailable.');
  if (!isAutoRolesEnabled(guild.id)) return { processed: 0, assigned: 0, failed: 0 };

  const section = getAutoRolesSection(guild.id);
  const members = await guild.members.fetch();
  let processed = 0;
  let assigned = 0;
  let failed = 0;

  for (const member of members.values()) {
    if (member.user?.bot && section.settings?.applyToBots !== true) continue;
    try {
      const roles = await applyAutoRoles(member, { reason: options.reason || 'Goliath Auto Roles reapply' });
      processed += 1;
      assigned += roles.length;
    } catch {
      processed += 1;
      failed += 1;
    }
  }
  return { processed, assigned, failed };
}

function exportConfiguration(guildId) {
  return {
    exportedAt: now(),
    guildId,
    module: MODULE,
    registryEnabled: guildManager.isModuleEnabled(guildId, MODULE),
    config: getAutoRolesSection(guildId),
  };
}

function resetAutoRoles(guildId, meta = {}) {
  guildManager.setModuleEnabled(guildId, MODULE, true, meta);
  return resetAutoRolesSection(guildId, meta);
}

async function startupAutoRoles(client) {
  if (!client?.guilds?.cache) return { ok: false, reason: 'Missing Discord client.', guildsChecked: 0, results: [] };
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const section = getAutoRolesSection(guild.id);
      const health = await buildHealthReport(guild);
      const reapply = section.enabled !== false && section.settings?.reapplyOnStartup === true
        ? await reapplyToGuild(guild, { reason: 'Goliath Auto Roles startup recovery' })
        : null;
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled: section.enabled !== false,
        healthy: health.healthy,
        warnings: health.warnings,
        joinRoles: health.joinRoles,
        botRoles: health.botRoles,
        reapply,
      });
    } catch (error) {
      results.push({ guildId: guild.id, guildName: guild.name, enabled: false, healthy: false, warnings: [error.message || 'Auto Roles startup check failed.'], joinRoles: 0, botRoles: 0, reapply: null });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    configuredRoles: results.reduce((total, result) => total + result.joinRoles + result.botRoles, 0),
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[AutoRoles] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.configuredRoles} configured role(s), ${summary.warnings} warning(s).`);
  for (const result of results) {
    if (result.warnings.length) console.warn(`[AutoRoles] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }
  return summary;
}

module.exports = {
  MODULE,
  cleanDiscordId,
  cleanRoleIds,
  defaultAnalytics,
  defaultAutoRolesSection,
  normalizeAnalytics,
  normalizeAutoRolesSection,
  getAutoRolesSection,
  saveAutoRolesSection,
  updateAutoRolesSection,
  setEnabled,
  setJoinRoles,
  addJoinRole,
  removeJoinRole,
  setBotRoles,
  addBotRole,
  removeBotRole,
  updateSettings,
  incrementAnalytics,
  resetAutoRolesSection,
  canManageAutoRoles,
  canBotManageRole,
  canBotManageMember,
  validateManageableRole,
  isAutoRolesEnabled,
  applyAutoRoles,
  configureAutoRoles,
  setAutoRolesEnabled,
  addAutoRole,
  removeAutoRole,
  setApplyToBots,
  getAutoRoleAnalytics,
  buildHealthReport,
  repairConfiguration,
  reapplyToGuild,
  exportConfiguration,
  resetAutoRoles,
  startupAutoRoles,
};
