'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { enforceCommandAccess } = require('../../../core/commands/commandAccess');
const emojisUserPanel = require('./emojisUserPanel');

module.exports = {
  category: 'Utility',
  help: {
    name: 'e',
    description: 'Quickly use Goliath emojis.',
    usage: '/e [find]',
  },
  access: {
    ownerOnly: false,
  },
  data: new SlashCommandBuilder()
    .setName('e')
    .setDescription('Quickly use a Goliath emoji')
    .addStringOption((option) => option
      .setName('find')
      .setDescription('Choose a built-in or server emoji')
      .setAutocomplete(true)
      .setRequired(false))
    .setDMPermission(false),

  async autocomplete(interaction) {
    return emojisUserPanel.autocomplete(interaction);
  },

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used inside a server.', flags: MessageFlags.Ephemeral });
      }

      const emoji = interaction.options.getString('find');

      if (emoji) {
        const selection = await emojisUserPanel.commandSelection(interaction, emoji);
        if (!selection) {
          return interaction.reply({ content: 'That emoji is no longer available in this server.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply(selection);
      }

      return interaction.reply({ ...emojisUserPanel.buildLauncher(), flags: MessageFlags.Ephemeral });
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('Emoji alias command failed:', error);
      const payload = { content: 'Failed to open Emoji Studio. Please try again.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply(payload);
    }
  },
};
