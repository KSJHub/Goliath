'use strict';

function parseGuildIds(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{16,25}$/.test(id)))];
}

module.exports = {
  get BETA_GUILD_IDS() {
    return parseGuildIds(process.env.BETA_GUILD_IDS || process.env.BETA_GUILD_ID || '');
  },
  parseGuildIds,
};
