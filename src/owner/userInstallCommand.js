'use strict';

const { SlashCommandBuilder } = require('discord.js');
const ownerPanel = require('./command');

/**
 * Private Goliath owner command.
 *
 * /owner is a normal guild/global application command so the configured
 * Goliath owners can invoke it in any server where Goliath is installed.
 * Discord cannot express a dynamic OWNER_IDS allow-list in command metadata,
 * so ownerPanel.execute() is the authoritative access gate.
 *
 * IMPORTANT:
 * Visibility is not authorization. The command may appear in the picker,
 * but only configured OWNER_IDS receive the private owner panel.
 */
const data = new SlashCommandBuilder()
  .setName('owner')
  .setDescription('Open the private Goliath owner control panel.')
  .setDMPermission(false);

async function execute(interaction, client) {
  return ownerPanel.execute(interaction, client);
}

module.exports = {
  ...ownerPanel,
  data,
  execute,
  category: 'Owner',
  access: { ownerOnly: true },
};
