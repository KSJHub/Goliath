'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');
const { buildPreviewEmbeds } = require('../embed/embedPanel');
const embedTemplateManager = require('../embed/embedTemplateManager');

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
    dmTemplateId: null,
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
    dmTemplateId: source.dmTemplateId ? cleanString(source.dmTemplateId, '', 120) : null,
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
    dmTemplateId: patch.dmTemplateId === undefined
      ? section.dmTemplateId
      : (patch.dmTemplateId ? cleanString(patch.dmTemplateId, '', 120) : null),
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

function getMemberCount(guild, ignoreBots = true) {
  if (!ignoreBots) return Math.max(0, Number(guild?.memberCount || 0));
  const cache = guild?.members?.cache;
  if (cache?.size) return cache.filter((member) => !member.user?.bot).size;
  return Math.max(0, Number(guild?.memberCount || 0) - 1);
}

async function refreshMemberCache(guild, ignoreBots) {
  if (!ignoreBots || !guild?.members?.fetch) return;
  try {
    await guild.members.fetch();
  } catch (error) {
    console.warn('[Welcome] Could not refresh member cache for human-only count:', error.message || error);
  }
}

function buildTemplateVariables(member, config = getWelcomeSection(member.guild.id)) {
  const guild = member.guild;
  const memberCount = getMemberCount(guild, config.ignoreBots);
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
    user: String(member.user),
    userMention: `<@${member.user.id}>`,
    userNoPing: `<@${member.user.id}>`,
    username: member.user.username || member.user.tag || member.user.id,
    userDisplay: member.displayName || member.user.globalName || member.user.username || member.user.id,
    userId: member.user.id,
    userAvatar: getAvatar(member),
    memberAvatar: getAvatar(member),
    createdAt: formatTimestamp(member.user.createdTimestamp, 'F'),
    joinedAt: formatTimestamp(member.joinedTimestamp, 'F'),
    timestamp: formatTimestamp(Date.now(), 'F'),
  };
}

function getWelcomeTemplates(guildId) {
  return Object.values(embedTemplateManager.listTemplates(guildId))
    .filter(Boolean)
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

function getAssignedTemplate(guildId, type, config = getWelcomeSection(guildId)) {
  const isDm = type === 'dmWelcome';
  const slot = isDm ? 'dm_welcome' : 'welcome';
  const configuredId = isDm ? config.dmTemplateId : config.templateId;
  return getWelcomeBinding(guildId, slot)
    || (configuredId ? embedTemplateManager.getTemplate(guildId, configuredId) : null)
    || (isDm ? getWelcomeBinding(guildId, 'welcome') : null)
    || (isDm ? embedTemplateManager.getTemplate(guildId, config.templateId) : null);
}

function renderGuildForCount(guild, count) {
  return new Proxy(guild, {
    get(target, property, receiver) {
      if (property === 'memberCount') return count;
      return Reflect.get(target, property, receiver);
    },
  });
}

function templateToPreviewState(template = {}) {
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
  };
}

