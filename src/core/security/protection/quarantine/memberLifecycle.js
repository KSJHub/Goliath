'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { shouldBlockOwnerDestructiveAction } = require('../../../../owner/dev/DevOverrideManager');
const { canManageTargetMember } = require('../core');
const {
  QUARANTINE_MODES,
  getQuarantineState,
  saveQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
} = require('./state');
const { ensureQuarantineRole } = require('./roleManager');
const {
  syncQuarantineIsolation,
  verifyMemberContainment,
  restoreMemberViewAllows,
} = require('./isolation');
const { createInvestigationRoom } = require('./investigationRooms');

function resolveRequestedMode(options = {}) {
  const requested = String(options.mode || '').trim().toLowerCase();
  if (requested === QUARANTINE_MODES.SECURITY) return QUARANTINE_MODES.SECURITY;
  if (requested === QUARANTINE_MODES.INVESTIGATION) return QUARANTINE_MODES.INVESTIGATION;
  if (String(options.source || '').toLowerCase() === 'anti_nuke' || String(options.quarantinedBy || '').toLowerCase() === 'anti_nuke') return QUARANTINE_MODES.SECURITY;
  return QUARANTINE_MODES.INVESTIGATION;
}

function isAutomatedSecurityRequest(options = {}) {
  return options.system === true
    || String(options.source || '').toLowerCase() === 'anti_nuke'
    || String(options.quarantinedBy || '').toLowerCase() === 'anti_nuke';
}

function canManuallyUseSecurityIsolation(guild, options = {}) {
  if (isAutomatedSecurityRequest(options)) return true;
  return Boolean(guild?.ownerId && options.quarantinedBy && String(guild.ownerId) === String(options.quarantinedBy));
}

function createQuarantineDryRunResult(guild, member, options = {}) {
  const snapshotRoles = member.roles.cache.filter((role) => role.id !== guild.id).map((role) => role.id);
  const mode = resolveRequestedMode(options);
  emitCurrentQuarantineState(guild, 'member_quarantine_dry_run', { memberId: member.id, mode, testMode: true, dryRun: true });
  console.log(`[TEST MODE] Quarantine prevented for owner ${member.user?.tag || member.id} in guild ${guild.id}`);
  return { success: true, testMode: true, dryRun: true, action: 'quarantine', executed: false, mode, roleId: null, interviewChannelId: null, snapshotRoles, memberId: member.id, memberTag: member.user?.tag || null, reason: options.reason || 'Development test override prevented owner quarantine.' };
}

async function getRestorableRoleIds(guild, snapshotRoleIds = [], quarantineRoleId = null) {
  await guild.roles.fetch().catch(() => null);
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  const botHighest = Number(botMember?.roles?.highest?.position || 0);
  const restored = [];
  const skipped = [];
  for (const roleId of [...new Set((snapshotRoleIds || []).map(String))]) {
    const role = guild.roles.cache.get(roleId);
    if (!role) { skipped.push({ roleId, reason: 'role_missing' }); continue; }
    if (role.id === guild.id || role.id === quarantineRoleId) continue;
    if (role.managed) { skipped.push({ roleId, roleName: role.name, reason: 'managed_role' }); continue; }
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) { skipped.push({ roleId, roleName: role.name, reason: 'missing_manage_roles' }); continue; }
    if (Number(role.position || 0) >= botHighest) { skipped.push({ roleId, roleName: role.name, reason: 'role_hierarchy' }); continue; }
    restored.push(role.id);
  }
  return { restored, skipped };
}

