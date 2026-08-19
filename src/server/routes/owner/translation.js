'use strict';

const express = require('express');
const { normalizeBotMode } = require('../../../config/botModes');
const security = require('../../../core/security/securityCore');
const guildManager = require('../../../core/guild/guildManager');
const translationStore = require('../../../modules/utilityStudio/translation/translationStore');

const router = express.Router();
const RUNTIME_MODE = normalizeBotMode(process.env.BOT_MODE);

const ENVIRONMENT_PORTS = [
  { environment: 'DEV', port: 3001 },
  { environment: 'BETA', port: 3011 },
  { environment: 'PRODUCTION', port: 3021 },
];

function isInternalOwnerRequest(req) {
  const token = String(process.env.OWNER_INTERNAL_TOKEN || '').trim();
  const headerToken = String(req.headers['x-goliath-owner-token'] || '').trim();
  return Boolean(token && headerToken === token);
}

function requireOwner(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated.' });
  }

  if (!security.isBotOwner(req.session.user.id)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  return next();
}

function requireOwnerOrInternal(req, res, next) {
  if (isInternalOwnerRequest(req)) return next();
  return requireOwner(req, res, next);
}

function getDiscordClient(req) {
  return (
    req.app?.locals?.client ||
    req.app?.locals?.discordClient ||
    global.client ||
    global.discordClient ||
    null
  );
}

function getGuildName(guild) {
  return guild?.name || guild?.guildName || 'Unknown Guild';
}

function providerHealth() {
  return {
    openai: {
      label: 'OpenAI',
      priority: 1,
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    deepl: {
      label: 'DeepL',
      priority: 2,
      configured: Boolean(process.env.DEEPL_API_KEY),
    },
    google: {
      label: 'Google',
      priority: 3,
      configured: Boolean(process.env.GOOGLE_TRANSLATE_API_KEY),
    },
  };
}

function buildGuildOverview(guild, environment = RUNTIME_MODE) {
  const guildId = guild.guildId || guild.id;
  const section = translationStore.getTranslationSection(guildId) || {};
  const channels = Object.values(section.channels || {});
  const enabledChannels = channels.filter((channel) => channel.enabled !== false);
  const users = Object.values(section.userPreferences || {});
  const threadMappings = Object.values(section.threadMappings || {}).reduce(
    (total, mapping) => total + Object.keys(mapping || {}).length,
    0,
  );
  const analytics = section.analytics || {};
  const logs = Array.isArray(section.logs) ? section.logs : [];
  const guildName = getGuildName(guild);

  return {
    guildId,
    guildName,
    environment,
    enabled: guildManager.isModuleEnabled(guildId, 'translation'),
    provider: section.settings?.provider || 'manual',
    autoDetect: section.settings?.autoDetect !== false,
    threadMode: section.settings?.threadMode !== false,
    defaultTargetLanguage: section.settings?.defaultTargetLanguage || 'en',
    targetLanguages: section.settings?.targetLanguages || ['en'],
    channelCount: channels.length,
    enabledChannelCount: enabledChannels.length,
    userPreferenceCount: users.length,
    threadMappingCount: threadMappings,
    totalTranslations: Number(
      analytics.totalTranslations ||
      analytics.translations ||
      analytics.messagesTranslated ||
      0,
    ),
    logsStored: logs.length,
    recentActivity: logs.slice(0, 10).map((entry) => ({
      ...entry,
      guildId,
      guildName,
      environment,
      timestamp: entry.timestamp || entry.createdAt || entry.time || null,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function summarise(guilds = []) {
  const totals = {
    guilds: guilds.length,
    enabledGuilds: 0,
    configuredChannels: 0,
    enabledChannels: 0,
    userPreferences: 0,
    threadMappings: 0,
    translations: 0,
    logsStored: 0,
    manualProviderGuilds: 0,
  };

  const recentActivity = [];

  for (const guild of guilds) {
    totals.enabledGuilds += guild.enabled ? 1 : 0;
    totals.configuredChannels += Number(guild.channelCount || 0);
    totals.enabledChannels += Number(guild.enabledChannelCount || 0);
    totals.userPreferences += Number(guild.userPreferenceCount || 0);
    totals.threadMappings += Number(guild.threadMappingCount || 0);
    totals.translations += Number(guild.totalTranslations || 0);
    totals.logsStored += Number(guild.logsStored || 0);
    totals.manualProviderGuilds += guild.provider === 'manual' ? 1 : 0;

    for (const entry of guild.recentActivity || []) {
      recentActivity.push(entry);
    }
  }

  recentActivity.sort((a, b) => {
    const left = new Date(a.timestamp || 0).getTime();
    const right = new Date(b.timestamp || 0).getTime();
    return right - left;
  });

  return {
    totals,
    providerHealth: providerHealth(),
    recentActivity: recentActivity.slice(0, 25),
  };
}

async function fetchEnvironmentTranslation(port, environment) {
  try {
    const token = String(process.env.OWNER_INTERNAL_TOKEN || '').trim();
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/translation`, {
      headers: {
        'x-goliath-owner-token': token,
      },
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    const guilds = Array.isArray(payload.guilds) ? payload.guilds : [];

    return guilds.map((guild) => ({
      ...guild,
      environment,
      runtimeMode: environment,
      sourcePort: port,
    }));
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[OWNER TRANSLATION ALL] ${environment} unavailable on port ${port}:`, error.message);
    }

    return [];
  }
}

router.get('/', requireOwnerOrInternal, (req, res) => {
  const client = getDiscordClient(req);
  const mode = RUNTIME_MODE;

  if (!client?.guilds?.cache) {
    return res.status(503).json({ success: false, error: 'Discord client unavailable.' });
  }

  const guilds = [...client.guilds.cache.values()]
    .map((guild) => buildGuildOverview(guild, mode))
    .sort((a, b) => String(a.guildName || '').localeCompare(String(b.guildName || '')));

  const summary = summarise(guilds);

  return res.json({
    success: true,
    owner: true,
    mode,
    runtimeMode: mode,
    guilds,
    ...summary,
    updatedAt: new Date().toISOString(),
  });
});

router.get('/all', requireOwner, async (req, res) => {
  try {
    const requestedEnvironment = String(req.query.environment || 'all').toUpperCase();
    const results = await Promise.all(
      ENVIRONMENT_PORTS.map((environmentConfig) =>
        fetchEnvironmentTranslation(environmentConfig.port, environmentConfig.environment),
      ),
    );

    let guilds = [
      ...(results[0] || []),
      ...(results[1] || []),
      ...(results[2] || []),
    ];

    if (requestedEnvironment !== 'ALL') {
      guilds = guilds.filter((guild) => String(guild.environment || '').toUpperCase() === requestedEnvironment);
    }

    const summary = summarise(guilds);

    return res.json({
      success: true,
      owner: true,
      mode: 'GLOBAL',
      runtimeMode: 'GLOBAL',
      environment: requestedEnvironment,
      guilds,
      ...summary,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[OWNER TRANSLATION ALL]', error);

    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
