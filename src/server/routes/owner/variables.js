'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { getRuntimeRoot } = require('../../../config/runtimePaths');
const {
  SYSTEM_VARIABLES,
  normalizeCustomVariable,
  normalizeCustomVariables,
} = require('../../../core/guild/guildVariables');

const router = express.Router();

function splitIds(value) {
  return String(value || '').split(',').map((id) => id.trim()).filter(Boolean);
}

function getOwnerIds() {
  return [...new Set([
    ...splitIds(process.env.OWNER_ID),
    ...splitIds(process.env.OWNER_IDS),
    ...splitIds(process.env.BOT_OWNER_ID),
    ...splitIds(process.env.BOT_OWNER_IDS),
  ])];
}

function requireOwner(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Not authenticated.' });
  if (!getOwnerIds().includes(String(req.session.user.id))) return res.status(403).json({ success: false, error: 'Forbidden' });
  return next();
}

function runtimeKey() {
  const mode = String(process.env.BOT_MODE || 'dev').trim().toLowerCase();
  if (mode === 'production' || mode === 'prod') return 'production';
  if (mode === 'beta') return 'beta';
  return 'dev';
}

function variablesPath() {
  return path.join(getRuntimeRoot(runtimeKey()), 'data', 'globalVariables.json');
}

function readCustomVariables() {
  const file = variablesPath();
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeCustomVariables(Array.isArray(parsed) ? parsed : parsed?.variables || []);
  } catch (error) {
    console.warn('[OWNER VARIABLES] Could not read persisted variables:', error.message);
    return [];
  }
}

function writeCustomVariables(variables) {
  const file = variablesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalizeCustomVariables(variables);
  const payload = {
    version: 1,
    environment: runtimeKey().toUpperCase(),
    updatedAt: new Date().toISOString(),
    variables: normalized,
  };
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
  return normalized;
}

function systemPayload() {
  return SYSTEM_VARIABLES.map((token) => ({
    key: token.slice(1, -1),
    token,
    category: 'System',
    protected: true,
    enabled: true,
  }));
}

function responsePayload(custom = readCustomVariables()) {
  return {
    success: true,
    environment: runtimeKey().toUpperCase(),
    system: systemPayload(),
    custom,
    counts: { system: SYSTEM_VARIABLES.length, custom: custom.length },
  };
}

router.get('/', requireOwner, (_req, res) => res.json(responsePayload()));

router.post('/', requireOwner, (req, res) => {
  try {
    const variable = normalizeCustomVariable(req.body || {});
    const custom = readCustomVariables();
    if (custom.some((item) => item.key.toLowerCase() === variable.key.toLowerCase())) {
      return res.status(409).json({ success: false, error: `${variable.token} already exists.` });
    }
    const saved = writeCustomVariables([...custom, variable]);
    return res.status(201).json({ ...responsePayload(saved), variable });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.patch('/:key', requireOwner, (req, res) => {
  try {
    const requestedKey = String(req.params.key || '').trim().toLowerCase();
    const custom = readCustomVariables();
    const index = custom.findIndex((item) => item.key.toLowerCase() === requestedKey);
    if (index === -1) return res.status(404).json({ success: false, error: 'Custom variable not found.' });

    const variable = normalizeCustomVariable({ ...custom[index], ...req.body, key: custom[index].key });
    custom[index] = variable;
    const saved = writeCustomVariables(custom);
    return res.json({ ...responsePayload(saved), variable });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/:key', requireOwner, (req, res) => {
  const requestedKey = String(req.params.key || '').trim().toLowerCase();
  const custom = readCustomVariables();
  const next = custom.filter((item) => item.key.toLowerCase() !== requestedKey);
  if (next.length === custom.length) return res.status(404).json({ success: false, error: 'Custom variable not found.' });
  const saved = writeCustomVariables(next);
  return res.json(responsePayload(saved));
});

module.exports = router;
