'use strict';

const {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const ownerPanel = require('./command');

/**
 * Private Goliath owner command.
 *
 * /owner is registered as a GUILD_INSTALL command and disabled by default
 * for ordinary guild members. Discord therefore does not expose it as a
 * normal member command.
 *
 * IMPORTANT:
 * This is only the Discord-side visibility restriction.
 * ownerPanel.execute() still enforces Goliath's OWNER_IDS authorization,
 * which remains the authoritative security gate.
 */
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Open the private Goliath owner control panel.')
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction, client) {
  return ownerPanel.execute(interaction, client);
}

module.exports = {
  ...ownerPanel,
  data,
  execute,
  category: 'Owner',
  access: {
    ownerOnly: true,
    restrictedGuildCommand: true,
  },
};
