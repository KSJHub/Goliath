'use strict';

// Moderation panel layout contract: feature rows first; the final row is navigation,
// with Back first and Export immediately after it when export is available.
const { SlashCommandBuilder } = require('discord.js');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const { errorEmbed } = require('../../ui/embeds');
const { safeEditReply } = require('../../ui/interactionResponse');
const { openModPanel } = require('./panel');
const { openExternalAppealFromCommand } = require('./cases');
const { recordModerationSystemEvent, getModerationDoctorStatus } = require('./permissions');

const command = {
  category: 'Moderation',
  help: { name: 'mod', description: '🔐 Open moderation hub and staff tools, or appeal a case by DM.', usage: '/mod or /mod appeal:SERVER_ID:CASE_ID' },
  access: { level: 'mod', ownerOnly: false },
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('🔐 Open Goliath’s moderation hub and staff tools')
    .addStringOption((option) => option.setName('appeal').setDescription('Appeal a case using SERVER_ID:CASE_ID (works in bot DMs)').setRequired(false).setMaxLength(40)),
  async execute(interaction) {
    const appealReference = interaction.options?.getString?.('appeal') || null;
    if (appealReference) {
      try {
        const result = await openExternalAppealFromCommand(interaction, appealReference);
        recordModerationSystemEvent({ interaction, guildId: interaction.guild?.id || 'dm', event: 'moderation.appeal.command', action: 'appeal', metadata: { handled: Boolean(result), referenceProvided: true } });
        return result;
      } catch (error) {
        if (error?.code === 10062 || error?.code === 40060) return;
        console.error('❌ Appeal command fallback failed:', error);
        recordModerationSystemEvent({ interaction, guildId: interaction.guild?.id || 'dm', event: 'moderation.appeal.command.failed', action: 'appeal', reason: error?.message || error, metadata: { stack: String(error?.stack || '').slice(0, 1500) } });
        if (!interaction.deferred && !interaction.replied) return interaction.reply({ content: '❌ Failed to open the appeal form.' }).catch(() => null);
        return safeEditReply(interaction, { content: '❌ Failed to open the appeal form.', embeds: [], components: [] });
      }
    }
    const denied = await enforceCommandAccess(interaction, command);
    if (denied) {
      recordModerationSystemEvent({ interaction, event: 'moderation.command.denied', action: 'view_dashboard', reason: 'Command access policy denied the moderation hub.' });
      return;
    }
    try {
      if (!interaction.guild) {
        recordModerationSystemEvent({ interaction, guildId: 'dm', event: 'moderation.command.invalid_context', action: 'view_dashboard', reason: 'Moderation panel requested outside a guild.' });
        return safeEditReply(interaction, { embeds: [errorEmbed('Use `/mod appeal:SERVER_ID:CASE_ID` in DM to appeal a moderation case. The moderation panel itself can only be used inside a server.')] });
      }
      const doctor = getModerationDoctorStatus();
      if (!doctor.ok) recordModerationSystemEvent({ interaction, event: 'moderation.doctor.warning', action: 'view_dashboard', after: doctor });
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
      return openModPanel(interaction);
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;
      console.error('❌ Mod command failed:', error);
      recordModerationSystemEvent({ interaction, event: 'moderation.command.failed', action: 'view_dashboard', reason: error?.message || error, metadata: { stack: String(error?.stack || '').slice(0, 1500) } });
      return safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to open the moderation hub. Please try again.')],
        components: [],
      });
    }
  },
};

module.exports = command;
