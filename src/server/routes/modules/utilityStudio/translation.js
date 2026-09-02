'use strict';

const express = require('express');

const translationStore = require('../../../../modules/utilityStudio/translation/translationStore');
const translationThreadManager = require('../../../../modules/utilityStudio/translation/translationThreadManager');
const providerManager = require('../../../../modules/utilityStudio/translation/translationProviderConfig');
const { isModuleEnabled, setModuleEnabled } = require('../../../../core/guild/guildManager');
const { requireEntitlement } = require('../../../middleware/requireEntitlement');
const {
  DEFAULT_BOT_CHANNEL_PERMISSIONS,
  guardChannelAccess,
  isGoliathPermissionError,
} = require('../../../../core/security/protection/permissions');

const router = express.Router();

function success(res, payload = {}) {
  return res.json({ success: true, ...payload });
}

function failure(res, error, status = 500) {
  console.error('[Translation API]', error);

  if (isGoliathPermissionError(error)) {
    const details = error.details || {};

    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      message: details.message || error.message,
      scope: details.scope || null,
      guildId: details.guildId || null,
      channelId: details.channelId || null,
      channelName: details.channelName || null,
      missingPermissions: details.missingPermissions || [],
      failures: details.failures || [],
      metadata: details.metadata || {},
      autoFixAvailable: Boolean(details.autoFixAvailable),
      confirmationRequired: Boolean(details.confirmationRequired),
    });
  }

  return res.status(status).json({
    success: false,
    error: error.message || 'Translation API request failed.',
  });
}

function getGuildId(req) {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  if (!guildId || guildId.length < 16) throw new Error('Invalid guild ID.');
  return guildId;
}

function cleanDiscordId(value, label = 'Discord ID') {
  const id = String(value || '').replace(/\D/g, '');
  if (!id || id.length < 15) throw new Error(`Invalid ${label}.`);
  return id;
}

function getDiscordClient(req) {
  return (
    req.client ||
    req.app?.get?.('goliath.client') ||
    req.app?.locals?.discordClient ||
    req.app?.locals?.client ||
    global.client ||
    global.discordClient ||
    null
  );
}

async function getGuild(req, guildId) {
  const client = getDiscordClient(req);
  const cachedGuild = client?.guilds?.cache?.get?.(guildId);
  if (cachedGuild) return cachedGuild;

  const fetchedGuild = typeof client?.guilds?.fetch === 'function'
    ? await client.guilds.fetch(guildId).catch(() => null)
    : null;

  if (!fetchedGuild) throw new Error('Guild is not available to the Discord client.');
  return fetchedGuild;
}

async function guardTranslationChannelConfig(guild, channelId) {
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased?.()) {
    throw new Error('Translation channel must be a valid text or announcement channel.');
  }

  await guardChannelAccess(
    guild,
    channel.id,
    DEFAULT_BOT_CHANNEL_PERMISSIONS,
    {
      scope: 'translation.channel_config',
      autoFix: true,
      throwOnFail: true,
      reason: 'Goliath translation channel configuration validation',
    }
  );

  return channel;
}

function publicTranslationConfig(guildId) {
  const section = translationStore.getTranslationSection(guildId);
  const providerStatus = providerManager.getProviderStatus(guildId);

  return {
    ...section,
    enabled: isModuleEnabled(guildId, 'translation'),
    providerStatus,
    providerSettings: providerStatus.supportedProviders,
    settings: {
      ...(section.settings || {}),
      providerStatus,
      providerSettings: providerStatus.supportedProviders,
    },
  };
}

router.use('/:guildId', requireEntitlement('translation.hub'));

