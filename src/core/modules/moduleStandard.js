'use strict';

const MODULE_MATURITY = Object.freeze({
  NOT_STARTED: 'not_started',
  PAUSED: 'paused',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
});

const REQUIRED_CAPABILITIES = Object.freeze([
  'guildStorage',
  'runtime',
  'adminPanel',
  'dashboard',
  'api',
  'health',
  'startupRecovery',
  'export',
  'reset',
  'doctor',
  'documentation',
]);

const MODULE_STANDARD = Object.freeze({
  storage: [
    'GuildManager is the only persistence layer.',
    'Configuration is stored under guild.modules.<moduleKey>.',
    'Defaults and normalization are defined.',
    'No standalone module JSON files are created.',
  ],
  runtime: [
    'Runtime services and event hooks are implemented.',
    'Existing shared events are reused instead of duplicate listeners.',
    'Startup recovery validates saved runtime state.',
    'Missing channels, roles and messages are reported safely.',
  ],
  adminPanel: [
    'Overview and enable/disable controls are available.',
    'Channel and role selectors are used where appropriate.',
    'Module-specific settings are fully configurable.',
    'Deploy, preview, repair, reset and export actions are available where relevant.',
    'Navigation is consistent with every other module.',
  ],
  dashboard: [
    'The module appears in the dashboard module grid.',
    'A dedicated dashboard page exists.',
    'The page exposes the same core configuration and management actions as Discord admin.',
    'Live health and analytics are displayed.',
  ],
  api: [
    'Overview, configuration and action endpoints exist.',
    'Input is normalized and validated.',
    'Errors use consistent API responses.',
  ],
  health: [
    'Doctor checks files and required exports.',
    'Runtime import audit loads module integration files.',
    'Module-specific health checks report missing dependencies and broken deployments.',
  ],
  completionRule: [
    'Only one module may be marked in_progress at a time.',
    'Partially built modules not currently being worked on must be marked paused.',
    'A module cannot be marked complete until every required capability is true.',
    'No new module work starts until the active module is complete unless explicitly approved.',
  ],
});

function createCapabilityMap(overrides = {}) {
  return Object.fromEntries(REQUIRED_CAPABILITIES.map((key) => [key, overrides[key] === true]));
}

function isModuleComplete(moduleDefinition) {
  if (!moduleDefinition || moduleDefinition.maturity !== MODULE_MATURITY.COMPLETE) return false;
  return REQUIRED_CAPABILITIES.every((capability) => moduleDefinition.capabilities?.[capability] === true);
}

function getMissingCapabilities(moduleDefinition) {
  return REQUIRED_CAPABILITIES.filter((capability) => moduleDefinition?.capabilities?.[capability] !== true);
}

module.exports = {
  MODULE_MATURITY,
  REQUIRED_CAPABILITIES,
  MODULE_STANDARD,
  createCapabilityMap,
  isModuleComplete,
  getMissingCapabilities,
};