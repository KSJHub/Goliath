'use strict';

const { Events } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
require('../../modules/roleStudio/timedRoles/timedRolesCompat');
const timedRoles = require('../../modules/roleStudio/timedRoles/timedRolesService');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    await timedRoles.startup(client);
    // Reconcile membership independently of Timed Roles enablement.
    for (const guild of client.guilds.cache.values()) {
      if (!guild.available) continue;
      try {
        const members = await guild.members.fetch({ time: 120000 });
        const imported = guildManager.importMembershipRecords(guild, members);
        if (imported) console.info('[Membership Records] Imported', imported, 'members for', guild.id);
      } catch (error) {
        console.warn('[Membership Records] Import failed for', guild.id, error?.message || error);
      }
    }
  },
};
