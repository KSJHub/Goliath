'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

const {
  getPrefixInfo,
  setGuildPrefix,
  resetGuildPrefix,
  normalizePrefix,
} = require('../../core/commands/prefixStore');

const { enforceCommandAccess } = require('../../core/commands/commandAccess');

function buildPrefixEmbed(interaction) {
  const info = getPrefixInfo(interaction.guild.id);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Goliath Prefix Settings')
    .setDescription([
      `Current prefix: \`${info.prefix}\``,
      `Default prefix: \`${info.defaultPrefix}\``,
      '',
      '**Prefix examples**',
      `\`${info.prefix}help\``,
      `\`${info.prefix}ping\``,
      `\`${info.prefix}prefix set ?\``,
      '',
      '**Slash commands still work normally.**',
    ].join('\n'))
    .setFooter({ text: `Requested by ${interaction.member?.displayName || interaction.user.username}` })
    .setTimestamp(new Date());
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

module.exports = {
  category: 'Admin',

  help: {
    name: 'prefix',
    description: '⚙️ View, set, or reset this server’s Goliath prefix.',
    usage: '/prefix view | /prefix set <prefix> | /prefix reset',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('prefix')
    .setDescription('⚙️ View, set, or reset this server’s Goliath prefix')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View the current server prefix')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Set a new server prefix')
        .addStringOption((option) =>
          option
            .setName('prefix')
            .setDescription('New prefix, 1-5 characters, no spaces')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(5)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Reset the server prefix back to the default')
    ),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    const action = interaction.options.getSubcommand(false) || 'view';

    if (action === 'view') {
      return safeReply(interaction, {
        embeds: [buildPrefixEmbed(interaction)],
      });
    }

    if (action === 'set') {
      const requestedPrefix = interaction.options.getString('prefix', true);

      try {
        const safePrefix = normalizePrefix(requestedPrefix);
        const savedPrefix = setGuildPrefix(interaction.guild.id, safePrefix, interaction.guild);

        return safeReply(interaction, {
          content: `✅ Prefix updated to \`${savedPrefix}\`. Try \`${savedPrefix}help\` or \`${savedPrefix}ping\`.`,
        });
      } catch (error) {
        return safeReply(interaction, {
          content: `❌ ${error.message}`,
        });
      }
    }

    if (action === 'reset') {
      const savedPrefix = resetGuildPrefix(interaction.guild.id, interaction.guild);

      return safeReply(interaction, {
        content: `✅ Prefix reset to \`${savedPrefix}\`.`,
      });
    }

    return safeReply(interaction, {
      embeds: [buildPrefixEmbed(interaction)],
    });
  },
};
