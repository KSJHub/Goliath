'use strict';

// Moderation panel layout contract: feature rows first; the final row is navigation,
// with Back first and Export immediately after it when export is available.
const express = require('express');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const security = require('../../security/protection/core');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const { errorEmbed } = require('../../ui/embeds');
const { safeEditReply } = require('../../ui/interactionResponse');
require('./caseManagementUx');
const { openModPanel } = require('./panel');
const { recordModerationSystemEvent, getModerationDoctorStatus } = require('./permissions');
const { db, getCaseById, getCasesForUser, getAllCases } = require('./storage');
const { getAppealEligibility, getCaseAppeals, submitAppeal } = require('./cases');

const router = express.Router();
const APPEALABLE_WEB_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban', 'case']);
const WEB_APPEAL_WINDOW_MS = 10 * 60 * 1000;
const WEB_APPEAL_MAX_SUBMITS = 5;
const WEB_APPEAL_SUBMITS = new Map();

function requireAppealSession(req, res, next) {
  const userId = String(req.session?.user?.id || '').trim();
  if (!/^\d{16,20}$/.test(userId)) return res.status(401).json({ error: 'Authentication required.' });
  req.appealUserId = userId;
  return next();
}

function requireSameOrigin(req, res, next) {
  const origin = String(req.get('origin') || '').trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return res.status(403).json({ error: 'Invalid appeal request origin.' });
  try {
    const parsed = new URL(origin);
    if (parsed.host.toLowerCase() !== host) return res.status(403).json({ error: 'Invalid appeal request origin.' });
  } catch {
    return res.status(403).json({ error: 'Invalid appeal request origin.' });
  }
  return next();
}

function enforceAppealRateLimit(req, res, next) {
  const userId = req.appealUserId;
  const now = Date.now();
  const recent = (WEB_APPEAL_SUBMITS.get(userId) || []).filter((timestamp) => now - timestamp < WEB_APPEAL_WINDOW_MS);
  if (recent.length >= WEB_APPEAL_MAX_SUBMITS) {
    const retryAfterMs = Math.max(1000, WEB_APPEAL_WINDOW_MS - (now - recent[0]));
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Too many appeal submissions. Please wait before trying again.' });
  }
  recent.push(now);
  WEB_APPEAL_SUBMITS.set(userId, recent);
  if (WEB_APPEAL_SUBMITS.size > 1000) {
    for (const [key, timestamps] of WEB_APPEAL_SUBMITS) {
      if (!timestamps.some((timestamp) => now - timestamp < WEB_APPEAL_WINDOW_MS)) WEB_APPEAL_SUBMITS.delete(key);
    }
  }
  return next();
}

function getGuildName(req, guildId) {
  const guild = req.client?.guilds?.cache?.get?.(String(guildId));
  return guild?.name || `Server ${guildId}`;
}

function safeAppeal(appeal = {}) {
  return {
    id: String(appeal.id || ''),
    status: String(appeal.status || 'pending'),
    grounds: String(appeal.grounds || ''),
    requestedResolution: appeal.requestedResolution ? String(appeal.requestedResolution) : null,
    submittedAt: appeal.submittedAt || null,
    reviewedAt: appeal.reviewedAt || null,
    reviewNote: appeal.reviewNote ? String(appeal.reviewNote) : null,
    remedyDetail: appeal.remedy?.detail ? String(appeal.remedy.detail) : null,
  };
}

