'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { EMOJIS } = require('../../ui/emojis');
const guildManager = require('../../guild/guildManager');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');
const { emitLockdownUpdate } = require('../../../server/sockets/socketHub');

const activeReminderIntervals = new Map();
const activeOperations = new Set();
let lockdownRecoveryTimer = null;

const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_DELETE_MS = 60 * 1000;
const LOCKDOWN_RECOVERY_INTERVAL_MS = 60 * 1000;
const LOCKDOWN_RECOVERY_SCHEDULER_ID = 'security:lockdown-recovery:global';

function lockdownReminderSchedulerId(guildId) {
  return schedulerRegistry.schedulerId({
    module: 'security',
    component: 'lockdown-reminder',
    guildId,
  });
}

function emptyLockdownState() {
  return {
    active: false,
    enabledBy: null,
    enabledAt: null,
    reason: null,
    lockdownMode: null,
    severity: null,
    lockdownStartedAt: null,
    lockdownExpiresAt: null,
    reminderChannelId: null,
    reminderUserId: null,
    lastReminderAt: null,
    channels: [],
    bypassRoleIds: [],
    failedChannels: [],
    lastRestoreError: null,
  };
}

function normalizeRoleIds(roleIds = []) {
  if (!Array.isArray(roleIds)) return [];
  return [...new Set(roleIds.map((roleId) => String(roleId || '').trim()).filter((roleId) => /^\d{16,20}$/.test(roleId)))];
}

function normalizeLockdownState(state = {}) {
  const normalized = { ...emptyLockdownState(), ...(state || {}) };
  normalized.bypassRoleIds = normalizeRoleIds(normalized.bypassRoleIds);
  normalized.channels = Array.isArray(normalized.channels) ? normalized.channels.filter(Boolean) : [];
  normalized.failedChannels = Array.isArray(normalized.failedChannels) ? normalized.failedChannels.filter(Boolean) : [];
  return normalized;
}

function getIncidentLogger() { return require('./system'); }

function getLockdownState(guildId) {
  const security = guildManager.getSecurityConfig(guildId) || {};
  const rawLockdown = security?.lockdown;
  if (!rawLockdown || typeof rawLockdown !== 'object' || Array.isArray(rawLockdown)) return normalizeLockdownState();
  return normalizeLockdownState(rawLockdown);
}

function getBypassRoleIds(guildId) { return normalizeRoleIds(getLockdownState(guildId).bypassRoleIds); }

function saveLockdownState(guild, lockdownData = {}) {
  const nextLockdown = normalizeLockdownState(lockdownData);
  return guildManager.updateSecurityConfig(guild.id, (security = {}) => ({
    ...security,
    lastLockdownAt: nextLockdown.active ? new Date().toISOString() : security.lastLockdownAt || null,
    lockdown: nextLockdown,
  }), guild);
}

function clearLockdownState(guild) {
  const current = getLockdownState(guild.id);
  return saveLockdownState(guild, { ...emptyLockdownState(), bypassRoleIds: current.bypassRoleIds });
}

function stopLockdownReminder(guildId) {
  const interval = activeReminderIntervals.get(guildId);
  if (interval) {
    clearInterval(interval);
    activeReminderIntervals.delete(guildId);
  }
  schedulerRegistry.stop(lockdownReminderSchedulerId(guildId), 'lockdown reminder stopped');
}

function getTextLockPermissions(options = {}) {
  const permissions = {};
  if (options.lockText !== false) {
    permissions.SendMessages = false;
    permissions.AddReactions = false;
  }
  if (options.lockThreads !== false) {
    permissions.CreatePublicThreads = false;
    permissions.CreatePrivateThreads = false;
    permissions.SendMessagesInThreads = false;
  }
  if (options.lockCommands !== false) permissions.UseApplicationCommands = false;
  return permissions;
}

function getVoiceLockPermissions(options = {}) {
  if (options.lockVoice === false) return {};
  return { Connect: false, Speak: false, Stream: false };
}

