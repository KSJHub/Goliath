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

module.exports = {
  providerInfo,
  checkAccount,
};
