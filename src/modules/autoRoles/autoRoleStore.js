'use strict';

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');

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

function cleanCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
};
