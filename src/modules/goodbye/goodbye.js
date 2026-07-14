'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');
const { buildPreviewEmbed, TEMPLATES } = require('../embed/embedPanel');
const embedTemplateManager = require('../embed/embedTemplateManager');
const guildManager = require('../../core/guild/guildManager');

const MODULE = 'goodbye';

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanString(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultAnalytics() {
  return {
    sent: 0,
    failed: 0,
    skipped: 0,
    lastSentAt: null,
    lastFailedAt: null,
  };
}

function defaultGoodbyeSection() {
  return {
    enabled: false,
    channelId: null,
    templateId: 'goodbye_default',
    ignoreBots: true,
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAnalytics(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...defaultAnalytics(),
    ...clone(source),
    sent: cleanCount(source.sent),
    failed: cleanCount(source.failed),
    skipped: cleanCount(source.skipped),
    lastSentAt: cleanDate(source.lastSentAt),
    lastFailedAt: cleanDate(source.lastFailedAt),
  };
}

function normalizeGoodbyeSection(section = {}) {
  const base = defaultGoodbyeSection();
  const source = section && typeof section === 'object' ? section : {};
  const channelId = cleanDiscordId(source.channelId || source.leaveChannelId || source.goodbyeChannelId);
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true || (source.enabled !== false && Boolean(channelId)),
    channelId,
    templateId: cleanString(source.templateId || base.templateId, base.templateId, 120),
    ignoreBots: source.ignoreBots !== false,
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getGoodbyeSection(guildId) {
  return normalizeGoodbyeSection(getModuleSection(guildId, MODULE, defaultGoodbyeSection()));
}

function saveGoodbyeSection(guildId, section, meta = {}) {
  return normalizeGoodbyeSection(saveModuleSection(guildId, MODULE, normalizeGoodbyeSection(section), meta));
}

function updateGoodbyeSection(guildId, updater, meta = {}) {
  return normalizeGoodbyeSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeGoodbyeSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeGoodbyeSection(next);
    },
    defaultGoodbyeSection(),
    meta
  ));
}

function updateConfig(guildId, patch = {}, meta = {}) {
  return updateGoodbyeSection(guildId, (section) => ({
    ...section,
    ...patch,
    channelId: patch.channelId === undefined ? section.channelId : cleanDiscordId(patch.channelId),
    templateId: patch.templateId === undefined ? section.templateId : cleanString(patch.templateId, section.templateId, 120),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : section.enabled,
    ignoreBots: typeof patch.ignoreBots === 'boolean' ? patch.ignoreBots : section.ignoreBots,
    updatedAt: now(),
  }), meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateGoodbyeSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = { ...analytics };
    for (const key of ['sent', 'failed', 'skipped']) {
      next[key] = cleanCount(analytics[key] + cleanCount(increments[key]));
    }
    if (cleanCount(increments.sent) > 0) next.lastSentAt = timestamp;
    if (cleanCount(increments.failed) > 0) next.lastFailedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

function resetGoodbyeSection(guildId, meta = {}) {
  return saveGoodbyeSection(guildId, defaultGoodbyeSection(), { action: 'goodbye_reset', ...meta });
}

function formatTimestamp(timestamp, style = 'F') {
  return timestamp ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Unknown';
}

function getAvatar(member) {
  return member?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || member?.user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || '';
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
      template.templateType === MODULE
      || template.templateType === 'leave'
      || template.module === MODULE
    ))
    .sort((a, b) => String(a.name || a.templateId).localeCompare(String(b.name || b.templateId)));
}

function getGoodbyeBinding(guildId) {
  return embedTemplateManager.getBinding(guildId, MODULE, MODULE)
    || embedTemplateManager.getBinding(guildId, 'welcome', 'leave');
}

function bindGoodbyeTemplate(guildId, templateId, meta = {}) {
  const binding = embedTemplateManager.bindTemplate(guildId, MODULE, MODULE, templateId);
  const config = updateConfig(guildId, { templateId: binding.templateId }, { action: 'goodbye_template_bind', ...meta });
  return { binding, config };
}

function buildMessageData(member, config) {
  const guildId = member.guild.id;
  const legacy = getLegacySection(guildId);
  const variables = buildTemplateVariables(member);
  const rendered = embedTemplateManager.renderBinding(guildId, MODULE, MODULE, variables, config.templateId)
    || embedTemplateManager.renderBinding(guildId, 'welcome', 'leave', variables, config.templateId);

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
  const config = getGoodbyeSection(member.guild.id);
  if ((!options.force && config.enabled === false) || (config.ignoreBots && member.user.bot)) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, skipped: true, reason: config.enabled === false ? 'disabled' : 'ignored_bot' };
  }

  if (!config.channelId) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, skipped: true, reason: 'no_channel' };
  }

  const channel = await resolveGoodbyeChannel(member.guild, config.channelId);
  if (!channel) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { failed: 1 });
    return { sent: false, failed: true, skipped: false, reason: 'channel_unavailable' };
  }

  try {
    await channel.send(buildDiscordPayload(member, config));
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { sent: 1 });
    return { sent: true, failed: false, skipped: false };
  } catch (error) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { failed: 1 });
    if (!options.silent) console.error('[Goodbye] Failed to send public goodbye:', error);
    return { sent: false, failed: true, skipped: false, error: error.message || String(error) };
  }
}

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = getGoodbyeSection(guild.id);
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
  const config = getGoodbyeSection(guild.id);
  const channel = config.channelId ? await resolveGoodbyeChannel(guild, config.channelId) : null;
  const template = getGoodbyeBinding(guild.id) || embedTemplateManager.getTemplate(guild.id, config.templateId);
  return updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    templateId: template?.templateId || 'goodbye_default',
    enabled: channel ? config.enabled : false,
  }, { action: 'goodbye_repair', ...meta });
}

function exportConfiguration(guildId) {
  return {
    exportedAt: now(),
    guildId,
    module: MODULE,
    config: getGoodbyeSection(guildId),
    binding: getGoodbyeBinding(guildId),
  };
}

function resetGoodbye(guildId, meta = {}) {
  return resetGoodbyeSection(guildId, meta);
}

async function startupGoodbye(client) {
  if (!client?.guilds?.cache) return { ok: false, guildsChecked: 0, warnings: 1, results: [] };
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const config = getGoodbyeSection(guild.id);
      const health = await buildHealthReport(guild);
      results.push({ guildId: guild.id, guildName: guild.name, enabled: config.enabled !== false, healthy: health.healthy, warnings: health.warnings });
    } catch (error) {
      results.push({ guildId: guild.id, guildName: guild.name, enabled: false, healthy: false, warnings: [error.message || 'Goodbye startup check failed.'] });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[Goodbye] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.warnings} warning(s).`);
  for (const result of results) {
    if (result.warnings.length) console.warn(`[Goodbye] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }
  return summary;
}

module.exports = {
  MODULE,
  cleanDiscordId,
  defaultAnalytics,
  defaultGoodbyeSection,
  normalizeAnalytics,
  normalizeGoodbyeSection,
  getGoodbyeSection,
  saveGoodbyeSection,
  updateGoodbyeSection,
  updateConfig,
  incrementAnalytics,
  resetGoodbyeSection,
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
  startupGoodbye,
};
