'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const translationStore = require('./translationStore');
const translationProviderManager = require('./translationProviderManager');
const translation = require('./translation');
const guildManager = require('../../../core/guild/guildManager');
const {
  DEFAULT_BOT_CHANNEL_PERMISSIONS,
  guardChannelAccess,
} = require('../../../core/security/goliathPermissionGuard');

const TRANSLATION_SOURCE_PERMISSIONS = [
  ...DEFAULT_BOT_CHANNEL_PERMISSIONS,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];

const TRANSLATION_THREAD_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
];

function now() {
  return new Date().toISOString();
}

function isTextSourceChannel(channel) {
  return Boolean(channel) && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
}

function isThreadChannel(channel) {
  return Boolean(channel?.isThread?.());
}

function buildThreadName(languageCode) {
  return `🌐 ${translation.languageLabel(languageCode)}`.slice(0, 100);
}

function formatThreadMessage({ message, result, targetLanguage }) {
  const authorLabel = message.member?.displayName || message.author?.username || 'Unknown User';
  const sourceUrl = message.url ? `\n[Jump to original](${message.url})` : '';

  return [
    `🌐 **${translation.languageLabel(result.sourceLanguage || 'auto')} → ${translation.languageLabel(targetLanguage)}**`,
    `👤 **Original Author:** ${authorLabel}`,
    sourceUrl,
    '',
    result.translatedText || result.originalText || '_No translated text returned._',
  ].filter(Boolean).join('\n');
}

async function fetchChannel(clientOrGuild, channelId) {
  if (!clientOrGuild || !channelId) return null;

  const client = clientOrGuild.client || clientOrGuild;
  const cached = client.channels?.cache?.get?.(channelId);
  if (cached) return cached;

  try {
    return await client.channels?.fetch?.(channelId);
  } catch {
    return null;
  }
}

async function fetchThread(clientOrGuild, threadId) {
  if (!threadId) return null;
  return fetchChannel(clientOrGuild, threadId);
}

async function guardTranslationSourceChannel(sourceChannel, scope = 'translation.source_channel') {
  if (!sourceChannel?.guild?.id) return null;

  return guardChannelAccess(sourceChannel.guild, sourceChannel.id, TRANSLATION_SOURCE_PERMISSIONS, {
    scope,
    autoFix: true,
    throwOnFail: true,
    reason: 'Goliath translation source channel validation',
  });
}

async function guardTranslationThread(thread, scope = 'translation.thread') {
  if (!thread?.guild?.id) return null;

  return guardChannelAccess(thread.guild, thread.id, TRANSLATION_THREAD_PERMISSIONS, {
    scope,
    autoFix: true,
    throwOnFail: true,
    reason: 'Goliath translation thread validation',
  });
}

async function createLanguageThread(sourceChannel, languageCode) {
  if (!isTextSourceChannel(sourceChannel)) {
    throw new Error('Translation source channel must be a text or announcement channel.');
  }

  await guardTranslationSourceChannel(sourceChannel, 'translation.thread_create');

  const thread = await sourceChannel.threads.create({
    name: buildThreadName(languageCode),
    autoArchiveDuration: 10080,
    reason: `Goliath translation thread: ${languageCode}`,
  });

  await guardTranslationThread(thread, 'translation.created_thread');
  return thread;
}

function getChannelConfig(section, channelId) {
  return section.threadChannels?.[channelId] || section.channels?.[channelId] || null;
}

function getTargetLanguages(section, config) {
  const languages = config?.languages || config?.targetLanguages || section.languages || section.settings?.targetLanguages || ['en'];

  return [...new Set(
    (Array.isArray(languages) ? languages : ['en'])
      .map((code) => translation.normalizeLanguage(code))
      .filter(Boolean)
  )].slice(0, 10);
}

function threadNeedsReplacement(thread) {
  return !thread || thread.archived === true || thread.locked === true;
}

function threadState(thread) {
  if (!thread) return 'missing';
  if (thread.locked === true) return 'locked';
  if (thread.archived === true) return 'archived';
  return 'active';
}

function markThreadMapping(guildId, channelId, languageCode, mapping, patch = {}, guildOrMeta = {}) {
  return translationStore.saveThreadMapping(guildId, channelId, languageCode, {
    ...(mapping || {}),
    ...patch,
    languageCode,
  }, guildOrMeta);
}

