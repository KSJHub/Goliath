'use strict';

const express = require('express');
const guildManager = require('../../../core/guild/guildManager');

const router = express.Router();

function normalizeGuildId(guildId) {
  const id = String(guildId || '').trim();

  if (!/^\d{16,20}$/.test(id)) {
    return null;
  }

  return id;
}

function getGuildModeration(guildId) {
  const safeGuildId = normalizeGuildId(guildId);
  if (!safeGuildId) return { enabled: true, cases: {}, analytics: {} };

  return guildManager.getGuildSection(safeGuildId, 'moderation', {
    enabled: true,
    cases: {},
    analytics: {},
  });
}

function getGuildCases(guildId) {
  const moderation = getGuildModeration(guildId);
  return moderation.cases && typeof moderation.cases === 'object' && !Array.isArray(moderation.cases)
    ? moderation.cases
    : {};
}

function getGuildCaseEntries(guildCases, guildId) {
  if (!guildCases || typeof guildCases !== 'object' || Array.isArray(guildCases)) {
    return [];
  }

  return Object.values(guildCases)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      ...entry,
      guildId: entry.guildId || guildId,
    }))
    .sort((a, b) => Number(b.caseNumber || 0) - Number(a.caseNumber || 0));
}

function getGuildWarnings(guildCases, guildId) {
  return getGuildCaseEntries(guildCases, guildId).filter(
    (entry) => String(entry.action || '').toLowerCase() === 'warn'
  );
}

/* ================= RAW CASES ================= */

router.get('/:guildId', (req, res) => {
  try {
    const guildId = normalizeGuildId(req.params.guildId);

    if (!guildId) {
      return res.status(400).json({ error: 'Missing or invalid guild ID.' });
    }

    return res.json(getGuildCases(guildId));
  } catch (error) {
    console.error('Failed to load cases:', error);

    return res.status(500).json({
      error: 'Failed to load cases',
      message: error.message,
    });
  }
});

/* ================= SORTED CASE LIST ================= */

router.get('/:guildId/list', (req, res) => {
  try {
    const guildId = normalizeGuildId(req.params.guildId);

    if (!guildId) {
      return res.status(400).json({ error: 'Missing or invalid guild ID.' });
    }

    const guildCases = getGuildCases(guildId);
    const list = getGuildCaseEntries(guildCases, guildId);

    return res.json(list);
  } catch (error) {
    console.error('Failed to load case list:', error);

    return res.status(500).json({
      error: 'Failed to load case list',
      message: error.message,
    });
  }
});

/* ================= WARNINGS ================= */

router.get('/:guildId/warnings', (req, res) => {
  try {
    const guildId = normalizeGuildId(req.params.guildId);

    if (!guildId) {
      return res.status(400).json({ error: 'Missing or invalid guild ID.' });
    }

    const guildCases = getGuildCases(guildId);
    const warnings = getGuildWarnings(guildCases, guildId);

    return res.json(warnings);
  } catch (error) {
    console.error('Failed to load warnings:', error);

    return res.status(500).json({
      error: 'Failed to load warnings',
      message: error.message,
    });
  }
});

module.exports = router;
