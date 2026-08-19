'use strict';

const { normalizeBotMode } = require('../../config/botModes');
const notifications = require('./notificationStore');

function ownerGuildId(fallbackGuildId = null) {
  return process.env.OWNER_NOTIFICATION_GUILD_ID || process.env.PRIMARY_GUILD_ID || process.env.GUILD_ID || fallbackGuildId || null;
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function notify(guildId, payload = {}, options = {}) {
  const targetGuildId = ownerGuildId(guildId);
  if (!targetGuildId) return null;

  try {
    return notifications.addNotificationOnce(targetGuildId, {
      source: 'backup',
      route: '/owner/backups',
      ...payload,
    }, options);
  } catch (error) {
    console.warn('[BackupNotifications] skipped:', error.message || error);
    return null;
  }
}

function backupCompleted(backup = {}) {
  const backupId = backup.backupId || backup.id || 'unknown';
  const backupType = backup.backupType || backup.type || 'runtime';
  const guildId = backup.guildId || backup.guild?.id || null;
  const guildName = backup.guildName || backup.guild?.name || 'Unknown Guild';
  const environment = normalizeBotMode(backup.environment || backup.metadata?.environment);
  const roles = normalizeCount(Array.isArray(backup.roles) ? backup.roles.length : (backup.roles ?? backup.counts?.roles));
  const channels = normalizeCount(Array.isArray(backup.channels) ? backup.channels.length : (backup.channels ?? backup.counts?.channels));
  const level = backupType === 'rollback' ? 'warning' : 'success';
  const title = backupType === 'rollback' ? 'Rollback snapshot created' : 'Backup completed';

  return notify(guildId, {
    level,
    title,
    message: `${guildName} ${backupType} backup ${backupId} completed with ${roles} roles and ${channels} channels.`,
    metadata: { backupId, backupType, guildId, guildName, environment, roles, channels, fingerprint: `backup:completed:${environment}:${backupId}` },
  }, { fingerprint: `backup:completed:${environment}:${backupId}`, windowMs: 24 * 60 * 60_000 });
}

function backupFailed(details = {}) {
  const guildId = details.guildId || details.guild?.id || null;
  const environment = normalizeBotMode(details.environment);
  const backupType = details.backupType || details.type || 'runtime';
  const message = details.error || details.message || 'Backup failed.';

  return notify(guildId, {
    level: 'danger',
    title: 'Backup failed',
    message,
    metadata: { guildId, environment, backupType, error: message, fingerprint: `backup:failed:${environment}:${guildId || 'owner'}:${message}` },
  }, { fingerprint: `backup:failed:${environment}:${guildId || 'owner'}:${message}`, windowMs: 15 * 60_000 });
}

function backupIntegrityWarning(backup = {}, warning = 'Backup integrity needs attention.') {
  const backupId = backup.backupId || backup.id || 'unknown';
  const guildId = backup.guildId || backup.guild?.id || null;
  const environment = normalizeBotMode(backup.environment || backup.metadata?.environment);

  return notify(guildId, {
    level: 'warning',
    title: 'Backup integrity warning',
    message: warning,
    metadata: { backupId, guildId, environment, warning, fingerprint: `backup:integrity:${environment}:${backupId}` },
  }, { fingerprint: `backup:integrity:${environment}:${backupId}`, windowMs: 24 * 60 * 60_000 });
}

function restoreQueueFailed(environment = process.env.BOT_MODE, count = 1, message = 'Restore queue has failed request(s).') {
  const mode = normalizeBotMode(environment);
  const failedCount = Math.max(1, normalizeCount(count));

  return notify(null, {
    level: 'danger',
    title: 'Restore queue failure',
    message: `${failedCount} failed restore request(s): ${message}`,
    metadata: { environment: mode, count: failedCount, fingerprint: `backup:restore-failed:${mode}:${failedCount}` },
  }, { fingerprint: `backup:restore-failed:${mode}:${failedCount}`, windowMs: 15 * 60_000 });
}

module.exports = {
  backupCompleted,
  backupFailed,
  backupIntegrityWarning,
  restoreQueueFailed,
};
