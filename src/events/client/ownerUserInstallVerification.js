'use strict';

const {
  ApplicationIntegrationType,
  Events,
  InteractionContextType,
  REST,
  Routes,
} = require('discord.js');
const { resolveTokenDetails } = require('../../config/tokenResolver');

const OWNER_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];

function desiredOwnerCommand(client) {
  const command = client?.commands?.get?.('owner');
  if (!command?.data?.toJSON) return null;

  const payload = command.data.toJSON();
  const desired = {
    ...payload,
    integration_types: [ApplicationIntegrationType.UserInstall],
    contexts: [...OWNER_CONTEXTS],
  };
  delete desired.default_member_permissions;
  delete desired.default_permission;
  delete desired.dm_permission;
  return desired;
}

function matchesUserInstall(command) {
  const integrations = Array.isArray(command?.integration_types) ? command.integration_types : [];
  const contexts = Array.isArray(command?.contexts) ? command.contexts : [];
  return integrations.length === 1
    && integrations[0] === ApplicationIntegrationType.UserInstall
    && contexts.length === OWNER_CONTEXTS.length
    && OWNER_CONTEXTS.every((value) => contexts.includes(value));
}

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    const payload = desiredOwnerCommand(client);
    if (!payload) {
      console.warn('[OwnerInstall] /owner is not loaded in client.commands; verification skipped.');
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));

    try {
      const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
      const token = String(resolveTokenDetails({ mode })?.token || '').trim();
      const applicationId = String(client.application?.id || client.user?.id || '').trim();
      if (!token || !applicationId) throw new Error('Missing bot token or application ID.');

      const rest = new REST({ version: '10' }).setToken(token);
      const globalCommands = await rest.get(Routes.applicationCommands(applicationId));
      const owner = (globalCommands || []).find((entry) => entry?.name === 'owner');

      if (!owner) {
        await rest.post(Routes.applicationCommands(applicationId), { body: payload });
        console.log('[OwnerInstall] Created global USER_INSTALL /owner command.');
      } else if (!matchesUserInstall(owner)) {
        await rest.patch(Routes.applicationCommand(applicationId, owner.id), { body: payload });
        console.log('[OwnerInstall] Corrected /owner to USER_INSTALL with complete interaction contexts.');
      } else {
        console.log('[OwnerInstall] Verified /owner: USER_INSTALL only with Guild, BotDM and PrivateChannel contexts.');
      }

      const verified = await rest.get(Routes.applicationCommands(applicationId));
      const finalOwner = (verified || []).find((entry) => entry?.name === 'owner');
      console.log(
        `[OwnerInstall] Discord record: integration_types=${JSON.stringify(finalOwner?.integration_types || [])} `
        + `contexts=${JSON.stringify(finalOwner?.contexts || [])}`,
      );
    } catch (error) {
      console.error('[OwnerInstall] Verification failed:', error?.stack || error?.message || error);
    }
  },
};
