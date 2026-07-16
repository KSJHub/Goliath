'use strict';

const { Events } = require('discord.js');
const legacyRolesMigration = require('../../core/guild/legacyRolesMigration');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    const reports = legacyRolesMigration.migrateClient(client);
    const migrated = reports.filter((report) => report.migrated === true).length;
    const failed = reports.filter((report) => report.error).length;
    const panels = reports.reduce((total, report) => total + Number(report.panels || 0), 0);
    const timedRules = reports.reduce((total, report) => total + Number(report.timedRules || 0), 0);
    const joinRoles = reports.reduce((total, report) => total + Number(report.joinRoles || 0), 0);

    if (migrated || failed) {
      console.log(`[LegacyRolesMigration] guilds=${migrated} panels=${panels} timedRules=${timedRules} joinRoles=${joinRoles} failed=${failed}`);
    }
    for (const report of reports.filter((item) => item.error)) {
      console.error(`[LegacyRolesMigration] ${report.guildId}: ${report.error}`);
    }
  },
};
