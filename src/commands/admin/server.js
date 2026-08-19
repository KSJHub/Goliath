'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload).catch(() => interaction.followUp(payload).catch(() => null));
  }

  return interaction.reply(payload).catch(() => null);
}

module.exports = {
  hidden: true,
  category: 'Admin',
  devOnly: false,

  access: {
    ownerOnly: true,
  },

  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Internal server developer tools.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Choose what to do.')
        .setRequired(true)
        .addChoices(
          { name: 'copy', value: 'copy' },
          { name: 'analyse', value: 'analyse' },
          { name: 'export', value: 'export' },
          { name: 'build', value: 'build' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('source_server')
        .setDescription('Source server ID for analyse/export.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('destination_server')
        .setDescription('Destination server ID for analyse/build.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Template name for export.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('template_id')
        .setDescription('Optional stable template ID for export.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('version')
        .setDescription('Template version for export.')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Short template description for export.')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      const duplicator = require('../../owner/dev/duplicator');
      return await duplicator.run(interaction);
    } catch (error) {
      console.error('[ServerCommand] Failed:', error);
      return safeReply(interaction, `❌ Server command failed: ${error.message}`);
    }
  },
};
