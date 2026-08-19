const {
  createServerBackup,
  listServerBackups,
  deleteServerBackup,
} = require('./serverBackup');

const guildManager = require('../guild/guildManager');
const sentinelScheduler = require('../../owner/sentinel/schedulerRegistry.js');

const CHECK_EVERY_MS = 60 * 60 * 1000; // checks hourly
const INITIAL_DELAY_MS = 30 * 1000;
const SCHEDULER_ID = 'serverBackups:automatic-backup:global';

let started = false;

function getEnvNumber(name, fallback) {
  const value = Number(process.env[name]);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

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

  if (!guilds || typeof guilds.values !== 'function') {
    return null;
  }

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

    if (backupId && deleteServerBackup(guildId, backupId)) {
      deleted += 1;
    }
  }

  return deleted;
}

async function backupGuild(guild) {
  if (!guild) return null;

  if (!guildManager.isModuleEnabled(guild.id, 'serverBackups')) {
    return {
      guildId: guild.id,
      skipped: true,
      reason: 'Server Backups module is disabled.',
    };
  }

  if (!shouldBackup(guild.id)) {
    return {
      guildId: guild.id,
      skipped: true,
      reason: 'Backup interval not reached.',
    };
  }

  const backup = await createServerBackup(guild, {
    createdBy: 'system:auto-weekly',
    reason: 'Automatic weekly server disaster backup',
    type: 'scheduled',
  });

  const deletedOldBackups = cleanupOldBackups(guild.id);

  return {
    guildId: guild.id,
    guildName: guild.name,
    backupId: backup.backupId,
    deletedOldBackups,
  };
}

function registerScheduler() {
  return sentinelScheduler.register({
    id: SCHEDULER_ID,
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

  const schedulerId = registerScheduler();
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
        console.log(
          `💾 Backup created: ${guild.name} | ${result.backupId} | old deleted: ${result.deletedOldBackups}`
        );
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
  registerScheduler();

  console.log(
    `💾 Server backup scheduler started | every ${getIntervalDays()} day(s) | keep ${getRetentionLimit()}`
  );

  setTimeout(() => {
    runServerBackupCycle(client).catch((error) => {
      sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'initial-cycle' });
      console.error('❌ Initial server backup cycle failed:', error);
    });
  }, INITIAL_DELAY_MS).unref?.();

  setInterval(() => {
    runServerBackupCycle(client).catch((error) => {
      sentinelScheduler.fail(SCHEDULER_ID, error, { phase: 'scheduled-cycle' });
      console.error('❌ Scheduled server backup cycle failed:', error);
    });
  }, CHECK_EVERY_MS).unref?.();
}

module.exports = {
  startServerBackupScheduler,
  runServerBackupCycle,
  backupGuild,
  cleanupOldBackups,
  getIntervalDays,
  getRetentionLimit,
};
