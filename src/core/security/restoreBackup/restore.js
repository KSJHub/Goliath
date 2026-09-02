// security/restoreBackup/restore.js

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const {
  readServerBackup,
  validateServerBackup,
  getLatestServerBackupId,
} = require('./backup');

const {
  buildRestoreDiff,
  createRestoreDiffText,
} = require('./diff');

const {
  validateBackupIntegrity,
} = require('./core');

const { validateBotHierarchy } = require('../protection/system');

const guildManager = require('../../guild/guildManager');

const RESTORE_VERSION = '3C_DIFF_PREVIEW_SAFE';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asSnowflake(value) {
  return value ? String(value) : null;
}

const OWNER_IDS = (process.env.OWNER_IDS || '')
  .split(',')
  .map((id) => String(id).trim())
  .filter(Boolean);

function getBotOwnerIds() {
  return [...new Set(OWNER_IDS)];
}

function getBotOwnerId() {
  return OWNER_IDS[0] || null;
}

function isBotOwner(userId) {
  return OWNER_IDS.includes(String(userId));
}

function isCategoryType(type) {
  return (
    type === ChannelType.GuildCategory ||
    type === 4 ||
    type === 'GuildCategory' ||
    type === 'category'
  );
}

function normalizeChannelType(type) {
  if (typeof type === 'number') return type;

  const map = {
    GuildText: ChannelType.GuildText,
    GuildAnnouncement: ChannelType.GuildAnnouncement,
    GuildVoice: ChannelType.GuildVoice,
    GuildCategory: ChannelType.GuildCategory,
    GuildStageVoice: ChannelType.GuildStageVoice,
    GuildForum: ChannelType.GuildForum,
    GuildMedia: ChannelType.GuildMedia,

    text: ChannelType.GuildText,
    announcement: ChannelType.GuildAnnouncement,
    news: ChannelType.GuildAnnouncement,
    voice: ChannelType.GuildVoice,
    category: ChannelType.GuildCategory,
    stage: ChannelType.GuildStageVoice,
    forum: ChannelType.GuildForum,
    media: ChannelType.GuildMedia,
  };

  return map[type] ?? ChannelType.GuildText;
}

function bitfield(value) {
  if (value == null) return undefined;

  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function hasDangerousRolePermissions(role) {
  const permissions = bitfield(role.permissions);
  if (permissions == null) return false;

  const dangerousFlags = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageWebhooks,
  ];

  return dangerousFlags.some((flag) => {
    try {
      return (permissions & flag) === flag;
    } catch {
      return false;
    }
  });
}

function cleanName(name, fallback) {
  return String(name || fallback || 'restored-item')
    .trim()
    .slice(0, 100);
}

function getBackupGuildId(backup) {
  return (
    backup.guild?.id ||
    backup.sourceGuild?.id ||
    backup.guildId ||
    backup.sourceGuildId ||
    null
  );
}

function getBackupRoles(backup) {
  return asArray(backup.roles);
}

function getBackupCategories(backup) {
  const categories = asArray(backup.categories);
  if (categories.length) return categories;

  return asArray(backup.channels).filter((channel) =>
    isCategoryType(channel.type)
  );
}

function getBackupChannels(backup) {
  return asArray(backup.channels).filter(
    (channel) => !isCategoryType(channel.type)
  );
}

function roleIsRestorable(role) {
  if (!role) return false;
  if (role.id === role.guildId) return false;
  if (role.name === '@everyone') return false;
  if (role.managed) return false;

  return true;
}

