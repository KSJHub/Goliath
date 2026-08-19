'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const tempVoiceStore = require('./tempVoiceStore');
const { buildControlRows, buildPanelContent } = require('./tempVoicePanel');

function assertTempVoiceModuleEnabled(guildId) {
  if (!tempVoiceStore.isEnabled(guildId)) throw new Error('Temp Voice module is disabled for this server.');
}

function safeChannelName(name) {
  return String(name || 'Temp Voice').replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Temp Voice';
}

function safeStatus(value) {
  return String(value || '').replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanLimit(value, fallback = 0) {
  const number = Number(value);
  return Math.max(0, Math.min(99, Math.floor(Number.isFinite(number) ? number : fallback)));
}

function buildChannelName(template, member) {
  const username = member?.displayName || member?.user?.username || 'Member';
  return safeChannelName(String(template || '{username}\'s Channel').replaceAll('{username}', username));
}

function hasManageChannels(guild) { return Boolean(guild?.members?.me?.permissions?.has(PermissionFlagsBits.ManageChannels)); }
function hasMoveMembers(guild) { return Boolean(guild?.members?.me?.permissions?.has(PermissionFlagsBits.MoveMembers)); }
function canManageVoice(guild) { return hasManageChannels(guild) && hasMoveMembers(guild); }
function canControlTempChannel(member, tempChannel) {
  return Boolean(member?.id === tempChannel?.ownerId || member?.permissions?.has(PermissionFlagsBits.ManageChannels) || member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

async function getMember(guild, memberId) {
  if (!guild || !memberId) return null;
  return guild.members.cache.get(memberId) || guild.members.fetch(memberId).catch(() => null);
}

async function getTrackedVoiceChannel(guild, channelId) {
  const tempChannel = tempVoiceStore.getTempChannel(guild.id, channelId);
  if (!tempChannel) throw new Error('Temporary voice channel is not tracked.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error('Temporary voice channel no longer exists in Discord.');
  return { tempChannel, channel };
}

async function assertCanControl(guild, tempChannel, actorId) {
  const actor = await getMember(guild, actorId);
  if (!canControlTempChannel(actor, tempChannel)) throw new Error('You do not own this temporary voice channel.');
  return actor;
}

async function applyBaseTempPermissions(channel, hub = {}) {
  const everyoneId = channel.guild?.roles?.everyone?.id;
  if (!everyoneId) return;
  const overwrites = {};
  if (hub.lockedByDefault) overwrites.Connect = false;
  if (hub.hiddenByDefault) overwrites.ViewChannel = false;
  if (Object.keys(overwrites).length) await channel.permissionOverwrites.edit(everyoneId, overwrites).catch(() => null);
}

async function applyOwnerPermission(channel, ownerId) {
  if (!ownerId) return;
  await channel.permissionOverwrites.edit(ownerId, { ViewChannel: true, Connect: true, ManageChannels: true, MoveMembers: true }).catch(() => null);
}

function activity(guildId, type, label, channelData = {}, extra = {}) {
  tempVoiceStore.addActivity(guildId, {
    type, label, channelId: channelData.channelId, ownerId: channelData.ownerId,
    actorId: extra.actorId, targetId: extra.targetId, metadata: extra.metadata || {},
  }, { actorId: extra.actorId, action: `temp_voice_${type}` });
}

async function postOwnerPanel(channel, tempChannel) {
  const section = tempVoiceStore.getTempVoiceSection(channel.guild.id);
  if (section.settings?.ownerPanelEnabled === false || !channel?.send) return tempChannel;
  const message = await channel.send({ content: buildPanelContent(tempChannel), components: buildControlRows(channel.id, tempChannel) }).catch(() => null);
  if (!message?.id) return tempChannel;
  return tempVoiceStore.updateTempChannel(channel.guild.id, channel.id, { controlMessageId: message.id }, { action: 'temp_voice_owner_panel' }) || tempChannel;
}

async function createTempChannel(newState, hub) {
  const guild = newState.guild;
  const member = newState.member;
  if (!guild || !member || !hub?.joinChannelId) return null;
  if (!tempVoiceStore.isEnabled(guild.id) || !hasManageChannels(guild) || member.voice?.channelId !== hub.joinChannelId) return null;
  const section = tempVoiceStore.getTempVoiceSection(guild.id);
  const parent = hub.categoryId || newState.channel?.parentId || null;
  const name = buildChannelName(hub.nameTemplate, member);
  const userLimit = hub.userLimit > 0 ? hub.userLimit : section.settings?.defaultUserLimit || 0;
  const channel = await guild.channels.create({
    name, type: ChannelType.GuildVoice, parent, bitrate: hub.bitrate > 0 ? hub.bitrate : undefined,
    userLimit: userLimit > 0 ? userLimit : undefined,
    reason: `Goliath temp voice created for ${member.user?.tag || member.id}`,
  }).catch((error) => { console.error('[TempVoice] Failed to create temporary channel:', error); return null; });
  if (!channel) return null;
  await applyBaseTempPermissions(channel, hub);
  await applyOwnerPermission(channel, member.id);
  let tempChannel = tempVoiceStore.saveTempChannel(guild.id, {
    channelId: channel.id, ownerId: member.id, hubId: hub.hubId || hub.id, name, userLimit,
    locked: hub.lockedByDefault === true, hidden: hub.hiddenByDefault === true,
  });
  activity(guild.id, 'channel_created', 'Temporary voice channel created', tempChannel, { actorId: member.id });
  tempChannel = await postOwnerPanel(channel, tempChannel);
  if (hasMoveMembers(guild)) await member.voice.setChannel(channel, 'Goliath temp voice join-to-create').catch(() => null);
  return channel;
}

async function cleanupTempChannel(oldState) {
  const guild = oldState.guild;
  const oldChannel = oldState.channel;
  if (!guild || !oldChannel) return null;
  const section = tempVoiceStore.getTempVoiceSection(guild.id);
  const tempChannel = section.channels?.[oldChannel.id] || null;
  if (!tempChannel || (oldChannel.members?.size || 0) > 0) return null;
  tempVoiceStore.deleteTempChannel(guild.id, oldChannel.id);
  activity(guild.id, 'channel_deleted', 'Temporary voice channel deleted after becoming empty', tempChannel, { actorId: tempChannel.ownerId });
  if (section.settings?.deleteWhenEmpty !== false && oldChannel.deletable) await oldChannel.delete('Goliath temp voice empty cleanup').catch(() => null);
  return tempChannel;
}

async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild?.id) return null;
    if (newState.channelId && newState.channelId !== oldState.channelId && tempVoiceStore.isEnabled(guild.id)) {
      const hub = tempVoiceStore.findHubByJoinChannel(guild.id, newState.channelId);
      if (hub) await createTempChannel(newState, hub);
    }
    if (oldState.channelId && oldState.channelId !== newState.channelId) await cleanupTempChannel(oldState);
    return true;
  } catch (error) {
    console.error('[TempVoice] voiceStateUpdate failed:', error);
    return false;
  }
}

async function deployHub(guild, input = {}) {
  if (!guild?.id) throw new Error('Guild is required to deploy Temp Voice.');
  if (input.enabled === true) tempVoiceStore.setEnabled(guild.id, true, { actorId: input.actorId, action: 'temp_voice_deploy_enable' });
  assertTempVoiceModuleEnabled(guild.id);
  if (!hasManageChannels(guild)) throw new Error('Goliath needs Manage Channels to deploy Temp Voice channels.');
  const warnings = [];
  if (!hasMoveMembers(guild)) warnings.push('Goliath is missing Move Members. Automatic movement into new temporary channels will not work.');
  let categoryId = tempVoiceStore.cleanDiscordId(input.categoryId);
  let category = categoryId ? guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null) : null;
  if (!categoryId && input.createCategory !== false) {
    category = await guild.channels.create({ name: safeChannelName(input.categoryName || 'Temporary Voice Channels'), type: ChannelType.GuildCategory, reason: 'Goliath Temp Voice dashboard deployment' });
    categoryId = category.id;
  }
  let joinChannelId = tempVoiceStore.cleanDiscordId(input.joinChannelId);
  let joinChannel = joinChannelId ? guild.channels.cache.get(joinChannelId) || await guild.channels.fetch(joinChannelId).catch(() => null) : null;
  if (!joinChannelId) {
    joinChannel = await guild.channels.create({ name: safeChannelName(input.joinChannelName || '➕ Create Temp Voice'), type: ChannelType.GuildVoice, parent: categoryId || undefined, userLimit: 1, reason: 'Goliath Temp Voice hub deployment' });
    joinChannelId = joinChannel.id;
  }
  const hub = tempVoiceStore.saveHub(guild.id, { ...input, joinChannelId, categoryId }, { actorId: input.actorId });
  return { hub, created: { categoryId, categoryName: category?.name || null, joinChannelId, joinChannelName: joinChannel?.name || null }, warnings };
}