async function ensureThreadsForChannel(guild, channelId, options = {}) {
  const section = translationStore.getTranslationSection(guild.id);
  const config = getChannelConfig(section, channelId);

  if (!config || config.enabled === false || config.threadMode === false) {
    return { ok: false, reason: 'Translation threads are not enabled for this channel.', created: [], recovered: [], replaced: [], missing: [] };
  }

  const sourceChannel = await fetchChannel(guild, channelId);
  if (!isTextSourceChannel(sourceChannel)) {
    return { ok: false, reason: 'Source channel is missing or is not a supported text channel.', created: [], recovered: [], replaced: [], missing: [] };
  }

  await guardTranslationSourceChannel(sourceChannel, 'translation.thread_setup');

  const targetLanguages = getTargetLanguages(section, config);
  const created = [];
  const recovered = [];
  const replaced = [];
  const missing = [];
  const failures = [];

  for (const languageCode of targetLanguages) {
    const currentMapping = section.threadMappings?.[channelId]?.[languageCode] || null;
    let thread = currentMapping?.threadId ? await fetchThread(guild, currentMapping.threadId) : null;
    const previousState = threadState(thread);

    try {
      if (threadNeedsReplacement(thread)) {
        if (config.autoCreateThreads === false) {
          missing.push({ languageCode, threadId: currentMapping?.threadId || null, reason: previousState });
          markThreadMapping(guild.id, channelId, languageCode, currentMapping, {
            active: false,
            archived: previousState === 'archived',
            locked: previousState === 'locked',
            recoveredAt: options.recovery ? now() : currentMapping?.recoveredAt || null,
          }, guild);
          continue;
        }

        thread = await createLanguageThread(sourceChannel, languageCode);

        if (currentMapping?.threadId) {
          replaced.push({
            languageCode,
            oldThreadId: currentMapping.threadId,
            oldState: previousState,
            threadId: thread.id,
          });
        } else {
          created.push({ languageCode, threadId: thread.id });
        }

        translationStore.incrementAnalytics(guild.id, { threadsCreated: 1, threadChannelsCreated: 1 }, guild);
      } else {
        await guardTranslationThread(thread, 'translation.thread_recovery');
        recovered.push({ languageCode, threadId: thread.id });
      }

      markThreadMapping(guild.id, channelId, languageCode, currentMapping, {
        threadId: thread.id,
        threadName: thread.name,
        active: true,
        archived: thread.archived === true,
        locked: thread.locked === true,
        recoveredAt: options.recovery ? now() : currentMapping?.recoveredAt || null,
      }, guild);
    } catch (error) {
      failures.push({ languageCode, error: error.message, guard: error.details || null });
      translationStore.incrementAnalytics(guild.id, { failedTranslations: 1, threadFailures: 1 }, guild);
    }
  }

  return {
    ok: failures.length === 0,
    sourceChannelId: channelId,
    created,
    recovered,
    replaced,
    missing,
    failures,
    languages: targetLanguages,
  };
}

async function recoverGuildThreads(guild) {
  const section = translationStore.getTranslationSection(guild.id);
  const channelIds = Object.keys(section.threadChannels || section.channels || {});
  const results = [];

  for (const channelId of channelIds) {
    const config = getChannelConfig(section, channelId);
    if (!config || config.enabled === false || config.threadMode === false) continue;

    try {
      const result = await ensureThreadsForChannel(guild, channelId, { recovery: true });
      results.push(result);
      translationStore.incrementAnalytics(guild.id, { threadRecoveries: 1 }, guild);
    } catch (error) {
      results.push({ ok: false, sourceChannelId: channelId, reason: error.message, guard: error.details || null });
      translationStore.incrementAnalytics(guild.id, { failedTranslations: 1, threadFailures: 1 }, guild);
    }
  }

  return results;
}

async function handleMessageCreate(message) {
  if (!message?.guild || !message?.channel || !message?.content) return null;
  if (message.author?.bot || message.webhookId) return null;
  if (isThreadChannel(message.channel)) return null;

  const guildId = message.guild.id;
  const section = translationStore.getTranslationSection(guildId);

  if (!guildManager.isModuleEnabled(guildId, 'translation')) return null;

  const config = getChannelConfig(section, message.channelId);
  if (!config || config.enabled === false || config.mode === 'disabled') return null;
  if (config.mode !== 'auto') return null;
  if (config.threadMode === false) return null;

  const recovery = await ensureThreadsForChannel(message.guild, message.channelId);

  const latestSection = translationStore.getTranslationSection(guildId);
  const latestConfig = getChannelConfig(latestSection, message.channelId) || config;
  const mappings = latestSection.threadMappings?.[message.channelId] || {};
  const targetLanguages = getTargetLanguages(latestSection, latestConfig);
  const sent = [];
  const failed = [...(recovery.failures || [])];

  for (const targetLanguage of targetLanguages) {
    const mapping = mappings[targetLanguage];
    if (!mapping?.threadId || mapping.active === false) continue;

    try {
      const thread = await fetchThread(message.guild, mapping.threadId);
      if (threadNeedsReplacement(thread)) {
        throw new Error(`Translation thread for ${targetLanguage} is ${threadState(thread)}. Run thread recovery.`);
      }

      await guardTranslationThread(thread, 'translation.thread_send');

      const result = await translationProviderManager.translateText({
        section: latestSection,
        guildId,
        text: message.content,
        sourceLanguage: latestConfig.sourceLanguage || latestSection.settings?.defaultSourceLanguage || 'auto',
        targetLanguage,
      });

      if (!result.ok) throw new Error(result.error || 'Translation failed.');

      const translatedMessage = await thread.send({
        content: formatThreadMessage({ message, result, targetLanguage }).slice(0, 2000),
        allowedMentions: { parse: [] },
      });

      translationStore.saveThreadMapping(guildId, message.channelId, targetLanguage, {
        ...mapping,
        lastMessageId: message.id,
        lastTranslatedMessageId: translatedMessage.id,
        lastTranslatedAt: now(),
        active: true,
        archived: false,
        locked: false,
      }, message.guild);

      translationStore.incrementAnalytics(guildId, { autoTranslations: 1, threadTranslations: 1 }, message.guild);
      sent.push({ targetLanguage, threadId: thread.id, messageId: translatedMessage.id });
    } catch (error) {
      failed.push({ targetLanguage, error: error.message, guard: error.details || null });
      translationStore.incrementAnalytics(guildId, { failedTranslations: 1, threadFailures: 1 }, message.guild);
    }
  }

  translationStore.addTranslationLog(guildId, {
    type: 'thread_message',
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
    authorId: message.author?.id || null,
    sent,
    failed,
  }, message.guild);

  return { ok: failed.length === 0, recovery, sent, failed };
}

module.exports = {
  ensureThreadsForChannel,
  recoverGuildThreads,
  handleMessageCreate,
};