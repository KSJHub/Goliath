'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const security = require('../../../core/security/protection/core');
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

// Public Role Selector stats deployment manager. Kept in an existing Role Selector
// file so the module remains inside its current file-count boundary.
const statsSessions = new Map();
const statsRow = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const statsButton = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const statsLinkButton = (label, url) => new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link);
const statsSafePart = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const statsCustomId = (...parts) => parts.filter((part) => part !== null && part !== undefined && part !== '').join(':').slice(0, 100);
const statsCleanId = (value) => {
  const id = String(value || '').replace(/[^0-9]/g, '');
  return /^\d{15,25}$/.test(id) ? id : null;
};

function statsState(i) {
  const key = `${i.guildId}:${i.user.id}`;
  const value = statsSessions.get(key) || {};
  statsSessions.set(key, value);
  return value;
}

async function statsRespond(i, payload) {
  if (i.deferred || i.replied) return i.editReply(payload);
  return i.update(payload);
}

function normalizeStatsDeployment(raw, fallbackId = null) {
  const id = statsSafePart(raw?.id || fallbackId) || `s${Date.now().toString(36)}`;
  const mode = ['all', 'selected', 'single'].includes(raw?.mode) ? raw.mode : (Array.isArray(raw?.groupIds) && raw.groupIds.length === 1 ? 'single' : 'all');
  const topLimit = [5, 10, 25].includes(Number(raw?.topLimit)) ? Number(raw.topLimit) : 10;
  return {
    id,
    channelId: statsCleanId(raw?.channelId),
    messageId: statsCleanId(raw?.messageId),
    mode,
    groupIds: Array.isArray(raw?.groupIds) ? [...new Set(raw.groupIds.map(String))].slice(0, 25) : [],
    topLimit,
    status: raw?.status === 'retired' ? 'retired' : 'active',
    createdAt: raw?.createdAt || new Date().toISOString(),
  };
}

function statsDeploymentList(section) {
  const source = Array.isArray(section?.statsDeployments) ? section.statsDeployments : [];
  const list = source.map((item) => normalizeStatsDeployment(item));
  if (!list.length && section?.statsDeployment?.channelId) {
    list.push(normalizeStatsDeployment({
      id: 'legacy-stats',
      channelId: section.statsDeployment.channelId,
      messageId: section.statsDeployment.messageId,
      mode: 'all',
      groupIds: [],
    }));
  }
  return list;
}

function saveStatsDeployments(guildId, list, meta = {}) {
  return roleSelector.updateSection(guildId, (current) => ({
    ...current,
    statsDeployments: list.map((item) => normalizeStatsDeployment(item)),
    statsDeployment: { channelId: null, messageId: null },
  }), meta);
}

function statsDeploymentById(guildId, deploymentId) {
  return statsDeploymentList(roleSelector.getSection(guildId)).find((item) => item.id === deploymentId) || null;
}

function statsGroupIds(guildId, deployment) {
  const available = roleSelector.listGroups(guildId).filter((group) => group?.enabled !== false).map((group) => group.id);
  if (!deployment || deployment.mode === 'all') return available;
  const selected = deployment.groupIds.filter((id) => available.includes(id));
  return deployment.mode === 'single' ? selected.slice(0, 1) : selected;
}

async function fetchStatsMessage(guild, deployment) {
  if (!deployment?.channelId) return { channel: null, message: null };
  const channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId).catch(() => null);
  const message = channel?.messages?.fetch && deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  return { channel, message };
}

function statsOwned(guild, message) {
  return Boolean(message && (!guild.client?.user?.id || message.author?.id === guild.client.user.id));
}

async function usageForStatsDeployment(guild, deployment) {
  const usage = await roleSelector.getUsage(guild);
  const allowed = new Set(statsGroupIds(guild.id, deployment));
  const selectedGroups = (usage.groups || []).filter((group) => allowed.has(group.groupId));
  const memberIds = new Set(selectedGroups.flatMap((group) => (group.rows || []).flatMap((entry) => (entry.members || []).map((member) => member.id))));
  const totalSelections = selectedGroups.reduce((sum, group) => sum + (group.rows || []).reduce((groupSum, entry) => groupSum + Number(entry.count || 0), 0), 0);
  return { ...usage, groups: selectedGroups, totalUsing: memberIds.size, totalSelections };
}

