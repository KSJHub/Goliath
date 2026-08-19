const { EmbedBuilder } = require('discord.js');
const guildManager = require('../guild/guildManager');

const EVENT_NAME_MAP = {
  'member.join': 'memberJoin',
  'member.leave': 'memberLeave',
  'member.remove': 'memberRemove',
  'member.kick': 'memberKick',
  'member.ban': 'memberBan',

  'message.delete': 'messageDelete',
  'message.bulkDelete': 'messageBulkDelete',
  'message.edit': 'messageEdit',
  'message.pin': 'messagePin',
  'message.unpin': 'messageUnpin',

  'voice.join': 'voiceJoin',
  'voice.leave': 'voiceLeave',
  'voice.move': 'voiceMove',
  'voice.deafUpdate': 'voiceDeafUpdate',
  'voice.muteUpdate': 'voiceMuteUpdate',
  'voice.streamUpdate': 'voiceStreamUpdate',
  'voice.videoUpdate': 'voiceVideoUpdate',

  'channel.create': 'channelCreate',
  'channel.delete': 'channelDelete',
  'channel.update': 'channelUpdate',
  'channel.nameUpdate': 'channelNameUpdate',
  'channel.topicUpdate': 'channelTopicUpdate',
  'channel.permissionsUpdate': 'channelPermissionsUpdate',
  'channel.nsfwUpdate': 'channelNsfwUpdate',
  'channel.parentUpdate': 'channelParentUpdate',
  'channel.slowModeUpdate': 'channelSlowModeUpdate',
  'channel.typeUpdate': 'channelTypeUpdate',
  'channel.userLimitUpdate': 'channelUserLimitUpdate',
  'channel.bitrateUpdate': 'channelBitrateUpdate',
  'channel.rtcRegionUpdate': 'channelRtcRegionUpdate',
  'channel.videoQualityUpdate': 'channelVideoQualityUpdate',

  'role.create': 'roleCreate',
  'role.delete': 'roleDelete',
  'role.update': 'roleUpdate',
  'role.nameUpdate': 'roleNameUpdate',
  'role.colorUpdate': 'roleColorUpdate',
  'role.permissionsUpdate': 'rolePermissionsUpdate',
  'role.positionUpdate': 'rolePositionUpdate',

  'webhook.create': 'webhookCreate',
  'webhook.delete': 'webhookDelete',
  'webhook.update': 'webhookNameUpdate',
  'webhook.nameUpdate': 'webhookNameUpdate',
  'webhook.channelUpdate': 'webhookChannelUpdate',
  'webhook.avatarUpdate': 'webhookAvatarUpdate',

  'emoji.create': 'emojiCreate',
  'emoji.delete': 'emojiDelete',
  'emoji.nameUpdate': 'emojiNameUpdate',
  'emoji.rolesUpdate': 'emojiRolesUpdate',

  'invite.create': 'inviteCreate',
  'invite.delete': 'inviteDelete',
  'invite.use': 'inviteUse',

  'thread.create': 'threadCreate',
  'thread.delete': 'threadDelete',
  'thread.nameUpdate': 'threadNameUpdate',
  'thread.archiveUpdate': 'threadArchiveUpdate',
  'thread.lockedUpdate': 'threadLockedUpdate',
  'thread.memberAdd': 'threadMemberAdd',
  'thread.memberRemove': 'threadMemberRemove',

  'guild.nameUpdate': 'guildNameUpdate',
  'guild.iconUpdate': 'guildIconUpdate',
  'guild.bannerUpdate': 'guildBannerUpdate',
  'guild.ownerUpdate': 'guildOwnerUpdate',
  'guild.verificationLevelUpdate': 'guildVerificationLevelUpdate',
  'guild.boostUpdate': 'guildBoostUpdate',

  'event.create': 'eventCreate',
  'event.delete': 'eventDelete',
  'event.nameUpdate': 'eventNameUpdate',
  'event.statusUpdate': 'eventStatusUpdate',
  'event.userAdd': 'eventUserAdd',
  'event.userRemove': 'eventUserRemove',
};

