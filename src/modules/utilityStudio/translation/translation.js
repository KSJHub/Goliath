'use strict';

const { EmbedBuilder } = require('discord.js');
const translationStore = require('./translationStore');
const translationProviderManager = require('./translationProviderManager');
const guildManager = require('../../../core/guild/guildManager');
const { isModuleEnabled } = guildManager;

const LANGUAGE_LABELS = Object.freeze({
  auto: 'Auto Detect',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  ar: 'Arabic',
  hi: 'Hindi',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
});

function languageLabel(code = 'en') {
  const safeCode = String(code || 'en').toLowerCase();
  return LANGUAGE_LABELS[safeCode] || safeCode.toUpperCase();
}

function normalizeLanguage(code = 'en') {
  const clean = String(code || 'en')
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, '')
    .slice(0, 12);

  return clean || 'en';
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanLanguageList(value, fallback = ['en']) {
  const list = Array.isArray(value) ? value : fallback;
  return [...new Set(list.map((code) => normalizeLanguage(code)).filter(Boolean))].slice(0, 10);
}

function providerLabel(provider = 'manual') {
  const clean = String(provider || 'manual').toLowerCase();
  if (clean === 'openai') return 'OpenAI';
  if (clean === 'deepl') return 'DeepL';
  if (clean === 'google') return 'Google Translate';
  return 'Manual / Not Connected';
}

function getAdminTranslationConfig(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const config = modules?.translation;
  return config && typeof config === 'object' ? config : {};
}

function mergeAdminTranslationConfig(guildId, section) {
  const adminConfig = getAdminTranslationConfig(guildId);
  const defaultChannelId = cleanDiscordId(adminConfig.defaultChannelId || adminConfig.channelId || adminConfig.logChannelId);
  const logChannelId = cleanDiscordId(adminConfig.logChannelId || section.settings?.logChannelId);
  const targetLanguages = cleanLanguageList(adminConfig.targetLanguages || section.settings?.targetLanguages || section.languages || ['en']);
  const autoDetect = typeof adminConfig.autoDetect === 'boolean'
    ? adminConfig.autoDetect
    : section.settings?.autoDetect !== false;
  const allowUserPreferences = typeof adminConfig.allowUserPreferences === 'boolean'
    ? adminConfig.allowUserPreferences
    : section.settings?.allowUserPreferences !== false;
  const ephemeralReplies = typeof adminConfig.ephemeralReplies === 'boolean'
    ? adminConfig.ephemeralReplies
    : section.settings?.ephemeralReplies !== false;

  const channels = { ...(section.channels || {}) };
  const threadChannels = { ...(section.threadChannels || {}) };

  if (defaultChannelId && !channels[defaultChannelId]) {
    const channelConfig = translationStore.normalizeChannelConfig({
      enabled: true,
      mode: autoDetect ? 'auto' : 'manual',
      threadMode: section.settings?.threadMode !== false,
      autoDetect,
      sourceLanguage: 'auto',
      targetLanguages,
      languages: targetLanguages,
    });
    channels[defaultChannelId] = channelConfig;
    threadChannels[defaultChannelId] = channelConfig;
  }

  return translationStore.normalizeTranslationSection({
    ...section,
    settings: {
      ...(section.settings || {}),
      autoDetect,
      allowUserPreferences,
      ephemeralReplies,
      logChannelId,
      targetLanguages,
      defaultTargetLanguage: targetLanguages[0] || section.settings?.defaultTargetLanguage || 'en',
    },
    languages: targetLanguages,
    channels,
    threadChannels,
  });
}

function getEffectiveTranslationSection(guildId) {
  return mergeAdminTranslationConfig(guildId, translationStore.getTranslationSection(guildId));
}

function isTranslationModuleEnabled(guildId) {
  return isModuleEnabled(guildId, 'translation');
}

function buildOverviewEmbed(guildId) {
  const section = getEffectiveTranslationSection(guildId);
  const moduleEnabled = isTranslationModuleEnabled(guildId);
  const providerStatus = translationProviderManager.getProviderStatus(section);
  const channelCount = Object.keys(section.channels || {}).length;
  const userCount = Object.keys(section.userPreferences || {}).length;
  const targetLanguages = section.settings?.targetLanguages || ['en'];

  return new EmbedBuilder()
    .setColor(moduleEnabled ? 0x57f287 : 0xed4245)
    .setTitle('Goliath Translation')
    .setDescription([
      `**Module:** ${moduleEnabled ? 'Enabled' : 'Disabled'}`,
      `**Provider:** \`${providerLabel(providerStatus.selectedProvider)}\``,
      `**Provider Health:** ${providerStatus.providers?.[providerStatus.selectedProvider]?.healthy ? 'Healthy' : 'Needs Attention'}`,
      `**Default Target:** ${languageLabel(section.settings?.defaultTargetLanguage || 'en')}`,
      `**Targets:** ${targetLanguages.map(languageLabel).join(', ')}`,
      `**Thread Mode:** ${section.settings?.threadMode !== false ? 'Enabled' : 'Disabled'}`,
      `**Auto Detect:** ${section.settings?.autoDetect !== false ? 'Enabled' : 'Disabled'}`,
      `**User Preferences:** ${section.settings?.allowUserPreferences !== false ? 'Enabled' : 'Disabled'}`,
      `**Ephemeral Replies:** ${section.settings?.ephemeralReplies !== false ? 'Enabled' : 'Disabled'}`,
      '',
      `**Configured Channels:** ${channelCount}`,
      `**User Preferences Stored:** ${userCount}`,
      '',
      '**Analytics**',
      `Manual: ${section.analytics?.manualTranslations || 0}`,
      `Auto: ${section.analytics?.autoTranslations || 0}`,
      `Threads: ${section.analytics?.threadsCreated || 0}`,
      `Failed: ${section.analytics?.failedTranslations || 0}`,
    ].join('\n'))
    .setFooter({ text: 'Goliath Translation - Config stored in modules.translation' })
    .setTimestamp(new Date());
}

