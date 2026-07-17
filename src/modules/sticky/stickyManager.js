'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const stickyStore = require('./stickyGuildStore');
const { TYPES, createTimelineEvent } = require('../../features/timeline/timelineManager');
const { isModuleEnabled } = require('../../core/guild/guildManager');

const channelLocks = new Map();

function stickyLockKey(channel) {
  return channel?.guild?.id && channel?.id ? `${channel.guild.id}:${channel.id}` : null;
}

async function withChannelLock(channel, operation) {
  const key = stickyLockKey(channel);
  if (!key) return operation();

  const previous = channelLocks.get(key) || Promise.resolve();
  const current = previous
    .catch(() => null)
    .then(operation);

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
    return isModuleEnabled(guildId, 'sticky') === true;
  } catch (error) {
    console.error(`[Sticky] Failed to read module state for guild ${guildId}:`, error?.message || error);
    return false;
  }
}

function assertStickyModuleEnabled(guildId) {
  if (!stickyModuleEnabled(guildId)) {
    throw new Error('Sticky Messages module is disabled for this server.');
  }
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

function logStickyTimeline(channel, title, input = {}, client) {
  if (!channel?.guild) return null;

  try {
    return createTimelineEvent(
      channel.guild.id,
      {
        type: TYPES.STICKY,
        title,
        description: input.description || null,
        actor: input.actor || null,
        actorId: input.actorId || null,
        actorTag: input.actorTag || null,
        channelId: channel.id,
        meta: input.meta || {},
      },
      client
    );
  } catch (error) {
    console.error(`[Sticky] Timeline logging failed for ${channel.guild.id}:${channel.id}:`, error?.message || error);
    return null;
  }
}

function normaliseStickyInput(input = {}) {
  return {
    type: input.type === 'embed' ? 'embed' : 'text',
    content: String(input.content || '').trim(),
    embed: input.embed || null,
    repostEvery: Math.max(1, Number(input.repostEvery || 10)),
    cooldownSeconds: Math.max(0, Number(input.cooldownSeconds ?? 60)),
    updatedBy: input.updatedBy || null,
    actor: input.actor || null,
  };
}

function buildStickyPayload(sticky) {
  if (sticky.type === 'embed') {
    const embedData = sticky.embed || {};
    const embed = new EmbedBuilder()
      .setColor(embedData.color || '#2b7cff')
      .setTitle(embedData.title || 'Sticky Message')
      .setDescription(embedData.description || sticky.content || 'No sticky content set.');

    if (embedData.footer) {
      embed.setFooter({ text: String(embedData.footer).slice(0, 2048) });
    }

    return {
      content: sticky.content && embedData.description ? sticky.content : '',
      embeds: [embed],
    };
  }

  return {
    content: sticky.content || 'No sticky content set.',
    embeds: [],
  };
}

async function fetchLastSticky(channel, sticky) {
  if (!sticky?.lastMessageId || !channel?.messages?.fetch) return null;
  try {
    return await channel.messages.fetch(sticky.lastMessageId);
  } catch (error) {
    if (error?.code !== 10008) {
      console.warn(`[Sticky] Failed to fetch prior sticky ${sticky.lastMessageId} in ${channel?.id}:`, error?.message || error);
    }
    return null;
  }
}

async function deleteOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (!message) return { ok: true, missing: true };
  if (!message.deletable) return { ok: false, reason: 'Prior sticky is not deletable.' };

  try {
    await message.delete();
    return { ok: true, deleted: true };
  } catch (error) {
    if (error?.code === 10008) return { ok: true, missing: true };
    console.error(`[Sticky] Failed to delete prior sticky ${message.id} in ${channel.id}:`, error?.message || error);
    return { ok: false, reason: error?.message || 'Delete failed.' };
  }
}

async function editOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (!message?.editable) return null;
  try {
    return await message.edit(buildStickyPayload(sticky));
  } catch (error) {
    console.error(`[Sticky] Failed to edit sticky ${message.id} in ${channel.id}:`, error?.message || error);
    return null;
  }
}

function isCoolingDown(sticky) {
  const cooldownSeconds = Number(sticky.cooldownSeconds ?? 60);
  if (cooldownSeconds <= 0 || !sticky.lastPostedAt) return false;

  const lastPosted = new Date(sticky.lastPostedAt).getTime();
  if (!Number.isFinite(lastPosted)) return false;
  return Date.now() - lastPosted < cooldownSeconds * 1000;
}

