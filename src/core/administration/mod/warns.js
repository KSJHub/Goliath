'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const {
  db,
  addWarning,
  getWarningsForUser: getStoredWarningsForUser,
  getWarningCountForUser: getStoredWarningCountForUser,
  getWarningByCaseId: getStoredWarningByCaseId,
  deleteWarningByCaseId,
  createCase,
  getCaseById,
  updateCaseStatus,
  recordCaseAudit,
  emitCaseCreated,
  emitCaseStatusUpdated,
  sendModLog,
} = require('./storage');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const { ensureActionAccess, requireModeratableTarget, recordModerationSystemEvent } = require('./permissions');

const NO_EXPIRY_VALUES = new Set(['', 'never', 'none']);
const MIN_STRIKE_WEIGHT = 1;
const MAX_STRIKE_WEIGHT = 5;
const DEFAULT_STRIKE_WEIGHT = 1;
const ESCALATION_CONFIG = Object.freeze({
  2: { action: 'timeout', duration: '10m', label: '10 minute timeout' },
  3: { action: 'timeout', duration: '1h', label: '1 hour timeout' },
  4: { action: 'kick', label: 'kick' },
  5: { action: 'ban', deleteDays: 0, label: 'ban' },
});
const ESCALATION_THRESHOLDS = Object.freeze(Object.keys(ESCALATION_CONFIG).map(Number).sort((a, b) => a - b));
const ESCALATION_DURATION_UNITS = Object.freeze({ m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 });

