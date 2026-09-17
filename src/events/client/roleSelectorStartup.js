'use strict';

const { Events } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const roleSelector = require('../../modules/roleStudio/roleSelector/roleSelector');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');
const audit = require('../../owner/auditIntelligence/auditIntelligence');

const INTERVAL_MS = 60 * 60 * 1000;
const TIMER_KEY = Symbol.for('goliath.roleSelector.maintenanceTimer');
const SCHEDULER_ID = 'roleSelector:maintenance:global';

async function maintainGuild(guild) {
  if (!guildManager.isModuleEnabled(guild.id, roleSelector.MODULE)) return { skipped: true, failures: 0 };
  const result = await roleSelector.runMaintenance(guild);
  if (result?.failures) console.warn(`[RoleSelector] ${result.failures} maintenance operation(s) failed for ${guild.id}.`);
  return result;
}

async function maintainAll(client, { startup = false } = {}) {
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

  // Keep routine healthy hourly cycles quiet, but make startup state and any
  // background failure visible in Goliath Actions without an interaction.
  if (startup || failures > 0) {
    await audit.captureGoliathAction(client, {
      type: startup ? 'goliath.scheduler.role_selector.startup' : 'goliath.scheduler.role_selector.maintenance',
      category: 'goliath',
      action: 'execute',
      system: 'Role Studio',
      result: failures > 0 ? 'Partial / Failed' : 'Success',
      summary: `Role Selector ${startup ? 'startup ' : ''}maintenance checked ${checked} enabled guild(s) and recorded ${failures} failure(s).`,
      metadata: { schedulerId: SCHEDULER_ID, startup, guildsChecked: checked, failures },
    }).catch((error) => console.warn('[RoleSelector] Could not record scheduler audit action:', error?.message || error));
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
      await maintainAll(client, { startup: true });
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