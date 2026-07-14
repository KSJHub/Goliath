'use strict';

const path = require('path');

const MODULE_REGISTRY = {
  verification: {
    key: 'verification',
    label: 'Verification',
    managerPath: path.join('..', '..', 'modules', 'verification'),
    storePath: path.join('..', '..', 'modules', 'verification'),
  },
  autoRoles: {
    key: 'autoRoles',
    label: 'Auto Roles',
    managerPath: path.join('..', '..', 'modules', 'autoroles'),
    storePath: path.join('..', '..', 'modules', 'autoroles'),
  },
  forms: {
    key: 'forms',
    label: 'Forms',
    managerPath: path.join('..', '..', 'modules', 'forms', 'formManager'),
    storePath: path.join('..', '..', 'modules', 'forms', 'formStore'),
  },
  tickets: {
    key: 'tickets',
    label: 'Tickets',
    managerPath: path.join('..', '..', 'modules', 'tickets', 'ticketManager'),
  },
  giveaways: {
    key: 'giveaways',
    label: 'Giveaways',
    menuPath: path.join('..', '..', 'modules', 'giveaways', 'giveawayMenu'),
    managerPath: path.join('..', '..', 'modules', 'giveaways', 'giveawayManager'),
    storePath: path.join('..', '..', 'modules', 'giveaways', 'giveawayStore'),
  },
  starboard: {
    key: 'starboard',
    label: 'Starboard',
    menuPath: path.join('..', '..', 'modules', 'starboard', 'starboardMenu'),
    managerPath: path.join('..', '..', 'modules', 'starboard', 'starboardManager'),
    storePath: path.join('..', '..', 'modules', 'starboard', 'starboardStore'),
  },
  tempVoice: {
    key: 'tempVoice',
    label: 'Temp Voice',
    menuPath: path.join('..', '..', 'modules', 'tempvoice', 'tempVoiceMenu'),
    managerPath: path.join('..', '..', 'modules', 'tempvoice', 'tempVoiceManager'),
  },
  sticky: {
    key: 'sticky',
    label: 'Sticky Messages',
    menuPath: path.join('..', '..', 'modules', 'sticky', 'stickyMenu'),
    managerPath: path.join('..', '..', 'modules', 'sticky', 'stickyManager'),
    storePath: path.join('..', '..', 'modules', 'sticky', 'stickyGuildStore'),
  },
  suggestions: {
    key: 'suggestions',
    label: 'Suggestions',
    menuPath: path.join('..', '..', 'modules', 'suggestions', 'suggestionMenu'),
    managerPath: path.join('..', '..', 'modules', 'suggestions', 'suggestionManager'),
  },
  translation: {
    key: 'translation',
    label: 'Translation',
  },
  embedStudio: {
    key: 'embedStudio',
    label: 'Embed Studio',
  },
};

function safeRequire(modulePath) {
  if (!modulePath) return null;

  try {
    return require(modulePath);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return null;
  }
}

function listModules() {
  return Object.values(MODULE_REGISTRY).map(({ key, label }) => ({ key, label }));
}

function hasModule(moduleKey) {
  return Boolean(MODULE_REGISTRY[moduleKey]);
}

function getModuleDefinition(moduleKey) {
  const definition = MODULE_REGISTRY[moduleKey];
  if (!definition) return null;

  return {
    ...definition,
    menu: safeRequire(definition.menuPath),
    manager: safeRequire(definition.managerPath),
    store: safeRequire(definition.storePath),
  };
}

function getAllModuleDefinitions() {
  return Object.keys(MODULE_REGISTRY)
    .map((key) => getModuleDefinition(key))
    .filter(Boolean);
}

function requireModuleDefinition(moduleKey) {
  const definition = getModuleDefinition(moduleKey);
  if (!definition) throw new Error(`Unknown admin module: ${moduleKey}`);
  return definition;
}

module.exports = {
  MODULE_REGISTRY,
  listModules,
  hasModule,
  getAllModuleDefinitions,
  getModuleDefinition,
  requireModuleDefinition,
};