function getTextBypassPermissions(options = {}) {
  const permissions = {};
  if (options.lockText !== false) {
    permissions.SendMessages = true;
    permissions.AddReactions = true;
  }
  if (options.lockThreads !== false) {
    permissions.SendMessagesInThreads = true;
    permissions.CreatePublicThreads = true;
    permissions.CreatePrivateThreads = true;
  }
  if (options.lockCommands !== false) permissions.UseApplicationCommands = true;
  return permissions;
}

function getVoiceBypassPermissions(options = {}) {
  if (options.lockVoice === false) return {};
  return { Connect: true, Speak: true, Stream: true };
}

function getLockdownModeFromSeverity(severity = 'low') {
  switch (String(severity).toLowerCase()) {
    case 'critical': return { mode: 'emergency', slowmodeSeconds: 21600, lockText: true, lockVoice: true, lockThreads: true, lockCommands: true };
    case 'high': return { mode: 'high', slowmodeSeconds: 3600, lockText: true, lockVoice: true, lockThreads: true, lockCommands: true };
    case 'medium': return { mode: 'medium', slowmodeSeconds: 600, lockText: true, lockVoice: false, lockThreads: true, lockCommands: false };
    default: return { mode: 'low', slowmodeSeconds: 60, lockText: false, lockVoice: false, lockThreads: false, lockCommands: false };
  }
}

function serializePermissionOverwrites(channel) {
  try {
    if (!channel.permissionOverwrites?.cache) return [];
    return channel.permissionOverwrites.cache.map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    }));
  } catch {
    return [];
  }
}

function createChannelSnapshot(channel) {
  return {
    id: channel.id,
    name: channel.name || null,
    type: channel.type,
    parentId: channel.parentId || null,
    slowmode: typeof channel.rateLimitPerUser === 'number' ? channel.rateLimitPerUser : 0,
    nsfw: typeof channel.nsfw === 'boolean' ? channel.nsfw : false,
    permissionsLocked: typeof channel.permissionsLocked === 'boolean' ? channel.permissionsLocked : null,
    overwrites: serializePermissionOverwrites(channel),
  };
}

function isLockdownTextChannel(channel) {
  return channel?.type === ChannelType.GuildText
    || channel?.type === ChannelType.GuildAnnouncement
    || channel?.type === ChannelType.GuildForum;
}

function isLockdownVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

function buildLockPermissions(isText, isVoice, options = {}) {
  const perms = {};
  if (isText) Object.assign(perms, getTextLockPermissions(options));
  if (isVoice) Object.assign(perms, getVoiceLockPermissions(options));
  return perms;
}

function getLockdownSlowmode(options = {}) {
  const value = Number(options.slowmodeSeconds);
  if (!Number.isFinite(value) || value < 0) return 10;
  return Math.min(value, 21600);
}

async function applyBypassRoleOverwrites(channel, guild, bypassRoleIds, isText, isVoice, options = {}) {
  if (!bypassRoleIds.length) return { applied: 0, failures: [] };
  let applied = 0;
  const failures = [];
  for (const roleId of bypassRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role || role.managed || role.id === guild.id) continue;
    const bypassPerms = {};
    if (isText) Object.assign(bypassPerms, getTextBypassPermissions(options));
    if (isVoice) Object.assign(bypassPerms, getVoiceBypassPermissions(options));
    if (!Object.keys(bypassPerms).length) continue;
    try {
      await channel.permissionOverwrites.edit(role.id, bypassPerms, { reason: 'Goliath lockdown bypass role.' });
      applied += 1;
    } catch (error) {
      failures.push({ roleId: role.id, channelId: channel.id, error: String(error?.message || error).slice(0, 250) });
    }
  }
  return { applied, failures };
}

async function restoreOriginalOverwrites(channel, saved, reason) {
  const overwrites = Array.isArray(saved?.overwrites) ? saved.overwrites : [];
  const payload = overwrites.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: BigInt(overwrite.allow || 0),
    deny: BigInt(overwrite.deny || 0),
  }));
  await channel.permissionOverwrites.set(payload, reason);
  return payload.length;
}

