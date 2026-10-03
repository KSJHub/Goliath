'use strict';

const { Events, REST, Routes } = require('discord.js');
const { resolveTokenDetails } = require('../../config/tokenResolver');

/**
 * /owner registration verification.
 *
 * /owner is a normal global/guild-available command. Authorization is
 * enforced by the owner command itself using the configured Goliath owner IDs.
 *
 * This module is verification-only. It MUST NOT convert /owner to
 * USER_INSTALL or mutate Discord's command registration.
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

      const owner = (globalCommands || []).find(
        (entry) => entry?.name === 'owner'
      );

      if (!owner) {
        console.warn('[OwnerInstall] /owner is not present in global command registration.');
        return;
      }

      const integrations = Array.isArray(owner.integration_types)
        ? owner.integration_types
        : [];

      if (integrations.includes(1) && integrations.length === 1) {
        console.warn(
          '[OwnerInstall] WARNING: Discord still reports /owner as USER_INSTALL only; no automatic mutation performed.'
        );
        return;
      }

      console.log(
        `[OwnerInstall] Verified normal /owner registration: integration_types=${JSON.stringify(integrations)}.`
      );
    } catch (error) {
      console.error(
        '[OwnerInstall] /owner verification failed:',
        error?.stack || error?.message || error
      );
    }
  },
};
