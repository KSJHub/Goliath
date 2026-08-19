'use strict';

const scheduler = require('./schedulerRegistry.js');

let timer = null;

function baseIncident(entry) {
  return {
    guildId: entry.guildId || undefined,
    guildName: entry.guildName || undefined,
    module: entry.module || 'runtime',
    component: `scheduler:${entry.component || entry.id}`,
    code: `scheduler-stale:${entry.id}`,
  };
}

async function cycle(client, sentinel) {
  const now = Date.now();
  for (const entry of scheduler.entries()) {
    const base = baseIncident(entry);
    const failureBase = {
      ...base,
      code: `scheduler-failing:${entry.id}`,
      component: `scheduler:${entry.component || entry.id}:failures`,
    };

    if (entry.state === 'stopped') {
      await sentinel.recover(client, base, {
        schedulerId: entry.id,
        state: 'stopped',
        stoppedAt: entry.stoppedAt,
        stopReason: entry.stopReason,
      });
      await sentinel.recover(client, failureBase, {
        schedulerId: entry.id,
        state: 'stopped',
        stoppedAt: entry.stoppedAt,
      });
      continue;
    }

    const lastBeat = Date.parse(entry.lastBeatAt || '') || 0;
    const ageMs = lastBeat ? now - lastBeat : Infinity;

    if (ageMs > entry.staleAfterMs) {
      await sentinel.report(client, {
        ...base,
        severity: ageMs > entry.staleAfterMs * 2 ? 'critical' : 'error',
        message: 'A registered background scheduler has stopped reporting its expected heartbeat.',
        details: {
          schedulerId: entry.id,
          state: entry.state || 'running',
          expectedIntervalMs: entry.intervalMs,
          staleAfterMs: entry.staleAfterMs,
          lastBeatAt: entry.lastBeatAt,
          lastSuccessAt: entry.lastSuccessAt,
          lastFailureAt: entry.lastFailureAt,
          consecutiveFailures: entry.consecutiveFailures,
          lastError: entry.lastError,
        },
      });
    } else {
      await sentinel.recover(client, base, {
        schedulerId: entry.id,
        state: entry.state || 'running',
        lastBeatAt: entry.lastBeatAt,
        lastSuccessAt: entry.lastSuccessAt,
      });
    }

    if (entry.consecutiveFailures >= 3) {
      await sentinel.report(client, {
        ...failureBase,
        severity: entry.consecutiveFailures >= 6 ? 'critical' : 'error',
        message: 'A registered background scheduler is repeatedly failing while still running.',
        details: {
          schedulerId: entry.id,
          state: entry.state || 'running',
          consecutiveFailures: entry.consecutiveFailures,
          failures: entry.failures,
          lastFailureAt: entry.lastFailureAt,
          lastError: entry.lastError,
        },
      });
    } else {
      await sentinel.recover(client, failureBase, {
        schedulerId: entry.id,
        state: entry.state || 'running',
        consecutiveFailures: entry.consecutiveFailures,
      });
    }
  }

  return scheduler.snapshot();
}

function start(client, sentinel, intervalMs = 60_000) {
  if (timer || !client || typeof sentinel?.report !== 'function') return false;
  cycle(client, sentinel).catch(() => null);
  timer = setInterval(() => cycle(client, sentinel).catch(() => null), Math.max(30_000, Number(intervalMs) || 60_000));
  timer.unref?.();
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function status() {
  return { running: Boolean(timer), schedulers: scheduler.snapshot() };
}

module.exports = { start, stop, cycle, status };
