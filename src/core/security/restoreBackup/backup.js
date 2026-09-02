// security/restoreBackup/backup.js

const fs = require('node:fs');
const path = require('node:path');
const { ChannelType } = require('discord.js');

const guildManager = require('../../guild/guildManager');

const {
  getBackupRoot,
  getBackupDir,
  ensureBackupDir,
  writeIntegrityFile,
  validateBackupIntegrity,
} = require('./core');

const backupSync = require('./sync');

const BACKUPS_DIR = getBackupRoot();

const SUPPORTED_BACKUP_VERSIONS = [3];
const BACKUP_SCHEMA_VERSION = 3;

const BACKUP_TYPES_TO_LIST = ['scheduled', 'runtime'];

const DANGEROUS_PERMISSION_NAMES = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeLabel(value, fallback = 'backup') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

function createBackupId(type = 'runtime') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safeLabel(type)}_${timestamp}`;
}

function getRetentionLimit() {
  return Number(process.env.SERVER_BACKUP_RETENTION || 4) || 4;
}

function getRollbackRetentionLimit() {
  return Number(process.env.SERVER_ROLLBACK_RETENTION || 6) || 6;
}

function normaliseBackupType(type = 'runtime') {
  const value = String(type || 'runtime').toLowerCase();

  if (value === 'rollback') return 'rollback';
  if (value === 'scheduled') return 'scheduled';
  if (value === 'runtime') return 'runtime';

  return 'runtime';
}

function getGuildBackupDir(guildId, backupType = 'runtime') {
  return getBackupDir({
    environment: process.env.BOT_MODE,
    guildId,
    backupType: normaliseBackupType(backupType),
  });
}

function getGuildRollbackDir(guildId) {
  return getBackupDir({
    environment: process.env.BOT_MODE,
    guildId,
    backupType: 'rollback',
  });
}

function getBackupFilePath(guildId, backupId, type = 'runtime') {
  const backupType = normaliseBackupType(type);

  const dir =
    backupType === 'rollback'
      ? getGuildRollbackDir(guildId)
      : getGuildBackupDir(guildId, backupType);

  return path.join(dir, `${backupId}.json`);
}

function findBackupFilePath(guildId, backupId) {
  for (const backupType of BACKUP_TYPES_TO_LIST) {
    const filePath = getBackupFilePath(guildId, backupId, backupType);
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));

  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isValidBitfield(value) {
  if (value === undefined || value === null) return false;

  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

function isValidSnowflake(value) {
  return /^\d{16,20}$/.test(String(value || ''));
}

function isValidChannelType(type) {
  return typeof type === 'number';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueCount(values = []) {
  return new Set(values.map((value) => String(value))).size;
}

function serializeOverwrite(overwrite) {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  };
}

function serializeRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
  };
}

function serializeChannel(channel) {
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
      ? channel.permissionOverwrites.cache.map(serializeOverwrite)
      : [],
  };
}

function getGuildConfigSnapshot(guildId) {
  if (typeof guildManager.getGuildData === 'function') {
    return guildManager.getGuildData(guildId) || {};
  }

  return {};
}

function getLogsSnapshot(guildId) {
  const guildData = getGuildConfigSnapshot(guildId);

  return {
    enabled: guildData.logs?.enabled !== false,
    channels: guildData.logs?.channels || {},
    events: guildData.logs?.events || {},
  };
}

function createBackupSummary(backup) {
  const roles = asArray(backup?.roles);
  const channels = asArray(backup?.channels);

  return {
    backupId: backup?.backupId || null,
    type: backup?.type || 'runtime',
    backupType: backup?.backupType || backup?.metadata?.backupType || backup?.type || 'runtime',
    version: backup?.version || null,
    createdAt: backup?.createdAt || null,
    createdBy: backup?.createdBy || null,
    requestedBy: backup?.requestedBy || null,
    restoreRequestId: backup?.restoreRequestId || null,
    reason: backup?.reason || null,
    environment: backup?.environment || backup?.metadata?.environment || null,
    guildId: backup?.guild?.id || null,
    guildName: backup?.guild?.name || null,

    integrity: backup?.integrity || null,

    counts: {
      roles: roles.length,
      channels: channels.length,
      categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length,
      permissionOverwrites: channels.reduce(
        (total, c) =>
          total +
          (Array.isArray(c.permissionOverwrites)
            ? c.permissionOverwrites.length
            : 0),
        0
      ),
    },
  };
}

function validateServerBackup(backup, options = {}) {
  const errors = [];
  const warnings = [];
  const blockers = [];
  const safety = {
    emptyBackup: false,
    guildMismatch: false,
    unsupportedVersion: false,
    invalidRoles: 0,
    invalidChannels: 0,
    invalidOverwrites: 0,
    duplicateRoleNames: [],
    duplicateChannelKeys: [],
    dangerousRoles: [],
  };

  const strict = options.strict !== false;

  if (!isObject(backup)) {
    return {
      valid: false,
      safe: false,
      errors: ['Backup is not a valid object.'],
      warnings,
      blockers: ['Backup is not readable.'],
      safety,
      summary: null,
      integrity: null,
    };
  }

  const roles = asArray(backup.roles);
  const channels = asArray(backup.channels);

  if (!SUPPORTED_BACKUP_VERSIONS.includes(Number(backup.version))) {
    safety.unsupportedVersion = true;
    errors.push(`Unsupported backup version: ${backup.version || 'missing'}`);
  }

  if (!backup.backupId) errors.push('Backup is missing backupId.');
  if (!backup.createdAt) errors.push('Backup is missing createdAt.');
  if (!backup.guild?.id) errors.push('Backup is missing guild.id.');
  if (!backup.guild?.name) warnings.push('Backup is missing guild.name.');

  if (
    options.guildId &&
    backup.guild?.id &&
    String(options.guildId) !== String(backup.guild.id)
  ) {
    safety.guildMismatch = true;
    blockers.push(
      `Backup guild mismatch. Backup belongs to ${backup.guild.id}, current guild is ${options.guildId}.`
    );
  }

  if (!Array.isArray(backup.roles)) {
    errors.push('Backup roles field is missing or invalid.');
  }

  if (!Array.isArray(backup.channels)) {
    errors.push('Backup channels field is missing or invalid.');
  }

  if (roles.length === 0 && channels.length === 0) {
    safety.emptyBackup = true;
    blockers.push('Backup contains no roles and no channels.');
  }

  if (roles.length === 0) {
    warnings.push('Backup contains no restorable roles.');
  }

  if (channels.length === 0) {
    warnings.push('Backup contains no restorable channels.');
  }

  const roleNames = roles
    .map((role) => String(role?.name || '').trim().toLowerCase())
    .filter(Boolean);

  const duplicateRoleNames = roleNames.filter(
    (name, index) => roleNames.indexOf(name) !== index
  );

  safety.duplicateRoleNames = [...new Set(duplicateRoleNames)];

  if (safety.duplicateRoleNames.length) {
    warnings.push(
      `Backup contains duplicate role names: ${safety.duplicateRoleNames.join(', ')}`
    );
  }

  const channelKeys = channels
    .map((channel) =>
      `${channel?.type ?? 'unknown'}:${String(channel?.name || '').trim().toLowerCase()}`
    )
    .filter(Boolean);

  const duplicateChannelKeys = channelKeys.filter(
    (key, index) => channelKeys.indexOf(key) !== index
  );

  safety.duplicateChannelKeys = [...new Set(duplicateChannelKeys)];

  if (safety.duplicateChannelKeys.length) {
    warnings.push(
      `Backup contains duplicate channel names/types: ${safety.duplicateChannelKeys.join(', ')}`
    );
  }

  for (const role of roles) {
    const roleName = role?.name || role?.id || 'unknown role';

    if (!isObject(role)) {
      safety.invalidRoles += 1;
      errors.push('Backup contains an invalid role entry.');
      continue;
    }

    if (!role.id) {
      safety.invalidRoles += 1;
      errors.push(`Role "${roleName}" is missing id.`);
    } else if (!isValidSnowflake(role.id)) {
      warnings.push(`Role "${roleName}" has a non-standard id format.`);
    }

    if (!role.name) {
      safety.invalidRoles += 1;
      errors.push(`Role at ${role.id || 'unknown'} is missing name.`);
    }

    if (role.name === '@everyone') {
      warnings.push('Backup includes @everyone role. It will not be recreated.');
    }

    if (!isValidBitfield(role.permissions)) {
      safety.invalidRoles += 1;
      errors.push(`Role "${roleName}" has invalid permissions.`);
    }

    if (typeof role.position !== 'number') {
      warnings.push(`Role "${roleName}" has no numeric position.`);
    }

    if (role.managed) {
      warnings.push(`Role "${roleName}" is managed and should be skipped during restore.`);
    }

    try {
      const permissions = BigInt(role.permissions || 0);
      const dangerousFlags = [];

      const { PermissionFlagsBits } = require('discord.js');

      for (const permissionName of DANGEROUS_PERMISSION_NAMES) {
        const flag = PermissionFlagsBits[permissionName];

        if (flag && (permissions & flag) === flag) {
          dangerousFlags.push(permissionName);
        }
      }

      if (dangerousFlags.length) {
        safety.dangerousRoles.push({
          id: role.id,
          name: role.name,
          permissions: dangerousFlags,
        });

        warnings.push(
          `Role "${role.name}" contains dangerous permissions: ${dangerousFlags.join(', ')}`
        );
      }
    } catch {
      // already handled by bitfield validation
    }
  }

  for (const channel of channels) {
    const channelName = channel?.name || channel?.id || 'unknown channel';

    if (!isObject(channel)) {
      safety.invalidChannels += 1;
      errors.push('Backup contains an invalid channel entry.');
      continue;
    }

    if (!channel.id) {
      safety.invalidChannels += 1;
      errors.push(`Channel "${channelName}" is missing id.`);
    } else if (!isValidSnowflake(channel.id)) {
      warnings.push(`Channel "${channelName}" has a non-standard id format.`);
    }

    if (!channel.name) {
      safety.invalidChannels += 1;
      errors.push(`Channel at ${channel.id || 'unknown'} is missing name.`);
    }

    if (!isValidChannelType(channel.type)) {
      safety.invalidChannels += 1;
      errors.push(`Channel "${channelName}" has invalid type.`);
    }

    if (typeof channel.position !== 'number') {
      warnings.push(`Channel "${channelName}" has no numeric position.`);
    }

    if (
      channel.parentId &&
      !channels.some((candidate) => String(candidate.id) === String(channel.parentId))
    ) {
      warnings.push(
        `Channel "${channelName}" references a parent category that is not in this backup.`
      );
    }

    if (
      channel.permissionOverwrites !== undefined &&
      !Array.isArray(channel.permissionOverwrites)
    ) {
      safety.invalidOverwrites += 1;
      errors.push(`Channel "${channelName}" has invalid permissionOverwrites.`);
    }

    for (const overwrite of asArray(channel.permissionOverwrites)) {
      if (!isObject(overwrite)) {
        safety.invalidOverwrites += 1;
        errors.push(`Channel "${channelName}" has an invalid overwrite entry.`);
        continue;
      }

      if (!overwrite.id) {
        safety.invalidOverwrites += 1;
        errors.push(`Channel "${channelName}" has overwrite missing id.`);
      } else if (!isValidSnowflake(overwrite.id)) {
        warnings.push(`Channel "${channelName}" has overwrite with non-standard id.`);
      }

      if (overwrite.type === undefined || overwrite.type === null) {
        safety.invalidOverwrites += 1;
        errors.push(`Channel "${channelName}" has overwrite missing type.`);
      }

      if (!isValidBitfield(overwrite.allow)) {
        safety.invalidOverwrites += 1;
        errors.push(`Channel "${channelName}" has overwrite with invalid allow.`);
      }

      if (!isValidBitfield(overwrite.deny)) {
        safety.invalidOverwrites += 1;
        errors.push(`Channel "${channelName}" has overwrite with invalid deny.`);
      }
    }
  }

  if (backup.stats) {
    if (
      typeof backup.stats.roles === 'number' &&
      backup.stats.roles !== roles.length
    ) {
      warnings.push(
        `Backup role count mismatch. Stats say ${backup.stats.roles}, actual is ${roles.length}.`
      );
    }

    if (
      typeof backup.stats.channels === 'number' &&
      backup.stats.channels !== channels.length
    ) {
      warnings.push(
        `Backup channel count mismatch. Stats say ${backup.stats.channels}, actual is ${channels.length}.`
      );
    }
  }

  let integrity = null;

  const backupPath =
    backup.path ||
    backup.filePath ||
    backup.file ||
    options.backupPath ||
    null;

  if (backupPath && fs.existsSync(backupPath)) {
    integrity = validateBackupIntegrity(backupPath);

    if (!integrity.valid) {
      if (strict) {
        errors.push(`Backup integrity validation failed: ${integrity.reason}`);
      } else {
        warnings.push(`Backup integrity not verified: ${integrity.reason}`);
      }
    }
  } else if (strict && options.requireIntegrityPath) {
    errors.push('Backup integrity could not be checked because backup path is missing.');
  } else if (!backupPath) {
    warnings.push('Backup path missing; integrity could not be checked here.');
  }

  const summary = createBackupSummary(backup);

  const safe =
    errors.length === 0 &&
    blockers.length === 0 &&
    !safety.emptyBackup &&
    !safety.guildMismatch &&
    !safety.unsupportedVersion;

  return {
    valid: errors.length === 0 && blockers.length === 0,
    safe,
    errors,
    warnings,
    blockers,
    safety,
    summary,
    integrity,

    counts: {
      roles: roles.length,
      uniqueRoleNames: uniqueCount(roleNames),
      channels: channels.length,
      uniqueChannelKeys: uniqueCount(channelKeys),
      permissionOverwrites: channels.reduce(
        (total, channel) => total + asArray(channel.permissionOverwrites).length,
        0
      ),
      dangerousRoles: safety.dangerousRoles.length,
    },
  };
}

function getBackupStats(roles, channels) {
  return {
    roles: roles.length,
    channels: channels.length,
    categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length,
    textChannels: channels.filter((c) => c.type === ChannelType.GuildText).length,
    announcementChannels: channels.filter((c) => c.type === ChannelType.GuildAnnouncement).length,
    voiceChannels: channels.filter((c) => c.type === ChannelType.GuildVoice).length,
    stageChannels: channels.filter((c) => c.type === ChannelType.GuildStageVoice).length,
    forumChannels: channels.filter((c) => c.type === ChannelType.GuildForum).length,
    mediaChannels: channels.filter((c) => c.type === ChannelType.GuildMedia).length,
  };
}

function getEnvironmentName() {
  return String(process.env.BOT_MODE || 'DEV').toUpperCase();
}

async function createServerBackup(guild, options = {}) {
  if (!guild) throw new Error('Missing guild.');

  const backupType = normaliseBackupType(options.type || options.backupType || 'runtime');
  const backupId = options.backupId || createBackupId(backupType);
  const environment = getEnvironmentName();

  const dir = ensureBackupDir({
    environment,
    guildId: guild.id,
    backupType,
  });

  const filePath = path.join(dir, `${backupId}.json`);

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map(serializeRole);

  const channels = guild.channels.cache
    .sort(
      (a, b) =>
        (a.rawPosition ?? a.position ?? 0) -
        (b.rawPosition ?? b.position ?? 0)
    )
    .map(serializeChannel);

  const guildConfig = getGuildConfigSnapshot(guild.id);

  const backup = {
    version: BACKUP_SCHEMA_VERSION,
    type: backupType,
    backupType,
    backupId,
    path: filePath,
    environment,

    createdAt: new Date().toISOString(),
    createdBy: options.createdBy || options.requestedBy || null,
    requestedBy: options.requestedBy || null,
    approvedBy: options.approvedBy || null,
    restoreRequestId: options.restoreRequestId || null,
    reason:
      options.reason ||
      (backupType === 'rollback'
        ? 'Automatic rollback snapshot before restore'
        : 'Server backup'),

    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ extension: 'png', size: 1024 }) || null,
    },

    metadata: {
      source: 'Goliath',
      backupVersion: BACKUP_SCHEMA_VERSION,
      backupType,
      environment,
      isRollbackSnapshot: backupType === 'rollback',
      restoreRequestId: options.restoreRequestId || null,
      createdBySystem: Boolean(options.createdBySystem),
      storageRoot: BACKUPS_DIR,
    },

    logs: getLogsSnapshot(guild.id),
    guildConfig,

    stats: getBackupStats(roles, channels),

    restoreNotes: {
      canRestore: [
        'Roles',
        'Categories',
        'Channels',
        'Permission overwrites',
        'Guild configuration references',
        'Log configuration references',
      ],
      cannotRestore: [
        'Messages',
        'Members',
        'Boosts',
        'Audit logs',
        'Original guild ID',
        'Original ownership',
      ],
    },

    roles,
    channels,
  };

  writeJson(filePath, backup);

  const integrity = writeIntegrityFile({
    backupId,
    environment,
    guildId: guild.id,
    backupType,
    backupPath: filePath,
    backupData: backup,
  });

  backup.integrity = {
    verified: true,
    algorithm: integrity.integrityRecord.integrity.algorithm,
    hash: integrity.integrityRecord.integrity.hash,
    integrityPath: integrity.integrityPath,
    generatedAt: integrity.integrityRecord.integrity.generatedAt,
  };

  writeJson(filePath, backup);

  writeIntegrityFile({
    backupId,
    environment,
    guildId: guild.id,
    backupType,
    backupPath: filePath,
    backupData: backup,
  });

  if (backupType === 'rollback') {
    cleanupOldRollbacks(guild.id);
    updateGuildRollbackReference(guild, backup);
  } else {
    cleanupOldBackups(guild.id);
    updateGuildBackupReference(guild, backup);
  }

  try {
    backupSync.queueBackupSync({
      guildId: guild.id,
      backupId: backup.backupId,
      backupPath: filePath,

      environment: backup.environment || environment,

      backupType: backup.backupType || backup.type || backupType,

      createdBy: options.requestedBy || options.createdBy || 'system',

      metadata: {
        restoreRequestId: options.restoreRequestId || null,
        isRollback: backupType === 'rollback',
        createdBySystem: Boolean(options.createdBySystem),
      },
    });
  } catch (error) {
    console.error('[Backup Sync Queue Error]', error);
  }

  return {
    ...backup,
    file: filePath,
    filePath,
  };
}

function listFilesAsBackupIds(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => !file.endsWith('.integrity.json'))
    .map((file) => file.replace('.json', ''))
    .sort((a, b) => b.localeCompare(a));
}

function listServerBackups(guildId) {
  return BACKUP_TYPES_TO_LIST
    .flatMap((backupType) => listFilesAsBackupIds(getGuildBackupDir(guildId, backupType)))
    .sort((a, b) => b.localeCompare(a));
}

function listServerRollbacks(guildId) {
  return listFilesAsBackupIds(getGuildRollbackDir(guildId));
}

function getLatestServerBackupId(guildId) {
  const section = guildManager.getGuildSection(guildId, 'serverBackups', {});

  if (section.lastBackupId) {
    const existing = readServerBackup(guildId, section.lastBackupId);
    if (existing) return section.lastBackupId;
  }

  return listServerBackups(guildId)[0] || null;
}

function getLatestServerRollbackId(guildId) {
  const section = guildManager.getGuildSection(guildId, 'serverBackups', {});

  if (section.lastRollbackId) {
    const existing = readServerRollback(guildId, section.lastRollbackId);
    if (existing) return section.lastRollbackId;
  }

  return listServerRollbacks(guildId)[0] || null;
}

function readLatestServerBackup(guildId) {
  const latestBackupId = getLatestServerBackupId(guildId);
  if (!latestBackupId) return null;

  return readServerBackup(guildId, latestBackupId);
}

function readLatestServerRollback(guildId) {
  const latestRollbackId = getLatestServerRollbackId(guildId);
  if (!latestRollbackId) return null;

  return readServerRollback(guildId, latestRollbackId);
}

function cleanupOldBackups(guildId) {
  const maxBackups = getRetentionLimit();
  const backups = listServerBackups(guildId);

  if (backups.length <= maxBackups) return 0;

  const oldBackups = backups.slice(maxBackups);
  let deleted = 0;

  for (const backupId of oldBackups) {
    if (deleteServerBackup(guildId, backupId)) deleted += 1;
  }

  return deleted;
}

function cleanupOldRollbacks(guildId) {
  const maxRollbacks = getRollbackRetentionLimit();
  const rollbacks = listServerRollbacks(guildId);

  if (rollbacks.length <= maxRollbacks) return 0;

  const oldRollbacks = rollbacks.slice(maxRollbacks);
  let deleted = 0;

  for (const rollbackId of oldRollbacks) {
    if (deleteServerRollback(guildId, rollbackId)) deleted += 1;
  }

  return deleted;
}

function getBackupSummaries(guildId) {
  return listServerBackups(guildId)
    .map((backupId) => readServerBackup(guildId, backupId))
    .filter(Boolean)
    .map((backup) => ({
      backupId: backup.backupId,
      type: backup.type || 'runtime',
      backupType: backup.backupType || backup.metadata?.backupType || backup.type || 'runtime',
      environment: backup.environment || backup.metadata?.environment || null,
      createdAt: backup.createdAt,
      createdBy: backup.createdBy,
      requestedBy: backup.requestedBy || null,
      restoreRequestId: backup.restoreRequestId || null,
      reason: backup.reason,
      guildName: backup.guild?.name || null,
      roles: backup.roles?.length || 0,
      channels: backup.channels?.length || 0,
      logsIncluded: Boolean(backup.logs),
      integrity: backup.integrity || null,
      validation: validateServerBackup(backup, {
        guildId: backup.guild?.id,
        strict: false,
      }),
    }));
}

function getRollbackSummaries(guildId) {
  return listServerRollbacks(guildId)
    .map((rollbackId) => readServerRollback(guildId, rollbackId))
    .filter(Boolean)
    .map((backup) => ({
      backupId: backup.backupId,
      type: backup.type || 'rollback',
      backupType: backup.backupType || backup.metadata?.backupType || 'rollback',
      environment: backup.environment || backup.metadata?.environment || null,
      createdAt: backup.createdAt,
      createdBy: backup.createdBy,
      requestedBy: backup.requestedBy || null,
      restoreRequestId: backup.restoreRequestId || null,
      reason: backup.reason,
      guildName: backup.guild?.name || null,
      roles: backup.roles?.length || 0,
      channels: backup.channels?.length || 0,
      logsIncluded: Boolean(backup.logs),
      integrity: backup.integrity || null,
      validation: validateServerBackup(backup, {
        guildId: backup.guild?.id,
        strict: false,
      }),
    }));
}

function readServerBackup(guildId, backupId) {
  return readJson(findBackupFilePath(guildId, backupId));
}

function readServerRollback(guildId, rollbackId) {
  return readJson(getBackupFilePath(guildId, rollbackId, 'rollback'));
}

function deleteFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function deleteServerBackup(guildId, backupId) {
  const file = findBackupFilePath(guildId, backupId);
  if (!file || !fs.existsSync(file)) return false;

  deleteFileIfExists(`${file}.integrity.json`);
  fs.unlinkSync(file);
  return true;
}

function deleteServerRollback(guildId, rollbackId) {
  const file = getBackupFilePath(guildId, rollbackId, 'rollback');
  if (!fs.existsSync(file)) return false;

  deleteFileIfExists(`${file}.integrity.json`);
  fs.unlinkSync(file);
  return true;
}

function updateGuildBackupReference(guild, backup) {
  const existing = guildManager.getGuildSection(guild.id, 'serverBackups', {});
  const backups = listServerBackups(guild.id);
  const rollbacks = listServerRollbacks(guild.id);
  const retentionMax = getRetentionLimit();

  guildManager.replaceGuildSection(guild.id, 'serverBackups', {
    ...existing,

    enabled: existing.enabled !== false,

    lastBackupId: backup.backupId,
    lastBackupAt: backup.createdAt,
    lastBackupBy: backup.createdBy || null,
    lastBackupReason: backup.reason || null,
    lastBackupType: backup.backupType || backup.type || 'runtime',
    lastBackupIntegrity: backup.integrity || null,

    backupCount: backups.length,
    rollbackCount: rollbacks.length,

    latestBackup: {
      backupId: backup.backupId,
      backupType: backup.backupType || backup.type || 'runtime',
      environment: backup.environment || backup.metadata?.environment || null,
      createdAt: backup.createdAt,
      createdBy: backup.createdBy || null,
      reason: backup.reason || null,
      sourceGuildName: guild.name,
      roles: backup.roles?.length || 0,
      channels: backup.channels?.length || 0,
      logsIncluded: Boolean(backup.logs),
      integrity: backup.integrity || null,
    },

    storage: {
      provider: process.env.SERVER_BACKUP_PROVIDER || 'local_runtime',
      path: BACKUPS_DIR,
      restoreRequiresSupport: true,
    },

    retention: {
      maxBackups: retentionMax,
      maxRollbacks: getRollbackRetentionLimit(),
      autoCleanup: existing.retention?.autoCleanup !== false,
    },
  });
}

function updateGuildRollbackReference(guild, rollback) {
  const existing = guildManager.getGuildSection(guild.id, 'serverBackups', {});
  const backups = listServerBackups(guild.id);
  const rollbacks = listServerRollbacks(guild.id);

  guildManager.replaceGuildSection(guild.id, 'serverBackups', {
    ...existing,

    enabled: existing.enabled !== false,

    lastRollbackId: rollback.backupId,
    lastRollbackAt: rollback.createdAt,
    lastRollbackBy: rollback.createdBy || null,
    lastRollbackReason: rollback.reason || null,
    lastRollbackRestoreRequestId: rollback.restoreRequestId || null,
    lastRollbackIntegrity: rollback.integrity || null,

    backupCount: backups.length,
    rollbackCount: rollbacks.length,

    latestRollback: {
      backupId: rollback.backupId,
      backupType: 'rollback',
      environment: rollback.environment || rollback.metadata?.environment || null,
      createdAt: rollback.createdAt,
      createdBy: rollback.createdBy || null,
      requestedBy: rollback.requestedBy || null,
      restoreRequestId: rollback.restoreRequestId || null,
      reason: rollback.reason || null,
      sourceGuildName: guild.name,
      roles: rollback.roles?.length || 0,
      channels: rollback.channels?.length || 0,
      logsIncluded: Boolean(rollback.logs),
      integrity: rollback.integrity || null,
    },

    storage: {
      provider: process.env.SERVER_BACKUP_PROVIDER || 'local_runtime',
      path: BACKUPS_DIR,
      restoreRequiresSupport: true,
    },

    retention: {
      maxBackups: getRetentionLimit(),
      maxRollbacks: getRollbackRetentionLimit(),
      autoCleanup: existing.retention?.autoCleanup !== false,
    },
  });
}

module.exports = {
  BACKUPS_DIR,
  SUPPORTED_BACKUP_VERSIONS,

  createServerBackup,

  listServerBackups,
  listServerRollbacks,

  cleanupOldBackups,
  cleanupOldRollbacks,

  getBackupSummaries,
  getRollbackSummaries,

  readServerBackup,
  readServerRollback,

  deleteServerBackup,
  deleteServerRollback,

  getLatestServerBackupId,
  getLatestServerRollbackId,

  readLatestServerBackup,
  readLatestServerRollback,

  validateServerBackup,
  createBackupSummary,
};
