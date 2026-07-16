'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');
const { buildPreviewEmbeds } = require('../embed/embedPanel');
const embedTemplateManager = require('../embed/embedTemplateManager');

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

async function refreshMemberCache(guild) {
  if (!guild?.members?.fetch) return;
  try {
    await guild.members.fetch();
  } catch (error) {
    console.warn('[Goodbye] Could not refresh member cache:', error.message || error);
  }
}

async function memberCountFor(guild, ignoreBots) {
  await refreshMemberCache(guild);
  if (!ignoreBots) return Math.max(0, Number(guild?.memberCount || 0));
  const cache = guild?.members?.cache;
  if (cache?.size) return cache.filter((member) => !member.user?.bot).size;
  return Math.max(0, Number(guild?.memberCount || 0) - 1);
}

async function buildTemplateVariables(member, config = getGoodbyeSection(member.guild.id)) {
  const guild = member.guild;
  const leftAt = formatTimestamp(Date.now(), 'F');
  const memberCount = await memberCountFor(guild, config.ignoreBots);
  return {
    guild: guild.name,
    guildName: guild.name,
    server: guild.name,
    serverName: guild.name,
    guildId: guild.id,
    guildIcon: guild.iconURL?.({ extension: 'png', size: 256 }) || '',
    guildBanner: guild.bannerURL?.({ extension: 'png', size: 1024 }) || '',
    memberCount,
    guildMemberCount: memberCount,
    totalMemberCount: Math.max(0, Number(guild?.memberCount || 0)),
    user: String(member.user),
    userMention: `<@${member.user.id}>`,
    userNoPing: `@${member.user.username || member.user.id}`,
    username: member.user.username || member.user.tag || member.user.id,
    userDisplay: member.displayName || member.user.globalName || member.user.username || member.user.id,
    userId: member.user.id,
    userAvatar: getAvatar(member),
    memberAvatar: getAvatar(member),
    createdAt: formatTimestamp(member.user.createdTimestamp, 'F'),
    joinedAt: member.joinedTimestamp ? formatTimestamp(member.joinedTimestamp, 'F') : 'Unknown',
    leftAt,
    timestamp: leftAt,
  };
}

function getGoodbyeTemplates(guildId) {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter(Boolean)
    .sort((a, b) => {
      const aGoodbye = a.templateType === 'goodbye' || a.templateType === 'leave' || a.module === MODULE ? 0 : 1;
      const bGoodbye = b.templateType === 'goodbye' || b.templateType === 'leave' || b.module === MODULE ? 0 : 1;
      return aGoodbye - bGoodbye || String(a.name || a.templateId).localeCompare(String(b.name || b.templateId));
    });
}

function getGoodbyeBinding(guildId) {
  return embedTemplateManager.getBinding(guildId, MODULE, MODULE);
}

function getAssignedTemplate(guildId, config = getGoodbyeSection(guildId)) {
  return getGoodbyeBinding(guildId)
    || embedTemplateManager.getTemplate(guildId, config.templateId);
}

function bindGoodbyeTemplate(guildId, templateId, meta = {}) {
  const template = embedTemplateManager.getTemplate(guildId, templateId);
  if (!template) throw new Error('Template not found in Embed Studio.');
  const binding = embedTemplateManager.bindTemplate(guildId, MODULE, MODULE, templateId);
  const config = updateConfig(guildId, { templateId: binding.templateId }, { action: 'goodbye_template_bind', ...meta });
  return { binding, config };
}

function templatePreviewState(template = {}) {
  const panels = Array.isArray(template.panels) && template.panels.length
    ? clone(template.panels)
    : [{
      title: template.embed?.title || '',
      description: template.embed?.description || '',
      color: template.embed?.color || '#5865F2',
      authorName: template.embed?.author?.name || '',
      authorIcon: template.embed?.author?.iconURL || '',
      authorUrl: template.embed?.author?.url || '',
      thumbnail: template.embed?.thumbnailURL || '',
      image: template.embed?.imageURL || '',
      footer: template.embed?.footer?.text || '',
      footerIcon: template.embed?.footer?.iconURL || '',
      fields: Array.isArray(template.embed?.fields) ? clone(template.embed.fields) : [],
    }];
  return {
    ...clone(template),
    panels,
    selectedPanelIndex: 0,
    buttons: Array.isArray(template.buttons) ? clone(template.buttons) : clone(template.embed?.buttons || []),
    showTimestamp: template.showTimestamp !== false,
    fieldLayout: template.fieldLayout || 'auto',
    allowUserPing: false,
  };
}

