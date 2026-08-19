'use strict';

const SECTION_PATHS = Object.freeze({
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
  automod: 'modules.automod',
  polls: 'modules.polls',
  stats: 'modules.stats',
  social: 'modules.social',
  templates: 'modules.serverCopy.templates',
});

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function getPathParts(sectionName) {
  const rawSection = String(sectionName || '').trim();
  const routedSection = SECTION_PATHS[rawSection] || rawSection;
  const pathParts = routedSection.split('.').map((part) => part.trim()).filter(Boolean);

  if (pathParts.length === 0) {
    throw new Error('Guild section path is required.');
  }

  if (pathParts.some((part) => UNSAFE_PATH_SEGMENTS.has(part))) {
    throw new Error('Invalid guild section path.');
  }

  return pathParts;
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

module.exports = {
  getRoutedSection,
  setRoutedSection,
};