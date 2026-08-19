// src/security/lockdownSystem.js

const { ChannelType } = require('discord.js');
const guildManager = require('../guild/guildManager');
const schedulerRegistry = require('../../owner/sentinel/schedulerRegistry');

const {
  emitLockdownUpdate,
} = require('../../server/sockets/socketHub');

const activeReminderIntervals = new Map();

const REMINDER_INTERVAL_MS = 5 * 60 * 1000;
const REMINDER_DELETE_MS = 60 * 1000;

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
  };
}

function normalizeRoleIds(roleIds = []) {
  if (!Array.isArray(roleIds)) return [];

  return [
    ...new Set(
      roleIds
        .map((roleId) => String(roleId || '').trim())
        .filter((roleId) => /^\d{16,20}$/.test(roleId))
    ),
  ];
}

function normalizeLockdownState(state = {}) {
  const normalized = {
    ...emptyLockdownState(),
    ...(state || {}),
  };

  normalized.bypassRoleIds = normalizeRoleIds(normalized.bypassRoleIds);

  normalized.channels = Array.isArray(normalized.channels)
    ? normalized.channels.filter(Boolean)
    : [];

  return normalized;
}

function getIncidentLogger() {
  return require('./securitySystem');
}

function getLockdownState(guildId) {
  const security =
    guildManager.getSecurityConfig(
      guildId
    ) || {};

  const rawLockdown =
    security?.lockdown;

  if (
    !rawLockdown ||
    typeof rawLockdown !== 'object' ||
    Array.isArray(rawLockdown)
  ) {
    return normalizeLockdownState();
  }

  return normalizeLockdownState(
    rawLockdown
  );
}

function getBypassRoleIds(guildId) {
  return normalizeRoleIds(getLockdownState(guildId).bypassRoleIds);
}

function saveLockdownState(guild, lockdownData = {}) {
  const nextLockdown = normalizeLockdownState(lockdownData);

  return guildManager.updateSecurityConfig(
    guild.id,
    (security = {}) => ({
      ...security,
      lastLockdownAt: nextLockdown.active
        ? new Date().toISOString()
        : security.lastLockdownAt || null,
      lockdown: nextLockdown,
    }),
    guild
  );
}

function clearLockdownState(guild) {
  const current = getLockdownState(guild.id);

  return saveLockdownState(guild, {
    ...emptyLockdownState(),
    bypassRoleIds: current.bypassRoleIds,
  });
}

function stopLockdownReminder(guildId) {
  const interval = activeReminderIntervals.get(guildId);

  if (interval) {
    clearInterval(interval);
    activeReminderIntervals.delete(guildId);
  }

  schedulerRegistry.stop(
    lockdownReminderSchedulerId(guildId),
    'lockdown reminder stopped'
  );
}

function getTextLockPermissions() {
  return {
    SendMessages: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    AddReactions: false,
    UseApplicationCommands: false,
  };
}

function getVoiceLockPermissions() {
  return {
    Connect: false,
    Speak: false,
    Stream: false,
  };
}

function getRestorePermissions() {
  return {
    SendMessages: null,
    CreatePublicThreads: null,
    CreatePrivateThreads: null,
    SendMessagesInThreads: null,
    AddReactions: null,
    UseApplicationCommands: null,
    Connect: null,
    Speak: null,
    Stream: null,
  };
}

function getTextBypassPermissions() {
  return {
    SendMessages: true,
    AddReactions: true,
    UseApplicationCommands: true,
    SendMessagesInThreads: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
  };
}

function getVoiceBypassPermissions() {
  return {
    Connect: true,
    Speak: true,
    Stream: true,
  };
}

function getBypassRestorePermissions() {
  return {
    SendMessages: null,
    AddReactions: null,
    UseApplicationCommands: null,
    SendMessagesInThreads: null,
    CreatePublicThreads: null,
    CreatePrivateThreads: null,
    Connect: null,
    Speak: null,
    Stream: null,
  };
}

