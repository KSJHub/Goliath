'use strict';

const { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } = require('discord.js');
const emojisUserPanel = require('./emojisUserPanel');

module.exports = {
  category: 'Utility',
  help: {
    name: 'Convert Emoji Shortcodes',
    description: 'Preview and convert Emoji Studio shortcodes in one of your messages.',
  },
  data: new ContextMenuCommandBuilder()
    .setName('Convert Emoji Shortcodes')
    .setType(ApplicationCommandType.Message)
    .setDMPermission(false),

  async execute(interaction) {
    try {
      if (!interaction.guild || !interaction.targetMessage) {
        return interaction.reply({ content: 'This can only be used on a server message.', flags: MessageFlags.Ephemeral });
      }
      const payload = await emojisUserPanel.buildMessageConversionPreview(interaction, interaction.targetMessage);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('Emoji message conversion failed:', error);
      const payload = { content: 'Failed to convert that message. Please try again.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply(payload);
    }
  },
};