function flattenStatsRows(usage) {
  const rows = [];
  for (const group of usage.groups || []) {
    for (const entry of group.rows || []) rows.push({ ...entry, groupId: group.groupId, groupName: group.name, groupEmoji: group.emoji || '🏷️' });
  }
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.label).localeCompare(String(b.label)));
  return rows;
}

async function buildPublicStatsPayloadV2(guild, deployment) {
  const usage = await usageForStatsDeployment(guild, deployment);
  const rows = flattenStatsRows(usage);
  const limit = deployment.topLimit || 10;
  const singleGroup = deployment.mode === 'single' ? usage.groups?.[0] : null;
  const lines = [
    `👥 **Members represented:** ${usage.totalUsing}`,
    `🎯 **Total selections:** ${usage.totalSelections}`,
    '',
  ];

  if (deployment.mode === 'all') {
    lines.push('**🏆 Top Choices**');
    lines.push(rows.filter((entry) => Number(entry.count || 0) > 0).slice(0, limit).map((entry, index) => `${index + 1}. ${entry.groupEmoji} **${entry.label}** — ${entry.count} · ${entry.groupName}`).join('\n') || '`No selections yet`');
  } else {
    for (const group of usage.groups || []) {
      const ranked = (group.rows || []).filter((entry) => Number(entry.count || 0) > 0).slice(0, limit);
      lines.push(`**${group.emoji || '🏷️'} ${group.name}**`);
      lines.push(ranked.map((entry, index) => `${index + 1}. ${entry.emoji || '•'} **${entry.label}** — ${entry.count}`).join('\n') || '`No selections yet`');
      lines.push('');
    }
    if (!(usage.groups || []).length) lines.push('`No groups selected`');
  }

  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(singleGroup ? `📊 ${singleGroup.emoji || '🏷️'} ${singleGroup.name} Leaderboard` : deployment.mode === 'selected' ? '📊 Role Selector · Selected Groups' : '📊 Role Selector Leaderboard')
      .setDescription(lines.join('\n').slice(0, 4096))
      .setFooter({ text: 'Role Selector • Updates automatically' })],
    components: [statsRow(
      statsButton(statsCustomId('roleSelector:statsMembers', deployment.id), '👥 View Members', ButtonStyle.Primary),
      statsButton(statsCustomId('roleSelector:statsBreakdown', deployment.id), '📋 Full Breakdown', ButtonStyle.Secondary),
    )],
  };
}

async function syncOneStatsDeployment(guild, deployment) {
  if (!deployment || deployment.status === 'retired') return { updated: false, reason: 'retired' };
  const { message } = await fetchStatsMessage(guild, deployment);
  if (!message || !statsOwned(guild, message)) return { updated: false, reason: message ? 'not_owned' : 'missing' };
  await message.edit(await buildPublicStatsPayloadV2(guild, deployment));
  return { updated: true, messageId: message.id, channelId: message.channel.id };
}

async function syncAllStatsDeployments(guild) {
  const list = statsDeploymentList(roleSelector.getSection(guild.id));
  const results = [];
  for (const deployment of list) results.push(await syncOneStatsDeployment(guild, deployment).catch((error) => ({ updated: false, reason: error.message })));
  return { updated: results.some((result) => result.updated), results };
}

function statsDeploymentSelect(guildId, selectedId = null) {
  const list = statsDeploymentList(roleSelector.getSection(guildId)).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:roleSelector:statsDeploymentSelect')
    .setPlaceholder(list.length ? 'Choose a stats panel' : 'No stats panels yet')
    .setMinValues(1)
    .setMaxValues(1);
  if (!list.length) return statsRow(menu.setDisabled(true).addOptions({ label: 'No stats panels yet', value: '__none__' }));
  menu.addOptions(list.map((item, index) => ({
    label: `Stats Panel ${index + 1}${item.status === 'retired' ? ' · Retired' : ''}`.slice(0, 100),
    value: item.id,
    description: `${item.mode === 'all' ? 'All groups' : item.mode === 'single' ? 'Single group' : 'Selected groups'} · ${item.channelId ? 'Channel selected' : 'No channel'}`.slice(0, 100),
    default: item.id === selectedId,
  })));
  return statsRow(menu);
}