function safeAppealCase(req, modCase, userId) {
  const action = String(modCase.action || '').toLowerCase();
  if (!APPEALABLE_WEB_ACTIONS.has(action)) return null;

  const proceeding = modCase.metadata?.proceeding && typeof modCase.metadata.proceeding === 'object'
    ? modCase.metadata.proceeding
    : null;
  if (action === 'case' && (!proceeding?.publication || !proceeding?.decision || proceeding.stage !== 'published')) return null;

  const appeals = getCaseAppeals(modCase).map(safeAppeal);
  const eligibility = getAppealEligibility(modCase, userId);
  if (!eligibility.ok && !appeals.length) return null;

  const effectiveAction = action === 'case'
    ? String(proceeding?.sanctionExecution?.action || proceeding?.decision?.action || 'case').toLowerCase()
    : action;
  const publicSummary = action === 'case'
    ? String(proceeding?.publication?.summary || proceeding?.decision?.summary || 'An official Case Proceedings decision was published.').slice(0, 1500)
    : String(modCase.reason || 'No reason provided.').slice(0, 1500);
  const decisionAt = action === 'case'
    ? (proceeding?.publication?.publishedAt || proceeding?.decision?.decidedAt || proceeding?.decision?.createdAt || modCase.updatedAt || modCase.createdAt || null)
    : (modCase.createdAt || null);

  return {
    guildId: String(modCase.guildId),
    guildName: getGuildName(req, modCase.guildId),
    caseId: Number(modCase.caseId),
    action: effectiveAction,
    actionLabel: effectiveAction.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    status: String(modCase.status || 'active'),
    createdAt: modCase.createdAt || null,
    decisionAt,
    publicSummary,
    eligible: Boolean(eligibility.ok),
    eligibilityMessage: eligibility.ok ? null : String(eligibility.error || 'This case is not currently appealable.'),
    eligibleAt: eligibility.eligibleAt || null,
    appeals,
  };
}

async function requireModerationGuildAccess(req, res, next) {
  try {
    const userId = String(req.session?.user?.id || '').trim();
    if (!/^\d{16,20}$/.test(userId)) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const guildId = String(req.params.guildId || '').trim();
    if (!/^\d{16,20}$/.test(guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID.' });
    }

    if (security.isBotOwner(userId)) return next();

    const client = req.client;
    const guild = client?.guilds?.cache?.get(guildId)
      || await client?.guilds?.fetch(guildId).catch(() => null);

    if (!guild) return res.status(403).json({ error: 'Guild unavailable.' });

    const member = guild.members.cache.get(userId)
      || await guild.members.fetch(userId).catch(() => null);

    const permitted = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator)
      || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );

    if (!permitted) return res.status(403).json({ error: 'Manage Server permission required.' });

    return next();
  } catch (error) {
    console.error('[Moderation dashboard access]', error);
    return res.status(403).json({ error: 'Unable to verify guild access.' });
  }
}

router.get('/:guildId', requireModerationGuildAccess, (req, res) => {
  try {
    const cases = getAllCases(req.params.guildId).map((item) => ({
      ...item,
      caseNumber: item.caseId,
      targetId: item.userId,
      cleared: item.status === 'cleared',
      clearedAt: item.status === 'cleared' ? item.updatedAt : null,
    }));
    return res.json({ cases });
  } catch (error) {
    console.error('[Moderation dashboard cases]', error);
    return res.status(500).json({ error: 'Unable to load cases.' });
  }
});

router.get('/:guildId/warnings', requireModerationGuildAccess, (req, res) => {
  try {
    const guildId = req.params.guildId;
    const warnings = db.prepare(
      'SELECT * FROM warnings WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC'
    ).all(guildId, new Date().toISOString()).map((row) => ({
      id: row.id,
      warningId: row.id,
      guildId: row.guild_id,
      caseId: row.case_id,
      caseNumber: row.case_id,
      userId: row.user_id,
      moderatorId: row.moderator_id,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      cleared: false,
      clearedAt: null,
    }));
    return res.json({ warnings });
  } catch (error) {
    console.error('[Moderation dashboard warnings]', error);
    return res.status(500).json({ error: 'Unable to load warnings.' });
  }
});

router.get('/appeals/me', requireAppealSession, (req, res) => {
  try {
    const userId = req.appealUserId;
    const guildRows = db.prepare('SELECT DISTINCT guild_id FROM cases WHERE user_id = ? ORDER BY guild_id').all(userId);
    const records = [];
    for (const row of guildRows) {
      for (const modCase of getCasesForUser(String(row.guild_id), userId) || []) {
        const safe = safeAppealCase(req, modCase, userId);
        if (safe) records.push(safe);
      }
    }
    records.sort((a, b) => (new Date(b.decisionAt || b.createdAt || 0).getTime() || 0) - (new Date(a.decisionAt || a.createdAt || 0).getTime() || 0));
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, cases: records });
  } catch (error) {
    console.error('[Appeals API] Failed to load member cases:', error);
    return res.status(500).json({ error: 'Could not load your appeal records.' });
  }
});

