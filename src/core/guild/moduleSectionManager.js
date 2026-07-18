'use strict';

// src/core/guild/moduleSectionManager.js

const {
  getGuildSection,
  updateGuildSection,
} = require('./guildManager');
const { prepareInviteSection } = require('../../modules/invites/inviteTemplates');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function prepareSection(moduleName, sectionData = {}, guildOrMeta = {}) {
  const nextSection = isPlainObject(sectionData) ? clone(sectionData) : {};
  if (moduleName === 'invites') {
    return prepareInviteSection(nextSection, guildOrMeta);
  }
  return nextSection;
}

function getModules(guildId) {
  const modules = getGuildSection(guildId, 'modules', {});
  return isPlainObject(modules) ? modules : {};
}

function getModuleSection(guildId, moduleName, fallback = {}) {
  const modules = getModules(guildId);
  const section = modules[moduleName];

  if (!isPlainObject(section)) {
    return clone(fallback);
  }

  return {
    ...clone(fallback),
    ...clone(section),
  };
}

function saveModuleSection(guildId, moduleName, sectionData = {}, guildOrMeta = {}) {
  const nextSection = prepareSection(moduleName, sectionData, guildOrMeta);

  updateGuildSection(
    guildId,
    'modules',
    (modules = {}) => ({
      ...(isPlainObject(modules) ? modules : {}),
      [moduleName]: {
        ...nextSection,
        updatedAt: new Date().toISOString(),
      },
    }),
    {},
    guildOrMeta
  );

  return getModuleSection(guildId, moduleName, nextSection);
}

function updateModuleSection(guildId, moduleName, updater, fallback = {}, guildOrMeta = {}) {
  const current = getModuleSection(guildId, moduleName, fallback);
  const next = typeof updater === 'function' ? updater(clone(current)) : updater;

  return saveModuleSection(
    guildId,
    moduleName,
    isPlainObject(next) ? next : {},
    guildOrMeta
  );
}

module.exports = {
  getModules,
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
};
