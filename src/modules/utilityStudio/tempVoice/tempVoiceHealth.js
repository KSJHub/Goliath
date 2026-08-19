'use strict';

const { PermissionFlagsBits } = require('discord.js');
const tempVoiceStore = require('./tempVoiceStore');

async function resolveChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function buildHealth(guild) {
  if (!guild?.id) throw new Error('Guild is required.');

  const section = tempVoiceStore.getTempVoiceSection(guild.id);
  const issues = [];
  const warnings = [];

  for (const hub of Object.values(section.hubs || {})) {
    const joinChannel = await resolveChannel(guild, hub.joinChannelId);
    if (!joinChannel) {
      issues.push({ code: 'hub_join_channel_missing', hubId: hub.hubId, channelId: hub.joinChannelId });
    }

    if (hub.categoryId) {
      const category = await resolveChannel(guild, hub.categoryId);
      if (!category) warnings.push({ code: 'hub_category_missing', hubId: hub.hubId, categoryId: hub.categoryId });
    }
  }

  for (const tempChannel of Object.values(section.channels || {})) {
    const channel = await resolveChannel(guild, tempChannel.channelId);
    if (!channel) issues.push({ code: 'tracked_channel_missing', channelId: tempChannel.channelId, ownerId: tempChannel.ownerId });
  }

  const permissions = guild.members.me?.permissions;
  if (!permissions?.has(PermissionFlagsBits.ManageChannels)) issues.push({ code: 'manage_channels_missing' });
  if (!permissions?.has(PermissionFlagsBits.MoveMembers)) warnings.push({ code: 'move_members_missing' });

  return {
    module: 'tempVoice',
    guildId: guild.id,
    enabled: tempVoiceStore.isEnabled(guild.id),
    healthy: issues.length === 0,
    hubs: Object.keys(section.hubs || {}).length,
    trackedChannels: Object.keys(section.channels || {}).length,
    issues,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

async function repair(guild, meta = {}) {
  if (!guild?.id) throw new Error('Guild is required.');

  const section = tempVoiceStore.getTempVoiceSection(guild.id);
  const hubs = {};
  const channels = {};

  for (const [hubId, hub] of Object.entries(section.hubs || {})) {
    const joinChannel = await resolveChannel(guild, hub.joinChannelId);
    if (!joinChannel) continue;

    let categoryId = hub.categoryId;
    if (categoryId && !(await resolveChannel(guild, categoryId))) categoryId = null;
    hubs[hubId] = { ...hub, categoryId };
  }

  for (const [channelId, tempChannel] of Object.entries(section.channels || {})) {
    if (await resolveChannel(guild, channelId)) channels[channelId] = tempChannel;
  }

  tempVoiceStore.saveTempVoiceSection(guild.id, { ...section, hubs, channels }, meta);
  return buildHealth(guild);
}

module.exports = {
  buildHealth,
  repair,
};