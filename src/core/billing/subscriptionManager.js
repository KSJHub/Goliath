'use strict';

const guildManager = require('../guild/guildManager');
const { PLAN_IDS, normalizePlanId, getPlanDefinition } = require('../../config/plans');

const ACTIVE_STATUS = 'active';
const EXPIRED_STATUS = 'expired';
const CANCELLED_STATUS = 'cancelled';

function now() {
  return new Date().toISOString();
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultSubscription() {
  return {
    plan: PLAN_IDS.FREE,
    status: ACTIVE_STATUS,
    source: 'system',
    expiresAt: null,
    updatedAt: now(),
  };
}

function isExpired(subscription = {}) {
  if (!subscription.expiresAt) return false;
  const expiresAt = new Date(subscription.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function normalizeSubscription(subscription = {}) {
  const source = subscription && typeof subscription === 'object' ? subscription : {};
  const plan = normalizePlanId(source.plan);
  const normalized = {
    ...defaultSubscription(),
    ...source,
    plan,
    status: String(source.status || ACTIVE_STATUS).trim().toLowerCase() || ACTIVE_STATUS,
    source: String(source.source || 'system').trim().toLowerCase() || 'system',
    expiresAt: cleanDate(source.expiresAt),
    updatedAt: cleanDate(source.updatedAt) || now(),
  };

  if (normalized.plan === PLAN_IDS.LIFETIME) {
    normalized.status = ACTIVE_STATUS;
    normalized.expiresAt = null;
  } else if (isExpired(normalized)) {
    normalized.status = EXPIRED_STATUS;
  }

  if (![ACTIVE_STATUS, EXPIRED_STATUS, CANCELLED_STATUS, 'past_due'].includes(normalized.status)) {
    normalized.status = ACTIVE_STATUS;
  }

  return normalized;
}

function getSubscription(guildId, options = {}) {
  const guildData = guildManager.getGuildData(guildId, options);
  const subscription = normalizeSubscription(guildData.subscription || defaultSubscription());

  if (subscription.status === EXPIRED_STATUS && guildData.subscription?.status !== EXPIRED_STATUS) {
    return saveSubscription(guildId, subscription);
  }

  return subscription;
}

function saveSubscription(guildId, subscription = {}, guildOrMeta = {}) {
  const normalized = normalizeSubscription({
    ...subscription,
    updatedAt: now(),
  });

  const updatedGuild = guildManager.saveGuildData(guildId, { subscription: normalized }, guildOrMeta);
  return normalizeSubscription(updatedGuild.subscription);
}

function setSubscription(guildId, plan, options = {}, guildOrMeta = {}) {
  const nextSubscription = normalizeSubscription({
    plan,
    status: options.status || ACTIVE_STATUS,
    source: options.source || 'manual',
    expiresAt: plan === PLAN_IDS.LIFETIME ? null : cleanDate(options.expiresAt),
    stripeCustomerId: options.stripeCustomerId || null,
    stripeSubscriptionId: options.stripeSubscriptionId || null,
    redeemCode: options.redeemCode || null,
  });

  return saveSubscription(guildId, nextSubscription, guildOrMeta);
}

function clearSubscription(guildId, source = 'system', guildOrMeta = {}) {
  return saveSubscription(guildId, {
    ...defaultSubscription(),
    source,
  }, guildOrMeta);
}

function getActivePlan(guildId) {
  const subscription = getSubscription(guildId);
  if (subscription.status !== ACTIVE_STATUS) return PLAN_IDS.FREE;
  return normalizePlanId(subscription.plan);
}

function getActivePlanDefinition(guildId) {
  return getPlanDefinition(getActivePlan(guildId));
}

function hasActivePremium(guildId) {
  const plan = getActivePlan(guildId);
  return [PLAN_IDS.PLUS, PLAN_IDS.PRO, PLAN_IDS.LIFETIME].includes(plan);
}

function hasActivePro(guildId) {
  const plan = getActivePlan(guildId);
  return [PLAN_IDS.PRO, PLAN_IDS.LIFETIME].includes(plan);
}

module.exports = {
  getSubscription,
  setSubscription,
  clearSubscription,
  getActivePlan,
  hasActivePremium,
  hasActivePro,
};
