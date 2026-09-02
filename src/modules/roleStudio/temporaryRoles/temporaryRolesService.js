'use strict';

const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const base = require('./temporaryRoles');
const { withTemporaryRolesLock } = require('./temporaryRolesLocks');

const SECTION = base.SECTION;
const MAX_RETRY_MS = 60 * 60 * 1000;
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function cleanId(value) {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
}

function normalizedSection(guildId) {
  const section = base.getSection(guildId);
  return {
    ...section,
    analytics: {
      renewed: 0,
      departed: 0,
      externallyRemoved: 0,
      roleDeleted: 0,
      ...(section.analytics || {}),
    },
  };
}

function save(guildId, section, meta = {}) {
  return base.saveSection(guildId, { ...section, updatedAt: now() }, meta);
}

function durationToMs(value, unit) {
  const ms = base.durationToMs(value, unit);
  const expiry = Date.now() + ms;
  if (!Number.isFinite(ms) || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new Error('Duration produces an invalid expiry time.');
  }
  const date = new Date(expiry);
  if (!Number.isFinite(date.getTime())) throw new Error('Duration is too large.');
  return ms;
}

async function resolveRole(guild, roleId) {
  const id = cleanId(roleId);
  if (!id) return null;
  return guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
}

async function resolveMember(guild, memberId) {
  const id = cleanId(memberId);
  if (!id) return null;
  return guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
}

async function validateRole(guild, roleId) {
  const role = await resolveRole(guild, roleId);
  if (!role) throw new Error('The selected role no longer exists.');
  if (role.id === guild.id) throw new Error('The @everyone role cannot be assigned as a temporary role.');
  if (role.managed) throw new Error('Managed integration roles cannot be assigned.');
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Goliath requires Manage Roles.');
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}

function validateMember(guild, member) {
  if (!member) throw new Error('The selected member could not be found.');
  if (member.id === guild.members.me?.id) throw new Error('Goliath cannot assign a temporary role to itself.');
  if (member.id === guild.ownerId) throw new Error('Temporary roles cannot be managed on the server owner.');
  if (member.manageable === false) throw new Error(`${member.displayName || member.user?.username || 'This member'} is above Goliath and cannot be managed.`);
  return member;
}

function findActive(section, memberId, roleId, excludeAssignmentId = null) {
  return Object.values(section.assignments || {}).find((assignment) => (
    assignment.assignmentId !== excludeAssignmentId
    && assignment.status === 'active'
    && assignment.memberId === memberId
    && assignment.roleId === roleId
  )) || null;
}

async function refreshMember(guild, member) {
  return await guild.members.fetch(member.id).catch(() => member);
}

async function assertRolePresence(guild, member, roleId, shouldHave) {
  const live = await refreshMember(guild, member);
  const has = live.roles.cache.has(roleId);
  if (has !== shouldHave) throw new Error(`Discord did not ${shouldHave ? 'apply' : 'remove'} the temporary role as requested.`);
  return live;
}

function assignmentRecord(input = {}) {
  return {
    assignmentId: String(input.assignmentId || `tmp_${crypto.randomUUID().slice(0, 12)}`),
    memberId: cleanId(input.memberId),
    roleId: cleanId(input.roleId),
    reason: String(input.reason || 'Temporary role').trim().slice(0, 300),
    assignedBy: cleanId(input.assignedBy),
    assignedAt: input.assignedAt || now(),
    expiresAt: input.expiresAt || null,
    status: ['active', 'expired', 'removed', 'failed'].includes(input.status) ? input.status : 'active',
    lastError: input.lastError ? String(input.lastError).slice(0, 500) : null,
    retryCount: Math.max(0, Number(input.retryCount || 0)),
    nextRetryAt: input.nextRetryAt || null,
    removalSource: input.removalSource || null,
    updatedAt: now(),
  };
}

