'use strict';

const twitchProvider = require('./providers/twitchProvider');
const youtubeProvider = require('./providers/youtubeProvider');
const kickProvider = require('./providers/kickProvider');
const tiktokProvider = require('./providers/tiktokProvider');
const instagramProvider = require('./providers/instagramProvider');
const xProvider = require('./providers/xProvider');

const PROVIDER_STATUSES = Object.freeze({
  READY: 'ready',
  NOT_CONFIGURED: 'not_configured',
  NOT_IMPLEMENTED: 'not_implemented',
  AUTHORIZATION_REQUIRED: 'authorization_required',
  ERROR: 'error',
});

const providerDefinitions = Object.freeze({
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    supportedAlertTypes: ['post'],
    requiredEnv: [],
    handler: instagramProvider,
    zeroCredentialSupported: false,
    unavailableReason: 'Instagram monitoring requires authorization from the monitored professional account and is outside Social Studio zero-credential scope.',
  },
  kick: {
    id: 'kick',
    label: 'Kick',
    supportedAlertTypes: ['live'],
    requiredEnv: ['KICK_CLIENT_ID', 'KICK_CLIENT_SECRET'],
    handler: kickProvider,
    zeroCredentialSupported: true,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    supportedAlertTypes: ['post', 'live'],
    requiredEnv: [],
    handler: tiktokProvider,
    zeroCredentialSupported: false,
    unavailableReason: 'TikTok monitored-account access requires creator authorization and is outside Social Studio zero-credential scope.',
  },
  twitch: {
    id: 'twitch',
    label: 'Twitch',
    supportedAlertTypes: ['live'],
    requiredEnv: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
    handler: twitchProvider,
    zeroCredentialSupported: true,
  },
  x: {
    id: 'x',
    label: 'X',
    supportedAlertTypes: ['post'],
    requiredEnv: [],
    handler: xProvider,
    zeroCredentialSupported: true,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    supportedAlertTypes: ['upload', 'short', 'live'],
    requiredEnv: ['YOUTUBE_API_KEY'],
    handler: youtubeProvider,
    zeroCredentialSupported: true,
  },
});

function hasRequiredEnv(requiredEnv = []) {
  return requiredEnv.every((name) => Boolean(String(process.env[name] || '').trim()));
}

function getProvider(platform) {
  const provider = providerDefinitions[String(platform || '').toLowerCase()] || null;
  if (!provider) return null;

  let status;
  if (provider.zeroCredentialSupported === false) {
    status = PROVIDER_STATUSES.AUTHORIZATION_REQUIRED;
  } else if (typeof provider.handler?.isConfigured === 'function' && !provider.handler.isConfigured()) {
    status = PROVIDER_STATUSES.NOT_CONFIGURED;
  } else if (provider.requiredEnv.length && !hasRequiredEnv(provider.requiredEnv)) {
    status = PROVIDER_STATUSES.NOT_CONFIGURED;
  } else if (provider.handler?.implemented === true || ['twitch', 'youtube'].includes(provider.handler?.id)) {
    status = PROVIDER_STATUSES.READY;
  } else {
    status = PROVIDER_STATUSES.NOT_IMPLEMENTED;
  }

  return {
    ...provider,
    status,
    productionSupported: status === PROVIDER_STATUSES.READY,
    ownerManaged: true,
    userCredentialsRequired: false,
  };
}

function listProviders() {
  return Object.keys(providerDefinitions)
    .sort((a, b) => providerDefinitions[a].label.localeCompare(providerDefinitions[b].label))
    .map(getProvider);
}

async function checkAccount(account = {}) {
  const provider = getProvider(account.platform);
  if (!provider) {
    return {
      success: false,
      status: PROVIDER_STATUSES.ERROR,
      providerStatus: PROVIDER_STATUSES.ERROR,
      error: `Unsupported social platform: ${account.platform || 'unknown'}`,
    };
  }

  if (provider.status !== PROVIDER_STATUSES.READY) {
    const error = provider.status === PROVIDER_STATUSES.AUTHORIZATION_REQUIRED
      ? provider.unavailableReason
      : provider.status === PROVIDER_STATUSES.NOT_CONFIGURED
        ? `${provider.label} provider is missing global Goliath credentials.`
        : `${provider.label} provider polling is not implemented yet.`;
    return {
      success: false,
      status: provider.status,
      providerStatus: provider.status,
      platform: provider.id,
      provider: provider.label,
      accountId: account.accountId,
      username: account.username,
      supportedAlertTypes: provider.supportedAlertTypes,
      checkedAt: new Date().toISOString(),
      error,
    };
  }

  if (typeof provider.handler?.checkAccount === 'function') return provider.handler.checkAccount(account);
  return {
    success: false,
    status: PROVIDER_STATUSES.ERROR,
    providerStatus: PROVIDER_STATUSES.ERROR,
    error: `${provider.label} provider handler is unavailable.`,
  };
}

module.exports = {
  PROVIDER_STATUSES,
  getProvider,
  listProviders,
  checkAccount,
};