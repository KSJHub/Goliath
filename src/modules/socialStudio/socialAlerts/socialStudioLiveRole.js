'use strict';

const guildManager = require('../../../core/guild/guildManager');

let timer = null;
const RECONCILE_INTERVAL_MS = 15000;

function socialConfig(guildId) {
  return guildManager.getGuildSection(guildId, 'social', {}) || {};
}

function creatorIsLive(social, creator) {
  if (!creator || creator.enabled === false) return false;
  return (creator.accountIds || []).some((accountId) => {
    const account = social.accounts?.[accountId];
    return account && account.enabled !== false && account.state?.isLive === true;
  });
}

async function resolveGuild(client, guildId) {
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

async function resolveRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

async function resolveMember(guild, userId) {
  if (!userId) return null;
  return guild.members.cache.get(userId) || guild.members.fetch(userId).catch(() => null);
}

async function reconcileCreator(guild, social, creator, role) {
  const userId = String(creator?.ownerDiscordId || '').trim();
  if (!userId) return { creatorId: creator?.creatorId || null, skipped: 'unlinked' };

  const member = await resolveMember(guild, userId);
  if (!member) return { creatorId: creator.creatorId, userId, skipped: 'member_unavailable' };

  const shouldHaveRole = creatorIsLive(social, creator);
  const hasRole = member.roles.cache.has(role.id);
  if (shouldHaveRole === hasRole) return { creatorId: creator.creatorId, userId, live: shouldHaveRole, changed: false };

  if (!role.editable) {
    throw new Error(`Configured LIVE role ${role.id} is not manageable by Goliath.`);
  }

  if (shouldHaveRole) await member.roles.add(role.id, 'Social Studio creator went LIVE');
  else await member.roles.remove(role.id, 'Social Studio creator is no longer LIVE');

  const refreshed = await resolveMember(guild, userId);
  const confirmed = Boolean(refreshed?.roles?.cache?.has(role.id));
  if (confirmed !== shouldHaveRole) {
    throw new Error(`LIVE role state confirmation failed for creator ${creator.creatorId}.`);
  }

  return { creatorId: creator.creatorId, userId, live: shouldHaveRole, changed: true };
}

async function reconcileGuild(client, guildId) {
  const social = socialConfig(guildId);
  if (!guildManager.isModuleEnabled(guildId, 'social')) return { guildId, skipped: 'disabled' };

  const roleId = String(social.liveRoleId || '').trim();
  if (!roleId) return { guildId, skipped: 'not_configured' };

  const guild = await resolveGuild(client, guildId);
  if (!guild) return { guildId, skipped: 'guild_unavailable' };

  const role = await resolveRole(guild, roleId);
  if (!role) return { guildId, skipped: 'role_unavailable' };
  if (role.managed) return { guildId, skipped: 'managed_role' };

  const results = [];
  for (const creator of Object.values(social.creators || {})) {
    try {
      results.push(await reconcileCreator(guild, social, creator, role));
    } catch (error) {
      console.error(`[Social Studio] LIVE role reconciliation failed for creator ${creator?.creatorId || 'unknown'} in guild ${guildId}:`, error);
      results.push({ creatorId: creator?.creatorId || null, error: error?.message || String(error) });
    }
  }
  return { guildId, roleId, results };
}

async function reconcileAll(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      results.push(await reconcileGuild(client, guild.id));
    } catch (error) {
      console.error(`[Social Studio] LIVE role reconciliation failed for guild ${guild.id}:`, error);
    }
  }
  return results;
}

async function removeRoleFromCreators(client, guildId, roleId) {
  const id = String(roleId || '').trim();
  if (!id) return { guildId, removed: 0 };
  const guild = await resolveGuild(client, guildId);
  if (!guild) return { guildId, removed: 0 };
  const role = await resolveRole(guild, id);
  if (!role || role.managed || !role.editable) return { guildId, removed: 0 };

  const social = socialConfig(guildId);
  let removed = 0;
  for (const creator of Object.values(social.creators || {})) {
    const member = await resolveMember(guild, creator?.ownerDiscordId);
    if (!member?.roles?.cache?.has(id)) continue;
    await member.roles.remove(id, 'Social Studio LIVE role configuration changed').catch((error) => {
      console.error(`[Social Studio] Failed to remove previous LIVE role from ${member.id}:`, error);
    });
    const refreshed = await resolveMember(guild, member.id);
    if (!refreshed?.roles?.cache?.has(id)) removed += 1;
  }
  return { guildId, removed };
}

function start(client) {
  if (timer) return timer;
  const run = () => reconcileAll(client).catch((error) => console.error('[Social Studio] LIVE role reconciliation failed:', error));
  const initial = setTimeout(run, 8000);
  initial.unref?.();
  timer = setInterval(run, RECONCILE_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  creatorIsLive,
  reconcileGuild,
  reconcileAll,
  removeRoleFromCreators,
  start,
  stop,
};
