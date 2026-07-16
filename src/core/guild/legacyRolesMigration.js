'use strict';

const guildManager = require('./guildManager');
const { getModuleSection, updateModuleSection } = require('./moduleSectionManager');
const autoRoles = require('../../modules/autoroles/autoroles');
const timedRoles = require('../../modules/timedroles/timedRoles');

const MIGRATION_KEY = 'legacyRolesV1';
const now = () => new Date().toISOString();
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function getMigrationState(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  return asObject(modules?._migrations)[MIGRATION_KEY] || null;
}

function normalizeLegacyPanels(value) {
  return Object.fromEntries(Object.entries(asObject(value)).filter(([, panel]) => panel && typeof panel === 'object'));
}

function legacyJoinRoleIds(value) {
  return [...new Set(Object.values(asObject(value))
    .filter((rule) => rule?.enabled !== false)
    .map((rule) => cleanId(rule?.roleId || rule?.id))
    .filter(Boolean))];
}

function legacyTimedRules(value) {
  return Object.entries(asObject(value)).map(([id, rule]) => ({
    ruleId: String(rule?.ruleId || rule?.id || id).slice(0, 80),
    enabled: rule?.enabled !== false,
    name: String(rule?.name || 'Migrated timed role').slice(0, 100),
    roleId: cleanId(rule?.roleId),
    value: Math.max(1, Math.floor(Number(rule?.afterDays || rule?.value || 1))),
    unit: rule?.unit || 'days',
    removeRoleIds: Array.isArray(rule?.removeRoleIds) ? rule.removeRoleIds : [],
    createdBy: cleanId(rule?.createdBy),
    createdAt: rule?.createdAt || now(),
    lastRunAt: rule?.lastRunAt || null,
    lastAwarded: Math.max(0, Number(rule?.lastAssignedCount || rule?.lastAwarded || 0)),
  })).filter((rule) => rule.roleId);
}

function removeLegacySection(guildId, report) {
  guildManager.updateGuildSection(guildId, 'modules', (modules = {}) => {
    const next = { ...modules };
    delete next.roles;
    next._migrations = {
      ...asObject(next._migrations),
      [MIGRATION_KEY]: {
        completedAt: now(),
        ...report,
      },
    };
    return next;
  }, {});
}

function migrateGuild(guildId, meta = {}) {
  const previous = getMigrationState(guildId);
  if (previous?.completedAt) return { guildId, alreadyMigrated: true, ...previous };

  const legacy = getModuleSection(guildId, 'roles', null);
  if (!legacy || typeof legacy !== 'object' || !Object.keys(legacy).length) {
    const report = { migrated: false, panels: 0, timedRules: 0, joinRoles: 0, skippedTimedRules: 0 };
    removeLegacySection(guildId, report);
    return { guildId, ...report };
  }

  const panels = normalizeLegacyPanels(legacy.reactionPanels);
  const timed = legacyTimedRules(legacy.timedRoles);
  const rawTimedCount = Object.keys(asObject(legacy.timedRoles)).length;
  const joinRoleIds = legacyJoinRoleIds(legacy.joinRoles);

  if (Object.keys(panels).length) {
    updateModuleSection(guildId, 'reactionRoles', (section = {}) => ({
      ...section,
      legacyButtonPanels: { ...asObject(section.legacyButtonPanels), ...panels },
      legacyButtonAnalytics: {
        assigned: Number(section.legacyButtonAnalytics?.assigned || 0) + Number(legacy.analytics?.assigned || 0),
        removed: Number(section.legacyButtonAnalytics?.removed || 0) + Number(legacy.analytics?.removed || 0),
      },
      updatedAt: now(),
    }), {}, meta);
  }

  if (timed.length) {
    for (const rule of timed) {
      if (!timedRoles.getRule(guildId, rule.ruleId)) timedRoles.saveRule(guildId, rule, meta);
    }
  }

  if (joinRoleIds.length) {
    const current = autoRoles.getAutoRolesSection(guildId);
    autoRoles.setJoinRoles(guildId, [...new Set([...current.joinRoles, ...joinRoleIds])], meta);
  }

  const report = {
    migrated: true,
    panels: Object.keys(panels).length,
    timedRules: timed.length,
    joinRoles: joinRoleIds.length,
    skippedTimedRules: Math.max(0, rawTimedCount - timed.length),
  };
  removeLegacySection(guildId, report);
  return { guildId, ...report };
}

function migrateClient(client) {
  const reports = [];
  for (const guild of client.guilds.cache.values()) {
    try { reports.push(migrateGuild(guild.id, guild)); }
    catch (error) { reports.push({ guildId: guild.id, migrated: false, error: error.message }); }
  }
  return reports;
}

module.exports = { MIGRATION_KEY, getMigrationState, migrateGuild, migrateClient };
