'use strict';

const crypto = require('crypto');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'temporaryRoles';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};

function defaultSection() {
  return {
    enabled: true,
    assignments: {},
    settings: { removeExpiredOnStartup: true, auditLog: true },
    analytics: { assigned: 0, expired: 0, removed: 0, failed: 0, lastScanAt: null },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAssignment(item = {}) {
  const assignmentId = String(item.assignmentId || item.id || `tmp_${crypto.randomUUID().slice(0, 8)}`);
  return {
    assignmentId,
    memberId: cleanId(item.memberId),
    roleId: cleanId(item.roleId),
    reason: String(item.reason || 'Temporary role').trim().slice(0, 300),
    assignedBy: cleanId(item.assignedBy),
    assignedAt: item.assignedAt || now(),
    expiresAt: item.expiresAt || null,
    status: ['active', 'expired', 'removed', 'failed'].includes(item.status) ? item.status : 'active',
    lastError: item.lastError ? String(item.lastError).slice(0, 500) : null,
    updatedAt: now(),
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const assignments = section.assignments && typeof section.assignments === 'object' ? section.assignments : {};
  return {
    ...base,
    ...section,
    enabled: section.enabled !== false,
    settings: { ...base.settings, ...(section.settings || {}) },
    assignments: Object.fromEntries(Object.entries(assignments).map(([id, item]) => {
      const normalized = normalizeAssignment({ ...item, assignmentId: item.assignmentId || id });
      return [normalized.assignmentId, normalized];
    })),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, SECTION, defaultSection()));
}

function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(
    guildId,
    SECTION,
    (current) => normalizeSection(typeof updater === 'function' ? updater(clone(normalizeSection(current))) : updater),
    defaultSection(),
    meta,
  ));
}

function saveSection(guildId, section, meta = {}) {
  return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta));
}

function listAssignments(guildId, { activeOnly = false } = {}) {
  const items = Object.values(getSection(guildId).assignments);
  return (activeOnly ? items.filter((item) => item.status === 'active') : items)
    .sort((a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0));
}

function durationToMs(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Duration must be a positive number.');
  const units = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 604_800_000,
    months: 2_629_746_000,
  };
  const multiplier = units[String(unit || '').toLowerCase()];
  if (!multiplier) throw new Error('Use minutes, hours, days, weeks or months.');
  return amount * multiplier;
}

function validateRole(guild, roleId) {
  const role = guild.roles.cache.get(roleId);
  if (!role) throw new Error('The selected role no longer exists.');
  if (role.managed) throw new Error('Managed integration roles cannot be assigned.');
  const me = guild.members.me;
  if (!me?.permissions.has('ManageRoles')) throw new Error('Goliath requires Manage Roles.');
  if (role.position >= me.roles.highest.position) throw new Error(`${role.name} is above Goliath's highest role.`);
  return role;
}

async function assignTemporaryRole({ guild, memberId, roleId, value, unit, reason, assignedBy }) {
  if (getSection(guild.id).enabled === false) throw new Error('Temporary Roles is disabled.');
  const role = validateRole(guild, roleId);
  const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
  if (!member) throw new Error('The selected member could not be found.');
  if (member.user?.bot && member.id === guild.members.me?.id) throw new Error('Goliath cannot assign a temporary role to itself.');
  const expiresAt = new Date(Date.now() + durationToMs(value, unit)).toISOString();
  await member.roles.add(role, reason || 'Temporary role assigned through Role Studio');
  const assignment = normalizeAssignment({ memberId, roleId, reason, assignedBy, expiresAt, status: 'active' });
  updateSection(guild.id, (section) => ({
    ...section,
    assignments: { ...section.assignments, [assignment.assignmentId]: assignment },
    analytics: { ...section.analytics, assigned: Number(section.analytics.assigned || 0) + 1 },
    updatedAt: now(),
  }), { actorId: assignedBy });
  return assignment;
}

async function removeAssignment(guild, assignmentId, { actorId = null, expired = false } = {}) {
  const section = getSection(guild.id);
  const assignment = section.assignments[assignmentId];
  if (!assignment) throw new Error('Temporary role assignment not found.');
  const member = guild.members.cache.get(assignment.memberId) || await guild.members.fetch(assignment.memberId).catch(() => null);
  const role = guild.roles.cache.get(assignment.roleId);
  if (member && role && member.roles.cache.has(role.id)) await member.roles.remove(role, expired ? 'Temporary role expired' : 'Temporary role removed through Role Studio');
  const status = expired ? 'expired' : 'removed';
  return updateSection(guild.id, (current) => ({
    ...current,
    assignments: { ...current.assignments, [assignmentId]: { ...assignment, status, updatedAt: now(), lastError: null } },
    analytics: {
      ...current.analytics,
      [expired ? 'expired' : 'removed']: Number(current.analytics[expired ? 'expired' : 'removed'] || 0) + 1,
    },
    updatedAt: now(),
  }), { actorId }).assignments[assignmentId];
}

async function scanExpired(guild, meta = {}) {
  const section = getSection(guild.id);
  if (section.enabled === false) return { checked: 0, expired: 0, failed: 0 };
  const due = Object.values(section.assignments).filter((item) => item.status === 'active' && new Date(item.expiresAt).getTime() <= Date.now());
  let expired = 0;
  let failed = 0;
  for (const assignment of due) {
    try {
      await removeAssignment(guild, assignment.assignmentId, { actorId: meta.actorId, expired: true });
      expired += 1;
    } catch (error) {
      failed += 1;
      updateSection(guild.id, (current) => ({
        ...current,
        assignments: { ...current.assignments, [assignment.assignmentId]: { ...assignment, status: 'failed', lastError: error.message, updatedAt: now() } },
        analytics: { ...current.analytics, failed: Number(current.analytics.failed || 0) + 1 },
      }), meta);
    }
  }
  updateSection(guild.id, (current) => ({ ...current, analytics: { ...current.analytics, lastScanAt: now() }, updatedAt: now() }), meta);
  return { checked: due.length, expired, failed };
}

function setEnabled(guildId, enabled, meta = {}) {
  return updateSection(guildId, (section) => ({ ...section, enabled: Boolean(enabled), updatedAt: now() }), meta);
}

function reset(guildId, meta = {}) {
  return saveSection(guildId, defaultSection(), meta);
}

module.exports = {
  SECTION,
  getSection,
  listAssignments,
  assignTemporaryRole,
  removeAssignment,
  scanExpired,
  setEnabled,
  reset,
  durationToMs,
};