async function escalateInvestigationToSecurity(guild, member, existing, options = {}) {
  const lifecycle = existing.investigationGroupId ? require('./releaseLifecycle') : null;
  const groupLock = existing.investigationGroupId ? `investigation-group:${existing.investigationGroupId}` : null;
  if (groupLock && !lifecycle.tryBeginQuarantineOperation(guild.id, groupLock)) return { success: false, busy: true, reason: 'This investigation is being updated.' };
  if (groupLock && !lifecycle.tryBeginQuarantineOperation(guild.id, member.id)) { lifecycle.endQuarantineOperation(guild.id, groupLock); return { success: false, busy: true, reason: 'This member is being updated.' }; }
  const state = getQuarantineState(guild.id);
  try {
    let interviewChannel = existing.interviewChannelId ? guild.channels.cache.get(String(existing.interviewChannelId)) : null;
    if (!interviewChannel && existing.interviewChannelId) interviewChannel = await guild.channels.fetch(String(existing.interviewChannelId)).catch(() => null);
    if (interviewChannel?.permissionOverwrites?.edit) {
      await interviewChannel.permissionOverwrites.edit(member.id, { ViewChannel: false }, { reason: 'Investigation escalated to full Security Isolation' });
      await interviewChannel.send({ content: '🚨 This investigation hold has been escalated to **Full Security Isolation**. Member access to this room has been revoked.', allowedMentions: { parse: [] } }).catch(() => null);
    }
    state.users[member.id] = {
      ...existing,
      mode: QUARANTINE_MODES.SECURITY,
      reason: options.reason || existing.reason || 'Security isolation escalation',
      source: options.source || existing.source || 'security',
      quarantinedBy: options.quarantinedBy || existing.quarantinedBy || null,
      securityEscalatedAt: Date.now(),
      interviewChannelId: null,
      previousInterviewChannelId: existing.interviewChannelId || null,
      expiresAt: options.durationMs && Number(options.durationMs) > 0 ? Date.now() + Number(options.durationMs) : existing.expiresAt || null,
    };
    saveQuarantineState(guild, state);
    emitCurrentQuarantineState(guild, 'member_quarantine_escalated', { memberId: member.id, mode: QUARANTINE_MODES.SECURITY });
    return { success: true, escalated: true, mode: QUARANTINE_MODES.SECURITY, roleId: state.roleId, interviewChannelId: null };
  } catch (error) { return { success: false, error: error.message }; }
  finally { if (groupLock) { lifecycle.endQuarantineOperation(guild.id, member.id); lifecycle.endQuarantineOperation(guild.id, groupLock); } }
}

