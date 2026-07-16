'use strict';

const { EmbedBuilder } = require('discord.js');
const socialStore = require('./socialStore');
const socialHistory = require('./socialHistory');

const PLATFORM_COLORS = {
  instagram: 0xe1306c,
  kick: 0x53fc18,
  tiktok: 0x010101,
  twitch: 0x9146ff,
  x: 0x111827,
  youtube: 0xff0000,
};

function getQueue() {
  return require('./socialQueue');
}

function getOverview(guildId) {
  const section = socialStore.getSocialSection(guildId);
  const accounts = Object.values(section.accounts || {});
  const enabledAccounts = accounts.filter((account) => account.enabled !== false);
  const platformCounts = accounts.reduce((counts, account) => {
    counts[account.platform] = (counts[account.platform] || 0) + 1;
    return counts;
  }, {});

  return {
    enabled: section.enabled !== false,
    accountCount: accounts.length,
    enabledAccountCount: enabledAccounts.length,
    platformCounts,
    analytics: section.analytics || {},
    history: socialHistory.summary(guildId),
    queue: getQueue().summary(guildId),
    settings: section.settings || {},
  };
}

function getConfig(guildId) {
  const section = socialStore.getSocialSection(guildId);
  return { ...section, accounts: Object.values(section.accounts || {}) };
}

function setEnabled(guildId, enabled, meta = {}) {
  return socialStore.updateSocialSection(guildId, (section) => ({ ...section, enabled: enabled === true, updatedAt: new Date().toISOString() }), meta);
}

function addAccount(guildId, account, meta = {}) { return socialStore.saveAccount(guildId, account, meta); }
function removeAccount(guildId, accountId, meta = {}) { return socialStore.removeAccount(guildId, accountId, meta); }

function updateAccount(guildId, accountId, updates = {}, meta = {}) {
  const existing = socialStore.getSocialSection(guildId).accounts[socialStore.cleanKey(accountId, 'account')];
  if (!existing) return null;
  return socialStore.saveAccount(guildId, { ...existing, ...updates, accountId: existing.accountId }, meta);
}

function formatPlatform(platform = 'social') {
  return ({ instagram: 'Instagram', kick: 'Kick', tiktok: 'TikTok', twitch: 'Twitch', x: 'X', youtube: 'YouTube' })[platform] || String(platform).toUpperCase();
}

function buildTestAlert(account = {}) {
  const platform = account.platform || 'social';
  const creator = account.displayName || account.username || 'Creator';
  const isLive = ['twitch', 'kick', 'tiktok'].includes(platform);
  return {
    platform,
    title: isLive ? `${creator} is now live` : `${creator} posted a new update`,
    description: isLive ? 'This is a test live notification from Goliath Social Alerts.' : 'This is a test content notification from Goliath Social Alerts.',
    url: account.metadata?.url || account.url || '',
    accountId: account.accountId,
    createdAt: new Date().toISOString(),
  };
}

function buildMention(account = {}) {
  if (account.mentionMode === 'everyone') return '@everyone';
  if (account.mentionMode === 'here') return '@here';
  if (account.mentionRoleId) return `<@&${account.mentionRoleId}>`;
  return '';
}

function buildTestEmbed(account = {}, alert = {}) {
  const platform = account.platform || alert.platform || 'social';
  const creator = account.displayName || account.username || 'Creator';
  const alertTypes = Array.isArray(account.alertTypes) && account.alertTypes.length ? account.alertTypes.join(', ') : 'test';
  return new EmbedBuilder()
    .setColor(PLATFORM_COLORS[platform] || 0x5865f2)
    .setTitle(`🧪 ${alert.title || `${creator} test alert`}`)
    .setDescription(alert.description || 'This is a test notification from Goliath Social Alerts.')
    .addFields(
      { name: 'Creator', value: creator, inline: true },
      { name: 'Platform', value: formatPlatform(platform), inline: true },
      { name: 'Alert Types', value: alertTypes, inline: true },
      { name: 'Username / Channel ID', value: account.username || account.externalId || 'Not set', inline: false }
    )
    .setFooter({ text: 'Goliath Social Alerts • Test Notification' })
    .setTimestamp(new Date());
}

