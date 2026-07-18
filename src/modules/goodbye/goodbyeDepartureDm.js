'use strict';

const { EmbedBuilder } = require('discord.js');
const goodbye = require('./goodbye');
const { formatDuration } = require('./departureTemplateSender');

const DEFAULT_DEPARTURE_DM = Object.freeze({
  enabled: false,
  sendOnLeave: true,
  sendOnKick: true,
  sendOnBan: true,
  sendOnPrune: false,
  includeJoinDate: true,
  includeMembershipDuration: true,
  includeReason: true,
  includeModerator: true,
  includeAppealLink: false,
  includeReferenceId: false,
  appealLink: '',
  analytics: {
    sent: 0,
    failed: 0,
    skipped: 0,
    lastSentAt: null,
    lastFailedAt: null,
  },
});

const EVENT_DETAILS = Object.freeze({
  left: { icon: '👋', label: 'Left Voluntarily', colour: '#5865F2' },
  kicked: { icon: '👢', label: 'Kicked', colour: '#FAA61A' },
  banned: { icon: '🔨', label: 'Banned', colour: '#ED4245' },
  pruned: { icon: '🧹', label: 'Removed During Server Prune', colour: '#FEE75C' },
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeAnalytics(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...clone(DEFAULT_DEPARTURE_DM.analytics),
    ...clone(source),
    sent: cleanCount(source.sent),
    failed: cleanCount(source.failed),
    skipped: cleanCount(source.skipped),
    lastSentAt: source.lastSentAt || null,
    lastFailedAt: source.lastFailedAt || null,
  };
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...clone(DEFAULT_DEPARTURE_DM),
    ...clone(source),
    enabled: source.enabled === true,
    sendOnLeave: source.sendOnLeave !== false,
    sendOnKick: source.sendOnKick !== false,
    sendOnBan: source.sendOnBan !== false,
    sendOnPrune: source.sendOnPrune === true,
    includeJoinDate: source.includeJoinDate !== false,
    includeMembershipDuration: source.includeMembershipDuration !== false,
    includeReason: source.includeReason !== false,
    includeModerator: source.includeModerator !== false,
    includeAppealLink: source.includeAppealLink === true,
    includeReferenceId: source.includeReferenceId === true,
    appealLink: String(source.appealLink || '').trim().slice(0, 1000),
    analytics: normalizeAnalytics(source.analytics),
  };
}

function getConfig(guildId) {
  return normalizeConfig(goodbye.getGoodbyeSection(guildId).departureDm);
}

function updateConfig(guildId, patch = {}, meta = {}) {
  const section = goodbye.updateGoodbyeSection(guildId, (current) => ({
    ...current,
    departureDm: normalizeConfig({ ...current.departureDm, ...patch }),
    updatedAt: new Date().toISOString(),
  }), { action: 'goodbye_departure_dm_update', ...meta });
  return normalizeConfig(section.departureDm);
}

function resetConfig(guildId, meta = {}) {
  return updateConfig(guildId, clone(DEFAULT_DEPARTURE_DM), {
    action: 'goodbye_departure_dm_reset',
    ...meta,
  });
}

function eventEnabled(config, eventKey) {
  return ({
    left: config.sendOnLeave,
    kicked: config.sendOnKick,
    banned: config.sendOnBan,
    pruned: config.sendOnPrune,
  })[eventKey] === true;
}

function moderatorText(user) {
  if (!user?.id) return 'N/A';
  return `${user.globalName || user.username || 'Moderator'} (${user.id})`;
}

function referenceId(removal = {}) {
  return removal.referenceId || removal.auditLog?.id || null;
}

