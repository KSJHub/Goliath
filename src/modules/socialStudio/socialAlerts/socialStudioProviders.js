'use strict';

const twitch = require('./providers/twitch');
const youtube = require('./providers/youtube');
const tiktok = require('./providers/tiktok');
const kick = require('./providers/kick');
const facebook = require('./providers/facebook');
const instagram = require('./providers/instagram');
const x = require('./providers/x');

const PROVIDERS = Object.freeze({ twitch, youtube, tiktok, kick, facebook, instagram, x });

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

function unavailable(platform, reason, status = 'unavailable', providerSource = null) {
  const info = providerInfo(platform);
  return {
    platform,
    status,
    isLive: null,
    checkedAt: new Date().toISOString(),
    reason,
    providerSource: providerSource || info.providerClass || 'unknown',
  };
}

async function checkAccount(account = {}) {
  const platform = String(account.platform || '').trim().toLowerCase();
  const provider = PROVIDERS[platform];
  const info = providerInfo(platform);

  if (!provider) return unavailable(platform, 'Unsupported social platform.', 'unsupported', 'unsupported');
  if (!info.configured) {
    return unavailable(
      platform,
      `${info.label} provider configuration is required before checks can run.`,
      'configuration_required',
      info.providerClass,
    );
  }

  try {
    const checked = await provider.check({ ...account, platform });
    return {
      ...checked,
      platform,
      providerSource: checked?.providerSource || info.providerClass,
    };
  } catch (error) {
    return unavailable(platform, error?.message || 'Provider check failed.', 'unavailable', info.providerClass);
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

  return {
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
}

module.exports = {
  providerInfo,
  checkAccount,
  diagnoseAccount,
  resolveAccountIdentity,
};
