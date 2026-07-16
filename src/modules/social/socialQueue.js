'use strict';

const crypto = require('crypto');
const socialStore = require('./socialStore');
const socialHistory = require('./socialHistory');

const MAX_QUEUE_ITEMS = 200;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
let intervalRef = null;
let processing = false;

function now() {
  return new Date().toISOString();
}

function cleanText(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function normalizeItem(item = {}) {
  const attempts = Math.max(0, Math.floor(Number(item.attempts || 0)));
  return {
    id: cleanText(item.id || `social_queue_${crypto.randomUUID().slice(0, 12)}`, '', 100),
    accountId: cleanText(item.accountId, '', 100),
    platform: cleanText(item.platform, '', 30) || null,
    alertType: cleanText(item.alertType || 'live', 'live', 30),
    contentId: cleanText(item.contentId, '', 200) || null,
    providerResult: item.providerResult && typeof item.providerResult === 'object' && !Array.isArray(item.providerResult)
      ? JSON.parse(JSON.stringify(item.providerResult))
      : {},
    reason: cleanText(item.reason || 'delivery_retry', 'delivery_retry', 100),
    status: item.status === 'failed' ? 'failed' : 'queued',
    attempts,
    lastError: cleanText(item.lastError, '', 1000) || null,
    createdAt: item.createdAt || now(),
    updatedAt: item.updatedAt || item.createdAt || now(),
    nextAttemptAt: item.nextAttemptAt || now(),
  };
}

function list(guildId, options = {}) {
  const section = socialStore.getSocialSection(guildId);
  let items = Array.isArray(section.deliveryQueue) ? section.deliveryQueue.map(normalizeItem) : [];
  if (options.status) items = items.filter((item) => item.status === String(options.status));
  if (options.accountId) items = items.filter((item) => item.accountId === String(options.accountId));
  const limit = Math.min(Math.max(Number(options.limit || MAX_QUEUE_ITEMS), 1), MAX_QUEUE_ITEMS);
  return items.slice(0, limit);
}

function save(guildId, items, meta = {}) {
  return socialStore.updateSocialSection(guildId, (section) => ({
    ...section,
    deliveryQueue: (Array.isArray(items) ? items : []).map(normalizeItem).slice(0, MAX_QUEUE_ITEMS),
    updatedAt: now(),
  }), { action: 'social_queue_save', ...meta });
}

function findDuplicate(items, input = {}) {
  if (!input.accountId || !input.contentId) return null;
  return items.find((item) => item.accountId === input.accountId && item.contentId === input.contentId && item.status === 'queued') || null;
}

function enqueue(guildId, input = {}, meta = {}) {
  const current = list(guildId);
  const duplicate = findDuplicate(current, input);
  if (duplicate) return { item: duplicate, duplicate: true };

  const item = normalizeItem({ ...input, status: 'queued', attempts: Number(input.attempts || 0), nextAttemptAt: input.nextAttemptAt || now() });
  save(guildId, [item, ...current], meta);
  socialHistory.record(guildId, {
    status: 'queued',
    eventType: 'delivery',
    accountId: item.accountId,
    platform: item.platform,
    alertType: item.alertType,
    contentId: item.contentId,
    title: item.providerResult?.title || null,
    reason: item.reason,
    error: item.lastError,
    metadata: { queueId: item.id, attempts: item.attempts, nextAttemptAt: item.nextAttemptAt },
  }, meta);
  return { item, duplicate: false };
}

function remove(guildId, queueId, meta = {}) {
  const current = list(guildId);
  const next = current.filter((item) => item.id !== String(queueId));
  save(guildId, next, meta);
  return next.length !== current.length;
}

function retryNow(guildId, queueId, meta = {}) {
  const current = list(guildId);
  let updated = null;
  const next = current.map((item) => {
    if (item.id !== String(queueId)) return item;
    updated = normalizeItem({ ...item, status: 'queued', nextAttemptAt: now(), updatedAt: now() });
    return updated;
  });
  if (updated) save(guildId, next, meta);
  return updated;
}

function clear(guildId, meta = {}) {
  save(guildId, [], meta);
  return [];
}

function nextDelay(attempts) {
  return RETRY_DELAYS_MS[Math.min(Math.max(Number(attempts || 1) - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

async function processGuild(guildId, client, options = {}) {
  const socialManager = require('./socialManager');
  const current = list(guildId);
  if (!current.length) return { guildId, processed: 0, sent: 0, failed: 0, deferred: 0 };

  const accounts = new Map(socialManager.getConfig(guildId).accounts.map((account) => [account.accountId, account]));
  const remaining = [];
  const results = { guildId, processed: 0, sent: 0, failed: 0, deferred: 0 };
  const timestamp = Date.now();

  for (const item of current) {
    if (item.status === 'failed' || new Date(item.nextAttemptAt).getTime() > timestamp) {
      remaining.push(item);
      continue;
    }

    const account = accounts.get(item.accountId);
    if (!account || account.enabled === false) {
      results.failed += 1;
      socialHistory.record(guildId, {
        status: 'failed', eventType: 'queue', accountId: item.accountId, platform: item.platform,
        alertType: item.alertType, contentId: item.contentId, reason: !account ? 'account_missing' : 'account_disabled',
        metadata: { queueId: item.id },
      }, options.meta || {});
      continue;
    }

    if (socialManager.isQuietHours(guildId, account, new Date())) {
      remaining.push(item);
      results.deferred += 1;
      continue;
    }

    results.processed += 1;
    const delivery = await socialManager.deliverQueuedAlert(guildId, account, item.providerResult, client, {
      ...(options.meta || {}), queueId: item.id,
    });

    if (delivery.success) {
      results.sent += 1;
      socialHistory.record(guildId, {
        status: 'retried', eventType: 'queue', accountId: item.accountId, creator: account.displayName,
        platform: item.platform, alertType: item.alertType, contentId: item.contentId,
        channelId: delivery.channelId, messageId: delivery.messageId,
        title: item.providerResult?.title || null, metadata: { queueId: item.id, attempts: item.attempts + 1 },
      }, options.meta || {});
      continue;
    }

    const attempts = item.attempts + 1;
    const permanentlyFailed = attempts >= MAX_ATTEMPTS;
    const updated = normalizeItem({
      ...item,
      status: permanentlyFailed ? 'failed' : 'queued',
      attempts,
      lastError: delivery.error || delivery.reason || 'Delivery failed.',
      updatedAt: now(),
      nextAttemptAt: new Date(Date.now() + nextDelay(attempts)).toISOString(),
    });
    remaining.push(updated);
    results.failed += 1;

    socialHistory.record(guildId, {
      status: permanentlyFailed ? 'failed' : 'queued', eventType: 'queue', accountId: item.accountId,
      creator: account.displayName, platform: item.platform, alertType: item.alertType, contentId: item.contentId,
      title: item.providerResult?.title || null, error: updated.lastError,
      reason: permanentlyFailed ? 'retry_limit_reached' : 'retry_scheduled',
      metadata: { queueId: item.id, attempts, nextAttemptAt: updated.nextAttemptAt },
    }, options.meta || {});
  }

  save(guildId, remaining, options.meta || {});
  return results;
}

async function processAll(client, options = {}) {
  if (processing) return { skipped: true, reason: 'already_processing' };
  processing = true;
  try {
    const guildIds = Array.isArray(options.guildIds) && options.guildIds.length
      ? options.guildIds
      : [...(client?.guilds?.cache?.keys?.() || [])];
    const results = [];
    for (const guildId of guildIds) results.push(await processGuild(guildId, client, options));
    return { skipped: false, results };
  } finally {
    processing = false;
  }
}

function start(client, options = {}) {
  if (intervalRef) return intervalRef;
  const intervalMs = Math.max(60_000, Number(options.intervalMs || 60_000));
  processAll(client, options).catch((error) => console.error('[SocialQueue] Startup processing failed:', error));
  intervalRef = setInterval(() => {
    processAll(client, options).catch((error) => console.error('[SocialQueue] Processing failed:', error));
  }, intervalMs);
  intervalRef.unref?.();
  console.log(`[SocialQueue] Delivery queue ready (${intervalMs}ms)`);
  return intervalRef;
}

function stop() {
  if (!intervalRef) return false;
  clearInterval(intervalRef);
  intervalRef = null;
  return true;
}

function summary(guildId) {
  const items = list(guildId);
  return {
    total: items.length,
    queued: items.filter((item) => item.status === 'queued').length,
    failed: items.filter((item) => item.status === 'failed').length,
    nextAttemptAt: items.filter((item) => item.status === 'queued').sort((a, b) => new Date(a.nextAttemptAt) - new Date(b.nextAttemptAt))[0]?.nextAttemptAt || null,
  };
}

module.exports = {
  MAX_QUEUE_ITEMS,
  MAX_ATTEMPTS,
  list,
  enqueue,
  remove,
  retryNow,
  clear,
  processGuild,
  processAll,
  start,
  stop,
  summary,
};