function resolveChannelType(type = '') {
  if (type.startsWith('automod')) return 'automod';
  if (type.startsWith('moderation')) return 'moderation';
  if (type.startsWith('admin')) return 'admin';
  if (type.startsWith('member')) return 'member';
  if (type.startsWith('voice')) return 'voice';

  if (type.startsWith('message')) {
    if (type.toLowerCase().includes('delete')) return 'messageDelete';
    if (type.toLowerCase().includes('edit')) return 'messageEdit';
    return 'messageDelete';
  }

  if (type.startsWith('channel')) return 'general';
  if (type.startsWith('role')) return 'admin';
  if (type.startsWith('webhook')) return 'admin';
  if (type.startsWith('emoji')) return 'general';
  if (type.startsWith('invite')) return 'general';
  if (type.startsWith('thread')) return 'general';
  if (type.startsWith('guild')) return 'admin';
  if (type.startsWith('event')) return 'general';
  if (type.startsWith('ticket')) return 'moderation';
  if (type.startsWith('form')) return 'admin';
  if (type.startsWith('verification')) return 'admin';
  if (type.startsWith('translation')) return 'general';
  if (type.startsWith('giveaway')) return 'general';
  if (type.startsWith('sticky')) return 'general';

  return 'general';
}

function resolveEventName(type = '') {
  const key = String(type || '').trim();
  if (EVENT_NAME_MAP[key]) return EVENT_NAME_MAP[key];

  if (key.startsWith('automod')) return 'automodActions';
  if (key.startsWith('moderation')) return 'moderationActions';
  if (key.startsWith('admin')) return 'adminActions';
  if (key.startsWith('member')) return 'memberUpdate';
  if (key.startsWith('voice')) return 'voiceMove';

  return key;
}

function formatType(type = 'general') {
  return String(type)
    .split('.')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatUser(user, fallback = 'Unknown') {
  if (!user) return fallback;

  const name =
    user.tag ||
    user.username ||
    user.displayName ||
    user.name ||
    fallback;

  return `${name} (${user.id || 'N/A'})`;
}

function normalizeFields(fields = []) {
  if (!Array.isArray(fields)) return [];

  return fields
    .filter((field) => field?.name && field?.value !== undefined && field?.value !== null)
    .map((field) => ({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: field.inline ?? false,
    }));
}

function buildEmbed(type, data = {}) {
  const title = String(data.title || formatType(type)).slice(0, 256);
  const embed = new EmbedBuilder()
    .setColor(data.color || '#5865F2')
    .setTitle(title)
    .setTimestamp();

  const fields = [];

  if (data.user) fields.push({ name: 'User', value: formatUser(data.user), inline: false });
  if (data.executor) fields.push({ name: 'Executor', value: formatUser(data.executor), inline: false });
  if (data.target) fields.push({ name: 'Target', value: formatUser(data.target), inline: false });
  if (data.reason) fields.push({ name: 'Reason', value: String(data.reason).slice(0, 1024), inline: false });

  fields.push(...normalizeFields(data.fields));

  if (fields.length) embed.addFields(fields.slice(0, 25));
  if (data.description) embed.setDescription(String(data.description).slice(0, 4096));
  if (data.url) embed.setURL(data.url);

  return embed;
}

async function resolveLogChannel(guild, eventName, channelType) {
  const channelId = guildManager.getLogChannelId(guild.id, eventName, channelType || 'general');

  if (!channelId) return null;

  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));

  return channel?.isTextBased() ? channel : null;
}

async function send(guild, type, data = {}) {
  if (!guild?.id || !type) return false;

  try {
    const eventName = resolveEventName(type);

    if (!guildManager.isLogEventEnabled(guild.id, eventName)) return false;

    const channelType = resolveChannelType(eventName || type);
    const channel = await resolveLogChannel(guild, eventName, channelType);

    if (!channel) return false;

    const embed = buildEmbed(type, data);
    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.error(`Log error in guild ${guild?.id || 'unknown'}:`, error);
    return false;
  }
}

module.exports = {
  send,
  buildEmbed,
  resolveChannelType,
  resolveEventName,
  resolveLogChannel,
};
