'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const guildManager = require('../../../core/guild/guildManager');

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
  const normalized = {
    ...base,
    ...clone(source),
    joinRoles: cleanRoleIds(source.joinRoles || source.roleIds || source.roles),
    botRoles: cleanRoleIds(source.botRoles),
    settings: {
      applyToBots: source.settings?.applyToBots === true,
      auditLog: source.settings?.auditLog !== false,
      reapplyOnStartup: source.settings?.reapplyOnStartup === true,
      ignoreExistingRoles: source.settings?.ignoreExistingRoles !== false,
    },
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  delete normalized.roleIds;
  delete normalized.roles;
  return normalized;
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
  return guildManager.isModuleEnabled(guildId, MODULE);
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
  // Human join roles are deferred while Verification is active. Persist the
  // entitlement in this existing module section for restart-safe delivery.
  if (!member.user?.bot && guildManager.isModuleEnabled(guild.id, 'verification')) {
    const verificationStore = require('../../securityStudio/verificationStore');
    const session = verificationStore.getSession(guild.id, member.id);
    if (session?.state !== 'verified' || member.pending === true) {
      updateAutoRolesSection(guild.id, (current) => ({
        ...current,
        deferredJoinRoles: {
          ...(current.deferredJoinRoles || {}),
          [member.id]: {
            roleIds: uniqueRoleIds,
            joinedAt: member.joinedAt?.toISOString?.() || null,
            queuedAt: now(),
          },
        },
      }));
      return [];
    }
  }
  if (!uniqueRoleIds.length) {
    incrementAnalytics(guild.id, { skipped: 1, botsProcessed: member.user?.bot ? 1 : 0, membersProcessed: member.user?.bot ? 0 : 1 });
    return [];
  }

  const addedRoles = [];
  let failed = 0;
  let skipped = 0;

  for (const roleId of uniqueRoleIds) {
    const role = await fetchRole(guild, roleId);
    if (!role) { failed += 1; continue; }
    if (member.roles.cache.has(role.id)) { skipped += 1; continue; }
    if (!canBotManageRole(guild, role)) { failed += 1; continue; }
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


async function releaseDeferredJoinRoles(member) {
  if (!member?.guild?.id || member.user?.bot || member.pending === true) return [];
  const guildId = member.guild.id;
  if (guildManager.isModuleEnabled(guildId, 'verification')) {
    const store = require('../../securityStudio/verificationStore');
    if (store.getSession(guildId, member.id)?.state !== 'verified') return [];
  }
  const pending = getAutoRolesSection(guildId).deferredJoinRoles?.[member.id];
  if (!pending || (pending.joinedAt && pending.joinedAt !== member.joinedAt?.toISOString?.())) return [];
  if (!isAutoRolesEnabled(guildId)) return [];
  const assigned = await applyAutoRoles(member, { reason: 'Goliath verified member Auto Roles' });
  const required = cleanRoleIds(pending.roleIds).filter(id => getAutoRolesSection(guildId).joinRoles.includes(id));
  const remaining = required.filter(id => !member.roles.cache.has(id) && !assigned.some(role => role.id === id));
  updateAutoRolesSection(guildId, (section) => {
    const deferredJoinRoles = { ...(section.deferredJoinRoles || {}) };
    if (remaining.length) deferredJoinRoles[member.id] = { ...pending, roleIds: remaining };
    else delete deferredJoinRoles[member.id];
    return { ...section, deferredJoinRoles };
  });
  return assigned;
}

function clearDeferredJoinRoles(guildId, memberId) {
  const existing = getAutoRolesSection(guildId).deferredJoinRoles || {};
  if (!Object.prototype.hasOwnProperty.call(existing, memberId)) return false;
  updateAutoRolesSection(guildId, section => {
    const deferredJoinRoles = { ...(section.deferredJoinRoles || {}) };
    delete deferredJoinRoles[memberId];
    return { ...section, deferredJoinRoles };
  });
  return true;
}

function configureAutoRoles(guildId, input = {}, meta = {}) {
  if (typeof input.enabled === 'boolean') guildManager.setModuleEnabled(guildId, MODULE, input.enabled, meta);
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  return updateAutoRolesSection(guildId, (section) => ({
    ...section,
    joinRoles: Array.isArray(input.joinRoles) ? cleanRoleIds(input.joinRoles) : section.joinRoles,
    botRoles: Array.isArray(input.botRoles) ? cleanRoleIds(input.botRoles) : section.botRoles,
    settings: {
      applyToBots: typeof settings.applyToBots === 'boolean' ? settings.applyToBots : section.settings?.applyToBots === true,
      auditLog: typeof settings.auditLog === 'boolean' ? settings.auditLog : section.settings?.auditLog !== false,
      reapplyOnStartup: typeof settings.reapplyOnStartup === 'boolean' ? settings.reapplyOnStartup : section.settings?.reapplyOnStartup === true,
      ignoreExistingRoles: typeof settings.ignoreExistingRoles === 'boolean' ? settings.ignoreExistingRoles : section.settings?.ignoreExistingRoles !== false,
    },
    updatedAt: now(),
  }), meta);
}

function setAutoRolesEnabled(guildId, enabled = true, meta = {}) {
  const nextEnabled = enabled !== false;
  guildManager.setModuleEnabled(guildId, MODULE, nextEnabled, meta);
  return nextEnabled;
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
  const enabled = guildManager.isModuleEnabled(guild.id, MODULE);
  const botMember = getBotMember(guild);
  const roleIds = [...new Set([...(section.joinRoles || []), ...(section.botRoles || [])])];
  const roles = [];

  for (const roleId of roleIds) {
    const role = await fetchRole(guild, roleId);
    roles.push({ roleId, exists: Boolean(role), manageable: Boolean(role && canBotManageRole(guild, role)), name: role?.name || null });
  }

  const configured = section.joinRoles.length > 0 || (section.settings.applyToBots === true && section.botRoles.length > 0);
  const notices = [
    enabled === true && !configured ? 'No automatic roles are configured.' : null,
  ].filter(Boolean);

  // Diagnose unsafe cross-module grants before introducing deferred role delivery.
  // This check is read-only and preserves every configured role assignment.
  const verificationEnabled = guildManager.isModuleEnabled(guild.id, 'verification');
  const verificationStore = verificationEnabled ? require('../../securityStudio/verificationStore') : null;
  const verificationSettings = verificationStore?.getVerificationSection(guild.id)?.settings || {};
  const restrictedRoleIds = new Set([
    ...(verificationSettings.roles?.pending || []),
    ...(verificationSettings.roles?.verifying || []),
    ...(verificationSettings.roles?.quarantine || []),
  ].map(String));
  const conflictingJoinRoles = verificationEnabled
    ? (section.joinRoles || []).filter((id) => restrictedRoleIds.has(String(id)))
    : [];
  const accessBearingJoinRoles = verificationEnabled
    ? roles.filter((entry) => section.joinRoles.includes(entry.roleId) && entry.exists)
      .filter((entry) => {
        const role = guild.roles.cache.get(entry.roleId);
        return role?.permissions?.has(PermissionFlagsBits.Administrator)
          || role?.permissions?.has(PermissionFlagsBits.ManageRoles)
          || role?.permissions?.has(PermissionFlagsBits.ManageChannels);
      })
    : [];
  const warnings = [
    ...conflictingJoinRoles.map((id) => `Auto Role ${id} overlaps a Verification pending, verifying or quarantine role; check role ownership and removal transitions.`),
    ...accessBearingJoinRoles.map((role) => `Auto Role ${role.name || role.roleId} has elevated permissions and is assigned before Verification completes.`),
    enabled === true && !botMember?.permissions?.has(PermissionFlagsBits.ManageRoles) ? 'Goliath is missing Manage Roles.' : null,
    ...roles.filter((role) => !role.exists).map((role) => `Role ${role.roleId} no longer exists.`),
    ...roles.filter((role) => role.exists && !role.manageable).map((role) => `${role.name || role.roleId} is above Goliath or managed by an integration.`),
  ].filter(Boolean);

  return {
    enabled,
    configured,
    hasManageRoles: Boolean(botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)),
    joinRoles: section.joinRoles.length,
    botRoles: section.botRoles.length,
    roles,
    notices,
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
    enabled: guildManager.isModuleEnabled(guildId, MODULE),
    config: getAutoRolesSection(guildId),
  };
}

function resetAutoRoles(guildId, meta = {}) {
  return resetAutoRolesSection(guildId, meta);
}

async function startupAutoRoles(client) {
  if (!client?.guilds?.cache) return { ok: false, reason: 'Missing Discord client.', guildsChecked: 0, results: [] };
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const section = getAutoRolesSection(guild.id);
      const enabled = isAutoRolesEnabled(guild.id);
      const health = await buildHealthReport(guild);
      const reapply = enabled && section.settings?.reapplyOnStartup === true
        ? await reapplyToGuild(guild, { reason: 'Goliath Auto Roles startup recovery' })
        : null;
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled,
        configured: health.configured,
        healthy: health.healthy,
        notices: health.notices,
        warnings: health.warnings,
        joinRoles: health.joinRoles,
        botRoles: health.botRoles,
        reapply,
      });
    } catch (error) {
      results.push({ guildId: guild.id, guildName: guild.name, enabled: false, configured: false, healthy: false, notices: [], warnings: [error.message || 'Auto Roles startup check failed.'], joinRoles: 0, botRoles: 0, reapply: null });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    configuredGuilds: results.filter((result) => result.enabled && result.configured).length,
    configuredRoles: results.reduce((total, result) => total + result.joinRoles + result.botRoles, 0),
    notices: results.reduce((total, result) => total + result.notices.length, 0),
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[AutoRoles] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.configuredGuilds} configured guild(s), ${summary.configuredRoles} configured role(s), ${summary.warnings} warning(s).`);
  for (const result of results) {
    if (result.notices.length) console.log(`[AutoRoles] ${result.guildName || result.guildId}: ${result.notices.join(' | ')}`);
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
  releaseDeferredJoinRoles,
  clearDeferredJoinRoles,
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