function statsModeMenu(deployment) {
  return statsRow(new StringSelectMenuBuilder()
    .setCustomId(statsCustomId('admin:roleSelector:statsDeploymentMode', deployment.id))
    .setPlaceholder('Choose leaderboard layout')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'All Groups', value: 'all', description: 'Combine every enabled group', default: deployment.mode === 'all' },
      { label: 'Selected Groups', value: 'selected', description: 'Choose multiple groups for one panel', default: deployment.mode === 'selected' },
      { label: 'Single Group', value: 'single', description: 'Dedicated leaderboard for one group', default: deployment.mode === 'single' },
    ));
}

function statsGroupsMenu(guildId, deployment) {
  const list = roleSelector.listGroups(guildId).filter((group) => group?.enabled !== false).slice(0, 25);
  if (deployment.mode === 'all') {
    return statsRow(new StringSelectMenuBuilder()
      .setCustomId(statsCustomId('admin:roleSelector:statsDeploymentGroups', deployment.id))
      .setPlaceholder('All enabled groups are included')
      .setDisabled(true)
      .addOptions({ label: 'All enabled groups', value: '__all__' }));
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(statsCustomId('admin:roleSelector:statsDeploymentGroups', deployment.id))
    .setPlaceholder(deployment.mode === 'single' ? 'Choose one group' : 'Choose groups for this leaderboard')
    .setMinValues(deployment.mode === 'single' ? 1 : 0)
    .setMaxValues(deployment.mode === 'single' ? 1 : Math.max(1, list.length));
  if (!list.length) return statsRow(menu.setDisabled(true).addOptions({ label: 'No groups available', value: '__none__' }));
  menu.addOptions(list.map((group) => ({
    label: `${group.emoji || '🏷️'} ${group.name}`.slice(0, 100),
    value: group.id,
    description: (group.description || `${group.type === 'colour' ? 'Colour selector' : 'Role selector'} group`).slice(0, 100),
    default: deployment.groupIds.includes(group.id),
  })));
  return statsRow(menu);
}

function statsNav(back = 'admin:roleSelector:deployment') {
  return statsRow(
    statsButton(back, '⬅️ Back'),
    statsButton('admin:roleSelector:settings', '⚙️ Settings'),
  );
}

async function buildStatsDeploymentPanelV2(i, selectedId = null) {
  const list = statsDeploymentList(roleSelector.getSection(i.guildId));
  const selected = selectedId ? list.find((item) => item.id === selectedId) : null;

  if (!selected) {
    const lines = await Promise.all(list.map(async (item, index) => {
      const { message } = await fetchStatsMessage(i.guild, item);
      const names = statsGroupIds(i.guildId, item).map((id) => roleSelector.getGroup(i.guildId, id)?.name).filter(Boolean);
      const scope = item.mode === 'all' ? 'All groups' : item.mode === 'single' ? names[0] || 'No group selected' : names.length ? names.join(' · ') : 'No groups selected';
      return `**${index + 1}.** ${item.channelId ? `<#${item.channelId}>` : '`No channel`'} · ${message ? 'Deployed ✅' : 'Not deployed ⚠️'}\n${scope} · Top ${item.topLimit}`;
    }));
    return {
      content: null,
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector · Deploy Stats').setDescription([
        'Create independent public leaderboard panels. Each panel can show all groups, selected groups or one dedicated group.',
        '',
        lines.join('\n\n') || '`No stats panels yet`',
      ].join('\n').slice(0, 4096))],
      components: [
        statsDeploymentSelect(i.guildId),
        statsRow(statsButton('admin:roleSelector:statsDeploymentCreate', '➕ Create Stats Panel', ButtonStyle.Success)),
        statsNav('admin:roleSelector:deployment'),
      ],
    };
  }

  const { message } = await fetchStatsMessage(i.guild, selected);
  const channelName = selected.channelId ? i.guild.channels.cache.get(selected.channelId)?.name : null;
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(statsCustomId('admin:roleSelector:statsDeploymentChannel', selected.id))
    .setPlaceholder(channelName ? `Current: #${channelName} · choose to change` : 'Choose stats channel')
    .setMinValues(1).setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const names = statsGroupIds(i.guildId, selected).map((id) => roleSelector.getGroup(i.guildId, id)?.name).filter(Boolean);
  const scope = selected.mode === 'all' ? 'All enabled groups' : names.length ? names.join(' · ') : '`None selected`';
  const jump = message ? `https://discord.com/channels/${i.guildId}/${message.channel.id}/${message.id}` : null;
  const canDeploy = Boolean(selected.channelId && (selected.mode === 'all' || selected.groupIds.length));

  return {
    content: null,
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📊 Role Selector · Manage Stats Panel').setDescription([
      `**Channel:** ${selected.channelId ? `<#${selected.channelId}>` : '`Not selected`'}`,
      `**Message:** ${message ? 'Deployed ✅' : 'Not deployed'}`,
      `**Layout:** ${selected.mode === 'all' ? 'All Groups' : selected.mode === 'single' ? 'Single Group' : 'Selected Groups'}`,
      `**Groups:** ${scope}`,
      `**Ranking:** Top ${selected.topLimit}`,
      '',
      'Public panels update automatically and include member drill-down controls for normal users.',
    ].join('\n').slice(0, 4096))],
    components: [
      statsRow(channelMenu),
      statsModeMenu(selected),
      statsGroupsMenu(i.guildId, selected),
      statsRow(
        statsButton(statsCustomId('admin:roleSelector:statsDeploymentLimit', selected.id), `🏆 Top ${selected.topLimit}`, ButtonStyle.Primary),
        statsButton(statsCustomId('admin:roleSelector:statsDeploy', selected.id), message ? '🔄 Update Stats Panel' : '📨 Deploy Stats Panel', ButtonStyle.Success, !canDeploy),
        jump ? statsLinkButton('↗️ Jump to Panel', jump) : null,
        statsButton(statsCustomId('admin:roleSelector:statsDeploymentDelete', selected.id), '🗑️ Delete', ButtonStyle.Danger),
      ),
      statsNav('admin:roleSelector:statsPublic'),
    ],
  };
}

