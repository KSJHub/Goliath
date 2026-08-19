'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const temporaryRoles = require('./temporaryRoles');

const now = () => new Date().toISOString();

async function resolveMember(guild, memberId) {
  return guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
}

async function resolveRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

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
  const failedAssignments = assignments.filter((item) => item.status === 'failed' && item.lastError);
  const issues = [];
  const warnings = failedAssignments.map((assignment) => `${assignment.assignmentId}: ${assignment.lastError}`);
  const orphanedAssignmentIds = [];
  const expiredAssignmentIds = [];
  const missingRoleAssignmentIds = [];

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    issues.push('Goliath requires Manage Roles to assign and remove temporary roles.');
  }

  for (const assignment of activeAssignments) {
    if (!assignment.memberId || !assignment.roleId || !assignment.expiresAt) {
      issues.push(`${assignment.assignmentId}: assignment data is incomplete.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
      continue;
    }

    const role = await resolveRole(guild, assignment.roleId);
    const member = await resolveMember(guild, assignment.memberId);

    if (!member) {
      warnings.push(`${assignment.assignmentId}: member ${assignment.memberId} is no longer in the server.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    }

    if (!role) {
      warnings.push(`${assignment.assignmentId}: role ${assignment.roleId} no longer exists.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    } else if (!canManageRole(guild, role)) {
      issues.push(`${assignment.assignmentId}: role ${role.name} cannot be managed by Goliath.`);
    } else if (member && !member.roles.cache.has(role.id)) {
      warnings.push(`${assignment.assignmentId}: ${member.displayName || member.user?.username || member.id} no longer has ${role.name} even though the assignment is active.`);
      missingRoleAssignmentIds.push(assignment.assignmentId);
    }

    const expiry = new Date(assignment.expiresAt).getTime();
    if (!Number.isFinite(expiry)) {
      issues.push(`${assignment.assignmentId}: expiry time is invalid.`);
      orphanedAssignmentIds.push(assignment.assignmentId);
    } else if (expiry <= Date.now()) {
      expiredAssignmentIds.push(assignment.assignmentId);
    }
  }

  return {
    healthy: issues.length === 0,
    enabled: guildManager.isModuleEnabled(guild.id, 'temporaryRoles'),
    assignments: assignments.length,
    activeAssignments: activeAssignments.length,
    failedAssignments: failedAssignments.length,
    issues,
    warnings,
    orphanedAssignmentIds: [...new Set(orphanedAssignmentIds)],
    expiredAssignmentIds: [...new Set(expiredAssignmentIds)],
    missingRoleAssignmentIds: [...new Set(missingRoleAssignmentIds)],
    checkedAt: now(),
  };
}

async function repair(guild, meta = {}) {
  const before = await buildHealth(guild);
  const section = temporaryRoles.getSection(guild.id);
  const assignments = { ...section.assignments };
  const archivedAssignmentIds = [];
  const restoredAssignmentIds = [];

  for (const assignmentId of before.orphanedAssignmentIds) {
    const assignment = assignments[assignmentId];
    if (!assignment || assignment.status !== 'active') continue;
    assignments[assignmentId] = {
      ...assignment,
      status: 'failed',
      lastError: 'Archived by Temporary Roles repair because the member, role or expiry data is invalid.',
      updatedAt: now(),
    };
    archivedAssignmentIds.push(assignmentId);
  }

  for (const assignmentId of before.missingRoleAssignmentIds) {
    const assignment = assignments[assignmentId];
    if (!assignment || assignment.status !== 'active' || archivedAssignmentIds.includes(assignmentId)) continue;
    const expiry = new Date(assignment.expiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= Date.now()) continue;
    const member = await resolveMember(guild, assignment.memberId);
    const role = await resolveRole(guild, assignment.roleId);
    if (!member || !canManageRole(guild, role)) continue;
    await member.roles.add(role, 'Temporary Roles repair restored an active assignment');
    assignments[assignmentId] = { ...assignment, lastError: null, updatedAt: now() };
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
    }, meta);
  }

  const expiryResult = await temporaryRoles.scanExpired(guild, meta);
  const health = await buildHealth(guild);

  return {
    archivedAssignmentIds,
    restoredAssignmentIds,
    expiryResult,
    health,
  };
}

module.exports = {
  buildHealth,
  repair,
};