async function repostStickyUnlocked(channel, sticky, client, options = {}) {
  if (!channel?.guild || !sticky?.enabled) return null;
  if (!stickyModuleEnabled(channel.guild.id)) return null;

  const botMember = channel.guild.members.me;
  if (!canBotManageChannel(channel, botMember)) {
    console.warn(`[Sticky] Missing channel permissions in ${channel.guild.id}:${channel.id}.`);
    return null;
  }

  const freshSticky = stickyStore.getChannelSticky(channel.guild.id, channel.id, client) || sticky;
  if (!freshSticky?.enabled || !stickyModuleEnabled(channel.guild.id)) return null;

  const deletion = await deleteOldSticky(channel, freshSticky);
  if (!deletion.ok) return null;

  let sent;
  try {
    sent = await channel.send(buildStickyPayload(freshSticky));
  } catch (error) {
    console.error(`[Sticky] Failed to send sticky in ${channel.guild.id}:${channel.id}:`, error?.message || error);
    return null;
  }

  stickyStore.updateChannelSticky(
    channel.guild.id,
    channel.id,
    {
      lastMessageId: sent.id,
      lastPostedAt: new Date().toISOString(),
      messageCount: 0,
    },
    client
  );

  logStickyTimeline(
    channel,
    options.manual ? 'Sticky reposted manually' : 'Sticky reposted',
    {
      actor: options.actor || null,
      actorId: options.actorId || null,
      actorTag: options.actorTag || null,
      meta: {
        messageId: sent.id,
        type: freshSticky.type || 'text',
        manual: Boolean(options.manual),
      },
    },
    client
  );

  return sent;
}

async function repostSticky(channel, sticky, client, options = {}) {
  return withChannelLock(channel, () => repostStickyUnlocked(channel, sticky, client, options));
}

async function handleStickyMessage(message, client) {
  if (!message?.guild || !message?.channel || message.author?.bot || message.webhookId) return null;
  if (!stickyModuleEnabled(message.guild.id)) return null;

  return withChannelLock(message.channel, async () => {
    if (!stickyModuleEnabled(message.guild.id)) return null;

    const data = stickyStore.loadStickyData(message.guild.id, client);
    if (!data?.enabled) return null;

    const sticky = data.channels?.[message.channel.id];
    if (!sticky?.enabled || message.id === sticky.lastMessageId) return null;

    const nextCount = Number(sticky.messageCount || 0) + 1;
    const updated = stickyStore.updateChannelSticky(
      message.guild.id,
      message.channel.id,
      { messageCount: nextCount },
      client
    ) || { ...sticky, messageCount: nextCount };

    if (nextCount < Number(updated.repostEvery || 10)) return null;
    if (isCoolingDown(updated)) return null;

    return repostStickyUnlocked(message.channel, updated, client);
  });
}

async function createSticky(channel, input, client) {
  assertStickyModuleEnabled(channel?.guild?.id);

  return withChannelLock(channel, async () => {
    assertStickyModuleEnabled(channel?.guild?.id);
    const stickyInput = normaliseStickyInput(input);
    const sticky = stickyStore.setChannelSticky(channel.guild.id, channel.id, stickyInput, client);

    const edited = await editOldSticky(channel, sticky);
    const sent = edited || await repostStickyUnlocked(channel, sticky, client, {
      actor: stickyInput.actor,
      actorId: stickyInput.updatedBy,
      manual: true,
    });

    if (!sent) throw new Error('Sticky message could not be created or updated. Check bot channel permissions.');

    if (edited) {
      stickyStore.updateChannelSticky(
        channel.guild.id,
        channel.id,
        {
          lastMessageId: edited.id,
          lastPostedAt: new Date().toISOString(),
          messageCount: 0,
        },
        client
      );
    }

    logStickyTimeline(
      channel,
      edited ? 'Sticky updated' : 'Sticky created',
      {
        actor: stickyInput.actor,
        actorId: stickyInput.updatedBy,
        meta: {
          type: sticky.type,
          repostEvery: sticky.repostEvery,
          cooldownSeconds: sticky.cooldownSeconds,
          messageId: sent.id,
          edited: Boolean(edited),
        },
      },
      client
    );

    return sent;
  });
}

async function pauseSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    const sticky = stickyStore.updateChannelSticky(channel.guild.id, channel.id, { enabled: false }, client);
    if (sticky) logStickyTimeline(channel, 'Sticky paused', { actor }, client);
    return sticky;
  });
}

async function resumeSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    assertStickyModuleEnabled(channel?.guild?.id);
    const sticky = stickyStore.updateChannelSticky(channel.guild.id, channel.id, { enabled: true }, client);
    if (!sticky) return null;

    const sent = await repostStickyUnlocked(channel, sticky, client, { actor, manual: true });
    if (!sent) throw new Error('Sticky could not be resumed because it could not be posted.');
    logStickyTimeline(channel, 'Sticky resumed', { actor }, client);
    return sticky;
  });
}

async function removeSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);
  return withChannelLock(channel, async () => {
    const sticky = stickyStore.getChannelSticky(channel.guild.id, channel.id, client);
    if (!sticky) return null;

    if (sticky.lastMessageId) {
      const deletion = await deleteOldSticky(channel, sticky);
      if (!deletion.ok) throw new Error(deletion.reason || 'Sticky message could not be deleted.');
    }

    const removed = stickyStore.deleteChannelSticky(channel.guild.id, channel.id, client);
    if (removed) {
      logStickyTimeline(
        channel,
        'Sticky deleted',
        {
          actor,
          meta: {
            lastMessageId: removed.lastMessageId || null,
            type: removed.type || 'text',
          },
        },
        client
      );
    }

    return removed;
  });
}

module.exports = {
  canManageSticky,
  handleStickyMessage,
  createSticky,
  repostSticky,
  pauseSticky,
  resumeSticky,
  removeSticky,
};