function getRestorableRoles(backup) {
  return getBackupRoles(backup)
    .filter(roleIsRestorable)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function getSortedCategories(backup) {
  return getBackupCategories(backup).sort(
    (a, b) => (a.position || 0) - (b.position || 0)
  );
}

function getSortedChannels(backup) {
  return getBackupChannels(backup).sort(
    (a, b) => (a.position || 0) - (b.position || 0)
  );
}

function getRoleBackupId(role) {
  return asSnowflake(role.id || role.roleId);
}

function getChannelBackupId(channel) {
  return asSnowflake(channel.id || channel.channelId);
}

function getParentBackupId(channel) {
  return asSnowflake(
    channel.parentId ||
      channel.parent ||
      channel.categoryId ||
      channel.category
  );
}

function getOverwriteType(overwrite) {
  const type = overwrite.type;

  if (type === 0 || type === 'role' || type === 'Role') return 0;
  if (type === 1 || type === 'member' || type === 'Member') return 1;

  return type;
}

function getBackupConfigSections(backup) {
  return (
    backup.guildConfig ||
    backup.config ||
    backup.sections ||
    backup.guildSections ||
    null
  );
}

function countConfigSections(backup) {
  const sections = getBackupConfigSections(backup);

  if (!sections || typeof sections !== 'object') {
    return 0;
  }

  return Object.entries(sections).filter(([, data]) => data != null).length;
}

function findExistingRole(guild, role) {
  const targetName = cleanName(role.name, 'restored-role').toLowerCase();

  return guild.roles.cache.find(
    (existing) =>
      !existing.managed &&
      existing.id !== guild.id &&
      existing.name.toLowerCase() === targetName
  );
}

function findExistingChannel(guild, channel, type) {
  const targetName = cleanName(channel.name, 'restored-channel').toLowerCase();

  return guild.channels.cache.find(
    (existing) =>
      existing.type === type &&
      existing.name.toLowerCase() === targetName
  );
}

async function emitProgress(options, payload) {
  if (typeof options.onProgress !== 'function') return;

  const total = Number(payload.total || 0);
  const current = Number(payload.current || 0);
  const percent = total > 0 ? Math.round((current / total) * 100) : 100;

  await options.onProgress({
    ...payload,
    current,
    total,
    percent,
    at: new Date().toISOString(),
  });
}

function mapPermissionOverwrites(overwrites, guild, maps) {
  return asArray(overwrites)
    .map((overwrite) => {
      const originalId = asSnowflake(overwrite.id);
      const type = getOverwriteType(overwrite);

      if (!originalId) return null;

      let mappedId = originalId;

      if (originalId === guild.id) {
        mappedId = guild.roles.everyone.id;
      } else if (type === 0) {
        mappedId = maps.roles.get(originalId);
      } else if (type === 1) {
        mappedId = originalId;
      }

      if (!mappedId) return null;

      return {
        id: mappedId,
        type,
        allow: bitfield(overwrite.allow),
        deny: bitfield(overwrite.deny),
      };
    })
    .filter(Boolean);
}

function remapConfigValue(value, maps) {
  if (Array.isArray(value)) {
    return value.map((item) => remapConfigValue(item, maps));
  }

  if (value && typeof value === 'object') {
    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = remapConfigValue(nestedValue, maps);
    }

    return output;
  }

  const stringValue = asSnowflake(value);

  if (!stringValue) return value;
  if (maps.roles.has(stringValue)) return maps.roles.get(stringValue);
  if (maps.channels.has(stringValue)) return maps.channels.get(stringValue);

  return value;
}

function createRestoreReport(guild, backupId, options) {
  return {
    version: RESTORE_VERSION,
    dryRun: Boolean(options.dryRun),
    cleanupMode: Boolean(options.cleanupMode),

    restoreRequestId: options.restoreRequestId || null,
    requestedBy: options.requestedBy || null,
    approvedBy: options.approvedBy || null,
    rollbackBackupId: options.rollbackBackupId || null,

    guildId: guild.id,
    guildName: guild.name,
    backupId,

    startedAt: new Date().toISOString(),
    finishedAt: null,

    validation: null,
    hierarchy: null,

    restoreDiff: null,
    restoreDiffText: null,

    roles: {
      planned: 0,
      created: 0,
      skippedDuplicates: 0,
      positionsRestored: 0,
    },

    categories: {
      planned: 0,
      created: 0,
      skippedDuplicates: 0,
    },

    channels: {
      planned: 0,
      created: 0,
      skippedDuplicates: 0,
    },

    config: {
      planned: 0,
      restored: 0,
      skipped: false,
      reason: null,
      sections: [],
    },

    cleanup: {
      enabled: Boolean(options.cleanupMode),
      deletedChannels: 0,
      deletedRoles: 0,
      skipped: [],
    },

    created: {
      roles: [],
      categories: [],
      channels: [],
    },

    duplicates: {
      roles: [],
      categories: [],
      channels: [],
    },

    warnings: [],
    errors: [],
    progress: [],
  };
}

function validateRestore(guild, backup, backupId, options) {
  if (!guild) throw new Error('Missing guild.');
  if (!backup) throw new Error(`Backup not found: ${backupId}`);

  if (!options.confirmed && !options.dryRun) {
    throw new Error('Restore blocked. Approval confirmation is required.');
  }

  const backupGuildId = getBackupGuildId(backup);

  if (
    options.requireSameGuild !== false &&
    backupGuildId &&
    backupGuildId !== guild.id
  ) {
    throw new Error(
      `Backup guild mismatch. Backup belongs to ${backupGuildId}, current guild is ${guild.id}.`
    );
  }
}

