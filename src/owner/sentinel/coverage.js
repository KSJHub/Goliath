'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_ROOT } = require('../../config/runtimePaths');
const { MODULE_CONTRACTS, moduleKeys } = require('./moduleContracts.js');

const MODULE_ROOT = path.join(PROJECT_ROOT, 'src', 'modules');
const BACKEND_ROOTS = Object.freeze([
  path.join(PROJECT_ROOT, 'server.js'),
  path.join(PROJECT_ROOT, 'scripts'),
  path.join(PROJECT_ROOT, 'src'),
]);
const CURRENT_MODULES = Object.freeze(moduleKeys());
const FOLDER_ALIASES = Object.freeze({ socialAlerts: 'social' });
const NON_RUNTIME_MODULE_FOLDERS = new Set(['notes']);
const SCHEDULER_CALL = /\bsetInterval\s*\(/;
const SENTINEL_INTEGRATION = /schedulerRegistry|schedulerMonitor|sentinelScheduler/i;

// These intervals are deliberately supervised by a parent/runtime health path rather
// than individually registered in schedulerRegistry. Keeping the list explicit makes
// new unmanaged intervals fail coverage instead of silently expanding the exception.
const SUPERVISED_INTERVALS = Object.freeze({
  'server.js': 'process/runtime heartbeat and PM2 health',
  'src/core/devSyncService.js': 'development-only sync worker',
  'src/events/client/guildOperationalControlsBootstrap.js': 'guild operational-control bootstrap health',
  'src/events/client/sentinelControlCenter.js': 'Sentinel control-center runtime',
  'src/events/client/socialStudioLivePostRecovery.js': 'Social Sentinel account freshness and delivery health',
  'src/modules/communityStudio/invites/invitesTracking.js': 'invites module runtime health',
  'src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js': 'Social Sentinel account freshness and delivery health',
  'src/modules/utilityStudio/schedule/schedule.js': 'scheduleStartup registered scheduler health',
  'src/modules/utilityStudio/stats/statsCounters.js': 'statsManager registered scheduler health',
  'src/owner/auditIntelligence/guildObservatory.js': 'client GuildObservatory registered collector health',
});

function normalizedRelative(file) {
  return path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
}

function shouldSkipBackendPath(file) {
  const relative = normalizedRelative(file);
  return relative.startsWith('src/dashboard/')
    || relative.startsWith('node_modules/')
    || relative.startsWith('dist/')
    || relative.includes('/node_modules/')
    || relative.includes('/dist/');
}

function walk(dir, predicate, output = []) {
  if (!fs.existsSync(dir)) return output;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    if (!shouldSkipBackendPath(dir) && predicate(dir, path.basename(dir))) output.push(dir);
    return output;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldSkipBackendPath(full)) continue;
    if (entry.isDirectory()) walk(full, predicate, output);
    else if (predicate(full, entry.name)) output.push(full);
  }
  return output;
}

function healthAdapters() {
  return walk(MODULE_ROOT, (_full, name) => /Health\.js$/i.test(name)).map((file) => ({
    file,
    relative: normalizedRelative(file),
  }));
}

function discoveredModuleFolders() {
  if (!fs.existsSync(MODULE_ROOT)) return [];
  const names = new Set();
  for (const studio of fs.readdirSync(MODULE_ROOT, { withFileTypes: true })) {
    if (!studio.isDirectory()) continue;
    const studioPath = path.join(MODULE_ROOT, studio.name);
    for (const entry of fs.readdirSync(studioPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const moduleName = FOLDER_ALIASES[entry.name] || entry.name;
      if (!NON_RUNTIME_MODULE_FOLDERS.has(moduleName)) names.add(moduleName);
    }
  }
  if (fs.existsSync(path.join(MODULE_ROOT, 'securityStudio', 'verification.js'))) names.add('verification');
  return [...names].sort();
}

function schedulerFiles() {
  const files = new Set();
  for (const root of BACKEND_ROOTS) {
    for (const file of walk(root, (_full, name) => /\.(?:js|cjs|mjs)$/i.test(name))) files.add(file);
  }

  return [...files]
    .sort()
    .map((file) => {
      const source = fs.readFileSync(file, 'utf8');
      if (!SCHEDULER_CALL.test(source)) return null;
      const relative = normalizedRelative(file);
      const sentinelOwned = relative.startsWith('src/owner/sentinel/');
      const directlyMonitored = sentinelOwned || SENTINEL_INTEGRATION.test(source);
      const supervision = SUPERVISED_INTERVALS[relative] || null;
      const monitored = directlyMonitored || Boolean(supervision);
      const intervalCount = (source.match(/\bsetInterval\s*\(/g) || []).length;
      return { file, relative, monitored, sentinelOwned, directlyMonitored, supervision, intervalCount };
    })
    .filter(Boolean);
}

function schedulerCoverage() {
  const discovered = schedulerFiles();
  return {
    discovered: discovered.map(({ relative, monitored, sentinelOwned, directlyMonitored, supervision, intervalCount }) => ({
      file: relative,
      monitored,
      sentinelOwned,
      directlyMonitored,
      supervision,
      intervalCount,
    })),
    unmonitored: discovered.filter((item) => !item.monitored).map((item) => item.relative),
    monitored: discovered.filter((item) => item.monitored).map((item) => item.relative),
    supervised: discovered.filter((item) => item.supervision).map((item) => ({ file: item.relative, by: item.supervision })),
  };
}

function coverageReport() {
  const discovered = discoveredModuleFolders();
  const adapters = healthAdapters();
  const contracts = moduleKeys();
  const contractSet = new Set(contracts);
  const discoveredSet = new Set(discovered);
  const futureUnregistered = discovered.filter((name) => !contractSet.has(name));
  const contractWithoutDiscoveredFolder = contracts.filter((name) => !discoveredSet.has(name));
  const contractSummary = contracts.map((moduleKey) => ({
    module: moduleKey,
    class: MODULE_CONTRACTS[moduleKey].class,
    signals: [...MODULE_CONTRACTS[moduleKey].signals],
  }));
  const schedulers = schedulerCoverage();

  return {
    generatedAt: new Date().toISOString(),
    currentModules: contracts,
    discovered,
    contractSummary,
    adapterFiles: adapters.map((item) => item.relative),
    futureUnregistered,
    contractWithoutDiscoveredFolder,
    schedulerFiles: schedulers.discovered,
    monitoredSchedulerFiles: schedulers.monitored,
    supervisedSchedulerFiles: schedulers.supervised,
    unmonitoredSchedulerFiles: schedulers.unmonitored,
    complete:
      futureUnregistered.length === 0
      && contractWithoutDiscoveredFolder.length === 0
      && schedulers.unmonitored.length === 0,
  };
}

module.exports = {
  CURRENT_MODULES,
  healthAdapters,
  discoveredModuleFolders,
  schedulerFiles,
  schedulerCoverage,
  coverageReport,
};