async function quarantineMember(guild, member, options = {}) {
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const mode = resolveRequestedMode(options);
  if (mode === QUARANTINE_MODES.SECURITY && !canManuallyUseSecurityIsolation(guild, options)) return { success: false, reason: 'Full Security Isolation can only be applied manually by the server owner.' };
  if (shouldBlockOwnerDestructiveAction({ guild, member, action: 'quarantine' })) return createQuarantineDryRunResult(guild, member, { ...options, mode });
  const manageCheck = canManageTargetMember(guild, member);
  if (!manageCheck.allowed) return { success: false, reason: manageCheck.reason || 'Target cannot be managed by Goliath.' };

  const existing = getQuarantineState(guild.id).users?.[member.id];
  if (existing) {
    const existingMode = getQuarantineMode(existing);
    if (existingMode === QUARANTINE_MODES.INVESTIGATION && mode === QUARANTINE_MODES.SECURITY) return escalateInvestigationToSecurity(guild, member, existing, options);
    // A repeated request can safely repair an orphaned case link after a prior
    // persistence failure, without applying roles or creating another room.
    if (!existing.caseId && existing.interviewChannelId) {
      try {
        const { getCasesForUser } = require('../../../administration/mod/storage');
        const matching = (getCasesForUser(guild.id, member.id) || []).find(record =>
          String(record.action) === 'quarantine' &&
          String(record.status) === 'active' &&
          String(record.metadata?.interviewChannelId || '') === String(existing.interviewChannelId));
        if (matching) attachQuarantineCase(guild, member.id, matching.caseId);
      } catch (error) {
        console.warn('[QuarantineSystem] Could not reconcile existing investigation case:', error);
      }
    }
    return { success: false, alreadyQuarantined: true, mode: existingMode, reason: 'Member is already quarantined.' };
  }

  const { tryBeginQuarantineOperation, endQuarantineOperation } = require('./releaseLifecycle');
  if (!tryBeginQuarantineOperation(guild.id, member.id)) return { success: false, busy: true, reason: 'Quarantine operation already in progress.' };
  let interviewRoom = null; let snapshotRoles = []; let snapshotCaptured = false; let rolesAttempted = false; let isolation = null; let quarantineRole = null;
  const protectedLocks = [];
  try {
    if (mode === QUARANTINE_MODES.INVESTIGATION && options.invitationSelection === true) {
      const { getOtherIsolatedMemberIds } = require('./investigationRooms');
      const otherCases = options.invitedRoleIds?.length ? getOtherIsolatedMemberIds(guild.id, member.id) : [];
      const ids = [...new Set([...(options.invitedUserIds || []), ...otherCases])].filter(id => id !== member.id);
      for (const id of ids) {
        if (!tryBeginQuarantineOperation(guild.id, id)) throw new Error('A selected member or another investigation is being updated. Please try again shortly.');
        protectedLocks.push(id);
      }
      options = { ...options, protectedCaseIds: protectedLocks };
    }
    quarantineRole = await ensureQuarantineRole(guild, options);
    isolation = await syncQuarantineIsolation(guild, { ...options, role: quarantineRole, targetMemberId: member.id });
    if (!isolation.success) return { success: false, mode, reason: `Quarantine isolation could not be guaranteed: ${isolation.reason || `${isolation.failed} channel(s) failed`}`, isolation };
    snapshotRoles = member.roles.cache.filter((entry) => entry.id !== guild.id && entry.id !== quarantineRole.id).map((entry) => entry.id);
    snapshotCaptured = true;
    if (mode === QUARANTINE_MODES.INVESTIGATION) interviewRoom = await createInvestigationRoom(guild, member, quarantineRole, options).catch((error) => { throw new Error(`Investigation room could not be created: ${error.message}`); });
    rolesAttempted = true;
    await member.roles.set([quarantineRole.id], options.reason || 'Goliath quarantine applied.');
    const verification = await verifyMemberContainment(guild, member, mode === QUARANTINE_MODES.INVESTIGATION && interviewRoom ? [interviewRoom.id] : []);
    if (!verification.success) throw new Error(`Containment verification failed: ${verification.leaks.length} channel(s) remain visible (${verification.leaks.slice(0, 3).map((entry) => entry.channelName || entry.channelId).join(', ')}).`);
    const state = getQuarantineState(guild.id);
    state.roleId = quarantineRole.id; state.roleName = quarantineRole.name;
    state.users[member.id] = { memberId: member.id, memberTag: member.user?.tag || null, mode, quarantinedAt: Date.now(), reason: options.reason || 'No reason provided', roles: snapshotRoles, memberViewAllowRestores: isolation.memberViewAllowRestores || [], quarantinedBy: options.quarantinedBy || null, source: options.source || (options.quarantinedBy === 'anti_nuke' ? 'anti_nuke' : 'moderation'), caseId: options.caseId || null, interviewChannelId: interviewRoom?.id || null, ...(options.invitationSelection === true ? { invitationSelection: true, invitedUserIds: [...new Set(options.invitedUserIds || [])], invitedRoleIds: [...new Set(options.invitedRoleIds || [])], protectedInvitationMembers: interviewRoom?.__protectedInvestigationMembers || [] } : {}), autoRelease: options.autoRelease === true && isAutomatedSecurityRequest(options), expiresAt: options.durationMs && Number(options.durationMs) > 0 ? Date.now() + Number(options.durationMs) : null };
    saveQuarantineState(guild, state);
    // Link to an existing case before creating another. A room ID identifies the
    // investigation across retries; a member can have unrelated historical cases.
    try {
      const { createCase, getCaseById, getCasesForUser } = require('../../../administration/mod/storage');
      const snapshot = getQuarantineState(guild.id).users[member.id];
      const linked = snapshot.caseId ? getCaseById(guild.id, snapshot.caseId) : null;
      const validLinked = linked && String(linked.userId) === String(member.id);
      const matching = !validLinked && snapshot.interviewChannelId
        ? (getCasesForUser(guild.id, member.id) || []).find(record =>
          String(record.action) === 'quarantine' &&
          String(record.status) === 'active' &&
          String(record.metadata?.interviewChannelId || '') === String(snapshot.interviewChannelId))
        : null;
      if (validLinked || matching) {
        if (Number(snapshot.caseId) !== Number((linked || matching).caseId)) attachQuarantineCase(guild, member.id, (linked || matching).caseId);
      } else {
        const record = createCase({
          guildId: guild.id, userId: member.id,
          moderatorId: /^\d{16,20}$/.test(String(options.quarantinedBy || '')) ? String(options.quarantinedBy) : guild.client.user.id,
          action: 'quarantine', reason: String(options.reason || 'Account restriction applied').slice(0, 1500),
          metadata: { source: 'quarantine', mode, interviewChannelId: interviewRoom?.id || null },
          status: 'active',
        });
        if (record?.caseId) attachQuarantineCase(guild, member.id, record.caseId);
      }
    } catch (caseError) {
      console.error('[QuarantineSystem] Failed to link moderation case:', caseError);
    }
    emitCurrentQuarantineState(guild, 'member_quarantined', { memberId: member.id, mode, interviewChannelId: interviewRoom?.id || null });
    return { success: true, mode, roleId: quarantineRole.id, interviewChannelId: interviewRoom?.id || null, snapshotRoles, isolation, verification };
  } catch (error) {
    const rollback = { roles: null, memberAccess: null, roomDeleted: false };
    if (snapshotCaptured && rolesAttempted && quarantineRole) {
      const manageable = await getRestorableRoleIds(guild, snapshotRoles, quarantineRole.id);
      rollback.roles = await member.roles.set(manageable.restored, 'Rolling back failed quarantine transaction').then(() => ({ success: true, restored: manageable.restored, skipped: manageable.skipped })).catch((roleError) => ({ success: false, error: String(roleError?.message || roleError), skipped: manageable.skipped }));
    }
    if (interviewRoom) rollback.roomDeleted = await interviewRoom.delete('Rolling back failed investigation isolation').then(() => true).catch(() => false);
    if (isolation?.memberViewAllowRestores?.length) rollback.memberAccess = await restoreMemberViewAllows(guild, member.id, isolation.memberViewAllowRestores, { reason: 'Rolling back failed quarantine transaction' });
    return { success: false, mode, error: error.message, rollback };
  } finally { for (const id of protectedLocks) endQuarantineOperation(guild.id, id); endQuarantineOperation(guild.id, member.id); }
}