async function deployStatsPanelV2(i, deploymentId) {
  const list = statsDeploymentList(roleSelector.getSection(i.guildId));
  const index = list.findIndex((item) => item.id === deploymentId);
  if (index < 0) throw new Error('Create a stats panel first.');
  const deployment = list[index];
  if (!deployment.channelId) throw new Error('Choose a stats channel first.');
  if (deployment.mode !== 'all' && !deployment.groupIds.length) throw new Error('Choose at least one group for this stats panel.');
  const channel = i.guild.channels.cache.get(deployment.channelId) || await i.guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel?.send) throw new Error('Choose a sendable text channel.');
  let message = deployment.messageId ? await channel.messages.fetch(deployment.messageId).catch(() => null) : null;
  if (message && !statsOwned(i.guild, message)) message = null;
  message = message ? await message.edit(await buildPublicStatsPayloadV2(i.guild, deployment)) : await channel.send(await buildPublicStatsPayloadV2(i.guild, deployment));
  list[index] = { ...deployment, messageId: message.id, status: 'active' };
  saveStatsDeployments(i.guildId, list, { actorId: i.user.id, action: 'role_selector_stats_deploy' });
  return message;
}

async function deleteStatsPanelV2(i, deploymentId) {
  const list = statsDeploymentList(roleSelector.getSection(i.guildId));
  const index = list.findIndex((item) => item.id === deploymentId);
  if (index < 0) throw new Error('Choose a stats panel first.');
  const deployment = list[index];
  const { message } = await fetchStatsMessage(i.guild, deployment);
  if (message) {
    if (!statsOwned(i.guild, message)) throw new Error('Goliath will not delete a message it does not own.');
    await message.delete();
  }
  list.splice(index, 1);
  saveStatsDeployments(i.guildId, list, { actorId: i.user.id, action: 'role_selector_stats_deployment_delete' });
}