async function assignTemporaryRole({ guild, memberId, roleId, value, unit, reason, assignedBy }) {
  return withTemporaryRolesLock(guild.id, async () => {
    if (!guildManager.isModuleEnabled(guild.id, SECTION)) throw new Error('Temporary Roles is disabled.');
    const role = await validateRole(guild, roleId);
    let member = validateMember(guild, await resolveMember(guild, memberId));
    const ms = durationToMs(value, unit);
    const expiresAt = new Date(Date.now() + ms).toISOString();
    const section = normalizedSection(guild.id);
    const existing = findActive(section, member.id, role.id);

    if (existing) {
      const hadRole = member.roles.cache.has(role.id);
      try {
        if (!hadRole) await member.roles.add(role, reason || 'Temporary role restored while renewing assignment');
        member = await assertRolePresence(guild, member, role.id, true);
        const renewed = assignmentRecord({
          ...existing,
          reason: reason || existing.reason,
          assignedBy: assignedBy || existing.assignedBy,
          expiresAt,
          status: 'active',
          lastError: null,
          retryCount: 0,
          nextRetryAt: null,
        });
        save(guild.id, {
          ...section,
          assignments: { ...section.assignments, [existing.assignmentId]: renewed },
          analytics: { ...section.analytics, renewed: Number(section.analytics.renewed || 0) + 1 },
        }, { actorId: assignedBy, action: 'temporary_roles_renew' });
        return renewed;
      } catch (error) {
        if (!hadRole && member?.roles?.cache?.has(role.id)) await member.roles.remove(role, 'Temporary role renewal rollback').catch(() => null);
        throw error;
      }
    }

    if (member.roles.cache.has(role.id)) {
      throw new Error(`${member.displayName || member.user?.username || 'This member'} already has ${role.name}. Goliath will not convert an existing permanent role into a temporary assignment.`);
    }

    const assignment = assignmentRecord({ memberId: member.id, roleId: role.id, reason, assignedBy, expiresAt, status: 'active' });
    try {
      await member.roles.add(role, reason || 'Temporary role assigned through Role Studio');
      member = await assertRolePresence(guild, member, role.id, true);
      save(guild.id, {
        ...section,
        assignments: { ...section.assignments, [assignment.assignmentId]: assignment },
        analytics: { ...section.analytics, assigned: Number(section.analytics.assigned || 0) + 1 },
      }, { actorId: assignedBy, action: 'temporary_roles_assign' });
      return assignment;
    } catch (error) {
      if (member?.roles?.cache?.has(role.id)) await member.roles.remove(role, 'Temporary role assignment rollback').catch(() => null);
      throw error;
    }
  });
}

async function removeUnlocked(guild, assignmentId, { actorId = null, expired = false, source = null } = {}) {
  const section = normalizedSection(guild.id);
  const assignment = section.assignments?.[assignmentId];
  if (!assignment) throw new Error('Temporary role assignment not found.');
  if (!['active', 'failed'].includes(assignment.status)) return assignment;

  const replacement = findActive(section, assignment.memberId, assignment.roleId, assignment.assignmentId);
  let member = await resolveMember(guild, assignment.memberId);
  const role = await resolveRole(guild, assignment.roleId);
  const shouldRemove = Boolean(!replacement && member && role && member.roles.cache.has(role.id));
  let removedFromDiscord = false;

  try {
    if (shouldRemove) {
      validateMember(guild, member);
      await validateRole(guild, role.id);
      await member.roles.remove(role, expired ? 'Temporary role expired' : 'Temporary role removed through Role Studio');
      member = await assertRolePresence(guild, member, role.id, false);
      removedFromDiscord = true;
    }

    const status = expired ? 'expired' : 'removed';
    const next = assignmentRecord({
      ...assignment,
      status,
      lastError: null,
      retryCount: 0,
      nextRetryAt: null,
      removalSource: source || (expired ? 'expiry' : 'admin'),
    });
    save(guild.id, {
      ...section,
      assignments: { ...section.assignments, [assignment.assignmentId]: next },
      analytics: {
        ...section.analytics,
        [expired ? 'expired' : 'removed']: Number(section.analytics[expired ? 'expired' : 'removed'] || 0) + 1,
      },
    }, { actorId, action: expired ? 'temporary_roles_expire' : 'temporary_roles_remove' });
    return next;
  } catch (error) {
    if (removedFromDiscord && member && role && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'Temporary role removal rollback').catch(() => null);
    }
    throw error;
  }
}

async function removeAssignment(guild, assignmentId, options = {}) {
  return withTemporaryRolesLock(guild.id, () => removeUnlocked(guild, assignmentId, options));
}

function retryDelay(retryCount) {
  return Math.min(MAX_RETRY_MS, 60_000 * (2 ** Math.min(6, Math.max(0, retryCount - 1))));
}

