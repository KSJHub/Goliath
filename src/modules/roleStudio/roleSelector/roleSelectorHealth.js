'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const roleSelector = require('./roleSelector');

async function fetchRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

async function fetchDeploymentMessage(channel, messageId) {
  if (!channel?.messages?.fetch || !messageId) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

function anchorIsUnsafe(guild, anchor) {
  const me = guild.members.me;
  if (!anchor || !me) return true;
  if (anchor.managed) return true;
  return anchor.position >= me.roles.highest.position;
}

function countStaleSelections(section) {
  let stale = 0;

  for (const selections of Object.values(section.memberSelections || {})) {
    if (!selections || typeof selections !== 'object') continue;

    for (const [groupId, rawValues] of Object.entries(selections)) {
      const group = section.groups?.[groupId];
      const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];

      if (!group) {
        stale += values.length || 1;
        continue;
      }

      if (group.type === 'colour') {
        const known = new Set(Object.keys(group.managedRoles || {}).map((hex) => roleSelector.normalizeHex(hex)).filter(Boolean));
        stale += values.filter((value) => !known.has(roleSelector.normalizeHex(value))).length;
        continue;
      }

      const known = new Set((group.options || []).map((option) => option.id));
      stale += values.filter((value) => !known.has(String(value))).length;
    }
  }

  return stale;
}

function pruneStaleSelections(section) {
  const memberSelections = JSON.parse(JSON.stringify(section.memberSelections || {}));
  let removed = 0;

  for (const [userId, selections] of Object.entries(memberSelections)) {
    if (!selections || typeof selections !== 'object') {
      delete memberSelections[userId];
      removed += 1;
      continue;
    }

    for (const [groupId, rawValues] of Object.entries(selections)) {
      const group = section.groups?.[groupId];
      const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];

      if (!group) {
        removed += values.length || 1;
        delete selections[groupId];
        continue;
      }

      if (group.type === 'colour') {
        const known = new Set(Object.keys(group.managedRoles || {}).map((hex) => roleSelector.normalizeHex(hex)).filter(Boolean));
        const next = values.map((value) => roleSelector.normalizeHex(value)).filter((value) => value && known.has(value));
        removed += Math.max(0, values.length - next.length);
        selections[groupId] = next;
        continue;
      }

      const known = new Set((group.options || []).map((option) => option.id));
      const next = values.map(String).filter((value) => known.has(value));
      removed += Math.max(0, values.length - next.length);
      selections[groupId] = next;
    }

    if (!Object.values(selections).some((value) => Array.isArray(value) ? value.length : Boolean(value))) {
      delete memberSelections[userId];
    }
  }

  return { memberSelections, removed };
}

async function buildAcceptanceReadiness(guild, section = roleSelector.getSection(guild.id)) {
  const checks = [];
  const add = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  const me = guild.members.me;
  const enabled = guildManager.isModuleEnabled(guild.id, roleSelector.MODULE);

  add('module_enabled', enabled, enabled ? 'Role Selector is enabled.' : 'Enable Role Selector before member acceptance tests.');
  add('manage_roles', me?.permissions.has(PermissionFlagsBits.ManageRoles), me?.permissions.has(PermissionFlagsBits.ManageRoles) ? 'Goliath has Manage Roles.' : 'Goliath is missing Manage Roles.');

  if (section.style.anchorRoleId) {
    const anchor = await fetchRole(guild, section.style.anchorRoleId);
    add('anchor_valid', Boolean(anchor) && !anchorIsUnsafe(guild, anchor), !anchor ? 'Configured anchor role is missing.' : anchorIsUnsafe(guild, anchor) ? 'Configured anchor is above Goliath or otherwise unusable.' : `Anchor ${anchor.name} is usable.`);
  } else {
    add('anchor_valid', false, 'No divider / anchor role is configured.');
  }

  const groups = roleSelector.listGroups(guild.id).filter((group) => group.enabled);
  add('colour_group', groups.some((group) => group.id === roleSelector.COLOUR_GROUP_ID), 'Built-in Colours selector must be enabled.');
  add('custom_group', groups.some((group) => !group.builtIn), groups.some((group) => !group.builtIn) ? 'At least one custom selector group is available.' : 'Create at least one custom group for single/multiple-choice acceptance testing.');

  if (section.deployment.channelId) {
    const channel = await fetchChannel(guild, section.deployment.channelId);
    const message = channel && section.deployment.messageId ? await fetchDeploymentMessage(channel, section.deployment.messageId) : null;
    add('deployment_channel', Boolean(channel?.send), channel?.send ? `Deployment channel ${channel.name || channel.id} is available.` : 'Deployment channel is missing or not sendable.');
    add('deployment_message', Boolean(message) && (!guild.client?.user?.id || message.author?.id === guild.client.user.id), !section.deployment.messageId ? 'No deployed message is stored yet.' : !message ? 'Stored deployed message is missing.' : guild.client?.user?.id && message.author?.id !== guild.client.user.id ? 'Stored deployment message is not owned by Goliath.' : 'Deployed Role Selector message is present and owned by Goliath.');
  } else {
    add('deployment_channel', false, 'No deployment channel is configured.');
    add('deployment_message', false, 'No deployed Role Selector message exists yet.');
  }

  const required = ['module_enabled', 'manage_roles', 'anchor_valid', 'colour_group', 'custom_group', 'deployment_channel', 'deployment_message'];
  const failed = checks.filter((check) => required.includes(check.id) && !check.passed);
  return {
    ready: failed.length === 0,
    checks,
    failed: failed.map((check) => check.id),
  };
}

