'use strict';

const subscriptionAdminManager = require('./subscriptionAdminManager');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const SCHEDULER_ID = 'billing:subscription-expiry:global';
let workerTimer = null;
let running = false;

function getIntervalMs() {
  const minutes = Number(process.env.SUBSCRIPTION_WORKER_INTERVAL_MINUTES || 60);
  if (!Number.isFinite(minutes) || minutes < 5) return DEFAULT_INTERVAL_MS;
  return Math.round(minutes * 60 * 1000);
}

function registerScheduler(intervalMs = getIntervalMs()) {
  return sentinelScheduler.register({
    id: SCHEDULER_ID,
    module: 'billing',
    component: 'subscription-expiry',
    intervalMs,
    staleAfterMs: Math.max(intervalMs * 3, 180_000),
  });
}

function runSubscriptionExpiryCheck() {
  const schedulerId = registerScheduler();
  if (running) {
    sentinelScheduler.beat(schedulerId, { skipped: true, reason: 'already_running' });
    return {
      skipped: true,
      reason: 'already_running',
    };
  }

  running = true;

  try {
    const result = subscriptionAdminManager.processExpiredSubscriptions({
      actor: 'subscription_worker',
    });

    if (result.expiredCount > 0) {
      console.log(`[Subscription Worker] Expired ${result.expiredCount} subscription(s).`);
    }

    sentinelScheduler.beat(schedulerId, {
      expiredCount: Number(result.expiredCount || 0),
      success: result.success !== false,
    });
    return result;
  } catch (error) {
    sentinelScheduler.fail(schedulerId, error, { phase: 'expiry-check' });
    console.error('[Subscription Worker] Expiry check failed:', error);
    return {
      success: false,
      error: error.message || 'Subscription expiry check failed.',
    };
  } finally {
    running = false;
  }
}

function startSubscriptionWorker() {
  if (workerTimer) return workerTimer;

  const intervalMs = getIntervalMs();
  registerScheduler(intervalMs);

  console.log(`[Subscription Worker] Starting expiry worker every ${Math.round(intervalMs / 60000)} minute(s).`);
  runSubscriptionExpiryCheck();

  workerTimer = setInterval(runSubscriptionExpiryCheck, intervalMs);
  if (typeof workerTimer.unref === 'function') workerTimer.unref();

  return workerTimer;
}

function stopSubscriptionWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  sentinelScheduler.stop(SCHEDULER_ID, 'Subscription expiry worker stopped intentionally.');
}

module.exports = {
  runSubscriptionExpiryCheck,
  startSubscriptionWorker,
  stopSubscriptionWorker,
};
