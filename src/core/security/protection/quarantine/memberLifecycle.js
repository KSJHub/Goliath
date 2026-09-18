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
  const state = getQuarantineState(guild.id);
  try {
    let interviewChannel = existing.interviewChannelId ? guild.channels.cache.get(String(existing.interviewChannelId)) : null;
    if (!interviewChannel && existing.interviewChannelId) interviewChannel = await guild.channels.fetch(String(existing.interviewChannelId)).catch(() => null);
    if (interviewChannel?.permissionOverwrites?.edit) {
      await interviewChannel.permissionOverwrites.edit(member.id, { ViewChannel: false }, { reason: 'Investigation escalated to full Security Isolation' }).catch(() => null);
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
    return { success: false, alreadyQuarantined: true, mode: existingMode, reason: 'Member is already quarantined.' };
  }

  let interviewRoom = null; let snapshotRoles = []; let snapshotCaptured = false; let isolation = null; let quarantineRole = null;
  try {
    quarantineRole = await ensureQuarantineRole(guild, options);
    isolation = await syncQuarantineIsolation(guild, { ...options, role: quarantineRole, targetMemberId: member.id });
    if (!isolation.success) return { success: false, mode, reason: `Quarantine isolation could not be guaranteed: ${isolation.reason || `${isolation.failed} channel(s) failed`}`, isolation };
    snapshotRoles = member.roles.cache.filter((entry) => entry.id !== guild.id && entry.id !== quarantineRole.id).map((entry) => entry.id);
    snapshotCaptured = true;
    if (mode === QUARANTINE_MODES.INVESTIGATION) interviewRoom = await createInvestigationRoom(guild, member, quarantineRole, options).catch((error) => { throw new Error(`Investigation room could not be created: ${error.message}`); });
    await member.roles.set([quarantineRole.id], options.reason || 'Goliath quarantine applied.');
    const verification = await verifyMemberContainment(guild, member, mode === QUARANTINE_MODES.INVESTIGATION && interviewRoom ? [interviewRoom.id] : []);
    if (!verification.success) throw new Error(`Containment verification failed: ${verification.leaks.length} channel(s) remain visible (${verification.leaks.slice(0, 3).map((entry) => entry.channelName || entry.channelId).join(', ')}).`);
    const state = getQuarantineState(guild.id);
    state.roleId = quarantineRole.id; state.roleName = quarantineRole.name;
    state.users[member.id] = { memberId: member.id, memberTag: member.user?.tag || null, mode, quarantinedAt: Date.now(), reason: options.reason || 'No reason provided', roles: snapshotRoles, memberViewAllowRestores: isolation.memberViewAllowRestores || [], quarantinedBy: options.quarantinedBy || null, source: options.source || (options.quarantinedBy === 'anti_nuke' ? 'anti_nuke' : 'moderation'), caseId: options.caseId || null, interviewChannelId: interviewRoom?.id || null, expiresAt: options.durationMs && Number(options.durationMs) > 0 ? Date.now() + Number(options.durationMs) : null };
    saveQuarantineState(guild, state);
    emitCurrentQuarantineState(guild, 'member_quarantined', { memberId: member.id, mode, interviewChannelId: interviewRoom?.id || null });
    return { success: true, mode, roleId: quarantineRole.id, interviewChannelId: interviewRoom?.id || null, snapshotRoles, isolation, verification };
  } catch (error) {
    const rollback = { roles: null, memberAccess: null, roomDeleted: false };
    if (snapshotCaptured && quarantineRole) {
      const manageable = await getRestorableRoleIds(guild, snapshotRoles, quarantineRole.id);
      rollback.roles = await member.roles.set(manageable.restored, 'Rolling back failed quarantine transaction').then(() => ({ success: true, restored: manageable.restored, skipped: manageable.skipped })).catch((roleError) => ({ success: false, error: String(roleError?.message || roleError), skipped: manageable.skipped }));
    }
    if (interviewRoom) rollback.roomDeleted = await interviewRoom.delete('Rolling back failed investigation isolation').then(() => true).catch(() => false);
    if (isolation?.memberViewAllowRestores?.length) rollback.memberAccess = await restoreMemberViewAllows(guild, member.id, isolation.memberViewAllowRestores, { reason: 'Rolling back failed quarantine transaction' });
    return { success: false, mode, error: error.message, rollback };
  }
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

module.exports = { resolveRequestedMode, isAutomatedSecurityRequest, canManuallyUseSecurityIsolation, createQuarantineDryRunResult, getRestorableRoleIds, escalateInvestigationToSecurity, quarantineMember, attachQuarantineCase };
