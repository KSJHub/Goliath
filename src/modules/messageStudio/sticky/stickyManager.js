'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const stickyStore = require('./stickyStore');

const channelLocks = new Map();

function stickyLockKey(channel) {
  return channel?.guild?.id && channel?.id ? `${channel.guild.id}:${channel.id}` : null;
}

async function withChannelLock(channel, operation) {
  const key = stickyLockKey(channel);
  if (!key) return operation();

  const previous = channelLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  channelLocks.set(key, current);

  try {
    return await current;
  } finally {
    if (channelLocks.get(key) === current) channelLocks.delete(key);
  }
}

function stickyModuleEnabled(guildId) {
  if (!guildId) return false;
  try {
    return stickyStore.isEnabled(guildId);
  } catch (error) {
    console.error(`[Sticky] Failed to read module state for guild ${guildId}:`, error?.message || error);
    return false;
  }
}

function assertStickyModuleEnabled(guildId) {
  if (!stickyModuleEnabled(guildId)) throw new Error('Sticky Messages module is disabled for this server.');
}

function canManageSticky(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member?.permissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function canBotManageChannel(channel, guildMember) {
  if (!channel?.permissionsFor || !guildMember) return false;
  const permissions = channel.permissionsFor(guildMember);
  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
    permissions?.has(PermissionFlagsBits.SendMessages) &&
    permissions?.has(PermissionFlagsBits.ReadMessageHistory) &&
    permissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function normaliseStickyInput(input = {}) {
  return {
    type: input.type === 'embed' ? 'embed' : 'text',
    content: String(input.content || '').trim(),
    embed: input.embed || null,
    repostEvery: Math.max(1, Number(input.repostEvery || 10)),
    cooldownSeconds: Math.max(0, Number(input.cooldownSeconds ?? 60)),
    updatedBy: input.updatedBy || null,
  };
}

function buildStickyPayload(sticky) {
  if (sticky.type === 'embed') {
    const embedData = sticky.embed || {};
    const embed = new EmbedBuilder()
      .setColor(embedData.color || '#2b7cff')
      .setTitle(embedData.title || 'Sticky Message')
      .setDescription(embedData.description || sticky.content || 'No sticky content set.');

    if (embedData.footer) embed.setFooter({ text: String(embedData.footer).slice(0, 2048) });
    return { content: sticky.content && embedData.description ? sticky.content : '', embeds: [embed] };
  }

  return { content: sticky.content || 'No sticky content set.', embeds: [] };
}

async function fetchLastSticky(channel, sticky) {
  if (!sticky?.lastMessageId || !channel?.messages?.fetch) return null;
  try {
    return await channel.messages.fetch(sticky.lastMessageId);
  } catch (error) {
    if (error?.code !== 10008) console.warn(`[Sticky] Failed to fetch prior sticky ${sticky.lastMessageId}:`, error?.message || error);
    return null;
  }
}

async function deleteOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (!message) return { ok: true, missing: true };
  if (!message.deletable) return { ok: false, reason: 'Prior sticky is not deletable.' };
  try {
    await message.delete();
    stickyStore.incrementAnalytics(channel.guild.id, { cleaned: 1 });
    return { ok: true, deleted: true };
  } catch (error) {
    if (error?.code === 10008) return { ok: true, missing: true };
    return { ok: false, reason: error?.message || 'Delete failed.' };
  }
}

async function editOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (!message?.editable) return null;
  try {
    const edited = await message.edit(buildStickyPayload(sticky));
    stickyStore.incrementAnalytics(channel.guild.id, { refreshed: 1 });
    return edited;
  } catch (error) {
    console.error(`[Sticky] Failed to edit sticky ${message.id}:`, error?.message || error);
    return null;
  }
}

function isCoolingDown(sticky) {
  const cooldownSeconds = Number(sticky.cooldownSeconds ?? 60);
  if (cooldownSeconds <= 0 || !sticky.lastPostedAt) return false;
  const lastPosted = new Date(sticky.lastPostedAt).getTime();
  return Number.isFinite(lastPosted) && Date.now() - lastPosted < cooldownSeconds * 1000;
}

