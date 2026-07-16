'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const socialStore = require('./socialStore');
const socialHistory = require('./socialHistory');
const socialManager = require('./socialManager');

function clean(value, fallback = '', max = 4096) { return String(value ?? fallback).trim().slice(0, max); }
function replaceVariables(value, variables) {
  return clean(value).replace(/\{([a-zA-Z]+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : match);
}
function variables(account, result) {
  return {
    creator: result.displayName || account.displayName || account.username || 'Creator',
    platform: account.platform || result.platform || 'Social',
    title: result.title || 'New content',
    game: result.gameName || '',
    category: result.gameName || '',
    viewers: Number(result.viewerCount || 0).toLocaleString('en-GB'),
    thumbnail: result.thumbnailUrl || '',
    streamUrl: result.url || '',
    videoUrl: result.url || '',
    uploadTime: result.publishedAt || result.createdAt || new Date().toISOString(),
    duration: result.duration || '',
  };
}
function buildEmbed(guildId, account, result) {
  const type = result.alertType || 'post';
  const template = socialStore.getSocialSection(guildId).templates?.[type] || {};
  const vars = variables(account, result);
  const embed = new EmbedBuilder()
    .setColor(Number(template.color || 0x5865f2))
    .setTitle(replaceVariables(template.title || '{creator} posted new content', vars).slice(0, 256))
    .setDescription(replaceVariables(template.description || '{title}', vars).slice(0, 4096))
    .setFooter({ text: clean(template.footer || 'Goliath Social Studio', 'Goliath Social Studio', 2048) })
    .setTimestamp(new Date(result.publishedAt || Date.now()));
  if (result.url) embed.setURL(result.url);
  const thumbnail = replaceVariables(template.thumbnail || result.thumbnailUrl || '', vars);
  const image = replaceVariables(template.image || result.thumbnailUrl || '', vars);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  return embed;
}
function mention(account) {
  if (account.mentionMode === 'everyone') return '@everyone';
  if (account.mentionMode === 'here') return '@here';
  return account.mentionRoleId ? `<@&${account.mentionRoleId}>` : '';
}
function enqueue(guildId, account, result, reason, error, meta) {
  return require('./socialQueue').enqueue(guildId, { accountId: account.accountId, platform: account.platform, alertType: result.alertType || 'post', contentId: result.contentId, providerResult: result, reason, lastError: error || null }, meta);
}
async function deliver(guildId, account, result, client, meta = {}) {
  if ((result.alertType || 'live') === 'live') return socialManager.sendLiveAlert(guildId, account, result, client, meta);
  const type = result.alertType || 'post';
  if (!result.contentId) return { success: false, skipped: true, reason: 'content_missing' };
  if (meta.bypassDuplicate !== true && account.lastSeen?.lastContentId === result.contentId) {
    socialHistory.record(guildId, { status: 'suppressed', eventType: 'duplicate', accountId: account.accountId, creator: account.displayName, platform: account.platform, alertType: type, contentId: result.contentId, title: result.title, reason: 'duplicate_content' }, meta);
    return { success: false, skipped: true, reason: 'duplicate_content' };
  }
  if (meta.bypassQueue !== true && socialManager.isQuietHours(guildId, account)) {
    const queued = enqueue(guildId, account, result, 'quiet_hours', null, meta);
    return { success: false, queued: true, queueId: queued.item.id, reason: queued.duplicate ? 'already_queued' : 'quiet_hours' };
  }
  const channelId = socialManager.routeChannelId(account, type);
  const discordClient = client || global.client || global.discordClient;
  const channel = channelId ? await discordClient?.channels?.fetch?.(channelId).catch(() => null) : null;
  if (!channel?.send) {
    if (meta.bypassQueue !== true) {
      const queued = enqueue(guildId, account, result, 'channel_unavailable', 'The routed Discord channel is unavailable.', meta);
      return { success: false, queued: true, queueId: queued.item.id };
    }
    return { success: false, error: 'The routed Discord channel is unavailable.' };
  }
  const content = mention(account);
  const components = result.url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(clean(socialStore.getSocialSection(guildId).templates?.[type]?.buttonLabel || 'View', 'View', 80)).setURL(result.url))] : [];
  try {
    const message = await channel.send({ content: content || undefined, embeds: [buildEmbed(guildId, account, result)], components, allowedMentions: { parse: ['@everyone', '@here'].includes(content) ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] } });
    socialManager.updateAccount(guildId, account.accountId, { externalId: result.externalId || account.externalId, lastSeen: { ...(account.lastSeen || {}), lastAlertAt: new Date().toISOString(), lastContentId: result.contentId, lastMessageId: message.id, lastChannelId: channel.id, lastTitle: result.title || '' } }, { action: 'social_content_alert_sent', ...meta });
    socialStore.incrementAnalytics(guildId, { alertsSent: 1, uploadAlerts: type === 'upload' || type === 'short' ? 1 : 0 }, { action: 'social_content_alert_analytics', ...meta });
    socialHistory.record(guildId, { status: 'sent', eventType: 'delivery', accountId: account.accountId, creator: account.displayName, platform: account.platform, alertType: type, contentId: result.contentId, title: result.title, channelId: channel.id, messageId: message.id }, meta);
    return { success: true, channelId: channel.id, messageId: message.id };
  } catch (error) {
    socialStore.incrementAnalytics(guildId, { errors: 1 }, { action: 'social_content_alert_error', ...meta });
    if (meta.bypassQueue !== true) {
      const queued = enqueue(guildId, account, result, 'discord_delivery_failed', error.message, meta);
      return { success: false, queued: true, queueId: queued.item.id, error: error.message };
    }
    return { success: false, error: error.message };
  }
}

module.exports = { buildEmbed, deliver };