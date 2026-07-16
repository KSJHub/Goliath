'use strict';

const social = require('./social');

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

function routedChannelIds(account = {}) {
  const routing = account.metadata?.routing && typeof account.metadata.routing === 'object' ? account.metadata.routing : {};
  const entries = [
    ['default', account.alertChannelId],
    ['live', routing.live || routing.liveChannelId],
    ['upload', routing.upload || routing.uploadChannelId],
    ['short', routing.short || routing.shortChannelId],
    ['post', routing.post || routing.postChannelId],
  ];
  const seen = new Set();
  return entries.filter(([, id]) => id && !seen.has(id) && seen.add(id));
}

function validClock(value) {
  if (value === undefined || value === null || value === '') return true;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

async function buildHealth(guild) {
  if (!guild) throw new Error('Guild is required.');
  const config = social.getConfig(guild.id);
  const issues = [];
  const providers = social.providers.listProviders();
  const queue = social.queue.list(guild.id);
  const diagnostics = social.diagnostics.buildDiagnostics(guild.id);

  for (const account of config.accounts || []) {
    if (account.enabled === false) continue;
    const provider = providers.find((item) => item.id === account.platform);
    if (!provider) issues.push({ code: 'provider_unknown', severity: 'error', accountId: account.accountId, platform: account.platform });
    else if (provider.status !== 'ready') issues.push({ code: `provider_${provider.status}`, severity: 'warning', accountId: account.accountId, platform: account.platform });

    const routes = routedChannelIds(account);
    if (!routes.length) issues.push({ code: 'alert_channel_missing', severity: 'error', accountId: account.accountId, channelId: null });
    for (const [alertType, channelId] of routes) {
      const channel = await resolveChannel(guild, channelId);
      if (!channel?.send) issues.push({ code: 'routed_channel_missing', severity: 'error', accountId: account.accountId, alertType, channelId });
    }

    if (!account.username && !account.externalId) issues.push({ code: 'account_identifier_missing', severity: 'error', accountId: account.accountId });
    if (account.lastSeen?.lastProviderError) issues.push({ code: 'provider_last_error', severity: 'warning', accountId: account.accountId, error: account.lastSeen.lastProviderError });
  }

  const quiet = config.settings?.quietHours || {};
  if (quiet.enabled === true) {
    if (!validClock(quiet.start) || !validClock(quiet.end)) issues.push({ code: 'quiet_hours_invalid', severity: 'error', start: quiet.start, end: quiet.end });
    if (quiet.timezone || quiet.timeZone) {
      const timezone = quiet.timezone || quiet.timeZone;
      try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date()); }
      catch { issues.push({ code: 'quiet_timezone_invalid', severity: 'error', timezone }); }
    }
  }

  for (const item of queue.filter((entry) => entry.status === 'failed')) {
    issues.push({ code: 'delivery_retry_exhausted', severity: 'warning', queueId: item.id, accountId: item.accountId, error: item.lastError });
  }

  for (const profile of diagnostics.profiles.filter((item) => item.accountCount === 0)) {
    issues.push({ code: 'creator_profile_empty', severity: 'warning', creatorId: profile.creatorId });
  }

  return {
    module: 'social',
    guildId: guild.id,
    healthy: issues.every((issue) => issue.severity !== 'error'),
    score: diagnostics.score,
    grade: diagnostics.grade,
    checkedAt: new Date().toISOString(),
    enabled: config.enabled !== false,
    accountCount: config.accounts.length,
    enabledAccountCount: config.accounts.filter((account) => account.enabled !== false).length,
    creatorProfileCount: diagnostics.profiles.length,
    providers: diagnostics.providers,
    accounts: diagnostics.accounts,
    creatorProfiles: diagnostics.profiles,
    queue: social.queue.summary(guild.id),
    quietHours: {
      enabled: quiet.enabled === true,
      start: quiet.start || '00:00',
      end: quiet.end || '08:00',
      timezone: quiet.timezone || quiet.timeZone || 'UTC',
    },
    issues,
  };
}

async function repair(guild, meta = {}) {
  if (!guild) throw new Error('Guild is required.');
  const config = social.getConfig(guild.id);
  const repaired = [];
  const failed = [];

  for (const account of config.accounts || []) {
    if (account.enabled === false) continue;
    try {
      const startedAt = Date.now();
      const result = await social.providers.checkAccount(account);
      social.updateAccount(guild.id, account.accountId, {
        externalId: result.externalId || account.externalId,
        metadata: {
          ...(account.metadata || {}),
          provider: {
            providerStatus: result.providerStatus || result.status || 'unknown',
            lastCheckedAt: result.checkedAt || new Date().toISOString(),
            lastError: result.success ? '' : result.error || '',
            isLive: result.isLive === true,
            responseTimeMs: Date.now() - startedAt,
          },
        },
        lastSeen: {
          ...(account.lastSeen || {}),
          lastCheckedAt: result.checkedAt || new Date().toISOString(),
          lastProviderStatus: result.providerStatus || result.status || 'unknown',
          lastProviderError: result.success ? '' : result.error || '',
          lastLiveState: result.isLive ? 'live' : 'offline',
        },
      }, { action: 'social_repair_check', ...meta });
      repaired.push({ accountId: account.accountId, providerStatus: result.providerStatus || result.status || 'unknown' });
    } catch (error) {
      social.store.incrementAnalytics(guild.id, { errors: 1 }, { action: 'social_repair_error', ...meta });
      failed.push({ accountId: account.accountId, error: error.message });
    }
  }

  for (const item of social.queue.list(guild.id, { status: 'failed' })) {
    social.queue.retryNow(guild.id, item.id, { action: 'social_repair_queue_retry', ...meta });
  }
  const queueResult = await social.queue.processGuild(guild.id, guild.client, { meta: { action: 'social_repair_queue_process', ...meta } });

  return { repaired, failed, queue: queueResult, health: await buildHealth(guild) };
}

function exportConfig(guildId) {
  return {
    module: 'social',
    guildId: String(guildId),
    exportedAt: new Date().toISOString(),
    config: social.store.getSocialSection(guildId),
    diagnostics: social.diagnostics.buildDiagnostics(guildId),
    queue: social.queue.list(guildId),
    history: social.history.list(guildId, { limit: social.history.MAX_HISTORY }),
  };
}

function reset(guildId, meta = {}) {
  social.queue.clear(guildId, { action: 'social_reset_queue', ...meta });
  return social.store.saveSocialSection(guildId, social.store.defaultSocialSection(), { action: 'social_reset', ...meta });
}

module.exports = { buildHealth, repair, exportConfig, reset };
