const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const { errorEmbed } = require('../../core/ui/embeds');
const { safeEditReply } = require('../../core/ui/interactionResponse');
const modPanel = require('../../core/panels/mod/modPanel');

const MOD_COMMAND_PERMISSIONS =
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers;

module.exports = {
  category: 'Moderation',

  help: {
    name: 'mod',
    description: '🔐 Open moderation hub and staff tools.',
    usage: '/mod',
  },

  access: {
    level: 'mod',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('🔐 Open Goliath’s moderation hub and staff tools')
    .setDefaultMemberPermissions(MOD_COMMAND_PERMISSIONS),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return await safeEditReply(interaction, {
          embeds: [
            errorEmbed('This command can only be used inside a server.'),
          ],
        });
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
      }

      if (typeof modPanel.openModPanel !== 'function') {
        throw new Error('Moderation panel opener was not found.');
      }

      return await modPanel.openModPanel(interaction);
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;

      console.error('❌ Mod command failed:', error);

      return await safeEditReply(interaction, {
        embeds: [
          errorEmbed('Failed to open the moderation hub. Please try again.'),
        ],
        components: [],
      });
    }
  },
};