function buildLiveEmbed(account = {}, providerResult = {}) {
  const platform = account.platform || providerResult.platform || 'social';
  const creator = providerResult.displayName || account.displayName || account.username || 'Creator';
  const embed = new EmbedBuilder()
    .setColor(PLATFORM_COLORS[platform] || 0x5865f2)
    .setTitle(`🔴 ${creator} is now live on ${formatPlatform(platform)}`)
    .setDescription(providerResult.title || 'A creator you follow is now live.')
    .addFields(
      { name: 'Creator', value: creator, inline: true },
      { name: 'Platform', value: formatPlatform(platform), inline: true }
    )
    .setFooter({ text: 'Goliath Social Alerts • Live Notification' })
    .setTimestamp(new Date());

  if (providerResult.gameName) embed.addFields({ name: 'Category', value: providerResult.gameName, inline: true });
  if (providerResult.viewerCount) embed.addFields({ name: 'Viewers', value: String(providerResult.viewerCount), inline: true });
  if (providerResult.url) embed.setURL(providerResult.url);
  if (providerResult.thumbnailUrl) embed.setImage(String(providerResult.thumbnailUrl).replace('{width}', '1280').replace('{height}', '720'));
  return embed;
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function routeChannelId(account = {}, alertType = 'live') {
  const routing = account.metadata?.routing && typeof account.metadata.routing === 'object' ? account.metadata.routing : {};
  return cleanDiscordId(routing[alertType] || routing[`${alertType}ChannelId`] || account.alertChannelId);
}

async function fetchAlertChannel(account = {}, client, alertType = 'live') {
  const channelId = routeChannelId(account, alertType);
  if (!channelId) return { channel: null, error: `Choose a ${alertType} alert channel before sending this alert.` };
  const discordClient = client || global.client || global.discordClient;
  if (!discordClient?.channels?.fetch) return { channel: null, error: 'Discord client is unavailable.' };
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) return { channel: null, error: 'Could not find a sendable alert channel.' };
  return { channel, error: null };
}

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || fallback));
  if (!match) return parseClock(fallback, '00:00');
  return Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
}