function getRestoreTotal(backup, options) {
  let total = 0;

  if (options.restoreRoles) total += getRestorableRoles(backup).length;
  if (options.restoreCategories) total += getSortedCategories(backup).length;
  if (options.restoreChannels) total += getSortedChannels(backup).length;
  if (options.restoreConfig) total += countConfigSections(backup);

  return total || 1;
}

async function restoreRoles(guild, backup, maps, report, options, progressState) {
  const roles = getRestorableRoles(backup);
  let processed = 0;

  for (const role of roles) {
    const oldRoleId = getRoleBackupId(role);

    if (!oldRoleId) {
      processed += 1;
      continue;
    }

    if (hasDangerousRolePermissions(role)) {
      report.warnings.push(
        `Dangerous permissions detected on restored role: ${role.name}`
      );
    }

    const existing = findExistingRole(guild, role);

    if (existing && options.skipDuplicates !== false) {
      maps.roles.set(oldRoleId, existing.id);
      report.roles.skippedDuplicates += 1;

      report.duplicates.roles.push({
        oldId: oldRoleId,
        existingId: existing.id,
        name: existing.name,
      });
    } else if (options.dryRun) {
      maps.roles.set(oldRoleId, `dry-role-${oldRoleId}`);
      report.roles.planned += 1;
    } else {
      const created = await guild.roles.create({
        name: cleanName(role.name, 'restored-role'),
        color: role.color || 0,
        hoist: Boolean(role.hoist),
        mentionable: Boolean(role.mentionable),
        permissions: bitfield(role.permissions) ?? 0n,
        reason: options.reason,
      });

      maps.roles.set(oldRoleId, created.id);
      report.roles.created += 1;

      report.created.roles.push({
        oldId: oldRoleId,
        newId: created.id,
        name: created.name,
      });
    }

    processed += 1;
    progressState.completed += 1;

    const progress = {
      phase: 'roles',
      step: options.dryRun ? 'Planning roles' : 'Restoring roles',
      current: progressState.completed,
      total: progressState.total,
      phaseCurrent: processed,
      phaseTotal: roles.length,
      itemName: role.name,
    };

    report.progress.push(progress);
    await emitProgress(options, progress);
  }

  if (!options.dryRun && options.restoreRolePositions !== false) {
    for (const role of roles) {
      const newRoleId = maps.roles.get(getRoleBackupId(role));
      const newRole = newRoleId ? guild.roles.cache.get(newRoleId) : null;

      if (!newRole || typeof role.position !== 'number') continue;

      try {
        await newRole.setPosition(role.position, options.reason);
        report.roles.positionsRestored += 1;
      } catch (error) {
        report.warnings.push(
          `Could not restore role position for ${role.name}: ${error.message}`
        );
      }
    }
  }
}

async function restoreCategories(guild, backup, maps, report, options, progressState) {
  const categories = getSortedCategories(backup);
  let processed = 0;

  for (const category of categories) {
    const oldCategoryId = getChannelBackupId(category);

    if (!oldCategoryId) {
      processed += 1;
      continue;
    }

    const type = ChannelType.GuildCategory;
    const existing = findExistingChannel(guild, category, type);

    if (existing && options.skipDuplicates !== false) {
      maps.channels.set(oldCategoryId, existing.id);
      report.categories.skippedDuplicates += 1;

      report.duplicates.categories.push({
        oldId: oldCategoryId,
        existingId: existing.id,
        name: existing.name,
      });
    } else if (options.dryRun) {
      maps.channels.set(oldCategoryId, `dry-category-${oldCategoryId}`);
      report.categories.planned += 1;
    } else {
      const overwrites = mapPermissionOverwrites(
        category.permissionOverwrites || category.overwrites,
        guild,
        maps
      );

      const created = await guild.channels.create({
        name: cleanName(category.name, 'restored-category'),
        type,
        permissionOverwrites: overwrites,
        reason: options.reason,
      });

      maps.channels.set(oldCategoryId, created.id);
      report.categories.created += 1;

      report.created.categories.push({
        oldId: oldCategoryId,
        newId: created.id,
        name: created.name,
      });
    }

    processed += 1;
    progressState.completed += 1;

    const progress = {
      phase: 'categories',
      step: options.dryRun ? 'Planning categories' : 'Restoring categories',
      current: progressState.completed,
      total: progressState.total,
      phaseCurrent: processed,
      phaseTotal: categories.length,
      itemName: category.name,
    };

    report.progress.push(progress);
    await emitProgress(options, progress);
  }
}

