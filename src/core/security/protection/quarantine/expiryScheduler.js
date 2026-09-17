'use strict';

const quarantine = require('../quarantine');
const schedulerRegistry = require('../../../../owner/sentinel/schedulerRegistry');
const auditIntelligence = require('../../../../owner/auditIntelligence/auditIntelligence');

const QUARANTINE_SWEEP_INTERVAL_MS = Number(quarantine.QUARANTINE_SWEEP_INTERVAL_MS || 60_000);
const QUARANTINE_SCHEDULER_ID = 'security:quarantine-expiry:global';
let quarantineSweepTimer = null;

async function recordExpiryActions(client, phase, result) {
  if (!client || !result) return;
  const changed = Number(result.restored || 0) + Number(result.clearedAbsent || 0);
  const failed = Number(result.failed || 0);
  if (!changed && !failed) return;

  for (const guild of client.guilds.cache.values()) {
    await auditIntelligence.captureGoliathAction(client, {
      guild,
      guildId: guild.id,
      type: 'goliath.background.quarantine_expiry',
      category: 'security',
      action: failed ? 'expiry_cycle_attention' : 'expiry_cycle',
      result: failed ? 'Warning' : 'Success',
      summary: `Goliath quarantine expiry ${phase} cycle processed ${Number(result.checked || 0)} expired snapshot(s): ${Number(result.restored || 0)} member(s) restored, ${Number(result.clearedAbsent || 0)} absent snapshot(s) cleared, ${failed} failure(s).`,
      target: { type: 'guild', id: guild.id, label: guild.name },
      reason: 'Automatic quarantine expiry and safe restoration cycle',
      metadata: {
        schedulerId: QUARANTINE_SCHEDULER_ID,
        phase,
        checked: Number(result.checked || 0),
        restored: Number(result.restored || 0),
        clearedAbsent: Number(result.clearedAbsent || 0),
        failed,
        automatic: true,
      },
    }).catch((error) => {
      console.warn(`[QuarantineSystem] Could not record expiry audit action for ${guild.id}:`, error?.message || error);
    });
  }
}

async function runExpiryCycle(client, phase = 'scheduled') {
  try {
    const result = await quarantine.restoreExpiredQuarantines(client);
    if (Number(result.failed || 0) > 0) {
      schedulerRegistry.fail(
        QUARANTINE_SCHEDULER_ID,
        new Error(`${result.failed} quarantine expiry restoration(s) failed.`),
        { phase, ...result },
      );
    } else {
      schedulerRegistry.beat(QUARANTINE_SCHEDULER_ID, { phase, ...result });
    }
    await recordExpiryActions(client, phase, result);
    return result;
  } catch (error) {
    schedulerRegistry.fail(QUARANTINE_SCHEDULER_ID, error, { phase });
    console.warn('[QuarantineSystem] Expiry scheduler failed:', error?.message || error);
    return { checked: 0, restored: 0, clearedAbsent: 0, failed: 1, error: error?.message || String(error) };
  }
}

function startQuarantineExpiryScheduler(client) {
  if (!client) return null;
  if (quarantineSweepTimer) return quarantineSweepTimer;

  schedulerRegistry.register({
    id: QUARANTINE_SCHEDULER_ID,
    module: 'security',
    component: 'quarantine-expiry',
    intervalMs: QUARANTINE_SWEEP_INTERVAL_MS,
    staleAfterMs: QUARANTINE_SWEEP_INTERVAL_MS * 3,
    details: { implementation: 'split-expiry-scheduler' },
  });

  void runExpiryCycle(client, 'startup');
  quarantineSweepTimer = setInterval(() => {
    void runExpiryCycle(client, 'scheduled');
  }, QUARANTINE_SWEEP_INTERVAL_MS);
  quarantineSweepTimer.unref?.();
  return quarantineSweepTimer;
}

function stopQuarantineExpiryScheduler() {
  if (quarantineSweepTimer) clearInterval(quarantineSweepTimer);
  quarantineSweepTimer = null;
  schedulerRegistry.stop(QUARANTINE_SCHEDULER_ID, 'quarantine expiry scheduler stopped');
}

module.exports = {
  QUARANTINE_SWEEP_INTERVAL_MS,
  runExpiryCycle,
  startQuarantineExpiryScheduler,
  stopQuarantineExpiryScheduler,
};
