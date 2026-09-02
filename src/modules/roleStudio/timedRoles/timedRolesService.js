'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const base = require('./timedRoles');
const { withTimedRolesLock } = require('./timedRolesLocks');

const SECTION = base.SECTION;
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const SCHEDULER_ID = 'timedRoles:progression:global';
const now = () => new Date().toISOString();

async function resolveRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function refreshMember(guild, member) {
  return member?.id ? await guild.members.fetch(member.id).catch(() => member) : member;
}

function assertManageableMember(guild, member) {
  if (!member) throw new Error('Member could not be found.');
  if (member.id === guild.members.me?.id) throw new Error('Goliath cannot manage its own timed roles.');
  if (member.id === guild.ownerId) throw new Error('Timed roles cannot be managed on the server owner.');
  if (member.manageable === false) throw new Error(`${member.displayName || member.user?.username || 'This member'} is above Goliath and cannot be managed.`);
  return member;
}

function assertManageableRole(guild, role) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath requires Manage Roles.');
  if (!role) throw new Error('A configured Timed Roles role no longer exists.');
  if (role.id === guild.id) throw new Error('@everyone cannot be used by Timed Roles.');
  if (role.managed) throw new Error(`${role.name} is managed by an integration.`);
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}

function assertUniqueTargetRole(guildId, input = {}) {
  const roleId = String(input.roleId || '');
  if (!roleId) return;
  const ruleId = String(input.ruleId || input.id || '');
  const duplicate = base.listRules(guildId).find((rule) => rule.roleId === roleId && rule.ruleId !== ruleId);
  if (duplicate) throw new Error(`That Discord role is already used by the Timed Roles milestone “${duplicate.name}”.`);
}

function saveRule(guildId, input, meta = {}) {
  assertUniqueTargetRole(guildId, input);
  return base.saveRule(guildId, input, meta);
}

function desiredState(member, section, rules) {
  const progression = base.getMemberProgression(member, rules);
  const targetRules = section.settings.progressionMode === 'keep_all'
    ? progression.due
    : (progression.current ? [progression.current] : []);
  const targetRoleIds = new Set(targetRules.map((rule) => rule.roleId));
  const milestoneRoleIds = new Set(rules.map((rule) => rule.roleId));
  const cleanupRoleIds = new Set();
  for (const rule of targetRules) {
    for (const roleId of rule.removeRoleIds || []) {
      if (!targetRoleIds.has(roleId)) cleanupRoleIds.add(roleId);
    }
  }
  if (section.settings.progressionMode === 'highest_only') {
    for (const roleId of milestoneRoleIds) if (!targetRoleIds.has(roleId)) cleanupRoleIds.add(roleId);
  }
  return { progression, targetRules, targetRoleIds, milestoneRoleIds, cleanupRoleIds };
}

async function announcePromotion(member, rule, role, settings) {
  if (!settings.announcePromotions || !settings.announcementChannelId) return false;
  const channel = member.guild.channels.cache.get(settings.announcementChannelId)
    || await member.guild.channels.fetch(settings.announcementChannelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
  const permissions = channel.permissionsFor?.(member.guild.members.me);
  if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages))) return false;
  const message = settings.announcementMessage
    .replaceAll('{member}', `<@${member.id}>`)
    .replaceAll('{role}', `<@&${role.id}>`)
    .replaceAll('{duration}', base.formatDuration(rule))
    .replaceAll('{server}', member.guild.name);
  await channel.send({ content: message, allowedMentions: { users: [member.id], roles: [role.id] } });
  return true;
}

