'use strict';

const {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');
const ownerPanel = require('./command');

// /owner follows the configured Goliath owner account rather than a guild
// installation. Keep it USER_INSTALL-only and expose it in every Discord
// interaction context supported for user-installed application commands.
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Open the private Goliath owner control panel.')
  .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

module.exports = {
  ...ownerPanel,
  data,
  category: 'Owner',
  access: { ownerOnly: true, userInstallOnly: true },
};
