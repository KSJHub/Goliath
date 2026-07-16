'use strict';

const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'timedRoles';
const UNITS = Object.freeze(['minutes', 'hours', 'days', 'weeks', 'months', 'years']);
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const cleanText = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const createId = () => `tr_${crypto.randomUUID().slice(0, 8)}`;

function defaultSection() {
  return {
    enabled: true,
    settings: { includeBots: false, scanIntervalMinutes: 60 },
    rules: {},
    analytics: { scans: 0, membersChecked: 0, awarded: 0, removed: 0, skipped: 0, failed: 0, lastScanAt: null },
    createdAt: now(), updatedAt: now(),
  };
}

function normalizeRule(rule = {}) {
  const value = Math.max(1, Math.floor(Number(rule.value || rule.durationValue || 1)));
  const unit = UNITS.includes(String(rule.unit || rule.durationUnit).toLowerCase()) ? String(rule.unit || rule.durationUnit).toLowerCase() : 'days';
  return {
    ruleId: cleanText(rule.ruleId || rule.id, 80) || createId(),
    enabled: rule.enabled !== false,
    name: cleanText(rule.name || 'Timed role milestone', 100),
    roleId: cleanId(rule.roleId),
    value,
    unit,
    removeRoleIds: [...new Set((Array.isArray(rule.removeRoleIds) ? rule.removeRoleIds : []).map(cleanId).filter(Boolean))],
    createdBy: cleanId(rule.createdBy),
    createdAt: rule.createdAt || now(),
    updatedAt: now(),
    lastRunAt: rule.lastRunAt || null,
    lastAwarded: Math.max(0, Number(rule.lastAwarded || 0)),
    lastError: cleanText(rule.lastError, 500) || null,
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const sourceRules = section.rules && typeof section.rules === 'object' ? section.rules : {};
  return {
    ...base, ...clone(section),
    enabled: section.enabled !== false,
    settings: {
      ...base.settings,
      ...(section.settings || {}),
      includeBots: section.settings?.includeBots === true,
      scanIntervalMinutes: Math.max(5, Math.min(1440, Number(section.settings?.scanIntervalMinutes || 60))),
    },
    rules: Object.fromEntries(Object.entries(sourceRules).map(([id, rule]) => {
      const normalized = normalizeRule({ ...rule, ruleId: rule.ruleId || id });
      return [normalized.ruleId, normalized];
    })),
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
}

function getSection(guildId) { return normalizeSection(getModuleSection(guildId, SECTION, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    return normalizeSection(typeof updater === 'function' ? updater(clone(normalized)) : updater);
  }, defaultSection(), meta));
}
function listRules(guildId) { return Object.values(getSection(guildId).rules).sort((a, b) => durationRank(a) - durationRank(b)); }
function getRule(guildId, ruleId) { return getSection(guildId).rules[cleanText(ruleId, 80)] || null; }
function setEnabled(guildId, enabled, meta = {}) { return updateSection(guildId, (section) => ({ ...section, enabled: enabled === true, updatedAt: now() }), meta); }
function updateSettings(guildId, settings = {}, meta = {}) {
  return updateSection(guildId, (section) => ({ ...section, settings: { ...section.settings, ...settings }, updatedAt: now() }), meta);
}
function saveRule(guildId, input, meta = {}) {
  const normalized = normalizeRule(input);
  if (!normalized.roleId) throw new Error('A valid Discord role is required.');
  return updateSection(guildId, (section) => ({
    ...section,
    rules: { ...section.rules, [normalized.ruleId]: { ...(section.rules[normalized.ruleId] || {}), ...normalized } },
    updatedAt: now(),
  }), meta).rules[normalized.ruleId];
}
function removeRule(guildId, ruleId, meta = {}) {
  return updateSection(guildId, (section) => {
    const rules = { ...section.rules };
    delete rules[cleanText(ruleId, 80)];
    return { ...section, rules, updatedAt: now() };
  }, meta);
}

function eligibleAt(joinedAt, rule) {
  const date = new Date(joinedAt || 0);
  if (!Number.isFinite(date.getTime())) return null;
  const value = Number(rule.value || 1);
  if (rule.unit === 'minutes') date.setUTCMinutes(date.getUTCMinutes() + value);
  else if (rule.unit === 'hours') date.setUTCHours(date.getUTCHours() + value);
  else if (rule.unit === 'weeks') date.setUTCDate(date.getUTCDate() + (value * 7));
  else if (rule.unit === 'months') date.setUTCMonth(date.getUTCMonth() + value);
  else if (rule.unit === 'years') date.setUTCFullYear(date.getUTCFullYear() + value);
  else date.setUTCDate(date.getUTCDate() + value);
  return date;
}
function durationRank(rule) {
  const origin = new Date('2000-01-01T00:00:00.000Z');
  return eligibleAt(origin, rule)?.getTime() - origin.getTime() || 0;
}
function canManageRole(guild, role) {
  const me = guild?.members?.me;
  return Boolean(me && role && !role.managed && role.id !== guild.id && me.permissions.has(PermissionFlagsBits.ManageRoles) && me.roles.highest.position > role.position);
}
async function resolveRole(guild, roleId) { return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null); }