async function restoreChannelSnapshot(channel, saved, reason) {
  const overwritesRestored = await restoreOriginalOverwrites(channel, saved, reason);
  if (typeof channel.setRateLimitPerUser === 'function') {
    await channel.setRateLimitPerUser(typeof saved.slowmode === 'number' ? saved.slowmode : 0, reason);
  }
  return { overwritesRestored };
}

function emitCurrentLockdownState(guild, action, extra = {}) {
  try {
    emitLockdownUpdate(guild.id, { action, lockdown: getLockdownState(guild.id), ...extra });
  } catch (error) {
    console.warn('[LockdownSystem] Failed to emit lockdown update:', error.message);
  }
}

function startLockdownReminder(guild, reminderChannelId, reminderUserId) {
  if (!guild || !reminderChannelId || !reminderUserId) return false;
  stopLockdownReminder(guild.id);
  const schedulerId = lockdownReminderSchedulerId(guild.id);
  schedulerRegistry.register({
    id: schedulerId,
    module: 'security',
    component: 'lockdown-reminder',
    guildId: guild.id,
    guildName: guild.name,
    intervalMs: REMINDER_INTERVAL_MS,
    staleAfterMs: REMINDER_INTERVAL_MS * 3,
    details: { reminderChannelId, reminderUserId },
  });
  const interval = setInterval(async () => {
    try {
      const latest = getLockdownState(guild.id);
      if (!latest?.active) {
        stopLockdownReminder(guild.id);
        return;
      }
      if (latest.lockdownExpiresAt && Date.now() >= Number(latest.lockdownExpiresAt)) {
        await disableLockdown(guild, { reason: 'Automatic lockdown expiry', disabledByTag: 'Goliath Auto Recovery', restoredAutomatically: true });
        return;
      }
      const channel = await guild.channels.fetch(latest.reminderChannelId || reminderChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        schedulerRegistry.beat(schedulerId, { reminderSent: false, reason: 'reminder channel unavailable' });
        return;
      }
      const reminderMessage = await channel.send({
        content: `${EMOJIS.WARNING} <@${latest.reminderUserId || reminderUserId}> Lockdown is still **ACTIVE**. ${EMOJIS.WARNING}\nRemove the lockdown as soon as the server is secure.`,
      });
      saveLockdownState(guild, { ...latest, lastReminderAt: Date.now() });
      schedulerRegistry.beat(schedulerId, { reminderSent: true, reminderChannelId: channel.id });
      setTimeout(() => { reminderMessage.delete().catch(() => null); }, REMINDER_DELETE_MS);
    } catch (error) {
      schedulerRegistry.fail(schedulerId, error, { guildId: guild.id, guildName: guild.name });
      console.warn('[LockdownSystem] Reminder interval failed:', error.message);
    }
  }, REMINDER_INTERVAL_MS);
  interval.unref?.();
  activeReminderIntervals.set(guild.id, interval);
  return true;
}

