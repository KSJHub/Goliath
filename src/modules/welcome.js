'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../core/guild/moduleSectionManager');
const { buildPreviewEmbed, TEMPLATES } = require('./embed/embedPanel');
const embedTemplateManager = require('./embed/embedTemplateManager');
const guildManager = require('../core/guild/guildManager');

const MODULE = 'welcome';

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
    publicSent: 0,
    publicFailed: 0,
    dmSent: 0,
    dmFailed: 0,
    skipped: 0,
    lastPublicSentAt: null,
    lastDmSentAt: null,
    lastFailedAt: null,
  };
}

function defaultWelcomeSection() {
  return {
    enabled: false,
    channelId: null,
    templateId: 'welcome_default',
    dmEnabled: false,
    dmTemplateId: 'dm_welcome_default',
    allowUserPing: true,
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
    publicSent: cleanCount(source.publicSent),
    publicFailed: cleanCount(source.publicFailed),
    dmSent: cleanCount(source.dmSent),
    dmFailed: cleanCount(source.dmFailed),
    skipped: cleanCount(source.skipped),
    lastPublicSentAt: cleanDate(source.lastPublicSentAt),
    lastDmSentAt: cleanDate(source.lastDmSentAt),
    lastFailedAt: cleanDate(source.lastFailedAt),
  };
}

function normalizeWelcomeSection(section = {}) {
  const base = defaultWelcomeSection();
  const source = section && typeof section === 'object' ? section : {};
  const channelId = cleanDiscordId(source.channelId || source.welcomeChannelId);

  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true || (source.enabled !== false && Boolean(channelId)),
    channelId,
    templateId: cleanString(source.templateId || base.templateId, base.templateId, 120),
    dmEnabled: source.dmEnabled === true || source.sendDm === true,
    dmTemplateId: cleanString(source.dmTemplateId || base.dmTemplateId, base.dmTemplateId, 120),
    allowUserPing: source.allowUserPing !== false,
    ignoreBots: source.ignoreBots !== false,
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getWelcomeSection(guildId) {
  return normalizeWelcomeSection(getModuleSection(guildId, MODULE, defaultWelcomeSection()));
}

function saveWelcomeSection(guildId, section, meta = {}) {
  return normalizeWelcomeSection(saveModuleSection(guildId, MODULE, normalizeWelcomeSection(section), meta));
}

function updateWelcomeSection(guildId, updater, meta = {}) {
  return normalizeWelcomeSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeWelcomeSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeWelcomeSection(next);
    },
    defaultWelcomeSection(),
    meta
  ));
}

