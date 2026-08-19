'use strict';

const crypto = require('node:crypto');
const { getGuildSection, updateGuildSection, isModuleEnabled } = require('../guild/guildManager');

function now() { return new Date().toISOString(); }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function list(value) { return Array.isArray(value) ? value : []; }
function text(value = '', fallback = '', max = 1000) { return String(value ?? fallback).trim().slice(0, max); }
function base() { return { entries: [], updatedAt: now() }; }

function normalise(entry = {}) {
  const severity = ['debug', 'info', 'success', 'warning', 'danger'].includes(entry.severity) ? entry.severity : 'info';
  return {
    id: entry.id || `act_${crypto.randomUUID()}`,
    module: text(entry.module || entry.source || 'system', 'system', 80),
    event: text(entry.event || entry.type || 'activity.event', 'activity.event', 120),
    title: text(entry.title || 'Activity', 'Activity', 160),
    message: text(entry.message || '', '', 1200),
    severity,
    route: text(entry.route || '', '', 200),
    actorId: text(entry.actorId || '', '', 40) || null,
    targetId: text(entry.targetId || '', '', 80) || null,
    createdAt: entry.createdAt || now(),
    metadata: obj(entry.metadata),
  };
}

function section(guildId) {
  const current = { ...base(), ...obj(getGuildSection(guildId, 'activityTimeline', base())) };
  return { ...current, entries: list(current.entries) };
}

function logActivity(guildId, entry = {}) {
  if (!guildId || !isModuleEnabled(guildId, 'timeline')) return null;
  const activity = normalise(entry);
  updateGuildSection(guildId, 'activityTimeline', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    return { ...next, entries: [activity, ...list(next.entries)].slice(0, 1000), updatedAt: now() };
  }, base());
  return activity;
}

function getTimeline(guildId, filters = {}) {
  let entries = section(guildId).entries.map(normalise);
  if (filters.module) entries = entries.filter((entry) => entry.module === filters.module);
  if (filters.severity) entries = entries.filter((entry) => entry.severity === filters.severity);
  if (filters.search) {
    const needle = String(filters.search).toLowerCase();
    entries = entries.filter((entry) => `${entry.module} ${entry.event} ${entry.title} ${entry.message}`.toLowerCase().includes(needle));
  }
  const requestedLimit = Number(filters.limit ?? 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit)))
    : 100;
  return entries.slice(0, limit);
}

function clearTimeline(guildId) {
  updateGuildSection(guildId, 'activityTimeline', () => base(), base());
  return [];
}

function summary(guildId) {
  const entries = getTimeline(guildId, { limit: 1000 });
  return {
    total: entries.length,
    danger: entries.filter((entry) => entry.severity === 'danger').length,
    warning: entries.filter((entry) => entry.severity === 'warning').length,
    modules: [...new Set(entries.map((entry) => entry.module))],
    latestAt: entries[0]?.createdAt || null,
  };
}

module.exports = { logActivity, getTimeline, clearTimeline, summary };
