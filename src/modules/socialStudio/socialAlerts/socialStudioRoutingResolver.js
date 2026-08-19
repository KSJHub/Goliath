'use strict';

const { ALERT_TYPES } = require('./socialStudioTemplates');

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function creatorFor(config, accountId) {
  return Object.values(object(config?.creators)).find((creator) =>
    Array.isArray(creator?.accountIds) && creator.accountIds.map(String).includes(String(accountId || ''))
  ) || null;
}

function linkedUserId(creator, account) {
  return String(
    creator?.ownerDiscordId || creator?.discordUserId || creator?.userId ||
    account?.ownerDiscordId || account?.discordUserId || account?.userId || ''
  );
}

function explicitAccountRoutes(account) {
  if (!account || typeof account !== 'object') return { channelId: null, channels: {} };
  if (account.userRouteBaseCaptured) {
    return { channelId: account.userRouteBaseChannelId || null, channels: object(account.userRouteBaseChannels) };
  }
  if (account.creatorRouteInherited) {
    return { channelId: account.creatorRoutePreviousChannelId || null, channels: object(account.creatorRoutePreviousChannels) };
  }
  return { channelId: account.alertChannelId || null, channels: object(account.alertChannels) };
}

function resolveSocialRoute(config, account, eventType, creatorInput = null) {
  const creator = creatorInput || creatorFor(config, account?.accountId);
  const platform = String(account?.platform || '').toLowerCase();
  const userId = linkedUserId(creator, account);
  const userRoutes = object(object(config?.userChannelOverrides)[userId]);
  const accountRoutes = explicitAccountRoutes(account);

  const candidates = [
    [object(creator?.platformChannels)[platform], 'Creator Platform Override'],
    [userRoutes[eventType], 'User Content Override'],
    [userRoutes.all, 'User All Content'],
    [creator?.alertChannelId, 'Creator Override'],
    [accountRoutes.channels[eventType], 'Account Content Override'],
    [accountRoutes.channelId, 'Account Override'],
    [object(config?.platformChannels)[platform], 'Server Platform Override'],
    [object(config?.alertChannels)[eventType], 'Server Dedicated'],
    [config?.alertsChannelId, 'Server Default'],
  ];

  for (const [channelId, source] of candidates) {
    if (channelId) return { channelId: String(channelId), source, creator, userId, platform };
  }
  return { channelId: null, source: 'Not configured', creator, userId, platform };
}

function projectEffectiveAccounts(config) {
  const projected = {};
  const notificationMentionMode = ['role', 'everyone', 'here'].includes(config?.notificationMentionMode)
    ? config.notificationMentionMode
    : 'none';
  const notificationRoleId = notificationMentionMode === 'role'
    ? String(config?.notificationRoleId || '') || null
    : null;

  for (const [accountId, accountValue] of Object.entries(object(config?.accounts))) {
    const account = {
      ...accountValue,
      accountId,
      alertChannels: { ...object(accountValue?.alertChannels) },
      mentionMode: notificationMentionMode,
      mentionRoleId: notificationRoleId,
    };
    const creator = creatorFor(config, accountId);
    for (const eventType of ALERT_TYPES) {
      const resolved = resolveSocialRoute(config, account, eventType, creator);
      if (resolved.channelId) account.alertChannels[eventType] = resolved.channelId;
      else delete account.alertChannels[eventType];
    }
    projected[accountId] = account;
  }
  return projected;
}

module.exports = {
  projectEffectiveAccounts,
};