async function enableLockdown(guild, options = {}) {
  if (!guild) return { success: false, reason: 'Missing guild.', locked: 0, bypassApplied: 0 };
  if (activeOperations.has(guild.id)) return { success: false, busy: true, reason: 'A lockdown operation is already running.', locked: 0, bypassApplied: 0 };
  const current = getLockdownState(guild.id);
  if (current.active) return { success: false, alreadyActive: true, reason: 'Lockdown is already active.', locked: 0, bypassApplied: 0 };

  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    return { success: false, reason: 'Goliath is missing Manage Channels.', locked: 0, bypassApplied: 0 };
  }

  activeOperations.add(guild.id);
  try {
    const reason = options.reason || 'No reason provided';
    const enabledBy = options.enabledBy || null;
    const enabledByTag = options.enabledByTag || 'Goliath System';
    const reminderChannelId = options.reminderChannelId || null;
    const reminderUserId = options.reminderUserId || null;
    const bypassRoleIds = normalizeRoleIds(options.bypassRoleIds || current.bypassRoleIds);
    const enabledAt = Date.now();
    const lockdownExpiresAt = options.durationMs && Number(options.durationMs) > 0 ? enabledAt + Number(options.durationMs) : null;
    const slowmodeSeconds = getLockdownSlowmode(options);
    const savedChannels = [];
    const failures = [];
    let bypassApplied = 0;

    const channels = await guild.channels.fetch().catch((error) => {
      throw new Error(`Failed to fetch guild channels: ${error.message}`);
    });

    for (const [, channel] of channels) {
      if (!channel || !channel.manageable) continue;
      const isText = isLockdownTextChannel(channel);
      const isVoice = isLockdownVoiceChannel(channel);
      if (!isText && !isVoice) continue;

      const perms = buildLockPermissions(isText, isVoice, options);
      const shouldSlowText = isText && typeof channel.setRateLimitPerUser === 'function' && slowmodeSeconds > 0;
      if (!Object.keys(perms).length && !shouldSlowText) continue;

      const snapshot = createChannelSnapshot(channel);
      try {
        if (Object.keys(perms).length) {
          await channel.permissionOverwrites.edit(guild.roles.everyone, perms, { reason: `Lockdown enabled by ${enabledByTag}: ${reason}` });
        }
        const bypass = await applyBypassRoleOverwrites(channel, guild, bypassRoleIds, isText, isVoice, options);
        bypassApplied += bypass.applied;
        if (bypass.failures.length) throw new Error(`Failed to apply ${bypass.failures.length} bypass overwrite(s).`);
        if (shouldSlowText) await channel.setRateLimitPerUser(slowmodeSeconds, `Lockdown enabled by ${enabledByTag}`);
        savedChannels.push(snapshot);
      } catch (error) {
        failures.push({ channelId: channel.id, channelName: channel.name || null, error: String(error?.message || error).slice(0, 250) });
        try { await restoreChannelSnapshot(channel, snapshot, 'Rolling back failed Goliath lockdown channel update'); }
        catch (rollbackError) { console.error(`[LockdownSystem] Failed immediate rollback for #${channel.name}:`, rollbackError.message); }
      }
    }

    if (!savedChannels.length) {
      return { success: false, reason: failures.length ? 'Lockdown could not be applied to any channel.' : 'No eligible channels required lockdown changes.', locked: 0, bypassApplied, failures };
    }

    if (failures.length && options.allowPartial !== true) {
      let rolledBack = 0;
      const rollbackFailures = [];
      for (const saved of savedChannels) {
        const channel = await guild.channels.fetch(saved.id).catch(() => null);
        if (!channel) continue;
        try {
          await restoreChannelSnapshot(channel, saved, 'Rolling back incomplete Goliath lockdown');
          rolledBack += 1;
        } catch (error) {
          rollbackFailures.push({ channelId: saved.id, channelName: saved.name || null, error: String(error?.message || error).slice(0, 250) });
        }
      }
      return {
        success: false,
        reason: 'Lockdown was not fully applied and has been rolled back.',
        locked: 0,
        bypassApplied: 0,
        failures,
        rolledBack,
        rollbackFailures,
      };
    }

    saveLockdownState(guild, {
      active: true,
      enabledBy,
      enabledAt,
      reason,
      lockdownMode: options.lockdownMode || null,
      severity: options.severity || null,
      lockdownStartedAt: enabledAt,
      lockdownExpiresAt,
      reminderChannelId,
      reminderUserId,
      lastReminderAt: null,
      channels: savedChannels,
      bypassRoleIds,
      failedChannels: failures,
      lastRestoreError: null,
    });
    emitCurrentLockdownState(guild, 'lockdown_enabled', { failures });
    if (reminderChannelId && reminderUserId) startLockdownReminder(guild, reminderChannelId, reminderUserId);

    const { logIncident, INCIDENT_TYPES, SEVERITY } = getIncidentLogger();
    await logIncident(guild, {
      type: INCIDENT_TYPES.LOCKDOWN_ENABLED,
      severity: options.severity || SEVERITY.HIGH,
      actorId: enabledBy,
      actorTag: enabledByTag,
      reason,
      actionTaken: failures.length ? 'Server lockdown enabled with partial coverage.' : 'Server lockdown enabled.',
      metadata: {
        lockedChannels: savedChannels.length,
        failedChannels: failures,
        bypassRoles: bypassRoleIds.length,
        lockdownMode: options.lockdownMode || null,
        severity: options.severity || null,
        slowmodeSeconds,
        lockdownStartedAt: enabledAt,
        lockdownExpiresAt,
        reminderEnabled: Boolean(reminderChannelId && reminderUserId),
        reminderChannelId,
        reminderUserId,
      },
    });

    return {
      success: true,
      alreadyActive: false,
      partial: failures.length > 0,
      locked: savedChannels.length,
      bypassApplied,
      snapshotsCreated: savedChannels.length,
      failures,
      reason,
      lockdownMode: options.lockdownMode || null,
      severity: options.severity || null,
      slowmodeSeconds,
      expiresAt: lockdownExpiresAt,
    };
  } finally {
    activeOperations.delete(guild.id);
  }
}

