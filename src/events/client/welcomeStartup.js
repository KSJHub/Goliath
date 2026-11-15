'use strict';

const { Events } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const { startupWelcome } = require('../../modules/messageStudio/welcome/welcome');
const scheduledWelcomeScheduler = require('../../modules/messageStudio/welcome/scheduledWelcomeScheduler');

module.exports = {
  name: Events.ClientReady,
  async execute(client) {
    // Scheduled Welcome startup must not prevent recovery of ordinary
    // deferred welcomes when its scheduler fails to initialise.
    try {
      await scheduledWelcomeScheduler.startup(client);
    } catch (error) {
      console.error('[Welcome] Scheduled Welcome startup failed:', error);
    }

    const enabledGuilds = client.guilds.cache.filter((guild) => guildManager.isModuleEnabled(guild.id, 'welcome'));
    if (!enabledGuilds.size) {
      console.log('[Welcome] Startup check skipped: no enabled guilds.');
      return;
    }

    await startupWelcome({
      ...client,
      guilds: { ...client.guilds, cache: enabledGuilds },
    });
  },
};