function updateConfig(guildId, patch = {}, meta = {}) {
  return updateWelcomeSection(guildId, (section) => ({
    ...section,
    ...patch,
    channelId: patch.channelId === undefined ? section.channelId : cleanDiscordId(patch.channelId),
    templateId: patch.templateId === undefined ? section.templateId : cleanString(patch.templateId, section.templateId, 120),
    dmTemplateId: patch.dmTemplateId === undefined ? section.dmTemplateId : cleanString(patch.dmTemplateId, section.dmTemplateId, 120),
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : section.enabled,
    dmEnabled: typeof patch.dmEnabled === 'boolean' ? patch.dmEnabled : section.dmEnabled,
    allowUserPing: typeof patch.allowUserPing === 'boolean' ? patch.allowUserPing : section.allowUserPing,
    ignoreBots: typeof patch.ignoreBots === 'boolean' ? patch.ignoreBots : section.ignoreBots,
    updatedAt: now(),
  }), meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateWelcomeSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = { ...analytics };
    for (const key of ['publicSent', 'publicFailed', 'dmSent', 'dmFailed', 'skipped']) {
      next[key] = cleanCount(analytics[key] + cleanCount(increments[key]));
    }
    if (cleanCount(increments.publicSent) > 0) next.lastPublicSentAt = timestamp;
    if (cleanCount(increments.dmSent) > 0) next.lastDmSentAt = timestamp;
    if (cleanCount(increments.publicFailed) > 0 || cleanCount(increments.dmFailed) > 0) next.lastFailedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

function resetWelcomeSection(guildId, meta = {}) {
  return saveWelcomeSection(guildId, defaultWelcomeSection(), { action: 'welcome_reset', ...meta });
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
    joinedAt: formatTimestamp(member.joinedTimestamp, 'F'),
    timestamp: formatTimestamp(Date.now(), 'F'),
  };
}

function getLegacySection(guildId, type) {
  return guildManager.getGuildSection(guildId, type, null)
    || guildManager.getGuildSection(guildId, `${type}Settings`, null)
    || {};
}

function getRenderedTemplate(guildId, slot, variables, fallbackTemplateId) {
  return embedTemplateManager.renderBinding(guildId, MODULE, slot, variables, fallbackTemplateId);
}

function getWelcomeTemplates(guildId, templateType = 'welcome') {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter((template) => template && (template.templateType === templateType || template.module === MODULE))
    .sort((a, b) => String(a.name || a.templateId).localeCompare(String(b.name || b.templateId)));
}

function getWelcomeBinding(guildId, slot = 'welcome') {
  return embedTemplateManager.getBinding(guildId, MODULE, slot);
}

function bindWelcomeTemplate(guildId, templateId, slot = 'welcome', meta = {}) {
  const binding = embedTemplateManager.bindTemplate(guildId, MODULE, slot, templateId);
  const patch = slot === 'dm_welcome'
    ? { dmTemplateId: binding.templateId }
    : { templateId: binding.templateId };
  const config = updateConfig(guildId, patch, { action: 'welcome_template_bind', ...meta });
  return { binding, config };
}

function buildMessageData(member, type, config) {
  const guildId = member.guild.id;
  const isDm = type === 'dmWelcome';
  const legacy = getLegacySection(guildId, type);
  const templateId = isDm ? config.dmTemplateId : config.templateId;
  const slot = isDm ? 'dm_welcome' : 'welcome';
  const rendered = getRenderedTemplate(guildId, slot, buildTemplateVariables(member), templateId);

  return {
    ...(TEMPLATES[type] || {}),
    ...legacy,
    ...(rendered?.embed || {}),
    content: rendered?.content || legacy.content || legacy.message || '',
    embed: rendered?.embed || null,
    templateId: rendered?.templateId || templateId,
    templateName: rendered?.name || null,
    allowUserPing: isDm ? false : config.allowUserPing !== false,
  };
}

function buildDiscordPayload(member, type, config) {
  const messageData = buildMessageData(member, type, config);
  const fakeInteraction = { guild: member.guild, guildId: member.guild.id, user: member.user, member };
  const content = messageData.content || (messageData.allowUserPing ? `<@${member.user.id}>` : '');

  return {
    content,
    embeds: [buildPreviewEmbed(messageData, fakeInteraction)],
    allowedMentions: messageData.allowUserPing || content.includes(`<@${member.user.id}>`)
      ? { users: [member.user.id], roles: [], repliedUser: false }
      : { parse: [], repliedUser: false },
  };
}

async function resolveWelcomeChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function sendWelcome(member, options = {}) {
  if (!member?.guild?.id || !member?.user?.id) return { publicSent: false, dmSent: false, skipped: true };

  const config = getWelcomeSection(member.guild.id);
  if ((!options.force && config.enabled === false) || (config.ignoreBots && member.user.bot)) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { publicSent: false, dmSent: false, skipped: true, reason: config.enabled === false ? 'disabled' : 'ignored_bot' };
  }

  let publicSent = false;
  let dmSent = false;
  let publicFailed = false;
  let dmFailed = false;

  if (config.channelId) {
    const channel = await resolveWelcomeChannel(member.guild, config.channelId);
    if (channel) {
      try {
        await channel.send(buildDiscordPayload(member, 'welcome', config));
        publicSent = true;
      } catch (error) {
        publicFailed = true;
        if (!options.silent) console.error('[Welcome] Failed to send public welcome:', error);
      }
    } else {
      publicFailed = true;
    }
  }

  if (config.dmEnabled && options.skipDm !== true) {
    try {
      await member.send(buildDiscordPayload(member, 'dmWelcome', config));
      dmSent = true;
    } catch (error) {
      dmFailed = true;
      if (!options.silent) console.warn('[Welcome] Failed to send welcome DM:', error.message || error);
    }
  }

  if (!options.previewOnly) {
    incrementAnalytics(member.guild.id, {
      publicSent: publicSent ? 1 : 0,
      publicFailed: publicFailed ? 1 : 0,
      dmSent: dmSent ? 1 : 0,
      dmFailed: dmFailed ? 1 : 0,
      skipped: !publicSent && !dmSent && !publicFailed && !dmFailed ? 1 : 0,
    });
  }

  return { publicSent, dmSent, publicFailed, dmFailed, skipped: false };
}

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is required.');
  const config = getWelcomeSection(guild.id);
  const channel = config.channelId ? await resolveWelcomeChannel(guild, config.channelId) : null;
  const botMember = guild.members?.me || guild.members?.cache?.get(guild.client?.user?.id) || null;
  const permissions = channel && botMember ? channel.permissionsFor(botMember) : null;
  const canView = Boolean(permissions?.has(PermissionFlagsBits.ViewChannel));
  const canSend = Boolean(permissions?.has(PermissionFlagsBits.SendMessages));
  const canEmbed = Boolean(permissions?.has(PermissionFlagsBits.EmbedLinks));
  const boundTemplate = getWelcomeBinding(guild.id, 'welcome');
  const configuredTemplate = embedTemplateManager.getTemplate(guild.id, config.templateId);
  const activeTemplate = boundTemplate || configuredTemplate;

  const warnings = [
    config.enabled === false ? 'Welcome is disabled.' : null,
    config.enabled && !config.channelId && !config.dmEnabled ? 'No public welcome channel or DM welcome is configured.' : null,
    config.channelId && !channel ? `Configured welcome channel ${config.channelId} no longer exists or is not text-based.` : null,
    channel && !canView ? 'Goliath cannot view the welcome channel.' : null,
    channel && !canSend ? 'Goliath cannot send messages in the welcome channel.' : null,
    channel && !canEmbed ? 'Goliath cannot embed links in the welcome channel.' : null,
    !activeTemplate ? `Welcome template ${config.templateId} could not be found.` : null,
    !boundTemplate ? 'No Embed Studio template is explicitly bound to the Welcome slot; the configured fallback template will be used.' : null,
  ].filter(Boolean);

  return {
    enabled: config.enabled !== false,
    channelId: config.channelId,
    channelExists: Boolean(channel),
    channelName: channel?.name || null,
    dmEnabled: config.dmEnabled === true,
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
  const config = getWelcomeSection(guild.id);
  const channel = config.channelId ? await resolveWelcomeChannel(guild, config.channelId) : null;
  const template = getWelcomeBinding(guild.id, 'welcome') || embedTemplateManager.getTemplate(guild.id, config.templateId);
  return updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    templateId: template?.templateId || 'welcome_default',
    enabled: channel || config.dmEnabled ? config.enabled : false,
  }, { action: 'welcome_repair', ...meta });
}

