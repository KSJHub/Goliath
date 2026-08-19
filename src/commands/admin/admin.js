const { SlashCommandBuilder } = require('discord.js');

const { buildAdminPanel } = require('../../core/admin/functions/adminPanel');
const socialStudioPanel = require('../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { errorEmbed } = require('../../core/ui/embeds');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const security = require('../../core/security/securityCore');

module.exports = {
  category: 'Admin',

  help: {
    name: 'admin',
    description: 'Open admin controls and server tools.',
    usage: '/admin',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open Goliath admin controls and server tools')
    .setDMPermission(false),

  async execute(interaction) {
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

      const isFullAdmin = security.hasPermission(interaction, 'admin');
      const canManageSocial = typeof socialStudioPanel.canManageSocialStudio === 'function' && socialStudioPanel.canManageSocialStudio(interaction);
      if (!isFullAdmin && canManageSocial) {
        const payload = socialStudioPanel.buildSocialAdminPanel(interaction.guild, memberDisplayName);
        return await safeReply(interaction, payload);
      }

      const denied = await enforceCommandAccess(interaction, module.exports);
      if (denied) return;

      const payload = buildAdminPanel(interaction.guild, memberDisplayName);

      return await safeReply(interaction, payload);
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;

      console.error('❌ Admin command failed:', error);

      return await safeReply(interaction, {
        embeds: [errorEmbed('Failed to open the admin panel. Please try again.')],
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
