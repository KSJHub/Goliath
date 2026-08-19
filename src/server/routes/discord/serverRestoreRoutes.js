// src/server/routes/discord/serverRestoreRoutes.js

const express = require('express');

const {
  getBackupSummaries,
  readServerBackup,
  createServerBackup,
  validateServerBackup,
} = require('../../../core/security/serverBackup');

const {
  restoreServerBackup,
} = require('../../../core/security/serverRestore');

const {
  buildRestoreComparison,
} = require('../../../core/security/serverRestoreCompare');

const { requireEntitlement } = require('../../middleware/requireEntitlement');

const router = express.Router();

function getClient(req) {
  return (
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    req.app?.get?.('client') ||
    req.app?.get?.('goliath.client') ||
    req.client ||
    null
  );
}

function getGuild(client, guildId) {
  if (!client?.guilds?.cache || !guildId) return null;
  return client.guilds.cache.get(String(guildId)) || null;
}

function isAuthenticated(req) {
  return Boolean(req.session?.user);
}

function denyUnauthenticated(res) {
  return res.status(401).json({
    success: false,
    error: 'Not authenticated.',
  });
}

function requireAuthenticated(req, res, next) {
  if (!isAuthenticated(req)) return denyUnauthenticated(res);
  return next();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeBackupSummary(backup) {
  if (!backup || typeof backup !== 'object') return null;

  const channels = Array.isArray(backup.channels) ? backup.channels : [];
  const roles = Array.isArray(backup.roles) ? backup.roles : [];

  return {
    backupId: backup.backupId,
    createdAt: backup.createdAt,
    createdBy: backup.createdBy,
    reason: backup.reason,
    guildId: backup.guild?.id || backup.guildId || null,
    guildName: backup.guild?.name || backup.guildName || null,
    roles: roles.length,
    channels: channels.length,
    categories: channels.filter((channel) => Number(channel.type) === 4).length,
    logsIncluded: Boolean(backup.logs),
    restoreNotes: backup.restoreNotes || null,
    version: backup.version || backup.backupVersion || null,
    validation: validateServerBackup(backup, { guildId: backup.guild?.id, strict: false }),
  };
}

function normalizeBackups(backups) {
  if (!Array.isArray(backups)) return [];

  return backups
    .map((backup) => safeBackupSummary(backup) || backup)
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = Date.parse(a.createdAt || 0);
      const bTime = Date.parse(b.createdAt || 0);
      return safeNumber(bTime) - safeNumber(aTime);
    });
}

function getRestoreOptions(input = {}) {
  if (!input || typeof input !== 'object') return {};

  return {
    restoreRoles: input.restoreRoles !== false,
    restoreChannels: input.restoreChannels !== false,
    restorePermissions: input.restorePermissions !== false,
    restoreCategories: input.restoreCategories !== false,
    skipDuplicates: input.skipDuplicates !== false,
  };
}

router.use('/:guildId', requireAuthenticated, requireEntitlement('backup.restore'));

router.get('/:guildId/backups', async (req, res) => {
  try {
    const { guildId } = req.params;
    const backups = getBackupSummaries(guildId);

    return res.json({
      success: true,
      guildId,
      backups: normalizeBackups(backups),
    });
  } catch (error) {
    console.error('Failed to list backups:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list backups.',
    });
  }
});

router.get('/:guildId/backups/:backupId', async (req, res) => {
  try {
    const { guildId, backupId } = req.params;
    const backup = readServerBackup(guildId, backupId);

    if (!backup) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found.',
      });
    }

    return res.json({
      success: true,
      guildId,
      backup: safeBackupSummary(backup),
    });
  } catch (error) {
    console.error('Failed to read backup:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to read backup.',
    });
  }
});

router.post('/:guildId/restore/compare', async (req, res) => {
  try {
    const client = getClient(req);
    const { guildId } = req.params;
    const { backupId } = req.body || {};
    const guild = getGuild(client, guildId);

    if (!guild) {
      return res.status(404).json({
        success: false,
        error: 'Guild not found or bot is not in this server.',
      });
    }

    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: 'Missing backupId.',
      });
    }

    const backup = readServerBackup(guildId, backupId);
    if (!backup) {
      return res.status(404).json({
        success: false,
        error: 'Backup not found.',
      });
    }

    const validation = validateServerBackup(backup, { guildId, strict: false });
    const comparison = await buildRestoreComparison(guild, backup);

    return res.json({
      success: true,
      guildId,
      backupId,
      validation,
      comparison,
    });
  } catch (error) {
    console.error('Restore comparison failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Restore comparison failed.',
    });
  }
});

router.post('/:guildId/restore/preview', async (req, res) => {
  try {
    const client = getClient(req);
    const { guildId } = req.params;
    const { backupId, options = {} } = req.body || {};
    const guild = getGuild(client, guildId);

    if (!guild) {
      return res.status(404).json({
        success: false,
        error: 'Guild not found or bot is not in this server.',
      });
    }

    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: 'Missing backupId.',
      });
    }

    const report = await restoreServerBackup(guild, backupId, {
      ...getRestoreOptions(options),
      dryRun: true,
      confirmed: false,
      cleanupMode: false,
      skipDuplicates: true,
      reason: 'Goliath restore preview',
    });

    return res.json({
      success: true,
      guildId,
      backupId,
      report,
    });
  } catch (error) {
    console.error('Restore preview failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Restore preview failed.',
    });
  }
});

router.post('/:guildId/restore/execute', async (req, res) => {
  try {
    const client = getClient(req);
    const { guildId } = req.params;
    const { backupId, confirmText, cleanupMode = false, options = {} } = req.body || {};
    const guild = getGuild(client, guildId);

    if (!guild) {
      return res.status(404).json({
        success: false,
        error: 'Guild not found or bot is not in this server.',
      });
    }

    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: 'Missing backupId.',
      });
    }

    if (confirmText !== 'RESTORE') {
      return res.status(400).json({
        success: false,
        error: 'Restore confirmation failed. Type RESTORE to continue.',
      });
    }

    const safetyBackup = await createServerBackup(guild, {
      createdBy: `dashboard:${req.session.user.id}`,
      reason: `Automatic safety backup before restoring ${backupId}`,
    });

    const progress = [];
    const report = await restoreServerBackup(guild, backupId, {
      ...getRestoreOptions(options),
      dryRun: false,
      confirmed: true,
      cleanupMode: Boolean(cleanupMode),
      skipDuplicates: true,
      reason: `Goliath confirmed restore from ${backupId}`,
      onProgress: async (payload) => {
        progress.push(payload);
      },
    });

    return res.json({
      success: true,
      guildId,
      backupId,
      safetyBackup: {
        backupId: safetyBackup.backupId,
        createdAt: safetyBackup.createdAt,
      },
      report: {
        ...report,
        progress,
      },
    });
  } catch (error) {
    console.error('Restore execution failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Restore execution failed.',
    });
  }
});

module.exports = router;
