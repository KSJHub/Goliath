'use strict';

const {
  Events,
  REST,
  Routes,
} = require('discord.js');

const { resolveTokenDetails } = require('../../config/tokenResolver');

/**
 * Legacy USER_INSTALL /owner cleanup.
 *
 * /owner is now a restricted GUILD_INSTALL command with
 * default_member_permissions=8 (Administrator).
 *
 * This startup check ensures the old global USER_INSTALL /owner registration
 * cannot survive and remain discoverable outside the restricted guild command
 * registration.
 */
module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    await new Promise((resolve) => setTimeout(resolve, 2500));

    try {
      const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
      const token = String(resolveTokenDetails({ mode })?.token || '').trim();
      const applicationId = String(
        client.application?.id || client.user?.id || ''
      ).trim();

      if (!token || !applicationId) {
        throw new Error('Missing bot token or application ID.');
      }

      const rest = new REST({ version: '10' }).setToken(token);

      const globalCommands = await rest.get(
        Routes.applicationCommands(applicationId)
      );

      const staleOwner = (globalCommands || []).find(
        (entry) => entry?.name === 'owner'
      );

      if (!staleOwner) {
        console.log(
          '[OwnerInstall] Verified: no legacy global /owner registration.'
        );
        return;
      }

      await rest.delete(
        Routes.applicationCommand(applicationId, staleOwner.id)
      );

      console.log(
        `[OwnerInstall] Removed legacy global /owner command ${staleOwner.id}.`
      );
    } catch (error) {
      console.error(
        '[OwnerInstall] Legacy /owner cleanup failed:',
        error?.stack || error?.message || error
      );
    }
  },
};
