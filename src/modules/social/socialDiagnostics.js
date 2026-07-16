'use strict';

const socialManager = require('./socialManager');
const socialQueue = require('./socialQueue');
const socialHistory = require('./socialHistory');
const socialCreators = require('./socialCreators');
const providerRegistry = require('./providerRegistry');

const SCORE_WEIGHTS = Object.freeze({
  identifier: 20,
  destination: 20,
  provider: 20,
  providerCheck: 15,
  providerError: 15,
  queue: 10,
});

function ageMs(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Infinity;
}

function grade(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'warning';
  return 'critical';
}

function providerDiagnostics(guildId) {
  const config = socialManager.getConfig(guildId);
  const accounts = config.accounts || [];
  return providerRegistry.listProviders().map((provider) => {
    const providerAccounts = accounts.filter((account) => account.platform === provider.id);
    const enabledAccounts = providerAccounts.filter((account) => account.enabled !== false);
    const checkedAccounts = enabledAccounts.filter((account) => account.lastSeen?.lastCheckedAt);
    const failedAccounts = enabledAccounts.filter((account) => account.lastSeen?.lastProviderError);
    const latestCheck = checkedAccounts.map((account) => account.lastSeen.lastCheckedAt).sort().at(-1) || null;
    const responseTimes = enabledAccounts
      .map((account) => Number(account.metadata?.provider?.responseTimeMs || 0))
      .filter((value) => Number.isFinite(value) && value > 0);

    return {
      id: provider.id,
      label: provider.label,
      status: config.providers?.[provider.id]?.enabled === false ? 'disabled' : provider.status,
      enabled: config.providers?.[provider.id]?.enabled !== false,
      supportedAlertTypes: provider.supportedAlertTypes || [],
      accountCount: providerAccounts.length,
      enabledAccountCount: enabledAccounts.length,
      checkedAccountCount: checkedAccounts.length,
      failedAccountCount: failedAccounts.length,
      latestCheck,
      latestCheckAgeMs: latestCheck ? ageMs(latestCheck) : null,
      averageResponseMs: responseTimes.length ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length) : null,
      credentialOwner: 'Goliath',
      userCredentialsRequired: false,
      ready: provider.status === 'ready',
    };
  });
}

function accountDiagnostics(account, providerMap, queueItems) {
  let score = 100;
  const issues = [];
  const provider = providerMap.get(account.platform);
  const routedChannel = socialManager.routeChannelId(account, account.alertTypes?.[0] || 'live');
  const accountQueue = queueItems.filter((item) => item.accountId === account.accountId);

  if (!account.username && !account.externalId && !account.url) {
    score -= SCORE_WEIGHTS.identifier;
    issues.push({ code: 'identifier_missing', severity: 'error' });
  }
  if (!routedChannel) {
    score -= SCORE_WEIGHTS.destination;
    issues.push({ code: 'destination_missing', severity: 'error' });
  }
  if (!provider || provider.status !== 'ready') {
    score -= SCORE_WEIGHTS.provider;
    issues.push({ code: `provider_${provider?.status || 'unknown'}`, severity: provider?.status === 'disabled' ? 'warning' : 'error' });
  }
  if (!account.lastSeen?.lastCheckedAt || ageMs(account.lastSeen.lastCheckedAt) > 24 * 60 * 60 * 1000) {
    score -= SCORE_WEIGHTS.providerCheck;
    issues.push({ code: 'provider_check_stale', severity: 'warning' });
  }
  if (account.lastSeen?.lastProviderError) {
    score -= SCORE_WEIGHTS.providerError;
    issues.push({ code: 'provider_last_error', severity: 'warning', error: account.lastSeen.lastProviderError });
  }
  if (accountQueue.some((item) => item.status === 'failed')) {
    score -= SCORE_WEIGHTS.queue;
    issues.push({ code: 'delivery_failed', severity: 'warning' });
  }

  score = Math.max(0, Math.min(100, score));
  return {
    accountId: account.accountId,
    creatorId: account.metadata?.creatorId || null,
    displayName: account.displayName || account.username || account.platform,
    platform: account.platform,
    enabled: account.enabled !== false,
    score,
    grade: grade(score),
    lastCheckedAt: account.lastSeen?.lastCheckedAt || null,
    lastAlertAt: account.lastSeen?.lastAlertAt || null,
    lastProviderStatus: account.lastSeen?.lastProviderStatus || provider?.status || 'unknown',
    queuedDeliveries: accountQueue.filter((item) => item.status === 'queued').length,
    failedDeliveries: accountQueue.filter((item) => item.status === 'failed').length,
    issues,
  };
}

function creatorDiagnostics(guildId) {
  const config = socialManager.getConfig(guildId);
  const providers = providerDiagnostics(guildId);
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const queueItems = socialQueue.list(guildId);
  const accounts = (config.accounts || []).map((account) => accountDiagnostics(account, providerMap, queueItems));
  const profiles = socialCreators.list(guildId).map((profile) => {
    const linked = accounts.filter((account) => profile.accountIds.includes(account.accountId));
    const score = linked.length ? Math.round(linked.reduce((sum, account) => sum + account.score, 0) / linked.length) : 0;
    const issues = linked.flatMap((account) => account.issues.map((issue) => ({ ...issue, accountId: account.accountId, platform: account.platform })));
    if (!linked.length) issues.push({ code: 'profile_has_no_accounts', severity: 'warning' });
    return {
      creatorId: profile.creatorId,
      displayName: profile.displayName,
      enabled: profile.enabled !== false,
      group: profile.group,
      tags: profile.tags,
      accountCount: linked.length,
      score,
      grade: grade(score),
      issues,
    };
  });

  return { accounts, profiles };
}

function buildDiagnostics(guildId) {
  const providers = providerDiagnostics(guildId);
  const creators = creatorDiagnostics(guildId);
  const scored = creators.accounts.filter((account) => account.enabled);
  const score = scored.length ? Math.round(scored.reduce((sum, account) => sum + account.score, 0) / scored.length) : 100;
  return {
    module: 'social',
    guildId: String(guildId),
    checkedAt: new Date().toISOString(),
    score,
    grade: grade(score),
    providers,
    accounts: creators.accounts,
    profiles: creators.profiles,
    queue: socialQueue.summary(guildId),
    history: socialHistory.summary(guildId),
  };
}

module.exports = { SCORE_WEIGHTS, grade, providerDiagnostics, creatorDiagnostics, buildDiagnostics };