router.get('/:guildId/overview', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = translationStore.getTranslationSection(guildId);
    const providerStatus = providerManager.getProviderStatus(guildId);
    const channelConfigs = Object.values(section.channels || {});
    const userPreferences = Object.values(section.userPreferences || {});

    return success(res, {
      guildId,
      overview: {
        enabled: isModuleEnabled(guildId, 'translation'),
        provider: providerStatus.provider,
        providerLabel: providerStatus.label,
        providerReady: providerStatus.ready,
        providerStatus: providerStatus.status,
        apiKeyConfigured: providerStatus.apiKeyConfigured,
        autoDetect: section.settings?.autoDetect !== false,
        threadMode: section.settings?.threadMode !== false,
        defaultTargetLanguage: section.settings?.defaultTargetLanguage || 'en',
        targetLanguages: section.settings?.targetLanguages || ['en'],
        configuredChannelCount: channelConfigs.length,
        enabledChannelCount: channelConfigs.filter((channel) => channel.enabled !== false).length,
        userPreferenceCount: userPreferences.length,
        analytics: section.analytics || {},
      },
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/provider', (req, res) => {
  try {
    const guildId = getGuildId(req);
    return success(res, { guildId, provider: providerManager.getProviderStatus(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/provider', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const config = providerManager.saveProviderConfig(guildId, req.body || {});
    return success(res, {
      guildId,
      config: publicTranslationConfig(guildId),
      provider: providerManager.getProviderStatus(guildId),
      saved: {
        provider: config.provider,
        defaultTargetLanguage: config.settings?.defaultTargetLanguage || 'en',
        defaultSourceLanguage: config.settings?.defaultSourceLanguage || 'auto',
      },
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/enabled', (req, res) => {
  try {
    const guildId = getGuildId(req);
    setModuleEnabled(guildId, 'translation', req.body?.enabled === true);
    return success(res, { guildId, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.patch('/:guildId/settings', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const sanitizedSettings = { ...(req.body?.settings || req.body || {}) };
    delete sanitizedSettings.apiKey;
    delete sanitizedSettings.apiSecret;
    delete sanitizedSettings.token;

    const config = translationStore.updateTranslationSection(guildId, (current) => ({
      ...current,
      settings: { ...(current.settings || {}), ...sanitizedSettings },
    }));
    return success(res, { guildId, config: publicTranslationConfig(guildId), rawConfig: config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/channels', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, channels: section.channels || {} });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/channels/:channelId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, channelId, channel: section.channels?.[channelId] || null });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/channels/:channelId', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const guild = await getGuild(req, guildId);
    await guardTranslationChannelConfig(guild, channelId);
    const channel = translationStore.saveChannelConfig(guildId, channelId, req.body || {}, guild);
    return success(res, { guildId, channelId, channel, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.delete('/:guildId/channels/:channelId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const config = translationStore.updateTranslationSection(guildId, (current) => {
      const channels = { ...(current.channels || {}) };
      const threadChannels = { ...(current.threadChannels || {}) };
      const threadMappings = { ...(current.threadMappings || {}) };
      delete channels[channelId];
      delete threadChannels[channelId];
      delete threadMappings[channelId];
      return { ...current, channels, threadChannels, threadMappings };
    });
    return success(res, { guildId, channelId, config: publicTranslationConfig(guildId), rawConfig: config });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/threads', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = translationStore.getTranslationSection(guildId);
    return success(res, {
      guildId,
      threadChannels: section.threadChannels || section.channels || {},
      threadMappings: section.threadMappings || {},
      languages: section.languages || section.settings?.targetLanguages || ['en'],
      analytics: section.analytics || {},
      logs: section.logs || [],
    });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/threads/channels/:channelId/enable', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const guild = await getGuild(req, guildId);
    await guardTranslationChannelConfig(guild, channelId);
    const channel = translationStore.saveChannelConfig(guildId, channelId, {
      ...(req.body || {}),
      enabled: true,
      mode: req.body?.mode || 'auto',
      threadMode: true,
      autoCreateThreads: true,
    }, guild);
    const recovery = await translationThreadManager.ensureThreadsForChannel(guild, channelId);
    return success(res, { guildId, channelId, channel, recovery, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/threads/channels/:channelId/disable', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const channel = translationStore.saveChannelConfig(guildId, channelId, { enabled: false, mode: 'disabled' });
    return success(res, { guildId, channelId, channel, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.post('/:guildId/threads/channels/:channelId/recover', async (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const guild = await getGuild(req, guildId);
    const recovery = await translationThreadManager.ensureThreadsForChannel(guild, channelId, { recovery: true });
    return success(res, { guildId, channelId, recovery, config: publicTranslationConfig(guildId) });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/threads/channels/:channelId/mappings', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const channelId = cleanDiscordId(req.params.channelId, 'channel ID');
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, channelId, mappings: section.threadMappings?.[channelId] || {} });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/users', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, userPreferences: section.userPreferences || {} });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/users/:userId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const userId = cleanDiscordId(req.params.userId, 'user ID');
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, userId, preference: section.userPreferences?.[userId] || null });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.put('/:guildId/users/:userId', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const userId = cleanDiscordId(req.params.userId, 'user ID');
    const preference = translationStore.saveUserPreference(guildId, userId, req.body || {});
    return success(res, { guildId, userId, preference });
  } catch (error) {
    return failure(res, error, 400);
  }
});

router.get('/:guildId/analytics', (req, res) => {
  try {
    const guildId = getGuildId(req);
    const section = translationStore.getTranslationSection(guildId);
    return success(res, { guildId, analytics: section.analytics || {} });
  } catch (error) {
    return failure(res, error, 400);
  }
});

module.exports = router;