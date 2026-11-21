'use strict';

const { Events } = require('discord.js');
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

    // Let startupWelcome inspect each guild independently. Filtering here
    // could throw on one guild's configuration and prevent recovery for all.
    // startupWelcome already skips recovery for disabled guilds.
    try {
      const summary = await startupWelcome(client);
      if (!summary.ok) {
        console.warn(`[Welcome] Startup reported ${summary.warnings} warning(s) across ${summary.guildsChecked} guild(s).`);
      }
    } catch (error) {
      console.error('[Welcome] Startup health and recovery failed:', error);
    }
  },
};