async function applyUnlocked(member, section = base.getSection(member.guild.id), rules = base.listRules(member.guild.id).filter((rule) => rule.enabled)) {
  const guild = member.guild;
  if (!member?.joinedAt) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  if (member.user?.bot && section.settings.includeBots !== true) return { status: 'skipped', awarded: [], removed: [], announced: 0 };
  assertManageableMember(guild, member);

  const state = desiredState(member, section, rules);
  const targetRoles = [];
  for (const rule of state.targetRules) targetRoles.push({ rule, role: assertManageableRole(guild, await resolveRole(guild, rule.roleId)) });
  const cleanupRoles = [];
  for (const roleId of state.cleanupRoleIds) {
    const role = await resolveRole(guild, roleId);
    if (!role) continue;
    cleanupRoles.push(assertManageableRole(guild, role));
  }

  const initial = await refreshMember(guild, member);
  const initiallyHeld = new Set(initial.roles.cache.keys());

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let live = await refreshMember(guild, member);
    for (const { role } of targetRoles) if (!live.roles.cache.has(role.id)) await live.roles.add(role, 'Goliath Timed Roles progression');
    live = await refreshMember(guild, live);
    for (const role of cleanupRoles) if (live.roles.cache.has(role.id)) await live.roles.remove(role, 'Goliath Timed Roles progression cleanup');
    live = await refreshMember(guild, live);

    const targetOk = targetRoles.every(({ role }) => live.roles.cache.has(role.id));
    const cleanupOk = cleanupRoles.every((role) => !live.roles.cache.has(role.id));
    if (targetOk && cleanupOk) {
      const awarded = targetRoles.map(({ role }) => role.id).filter((roleId) => !initiallyHeld.has(roleId));
      const removed = cleanupRoles.map((role) => role.id).filter((roleId) => initiallyHeld.has(roleId));
      let announced = 0;
      for (const { rule, role } of targetRoles) {
        if (!awarded.includes(role.id)) continue;
        if (await announcePromotion(live, rule, role, section.settings).catch(() => false)) announced += 1;
      }
      return { status: awarded.length || removed.length ? 'changed' : 'noop', awarded, removed, announced, progression: state.progression };
    }
  }

  throw new Error('Discord did not converge to the requested Timed Roles state.');
}

async function applyProgressionToMember(member) {
  if (!member?.guild?.id) throw new Error('Guild member is required.');
  return withTimedRolesLock(member.guild.id, async () => {
    if (!guildManager.isModuleEnabled(member.guild.id, SECTION)) throw new Error('Timed Roles is disabled.');
    const section = base.getSection(member.guild.id);
    const rules = base.listRules(member.guild.id).filter((rule) => rule.enabled);
    return applyUnlocked(member, section, rules);
  });
}

async function simulateGuild(guild) {
  const section = base.getSection(guild.id);
  const rules = base.listRules(guild.id).filter((rule) => rule.enabled);
  const members = await guild.members.fetch();
  const result = { membersChecked: 0, awards: 0, removals: 0, unchanged: 0, failed: 0, changes: [] };
  for (const member of members.values()) {
    if (member.user?.bot && section.settings.includeBots !== true) continue;
    result.membersChecked += 1;
    try {
      const state = desiredState(member, section, rules);
      const add = [...state.targetRoleIds].filter((roleId) => !member.roles.cache.has(roleId));
      const remove = [...state.cleanupRoleIds].filter((roleId) => member.roles.cache.has(roleId));
      if (add.length || remove.length) {
        result.awards += add.length;
        result.removals += remove.length;
        result.changes.push({ memberId: member.id, add, remove });
      } else result.unchanged += 1;
    } catch {
      result.failed += 1;
    }
  }
  base.updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, simulations: Number(current.analytics?.simulations || 0) + 1 } }), { action: 'timed_roles_simulation' });
  return result;
}

