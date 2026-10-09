'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  db,
  getAllCases,
  getCaseById,
  updateCaseReason,
  updateCaseNote,
  clearCaseNote,
  updateCaseStatus,
  deleteWarningByCaseId,
  recordCaseAudit,
  emitCaseUpdated,
  claimProceedingOperationAtomic,
} = require('./storage');
const { COLORS, EMOJIS } = require('../../ui/uiConfig');
const { createEmbed } = require('../../ui/embeds');
const { safeReply, safeEditReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const { canUseModAction } = require('./permissions');
const { restoreQuarantinedMember } = require('../../security/protection/quarantine');

const STATUS_LABELS = Object.freeze({
  active: '🟢 Active',
  reversed: '🔁 Reversed',
  expired: '⌛ Expired',
});
const APPEALABLE_ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban', 'case']);
const APPEAL_PAGE_SIZE = 5;
const MAX_APPEALS_PER_CASE = 20;
const APPEAL_STATUSES = new Set(['pending', 'approved', 'denied']);
const APPEAL_RESUBMIT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const APPEAL_QUEUE_TTL = 30 * 60 * 1000;
const APPEAL_QUEUE_STATES = new Map();
const APPEAL_REVIEW_LOCKS = new Set();
const APPEAL_REMEDY_LOCKS = new Set();
const APPEAL_REMEDY_STALE_MS = 5 * 60 * 1000;

function getStatus(modCase = {}) { return modCase.status || 'active'; }
function getStatusLabel(modCase = {}) { return STATUS_LABELS[getStatus(modCase)] || STATUS_LABELS.active; }
function getCaseTimestamp(dateValue) {
  const timestamp = new Date(dateValue).getTime();
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : Math.floor(Date.now() / 1000);
}
function formatCaseSummary(modCase = {}) { return [`#${modCase.caseId || '?'}`, modCase.action || 'unknown', getStatusLabel(modCase), `<t:${getCaseTimestamp(modCase.createdAt)}:R>`].join(' • '); }
function buildCaseFilterButtons() { return []; }
function buildCasesPageButtons(targetId, page, totalPages, actionFilter = 'all', statusFilter = 'all') {
  const actionOrder = ['all', 'warn', 'timeout', 'kick', 'ban', 'note'];
  const statusOrder = ['all', 'active', 'reversed', 'expired'];
  const actionIndex = Math.max(0, actionOrder.indexOf(actionFilter));
  const statusIndex = Math.max(0, statusOrder.indexOf(statusFilter));
  const nextAction = actionOrder[(actionIndex + 1) % actionOrder.length];
  const nextStatus = statusOrder[(statusIndex + 1) % statusOrder.length];
  const actionLabel = actionFilter === 'all' ? 'All' : actionFilter[0].toUpperCase() + actionFilter.slice(1);
  const statusLabel = statusFilter === 'all' ? 'All' : statusFilter[0].toUpperCase() + statusFilter.slice(1);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_page:${targetId}:${actionFilter}:${statusFilter}:${page - 1}`).setLabel(`${EMOJIS.BACK} Prev`).setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`mod_filter_cases:${targetId}:${nextAction}:${statusFilter}:0`).setLabel(`Action: ${actionLabel}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_filter_cases:${targetId}:${actionFilter}:${nextStatus}:0`).setLabel(`Status: ${statusLabel}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_case_page:${targetId}:${actionFilter}:${statusFilter}:${page + 1}`).setLabel(`Next ${EMOJIS.NEXT}`).setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
  )];
}

function getCaseAppeals(modCase = {}) {
  return Array.isArray(modCase?.metadata?.appeals)
    ? modCase.metadata.appeals.filter((appeal) => appeal && typeof appeal === 'object' && appeal.id)
    : [];
}
function getPendingAppeal(modCase = {}) { return getCaseAppeals(modCase).find((appeal) => appeal.status === 'pending') || null; }
function getAppealById(modCase, appealId) { return getCaseAppeals(modCase).find((appeal) => String(appeal.id) === String(appealId)) || null; }
function updateCaseMetadata(guildId, caseId, metadata) {
  const updatedAt = new Date().toISOString();
  const result = db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?').run(JSON.stringify(metadata || {}), updatedAt, String(guildId), Number(caseId));
  if (!result.changes) return null;
  const updated = getCaseById(guildId, caseId);
  if (updated) emitCaseUpdated(guildId, updated);
  return updated;
}
function getAppealEligibility(modCase, appellantId, nowMs = Date.now()) {
  if (!modCase) return { ok: false, error: 'Case not found.' };
  const normalizedAppellant = String(appellantId || '').trim();
  if (!/^\d{16,20}$/.test(normalizedAppellant)) return { ok: false, error: 'Appellant ID must be a valid Discord user ID.' };
  if (String(modCase.userId) !== normalizedAppellant) return { ok: false, error: 'Only the user affected by this moderation case can appeal it.' };
  if (!APPEALABLE_ACTIONS.has(String(modCase.action || '').toLowerCase())) return { ok: false, error: 'This case type is not appealable.' };
  if (String(modCase.action || '').toLowerCase() === 'case') {
    const proceeding = modCase.metadata?.proceeding;
    if (!proceeding?.publication || proceeding.stage !== 'published' || !proceeding.decision) return { ok: false, error: 'Cases become appealable only after an official decision is published.' };
  }
  if (getStatus(modCase) !== 'active') return { ok: false, error: `This case is ${getStatus(modCase)} and is no longer eligible for appeal.` };
  const appeals = getCaseAppeals(modCase);
  if (appeals.length >= MAX_APPEALS_PER_CASE) return { ok: false, error: `Case appeal history is limited to ${MAX_APPEALS_PER_CASE} appeals.` };
  if (appeals.some((appeal) => appeal.status === 'pending')) return { ok: false, error: 'This case already has a pending appeal.' };
  if (appeals.some((appeal) => appeal.status === 'approved')) return { ok: false, error: 'An appeal for this case has already been approved.' };
  const denied = appeals.filter((appeal) => appeal.status === 'denied' && appeal.reviewedAt).sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt)))[0];
  if (denied) {
    const reviewedAt = new Date(denied.reviewedAt).getTime();
    if (Number.isFinite(reviewedAt) && nowMs - reviewedAt < APPEAL_RESUBMIT_COOLDOWN_MS) {
      const eligibleAt = reviewedAt + APPEAL_RESUBMIT_COOLDOWN_MS;
      return { ok: false, error: `A denied appeal can be resubmitted after <t:${Math.floor(eligibleAt / 1000)}:F>.`, eligibleAt };
    }
  }
  return { ok: true };
}
function submitAppeal(guildId, caseId, { appellantId, grounds, requestedResolution, source = 'staff' }, actorId = null) {
  const modCase = getCaseById(guildId, caseId);
  if (!modCase) return { ok: false, error: 'Case not found.' };
  const normalizedAppellant = String(appellantId || modCase.userId || '').trim();
  const eligibility = getAppealEligibility(modCase, normalizedAppellant);
  if (!eligibility.ok) return eligibility;
  const normalizedGrounds = String(grounds || '').trim().slice(0, 1500);
  if (!normalizedGrounds) return { ok: false, error: 'Appeal grounds are required.' };
  const appeals = getCaseAppeals(modCase);
  const appeal = {
    id: `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'pending',
    appellantId: normalizedAppellant,
    grounds: normalizedGrounds,
    requestedResolution: String(requestedResolution || '').trim().slice(0, 500) || null,
    source: String(source || 'staff').slice(0, 32),
    submittedBy: actorId ? String(actorId) : null,
    submittedAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    remedy: null,
    notification: null,
  };
  const metadata = { ...(modCase.metadata || {}), appeals: [...appeals, appeal] };
  const updated = updateCaseMetadata(guildId, caseId, metadata);
  if (!updated) return { ok: false, error: 'Failed to persist appeal.' };
  recordCaseAudit({ guildId, caseId, actorId, event: 'case.appeal.submitted', before: null, after: { appealId: appeal.id, appellantId: appeal.appellantId, status: appeal.status, source: appeal.source, grounds: appeal.grounds, requestedResolution: appeal.requestedResolution }, metadata: { appealId: appeal.id, source: appeal.source } });
  return { ok: true, case: updated, appeal };
}
function listAppeals(guildId, filters = {}) {
  const status = String(filters.status || 'pending').trim().toLowerCase();
  const userId = String(filters.userId || '').trim();
  const moderatorId = String(filters.moderatorId || '').trim();
  const caseId = Number(filters.caseId);
  const results = [];
  for (const modCase of getAllCases(guildId) || []) {
    if (Number.isInteger(caseId) && caseId > 0 && Number(modCase.caseId) !== caseId) continue;
    if (userId && String(modCase.userId) !== userId) continue;
    if (moderatorId && String(modCase.moderatorId) !== moderatorId) continue;
    for (const appeal of getCaseAppeals(modCase)) {
      if (status && status !== 'all' && appeal.status !== status) continue;
      results.push({ case: modCase, appeal });
    }
  }
  return results.sort((a, b) => String(b.appeal.submittedAt || '').localeCompare(String(a.appeal.submittedAt || '')));
}
function getPendingAppeals(guildId) { return listAppeals(guildId, { status: 'pending' }); }
function rememberAppealQueue(guildId, filters = {}) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  APPEAL_QUEUE_STATES.set(token, { guildId: String(guildId), filters: { status: 'pending', ...filters }, createdAt: Date.now() });
  for (const [key, value] of APPEAL_QUEUE_STATES) if (Date.now() - value.createdAt > APPEAL_QUEUE_TTL) APPEAL_QUEUE_STATES.delete(key);
  return token;
}
function getAppealQueueState(token, guildId) {
  const state = APPEAL_QUEUE_STATES.get(token);
  if (!state || state.guildId !== String(guildId) || Date.now() - state.createdAt > APPEAL_QUEUE_TTL) { APPEAL_QUEUE_STATES.delete(token); return null; }
  return state;
}
function appealRemedyIsStale(execution) {
  if (!execution || execution.status !== 'reversing') return false;
  const started = new Date(execution.reversalClaimedAt || execution.reversalAttemptedAt || 0).getTime();
  return !Number.isFinite(started) || Date.now() - started > APPEAL_REMEDY_STALE_MS;
}

