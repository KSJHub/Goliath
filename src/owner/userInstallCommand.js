'use strict';

const {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const ownerPanel = require('./command');

// Keep /owner completely out of guild-installed command sets. Discord exposes
// this command only through a USER_INSTALL of the application, while the
// owner panel itself still performs the OWNER_IDS runtime gate on every use.
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Open the private Goliath owner control panel.')
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(InteractionContextType.Guild);

module.exports = {
  ...ownerPanel,
  data,
  category: 'Owner',
  access: { ownerOnly: true, userInstallOnly: true },
};
