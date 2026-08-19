const {
  SlashCommandBuilder,
  ChannelType,
} = require('discord.js');

const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const { baseEmbed } = require('../../core/ui/embeds');

module.exports = {
  category: 'Utility',

  help: {
    name: 'serverinfo',
    description: '🏰 View server stats, members, roles, channels and guild details.',
    usage: '/serverinfo',
  },

  access: {
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('🏰 View server stats, members, roles, channels and guild details'),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    try {
      if (!interaction.guild) {
        return await safeReply(interaction, {
          content: '❌ This command can only be used inside a server.',
        });
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
      }

      const guild = interaction.guild;

      await guild.members.fetch().catch(() => null);

      const owner = await guild.fetchOwner().catch(() => null);

      const textChannels = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildText
      ).size;

      const voiceChannels = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildVoice
      ).size;

      const categories = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildCategory
      ).size;

      const totalMembers = guild.memberCount;
      const humans = guild.members.cache.filter((member) => !member.user.bot).size;
      const bots = guild.members.cache.filter((member) => member.user.bot).size;
      const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

      const embed = baseEmbed(interaction.client)
        .setTitle('`🏰` Server Overview')
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .setDescription([
          `\`💎\` **${guild.name}**`,
          '',
          `\`👑\` **Owner:** ${owner ? `<@${owner.id}>` : '`Unknown`'}`,
          `\`🆔\` **Server ID:** \`${guild.id}\``,
          `\`📅\` **Created:** <t:${createdTimestamp}:F>`,
          '',
          `\`👥\` **Members**`,
          `Total: \`${totalMembers}\`  •  Humans: \`${humans}\`  •  Bots: \`${bots}\``,
          '',
          `\`💬\` **Channels**`,
          `Text: \`${textChannels}\`  •  Voice: \`${voiceChannels}\`  •  Categories: \`${categories}\``,
          '',
          `\`🎭\` **Roles**`,
          `\`${guild.roles.cache.size}\` roles`,
        ].join('\n'));

      return await interaction.editReply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('❌ Serverinfo command failed:', error);

      return await safeReply(interaction, {
        content: '❌ Failed to load server information.',
        embeds: [],
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
