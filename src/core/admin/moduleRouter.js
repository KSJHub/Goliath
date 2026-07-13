'use strict';

const path = require('path');

const MODULE_REGISTRY = {
  verification: {
    key: 'verification',
    label: 'Verification',
    menuPath: path.join('..', 'verification', 'verificationMenu'),
    managerPath: path.join('..', 'verification', 'verificationManager'),
    storePath: path.join('..', 'verification', 'verificationStore'),
  },
  autoRoles: {
    key: 'autoRoles',
    label: 'Auto Roles',
    managerPath: path.join('..', 'autoroles'),
    storePath: path.join('..', 'autoroles'),
  },
  forms: {
    key: 'forms',
    label: 'Forms',
    managerPath: path.join('..', 'forms', 'formManager'),
    storePath: path.join('..', 'forms', 'formStore'),
  },
  tickets: {
    key: 'tickets',
    label: 'Tickets',
    managerPath: path.join('..', 'tickets', 'ticketManager'),
  },
  giveaways: {
    key: 'giveaways',
    label: 'Giveaways',
    menuPath: path.join('..', 'giveaways', 'giveawayMenu'),
    managerPath: path.join('..', 'giveaways', 'giveawayManager'),
    storePath: path.join('..', 'giveaways', 'giveawayStore'),
  },
  starboard: {
    key: 'starboard',
    label: 'Starboard',
    menuPath: path.join('..', 'starboard', 'starboardMenu'),
    managerPath: path.join('..', 'starboard', 'starboardManager'),
    storePath: path.join('..', 'starboard', 'starboardStore'),
  },
  tempVoice: {
    key: 'tempVoice',
    label: 'Temp Voice',
    menuPath: path.join('..', 'tempvoice', 'tempVoiceMenu'),
    managerPath: path.join('..', 'tempvoice', 'tempVoiceManager'),
  },
  sticky: {
    key: 'sticky',
    label: 'Sticky Messages',
    menuPath: path.join('..', 'sticky', 'stickyMenu'),
    managerPath: path.join('..', 'sticky', 'stickyManager'),
    storePath: path.join('..', 'sticky', 'stickyGuildStore'),
  },
  suggestions: {
    key: 'suggestions',
    label: 'Suggestions',
    menuPath: path.join('..', 'suggestions', 'suggestionMenu'),
    managerPath: path.join('..', 'suggestions', 'suggestionManager'),
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
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
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
  if (!definition) {
    throw new Error(`Unknown admin module: ${moduleKey}`);
  }
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