function timeInZone(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function quietHoursConfig(guildId, account = {}) {
  const globalConfig = getConfig(guildId).settings?.quietHours || {};
  const accountConfig = account.metadata?.quietHours && typeof account.metadata.quietHours === 'object'
    ? account.metadata.quietHours
    : {};
  return { ...globalConfig, ...accountConfig };
}

function isQuietHours(guildId, account = {}, date = new Date()) {
  const quiet = quietHoursConfig(guildId, account);
  if (quiet.enabled !== true) return false;
  const start = parseClock(quiet.start, '00:00');
  const end = parseClock(quiet.end, '08:00');
  if (start === end) return true;
  const current = timeInZone(date, quiet.timezone || 'UTC');
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function shouldQueueFailures(guildId) {
  return getConfig(guildId).settings?.retryDeliveries !== false;
}

function historyBase(account = {}, extra = {}) {
  return {
    accountId: account.accountId || null,
    creator: account.displayName || account.username || null,
    platform: account.platform || null,
    alertType: extra.alertType || 'live',
    contentId: extra.contentId || null,
    title: extra.title || null,
    providerStatus: extra.providerStatus || null,
  };
}

function enqueueDelivery(guildId, account, providerResult, reason, error, meta = {}) {
  const result = getQueue().enqueue(guildId, {
    accountId: account.accountId,
    platform: account.platform,
    alertType: providerResult.alertType || 'live',
    contentId: providerResult.contentId,
    providerResult,
    reason,
    lastError: error || null,
  }, meta);
  if (result.duplicate) {
    socialHistory.record(guildId, {
      ...historyBase(account, { contentId: providerResult.contentId, title: providerResult.title }),
      status: 'suppressed', eventType: 'queue', reason: 'already_queued', metadata: { queueId: result.item.id },
    }, meta);
  }
  return result;
}

async function sendTestAlert(guildId, accountId, client, meta = {}) {
  const account = getConfig(guildId).accounts.find((item) => item.accountId === accountId || item.id === accountId);
  if (!account) return { success: false, status: 404, error: 'Social account not found.' };
  if (account.enabled === false) {
    socialHistory.record(guildId, { ...historyBase(account), status: 'skipped', eventType: 'test', isTest: true, reason: 'account_disabled' }, meta);
    return { success: false, status: 400, error: 'Enable this social account before sending a test alert.' };
  }

  const { channel, error } = await fetchAlertChannel(account, client, 'live');
  if (!channel) {
    socialHistory.record(guildId, { ...historyBase(account), status: 'failed', eventType: 'test', isTest: true, error }, meta);
    return { success: false, status: 400, error };
  }

  const alert = buildTestAlert(account);
  const mention = buildMention(account);
  try {
    const message = await channel.send({
      content: mention || undefined,
      embeds: [buildTestEmbed(account, alert)],
      allowedMentions: { parse: mention === '@everyone' || mention === '@here' ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] },
    });
    updateAccount(guildId, account.accountId, { lastSeen: { ...(account.lastSeen || {}), lastAlertAt: new Date().toISOString(), lastTestMessageId: message.id, lastTestChannelId: channel.id } }, { action: 'social_test_alert_sent', ...meta });
    socialStore.incrementAnalytics(guildId, { alertsSent: 1 }, { action: 'social_test_alert_analytics', ...meta });
    socialHistory.record(guildId, { ...historyBase(account, { title: alert.title }), status: 'test', eventType: 'test', isTest: true, channelId: channel.id, messageId: message.id }, meta);
    return { success: true, alert, channelId: channel.id, messageId: message.id };
  } catch (sendError) {
    socialStore.incrementAnalytics(guildId, { errors: 1 }, { action: 'social_test_alert_error', ...meta });
    socialHistory.record(guildId, { ...historyBase(account, { title: alert.title }), status: 'failed', eventType: 'test', isTest: true, channelId: channel.id, error: sendError.message }, meta);
    return { success: false, status: 500, error: sendError.message };
  }
}

async function sendLiveAlert(guildId, account = {}, providerResult = {}, client, meta = {}) {
  const base = historyBase(account, { alertType: 'live', contentId: providerResult.contentId, title: providerResult.title, providerStatus: providerResult.providerStatus || providerResult.status });
  if (!providerResult?.isLive || !providerResult.contentId) {
    socialHistory.record(guildId, { ...base, status: 'skipped', eventType: 'provider', reason: 'not_live' }, meta);
    return { success: false, skipped: true, reason: 'not_live' };
  }
  if (meta.bypassDuplicate !== true && account.lastSeen?.lastContentId === providerResult.contentId) {
    socialHistory.record(guildId, { ...base, status: 'suppressed', eventType: 'duplicate', reason: 'duplicate_content' }, meta);
    return { success: false, skipped: true, reason: 'duplicate_content' };
  }

  if (meta.bypassQueue !== true && isQuietHours(guildId, account)) {
    const queued = enqueueDelivery(guildId, account, providerResult, 'quiet_hours', null, meta);
    return { success: false, queued: true, queueId: queued.item.id, reason: queued.duplicate ? 'already_queued' : 'quiet_hours' };
  }

  const { channel, error } = await fetchAlertChannel(account, client, 'live');
  if (!channel) {
    if (meta.bypassQueue !== true && shouldQueueFailures(guildId)) {
      const queued = enqueueDelivery(guildId, account, providerResult, 'channel_unavailable', error, meta);
      return { success: false, queued: true, queueId: queued.item.id, error };
    }
    socialHistory.record(guildId, { ...base, status: 'failed', eventType: 'delivery', error }, meta);
    return { success: false, skipped: false, error };
  }

  const mention = buildMention(account);
  try {
    const message = await channel.send({
      content: mention || undefined,
      embeds: [buildLiveEmbed(account, providerResult)],
      allowedMentions: { parse: mention === '@everyone' || mention === '@here' ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] },
    });
    updateAccount(guildId, account.accountId, {
      externalId: providerResult.externalId || account.externalId,
      displayName: account.displayName || providerResult.displayName,
      lastSeen: { ...(account.lastSeen || {}), lastAlertAt: new Date().toISOString(), lastContentId: providerResult.contentId, lastMessageId: message.id, lastChannelId: channel.id, lastLiveTitle: providerResult.title || '' },
    }, { action: 'social_live_alert_sent', ...meta });
    socialStore.incrementAnalytics(guildId, { alertsSent: 1, liveAlerts: 1 }, { action: 'social_live_alert_analytics', ...meta });
    socialHistory.record(guildId, { ...base, status: 'sent', eventType: 'delivery', channelId: channel.id, messageId: message.id }, meta);
    return { success: true, channelId: channel.id, messageId: message.id };
  } catch (sendError) {
    socialStore.incrementAnalytics(guildId, { errors: 1 }, { action: 'social_live_alert_error', ...meta });
    if (meta.bypassQueue !== true && shouldQueueFailures(guildId)) {
      const queued = enqueueDelivery(guildId, account, providerResult, 'discord_delivery_failed', sendError.message, meta);
      return { success: false, queued: true, queueId: queued.item.id, error: sendError.message };
    }
    socialHistory.record(guildId, { ...base, status: 'failed', eventType: 'delivery', channelId: channel.id, error: sendError.message }, meta);
    return { success: false, skipped: false, error: sendError.message };
  }
}

function deliverQueuedAlert(guildId, account, providerResult, client, meta = {}) {
  return sendLiveAlert(guildId, account, providerResult, client, {
    ...meta,
    bypassQueue: true,
    bypassDuplicate: true,
    action: meta.action || 'social_queue_delivery',
  });
}

module.exports = {
  getOverview,
  getConfig,
  setEnabled,
  addAccount,
  removeAccount,
  updateAccount,
  buildTestAlert,
  buildTestEmbed,
  buildLiveEmbed,
  routeChannelId,
  isQuietHours,
  sendTestAlert,
  sendLiveAlert,
  deliverQueuedAlert,
};