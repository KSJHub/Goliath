'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { buildPreviewEmbed, TEMPLATES } = require('../embed/embedPanel');
const embedTemplateManager = require('../embed/embedTemplateManager');
const guildManager = require('../../core/guild/guildManager');
const goodbyeStore = require('./goodbyeStore');

function formatTimestamp(timestamp, style = 'F') {
  return timestamp ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Unknown';
}

function getAvatar(member) {
  return member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || member?.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
}

function buildTemplateVariables(member) {
  const guild = member.guild;
  const leftAt = formatTimestamp(Date.now(), 'F');
  return {
    guild: guild.name,
    guildName: guild.name,
    server: guild.name,
    serverName: guild.name,
    guildId: guild.id,
    guildIcon: guild.iconURL?.({ extension: 'png', size: 256 }) || '',
    guildBanner: guild.bannerURL?.({ extension: 'png', size: 1024 }) || '',
    memberCount: guild.memberCount,
    user: String(member.user),
    userMention: `<@${member.user.id}>`,
    username: member.user.username || member.user.tag || member.user.id,
    userId: member.user.id,
    userAvatar: getAvatar(member),
    memberAvatar: getAvatar(member),
    createdAt: formatTimestamp(member.user.createdTimestamp, 'F'),
    joinedAt: member.joinedTimestamp ? formatTimestamp(member.joinedTimestamp, 'F') : 'Unknown',
    leftAt,
    timestamp: leftAt,
  };
}

function getLegacySection(guildId) {
  return guildManager.getGuildSection(guildId, 'leave', null)
    || guildManager.getGuildSection(guildId, 'leaveSettings', null)
    || {};
}

function getGoodbyeTemplates(guildId) {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter((template) => template && (
      template.templateType === 'goodbye'
      || template.templateType === 'leave'
      || template.module === 'goodbye'
    ))
    .sort((a, b) => String(a.name || a.templateId).localeCompare(String(b.name || b.templateId)));
}

function getGoodbyeBinding(guildId) {
  return embedTemplateManager.getBinding(guildId, 'goodbye', 'goodbye')
    || embedTemplateManager.getBinding(guildId, 'welcome', 'leave');
}

function bindGoodbyeTemplate(guildId, templateId, meta = {}) {
  const binding = embedTemplateManager.bindTemplate(guildId, 'goodbye', 'goodbye', templateId);
  const config = goodbyeStore.updateConfig(guildId, { templateId: binding.templateId }, { action: 'goodbye_template_bind', ...meta });
  return { binding, config };
}

function buildMessageData(member, config) {
  const guildId = member.guild.id;
  const legacy = getLegacySection(guildId);
  const rendered = embedTemplateManager.renderBinding(
    guildId,
    'goodbye',
    'goodbye',
    buildTemplateVariables(member),
    config.templateId
  ) || embedTemplateManager.renderBinding(
    guildId,
    'welcome',
    'leave',
    buildTemplateVariables(member),
    config.templateId
  );

  return {
    ...(TEMPLATES.leave || {}),
    ...legacy,
    ...(rendered?.embed || {}),
    content: rendered?.content || legacy.content || legacy.message || '',
    embed: rendered?.embed || null,
    templateId: rendered?.templateId || config.templateId,
    templateName: rendered?.name || null,
  };
}

function buildDiscordPayload(member, config) {
  const messageData = buildMessageData(member, config);
  const fakeInteraction = { guild: member.guild, guildId: member.guild.id, user: member.user, member };
  return {
    content: messageData.content || '',
    embeds: [buildPreviewEmbed(messageData, fakeInteraction)],
    allowedMentions: { parse: [], repliedUser: false },
  };
}