async function disableLockdown(guild, options = {}) {
  if (!guild) return { success: false, reason: 'Missing guild.', restored: 0, overwritesRestored: 0 };
  if (activeOperations.has(guild.id)) return { success: false, busy: true, reason: 'A lockdown operation is already running.', restored: 0, overwritesRestored: 0 };
  const state = getLockdownState(guild.id);
  if (!state.active) return { success: false, notActive: true, reason: 'Lockdown is not currently active.', restored: 0, overwritesRestored: 0 };

  activeOperations.add(guild.id);
  try {
    const disabledByTag = options.disabledByTag || 'Goliath System';
    const reason = options.reason || 'Lockdown disabled';
    let restored = 0;
    let overwritesRestored = 0;
    let missingChannels = 0;
    const remainingChannels = [];
    const failures = [];

    for (const saved of state.channels || []) {
      if (!saved?.id) continue;
      const channel = await guild.channels.fetch(saved.id).catch(() => null);
      if (!channel) {
        missingChannels += 1;
        continue;
      }
      try {
        const result = await restoreChannelSnapshot(channel, saved, `${reason} by ${disabledByTag}`);
        overwritesRestored += result.overwritesRestored;
        restored += 1;
      } catch (error) {
        remainingChannels.push(saved);
        failures.push({ channelId: saved.id, channelName: saved.name || null, error: String(error?.message || error).slice(0, 250) });
        console.warn(`[LockdownSystem] Failed to restore #${saved.name || saved.id}:`, error.message);
      }
    }

    if (remainingChannels.length) {
      saveLockdownState(guild, {
        ...state,
        active: true,
        channels: remainingChannels,
        failedChannels: failures,
        lastRestoreError: failures[0]?.error || 'One or more channels could not be restored.',
      });
      emitCurrentLockdownState(guild, 'lockdown_restore_incomplete', { failures, restored, missingChannels });
      return {
        success: false,
        partial: true,
        reason: 'Lockdown restoration is incomplete. Goliath retained the recovery snapshot and will retry.',
        restored,
        overwritesRestored,
        missingChannels,
        failures,
      };
    }

    stopLockdownReminder(guild.id);
    clearLockdownState(guild);
    emitCurrentLockdownState(guild, 'lockdown_disabled');

    const { logIncident, INCIDENT_TYPES, SEVERITY } = getIncidentLogger();
    await logIncident(guild, {
      type: INCIDENT_TYPES.LOCKDOWN_DISABLED,
      severity: SEVERITY.LOW,
      reason,
      actionTaken: options.restoredAutomatically ? 'Lockdown automatically expired and was restored.' : 'Server lockdown disabled and restored.',
      metadata: {
        restoredChannels: restored,
        overwritesRestored,
        missingChannels,
        restoredAutomatically: Boolean(options.restoredAutomatically),
        disabledByTag,
      },
      sendToOwner: false,
    });
    return { success: true, restored, overwritesRestored, missingChannels };
  } finally {
    activeOperations.delete(guild.id);
  }
}

