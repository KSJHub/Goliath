const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const { errorEmbed } = require('../../core/ui/embeds');
const { buildEmbedPanel } = require('../../modules/embed/embedPanel');
const { enforceCommandAccess } = require('../../core/ui/commandAccess');

const activeEmbedPanels = new Map();
const PANEL_SESSION_TTL_MS = 14 * 60 * 1000;

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

      const panelKey = `${interaction.guildId}:${interaction.user.id}`;
      await removePreviousPanel(panelKey, interaction);

      const memberDisplayName =
        interaction.member?.displayName ||
        interaction.user?.displayName ||
        interaction.user?.username ||
        'Unknown User';

      const reply = await safeReply(interaction, {
        ...buildEmbedPanel(interaction, memberDisplayName),
      });

      rememberPanel(panelKey, interaction);
      return reply;
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

async function removePreviousPanel(panelKey, currentInteraction) {
  const previous = activeEmbedPanels.get(panelKey);
  if (!previous || previous.interaction === currentInteraction) return;

  activeEmbedPanels.delete(panelKey);
  if (previous.timeout) clearTimeout(previous.timeout);

  try {
    await previous.interaction.deleteReply();
  } catch (error) {
    if (![10008, 10015, 10062].includes(error?.code)) {
      console.warn('[Embed] Could not remove the previous ephemeral panel:', error?.message || error);
    }
  }
}

function rememberPanel(panelKey, interaction) {
  const timeout = setTimeout(() => {
    const current = activeEmbedPanels.get(panelKey);
    if (current?.interaction === interaction) activeEmbedPanels.delete(panelKey);
  }, PANEL_SESSION_TTL_MS);
  timeout.unref?.();

  activeEmbedPanels.set(panelKey, { interaction, timeout });
}

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
