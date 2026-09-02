'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const temporaryRoles = require('./temporaryRolesService');

const now = () => new Date().toISOString();

function canManageRole(guild, role) {
  const me = guild.members.me;
  return Boolean(
    me
    && role
    && role.id !== guild.id
    && !role.managed
    && me.permissions.has(PermissionFlagsBits.ManageRoles)
    && role.position < me.roles.highest.position
  );
}

async function buildHealth(guild) {
  const assignments = temporaryRoles.listAssignments(guild.id);
  const activeAssignments = assignments.filter((item) => item.status === 'active');
  const failedAssignments = assignments.filter((item) => item.status === 'failed');
  const issues = [];
  const warnings = [];
  const orphanedAssignmentIds = [];
  const expiredAssignmentIds = [];
  const missingRoleAssignmentIds = [];
  const duplicateAssignmentIds = [];
  const activePairs = new Map();

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    issues.push('Goliath requires Manage Roles to assign and remove temporary roles.');
  }

  for (const assignment of activeAssignments) {
    const pairKey = `${assignment.memberId || '?'}:${assignment.roleId || '?'}`;
    if (activePairs.has(pairKey)) {
      duplicateAssignmentIds.push(assignment.assignmentId);
      warnings.push(`${assignment.assignmentId}: duplicate active assignment for the same member and role.`);
    } else {
      activePairs.set(pairKey, assignment.assignmentId);
    }
  }

  for (const assignment of [...activeAssignments, ...failedAssignments]) {
    if (!assignment.memberId || !assignment.roleId || !assignment.expiresAt) {
      issues.push(`${assignment.assignmentId}: assignment data is incomplete.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
      continue;
    }

    const role = await temporaryRoles.resolveRole(guild, assignment.roleId);
    const member = await temporaryRoles.resolveMember(guild, assignment.memberId);

    if (!member) {
      warnings.push(`${assignment.assignmentId}: member ${assignment.memberId} is no longer in the server.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    } else if (member.id === guild.ownerId || member.manageable === false) {
      issues.push(`${assignment.assignmentId}: ${member.displayName || member.id} cannot be managed by Goliath.`);
    }

    if (!role) {
      warnings.push(`${assignment.assignmentId}: role ${assignment.roleId} no longer exists.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    } else if (!canManageRole(guild, role)) {
      issues.push(`${assignment.assignmentId}: role ${role.name} cannot be managed by Goliath.`);
    } else if (member && assignment.status === 'active' && !member.roles.cache.has(role.id)) {
      warnings.push(`${assignment.assignmentId}: ${member.displayName || member.user?.username || member.id} no longer has ${role.name} even though the assignment is active.`);
      missingRoleAssignmentIds.push(assignment.assignmentId);
    }

    const expiry = new Date(assignment.expiresAt).getTime();
    if (!Number.isFinite(expiry)) {
      issues.push(`${assignment.assignmentId}: expiry time is invalid.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    } else if (expiry <= Date.now() && assignment.status === 'active') {
      expiredAssignmentIds.push(assignment.assignmentId);
    }

    if (assignment.status === 'failed') {
      warnings.push(`${assignment.assignmentId}: ${assignment.lastError || 'expiry processing failed'}${assignment.nextRetryAt ? `; retry scheduled ${assignment.nextRetryAt}` : ''}.`);
    }
  }

  return {
    healthy: issues.length === 0 && warnings.length === 0,
    enabled: guildManager.isModuleEnabled(guild.id, temporaryRoles.SECTION),
    assignments: assignments.length,
    activeAssignments: activeAssignments.length,
    failedAssignments: failedAssignments.length,
    issues,
    warnings,
    orphanedAssignmentIds: [...new Set(orphanedAssignmentIds)],
    expiredAssignmentIds: [...new Set(expiredAssignmentIds)],
    missingRoleAssignmentIds: [...new Set(missingRoleAssignmentIds)],
    duplicateAssignmentIds: [...new Set(duplicateAssignmentIds)],
    checkedAt: now(),
  };
}

async function repair(guild, meta = {}) {
  const before = await buildHealth(guild);
  const result = await temporaryRoles.withTemporaryRolesLock(guild.id, async () => {
    const section = temporaryRoles.getSection(guild.id);
    const assignments = JSON.parse(JSON.stringify(section.assignments || {}));
    const archivedAssignmentIds = [];
    const restoredAssignmentIds = [];
    const duplicateAssignmentIds = [];

    for (const assignmentId of [...before.orphanedAssignmentIds, ...before.duplicateAssignmentIds]) {
      const assignment = assignments[assignmentId];
      if (!assignment || !['active', 'failed'].includes(assignment.status)) continue;
      const duplicate = before.duplicateAssignmentIds.includes(assignmentId);
      assignments[assignmentId] = {
        ...assignment,
        status: 'removed',
        removalSource: duplicate ? 'health_repair_duplicate' : 'health_repair_orphan',
        lastError: duplicate
          ? 'Archived by Temporary Roles repair because a newer canonical active assignment exists for this member and role.'
          : 'Archived by Temporary Roles repair because the member, role or expiry data is invalid.',
        retryCount: 0,
        nextRetryAt: null,
        updatedAt: now(),
      };
      archivedAssignmentIds.push(assignmentId);
      if (duplicate) duplicateAssignmentIds.push(assignmentId);
    }

    for (const assignmentId of before.missingRoleAssignmentIds) {
      const assignment = assignments[assignmentId];
      if (!assignment || assignment.status !== 'active' || archivedAssignmentIds.includes(assignmentId)) continue;
      const expiry = new Date(assignment.expiresAt).getTime();
      if (!Number.isFinite(expiry) || expiry <= Date.now()) continue;
      const member = await temporaryRoles.resolveMember(guild, assignment.memberId);
      const role = await temporaryRoles.resolveRole(guild, assignment.roleId);
      if (!member || member.id === guild.ownerId || member.manageable === false || !canManageRole(guild, role)) continue;
      await member.roles.add(role, 'Temporary Roles repair restored an active assignment');
      const refreshed = await guild.members.fetch(member.id).catch(() => member);
      if (!refreshed.roles.cache.has(role.id)) continue;
      assignments[assignmentId] = { ...assignment, lastError: null, retryCount: 0, nextRetryAt: null, updatedAt: now() };
      restoredAssignmentIds.push(assignmentId);
    }

    if (archivedAssignmentIds.length || restoredAssignmentIds.length) {
      temporaryRoles.saveSection(guild.id, {
        ...section,
        assignments,
        analytics: {
          ...section.analytics,
          failed: Number(section.analytics.failed || 0) + archivedAssignmentIds.length,
        },
        updatedAt: now(),
      }, { ...meta, action: meta.action || 'temporary_roles_health_repair' });
    }

    return { archivedAssignmentIds, duplicateAssignmentIds, restoredAssignmentIds };
  });

  const expiryResult = await temporaryRoles.scanExpired(guild, meta);
  const health = await buildHealth(guild);
  return { ...result, expiryResult, health };
}

module.exports = {
  buildHealth,
  repair,
};
