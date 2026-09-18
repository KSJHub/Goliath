'use strict';

const {
  QUARANTINE_MODES,
  getQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
} = require('./state');
const { ensureQuarantineRole } = require('./roleManager');
const { syncQuarantineIsolation, verifyMemberContainment } = require('./isolation');
const { ensureInvestigationRoomForSnapshot } = require('./investigationRooms');
const { restoreQuarantinedMember, clearExpiredAbsentMember } = require('./releaseLifecycle');

async function enforceQuarantineOnMember(member, options = {}) {
  const guild = member?.guild;
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const state = getQuarantineState(guild.id);
  const snapshot = state.users?.[member.id];
  if (!snapshot) return { success: false, notQuarantined: true, reason: 'No quarantine snapshot' };
  const mode = getQuarantineMode(snapshot);

  if (snapshot.expiresAt && Date.now() >= Number(snapshot.expiresAt)) {
    const restored = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry during enforcement', system: true });
    return restored.success ? { ...restored, expired: true, executed: false } : { ...restored, expired: true, executed: false, success: false };
  }

  try {
    const role = await ensureQuarantineRole(guild, options);
    const isolation = await syncQuarantineIsolation(guild, { ...options, role, targetMemberId: member.id, rollbackMemberAllowsOnFailure: false });
    if (!isolation.success) return { success: false, mode, reason: 'Quarantine isolation sync failed.', isolation };
    let interviewRoom = null;
    if (mode === QUARANTINE_MODES.INVESTIGATION) interviewRoom = await ensureInvestigationRoomForSnapshot(guild, member, role, snapshot, options);
    await member.roles.set([role.id], `Reapplying active Goliath ${mode} quarantine`);
    const verification = await verifyMemberContainment(guild, member, mode === QUARANTINE_MODES.INVESTIGATION && interviewRoom ? [interviewRoom.id] : []);
    if (!verification.success) return { success: false, mode, reason: 'Effective containment verification failed.', isolation, verification };
    emitCurrentQuarantineState(guild, 'member_quarantine_reapplied', { memberId: member.id, mode, interviewChannelId: interviewRoom?.id || null });
    return { success: true, mode, roleId: role.id, interviewChannelId: interviewRoom?.id || null, isolation, verification };
  } catch (error) {
    return { success: false, mode, error: error.message };
  }
}

async function restoreExpiredQuarantines(client) {
  if (!client) return { checked: 0, restored: 0, clearedAbsent: 0, failed: 0 };
  const result = { checked: 0, restored: 0, clearedAbsent: 0, failed: 0 };
  for (const [, guild] of client.guilds.cache) {
    try {
      let state = getQuarantineState(guild.id);
      for (const userId of Object.keys(state.users || {})) {
        const snapshot = state.users[userId];
        if (!snapshot?.expiresAt || Date.now() < Number(snapshot.expiresAt)) continue;
        result.checked += 1;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
          const cleared = await clearExpiredAbsentMember(guild, userId, state);
          if (cleared.success) result.clearedAbsent += 1; else result.failed += 1;
          state = getQuarantineState(guild.id);
          continue;
        }
        console.log(`[QuarantineSystem] Auto restoring ${member.user.tag}`);
        const restored = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry', system: true });
        if (restored.success) result.restored += 1; else result.failed += 1;
        state = getQuarantineState(guild.id);
      }
    } catch (error) {
      result.failed += 1;
      console.warn(`[QuarantineSystem] Failed restore cycle for guild ${guild.id}:`, error.message);
    }
  }
  return result;
}

async function recoverGuildQuarantine(guild) {
  if (!guild) return { success: false, reason: 'Missing guild.', active: 0, reapplied: 0, restored: 0, failed: 0 };
  const state = getQuarantineState(guild.id);
  const entries = Object.entries(state.users || {});
  if (!entries.length) return { success: true, active: 0, reapplied: 0, restored: 0, failed: 0 };
  const role = await ensureQuarantineRole(guild).catch((error) => {
    console.warn(`[QuarantineSystem] Failed to recover role in guild ${guild.id}:`, error.message);
    return null;
  });
  if (!role) return { success: false, reason: 'Quarantine role recovery failed.', active: entries.length, reapplied: 0, restored: 0, failed: entries.length };

  let reapplied = 0; let restored = 0; let failed = 0;
  for (const [userId, snapshot] of entries) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (snapshot?.expiresAt && Date.now() >= Number(snapshot.expiresAt)) {
      if (member) {
        const result = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry during startup recovery', system: true });
        if (result.success) restored += 1; else failed += 1;
      } else {
        const latest = getQuarantineState(guild.id);
        const cleared = await clearExpiredAbsentMember(guild, userId, latest);
        if (cleared.success) restored += 1; else failed += 1;
      }
      continue;
    }
    if (!member) continue;
    const result = await enforceQuarantineOnMember(member, { role });
    if (result.success) reapplied += 1; else failed += 1;
  }
  return { success: failed === 0, active: entries.length, reapplied, restored, failed };
}

async function recoverQuarantines(client) {
  if (!client) return { guilds: 0, active: 0, reapplied: 0, restored: 0, failed: 0 };
  const result = { guilds: 0, active: 0, reapplied: 0, restored: 0, failed: 0 };
  for (const [, guild] of client.guilds.cache) {
    const state = getQuarantineState(guild.id);
    if (!Object.keys(state.users || {}).length) continue;
    result.guilds += 1;
    try {
      const recovered = await recoverGuildQuarantine(guild);
      result.active += recovered.active || 0;
      result.reapplied += recovered.reapplied || 0;
      result.restored += recovered.restored || 0;
      result.failed += recovered.failed || 0;
    } catch (error) {
      result.failed += Object.keys(state.users || {}).length;
      console.warn(`[QuarantineSystem] Guild recovery failed for ${guild.id}:`, error.message);
    }
  }
  return result;
}

module.exports = { enforceQuarantineOnMember, restoreExpiredQuarantines, recoverGuildQuarantine, recoverQuarantines };
