'use strict';

const crypto = require('crypto');
const socialStore = require('./socialStore');

const MAX_HISTORY = 500;
const VALID_STATUSES = new Set(['sent', 'failed', 'skipped', 'suppressed', 'queued', 'retried', 'test']);

function now() {
  return new Date().toISOString();
}

function cleanText(value, fallback = '', maxLength = 500) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanStatus(value) {
  const status = cleanText(value, 'skipped', 30).toLowerCase();
  return VALID_STATUSES.has(status) ? status : 'skipped';
}

function normalizeEntry(entry = {}) {
  return {
    id: cleanText(entry.id || `social_event_${crypto.randomUUID().slice(0, 12)}`, '', 100),
    status: cleanStatus(entry.status),
    eventType: cleanText(entry.eventType || 'alert', 'alert', 40),
    alertType: cleanText(entry.alertType || 'live', 'live', 30),
    accountId: cleanText(entry.accountId, '', 100) || null,
    creator: cleanText(entry.creator, '', 120) || null,
    platform: cleanText(entry.platform, '', 30) || null,
    contentId: cleanText(entry.contentId, '', 200) || null,
    channelId: cleanText(entry.channelId, '', 30) || null,
    messageId: cleanText(entry.messageId, '', 30) || null,
    title: cleanText(entry.title, '', 300) || null,
    reason: cleanText(entry.reason, '', 500) || null,
    error: cleanText(entry.error, '', 1000) || null,
    providerStatus: cleanText(entry.providerStatus, '', 80) || null,
    isTest: entry.isTest === true,
    createdAt: entry.createdAt || now(),
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? JSON.parse(JSON.stringify(entry.metadata))
      : {},
  };
}

function list(guildId, options = {}) {
  const section = socialStore.getSocialSection(guildId);
  let entries = Array.isArray(section.history) ? section.history.map(normalizeEntry) : [];

  if (options.status) entries = entries.filter((entry) => entry.status === cleanStatus(options.status));
  if (options.accountId) entries = entries.filter((entry) => entry.accountId === String(options.accountId));
  if (options.platform) entries = entries.filter((entry) => entry.platform === String(options.platform).toLowerCase());
  if (options.alertType) entries = entries.filter((entry) => entry.alertType === String(options.alertType).toLowerCase());

  const limit = Math.min(Math.max(Number(options.limit || 100), 1), MAX_HISTORY);
  return entries.slice(0, limit);
}

function record(guildId, entry = {}, meta = {}) {
  const normalized = normalizeEntry(entry);
  socialStore.updateSocialSection(guildId, (section) => ({
    ...section,
    history: [normalized, ...(Array.isArray(section.history) ? section.history : [])]
      .map(normalizeEntry)
      .slice(0, MAX_HISTORY),
    updatedAt: now(),
  }), { action: 'social_history_record', ...meta });
  return normalized;
}

function clear(guildId, meta = {}) {
  return socialStore.updateSocialSection(guildId, (section) => ({
    ...section,
    history: [],
    updatedAt: now(),
  }), { action: 'social_history_clear', ...meta });
}

function summary(guildId) {
  const entries = list(guildId, { limit: MAX_HISTORY });
  const counts = {};
  for (const entry of entries) counts[entry.status] = Number(counts[entry.status] || 0) + 1;
  return {
    total: entries.length,
    sent: Number(counts.sent || 0),
    failed: Number(counts.failed || 0),
    skipped: Number(counts.skipped || 0),
    suppressed: Number(counts.suppressed || 0),
    queued: Number(counts.queued || 0),
    retried: Number(counts.retried || 0),
    tests: Number(counts.test || 0),
    latestAt: entries[0]?.createdAt || null,
  };
}

module.exports = {
  MAX_HISTORY,
  normalizeEntry,
  list,
  record,
  clear,
  summary,
};