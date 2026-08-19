'use strict';

const entitlementManager = require('./entitlementManager');
const { getPlanDefinition, getPlanLimits } = require('../../config/plans');

const LIMIT_LABELS = Object.freeze({
  ticketPanels: 'Ticket Panels',
  forms: 'Forms',
  embedPresets: 'Embed Presets',
  activeTicketsPerUser: 'Active Tickets Per User',
  translationsPerMonth: 'Translations Per Month',
});

function cleanLimitKey(limitKey) {
  const key = String(limitKey || '').trim();
  if (!key) throw new Error('Limit key is required.');
  return key;
}

function getActivePlan(guildId) {
  return entitlementManager.getPlan(guildId);
}

function getPlanLimit(guildId, limitKey) {
  const key = cleanLimitKey(limitKey);
  const plan = getActivePlan(guildId);
  const limits = getPlanLimits(plan);
  return Object.prototype.hasOwnProperty.call(limits, key) ? limits[key] : null;
}

function getPlanLimitSummary(guildId, limitKey) {
  const key = cleanLimitKey(limitKey);
  const plan = getActivePlan(guildId);
  const planDefinition = getPlanDefinition(plan);
  const limit = getPlanLimit(guildId, key);

  return {
    limitKey: key,
    label: LIMIT_LABELS[key] || key,
    plan: planDefinition,
    limit,
    unlimited: limit == null,
  };
}

function hasUnlimitedLimit(guildId, limitKey) {
  return getPlanLimit(guildId, limitKey) == null;
}

function canCreateResource(guildId, limitKey, currentCount = 0) {
  const summary = getPlanLimitSummary(guildId, limitKey);
  const requestedCount = Number(currentCount);
  const count = Number.isFinite(requestedCount)
    ? Math.max(Math.trunc(requestedCount), 0)
    : 0;
  const allowed = summary.unlimited || count < Number(summary.limit || 0);

  return {
    ...summary,
    currentCount: count,
    allowed,
    remaining: summary.unlimited ? null : Math.max(Number(summary.limit || 0) - count, 0),
  };
}

function createLimitError(check, options = {}) {
  const planName = check.plan?.name || 'Free';
  const label = check.label || check.limitKey || 'Resource';
  const upgradeHint = options.upgradeHint || 'Upgrade to Plus or Pro to increase this limit.';
  const error = new Error(`🔒 ${label} limit reached for Goliath ${planName}. ${label}: ${check.currentCount} / ${check.limit}. ${upgradeHint}`);

  error.code = 'PLAN_LIMIT_REACHED';
  error.status = 403;
  error.limitKey = check.limitKey;
  error.label = label;
  error.currentPlan = check.plan?.id || 'free';
  error.currentPlanName = planName;
  error.currentCount = check.currentCount;
  error.limit = check.limit;
  error.remaining = check.remaining;
  error.upgradeHint = upgradeHint;

  return error;
}

function assertCanCreateResource(guildId, limitKey, currentCount = 0, options = {}) {
  const check = canCreateResource(guildId, limitKey, currentCount);
  if (!check.allowed) throw createLimitError(check, options);
  return check;
}

module.exports = {
  LIMIT_LABELS,
  canCreateResource,
  assertCanCreateResource,
  createLimitError,
};