// New investigations only: all subjects are selected explicitly, never inferred
// from invited roles. Persist every original snapshot before the first role write.
async function quarantineInvestigationMembers(guild, memberIds, options = {}) {
  const ids = [...new Set(memberIds || [])];
  if (ids.length < 2 || ids.length > 6 || !ids.every(id => /^\d{15,25}$/.test(id))) return { success: false, reason: 'Choose between two and six investigated members.' };
  const lifecycle = require('./releaseLifecycle');
  const rooms = require('./investigationRooms');
  const locks = [];
  let room = null, persisted = false;
  const groupId = require('node:crypto').randomUUID();
  try {
    const actor = await guild.members.fetch({ user: options.quarantinedBy, force: true });
    const permissions = require('../../../administration/mod/permissions');
    if (!actor || ids.includes(actor.id) || getQuarantineState(guild.id).users?.[actor.id]
      || !permissions.canUseModAction(actor, guild, 'quarantine')) throw Error('You no longer have permission to open this investigation.');
    const otherIds = rooms.getOtherIsolatedMemberIds(guild.id, null);
    for (const id of [...new Set([...ids, actor.id, ...(options.invitedUserIds || []), ...otherIds])]) {
      if (!lifecycle.tryBeginQuarantineOperation(guild.id, id)) throw Error('A selected member or investigation is being updated. Please try again.');
      locks.push(id);
    }
    const role = await ensureQuarantineRole(guild, options);
    const members = [];
    for (const id of ids) {
      const member = await guild.members.fetch({ user: id, force: true });
      const hierarchyError = permissions.checkHierarchyForBulk(actor, guild.members.me, guild.ownerId, member, actor.id);
      if (hierarchyError) throw Error(hierarchyError);
      if (shouldBlockOwnerDestructiveAction({ guild, member, action: 'quarantine' })) throw Error('An investigated member is protected by the development override.');
      const manageable = canManageTargetMember(guild, member);
      if (!manageable.allowed) throw Error(manageable.reason || 'An investigated member cannot be managed.');
      if (otherIds.includes(id) || member.roles.cache.has(role.id)) throw Error('An investigated member is already isolated. Open new investigations only.');
      if ((options.invitedUserIds || []).includes(id)) throw Error('An investigated member cannot also be a guest.');
      members.push(member);
    }
    const isolation = await syncQuarantineIsolation(guild, { role });
    if (!isolation.success) throw Error(isolation.reason || 'Server isolation could not be prepared.');
    const groupOptions = { ...options, invitationSelection: true, investigatedMemberIds: ids,
      investigationMemberIds: ids, investigationGroupId: groupId, protectedCaseIds: locks };
    room = await createInvestigationRoom(guild, members[0], role, groupOptions);
    const channels = await guild.channels.fetch();
    const originals = [];
    for (const member of members) {
      const current = await guild.members.fetch({ user: member.id, force: true });
      if (getQuarantineState(guild.id).users?.[member.id] || current.roles.cache.has(role.id)) throw Error('An investigated member changed while the room was being prepared.');
      const hierarchyError = permissions.checkHierarchyForBulk(actor, guild.members.me, guild.ownerId, current, actor.id);
      if (hierarchyError) throw Error(hierarchyError);
      originals.push({ member: current, roles: current.roles.cache.filter(entry => entry.id !== guild.id && entry.id !== role.id).map(entry => entry.id),
        restores: [...channels.values()].filter(channel => channel.id !== room.id && channel.permissionOverwrites?.cache?.get(member.id)?.allow?.has(PermissionFlagsBits.ViewChannel)).map(channel => channel.id) });
    }
    const state = getQuarantineState(guild.id);
    state.roleId = role.id; state.roleName = role.name;
    for (const original of originals) state.users[original.member.id] = {
      memberId: original.member.id, memberTag: original.member.user?.tag || original.member.id,
      mode: QUARANTINE_MODES.INVESTIGATION, quarantinedAt: Date.now(), reason: options.reason,
      roles: original.roles, memberViewAllowRestores: original.restores, quarantinedBy: options.quarantinedBy,
      source: 'moderation', interviewChannelId: room.id, autoRelease: false, expiresAt: null,
      invitationSelection: true, invitedUserIds: options.invitedUserIds || [], invitedRoleIds: options.invitedRoleIds || [],
      investigationGroupId: groupId, investigationMemberIds: ids, creationPending: true,
      protectedInvitationMembers: room.__protectedInvestigationMembers || [],
    };
    saveQuarantineState(guild, state); persisted = true;
    const saved = getQuarantineState(guild.id);
    if (ids.some(id => saved.users?.[id]?.investigationGroupId !== groupId)) throw Error('The original role records could not be verified after saving.');
    const storage = require('../../../administration/mod/storage');
    for (const original of originals) {
      const record = storage.createCase({ guildId: guild.id, userId: original.member.id, moderatorId: actor.id,
        action: 'quarantine', reason: options.reason, status: 'active',
        metadata: { source: 'quarantine', mode: QUARANTINE_MODES.INVESTIGATION, interviewChannelId: room.id, investigationGroupId: groupId } });
      if (!record?.caseId) throw Error('An investigation case could not be saved.');
      attachQuarantineCase(guild, original.member.id, record.caseId);
    }
    for (const original of originals) {
      const contained = await syncQuarantineIsolation(guild, { role, targetMemberId: original.member.id, allowedChannelIds: [room.id], rollbackMemberAllowsOnFailure: false });
      if (!contained.success) throw Error(contained.reason || 'Member isolation could not be completed.');
      await original.member.roles.set([role.id], options.reason || 'Investigation isolation applied');
      const verification = await verifyMemberContainment(guild, original.member, [room.id]);
      if (!verification.success) throw Error('Effective member isolation could not be verified.');
      const latest = getQuarantineState(guild.id); latest.users[original.member.id].creationPending = false; saveQuarantineState(guild, latest);
    }
    for (const member of members.slice(1)) await room.send({ ...rooms.buildInvestigationRoomPanel(member, room.id, groupOptions), allowedMentions: { parse: [], users: [member.id] } });
    emitCurrentQuarantineState(guild, 'investigation_group_created', { investigationGroupId: groupId, memberIds: ids, interviewChannelId: room.id });
    return { success: true, mode: QUARANTINE_MODES.INVESTIGATION, memberIds: ids, investigationGroupId: groupId, interviewChannelId: room.id };
  } catch (error) {
    // Once saved, keep the room and snapshots for recovery. Never automatically
    // release a successfully isolated subject because another subject failed.
    if (room && !persisted) await room.delete('Investigation setup did not complete').catch(() => null);
    return { success: false, retained: persisted, needsReview: persisted, memberIds: ids,
      interviewChannelId: persisted ? room?.id : null, reason: error.message };
  } finally { for (const id of locks) lifecycle.endQuarantineOperation(guild.id, id); }
}