function buildDmEmbed(member, removal = {}, suppliedConfig = null) {
  const config = normalizeConfig(suppliedConfig || getConfig(member.guild.id));
  const eventKey = EVENT_DETAILS[removal.key] ? removal.key : 'left';
  const details = EVENT_DETAILS[eventKey];
  const auditLog = removal.auditLog || null;
  const reason = String(auditLog?.reason || (eventKey === 'pruned' ? 'Server prune' : 'No reason provided')).slice(0, 1024);
  const moderator = moderatorText(auditLog?.executor);
  const joined = member.joinedTimestamp
    ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
    : 'Unknown';
  const duration = formatDuration(member.joinedTimestamp, Date.now());
  const ref = referenceId(removal);

  const account = [
    `**Username:** ${member.user.username || member.user.id}`,
    `**Display:** ${member.displayName || member.user.globalName || member.user.username || member.user.id}`,
  ].join('\n');

  const timeline = [];
  if (config.includeJoinDate) timeline.push(`**Joined:** ${joined}`);
  if (config.includeMembershipDuration) timeline.push(`**Time in Community:** ${duration}`);

  const event = [`**Type:** ${details.icon} ${details.label}`];
  if (['kicked', 'banned'].includes(eventKey) && config.includeReason) event.push(`**Reason:** ${reason}`);
  if (['kicked', 'banned'].includes(eventKey) && config.includeModerator) event.push(`**Moderator:** ${moderator}`);
  if (eventKey === 'banned' && config.includeAppealLink && config.appealLink) event.push(`**Appeal:** ${config.appealLink}`);
  if (eventKey === 'banned' && config.includeReferenceId && ref) event.push(`**Reference:** ${ref}`);

  const intro = eventKey === 'left'
    ? `You've now left **${member.guild.name}**.\n\nThank you for being part of our community. We appreciate the time you spent with us and wish you all the best moving forward.`
    : eventKey === 'pruned'
      ? `Your membership of **${member.guild.name}** ended during a server prune.`
      : `Your membership of **${member.guild.name}** has ended.`;

  const closing = eventKey === 'left'
    ? `We'd love to see you again someday.\n\nTake care, and thank you for being part of **${member.guild.name}**. 💙`
    : 'Please review the information above. Contact the server management team if you need further assistance.';

  const embed = new EmbedBuilder()
    .setColor(details.colour)
    .setAuthor({
      name: member.guild.name,
      ...(member.guild.iconURL?.({ extension: 'png', size: 256 }) ? { iconURL: member.guild.iconURL({ extension: 'png', size: 256 }) } : {}),
    })
    .setTitle(`${details.icon} Member Departure`)
    .setDescription(`${intro}\n\n━━━━━━━━━━━━━━━━━━`)
    .addFields(
      { name: '👤 YOUR ACCOUNT', value: account, inline: false },
      ...(timeline.length ? [{ name: '📅 YOUR TIME HERE', value: timeline.join('\n'), inline: false }] : []),
      { name: '📋 DEPARTURE', value: event.join('\n'), inline: false },
      { name: '\u200b', value: `━━━━━━━━━━━━━━━━━━\n\n${closing}`, inline: false },
    )
    .setFooter({ text: `The ${member.guild.name} Team` })
    .setTimestamp();

  const avatar = member.displayAvatarURL?.({ extension: 'png', size: 256 })
    || member.user.displayAvatarURL?.({ extension: 'png', size: 256 });
  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

function updateAnalytics(guildId, key) {
  const config = getConfig(guildId);
  const analytics = normalizeAnalytics(config.analytics);
  analytics[key] = cleanCount(analytics[key]) + 1;
  if (key === 'sent') analytics.lastSentAt = new Date().toISOString();
  if (key === 'failed') analytics.lastFailedAt = new Date().toISOString();
  updateConfig(guildId, { analytics }, { action: `goodbye_departure_dm_${key}` });
}

async function sendDepartureDm(member, removal = {}, options = {}) {
  if (!member?.guild?.id || !member?.user?.id || member.user.bot) {
    return { sent: false, failed: false, skipped: true, reason: 'invalid_or_bot_member' };
  }

  const config = getConfig(member.guild.id);
  const eventKey = EVENT_DETAILS[removal.key] ? removal.key : 'left';
  if (!options.force && (!config.enabled || !eventEnabled(config, eventKey))) {
    if (!options.previewOnly) updateAnalytics(member.guild.id, 'skipped');
    return { sent: false, failed: false, skipped: true, reason: config.enabled ? `${eventKey}_disabled` : 'disabled' };
  }

  try {
    const embed = buildDmEmbed(member, removal, config);
    if (!options.previewOnly) await member.send({ embeds: [embed], allowedMentions: { parse: [] } });
    if (!options.previewOnly) updateAnalytics(member.guild.id, 'sent');
    return { sent: true, failed: false, skipped: false, preview: options.previewOnly === true, embed };
  } catch (error) {
    if (!options.previewOnly) updateAnalytics(member.guild.id, 'failed');
    if (!options.silent) console.warn('[Goodbye] Departure DM could not be delivered:', error.message || error);
    return { sent: false, failed: true, skipped: false, error: error.message || String(error) };
  }
}

module.exports = {
  DEFAULT_DEPARTURE_DM,
  EVENT_DETAILS,
  normalizeConfig,
  getConfig,
  updateConfig,
  resetConfig,
  buildDmEmbed,
  sendDepartureDm,
};
