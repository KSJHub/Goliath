'use strict';

const { ChannelType } = require('discord.js');
const guildManager = require('../../guild/guildManager');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function channelKey(channel = {}) {
  return `${channel.type ?? 'unknown'}:${norm(channel.name)}`;
}

function roleKey(role = {}) {
  return norm(role.name);
}

function overwriteKey(overwrite = {}) {
  return `${overwrite.id}:${overwrite.type}`;
}

function bitfield(value) {
  if (value === undefined || value === null) return '0';
  try {
    return BigInt(value).toString();
  } catch {
    return String(value);
  }
}

function serializeLiveRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions?.bitfield?.toString?.() || '0',
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
  };
}

function serializeLiveOverwrite(overwrite) {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow?.bitfield?.toString?.() || '0',
    deny: overwrite.deny?.bitfield?.toString?.() || '0',
  };
}

function serializeLiveChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId || null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: channel.topic || null,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser || 0,
    bitrate: channel.bitrate || null,
    userLimit: channel.userLimit || 0,
    permissionOverwrites: channel.permissionOverwrites?.cache
      ? channel.permissionOverwrites.cache.map(serializeLiveOverwrite)
      : [],
  };
}

function diffFields(current = {}, backup = {}, fields = []) {
  const changes = [];

  for (const field of fields) {
    const currentValue = field.endsWith('permissions') || field === 'permissions' || field === 'allow' || field === 'deny'
      ? bitfield(current[field])
      : current[field];
    const backupValue = field.endsWith('permissions') || field === 'permissions' || field === 'allow' || field === 'deny'
      ? bitfield(backup[field])
      : backup[field];

    if (JSON.stringify(currentValue) !== JSON.stringify(backupValue)) {
      changes.push({ field, current: currentValue ?? null, backup: backupValue ?? null });
    }
  }

  return changes;
}