async function restoreChannels(guild, backup, maps, report, options, progressState) {
  const channels = getSortedChannels(backup);
  let processed = 0;

  for (const channel of channels) {
    const oldChannelId = getChannelBackupId(channel);

    if (!oldChannelId) {
      processed += 1;
      continue;
    }

    const type = normalizeChannelType(channel.type);
    const existing = findExistingChannel(guild, channel, type);

    if (existing && options.skipDuplicates !== false) {
      maps.channels.set(oldChannelId, existing.id);
      report.channels.skippedDuplicates += 1;

      report.duplicates.channels.push({
        oldId: oldChannelId,
        existingId: existing.id,
        name: existing.name,
        type,
      });
    } else if (options.dryRun) {
      maps.channels.set(oldChannelId, `dry-channel-${oldChannelId}`);
      report.channels.planned += 1;
    } else {
      const parentOldId = getParentBackupId(channel);
      const parentNewId = parentOldId ? maps.channels.get(parentOldId) : null;

      const overwrites = mapPermissionOverwrites(
        channel.permissionOverwrites || channel.overwrites,
        guild,
        maps
      );

      const payload = {
        name: cleanName(channel.name, 'restored-channel'),
        type,
        parent: parentNewId || undefined,
        permissionOverwrites: overwrites,
        topic: channel.topic || undefined,
        nsfw: Boolean(channel.nsfw),
        rateLimitPerUser: channel.rateLimitPerUser || channel.slowmode || 0,
        reason: options.reason,
      };

      if (
        type === ChannelType.GuildVoice ||
        type === ChannelType.GuildStageVoice
      ) {
        payload.bitrate = channel.bitrate || undefined;
        payload.userLimit = channel.userLimit || undefined;
      }

      const created = await guild.channels.create(payload);

      maps.channels.set(oldChannelId, created.id);
      report.channels.created += 1;

      report.created.channels.push({
        oldId: oldChannelId,
        newId: created.id,
        name: created.name,
        type,
      });
    }

    processed += 1;
    progressState.completed += 1;

    const progress = {
      phase: 'channels',
      step: options.dryRun ? 'Planning channels' : 'Restoring channels',
      current: progressState.completed,
      total: progressState.total,
      phaseCurrent: processed,
      phaseTotal: channels.length,
      itemName: channel.name,
    };

    report.progress.push(progress);
    await emitProgress(options, progress);
  }
}

async function restoreGuildConfig(guild, backup, maps, report, options, progressState) {
  const sections = getBackupConfigSections(backup);

  if (!sections || typeof sections !== 'object') {
    report.config.skipped = true;
    report.config.reason = 'No config sections found in backup.';
    return;
  }

  const entries = Object.entries(sections).filter(
    ([section, data]) => section && data != null
  );

  for (const [section, data] of entries) {
    const remapped = remapConfigValue(data, maps);

    if (options.dryRun) {
      report.config.planned += 1;
    } else {
      guildManager.replaceGuildSection(guild.id, section, remapped);
      report.config.restored += 1;
      report.config.sections.push(section);
    }

    progressState.completed += 1;

    const progress = {
      phase: 'config',
      step: options.dryRun ? 'Planning config' : 'Restoring config',
      current: progressState.completed,
      total: progressState.total,
      itemName: section,
    };

    report.progress.push(progress);
    await emitProgress(options, progress);
  }
}

