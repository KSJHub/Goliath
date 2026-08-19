'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const formsPanel = require('../../modules/feedbackStudio/forms/formsPanel');
const forms = require('../../modules/feedbackStudio/forms/forms');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');

async function safeReply(interaction, payload) {
  const finalPayload = {
    ...payload,
    flags: 64,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(finalPayload);
  }

  return interaction.reply(finalPayload);
}

module.exports = {
  category: 'Admin',

  help: {
    name: 'forms',
    description: '📝 Manage Goliath universal forms foundation.',
    usage: '/forms overview | /forms create-defaults',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('forms')
    .setDescription('📝 Manage Goliath universal forms')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('overview')
        .setDescription('Show the current forms overview')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create-defaults')
        .setDescription('Create starter Support, Appeal and Application forms')
    ),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    const action = interaction.options.getSubcommand(false) || 'overview';

    if (action === 'create-defaults') {
      const defaults = [
        {
          formId: 'support',
          name: 'Support Request',
          description: 'Ask staff for help through a clean support form.',
          buttonLabel: 'Open Support Form',
          action: forms.FORM_ACTIONS.CREATE_TICKET,
          ticketType: 'support',
          fields: [
            { id: 'summary', label: 'What do you need help with?', type: forms.FIELD_TYPES.SHORT, required: true, maxLength: 100 },
            { id: 'details', label: 'Describe the issue', type: forms.FIELD_TYPES.PARAGRAPH, required: true, maxLength: 1000 },
          ],
        },
        {
          formId: 'appeal',
          name: 'Punishment Appeal',
          description: 'Appeal a timeout, kick, ban or moderation decision.',
          buttonLabel: 'Open Appeal Form',
          action: forms.FORM_ACTIONS.CREATE_TICKET,
          ticketType: 'appeal',
          fields: [
            { id: 'punishment', label: 'What are you appealing?', type: forms.FIELD_TYPES.SHORT, required: true, maxLength: 100 },
            { id: 'reason', label: 'Why should staff review it?', type: forms.FIELD_TYPES.PARAGRAPH, required: true, maxLength: 1000 },
          ],
        },
        {
          formId: 'application',
          name: 'Application Form',
          description: 'Apply for staff, creator, event or community roles.',
          buttonLabel: 'Open Application',
          action: forms.FORM_ACTIONS.CREATE_TICKET,
          ticketType: 'application',
          fields: [
            { id: 'role', label: 'What are you applying for?', type: forms.FIELD_TYPES.SHORT, required: true, maxLength: 100 },
            { id: 'about', label: 'Tell us about yourself', type: forms.FIELD_TYPES.PARAGRAPH, required: true, maxLength: 1000 },
          ],
        },
      ];

      for (const form of defaults) {
        forms.saveForm(interaction.guildId, {
          ...form,
          createdBy: interaction.user.id,
          updatedBy: interaction.user.id,
        }, interaction.guild);
      }

      await safeReply(interaction, {
        content: '✅ Starter forms created: Support, Appeal and Application.',
        embeds: [formsPanel.buildFormsOverviewEmbed(interaction.guildId)],
      });
      return;
    }

    await safeReply(interaction, {
      embeds: [formsPanel.buildFormsOverviewEmbed(interaction.guildId)],
    });
  },
};
