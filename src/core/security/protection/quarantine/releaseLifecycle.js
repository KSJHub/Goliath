'use strict';

const {
  QUARANTINE_MODES,
  getQuarantineState,
  saveQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
  isAutomaticQuarantineReleaseDue,
  hasOriginalQuarantineRoles,
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

// Remove only the exact member deny that this system added to another active
// investigation room. Other manually configured overwrites remain untouched.
async function cleanupReleasedInvitationDenies(guild, onlyMemberId = null, options = {}) {
  const state = getQuarantineState(guild.id);
  const targets = new Set();
  for (const snapshot of Object.values(state.users || {})) for (const id of snapshot.protectedInvitationMembers || []) if (!onlyMemberId || id === onlyMemberId) targets.add(id);
  if (!targets.size) return { cleaned: 0, failed: 0 };
  let sessions;
  try { sessions = require('../../../../modules/securityStudio/verificationStore').getVerificationSection(guild.id)?.sessions || {}; }
  catch (error) { return { cleaned: 0, failed: targets.size }; }
  let cleaned = 0, failed = 0;
  for (const memberId of targets) {
    const acquired = options.operationHeld === true || tryBeginQuarantineOperation(guild.id, memberId);
    if (!acquired) continue;
    try {
    if (getQuarantineState(guild.id).users?.[memberId] || sessions[memberId]?.state === 'quarantined'
      || (sessions[memberId]?.state === 'review' && sessions[memberId]?.quarantineChannelId)) continue;
    for (const [ownerId, snapshot] of Object.entries(getQuarantineState(guild.id).users || {})) {
      if (!snapshot.protectedInvitationMembers?.includes(memberId) || !snapshot.interviewChannelId) continue;
      try {
        let channel;
        try { channel = await guild.channels.fetch(snapshot.interviewChannelId, { force: true }); }
        catch (error) { if (Number(error?.code) !== 10003) throw error; }
        if (channel && !channel.permissionOverwrites?.cache) throw Error('Room permission overwrites are unavailable.');
        const overwrite = channel?.permissionOverwrites?.cache?.get(memberId);
        if (overwrite && (overwrite.allow?.bitfield == null || overwrite.deny?.bitfield == null)) throw Error('Room permission overwrite could not be verified.');
        if (overwrite && BigInt(overwrite.allow?.bitfield ?? -1) === 0n && BigInt(overwrite.deny?.bitfield ?? -1) === require('discord.js').PermissionFlagsBits.ViewChannel) {
          await channel.permissionOverwrites.delete(memberId, 'Remove temporary isolation deny after authorised release');
        }
        const latest = getQuarantineState(guild.id);
        const owner = latest.users?.[ownerId];
        if (owner?.interviewChannelId === snapshot.interviewChannelId) {
          owner.protectedInvitationMembers = (owner.protectedInvitationMembers || []).filter(id => id !== memberId);
          saveQuarantineState(guild, latest);
        }
        cleaned++;
      } catch (error) { failed++; console.warn('[QuarantineSystem] Could not remove temporary investigation deny:', error.message); }
    }
    } finally { if (!options.operationHeld) endQuarantineOperation(guild.id, memberId); }
  }
  return { cleaned, failed };
}

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
  const otherOwner = Object.entries(getQuarantineState(guild.id).users || {}).some(([userId, active]) => String(userId) !== String(snapshot?.memberId || '') && String(active?.interviewChannelId || '') === String(channelId));
  if (otherOwner) return { success: false, archived: false, channelId: String(channelId), error: 'Investigation room is still assigned to another active case; manual review required.' };
  let channel = guild.channels.cache.get(String(channelId));
  if (!channel) {
    try { channel = await guild.channels.fetch(String(channelId)); }
    catch (error) { if (Number(error?.code) !== 10003) return { success: false, archived: false, channelId: String(channelId), error: String(error?.message || error) }; }
  }
  if (!channel) return { success: true, archived: false, missing: true, channelId: String(channelId) };
  try {
    const { buildMemberNotice, COLORS } = require('../../../ui/memberNotice');
    const notice = buildMemberNotice(guild, {
      module: 'Moderation', emoji: '🔓', title: 'Investigation Closed', color: COLORS.success,
      description: 'Your investigation has ended, and your quarantine restrictions have been lifted.\n\nIf you need any further help, please contact server management.',
      fields: snapshot.caseId ? [{ name: '📁 Case reference', value: `#${snapshot.caseId}`, inline: true }] : [],
      compactModerationLayout: true,
    });
    notice.embeds[0].setFooter({ text: 'Private Moderation Review' });
    const closureMessage = await channel.send(notice).catch(() => null);
    if (snapshot.memberId && channel.permissionOverwrites?.edit) await channel.permissionOverwrites.edit(String(snapshot.memberId), { ViewChannel: false }, { reason: options.reason || 'Investigation isolation closed' });
    const { cleanChannelName } = require('./investigationRooms');
    const legacySuffix = `-${String(snapshot.memberId || '').slice(-4)}`;
    const roomName = /^investigation-[a-z0-9-]+$/.test(channel.name || '') && channel.name.endsWith(legacySuffix)
      ? channel.name.slice('investigation-'.length, -legacySuffix.length) : channel.name;
    const closedName = `closed-${cleanChannelName(roomName || snapshot.memberTag || 'member').replace(/^closed-/, '')}`;
    await channel.setName(closedName, options.reason || 'Investigation isolation closed').catch(() => null);
    await channel.setTopic(`Closed investigation • Member ${snapshot.memberId || 'unknown'}${snapshot.caseId ? ` • Case #${snapshot.caseId}` : ''}`, options.reason || 'Investigation isolation closed').catch(() => null);
    const state = getQuarantineState(guild.id);
    state.archivedRooms = normalizeArchivedRooms([...(state.archivedRooms || []), { channelId: channel.id, memberId: snapshot.memberId || null, caseId: snapshot.caseId || null, closureMessageId: closureMessage?.id || null, closedAt: Date.now(), closedBy: options.restoredBy || options.closedBy || null, roomTranscript: snapshot.roomTranscript || null }]);
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

// Share the release guard with recovery so role/overwrite mutations cannot race.
const releasesInProgress = new Set();
function tryBeginQuarantineOperation(guildId, memberId) {
  const key = `${guildId}:${memberId}`;
  if (releasesInProgress.has(key)) return false;
  releasesInProgress.add(key);
  return true;
}
function endQuarantineOperation(guildId, memberId) { releasesInProgress.delete(`${guildId}:${memberId}`); }
function isQuarantineReleaseInProgress(guildId, memberId) {
  return releasesInProgress.has(`${guildId}:${memberId}`);
}

function hasOtherActiveRoomOwner(guild, memberId, snapshot) {
  const roomIds = new Set([snapshot.interviewChannelId, snapshot.previousInterviewChannelId].filter(Boolean).map(String));
  return roomIds.size > 0 && Object.entries(getQuarantineState(guild.id).users || {}).some(([userId, active]) =>
    String(userId) !== String(memberId) && [active?.interviewChannelId, active?.previousInterviewChannelId].some(id => id && roomIds.has(String(id))));
}

async function restoreQuarantinedMember(guild, member, options = {}) {
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const state = getQuarantineState(guild.id);
  const snapshot = state.users?.[member.id];
  if (!snapshot) return { success: false, reason: 'No quarantine snapshot' };
  if (!Array.isArray(snapshot.roles) || !hasOriginalQuarantineRoles(snapshot)) return { success: false, reason: 'Original role snapshot is missing; manual review required before release.' };
  if (snapshot.allowedChannelIds?.length) return { success: false, needsReview: true, reason: 'Legacy additional channel access must be reconciled before release.' };
  const mode = getQuarantineMode(snapshot);
  if (mode === QUARANTINE_MODES.SECURITY && options.system !== true && String(options.restoredBy || '') !== String(guild.ownerId || '')) return { success: false, mode, reason: 'Full Security Isolation can only be cleared manually by the server owner.' };
  const releaseKey = `${guild.id}:${member.id}`;
  if (!tryBeginQuarantineOperation(guild.id, member.id)) return { success: false, busy: true, reason: 'Quarantine operation already in progress.' };
  try {
    // A shared room is not yet supported by the release/archival transaction.
    // Refuse before restoring roles or channel access, keeping both snapshots.
    if (hasOtherActiveRoomOwner(guild, member.id, snapshot)) {
      return { success: false, needsReview: true, reason: 'Another active case uses this investigation room; manual review is required before release.' };
    }
    const quarantineRoleId = state.roleId || null;
    const roles = await getRestorableRoleIds(guild, snapshot.roles, quarantineRoleId);
    const blockedRoles = roles.skipped.filter(entry => entry.reason === 'missing_manage_roles' || entry.reason === 'role_hierarchy');
    if (blockedRoles.length) return { success: false, mode, reason: 'Cannot restore all manageable original roles; review bot permissions and role hierarchy before release.', blockedRoles };
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
    if (snapshot.caseId) {
      try {
        const { getCaseById, updateCaseStatus } = require('../../../administration/mod/storage');
        const record = getCaseById(guild.id, snapshot.caseId);
        if (record && String(record.userId) === String(member.id) && String(record.action) === 'quarantine' && String(record.status) === 'active') {
          updateCaseStatus(guild.id, snapshot.caseId, 'closed', options.restoredBy || options.closedBy || guild.client?.user?.id || null);
        }
      } catch (caseError) {
        console.error('[QuarantineSystem] Failed to close linked restriction case:', caseError);
      }
    }
    const verification = await reconcileVerificationRelease(guild, member, options);
    const invitationCleanup = await cleanupReleasedInvitationDenies(guild, member.id, { operationHeld: true });
    emitCurrentQuarantineState(guild, 'member_restored', { memberId: member.id, mode, restoredRoles: roles.restored.length, skippedRoles: roles.skipped, archive, cleanupPending: archive?.success === false, restoredMemberChannelAllows: memberAccess.restored.length, invitationCleanup, verificationReconciled: verification?.reconciled === true });
    return { success: true, mode, restoredRoles: roles.restored.length, restoredRoleIds: roles.restored, skippedRoles: roles.skipped, memberAccess, archive, cleanupPending: archive?.success === false, invitationCleanup, verification };
  } catch (error) { return { success: false, mode, error: error.message }; }
  finally { releasesInProgress.delete(releaseKey); }
}

async function clearExpiredAbsentMember(guild, userId, state) {
  const snapshot = state.users?.[userId];
  if (!snapshot) return { success: true, cleared: false, reason: 'No quarantine snapshot.' };
  if (!isAutomaticQuarantineReleaseDue(snapshot) || !hasOriginalQuarantineRoles(snapshot) || snapshot.allowedChannelIds?.length) return { success: false, cleared: false, reason: 'Automatic release is not authorised or original roles are missing; snapshot retained.' };
  if (hasOtherActiveRoomOwner(guild, userId, snapshot)) return { success: false, cleared: false, needsReview: true, reason: 'Another active case uses this investigation room; manual review is required before release.' };
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

module.exports = { cleanupReleasedInvitationDenies, tryBeginQuarantineOperation, endQuarantineOperation, isQuarantineReleaseInProgress, archiveInvestigationRoom, retryPendingInvestigationRoomCleanups, restoreQuarantinedMember, clearExpiredAbsentMember };
