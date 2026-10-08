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

function updateStats(guildId, updater, guildOrMeta = {}) {
  const hasLiveGuild = guildOrMeta?.id === String(guildId) && guildOrMeta?.voiceStates?.cache;
  if (hasLiveGuild) statsManager.flushGuildVoiceSessions(guildOrMeta);
  const stored = statsStore.updateStats(guildId, updater, guildOrMeta);
  if (hasLiveGuild) statsManager.reconcileGuildVoiceSessions(guildOrMeta);
  return stored;
}

module.exports = {
  ...statsManager,
  store: { ...statsStore, updateStats },
  counters: statsCounters,
  getConfig: statsStore.getStats,
  getSummary: statsStore.getSummary,
  setEnabled,
};
