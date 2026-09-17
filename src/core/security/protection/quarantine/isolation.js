'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { getQuarantineState, saveQuarantineState } = require('./state');
const { ensureQuarantineRole } = require('./roleManager');

function quarantineDenyOverwrite() {
  return { ViewChannel: false };
}

function investigationMemberOverwrite() {
  return { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
}

function investigationStaffOverwrite() {
  return { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };
}

async function restoreMemberViewAllows(guild, memberId, channelIds = [], options = {}) {
  const restored = [];
  const failed = [];
  for (const channelId of [...new Set((channelIds || []).map(String))]) {
    let channel = guild.channels.cache.get(channelId);
    if (!channel) channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.permissionOverwrites?.edit) continue;
    try {
      await channel.permissionOverwrites.edit(String(memberId), { ViewChannel: true }, { reason: options.reason || 'Restoring pre-quarantine member channel access' });
      restored.push(channelId);
    } catch (error) {
      failed.push({ channelId, error: String(error?.message || error).slice(0, 250) });
    }
  }
  return { restored, failed };
}

async function recontainMemberViewAllows(guild, memberId, channelIds = [], options = {}) {
  const contained = [];
  const failed = [];
  for (const channelId of [...new Set((channelIds || []).map(String))]) {
    let channel = guild.channels.cache.get(channelId);
    if (!channel) channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.permissionOverwrites?.edit) continue;
    try {
      await channel.permissionOverwrites.edit(String(memberId), { ViewChannel: false }, { reason: options.reason || 'Re-containing member after failed quarantine release' });
      contained.push(channelId);
    } catch (error) {
      failed.push({ channelId, error: String(error?.message || error).slice(0, 250) });
    }
  }
  return { contained, failed };
}

async function verifyMemberContainment(guild, member, allowedChannelIds = []) {
  const allowed = new Set((allowedChannelIds || []).filter(Boolean).map(String));
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const leaks = [];
  for (const [, channel] of channels || []) {
    if (!channel || channel.type === ChannelType.GuildCategory || channel.isThread?.()) continue;
    if (allowed.has(String(channel.id))) continue;
    const permissions = channel.permissionsFor?.(member);
    if (permissions?.has(PermissionFlagsBits.ViewChannel)) {
      leaks.push({ channelId: channel.id, channelName: channel.name || null });
      if (leaks.length >= 25) break;
    }
  }
  return { success: leaks.length === 0, leaks };
}

async function syncQuarantineIsolation(guild, options = {}) {
  if (!guild) return { success: false, reason: 'Missing guild.', updated: 0, failed: 0 };
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) return { success: false, reason: 'Goliath is missing Manage Roles.', updated: 0, failed: 0 };
  if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) return { success: false, reason: 'Goliath is missing Manage Channels.', updated: 0, failed: 0 };

  let role;
  try { role = options.role || await ensureQuarantineRole(guild, options); }
  catch (error) { return { success: false, reason: error.message, updated: 0, failed: 0 }; }

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  const memberViewAllowRestores = [];
  const targetMemberId = options.targetMemberId ? String(options.targetMemberId) : null;

  for (const [, channel] of channels || []) {
    if (!channel?.permissionOverwrites?.edit || channel.isThread?.()) continue;
    if (targetMemberId) {
      const memberOverwrite = channel.permissionOverwrites.cache?.get(targetMemberId);
      if (memberOverwrite?.allow?.has(PermissionFlagsBits.ViewChannel)) {
        const botPermissions = channel.permissionsFor?.(botMember);
        if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
          failed += 1;
          failures.push({ channelId: channel.id, channelName: channel.name || null, error: 'Goliath cannot temporarily contain the target member overwrite in this channel.' });
          continue;
        }
        try {
          await channel.permissionOverwrites.edit(targetMemberId, { ViewChannel: false }, { reason: 'Goliath quarantine: temporarily contain explicit member channel access' });
          memberViewAllowRestores.push(channel.id);
        } catch (error) {
          failed += 1;
          failures.push({ channelId: channel.id, channelName: channel.name || null, error: String(error?.message || error).slice(0, 250) });
          continue;
        }
      }
    }

    const rolePermissions = channel.permissionsFor?.(role);
    if (!rolePermissions?.has(PermissionFlagsBits.ViewChannel)) { skipped += 1; continue; }
    const botPermissions = channel.permissionsFor?.(botMember);
    if (!botPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      failed += 1;
      failures.push({ channelId: channel.id, channelName: channel.name || null, error: 'Goliath lacks Manage Roles in this channel.' });
      continue;
    }
    if (!botPermissions?.has(PermissionFlagsBits.ViewChannel)) {
      failed += 1;
      failures.push({ channelId: channel.id, channelName: channel.name || null, error: 'Goliath cannot deny View Channel here because it does not possess View Channel in this channel/parent.' });
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(role.id, quarantineDenyOverwrite(), { reason: 'Goliath quarantine isolation policy' });
      updated += 1;
    } catch (error) {
      failed += 1;
      failures.push({ channelId: channel.id, channelName: channel.name || null, error: String(error?.message || error).slice(0, 250) });
    }
  }

  const state = getQuarantineState(guild.id);
  saveQuarantineState(guild, { ...state, roleId: role.id, roleName: role.name, isolationSyncedAt: Date.now() });
  if (failed) {
    const firstError = failures[0]?.error || null;
    let memberAccessRollback = { restored: [], failed: [] };
    if (targetMemberId && memberViewAllowRestores.length && options.rollbackMemberAllowsOnFailure !== false) {
      memberAccessRollback = await restoreMemberViewAllows(guild, targetMemberId, memberViewAllowRestores, { reason: 'Rolling back failed quarantine preflight' });
    }
    console.warn(`[QuarantineSystem] Isolation sync incomplete in ${guild.id}: ${failed} channel(s) failed.${firstError ? ` First error: ${firstError}` : ''}${memberAccessRollback.failed.length ? ` Rollback failures: ${memberAccessRollback.failed.length}.` : ''}`);
    return { success: false, reason: `${failed} channel(s) failed${firstError ? `; first error: ${firstError}` : ''}${memberAccessRollback.failed.length ? `; ${memberAccessRollback.failed.length} member-access rollback(s) also failed` : ''}`, roleId: role.id, roleName: role.name, updated, skipped, failed, failures, memberViewAllowRestores, memberAccessRollback };
  }
  return { success: true, roleId: role.id, roleName: role.name, updated, skipped, failed: 0, failures, memberViewAllowRestores };
}

module.exports = {
  quarantineDenyOverwrite,
  investigationMemberOverwrite,
  investigationStaffOverwrite,
  restoreMemberViewAllows,
  recontainMemberViewAllows,
  verifyMemberContainment,
  syncQuarantineIsolation,
};