async function scanGuild(guild, meta = {}) {
  return withTimedRolesLock(guild.id, async () => {
    if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { guildId: guild.id, disabled: true, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const section = base.getSection(guild.id);
    const rules = base.listRules(guild.id).filter((rule) => rule.enabled);
    if (!rules.length) return { guildId: guild.id, rules: 0, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const members = await guild.members.fetch();
    const result = { guildId: guild.id, rules: rules.length, membersChecked: 0, awarded: 0, removed: 0, announced: 0, skipped: 0, failed: 0 };
    const stats = new Map(rules.map((rule) => [rule.ruleId, { awarded: 0, error: null }]));

    for (const member of members.values()) {
      if (member.user?.bot && section.settings.includeBots !== true) continue;
      result.membersChecked += 1;
      try {
        const applied = await applyUnlocked(member, section, rules);
        result.awarded += applied.awarded.length;
        result.removed += applied.removed.length;
        result.announced += applied.announced;
        for (const rule of rules) if (applied.awarded.includes(rule.roleId)) stats.get(rule.ruleId).awarded += 1;
        if (applied.status === 'noop' || applied.status === 'skipped') result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        const progression = base.getMemberProgression(member, rules);
        const affected = progression.current ? [progression.current] : [];
        for (const rule of affected) stats.get(rule.ruleId).error ||= error.message;
      }
    }

    const scannedAt = now();
    for (const rule of rules) {
      const stat = stats.get(rule.ruleId);
      base.saveRule(guild.id, { ...rule, lastRunAt: scannedAt, lastAwarded: stat.awarded, lastError: stat.error }, meta);
    }
    base.updateSection(guild.id, (current) => ({
      ...current,
      analytics: {
        ...current.analytics,
        scans: Number(current.analytics?.scans || 0) + 1,
        membersChecked: Number(current.analytics?.membersChecked || 0) + result.membersChecked,
        awarded: Number(current.analytics?.awarded || 0) + result.awarded,
        removed: Number(current.analytics?.removed || 0) + result.removed,
        announced: Number(current.analytics?.announced || 0) + result.announced,
        skipped: Number(current.analytics?.skipped || 0) + result.skipped,
        failed: Number(current.analytics?.failed || 0) + result.failed,
        lastScanAt: scannedAt,
      },
    }), { ...meta, action: meta.action || 'timed_roles_scan' });
    return result;
  });
}

async function startup(client) {
  if (client.__goliathTimedRolesStarted) return null;
  client.__goliathTimedRolesStarted = true;
  sentinelScheduler.register({ id: SCHEDULER_ID, module: SECTION, component: 'progression-scan', intervalMs: SCHEDULER_TICK_MS, staleAfterMs: Math.max(SCHEDULER_TICK_MS * 3, 180_000) });
  const run = async (force = false) => {
    const timestamp = Date.now();
    let scannedGuilds = 0; let guildFailures = 0; let memberFailures = 0;
    for (const guild of client.guilds.cache.values()) {
      if (!force && !base.shouldScanGuild(guild.id, timestamp)) continue;
      try {
        const result = await scanGuild(guild, { actorId: client.user?.id, action: force ? 'timed_roles_startup_scan' : 'timed_roles_scheduled_scan' });
        scannedGuilds += 1;
        memberFailures += Number(result?.failed || 0);
      } catch (error) {
        guildFailures += 1;
        console.warn(`[TimedRoles] ${guild.id}: ${error.message}`);
      }
    }
    if (guildFailures || memberFailures) sentinelScheduler.fail(SCHEDULER_ID, new Error(`${guildFailures} guild and ${memberFailures} member Timed Roles failure(s).`), { scannedGuilds, guildFailures, memberFailures });
    else sentinelScheduler.beat(SCHEDULER_ID, { scannedGuilds, guildFailures: 0, memberFailures: 0 });
    return { scannedGuilds, guildFailures, memberFailures };
  };
  try {
    await run(true);
  } catch (error) {
    client.__goliathTimedRolesStarted = false;
    throw error;
  }
  const timer = setInterval(() => run(false).catch((error) => console.warn(`[TimedRoles] Scheduler failed: ${error.message}`)), SCHEDULER_TICK_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  ...base,
  SECTION,
  applyProgressionToMember,
  saveRule,
  scanGuild,
  simulateGuild,
  startup,
  withTimedRolesLock,
};
