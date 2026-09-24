'use strict';

const twitch = require('./providers/twitch');
const youtube = require('./providers/youtube');
const tiktok = require('./providers/tiktok');
const kick = require('./providers/kick');
const facebook = require('./providers/facebook');
const instagram = require('./providers/instagram');
const x = require('./providers/x');

const PROVIDERS = Object.freeze({ twitch, youtube, tiktok, kick, facebook, instagram, x });
const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

const PROVIDER_CAPABILITIES = Object.freeze({
  twitch: { providerClass: 'official_api', alertTypes: ['live', 'vod', 'clip'] },
  youtube: { providerClass: 'official_api', alertTypes: ['live', 'video', 'short', 'vod'] },
  kick: { providerClass: 'official_api', alertTypes: ['live'] },
  tiktok: { providerClass: 'public_detection', alertTypes: ['live'] },
  facebook: { providerClass: 'official_api', alertTypes: ['live', 'post'] },
  instagram: { providerClass: 'official_api', alertTypes: ['post', 'short'] },
  x: { providerClass: 'official_api', alertTypes: ['post'] },
});

function providerInfo(platform) {
  const id = String(platform || '').trim().toLowerCase();
  const provider = PROVIDERS[id];
  const capability = PROVIDER_CAPABILITIES[id];

  if (!provider || !capability) {
    return {
      id,
      label: id || 'Unknown',
      providerClass: 'unsupported',
      supportedAlertTypes: [],
      status: 'unsupported',
      configured: false,
      authorizationRequired: false,
      productionSupported: false,
    };
  }

  const configured = provider.isConfigured();
  const supportedAlertTypes = Array.isArray(provider.alertTypes) && provider.alertTypes.length
    ? [...provider.alertTypes]
    : [...capability.alertTypes];

  return {
    id: provider.id,
    label: provider.label,
    providerClass: capability.providerClass,
    supportedAlertTypes,
    status: configured ? 'ready' : 'configuration_required',
    configured,
    authorizationRequired: capability.providerClass === 'official_api' && !configured,
    productionSupported: true,
  };
}

function unavailable(platform, reason, status = 'unavailable', providerSource = null, failureCategory = null) {
  const info = providerInfo(platform);
  return {
    platform,
    status,
    isLive: null,
    checkedAt: new Date().toISOString(),
    reason,
    failureCategory,
    providerSource: providerSource || info.providerClass || 'unknown',
  };
}

function providerTimeoutMs() {
  const configured = Number(process.env.SOCIAL_PROVIDER_TIMEOUT_MS || DEFAULT_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000 ? configured : DEFAULT_PROVIDER_TIMEOUT_MS;
}

function classifyProviderFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const statusCode = Number(error?.status || error?.statusCode || error?.response?.status || 0);

  if (/timed out after \d+ms/.test(message) || message.includes('timeout')) return 'timeout';
  if (statusCode === 401 || message.includes('unauthorized') || message.includes('invalid token')) return 'authentication';
  if (statusCode === 403 || message.includes('forbidden') || message.includes('permission')) return 'permission';
  if (statusCode === 404 || message.includes('not found')) return 'not_found';
  if (statusCode === 429 || message.includes('rate limit') || message.includes('too many requests')) return 'rate_limited';
  if (statusCode >= 500 || message.includes('service unavailable') || message.includes('bad gateway')) return 'provider_unavailable';
  if (message.includes('json') || message.includes('parse') || message.includes('malformed') || message.includes('invalid response')) return 'invalid_response';
  if (message.includes('network') || message.includes('fetch failed') || message.includes('econn') || message.includes('enotfound')) return 'network';
  return 'unknown';
}

function diagnosticHealth(diagnostic = {}) {
  const status = String(diagnostic.status || '').toLowerCase();
  const failureCategory = diagnostic.failureCategory || null;

  if (status === 'unsupported' || failureCategory === 'unsupported') {
    return { level: 'unsupported', healthy: false, actionable: false, label: 'Unsupported' };
  }
  if (status === 'configuration_required' || failureCategory === 'configuration') {
    return { level: 'configuration', healthy: false, actionable: true, label: 'Configuration Required' };
  }
  if (failureCategory || ['timeout', 'unavailable', 'error', 'failed'].includes(status)) {
    return { level: 'error', healthy: false, actionable: true, label: 'Provider Error' };
  }
  if (diagnostic.deliveryReady === false) {
    return { level: 'delivery', healthy: false, actionable: true, label: 'Delivery Setup Required' };
  }
  return { level: 'healthy', healthy: true, actionable: false, label: 'Healthy' };
}

function diagnosticRecord(diagnostic = {}) {
  const health = diagnostic.health || diagnosticHealth(diagnostic);
  return {
    checkedAt: diagnostic.checkedAt || new Date().toISOString(),
    status: diagnostic.status || 'unknown',
    isLive: typeof diagnostic.isLive === 'boolean' ? diagnostic.isLive : null,
    latencyMs: Number.isFinite(Number(diagnostic.latencyMs)) ? Number(diagnostic.latencyMs) : null,
    providerClass: diagnostic.providerClass || null,
    providerSource: diagnostic.providerSource || null,
    configured: diagnostic.configured !== false,
    failureCategory: diagnostic.failureCategory || null,
    reason: diagnostic.reason || null,
    deliveryReady: typeof diagnostic.deliveryReady === 'boolean' ? diagnostic.deliveryReady : null,
    deliveryChannelId: diagnostic.deliveryChannelId || null,
    deliveryReason: diagnostic.deliveryReason || null,
    health: {
      level: health.level || 'unknown',
      healthy: health.healthy === true,
      actionable: health.actionable === true,
      label: health.label || 'Unknown',
    },
  };
}

