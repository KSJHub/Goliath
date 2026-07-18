'use strict';

const { buildPreviewEmbeds } = require('../embed/embedPanel');
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
  const leftAt = Date.now();

  return {
    userDisplay: member.displayName || member.user.globalName || member.user.username || member.user.id,
    membershipDuration: formatDuration(member.joinedTimestamp, leftAt),
    accountAge: formatDuration(member.user.createdTimestamp, leftAt),
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
    .replace(iconUrl, '')
    .replace(/^\s*[•|·—–-]+\s*/, '')
    .replace(/\s*[•|·—–-]+\s*$/, '')
    .trim();

  return { text: cleaned, usedIcon: true };
}

function toPreviewPanel(panel = {}, guildIconUrl = '') {
  const author = panel.author && typeof panel.author === 'object' ? panel.author : {};
  const footer = panel.footer && typeof panel.footer === 'object' ? panel.footer : {};

  const rawAuthorName = panel.authorName ?? author.name ?? '';
  const rawFooterText = typeof panel.footer === 'string' ? panel.footer : footer.text || '';
  const authorResult = stripIconFromText(rawAuthorName, guildIconUrl);
  const footerResult = stripIconFromText(rawFooterText, guildIconUrl);

  return {
    title: panel.title || '',
    description: panel.description || '',
    color: panel.color || '#ED4245',
    authorName: authorResult.text,
    authorIcon: panel.authorIcon || author.iconURL || (authorResult.usedIcon ? guildIconUrl : ''),
    authorUrl: panel.authorUrl || author.url || '',
    thumbnail: panel.thumbnail || panel.thumbnailURL || '',
    image: panel.image || panel.imageURL || '',
    footer: footerResult.text,
    footerIcon: panel.footerIcon || footer.iconURL || (footerResult.usedIcon ? guildIconUrl : ''),
    fields: Array.isArray(panel.fields) ? panel.fields : [],
  };
}

function buildPreviewState(rendered, guildIconUrl = '') {
  const sourcePanels = Array.isArray(rendered.panels) && rendered.panels.length
    ? rendered.panels
    : [rendered.embed || {}];

  return {
    ...rendered,
    panels: sourcePanels.map((panel) => toPreviewPanel(panel, guildIconUrl)),
    selectedPanelIndex: 0,
    buttons: Array.isArray(rendered.buttons) ? rendered.buttons : (rendered.embed?.buttons || []),
    showTimestamp: rendered.showTimestamp !== false,
    fieldLayout: rendered.fieldLayout || 'auto',
    allowUserPing: false,
  };
}

async function sendDeparture(member, removal = {}, options = {}) {
  const config = goodbyeManager.getGoodbyeSection(member.guild.id);
  if (!options.force && config.enabled === false) return goodbyeManager.sendGoodbye(member, options);
  if (config.ignoreBots && member.user.bot) return goodbyeManager.sendGoodbye(member, options);
  if (!config.channelId) return goodbyeManager.sendGoodbye(member, options);

  const channel = await goodbyeManager.resolveGoodbyeChannel(member.guild, config.channelId);
  if (!channel) return goodbyeManager.sendGoodbye(member, options);

  const template = goodbyeManager.getAssignedTemplate(member.guild.id, config);
  if (!template) return goodbyeManager.sendGoodbye(member, options);

  try {
    const baseVariables = await goodbyeManager.buildTemplateVariables(member, config);
    const variables = { ...baseVariables, ...buildDepartureVariables(member, removal) };
    const rendered = embedTemplateManager.renderTemplate(template, variables);
    const state = buildPreviewState(rendered, variables.guildIcon || '');
    const fakeInteraction = {
      guild: member.guild,
      guildId: member.guild.id,
      user: member.user,
      member,
    };

    await channel.send({
      content: rendered.content || '',
      embeds: buildPreviewEmbeds(state, fakeInteraction),
      allowedMentions: { parse: [], repliedUser: false },
    });
    if (!options.previewOnly) goodbyeManager.incrementAnalytics(member.guild.id, { sent: 1 });
    return { sent: true, failed: false, skipped: false, channelId: channel.id, errors: [] };
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
  toPreviewPanel,
  buildPreviewState,
  sendDeparture,
};
