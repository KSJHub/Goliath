'use strict';

const LIVE_REFRESH_INTERVALS = Object.freeze([
  10 * 60 * 1000,
  15 * 60 * 1000,
  20 * 60 * 1000,
  30 * 60 * 1000,
  45 * 60 * 1000,
  60 * 60 * 1000,
]);

const LIVE_REFRESH_INTERVAL_SET = new Set(LIVE_REFRESH_INTERVALS);
const DEFAULT_LIVE_REFRESH_MS = LIVE_REFRESH_INTERVALS[0];

function liveRefreshEnabled(settings = {}) {
  return settings.liveMessageRefreshEnabled !== false;
}

function liveRefreshMs(settings = {}) {
  const requested = Number(settings.liveMessageRefreshMs);
  return LIVE_REFRESH_INTERVAL_SET.has(requested) ? requested : DEFAULT_LIVE_REFRESH_MS;
}

function coreRefreshBaseMs(account) {
  return String(account?.platform || '').toLowerCase() === 'kick'
    ? 5 * 60 * 1000
    : 60 * 60 * 1000;
}

function projectedRefreshTimestamp(account, state, settings = {}, dateNow = Date.now()) {
  if (state?.isLive !== true) return null;

  const actualRaw = state.lastLiveMessageUpdatedAt || state.lastLiveMessageUpdateAt || null;
  const actualMs = typeof actualRaw === 'number'
    ? actualRaw
    : actualRaw instanceof Date
      ? actualRaw.getTime()
      : Date.parse(String(actualRaw || ''));

  if (!Number.isFinite(actualMs)) return null;

  // Refresh Off only suppresses periodic LIVE edits. Provider checks and the
  // mandatory LIVE -> OFFLINE transition continue independently in monitor core.
  if (!liveRefreshEnabled(settings)) return new Date(dateNow);

  return new Date(actualMs + (liveRefreshMs(settings) - coreRefreshBaseMs(account)));
}

module.exports = {
  LIVE_REFRESH_INTERVALS,
  DEFAULT_LIVE_REFRESH_MS,
  liveRefreshEnabled,
  liveRefreshMs,
  projectedRefreshTimestamp,
};
