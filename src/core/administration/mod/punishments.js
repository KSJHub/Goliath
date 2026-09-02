'use strict';

const crypto = require('node:crypto');
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  db,
  createCase,
  getCaseById,
  updateCaseStatus,
  recordCaseAudit,
  sendModLog,
} = require('./storage');
const { applyPunishmentEngine } = require('../automod/engine');
const { safeReply, safeEditReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const { checkHierarchy, checkHierarchyForBulk, fetchTarget, ensureActionAccess } = require('./permissions');
const {
  createWarningCaseAtomic,
  removeWarningByCaseId,
  getWarningContext,
  getActiveStrikeProfile,
  runWarningEscalation,
  parseStrikeWeight,
} = require('./warns');
const { getBulkActionProgressEmbed, getBulkActionSummaryEmbed } = require('./cases');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const MAX_BULK_TARGETS = 25;
const DURATION_UNITS = Object.freeze({ s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 });
const ACTION_LABELS = Object.freeze({ warn: 'Bulk Warn', timeout: 'Bulk Timeout', kick: 'Bulk Kick', ban: 'Bulk Ban', 'remove-warning': 'Bulk Remove Warning', 'remove-timeout': 'Bulk Remove Timeout' });
const ACTION_EMOJIS = Object.freeze({ warn: '⚠️', timeout: '⏳', kick: '👢', ban: '🔨', 'remove-warning': '🗑️', 'remove-timeout': '✅' });
const BULK_PERMISSION_ACTIONS = Object.freeze({ warn: 'bulk_warn', timeout: 'bulk_timeout', kick: 'bulk_kick', ban: 'bulk_ban', 'remove-warning': 'bulk_remove_warning', 'remove-timeout': 'bulk_remove_timeout' });
const ENGINE_ACTIONS = Object.freeze({
  timeout: { punishments: ['dm', 'timeout'], rule: 'Timeout', logAction: 'Timeout', caseAction: 'timeout', appliedKey: 'timeout' },
  kick: { punishments: ['dm', 'kick'], rule: 'Kick', logAction: 'Kick', caseAction: 'kick', appliedKey: 'kick' },
  ban: { punishments: ['dm', 'ban'], rule: 'Ban', logAction: 'Ban', caseAction: 'ban', appliedKey: 'ban' },
});
const PENDING_ACTION_PERMISSIONS = Object.freeze({ ban: 'ban', kick: 'kick', 'remove-warning': 'remove_warning', 'remove-timeout': 'remove_timeout' });
const VALID_BULK_ACTIONS = new Set(Object.keys(ACTION_LABELS));
const PROGRESS_UPDATE_EVERY = 2;
const DEFAULT_DASHBOARD_CONTEXT = Object.freeze({ view: 'actions', actionFilter: 'all', statusFilter: 'all', page: 0 });

function parseDuration(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/);
  if (!match) return null;
  const durationMs = Math.floor(Number(match[1]) * DURATION_UNITS[match[2]]);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}