function effectiveAppealAction(modCase = {}) {
  const directAction = String(modCase.action || '').trim().toLowerCase();
  if (directAction !== 'case') return directAction;
  const proceeding = modCase?.metadata?.proceeding && typeof modCase.metadata.proceeding === 'object' ? modCase.metadata.proceeding : null;
  return String(proceeding?.sanctionExecution?.action || proceeding?.decision?.action || directAction).trim().toLowerCase();
}

function claimProceedingAppealRemedyForApproval(interaction, modCase) {
  const guildId = interaction.guild.id;
  const actorId = interaction.user?.id || null;
  const proceeding = modCase?.metadata?.proceeding && typeof modCase.metadata.proceeding === 'object' ? modCase.metadata.proceeding : null;
  const execution = proceeding?.sanctionExecution && typeof proceeding.sanctionExecution === 'object' ? proceeding.sanctionExecution : null;
  if (!proceeding?.publication || !proceeding?.decision) return { ok: true, case: modCase, claimed: false };

  // No successful punishment reached Discord, so there is nothing physical to undo.
  if (!execution || execution.status === 'failed') return { ok: true, case: modCase, claimed: false };
  if (execution.status === 'reversed') return { ok: false, error: 'This proceeding sanction has already been reversed.' };
  if (execution.status === 'executing') {
    return { ok: false, error: executionIsStaleForAppeal(execution)
      ? 'The sanction execution lock is stale and its outcome is uncertain. Resolve the execution state before approving this appeal.'
      : 'The sanction is still being executed. Wait for execution to finish before approving this appeal.' };
  }
  if (execution.status === 'reversing') return { ok: false, error: appealRemedyIsStale(execution) ? 'A stale appeal reversal exists. Use Retry Remedy from the appeal record to recover it.' : 'This appeal remedy is already being processed.' };
  if (execution.status === 'reversal_failed') return { ok: false, error: 'A previous reversal failed. Use Retry Remedy from the approved appeal record.' };
  if (execution.status !== 'executed') return { ok: false, error: `Sanction state ${execution.status || 'unknown'} cannot be safely reversed automatically.` };

  const claimedAt = new Date().toISOString();
  const operationId = `proceeding_remedy_${modCase.caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const claimedExecution = {
    ...execution,
    status: 'reversing',
    reversalOperationId: operationId,
    reversalClaimedBy: actorId,
    reversalClaimedAt: claimedAt,
    reversalAttemptedBy: actorId,
    reversalAttemptedAt: claimedAt,
    reversalRemedy: null,
  };
  const atomicClaim = claimProceedingOperationAtomic(guildId, modCase.caseId, { mode: 'reversal', claim: claimedExecution, staleMs: APPEAL_REMEDY_STALE_MS });
  if (!atomicClaim?.ok || !atomicClaim.case) {
    const error = atomicClaim?.reason === 'busy'
      ? 'This sanction reversal is already being processed by another Goliath process.'
      : atomicClaim?.reason === 'finalized'
        ? 'This sanction has already been reversed.'
        : 'The sanction could not be safely claimed for reversal. No appeal remedy was attempted.';
    return { ok: false, error };
  }
  recordCaseAudit({ guildId, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_claimed', before: atomicClaim.previous || execution, after: claimedExecution, metadata: { operationId, atomic: true } });
  return { ok: true, case: atomicClaim.case, claimed: true, operationId };
}

function executionIsStaleForAppeal(execution) {
  if (!execution || execution.status !== 'executing') return false;
  const started = new Date(execution.startedAt || execution.claimedAt || 0).getTime();
  return !Number.isFinite(started) || Date.now() - started > APPEAL_REMEDY_STALE_MS;
}

function persistProceedingAppealReversalFailure(interaction, modCase, error, operationId = null) {
  const guildId = interaction.guild.id;
  const actorId = interaction.user?.id || null;
  const current = getCaseById(guildId, modCase.caseId) || modCase;
  const metadata = { ...(current.metadata || {}) };
  const proceeding = metadata.proceeding && typeof metadata.proceeding === 'object' ? metadata.proceeding : {};
  const execution = proceeding.sanctionExecution && typeof proceeding.sanctionExecution === 'object' ? proceeding.sanctionExecution : null;
  const remedyAction = String(execution?.action || proceeding.decision?.action || 'proceeding');
  if (execution?.status === 'reversed') {
    const remedy = { attempted: false, action: remedyAction, ok: true, detail: 'The sanction is already reversed; a late failure result was ignored.' };
    recordCaseAudit({ guildId, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_failure_ignored', before: execution, after: execution, metadata: { operationId, reason: 'already_reversed' } });
    return { case: current, remedy, superseded: true };
  }
  if (operationId && execution?.reversalOperationId && execution.reversalOperationId !== operationId) {
    const remedy = { attempted: true, action: remedyAction, ok: false, detail: 'A newer reversal operation owns this case; the stale failure result was ignored.' };
    recordCaseAudit({ guildId, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_failure_ignored', before: execution, after: execution, metadata: { operationId, currentOperationId: execution.reversalOperationId, reason: 'superseded' } });
    return { case: current, remedy, superseded: true };
  }
  const remedy = { attempted: true, action: remedyAction, ok: false, detail: String(error?.message || error || 'Appeal remedy failed.').slice(0, 300) };
  metadata.proceeding = { ...proceeding, sanctionExecution: execution ? { ...execution, status: 'reversal_failed', reversalOperationId: operationId || execution.reversalOperationId || null, reversalAttemptedBy: actorId, reversalAttemptedAt: new Date().toISOString(), reversalRemedy: remedy } : execution };
  const updated = updateCaseMetadata(guildId, modCase.caseId, metadata) || current;
  recordCaseAudit({ guildId, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_failed', before: execution, after: metadata.proceeding.sanctionExecution, metadata: { operationId, remedy } });
  return { case: updated, remedy };
}

async function applyApprovedProceedingAppealRemedy(interaction, modCase, fetchTarget) {
  const guild = interaction.guild;
  const actorId = interaction.user?.id || null;
  const currentStart = getCaseById(guild.id, modCase.caseId) || modCase;
  const proceeding = currentStart.metadata?.proceeding && typeof currentStart.metadata.proceeding === 'object' ? currentStart.metadata.proceeding : null;
  const execution = proceeding?.sanctionExecution && typeof proceeding.sanctionExecution === 'object' ? proceeding.sanctionExecution : null;
  const action = String(execution?.action || proceeding?.decision?.action || 'no_action').toLowerCase();
  const linkedCaseId = Number(execution?.linkedCaseId || 0) || null;
  const reason = `Appeal approved for Case #${modCase.caseId}`;

  if (!proceeding?.publication || !proceeding?.decision) {
    updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
    return { attempted: false, action: 'proceeding', ok: true, detail: 'Case reversed; no published sanction was available to undo.' };
  }

  let remedy = { attempted: false, action, ok: true, detail: 'Published case decision reversed.' };
  if (!execution || execution.status === 'failed') {
  remedy = { attempted: false, action, ok: true, detail: 'Appeal approved before any sanction was successfully executed; no physical undo was required.' };
  const current = getCaseById(guild.id, modCase.caseId) || currentStart;
  const metadata = { ...(current.metadata || {}) };
  const currentProceeding = metadata.proceeding && typeof metadata.proceeding === 'object' ? metadata.proceeding : proceeding;
  const currentExecution = currentProceeding?.sanctionExecution && typeof currentProceeding.sanctionExecution === 'object' ? currentProceeding.sanctionExecution : null;
  if (currentExecution?.status === 'executed') {
    const claim = claimProceedingAppealRemedyForApproval(interaction, current);
    if (!claim.ok) return { attempted: false, action, ok: false, detail: claim.error || 'The sanction state changed while the appeal was being approved.' };
    return applyApprovedProceedingAppealRemedy(interaction, claim.case || current, fetchTarget);
  }
  if (currentExecution && !['failed', 'reversed'].includes(currentExecution.status)) return { attempted: false, action, ok: false, detail: `The sanction state changed to ${currentExecution.status}; no false reversal was recorded.` };
  if (currentExecution?.status === 'reversed') return { attempted: false, action, ok: true, detail: 'The sanction was already reversed; no further physical undo was required.' };
  const reversedAt = new Date().toISOString();
  metadata.proceeding = { ...currentProceeding, sanctionExecution: { ...(currentExecution || execution || { action }), status: 'reversed', action, reversedBy: actorId, reversedAt, reversalAttemptedBy: actorId, reversalAttemptedAt: reversedAt, reversalReason: reason, reversalRemedy: remedy }, appealOutcome: { status: 'approved', reviewedBy: actorId, reviewedAt: reversedAt, remedy } };
  updateCaseMetadata(guild.id, modCase.caseId, metadata);
  updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
  recordCaseAudit({ guildId: guild.id, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_applied', before: currentExecution || execution, after: metadata.proceeding.sanctionExecution, metadata: { linkedCaseId, remedy } });
  return remedy;
}

  const target = typeof fetchTarget === 'function' ? await fetchTarget(guild, modCase.userId) : null;

  if (action === 'warn') {
    const linkedWarning = linkedCaseId ? getCaseById(guild.id, linkedCaseId) : null;
    const removed = linkedCaseId ? deleteWarningByCaseId(guild.id, linkedCaseId) : false;
    const alreadyAbsent = Boolean(linkedCaseId && (!linkedWarning || linkedWarning.status !== 'active'));
    remedy = {
      attempted: true,
      action: 'remove-warning',
      ok: Boolean(removed) || alreadyAbsent,
      detail: removed
        ? `Warning Case #${linkedCaseId} removed.`
        : alreadyAbsent
          ? `Warning Case #${linkedCaseId} was already absent or inactive.`
          : 'Linked warning record could not be removed.',
    };
  } else if (action === 'timeout') {
    if (!target) remedy = { attempted: true, action: 'remove-timeout', ok: false, detail: 'Member not available to clear timeout.' };
    else {
      try { await target.timeout(null, reason); remedy = { attempted: true, action: 'remove-timeout', ok: true, detail: 'Timeout cleared following the approved appeal.' }; }
      catch (error) { remedy = { attempted: true, action: 'remove-timeout', ok: false, detail: String(error?.message || 'Failed to clear timeout.').slice(0, 300) }; }
    }
  } else if (action === 'quarantine') {
    if (!target) remedy = { attempted: true, action: 'remove-quarantine', ok: false, detail: 'Member not available to restore quarantine roles.' };
    else {
      const result = await restoreQuarantinedMember(guild, target, { reason });
      remedy = { attempted: true, action: 'remove-quarantine', ok: Boolean(result?.success), detail: result?.success ? `Quarantine removed; restored ${result.restoredRoles || 0} role(s).` : String(result?.error || result?.reason || 'Failed to remove quarantine.').slice(0, 300) };
    }
  } else if (action === 'ban') {
    try {
      await guild.bans.remove(modCase.userId, reason);
      remedy = { attempted: true, action: 'unban', ok: true, detail: 'Ban removed following the approved appeal.' };
    } catch (error) {
      const errorCode = Number(error?.code || error?.rawError?.code || 0);
      const errorText = String(error?.message || error?.rawError?.message || 'Failed to remove ban.');
      const alreadyUnbanned = errorCode === 10026 || /unknown ban|not banned/i.test(errorText);
      remedy = {
        attempted: true,
        action: 'unban',
        ok: alreadyUnbanned,
        detail: alreadyUnbanned ? 'Ban was already absent; the approved appeal outcome is satisfied.' : errorText.slice(0, 300),
      };
    }
  } else if (action === 'kick') {
    remedy = { attempted: false, action: 'kick', ok: true, detail: 'Kick cannot be automatically undone; the case decision has been reversed.' };
  } else if (action === 'no_action') {
    remedy = { attempted: false, action: 'no_action', ok: true, detail: 'Finding reversed; there was no sanction to undo.' };
  }

  const reversalSucceeded = remedy.ok !== false;
  if (linkedCaseId && reversalSucceeded) {
    const linked = getCaseById(guild.id, linkedCaseId);
    if (linked && linked.status === 'active') updateCaseStatus(guild.id, linkedCaseId, 'reversed', actorId);
  }

  const current = getCaseById(guild.id, modCase.caseId) || currentStart;
  const metadata = { ...(current.metadata || {}) };
  const currentProceeding = metadata.proceeding && typeof metadata.proceeding === 'object' ? metadata.proceeding : proceeding;
  const currentExecution = currentProceeding?.sanctionExecution && typeof currentProceeding.sanctionExecution === 'object' ? currentProceeding.sanctionExecution : null;
  const expectedOperationId = execution?.reversalOperationId || null;
  if (currentExecution?.status === 'reversed') return { ...remedy, ok: true, detail: reversalSucceeded ? remedy.detail : 'The sanction is already reversed; a stale failure result was ignored.' };
  if (expectedOperationId && currentExecution?.reversalOperationId && currentExecution.reversalOperationId !== expectedOperationId) {
    const supersededRemedy = { ...remedy, ok: false, detail: `${String(remedy.detail || 'Appeal remedy completed.').slice(0, 220)} A newer reversal operation owns the case, so this stale result was not persisted.` };
    recordCaseAudit({ guildId: guild.id, caseId: modCase.caseId, actorId, event: 'case.proceeding.appeal_remedy_result_ignored', before: execution, after: currentExecution, metadata: { linkedCaseId, expectedOperationId, currentOperationId: currentExecution.reversalOperationId } });
    return supersededRemedy;
  }
  metadata.proceeding = { ...currentProceeding, sanctionExecution: currentExecution ? { ...currentExecution, status: reversalSucceeded ? 'reversed' : 'reversal_failed', reversedBy: reversalSucceeded ? actorId : null, reversedAt: reversalSucceeded ? new Date().toISOString() : null, reversalAttemptedBy: actorId, reversalAttemptedAt: new Date().toISOString(), reversalReason: reason, reversalRemedy: remedy } : currentExecution, appealOutcome: { status: 'approved', reviewedBy: actorId, reviewedAt: new Date().toISOString(), remedy } };
  updateCaseMetadata(guild.id, modCase.caseId, metadata);
  if (reversalSucceeded) updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
  recordCaseAudit({ guildId: guild.id, caseId: modCase.caseId, actorId, event: reversalSucceeded ? 'case.proceeding.appeal_remedy_applied' : 'case.proceeding.appeal_remedy_failed', before: currentExecution || execution, after: metadata.proceeding.sanctionExecution, metadata: { linkedCaseId, remedy, operationId: expectedOperationId } });

  return remedy;
}

async function applyApprovedAppealRemedy(interaction, modCase, fetchTarget) {
  const guild = interaction.guild;
  const actorId = interaction.user?.id || null;
  const reason = `Appeal approved for Case #${modCase.caseId}`;
  if (modCase.action === 'case' && modCase.metadata?.proceeding) return applyApprovedProceedingAppealRemedy(interaction, modCase, fetchTarget);
  if (modCase.action === 'warn') {
    const removed = deleteWarningByCaseId(guild.id, modCase.caseId);
    // Desired end state is warning absent. Treat an already-absent warning as idempotent success.
    updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
    return { attempted: true, action: 'remove-warning', ok: true, detail: removed ? 'Warning removed.' : 'Warning record was already absent; no further warning action was required.' };
  }
  if (modCase.action === 'timeout') {
    const target = typeof fetchTarget === 'function' ? await fetchTarget(guild, modCase.userId) : null;
    if (!target) {
      return { attempted: true, action: 'remove-timeout', ok: false, detail: 'Member not available to clear timeout. Case remains active until the remedy succeeds.' };
    }
    try {
      await target.timeout(null, reason);
      updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
      return { attempted: true, action: 'remove-timeout', ok: true, detail: 'Timeout cleared.' };
    } catch (error) {
      return { attempted: true, action: 'remove-timeout', ok: false, detail: `${String(error?.message || 'Failed to clear timeout.').slice(0, 260)} Case remains active until the remedy succeeds.` };
    }
  }
  if (modCase.action === 'ban') {
    try {
      await guild.bans.remove(modCase.userId, reason);
      updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
      return { attempted: true, action: 'unban', ok: true, detail: 'Ban removed.' };
    } catch (error) {
      const message = String(error?.message || 'Failed to remove ban.');
      const alreadyAbsent = /unknown ban|not banned|10026/i.test(message);
      if (alreadyAbsent) {
        updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
        return { attempted: true, action: 'unban', ok: true, detail: 'Ban was already absent; desired appeal remedy state is satisfied.' };
      }
      return { attempted: true, action: 'unban', ok: false, detail: `${message.slice(0, 260)} Case remains active until the remedy succeeds.` };
    }
  }
  updateCaseStatus(guild.id, modCase.caseId, 'reversed', actorId);
  return { attempted: false, action: modCase.action, ok: true, detail: modCase.action === 'kick' ? 'Kick cannot be automatically undone; case status reversed.' : 'Case status reversed.' };
}

async function createRejoinInvite(guild, caseId) {
  const me = guild?.members?.me;
  if (!guild || !me) return { ok: false, error: 'Bot member is unavailable.' };
  const candidates = [];
  if (guild.systemChannel) candidates.push(guild.systemChannel);
  for (const channel of guild.channels?.cache?.values?.() || []) if (!candidates.some((item) => item?.id === channel?.id)) candidates.push(channel);
  for (const channel of candidates) {
    if (!channel?.isTextBased?.() || typeof channel.createInvite !== 'function') continue;
    const permissions = channel.permissionsFor?.(me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.CreateInstantInvite)) continue;
    try {
      const invite = await channel.createInvite({ maxAge: 24 * 60 * 60, maxUses: 1, unique: true, reason: `Appeal approved for Case #${caseId}` });
      if (invite?.url) return { ok: true, url: invite.url, channelId: channel.id };
    } catch { }
  }
  return { ok: false, error: 'No channel was available for a safe one-use rejoin invite.' };
}
async function notifyAppealOutcome(interaction, modCase, appeal) {
  const client = interaction.client || interaction.guild?.client;
  let invite = null;
  if (appeal.status === 'approved' && ['ban', 'kick'].includes(effectiveAppealAction(modCase)) && appeal.remedy?.ok === true) invite = await createRejoinInvite(interaction.guild, modCase.caseId);
  const decision = appeal.status === 'approved' ? 'approved ✅' : 'denied ❌';
  const lines = [
    `Your appeal for **${interaction.guild.name}** • Case **#${modCase.caseId}** has been **${decision}**.`,
    `Review: ${appeal.reviewNote}`,
  ];
  if (appeal.remedy?.detail) lines.push(`Outcome: ${appeal.remedy.detail}`);
  if (invite?.ok) lines.push(`Rejoin link (single use, expires in 24 hours): ${invite.url}`);
  lines.push('You can keep this DM as your appeal record.');
  let user = null;
  let sent = false;
  let error = null;
  try {
    user = await client?.users?.fetch?.(appeal.appellantId);
    if (!user?.send) throw new Error('Could not resolve appellant for DM delivery.');
    await user.send({ content: lines.join('\n').slice(0, 1900), components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('mod_appeal_lookup').setLabel('Appeal Another Case').setStyle(ButtonStyle.Secondary))] });
    sent = true;
  } catch (deliveryError) {
    error = String(deliveryError?.message || deliveryError || 'DM delivery failed.').slice(0, 300);
  }
  const notification = { sent, sentAt: new Date().toISOString(), error, invite: invite?.ok ? { url: invite.url, channelId: invite.channelId } : invite || null };
  recordCaseAudit({ guildId: interaction.guild.id, caseId: modCase.caseId, actorId: interaction.user?.id || null, event: sent ? 'case.appeal.notification.sent' : 'case.appeal.notification.failed', before: null, after: notification, metadata: { appealId: appeal.id, appellantId: appeal.appellantId } });
  return notification;
}
async function retryApprovedProceedingAppealRemedy(interaction, caseId, appealId, fetchTarget) {
  const guildId = interaction.guild.id;
  const actorId = interaction.user?.id || null;
  const lockKey = `${guildId}:${caseId}:${appealId}:remedy`;
  if (APPEAL_REMEDY_LOCKS.has(lockKey)) return { ok: false, error: 'This appeal remedy is already being retried.' };
  APPEAL_REMEDY_LOCKS.add(lockKey);
  try {
    let modCase = getCaseById(guildId, caseId);
    if (!modCase || modCase.action !== 'case' || !modCase.metadata?.proceeding) return { ok: false, error: 'Case could not be found.' };
    let appeals = getCaseAppeals(modCase);
    let index = appeals.findIndex((appeal) => String(appeal.id) === String(appealId));
    if (index < 0 || appeals[index].status !== 'approved') return { ok: false, error: 'Only an approved appeal can retry its remedy.' };
    if (appeals[index].remedy?.ok !== false) return { ok: false, error: 'This appeal remedy is already satisfied.' };
    const proceeding = modCase.metadata.proceeding;
    const execution = proceeding.sanctionExecution && typeof proceeding.sanctionExecution === 'object' ? proceeding.sanctionExecution : null;
    if (!execution || !['reversal_failed', 'reversing'].includes(execution.status)) return { ok: false, error: 'This sanction is not awaiting reversal recovery.' };
    if (execution.status === 'reversing' && !appealRemedyIsStale(execution)) return { ok: false, error: 'This appeal remedy is already being processed by another reviewer.' };

    const claimedAt = new Date().toISOString();
    const operationId = `proceeding_remedy_${caseId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const claimedExecution = {
      ...execution,
      status: 'reversing',
      reversalOperationId: operationId,
      reversalClaimedBy: actorId,
      reversalClaimedAt: claimedAt,
      reversalAttemptedBy: actorId,
      reversalAttemptedAt: claimedAt,
      error: null,
    };
    const atomicClaim = claimProceedingOperationAtomic(guildId, caseId, { mode: 'reversal', claim: claimedExecution, staleMs: APPEAL_REMEDY_STALE_MS });
    const claimed = atomicClaim?.case || null;
    if (!atomicClaim?.ok || !claimed) {
      return { ok: false, error: atomicClaim?.reason === 'busy' ? 'This appeal remedy is already being retried by another Goliath process.' : atomicClaim?.reason === 'finalized' ? 'This appeal remedy has already completed.' : 'Failed to claim the appeal remedy retry. No reversal action was attempted.' };
    }
    recordCaseAudit({ guildId, caseId, actorId, event: 'case.proceeding.appeal_remedy_retry_claimed', before: atomicClaim.previous || execution, after: claimedExecution, metadata: { appealId, operationId, atomic: true } });

    let remedy;
    try {
      remedy = await applyApprovedProceedingAppealRemedy(interaction, claimed, fetchTarget);
    } catch (error) {
    const failed = persistProceedingAppealReversalFailure(interaction, claimed, error, operationId);
    remedy = failed.remedy;
    recordCaseAudit({ guildId, caseId, actorId, event: 'case.proceeding.appeal_remedy_retry_failed', before: claimedExecution, after: remedy, metadata: { appealId, operationId, superseded: Boolean(failed.superseded) } });
  }


    modCase = getCaseById(guildId, caseId) || claimed;
    appeals = getCaseAppeals(modCase);
    index = appeals.findIndex((appeal) => String(appeal.id) === String(appealId));
    if (index < 0) return { ok: false, error: 'Appeal disappeared while the remedy retry was running.' };
    const previousAppeal = appeals[index];
    const attempt = { operationId, attemptedBy: actorId, attemptedAt: new Date().toISOString(), remedy };
    const updatedAppeal = { ...previousAppeal, remedy, remedyAttempts: [...(Array.isArray(previousAppeal.remedyAttempts) ? previousAppeal.remedyAttempts : []), attempt].slice(-20) };
    const nextAppeals = appeals.map((appeal, idx) => idx === index ? updatedAppeal : appeal);
    const updated = updateCaseMetadata(guildId, caseId, { ...(modCase.metadata || {}), appeals: nextAppeals }) || modCase;
    recordCaseAudit({ guildId, caseId, actorId, event: remedy?.ok ? 'case.proceeding.appeal_remedy_retry_succeeded' : 'case.proceeding.appeal_remedy_retry_failed', before: previousAppeal.remedy || null, after: remedy, metadata: { appealId, operationId } });
    return { ok: true, case: updated, appeal: getAppealById(updated, appealId) || updatedAppeal, remedy };
  } finally {
    APPEAL_REMEDY_LOCKS.delete(lockKey);
  }
}

async function resolveAppeal(interaction, caseId, appealId, decision, reviewNote, fetchTarget) {
  if (!APPEAL_STATUSES.has(decision) || decision === 'pending') return { ok: false, error: 'Appeal decision must be approved or denied.' };
  const lockKey = `${interaction.guild.id}:${caseId}:${appealId}`;
  if (APPEAL_REVIEW_LOCKS.has(lockKey)) return { ok: false, error: 'This appeal is already being reviewed by another moderator.' };
  APPEAL_REVIEW_LOCKS.add(lockKey);
  try {
    let modCase = getCaseById(interaction.guild.id, caseId);
    if (!modCase) return { ok: false, error: 'Case not found.' };
    let appeals = getCaseAppeals(modCase);
    let index = appeals.findIndex((appeal) => String(appeal.id) === String(appealId));
    if (index < 0) return { ok: false, error: 'Appeal not found.' };
    if (appeals[index].status !== 'pending') return { ok: false, error: `Appeal is already ${appeals[index].status}.` };
    const note = String(reviewNote || '').trim().slice(0, 1000);
    if (!note) return { ok: false, error: 'A review rationale is required.' };
    recordCaseAudit({ guildId: interaction.guild.id, caseId, actorId: interaction.user?.id || null, event: 'case.appeal.review.started', before: { appealId, status: 'pending' }, after: { reviewerId: interaction.user?.id || null }, metadata: { appealId } });
    let remedy = null;
    if (decision === 'approved') {
      let reversalClaim = { ok: true, case: modCase, claimed: false, operationId: null };
      if (modCase.action === 'case' && modCase.metadata?.proceeding) {
        reversalClaim = claimProceedingAppealRemedyForApproval(interaction, modCase);
        if (!reversalClaim.ok) return { ok: false, error: reversalClaim.error };
        modCase = reversalClaim.case || modCase;
      }
      try {
        remedy = await applyApprovedAppealRemedy(interaction, modCase, fetchTarget);
      } catch (error) {
        if (modCase.action === 'case' && modCase.metadata?.proceeding) {
          const failed = persistProceedingAppealReversalFailure(interaction, modCase, error, reversalClaim.operationId);
          modCase = failed.case;
          remedy = failed.remedy;
        } else {
          remedy = { attempted: true, action: modCase.action, ok: false, detail: String(error?.message || error || 'Appeal remedy failed.').slice(0, 300) };
        }
      }
    }
    modCase = getCaseById(interaction.guild.id, caseId) || modCase;
    appeals = getCaseAppeals(modCase);
    index = appeals.findIndex((appeal) => String(appeal.id) === String(appealId));
    if (index < 0 || appeals[index].status !== 'pending') return { ok: false, error: 'Appeal changed while it was being reviewed. Reload the queue.' };
    const before = { ...appeals[index] };
    const decided = { ...before, status: decision, reviewedBy: interaction.user?.id ? String(interaction.user.id) : null, reviewedAt: new Date().toISOString(), reviewNote: note, remedy };
    const next = appeals.map((appeal, idx) => idx === index ? decided : appeal);
    const metadata = { ...(modCase.metadata || {}), appeals: next };
    let updated = updateCaseMetadata(interaction.guild.id, caseId, metadata);
    if (!updated) return { ok: false, error: 'Failed to persist appeal decision.' };
    recordCaseAudit({ guildId: interaction.guild.id, caseId, actorId: interaction.user?.id || null, event: decision === 'approved' ? 'case.appeal.approved' : 'case.appeal.denied', before: { appealId: before.id, status: before.status }, after: { appealId: decided.id, status: decided.status, reviewNote: decided.reviewNote, remedy }, metadata: { appealId: decided.id, appellantId: decided.appellantId } });
    const notification = await notifyAppealOutcome(interaction, updated, decided);
    const refreshed = getCaseById(interaction.guild.id, caseId) || updated;
    const refreshedAppeals = getCaseAppeals(refreshed);
    const notificationIndex = refreshedAppeals.findIndex((appeal) => String(appeal.id) === String(appealId));
    if (notificationIndex >= 0) {
      const withNotification = refreshedAppeals.map((appeal, idx) => idx === notificationIndex ? { ...appeal, notification } : appeal);
      updated = updateCaseMetadata(interaction.guild.id, caseId, { ...(refreshed.metadata || {}), appeals: withNotification }) || refreshed;
    }
    return { ok: true, case: updated, appeal: getAppealById(updated, appealId) || { ...decided, notification } };
  } finally {
    APPEAL_REVIEW_LOCKS.delete(lockKey);
  }
}

function buildCaseDetailButtons(modCase) {
  const isWarning = modCase.action === 'warn';
  const isTimeout = modCase.action === 'timeout';
  const reversedOrExpired = modCase.status === 'reversed' || modCase.status === 'expired';
  const hasNote = Boolean(modCase.note && String(modCase.note).trim());
  const appeals = getCaseAppeals(modCase);
  const pending = appeals.some((appeal) => appeal.status === 'pending');
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mod_case_reverse_warning:${modCase.caseId}`).setLabel(`${EMOJIS.REVERSED} Reverse Warning`).setStyle(ButtonStyle.Secondary).setDisabled(!isWarning || reversedOrExpired),
      new ButtonBuilder().setCustomId(`mod_case_reverse_timeout:${modCase.caseId}`).setLabel('⏪ Reverse Timeout').setStyle(ButtonStyle.Secondary).setDisabled(!isTimeout || reversedOrExpired),
      new ButtonBuilder().setCustomId(`mod_case_note:${modCase.caseId}`).setLabel(hasNote ? `${EMOJIS.EDIT} Edit Note` : `${EMOJIS.NOTE} Add Note`).setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mod_case_appeal_submit:${modCase.caseId}`).setLabel(pending ? '⏳ Appeal Pending' : '📨 Record Appeal').setStyle(ButtonStyle.Primary).setDisabled(pending || appeals.length >= MAX_APPEALS_PER_CASE || reversedOrExpired || !APPEALABLE_ACTIONS.has(modCase.action)),
      new ButtonBuilder().setCustomId(`mod_case_appeal_history:${modCase.caseId}:0`).setLabel(`⚖️ Appeals (${appeals.length})`).setStyle(ButtonStyle.Secondary).setDisabled(!appeals.length),
      new ButtonBuilder().setCustomId('mod_case_appeal_queue:0').setLabel('📥 Appeal Queue').setStyle(ButtonStyle.Secondary)
    ),
  ];
}
function buildCaseIdModal(customId, title, label = 'Case ID') {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_id').setLabel(label).setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(true).setMaxLength(10)));
}
function buildEditCaseModal(customId) {
  return new ModalBuilder().setCustomId(customId).setTitle('Edit Case').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_id').setLabel('Case ID').setStyle(TextInputStyle.Short).setPlaceholder('1').setRequired(true).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('New Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the updated moderation reason').setRequired(true).setMaxLength(500))
  );
}
function buildCaseNoteModal(customId, existingNote = '') {
  return new ModalBuilder().setCustomId(customId).setTitle(existingNote ? 'Edit Case Note' : 'Add Case Note').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('note').setLabel('Staff Note').setStyle(TextInputStyle.Paragraph).setPlaceholder('Add internal staff-only context for this case').setRequired(false).setMaxLength(1000).setValue(String(existingNote || '').slice(0, 1000))));
}
function buildAppealSubmitModal(modCase) {
  return new ModalBuilder().setCustomId(`mod_submit_case_appeal:${modCase.caseId}`).setTitle(`Record Appeal • Case #${modCase.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('appellant_id').setLabel('Appellant User ID').setStyle(TextInputStyle.Short).setPlaceholder(modCase.userId).setRequired(false).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('grounds').setLabel('Appeal Grounds').setStyle(TextInputStyle.Paragraph).setPlaceholder('Why this moderation action should be reviewed').setRequired(true).setMaxLength(1500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('requested_resolution').setLabel('Requested Resolution').setStyle(TextInputStyle.Paragraph).setPlaceholder('Optional requested outcome').setRequired(false).setMaxLength(500))
  );
}
function buildExternalAppealModal(guildId, modCase) {
  return new ModalBuilder().setCustomId(`mod_appeal_external_submit:${guildId}:${modCase.caseId}`).setTitle(`Appeal Case #${modCase.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('grounds').setLabel('Why are you appealing?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Explain why the action should be reviewed').setRequired(true).setMaxLength(1500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('requested_resolution').setLabel('Requested Resolution').setStyle(TextInputStyle.Paragraph).setPlaceholder('Optional outcome you are asking for').setRequired(false).setMaxLength(500))
  );
}
function buildExternalAppealLookupModal() {
  return new ModalBuilder().setCustomId('mod_appeal_lookup_submit').setTitle('Appeal a Moderation Case').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Server ID').setStyle(TextInputStyle.Short).setPlaceholder('Discord server ID').setRequired(true).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_id').setLabel('Case ID').setStyle(TextInputStyle.Short).setPlaceholder('Case number from your moderation notice').setRequired(true).setMaxLength(12)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('grounds').setLabel('Why are you appealing?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Explain why the action should be reviewed').setRequired(true).setMaxLength(1500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('requested_resolution').setLabel('Requested Resolution').setStyle(TextInputStyle.Paragraph).setPlaceholder('Optional outcome you are asking for').setRequired(false).setMaxLength(500))
  );
}
function buildAppealDecisionModal(modCase, appeal, decision) {
  return new ModalBuilder().setCustomId(`mod_submit_case_appeal_decision:${modCase.caseId}:${appeal.id}:${decision}`).setTitle(`${decision === 'approved' ? 'Approve' : 'Deny'} Appeal • Case #${modCase.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('review_note').setLabel('Review Rationale').setStyle(TextInputStyle.Paragraph).setPlaceholder('Record why this appeal is being approved or denied').setRequired(true).setMaxLength(1000))
  );
}
function buildAppealQueueFilterModal(token) {
  return new ModalBuilder().setCustomId(`mod_submit_case_appeal_queue_filter:${token}`).setTitle('Filter Appeals').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('status').setLabel('Status').setStyle(TextInputStyle.Short).setPlaceholder('pending, approved, denied, all').setRequired(false).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user_id').setLabel('User ID').setStyle(TextInputStyle.Short).setPlaceholder('Optional appellant/user ID').setRequired(false).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_id').setLabel('Case ID').setStyle(TextInputStyle.Short).setPlaceholder('Optional case ID').setRequired(false).setMaxLength(12)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('moderator_id').setLabel('Case Moderator ID').setStyle(TextInputStyle.Short).setPlaceholder('Optional moderator ID').setRequired(false).setMaxLength(20))
  );
}
function buildCaseDetailEmbed(modCase) {
  const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🧾 Case #${modCase.caseId}`).addFields(
    { name: 'Action', value: modCase.action, inline: true }, { name: 'Status', value: getStatusLabel(modCase), inline: true }, { name: 'User ID', value: modCase.userId, inline: true }, { name: 'Moderator ID', value: modCase.moderatorId, inline: true }, { name: 'Reason', value: modCase.reason || 'No reason provided', inline: false }, { name: 'Created', value: `<t:${getCaseTimestamp(modCase.createdAt)}:F>`, inline: true }, { name: 'Updated', value: modCase.updatedAt ? `<t:${getCaseTimestamp(modCase.updatedAt)}:F>` : 'Never', inline: true }
  ).setTimestamp();
  if (modCase.relatedCaseId) embed.addFields({ name: 'Related Case', value: `#${modCase.relatedCaseId}`, inline: true });
  const appeals = getCaseAppeals(modCase);
  if (appeals.length) {
    const pending = appeals.filter((appeal) => appeal.status === 'pending').length;
    const approved = appeals.filter((appeal) => appeal.status === 'approved').length;
    const denied = appeals.filter((appeal) => appeal.status === 'denied').length;
    const failedNotifications = appeals.filter((appeal) => appeal.notification && appeal.notification.sent === false).length;
    embed.addFields({ name: '⚖️ Appeals', value: `Pending **${pending}** • Approved **${approved}** • Denied **${denied}** • History **${appeals.length}**${failedNotifications ? ` • DM failures **${failedNotifications}**` : ''}`, inline: false });
  }
  if (modCase.metadata?.appealNotice) {
    const notice = modCase.metadata.appealNotice;
    embed.addFields({ name: '📨 Appeal Notice', value: notice.sent ? `Sent ✅${notice.sentAt ? ` • <t:${getCaseTimestamp(notice.sentAt)}:R>` : ''}` : `Failed ❌${notice.error ? ` • ${String(notice.error).slice(0, 250)}` : ''}`, inline: false });
  }
  if (modCase.note && String(modCase.note).trim()) embed.addFields({ name: 'Staff Note', value: String(modCase.note).slice(0, 1024), inline: false });
  if (modCase.metadata && Object.keys(modCase.metadata).length) embed.addFields({ name: 'Metadata', value: `\`\`\`json\n${JSON.stringify(modCase.metadata, null, 2).slice(0, 900)}\n\`\`\``, inline: false });
  return embed;
}
function buildAppealHistoryEmbed(modCase, requestedPage = 0) {
  const appeals = [...getCaseAppeals(modCase)].sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
  const totalPages = Math.max(1, Math.ceil(appeals.length / APPEAL_PAGE_SIZE));
  const page = Math.max(0, Math.min(Math.trunc(Number(requestedPage) || 0), totalPages - 1));
  const slice = appeals.slice(page * APPEAL_PAGE_SIZE, (page + 1) * APPEAL_PAGE_SIZE);
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`⚖️ Case #${modCase.caseId} Appeals`).setFooter({ text: `Appeal history page ${page + 1}/${totalPages}` }).setTimestamp();
  if (!slice.length) embed.setDescription('No appeals recorded for this case.');
  for (const appeal of slice) {
    const submitted = appeal.submittedAt ? `<t:${getCaseTimestamp(appeal.submittedAt)}:R>` : 'unknown time';
    const reviewed = appeal.reviewedAt ? `<t:${getCaseTimestamp(appeal.reviewedAt)}:R>` : null;
    const lines = [
      `Status: **${String(appeal.status || 'pending').toUpperCase()}** • Appellant <@${appeal.appellantId}> • ${submitted}`,
      `Source: **${appeal.source || 'legacy'}**`,
      `Grounds: ${String(appeal.grounds || 'No grounds recorded').slice(0, 450)}`,
    ];
    if (appeal.requestedResolution) lines.push(`Requested: ${String(appeal.requestedResolution).slice(0, 250)}`);
    if (appeal.reviewedBy) lines.push(`Reviewed by <@${appeal.reviewedBy}>${reviewed ? ` • ${reviewed}` : ''}`);
    if (appeal.reviewNote) lines.push(`Decision note: ${String(appeal.reviewNote).slice(0, 300)}`);
    if (appeal.remedy) lines.push(`Remedy: ${appeal.remedy.ok ? '✅' : '⚠️'} ${String(appeal.remedy.detail || appeal.remedy.action || 'Recorded').slice(0, 250)}`);
    if (appeal.notification) lines.push(`Outcome DM: ${appeal.notification.sent ? '✅ sent' : `❌ failed${appeal.notification.error ? ` • ${String(appeal.notification.error).slice(0, 180)}` : ''}`}`);
    embed.addFields({ name: appeal.id, value: lines.join('\n').slice(0, 1024), inline: false });
  }
  const pending = getPendingAppeal(modCase);
  const components = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_appeal_history:${modCase.caseId}:${Math.max(0, page - 1)}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`mod_case_appeal_history:${modCase.caseId}:${Math.min(totalPages - 1, page + 1)}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId(`mod_case_appeal_open:${modCase.caseId}:${pending?.id || 'none'}`).setLabel('Open Pending').setStyle(ButtonStyle.Primary).setDisabled(!pending)
  ),
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mod_search_open:${modCase.caseId}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)),
];

  return { embeds: [embed], components };
}
function buildAppealDetailPayload(modCase, appeal) {
  const embed = new EmbedBuilder().setColor(appeal.status === 'pending' ? COLORS.PRIMARY : appeal.status === 'approved' ? COLORS.SUCCESS : COLORS.ERROR).setTitle(`⚖️ Appeal ${appeal.id}`).setDescription(`Linked Case **#${modCase.caseId}** • ${String(modCase.action).toUpperCase()} • ${String(appeal.status).toUpperCase()}`).addFields(
    { name: 'Appellant', value: `<@${appeal.appellantId}>`, inline: true },
    { name: 'Source', value: String(appeal.source || 'legacy'), inline: true },
    { name: 'Submitted', value: appeal.submittedAt ? `<t:${getCaseTimestamp(appeal.submittedAt)}:F>` : 'Unknown', inline: true },
    { name: 'Appeal Grounds', value: String(appeal.grounds || 'No grounds recorded').slice(0, 1024), inline: false }
  ).setTimestamp();
  if (appeal.requestedResolution) embed.addFields({ name: 'Requested Resolution', value: String(appeal.requestedResolution).slice(0, 1024), inline: false });
  if (appeal.reviewNote) embed.addFields({ name: 'Review Decision', value: String(appeal.reviewNote).slice(0, 1024), inline: false });
  if (appeal.remedy) embed.addFields({ name: 'Remedy', value: `${appeal.remedy.ok ? '✅' : '⚠️'} ${String(appeal.remedy.detail || appeal.remedy.action || 'Recorded').slice(0, 1000)}`, inline: false });
  if (appeal.notification) embed.addFields({ name: 'Outcome Notification', value: appeal.notification.sent ? `DM sent ✅${appeal.notification.invite?.url ? ' • rejoin invite created' : ''}` : `DM failed ❌${appeal.notification.error ? ` • ${appeal.notification.error}` : ''}`.slice(0, 1024), inline: false });
  const proceedingExecution = modCase.action === 'case' ? modCase.metadata?.proceeding?.sanctionExecution : null;
  const canRetryRemedy = appeal.status === 'approved' && appeal.remedy?.ok === false && (proceedingExecution?.status === 'reversal_failed' || (proceedingExecution?.status === 'reversing' && appealRemedyIsStale(proceedingExecution)));
  const components = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_appeal_decide:${modCase.caseId}:${appeal.id}:approved`).setLabel('✅ Approve').setStyle(ButtonStyle.Success).setDisabled(appeal.status !== 'pending'),
    new ButtonBuilder().setCustomId(`mod_case_appeal_decide:${modCase.caseId}:${appeal.id}:denied`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger).setDisabled(appeal.status !== 'pending'),
    new ButtonBuilder().setCustomId(`mod_case_appeal_retry_remedy:${modCase.caseId}:${appeal.id}`).setLabel(proceedingExecution?.status === 'reversing' && !appealRemedyIsStale(proceedingExecution) ? '⏳ Remedy Running' : '🔁 Retry Remedy').setStyle(ButtonStyle.Primary).setDisabled(!canRetryRemedy)
  ),
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mod_search_open:${modCase.caseId}`).setLabel('Case Detail').setStyle(ButtonStyle.Secondary)),
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mod_case_appeal_history:${modCase.caseId}:0`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)),
];

  return { embeds: [embed], components };
}
function buildAppealQueuePayload(guildId, requestedPage = 0, filters = { status: 'pending' }, token = null) {
  const normalizedStatus = ['pending', 'approved', 'denied', 'all'].includes(String(filters.status || '').toLowerCase()) ? String(filters.status).toLowerCase() : 'pending';
  const activeFilters = { ...filters, status: normalizedStatus };
  const results = listAppeals(guildId, activeFilters);
  const allAppeals = listAppeals(guildId, { status: 'all' });
  const counts = { pending: 0, approved: 0, denied: 0 };
  for (const { appeal } of allAppeals) if (Object.prototype.hasOwnProperty.call(counts, appeal.status)) counts[appeal.status] += 1;
  const totalPages = Math.max(1, Math.ceil(results.length / APPEAL_PAGE_SIZE));
  const page = Math.max(0, Math.min(Math.trunc(Number(requestedPage) || 0), totalPages - 1));
  const slice = results.slice(page * APPEAL_PAGE_SIZE, (page + 1) * APPEAL_PAGE_SIZE);
  const activeToken = token || rememberAppealQueue(guildId, activeFilters);
  const extraFilters = [activeFilters.userId ? `User <@${activeFilters.userId}>` : null, activeFilters.caseId ? `Case #${activeFilters.caseId}` : null, activeFilters.moderatorId ? `Moderator <@${activeFilters.moderatorId}>` : null].filter(Boolean);
  const emptyText = normalizedStatus === 'pending' && !extraFilters.length
    ? '**📭 No Pending Appeals**\nThere are currently no moderation appeals awaiting review.'
    : `**📭 No Appeals Found**\nNo ${normalizedStatus === 'all' ? '' : normalizedStatus + ' '}appeals matched the current filters.`;
  const description = slice.length
    ? ['Review and manage appeals submitted against moderation cases.', '', ...slice.map(({ case: modCase, appeal }) => {
        const submitted = appeal.submittedAt ? `<t:${getCaseTimestamp(appeal.submittedAt)}:f>` : 'Unknown';
        return [`**Case #${modCase.caseId} • ${String(modCase.action || 'case').toUpperCase()} Appeal**`, `Member: <@${appeal.appellantId}>`, `Moderator: <@${modCase.moderatorId}>`, `Submitted: ${submitted}`, `Status: **${String(appeal.status || 'pending').toUpperCase()}**`, `Appeal: ${String(appeal.grounds || 'No grounds recorded').replace(/\s+/g, ' ').slice(0, 220)}`].join('\n');
      })].join('\n\n')
    : ['Review and manage appeals submitted against moderation cases.', '', emptyText].join('\n');
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('⚖️ Moderation Appeals')
    .setDescription(description)
    .addFields(
      { name: '⏳ Pending', value: `**${counts.pending}**`, inline: true },
      { name: '✅ Approved', value: `**${counts.approved}**`, inline: true },
      { name: '❌ Denied', value: `**${counts.denied}**`, inline: true },
    );
  if (extraFilters.length) embed.addFields({ name: '🔎 Additional Filters', value: extraFilters.join(' • '), inline: false });
  embed.setFooter({ text: `${results.length} matching appeal${results.length === 1 ? '' : 's'} • Page ${page + 1}/${totalPages}` }).setTimestamp();
  const statusRow = new ActionRowBuilder().addComponents(
    ...['pending', 'approved', 'denied'].map((status) => new ButtonBuilder()
      .setCustomId(`mod_case_appeal_queue_status:${activeToken}:${status}`)
      .setLabel(status === 'pending' ? 'Pending' : status === 'approved' ? 'Approved' : 'Denied')
      .setStyle(normalizedStatus === status ? ButtonStyle.Primary : ButtonStyle.Secondary))
  );
  const pageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_appeal_queue:${activeToken}:${Math.max(0, page - 1)}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`mod_case_appeal_queue_status:${activeToken}:all`).setLabel('All').setStyle(normalizedStatus === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_case_appeal_queue:${activeToken}:${Math.min(totalPages - 1, page + 1)}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
  );
  const rows = [statusRow, pageRow];
  if (slice.length) rows.push(new ActionRowBuilder().addComponents(...slice.map(({ case: modCase, appeal }) => new ButtonBuilder().setCustomId(`mod_case_appeal_open:${modCase.caseId}:${appeal.id}`).setLabel(`#${modCase.caseId}`).setStyle(ButtonStyle.Primary))));
  rows.push(new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`mod_case_appeal_queue_refresh:${activeToken}:${page}`).setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`mod_case_appeal_queue_filter:${activeToken}`).setLabel('🔎 Filter').setStyle(ButtonStyle.Secondary)
));
rows.push(new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('mod_dashboard:none:analytics').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
));

  return { embeds: [embed], components: rows };
}