function createHub(guildId, input = {}) {
  if (input.enabled === true) tempVoiceStore.setEnabled(guildId, true, { actorId: input.actorId || input.createdBy, action: 'temp_voice_create_hub_enable' });
  assertTempVoiceModuleEnabled(guildId);
  return tempVoiceStore.saveHub(guildId, {
    joinChannelId: input.joinChannelId, joinChannelName: input.joinChannelName, categoryId: input.categoryId,
    categoryName: input.categoryName, nameTemplate: input.nameTemplate, userLimit: input.userLimit,
    bitrate: input.bitrate, lockedByDefault: input.lockedByDefault, hiddenByDefault: input.hiddenByDefault,
    ownerControlsEnabled: input.ownerControlsEnabled, createdBy: input.createdBy,
  });
}

function getHubs(guildId) { return tempVoiceStore.getHubs(guildId); }

async function updateTempChannelControls(guild, channelId, actorId, input = {}) {
  if (!guild?.id) throw new Error('Guild is required.');
  assertTempVoiceModuleEnabled(guild.id);
  const { tempChannel, channel } = await getTrackedVoiceChannel(guild, channelId);
  await assertCanControl(guild, tempChannel, actorId);
  const settings = tempVoiceStore.getTempVoiceSection(guild.id).settings || {};
  const updates = {};
  const eventTypes = [];
  if (Object.prototype.hasOwnProperty.call(input, 'name')) {
    if (!settings.allowOwnerRename && actorId === tempChannel.ownerId) throw new Error('Channel rename is disabled.');
    const name = safeChannelName(input.name); await channel.setName(name, 'Temp Voice owner rename').catch(() => null); updates.name = name; eventTypes.push(['channel_renamed', 'Temporary voice channel renamed']);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'activityStatus')) {
    if (!settings.allowOwnerStatus && actorId === tempChannel.ownerId) throw new Error('Activity status changes are disabled.');
    const activityStatus = safeStatus(input.activityStatus); if (typeof channel.setStatus === 'function') await channel.setStatus(activityStatus || null, 'Temp Voice owner status').catch(() => null); updates.activityStatus = activityStatus; eventTypes.push(['channel_status_changed', 'Temporary voice status changed']);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'userLimit')) {
    if (!settings.allowOwnerLimit && actorId === tempChannel.ownerId) throw new Error('User limit changes are disabled.');
    const userLimit = cleanLimit(input.userLimit, tempChannel.userLimit || 0); await channel.setUserLimit(userLimit, 'Temp Voice owner limit').catch(() => null); updates.userLimit = userLimit; eventTypes.push(['channel_limit_changed', 'Temporary voice user limit changed']);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'locked')) {
    if (!settings.allowOwnerLock && actorId === tempChannel.ownerId) throw new Error('Lock controls are disabled.');
    const locked = input.locked === true; await channel.permissionOverwrites.edit(guild.roles.everyone.id, { Connect: locked ? false : null }).catch(() => null); updates.locked = locked; eventTypes.push([locked ? 'channel_locked' : 'channel_unlocked', locked ? 'Temporary voice channel locked' : 'Temporary voice channel unlocked']);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'hidden')) {
    if (!settings.allowOwnerHide && actorId === tempChannel.ownerId) throw new Error('Hide controls are disabled.');
    const hidden = input.hidden === true; await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: hidden ? false : null }).catch(() => null); updates.hidden = hidden; eventTypes.push([hidden ? 'channel_hidden' : 'channel_shown', hidden ? 'Temporary voice channel hidden' : 'Temporary voice channel shown']);
  }
  if (settings.allowOwnerPermits !== false) {
    for (const [field, permissionValue] of [['allowedUserIds', true], ['allowedRoleIds', true], ['blockedUserIds', false], ['blockedRoleIds', false]]) {
      if (!Object.prototype.hasOwnProperty.call(input, field) || !Array.isArray(input[field])) continue;
      const ids = [...new Set(input[field].map(tempVoiceStore.cleanDiscordId).filter(Boolean))];
      for (const id of ids) await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: permissionValue }).catch(() => null);
      updates[field] = ids;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'ownerId')) {
    if (!settings.allowOwnerTransfer && actorId === tempChannel.ownerId) throw new Error('Ownership transfer is disabled.');
    const ownerId = tempVoiceStore.cleanDiscordId(input.ownerId);
    if (ownerId) { await applyOwnerPermission(channel, ownerId); updates.ownerId = ownerId; eventTypes.push(['channel_transferred', 'Temporary voice ownership transferred']); }
  }
  const updated = tempVoiceStore.updateTempChannel(guild.id, channelId, updates, { actorId });
  for (const [type, label] of eventTypes) activity(guild.id, type, label, updated || tempChannel, { actorId });
  return updated;
}