function parseWarningExpiry(value) {
  const raw = String(value || 'never').trim().toLowerCase();
  if (NO_EXPIRY_VALUES.has(raw)) return null;
  const match = raw.match(/^(\d+)\s*([dwm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const current = new Date();
  if (match[2] === 'm') {
    const expiry = new Date(current);
    expiry.setUTCMonth(expiry.getUTCMonth() + amount);
    return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const multiplier = match[2] === 'w' ? 7 * dayMs : dayMs;
  const expiry = new Date(current.getTime() + amount * multiplier);
  return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
}

function parseStrikeWeight(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_STRIKE_WEIGHT;
  if (!/^\d+$/.test(raw)) return null;
  const weight = Number(raw);
  return Number.isInteger(weight) && weight >= MIN_STRIKE_WEIGHT && weight <= MAX_STRIKE_WEIGHT ? weight : null;
}

function getCaseStrikeWeight(guildId, warning) {
  const modCase = warning?.caseId ? getCaseById(guildId, warning.caseId) : null;
  const raw = Number(modCase?.metadata?.strikeWeight ?? DEFAULT_STRIKE_WEIGHT);
  return Number.isFinite(raw) ? Math.min(MAX_STRIKE_WEIGHT, Math.max(MIN_STRIKE_WEIGHT, Math.trunc(raw))) : DEFAULT_STRIKE_WEIGHT;
}

function mapExpiredWarning(row) {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    caseId: row.case_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function syncExpiredWarningsToCases(guildId) {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId) return [];
  const nowIso = new Date().toISOString();
  const expiredWarnings = db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY id ASC').all(normalizedGuildId, nowIso).map(mapExpiredWarning);
  if (!expiredWarnings.length) return [];
  const changedCaseIds = [];
  db.transaction(() => {
    for (const warning of expiredWarnings) {
      if (warning.caseId) {
        const currentCase = getCaseById(normalizedGuildId, warning.caseId);
        if (currentCase && currentCase.status === 'active') {
          const result = db.prepare('UPDATE cases SET status = ?, updated_at = ? WHERE guild_id = ? AND case_id = ? AND status = ?').run('expired', nowIso, normalizedGuildId, Number(warning.caseId), 'active');
          if (result.changes) {
            changedCaseIds.push(Number(warning.caseId));
            recordCaseAudit({ guildId: normalizedGuildId, caseId: warning.caseId, actorId: null, event: 'case.status.updated', before: 'active', after: 'expired', metadata: { automatic: true, warningExpiry: true } });
            recordCaseAudit({ guildId: normalizedGuildId, caseId: warning.caseId, actorId: null, event: 'case.strike.expired', before: getCaseStrikeWeight(normalizedGuildId, warning), after: 0, metadata: { automatic: true, expiresAt: warning.expiresAt } });
          }
        }
      }
    }
    db.prepare('DELETE FROM warnings WHERE guild_id = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(normalizedGuildId, nowIso);
  })();
  for (const caseId of changedCaseIds) {
    const updated = getCaseById(normalizedGuildId, caseId);
    if (updated) emitCaseStatusUpdated(normalizedGuildId, updated);
  }
  return expiredWarnings;
}

function getWarningsForUser(guildId, userId) {
  syncExpiredWarningsToCases(guildId);
  return getStoredWarningsForUser(guildId, userId);
}
function getWarningCountForUser(guildId, userId) {
  syncExpiredWarningsToCases(guildId);
  return getStoredWarningCountForUser(guildId, userId);
}
function getWarningByCaseId(guildId, caseId) {
  syncExpiredWarningsToCases(guildId);
  return getStoredWarningByCaseId(guildId, caseId);
}

function getActiveStrikeProfile(guildId, userId) {
  const warnings = getWarningsForUser(guildId, userId) || [];
  const entries = warnings.map((warning) => ({ ...warning, strikeWeight: getCaseStrikeWeight(guildId, warning) }));
  return {
    warningCount: entries.length,
    strikeScore: entries.reduce((sum, warning) => sum + warning.strikeWeight, 0),
    entries,
  };
}

function getEscalationConfig() { return { ...ESCALATION_CONFIG }; }
function parseEscalationDuration(input) {
  const match = String(input || '').trim().toLowerCase().match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  return Number(match[1]) * ESCALATION_DURATION_UNITS[match[2]];
}
function normalizeReason(reason) { return String(reason || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function getRepeatReasonInfo(guildIdOrOptions, userId, reason) {
  const options = typeof guildIdOrOptions === 'object' ? guildIdOrOptions : { guildId: guildIdOrOptions, userId, reason };
  const warnings = getWarningsForUser(options.guildId, options.userId) || [];
  const normalizedReason = normalizeReason(options.reason);
  const matches = normalizedReason ? warnings.filter((entry) => normalizeReason(entry.reason) === normalizedReason) : [];
  return {
    repeatCount: matches.length,
    isRepeatPattern: matches.length >= 2,
    newlyTriggered: matches.length === 2,
    matchingCaseIds: matches.map((entry) => entry.caseId).filter(Boolean),
  };
}

function getCrossedEscalation(previousScore, currentScore) {
  const crossed = ESCALATION_THRESHOLDS.filter((threshold) => threshold > previousScore && threshold <= currentScore);
  if (!crossed.length) return null;
  const threshold = crossed[crossed.length - 1];
  return { threshold, ...ESCALATION_CONFIG[threshold] };
}

function getNextEscalationPreview(guildId, userId) {
  const profile = getActiveStrikeProfile(guildId, userId);
  const nextThreshold = ESCALATION_THRESHOLDS.find((threshold) => threshold > profile.strikeScore);
  if (!nextThreshold) return `Maximum configured escalation reached (${profile.strikeScore} active strike points)`;
  const next = ESCALATION_CONFIG[nextThreshold];
  return `${next.label} at ${nextThreshold} active strike points • current ${profile.strikeScore}`;
}

function buildEscalationReason(escalation, strikeScore, reason) {
  const baseReason = escalation.repeatTriggered
    ? 'Auto escalation (repeat behavior detected)'
    : `Auto escalation (${strikeScore} active strike points; threshold ${escalation.threshold})`;
  return `${baseReason}${reason ? ` | ${reason}` : ''}`.slice(0, 512);
}

async function createEscalationCase({ guild, member, moderator, action, reason, metadata = {} }) {
  return createCase({
    guildId: guild.id,
    userId: member.id,
    moderatorId: moderator.id,
    action,
    reason,
    metadata: { auto: true, escalation: true, ...metadata },
    actorId: moderator.id,
  });
}
async function logEscalation({ guild, member, moderator, actionLabel, reason, caseId, metadata = {} }) {
  return sendModLog({ guild, target: member, moderator, action: actionLabel, reason, caseId, metadata });
}

function escalationMetadata(escalation) {
  return {
    strikeScore: escalation.strikeScore,
    previousStrikeScore: escalation.previousStrikeScore,
    threshold: escalation.threshold || null,
    repeatTriggered: Boolean(escalation.repeatTriggered),
    sourceWarningCaseId: escalation.sourceWarningCaseId || null,
  };
}

async function applyTimeout({ guild, member, moderator, escalation, finalReason }) {
  const durationMs = parseEscalationDuration(escalation.duration);
  if (!durationMs) return null;
  await member.timeout(durationMs, finalReason);
  const metadata = { duration: escalation.duration, ...escalationMetadata(escalation) };
  const modCase = await createEscalationCase({ guild, member, moderator, action: 'timeout', reason: finalReason, metadata });
  await logEscalation({ guild, member, moderator, actionLabel: 'Auto Timeout', reason: finalReason, caseId: modCase.caseId, metadata });
  return modCase;
}
async function applyKick({ guild, member, moderator, escalation, finalReason }) {
  await member.kick(finalReason);
  const metadata = escalationMetadata(escalation);
  const modCase = await createEscalationCase({ guild, member, moderator, action: 'kick', reason: finalReason, metadata });
  await logEscalation({ guild, member, moderator, actionLabel: 'Auto Kick', reason: finalReason, caseId: modCase.caseId, metadata });
  return modCase;
}
async function applyBan({ guild, member, moderator, escalation, finalReason }) {
  const rawDeleteDays = Number(escalation.deleteDays);
  const deleteDays = Number.isFinite(rawDeleteDays) ? Math.min(7, Math.max(0, Math.trunc(rawDeleteDays))) : 0;
  await member.ban({ deleteMessageSeconds: deleteDays * 24 * 60 * 60, reason: finalReason });
  const metadata = { deleteDays, ...escalationMetadata(escalation) };
  const modCase = await createEscalationCase({ guild, member, moderator, action: 'ban', reason: finalReason, metadata });
  await logEscalation({ guild, member, moderator, actionLabel: 'Auto Ban', reason: finalReason, caseId: modCase.caseId, metadata });
  return modCase;
}

async function handleEscalation({ guild, member, moderator, reason, previousStrikeScore = null, sourceWarningCaseId = null }) {
  if (!guild || !member || !moderator) return null;
  const profile = getActiveStrikeProfile(guild.id, member.id);
  const currentScore = profile.strikeScore;
  const previousScore = Number.isFinite(Number(previousStrikeScore)) ? Math.max(0, Number(previousStrikeScore)) : Math.max(0, currentScore - DEFAULT_STRIKE_WEIGHT);
  const repeatInfo = getRepeatReasonInfo(guild.id, member.id, reason);
  let escalation = getCrossedEscalation(previousScore, currentScore);
  if (!escalation && repeatInfo.newlyTriggered) escalation = { action: 'timeout', duration: '10m', repeatTriggered: true, threshold: null };
  if (!escalation) return null;
  escalation = { ...escalation, strikeScore: currentScore, previousStrikeScore: previousScore, sourceWarningCaseId };
  const finalReason = buildEscalationReason(escalation, currentScore, reason);
  try {
    if (escalation.action === 'timeout') return applyTimeout({ guild, member, moderator, escalation, finalReason });
    if (escalation.action === 'kick') return applyKick({ guild, member, moderator, escalation, finalReason });
    if (escalation.action === 'ban') return applyBan({ guild, member, moderator, escalation, finalReason });
    return null;
  } catch (error) {
    console.error('❌ Escalation error:', error);
    recordModerationSystemEvent({ guildId: guild.id, actorId: moderator.id, event: 'moderation.escalation.failed', action: escalation.action, targetId: member.id, reason: error?.message || error, metadata: { sourceWarningCaseId, strikeScore: currentScore, threshold: escalation.threshold || null, stack: String(error?.stack || '').slice(0, 1500) } });
    return null;
  }
}

function createWarningCaseAtomic({ guildId, userId, moderatorId, reason = 'No reason provided', expiresAt = null, strikeWeight = DEFAULT_STRIKE_WEIGHT, metadata = {}, actorId = null }) {
  const normalizedGuildId = String(guildId);
  const normalizedUserId = String(userId);
  const normalizedModeratorId = String(moderatorId);
  const createdAt = new Date().toISOString();
  const caseMetadata = { expiresAt: expiresAt || null, strikeWeight, strikeSystem: 'weighted-v1', ...(metadata || {}) };
  const result = db.transaction(() => {
    const insert = db.prepare('INSERT INTO cases (guild_id, user_id, moderator_id, action, reason, metadata, status, related_case_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)').run(normalizedGuildId, normalizedUserId, normalizedModeratorId, 'warn', reason, JSON.stringify(caseMetadata), 'active', createdAt);
    const caseId = Number(insert.lastInsertRowid);
    const warning = addWarning({ guildId: normalizedGuildId, userId: normalizedUserId, moderatorId: normalizedModeratorId, reason, caseId, expiresAt });
    return { caseId, warning };
  })();
  const modCase = getCaseById(normalizedGuildId, result.caseId);
  if (!modCase) throw new Error('Failed to load warning case after atomic creation.');
  recordCaseAudit({ guildId: normalizedGuildId, caseId: modCase.caseId, actorId: actorId || normalizedModeratorId, event: 'case.created', before: null, after: modCase, metadata: { action: 'warn', atomic: true } });
  emitCaseCreated(normalizedGuildId, modCase);
  return { modCase, warning: result.warning };
}

function createWarning({ guildId, userId, moderatorId, reason = 'No reason provided', caseId, expiresAt = null }) {
  return addWarning({ guildId, userId, moderatorId, reason, caseId, expiresAt });
}
function removeWarningByCaseId(guildId, caseId, actorId = null) {
  syncExpiredWarningsToCases(guildId);
  const warning = getStoredWarningByCaseId(guildId, caseId);
  if (!warning) return null;
  const strikeWeight = getCaseStrikeWeight(guildId, warning);
  const removed = deleteWarningByCaseId(guildId, caseId);
  if (!removed) return null;
  updateCaseStatus(guildId, caseId, 'reversed', actorId);
  recordCaseAudit({ guildId, caseId, actorId, event: 'case.strike.removed', before: strikeWeight, after: 0, metadata: { strikeWeight } });
  return { ...warning, strikeWeight };
}

async function getWarningContext({ guildId, userId, reason }) {
  let repeatInfo = { isRepeatPattern: false, repeatCount: 0, newlyTriggered: false, matchingCaseIds: [] };
  try { repeatInfo = getRepeatReasonInfo({ guildId, userId, reason }) || repeatInfo; }
  catch (error) { console.error('❌ Warning repeat-reason check failed:', error); }
  const profile = getActiveStrikeProfile(guildId, userId);
  return { count: profile.warningCount, strikeScore: profile.strikeScore, repeatInfo, nextEscalation: getNextEscalationPreview(guildId, userId) };
}
async function runWarningEscalation({ guild, member, moderator, reason, previousStrikeScore = null, sourceWarningCaseId = null }) {
  try { return await handleEscalation({ guild, member, moderator, reason, previousStrikeScore, sourceWarningCaseId }); }
  catch (error) {
    console.error('❌ Warning escalation failed:', error);
    recordModerationSystemEvent({ guildId: guild?.id || 'system', actorId: moderator?.id || null, event: 'moderation.escalation.failed', targetId: member?.id || null, reason: error?.message || error, metadata: { sourceWarningCaseId, stack: String(error?.stack || '').slice(0, 1500) } });
    return null;
  }
}

function buildWarnModal(targetId) {
  return new ModalBuilder().setCustomId(`mod_submit_warn:${targetId}`).setTitle('Warn User').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('strike_weight').setLabel('Strike weight (1-5)').setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(false).setMaxLength(1)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('warn_expiry').setLabel('Warn expiry (7d, 2w, 1m, or never)').setStyle(TextInputStyle.Short).setPlaceholder('never').setRequired(false).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the moderation reason').setRequired(true).setMaxLength(500))
  );
}
function buildRemoveWarningModal(targetId) {
  return new ModalBuilder().setCustomId(`mod_submit_remove_warning:${targetId}`).setTitle('Remove Warning').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_id').setLabel('Warning Case ID').setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(true).setMaxLength(10))
  );
}
async function showWarningModal(interaction, targetId) {
  const target = await requireModeratableTarget(interaction, targetId, 'warn');
  if (!target) return true;
  await interaction.showModal(buildWarnModal(target.id));
  return true;
}
async function showRemoveWarningModal(interaction, targetId) {
  const allowed = await ensureActionAccess(interaction, 'remove_warning', '❌ No permission to remove warnings.');
  if (!allowed) return true;
  if (!targetId || targetId === 'none') return safeReply(interaction, ephemeralError('No user selected.'));
  await interaction.showModal(buildRemoveWarningModal(targetId));
  return true;
}

async function submitWarning(interaction, target) {
  if (!interaction?.guild || !interaction?.user || !target) {
    const error = 'Could not resolve the warning target.';
    await safeReply(interaction, ephemeralError(error));
    return { ok: false, target, error };
  }
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const expiryRaw = interaction.fields.getTextInputValue('warn_expiry') || 'never';
  const weightRaw = interaction.fields.getTextInputValue('strike_weight') || '';
  const strikeWeight = parseStrikeWeight(weightRaw);
  if (!strikeWeight) {
    const error = 'Strike weight must be a whole number from 1 to 5.';
    await safeReply(interaction, ephemeralError(error));
    return { ok: false, target, error };
  }
  const normalizedExpiry = expiryRaw.trim().toLowerCase();
  const expiresAt = parseWarningExpiry(expiryRaw);
  if (!NO_EXPIRY_VALUES.has(normalizedExpiry) && !expiresAt) {
    const error = 'Invalid warning expiry. Use `7d`, `2w`, `1m`, or `never`.';
    await safeReply(interaction, ephemeralError(error));
    return { ok: false, target, error };
  }
  try {
    syncExpiredWarningsToCases(interaction.guild.id);
    const beforeProfile = getActiveStrikeProfile(interaction.guild.id, target.id);
    const { modCase } = createWarningCaseAtomic({
      guildId: interaction.guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      reason,
      expiresAt,
      strikeWeight,
      actorId: interaction.user.id,
    });
    const warningContext = await getWarningContext({ guildId: interaction.guild.id, userId: target.id, reason });
    recordCaseAudit({
      guildId: interaction.guild.id,
      caseId: modCase.caseId,
      actorId: interaction.user.id,
      event: 'case.strike.added',
      before: beforeProfile.strikeScore,
      after: warningContext.strikeScore,
      metadata: { strikeWeight, warningCount: warningContext.count, expiresAt, repeatCount: warningContext.repeatInfo.repeatCount },
    });
    const escalatedCase = await runWarningEscalation({
      guild: interaction.guild,
      member: target,
      moderator: interaction.user,
      reason,
      previousStrikeScore: beforeProfile.strikeScore,
      sourceWarningCaseId: modCase.caseId,
    });
    if (escalatedCase) {
      recordCaseAudit({
        guildId: interaction.guild.id,
        caseId: modCase.caseId,
        actorId: interaction.user.id,
        event: 'case.strike.escalated',
        before: warningContext.strikeScore,
        after: escalatedCase.action,
        metadata: { escalatedCaseId: escalatedCase.caseId, action: escalatedCase.action },
      });
    }
    await sendModLog({
      guild: interaction.guild,
      target,
      moderator: interaction.user,
      action: 'Warn',
      reason,
      caseId: modCase.caseId,
      metadata: {
        expiresAt,
        strikeWeight,
        strikeScore: warningContext.strikeScore,
        warningCount: warningContext.count,
        nextEscalation: warningContext.nextEscalation,
        repeatPattern: Boolean(warningContext.repeatInfo.isRepeatPattern),
        repeatCount: warningContext.repeatInfo.repeatCount || 0,
        escalatedAction: escalatedCase?.action || null,
        escalatedCaseId: escalatedCase?.caseId || null,
      },
    });
    const extra = [
      `🎯 Strike weight: **${strikeWeight}** • Active score: **${warningContext.strikeScore}** (${warningContext.count} warning${warningContext.count === 1 ? '' : 's'})`,
      `📈 Next: ${warningContext.nextEscalation}`,
    ];
    if (warningContext.repeatInfo.isRepeatPattern) extra.push(`🔁 Repeat reason detected (${warningContext.repeatInfo.repeatCount} matching active warnings)`);
    if (escalatedCase) extra.push(`⚡ Auto escalation triggered: **${escalatedCase.action}** (Case #${escalatedCase.caseId})`);
    await safeReply(interaction, { content: [`⚠️ Warned **${target.user.tag}** • Case #${modCase.caseId}`, ...extra].join('\n'), flags: 64 });
    return { ok: true, target, modCase, warningContext, escalatedCase, strikeWeight };
  } catch (error) {
    console.error('❌ Warn error:', error);
    await safeReply(interaction, ephemeralError('Failed to warn user.'));
    return { ok: false, target, error };
  }
}

async function submitWarningModal(interaction, targetId, refreshDashboard = null) {
  const target = await requireModeratableTarget(interaction, targetId, 'warn');
  if (!target) return { ok: false, handled: true, target: null, error: 'Warning target unavailable or denied.' };
  const result = await submitWarning(interaction, target);
  if (result?.ok && typeof refreshDashboard === 'function') await refreshDashboard(interaction, target);
  return result;
}
async function submitRemoveWarningRequest(interaction, targetId, createConfirmation) {
  const raw = interaction.fields.getTextInputValue('case_id').trim();
  const caseId = /^\d+$/.test(raw) ? Number(raw) : null;
  if (!caseId) return safeReply(interaction, ephemeralError('Warning case ID must be a number.'));
  const allowed = await ensureActionAccess(interaction, 'remove_warning');
  if (!allowed) return true;
  const warning = getWarningByCaseId(interaction.guild.id, caseId);
  if (!warning) return safeReply(interaction, ephemeralError('Warning not found for that case ID.'));
  if (targetId !== 'none' && warning.userId !== targetId) return safeReply(interaction, ephemeralError('User not found for that case.'));
  if (typeof createConfirmation !== 'function') return false;
  return createConfirmation(interaction, warning.userId, 'remove-warning', { caseId }, `Remove warning linked to **Case #${caseId}**?`);
}

module.exports = {
  syncExpiredWarningsToCases,
  createWarning,
  createWarningCaseAtomic,
  removeWarningByCaseId,
  getWarningContext,
  getActiveStrikeProfile,
  runWarningEscalation,
  showWarningModal,
  showRemoveWarningModal,
  submitWarningModal,
  submitRemoveWarningRequest,
  getWarningCountForUser,
  handleEscalation,
  getEscalationConfig,
  getNextEscalationPreview,
  getRepeatReasonInfo,
  parseStrikeWeight,
  parseDuration: parseEscalationDuration,
  normalizeReason,
};