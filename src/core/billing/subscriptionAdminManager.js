'use strict';

const fs = require('node:fs');
const path = require('node:path');

const guildManager = require('../guild/guildManager');
const { resolveBillingPath } = require('./billingPaths');
const { PLAN_IDS, normalizePlanId, getPlanDefinition } = require('../../config/plans');
const subscriptionManager = require('./subscriptionManager');

function now() {
  return new Date().toISOString();
}

function getHistoryFile() {
  return resolveBillingPath('subscriptionHistory.json');
}

function cleanGuildId(value) {
  const guildId = String(value || '').trim();
  if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.');
  return guildId;
}

function normalizeDurationDays(value, plan) {
  if (plan === PLAN_IDS.LIFETIME) return null;
  const input = String(value || '30').trim().toLowerCase();
  if (input === 'lifetime') return null;
  if (input === '1m') return 30;
  if (input === '3m') return 90;
  if (input === '6m') return 180;
  const days = Number(input);
  if (!Number.isFinite(days) || days <= 0) return 30;
  return Math.round(days);
}

function addDaysFrom(startValue, days) {
  const numericDays = Number(days);
  if (!Number.isFinite(numericDays) || numericDays <= 0) return null;

  const start = startValue ? new Date(startValue) : new Date();
  const base = Number.isFinite(start.getTime()) && start.getTime() > Date.now() ? start : new Date();
  base.setUTCDate(base.getUTCDate() + Math.trunc(numericDays));

  if (!Number.isFinite(base.getTime())) {
    throw new Error('Subscription duration exceeds the supported date range.');
  }

  return base.toISOString();
}

function readHistory() {
  const file = getHistoryFile();
  if (!fs.existsSync(file)) return { history: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { history: Array.isArray(parsed.history) ? parsed.history : [] };
  } catch {
    return { history: [] };
  }
}

function writeHistory(data) {
  fs.writeFileSync(getHistoryFile(), JSON.stringify({ history: Array.isArray(data.history) ? data.history : [] }, null, 2));
}

function addHistory(entry = {}) {
  const data = readHistory();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now(),
    ...entry,
  };
  data.history.unshift(item);
  data.history = data.history.slice(0, 1000);
  writeHistory(data);
  return item;
}

function listHistory(limit = 100) {
  const numericLimit = Number(limit);
  const safeLimit = Number.isFinite(numericLimit)
    ? Math.min(Math.max(Math.trunc(numericLimit), 1), 500)
    : 100;
  return readHistory().history.slice(0, safeLimit);
}

function listSubscriptions() {
  const files = guildManager.listGuildFiles();
  return files.map((filePath) => {
    const guildId = path.basename(filePath, '.json');
    const guild = guildManager.getGuildData(guildId);
    const subscription = subscriptionManager.getSubscription(guildId);
    const plan = getPlanDefinition(subscription.plan);

    return {
      guildId,
      guildName: guild.guildName || guild.name || guild.meta?.guildName || 'Unknown Guild',
      subscription,
      plan: {
        id: plan.id,
        name: plan.name,
        icon: plan.icon,
        public: plan.public !== false,
        rank: plan.rank,
      },
    };
  }).sort((a, b) => {
    const rankDiff = (b.plan?.rank || 0) - (a.plan?.rank || 0);
    if (rankDiff) return rankDiff;
    return String(a.guildName).localeCompare(String(b.guildName));
  });
}

function grantSubscription({ guildId, plan = PLAN_IDS.PLUS, duration = 30, actor = 'owner' } = {}) {
  const safeGuildId = cleanGuildId(guildId);
  const requestedPlan = String(plan || '').trim().toLowerCase();
  if (!Object.values(PLAN_IDS).includes(requestedPlan)) {
    throw new Error('Invalid subscription plan.');
  }
  const normalizedPlan = normalizePlanId(requestedPlan);
  const durationDays = normalizeDurationDays(duration, normalizedPlan);
  const expiresAt = normalizedPlan === PLAN_IDS.LIFETIME ? null : addDaysFrom(null, durationDays);

  const previous = subscriptionManager.getSubscription(safeGuildId);
  const subscription = subscriptionManager.setSubscription(safeGuildId, normalizedPlan, {
    source: 'owner',
    expiresAt,
  });

  addHistory({
    action: 'grant',
    actor,
    guildId: safeGuildId,
    previousPlan: previous.plan,
    previousExpiresAt: previous.expiresAt,
    plan: subscription.plan,
    expiresAt: subscription.expiresAt,
    duration: durationDays,
  });

  return subscription;
}

function extendSubscription({ guildId, duration = 30, actor = 'owner' } = {}) {
  const safeGuildId = cleanGuildId(guildId);
  const current = subscriptionManager.getSubscription(safeGuildId);
  if (current.plan === PLAN_IDS.FREE) throw new Error('Cannot extend a Free subscription. Grant a premium plan first.');
  if (current.plan === PLAN_IDS.LIFETIME) throw new Error('Lifetime subscriptions do not expire.');

  const durationDays = normalizeDurationDays(duration, current.plan);
  const expiresAt = addDaysFrom(current.expiresAt, durationDays);
  const subscription = subscriptionManager.setSubscription(safeGuildId, current.plan, {
    source: current.source || 'owner',
    status: 'active',
    expiresAt,
  });

  addHistory({
    action: 'extend',
    actor,
    guildId: safeGuildId,
    plan: subscription.plan,
    previousExpiresAt: current.expiresAt,
    expiresAt: subscription.expiresAt,
    duration: durationDays,
  });

  return subscription;
}

function removeSubscription({ guildId, actor = 'owner' } = {}) {
  const safeGuildId = cleanGuildId(guildId);
  const previous = subscriptionManager.getSubscription(safeGuildId);
  const subscription = subscriptionManager.clearSubscription(safeGuildId, 'owner_removed');

  addHistory({
    action: 'remove',
    actor,
    guildId: safeGuildId,
    previousPlan: previous.plan,
    previousExpiresAt: previous.expiresAt,
    plan: subscription.plan,
    expiresAt: subscription.expiresAt,
  });

  return subscription;
}

function processExpiredSubscriptions({ actor = 'subscription_worker' } = {}) {
  const expired = [];
  const checkedAt = now();

  for (const filePath of guildManager.listGuildFiles()) {
    const guildId = path.basename(filePath, '.json');
    const current = subscriptionManager.getSubscription(guildId, { forceReload: true });

    if (current.plan === PLAN_IDS.FREE || current.plan === PLAN_IDS.LIFETIME) continue;
    if (!current.expiresAt) continue;

    const expiryTime = new Date(current.expiresAt).getTime();
    if (!Number.isFinite(expiryTime) || expiryTime > Date.now()) continue;

    const subscription = subscriptionManager.clearSubscription(guildId, 'expired');
    const history = addHistory({
      action: 'expire',
      actor,
      guildId,
      previousPlan: current.plan,
      previousExpiresAt: current.expiresAt,
      plan: subscription.plan,
      expiresAt: subscription.expiresAt,
      checkedAt,
    });

    expired.push({ guildId, previous: current, subscription, history });
  }

  return {
    checkedAt,
    expiredCount: expired.length,
    expired,
  };
}

module.exports = {
  listSubscriptions,
  listHistory,
  grantSubscription,
  extendSubscription,
  removeSubscription,
  processExpiredSubscriptions,
};