async function applyRuleToMember(member, rule) {
  if (!member?.joinedAt || !rule?.enabled) return { status: 'skipped' };
  const dueAt = eligibleAt(member.joinedAt, rule);
  if (!dueAt || Date.now() < dueAt.getTime()) return { status: 'not_due', dueAt: dueAt?.toISOString() || null };
  const role = await resolveRole(member.guild, rule.roleId);
  if (!canManageRole(member.guild, role)) throw new Error(`Goliath cannot manage role ${rule.roleId}.`);
  let awarded = false;
  const removed = [];
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Goliath timed role milestone: ${rule.value} ${rule.unit}`);
    awarded = true;
  }
  for (const roleId of rule.removeRoleIds) {
    if (!member.roles.cache.has(roleId)) continue;
    const removeRole = await resolveRole(member.guild, roleId);
    if (!canManageRole(member.guild, removeRole)) continue;
    await member.roles.remove(removeRole, `Goliath timed role progression to ${role.name}`);
    removed.push(roleId);
  }
  return { status: awarded || removed.length ? 'changed' : 'noop', awarded, removed, dueAt: dueAt.toISOString() };
}

function addAnalytics(guildId, patch, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch)) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    return { ...section, analytics, updatedAt: now() };
  }, meta).analytics;
}

function shouldScanGuild(guildId, timestamp = Date.now()) {
  const section = getSection(guildId);
  if (section.enabled === false) return false;
  const lastScan = new Date(section.analytics.lastScanAt || 0).getTime();
  if (!Number.isFinite(lastScan) || lastScan <= 0) return true;
  return timestamp - lastScan >= section.settings.scanIntervalMinutes * 60 * 1000;
}

async function scanGuild(guild, meta = {}) {
  const section = getSection(guild.id);
  if (section.enabled === false) return { guildId: guild.id, disabled: true, rules: 0, membersChecked: 0, awarded: 0, removed: 0, skipped: 0, failed: 0 };
  const rules = listRules(guild.id).filter((rule) => rule.enabled);
  if (!rules.length) return { guildId: guild.id, rules: 0, membersChecked: 0, awarded: 0, removed: 0, skipped: 0, failed: 0 };
  const members = await guild.members.fetch();
  const result = { guildId: guild.id, rules: rules.length, membersChecked: 0, awarded: 0, removed: 0, skipped: 0, failed: 0 };
  const ruleStats = new Map(rules.map((rule) => [rule.ruleId, { awarded: 0, error: null }]));
  for (const member of members.values()) {
    if (member.user?.bot && section.settings.includeBots !== true) continue;
    result.membersChecked += 1;
    for (const rule of rules) {
      try {
        const applied = await applyRuleToMember(member, rule);
        if (applied.awarded) {
          result.awarded += 1;
          ruleStats.get(rule.ruleId).awarded += 1;
        }
        result.removed += applied.removed?.length || 0;
        if (['noop', 'not_due', 'skipped'].includes(applied.status)) result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        ruleStats.get(rule.ruleId).error = error.message;
      }
    }
  }
  const scannedAt = now();
  for (const rule of rules) {
    const stats = ruleStats.get(rule.ruleId);
    saveRule(guild.id, { ...rule, lastRunAt: scannedAt, lastAwarded: stats.awarded, lastError: stats.error }, meta);
  }
  addAnalytics(guild.id, { scans: 1, membersChecked: result.membersChecked, awarded: result.awarded, removed: result.removed, skipped: result.skipped, failed: result.failed, lastScanAt: scannedAt }, meta);
  return result;
}

async function buildHealth(guild) {
  const issues = [];
  const warnings = [];
  const section = getSection(guild.id);
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Goliath requires Manage Roles.');
  for (const rule of listRules(guild.id)) {
    const role = await resolveRole(guild, rule.roleId);
    if (!role) issues.push(`${rule.name}: target role no longer exists.`);
    else if (!canManageRole(guild, role)) issues.push(`${rule.name}: target role is above Goliath or managed.`);
    for (const roleId of rule.removeRoleIds) if (!guild.roles.cache.has(roleId)) warnings.push(`${rule.name}: cleanup role ${roleId} no longer exists.`);
    if (rule.lastError) warnings.push(`${rule.name}: last scan failed — ${rule.lastError}`);
  }
  return { healthy: issues.length === 0, enabled: section.enabled, rules: listRules(guild.id).length, issues, warnings, checkedAt: now() };
}
async function repair(guild, meta = {}) {
  const section = getSection(guild.id);
  const validRules = {};
  for (const rule of listRules(guild.id)) {
    const role = await resolveRole(guild, rule.roleId);
    if (!role) continue;
    validRules[rule.ruleId] = normalizeRule({ ...rule, removeRoleIds: rule.removeRoleIds.filter((id) => guild.roles.cache.has(id)) });
  }
  return saveSection(guild.id, { ...section, rules: validRules }, meta);
}

async function startup(client) {
  if (client.__goliathTimedRolesStarted) return null;
  client.__goliathTimedRolesStarted = true;
  const run = async (force = false) => {
    const timestamp = Date.now();
    for (const guild of client.guilds.cache.values()) {
      if (!force && !shouldScanGuild(guild.id, timestamp)) continue;
      await scanGuild(guild, client).catch((error) => console.warn(`[TimedRoles] ${guild.id}: ${error.message}`));
    }
  };
  await run(true);
  const timer = setInterval(() => run(false), SCHEDULER_TICK_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  SECTION, UNITS, getSection, listRules, getRule, setEnabled, updateSettings, saveRule, removeRule,
  eligibleAt, applyRuleToMember, shouldScanGuild, scanGuild, buildHealth, repair, startup,
  exportConfiguration: getSection,
  reset: (guildId, meta = {}) => saveSection(guildId, defaultSection(), meta),
};
