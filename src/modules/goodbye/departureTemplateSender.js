'use strict';

const { EmbedBuilder } = require('discord.js');
const guildManager = require('../../core/guild/guildManager');
const embedTemplateManager = require('../embed/embedTemplateManager');
const goodbyeManager = require('./goodbye');

const DEPARTURE_DETAILS = Object.freeze({
  left: {
    icon: '👋',
    label: 'Left Voluntarily',
    defaultReason: 'No reason — the member left voluntarily.',
    moderatorFallback: 'Not applicable',
  },
  kicked: {
    icon: '👢',
    label: 'Kicked',
    defaultReason: 'No reason provided.',
    moderatorFallback: 'Unknown moderator',
  },
  banned: {
    icon: '🔨',
    label: 'Banned',
    defaultReason: 'No reason provided.',
    moderatorFallback: 'Unknown moderator',
  },
  pruned: {
    icon: '🧹',
    label: 'Pruned / Removed',
    defaultReason: 'Member removed during a server prune.',
    moderatorFallback: 'System',
  },
});

function formatDuration(startTimestamp, endTimestamp = Date.now()) {
  if (!startTimestamp || !Number.isFinite(Number(startTimestamp))) return 'Unknown';

  let seconds = Math.max(0, Math.floor((Number(endTimestamp) - Number(startTimestamp)) / 1000));
  const units = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60],
  ];
  const parts = [];

  for (const [label, size] of units) {
    const value = Math.floor(seconds / size);
    if (!value) continue;
    parts.push(`${value} ${label}${value === 1 ? '' : 's'}`);
    seconds -= value * size;
    if (parts.length === 2) break;
  }

  return parts.length ? parts.join(', ') : 'Less than a minute';
}

function formatModerator(user, fallback) {
  if (!user) return fallback;
  const name = user.tag || user.username || user.id;
  return `${user} \`${name}\``;
}

function buildDepartureVariables(member, removal = {}) {
  const type = DEPARTURE_DETAILS[removal.key] ? removal.key : 'left';
  const details = DEPARTURE_DETAILS[type];
  const auditLog = removal.auditLog || null;
  const moderator = auditLog?.executor || null;
  const departedAt = Date.now();

  return {
    userDisplay: member.displayName || member.user.globalName || member.user.username || member.user.id,
    membershipDuration: formatDuration(member.joinedTimestamp, departedAt),
    accountAge: formatDuration(member.user.createdTimestamp, departedAt),
    departureType: type,
    departureLabel: details.label,
    departureIcon: details.icon,
    departureReason: String(auditLog?.reason || removal.reasonLabel || details.defaultReason).slice(0, 1024),
    departureModerator: formatModerator(moderator, details.moderatorFallback),
    departureModeratorId: moderator?.id || 'Not applicable',
  };
}