async function repostStickyUnlocked(channel, sticky, client) {
  if (!channel?.guild || !sticky?.enabled || !stickyModuleEnabled(channel.guild.id)) return null;
  if (!canBotManageChannel(channel, channel.guild.members.me)) return null;

  const freshSticky = stickyStore.getChannelSticky(channel.guild.id, channel.id) || sticky;
  if (!freshSticky?.enabled || !stickyModuleEnabled(channel.guild.id)) return null;

  const deletion = await deleteOldSticky(channel, freshSticky);
  if (!deletion.ok) return null;

  const sent = await channel.send(buildStickyPayload(freshSticky)).catch((error) => {
    console.error(`[Sticky] Failed to send sticky in ${channel.guild.id}:${channel.id}:`, error?.message || error);
    return null;
  });
  if (!sent) return null;

  stickyStore.updateChannelSticky(channel.guild.id, channel.id, {
    lastMessageId: sent.id,
    lastPostedAt: new Date().toISOString(),
    messageCount: 0,
  });
  stickyStore.incrementAnalytics(channel.guild.id, { deployed: 1 });
  return sent;
}

async function repostSticky(channel, sticky, client) {
  return withChannelLock(channel, () => repostStickyUnlocked(channel, sticky, client));
}

async function handleStickyMessage(message, client) {
  if (!message?.guild || !message?.channel || message.author?.bot || message.webhookId) return null;
  if (!stickyModuleEnabled(message.guild.id)) return null;

  return withChannelLock(message.channel, async () => {
    if (!stickyModuleEnabled(message.guild.id)) return null;
    const sticky = stickyStore.getChannelSticky(message.guild.id, message.channel.id);
    if (!sticky?.enabled || message.id === sticky.lastMessageId) return null;

    const nextCount = Number(sticky.messageCount || 0) + 1;
    const updated = stickyStore.updateChannelSticky(message.guild.id, message.channel.id, { messageCount: nextCount });
    if (!updated || nextCount < Number(updated.repostEvery || 10) || isCoolingDown(updated)) return null;
    return repostStickyUnlocked(message.channel, updated, client);
  });
}

async function createSticky(channel, input, client) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    const stickyInput = normaliseStickyInput(input);
    const sticky = stickyStore.setChannelSticky(channel.guild.id, channel.id, stickyInput);
    const edited = await editOldSticky(channel, sticky);
    const sent = edited || await repostStickyUnlocked(channel, sticky, client);
    if (!sent) throw new Error('Sticky message could not be created or updated. Check bot channel permissions.');
    if (edited) stickyStore.updateChannelSticky(channel.guild.id, channel.id, { lastMessageId: edited.id, lastPostedAt: new Date().toISOString(), messageCount: 0 });
    return sent;
  });
}

async function pauseSticky(channel) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, () => stickyStore.updateChannelSticky(channel.guild.id, channel.id, { enabled: false }));
}

async function resumeSticky(channel, client) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    const sticky = stickyStore.updateChannelSticky(channel.guild.id, channel.id, { enabled: true });
    if (!sticky) return null;
    const sent = await repostStickyUnlocked(channel, sticky, client);
    if (!sent) throw new Error('Sticky could not be resumed because it could not be posted.');
    return sticky;
  });
}

async function removeSticky(channel) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    const sticky = stickyStore.getChannelSticky(channel.guild.id, channel.id);
    if (!sticky) return null;
    if (sticky.lastMessageId) {
      const deletion = await deleteOldSticky(channel, sticky);
      if (!deletion.ok) throw new Error(deletion.reason || 'Sticky message could not be deleted.');
    }
    return stickyStore.deleteChannelSticky(channel.guild.id, channel.id);
  });
}

module.exports = {
  canManageSticky,
  buildStickyPayload,
  handleStickyMessage,
  createSticky,
  repostSticky,
  pauseSticky,
  resumeSticky,
  removeSticky,
};