router.post('/appeals/:guildId/:caseId', requireAppealSession, requireSameOrigin, enforceAppealRateLimit, (req, res) => {
  try {
    const guildId = String(req.params.guildId || '').trim();
    const caseId = Number(req.params.caseId);
    const userId = req.appealUserId;
    if (!/^\d{16,20}$/.test(guildId) || !Number.isInteger(caseId) || caseId <= 0) return res.status(400).json({ error: 'Invalid appeal reference.' });

    const modCase = getCaseById(guildId, caseId);
    if (!modCase || String(modCase.userId) !== userId) return res.status(404).json({ error: 'This case is not available for appeal.' });

    const eligibility = getAppealEligibility(modCase, userId);
    if (!eligibility.ok) return res.status(409).json({ error: eligibility.error || 'This case is not currently appealable.', eligibleAt: eligibility.eligibleAt || null });

    const rawGrounds = String(req.body?.grounds || '');
    const rawResolution = String(req.body?.requestedResolution || '');
    if (rawGrounds.length > 1500) return res.status(400).json({ error: 'Appeal grounds cannot exceed 1500 characters.' });
    if (rawResolution.length > 500) return res.status(400).json({ error: 'Requested resolution cannot exceed 500 characters.' });
    const grounds = rawGrounds.trim();
    const requestedResolution = rawResolution.trim();
    if (!grounds) return res.status(400).json({ error: 'Appeal grounds are required.' });

    const result = submitAppeal(guildId, caseId, {
      appellantId: userId,
      grounds,
      requestedResolution,
      source: 'web',
    }, userId);
    if (!result.ok) return res.status(409).json({ error: result.error || 'Could not submit your appeal.' });

    res.set('Cache-Control', 'no-store');
    return res.status(201).json({
      ok: true,
      appeal: safeAppeal(result.appeal),
      caseId,
      guildId,
    });
  } catch (error) {
    console.error('[Appeals API] Failed to submit appeal:', error);
    return res.status(500).json({ error: 'Could not submit your appeal.' });
  }
});

const command = {
  category: 'Moderation',
  help: { name: 'mod', description: '🔐 Open Goliath’s moderation hub and management tools.', usage: '/mod' },
  access: { level: 'mod', ownerOnly: false },
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('🔑 Open Goliath’s moderation hub and management tools'),
  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, command);
    if (denied) {
      recordModerationSystemEvent({ interaction, event: 'moderation.command.denied', action: 'view_dashboard', reason: 'Command access policy denied the moderation hub.' });
      return;
    }
    try {
      if (!interaction.guild) {
        recordModerationSystemEvent({ interaction, guildId: 'dm', event: 'moderation.command.invalid_context', action: 'view_dashboard', reason: 'Moderation panel requested outside a guild.' });
        return safeEditReply(interaction, { embeds: [errorEmbed('The moderation hub can only be used inside a server. Member appeals are available from `/user` → Account → Appeals or the secure Goliath Appeals website.')] });
      }
      const doctor = getModerationDoctorStatus();
      if (!doctor.ok) recordModerationSystemEvent({ interaction, event: 'moderation.doctor.warning', action: 'view_dashboard', after: doctor });
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
      return openModPanel(interaction);
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('❌ Mod command failed:', error);
      recordModerationSystemEvent({ interaction, event: 'moderation.command.failed', action: 'view_dashboard', reason: error?.message || error, metadata: { stack: String(error?.stack || '').slice(0, 1500) } });
      return safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to open the moderation hub. Please try again.')],
        components: [],
      });
    }
  },
};

command.router = router;
module.exports = command;