async function buildMemberLeaderboardV2(guild, deploymentId, page = 0) {
  const deployment = statsDeploymentById(guild.id, deploymentId);
  if (!deployment) throw new Error('That stats panel no longer exists.');
  const usage = await usageForStatsDeployment(guild, deployment);
  const memberMap = new Map();

  for (const group of usage.groups || []) {
    for (const choice of group.rows || []) {
      for (const member of choice.members || []) {
        const current = memberMap.get(member.id) || { id: member.id, name: member.name, choices: [] };
        current.choices.push({ groupName: group.name, groupEmoji: group.emoji || '🏷️', label: choice.label, emoji: choice.emoji || '•' });
        memberMap.set(member.id, current);
      }
    }
  }

  const members = [...memberMap.values()].sort((a, b) => b.choices.length - a.choices.length || String(a.name).localeCompare(String(b.name)));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(members.length / pageSize));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const visible = members.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const lines = [];

  visible.forEach((member, index) => {
    const shown = member.choices.slice(0, 6).map((choice) => `${choice.groupEmoji} ${choice.label}`);
    if (member.choices.length > shown.length) shown.push(`+${member.choices.length - shown.length} more`);
    lines.push(`${safePage * pageSize + index + 1}. <@${member.id}> — **${member.choices.length} choice${member.choices.length === 1 ? '' : 's'}**`);
    lines.push(`   └ ${shown.join(' · ') || 'No current choices'}`);
  });

  return {
    allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Role Selector · Member Leaderboard').setDescription([
      `**Members represented:** ${members.length}`,
      totalPages > 1 ? `**Page:** ${safePage + 1}/${totalPages}` : '',
      '',
      lines.join('\n') || '`No members have made a selection yet.`',
    ].filter(Boolean).join('\n').slice(0, 4096))],
    components: [
      statsRow(
        statsButton(statsCustomId('roleSelector:statsMemberLeaderboardPage', deployment.id, safePage - 1), '⬅️ Previous', ButtonStyle.Secondary, safePage <= 0),
        statsButton(statsCustomId('roleSelector:statsChoicePicker', deployment.id), '🎯 View By Choice', ButtonStyle.Primary),
        statsButton(statsCustomId('roleSelector:statsMemberLeaderboardPage', deployment.id, safePage + 1), 'Next ➡️', ButtonStyle.Secondary, safePage >= totalPages - 1),
      ),
      statsRow(statsButton(statsCustomId('roleSelector:statsBreakdown', deployment.id), '📋 Full Breakdown', ButtonStyle.Secondary)),
    ],
  };
}

async function buildChoicePickerV2(guild, deploymentId, page = 0) {
  const deployment = statsDeploymentById(guild.id, deploymentId);
  if (!deployment) throw new Error('That stats panel no longer exists.');
  const usage = await usageForStatsDeployment(guild, deployment);
  const choices = flattenStatsRows(usage).filter((entry) => Number(entry.count || 0) > 0);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(choices.length / pageSize));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const visible = choices.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const components = [];

  if (visible.length) {
    components.push(statsRow(new StringSelectMenuBuilder()
      .setCustomId(statsCustomId('roleSelector:statsMemberChoice', deployment.id, safePage))
      .setPlaceholder('Choose a role or choice to view members')
      .setMinValues(1).setMaxValues(1)
      .addOptions(visible.map((entry) => ({
        label: `${entry.groupEmoji} ${entry.label}`.slice(0, 100),
        value: `${entry.groupId}|${encodeURIComponent(String(entry.id))}`.slice(0, 100),
        description: `${entry.groupName} · ${entry.count} member${Number(entry.count) === 1 ? '' : 's'}`.slice(0, 100),
      })))));
  }

  if (totalPages > 1) {
    components.push(statsRow(
      statsButton(statsCustomId('roleSelector:statsChoicePickerPage', deployment.id, safePage - 1), '⬅️ Previous', ButtonStyle.Secondary, safePage <= 0),
      statsButton(statsCustomId('roleSelector:statsChoicePickerPage', deployment.id, safePage + 1), 'Next ➡️', ButtonStyle.Secondary, safePage >= totalPages - 1),
    ));
  }
  components.push(statsRow(
    statsButton(statsCustomId('roleSelector:statsMembers', deployment.id), '👥 Member Leaderboard', ButtonStyle.Primary),
    statsButton(statsCustomId('roleSelector:statsBreakdown', deployment.id), '📋 Full Breakdown', ButtonStyle.Secondary),
  ));

  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎯 Role Selector · View By Choice').setDescription([
      choices.length ? 'Choose any leaderboard entry below to see the members who currently selected it.' : '`No selections have been made on this leaderboard yet.`',
      totalPages > 1 ? `\n**Choices page:** ${safePage + 1}/${totalPages}` : '',
    ].join('\n'))],
    components,
  };
}

