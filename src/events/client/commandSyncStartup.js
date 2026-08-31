'use strict';

const { Events } = require('discord.js');

function startupSyncEnabled() {
  const value = String(process.env.COMMAND_SYNC_ON_STARTUP ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute() {
    if (!startupSyncEnabled()) {
      console.log('[CommandSync] Startup sync disabled by COMMAND_SYNC_ON_STARTUP.');
      return;
    }

    try {
      const { syncCommands } = require('../../core/commands/syncCommands');
      const result = await syncCommands();
      console.log(
        `[CommandSync] Startup sync complete (${String(result?.mode || process.env.BOT_MODE || 'unknown').toUpperCase()}): `
        + `${(result?.commands || []).map((name) => `/${name}`).join(', ') || 'no public commands'}`,
      );
    } catch (error) {
      // Keep the bot online if Discord rejects the user-install /owner command
      // (for example until User Install is enabled in the Developer Portal),
      // but make the failure explicit in startup logs.
      console.error('[CommandSync] Startup sync failed:', error?.stack || error?.message || error);
    }
  },
};
