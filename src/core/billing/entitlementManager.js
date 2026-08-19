'use strict';

const {
  PLAN_IDS,
  getPlanDefinition,
  getPlanFeatures,
  getPlanLimits,
  planHasFeature,
  getRequiredPlanForFeature,
} = require('../../config/plans');

const subscriptionManager = require('./subscriptionManager');
const testDevOverride = require('../../owner/dev/DevOverrideManager');

function getDevPlan() {
  return testDevOverride.shouldBypassPaywall() ? testDevOverride.getPaywallBypassPlan() || PLAN_IDS.LIFETIME : null;
}

function getPlan(guildId) {
  return getDevPlan() || subscriptionManager.getActivePlan(guildId);
}

function getSubscription(guildId) {
  const devPlan = getDevPlan();
  if (!devPlan) return subscriptionManager.getSubscription(guildId);

  return {
    guildId: String(guildId || ''),
    plan: devPlan,
    status: 'dev_test_override',
    source: 'testdev',
    active: true,
    startedAt: null,
    expiresAt: null,
    devTest: testDevOverride.buildPaywallBypassMetadata(),
  };
}

function getCurrentPlanDefinition(guildId) {
  return getPlanDefinition(getPlan(guildId));
}

function getFeatures(guildId) {
  return getPlanFeatures(getPlan(guildId));
}

function getLimits(guildId) {
  return getPlanLimits(getPlan(guildId));
}

function canUseFeature(guildId, featureKey) {
  if (testDevOverride.shouldBypassPaywall()) return true;
  return planHasFeature(getPlan(guildId), featureKey);
}

function requireFeature(guildId, featureKey) {
  if (canUseFeature(guildId, featureKey)) return true;

  const requiredPlan = getRequiredPlanForFeature(featureKey);
  const planName = requiredPlan?.name || 'Plus or Pro';
  const error = new Error(`This feature requires Goliath ${planName}.`);
  error.code = 'FEATURE_LOCKED';
  error.featureKey = featureKey;
  error.requiredPlan = requiredPlan?.id || PLAN_IDS.PLUS;
  error.currentPlan = getPlan(guildId);
  throw error;
}

function isPremium(guildId) {
  if (testDevOverride.shouldBypassPaywall()) return true;
  return subscriptionManager.hasActivePremium(guildId);
}

function isPro(guildId) {
  if (testDevOverride.shouldBypassPaywall()) return true;
  return subscriptionManager.hasActivePro(guildId);
}

function isLifetime(guildId) {
  return getPlan(guildId) === PLAN_IDS.LIFETIME;
}

function getLimit(guildId, limitKey, fallback = null) {
  const limits = getLimits(guildId);
  return Object.prototype.hasOwnProperty.call(limits, limitKey) ? limits[limitKey] : fallback;
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0;
}

function isWithinLimit(guildId, limitKey, currentValue) {
  if (testDevOverride.shouldBypassPaywall()) return true;
  const limit = getLimit(guildId, limitKey, null);
  if (limit == null) return true;
  return normalizeCount(currentValue) < Number(limit);
}

function requireWithinLimit(guildId, limitKey, currentValue) {
  if (isWithinLimit(guildId, limitKey, currentValue)) return true;

  const error = new Error('You have reached the limit for your current Goliath plan.');
  error.code = 'PLAN_LIMIT_REACHED';
  error.limitKey = limitKey;
  error.limit = getLimit(guildId, limitKey, null);
  error.currentValue = normalizeCount(currentValue);
  error.currentPlan = getPlan(guildId);
  throw error;
}

function getEntitlementSummary(guildId) {
  const subscription = getSubscription(guildId);
  const plan = getCurrentPlanDefinition(guildId);
  const devState = testDevOverride.getPaywallBypassState();

  return {
    subscription,
    plan,
    features: getFeatures(guildId),
    limits: getLimits(guildId),
    premium: isPremium(guildId),
    pro: isPro(guildId),
    lifetime: isLifetime(guildId),
    devTestEntitlements: devState.active ? devState : null,
  };
}

module.exports = {
  getPlan,
  getSubscription,
  getFeatures,
  getLimits,
  getLimit,
  canUseFeature,
  requireFeature,
  isPremium,
  isPro,
  isLifetime,
  isWithinLimit,
  requireWithinLimit,
  getEntitlementSummary,
};
