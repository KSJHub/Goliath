'use strict';

const auditIntelligence = require('../../../../owner/auditIntelligence/auditIntelligence');
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

async function recordAutomaticAction(guild, input = {}) {
  if (!guild?.client || !guild?.id) return;
  const success = input.success !== false;
  await auditIntelligence.captureGoliathAction(guild.client, {
    guild,
    guildId: guild.id,
    type: input.type || 'goliath.background.quarantine_recovery',
    category: 'security',
    action: success ? (input.action || 'update') : 'failure',
    result: success ? 'Success' : 'Failure',
    summary: input.summary || `Goliath ${success ? 'completed' : 'failed'} an automatic quarantine recovery operation in **${guild.name}**.`,
    target: input.memberId
      ? { type: 'member', id: String(input.memberId), label: input.memberTag || String(input.memberId) }
      : { type: 'guild', id: guild.id, label: guild.name },
    reason: String(input.reason || 'Automatic quarantine recovery').slice(0, 500),
    metadata: { automatic: true, ...(input.metadata || {}) },
  }).catch((error) => console.warn(`[QuarantineSystem] Could not record automatic recovery action in ${guild.id}:`, error?.message || error));
}

async function enforceQuarantineOnMember(member, options = {}) {
  const guild = member?.guild;
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const state = getQuarantineState(guild.id);
  const snapshot = state.users?.[member.id];
  if (!snapshot) return { success: false, notQuarantined: true, reason: 'No quarantine snapshot' };
  const mode = getQuarantineMode(snapshot);

  if (snapshot.expiresAt && Date.now() >= Number(snapshot.expiresAt)) {
    const restored = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry during enforcement', system: true });
    await recordAutomaticAction(guild, {
      type: 'goliath.background.quarantine_expiry', success: restored.success, action: 'delete', memberId: member.id, memberTag: member.user?.tag,
      summary: restored.success ? `Goliath automatically released expired quarantine for **${member.user?.tag || member.id}**.` : `Goliath failed to release expired quarantine for **${member.user?.tag || member.id}**.`,
      reason: restored.success ? 'Automatic quarantine expiry during enforcement' : restored.reason || restored.error || 'Automatic quarantine expiry restoration failed',
      metadata: { phase: 'enforcement', mode },
    });
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
          await recordAutomaticAction(guild, {
            type: 'goliath.background.quarantine_expiry', success: cleared.success, action: 'delete', memberId: userId, memberTag: snapshot.memberTag,
            summary: cleared.success ? `Goliath cleared expired quarantine state for absent member **${snapshot.memberTag || userId}**.` : `Goliath failed to clear expired quarantine state for absent member **${snapshot.memberTag || userId}**.`,
            reason: cleared.success ? 'Automatic quarantine expiry; member is no longer in the guild' : cleared.reason || cleared.error || 'Expired absent-member cleanup failed',
            metadata: { phase: 'scheduled', absentMember: true, mode: getQuarantineMode(snapshot) },
          });
          state = getQuarantineState(guild.id);
          continue;
        }
        console.log(`[QuarantineSystem] Auto restoring ${member.user.tag}`);
        const restored = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry', system: true });
        if (restored.success) result.restored += 1; else result.failed += 1;
        await recordAutomaticAction(guild, {
          type: 'goliath.background.quarantine_expiry', success: restored.success, action: 'delete', memberId: member.id, memberTag: member.user?.tag,
          summary: restored.success ? `Goliath automatically released expired quarantine for **${member.user?.tag || member.id}**.` : `Goliath failed to release expired quarantine for **${member.user?.tag || member.id}**.`,
          reason: restored.success ? 'Automatic quarantine expiry' : restored.reason || restored.error || 'Automatic quarantine expiry restoration failed',
          metadata: { phase: 'scheduled', mode: getQuarantineMode(snapshot) },
        });
        state = getQuarantineState(guild.id);
      }
    } catch (error) {
      result.failed += 1;
      console.warn(`[QuarantineSystem] Failed restore cycle for guild ${guild.id}:`, error.message);
      await recordAutomaticAction(guild, { type: 'goliath.background.quarantine_expiry_cycle', success: false, summary: `Goliath quarantine expiry cycle failed in **${guild.name}**.`, reason: error.message, metadata: { phase: 'scheduled' } });
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
  if (!role) {
    await recordAutomaticAction(guild, { type: 'goliath.background.quarantine_startup_recovery', success: false, summary: `Goliath could not recover the quarantine role in **${guild.name}**.`, reason: 'Quarantine role recovery failed.', metadata: { phase: 'startup', active: entries.length } });
    return { success: false, reason: 'Quarantine role recovery failed.', active: entries.length, reapplied: 0, restored: 0, failed: entries.length };
  }

  let reapplied = 0; let restored = 0; let failed = 0;
  for (const [userId, snapshot] of entries) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (snapshot?.expiresAt && Date.now() >= Number(snapshot.expiresAt)) {
      let operation;
      if (member) operation = await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry during startup recovery', system: true });
      else operation = await clearExpiredAbsentMember(guild, userId, getQuarantineState(guild.id));
      if (operation.success) restored += 1; else failed += 1;
      await recordAutomaticAction(guild, {
        type: 'goliath.background.quarantine_startup_expiry', success: operation.success, action: 'delete', memberId: userId, memberTag: member?.user?.tag || snapshot.memberTag,
        summary: operation.success ? `Goliath resolved expired quarantine during startup for **${member?.user?.tag || snapshot.memberTag || userId}**.` : `Goliath failed to resolve expired quarantine during startup for **${member?.user?.tag || snapshot.memberTag || userId}**.`,
        reason: operation.success ? 'Automatic quarantine expiry during startup recovery' : operation.reason || operation.error || 'Startup expiry restoration failed',
        metadata: { phase: 'startup', absentMember: !member, mode: getQuarantineMode(snapshot) },
      });
      continue;
    }
    if (!member) continue;
    const operation = await enforceQuarantineOnMember(member, { role });
    if (operation.success) reapplied += 1; else failed += 1;
    await recordAutomaticAction(guild, {
      type: 'goliath.background.quarantine_startup_recovery', success: operation.success, action: 'update', memberId: member.id, memberTag: member.user?.tag,
      summary: operation.success ? `Goliath re-applied active ${getQuarantineMode(snapshot)} quarantine to **${member.user?.tag || member.id}** during startup recovery.` : `Goliath failed to re-apply active quarantine to **${member.user?.tag || member.id}** during startup recovery.`,
      reason: operation.success ? 'Startup quarantine recovery' : operation.reason || operation.error || 'Startup quarantine recovery failed',
      metadata: { phase: 'startup', mode: getQuarantineMode(snapshot), interviewChannelId: operation.interviewChannelId || null },
    });
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
      await recordAutomaticAction(guild, { type: 'goliath.background.quarantine_startup_recovery', success: false, summary: `Goliath startup quarantine recovery crashed in **${guild.name}**.`, reason: error.message, metadata: { phase: 'startup', active: Object.keys(state.users || {}).length } });
    }
  }
  return result;
}

module.exports = { enforceQuarantineOnMember, restoreExpiredQuarantines, recoverGuildQuarantine, recoverQuarantines };
