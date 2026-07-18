'use strict';

const LEGACY_SECTION_MAP = Object.freeze({
  tickets: 'modules.tickets',
  security: 'modules.security',
  logs: 'modules.logs',
  generalSettings: 'modules.generalSettings',
  embedBuilder: 'modules.embedBuilder',
  embedDefaults: 'modules.embedDefaults',
  embedPresets: 'modules.embedPresets',
  embedDeployments: 'modules.embedDeployments',
  embedStudio: 'modules.embedStudio',
  serverBackups: 'modules.serverBackups',
  moderation: 'modules.moderation',
  discord: 'modules.discord',
  polls: 'modules.polls',
  stats: 'modules.stats',
  templates: 'modules.serverCopy.templates',
});

const LEGACY_TOP_LEVEL_SECTIONS = Object.freeze(Object.keys(LEGACY_SECTION_MAP));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function getPathParts(sectionName) {
  const rawSection = String(sectionName || '').trim();
  const routedSection = LEGACY_SECTION_MAP[rawSection] || rawSection;
  return routedSection.split('.').map((part) => part.trim()).filter(Boolean);
}

function getValueAtPath(source, pathParts) {
  let current = source;
  for (const part of pathParts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function setValueAtPath(source, pathParts, value) {
  const next = isPlainObject(source) ? clone(source) : {};
  let current = next;

  pathParts.forEach((part, index) => {
    const isLast = index === pathParts.length - 1;
    if (isLast) {
      current[part] = clone(value);
      return;
    }
    current[part] = isPlainObject(current[part]) ? clone(current[part]) : {};
    current = current[part];
  });

  return next;
}

function resolveSectionPath(sectionName) {
  return getPathParts(sectionName);
}

function getRoutedSection(source, sectionName, fallback = {}) {
  const value = getValueAtPath(source, resolveSectionPath(sectionName));
  return isPlainObject(value) ? clone(value) : clone(fallback);
}

function setRoutedSection(source, sectionName, sectionData = {}) {
  return setValueAtPath(source, resolveSectionPath(sectionName), isPlainObject(sectionData) ? sectionData : {});
}

function removeLegacyTopLevelSections(source = {}) {
  if (!isPlainObject(source)) return {};
  const clean = clone(source);
  for (const sectionName of LEGACY_TOP_LEVEL_SECTIONS) {
    delete clean[sectionName];
  }
  return clean;
}

function hasLegacyTopLevelSections(source = {}) {
  if (!isPlainObject(source)) return false;
  return LEGACY_TOP_LEVEL_SECTIONS.some((sectionName) => Object.prototype.hasOwnProperty.call(source, sectionName));
}

module.exports = {
  LEGACY_SECTION_MAP,
  LEGACY_TOP_LEVEL_SECTIONS,
  resolveSectionPath,
  getRoutedSection,
  setRoutedSection,
  removeLegacyTopLevelSections,
  hasLegacyTopLevelSections,
};