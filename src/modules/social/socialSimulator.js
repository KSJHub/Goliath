'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const socialStore = require('./socialStore');
const socialHistory = require('./socialHistory');
const socialManager = require('./socialManager');

const ALERT_TYPES = new Set(['live', 'upload', 'short', 'post']);
const SAMPLE = Object.freeze({
  live: { title: 'Example live stream', description: 'A simulated live alert from Social Studio.', url: 'https://example.com/live', gameName: 'Gaming', viewerCount: 1234 },
  upload: { title: 'Example new video', description: 'A simulated upload alert from Social Studio.', url: 'https://example.com/video', duration: '12:34' },
  short: { title: 'Example short-form video', description: 'A simulated short alert from Social Studio.', url: 'https://example.com/short', duration: '0:42' },
  post: { title: 'Example social update', description: 'A simulated post alert from Social Studio.', url: 'https://example.com/post' },
});

function clean(value, fallback = '', max = 1000) { return String(value ?? fallback).trim().slice(0, max); }
function alertType(value) { const type = clean(value, 'live', 20).toLowerCase(); return ALERT_TYPES.has(type) ? type : 'live'; }
function replaceVariables(value, variables) {
  return clean(value, '', 4096).replace(/\{([a-zA-Z]+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : match);
}
function variablesFor(account, type, sample) {
  return {
    creator: account.displayName || account.username || 'Creator',
    platform: account.platform || 'Social',
    title: sample.title,
    game: sample.gameName || 'Gaming',
    category: sample.gameName || 'Community',
    viewers: Number(sample.viewerCount || 0).toLocaleString('en-GB'),
    thumbnail: sample.thumbnailUrl || '',
    streamUrl: sample.url || '',
    videoUrl: sample.url || '',
    uploadTime: new Date().toISOString(),
    duration: sample.duration || '',
    alertType: type,
  };
}
function build(guildId, account, requestedType = 'live', overrides = {}) {
  const type = alertType(requestedType);
  const config = socialStore.getSocialSection(guildId);
  const template = config.templates?.[type] || {};
  const sample = { ...SAMPLE[type], ...(overrides && typeof overrides === 'object' ? overrides : {}) };
  const variables = variablesFor(account, type, sample);
  const title = replaceVariables(template.title || `{creator} ${type === 'live' ? 'is now live' : 'posted new content'}`, variables).slice(0, 256);
  const description = replaceVariables(template.description || '{title}', variables).slice(0, 4096);
  const embed = new EmbedBuilder()
    .setColor(Number(template.color || 0x5865f2))
    .setTitle(title || `${variables.creator} alert`)
    .setDescription(description || sample.description)
    .addFields(
      { name: 'Creator', value: variables.creator, inline: true },
      { name: 'Platform', value: variables.platform, inline: true },
      { name: 'Simulation', value: type, inline: true },
    )
    .setFooter({ text: clean(template.footer || 'Goliath Social Studio • Simulation', 'Goliath Social Studio • Simulation', 2048) })
    .setTimestamp();
  if (template.thumbnail || sample.thumbnailUrl) embed.setThumbnail(replaceVariables(template.thumbnail || sample.thumbnailUrl, variables));
  if (template.image) embed.setImage(replaceVariables(template.image, variables));
  const buttonLabel = clean(template.buttonLabel || 'View', 'View', 80);
  const components = sample.url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(buttonLabel).setURL(sample.url))] : [];
  return { type, sample, variables, embed, components, channelId: socialManager.routeChannelId(account, type), quietHours: socialManager.isQuietHours(guildId, account) };
}
function mention(account = {}) {
  if (account.mentionMode === 'everyone') return '@everyone';
  if (account.mentionMode === 'here') return '@here';
  if (account.mentionRoleId) return `<@&${account.mentionRoleId}>`;
  return '';
}
async function simulate(guildId, accountId, requestedType, client, options = {}, meta = {}) {
  const account = Object.values(socialStore.getSocialSection(guildId).accounts || {}).find((item) => item.accountId === accountId || item.id === accountId);
  if (!account) return { success: false, status: 404, error: 'Social account not found.' };
  const preview = build(guildId, account, requestedType, options.overrides || {});
  const response = { success: true, preview: { alertType: preview.type, channelId: preview.channelId, quietHours: preview.quietHours, title: preview.embed.data.title, description: preview.embed.data.description, variables: preview.variables } };
  if (options.send !== true) return response;
  if (preview.quietHours && options.force !== true) return { ...response, success: false, status: 409, blocked: true, error: 'Quiet hours are active. Use force to send this simulation now.' };
  if (!preview.channelId) return { ...response, success: false, status: 400, error: `No ${preview.type} destination is configured for this creator.` };
  const discordClient = client || global.client || global.discordClient;
  const channel = await discordClient?.channels?.fetch?.(preview.channelId).catch(() => null);
  if (!channel?.send) return { ...response, success: false, status: 400, error: 'The routed Discord channel is unavailable.' };
  const content = mention(account);
  try {
    const message = await channel.send({
      content: content || undefined,
      embeds: [preview.embed],
      components: preview.components,
      allowedMentions: { parse: content === '@everyone' || content === '@here' ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] },
    });
    socialHistory.record(guildId, { status: 'test', eventType: 'simulation', alertType: preview.type, accountId: account.accountId, creator: account.displayName || account.username, platform: account.platform, channelId: channel.id, messageId: message.id, title: preview.embed.data.title, isTest: true, metadata: { forced: options.force === true } }, meta);
    return { ...response, sent: true, channelId: channel.id, messageId: message.id };
  } catch (error) {
    socialHistory.record(guildId, { status: 'failed', eventType: 'simulation', alertType: preview.type, accountId: account.accountId, creator: account.displayName || account.username, platform: account.platform, channelId: channel.id, title: preview.embed.data.title, error: error.message, isTest: true }, meta);
    return { ...response, success: false, status: 500, error: error.message };
  }
}

module.exports = { ALERT_TYPES, SAMPLE, build, simulate };