function getCaseIdFromModal(interaction, field = 'case_id') { const raw = interaction.fields.getTextInputValue(field).trim(); return /^\d+$/.test(raw) ? Number(raw) : null; }
function editCaseReason(guildId, caseId, reason, actorId = null) { return updateCaseReason(guildId, caseId, String(reason || '').trim(), actorId); }
function setCaseNote(guildId, caseId, note, actorId = null) {
  const value = String(note || '').trim();
  return value ? updateCaseNote(guildId, caseId, value, actorId) : clearCaseNote(guildId, caseId, actorId);
}
function getTargetIdFromCustomId(customId) { const [, targetId] = String(customId || '').split(':'); return targetId || 'none'; }

async function openExternalAppealFromCommand(interaction, rawReference) {
  const raw = String(rawReference || '').trim();
  const match = raw.match(/^(\d{16,20})\s*[:/#-]\s*(\d{1,12})$/);
  if (!match) return safeReply(interaction, { content: '❌ Use `SERVER_ID:CASE_ID`, for example `123456789012345678:42`.' });
  const guildId = match[1];
  const caseId = Number(match[2]);
  const modCase = getCaseById(guildId, caseId);
  const eligibility = getAppealEligibility(modCase, interaction.user?.id);
  if (!eligibility.ok) return safeReply(interaction, { content: `❌ ${eligibility.error}` });
  await interaction.showModal(buildExternalAppealModal(guildId, modCase));
  return true;
}
async function submitExternalAppeal(interaction, guildId, caseId, grounds, requestedResolution, source) {
  const modCase = getCaseById(guildId, caseId);
  const eligibility = getAppealEligibility(modCase, interaction.user?.id);
  if (!eligibility.ok) return safeReply(interaction, { content: `❌ ${eligibility.error}` });
  const result = submitAppeal(guildId, caseId, { appellantId: interaction.user.id, grounds, requestedResolution, source }, interaction.user.id);
  if (!result.ok) return safeReply(interaction, { content: `❌ ${result.error || 'Failed to submit appeal.'}` });
  return safeReply(interaction, { content: `✅ Appeal **${result.appeal.id}** submitted for Case **#${caseId}**.\nManagement can now review it. You will receive the outcome by DM when a decision is recorded.` });
}
async function handleExternalAppealInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (id === 'mod_appeal_lookup') {
    if (!interaction.user?.id) return false;
    await interaction.showModal(buildExternalAppealLookupModal());
    return true;
  }
  if (id.startsWith('mod_appeal_external:')) {
    const [, guildId, caseIdRaw] = id.split(':');
    const modCase = getCaseById(guildId, Number(caseIdRaw));
    const eligibility = getAppealEligibility(modCase, interaction.user?.id);
    if (!eligibility.ok) return safeReply(interaction, { content: `❌ ${eligibility.error}` });
    await interaction.showModal(buildExternalAppealModal(guildId, modCase));
    return true;
  }
  if (id.startsWith('mod_appeal_external_submit:')) {
    const [, guildId, caseIdRaw] = id.split(':');
    return submitExternalAppeal(interaction, guildId, Number(caseIdRaw), interaction.fields.getTextInputValue('grounds'), interaction.fields.getTextInputValue('requested_resolution'), interaction.guildId ? 'server' : 'dm');
  }
  if (id === 'mod_appeal_lookup_submit') {
    const guildId = String(interaction.fields.getTextInputValue('guild_id') || '').trim();
    const caseRaw = String(interaction.fields.getTextInputValue('case_id') || '').trim();
    if (!/^\d{16,20}$/.test(guildId) || !/^\d{1,12}$/.test(caseRaw)) return safeReply(interaction, { content: '❌ Server ID or Case ID is invalid.' });
    return submitExternalAppeal(interaction, guildId, Number(caseRaw), interaction.fields.getTextInputValue('grounds'), interaction.fields.getTextInputValue('requested_resolution'), interaction.guildId ? 'server-lookup' : 'dm-lookup');
  }
  return false;
}

async function openCaseTool(interaction) {
  const id = String(interaction.customId || '');
  const targetId = getTargetIdFromCustomId(id);
  if (id.startsWith('mod_case_detail:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to view case details.'));
    if (targetId === 'none') return safeReply(interaction, ephemeralError('No user selected.'));
    await interaction.showModal(buildCaseIdModal(`mod_submit_case_detail:${targetId}`, 'View Case Detail')); return true;
  }
  if (id.startsWith('mod_edit_case:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) return safeReply(interaction, ephemeralError('No permission to edit cases.'));
    if (targetId === 'none') return safeReply(interaction, ephemeralError('No user selected.'));
    await interaction.showModal(buildEditCaseModal(`mod_submit_edit_case:${targetId}`)); return true;
  }
  return false;
}

async function handleCaseAction(interaction, { fetchTarget, createConfirmation } = {}) {
  const id = String(interaction.customId || '');
  if (id.startsWith('mod_case_appeal_submit:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to record case appeals.'));
    const [, caseIdRaw] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    const eligibility = getAppealEligibility(modCase, modCase.userId);
    if (!eligibility.ok) return safeReply(interaction, ephemeralError(eligibility.error));
    await interaction.showModal(buildAppealSubmitModal(modCase));
    return true;
  }
  if (id.startsWith('mod_case_appeal_history:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to view appeals.'));
    const [, caseIdRaw, pageRaw] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    return safeReply(interaction, { ...buildAppealHistoryEmbed(modCase, pageRaw), flags: 64 });
  }
  if (id.startsWith('mod_case_appeal_queue_status:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_cases')) return safeReply(interaction, ephemeralError('No permission to filter appeals.'));
    const [, token, status] = id.split(':');
    const state = getAppealQueueState(token, interaction.guild.id);
    if (!state) return safeReply(interaction, ephemeralError('This appeal queue session expired. Open the queue again.'));
    if (!['pending', 'approved', 'denied', 'all'].includes(status)) return safeReply(interaction, ephemeralError('That appeal status filter is invalid.'));
    state.filters = { ...state.filters, status };
    state.createdAt = Date.now();
    return interaction.update(buildAppealQueuePayload(interaction.guild.id, 0, state.filters, token));
  }
  if (id.startsWith('mod_case_appeal_queue_refresh:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_cases')) return safeReply(interaction, ephemeralError('No permission to view the appeal queue.'));
    const [, token, pageRaw] = id.split(':');
    const state = getAppealQueueState(token, interaction.guild.id);
    if (!state) return safeReply(interaction, ephemeralError('This appeal queue session expired. Open the queue again.'));
    state.createdAt = Date.now();
    return interaction.update(buildAppealQueuePayload(interaction.guild.id, pageRaw, state.filters, token));
  }
  if (id.startsWith('mod_case_appeal_queue_filter:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_cases')) return safeReply(interaction, ephemeralError('No permission to filter appeals.'));
    const [, token] = id.split(':');
    const state = getAppealQueueState(token, interaction.guild.id);
    if (!state) return safeReply(interaction, ephemeralError('This appeal queue session expired. Open the queue again.'));
    await interaction.showModal(buildAppealQueueFilterModal(token));
    return true;
  }
  if (id.startsWith('mod_case_appeal_queue:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_cases')) return safeReply(interaction, ephemeralError('No permission to view the appeal queue.'));
    const parts = id.split(':');
    if (parts.length === 2 || (parts.length === 3 && /^\d+$/.test(parts[1]))) {
      const pageRaw = parts.length === 2 ? parts[1] : parts[2];
      const token = rememberAppealQueue(interaction.guild.id, { status: 'pending' });
      return safeReply(interaction, { ...buildAppealQueuePayload(interaction.guild.id, pageRaw || 0, { status: 'pending' }, token), flags: 64 });
    }
    const [, token, pageRaw] = parts;
    const state = getAppealQueueState(token, interaction.guild.id);
    if (!state) return safeReply(interaction, ephemeralError('This appeal queue session expired. Open the queue again.'));
    return safeReply(interaction, { ...buildAppealQueuePayload(interaction.guild.id, pageRaw, state.filters, token), flags: 64 });
  }
  if (id.startsWith('mod_case_appeal_open:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to review appeals.'));
    const [, caseIdRaw, appealId] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    const appeal = modCase ? getAppealById(modCase, appealId) : null;
    if (!modCase || !appeal) return safeReply(interaction, ephemeralError('Appeal could not be found.'));
    return safeReply(interaction, { ...buildAppealDetailPayload(modCase, appeal), flags: 64 });
  }
  if (id.startsWith('mod_case_appeal_retry_remedy:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) return safeReply(interaction, ephemeralError('No permission to retry appeal remedies.'));
    const [, caseIdRaw, appealId] = id.split(':');
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await retryApprovedProceedingAppealRemedy(interaction, Number(caseIdRaw), appealId, fetchTarget);
    if (!result.ok) return safeEditReply(interaction, ephemeralError(result.error || 'Failed to retry appeal remedy.'));
    return safeEditReply(interaction, { ...buildAppealDetailPayload(result.case, result.appeal), flags: 64 });
  }
  if (id.startsWith('mod_case_appeal_decide:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) return safeReply(interaction, ephemeralError('No permission to decide appeals.'));
    const [, caseIdRaw, appealId, decision] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    const appeal = modCase ? getAppealById(modCase, appealId) : null;
    if (!modCase || !appeal || appeal.status !== 'pending') return safeReply(interaction, ephemeralError('Pending appeal could not be found.'));
    await interaction.showModal(buildAppealDecisionModal(modCase, appeal, decision));
    return true;
  }
  if (id.startsWith('mod_case_note:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'add_case_note')) return safeReply(interaction, ephemeralError('No permission to add case notes.'));
    const [, caseIdRaw] = id.split(':');
    if (!/^\d+$/.test(caseIdRaw)) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    await interaction.showModal(buildCaseNoteModal(`mod_submit_case_note:${modCase.caseId}`, modCase.note || '')); return true;
  }
  if (id.startsWith('mod_search_open:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to view case details.'));
    const [, caseIdRaw] = id.split(':');
    if (!/^\d+$/.test(caseIdRaw)) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    return safeReply(interaction, { embeds: [buildCaseDetailEmbed(modCase)], components: buildCaseDetailButtons(modCase), flags: 64 });
  }
  if (id.startsWith('mod_case_reverse_warning:') || id.startsWith('mod_case_reverse_timeout:')) {
    const isWarning = id.startsWith('mod_case_reverse_warning:');
    const permission = isWarning ? 'remove_warning' : 'remove_timeout';
    if (!canUseModAction(interaction.member, interaction.guild, permission)) return safeReply(interaction, ephemeralError(isWarning ? 'No permission to reverse warnings.' : 'No permission to reverse timeouts.'));
    const [, caseIdRaw] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    const expectedAction = isWarning ? 'warn' : 'timeout';
    if (!modCase || modCase.action !== expectedAction) return safeReply(interaction, ephemeralError(isWarning ? 'Warning case could not be found.' : 'That timeout case could not be found.'));
    if (typeof fetchTarget !== 'function' || typeof createConfirmation !== 'function') return false;
    const target = await fetchTarget(interaction.guild, modCase.userId);
    if (!target) return safeReply(interaction, ephemeralError('User not found for that case.'));
    return createConfirmation(interaction, target.id, isWarning ? 'remove-warning' : 'remove-timeout', isWarning ? { caseId: modCase.caseId } : { sourceCaseId: modCase.caseId }, isWarning ? `⚠️ Reverse warning from **Case #${modCase.caseId}**?` : `⏳ Reverse timeout from **Case #${modCase.caseId}**?`);
  }
  return false;
}

function parseAppealQueueFilters(interaction) {
  const status = String(interaction.fields.getTextInputValue('status') || 'pending').trim().toLowerCase() || 'pending';
  const userId = String(interaction.fields.getTextInputValue('user_id') || '').trim();
  const caseRaw = String(interaction.fields.getTextInputValue('case_id') || '').trim();
  const moderatorId = String(interaction.fields.getTextInputValue('moderator_id') || '').trim();
  if (!['pending', 'approved', 'denied', 'all'].includes(status)) return { error: 'Status must be pending, approved, denied, or all.' };
  if (userId && !/^\d{16,20}$/.test(userId)) return { error: 'User ID is invalid.' };
  if (moderatorId && !/^\d{16,20}$/.test(moderatorId)) return { error: 'Moderator ID is invalid.' };
  if (caseRaw && !/^\d{1,12}$/.test(caseRaw)) return { error: 'Case ID is invalid.' };
  return { filters: { status, userId: userId || undefined, moderatorId: moderatorId || undefined, caseId: caseRaw ? Number(caseRaw) : undefined } };
}
async function submitCaseModal(interaction, { fetchTarget, refreshCasesDashboard } = {}) {
  const id = String(interaction.customId || '');
  if (id.startsWith('mod_submit_case_appeal_queue_filter:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_cases')) return safeReply(interaction, ephemeralError('No permission to filter appeals.'));
    const [, token] = id.split(':');
    const state = getAppealQueueState(token, interaction.guild.id);
    if (!state) return safeReply(interaction, ephemeralError('This appeal queue session expired. Open the queue again.'));
    const parsed = parseAppealQueueFilters(interaction);
    if (parsed.error) return safeReply(interaction, ephemeralError(parsed.error));
    state.filters = parsed.filters;
    state.createdAt = Date.now();
    return safeReply(interaction, { ...buildAppealQueuePayload(interaction.guild.id, 0, state.filters, token), flags: 64 });
  }
  if (id.startsWith('mod_submit_case_appeal_decision:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) return safeReply(interaction, ephemeralError('No permission to decide appeals.'));
    const [, caseIdRaw, appealId, decision] = id.split(':');
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = await resolveAppeal(interaction, Number(caseIdRaw), appealId, decision, interaction.fields.getTextInputValue('review_note'), fetchTarget);
    if (!result.ok) return safeEditReply(interaction, ephemeralError(result.error || 'Failed to decide appeal.'));
    return safeEditReply(interaction, { ...buildAppealDetailPayload(result.case, result.appeal), flags: 64 });
  }
  if (id.startsWith('mod_submit_case_appeal:')) {
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to record appeals.'));
    const [, caseIdRaw] = id.split(':');
    const modCase = getCaseById(interaction.guild.id, Number(caseIdRaw));
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
    const result = submitAppeal(interaction.guild.id, modCase.caseId, {
      appellantId: interaction.fields.getTextInputValue('appellant_id') || modCase.userId,
      grounds: interaction.fields.getTextInputValue('grounds'),
      requestedResolution: interaction.fields.getTextInputValue('requested_resolution'),
      source: 'staff-recorded',
    }, interaction.user?.id || null);
    if (!result.ok) return safeEditReply(interaction, ephemeralError(result.error || 'Failed to submit appeal.'));
    return safeEditReply(interaction, { ...buildAppealDetailPayload(result.case, result.appeal), flags: 64 });
  }
  if (id.startsWith('mod_submit_case_detail:')) {
    const targetId = getTargetIdFromCustomId(id); const caseId = getCaseIdFromModal(interaction);
    if (!caseId) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'view_case_detail')) return safeReply(interaction, ephemeralError('No permission to view case details.'));
    const modCase = getCaseById(interaction.guild.id, caseId);
    if (!modCase) return safeReply(interaction, ephemeralError('Case not found.'));
    if (targetId !== 'none' && modCase.userId !== targetId) return safeReply(interaction, ephemeralError('That case does not belong to the currently selected user.'));
    return safeReply(interaction, { embeds: [buildCaseDetailEmbed(modCase)], components: buildCaseDetailButtons(modCase), flags: 64 });
  }
  if (id.startsWith('mod_submit_edit_case:')) {
    const targetId = getTargetIdFromCustomId(id); const caseId = getCaseIdFromModal(interaction); const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!caseId) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'edit_case')) return safeReply(interaction, ephemeralError('No permission to edit cases.'));
    const existing = getCaseById(interaction.guild.id, caseId);
    if (!existing) return safeReply(interaction, ephemeralError('Case not found.'));
    if (targetId !== 'none' && existing.userId !== targetId) return safeReply(interaction, ephemeralError('That case does not belong to the currently selected user.'));
    const actorId = interaction.user?.id || null;
    const updated = editCaseReason(interaction.guild.id, caseId, reason, actorId);
    if (!updated) return safeReply(interaction, ephemeralError('Failed to update case.'));
    const target = typeof fetchTarget === 'function' ? await fetchTarget(interaction.guild, updated.userId) : null;
    await safeReply(interaction, { content: `✏️ Updated reason for **Case #${updated.caseId}**.`, flags: 64 });
    if (target && typeof refreshCasesDashboard === 'function') await refreshCasesDashboard(interaction, target);
    return true;
  }
  if (id.startsWith('mod_submit_case_note:')) {
    const [, caseIdRaw] = id.split(':');
    if (!/^\d+$/.test(caseIdRaw)) return safeReply(interaction, ephemeralError('Case ID must be a number.'));
    if (!canUseModAction(interaction.member, interaction.guild, 'add_case_note')) return safeReply(interaction, ephemeralError('No permission to add case notes.'));
    const caseId = Number(caseIdRaw); const existing = getCaseById(interaction.guild.id, caseId);
    if (!existing) return safeReply(interaction, ephemeralError('Case not found.'));
    const note = interaction.fields.getTextInputValue('note').trim(); const actorId = interaction.user?.id || null;
    const updated = setCaseNote(interaction.guild.id, caseId, note, actorId);
    if (!updated) return safeReply(interaction, ephemeralError('Failed to update case note.'));
    const target = typeof fetchTarget === 'function' ? await fetchTarget(interaction.guild, updated.userId) : null;
    await safeReply(interaction, { content: note ? `📝 Updated note for **Case #${updated.caseId}**.` : `🗑️ Cleared note for **Case #${updated.caseId}**.`, flags: 64 });
    if (target && typeof refreshCasesDashboard === 'function') await refreshCasesDashboard(interaction, target);
    return true;
  }
  return false;
}

