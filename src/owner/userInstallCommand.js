'use strict';

const {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} = require('discord.js');

const ownerPanel = require('./command');

/**
 * Private Goliath owner command.
 *
 * /owner is registered as a GUILD_INSTALL command and intentionally visible
 * in the guild command picker. Discord cannot express a dynamic OWNER_IDS
 * allow-list through default_member_permissions, so the authoritative owner
 * check remains inside ownerPanel.execute().
 *
 * IMPORTANT:
 * Visibility is not authorization. Non-owners can see the command entry, but
 * ownerPanel.execute() and every owner-panel interaction enforce OWNER_IDS.
 */
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('💎 Open Goliath’s private owner control centre and system tools')
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild)
  .setDMPermission(false);

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
