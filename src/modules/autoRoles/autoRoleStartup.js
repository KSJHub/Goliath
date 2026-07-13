'use strict';

const autoRoleStore = require('./autoRoleStore');
const autoRoleManager = require('./autoRoleManager');

async function startupAutoRoles(client) {
  if (!client?.guilds?.cache) {
    return { ok: false, reason: 'Missing Discord client.', guildsChecked: 0, results: [] };
  }

  const results = [];

  for (const guild of client.guilds.cache.values()) {
    try {
      const section = autoRoleStore.getAutoRolesSection(guild.id);
      const health = await autoRoleManager.buildHealthReport(guild);
      let reapply = null;

      if (section.enabled !== false && section.settings?.reapplyOnStartup === true) {
        reapply = await autoRoleManager.reapplyToGuild(guild, { reason: 'Goliath Auto Roles startup recovery' });
      }

      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled: section.enabled !== false,
        healthy: health.healthy,
        warnings: health.warnings,
        joinRoles: health.joinRoles,
        botRoles: health.botRoles,
        reapply,
      });
    } catch (error) {
      results.push({
        guildId: guild.id,
        guildName: guild.name,
        enabled: false,
        healthy: false,
        warnings: [error.message || 'Auto Roles startup check failed.'],
        joinRoles: 0,
        botRoles: 0,
        reapply: null,
      });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    configuredRoles: results.reduce((total, result) => total + result.joinRoles + result.botRoles, 0),
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[AutoRoles] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.configuredRoles} configured role(s), ${summary.warnings} warning(s).`);

  for (const result of results) {
    if (!result.warnings.length) continue;
    console.warn(`[AutoRoles] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }

  return summary;
}

module.exports = {
  startupAutoRoles,
};
