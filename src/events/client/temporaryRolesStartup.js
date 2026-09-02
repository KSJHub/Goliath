'use strict';

const { Events } = require('discord.js');
const temporaryRoles = require('../../modules/roleStudio/temporaryRoles/temporaryRolesService');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');

const SCAN_INTERVAL_MS = 60 * 1000;
const SCHEDULER_ID = 'temporaryRoles:expiry-scan:global';
const installed = Symbol.for('goliath.roleStudio.temporaryRolesScanner');

async function scanAllGuilds(client, { startup = false } = {}) {
  let checked = 0;
  let skipped = 0;
  let failed = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      if (startup && temporaryRoles.getSection(guild.id).settings.removeExpiredOnStartup === false) {
        skipped += 1;
        continue;
      }
      await temporaryRoles.scanExpired(guild, { action: startup ? 'temporary_roles_startup_scan' : 'temporary_roles_scheduled_scan' });
      checked += 1;
    } catch (error) {
      failed += 1;
      console.error(`[TemporaryRoles] Expiry scan failed for ${guild.id}:`, error?.stack || error?.message || error);
    }
  }
  if (failed) {
    sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failed} temporary role expiry scan(s) failed.`), {
      guildsChecked: checked,
      guildsSkipped: skipped,
      guildFailures: failed,
    });
  } else {
    sentinelScheduler.beat(SCHEDULER_ID, { guildsChecked: checked, guildsSkipped: skipped, guildFailures: 0 });
  }
  return { checked, skipped, failed };
}

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    if (client[installed]) return;
    Object.defineProperty(client, installed, { value: true });
    sentinelScheduler.register({
      id: SCHEDULER_ID,
      module: 'temporaryRoles',
      component: 'expiry-scan',
      intervalMs: SCAN_INTERVAL_MS,
      staleAfterMs: Math.max(SCAN_INTERVAL_MS * 3, 180_000),
      details: { scope: 'all-guilds' },
    });
    await scanAllGuilds(client, { startup: true });
    const timer = setInterval(() => {
      scanAllGuilds(client).catch((error) => {
        sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduler-cycle' });
        console.error('[TemporaryRoles] Expiry scheduler failed:', error?.stack || error?.message || error);
      });
    }, SCAN_INTERVAL_MS);
    timer.unref?.();
  },
};