function indexBy(items = [], keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function compareRoles(currentRoles = [], backupRoles = []) {
  const live = currentRoles.filter((role) => role.name !== '@everyone' && !role.managed);
  const saved = backupRoles.filter((role) => role.name !== '@everyone' && !role.managed);
  const liveMap = indexBy(live, roleKey);
  const savedMap = indexBy(saved, roleKey);
  const missing = [];
  const extra = [];
  const changed = [];
  const allKeys = new Set([...liveMap.keys(), ...savedMap.keys()]);

  for (const key of allKeys) {
    const current = liveMap.get(key)?.[0] || null;
    const backup = savedMap.get(key)?.[0] || null;

    if (!current && backup) {
      missing.push({ key, name: backup.name, backupId: backup.id, action: 'create_role' });
      continue;
    }

    if (current && !backup) {
      extra.push({ key, name: current.name, currentId: current.id, action: 'not_in_backup' });
      continue;
    }

    const changes = diffFields(current, backup, ['color', 'permissions', 'hoist', 'mentionable']);
    if (changes.length) {
      changed.push({ key, name: current.name || backup.name, currentId: current.id, backupId: backup.id, changes });
    }
  }

  return { missing, extra, changed, counts: { current: live.length, backup: saved.length, missing: missing.length, extra: extra.length, changed: changed.length } };
}

function compareOverwrites(current = [], backup = []) {
  const currentMap = indexBy(current, overwriteKey);
  const backupMap = indexBy(backup, overwriteKey);
  const missing = [];
  const extra = [];
  const changed = [];
  const allKeys = new Set([...currentMap.keys(), ...backupMap.keys()]);

  for (const key of allKeys) {
    const currentOverwrite = currentMap.get(key)?.[0] || null;
    const backupOverwrite = backupMap.get(key)?.[0] || null;

    if (!currentOverwrite && backupOverwrite) {
      missing.push({ key, id: backupOverwrite.id, type: backupOverwrite.type });
      continue;
    }

    if (currentOverwrite && !backupOverwrite) {
      extra.push({ key, id: currentOverwrite.id, type: currentOverwrite.type });
      continue;
    }

    const changes = diffFields(currentOverwrite, backupOverwrite, ['allow', 'deny']);
    if (changes.length) changed.push({ key, id: currentOverwrite.id, type: currentOverwrite.type, changes });
  }

  return { missing, extra, changed, total: missing.length + extra.length + changed.length };
}

function compareChannels(currentChannels = [], backupChannels = []) {
  const liveMap = indexBy(currentChannels, channelKey);
  const savedMap = indexBy(backupChannels, channelKey);
  const missing = [];
  const extra = [];
  const changed = [];
  const permissionChanges = [];
  const allKeys = new Set([...liveMap.keys(), ...savedMap.keys()]);

  for (const key of allKeys) {
    const current = liveMap.get(key)?.[0] || null;
    const backup = savedMap.get(key)?.[0] || null;

    if (!current && backup) {
      missing.push({ key, name: backup.name, type: backup.type, backupId: backup.id, action: backup.type === ChannelType.GuildCategory ? 'create_category' : 'create_channel' });
      continue;
    }

    if (current && !backup) {
      extra.push({ key, name: current.name, type: current.type, currentId: current.id, action: 'not_in_backup' });
      continue;
    }

    const changes = diffFields(current, backup, ['topic', 'nsfw', 'rateLimitPerUser', 'bitrate', 'userLimit']);
    if (changes.length) {
      changed.push({ key, name: current.name || backup.name, type: current.type, currentId: current.id, backupId: backup.id, changes });
    }

    const overwriteDiff = compareOverwrites(asArray(current.permissionOverwrites), asArray(backup.permissionOverwrites));
    if (overwriteDiff.total) {
      permissionChanges.push({ key, name: current.name || backup.name, type: current.type, currentId: current.id, backupId: backup.id, ...overwriteDiff });
    }
  }

  return { missing, extra, changed, permissionChanges, counts: { current: currentChannels.length, backup: backupChannels.length, missing: missing.length, extra: extra.length, changed: changed.length, permissionChanges: permissionChanges.length } };
}

function compareModules(guildId, backup = {}) {
  const currentConfig = guildManager.getGuildData(guildId) || {};
  const backupConfig = backup.guildConfig || {};
  const currentModules = currentConfig.modules || {};
  const backupModules = backupConfig.modules || {};
  const currentKeys = Object.keys(currentModules);
  const backupKeys = Object.keys(backupModules);
  const allKeys = new Set([...currentKeys, ...backupKeys]);
  const missing = [];
  const extra = [];
  const changed = [];

  for (const key of allKeys) {
    const current = currentModules[key];
    const saved = backupModules[key];
    if (current === undefined && saved !== undefined) missing.push({ key, action: 'restore_module_section' });
    else if (current !== undefined && saved === undefined) extra.push({ key, action: 'not_in_backup' });
    else if (JSON.stringify(current) !== JSON.stringify(saved)) changed.push({ key, action: 'update_module_section' });
  }

  const currentLogs = currentConfig.logs || {};
  const backupLogs = backupConfig.logs || backup.logs || {};
  const logsChanged = JSON.stringify(currentLogs) !== JSON.stringify(backupLogs);

  return {
    missing,
    extra,
    changed,
    logsChanged,
    counts: {
      current: currentKeys.length,
      backup: backupKeys.length,
      missing: missing.length,
      extra: extra.length,
      changed: changed.length,
      logsChanged: logsChanged ? 1 : 0,
    },
  };
}

async function buildRestoreComparison(guild, backup = {}) {
  if (!guild) throw new Error('Guild is required.');
  if (!backup || typeof backup !== 'object') throw new Error('Backup is required.');

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const currentRoles = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map(serializeLiveRole);

  const currentChannels = guild.channels.cache
    .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
    .map(serializeLiveChannel);

  const roles = compareRoles(currentRoles, asArray(backup.roles));
  const channels = compareChannels(currentChannels, asArray(backup.channels));
  const modules = compareModules(guild.id, backup);
  const totals = {
    missingRoles: roles.counts.missing,
    extraRoles: roles.counts.extra,
    changedRoles: roles.counts.changed,
    missingChannels: channels.counts.missing,
    extraChannels: channels.counts.extra,
    changedChannels: channels.counts.changed,
    permissionChanges: channels.counts.permissionChanges,
    missingModules: modules.counts.missing,
    extraModules: modules.counts.extra,
    changedModules: modules.counts.changed,
    logsChanged: modules.counts.logsChanged,
  };

  const totalDifferences = Object.values(totals).reduce((sum, value) => sum + Number(value || 0), 0);
  const warnings = [];
  if (String(backup.guild?.id || '') && String(backup.guild.id) !== String(guild.id)) warnings.push(`Backup belongs to guild ${backup.guild.id}, current guild is ${guild.id}.`);
  if (roles.extra.length || channels.extra.length) warnings.push('Current server has roles/channels that are not in the backup. Selective restore should not delete extras unless cleanup mode is explicitly used.');
  if (modules.changed.length || modules.missing.length) warnings.push('Module settings differ. Restoring modules should update guild.json sections only, not create standalone module files.');

  return {
    guildId: guild.id,
    guildName: guild.name,
    backupId: backup.backupId || null,
    backupCreatedAt: backup.createdAt || null,
    comparedAt: new Date().toISOString(),
    summary: {
      totalDifferences,
      safeToPreview: true,
      restoreSupported: true,
      warnings,
      totals,
    },
    roles,
    channels,
    modules,
  };
}

module.exports = {
  buildRestoreComparison,
};