function stripIconFromText(value, iconUrl) {
  const text = String(value || '').trim();
  if (!text || !iconUrl || !text.includes(iconUrl)) return { text, usedIcon: false };

  const cleaned = text
    .split(iconUrl).join('')
    .replace(/^\s*[•|·—–-]+\s*/, '')
    .replace(/\s*[•|·—–-]+\s*$/, '')
    .trim();

  return { text: cleaned, usedIcon: true };
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveDepartureTemplate(guildId, config = goodbyeManager.getGoodbyeSection(guildId)) {
  const binding = goodbyeManager.getGoodbyeBinding(guildId);
  if (binding) return binding;

  for (const templateKey of ['leave', 'goodbye']) {
    const activePreset = guildManager.getEmbedDefaultPreset?.(guildId, templateKey);
    if (!activePreset) continue;

    try {
      return embedTemplateManager.normalizeTemplate(
        embedTemplateManager.legacyPresetToTemplate(`active_${templateKey}`, activePreset)
      );
    } catch (error) {
      console.warn(`[Goodbye] Active ${templateKey} preset could not be converted:`, error.message || error);
    }
  }

  return goodbyeManager.getAssignedTemplate(guildId, config);
}

function normalizeRenderedPanel(panel = {}, guildIconUrl = '') {
  const author = panel.author && typeof panel.author === 'object' ? panel.author : {};
  const footer = panel.footer && typeof panel.footer === 'object' ? panel.footer : {};

  const rawAuthorName = panel.authorName ?? author.name ?? '';
  const rawFooterText = typeof panel.footer === 'string' ? panel.footer : footer.text || '';
  const authorResult = stripIconFromText(rawAuthorName, guildIconUrl);
  const footerResult = stripIconFromText(rawFooterText, guildIconUrl);

  return {
    title: String(panel.title || '').slice(0, 256),
    description: String(panel.description || '').slice(0, 4096),
    color: panel.color || '#ED4245',
    authorName: authorResult.text.slice(0, 256),
    authorIcon: panel.authorIcon || author.iconURL || (authorResult.usedIcon ? guildIconUrl : ''),
    authorUrl: panel.authorUrl || author.url || '',
    thumbnail: panel.thumbnail || panel.thumbnailURL || '',
    image: panel.image || panel.imageURL || '',
    footer: footerResult.text.slice(0, 2048),
    footerIcon: panel.footerIcon || footer.iconURL || (footerResult.usedIcon ? guildIconUrl : ''),
    fields: Array.isArray(panel.fields) ? panel.fields.slice(0, 25) : [],
  };
}

function buildDiscordEmbed(panel = {}, options = {}) {
  const normalized = normalizeRenderedPanel(panel, options.guildIconUrl || '');
  const embed = new EmbedBuilder().setColor(normalized.color || '#ED4245');

  if (normalized.title) embed.setTitle(normalized.title);
  if (normalized.description) embed.setDescription(normalized.description);

  if (normalized.authorName || isHttpUrl(normalized.authorIcon)) {
    embed.setAuthor({
      name: normalized.authorName || options.guildName || 'Member Departure',
      ...(isHttpUrl(normalized.authorIcon) ? { iconURL: normalized.authorIcon } : {}),
      ...(isHttpUrl(normalized.authorUrl) ? { url: normalized.authorUrl } : {}),
    });
  }

  if (normalized.footer || isHttpUrl(normalized.footerIcon)) {
    embed.setFooter({
      text: normalized.footer || 'Member Logs',
      ...(isHttpUrl(normalized.footerIcon) ? { iconURL: normalized.footerIcon } : {}),
    });
  }

  if (isHttpUrl(normalized.thumbnail)) embed.setThumbnail(normalized.thumbnail);
  if (isHttpUrl(normalized.image)) embed.setImage(normalized.image);

  const fields = normalized.fields
    .filter((field) => field?.name && field?.value)
    .map((field) => ({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: field.inline === true,
    }));
  if (fields.length) embed.addFields(fields);

  if (options.showTimestamp !== false) embed.setTimestamp();
  return embed;
}

function buildDiscordEmbeds(rendered = {}, variables = {}) {
  const panels = Array.isArray(rendered.panels) && rendered.panels.length
    ? rendered.panels
    : [rendered.embed || {}];

  return panels.slice(0, 10).map((panel) => buildDiscordEmbed(panel, {
    guildIconUrl: variables.guildIcon || '',
    guildName: variables.guildName || variables.guild || 'Member Departure',
    showTimestamp: rendered.showTimestamp !== false,
  }));
}

async function sendDeparture(member, removal = {}, options = {}) {
  const config = goodbyeManager.getGoodbyeSection(member.guild.id);
  if (!options.force && config.enabled === false) return goodbyeManager.sendGoodbye(member, options);
  if (config.ignoreBots && member.user.bot) return goodbyeManager.sendGoodbye(member, options);
  if (!config.channelId) return goodbyeManager.sendGoodbye(member, options);

  const channel = await goodbyeManager.resolveGoodbyeChannel(member.guild, config.channelId);
  if (!channel) return goodbyeManager.sendGoodbye(member, options);

  const template = resolveDepartureTemplate(member.guild.id, config);
  if (!template) return goodbyeManager.sendGoodbye(member, options);

  try {
    const baseVariables = await goodbyeManager.buildTemplateVariables(member, config);
    const variables = { ...baseVariables, ...buildDepartureVariables(member, removal) };
    const rendered = embedTemplateManager.renderTemplate(template, variables);
    const embeds = buildDiscordEmbeds(rendered, variables);

    await channel.send({
      content: rendered.content || '',
      embeds,
      allowedMentions: { parse: [], repliedUser: false },
    });

    if (!options.previewOnly) goodbyeManager.incrementAnalytics(member.guild.id, { sent: 1 });
    return { sent: true, failed: false, skipped: false, channelId: channel.id, templateId: template.templateId, errors: [] };
  } catch (error) {
    if (!options.previewOnly) goodbyeManager.incrementAnalytics(member.guild.id, { failed: 1 });
    if (!options.silent) console.error('[Goodbye] Failed to send dynamic departure template:', error);
    return { sent: false, failed: true, skipped: false, error: error.message || String(error), errors: [error.message || String(error)] };
  }
}

module.exports = {
  DEPARTURE_DETAILS,
  formatDuration,
  buildDepartureVariables,
  stripIconFromText,
  resolveDepartureTemplate,
  normalizeRenderedPanel,
  buildDiscordEmbed,
  buildDiscordEmbeds,
  sendDeparture,
};
