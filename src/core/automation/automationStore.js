'use strict';

const crypto = require('node:crypto');
const { getGuildSection, updateGuildSection } = require('../guild/guildManager');
const registry = require('./automationRegistry');

function now() { return new Date().toISOString(); }
function obj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function key(value = '') { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 100); }
function text(value = '', max = 1000) { return String(value || '').trim().slice(0, max); }
function base() { return { rules: {}, executions: [], updatedAt: now() }; }
function objectEntries(value, limit = 20) {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)).slice(0, limit)
    : [];
}

function normalizeRule(input = {}) {
  const trigger = key(input.trigger || 'form.submitted');
  const id = key(input.ruleId || input.id || input.name || `rule_${crypto.randomUUID()}`);
  const actions = objectEntries(input.actions);
  return {
    id,
    ruleId: id,
    name: text(input.name || registry.getTrigger(trigger)?.label || 'Automation Rule', 120),
    description: text(input.description || '', 500),
    trigger,
    enabled: input.enabled !== false,
    conditions: objectEntries(input.conditions),
    actions: actions.length ? actions : [{ action: 'log.event', config: {} }],
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now(),
  };
}

function section(guildId) {
  return { ...base(), ...obj(getGuildSection(guildId, 'automation', base())) };
}

function listRules(guildId) {
  return Object.values(section(guildId).rules || {}).map(normalizeRule);
}

function getRule(guildId, ruleId) {
  const id = key(ruleId);
  return listRules(guildId).find((rule) => rule.ruleId === id) || null;
}

function validateRule(rule) {
  const errors = [];
  if (!registry.getTrigger(rule.trigger)) errors.push(`Unknown trigger: ${rule.trigger}`);
  for (const action of rule.actions || []) {
    if (!registry.getAction(action.action)) errors.push(`Unknown action: ${action.action}`);
  }
  return { ok: errors.length === 0, errors };
}

function saveRule(guildId, input = {}) {
  const rule = normalizeRule(input);
  const validation = validateRule(rule);
  if (!validation.ok) {
    const error = new Error('Invalid automation rule.');
    error.validation = validation;
    throw error;
  }

  updateGuildSection(guildId, 'automation', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    const previous = next.rules?.[rule.ruleId];
    return {
      ...next,
      rules: {
        ...(next.rules || {}),
        [rule.ruleId]: { ...rule, createdAt: previous?.createdAt || rule.createdAt, updatedAt: now() },
      },
      updatedAt: now(),
    };
  }, base());

  return getRule(guildId, rule.ruleId);
}

function deleteRule(guildId, ruleId) {
  const id = key(ruleId);
  let deleted = false;
  updateGuildSection(guildId, 'automation', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    const rules = { ...(next.rules || {}) };
    if (rules[id]) { delete rules[id]; deleted = true; }
    return { ...next, rules, updatedAt: now() };
  }, base());
  return deleted;
}

function logExecution(guildId, input = {}) {
  const entry = {
    id: `auto_${crypto.randomUUID()}`,
    ruleId: input.ruleId || null,
    trigger: input.trigger || null,
    status: input.status || 'logged',
    message: text(input.message || '', 1000),
    context: obj(input.context),
    createdAt: now(),
  };

  updateGuildSection(guildId, 'automation', (current = base()) => {
    const next = { ...base(), ...obj(current) };
    return { ...next, executions: [entry, ...(next.executions || [])].slice(0, 100), updatedAt: now() };
  }, base());

  return entry;
}

function getExecutions(guildId) {
  return section(guildId).executions || [];
}

module.exports = { listRules, getRule, saveRule, deleteRule, logExecution, getExecutions, validateRule };