function isValidTimeoutDuration(value) { const ms = Number(value); return Number.isFinite(ms) && ms > 0 && ms <= MAX_TIMEOUT_MS; }
function parseDeleteDays(value) { const raw = String(value ?? '').trim(); if (!/^\d+$/.test(raw)) return null; const days = Number(raw); return Number.isInteger(days) && days >= 0 && days <= 7 ? days : null; }
function parseWarningExpiry(value) {
  const raw = String(value || 'never').trim().toLowerCase();
  if (!raw || raw === 'never' || raw === 'none') return null;
  const match = raw.match(/^(\d+)\s*([dwm])$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  const current = new Date();
  if (match[2] === 'm') { const expiry = new Date(current); expiry.setUTCMonth(expiry.getUTCMonth() + amount); return expiry.toISOString(); }
  return new Date(current.getTime() + amount * (match[2] === 'w' ? 7 : 1) * 86400000).toISOString();
}

function buildPunishmentModal(type, targetId) {
  const config = { timeout: { title: 'Timeout User', duration: true }, kick: { title: 'Kick User' }, ban: { title: 'Ban User', days: true } }[type];
  if (!config) return null;
  const rows = [];
  if (config.days) rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Delete message days (0-7)').setStyle(TextInputStyle.Short).setPlaceholder('0').setRequired(true).setMaxLength(1)));
  if (config.duration) rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (10m, 1h, 1d)').setStyle(TextInputStyle.Short).setPlaceholder('1h').setRequired(true).setMaxLength(10)));
  rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the moderation reason').setRequired(true).setMaxLength(500)));
  return new ModalBuilder().setCustomId(`mod_submit_${type}:${targetId}`).setTitle(config.title).addComponents(...rows);
}
function buildBulkModal(type) {
  const operationHint = type === 'warn' ? 'warn or remove-warning' : type === 'timeout' ? 'timeout or remove-timeout' : type;
  const rows = [
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('users').setLabel(type === 'warn' ? 'User IDs / warning case IDs (max 25)' : 'User IDs / mentions (max 25)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Comma, space, mention, newline or semicolon separated').setRequired(true).setMaxLength(1000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('operation').setLabel(`Operation: ${operationHint}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20).setValue(type)),
  ];
  if (type === 'warn') {
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('strike_weight').setLabel('Warn strike weight (1-5)').setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(false).setMaxLength(1)));
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('warn_expiry').setLabel('Warn expiry (7d, 2w, 1m, never)').setStyle(TextInputStyle.Short).setPlaceholder('never').setRequired(false).setMaxLength(10)));
  } else if (type === 'timeout') rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Duration (10m, 1h, 1d)').setStyle(TextInputStyle.Short).setPlaceholder('1h').setRequired(false).setMaxLength(10)));
  else if (type === 'ban') rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('days').setLabel('Delete message days (0-7)').setStyle(TextInputStyle.Short).setPlaceholder('0').setRequired(true).setMaxLength(1)));
  rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(type === 'warn' ? 'Reason / removal note' : 'Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the moderation reason').setRequired(true).setMaxLength(500)));
  return new ModalBuilder().setCustomId(`mod_submit_bulk_${type}`).setTitle(ACTION_LABELS[type] || 'Bulk Moderation').addComponents(...rows);
}

function purgeExpiredPendingActions(guildId) { return db.prepare('DELETE FROM pending_actions WHERE guild_id = ? AND expires_at <= ?').run(String(guildId), new Date().toISOString()).changes; }
function createPendingAction(guildId, action = {}) {
  purgeExpiredPendingActions(guildId);
  const token = crypto.randomBytes(8).toString('hex');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 600000).toISOString();
  db.prepare('INSERT INTO pending_actions (token, guild_id, moderator_id, target_id, type, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(token, String(guildId), action.moderatorId || null, action.targetId || null, action.type || 'unknown', JSON.stringify(action.payload || {}), createdAt, expiresAt);
  return token;
}
function getPendingAction(guildId, token) {
  purgeExpiredPendingActions(guildId);
  const row = db.prepare('SELECT * FROM pending_actions WHERE guild_id = ? AND token = ?').get(String(guildId), String(token));
  if (!row) return null;
  let payload = {};
  try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch { payload = {}; }
  return { token: row.token, moderatorId: row.moderator_id, targetId: row.target_id, type: row.type, payload, createdAt: row.created_at, expiresAt: row.expires_at };
}
function deletePendingAction(guildId, token) { return db.prepare('DELETE FROM pending_actions WHERE guild_id = ? AND token = ?').run(String(guildId), String(token)).changes > 0; }
function normalizeDashboardContext(context = {}) { return { view: context.view || 'actions', actionFilter: context.actionFilter || 'all', statusFilter: context.statusFilter || 'all', page: Math.max(0, Math.trunc(Number(context.page) || 0)) }; }
function buildConfirmCustomId(token, context = DEFAULT_DASHBOARD_CONTEXT) { const c = normalizeDashboardContext(context); return ['mod_confirm_action', token, c.view, c.actionFilter, c.statusFilter, c.page].join(':'); }
function buildCancelCustomId(targetId, context = DEFAULT_DASHBOARD_CONTEXT) { const c = normalizeDashboardContext(context); return ['mod_cancel_action', targetId || 'none', c.view, c.actionFilter, c.statusFilter, c.page].join(':'); }
function buildConfirmRow(confirmId, cancelId) { return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(confirmId).setLabel('⚠️ Confirm').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(cancelId).setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary))]; }
async function createConfirmation(interaction, targetId, type, payload, message, context = DEFAULT_DASHBOARD_CONTEXT) {
  const normalizedContext = normalizeDashboardContext(context);
  const token = createPendingAction(interaction.guild.id, { moderatorId: interaction.user.id, targetId, type, payload });
  return safeReply(interaction, { content: message, components: buildConfirmRow(buildConfirmCustomId(token, normalizedContext), buildCancelCustomId(targetId, normalizedContext)), flags: 64 });
}
function createModerationCase(interaction, targetId, action, reason, metadata = {}, extras = {}) { return createCase({ guildId: interaction.guild.id, userId: targetId, moderatorId: interaction.user.id, action, reason, metadata, actorId: interaction.user.id, ...extras }); }
async function logAction(interaction, target, action, reason, caseId, metadata = {}) { return target ? sendModLog({ guild: interaction.guild, target, moderator: interaction.user, action, reason, caseId, metadata }) : null; }

async function executeEnginePunishment(interaction, target, action, reason, metadata = {}, options = {}) {
  const config = ENGINE_ACTIONS[action];
  if (!config) throw new Error(`Unknown punishment action: ${action}`);
  const engineOptions = { punishments: config.punishments, rule: config.rule, reason, moderator: interaction.user, source: 'moderation' };
  if (action === 'timeout') engineOptions.durationMs = metadata.durationMs;
  if (action === 'ban') engineOptions.deleteDays = metadata.deleteDays;
  const report = await applyPunishmentEngine({ member: target, user: target.user, guild: interaction.guild }, engineOptions);
  if (!Array.isArray(report?.applied) || !report.applied.includes(config.appliedKey)) throw new Error(`Failed to ${action} user. Failed: ${report?.failedText || 'unknown'}`);
  const caseMetadata = {
    ...(action === 'timeout' ? { duration: metadata.durationRaw } : {}),
    ...(action === 'ban' ? { deleteDays: metadata.deleteDays } : {}),
    ...(metadata.bulkBatchId ? { bulk: true, bulkBatchId: metadata.bulkBatchId } : {}),
    punishmentReport: report,
  };
  const modCase = createModerationCase(interaction, target.id, config.caseAction, reason, caseMetadata);
  await logAction(interaction, target, options.logAction || config.logAction, reason, modCase.caseId, { ...caseMetadata, dmSent: report.dmSent });
  return { target, modCase, report };
}
async function submitTimeout(interaction, target) {
  const durationRaw = interaction.fields.getTextInputValue('duration').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const durationMs = parseDuration(durationRaw);
  if (!durationMs || !isValidTimeoutDuration(durationMs)) { await safeReply(interaction, ephemeralError(durationMs ? 'Timeout cannot exceed 28 days.' : 'Invalid duration. Use `10m`, `1h`, or `1d`.')); return { ok: false, target, error: 'Invalid timeout duration.' }; }
  try {
    const result = await executeEnginePunishment(interaction, target, 'timeout', reason, { durationRaw, durationMs });
    await safeReply(interaction, { content: `⏳ Timed out **${target.user.tag}** for **${durationRaw}** • Case #${result.modCase.caseId}`, flags: 64 });
    return { ok: true, ...result };
  } catch (error) { console.error('❌ Timeout error:', error); await safeReply(interaction, ephemeralError('Failed to timeout user.')); return { ok: false, target, error }; }
}
async function submitPunishmentRequest(interaction, target, action, confirm = createConfirmation) {
  if (!target || !ENGINE_ACTIONS[action]) return { ok: false, target, error: 'Unknown punishment action.' };
  if (action === 'timeout') return submitTimeout(interaction, target);
  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (action === 'ban') {
    const deleteDays = parseDeleteDays(interaction.fields.getTextInputValue('days'));
    if (deleteDays === null) { await safeReply(interaction, ephemeralError('Delete message days must be 0-7.')); return { ok: false, target, error: 'Invalid delete days.' }; }
    await confirm(interaction, target.id, 'ban', { reason, deleteDays }, `Confirm ban for **${target.user.tag}**?\nReason: ${reason}\nDelete days: ${deleteDays}`);
    return { ok: true, pending: true, target };
  }
  await confirm(interaction, target.id, 'kick', { reason }, `Confirm kick for **${target.user.tag}**?\nReason: ${reason}`);
  return { ok: true, pending: true, target };
}

function readField(interaction, id, fallback = '') { try { return interaction.fields.getTextInputValue(id); } catch { return fallback; } }
function parseBulkTokens(raw, actionType) {
  const tokens = String(raw || '').split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
  const ids = []; const invalid = []; const seen = new Set(); const caseMode = actionType === 'remove-warning';
  for (const token of tokens) {
    const mention = token.match(/^<@!?(\d{16,20})>$/); const cleaned = mention ? mention[1] : token;
    const valid = caseMode ? /^\d{1,12}$/.test(cleaned) : /^\d{16,20}$/.test(cleaned);
    if (!valid) { invalid.push(token.slice(0, 40)); continue; }
    if (!seen.has(cleaned)) { seen.add(cleaned); ids.push(cleaned); }
  }
  return { ids, invalid, duplicateCount: Math.max(0, tokens.length - invalid.length - ids.length) };
}
function parseBulkModalPayload(interaction, buttonAction) {
  const operation = String(readField(interaction, 'operation', buttonAction) || buttonAction).trim().toLowerCase();
  const allowed = buttonAction === 'warn' ? new Set(['warn', 'remove-warning']) : buttonAction === 'timeout' ? new Set(['timeout', 'remove-timeout']) : new Set([buttonAction]);
  if (!allowed.has(operation)) return { error: `Operation must be ${[...allowed].join(' or ')}.` };
  const targets = parseBulkTokens(readField(interaction, 'users'), operation);
  const payload = { actionType: operation, ids: targets.ids, invalidTargets: targets.invalid, duplicateCount: targets.duplicateCount, reason: String(readField(interaction, 'reason')).trim() };
  if (operation === 'warn') { payload.strikeWeight = parseStrikeWeight(readField(interaction, 'strike_weight', '')); payload.warnExpiryRaw = String(readField(interaction, 'warn_expiry', 'never') || 'never').trim().toLowerCase(); payload.expiresAt = parseWarningExpiry(payload.warnExpiryRaw); }
  if (operation === 'timeout') payload.durationRaw = String(readField(interaction, 'duration')).trim();
  if (operation === 'ban') { payload.deleteDays = parseDeleteDays(readField(interaction, 'days')); if (payload.deleteDays === null) return { error: 'Delete message days must be 0-7.' }; }
  return { payload };
}
function validateBulkOptions(actionType, options = {}) {
  const errors = [];
  if (!VALID_BULK_ACTIONS.has(actionType)) errors.push('❌ Unknown bulk action type.');
  if (!Array.isArray(options.ids) || !options.ids.length) errors.push(`❌ No valid ${actionType === 'remove-warning' ? 'warning case IDs' : 'user IDs'} provided.`);
  if (options.ids?.length > MAX_BULK_TARGETS) errors.push(`❌ Bulk moderation is limited to ${MAX_BULK_TARGETS} unique targets per batch.`);
  if (!String(options.reason || '').trim()) errors.push('❌ A reason is required.');
  if (actionType === 'timeout') { const ms = parseDuration(options.durationRaw); if (!ms) errors.push('❌ Invalid duration. Use `10m`, `1h`, or `1d`.'); else if (!isValidTimeoutDuration(ms)) errors.push('❌ Timeout cannot exceed 28 days.'); }
  if (actionType === 'ban' && parseDeleteDays(options.deleteDays) === null) errors.push('❌ Delete message days must be between 0 and 7.');
  if (actionType === 'warn') { if (!options.strikeWeight) errors.push('❌ Strike weight must be a whole number from 1 to 5.'); if (options.expiresAt === undefined) errors.push('❌ Warning expiry must be `7d`, `2w`, `1m`, or `never`.'); }
  return errors;
}
function buildBulkPreview(options, batchId) {
  const ids = options.ids || [];
  return [
    `⚠️ **Confirm ${ACTION_LABELS[options.actionType] || 'Bulk Moderation'}**`, `Batch: \`${batchId}\``,
    `Targets: **${ids.length}** unique ${options.actionType === 'remove-warning' ? 'warning case' : 'member'}${ids.length === 1 ? '' : 's'} (max ${MAX_BULK_TARGETS})`,
    options.invalidTargets?.length ? `Invalid entries skipped: **${options.invalidTargets.length}**` : null,
    options.duplicateCount ? `Duplicates removed: **${options.duplicateCount}**` : null,
    options.actionType === 'warn' ? `Warning: weight **${options.strikeWeight}** • expiry **${options.warnExpiryRaw || 'never'}**` : null,
    options.actionType === 'timeout' ? `Duration: **${options.durationRaw}**` : null,
    options.actionType === 'ban' ? `Delete message days: **${options.deleteDays}**` : null,
    `Reason: ${String(options.reason).slice(0, 500)}`, '',
    `First targets: ${ids.slice(0, 10).map((id) => `\`${id}\``).join(', ')}${ids.length > 10 ? ` +${ids.length - 10} more` : ''}`,
  ].filter(Boolean).join('\n').slice(0, 1900);
}
async function submitBulkModal(interaction, buttonAction) {
  const parsed = parseBulkModalPayload(interaction, buttonAction);
  if (parsed.error) return safeReply(interaction, ephemeralError(parsed.error));
  const permission = BULK_PERMISSION_ACTIONS[parsed.payload.actionType];
  if (!permission || !(await ensureActionAccess(interaction, permission))) return true;
  const errors = validateBulkOptions(parsed.payload.actionType, parsed.payload);
  if (errors.length) return safeReply(interaction, { content: errors.join('\n'), flags: 64 });
  const batchId = `bulk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const payload = { ...parsed.payload, bulkBatchId: batchId };
  const token = createPendingAction(interaction.guild.id, { moderatorId: interaction.user.id, type: 'bulk', payload });
  return safeReply(interaction, { content: buildBulkPreview(payload, batchId), components: buildConfirmRow(buildConfirmCustomId(token, { view: 'tools' })), flags: 64 });
}

async function executeRemoveWarning(interaction, pending, fallbackTarget) {
  const caseId = Number(pending.payload.caseId);
  const warning = removeWarningByCaseId(interaction.guild.id, caseId, interaction.user.id);
  if (!warning) return { error: 'Failed to remove warning.' };
  const sourceCase = getCaseById(interaction.guild.id, caseId);
  const userId = sourceCase?.userId || warning.userId || pending.targetId;
  const unwindCase = createModerationCase(interaction, userId, 'unwarn', `Removed warning from case #${caseId}`, {}, { relatedCaseId: caseId, status: 'reversed' });
  const logTarget = fallbackTarget || await fetchTarget(interaction.guild, userId);
  await logAction(interaction, logTarget, 'Unwarn', unwindCase.reason, unwindCase.caseId);
  return { target: logTarget, content: `🗑️ Removed warning linked to **Case #${caseId}**.` };
}
async function executeRemoveTimeout(interaction, pending, target) {
  if (!target) return { error: 'Target is no longer available.' };
  await target.timeout(null, `Timeout removed by ${interaction.user.tag}`);
  const sourceCaseId = pending.payload.sourceCaseId || null;
  if (sourceCaseId) updateCaseStatus(interaction.guild.id, sourceCaseId, 'reversed', interaction.user.id);
  const reason = sourceCaseId ? `Removed timeout from case #${sourceCaseId}` : 'Timeout removed from panel';
  const modCase = createModerationCase(interaction, target.id, 'remove-timeout', reason, {}, { relatedCaseId: sourceCaseId, status: 'reversed' });
  await logAction(interaction, target, 'Remove Timeout', reason, modCase.caseId);
  return { target, content: `✅ Removed timeout from **${target.user.tag}** • Case #${modCase.caseId}` };
}

async function runBulkWarn(interaction, member, options) {
  const beforeProfile = getActiveStrikeProfile(interaction.guild.id, member.id);
  const report = await applyPunishmentEngine({ member, user: member.user, guild: interaction.guild }, { punishments: ['dm'], rule: 'Warning', reason: options.reason, moderator: interaction.user, source: 'moderation' });
  const { modCase } = createWarningCaseAtomic({
    guildId: interaction.guild.id,
    userId: member.id,
    moderatorId: interaction.user.id,
    reason: options.reason,
    expiresAt: options.expiresAt || null,
    strikeWeight: options.strikeWeight,
    actorId: interaction.user.id,
    metadata: { bulk: true, bulkBatchId: options.bulkBatchId, punishmentReport: report },
  });
  const warningContext = await getWarningContext({ guildId: interaction.guild.id, userId: member.id, reason: options.reason });
  recordCaseAudit({ guildId: interaction.guild.id, caseId: modCase.caseId, actorId: interaction.user.id, event: 'case.strike.added', before: beforeProfile.strikeScore, after: warningContext.strikeScore, metadata: { strikeWeight: options.strikeWeight, warningCount: warningContext.count, expiresAt: options.expiresAt || null, repeatCount: warningContext.repeatInfo.repeatCount, bulk: true, bulkBatchId: options.bulkBatchId } });
  const escalatedCase = await runWarningEscalation({ guild: interaction.guild, member, moderator: interaction.user, reason: options.reason, previousStrikeScore: beforeProfile.strikeScore, sourceWarningCaseId: modCase.caseId });
  if (escalatedCase) recordCaseAudit({ guildId: interaction.guild.id, caseId: modCase.caseId, actorId: interaction.user.id, event: 'case.strike.escalated', before: warningContext.strikeScore, after: escalatedCase.action, metadata: { escalatedCaseId: escalatedCase.caseId, action: escalatedCase.action, bulk: true, bulkBatchId: options.bulkBatchId } });
  await logAction(interaction, member, 'Bulk Warn', options.reason, modCase.caseId, { bulk: true, bulkBatchId: options.bulkBatchId, expiresAt: options.expiresAt || null, strikeWeight: options.strikeWeight, strikeScore: warningContext.strikeScore, warningCount: warningContext.count, repeatPattern: Boolean(warningContext.repeatInfo.isRepeatPattern), repeatCount: warningContext.repeatInfo.repeatCount || 0, escalatedAction: escalatedCase?.action || null, escalatedCaseId: escalatedCase?.caseId || null, dmSent: report.dmSent, punishmentReport: report });
  return modCase;
}
async function runBulkRemoveWarning(interaction, caseIdRaw, options) {
  const caseId = Number(caseIdRaw); const sourceCase = getCaseById(interaction.guild.id, caseId);
  if (!sourceCase || sourceCase.action !== 'warn') throw new Error('Warning case not found.');
  if (!removeWarningByCaseId(interaction.guild.id, caseId, interaction.user.id)) throw new Error('Warning is already absent or reversed.');
  const reason = options.reason || `Bulk removed warning from case #${caseId}`;
  const unwindCase = createModerationCase(interaction, sourceCase.userId, 'unwarn', reason, { bulk: true, bulkBatchId: options.bulkBatchId, sourceWarningCaseId: caseId }, { relatedCaseId: caseId, status: 'reversed' });
  const target = await fetchTarget(interaction.guild, sourceCase.userId);
  if (target) await logAction(interaction, target, 'Bulk Unwarn', reason, unwindCase.caseId, { bulk: true, bulkBatchId: options.bulkBatchId, sourceWarningCaseId: caseId });
  return unwindCase;
}
async function runBulkRemoveTimeout(interaction, member, options) {
  await member.timeout(null, `Bulk timeout removal by ${interaction.user.tag}: ${options.reason}`.slice(0, 512));
  const modCase = createModerationCase(interaction, member.id, 'remove-timeout', options.reason, { bulk: true, bulkBatchId: options.bulkBatchId }, { status: 'reversed' });
  await logAction(interaction, member, 'Bulk Remove Timeout', options.reason, modCase.caseId, { bulk: true, bulkBatchId: options.bulkBatchId });
  return modCase;
}
async function runSingleBulkAction(interaction, member, options) {
  if (options.actionType === 'warn') return runBulkWarn(interaction, member, options);
  if (options.actionType === 'remove-timeout') return runBulkRemoveTimeout(interaction, member, options);
  return executeEnginePunishment(interaction, member, options.actionType, options.reason, { durationRaw: options.durationRaw, durationMs: options.durationMs, deleteDays: options.deleteDays, bulkBatchId: options.bulkBatchId }, { logAction: ACTION_LABELS[options.actionType] });
}
async function runBulkAction(interaction, options) {
  const errors = validateBulkOptions(options.actionType, options);
  if (errors.length) return safeReply(interaction, { content: errors.join('\n'), flags: 64 });
  const durationMs = options.actionType === 'timeout' ? parseDuration(options.durationRaw) : null;
  const success = []; const failed = []; const total = options.ids.length; const actionLabel = ACTION_LABELS[options.actionType] || 'Bulk Moderation';
  await safeReply(interaction, { content: `Batch \`${options.bulkBatchId}\``, embeds: [getBulkActionProgressEmbed({ actionLabel, total, processed: 0, successCount: 0, failCount: 0 })], flags: 64 });
  for (let index = 0; index < options.ids.length; index += 1) {
    const id = options.ids[index];
    try {
      if (options.actionType === 'remove-warning') {
        const modCase = await runBulkRemoveWarning(interaction, id, options);
        success.push(`🗑️ Case #${id} → unwind #${modCase.caseId}`);
      } else {
        const member = await interaction.guild.members.fetch(id);
        const hierarchyError = checkHierarchyForBulk(interaction.member, interaction.guild.members.me, interaction.guild.ownerId, member, interaction.user.id);
        if (hierarchyError) failed.push(`❌ ${id} — ${hierarchyError}`);
        else {
          const result = await runSingleBulkAction(interaction, member, { ...options, durationMs });
          const caseId = result?.modCase?.caseId || result?.caseId || null;
          success.push(`${ACTION_EMOJIS[options.actionType] || '✅'} ${member.user.tag}${caseId ? ` • #${caseId}` : ''}`);
        }
      }
    } catch (error) { failed.push(`❌ ${id} — ${String(error?.message || 'Failed to process.').slice(0, 180)}`); }
    const processed = index + 1;
    if (processed % PROGRESS_UPDATE_EVERY === 0 || processed === total) await safeEditReply(interaction, { content: `Batch \`${options.bulkBatchId}\``, embeds: [getBulkActionProgressEmbed({ actionLabel, total, processed, successCount: success.length, failCount: failed.length })] });
  }
  return safeEditReply(interaction, { content: `Batch \`${options.bulkBatchId}\` • invalid skipped **${options.invalidTargets?.length || 0}** • duplicates removed **${options.duplicateCount || 0}**`, embeds: [getBulkActionSummaryEmbed({ actionLabel, total, success, failed })] });
}

async function executePendingAction(discord, interaction, token, returnContext = {}) {
  const pending = getPendingAction(interaction.guild.id, token);
  if (!pending) return safeReply(interaction, ephemeralError('That pending action has expired or could not be found.'));
  if (pending.moderatorId !== interaction.user.id) return safeReply(interaction, ephemeralError('Only the moderator who created this action can confirm it.'));
  if (pending.type === 'bulk') {
    const permission = BULK_PERMISSION_ACTIONS[pending.payload.actionType];
    if (!permission || !(await ensureActionAccess(interaction, permission))) { deletePendingAction(interaction.guild.id, token); return true; }
    deletePendingAction(interaction.guild.id, token);
    return runBulkAction(interaction, pending.payload);
  }
  const permissionAction = PENDING_ACTION_PERMISSIONS[pending.type];
  if (!permissionAction) { deletePendingAction(interaction.guild.id, token); return safeReply(interaction, ephemeralError('Unknown pending action type.')); }
  if (!(await ensureActionAccess(interaction, permissionAction))) { deletePendingAction(interaction.guild.id, token); return true; }
  const target = await fetchTarget(interaction.guild, pending.targetId);
  const hierarchyError = checkHierarchy(interaction, target);
  if (hierarchyError && pending.type !== 'remove-warning') { deletePendingAction(interaction.guild.id, token); return safeReply(interaction, ephemeralError(String(hierarchyError).replace(/^❌\s*/, ''))); }
  try {
    let result;
    if (pending.type === 'ban' || pending.type === 'kick') {
      const actionResult = await executeEnginePunishment(interaction, target, pending.type, pending.payload.reason || 'No reason provided', pending.type === 'ban' ? { deleteDays: Number(pending.payload.deleteDays || 0) } : {});
      result = { target, content: `✅ ${pending.type === 'ban' ? 'Banned' : 'Kicked'} **${target.user.tag}** • Case #${actionResult.modCase.caseId}${actionResult.report.dmSent ? ' • DM sent ✅' : ' • DM failed ❌'}` };
    } else if (pending.type === 'remove-warning') result = await executeRemoveWarning(interaction, pending, target);
    else if (pending.type === 'remove-timeout') result = await executeRemoveTimeout(interaction, pending, target);
    else result = { error: 'Unknown pending action type.' };
    deletePendingAction(interaction.guild.id, token);
    if (result?.error) return safeReply(interaction, ephemeralError(result.error));
    await interaction.update({ content: result.content, embeds: [], components: [] });
    const targetDeparted = pending.type === 'kick' || pending.type === 'ban';
    const dashboardTarget = targetDeparted ? null : result.target;
    const dashboardContext = targetDeparted
      ? { view: 'member', actionFilter: 'all', statusFilter: 'all', page: 0 }
      : normalizeDashboardContext(returnContext);
    if (dashboardTarget || targetDeparted) {
      const { refreshDashboard } = require('./panel');
      if (typeof refreshDashboard === 'function') await refreshDashboard(discord, interaction, dashboardTarget, dashboardContext);
    }
    return true;
  } catch (error) {
    console.error('❌ Pending action execution error:', error);
    deletePendingAction(interaction.guild.id, token);
    return safeReply(interaction, ephemeralError('Failed to complete that action.'));
  }
}

module.exports = { buildPunishmentModal, buildBulkModal, createConfirmation, submitPunishmentRequest, submitBulkModal, executePendingAction, runBulkAction, MAX_BULK_TARGETS };
