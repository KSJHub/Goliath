'use strict';

const { restoreExpiredQuarantines } = require('./enforcementRecovery');
const schedulerRegistry = require('../../../../owner/sentinel/schedulerRegistry');

const QUARANTINE_SWEEP_INTERVAL_MS = 60_000;
const QUARANTINE_SCHEDULER_ID = 'security:quarantine-expiry:global';
let quarantineSweepTimer = null;

async function runExpiryCycle(client, phase = 'scheduled') {
  try {
    const result = await restoreExpiredQuarantines(client);
    if (Number(result.failed || 0) > 0) {
      schedulerRegistry.fail(
        QUARANTINE_SCHEDULER_ID,
        new Error(`${result.failed} quarantine expiry restoration(s) failed.`),
        { phase, ...result },
      );
    } else {
      schedulerRegistry.beat(QUARANTINE_SCHEDULER_ID, { phase, ...result });
    }
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
  schedulerRegistry.register({ id: QUARANTINE_SCHEDULER_ID, module: 'security', component: 'quarantine-expiry', intervalMs: QUARANTINE_SWEEP_INTERVAL_MS, staleAfterMs: QUARANTINE_SWEEP_INTERVAL_MS * 3, details: { implementation: 'split-expiry-scheduler' } });
  void runExpiryCycle(client, 'startup');
  quarantineSweepTimer = setInterval(() => { void runExpiryCycle(client, 'scheduled'); }, QUARANTINE_SWEEP_INTERVAL_MS);
  quarantineSweepTimer.unref?.();
  return quarantineSweepTimer;
}

function stopQuarantineExpiryScheduler() {
  if (quarantineSweepTimer) clearInterval(quarantineSweepTimer);
  quarantineSweepTimer = null;
  schedulerRegistry.stop(QUARANTINE_SCHEDULER_ID, 'quarantine expiry scheduler stopped');
}

module.exports = { QUARANTINE_SWEEP_INTERVAL_MS, runExpiryCycle, startQuarantineExpiryScheduler, stopQuarantineExpiryScheduler };
