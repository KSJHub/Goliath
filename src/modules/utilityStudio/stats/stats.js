'use strict';

const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const statsManager = require('./statsManager');
const statsStartup = require('./statsStartup');

module.exports = {
  ...statsManager,
  store: statsStore,
  counters: statsCounters,
  getConfig: statsStore.getStats,
  getSummary: statsStore.getSummary,
  setEnabled: statsStore.setEnabled,
  reset: statsStore.resetStats,
  startup: statsStartup.startup,
  shutdown: statsStartup.shutdown,
};
