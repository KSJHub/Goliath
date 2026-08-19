'use strict';

/**
 * Canonical Goodbye departure layer.
 * Owns departure classification, public departure delivery and member DMs.
 */

let senderApi;
{
  const { EmbedBuilder } = require('discord.js');
  const guildManager = require('../../../core/guild/guildManager');
  const embedTemplateManager = require('../embed/embedTemplates');
  const goodbyeManager = require('./goodbye');

  const DEPARTURE_DETAILS = Object.freeze({
    left: {
      icon: '👋',
      label: 'Left Voluntarily',
      defaultReason: 'No reason provided',
      moderatorFallback: 'N/A',
    },
    kicked: {
      icon: '👢',
      label: 'Kicked',
      defaultReason: 'No reason provided',
      moderatorFallback: 'N/A',
    },
    banned: {
      icon: '🔨',
      label: 'Banned',
      defaultReason: 'No reason provided',
      moderatorFallback: 'N/A',
    },
    pruned: {
      icon: '🧹',
      label: 'Pruned',
      defaultReason: 'Server prune',
      moderatorFallback: 'System',
    },
  });

  function formatDuration(startTimestamp, endTimestamp = Date.now()) {
    if (!startTimestamp || !Number.isFinite(Number(startTimestamp))) return 'Unknown';

    let seconds = Math.max(0, Math.floor((Number(endTimestamp) - Number(startTimestamp)) / 1000));
    const units = [
      ['y', 365 * 24 * 60 * 60],
      ['mo', 30 * 24 * 60 * 60],
      ['d', 24 * 60 * 60],
      ['h', 60 * 60],
      ['m', 60],
    ];
    const parts = [];

    for (const [label, size] of units) {
      const value = Math.floor(seconds / size);
      if (!value) continue;
      parts.push(`${value}${label}`);
      seconds -= value * size;
      if (parts.length === 2) break;
    }

    return parts.length ? parts.join(' ') : '<1m';
  }

  function formatModerator(user, fallback) {
    if (!user?.id) return fallback;
    return `<@${user.id}>`;
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
      departureReason: String(auditLog?.reason || details.defaultReason).slice(0, 1024),
      departureModerator: formatModerator(moderator, details.moderatorFallback),
      departureModeratorId: moderator?.id || 'N/A',
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

  senderApi = {
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
}

let dmApi;
{
  const { EmbedBuilder } = require('discord.js');
  const goodbye = require('./goodbye');
  const { formatDuration } = senderApi;

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

  dmApi = {
    DEFAULT_DEPARTURE_DM,
    EVENT_DETAILS,
    normalizeConfig,
    getConfig,
    updateConfig,
    resetConfig,
    buildDmEmbed,
    sendDepartureDm,
  };
}

module.exports = {
  ...senderApi,
  ...dmApi,
  sender: senderApi,
  dm: dmApi,
};