function getLockdownModeFromSeverity(severity = 'low') {
  switch (String(severity).toLowerCase()) {
    case 'critical':
      return {
        mode: 'emergency',
        slowmodeSeconds: 21600,
        lockText: true,
        lockVoice: true,
        lockThreads: true,
        lockCommands: true,
      };

    case 'high':
      return {
        mode: 'high',
        slowmodeSeconds: 3600,
        lockText: true,
        lockVoice: true,
        lockThreads: true,
        lockCommands: true,
      };

    case 'medium':
      return {
        mode: 'medium',
        slowmodeSeconds: 600,
        lockText: true,
        lockVoice: false,
        lockThreads: true,
        lockCommands: false,
      };

    case 'low':
    default:
      return {
        mode: 'low',
        slowmodeSeconds: 60,
        lockText: false,
        lockVoice: false,
        lockThreads: false,
        lockCommands: false,
      };
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

    slowmode:
      typeof channel.rateLimitPerUser === 'number'
        ? channel.rateLimitPerUser
        : 0,

    nsfw:
      typeof channel.nsfw === 'boolean'
        ? channel.nsfw
        : false,

    permissionsLocked:
      typeof channel.permissionsLocked === 'boolean'
        ? channel.permissionsLocked
        : null,

    overwrites: serializePermissionOverwrites(channel),
  };
}

function buildLockPermissions(isText, isVoice, options = {}) {
  const perms = {};

  if (isText && options.lockText !== false) {
    Object.assign(perms, getTextLockPermissions());
  }

  if (isVoice && options.lockVoice !== false) {
    Object.assign(perms, getVoiceLockPermissions());
  }

  return perms;
}

function getLockdownSlowmode(options = {}) {
  const value = Number(options.slowmodeSeconds);

  if (!Number.isFinite(value) || value < 0) {
    return 10;
  }

  return Math.min(value, 21600);
}

async function applyBypassRoleOverwrites(channel, guild, bypassRoleIds, isText, isVoice) {
  if (!bypassRoleIds.length) return 0;

  let applied = 0;

  for (const roleId of bypassRoleIds) {
    const role = guild.roles.cache.get(roleId);

    if (!role) continue;
    if (role.managed) continue;
    if (role.id === guild.id) continue;

    const bypassPerms = {};

    if (isText) Object.assign(bypassPerms, getTextBypassPermissions());
    if (isVoice) Object.assign(bypassPerms, getVoiceBypassPermissions());

    if (!Object.keys(bypassPerms).length) continue;

    try {
      await channel.permissionOverwrites.edit(role.id, bypassPerms, {
        reason: 'Goliath lockdown bypass role.',
      });

      applied++;
    } catch (error) {
      console.warn(
        `[LockdownSystem] Failed bypass overwrite for role ${role.id} in #${channel.name}:`,
        error.message
      );
    }
  }

  return applied;
}

async function restoreBypassRoleOverwrites(channel, guild, bypassRoleIds) {
  if (!bypassRoleIds.length) return 0;

  let restored = 0;

  for (const roleId of bypassRoleIds) {
    const role = guild.roles.cache.get(roleId);

    if (!role) continue;
    if (role.managed) continue;
    if (role.id === guild.id) continue;

    try {
      await channel.permissionOverwrites.edit(
        role.id,
        getBypassRestorePermissions(),
        {
          reason: 'Goliath lockdown bypass restore.',
        }
      );

      restored++;
    } catch (error) {
      console.warn(
        `[LockdownSystem] Failed bypass restore for role ${role.id} in #${channel.name}:`,
        error.message
      );
    }
  }

  return restored;
}

async function restoreOriginalOverwrites(channel, saved, reason) {
  const overwrites = Array.isArray(saved?.overwrites) ? saved.overwrites : [];

  if (!overwrites.length) {
    return 0;
  }

  let restored = 0;

  for (const overwrite of overwrites) {
    if (!overwrite?.id) continue;

    try {
      await channel.permissionOverwrites.edit(
        overwrite.id,
        {
          allow: BigInt(overwrite.allow || 0),
          deny: BigInt(overwrite.deny || 0),
        },
        {
          type: overwrite.type,
          reason,
        }
      );

      restored++;
    } catch (error) {
      console.warn(
        `[LockdownSystem] Failed restoring overwrite ${overwrite.id} in #${channel.name}:`,
        error.message
      );
    }
  }

  return restored;
}