async function buildHealth(guild) {
  const section = roleSelector.getSection(guild.id);
  const issues = [];
  const warnings = [];
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('Goliath is missing Manage Roles.');

  if (section.style.anchorRoleId) {
    const anchor = await fetchRole(guild, section.style.anchorRoleId);
    if (!anchor) warnings.push('The configured divider / anchor role no longer exists.');
    else if (anchorIsUnsafe(guild, anchor)) warnings.push('The configured divider / anchor role is above Goliath or otherwise unusable for selector placement.');
  }

  let managedRoleCount = 0;
  for (const group of roleSelector.listGroups(guild.id)) {
    if (!group.enabled) continue;
    const ids = roleSelector.roleIdsForGroup(group);
    managedRoleCount += ids.length;
    for (const roleId of ids) {
      const role = await fetchRole(guild, roleId);
      if (!role) {
        warnings.push(`${group.name}: a stored role reference is missing.`);
        continue;
      }
      if (!roleSelector.canManageRole(guild, role)) warnings.push(`${group.name}: ${role.name} is above Goliath or otherwise unmanageable.`);
      if (role.permissions.bitfield !== 0n) warnings.push(`${group.name}: ${role.name} has permissions; selector roles should be cosmetic/self-service roles.`);
    }
  }

  if (section.deployment.channelId) {
    const channel = await fetchChannel(guild, section.deployment.channelId);
    if (!channel?.send) {
      warnings.push('The deployed Role Selector channel is missing or no longer sendable.');
    } else if (section.deployment.messageId) {
      const message = await fetchDeploymentMessage(channel, section.deployment.messageId);
      if (!message) warnings.push('The deployed Role Selector message no longer exists.');
      else if (guild.client?.user?.id && message.author?.id !== guild.client.user.id) warnings.push('The stored Role Selector deployment message is not owned by Goliath.');
    }
  } else if (section.deployment.messageId) {
    warnings.push('A Role Selector message ID is stored without a deployment channel.');
  }

  const staleSelections = countStaleSelections(section);
  if (staleSelections) warnings.push(`${staleSelections} stale member selection reference(s) were detected.`);

  const [usage, acceptance] = await Promise.all([
    roleSelector.getUsage(guild),
    buildAcceptanceReadiness(guild, section),
  ]);
  return {
    module: roleSelector.MODULE,
    healthy: issues.length === 0,
    issues,
    warnings,
    managedRoleCount,
    totalUsing: usage.totalUsing,
    groupCount: roleSelector.listGroups(guild.id).length,
    staleSelections,
    acceptance,
    checkedAt: new Date().toISOString(),
  };
}

async function repair(guild) {
  let section = roleSelector.getSection(guild.id);

  for (const group of roleSelector.listGroups(guild.id)) {
    if (group.type === 'colour') {
      const managedRoles = { ...(group.managedRoles || {}) };
      let changed = false;
      for (const [hex, record] of Object.entries(managedRoles)) {
        const role = await fetchRole(guild, record.roleId);
        if (!role) {
          delete managedRoles[hex];
          changed = true;
        }
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

  section = roleSelector.getSection(guild.id);

  if (section.style.anchorRoleId) {
    const anchor = await fetchRole(guild, section.style.anchorRoleId);
    if (!anchor || anchorIsUnsafe(guild, anchor)) {
      roleSelector.updateSection(guild.id, (current) => ({ ...current, style: { ...current.style, anchorRoleId: null } }), { action: 'role_selector_health_repair' });
    }
  }

  section = roleSelector.getSection(guild.id);
  if (section.deployment.channelId) {
    const channel = await fetchChannel(guild, section.deployment.channelId);
    if (!channel?.send) {
      roleSelector.updateSection(guild.id, (current) => ({ ...current, deployment: { channelId: null, messageId: null } }), { action: 'role_selector_health_repair' });
    } else if (section.deployment.messageId) {
      const message = await fetchDeploymentMessage(channel, section.deployment.messageId);
      if (!message || (guild.client?.user?.id && message.author?.id !== guild.client.user.id)) {
        roleSelector.updateSection(guild.id, (current) => ({ ...current, deployment: { ...current.deployment, messageId: null } }), { action: 'role_selector_health_repair' });
      }
    }
  } else if (section.deployment.messageId) {
    roleSelector.updateSection(guild.id, (current) => ({ ...current, deployment: { channelId: null, messageId: null } }), { action: 'role_selector_health_repair' });
  }

  section = roleSelector.getSection(guild.id);
  const pruned = pruneStaleSelections(section);
  if (pruned.removed) {
    roleSelector.updateSection(guild.id, (current) => ({ ...current, memberSelections: pruned.memberSelections }), { action: 'role_selector_health_repair' });
  }

  await roleSelector.syncManagedRoleAppearance(guild).catch(() => null);
  await roleSelector.syncManagedRoleHierarchy(guild).catch(() => null);
  return buildHealth(guild);
}

module.exports = { buildAcceptanceReadiness, buildHealth, repair };
