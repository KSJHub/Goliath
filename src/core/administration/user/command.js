const { SlashCommandBuilder } = require('discord.js');

const { errorEmbed } = require('../../ui/embeds');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const { buildUserHomePanel } = require('./interactions');
const emojisUserPanel = require('../../../modules/utilityStudio/emojis/emojisUserPanel');

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
    .addStringOption((option) => option
      .setName('emoji')
      .setDescription('Quickly find an emoji from Goliath Core or this server')
      .setAutocomplete(true)
      .setRequired(false))
    .addBooleanOption((option) => option
      .setName('emoji_browser')
      .setDescription('Open your searchable Emoji Studio browser')
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
        return await safeReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      if (interaction.options.getBoolean('emoji_browser') === true) {
        return await safeReply(interaction, await emojisUserPanel.buildPanel(interaction));
      }

      const emojiId = interaction.options.getString('emoji');
      if (emojiId) {
        const selection = await emojisUserPanel.commandSelection(interaction, emojiId);
        if (!selection) {
          return await safeReply(interaction, {
            embeds: [errorEmbed('That emoji is no longer available in this server.')],
            components: [],
          });
        }
        return await safeReply(interaction, selection);
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
