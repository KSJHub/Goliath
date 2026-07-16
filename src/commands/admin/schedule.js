'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSchedulePanel } = require('../../modules/schedule/schedulePanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Open the Schedule Studio event workspace.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Schedule Studio is only available inside a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ ...buildSchedulePanel(interaction), flags: MessageFlags.Ephemeral });
  },
};
