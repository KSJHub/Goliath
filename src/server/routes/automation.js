'use strict';

const express = require('express');
const registry = require('../../core/automation/automationRegistry');
const store = require('../../core/automation/automationStore');
const simulator = require('../../core/automation/automationSimulator');
const notifications = require('../../core/notifications/notificationStore');

const router = express.Router();

function ok(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function fail(res, error, status = 400) {
  return res.status(error.status || status).json({
    success: false,
    error: error.message || 'Automation request failed.',
    validation: error.validation || null,
  });
}

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

function notify(guildId, payload = {}) {
  try {
    return notifications.addNotification(guildId, {
      source: 'automation',
      route: '/automation',
      ...payload,
    });
  } catch (error) {
    console.warn('[AutomationRoute] Notification skipped:', error.message || error);
    return null;
  }
}

router.get('/registry', (req, res) => ok(res, {
  triggers: registry.listTriggers(),
  actions: registry.listActions(),
}));

router.get('/:guildId', (req, res) => {
  try {
    const id = guildId(req);
    const rules = store.listRules(id);
    const executions = store.getExecutions(id);
    return ok(res, {
      guildId: id,
      rules,
      executions,
      summary: {
        ruleCount: rules.length,
        enabledCount: rules.filter((rule) => rule.enabled !== false).length,
        executionCount: executions.length,
      },
    });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/:guildId/rules', (req, res) => {
  try {
    const id = guildId(req);
    const rule = store.saveRule(id, req.body || {});
    notify(id, {
      level: 'success',
      title: 'Automation rule saved',
      message: `${rule.name || 'Automation rule'} is ready for ${rule.trigger || 'its trigger'}.`,
      metadata: { ruleId: rule.ruleId, trigger: rule.trigger },
    });
    return ok(res, { guildId: id, rule, rules: store.listRules(id) });
  } catch (error) {
    return fail(res, error);
  }
});

router.delete('/:guildId/rules/:ruleId', (req, res) => {
  try {
    const id = guildId(req);
    const deleted = store.deleteRule(id, req.params.ruleId);
    if (deleted) {
      notify(id, {
        level: 'warning',
        title: 'Automation rule deleted',
        message: 'An automation rule was deleted from this server.',
        metadata: { ruleId: req.params.ruleId },
      });
    }
    return ok(res, { guildId: id, deleted, rules: store.listRules(id) });
  } catch (error) {
    return fail(res, error);
  }
});

router.get('/:guildId/executions', (req, res) => {
  try {
    const id = guildId(req);
    return ok(res, { guildId: id, executions: store.getExecutions(id) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/:guildId/rules/:ruleId/simulate', (req, res) => {
  try {
    const id = guildId(req);
    const simulation = simulator.simulateStoredRule(id, req.params.ruleId, req.body?.context || {});
    notify(id, {
      level: simulation.status === 'would_run' ? 'success' : 'warning',
      title: 'Automation simulation complete',
      message: `${simulation.name || 'Automation rule'} finished simulation with status: ${simulation.status}.`,
      metadata: { ruleId: simulation.ruleId, trigger: simulation.trigger, status: simulation.status },
    });
    return ok(res, { guildId: id, simulation, executions: store.getExecutions(id) });
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/:guildId/test-log', (req, res) => {
  try {
    const id = guildId(req);
    const entry = store.logExecution(id, {
      ruleId: req.body?.ruleId || null,
      trigger: req.body?.trigger || 'manual.test',
      status: 'test_logged',
      message: req.body?.message || 'Manual automation test log.',
      context: req.body?.context || {},
    });
    notify(id, {
      level: 'info',
      title: 'Automation test log written',
      message: entry.message || 'Manual automation test log.',
      metadata: { executionId: entry.id, ruleId: entry.ruleId, trigger: entry.trigger },
    });
    return ok(res, { guildId: id, entry, executions: store.getExecutions(id) });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
