'use strict';

const { Events } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const roleSelector = require('../../modules/roleStudio/roleSelector/roleSelector');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');

const INTERVAL_MS = 60 * 60 * 1000;
const TIMER_KEY = Symbol.for('goliath.roleSelector.maintenanceTimer');
const SCHEDULER_ID = 'roleSelector:maintenance:global';

async function maintainGuild(guild) {
  if (!guildManager.isModuleEnabled(guild.id, roleSelector.MODULE)) return { skipped: true, failures: 0 };
  let failures = 0;
  await roleSelector.syncManagedRoleAppearance(guild)
    .catch((error) => {
      failures += 1;
      console.warn(`[RoleSelector] Appearance sync failed for ${guild.id}:`, error.message || error);
    });
  await roleSelector.syncManagedRoleHierarchy(guild)
    .catch((error) => {
      failures += 1;
      console.warn(`[RoleSelector] Hierarchy sync failed for ${guild.id}:`, error.message || error);
    });
  await roleSelector.cleanupUnused(guild)
    .catch((error) => {
      failures += 1;
      console.warn(`[RoleSelector] Cleanup failed for ${guild.id}:`, error.message || error);
    });
  return { skipped: false, failures };
}

async function maintainAll(client) {
  let checked = 0;
  let failures = 0;
  for (const guild of client.guilds.cache.values()) {
    const result = await maintainGuild(guild);
    if (!result?.skipped) checked += 1;
    failures += Number(result?.failures || 0);
  }
  if (failures > 0) {
    sentinelScheduler.fail(SCHEDULER_ID, new Error(`${failures} Role Selector maintenance operation(s) failed.`), { guildsChecked: checked, failures });
  } else {
    sentinelScheduler.beat(SCHEDULER_ID, { guildsChecked: checked, failures: 0 });
  }
  return { checked, failures };
}

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    sentinelScheduler.register({
      id: SCHEDULER_ID,
      module: 'roleSelector',
      component: 'maintenance',
      intervalMs: INTERVAL_MS,
      staleAfterMs: Math.max(INTERVAL_MS * 3, 3 * 60 * 60 * 1000),
      details: { scope: 'all-guilds' },
    });

    try {
      await maintainAll(client);
    } catch (error) {
      sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'startup' });
      throw error;
    }

    if (client[TIMER_KEY]) clearInterval(client[TIMER_KEY]);
    client[TIMER_KEY] = setInterval(() => {
      maintainAll(client).catch((error) => {
        sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduled' });
        console.warn('[RoleSelector] Scheduled maintenance failed:', error.message || error);
      });
    }, INTERVAL_MS);
    client[TIMER_KEY].unref?.();
  },
};
