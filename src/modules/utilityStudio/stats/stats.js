'use strict';

const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const statsManager = require('./statsManager');

module.exports = {
  ...statsManager,
  store: statsStore,
  counters: statsCounters,
  getConfig: statsStore.getStats,
  getSummary: statsStore.getSummary,
  setEnabled: statsStore.setEnabled,
};