async function claimTempChannel(guild, channelId, actorId) {
  if (!guild?.id) throw new Error('Guild is required.');
  assertTempVoiceModuleEnabled(guild.id);
  const { tempChannel, channel } = await getTrackedVoiceChannel(guild, channelId);
  const actor = await getMember(guild, actorId);
  if (!actor) throw new Error('Claiming member was not found.');
  const currentOwner = tempChannel.ownerId ? await getMember(guild, tempChannel.ownerId) : null;
  const ownerStillInside = Boolean(currentOwner?.voice?.channelId === channelId);
  const actorIsManager = actor.permissions.has(PermissionFlagsBits.ManageChannels) || actor.permissions.has(PermissionFlagsBits.ManageGuild);
  if (ownerStillInside && !actorIsManager) throw new Error('This channel still has an active owner.');
  await applyOwnerPermission(channel, actorId);
  const updated = tempVoiceStore.updateTempChannel(guild.id, channelId, { ownerId: actorId }, { actorId, action: 'temp_voice_claim' });
  activity(guild.id, 'channel_claimed', 'Temporary voice channel claimed', updated || tempChannel, { actorId });
  return updated;
}

async function kickMemberFromTempChannel(guild, channelId, actorId, targetId, block = false) {
  if (!guild?.id) throw new Error('Guild is required.');
  assertTempVoiceModuleEnabled(guild.id);
  const { tempChannel, channel } = await getTrackedVoiceChannel(guild, channelId);
  await assertCanControl(guild, tempChannel, actorId);
  const target = await getMember(guild, targetId);
  if (!target) throw new Error('Target member was not found.');
  if (target.voice?.channelId === channelId) await target.voice.disconnect('Temp Voice owner kick').catch(() => null);
  const updates = {};
  if (block) {
    await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: false }).catch(() => null);
    updates.blockedUserIds = [...new Set([...(tempChannel.blockedUserIds || []), target.id])];
  }
  const updated = tempVoiceStore.updateTempChannel(guild.id, channelId, updates, { actorId, action: block ? 'temp_voice_block_user' : 'temp_voice_kick_user' });
  activity(guild.id, block ? 'member_restricted' : 'member_removed', block ? 'Member restricted from temporary voice channel' : 'Member removed from temporary voice channel', updated || tempChannel, { actorId, targetId: target.id });
  return updated;
}

async function deleteOwnedTempChannel(guild, channelId, actorId) {
  if (!guild?.id) throw new Error('Guild is required.');
  assertTempVoiceModuleEnabled(guild.id);
  const tempChannel = tempVoiceStore.getTempChannel(guild.id, channelId);
  if (!tempChannel) throw new Error('Temporary voice channel is not tracked.');
  await assertCanControl(guild, tempChannel, actorId);
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  tempVoiceStore.deleteTempChannel(guild.id, channelId, { actorId });
  activity(guild.id, 'channel_deleted', 'Temporary voice channel closed', tempChannel, { actorId });
  if (channel?.deletable) await channel.delete('Temp Voice owner delete').catch(() => null);
  return tempChannel;
}

module.exports = {
  handleVoiceStateUpdate, deployHub, createHub, getHubs, createTempChannel, cleanupTempChannel,
  updateTempChannelControls, claimTempChannel, kickMemberFromTempChannel, deleteOwnedTempChannel,
  canManageVoice,
};