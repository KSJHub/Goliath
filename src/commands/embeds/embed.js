const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const { errorEmbed } = require('../../core/ui/embeds');
const { buildEmbedPanel } = require('../../modules/embed/embedPanel');
const { enforceCommandAccess } = require('../../core/ui/commandAccess');

module.exports = {
  category: 'Embeds',

  help: {
    name: 'embed',
    description: '🎨 Open embed studio and builder tools.',
    usage: '/embed',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription("🎨 Open Goliath's embed studio")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return await safeReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      const memberDisplayName =
        interaction.member?.displayName ||
        interaction.user?.displayName ||
        interaction.user?.username ||
        'Unknown User';

      return await safeReply(interaction, {
        ...buildEmbedPanel(interaction, memberDisplayName),
      });
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;

      console.error('❌ Embed command failed:', error);

      return await safeReply(interaction, {
        embeds: [errorEmbed('Failed to open the embed panel. Please try again.')],
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