function emitCurrentLockdownState(guild, action) {
  try {
    emitLockdownUpdate(guild.id, {
      action,
      lockdown: getLockdownState(guild.id),
    });
  } catch (error) {
    console.warn(
      '[LockdownSystem] Failed to emit lockdown update:',
      error.message
    );
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
    details: {
      reminderChannelId,
      reminderUserId,
    },
  });

  const interval = setInterval(async () => {
    try {
      const latest = getLockdownState(guild.id);

      if (!latest || !latest.active) {
        stopLockdownReminder(guild.id);
        return;
      }

      if (
        latest.lockdownExpiresAt &&
        Date.now() >= Number(latest.lockdownExpiresAt)
      ) {
        await disableLockdown(guild, {
          reason: 'Automatic lockdown expiry',
          disabledByTag: 'Goliath Auto Recovery',
          restoredAutomatically: true,
        });

        return;
      }

      const channel = await guild.channels
        .fetch(latest.reminderChannelId || reminderChannelId)
        .catch(() => null);

      if (!channel || !channel.isTextBased()) {
        schedulerRegistry.beat(schedulerId, {
          reminderSent: false,
          reason: 'reminder channel unavailable',
        });
        return;
      }

      const reminderMessage = await channel.send({
        content:
          `⚠️ <@${latest.reminderUserId || reminderUserId}> Lockdown is still **ACTIVE**. ⚠️\n` +
          `Remove the lockdown as soon as the server is secure.`,
      });

      saveLockdownState(guild, {
        ...latest,
        lastReminderAt: Date.now(),
      });

      schedulerRegistry.beat(schedulerId, {
        reminderSent: true,
        reminderChannelId: channel.id,
      });

      setTimeout(() => {
        reminderMessage.delete().catch(() => null);
      }, REMINDER_DELETE_MS);
    } catch (error) {
      schedulerRegistry.fail(schedulerId, error, {
        guildId: guild.id,
        guildName: guild.name,
      });
      console.warn('[LockdownSystem] Reminder interval failed:', error.message);
    }
  }, REMINDER_INTERVAL_MS);

  interval.unref?.();
  activeReminderIntervals.set(guild.id, interval);
  return true;
}

async function enableLockdown(guild, options = {}) {
  if (!guild) {
    return {
      success: false,
      reason: 'Missing guild.',
      locked: 0,
      bypassApplied: 0,
    };
  }

  const current = getLockdownState(guild.id);

  if (current.active) {
    return {
      success: false,
      alreadyActive: true,
      reason: 'Lockdown is already active.',
      locked: 0,
      bypassApplied: 0,
    };
  }

  const reason = options.reason || 'No reason provided';
  const enabledBy = options.enabledBy || null;
  const enabledByTag = options.enabledByTag || 'Goliath System';
  const reminderChannelId = options.reminderChannelId || null;
  const reminderUserId = options.reminderUserId || null;

  const bypassRoleIds = normalizeRoleIds(
    options.bypassRoleIds || current.bypassRoleIds
  );

  const enabledAt = Date.now();

  const lockdownExpiresAt =
    options.durationMs && Number(options.durationMs) > 0
      ? enabledAt + Number(options.durationMs)
      : null;

  const slowmodeSeconds = getLockdownSlowmode(options);

  const savedChannels = [];
  const channels = await guild.channels.fetch();

  let locked = 0;
  let bypassApplied = 0;
  let snapshotsCreated = 0;

  for (const [, channel] of channels) {
    if (!channel || !channel.manageable) continue;

    const isText =
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.GuildForum;

    const isVoice =
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice;

    if (!isText && !isVoice) continue;

    const snapshot = createChannelSnapshot(channel);
    const perms = buildLockPermissions(isText, isVoice, options);

    if (!Object.keys(perms).length) continue;

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, perms, {
        reason: `Lockdown enabled by ${enabledByTag}: ${reason}`,
      });

      const bypassCount = await applyBypassRoleOverwrites(
        channel,
        guild,
        bypassRoleIds,
        isText,
        isVoice
      );

      bypassApplied += bypassCount;

      savedChannels.push(snapshot);
      snapshotsCreated++;

      if (isText && typeof channel.setRateLimitPerUser === 'function') {
        await channel.setRateLimitPerUser(
          slowmodeSeconds,
          `Lockdown enabled by ${enabledByTag}`
        );
      }

      locked++;
    } catch (error) {
      console.warn(
        `[LockdownSystem] Failed to lock #${channel.name}:`,
        error.message
      );
    }
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
  });

  emitCurrentLockdownState(guild, 'lockdown_enabled');

  if (reminderChannelId && reminderUserId) {
    startLockdownReminder(guild, reminderChannelId, reminderUserId);
  }

  const {
    logIncident,
    INCIDENT_TYPES,
    SEVERITY,
  } = getIncidentLogger();

  await logIncident(guild, {
    type: INCIDENT_TYPES.LOCKDOWN_ENABLED,
    severity: options.severity || SEVERITY.HIGH,
    actorId: enabledBy,
    actorTag: enabledByTag,
    reason,
    actionTaken: 'Server lockdown enabled.',
    metadata: {
      lockedChannels: locked,
      snapshotsCreated,
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
    locked,
    bypassApplied,
    snapshotsCreated,
    reason,
    lockdownMode: options.lockdownMode || null,
    severity: options.severity || null,
    slowmodeSeconds,
    expiresAt: lockdownExpiresAt,
  };
}

async function disableLockdown(guild, options = {}) {
  if (!guild) {
    return {
      success: false,
      reason: 'Missing guild.',
      restored: 0,
      bypassRestored: 0,
      overwritesRestored: 0,
    };
  }

  const state = getLockdownState(guild.id);

  if (!state.active) {
    return {
      success: false,
      notActive: true,
      reason: 'Lockdown is not currently active.',
      restored: 0,
      bypassRestored: 0,
      overwritesRestored: 0,
    };
  }

  const disabledByTag = options.disabledByTag || 'Goliath System';
  const reason = options.reason || 'Lockdown disabled';
  const bypassRoleIds = normalizeRoleIds(state.bypassRoleIds);

  let restored = 0;
  let bypassRestored = 0;
  let overwritesRestored = 0;

  const savedChannels = Array.isArray(state.channels) ? state.channels : [];

  for (const saved of savedChannels) {
    if (!saved?.id) continue;

    const channel = await guild.channels.fetch(saved.id).catch(() => null);

    if (!channel || !channel.manageable) continue;

    try {
      overwritesRestored += await restoreOriginalOverwrites(
        channel,
        saved,
        `${reason} by ${disabledByTag}`
      );

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        getRestorePermissions(),
        {
          reason: `${reason} by ${disabledByTag}`,
        }
      );

      bypassRestored += await restoreBypassRoleOverwrites(
        channel,
        guild,
        bypassRoleIds
      );

      if (typeof channel.setRateLimitPerUser === 'function') {
        await channel.setRateLimitPerUser(
          typeof saved.slowmode === 'number' ? saved.slowmode : 0,
          `${reason} by ${disabledByTag}`
        );
      }

      restored++;
    } catch (error) {
      console.warn(
        `[LockdownSystem] Failed to restore #${channel.name}:`,
        error.message
      );
    }
  }

  stopLockdownReminder(guild.id);

  const {
    logIncident,
    INCIDENT_TYPES,
    SEVERITY,
  } = getIncidentLogger();

  clearLockdownState(guild);
  emitCurrentLockdownState(guild, 'lockdown_disabled');

  await logIncident(guild, {
    type: INCIDENT_TYPES.LOCKDOWN_DISABLED,
    severity: SEVERITY.LOW,
    reason,
    actionTaken: options.restoredAutomatically
      ? 'Lockdown automatically expired and was restored.'
      : 'Server lockdown disabled and restored.',
    metadata: {
      restoredChannels: restored,
      bypassRestored,
      overwritesRestored,
      restoredAutomatically: Boolean(options.restoredAutomatically),
      disabledByTag,
    },
    sendToOwner: false,
  });

  return {
    success: true,
    restored,
    bypassRestored,
    overwritesRestored,
  };
}

