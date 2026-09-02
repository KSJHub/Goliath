const guildManager = require('../../core/guild/guildManager');
const antiNukeManager = require('../../core/security/protection/antiNuke');
const {
  emitSyncEvent,
} = require('../../server/sockets/socketHub');

const ROLE_SYNC_LOG_COOLDOWN_MS = 5000;
const roleSyncLogState = new Map();

function shouldLogRoleSync(guildId) {
  const now = Date.now();
  const last = roleSyncLogState.get(guildId) || 0;

  if (now - last < ROLE_SYNC_LOG_COOLDOWN_MS) {
    return false;
  }

  roleSyncLogState.set(guildId, now);
  return true;
}

async function getLiveGuild(guild) {
  if (!guild?.client || !guild?.id) {
    return null;
  }

  return guild.client.guilds.fetch(guild.id).catch(() => null);
}

function emitRoleSyncEvent(guild, event, role, extra = {}) {
  const guildId = guild?.id || role?.guild?.id;

  if (!guildId) return null;

  return emitSyncEvent(event, guildId, {
    module: 'roles',
    scope: 'roles',
    roleId: role?.id || null,
    roleName: role?.name || null,
    roleColor: role?.hexColor || null,
    rolePosition: Number.isFinite(role?.position) ? role.position : null,
    ...extra,
  });
}

async function refreshGuildRoles(guild, context = {}) {
  try {
    if (!guild) return;

    const liveGuild = await getLiveGuild(guild);

    if (!liveGuild) {
      console.warn(
        `[roleSync] Skipped ${guild.name || guild.id}: guild is not available.`
      );
      return;
    }

    await liveGuild.roles.fetch();

    if (typeof guildManager.syncGuildMeta === 'function') {
      guildManager.syncGuildMeta(liveGuild);
    }

    if (context.event && context.role) {
      emitRoleSyncEvent(liveGuild, context.event, context.role, {
        syncedAt: new Date().toISOString(),
      });
    }

    if (shouldLogRoleSync(liveGuild.id)) {
      console.log(`[roleSync] Role cache synced for ${liveGuild.name}`);
    }
  } catch (error) {
    console.error(
      `[roleSync] Failed to refresh roles for ${guild?.name || 'Unknown Guild'}:`,
      error
    );
  }
}

async function runAntiNuke(handlerName, ...args) {
  try {
    const guild = args.find((arg) => arg?.guild)?.guild || args.find((arg) => arg?.id && arg?.client?.guilds);
    if (guild?.id && !guildManager.isModuleEnabled(guild.id, 'security')) return null;

    const handler = antiNukeManager?.[handlerName];

    if (typeof handler !== 'function') {
      return null;
    }

    return await handler(...args);
  } catch (error) {
    console.error(`[roleSync] Anti-Nuke ${handlerName} failed:`, error);
    return null;
  }
}

async function handleRoleEvent({
  label,
  guild,
  antiNukeHandler,
  antiNukeArgs,
  event,
  role,
  delayMs = 0,
}) {
  try {
    if (!guild) return;

    await runAntiNuke(antiNukeHandler, ...antiNukeArgs);

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await refreshGuildRoles(guild, {
      event,
      role,
    });
  } catch (error) {
    console.error(`[roleSync] ${label} error:`, error);
  }
}

module.exports = [
  {
    name: 'roleCreate',

    async execute(role) {
      await handleRoleEvent({
        label: 'roleCreate',
        guild: role?.guild,
        antiNukeHandler: 'handleRoleCreate',
        antiNukeArgs: [role],
        event: 'role.created',
        role,
        delayMs: 2000,
      });
    },
  },

  {
    name: 'roleUpdate',

    async execute(oldRole, newRole) {
      await handleRoleEvent({
        label: 'roleUpdate',
        guild: newRole?.guild,
        antiNukeHandler: 'handleRoleUpdate',
        antiNukeArgs: [oldRole, newRole],
        event: 'role.updated',
        role: newRole,
      });
    },
  },

  {
    name: 'roleDelete',

    async execute(role) {
      await handleRoleEvent({
        label: 'roleDelete',
        guild: role?.guild,
        antiNukeHandler: 'handleRoleDelete',
        antiNukeArgs: [role],
        event: 'role.deleted',
        role,
      });
    },
  },
];