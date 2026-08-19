const express = require('express');

const {
  getGuildSection,
  saveGuildSection,
} = require('../../../core/guild/guildManager');

const {
  DEFAULT_PREFIX,
  LEGACY_UNSET_PREFIX,
  getGuildPrefix,
  normalizePrefix,
} = require('../../../core/commands/prefixStore');

const router = express.Router();

const DEFAULT_DASHBOARD_PERMISSIONS = {
  enabled: true,
  syncDiscordRoles: false,
  managerRoleIds: [],
  roleOrder: [],
  roleAccess: {},
  moduleAccess: {},
  discordAccess: {},
  presets: {
    full: ['view', 'edit', 'configure', 'deploy', 'delete', 'manage', 'sync'],
    manage: ['view', 'edit', 'configure', 'deploy', 'sync'],
    limited: ['view', 'edit'],
    view: ['view'],
  },
};

const DEFAULT_GENERAL_SETTINGS = {
  prefix: DEFAULT_PREFIX,
  appealUrl: '',
  dashboardEnabled: true,
  managerRoleIds: [],
  dashboardAccessRoleIds: [],
  commandManagerRoleIds: [],
  restrictedChannelIds: [],
  dashboardPermissions: DEFAULT_DASHBOARD_PERMISSIONS,
  commandNotFoundEnabled: true,
  wrongCommandUsageEnabled: true,
  noCommandPermissionsEnabled: true,
  disabledInChannelEnabled: false,
  commandCooldownEnabled: true,
  instantDeleteDataEnabled: false,
};

function safeArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePermissionList(value) {
  const allowed = new Set(['view', 'edit', 'configure', 'deploy', 'delete', 'manage', 'sync', 'admin', 'use', 'create']);
  return safeArray(value).filter((permission) => allowed.has(permission));
}

function normalizeAccessMap(value = {}) {
  return Object.fromEntries(Object.entries(safeObject(value)).map(([moduleKey, perRole]) => [String(moduleKey), Object.fromEntries(Object.entries(safeObject(perRole)).map(([roleId, access]) => [String(roleId), normalizePermissionList(access)]))]));
}

function normalizeDashboardPermissions(value = {}) {
  const source = safeObject(value);
  const roleAccess = safeObject(source.roleAccess);
  return {
    ...DEFAULT_DASHBOARD_PERMISSIONS,
    ...source,
    enabled: source.enabled !== false,
    syncDiscordRoles: source.syncDiscordRoles === true,
    managerRoleIds: safeArray(source.managerRoleIds),
    roleOrder: safeArray(source.roleOrder),
    roleAccess: Object.fromEntries(Object.entries(roleAccess).map(([roleId, access]) => [String(roleId), normalizePermissionList(access)])),
    moduleAccess: normalizeAccessMap(source.moduleAccess),
    discordAccess: normalizeAccessMap(source.discordAccess),
    presets: { ...DEFAULT_DASHBOARD_PERMISSIONS.presets, ...safeObject(source.presets) },
  };
}

function normalizePrefixForSave(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === LEGACY_UNSET_PREFIX) return DEFAULT_PREFIX;
  return normalizePrefix(raw);
}

function normalize(data = {}, options = {}) {
  const prefix = options.guildId ? getGuildPrefix(options.guildId) : normalizePrefixForSave(data.prefix || DEFAULT_PREFIX);
  return {
    prefix,
    appealUrl: data.appealUrl || '',
    dashboardEnabled: data.dashboardEnabled !== false,
    managerRoleIds: safeArray(data.managerRoleIds),
    dashboardAccessRoleIds: safeArray(data.dashboardAccessRoleIds),
    commandManagerRoleIds: safeArray(data.commandManagerRoleIds),
    restrictedChannelIds: safeArray(data.restrictedChannelIds),
    dashboardPermissions: normalizeDashboardPermissions(data.dashboardPermissions),
    commandNotFoundEnabled: data.commandNotFoundEnabled !== false,
    wrongCommandUsageEnabled: data.wrongCommandUsageEnabled !== false,
    noCommandPermissionsEnabled: data.noCommandPermissionsEnabled !== false,
    disabledInChannelEnabled: data.disabledInChannelEnabled === true,
    commandCooldownEnabled: data.commandCooldownEnabled !== false,
    instantDeleteDataEnabled: data.instantDeleteDataEnabled === true,
  };
}

router.get('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;
    const config = getGuildSection(guildId, 'generalSettings', DEFAULT_GENERAL_SETTINGS);
    return res.json({ success: true, guildId, config: { ...DEFAULT_GENERAL_SETTINGS, ...normalize(config || {}, { guildId }) } });
  } catch (error) {
    console.error('Failed to load general settings');
    console.error(error);
    return res.status(500).json({ success: false, error: 'Failed to load general settings.' });
  }
});

router.post('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;
    const updatedConfig = normalize({ ...DEFAULT_GENERAL_SETTINGS, ...(req.body || {}), prefix: normalizePrefixForSave(req.body?.prefix) });
    const savedConfig = saveGuildSection(guildId, 'generalSettings', { ...updatedConfig, updatedAt: new Date().toISOString() });
    return res.json({ success: true, guildId, config: normalize(savedConfig, { guildId }) });
  } catch (error) {
    console.error('Failed to save general settings');
    console.error(error);
    return res.status(400).json({ success: false, error: error.message || 'Failed to save general settings.' });
  }
});

module.exports = router;