async function restoreLockdownReminders(client) {
  if (!client) return;

  for (const [, guild] of client.guilds.cache) {
    try {
      const state = getLockdownState(guild.id);

      if (!state || !state.active) {
        continue;
      }

      if (
        state.lockdownExpiresAt &&
        Date.now() >= Number(state.lockdownExpiresAt)
      ) {
        console.log(
          `[LockdownSystem] Auto restoring expired lockdown for ${guild.name}`
        );

        await disableLockdown(guild, {
          reason: 'Automatic lockdown expiry',
          disabledByTag: 'Goliath Auto Recovery',
          restoredAutomatically: true,
        });

        continue;
      }

      if (!state.reminderChannelId || !state.reminderUserId) continue;
      if (activeReminderIntervals.has(guild.id)) continue;

      startLockdownReminder(
        guild,
        state.reminderChannelId,
        state.reminderUserId
      );

      const {
        logIncident,
        INCIDENT_TYPES,
        SEVERITY,
      } = getIncidentLogger();

      await logIncident(guild, {
        type: INCIDENT_TYPES.LOCKDOWN_RECOVERY_RESTORED,
        severity: SEVERITY.LOW,
        reason: 'Lockdown reminder system restored after restart.',
        actionTaken: 'Reminder interval recreated.',
        metadata: {
          reminderChannelId: state.reminderChannelId,
          reminderUserId: state.reminderUserId,
        },
        sendToOwner: false,
      });

      console.log(
        `[LockdownSystem] Restored reminder interval for ${guild.name}`
      );
    } catch (error) {
      console.warn(
      `[LockdownSystem] Failed restoring guild ${guild.id}:`,
      error
    );
    }
  }
}

module.exports = {
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

  getLockdownModeFromSeverity,
};
