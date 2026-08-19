'use strict';

// src/core/guild/moduleSectionManager.js

const {
  getGuildSection,
  updateGuildSection,
} = require('./guildManager');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanModuleName(moduleName) {
  const name = String(moduleName || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(name)) {
    throw new Error(`Invalid module name: ${moduleName}`);
  }
  return name;
}

function prepareSection(_moduleName, sectionData = {}) {
  return isPlainObject(sectionData) ? clone(sectionData) : {};
}

function getModules(guildId) {
  const modules = getGuildSection(guildId, 'modules', {});
  return isPlainObject(modules) ? modules : {};
}

function hasLegacyPayload(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function migrateColourRolesToRoleSelector(colourRoles = {}) {
  if (!isPlainObject(colourRoles)) return {};
  const legacySelections = isPlainObject(colourRoles.memberSelections) ? clone(colourRoles.memberSelections) : {};
  const memberSelections = Object.fromEntries(Object.entries(legacySelections).map(([userId, selection]) => {
    const value = Array.isArray(selection)
      ? selection
      : selection && typeof selection === 'object'
        ? [selection.hex || selection.value || selection.roleHex].filter(Boolean)
        : selection ? [selection] : [];
    return [userId, { colours: value }];
  }));
  const colourGroup = {
    id: 'colours',
    key: 'colours',
    name: 'Colours',
    emoji: '🌈',
    description: 'Choose a cosmetic Discord name colour.',
    type: 'colour',
    builtIn: true,
    enabled: true,
    selectionMode: 'single',
    allowRemove: colourRoles.allowRemoveColour !== false,
    palette: clone(colourRoles.palette || []),
    customHexEnabled: colourRoles.customHexEnabled !== false,
    managedRoles: clone(colourRoles.managedRoles || {}),
  };

  return {
    enabled: colourRoles.enabled !== false,
    groups: { colours: colourGroup },
    groupOrder: ['colours'],
    memberSelections,
    style: clone(colourRoles.style || {}),
    deployment: clone(colourRoles.deployment || {}),
    cleanup: clone(colourRoles.cleanup || {}),
    analytics: clone(colourRoles.analytics || {}),
    createdAt: colourRoles.createdAt,
    migratedFrom: 'colourRoles',
    migratedAt: new Date().toISOString(),
  };
}

/**
 * Known legacy Role Studio locations. These are copied into the modern module
 * section the first time that module is loaded.
 */
function getLegacyModuleSection(modules, moduleName) {
  const roles = isPlainObject(modules.roles) ? modules.roles : {};

  if (moduleName === 'autoRoles' && isPlainObject(roles.joinRoles)) {
    return {
      enabled: roles.enabled !== false,
      joinRoles: clone(roles.joinRoles),
      settings: clone(roles.settings || {}),
      analytics: clone(roles.analytics || {}),
    };
  }

  if (moduleName === 'reactionRoles' && isPlainObject(roles.reactionPanels)) {
    return {
      enabled: roles.enabled !== false,
      panels: clone(roles.reactionPanels),
      settings: clone(roles.settings || {}),
      analytics: clone(roles.analytics || {}),
    };
  }

  if (moduleName === 'timedRoles' && isPlainObject(roles.timedRoles)) {
    return {
      enabled: roles.enabled !== false,
      rules: clone(roles.timedRoles),
      settings: clone(roles.settings || {}),
      analytics: clone(roles.analytics || {}),
    };
  }

  if (moduleName === 'roleSelector' && isPlainObject(modules.colourRoles)) {
    return migrateColourRolesToRoleSelector(modules.colourRoles);
  }

  return {};
}

function canRemoveLegacyRoles(modules) {
  const roles = isPlainObject(modules.roles) ? modules.roles : null;
  if (!roles) return false;

  const legacyTargets = [
    ['joinRoles', 'autoRoles'],
    ['reactionPanels', 'reactionRoles'],
    ['timedRoles', 'timedRoles'],
  ];

  return legacyTargets.every(([legacyKey, canonicalKey]) => (
    !hasLegacyPayload(roles[legacyKey]) || hasLegacyPayload(modules[canonicalKey])
  ));
}

function cleanupLegacyRolesIfSafe(guildId, modules, guildOrMeta = {}) {
  if (!canRemoveLegacyRoles(modules)) return modules;

  return updateGuildSection(
    guildId,
    'modules',
    (existingModules = {}) => {
      const nextModules = isPlainObject(existingModules) ? clone(existingModules) : {};
      delete nextModules.roles;
      return nextModules;
    },
    {},
    guildOrMeta
  );
}

function cleanupLegacyColourRolesIfSafe(guildId, modules, guildOrMeta = {}) {
  if (!hasLegacyPayload(modules.roleSelector) || !hasLegacyPayload(modules.colourRoles)) return modules;
  return updateGuildSection(
    guildId,
    'modules',
    (existingModules = {}) => {
      const nextModules = isPlainObject(existingModules) ? clone(existingModules) : {};
      if (hasLegacyPayload(nextModules.roleSelector)) delete nextModules.colourRoles;
      return nextModules;
    },
    {},
    guildOrMeta
  );
}

/**
 * Ensure modules.<moduleName> exists in the mode-specific guild JSON.
 *
 * This is intentionally called by getModuleSection as well as write methods.
 * Consequently, any new module that uses moduleSectionManager is automatically
 * registered in that guild's single source-of-truth file without adding a
 * second data file or manually editing guild defaults.
 */
function ensureModuleSection(guildId, moduleName, fallback = {}, guildOrMeta = {}) {
  const safeModuleName = cleanModuleName(moduleName);
  const modules = getModules(guildId);
  const current = modules[safeModuleName];

  if (isPlainObject(current)) {
    cleanupLegacyRolesIfSafe(guildId, modules, guildOrMeta);
    if (safeModuleName === 'roleSelector') cleanupLegacyColourRolesIfSafe(guildId, modules, guildOrMeta);
    return {
      ...clone(fallback),
      ...clone(current),
    };
  }

  const legacy = getLegacyModuleSection(modules, safeModuleName);
  const initialSection = {
    ...prepareSection(safeModuleName, fallback),
    ...legacy,
  };

  if (!Object.prototype.hasOwnProperty.call(initialSection, 'enabled')) {
    initialSection.enabled = false;
  }

  initialSection.createdAt = initialSection.createdAt || new Date().toISOString();
  initialSection.updatedAt = new Date().toISOString();

  updateGuildSection(
    guildId,
    'modules',
    (existingModules = {}) => ({
      ...(isPlainObject(existingModules) ? existingModules : {}),
      [safeModuleName]: initialSection,
    }),
    {},
    guildOrMeta
  );

  const refreshedModules = getModules(guildId);
  cleanupLegacyRolesIfSafe(guildId, refreshedModules, guildOrMeta);
  if (safeModuleName === 'roleSelector') cleanupLegacyColourRolesIfSafe(guildId, refreshedModules, guildOrMeta);
  return clone(initialSection);
}

function getModuleSection(guildId, moduleName, fallback = {}, guildOrMeta = {}) {
  return ensureModuleSection(guildId, moduleName, fallback, guildOrMeta);
}

function saveModuleSection(guildId, moduleName, sectionData = {}, guildOrMeta = {}) {
  const safeModuleName = cleanModuleName(moduleName);
  const currentSection = ensureModuleSection(guildId, safeModuleName, {}, guildOrMeta);
  const nextSection = prepareSection(safeModuleName, sectionData);
  const hasExplicitEnabled = Object.prototype.hasOwnProperty.call(nextSection, 'enabled');

  if (!hasExplicitEnabled && Object.prototype.hasOwnProperty.call(currentSection, 'enabled')) {
    nextSection.enabled = currentSection.enabled !== false;
  }

  if (!Object.prototype.hasOwnProperty.call(nextSection, 'createdAt') && currentSection.createdAt) {
    nextSection.createdAt = currentSection.createdAt;
  }

  updateGuildSection(
    guildId,
    'modules',
    (modules = {}) => ({
      ...(isPlainObject(modules) ? modules : {}),
      [safeModuleName]: {
        ...nextSection,
        updatedAt: new Date().toISOString(),
      },
    }),
    {},
    guildOrMeta
  );

  return ensureModuleSection(guildId, safeModuleName, nextSection, guildOrMeta);
}

function updateModuleSection(guildId, moduleName, updater, fallback = {}, guildOrMeta = {}) {
  const current = ensureModuleSection(guildId, moduleName, fallback, guildOrMeta);
  const next = typeof updater === 'function' ? updater(clone(current)) : updater;

  return saveModuleSection(
    guildId,
    moduleName,
    isPlainObject(next) ? next : {},
    guildOrMeta
  );
}

module.exports = {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
};