function getBulkActionProgressEmbed({ actionLabel, total, processed, successCount, failCount }) { return createEmbed({ title: `${EMOJIS.SETTINGS} ${EMOJIS.BULK} ${actionLabel} Progress`, description: `${EMOJIS.FIRE} Bulk moderation is currently running...`, color: COLORS.PRIMARY, fields: [{ name: '📦 Processed', value: `${processed}/${total}`, inline: true }, { name: `${EMOJIS.SUCCESS} Success`, value: String(successCount), inline: true }, { name: `${EMOJIS.ERROR} Failed`, value: String(failCount), inline: true }] }); }
function getBulkActionSummaryEmbed({ actionLabel, total, success, failed }) { return createEmbed({ title: failed.length ? `${EMOJIS.WARNING} ${EMOJIS.BULK} ${actionLabel} Complete` : `${EMOJIS.SUCCESS} ${EMOJIS.BULK} ${actionLabel} Complete`, color: failed.length ? COLORS.ERROR : COLORS.SUCCESS, fields: [{ name: '🎯 Total Targets', value: String(total), inline: true }, { name: `${EMOJIS.SUCCESS} Successful`, value: String(success.length), inline: true }, { name: `${EMOJIS.ERROR} Failed`, value: String(failed.length), inline: true }, { name: `${EMOJIS.SUCCESS} Successes`, value: success.length ? success.join('\n').slice(0, 1024) : 'None' }, { name: `${EMOJIS.ERROR} Failures`, value: failed.length ? failed.join('\n').slice(0, 1024) : 'None' }] }); }

module.exports = {
  getStatusLabel,
  formatCaseSummary,
  buildCaseFilterButtons,
  buildCasesPageButtons,
  buildCaseDetailButtons,
  openCaseTool,
  handleCaseAction,
  submitCaseModal,
  getBulkActionProgressEmbed,
  getBulkActionSummaryEmbed,
  getCaseAppeals,
  getPendingAppeals,
  getAppealEligibility,
  submitAppeal,
  handleExternalAppealInteraction,
  openExternalAppealFromCommand,
};