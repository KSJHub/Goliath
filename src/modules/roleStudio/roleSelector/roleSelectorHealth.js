'use strict';

const { PermissionFlagsBits } = require('discord.js');
const roleSelector = require('./roleSelector');

async function buildHealth(guild) {
  const section = roleSelector.getSection(guild.id);
  const issues = [];
  const warnings = [];
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Goliath is missing Manage Roles.');

  if (section.style.anchorRoleId) {
    const anchor = guild.roles.cache.get(section.style.anchorRoleId)
      || await guild.roles.fetch(section.style.anchorRoleId).catch(() => null);
    if (!anchor) warnings.push('The configured divider / anchor role no longer exists.');
  }

  let managedRoleCount = 0;
  for (const group of roleSelector.listGroups(guild.id)) {
    if (!group.enabled) continue;
    const ids = roleSelector.roleIdsForGroup(group);
    managedRoleCount += ids.length;
    for (const roleId of ids) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        warnings.push(`${group.name}: a stored role reference is missing.`);
        continue;
      }
      if (!roleSelector.canManageRole(guild, role)) warnings.push(`${group.name}: ${role.name} is above Goliath or otherwise unmanageable.`);
      if (role.permissions.bitfield !== 0n) warnings.push(`${group.name}: ${role.name} has permissions; selector roles should be cosmetic/self-service roles.`);
    }
  }

  if (section.deployment.channelId) {
    const channel = guild.channels.cache.get(section.deployment.channelId)
      || await guild.channels.fetch(section.deployment.channelId).catch(() => null);
    if (!channel?.send) warnings.push('The deployed Role Selector channel is missing or no longer sendable.');
  }

  const usage = await roleSelector.getUsage(guild);
  return {
    module: roleSelector.MODULE,
    healthy: issues.length === 0,
    issues,
    warnings,
    managedRoleCount,
    totalUsing: usage.totalUsing,
    groupCount: roleSelector.listGroups(guild.id).length,
    checkedAt: new Date().toISOString(),
  };
}

async function repair(guild) {
  const section = roleSelector.getSection(guild.id);
  for (const group of roleSelector.listGroups(guild.id)) {
    if (group.type === 'colour') {
      const managedRoles = { ...(group.managedRoles || {}) };
      let changed = false;
      for (const [hex, record] of Object.entries(managedRoles)) {
        const role = guild.roles.cache.get(record.roleId) || await guild.roles.fetch(record.roleId).catch(() => null);
        if (!role) { delete managedRoles[hex]; changed = true; }
      }
      if (changed) roleSelector.saveGroup(guild.id, { ...group, managedRoles }, { action: 'role_selector_health_repair' });
    } else {
      let changed = false;
      const options = (group.options || []).map((option) => {
        if (!option.roleId) return option;
        const exists = guild.roles.cache.has(option.roleId);
        if (exists) return option;
        changed = true;
        return { ...option, roleId: null, unusedSince: null };
      });
      if (changed) roleSelector.saveGroup(guild.id, { ...group, options }, { action: 'role_selector_health_repair' });
    }
  }
  if (section.style.anchorRoleId && !guild.roles.cache.has(section.style.anchorRoleId)) {
    roleSelector.updateSection(guild.id, (current) => ({ ...current, style: { ...current.style, anchorRoleId: null } }), { action: 'role_selector_health_repair' });
  }
  await roleSelector.syncManagedRoleAppearance(guild).catch(() => null);
  await roleSelector.syncManagedRoleHierarchy(guild).catch(() => null);
  return buildHealth(guild);
}

module.exports = { buildHealth, repair };