function buildChannelEmbed(guildId, channelId) {
  const section = getEffectiveTranslationSection(guildId);
  const moduleEnabled = isTranslationModuleEnabled(guildId);
  const config = section.channels?.[channelId];

  if (!config) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Translation Channel')
      .setDescription(`No translation config found for <#${channelId}>.`)
      .setTimestamp(new Date());
  }

  return new EmbedBuilder()
    .setColor(moduleEnabled && config.enabled !== false ? 0x57f287 : 0xed4245)
    .setTitle('Translation Channel')
    .setDescription([
      `**Channel:** <#${channelId}>`,
      `**Module:** ${moduleEnabled ? 'Enabled' : 'Disabled'}`,
      `**Status:** ${config.enabled !== false ? 'Enabled' : 'Disabled'}`,
      `**Mode:** \`${config.mode}\``,
      `**Thread Mode:** ${config.threadMode !== false ? 'Enabled' : 'Disabled'}`,
      `**Source:** ${languageLabel(config.sourceLanguage || 'auto')}`,
      `**Targets:** ${(config.targetLanguages || ['en']).map(languageLabel).join(', ')}`,
    ].join('\n'))
    .setTimestamp(new Date());
}

function buildProviderNotConnectedEmbed({ text, targetLanguage, sourceLanguage = 'auto', result = null } = {}) {
  const errorMessage = result?.errorMessage || result?.error || 'The translation provider is not connected yet.';
  const errorCode = result?.errorCode ? `\n**Error Code:** \`${result.errorCode}\`` : '';

  return new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle('Translation Provider Issue')
    .setDescription([
      errorMessage,
      errorCode,
      '',
      `**Source:** ${languageLabel(sourceLanguage)}`,
      `**Target:** ${languageLabel(targetLanguage || 'en')}`,
      '',
      '**Text queued for translation:**',
      `>>> ${String(text || '').slice(0, 1500) || '_No text provided._'}`,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Configure OpenAI, DeepL, or Google Translate provider settings' })
    .setTimestamp(new Date());
}

async function translateText({ guildId, text, targetLanguage = 'en', sourceLanguage = 'auto', mode = 'manual', options = {} } = {}) {
  const section = getEffectiveTranslationSection(guildId);
  const provider = translationProviderManager.getConfiguredProvider(section);
  const maxCharacters = section.settings?.maxCharacters || 1500;
  const safeText = String(text || '').trim().slice(0, maxCharacters);
  const safeTarget = normalizeLanguage(targetLanguage || section.settings?.defaultTargetLanguage || 'en');
  const safeSource = normalizeLanguage(sourceLanguage || section.settings?.defaultSourceLanguage || 'auto');

  if (!isTranslationModuleEnabled(guildId)) {
    return translationProviderManager.createFailure(provider, 'MODULE_DISABLED', 'Translation module is disabled for this server.', {
      originalText: safeText,
      sourceLanguage: safeSource,
      targetLanguage: safeTarget,
    });
  }

  if (!safeText) {
    return translationProviderManager.createFailure(provider, 'EMPTY_TEXT', 'No text provided.', {
      originalText: '',
      sourceLanguage: safeSource,
      targetLanguage: safeTarget,
    });
  }

  const result = await translationProviderManager.translateText({
    section,
    guildId,
    text: safeText,
    sourceLanguage: safeSource,
    targetLanguage: safeTarget,
    options,
  });

  translationStore.incrementAnalytics(guildId, {
    [result.success ? (mode === 'auto' ? 'autoTranslations' : 'manualTranslations') : 'failedTranslations']: 1,
  });

  return {
    ...result,
    provider: result.provider || provider,
    originalText: result.originalText || safeText,
    translatedText: result.translatedText || '',
    sourceLanguage: result.sourceLanguage || safeSource,
    targetLanguage: result.targetLanguage || safeTarget,
  };
}

function getProviderStatus(guildId) {
  const section = getEffectiveTranslationSection(guildId);
  return translationProviderManager.getProviderStatus(section);
}

function listProviders() {
  return translationProviderManager.listProviders();
}

module.exports = {
  LANGUAGE_LABELS,
  languageLabel,
  normalizeLanguage,
  providerLabel,
  getEffectiveTranslationSection,
  buildOverviewEmbed,
  buildChannelEmbed,
  buildProviderNotConnectedEmbed,
  translateText,
  getProviderStatus,
  listProviders,
};