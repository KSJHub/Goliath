'use strict';

const { Events } = require('discord.js');
const temporaryRoles = require('../../modules/roleStudio/temporaryRoles/temporaryRolesService');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');
const audit = require('../../owner/auditIntelligence/auditIntelligence');

const SCAN_INTERVAL_MS = 60 * 1000;
const SCHEDULER_ID = 'temporaryRoles:expiry-scan:global';
const installed = Symbol.for('goliath.roleStudio.temporaryRolesScanner');

async function scanAllGuilds(client, { startup = false } = {}) {
  let checked = 0;
  let skipped = 0;
  let failed = 0;
  let assignmentsChecked = 0;
  let assignmentsExpired = 0;
  let assignmentFailures = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      if (startup && temporaryRoles.getSection(guild.id).settings.removeExpiredOnStartup === false) {
        skipped += 1;
        continue;
      }
      const result = await temporaryRoles.scanExpired(guild, { action: startup ? 'temporary_roles_startup_scan' : 'temporary_roles_scheduled_scan' });
      checked += 1;
      assignmentsChecked += Number(result?.checked || 0);
      assignmentsExpired += Number(result?.expired || 0);
      assignmentFailures += Number(result?.failed || 0);
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
      assignmentsChecked,
      assignmentsExpired,
      assignmentFailures,
    });
  } else {
    sentinelScheduler.beat(SCHEDULER_ID, { guildsChecked: checked, guildsSkipped: skipped, guildFailures: 0, assignmentsChecked, assignmentsExpired, assignmentFailures });
  }

  // Routine no-op scans are intentionally silent in Goliath Actions. Record startup
  // visibility and every cycle that actually expires/fails work so background role
  // changes are attributable even though no interaction triggered them.
  if (startup || failed || assignmentsExpired || assignmentFailures) {
    await audit.captureGoliathAction(client, {
      type: startup ? 'goliath.scheduler.temporary_roles.startup' : 'goliath.scheduler.temporary_roles.expiry',
      category: 'goliath',
      action: 'execute',
      system: 'Timed Roles',
      result: (failed || assignmentFailures) ? 'Partial / Failed' : 'Success',
      summary: startup
        ? `Temporary Roles startup expiry scan checked ${checked} guild(s); ${assignmentsExpired} assignment(s) expired and ${assignmentFailures + failed} failure(s) were recorded.`
        : `Temporary Roles scheduled expiry scan expired ${assignmentsExpired} assignment(s) across ${checked} guild(s); ${assignmentFailures + failed} failure(s) were recorded.`,
      metadata: {
        schedulerId: SCHEDULER_ID,
        startup,
        guildsChecked: checked,
        guildsSkipped: skipped,
        guildFailures: failed,
        assignmentsChecked,
        assignmentsExpired,
        assignmentFailures,
      },
    }).catch((error) => console.warn('[TemporaryRoles] Could not record scheduler audit action:', error?.message || error));
  }

  return { checked, skipped, failed, assignmentsChecked, assignmentsExpired, assignmentFailures };
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