function buildDiscordPayload(member, type, config = getWelcomeSection(member.guild.id), options = {}) {
  const isDm = type === 'dmWelcome';
  const template = getAssignedTemplate(member.guild.id, type, config);
  if (!template) throw new Error(`No ${isDm ? 'DM welcome' : 'welcome'} template is assigned.`);

  const count = getMemberCount(member.guild, config.ignoreBots);
  const renderInteraction = {
    guild: renderGuildForCount(member.guild, count),
    guildId: member.guild.id,
    user: member.user,
    member,
  };
  const state = templateToPreviewState(template);
  state.allowUserPing = !isDm && config.allowUserPing !== false;

  let content = String(template.content || '').trim();
  const mention = `<@${member.user.id}>`;
  if (!isDm && config.allowUserPing !== false && !content.includes(mention)) {
    content = content ? `${mention}\n${content}` : mention;
  }

  return {
    content,
    embeds: buildPreviewEmbeds(state, renderInteraction),
    components: options.includeComponents === false ? [] : undefined,
    allowedMentions: !isDm && config.allowUserPing !== false
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
  if (!member?.guild?.id || !member?.user?.id) {
    return { publicSent: false, dmSent: false, skipped: true, reason: 'invalid_member' };
  }

  const config = getWelcomeSection(member.guild.id);
  if (!options.force && config.enabled === false) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { publicSent: false, dmSent: false, skipped: true, reason: 'disabled' };
  }
  if (config.ignoreBots && member.user.bot) {
    if (!options.previewOnly) incrementAnalytics(member.guild.id, { skipped: 1 });
    return { publicSent: false, dmSent: false, skipped: true, reason: 'ignored_bot' };
  }

  await refreshMemberCache(member.guild, config.ignoreBots);

  let publicSent = false;
  let dmSent = false;
  let publicFailed = false;
  let dmFailed = false;
  const errors = [];

  if (config.channelId && options.skipPublic !== true) {
    const channel = await resolveWelcomeChannel(member.guild, config.channelId);
    if (!channel) {
      publicFailed = true;
      errors.push('Welcome channel is unavailable.');
    } else {
      try {
        await channel.send(buildDiscordPayload(member, 'welcome', config));
        publicSent = true;
      } catch (error) {
        publicFailed = true;
        errors.push(`Public welcome failed: ${error.message || error}`);
        if (!options.silent) console.error('[Welcome] Failed to send public welcome:', error);
      }
    }
  }

  if (config.dmEnabled && options.skipDm !== true) {
    try {
      await member.send(buildDiscordPayload(member, 'dmWelcome', config, { includeComponents: false }));
      dmSent = true;
    } catch (error) {
      dmFailed = true;
      errors.push(`Welcome DM failed: ${error.message || error}`);
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

  return { publicSent, dmSent, publicFailed, dmFailed, skipped: false, errors };
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
  const publicTemplate = getAssignedTemplate(guild.id, 'welcome', config);
  const dmTemplate = config.dmEnabled ? getAssignedTemplate(guild.id, 'dmWelcome', config) : null;
  const warnings = [
    config.enabled === false ? 'Welcome is disabled.' : null,
    config.enabled && !config.channelId && !config.dmEnabled ? 'No public welcome channel or welcome DM is configured.' : null,
    config.channelId && !channel ? `Configured welcome channel ${config.channelId} no longer exists or is not text-based.` : null,
    channel && !canView ? 'Goliath cannot view the welcome channel.' : null,
    channel && !canSend ? 'Goliath cannot send messages in the welcome channel.' : null,
    channel && !canEmbed ? 'Goliath cannot embed links in the welcome channel.' : null,
    config.channelId && !publicTemplate ? `Welcome template ${config.templateId} could not be found.` : null,
    config.dmEnabled && !dmTemplate ? 'Welcome DM is enabled, but no usable template is assigned.' : null,
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
    templateId: publicTemplate?.templateId || config.templateId,
    templateName: publicTemplate?.name || null,
    templateBound: Boolean(getWelcomeBinding(guild.id, 'welcome')),
    dmTemplateId: dmTemplate?.templateId || config.dmTemplateId || config.templateId,
    countMode: config.ignoreBots ? 'humans_only' : 'all_members',
    warnings,
    healthy: warnings.length === 0,
  };
}

async function repairConfiguration(guild, meta = {}) {
  const config = getWelcomeSection(guild.id);
  const channel = config.channelId ? await resolveWelcomeChannel(guild, config.channelId) : null;
  const publicTemplate = getAssignedTemplate(guild.id, 'welcome', config);
  return updateConfig(guild.id, {
    channelId: channel ? config.channelId : null,
    templateId: publicTemplate?.templateId || config.templateId,
    dmTemplateId: config.dmTemplateId && embedTemplateManager.getTemplate(guild.id, config.dmTemplateId)
      ? config.dmTemplateId
      : null,
    enabled: Boolean(channel || config.dmEnabled) && config.enabled,
  }, { action: 'welcome_repair', ...meta });
}

function exportConfiguration(guildId) {
  return {
    exportedAt: now(),
    guildId,
    module: MODULE,
    config: getWelcomeSection(guildId),
    publicBinding: getWelcomeBinding(guildId, 'welcome'),
    dmBinding: getWelcomeBinding(guildId, 'dm_welcome'),
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
  getMemberCount,
  buildTemplateVariables,
  getWelcomeTemplates,
  getWelcomeBinding,
  bindWelcomeTemplate,
  getAssignedTemplate,
  templateToPreviewState,
  buildDiscordPayload,
  resolveWelcomeChannel,
  sendWelcome,
  buildHealthReport,
  repairConfiguration,
  exportConfiguration,
  resetWelcome,
  startupWelcome,
};