async function cleanupBeforeRestore(guild, backup, report, options) {
  if (!options.cleanupMode || options.dryRun) return;

  const backupRoleNames = new Set(
    getRestorableRoles(backup).map((role) =>
      cleanName(role.name, 'restored-role').toLowerCase()
    )
  );

  const backupChannelKeys = new Set([
    ...getSortedCategories(backup).map(
      (channel) =>
        `${ChannelType.GuildCategory}:${cleanName(
          channel.name,
          'restored-category'
        ).toLowerCase()}`
    ),
    ...getSortedChannels(backup).map(
      (channel) =>
        `${normalizeChannelType(channel.type)}:${cleanName(
          channel.name,
          'restored-channel'
        ).toLowerCase()}`
    ),
  ]);

  for (const channel of guild.channels.cache.values()) {
    const key = `${channel.type}:${channel.name.toLowerCase()}`;

    if (!backupChannelKeys.has(key)) continue;

    try {
      await channel.delete(options.reason);
      report.cleanup.deletedChannels += 1;
    } catch (error) {
      report.cleanup.skipped.push({
        type: 'channel',
        name: channel.name,
        reason: error.message,
      });
    }
  }

  for (const role of guild.roles.cache.values()) {
    if (
      role.id === guild.id ||
      role.managed ||
      !backupRoleNames.has(role.name.toLowerCase())
    ) {
      continue;
    }

    const hasBotOwner = role.members.some((member) => isBotOwner(member.id));

    if (hasBotOwner) {
      report.cleanup.skipped.push({
        type: 'role',
        name: role.name,
        reason: 'Role is assigned to a Goliath owner.',
      });
      continue;
    }

    try {
      await role.delete(options.reason);
      report.cleanup.deletedRoles += 1;
    } catch (error) {
      report.cleanup.skipped.push({
        type: 'role',
        name: role.name,
        reason: error.message,
      });
    }
  }
}

async function attachRestoreDiff(guild, backup, report, options = {}) {
  const diff = await buildRestoreDiff(guild, backup, {
    enforceGuildMatch: options.requireSameGuild !== false,
  });

  report.restoreDiff = diff;
  report.restoreDiffText = createRestoreDiffText(diff);

  if (diff.warnings?.length) {
    report.warnings.push(
      ...diff.warnings.map((warning) => warning.message || String(warning))
    );
  }

  if (diff.blockers?.length) {
    report.errors.push(...diff.blockers);
  }

  return diff;
}

async function restoreServerBackup(guild, backupId, options = {}) {
  const restoreOptions = {
    onProgress: null,

    dryRun: true,
    confirmed: false,

    requireSameGuild: true,

    restoreRoles: true,
    restoreCategories: true,
    restoreChannels: true,
    restoreConfig: true,

    restoreRolePositions: true,

    skipDuplicates: true,
    cleanupMode: false,

    restoreRequestId: null,
    requestedBy: null,
    approvedBy: null,
    rollbackBackupId: null,

    reason: `Goliath safe restore ${RESTORE_VERSION}`,

    ...options,
  };

  const finalBackupId = backupId || getLatestServerBackupId(guild.id);

  if (!finalBackupId) {
    throw new Error('No server backup found for this guild.');
  }

  const backup = readServerBackup(guild.id, finalBackupId);

  if (!backup) {
    throw new Error(`Backup not found: ${finalBackupId}`);
  }

  const integrity = validateBackupIntegrity(backup.path);

  if (!integrity.valid) {
    throw new Error(
      `Backup integrity validation failed: ${integrity.reason}`
    );
  }

  validateRestore(
    guild,
    backup,
    finalBackupId,
    restoreOptions
  );

  const hierarchy = validateBotHierarchy(guild);

  if (!hierarchy.valid) {
    throw new Error(`Restore blocked: ${hierarchy.reason}`);
  }

  const validation = validateServerBackup(backup, {
    guildId: guild.id,
  });

  if (!validation.valid) {
    throw new Error(
      `Backup validation failed:\n${validation.errors.join('\n')}`
    );
  }

  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const report = createRestoreReport(guild, finalBackupId, restoreOptions);

  report.validation = validation;
  report.hierarchy = hierarchy;

  if (validation.warnings?.length) {
    report.warnings.push(...validation.warnings);
  }

  const diff = await attachRestoreDiff(guild, backup, report, restoreOptions);

  if (diff.blockers?.length) {
    throw new Error(
      `Restore blocked by diff validation:\n${diff.blockers.join('\n')}`
    );
  }

  const maps = {
    roles: new Map(),
    channels: new Map(),
  };

  const progressState = {
    completed: 0,
    total: getRestoreTotal(backup, restoreOptions),
  };

  try {
    await emitProgress(restoreOptions, {
      phase: 'start',
      step: restoreOptions.dryRun
        ? 'Starting restore preview'
        : 'Starting approved restore',
      current: 0,
      total: progressState.total,
    });

    await cleanupBeforeRestore(guild, backup, report, restoreOptions);

    if (restoreOptions.restoreRoles) {
      await restoreRoles(guild, backup, maps, report, restoreOptions, progressState);
    }

    if (restoreOptions.restoreCategories) {
      await restoreCategories(guild, backup, maps, report, restoreOptions, progressState);
    }

    if (restoreOptions.restoreChannels) {
      await restoreChannels(guild, backup, maps, report, restoreOptions, progressState);
    }

    if (restoreOptions.restoreConfig) {
      await restoreGuildConfig(guild, backup, maps, report, restoreOptions, progressState);
    }

    await emitProgress(restoreOptions, {
      phase: 'complete',
      step: restoreOptions.dryRun
        ? 'Restore preview complete'
        : 'Approved restore complete',
      current: progressState.total,
      total: progressState.total,
    });
  } catch (error) {
    report.errors.push(error.message);

    await emitProgress(restoreOptions, {
      phase: 'error',
      step: 'Restore failed',
      current: progressState.completed,
      total: progressState.total,
      error: error.message,
    });

    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
  }

  return report;
}

