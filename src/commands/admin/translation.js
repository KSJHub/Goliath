'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const translationStore = require('../../modules/utilityStudio/translation/translationStore');
const translation = require('../../modules/utilityStudio/translation/translation');
const translationThreadManager = require('../../modules/utilityStudio/translation/translationThreadManager');
const { setModuleEnabled } = require('../../core/guild/guildManager');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');

async function reply(interaction, payload) {
  const data = { ...payload, flags: 64 };
  if (interaction.deferred || interaction.replied) return interaction.editReply(data);
  return interaction.reply(data);
}

module.exports = {
  category: 'Admin',

  help: {
    name: 'translation',
    description: '🌐 Manage Goliath translation settings.',
    usage: '/translation overview | enable | disable | channel-set | channel-disable | user-language',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('translation')
    .setDescription('🌐 Manage Goliath translation settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('overview')
        .setDescription('Show translation module overview')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enable')
        .setDescription('Enable translation module')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setDescription('Disable translation module')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel-set')
        .setDescription('Configure translation for a channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to configure')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('mode')
            .setDescription('Translation mode')
            .addChoices(
              { name: 'Manual only', value: 'manual' },
              { name: 'Automatic', value: 'auto' },
              { name: 'Disabled', value: 'disabled' },
            )
        )
        .addStringOption((option) =>
          option
            .setName('targets')
            .setDescription('Comma-separated target languages, example: en,es,de')
        )
        .addBooleanOption((option) =>
          option
            .setName('thread_mode')
            .setDescription('Create/use translation threads')
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channel-disable')
        .setDescription('Disable translation in a channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to disable')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('user-language')
        .setDescription('Set a user translation language preference')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to update')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('language')
            .setDescription('Language code, example: en, es, de, fr')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    const action = interaction.options.getSubcommand(false) || 'overview';
    const guildId = interaction.guildId;

    if (action === 'overview') {
      await reply(interaction, {
        embeds: [translation.buildOverviewEmbed(guildId)],
      });
      return;
    }

    if (action === 'enable') {
      setModuleEnabled(guildId, 'translation', true, interaction.guild);
      await reply(interaction, {
        content: '✅ Translation module enabled.',
        embeds: [translation.buildOverviewEmbed(guildId)],
      });
      return;
    }

    if (action === 'disable') {
      setModuleEnabled(guildId, 'translation', false, interaction.guild);
      await reply(interaction, {
        content: '✅ Translation module disabled.',
        embeds: [translation.buildOverviewEmbed(guildId)],
      });
      return;
    }

    if (action === 'channel-set') {
      const channel = interaction.options.getChannel('channel', true);
      const mode = interaction.options.getString('mode') || 'manual';
      const targetsRaw = interaction.options.getString('targets') || 'en';
      const threadMode = interaction.options.getBoolean('thread_mode');
      const targetLanguages = targetsRaw
        .split(',')
        .map((code) => translation.normalizeLanguage(code))
        .filter(Boolean)
        .slice(0, 10);

      translationStore.saveChannelConfig(guildId, channel.id, {
        enabled: mode !== 'disabled',
        mode,
        targetLanguages: targetLanguages.length ? targetLanguages : ['en'],
        languages: targetLanguages.length ? targetLanguages : ['en'],
        threadMode: threadMode !== false,
        autoCreateThreads: true,
      }, interaction.guild);

      let threadSummary = null;

      if (mode !== 'disabled' && threadMode !== false) {
        threadSummary = await translationThreadManager.ensureThreadsForChannel(interaction.guild, channel.id);
      }

      await reply(interaction, {
        content: [
          `✅ Translation configured for ${channel}.`,
          threadSummary?.created?.length ? `🧵 Created ${threadSummary.created.length} translation thread(s).` : null,
        ].filter(Boolean).join('\n'),
        embeds: [translation.buildChannelEmbed(guildId, channel.id)],
      });
      return;
    }

    if (action === 'channel-disable') {
      const channel = interaction.options.getChannel('channel', true);

      translationStore.saveChannelConfig(guildId, channel.id, {
        enabled: false,
        mode: 'disabled',
      }, interaction.guild);

      await reply(interaction, {
        content: `✅ Translation disabled for ${channel}. Existing threads were kept for audit/recovery.`,
        embeds: [translation.buildChannelEmbed(guildId, channel.id)],
      });
      return;
    }

    if (action === 'user-language') {
      const user = interaction.options.getUser('user', true);
      const language = translation.normalizeLanguage(interaction.options.getString('language', true));

      translationStore.saveUserPreference(guildId, user.id, {
        enabled: true,
        preferredLanguage: language,
      }, interaction.guild);

      await reply(interaction, {
        content: `✅ ${user}'s preferred translation language is now **${translation.languageLabel(language)}**.`,
      });
      return;
    }

    await reply(interaction, { content: '⚠️ Unknown translation action.' });
  },
};