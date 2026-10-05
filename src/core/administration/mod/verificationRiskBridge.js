'use strict';

const decisioning = require('./memberDecisioning');

const SECURITY_STEPS = Object.freeze({
  accountAge: 'account_age',
  screening: 'discord_screening',
  challenge: 'one_time_challenge',
  staffApproval: 'staff_approval',
  rejoinHistory: 'rejoin_history',
  riskBased: 'risk_based',
});

const unique = (values = []) => [...new Set(values.filter(Boolean))];

function elevatedSecuritySteps(decision, settings = {}) {
  const security = settings.security || {};
  const level = ['clear', 'review', 'high'].includes(decision?.decision) ? decision.decision : 'clear';
  const reasons = Array.isArray(decision?.reasons) ? decision.reasons : [];
  const rejoinSignal = reasons.some((reason) => /join|rejoin/i.test(String(reason)));
  const steps = [];

  if (rejoinSignal && security.rejoinHistory === true) steps.push(SECURITY_STEPS.rejoinHistory);
  if (level !== 'clear' && security.riskBased === true) steps.push(SECURITY_STEPS.riskBased);

  if (level === 'review' || level === 'high') {
    if (security.accountAge === true) steps.push(SECURITY_STEPS.accountAge);
    if (security.discordScreening === true) steps.push(SECURITY_STEPS.screening);
    if (security.oneTimeChallenge === true) steps.push(SECURITY_STEPS.challenge);
  }

  if (level === 'high' && security.staffApproval === true) steps.push(SECURITY_STEPS.staffApproval);
  return unique(steps);
}

function resolveRequiredSecurity(guildId, userId, baseSteps = [], settings = {}) {
  const decision = decisioning.getDecision(guildId, userId);
  if (!decision) return { steps: unique(baseSteps), decision: null, elevated: [] };
  const elevated = elevatedSecuritySteps(decision, settings);
  return { steps: unique([...baseSteps, ...elevated]), decision, elevated };
}

module.exports = { SECURITY_STEPS, elevatedSecuritySteps, resolveRequiredSecurity };
