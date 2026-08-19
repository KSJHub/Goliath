const { SlashCommandBuilder } = require('discord.js');

const { enforceCommandAccess } = require('../../core/commands/commandAccess');
const {
  baseEmbed,
  statusText,
  formatUptime,
} = require('../../core/ui/embeds');

module.exports = {
  category: 'Utility',

  help: {
    name: 'ping',
    description: '💎 Check Goliath’s live status, heartbeat and latency.',
    usage: '/ping',
  },

  access: {
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('💎 Check Goliath’s heartbeat, latency and status'),

  async execute(interaction) {
    try {
      const denied = await enforceCommandAccess(interaction, module.exports);
      if (denied) return;

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
      }

      const clientLatency = Math.max(0, Date.now() - interaction.createdTimestamp);
      const apiLatency = Math.round(interaction.client.ws.ping);
      const uptime = formatUptime(process.uptime());

      const health =
        clientLatency < 100 && apiLatency < 100
          ? '🟢 Excellent'
          : clientLatency < 200 && apiLatency < 200
            ? '🟡 Stable'
            : clientLatency < 400 && apiLatency < 400
              ? '🟠 Slower than usual'
              : '🔴 Needs attention';

      const getBar = (ms) => {
        if (ms < 100) return '▰▰▰▰▰';
        if (ms < 200) return '▰▰▰▰▱';
        if (ms < 400) return '▰▰▰▱▱';
        return '▰▰▱▱▱';
      };

      const embed = baseEmbed(interaction.client)
        .setTitle('`🏓` Goliath Status')
        .setDescription([
          `\`●\` **Status:** ${health}`,
          '',
          `\`📡\` **Bot Latency**`,
          `\`${clientLatency}ms\` ${statusText(clientLatency)}`,
          getBar(clientLatency),
          '',
          `\`🌐\` **Discord API**`,
          `\`${apiLatency}ms\` ${statusText(apiLatency)}`,
          getBar(apiLatency),
          '',
          `\`⏱️\` **Uptime**`,
          `\`${uptime}\``,
        ].join('\n'));

      return await safeReply(interaction, {
        embeds: [embed],
      });
    } catch (error) {
      console.error('❌ Ping command failed:', error);

      return await safeReply(interaction, {
        content: '❌ Failed to check Goliath status.',
        embeds: [],
        components: [],
      });
    }
  },
};

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }

    return await interaction.reply({
      ...payload,
      flags: 64,
    });
  } catch (error) {
    console.error('❌ Failed to send ping response:', error);
    return null;
  }
}