async function buildChoiceMembersV2(guild, deploymentId, groupId, optionId, page = 0) {
  const deployment = statsDeploymentById(guild.id, deploymentId);
  if (!deployment) throw new Error('That stats panel no longer exists.');
  const usage = await usageForStatsDeployment(guild, deployment);
  const group = (usage.groups || []).find((entry) => entry.groupId === groupId);
  const choice = (group?.rows || []).find((entry) => String(entry.id) === String(optionId));
  if (!group || !choice) throw new Error('That leaderboard choice is no longer available.');
  const members = [...(choice.members || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(members.length / pageSize));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const visible = members.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const lines = visible.map((member, index) => `${safePage * pageSize + index + 1}. <@${member.id}>`);

  return {
    allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`👥 ${choice.label} · Members`).setDescription([
      `**Group:** ${group.emoji || '🏷️'} ${group.name}`,
      `**Members:** ${members.length}`,
      totalPages > 1 ? `**Page:** ${safePage + 1}/${totalPages}` : '',
      '',
      lines.join('\n') || '`No members currently have this selection.`',
    ].filter(Boolean).join('\n').slice(0, 4096))],
    components: [statsRow(
      statsButton(statsCustomId('roleSelector:statsChoiceMembersPage', deployment.id, safePage - 1), '⬅️ Previous', ButtonStyle.Secondary, safePage <= 0),
      statsButton(statsCustomId('roleSelector:statsChoicePicker', deployment.id), '↩️ Choices', ButtonStyle.Primary),
      statsButton(statsCustomId('roleSelector:statsChoiceMembersPage', deployment.id, safePage + 1), 'Next ➡️', ButtonStyle.Secondary, safePage >= totalPages - 1),
    )],
  };
}

async function buildFullBreakdownV2(guild, deploymentId) {
  const deployment = statsDeploymentById(guild.id, deploymentId);
  if (!deployment) throw new Error('That stats panel no longer exists.');
  const usage = await usageForStatsDeployment(guild, deployment);
  const lines = [
    `👥 **Members represented:** ${usage.totalUsing}`,
    `🎯 **Total selections:** ${usage.totalSelections}`,
    '',
  ];

  for (const group of usage.groups || []) {
    lines.push(`**${group.emoji || '🏷️'} ${group.name}**`);
    const rows = [...(group.rows || [])].sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.label).localeCompare(String(b.label)));
    lines.push(rows.map((entry, index) => `${index + 1}. ${entry.emoji || '•'} **${entry.label}** — ${entry.count || 0}`).join('\n') || '`No choices configured`');
    lines.push('');
  }

  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Role Selector · Full Breakdown').setDescription(lines.join('\n').slice(0, 4096))],
    components: [statsRow(
      statsButton(statsCustomId('roleSelector:statsMembers', deployment.id), '👥 Member Leaderboard', ButtonStyle.Primary),
      statsButton(statsCustomId('roleSelector:statsChoicePicker', deployment.id), '🎯 View By Choice', ButtonStyle.Secondary),
    )],
  };
}