function exportConfiguration(guildId) {
  return {
    exportedAt: now(),
    guildId,
    module: MODULE,
    config: getWelcomeSection(guildId),
    binding: getWelcomeBinding(guildId, 'welcome'),
  };
}

function resetWelcome(guildId, meta = {}) {
  return resetWelcomeSection(guildId, meta);
}

async function startupWelcome(client) {
  if (!client?.guilds?.cache) return { ok: false, guildsChecked: 0, warnings: 1, results: [] };

  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const config = getWelcomeSection(guild.id);
      const health = await buildHealthReport(guild);
      results.push({ guildId: guild.id, guildName: guild.name, enabled: config.enabled !== false, healthy: health.healthy, warnings: health.warnings });
    } catch (error) {
      results.push({ guildId: guild.id, guildName: guild.name, enabled: false, healthy: false, warnings: [error.message || 'Welcome startup check failed.'] });
    }
  }

  const summary = {
    ok: results.every((result) => result.healthy || result.enabled === false),
    guildsChecked: results.length,
    enabledGuilds: results.filter((result) => result.enabled).length,
    warnings: results.reduce((total, result) => total + result.warnings.length, 0),
    results,
  };

  console.log(`[Welcome] Startup check complete: ${summary.guildsChecked} guild(s), ${summary.enabledGuilds} enabled, ${summary.warnings} warning(s).`);
  for (const result of results) {
    if (result.warnings.length) console.warn(`[Welcome] ${result.guildName || result.guildId}: ${result.warnings.join(' | ')}`);
  }
  return summary;
}

module.exports = {
  MODULE,
  cleanDiscordId,
  defaultAnalytics,
  defaultWelcomeSection,
  normalizeAnalytics,
  normalizeWelcomeSection,
  getWelcomeSection,
  saveWelcomeSection,
  updateWelcomeSection,
  updateConfig,
  incrementAnalytics,
  resetWelcomeSection,
  formatTimestamp,
  buildTemplateVariables,
  getWelcomeTemplates,
  getWelcomeBinding,
  bindWelcomeTemplate,
  buildMessageData,
  buildDiscordPayload,
  resolveWelcomeChannel,
  sendWelcome,
  buildHealthReport,
  repairConfiguration,
  exportConfiguration,
  resetWelcome,
  startupWelcome,
};
