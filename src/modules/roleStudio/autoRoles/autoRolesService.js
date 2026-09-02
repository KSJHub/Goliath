'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const base = require('./autoRoles');
const { withAutoRolesLock } = require('./autoRolesLocks');

const MODULE = base.MODULE;

async function fetchRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function refreshMember(guild, member) {
  if (!member?.id) return member;
  return guild.members.fetch({ user: member.id, force: true }).catch(() => guild.members.fetch(member.id).catch(() => member));
}

function assertManageableMember(member) {
  const guild = member?.guild;
  const me = guild?.members?.me;
  if (!guild || !member || !me) throw new Error('Guild member is unavailable.');
  if (member.id === me.id) throw new Error('Goliath cannot apply Auto Roles to itself.');
  if (member.id === guild.ownerId) throw new Error('Auto Roles cannot manage the server owner.');
  if (member.manageable === false || me.roles.highest.position <= member.roles.highest.position) {
    throw new Error(`${member.displayName || member.user?.username || 'This member'} is above Goliath and cannot be managed.`);
  }
  return member;
}

function assertManageableRole(guild, role) {
  const me = guild?.members?.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath requires Manage Roles.');
  if (!role) throw new Error('A configured Auto Roles role no longer exists.');
  if (role.id === guild.id) throw new Error('@everyone cannot be used by Auto Roles.');
  if (role.managed) throw new Error(`${role.name} is managed by an integration.`);
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}

async function resolveConfiguredRoles(guild, roleIds) {
  const resolved = [];
  const failures = [];
  for (const roleId of base.cleanRoleIds(roleIds || [])) {
    const role = await fetchRole(guild, roleId);
    try {
      resolved.push(assertManageableRole(guild, role));
    } catch (error) {
      failures.push({ roleId, error: error.message });
    }
  }
  return { resolved, failures };
}

async function applyUnlocked(member, options = {}) {
  const guild = member?.guild;
  if (!guild?.id || !member?.id || !guildManager.isModuleEnabled(guild.id, MODULE)) return [];
  const section = base.getAutoRolesSection(guild.id);
  if (member.user?.bot && section.settings?.applyToBots !== true) return [];

  assertManageableMember(member);
  const configuredIds = member.user?.bot ? section.botRoles || [] : section.joinRoles || [];
  const { resolved, failures } = await resolveConfiguredRoles(guild, configuredIds);
  if (!resolved.length && !failures.length) {
    base.incrementAnalytics(guild.id, {
      skipped: 1,
      membersProcessed: member.user?.bot ? 0 : 1,
      botsProcessed: member.user?.bot ? 1 : 0,
    }, { action: 'auto_roles_apply_empty' });
    return [];
  }

  let live = await refreshMember(guild, member);
  const initiallyHeld = new Set(live.roles.cache.keys());
  const targets = resolved.filter((role) => !initiallyHeld.has(role.id));
  let writeFailures = failures.length;

  for (const role of targets) {
    try {
      await live.roles.add(role, options.reason || 'Goliath Auto Roles');
      live = await refreshMember(guild, live);
      if (!live.roles.cache.has(role.id)) throw new Error(`Discord did not apply ${role.name}.`);
    } catch {
      writeFailures += 1;
    }
  }

  live = await refreshMember(guild, live);
  const addedRoles = targets.filter((role) => live.roles.cache.has(role.id));
  const skipped = resolved.filter((role) => initiallyHeld.has(role.id)).length;

  base.incrementAnalytics(guild.id, {
    assigned: addedRoles.length,
    failed: writeFailures,
    skipped,
    membersProcessed: member.user?.bot ? 0 : 1,
    botsProcessed: member.user?.bot ? 1 : 0,
  }, { action: 'auto_roles_apply' });

  return addedRoles;
}

async function applyAutoRoles(member, options = {}) {
  if (!member?.guild?.id) return [];
  return withAutoRolesLock(member.guild.id, () => applyUnlocked(member, options));
}