function applyDiagnosticState(account = {}, diagnostic = {}) {
  const record = diagnosticRecord(diagnostic);
  return {
    ...account,
    diagnostics: {
      ...(account.diagnostics && typeof account.diagnostics === 'object' ? account.diagnostics : {}),
      provider: record,
    },
  };
}

function summarizeDiagnostics(diagnostics = []) {
  const summary = {
    total: 0,
    healthy: 0,
    live: 0,
    offline: 0,
    configuration: 0,
    providerErrors: 0,
    deliveryIssues: 0,
    unsupported: 0,
    slow: 0,
    maxLatencyMs: 0,
    overall: 'healthy',
  };

  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    const health = diagnosticHealth(diagnostic);
    const latencyMs = Math.max(0, Number(diagnostic?.latencyMs || 0));
    summary.total += 1;
    summary.maxLatencyMs = Math.max(summary.maxLatencyMs, latencyMs);
    if (latencyMs >= 5000) summary.slow += 1;
    if (diagnostic?.isLive === true) summary.live += 1;
    else if (diagnostic?.isLive === false) summary.offline += 1;

    if (health.level === 'healthy') summary.healthy += 1;
    else if (health.level === 'configuration') summary.configuration += 1;
    else if (health.level === 'delivery') summary.deliveryIssues += 1;
    else if (health.level === 'unsupported') summary.unsupported += 1;
    else summary.providerErrors += 1;
  }

  if (summary.providerErrors > 0) summary.overall = 'error';
  else if (summary.configuration > 0 || summary.deliveryIssues > 0) summary.overall = 'attention';
  else if (summary.total === 0) summary.overall = 'empty';

  return summary;
}

async function runProviderCheck(provider, account, platform) {
  const timeoutMs = providerTimeoutMs();
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => provider.check({ ...account, platform })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${provider.label || platform} provider check timed out after ${timeoutMs}ms.`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkAccount(account = {}) {
  const platform = String(account.platform || '').trim().toLowerCase();
  const provider = PROVIDERS[platform];
  const info = providerInfo(platform);

  if (!provider) return unavailable(platform, 'Unsupported social platform.', 'unsupported', 'unsupported', 'unsupported');
  if (!info.configured) {
    return unavailable(
      platform,
      `${info.label} provider configuration is required before checks can run.`,
      'configuration_required',
      info.providerClass,
      'configuration',
    );
  }

  try {
    const checked = await runProviderCheck(provider, account, platform);
    return {
      ...checked,
      platform,
      failureCategory: checked?.failureCategory || null,
      providerSource: checked?.providerSource || info.providerClass,
    };
  } catch (error) {
    const failureCategory = classifyProviderFailure(error);
    return unavailable(
      platform,
      error?.message || 'Provider check failed.',
      failureCategory === 'timeout' ? 'timeout' : 'unavailable',
      info.providerClass,
      failureCategory,
    );
  }
}

function resolveAccountIdentity(account = {}, checked = {}) {
  return {
    username: checked.resolvedUsername || account.username || account.normalizedUsername || null,
    resolvedUsername: checked.resolvedUsername || account.normalizedUsername || account.username || null,
    externalId: checked.externalId || account.externalId || null,
    displayName: checked.displayName || account.displayName || null,
    profileUrl: checked.url || checked.profileUrl || account.profileUrl || account.url || null,
  };
}

async function diagnoseAccount(account = {}, options = {}) {
  const startedAt = Date.now();
  const checked = await checkAccount(account);
  const identity = resolveAccountIdentity(account, checked);
  const deliveryChannelId = options.deliveryChannelId || null;
  const info = providerInfo(account.platform || checked.platform);
  const diagnostic = {
    accountId: account.accountId || account.id || null,
    platform: String(account.platform || checked.platform || '').trim().toLowerCase(),
    status: checked.status,
    isLive: checked.isLive,
    live: checked.event || null,
    events: Array.isArray(checked.events) ? checked.events : [],
    checkedAt: checked.checkedAt || new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    ...identity,
    reason: checked.reason || null,
    failureCategory: checked.failureCategory || null,
    providerSource: checked.providerSource || info.providerClass || null,
    providerClass: info.providerClass,
    configured: info.configured,
    supportedAlertTypes: info.supportedAlertTypes,
    deliveryReady: options.includeDelivery === true ? Boolean(deliveryChannelId) : null,
    deliveryChannelId: options.includeDelivery === true ? deliveryChannelId : null,
    deliveryReason: options.includeDelivery === true && !deliveryChannelId
      ? `No alert channel configured for ${account.platform}/live.`
      : null,
    delivered: [],
  };
  return { ...diagnostic, health: diagnosticHealth(diagnostic) };
}

module.exports = {
  providerInfo,
  checkAccount,
  diagnoseAccount,
  resolveAccountIdentity,
  classifyProviderFailure,
  diagnosticHealth,
  diagnosticRecord,
  applyDiagnosticState,
  summarizeDiagnostics,
};
