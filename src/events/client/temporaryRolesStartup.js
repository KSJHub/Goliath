'use strict';

const { Events } = require('discord.js');
const temporaryRoles = require('../../modules/roleStudio/temporaryRoles/temporaryRoles');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');

const SCAN_INTERVAL_MS = 60 * 1000;
const SCHEDULER_ID = 'temporaryRoles:expiry-scan:global';
const installed = Symbol.for('goliath.roleStudio.temporaryRolesScanner');

async function scanAllGuilds(client) {
  let checked = 0;
  let failed = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      await temporaryRoles.scanExpired(guild);
      checked += 1;
    } catch (error) {
      failed += 1;
      console.error(`[TemporaryRoles] Expiry scan failed for ${guild.id}:`, error?.stack || error?.message || error);
    }
  }
  if (failed) {
    sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failed} temporary role expiry scan(s) failed.`), {
      guildsChecked: checked,
      guildFailures: failed,
    });
  } else {
    sentinelScheduler.beat(SCHEDULER_ID, { guildsChecked: checked, guildFailures: 0 });
  }
  return { checked, failed };
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
    await scanAllGuilds(client);
    const timer = setInterval(() => {
      scanAllGuilds(client).catch((error) => {
        sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduler-cycle' });
        console.error('[TemporaryRoles] Expiry scheduler failed:', error?.stack || error?.message || error);
      });
    }, SCAN_INTERVAL_MS);
    timer.unref?.();
  },
};