function renderGuildForCount(guild, count) {
  return new Proxy(guild, {
    get(target, property, receiver) {
      if (property === 'memberCount') return count;
      return Reflect.get(target, property, receiver);
    },
  });
}

async function buildDiscordPayload(member, config = getGoodbyeSection(member.guild.id), options = {}) {
  const template = getAssignedTemplate(member.guild.id, config);
  if (!template) throw new Error(`Goodbye template ${config.templateId} could not be found.`);

  const variables = await buildTemplateVariables(member, config);
  const rendered = embedTemplateManager.renderTemplate(template, variables);
  const state = templatePreviewState(rendered);
  const fakeInteraction = {
    guild: renderGuildForCount(member.guild, variables.memberCount),
    guildId: member.guild.id,
    user: member.user,
    member,
  };

  return {
    content: rendered.content || '',
    embeds: buildPreviewEmbeds(state, fakeInteraction),
    components: options.includeComponents === false ? [] : undefined,
    allowedMentions: { parse: [], repliedUser: false },
  };
}

async function buildMessageData(member, config = getGoodbyeSection(member.guild.id)) {
  const payload = await buildDiscordPayload(member, config);
  return { ...payload, templateId: config.templateId };
}

async function resolveGoodbyeChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function sendGoodbye(member, options = {}) {
  if (!member?.guild?.id || !member?.user?.id) {
    return { sent: false, failed: false, skipped: true, reason: 'invalid_member', errors: [] };
  }

  const config = getGoodbyeSection(member.guild.id);
  if (!options.force && config.enabled === false) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, failed: false, skipped: true, reason: 'disabled', errors: [] };
  }
  if (config.ignoreBots && member.user.bot) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, failed: false, skipped: true, reason: 'ignored_bot', errors: [] };
  }
  if (!config.channelId) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { sent: false, failed: false, skipped: true, reason: 'no_channel', errors: [] };
  }

  const channel = await resolveGoodbyeChannel(member.guild, config.channelId);
  if (!channel) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { failed: 1 });
    return { sent: false, failed: true, skipped: false, reason: 'channel_unavailable', errors: ['Goodbye channel is unavailable.'] };
  }

  try {
    await channel.send(await buildDiscordPayload(member, config));
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { sent: 1 });
    return { sent: true, failed: false, skipped: false, channelId: channel.id, errors: [] };
  } catch (error) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { failed: 1 });
    if (!options.silent) console.error('[Goodbye] Failed to send public goodbye:', error);
    return { sent: false, failed: true, skipped: false, error: error.message || String(error), errors: [error.message || String(error)] };
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
  const binding = getGoodbyeBinding(guild.id);
  const activeTemplate = getAssignedTemplate(guild.id, config);
  const warnings = [
    config.enabled === false ? 'Goodbye is disabled.' : null,
    config.enabled && !config.channelId ? 'No goodbye channel is configured.' : null,
    config.channelId && !channel ? `Configured goodbye channel ${config.channelId} no longer exists or is not text-based.` : null,
    channel && !canView ? 'Goliath cannot view the goodbye channel.' : null,
    channel && !canSend ? 'Goliath cannot send messages in the goodbye channel.' : null,
    channel && !canEmbed ? 'Goliath cannot embed links in the goodbye channel.' : null,
    !activeTemplate ? `Goodbye template ${config.templateId} could not be found.` : null,
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
    templateBound: Boolean(binding),
    countMode: config.ignoreBots ? 'humans_only' : 'all_members',
    warnings,
    healthy: warnings.length === 0,
  };
}

async function repairConfiguration(guild, meta = {}) {
  const config = getGoodbyeSection(guild.id);
  const channel = config.channelId ? await resolveGoodbyeChannel(guild, config.channelId) : null;
  const template = getAssignedTemplate(guild.id, config);
  return updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    templateId: template?.templateId || 'goodbye_default',
    enabled: Boolean(channel) && config.enabled,
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
  memberCountFor,
  buildTemplateVariables,
  getGoodbyeTemplates,
  getGoodbyeBinding,
  getAssignedTemplate,
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
