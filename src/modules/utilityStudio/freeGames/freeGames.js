'use strict';
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { STORES, TYPES } = require('./freeGamesProviders');
const MODULE_KEY = 'freeGames';
const DEFAULTS = { enabled: false, channelId: null, stores: Object.keys(STORES), types: ['game'], alerts: false, roleId: null, state: { firstSeen: {}, observed: {}, deliveries: [], retired: [], initialized: false, lastCheck: null, lastSuccess: null, error: null, offerCount: 0 } };
function getConfig(guildId) {
  const section = getModuleSection(guildId, MODULE_KEY, DEFAULTS);
  return { ...DEFAULTS, ...section, state: { ...structuredClone(DEFAULTS.state), ...section.state }, enabled: guildManager.isModuleEnabled(guildId, MODULE_KEY) };
}
function update(guildId, fn) { return updateModuleSection(guildId, MODULE_KEY, fn, DEFAULTS); }
function filterOffers(offers, config, now = Date.now()) { return offers.filter((offer) => config.types.includes(offer.type) && offer.stores.some((store) => config.stores.includes(store)) && (!offer.endsAt || offer.endsAt > now)); }
function validateSettings(input, previous) {
  const result = {};
  for (const key of ['enabled', 'alerts']) if (Object.hasOwn(input, key)) { if (typeof input[key] !== 'boolean') throw new Error(`${key} must be true or false.`); result[key] = input[key]; }
  for (const [key, known] of [['stores', STORES], ['types', TYPES]]) if (Object.hasOwn(input, key)) {
    if (!Array.isArray(input[key]) || input[key].length > Object.keys(known).length || input[key].some((value) => !Object.hasOwn(known, value))) throw new Error(`Invalid ${key} selection.`);
    result[key] = [...new Set(input[key])];
  }
  for (const key of ['channelId', 'roleId']) if (Object.hasOwn(input, key)) {
    const id = input[key];
    if (id !== null && id !== '' && (typeof id !== 'string' || !/^\d{16,20}$/.test(id))) throw new Error(`Invalid ${key}.`);
    result[key] = id || null;
  }
  const next = { ...previous, ...result };
  if (next.enabled && (!next.channelId || !next.stores.length || !next.types.length)) throw new Error('Choose a channel, at least one store and one offer type before enabling Free Games.');
  return result;
}
function saveSettings(guildId, patch) {
  return update(guildId, (current) => {
    const config = getConfig(guildId);
    const changes = validateSettings(patch, config);
    const state = { ...config.state };
    if (Object.hasOwn(changes, 'channelId') && changes.channelId !== config.channelId) {
      state.retired = [...state.retired, ...state.deliveries]; state.deliveries = [];
    }
    if (['stores', 'types', 'alerts', 'enabled'].some((key) => Object.hasOwn(changes, key) && JSON.stringify(changes[key]) !== JSON.stringify(config[key]))) state.initialized = false;
    return { ...current, ...changes, state };
  });
}
module.exports = { MODULE_KEY, DEFAULTS, getConfig, update, filterOffers, validateSettings, saveSettings };
