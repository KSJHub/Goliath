'use strict';

const guildManager = require('../../../core/guild/guildManager');
const { projectEffectiveAccounts } = require('./socialStudioRoutingResolver');

function projectLiveRefreshState(account, history = []) {
  if (!account || typeof account !== 'object') return account;
  const state = account.state && typeof account.state === 'object' ? account.state : null;
  if (!state) return account;

  const hasDedicatedLiveMessage = state.isLive === true && Boolean(state.lastLiveMessageId && state.lastLiveMessageChannelId);
  const legacyLiveMessage = state.isLive === true && !hasDedicatedLiveMessage && state.lastAlertMessageId && state.lastAlertChannelId
    ? { lastLiveMessageId: state.lastAlertMessageId, lastLiveMessageChannelId: state.lastAlertChannelId }
    : {};
  const hasPersistedLiveMessage = hasDedicatedLiveMessage || Boolean(legacyLiveMessage.lastLiveMessageId && legacyLiveMessage.lastLiveMessageChannelId);
  const liveHistory = !hasPersistedLiveMessage
    ? [...(Array.isArray(history) ? history : [])].reverse().find((entry) => entry?.accountId && String(entry.accountId) === String(account.accountId) && (entry.status === 'alert_sent' || entry.status === 'alert_updated') && entry.alertType === 'live' && entry.messageId && entry.channelId)
    : null;
  const recoveredLiveMessage = state.isLive === true && liveHistory
    ? {
      lastAlertMessageId: liveHistory.messageId,
      lastAlertChannelId: liveHistory.channelId,
      lastLiveMessageId: liveHistory.messageId,
      lastLiveMessageChannelId: liveHistory.channelId,
      lastAlertKey: state.liveEventId ? `live:${state.liveEventId}` : state.lastAlertKey,
      lastLiveMessageUpdatedAt: liveHistory.createdAt || state.lastLiveMessageUpdatedAt,
    }
    : {};
  const effectiveState = { ...state, ...legacyLiveMessage, ...recoveredLiveMessage };
  const raw = effectiveState.lastLiveMessageUpdateAt || effectiveState.lastLiveMessageUpdatedAt;
  const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
  const hasTrackedLiveMessage = effectiveState.isLive === true && Boolean((effectiveState.lastLiveMessageId || effectiveState.lastAlertMessageId) && (effectiveState.lastLiveMessageChannelId || effectiveState.lastAlertChannelId));
  const alertTypes = Array.isArray(account.alertTypes)
    ? account.alertTypes.filter((type) => !(hasTrackedLiveMessage && String(type).toLowerCase() === 'ended'))
    : account.alertTypes;

  return {
    ...account,
    ...(Array.isArray(alertTypes) ? { alertTypes } : {}),
    state: {
      ...effectiveState,
      ...(Number.isFinite(parsed) && effectiveState.lastLiveMessageUpdateAt === raw ? { lastLiveMessageUpdateAt: new Date(parsed) } : {}),
      ...(Number.isFinite(parsed) && effectiveState.lastLiveMessageUpdatedAt === raw ? { lastLiveMessageUpdatedAt: new Date(parsed) } : {}),
    },
  };
}

function projectGuildConfig(guildConfig) {
  if (!guildConfig || typeof guildConfig !== 'object') return guildConfig;
  const modules = guildConfig.modules && typeof guildConfig.modules === 'object' ? guildConfig.modules : {};
  const social = modules.social && typeof modules.social === 'object' ? modules.social : null;
  if (!social) return guildConfig;
  const effectiveAccounts = projectEffectiveAccounts(social);
  const history = Array.isArray(social.history) ? social.history : [];
  const projectedAccounts = Object.fromEntries(Object.entries(effectiveAccounts && typeof effectiveAccounts === 'object' ? effectiveAccounts : {}).map(([accountId, account]) => [accountId, projectLiveRefreshState(account, history)]));
  return { ...guildConfig, modules: { ...modules, social: { ...social, accounts: projectedAccounts } } };
}

function projectedOptions(guildId, options = {}) {
  const sourceGuildConfig = options.guildConfig && typeof options.guildConfig === 'object' ? options.guildConfig : guildManager.reloadGuild(guildId);
  return { ...options, guildConfig: projectGuildConfig(sourceGuildConfig) };
}

module.exports = { projectLiveRefreshState, projectGuildConfig, projectedOptions };
