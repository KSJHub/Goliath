// src/commands/tickets/ticket.js

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const {
  sendSetupPanel,
} = require('../../modules/tickets/ticketsPanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('🎫 Manage the Goliath ticket system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('🎫 Open the ticket setup panel.')
    ),

  async execute(interaction) {
    const subcommand =
      interaction.options.getSubcommand(false);

    if (subcommand === 'setup') {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });
      }

      return sendSetupPanel(interaction);
    }

    const payload = {
      content: '❌ Unknown ticket subcommand.',
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload).catch(() => null);
    }

    return interaction.reply(payload).catch(() => null);
  },
};
