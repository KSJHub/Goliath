'use strict';

const welcomeManager = require('./welcomeManager');
const welcomeStore = require('./welcomeStore');

async function startupWelcome(client) {
  if (!client?.guilds?.cache) {
    return { ok: false, guildsChecked: 0, warnings: 1, results: [] };
  }

  const results = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const config = welcomeStore.getWelcomeSection(guild.id);
      const health = await welcomeManager.buildHealthReport(guild);
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled: config.enabled !== false,
        healthy: health.healthy,
        warnings: health.warnings,
      });
    } catch (error) {
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled: false,
        healthy: false,
        warnings: [error.message || 'Welcome startup check failed.'],
      });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[Welcome] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.warnings} warning(s).`);
  for (const result of results) {
    if (result.warnings.length) console.warn(`[Welcome] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }

  return summary;
}

module.exports = { startupWelcome };
