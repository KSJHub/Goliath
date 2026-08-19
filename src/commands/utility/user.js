const { SlashCommandBuilder } = require('discord.js');

const { errorEmbed } = require('../../core/ui/embeds');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const { buildUserHomePanel } = require('../../core/panels/user/userInteractions');

module.exports = {
  category: 'Utility',

  help: {
    name: 'user',
    description: 'Open your Goliath user panel.',
    usage: '/user',
  },

  access: {
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Open your Goliath user panel')
    .setDMPermission(false),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return await safeReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      return await safeReply(interaction, buildUserHomePanel(interaction));
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;

      console.error('User command failed:', error);

      return await safeReply(interaction, {
        embeds: [errorEmbed('Failed to open the user panel. Please try again.')],
        components: [],
      });
    }
  },
};

async function safeReply(interaction, payload) {
  const safePayload = {
    ...payload,
    flags: 64,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(safePayload);
  }

  return interaction.reply(safePayload);
}
