'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const timedRoles = require('./timedRoles');

const now = () => new Date().toISOString();

async function resolveRole(guild, roleId) {
  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

function canManageRole(guild, role) {
  const me = guild?.members?.me;
  return Boolean(
    me
    && role
    && !role.managed
    && role.id !== guild.id
    && me.permissions.has(PermissionFlagsBits.ManageRoles)
    && me.roles.highest.position > role.position
  );
}

async function buildTimedRolesHealth(guild) {
  if (!guild?.id) throw new Error('Guild is required.');

  const issues = [];
  const warnings = [];
  const section = timedRoles.getSection(guild.id);
  const rules = timedRoles.listRules(guild.id);
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    issues.push('Goliath requires Manage Roles.');
  }

  for (const rule of rules) {
    const role = await resolveRole(guild, rule.roleId);
    if (!role) issues.push(`${rule.name}: target role no longer exists.`);
    else if (!canManageRole(guild, role)) issues.push(`${rule.name}: target role is above Goliath or managed by an integration.`);

    for (const roleId of rule.removeRoleIds || []) {
      const cleanupRole = await resolveRole(guild, roleId);
      if (!cleanupRole) warnings.push(`${rule.name}: cleanup role ${roleId} no longer exists.`);
      else if (!canManageRole(guild, cleanupRole)) warnings.push(`${rule.name}: cleanup role ${cleanupRole.name} cannot be managed by Goliath.`);
    }

    if (rule.lastError) warnings.push(`${rule.name}: last scan failed — ${rule.lastError}`);
  }

  if (section.settings.announcePromotions) {
    const channelId = section.settings.announcementChannelId;
    const channel = channelId
      ? guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      warnings.push('Promotion announcements are enabled but the configured channel is missing or invalid.');
    } else {
      const permissions = channel.permissionsFor?.(me);
      if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
        warnings.push('Goliath cannot send promotion announcements in the configured channel.');
      }
    }
  }

  return {
    healthy: issues.length === 0,
    enabled: guildManager.isModuleEnabled(guild.id, 'timedRoles'),
    rules: rules.length,
    activeRules: rules.filter((rule) => rule.enabled !== false).length,
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    checkedAt: now(),
  };
}

async function repairTimedRoles(guild, meta = {}) {
  if (!guild?.id) throw new Error('Guild is required.');

  const section = timedRoles.getSection(guild.id);
  const removedRuleIds = [];
  const repairedRuleIds = [];

  for (const rule of timedRoles.listRules(guild.id)) {
    const targetRole = await resolveRole(guild, rule.roleId);
    if (!targetRole) {
      timedRoles.removeRule(guild.id, rule.ruleId, meta);
      removedRuleIds.push(rule.ruleId);
      continue;
    }

    const validCleanupRoleIds = [];
    for (const roleId of rule.removeRoleIds || []) {
      if (await resolveRole(guild, roleId)) validCleanupRoleIds.push(roleId);
    }

    if (validCleanupRoleIds.length !== (rule.removeRoleIds || []).length) {
      timedRoles.saveRule(guild.id, { ...rule, removeRoleIds: validCleanupRoleIds }, meta);
      repairedRuleIds.push(rule.ruleId);
    }
  }

  const settingsPatch = {};
  if (section.settings.announcementChannelId) {
    const channel = guild.channels.cache.get(section.settings.announcementChannelId)
      || await guild.channels.fetch(section.settings.announcementChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) settingsPatch.announcementChannelId = null;
  }
  if (Object.keys(settingsPatch).length) timedRoles.updateSettings(guild.id, settingsPatch, meta);

  return {
    removedRuleIds,
    repairedRuleIds,
    settingsUpdated: Object.keys(settingsPatch).length > 0,
    health: await buildTimedRolesHealth(guild),
  };
}

module.exports = {
  buildTimedRolesHealth,
  repairTimedRoles,
};