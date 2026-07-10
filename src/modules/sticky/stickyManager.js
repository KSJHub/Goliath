const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const stickyStore = require('./stickyGuildStore');
const { TYPES, createTimelineEvent } = require('../../features/timeline/timelineManager');
const { isModuleEnabled } = require('../../core/guild/guildManager');

function assertStickyModuleEnabled(guildId) {
  if (!isModuleEnabled(guildId, 'sticky')) {
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
  const permissions = channel.permissionsFor(guildMember);

  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel) &&
    permissions?.has(PermissionFlagsBits.SendMessages) &&
    permissions?.has(PermissionFlagsBits.ManageMessages)
  );
}

function logStickyTimeline(channel, title, input = {}, client) {
  if (!channel?.guild) return null;

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
  if (!sticky?.lastMessageId) return null;
  return channel.messages.fetch(sticky.lastMessageId).catch(() => null);
}

async function deleteOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (message?.deletable) await message.delete().catch(() => null);
}

async function editOldSticky(channel, sticky) {
  const message = await fetchLastSticky(channel, sticky);
  if (!message?.editable) return null;
  await message.edit(buildStickyPayload(sticky));
  return message;
}

function isCoolingDown(sticky) {
  const cooldownSeconds = Number(sticky.cooldownSeconds ?? 60);
  if (cooldownSeconds <= 0) return false;
  if (!sticky.lastPostedAt) return false;

  const lastPosted = new Date(sticky.lastPostedAt).getTime();
  const cooldownMs = cooldownSeconds * 1000;

  return Date.now() - lastPosted < cooldownMs;
}

async function repostSticky(channel, sticky, client, options = {}) {
  if (!channel?.guild || !sticky?.enabled) return null;
  if (!isModuleEnabled(channel.guild.id, 'sticky')) return null;

  const botMember = channel.guild.members.me;
  if (!canBotManageChannel(channel, botMember)) return null;

  await deleteOldSticky(channel, sticky);

  const sent = await channel.send(buildStickyPayload(sticky));

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
        type: sticky.type || 'text',
        manual: Boolean(options.manual),
      },
    },
    client
  );

  return sent;
}

async function handleStickyMessage(message, client) {
  if (!message?.guild || !message?.channel || message.author?.bot) return;
  if (!isModuleEnabled(message.guild.id, 'sticky')) return;

  const data = stickyStore.loadStickyData(message.guild.id, client);
  if (!data.enabled) return;

  const sticky = data.channels[message.channel.id];
  if (!sticky?.enabled) return;
  if (message.id === sticky.lastMessageId) return;

  const nextCount = Number(sticky.messageCount || 0) + 1;

  stickyStore.updateChannelSticky(
    message.guild.id,
    message.channel.id,
    { messageCount: nextCount },
    client
  );

  if (nextCount < Number(sticky.repostEvery || 10)) return;

  const freshSticky = stickyStore.getChannelSticky(message.guild.id, message.channel.id, client) || {
    ...sticky,
    messageCount: nextCount,
  };

  if (isCoolingDown(freshSticky)) return;

  await repostSticky(message.channel, freshSticky, client);
}

async function createSticky(channel, input, client) {
  assertStickyModuleEnabled(channel?.guild?.id);

  const stickyInput = normaliseStickyInput(input);

  const sticky = stickyStore.setChannelSticky(
    channel.guild.id,
    channel.id,
    stickyInput,
    client
  );

  const edited = await editOldSticky(channel, sticky);
  const sent = edited || await repostSticky(channel, sticky, client, {
    actor: stickyInput.actor,
    actorId: stickyInput.updatedBy,
    manual: true,
  });

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
        messageId: sent?.id || null,
        edited: Boolean(edited),
      },
    },
    client
  );

  return sent;
}

async function pauseSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);

  const sticky = stickyStore.updateChannelSticky(
    channel.guild.id,
    channel.id,
    { enabled: false },
    client
  );

  if (sticky) {
    logStickyTimeline(channel, 'Sticky paused', { actor }, client);
  }

  return sticky;
}

async function resumeSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);

  const sticky = stickyStore.updateChannelSticky(
    channel.guild.id,
    channel.id,
    { enabled: true },
    client
  );

  if (!sticky) return null;

  await repostSticky(channel, sticky, client, {
    actor,
    manual: true,
  });

  logStickyTimeline(channel, 'Sticky resumed', { actor }, client);

  return sticky;
}

async function removeSticky(channel, client, actor = null) {
  assertStickyModuleEnabled(channel?.guild?.id);

  const sticky = stickyStore.deleteChannelSticky(channel.guild.id, channel.id, client);

  if (sticky?.lastMessageId) {
    await deleteOldSticky(channel, sticky);
  }

  if (sticky) {
    logStickyTimeline(
      channel,
      'Sticky deleted',
      {
        actor,
        meta: {
          lastMessageId: sticky.lastMessageId || null,
          type: sticky.type || 'text',
        },
      },
      client
    );
  }

  return sticky;
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