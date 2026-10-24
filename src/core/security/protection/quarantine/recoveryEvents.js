'use strict';

const { Events } = require('discord.js');
const { QUARANTINE_MODES, getQuarantineState, getQuarantineMode } = require('./state');
const { ensureQuarantineRole } = require('./roleManager');
const { syncQuarantineIsolation } = require('./isolation');
const { ensureInvestigationRoomForSnapshot } = require('./investigationRooms');
const { enforceQuarantineOnMember, recoverGuildQuarantine, recoverQuarantines } = require('./enforcementRecovery');
const { startQuarantineExpiryScheduler } = require('./expiryScheduler');
const { isQuarantineReleaseInProgress } = require('./releaseLifecycle');
const { ensureInitiatorInterviewAccess } = require('../../../administration/mod/quarantineInteractions');

function hasActiveQuarantine(guildId) { return Object.keys(getQuarantineState(guildId)?.users || {}).length > 0; }

async function recoverInvestigationInitiatorAccess(guild) {
  if (!guild) return { checked: 0, restored: 0, failed: 0 };
  const state = getQuarantineState(guild.id);
  const result = { checked: 0, restored: 0, failed: 0 };
  for (const snapshot of Object.values(state.users || {})) {
    if (getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION || !snapshot.interviewChannelId || !snapshot.quarantinedBy) continue;
    result.checked += 1;
    const access = await ensureInitiatorInterviewAccess(guild, snapshot.interviewChannelId, snapshot.quarantinedBy);
    if (access.success) result.restored += 1; else result.failed += 1;
  }
  return result;
}

async function recoverInvestigationRoom(guild, member, snapshot) {
  if (getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) return null;
  const role = await ensureQuarantineRole(guild);
  return ensureInvestigationRoomForSnapshot(guild, member, role, snapshot, { reason: snapshot?.reason, quarantinedBy: snapshot?.quarantinedBy });
}

