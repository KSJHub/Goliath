'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const timedRoles = require('./timedRolesService');
const base = require('./timedRoles');

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
  const targetOwners = new Map();

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    issues.push('Goliath requires Manage Roles.');
  }

  for (const rule of rules) {
    const existingOwner = targetOwners.get(rule.roleId);
    if (existingOwner && existingOwner !== rule.ruleId) {
      issues.push(`${rule.name}: award role is also used by another Timed Roles milestone.`);
    } else if (rule.roleId) targetOwners.set(rule.roleId, rule.ruleId);

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
      if (permissions && (!permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages))) {
        warnings.push('Goliath cannot view/send promotion announcements in the configured channel.');
      }
    }
  }

  const uniqueIssues = [...new Set(issues)];
  const uniqueWarnings = [...new Set(warnings)];
  return {
    healthy: uniqueIssues.length === 0 && uniqueWarnings.length === 0,
    enabled: guildManager.isModuleEnabled(guild.id, timedRoles.SECTION),
    rules: rules.length,
    activeRules: rules.filter((rule) => rule.enabled !== false).length,
    issues: uniqueIssues,
    warnings: uniqueWarnings,
    checkedAt: now(),
  };
}

async function repairTimedRoles(guild, meta = {}) {
  if (!guild?.id) throw new Error('Guild is required.');

  return timedRoles.withTimedRolesLock(guild.id, async () => {
    const section = base.getSection(guild.id);
    const removedRuleIds = [];
    const repairedRuleIds = [];

    for (const rule of base.listRules(guild.id)) {
      const targetRole = await resolveRole(guild, rule.roleId);
      if (!targetRole) {
        base.removeRule(guild.id, rule.ruleId, { ...meta, action: meta.action || 'timed_roles_repair_missing_target' });
        removedRuleIds.push(rule.ruleId);
        continue;
      }

      const validCleanupRoleIds = [];
      for (const roleId of rule.removeRoleIds || []) {
        const cleanupRole = await resolveRole(guild, roleId);
        if (cleanupRole && canManageRole(guild, cleanupRole)) validCleanupRoleIds.push(roleId);
      }

      if (validCleanupRoleIds.length !== (rule.removeRoleIds || []).length) {
        base.saveRule(guild.id, { ...rule, removeRoleIds: validCleanupRoleIds }, { ...meta, action: meta.action || 'timed_roles_repair_cleanup_roles' });
        repairedRuleIds.push(rule.ruleId);
      }
    }

    const settingsPatch = {};
    if (section.settings.announcementChannelId) {
      const channel = guild.channels.cache.get(section.settings.announcementChannelId)
        || await guild.channels.fetch(section.settings.announcementChannelId).catch(() => null);
      const permissions = channel?.permissionsFor?.(guild.members.me);
      if (!channel?.isTextBased?.() || !permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages)) {
        settingsPatch.announcementChannelId = null;
        settingsPatch.announcePromotions = false;
      }
    }
    if (Object.keys(settingsPatch).length) base.updateSettings(guild.id, settingsPatch, { ...meta, action: meta.action || 'timed_roles_repair_settings' });

    return {
      removedRuleIds,
      repairedRuleIds,
      settingsUpdated: Object.keys(settingsPatch).length > 0,
      health: await buildTimedRolesHealth(guild),
    };
  });
}

module.exports = {
  buildTimedRolesHealth,
  repairTimedRoles,
};
