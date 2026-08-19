'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const {
  addWarning,
  getWarningCountForUser,
  getWarningByCaseId,
  deleteWarningByCaseId,
  purgeExpiredWarnings,
} = require('../../../core/logging/warnings/warningStore');
const {
  createCase,
  updateCaseStatus,
} = require('../../../core/logging/cases/caseStore');
const { sendModLog } = require('../../../core/logging/modlogs/moderationActionLog');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const {
  ensureActionAccess,
  requireModeratableTarget,
} = require('./permissions');
const {
  handleEscalation,
  getRepeatReasonInfo,
} = require('./escalationSystem');

const NO_EXPIRY_VALUES = new Set(['', 'never', 'none']);

function parseWarningExpiry(value) {
  const raw = String(value || 'never').trim().toLowerCase();
  if (NO_EXPIRY_VALUES.has(raw)) return null;

  const match = raw.match(/^(\d+)\s*([dwm])$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return null;

  const now = new Date();
  if (match[2] === 'm') {
    const expiry = new Date(now);
    expiry.setUTCMonth(expiry.getUTCMonth() + amount);
    return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const multiplier = match[2] === 'w' ? 7 * dayMs : dayMs;
  const expiry = new Date(now.getTime() + (amount * multiplier));
  return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
}

async function syncExpiredWarningsToCases(guildId) {
  const expiredWarnings = purgeExpiredWarnings(guildId) || [];
  for (const warning of expiredWarnings) {
    if (warning?.caseId) updateCaseStatus(guildId, warning.caseId, 'expired');
  }
  return expiredWarnings;
}

function createWarning({ guildId, userId, moderatorId, reason = 'No reason provided', caseId, expiresAt = null }) {
  return addWarning({ guildId, userId, moderatorId, reason, caseId, expiresAt });
}

function removeWarningByCaseId(guildId, caseId) {
  const warning = getWarningByCaseId(guildId, caseId);
  if (!warning) return null;
  const removed = deleteWarningByCaseId(guildId, caseId);
  if (!removed) return null;
  updateCaseStatus(guildId, caseId, 'reversed');
  return warning;
}

async function getWarningContext({ guildId, userId, reason }) {
  let repeatInfo = { isRepeatPattern: false, repeatCount: 0 };
  try {
    repeatInfo = getRepeatReasonInfo({ guildId, userId, reason }) || repeatInfo;
  } catch (error) {
    console.error('❌ Warning repeat-reason check failed:', error);
  }
  return { count: getWarningCountForUser(guildId, userId), repeatInfo };
}

async function runWarningEscalation({ guild, member, moderator, reason }) {
  try {
    return await handleEscalation({ guild, member, moderator, reason });
  } catch (error) {
    console.error('❌ Warning escalation failed:', error);
    return null;
  }
}

function buildWarnModal(targetId) {
  return new ModalBuilder()
    .setCustomId(`mod_submit_warn:${targetId}`)
    .setTitle('Warn User')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('warn_expiry')
          .setLabel('Warn expiry (7d, 2w, 1m, or never)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('never')
          .setRequired(false)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter the moderation reason')
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}

function buildRemoveWarningModal(targetId) {
  return new ModalBuilder()
    .setCustomId(`mod_submit_remove_warning:${targetId}`)
    .setTitle('Remove Warning')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('case_id')
          .setLabel('Warning Case ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1')
          .setRequired(true)
          .setMaxLength(10)
      )
    );
}

async function showWarningModal(interaction, targetId) {
  const target = await requireModeratableTarget(interaction, targetId, 'warn');
  if (!target) return true;
  await interaction.showModal(buildWarnModal(target.id));
  return true;
}

async function showRemoveWarningModal(interaction, targetId) {
  const allowed = await ensureActionAccess(
    interaction,
    'remove_warning',
    '❌ No permission to remove warnings.'
  );
  if (!allowed) return true;
  if (!targetId || targetId === 'none') {
    return safeReply(interaction, ephemeralError('No user selected.'));
  }
  await interaction.showModal(buildRemoveWarningModal(targetId));
  return true;
}

async function submitWarning(interaction, target) {
  if (!interaction?.guild || !interaction?.user || !target) {
    return safeReply(interaction, ephemeralError('Could not resolve the warning target.'));
  }

  const reason = interaction.fields.getTextInputValue('reason').trim();
  const expiryRaw = interaction.fields.getTextInputValue('warn_expiry') || 'never';
  const normalizedExpiry = expiryRaw.trim().toLowerCase();
  const expiresAt = parseWarningExpiry(expiryRaw);
  if (!NO_EXPIRY_VALUES.has(normalizedExpiry) && !expiresAt) {
    return safeReply(interaction, ephemeralError('Invalid warning expiry. Use `7d`, `2w`, `1m`, or `never`.'));
  }

  try {
    const modCase = createCase({
      guildId: interaction.guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      action: 'warn',
      reason,
      metadata: { expiresAt },
    });
    createWarning({
      guildId: interaction.guild.id,
      userId: target.id,
      moderatorId: interaction.user.id,
      reason,
      caseId: modCase.caseId,
      expiresAt,
    });

    const warningContext = await getWarningContext({
      guildId: interaction.guild.id,
      userId: target.id,
      reason,
    });
    const escalatedCase = await runWarningEscalation({
      guild: interaction.guild,
      member: target,
      moderator: interaction.user,
      reason,
    });

    await sendModLog({
      guild: interaction.guild,
      target,
      moderator: interaction.user,
      action: 'Warn',
      reason,
      caseId: modCase.caseId,
      metadata: {
        expiresAt,
        repeatPattern: Boolean(warningContext.repeatInfo.isRepeatPattern),
        repeatCount: warningContext.repeatInfo.repeatCount || 0,
        escalatedAction: escalatedCase?.action || null,
        escalatedCaseId: escalatedCase?.caseId || null,
      },
    });

    const extra = [];
    if (warningContext.repeatInfo.isRepeatPattern) {
      extra.push(`🔁 Repeat reason detected (${warningContext.repeatInfo.repeatCount} matching warnings)`);
    }
    if (escalatedCase) {
      extra.push(`⚡ Auto escalation triggered: **${escalatedCase.action}** (Case #${escalatedCase.caseId})`);
    }

    await safeReply(interaction, {
      content: [`⚠️ Warned **${target.user.tag}** • Case #${modCase.caseId}`, ...extra].join('\n'),
      flags: 64,
    });
    return { ok: true, target, modCase, warningContext, escalatedCase };
  } catch (error) {
    console.error('❌ Warn error:', error);
    await safeReply(interaction, ephemeralError('Failed to warn user.'));
    return { ok: false, target, error };
  }
}

async function submitWarningModal(interaction, targetId, refreshDashboard = null) {
  const target = await requireModeratableTarget(interaction, targetId, 'warn');
  if (!target) return true;
  const result = await submitWarning(interaction, target);
  if (result?.ok && typeof refreshDashboard === 'function') {
    await refreshDashboard(interaction, target);
  }
  return true;
}

async function submitRemoveWarningRequest(interaction, targetId, createConfirmation) {
  const raw = interaction.fields.getTextInputValue('case_id').trim();
  const caseId = /^\d+$/.test(raw) ? Number(raw) : null;
  if (!caseId) return safeReply(interaction, ephemeralError('Warning case ID must be a number.'));

  const allowed = await ensureActionAccess(interaction, 'remove_warning');
  if (!allowed) return true;

  const warning = getWarningByCaseId(interaction.guild.id, caseId);
  if (!warning) return safeReply(interaction, ephemeralError('Warning not found for that case ID.'));
  if (targetId !== 'none' && warning.userId !== targetId) {
    return safeReply(interaction, ephemeralError('User not found for that case.'));
  }
  if (typeof createConfirmation !== 'function') return false;

  return createConfirmation(
    interaction,
    warning.userId,
    'remove-warning',
    { caseId },
    `Remove warning linked to **Case #${caseId}**?`
  );
}

module.exports = {
  syncExpiredWarningsToCases,
  createWarning,
  removeWarningByCaseId,
  getWarningContext,
  runWarningEscalation,
  showWarningModal,
  showRemoveWarningModal,
  submitWarningModal,
  submitRemoveWarningRequest,
  getWarningCountForUser,
};
