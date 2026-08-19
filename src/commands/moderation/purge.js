const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const {
  baseEmbed,
  errorEmbed,
  warningEmbed,
} = require('../../core/ui/embeds');

module.exports = {
  category: 'Moderation',

  help: {
    name: 'purge',
    description: '🧹 Clean messages quickly with moderation controls.',
    usage: '/purge',
  },

  access: {
    level: 'mod',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('🧹 Clean messages quickly with moderation controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('🧹 Number of messages to delete, from 1 to 100')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return await safeReply(interaction, {
          embeds: [errorEmbed('This command can only be used inside a server.')],
        });
      }

      const channel = interaction.channel;

      if (!channel) {
        return await safeReply(interaction, {
          embeds: [errorEmbed('I could not find this channel.')],
        });
      }

      const allowedChannelTypes = [
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ];

      if (!allowedChannelTypes.includes(channel.type)) {
        return await safeReply(interaction, {
          embeds: [
            errorEmbed('This command can only be used in text channels or threads.'),
          ],
        });
      }

      const amount = interaction.options.getInteger('amount');

      const botMember =
        interaction.guild.members.me ||
        (await interaction.guild.members.fetchMe().catch(() => null));

      if (!botMember) {
        return await safeReply(interaction, {
          embeds: [errorEmbed('I could not verify my permissions in this server.')],
        });
      }

      if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return await safeReply(interaction, {
          embeds: [
            errorEmbed('I do not have permission to manage messages in this server.'),
          ],
        });
      }

      if (
        typeof channel.permissionsFor === 'function' &&
        !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages)
      ) {
        return await safeReply(interaction, {
          embeds: [
            errorEmbed('I do not have permission to manage messages in this channel.'),
          ],
        });
      }

      const deleted = await channel.bulkDelete(amount, true);

      if (!deleted.size) {
        return await safeReply(interaction, {
          embeds: [
            warningEmbed('No messages were deleted. They may all be older than 14 days.'),
          ],
        });
      }

      const embed = baseEmbed(interaction.client)
        .setTitle('`🧹` Messages Purged')
        .setDescription([
          `\`✅\` Successfully deleted \`${deleted.size}\` message${
            deleted.size === 1 ? '' : 's'
          }.`,
          '',
          `\`📍\` **Channel:** ${channel}`,
          `\`🗝️\` **Moderator:** ${interaction.user}`,
        ].join('\n'))
        .setFooter({
          text: `Requested by ${interaction.user.tag}`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
        });

      return await safeReply(interaction, {
        embeds: [embed],
      });
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) return;

      console.error('❌ Purge command failed:', error);

      return await safeReply(interaction, {
        embeds: [
          errorEmbed(
            'I could not delete those messages. Messages older than 14 days cannot be bulk deleted.'
          ),
        ],
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
