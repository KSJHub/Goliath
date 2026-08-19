'use strict';

const registry = require('./automationRegistry');
const store = require('./automationStore');

function now() { return new Date().toISOString(); }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function arr(value) { return Array.isArray(value) ? value : []; }

function getPath(source = {}, path = '') {
  return String(path || '').split('.').filter(Boolean).reduce((current, part) => current?.[part], source);
}

function compare(left, operator, right) {
  if (operator === 'equals') return String(left ?? '') === String(right ?? '');
  if (operator === 'not_equals') return String(left ?? '') !== String(right ?? '');
  if (operator === 'exists') return left !== undefined && left !== null && left !== '';
  if (operator === 'missing') return left === undefined || left === null || left === '';
  if (operator === 'contains') return String(left ?? '').includes(String(right ?? ''));
  return false;
}

function evaluateCondition(condition = {}, context = {}) {
  const field = condition.field || condition.path || '';
  const operator = condition.operator || 'equals';
  const actual = getPath(context, field);
  const expected = condition.value;
  const passed = compare(actual, operator, expected);
  return { field, operator, expected, actual, passed };
}

function simulateRule(rule = {}, context = {}) {
  const trigger = registry.getTrigger(rule.trigger);
  const conditions = arr(rule.conditions).map((condition) => evaluateCondition(condition, context));
  const conditionsPassed = conditions.every((condition) => condition.passed);
  const actions = arr(rule.actions).map((action, index) => {
    const definition = registry.getAction(action.action);
    return {
      index,
      action: action.action,
      label: definition?.label || action.action,
      safe: Boolean(definition?.safe),
      disabled: Boolean(definition?.disabled),
      wouldRun: conditionsPassed && rule.enabled !== false && Boolean(definition) && definition.disabled !== true,
      config: obj(action.config),
    };
  });

  return {
    simulatedAt: now(),
    ruleId: rule.ruleId || rule.id || null,
    name: rule.name || 'Automation Rule',
    trigger: rule.trigger,
    enabled: rule.enabled !== false,
    triggerKnown: Boolean(trigger),
    conditionsPassed,
    conditions,
    actions,
    status: rule.enabled === false ? 'disabled' : conditionsPassed ? 'would_run' : 'conditions_failed',
  };
}

function simulateStoredRule(guildId, ruleId, context = {}) {
  const rule = store.getRule(guildId, ruleId);
  if (!rule) {
    const error = new Error('Automation rule not found.');
    error.status = 404;
    throw error;
  }

  const simulation = simulateRule(rule, context);
  store.logExecution(guildId, {
    ruleId: rule.ruleId,
    trigger: rule.trigger,
    status: `simulation_${simulation.status}`,
    message: `Simulated automation rule: ${rule.name}`,
    context: simulation,
  });
  return simulation;
}

module.exports = { simulateRule, simulateStoredRule, evaluateCondition };