async function previewRestore(guild, options = {}) {
  const backupId =
    options.backupId ||
    options.selectedBackupId ||
    getLatestServerBackupId(guild.id);

  const report = await restoreServerBackup(guild, backupId, {
    ...options,
    dryRun: true,
    confirmed: false,
    reason: options.reason || `Goliath restore preview ${RESTORE_VERSION}`,
  });

  report.summary = report.restoreDiffText || [
    `Backup: ${report.backupId}`,
    `Roles planned: ${report.roles.planned}`,
    `Categories planned: ${report.categories.planned}`,
    `Channels planned: ${report.channels.planned}`,
    `Config sections planned: ${report.config.planned}`,
    `Warnings: ${report.warnings.length}`,
  ].join('\n');

  return report;
}

async function executeRestore(guild, options = {}) {
  if (!guild) {
    throw new Error('Restore blocked: missing guild.');
  }

  const restoreRequestId = options.restoreRequestId || null;
  const preview = options.preview || null;
  const rollbackBackupId = options.rollbackBackupId || null;

  if (!restoreRequestId) {
    throw new Error('Restore blocked: missing restore request ID.');
  }

  if (!preview) {
    throw new Error('Restore blocked: missing validated restore preview.');
  }

  if (!rollbackBackupId) {
    throw new Error('Restore blocked: rollback snapshot was not created.');
  }

  const integrity = preview.integrity || null;

  if (!integrity) {
    throw new Error('Restore blocked: integrity metadata missing.');
  }

  if (integrity.verified !== true) {
    throw new Error('Restore blocked: integrity verification failed.');
  }

  if (integrity.hashValid === false) {
    throw new Error('Restore blocked: backup hash invalid.');
  }

  if (integrity.corruptionCheck === false) {
    throw new Error('Restore blocked: corruption detected.');
  }

  const restoreDiff = preview.restoreDiff || null;

  if (!restoreDiff) {
    throw new Error('Restore blocked: restore diff missing.');
  }

  if (restoreDiff.safe === false) {
    throw new Error('Restore blocked: restore diff marked unsafe.');
  }

  if (Array.isArray(restoreDiff.blockers) && restoreDiff.blockers.length > 0) {
    throw new Error(
      `Restore blocked: ${restoreDiff.blockers.join(', ')}`
    );
  }

  if (restoreDiff.riskLevel === 'CRITICAL') {
    throw new Error('Restore blocked: CRITICAL risk restore.');
  }

  console.log(`[RESTORE] Safety validation passed for ${guild.name}`);
  console.log(`[RESTORE] Risk Level: ${restoreDiff.riskLevel || 'UNKNOWN'}`);
  console.log(`[RESTORE] Rollback Snapshot: ${rollbackBackupId}`);

  const backupId =
    options.backupId ||
    options.selectedBackupId ||
    preview.backupId ||
    getLatestServerBackupId(guild.id);

  return restoreServerBackup(guild, backupId, {
    ...options,
    dryRun: false,
    confirmed: true,
    reason:
      options.reason ||
      `Goliath approved restore ${RESTORE_VERSION}${
        options.restoreRequestId ? ` | Request ${options.restoreRequestId}` : ''
      }`,
  });
}

async function restoreLatestServerBackup(guild, options = {}) {
  if (!guild) throw new Error('Missing guild.');

  const latestBackupId = getLatestServerBackupId(guild.id);

  if (!latestBackupId) {
    throw new Error('No server backups found for this guild.');
  }

  return restoreServerBackup(guild, latestBackupId, {
    ...options,
    reason:
      options.reason ||
      `Goliath latest backup restore ${RESTORE_VERSION}`,
  });
}

module.exports = {
  RESTORE_VERSION,

  previewRestore,
  executeRestore,

  restoreServerBackup,
  restoreLatestServerBackup,
};
