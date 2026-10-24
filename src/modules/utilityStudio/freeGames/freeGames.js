'use strict';
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { STORES, TYPES, CURRENCIES } = require('./freeGamesProviders');
const MODULE_KEY = 'freeGames';
const DEFAULTS = { enabled: false, currency: 'GBP', priceMode: 'converted', locale: 'en-GB', timeZone: 'Europe/London', region: 'GB', channelId: null, stores: Object.keys(STORES), types: ['game'], alerts: false, roleId: null, state: { firstSeen: {}, newSince: {}, observed: {}, deliveries: [], retired: [], initialized: false, lastCheck: null, lastSuccess: null, error: null, offerCount: 0, pricing: null, warning: null } };
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
  if (Object.hasOwn(input, 'currency')) {
    if (!CURRENCIES.includes(input.currency)) throw new Error('Choose a supported currency.');
    result.currency = input.currency;
  }
  if (Object.hasOwn(input, 'priceMode')) {
    if (!['converted', 'source', 'hidden'].includes(input.priceMode)) throw new Error('Invalid price display.');
    result.priceMode = input.priceMode;
  }
  if (Object.hasOwn(input, 'locale')) {
    if (typeof input.locale !== 'string' || input.locale.length > 40) throw new Error('Invalid formatting locale.');
    try { result.locale = Intl.getCanonicalLocales(input.locale)[0]; if (!result.locale || !Intl.DateTimeFormat.supportedLocalesOf([result.locale]).length) throw new Error(); } catch { throw new Error('Choose a supported formatting locale, such as en-GB.'); }
  }
  if (Object.hasOwn(input, 'timeZone')) {
    try { if (typeof input.timeZone !== 'string' || !input.timeZone || input.timeZone.length > 80) throw new Error(); result.timeZone = new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).resolvedOptions().timeZone; } catch { throw new Error('Choose a valid timezone, such as Europe/London.'); }
  }
  if (Object.hasOwn(input, 'region')) {
    if (typeof input.region !== 'string' || (!/^[A-Z]{2}$/.test(input.region) || input.region === 'ZZ')) throw new Error('Use a two-letter region code, such as GB.');
    try { if (!new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(input.region)) throw new Error(); } catch { throw new Error('Choose a recognised region code.'); }
    result.region = input.region;
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
