'use strict';

const {
  QUARANTINE_MODES,
  getQuarantineState,
  saveQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
  normalizeArchivedRooms,
  normalizePendingRoomCleanups,
} = require('./state');
const { ensureQuarantineRole } = require('./roleManager');
const {
  restoreMemberViewAllows,
  recontainMemberViewAllows,
  verifyMemberContainment,
} = require('./isolation');
const { getRestorableRoleIds } = require('./memberLifecycle');

async function reconcileVerificationRelease(guild, member, options = {}) {
  try {
    const verificationQuarantine = require('../../../../modules/securityStudio/verificationQuarantine');
    if (typeof verificationQuarantine?.reconcileModerationRelease !== 'function') return null;
    return await verificationQuarantine.reconcileModerationRelease(
      guild,
      member.id,
      options.restoredBy || options.closedBy || null,
      options.reason || 'Moderation isolation cleared'
    );
  } catch (error) {
    console.warn(`[QuarantineSystem] Verification release reconciliation failed for ${member?.id || 'unknown'}: ${error?.message || error}`);
    return { ok: false, message: error?.message || 'Verification reconciliation failed.' };
  }
}

async function archiveInvestigationRoom(guild, snapshot, options = {}) {
  const channelId = snapshot?.interviewChannelId || snapshot?.previousInterviewChannelId || snapshot?.channelId || null;
  if (!channelId) return { success: true, archived: false, reason: 'No investigation room.' };
  let channel = guild.channels.cache.get(String(channelId));
  if (!channel) channel = await guild.channels.fetch(String(channelId)).catch(() => null);
  if (!channel) return { success: true, archived: false, missing: true, channelId: String(channelId) };
  try {
    await channel.send({ content: `🔓 Investigation containment closed${snapshot.caseId ? ` • Case #${snapshot.caseId}` : ''}. The member's previous manageable roles have been restored.`, allowedMentions: { parse: [] } }).catch(() => null);
    if (snapshot.memberId && channel.permissionOverwrites?.edit) await channel.permissionOverwrites.edit(String(snapshot.memberId), { ViewChannel: false }, { reason: options.reason || 'Investigation isolation closed' });
    const closedName = `closed-investigation-${String(snapshot.memberId || 'member').slice(-6)}-${Math.floor(Date.now() / 1000).toString(36)}`.slice(0, 100);
    await channel.setName(closedName, options.reason || 'Investigation isolation closed').catch(() => null);
    await channel.setTopic(`Closed Goliath investigation isolation • Member ${snapshot.memberId || 'unknown'}${snapshot.caseId ? ` • Case #${snapshot.caseId}` : ''}`, options.reason || 'Investigation isolation closed').catch(() => null);
    const state = getQuarantineState(guild.id);
    state.archivedRooms = normalizeArchivedRooms([...(state.archivedRooms || []), { channelId: channel.id, memberId: snapshot.memberId || null, caseId: snapshot.caseId || null, closedAt: Date.now(), closedBy: options.restoredBy || options.closedBy || null }]);
    saveQuarantineState(guild, state);
    return { success: true, archived: true, channelId: channel.id };
  } catch (error) { return { success: false, archived: false, channelId: channel.id, error: error.message }; }
}

function queueInvestigationRoomCleanup(guild, snapshot, archive) {
  const channelId = String(archive?.channelId || snapshot?.interviewChannelId || snapshot?.previousInterviewChannelId || '').trim();
  if (!channelId) return false;
  const latest = getQuarantineState(guild.id);
  latest.pendingRoomCleanups = normalizePendingRoomCleanups([...(latest.pendingRoomCleanups || []), { channelId, memberId: snapshot?.memberId || null, caseId: snapshot?.caseId || null, queuedAt: Date.now(), lastError: archive?.error || 'Investigation room archival failed.' }]);
  saveQuarantineState(guild, latest);
  return true;
}

async function retryPendingInvestigationRoomCleanups(guild, options = {}) {
  if (!guild) return { checked: 0, archived: 0, failed: 0 };
  const initial = getQuarantineState(guild.id);
  const pending = normalizePendingRoomCleanups(initial.pendingRoomCleanups);
  const result = { checked: pending.length, archived: 0, failed: 0 };
  for (const cleanup of pending) {
    const archive = await archiveInvestigationRoom(guild, cleanup, { ...options, system: true, reason: options.reason || 'Retrying investigation room cleanup' });
    const latest = getQuarantineState(guild.id);
    if (archive?.success === false) {
      result.failed += 1;
      latest.pendingRoomCleanups = normalizePendingRoomCleanups((latest.pendingRoomCleanups || []).map((entry) => String(entry.channelId) === String(cleanup.channelId) ? { ...entry, lastError: archive.error || entry.lastError } : entry));
    } else {
      result.archived += 1;
      latest.pendingRoomCleanups = normalizePendingRoomCleanups((latest.pendingRoomCleanups || []).filter((entry) => String(entry.channelId) !== String(cleanup.channelId)));
    }
    saveQuarantineState(guild, latest);
  }
  if (result.checked) emitCurrentQuarantineState(guild, 'investigation_room_cleanup_retry', result);
  return result;
}

async function restoreQuarantinedMember(guild, member, options = {}) {
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const state = getQuarantineState(guild.id);
  const snapshot = state.users?.[member.id];
  if (!snapshot) return { success: false, reason: 'No quarantine snapshot' };
  const mode = getQuarantineMode(snapshot);
  if (mode === QUARANTINE_MODES.SECURITY && options.system !== true && String(options.restoredBy || '') !== String(guild.ownerId || '')) return { success: false, mode, reason: 'Full Security Isolation can only be cleared manually by the server owner.' };
  try {
    const quarantineRoleId = state.roleId || null;
    const roles = await getRestorableRoleIds(guild, snapshot.roles, quarantineRoleId);
    await member.roles.set(roles.restored, options.reason || 'Restoring quarantined member');
    const memberAccess = await restoreMemberViewAllows(guild, member.id, snapshot.memberViewAllowRestores, options);
    if (memberAccess.failed.length) {
      const recontained = await recontainMemberViewAllows(guild, member.id, memberAccess.restored, { reason: 'Rollback after incomplete quarantine release' });
      let quarantineRole = quarantineRoleId ? guild.roles.cache.get(String(quarantineRoleId)) : null;
      if (!quarantineRole?.editable) quarantineRole = await ensureQuarantineRole(guild, options).catch(() => null);
      const roleRollback = quarantineRole ? await member.roles.set([quarantineRole.id], 'Rollback after incomplete quarantine release').then(() => ({ success: true })).catch((error) => ({ success: false, error: String(error?.message || error) })) : { success: false, error: 'Quarantine role was unavailable for rollback.' };
      const rollbackVerification = quarantineRole ? await verifyMemberContainment(guild, member, mode === QUARANTINE_MODES.INVESTIGATION && snapshot.interviewChannelId ? [snapshot.interviewChannelId] : []) : { success: false, leaks: [] };
      return { success: false, mode, reason: 'Pre-quarantine channel access could not be fully restored. Goliath re-contained the member and kept the quarantine snapshot for a safe retry.', memberAccess, rollback: { recontained, roleRollback, verification: rollbackVerification } };
    }
    const shouldArchive = Boolean(snapshot.interviewChannelId || snapshot.previousInterviewChannelId);
    const archive = shouldArchive ? await archiveInvestigationRoom(guild, snapshot, options) : { success: true, archived: false };
    if (archive?.success === false) queueInvestigationRoomCleanup(guild, snapshot, archive);
    const latest = getQuarantineState(guild.id);
    delete latest.users[member.id];
    saveQuarantineState(guild, latest);
    const verification = await reconcileVerificationRelease(guild, member, options);
    emitCurrentQuarantineState(guild, 'member_restored', { memberId: member.id, mode, restoredRoles: roles.restored.length, skippedRoles: roles.skipped, archive, cleanupPending: archive?.success === false, restoredMemberChannelAllows: memberAccess.restored.length, verificationReconciled: verification?.reconciled === true });
    return { success: true, mode, restoredRoles: roles.restored.length, restoredRoleIds: roles.restored, skippedRoles: roles.skipped, memberAccess, archive, cleanupPending: archive?.success === false, verification };
  } catch (error) { return { success: false, mode, error: error.message }; }
}

async function clearExpiredAbsentMember(guild, userId, state) {
  const snapshot = state.users?.[userId];
  if (!snapshot) return { success: true, cleared: false, reason: 'No quarantine snapshot.' };
  const memberAccess = await restoreMemberViewAllows(guild, userId, snapshot.memberViewAllowRestores, { reason: 'Restoring pre-quarantine channel access for expired absent member', system: true });
  if (memberAccess.failed.length) return { success: false, cleared: false, reason: 'Could not restore all persistent member channel overwrites; snapshot retained for retry.', memberAccess };
  const shouldArchive = Boolean(snapshot.interviewChannelId || snapshot.previousInterviewChannelId);
  const archive = shouldArchive ? await archiveInvestigationRoom(guild, snapshot, { reason: 'Automatic quarantine expiry while member absent', system: true }) : { success: true, archived: false };
  if (archive?.success === false) return { success: false, cleared: false, reason: 'Could not archive the investigation room; snapshot retained for retry.', memberAccess, archive };
  const latest = getQuarantineState(guild.id);
  delete latest.users[userId];
  saveQuarantineState(guild, latest);
  emitCurrentQuarantineState(guild, 'member_quarantine_expired_absent', { memberId: userId, mode: getQuarantineMode(snapshot) });
  return { success: true, cleared: true, memberAccess, archive };
}

module.exports = { archiveInvestigationRoom, retryPendingInvestigationRoomCleanups, restoreQuarantinedMember, clearExpiredAbsentMember };