async function restoreLockdownReminders(client) {
  if (!client) return { checked: 0, expired: 0, remindersRestored: 0, failed: 0 };
  const result = { checked: 0, expired: 0, remindersRestored: 0, failed: 0 };
  for (const [, guild] of client.guilds.cache) {
    try {
      const state = getLockdownState(guild.id);
      if (!state?.active) continue;
      result.checked += 1;
      if (state.lockdownExpiresAt && Date.now() >= Number(state.lockdownExpiresAt)) {
        const restored = await disableLockdown(guild, { reason: 'Automatic lockdown expiry', disabledByTag: 'Goliath Auto Recovery', restoredAutomatically: true });
        if (restored.success) result.expired += 1;
        else if (!restored.busy) result.failed += 1;
        continue;
      }
      if (!state.reminderChannelId || !state.reminderUserId || activeReminderIntervals.has(guild.id)) continue;
      startLockdownReminder(guild, state.reminderChannelId, state.reminderUserId);
      result.remindersRestored += 1;
      const { logIncident, INCIDENT_TYPES, SEVERITY } = getIncidentLogger();
      await logIncident(guild, {
        type: INCIDENT_TYPES.LOCKDOWN_RECOVERY_RESTORED,
        severity: SEVERITY.LOW,
        reason: 'Lockdown reminder system restored after restart.',
        actionTaken: 'Reminder interval recreated.',
        metadata: { reminderChannelId: state.reminderChannelId, reminderUserId: state.reminderUserId },
        sendToOwner: false,
      });
    } catch (error) {
      result.failed += 1;
      console.warn(`[LockdownSystem] Failed restoring guild ${guild.id}:`, error);
    }
  }
  return result;
}

function startLockdownRecoveryScheduler(client) {
  if (!client) return null;
  if (lockdownRecoveryTimer) return lockdownRecoveryTimer;
  schedulerRegistry.register({
    id: LOCKDOWN_RECOVERY_SCHEDULER_ID,
    module: 'security',
    component: 'lockdown-recovery',
    intervalMs: LOCKDOWN_RECOVERY_INTERVAL_MS,
    staleAfterMs: LOCKDOWN_RECOVERY_INTERVAL_MS * 3,
  });
  const run = async (phase = 'scheduled') => {
    try {
      const result = await restoreLockdownReminders(client);
      schedulerRegistry.beat(LOCKDOWN_RECOVERY_SCHEDULER_ID, { phase, ...result });
    } catch (error) {
      schedulerRegistry.fail(LOCKDOWN_RECOVERY_SCHEDULER_ID, error, { phase });
      console.warn('[LockdownSystem] Recovery scheduler failed:', error.message);
    }
  };
  run('startup');
  lockdownRecoveryTimer = setInterval(() => run('scheduled'), LOCKDOWN_RECOVERY_INTERVAL_MS);
  lockdownRecoveryTimer.unref?.();
  return lockdownRecoveryTimer;
}

function stopLockdownRecoveryScheduler() {
  if (lockdownRecoveryTimer) clearInterval(lockdownRecoveryTimer);
  lockdownRecoveryTimer = null;
  schedulerRegistry.stop(LOCKDOWN_RECOVERY_SCHEDULER_ID, 'lockdown recovery scheduler stopped');
}

module.exports = {
  LOCKDOWN_RECOVERY_INTERVAL_MS,
  emptyLockdownState,
  normalizeRoleIds,
  normalizeLockdownState,
  getLockdownState,
  getBypassRoleIds,
  saveLockdownState,
  clearLockdownState,
  enableLockdown,
  disableLockdown,
  restoreLockdownReminders,
  startLockdownRecoveryScheduler,
  stopLockdownRecoveryScheduler,
  getLockdownModeFromSeverity,
};
