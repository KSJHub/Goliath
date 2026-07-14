'use strict';

const store = require('./verificationStore');
const manager = require('./verificationManager');

async function startupVerification(client) {
  if (!client?.guilds?.cache) {
    return { ok: false, reason: 'Missing Discord client.', guildsChecked: 0, results: [] };
  }

  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const report = await manager.buildHealthReport(guild);
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        ok: report.warnings.length === 0,
        enabled: report.enabled,
        warnings: report.warnings,
        panels: report.panels,
      });
    } catch (error) {
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        ok: false,
        enabled: false,
        warnings: [error.message || 'Verification startup check failed.'],
        panels: [],
      });
    }
  }

  const summary = {
    ok: results.every((result) => result.ok || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    totalPanels: results.reduce((total, result) => total + (result.panels?.length || 0), 0),
    totalWarnings: results.reduce((total, result) => total + (result.warnings?.length || 0), 0),
    results,
  };

  console.log(`[Verification] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.totalPanels} panel(s), ${summary.totalWarnings} warning(s).`);
  for (const result of results) {
    if (result.warnings?.length) console.warn(`[Verification] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }
  return summary;
}

module.exports = {
  ...store,
  ...manager,
  startupVerification,
};
