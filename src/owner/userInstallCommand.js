'use strict';

const {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const ownerPanel = require('./command');

// Keep /owner completely out of guild-installed command sets. Discord exposes
// this command only through a USER_INSTALL of the application. Using the full
// USER_INSTALL interaction-context set lets configured owners open the private
// control panel wherever their user-installed Goliath command is available.
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Open the private Goliath owner control panel.')
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

async function execute(interaction, client) {
  return ownerPanel.execute(interaction, client);
}

module.exports = {
  ...ownerPanel,
  data,
  execute,
  category: 'Owner',
  access: { ownerOnly: true, userInstallOnly: true },
};