async function reapplyToGuild(guild, options = {}) {
  return withAutoRolesLock(guild.id, async () => {
    if (!guildManager.isModuleEnabled(guild.id, MODULE)) return { processed: 0, assigned: 0, failed: 0 };
    const section = base.getAutoRolesSection(guild.id);
    const members = await guild.members.fetch();
    let processed = 0;
    let assigned = 0;
    let failed = 0;
    for (const member of members.values()) {
      if (member.user?.bot && section.settings?.applyToBots !== true) continue;
      processed += 1;
      try {
        const roles = await applyUnlocked(member, { reason: options.reason || 'Goliath Auto Roles reapply' });
        assigned += roles.length;
      } catch {
        failed += 1;
      }
    }
    return { processed, assigned, failed };
  });
}

async function repairConfiguration(guild, meta = {}) {
  return withAutoRolesLock(guild.id, () => base.repairConfiguration(guild, { ...meta, action: meta.action || 'auto_roles_repair' }));
}

async function setConfiguredRoles(guild, type, roleIds, meta = {}) {
  return withAutoRolesLock(guild.id, async () => {
    const ids = base.cleanRoleIds(roleIds || []);
    const validation = await resolveConfiguredRoles(guild, ids);
    if (validation.failures.length) throw new Error(validation.failures[0].error);
    return type === 'bot'
      ? base.setBotRoles(guild.id, ids, meta)
      : base.setJoinRoles(guild.id, ids, meta);
  });
}

async function handleRoleDelete(role) {
  if (!role?.guild?.id || !role.id) return { changed: 0 };
  return withAutoRolesLock(role.guild.id, async () => {
    const section = base.getAutoRolesSection(role.guild.id);
    const joinRoles = (section.joinRoles || []).filter((id) => id !== role.id);
    const botRoles = (section.botRoles || []).filter((id) => id !== role.id);
    const changed = joinRoles.length !== section.joinRoles.length || botRoles.length !== section.botRoles.length;
    if (changed) base.configureAutoRoles(role.guild.id, { joinRoles, botRoles }, { action: 'auto_roles_role_deleted' });
    return { changed: changed ? 1 : 0 };
  });
}

async function startupAutoRoles(client) {
  if (!client?.guilds?.cache) return { ok: false, reason: 'Missing Discord client.', guildsChecked: 0, results: [] };
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const section = base.getAutoRolesSection(guild.id);
      const enabled = guildManager.isModuleEnabled(guild.id, MODULE);
      const health = await base.buildHealthReport(guild);
      const reapply = enabled && section.settings?.reapplyOnStartup === true
        ? await reapplyToGuild(guild, { reason: 'Goliath Auto Roles startup recovery' })
        : null;
      results.push({ guildId: guild.id, guildName: guild.name, enabled, configured: health.configured, healthy: health.healthy, notices: health.notices, warnings: health.warnings, joinRoles: health.joinRoles, botRoles: health.botRoles, reapply });
    } catch (error) {
      results.push({ guildId: guild.id, guildName: guild.name, enabled: false, configured: false, healthy: false, notices: [], warnings: [error.message || 'Auto Roles startup check failed.'], joinRoles: 0, botRoles: 0, reapply: null });
    }
  }
  return {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    configuredGuilds: results.filter((result) => result.enabled && result.configured).length,
    configuredRoles: results.reduce((total, result) => total + result.joinRoles + result.botRoles, 0),
    notices: results.reduce((total, result) => total + result.notices.length, 0),
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };
}

// Safe compatibility bridge for legacy imports used by the central member event.
// These wrappers do not call the corresponding base methods internally.
base.applyAutoRoles = applyAutoRoles;
base.reapplyToGuild = reapplyToGuild;
base.startupAutoRoles = startupAutoRoles;

module.exports = {
  ...base,
  MODULE,
  applyAutoRoles,
  handleRoleDelete,
  reapplyToGuild,
  repairConfiguration,
  setConfiguredRoles,
  startupAutoRoles,
  withAutoRolesLock,
};
