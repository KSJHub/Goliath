'use strict';

const fs = require('fs');
const path = require('path');
const {
  MODULE_MATURITY,
  REQUIRED_CAPABILITIES,
  getMissingCapabilities,
  isModuleComplete,
} = require('../src/core/modules/moduleStandard');
const { moduleManifest } = require('../src/core/modules/moduleManifest');

const root = path.resolve(__dirname, '..');
const validMaturities = new Set(Object.values(MODULE_MATURITY));
const errors = [];

const canonicalFiles = Object.freeze({
  schedule: [
    'src/modules/schedule/schedule.js',
    'src/modules/schedule/scheduleRoute.js',
    'src/events/schedule/scheduleReady.js',
    'docs/modules/schedule.md',
  ],
  social: [
    'src/modules/social/social.js',
    'src/modules/social/socialPanel.js',
    'src/modules/social/socialCreatorPanel.js',
    'src/modules/social/socialRoute.js',
    'src/modules/social/socialHealth.js',
    'src/modules/social/socialDiagnostics.js',
    'src/dashboard/js/pages/modules/Social.jsx',
    'docs/modules/social-alerts.md',
  ],
});

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

console.log('\nCanonical module manifest');
console.log('=========================');

const definitions = Object.values(moduleManifest).sort((a, b) => a.name.localeCompare(b.name));
const active = definitions.filter((definition) => definition.maturity === MODULE_MATURITY.IN_PROGRESS);

if (active.length !== 1) {
  errors.push(`Exactly one module must be in progress; found ${active.length}: ${active.map((item) => item.name).join(', ') || 'none'}.`);
}

for (const definition of definitions) {
  if (!definition.key || !definition.name) errors.push('Every module requires a key and name.');
  if (!validMaturities.has(definition.maturity)) errors.push(`${definition.name || definition.key}: invalid maturity ${definition.maturity}.`);

  for (const capability of REQUIRED_CAPABILITIES) {
    if (typeof definition.capabilities?.[capability] !== 'boolean') {
      errors.push(`${definition.name}.${capability} must be boolean.`);
    }
  }

  const missing = getMissingCapabilities(definition);
  if (definition.maturity === MODULE_MATURITY.COMPLETE && !isModuleComplete(definition)) {
    errors.push(`${definition.name} is complete but missing: ${missing.join(', ')}.`);
  }
  if (definition.maturity === MODULE_MATURITY.NOT_STARTED && missing.length !== REQUIRED_CAPABILITIES.length) {
    errors.push(`${definition.name} has implemented capabilities but is marked not_started; use paused.`);
  }

  const marker = definition.maturity === MODULE_MATURITY.COMPLETE
    ? '🟢'
    : definition.maturity === MODULE_MATURITY.IN_PROGRESS
      ? '🟡'
      : definition.maturity === MODULE_MATURITY.PAUSED
        ? '🔵'
        : '⚪';
  console.log(`${marker} ${definition.name} — ${definition.maturity}${missing.length ? ` (${missing.length} gaps)` : ''}`);

  for (const relativePath of canonicalFiles[definition.key] || []) {
    if (!exists(relativePath)) errors.push(`${definition.name}: missing ${relativePath}.`);
  }
}

if (moduleManifest.social?.name !== 'Social Studio') errors.push('The canonical social module name must be Social Studio.');
if (moduleManifest.schedule?.maturity !== MODULE_MATURITY.IN_PROGRESS) errors.push('Schedule must be the active module.');
if (moduleManifest.stats?.maturity !== MODULE_MATURITY.PAUSED) errors.push('Stats must remain paused while Schedule is active.');
if (moduleManifest.tickets?.maturity !== MODULE_MATURITY.PAUSED) errors.push('Tickets must remain paused while Schedule is active.');

console.log(`\nModules tracked: ${definitions.length}`);
console.log(`Complete: ${definitions.filter(isModuleComplete).length}`);
console.log(`Active: ${active.length}`);
console.log(`Paused: ${definitions.filter((item) => item.maturity === MODULE_MATURITY.PAUSED).length}`);
console.log(`Not started: ${definitions.filter((item) => item.maturity === MODULE_MATURITY.NOT_STARTED).length}`);

if (errors.length) {
  console.error(`\nCanonical module manifest failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(` - ${error}`);
  process.exitCode = 1;
} else {
  console.log('\n✅ Canonical module manifest passed.');
}
