'use strict';

const twitch = require('./providers/twitch');
const youtube = require('./providers/youtube');
const tiktok = require('./providers/tiktok');
const kick = require('./providers/kick');
const facebook = require('./providers/facebook');
const instagram = require('./providers/instagram');
const x = require('./providers/x');

const PROVIDERS = Object.freeze({
  twitch,
  youtube,
  tiktok,
  kick,
  facebook,
  instagram,
  x,
});

function providerInfo(platform) {
  const id = String(platform || '').trim().toLowerCase();
  const provider = PROVIDERS[id];

  if (!provider) {
    return {
      id,
      label: id || 'Unknown',
      supportedAlertTypes: [],
      status: 'unsupported',
      authorizationRequired: false,
      productionSupported: false,
    };
  }

  const ready = provider.isConfigured();

  return {
    id: provider.id,
    label: provider.label,
    supportedAlertTypes: [...provider.alertTypes],
    status: ready ? 'ready' : 'configuration_required',
    authorizationRequired: !ready,
    productionSupported: true,
  };
}

function unavailable(platform, reason, status = 'unavailable') {
  return {
    platform,
    status,
    isLive: null,
    checkedAt: new Date().toISOString(),
    reason,
    providerSource: 'official_api',
  };
}

async function checkAccount(account = {}) {
  const platform = String(account.platform || '').trim().toLowerCase();
  const provider = PROVIDERS[platform];

  if (!provider) {
    return unavailable(
      platform,
      'Unsupported social platform.',
      'unsupported',
    );
  }

  try {
    return await provider.check({
      ...account,
      platform,
    });
  } catch (error) {
    return unavailable(
      platform,
      error?.message || 'Provider check failed.',
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
    providerSource: checked.providerSource || null,
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
