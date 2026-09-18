'use strict';

const BASE_CONTRACTS = {
  autoRoles: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  birthdays: { class: 'scheduled', signals: ['runtime', 'scheduler', 'persistence', 'discord-write'] },
  embed: { class: 'event', signals: ['runtime', 'interaction', 'discord-write'] },
  forms: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  giveaways: { class: 'scheduled', signals: ['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'] },
  goodbye: { class: 'event', signals: ['runtime', 'persistence', 'discord-write'] },
  invites: { class: 'event', signals: ['runtime', 'persistence'] },
  leveling: { class: 'background', signals: ['runtime', 'background-worker', 'persistence'] },
  notes: { class: 'event', signals: ['runtime', 'interaction', 'persistence'] },
  polls: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  privateRooms: { class: 'background', signals: ['runtime', 'interaction', 'background-worker', 'persistence', 'discord-write'] },
  reactionRoles: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  roleSelector: { class: 'scheduled', signals: ['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'] },
  schedule: { class: 'scheduled', signals: ['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'] },
  social: { class: 'provider', signals: ['runtime', 'scheduler', 'provider', 'persistence', 'discord-write'] },
  starboard: { class: 'event', signals: ['runtime', 'persistence', 'discord-write'] },
  stats: { class: 'background', signals: ['runtime', 'background-worker', 'persistence'] },
  sticky: { class: 'background', signals: ['runtime', 'background-worker', 'persistence', 'discord-write'] },
  suggestions: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  temporaryRoles: { class: 'scheduled', signals: ['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'] },
  tempVoice: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  tickets: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  timedRoles: { class: 'scheduled', signals: ['runtime', 'interaction', 'scheduler', 'persistence', 'discord-write'] },
  translation: { class: 'provider', signals: ['runtime', 'provider', 'persistence', 'discord-write'] },
  verification: { class: 'event', signals: ['runtime', 'interaction', 'persistence', 'discord-write'] },
  welcome: { class: 'scheduled', signals: ['runtime', 'scheduler', 'persistence', 'discord-write'] },
};

// Every supported module must be observable at the universal Sentinel action
// boundary in addition to its module-specific health signals.
const MODULE_CONTRACTS = Object.freeze(Object.fromEntries(
  Object.entries(BASE_CONTRACTS).map(([key, contract]) => [key, Object.freeze({
    ...contract,
    signals: Object.freeze([...new Set([...contract.signals, 'sentinel-action'])]),
  })])
));

function getModuleContract(moduleKey) { return MODULE_CONTRACTS[String(moduleKey || '')] || null; }
function moduleKeys() { return Object.keys(MODULE_CONTRACTS).sort(); }

module.exports = { MODULE_CONTRACTS, getModuleContract, moduleKeys };
