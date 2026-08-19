'use strict';

const { SlashCommandBuilder } = require('discord.js');

const translationStore = require('../../modules/utilityStudio/translation/translationStore');
const translation = require('../../modules/utilityStudio/translation/translation');
const { isModuleEnabled } = require('../../core/guild/guildManager');

async function reply(interaction, payload) {
  const data = { ...payload, flags: 64 };
  if (interaction.deferred || interaction.replied) return interaction.editReply(data);
  return interaction.reply(data);
}

module.exports = {
  category: 'Utility',

  help: {
    name: 'translate',
    description: '🌐 Translate text using the configured translation provider.',
    usage: '/translate text:<message> target:<language>',
  },

  data: new SlashCommandBuilder()
    .setName('translate')
    .setDescription('🌐 Translate text')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('Text to translate')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('target')
        .setDescription('Target language code, example: en, es, de, fr')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('source')
        .setDescription('Source language code, or auto')
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const config = translationStore.getTranslationSection(guildId);

    if (!isModuleEnabled(guildId, 'translation')) {
      await reply(interaction, {
        content: '⚠️ Translation is not enabled in this server yet. Ask an admin to run `/translation enable`.',
      });
      return;
    }

    const text = interaction.options.getString('text', true);
    const targetLanguage = translation.normalizeLanguage(
      interaction.options.getString('target') || config.settings?.defaultTargetLanguage || 'en'
    );
    const sourceLanguage = translation.normalizeLanguage(
      interaction.options.getString('source') || config.settings?.defaultSourceLanguage || 'auto'
    );

    const result = await translation.translateText({
      guildId,
      text,
      targetLanguage,
      sourceLanguage,
      mode: 'manual',
    });

    if (!result.ok) {
      await reply(interaction, {
        embeds: [translation.buildProviderNotConnectedEmbed({
          text,
          targetLanguage,
          sourceLanguage,
          result,
        })],
      });
      return;
    }

    await reply(interaction, {
      content: [
        `🌐 **${translation.languageLabel(result.sourceLanguage)} → ${translation.languageLabel(result.targetLanguage)}**`,
        '',
        result.translatedText,
      ].join('\n'),
    });
  },
};
