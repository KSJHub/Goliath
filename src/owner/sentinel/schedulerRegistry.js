'use strict';

const registry = new Map();

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function schedulerId(input = {}) {
  if (typeof input === 'string') return String(input).trim();
  if (input?.id) return String(input.id).trim();
  const moduleKey = String(input.module || 'runtime').trim();
  const component = String(input.component || input.name || 'scheduler').trim();
  const guildId = input.guildId ? String(input.guildId).trim() : 'global';
  return `${moduleKey}:${component}:${guildId}`;
}

function register(input = {}) {
  const id = schedulerId(input);
  if (!id) throw new Error('Sentinel scheduler registration requires an id or module/component.');

  const now = new Date().toISOString();
  const intervalMs = positiveMs(input.intervalMs, 60_000);
  const staleAfterMs = positiveMs(input.staleAfterMs, Math.max(intervalMs * 3, 180_000));
  const existing = registry.get(id) || {};

  const entry = {
    id,
    module: String(input.module || existing.module || 'runtime'),
    component: String(input.component || input.name || existing.component || 'scheduler'),
    guildId: input.guildId ? String(input.guildId) : existing.guildId || null,
    guildName: input.guildName || existing.guildName || null,
    environment: input.environment || existing.environment || null,
    intervalMs,
    staleAfterMs,
    registeredAt: existing.registeredAt || now,
    lastBeatAt: existing.lastBeatAt || now,
    lastSuccessAt: existing.lastSuccessAt || null,
    lastFailureAt: existing.lastFailureAt || null,
    lastError: existing.lastError || null,
    consecutiveFailures: Number(existing.consecutiveFailures || 0),
    beats: Number(existing.beats || 0),
    failures: Number(existing.failures || 0),
    state: 'running',
    stoppedAt: null,
    stopReason: null,
    details: { ...(existing.details || {}), ...(input.details || {}) },
  };

  registry.set(id, entry);
  return id;
}

function ensureEntry(idOrInput) {
  const id = schedulerId(idOrInput);
  if (!id) throw new Error('Sentinel scheduler update requires an id or module/component.');
  if (!registry.has(id)) {
    const registration = typeof idOrInput === 'object'
      ? { ...idOrInput, id }
      : { id, component: id };
    register(registration);
  }
  const entry = registry.get(id);
  if (!entry) throw new Error(`Sentinel scheduler registry failed to initialise ${id}.`);
  return { id, entry };
}

function beat(idOrInput, details = {}) {
  const { id, entry } = ensureEntry(idOrInput);
  const now = new Date().toISOString();
  entry.state = 'running';
  entry.stoppedAt = null;
  entry.stopReason = null;
  entry.lastBeatAt = now;
  entry.lastSuccessAt = now;
  entry.lastError = null;
  entry.consecutiveFailures = 0;
  entry.beats += 1;
  entry.details = { ...(entry.details || {}), ...(details || {}) };
  registry.set(id, entry);
  return { ...entry, details: { ...entry.details } };
}

function fail(idOrInput, error, details = {}) {
  const { id, entry } = ensureEntry(idOrInput);
  const now = new Date().toISOString();
  entry.state = 'running';
  entry.stoppedAt = null;
  entry.stopReason = null;
  entry.lastBeatAt = now;
  entry.lastFailureAt = now;
  entry.lastError = String(error?.stack || error?.message || error || 'Unknown scheduler failure').slice(0, 3500);
  entry.consecutiveFailures += 1;
  entry.failures += 1;
  entry.details = { ...(entry.details || {}), ...(details || {}) };
  registry.set(id, entry);
  return { ...entry, details: { ...entry.details } };
}

function stop(idOrInput, reason = 'intentional shutdown', details = {}) {
  const { id, entry } = ensureEntry(idOrInput);
  const now = new Date().toISOString();
  entry.state = 'stopped';
  entry.stoppedAt = now;
  entry.stopReason = String(reason || 'intentional shutdown').slice(0, 500);
  entry.details = { ...(entry.details || {}), ...(details || {}) };
  registry.set(id, entry);
  return { ...entry, details: { ...entry.details } };
}

function unregister(idOrInput) {
  return registry.delete(schedulerId(idOrInput));
}

function entries() {
  return [...registry.values()].map((entry) => ({ ...entry, details: { ...(entry.details || {}) } }));
}

function snapshot() {
  return Object.fromEntries(entries().map((entry) => [entry.id, entry]));
}

function clear() {
  registry.clear();
}

module.exports = {
  register,
  beat,
  fail,
  stop,
  unregister,
  entries,
  snapshot,
  clear,
  schedulerId,
};