module.exports = [
  { name: Events.ClientReady, once: true, async execute(client) {
    try {
      const result = await recoverQuarantines(client);
      console.log(`[QuarantineSystem] Startup recovery: ${result.guilds} guild(s), ${result.active} active, ${result.reapplied} re-applied, ${result.restored} restored, ${result.failed} failed.`);
      for (const guild of client.guilds.cache.values()) {
        const access = await recoverInvestigationInitiatorAccess(guild);
        if (access.checked) console.log(`[InvestigationIsolation] Initiator access recovery in ${guild.id}: ${access.restored}/${access.checked} restored, ${access.failed} failed.`);
      }
    } catch (error) { console.error('[QuarantineSystem] Startup recovery failed:', error); }
    startQuarantineExpiryScheduler(client);
  } },
  { name: Events.ChannelCreate, async execute(channel) {
    if (!channel?.guild || !hasActiveQuarantine(channel.guild.id)) return;
    try {
      const result = await syncQuarantineIsolation(channel.guild);
      if (!result.success) console.warn(`[QuarantineSystem] New channel isolation incomplete for ${channel.id}: ${result.reason || 'Unknown failure'}`);
      for (const snapshot of Object.values(getQuarantineState(channel.guild.id)?.users || {})) {
        const member = await channel.guild.members.fetch(String(snapshot.memberId)).catch(() => null);
        if (!member) continue;
        const { PermissionFlagsBits } = require('discord.js');
        if (channel.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel)) {
          console.warn(`[QuarantineSystem] New channel ${channel.id} exposes quarantined member ${member.id}; attempting containment recovery.`);
          const recovery = await enforceQuarantineOnMember(member).catch(error => ({ success: false, reason: error.message }));
          if (!recovery.success) console.warn(`[QuarantineSystem] Failed to contain member ${member.id} after channel creation: ${recovery.reason || recovery.error || 'Unknown failure'}`);
        }
      }
    } catch (error) { console.warn(`[QuarantineSystem] Failed to secure new channel ${channel.id}:`, error.message); }
  } },
  { name: Events.ThreadCreate, async execute(thread) {
    if (!thread?.guild || !hasActiveQuarantine(thread.guild.id)) return;
    const state = getQuarantineState(thread.guild.id);
    for (const snapshot of Object.values(state.users || {})) {
      const member = await thread.guild.members.fetch(String(snapshot.memberId)).catch(() => null);
      if (!member) continue;
      const roleId = state.roleId;
      if (!roleId || !member.roles.cache.has(roleId)) {
        const result = await enforceQuarantineOnMember(member).catch(error => ({ success: false, reason: error.message }));
        if (!result.success) console.warn(`[QuarantineSystem] Thread isolation recovery failed for ${member.id}: ${result.reason || result.error || 'Unknown failure'}`);
      }
      const { PermissionFlagsBits } = require('discord.js');
      if (thread.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel)) {
        const recovery = await enforceQuarantineOnMember(member).catch(error => ({ success: false, reason: error.message }));
        if (!recovery.success || thread.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel)) {
          console.warn(`[QuarantineSystem] Thread ${thread.id} remains visible to quarantined member ${member.id}; manual intervention required.`);
        }
      }
    }
  } },
  { name: Events.ChannelUpdate, async execute(previous, channel) {
    if (!channel?.guild || !hasActiveQuarantine(channel.guild.id)) return;
    const roleId = getQuarantineState(channel.guild.id)?.roleId;
    if (!roleId) return;
    const { PermissionFlagsBits } = require('discord.js');
    const before = previous?.permissionOverwrites?.cache?.get(roleId);
    const after = channel.permissionOverwrites?.cache?.get(roleId);
    const deniedBefore = Boolean(before?.deny?.has(PermissionFlagsBits.ViewChannel));
    const deniedAfter = Boolean(after?.deny?.has(PermissionFlagsBits.ViewChannel));
    const state = getQuarantineState(channel.guild.id);
    const exposed = [];
    for (const snapshot of Object.values(state.users || {})) {
      if (String(snapshot.interviewChannelId || '') === String(channel.id)) continue;
      const member = await channel.guild.members.fetch(String(snapshot.memberId)).catch(() => null);
      if (member && channel.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel)) exposed.push(member);
    }
    if (deniedAfter && !exposed.length) return;
    try {
      const result = await syncQuarantineIsolation(channel.guild);
      if (!result.success) console.warn(`[QuarantineSystem] Updated channel isolation incomplete for ${channel.id}: ${result.reason || 'Unknown failure'}`);
      for (const member of exposed) {
        const recovery = await enforceQuarantineOnMember(member).catch(error => ({ success: false, reason: error.message }));
        if (!recovery.success) console.warn(`[QuarantineSystem] Member ${member.id} remains exposed after channel update: ${recovery.reason || recovery.error || 'Unknown failure'}`);
      }
    } catch (error) { console.warn('[QuarantineSystem] Updated channel isolation failed:', error.message); }
  } },
  { name: Events.ChannelDelete, async execute(channel) {
    if (!channel?.guild || !hasActiveQuarantine(channel.guild.id)) return;
    const state = getQuarantineState(channel.guild.id);
    const affected = Object.values(state.users || {}).filter((snapshot) => getQuarantineMode(snapshot) === QUARANTINE_MODES.INVESTIGATION && String(snapshot.interviewChannelId || '') === String(channel.id));
    for (const snapshot of affected) {
      const member = await channel.guild.members.fetch(String(snapshot.memberId)).catch(() => null);
      if (!member) continue;
      try {
        const room = await recoverInvestigationRoom(channel.guild, member, { ...snapshot, interviewChannelId: null });
        if (room && snapshot.quarantinedBy) {
          const access = await ensureInitiatorInterviewAccess(channel.guild, room.id, snapshot.quarantinedBy);
          if (!access.success) console.warn(`[InvestigationIsolation] Failed to restore initiator access after room recreation for ${member.id}: ${access.reason}`);
        }
      } catch (error) { console.warn(`[QuarantineSystem] Failed interview-room recovery for ${member.id}:`, error.message); }
    }
  } },
  { name: Events.GuildMemberAdd, async execute(member) {
    const snapshot = member?.guild ? getQuarantineState(member.guild.id)?.users?.[member.id] : null;
    if (!member?.guild || !snapshot) return;
    try {
      const result = await enforceQuarantineOnMember(member);
      if (!result.success) { console.warn(`[QuarantineSystem] Failed to reapply quarantine to ${member.id}: ${result.error || result.reason}`); return; }
      if (getQuarantineMode(snapshot) === QUARANTINE_MODES.INVESTIGATION) {
        const room = await recoverInvestigationRoom(member.guild, member, snapshot);
        const roomId = room?.id || result.interviewChannelId;
        if (roomId && snapshot.quarantinedBy) {
          const access = await ensureInitiatorInterviewAccess(member.guild, roomId, snapshot.quarantinedBy);
          if (!access.success) console.warn(`[InvestigationIsolation] Failed to restore initiator access after rejoin for ${member.id}: ${access.reason}`);
        }
      }
    } catch (error) { console.warn(`[QuarantineSystem] Failed join enforcement for ${member.id}:`, error.message); }
  } },
  { name: Events.GuildMemberUpdate, async execute(before, member) {
    if (!member?.guild || isQuarantineReleaseInProgress(member.guild.id, member.id) || !getQuarantineState(member.guild.id)?.users?.[member.id]) return;
    const quarantineRoleId = getQuarantineState(member.guild.id)?.roleId;
    if (!quarantineRoleId) return;
    const roles = member.roles?.cache;
    if (!roles || (roles.has(quarantineRoleId) && roles.filter(role => role.id !== member.guild.id && role.id !== quarantineRoleId).size === 0)) return;
    const result = await enforceQuarantineOnMember(member).catch(error => ({ success: false, reason: error.message }));
    if (!result.success) console.warn(`[QuarantineSystem] Member role recovery incomplete for ${member.id}: ${result.reason || result.error || 'Unknown failure'}`);
  } },
  { name: Events.GuildRoleDelete, async execute(role) {
    if (!role?.guild || !hasActiveQuarantine(role.guild.id)) return;
    const state = getQuarantineState(role.guild.id);
    if (String(state.roleId || '') !== String(role.id) && String(state.roleName || '') !== String(role.name || '')) return;
    try {
      await ensureQuarantineRole(role.guild);
      const result = await recoverGuildQuarantine(role.guild);
      if (!result.success) console.warn(`[QuarantineSystem] Quarantine role recovery incomplete in ${role.guild.id}.`);
      await recoverInvestigationInitiatorAccess(role.guild);
    } catch (error) { console.warn(`[QuarantineSystem] Failed to recover deleted quarantine role in ${role.guild.id}:`, error.message); }
  } },
];
