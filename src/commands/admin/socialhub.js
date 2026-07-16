'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildCreatorHubPanel } = require('../../modules/social/socialCreatorPanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('socialhub')
    .setDescription('Open the Social Studio Creator Hub workspace.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Social Studio is only available inside a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const payload = buildCreatorHubPanel(interaction);
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
};
