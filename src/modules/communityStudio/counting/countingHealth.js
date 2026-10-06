'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const counting = require('./counting');

function issue(code, detail = {}) { return { code, ...detail }; }

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const section = counting.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, counting.MODULE_KEY);
  const issues = [];
  const warnings = [];
  let channel = null;

  if (enabled && !section.channelId) issues.push(issue('channel_not_configured'));
  if (section.channelId) {
    channel = await fetchChannel(guild, section.channelId);
    if (!channel) issues.push(issue('channel_missing', { channelId: section.channelId }));
    else if (!channel.isTextBased?.() || !channel.send) issues.push(issue('channel_not_text_based', { channelId: section.channelId }));
    else {
      const me = guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      if (!permissions?.has(PermissionFlagsBits.ViewChannel)) issues.push(issue('view_channel_missing', { channelId: section.channelId }));
      if (!permissions?.has(PermissionFlagsBits.SendMessages)) issues.push(issue('send_messages_missing', { channelId: section.channelId }));
      if (!permissions?.has(PermissionFlagsBits.ReadMessageHistory)) warnings.push(issue('read_history_missing', { channelId: section.channelId }));
      if (section.deleteIncorrect && !permissions?.has(PermissionFlagsBits.ManageMessages)) warnings.push(issue('manage_messages_missing', { channelId: section.channelId }));
    }
  }

  const baseline = section.startingNumber - 1;
  if (!Number.isSafeInteger(section.startingNumber) || section.startingNumber < 0) issues.push(issue('starting_number_invalid'));
  if (!Number.isSafeInteger(section.currentCount) || section.currentCount < baseline) issues.push(issue('current_count_invalid', { currentCount: section.currentCount }));
  if (!Number.isSafeInteger(section.highestCount) || section.highestCount < section.currentCount) issues.push(issue('record_invalid', { highestCount: section.highestCount }));
  if (section.lastCounterId && section.consecutiveCount < 1) warnings.push(issue('turn_state_inconsistent'));
  if (!section.lastCounterId && section.consecutiveCount !== 0) warnings.push(issue('turn_state_stale'));

  if (section.playerPanelMessageId) {
    if (!channel?.messages?.fetch) warnings.push(issue('player_panel_unreachable', { messageId: section.playerPanelMessageId }));
    else {
      const panel = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null);
      if (!panel) warnings.push(issue('player_panel_missing', { messageId: section.playerPanelMessageId }));
    }
  }

  return {
    module: counting.MODULE_KEY,
    guildId: guild.id,
    enabled,
    configured: Boolean(section.channelId),
    healthy: issues.length === 0,
    issues,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

async function repair(guild, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const before = counting.getSection(guild.id);
  let channel = await fetchChannel(guild, before.channelId);

  if (before.channelId && (!channel?.isTextBased?.() || !channel.send)) {
    await counting.changeChannel(guild, null, { ...meta, action: 'counting_health_clear_missing_channel' });
    channel = null;
  }

  await counting.mutateSection(guild.id, (section) => {
    const baseline = section.startingNumber - 1;
    const currentCount = Number.isSafeInteger(section.currentCount) && section.currentCount >= baseline ? section.currentCount : baseline;
    const highestCount = Number.isSafeInteger(section.highestCount) && section.highestCount >= currentCount ? section.highestCount : currentCount;
    const hasCounter = Boolean(section.lastCounterId);
    return {
      ...section,
      currentCount,
      highestCount,
      consecutiveCount: hasCounter ? Math.max(1, Number(section.consecutiveCount) || 1) : 0,
    };
  }, { ...meta, action: 'counting_health_repair_state' });

  const section = counting.getSection(guild.id);
  if (section.playerPanelMessageId && channel?.messages?.fetch) {
    const panel = await channel.messages.fetch(section.playerPanelMessageId).catch(() => null);
    if (!panel) await counting.mutateSection(guild.id, (current) => ({ ...current, playerPanelMessageId: null }), { ...meta, action: 'counting_health_clear_missing_panel' });
  }

  return buildHealthReport(guild);
}

module.exports = { buildHealthReport, repair };
