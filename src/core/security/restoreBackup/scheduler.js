const {
  createServerBackup,
  listServerBackups,
  deleteServerBackup,
} = require('./backup');

const {
  incrementSyncAttempt,
  verifyRemoteHash,
  markBackupSynced,
  markBackupFailed,
  getPendingSyncs,
  uploadBackup,
} = require('./sync');

const guildManager = require('../../guild/guildManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');

const CHECK_EVERY_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;
const BACKUP_SCHEDULER_ID = 'serverBackups:automatic-backup:global';
const DEFAULT_SYNC_INTERVAL_MS = 1000 * 60 * 5;
const SYNC_SCHEDULER_ID = 'serverBackups:remote-sync:global';

let started = false;
let workerRunning = false;
let syncInterval = null;

function getEnvNumber(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function isEnabled() {
  return String(process.env.SERVER_BACKUP_ENABLED || 'false').toLowerCase() === 'true';
}

function getIntervalDays() {
  return getEnvNumber('SERVER_BACKUP_INTERVAL_DAYS', 7);
}

function getRetentionLimit() {
  return Math.max(1, Math.trunc(getEnvNumber('SERVER_BACKUP_RETENTION', 3)));
}

function daysToMs(days) {
  return days * 24 * 60 * 60 * 1000;
}

function getLastBackupAt(guildId) {
  const data = guildManager.getGuildSection(guildId, 'serverBackups', {});
  return data.lastBackupAt ? new Date(data.lastBackupAt).getTime() : 0;
}

function shouldBackup(guildId) {
  const lastBackupAt = getLastBackupAt(guildId);
  if (!lastBackupAt) return true;
  return Date.now() - lastBackupAt >= daysToMs(getIntervalDays());
}

function getClientGuilds(client) {
  const guilds = client?.guilds?.cache;
  if (!guilds || typeof guilds.values !== 'function') return null;
  return [...guilds.values()];
}

function cleanupOldBackups(guildId) {
  const retentionLimit = getRetentionLimit();
  const backups = listServerBackups(guildId);
  if (backups.length <= retentionLimit) return 0;

  const toDelete = backups.slice(retentionLimit);
  let deleted = 0;

  for (const backup of toDelete) {
    const backupId = typeof backup === 'string' ? backup : backup.backupId;
    if (backupId && deleteServerBackup(guildId, backupId)) deleted += 1;
  }

  return deleted;
}

async function backupGuild(guild) {
  if (!guild) return null;

  if (!guildManager.isModuleEnabled(guild.id, 'serverBackups')) {
    return { guildId: guild.id, skipped: true, reason: 'Server Backups module is disabled.' };
  }

  if (!shouldBackup(guild.id)) {
    return { guildId: guild.id, skipped: true, reason: 'Backup interval not reached.' };
  }

  const backup = await createServerBackup(guild, {
    createdBy: 'system:auto-weekly',
    reason: 'Automatic weekly server disaster backup',
    type: 'scheduled',
  });

  return {
    guildId: guild.id,
    guildName: guild.name,
    backupId: backup.backupId,
    deletedOldBackups: cleanupOldBackups(guild.id),
  };
}

function registerBackupScheduler() {
  return sentinelScheduler.register({
    id: BACKUP_SCHEDULER_ID,
    module: 'serverBackups',
    component: 'automatic-backup',
    intervalMs: CHECK_EVERY_MS,
    staleAfterMs: Math.max(CHECK_EVERY_MS * 3, 3 * 60 * 60 * 1000),
    details: {
      backupIntervalDays: getIntervalDays(),
      retentionLimit: getRetentionLimit(),
    },
  });
}

async function runServerBackupCycle(client) {
  if (!isEnabled()) return [];

  const schedulerId = registerBackupScheduler();
  const guilds = getClientGuilds(client);

  if (!guilds) {
    const error = new Error('Discord client is not ready yet.');
    sentinelScheduler.fail(schedulerId, error, { phase: 'client-unavailable' });
    console.warn('💾 Server backup cycle skipped: Discord client is not ready yet.');
    return [];
  }

  const results = [];
  let failures = 0;
  let created = 0;
  let skipped = 0;

  for (const guild of guilds) {
    if (!guildManager.isModuleEnabled(guild.id, 'serverBackups')) continue;

    try {
      const result = await backupGuild(guild);
      if (result) results.push(result);

      if (result?.skipped) {
        skipped += 1;
        console.log(`💾 Backup skipped: ${guild.name} | ${result.reason}`);
      } else if (result) {
        created += 1;
        console.log(`💾 Backup created: ${guild.name} | ${result.backupId} | old deleted: ${result.deletedOldBackups}`);
      }
    } catch (error) {
      failures += 1;
      console.error(`❌ Backup failed for ${guild.name} (${guild.id}):`, error);
    }
  }

  const details = { guildsChecked: guilds.length, backupsCreated: created, skipped, guildFailures: failures };
  if (failures > 0) {
    sentinelScheduler.fail(schedulerId, new Error(`${failures} guild backup operation(s) failed.`), details);
  } else {
    sentinelScheduler.beat(schedulerId, details);
  }

  return results;
}

function startServerBackupScheduler(client) {
  if (started) {
    console.warn('⚠️ Server backup scheduler already running.');
    return;
  }

  if (!isEnabled()) {
    console.log('💾 Server backup scheduler disabled.');
    return;
  }

  started = true;
  registerBackupScheduler();

  console.log(`💾 Server backup scheduler started | every ${getIntervalDays()} day(s) | keep ${getRetentionLimit()}`);

  setTimeout(() => {
    runServerBackupCycle(client).catch((error) => {
      sentinelScheduler.fail(BACKUP_SCHEDULER_ID, error, { phase: 'initial-cycle' });
      console.error('❌ Initial server backup cycle failed:', error);
    });
  }, INITIAL_DELAY_MS).unref?.();

  setInterval(() => {
    runServerBackupCycle(client).catch((error) => {
      sentinelScheduler.fail(BACKUP_SCHEDULER_ID, error, { phase: 'scheduled-cycle' });
      console.error('❌ Scheduled server backup cycle failed:', error);
    });
  }, CHECK_EVERY_MS).unref?.();
}

async function processSyncEntry(entry) {
  if (!entry) return null;

  try {
    incrementSyncAttempt(entry.syncId);

    const result = await uploadBackup({
      guildId: entry.guildId,
      backupId: entry.backupId,
      backupPath: entry.backupPath,
      environment: entry.environment,
      backupType: entry.backupType,
    });

    if (!result.configured) {
      return {
        success: false,
        skipped: true,
        reason: result.reason || 'Google Drive not configured.',
      };
    }

    if (!result.uploaded) {
      markBackupFailed(entry.syncId, result.reason || 'Upload failed.');
      return {
        success: false,
        skipped: false,
        reason: result.reason || 'Upload failed.',
      };
    }

    let verified = false;
    if (result.remoteHash) {
      const verification = verifyRemoteHash(entry.syncId, result.remoteHash);
      verified = verification.verified === true;
    }

    markBackupSynced(entry.syncId, {
      remoteVerified: verified,
      remoteHash: result.remoteHash || null,
    });

    return { success: true, verified };
  } catch (error) {
    markBackupFailed(entry.syncId, error.message || 'Unknown sync worker failure.');
    return { success: false, error };
  }
}

async function processPendingSyncs() {
  if (workerRunning) {
    return { skipped: true, reason: 'Sync worker already running.' };
  }

  workerRunning = true;

  try {
    const pending = getPendingSyncs();
    const results = [];

    for (const entry of pending) {
      const result = await processSyncEntry(entry);
      results.push({
        syncId: entry.syncId,
        backupId: entry.backupId,
        guildId: entry.guildId,
        result,
      });
    }

    return { success: true, processed: results.length, results };
  } finally {
    workerRunning = false;
  }
}

function registerSyncScheduler(intervalMs) {
  return sentinelScheduler.register({
    id: SYNC_SCHEDULER_ID,
    module: 'serverBackups',
    component: 'remote-sync',
    intervalMs,
    staleAfterMs: Math.max(intervalMs * 3, 180_000),
  });
}

async function runMonitoredSyncCycle(intervalMs) {
  const schedulerId = registerSyncScheduler(intervalMs);

  try {
    const result = await processPendingSyncs();

    if (result?.skipped) {
      sentinelScheduler.beat(schedulerId, {
        skipped: true,
        reason: result.reason || 'already-running',
      });
      return result;
    }

    const failures = (result?.results || []).filter(
      (item) => item?.result?.success === false && item?.result?.skipped !== true
    );

    const details = {
      processed: Number(result?.processed || 0),
      failed: failures.length,
      skipped: (result?.results || []).filter((item) => item?.result?.skipped === true).length,
    };

    if (failures.length) {
      sentinelScheduler.fail(schedulerId, new Error(`${failures.length} backup sync operation(s) failed.`), details);
    } else {
      sentinelScheduler.beat(schedulerId, details);
    }

    return result;
  } catch (error) {
    sentinelScheduler.fail(schedulerId, error, { phase: 'sync-cycle' });
    throw error;
  }
}

function startBackupWorker(options = {}) {
  const intervalMs = Number(options.intervalMs || process.env.BACKUP_SYNC_INTERVAL_MS) || DEFAULT_SYNC_INTERVAL_MS;

  if (syncInterval) {
    return {
      started: false,
      reason: 'Backup sync worker already running.',
      intervalMs,
    };
  }

  registerSyncScheduler(intervalMs);

  syncInterval = setInterval(async () => {
    try {
      await runMonitoredSyncCycle(intervalMs);
    } catch (error) {
      console.error('[Backup Sync Worker Error]', error);
    }
  }, intervalMs);

  if (typeof syncInterval.unref === 'function') syncInterval.unref();

  return { started: true, intervalMs };
}

module.exports = {
  startServerBackupScheduler,
  runServerBackupCycle,
  backupGuild,
  cleanupOldBackups,
  getIntervalDays,
  getRetentionLimit,
  startBackupWorker,
};
