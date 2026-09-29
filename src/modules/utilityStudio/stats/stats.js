'use strict';

const statsStore = require('./statsStore');
const statsCounters = require('./statsCounters');
const statsManager = require('./statsManager');

function setEnabled(guildId, enabled, guildOrMeta = {}) {
  if (guildOrMeta?.id === String(guildId) && guildOrMeta?.voiceStates?.cache) {
    return statsManager.applyRuntimeConfig(guildOrMeta, { enabled: enabled === true }, guildOrMeta);
  }
  return statsStore.setEnabled(guildId, enabled, guildOrMeta);
}

module.exports = {
  ...statsManager,
  store: statsStore,
  counters: statsCounters,
  getConfig: statsStore.getStats,
  getSummary: statsStore.getSummary,
  setEnabled,
};
