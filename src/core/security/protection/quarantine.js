const guildManager = require('../../guild/guildManager');
const { shouldBlockOwnerDestructiveAction } = require('../../../owner/dev/DevOverrideManager');

const {
  emitGuildUpdate,
} = require('../../../server/sockets/socketHub');

function emptyQuarantineState() {
  return {
    users: {},
  };
}

function getQuarantineState(guildId) {
  const security = guildManager.getSecurityConfig(guildId);
  return {
    ...emptyQuarantineState(),
    ...(security.quarantine || {}),
  };
}

function saveQuarantineState(guild, state) {
  return guildManager.updateSecurityConfig(
    guild.id,
    (security) => ({ ...security, quarantine: state }),
    guild
  );
}

function emitCurrentQuarantineState(guild, action, extra = {}) {
  try {
    emitGuildUpdate(guild.id, {
      module: 'security',
      event: 'security.quarantine.updated',
      data: {
        action,
        quarantine: getQuarantineState(guild.id),
        ...extra,
      },
    });
  } catch (error) {
    console.warn('[QuarantineSystem] Failed to emit quarantine update:', error.message);
  }
}

async function ensureQuarantineRole(guild) {
  let role = guild.roles.cache.find((entry) => entry.name === 'Goliath Quarantine');
  if (role) return role;

  role = await guild.roles.create({
    name: 'Goliath Quarantine',
    color: 0x991b1b,
    permissions: [],
    reason: 'Goliath emergency quarantine role',
  });
  return role;
}

function createQuarantineDryRunResult(guild, member, options = {}) {
  const snapshotRoles = member.roles.cache
    .filter((role) => role.id !== guild.id)
    .map((role) => role.id);

  emitCurrentQuarantineState(guild, 'member_quarantine_dry_run', {
    memberId: member.id,
    testMode: true,
    dryRun: true,
  });

  console.log(`[TEST MODE] Quarantine prevented for owner ${member.user?.tag || member.id} in guild ${guild.id}`);
  return {
    success: true,
    testMode: true,
    dryRun: true,
    action: 'quarantine',
    executed: false,
    roleId: null,
    snapshotRoles,
    memberId: member.id,
    memberTag: member.user?.tag || null,
    reason: options.reason || 'Development test override prevented owner quarantine.',
  };
}

async function quarantineMember(guild, member, options = {}) {
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };

  if (shouldBlockOwnerDestructiveAction({ guild, member, action: 'quarantine' })) {
    return createQuarantineDryRunResult(guild, member, options);
  }

  const role = await ensureQuarantineRole(guild);
  const snapshotRoles = member.roles.cache
    .filter((entry) => entry.id !== guild.id && entry.id !== role.id)
    .map((entry) => entry.id);

  try {
    await member.roles.set([role.id], options.reason || 'Goliath quarantine applied.');
    const state = getQuarantineState(guild.id);
    state.users[member.id] = {
      memberId: member.id,
      memberTag: member.user?.tag || null,
      quarantinedAt: Date.now(),
      reason: options.reason || 'No reason provided',
      roles: snapshotRoles,
      quarantinedBy: options.quarantinedBy || null,
      expiresAt: options.durationMs ? Date.now() + Number(options.durationMs) : null,
    };
    saveQuarantineState(guild, state);
    emitCurrentQuarantineState(guild, 'member_quarantined', { memberId: member.id });
    return { success: true, roleId: role.id, snapshotRoles };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function restoreQuarantinedMember(guild, member, options = {}) {
  if (!guild || !member) return { success: false, reason: 'Missing guild/member' };
  const state = getQuarantineState(guild.id);
  const snapshot = state.users?.[member.id];
  if (!snapshot) return { success: false, reason: 'No quarantine snapshot' };

  try {
    await member.roles.set(snapshot.roles, options.reason || 'Restoring quarantined member');
    delete state.users[member.id];
    saveQuarantineState(guild, state);
    emitCurrentQuarantineState(guild, 'member_restored', { memberId: member.id });
    return { success: true, restoredRoles: snapshot.roles.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function restoreExpiredQuarantines(client) {
  if (!client) return;
  for (const [, guild] of client.guilds.cache) {
    try {
      const state = getQuarantineState(guild.id);
      if (!state.users) continue;
      for (const userId of Object.keys(state.users)) {
        const snapshot = state.users[userId];
        if (!snapshot?.expiresAt || Date.now() < Number(snapshot.expiresAt)) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        console.log(`[QuarantineSystem] Auto restoring ${member.user.tag}`);
        await restoreQuarantinedMember(guild, member, { reason: 'Automatic quarantine expiry' });
      }
    } catch (error) {
      console.warn(`[QuarantineSystem] Failed restore cycle for guild ${guild.id}:`, error.message);
    }
  }
}

module.exports = {
  emptyQuarantineState,
  getQuarantineState,
  saveQuarantineState,
  ensureQuarantineRole,
  quarantineMember,
  restoreQuarantinedMember,
  restoreExpiredQuarantines,
};
