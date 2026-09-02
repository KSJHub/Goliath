'use strict';

const serverBackup = require('../security/restoreBackup/backup');
const backupNotifications = require('./backupNotifications');

let wired = false;
let originalCreateServerBackup = null;

function wireBackupNotifications() {
  if (wired) return true;
  if (!serverBackup || typeof serverBackup.createServerBackup !== 'function') return false;

  originalCreateServerBackup = serverBackup.createServerBackup;

  serverBackup.createServerBackup = async function createServerBackupWithNotifications(guild, options = {}) {
    try {
      const backup = await originalCreateServerBackup.call(this, guild, options);
      backupNotifications.backupCompleted({
        ...backup,
        guildId: backup?.guild?.id || guild?.id || null,
        guildName: backup?.guild?.name || guild?.name || null,
        backupType: backup?.backupType || backup?.type || options.backupType || options.type || 'runtime',
      });
      return backup;
    } catch (error) {
      backupNotifications.backupFailed({
        guildId: guild?.id || options.guildId || null,
        guildName: guild?.name || null,
        backupType: options.backupType || options.type || 'runtime',
        environment: process.env.BOT_MODE,
        error: error.message || 'Backup failed.',
      });
      throw error;
    }
  };

  wired = true;
  return true;
}

module.exports = { wireBackupNotifications };