function attachQuarantineCase(guild, memberId, caseId) {
  if (!guild || !memberId || !caseId) return false;
  const state = getQuarantineState(guild.id);
  if (!state.users?.[String(memberId)]) return false;
  state.users[String(memberId)].caseId = Number(caseId);
  saveQuarantineState(guild, state);
  emitCurrentQuarantineState(guild, 'member_quarantine_case_linked', { memberId: String(memberId), caseId: Number(caseId) });
  return true;
}

function reconcileQuarantineCaseLinks(guild) {
  if (!guild?.id) return { checked: 0, repaired: 0, unresolved: 0 };
  const { getCaseById, getCasesForUser } = require('../../../administration/mod/storage');
  const users = getQuarantineState(guild.id).users || {};
  const result = { checked: 0, repaired: 0, unresolved: 0 };
  for (const [memberId, snapshot] of Object.entries(users)) {
    result.checked++;
    try {
      const linked = snapshot.caseId ? getCaseById(guild.id, snapshot.caseId) : null;
      if (linked && String(linked.userId) === String(memberId)) continue;
      const match = (getCasesForUser(guild.id, memberId) || []).find(record =>
        String(record.action) === 'quarantine' &&
        String(record.status) === 'active' &&
        snapshot.interviewChannelId &&
        String(record.metadata?.interviewChannelId || '') === String(snapshot.interviewChannelId));
      if (match && attachQuarantineCase(guild, memberId, match.caseId)) result.repaired++;
      else result.unresolved++;
    } catch (error) {
      result.unresolved++;
      console.warn('[QuarantineSystem] Case reconciliation failed:', guild.id, memberId, error);
    }
  }
  return result;
}

module.exports = { resolveRequestedMode, isAutomatedSecurityRequest, canManuallyUseSecurityIsolation, createQuarantineDryRunResult, getRestorableRoleIds, escalateInvestigationToSecurity, quarantineMember, quarantineInvestigationMembers, attachQuarantineCase, reconcileQuarantineCaseLinks };