async function resolveGoodbyeChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function sendGoodbye(member, options = {}) {
  if (!member?.guild?.id || !member?.user?.id) return { sent: false, skipped: true };
  const config = goodbyeStore.getGoodbyeSection(member.guild.id);
  if ((!options.force && config.enabled === false) || (config.ignoreBots && member.user.bot)) {
    if (!options.previewOnly) goodbyeStore.incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, skipped: true, reason: config.enabled === false ? 'disabled' : 'ignored_bot' };
  }

  if (!config.channelId) {
    if (!options.previewOnly) goodbyeStore.incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, skipped: true, reason: 'no_channel' };
  }

  const channel = await resolveGoodbyeChannel(member.guild, config.channelId);
  if (!channel) {
    if (!options.previewOnly) goodbyeStore.incrementAnalytics(member.guild.id, { failed: 1 });
    return { sent: false, failed: true, skipped: false, reason: 'channel_unavailable' };
  }

  try {
    await channel.send(buildDiscordPayload(member, config));
    if (!options.previewOnly) goodbyeStore.incrementAnalytics(member.guild.id, { sent: 1 });
    return { sent: true, failed: false, skipped: false };
  } catch (error) {
    if (!options.previewOnly) goodbyeStore.incrementAnalytics(member.guild.id, { failed: 1 });
    if (!options.silent) console.error('[Goodbye] Failed to send public goodbye:', error);
    return { sent: false, failed: true, skipped: false, error: error.message || String(error) };
  }
}

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = goodbyeStore.getGoodbyeSection(guild.id);
  const channel = config.channelId ? await resolveGoodbyeChannel(guild, config.channelId) : null;
  const botMember = guild.members?.me || guild.members?.cache?.get(guild.client?.user?.id) || null;
  const permissions = channel && botMember ? channel.permissionsFor(botMember) : null;
  const canView = Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
  const canSend = Boolean(permissions?.has(PermissionFlagsBits.SendMessages));
  const canEmbed = Boolean(permissions?.has(PermissionFlagsBits.EmbedLinks));
  const boundTemplate = getGoodbyeBinding(guild.id);
  const configuredTemplate = embedTemplateManager.getTemplate(guild.id, config.templateId);
  const activeTemplate = boundTemplate || configuredTemplate;

  const warnings = [
    config.enabled === false ? 'Goodbye is disabled.' : null,
    config.enabled && !config.channelId ? 'No public goodbye channel is configured.' : null,
    config.channelId && !channel ? `Configured goodbye channel ${config.channelId} no longer exists or is not text-based.` : null,
    channel && !canView ? 'Goliath cannot view the goodbye channel.' : null,
    channel && !canSend ? 'Goliath cannot send messages in the goodbye channel.' : null,
    channel && !canEmbed ? 'Goliath cannot embed links in the goodbye channel.' : null,
    !activeTemplate ? `Goodbye template ${config.templateId} could not be found.` : null,
    !boundTemplate ? 'No Embed Studio template is explicitly bound to the Goodbye slot; the configured fallback template will be used.' : null,
  ].filter(Boolean);

  return {
    enabled: config.enabled !== false,
    channelId: config.channelId,
    channelExists: Boolean(channel),
    channelName: channel?.name || null,
    canView,
    canSend,
    canEmbed,
    templateId: activeTemplate?.templateId || config.templateId,
    templateName: activeTemplate?.name || null,
    templateBound: Boolean(boundTemplate),
    warnings,
    healthy: warnings.length === 0,
  };
}

async function repairConfiguration(guild, meta = {}) {
  const config = goodbyeStore.getGoodbyeSection(guild.id);
  const channel = config.channelId ? await resolveGoodbyeChannel(guild, config.channelId) : null;
  const template = getGoodbyeBinding(guild.id) || embedTemplateManager.getTemplate(guild.id, config.templateId);
  return goodbyeStore.updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    templateId: template?.templateId || 'goodbye_default',
    enabled: channel ? config.enabled : false,
  }, { action: 'goodbye_repair', ...meta });
}

function exportConfiguration(guildId) {
  return {
    exportedAt: new Date().toISOString(),
    guildId,
    module: 'goodbye',
    config: goodbyeStore.getGoodbyeSection(guildId),
    binding: getGoodbyeBinding(guildId),
  };
}

function resetGoodbye(guildId, meta = {}) {
  return goodbyeStore.resetGoodbyeSection(guildId, meta);
}

module.exports = {
  formatTimestamp,
  buildTemplateVariables,
  getGoodbyeTemplates,
  getGoodbyeBinding,
  bindGoodbyeTemplate,
  buildMessageData,
  buildDiscordPayload,
  resolveGoodbyeChannel,
  sendGoodbye,
  buildHealthReport,
  repairConfiguration,
  exportConfiguration,
  resetGoodbye,
};