async function scanExpired(guild, meta = {}) {
  return withTemporaryRolesLock(guild.id, async () => {
    if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { checked: 0, expired: 0, failed: 0 };
    let section = normalizedSection(guild.id);
    const currentTime = Date.now();
    const due = Object.values(section.assignments || {})
      .filter((item) => {
        if (!['active', 'failed'].includes(item.status)) return false;
        const expiry = new Date(item.expiresAt).getTime();
        if (!Number.isFinite(expiry) || expiry > currentTime) return false;
        const retryAt = new Date(item.nextRetryAt || 0).getTime();
        return item.status !== 'failed' || !Number.isFinite(retryAt) || retryAt <= currentTime;
      })
      .sort((a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0));

    let expired = 0;
    let failed = 0;
    for (const dueAssignment of due) {
      try {
        await removeUnlocked(guild, dueAssignment.assignmentId, { actorId: meta.actorId, expired: true, source: 'expiry' });
        expired += 1;
      } catch (error) {
        failed += 1;
        section = normalizedSection(guild.id);
        const latest = section.assignments?.[dueAssignment.assignmentId];
        if (!latest || !['active', 'failed'].includes(latest.status)) continue;
        const retryCount = Number(latest.retryCount || 0) + 1;
        const failedRecord = assignmentRecord({
          ...latest,
          status: 'failed',
          lastError: error.message,
          retryCount,
          nextRetryAt: new Date(Date.now() + retryDelay(retryCount)).toISOString(),
        });
        save(guild.id, {
          ...section,
          assignments: { ...section.assignments, [failedRecord.assignmentId]: failedRecord },
          analytics: { ...section.analytics, failed: Number(section.analytics.failed || 0) + 1 },
        }, { ...meta, action: 'temporary_roles_expiry_failed' });
      }
    }

    section = normalizedSection(guild.id);
    save(guild.id, { ...section, analytics: { ...section.analytics, lastScanAt: now() } }, { ...meta, action: 'temporary_roles_scan' });
    return { checked: due.length, expired, failed };
  });
}

async function handleMemberRemove(member) {
  if (!member?.guild?.id || !member.id) return { changed: 0 };
  return withTemporaryRolesLock(member.guild.id, async () => {
    const section = normalizedSection(member.guild.id);
    const assignments = clone(section.assignments || {});
    let changed = 0;
    for (const [id, assignment] of Object.entries(assignments)) {
      if (assignment.memberId !== member.id || !['active', 'failed'].includes(assignment.status)) continue;
      assignments[id] = assignmentRecord({ ...assignment, status: 'removed', lastError: null, removalSource: 'member_departed' });
      changed += 1;
    }
    if (changed) save(member.guild.id, {
      ...section,
      assignments,
      analytics: { ...section.analytics, departed: Number(section.analytics.departed || 0) + changed },
    }, { action: 'temporary_roles_member_departed' });
    return { changed };
  });
}

async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember?.guild?.id || !newMember.id) return { changed: 0 };
  const removedRoleIds = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));
  if (!removedRoleIds.length) return { changed: 0 };
  return withTemporaryRolesLock(newMember.guild.id, async () => {
    const section = normalizedSection(newMember.guild.id);
    const assignments = clone(section.assignments || {});
    let changed = 0;
    for (const [id, assignment] of Object.entries(assignments)) {
      if (assignment.memberId !== newMember.id || assignment.status !== 'active' || !removedRoleIds.includes(assignment.roleId)) continue;
      assignments[id] = assignmentRecord({ ...assignment, status: 'removed', lastError: null, removalSource: 'external_role_removal' });
      changed += 1;
    }
    if (changed) save(newMember.guild.id, {
      ...section,
      assignments,
      analytics: { ...section.analytics, externallyRemoved: Number(section.analytics.externallyRemoved || 0) + changed },
    }, { action: 'temporary_roles_external_role_removal' });
    return { changed };
  });
}

async function handleRoleDelete(role) {
  if (!role?.guild?.id || !role.id) return { changed: 0 };
  return withTemporaryRolesLock(role.guild.id, async () => {
    const section = normalizedSection(role.guild.id);
    const assignments = clone(section.assignments || {});
    let changed = 0;
    for (const [id, assignment] of Object.entries(assignments)) {
      if (assignment.roleId !== role.id || !['active', 'failed'].includes(assignment.status)) continue;
      assignments[id] = assignmentRecord({ ...assignment, status: 'removed', lastError: null, removalSource: 'role_deleted' });
      changed += 1;
    }
    if (changed) save(role.guild.id, {
      ...section,
      assignments,
      analytics: { ...section.analytics, roleDeleted: Number(section.analytics.roleDeleted || 0) + changed },
    }, { action: 'temporary_roles_role_deleted' });
    return { changed };
  });
}

function listAssignments(guildId, options) {
  return base.listAssignments(guildId, options);
}

function setEnabled(guildId, enabled, meta = {}) {
  return base.setEnabled(guildId, enabled, meta);
}

function exportConfiguration(guildId) {
  return { ...normalizedSection(guildId), enabled: guildManager.isModuleEnabled(guildId, SECTION) };
}

module.exports = {
  ...base,
  SECTION,
  assignTemporaryRole,
  durationToMs,
  exportConfiguration,
  getSection: normalizedSection,
  handleMemberRemove,
  handleMemberUpdate,
  handleRoleDelete,
  listAssignments,
  removeAssignment,
  resolveMember,
  resolveRole,
  scanExpired,
  setEnabled,
  validateMember,
  validateRole,
  withTemporaryRolesLock,
};
