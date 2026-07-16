'use strict';

const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const statsManager = require('./statsManager');

async function startup(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  return statsManager.startCounterRefreshScheduler(client);
}

module.exports = {
  ...statsManager,
  store: statsStore,
  counters: statsCounters,
  getConfig: statsStore.getStats,
  getSummary: statsStore.getSummary,
  setEnabled: statsStore.setEnabled,
  reset: statsStore.resetStats,
  startup,
};