async function handleStatsInteractionV2(i, id) {
  const actor = { actorId: i.user?.id };

  if (id === 'admin:roleSelector:stats' || id === 'admin:roleSelector:statsPublic') {
    await statsRespond(i, await buildStatsDeploymentPanelV2(i));
    return true;
  }
  if (id === 'admin:roleSelector:statsDeploymentSelect' && i.values?.[0] !== '__none__') {
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, i.values[0]));
    return true;
  }
  if (id === 'admin:roleSelector:statsDeploymentCreate') {
    const list = statsDeploymentList(roleSelector.getSection(i.guildId));
    let candidate = `s${Date.now().toString(36)}`;
    while (list.some((item) => item.id === candidate)) candidate = `${candidate}${Math.random().toString(36).slice(2, 4)}`.slice(0, 20);
    const deployment = normalizeStatsDeployment({ id: candidate, mode: 'all', groupIds: [], topLimit: 10 });
    list.push(deployment);
    saveStatsDeployments(i.guildId, list, { ...actor, action: 'role_selector_stats_deployment_create' });
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, deployment.id));
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploymentChannel:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploymentChannel:'.length);
    const target = i.values?.[0];
    if (!target) throw new Error('Choose a stats channel.');
    const list = statsDeploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((item) => item.id === deploymentId);
    if (index < 0) throw new Error('Choose a stats panel first.');
    const current = list[index];
    if (current.messageId && current.channelId && current.channelId !== target) {
      const { message } = await fetchStatsMessage(i.guild, current);
      if (message && statsOwned(i.guild, message)) await message.delete().catch(() => null);
    }
    list[index] = { ...current, channelId: target, messageId: current.channelId === target ? current.messageId : null };
    saveStatsDeployments(i.guildId, list, { ...actor, action: 'role_selector_stats_channel' });
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, deploymentId));
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploymentMode:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploymentMode:'.length);
    const mode = i.values?.[0];
    if (!['all', 'selected', 'single'].includes(mode)) throw new Error('Choose a valid stats layout.');
    const list = statsDeploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((item) => item.id === deploymentId);
    if (index < 0) throw new Error('Choose a stats panel first.');
    const current = list[index];
    list[index] = { ...current, mode, groupIds: mode === 'all' ? [] : mode === 'single' ? current.groupIds.slice(0, 1) : current.groupIds };
    saveStatsDeployments(i.guildId, list, { ...actor, action: 'role_selector_stats_mode' });
    await syncOneStatsDeployment(i.guild, list[index]).catch(() => null);
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, deploymentId));
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploymentGroups:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploymentGroups:'.length);
    const list = statsDeploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((item) => item.id === deploymentId);
    if (index < 0) throw new Error('Choose a stats panel first.');
    const current = list[index];
    const selected = [...new Set((i.values || []).filter((value) => !['__none__', '__all__'].includes(value)))];
    list[index] = { ...current, groupIds: current.mode === 'single' ? selected.slice(0, 1) : selected };
    saveStatsDeployments(i.guildId, list, { ...actor, action: 'role_selector_stats_groups' });
    await syncOneStatsDeployment(i.guild, list[index]).catch(() => null);
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, deploymentId));
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploymentLimit:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploymentLimit:'.length);
    const list = statsDeploymentList(roleSelector.getSection(i.guildId));
    const index = list.findIndex((item) => item.id === deploymentId);
    if (index < 0) throw new Error('Choose a stats panel first.');
    const limits = [5, 10, 25];
    const currentIndex = limits.indexOf(Number(list[index].topLimit));
    list[index] = { ...list[index], topLimit: limits[(currentIndex + 1 + limits.length) % limits.length] };
    saveStatsDeployments(i.guildId, list, { ...actor, action: 'role_selector_stats_limit' });
    await syncOneStatsDeployment(i.guild, list[index]).catch(() => null);
    await statsRespond(i, await buildStatsDeploymentPanelV2(i, deploymentId));
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploy:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploy:'.length);
    const message = await deployStatsPanelV2(i, deploymentId);
    const payload = await buildStatsDeploymentPanelV2(i, deploymentId);
    payload.content = `✅ Stats panel deployed in <#${message.channel.id}>.`;
    await statsRespond(i, payload);
    return true;
  }
  if (id.startsWith('admin:roleSelector:statsDeploymentDelete:')) {
    const deploymentId = id.slice('admin:roleSelector:statsDeploymentDelete:'.length);
    await deleteStatsPanelV2(i, deploymentId);
    await statsRespond(i, await buildStatsDeploymentPanelV2(i));
    return true;
  }

  if (id.startsWith('roleSelector:statsMembers:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const deploymentId = id.slice('roleSelector:statsMembers:'.length);
    const payload = await buildMemberLeaderboardV2(i.guild, deploymentId, 0);
    if (i.deferred || i.replied) await i.editReply(payload); else await i.reply({ ...payload, flags: 64 });
    return true;
  }
  if (id.startsWith('roleSelector:statsMemberLeaderboardPage:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const parts = id.slice('roleSelector:statsMemberLeaderboardPage:'.length).split(':');
    const deploymentId = parts[0];
    await i.update(await buildMemberLeaderboardV2(i.guild, deploymentId, Number(parts[1]) || 0));
    return true;
  }
  if (id.startsWith('roleSelector:statsChoicePicker:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const deploymentId = id.slice('roleSelector:statsChoicePicker:'.length);
    await i.update(await buildChoicePickerV2(i.guild, deploymentId, 0));
    return true;
  }
  if (id.startsWith('roleSelector:statsChoicePickerPage:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const parts = id.slice('roleSelector:statsChoicePickerPage:'.length).split(':');
    await i.update(await buildChoicePickerV2(i.guild, parts[0], Number(parts[1]) || 0));
    return true;
  }
  if (id.startsWith('roleSelector:statsMemberChoice:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const deploymentId = id.slice('roleSelector:statsMemberChoice:'.length).split(':')[0];
    const raw = i.values?.[0] || '';
    const separator = raw.indexOf('|');
    if (separator < 1) throw new Error('Choose a leaderboard entry.');
    const groupId = raw.slice(0, separator);
    const optionId = decodeURIComponent(raw.slice(separator + 1));
    const value = statsState(i);
    value.deploymentId = deploymentId;
    value.groupId = groupId;
    value.optionId = optionId;
    value.page = 0;
    await i.update(await buildChoiceMembersV2(i.guild, deploymentId, groupId, optionId, 0));
    return true;
  }
  if (id.startsWith('roleSelector:statsChoiceMembersPage:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const parts = id.slice('roleSelector:statsChoiceMembersPage:'.length).split(':');
    const deploymentId = parts[0];
    const value = statsState(i);
    if (value.deploymentId !== deploymentId || !value.groupId || value.optionId == null) {
      await i.update(await buildChoicePickerV2(i.guild, deploymentId, 0));
      return true;
    }
    value.page = Number(parts[1]) || 0;
    await i.update(await buildChoiceMembersV2(i.guild, deploymentId, value.groupId, value.optionId, value.page));
    return true;
  }
  if (id.startsWith('roleSelector:statsBreakdown:')) {
    roleSelector.assertModuleEnabled(i.guildId);
    const deploymentId = id.slice('roleSelector:statsBreakdown:'.length);
    const payload = await buildFullBreakdownV2(i.guild, deploymentId);
    if (i.deferred || i.replied) await i.editReply(payload); else await i.reply({ ...payload, flags: 64 });
    return true;
  }

  return false;
}

function isStatsInteractionId(id) {
  return id === 'admin:roleSelector:stats'
    || id === 'admin:roleSelector:statsPublic'
    || id.startsWith('admin:roleSelector:statsDeployment')
    || id.startsWith('admin:roleSelector:statsDeploy:')
    || id.startsWith('roleSelector:stats');
}

function shouldRefreshStatsAfter(id) {
  return id.startsWith('roleSelector:colourChoose:')
    || id.startsWith('roleSelector:customHexSubmit:')
    || id.startsWith('roleSelector:choose:')
    || id.startsWith('roleSelector:clear:')
    || id === 'colourRoles:choose'
    || id === 'colourRoles:remove'
    || id === 'admin:roleSelector:createGroupSubmit'
    || id.startsWith('admin:roleSelector:optionsSubmit:')
    || id.startsWith('admin:roleSelector:deleteGroup:')
    || id === 'admin:roleSelector:palette';
}

function installStatsPanelExtension() {
  let panel;
  try {
    panel = require('./roleSelectorPanel');
  } catch (error) {
    console.error('[RoleSelectorStats] Failed to load Role Selector panel:', error);
    return;
  }
  if (!panel || panel.__statsDeploymentManagerV2 || typeof panel.handleRoleSelectorInteraction !== 'function') return;

  const original = panel.handleRoleSelectorInteraction;
  panel.handleRoleSelectorInteraction = async function handleRoleSelectorInteractionWithStats(i) {
    const id = String(i.customId || '');
    if (isStatsInteractionId(id)) {
      try {
        if (id.startsWith('admin:')) {
          const access = await security.enforceInteractionSecurity(i, { level: 'admin', guildOnly: true });
          if (!access.allowed) return true;
        }
        return await handleStatsInteractionV2(i, id);
      } catch (error) {
        console.error('[RoleSelectorStats]', error);
        const payload = { content: `❌ ${error.message || 'Role Selector stats failed.'}`, flags: 64 };
        if (i.deferred || i.replied) await i.followUp(payload).catch(() => null);
        else await i.reply(payload).catch(() => null);
        return true;
      }
    }

    const handled = await original(i);
    if (handled && i.guild && shouldRefreshStatsAfter(id)) {
      void syncAllStatsDeployments(i.guild).catch((error) => console.error('[RoleSelectorStats] Deferred sync failed:', error));
    }
    return handled;
  };
  panel.__statsDeploymentManagerV2 = true;
}

queueMicrotask(installStatsPanelExtension);
