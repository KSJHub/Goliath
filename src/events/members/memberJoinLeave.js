const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { buildPreviewEmbed, TEMPLATES } = require('../../modules/embed/functions/embedPanel');
const embedTemplateManager = require('../../modules/embed/embedTemplateManager');
const guildManager = require('../../core/guild/guildManager');
const autoRoleManager = require('../../modules/autoRoles/autoRoleManager');
const statsManager = require('../../modules/stats/statsManager');
const verificationManager = require('../../modules/verification/verificationManager');

/* ---------------- SHARED HELPERS ---------------- */

function formatTimestamp(timestamp, style = 'R') {
  return timestamp ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Unknown';
}

function formatUser(user) {
  if (!user) return 'Unknown User';
  return `${user} \`${user.tag || user.username || user.id}\``;
}

function getAvatar(member) {
  return member.displayAvatarURL({ extension: 'png', size: 256 });
}

function getGuildIcon(guild) {
  return guild.iconURL?.({ extension: 'png', size: 256 }) || '';
}

function getGuildBanner(guild) {
  return guild.bannerURL?.({ extension: 'png', size: 1024 }) || '';
}

function getRolesText(member, addedRoles = []) {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => role.toString());

  for (const role of addedRoles) {
    if (!roles.includes(role.toString())) roles.push(role.toString());
  }

  if (!roles.length) return 'No roles';
  return roles.join(', ').slice(0, 1024);
}

function isLogEnabled(guildId, eventName) {
  if (typeof guildManager.isLogEventEnabled !== 'function') return true;
  return guildManager.isLogEventEnabled(guildId, eventName) !== false;
}

function buildMemberTemplateVariables(member, type) {
  const guild = member.guild;
  const createdAt = formatTimestamp(member.user.createdTimestamp, 'F');
  const joinedAt = member.joinedTimestamp ? formatTimestamp(member.joinedTimestamp, 'F') : 'Unknown';
  const leftAt = formatTimestamp(Date.now(), 'F');

  return {
    guild: guild.name,
    guildId: guild.id,
    guildIcon: getGuildIcon(guild),
    guildBanner: getGuildBanner(guild),
    memberCount: guild.memberCount,
    user: String(member.user),
    userMention: `<@${member.user.id}>`,
    username: member.user.username || member.user.tag || member.user.id,
    userId: member.user.id,
    userAvatar: getAvatar(member),
    memberAvatar: getAvatar(member),
    createdAt,
    joinedAt,
    leftAt,
    timestamp: type === 'leave' ? leftAt : createdAt,
  };
}

function templateSlotForType(type) {
  if (type === 'dmWelcome') return 'dm_welcome';
  return type;
}

function defaultTemplateForType(type) {
  if (type === 'welcome') return 'welcome_default';
  if (type === 'leave') return 'leave_default';
  if (type === 'dmWelcome') return 'dm_welcome_default';
  return null;
}

/* ---------------- PUBLIC WELCOME / LEAVE EMBEDS ---------------- */

function getDefaultPresetName(guildId, type) {
  if (typeof guildManager.getEmbedDefaultPreset === 'function') {
    const value = guildManager.getEmbedDefaultPreset(guildId, type);
    if (typeof value === 'string') return value;
    if (value?.name) return value.name;
    if (value?.presetName) return value.presetName;
  }

  const defaults = typeof guildManager.getEmbedDefaults === 'function' ? guildManager.getEmbedDefaults(guildId) : null;
  return defaults?.[type] || null;
}

function getDefaultPresetData(guildId, type) {
  const defaultPresetName = getDefaultPresetName(guildId, type);

  if (defaultPresetName && typeof guildManager.getEmbedPreset === 'function') {
    const preset = guildManager.getEmbedPreset(guildId, defaultPresetName);
    if (preset) return preset;
  }

  const directDefault = typeof guildManager.getEmbedDefaultPreset === 'function' ? guildManager.getEmbedDefaultPreset(guildId, type) : null;
  if (directDefault && typeof directDefault === 'object') return directDefault;

  return null;
}

function getSharedTemplateMessageData(member, type) {
  const guildId = member.guild.id;
  const sectionConfig = guildManager.getGuildSection(guildId, type, null) || guildManager.getGuildSection(guildId, `${type}Settings`, null) || {};
  const slot = templateSlotForType(type);
  const fallbackTemplateId = sectionConfig.templateId || defaultTemplateForType(type);
  const rendered = embedTemplateManager.renderBinding(guildId, 'welcome', slot, buildMemberTemplateVariables(member, type), fallbackTemplateId);

  if (!rendered) return null;

  return {
    ...sectionConfig,
    ...rendered.embed,
    content: rendered.content,
    message: rendered.content,
    embed: rendered.embed,
    sharedTemplateId: rendered.templateId,
    sharedTemplateName: rendered.name,
  };
}

async function sendPublicMemberEmbed(member, type) {
  try {
    const guild = member.guild;
    const sharedTemplateData = getSharedTemplateMessageData(member, type);
    const defaultPreset = getDefaultPresetData(guild.id, type);
    const sectionConfig = guildManager.getGuildSection(guild.id, type, null) || guildManager.getGuildSection(guild.id, `${type}Settings`, null) || {};
    const messageData = {
      ...(TEMPLATES[type] || {}),
      ...(sectionConfig || {}),
      ...(defaultPreset || {}),
      ...(sharedTemplateData || {}),
    };
    const channelId = messageData.channelId || sectionConfig.channelId || guildManager.getGuildSection(guild.id, `${type}Settings`, {})?.channelId || guildManager.getGuildSection(guild.id, type, {})?.channelId || null;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel?.isTextBased()) return;
    const fakeInteraction = { guild, guildId: guild.id, user: member.user, member };
    const content = messageData.content || (messageData.allowUserPing ? `<@${member.user.id}>` : '');

    await channel.send({
      content,
      embeds: [buildPreviewEmbed(messageData, fakeInteraction)],
      allowedMentions: messageData.allowUserPing || content.includes(`<@${member.user.id}>`)
        ? { users: [member.user.id], roles: [], repliedUser: false }
        : { parse: [], repliedUser: false },
    });
  } catch (error) {
    console.error(`[joinLeave] Failed to send public ${type} embed:`, error);
  }
}

/* ---------------- REMOVAL DETECTION ---------------- */

const REMOVAL_TYPES = {
  left: { key: 'left', title: '👋 Member Left', color: '#ED4245', eventName: 'memberLeave', reasonLabel: 'No reason - user left normally' },
  kicked: { key: 'kicked', title: '👢 Member Kicked', color: '#FAA61A', eventName: 'memberKick', auditType: AuditLogEvent.MemberKick, reasonLabel: 'No reason provided' },
  banned: { key: 'banned', title: '🔨 Member Banned', color: '#ED4245', eventName: 'memberBan', auditType: AuditLogEvent.MemberBanAdd, reasonLabel: 'No reason provided' },
  pruned: { key: 'pruned', title: '🧹 Member Pruned / Removed', color: '#FEE75C', eventName: 'memberPrune', auditType: AuditLogEvent.MemberPrune, reasonLabel: 'Possible prune or bulk removal' },
  removed: { key: 'removed', title: '🚪 Member Removed', color: '#ED4245', eventName: 'memberRemove', reasonLabel: 'Removal type unknown' },
};

async function findRecentAuditLog(guild, userId, auditType, maxAgeMs = 15000) {
  if (!auditType) return null;
  try {
    const logs = await guild.fetchAuditLogs({ limit: 10, type: auditType });
    return logs.entries.find((entry) => {
      const targetId = entry.target?.id;
      const isTarget = !targetId || targetId === userId;
      const isRecent = Date.now() - entry.createdTimestamp < maxAgeMs;
      return isTarget && isRecent;
    }) || null;
  } catch (error) {
    console.warn(`[joinLeave] Audit log check failed for ${auditType}:`, error.message);
    return null;
  }
}

async function detectRemoval(member) {
  const guild = member.guild;
  const userId = member.user.id;
  const banLog = await findRecentAuditLog(guild, userId, AuditLogEvent.MemberBanAdd, 20000);
  if (banLog) return { ...REMOVAL_TYPES.banned, auditLog: banLog };
  const kickLog = await findRecentAuditLog(guild, userId, AuditLogEvent.MemberKick, 20000);
  if (kickLog) return { ...REMOVAL_TYPES.kicked, auditLog: kickLog };
  const pruneLog = await findRecentAuditLog(guild, userId, AuditLogEvent.MemberPrune, 30000);
  if (pruneLog) return { ...REMOVAL_TYPES.pruned, auditLog: pruneLog };
  return { ...REMOVAL_TYPES.left, auditLog: null };
}

/* ---------------- ADMIN MEMBER LOGS ---------------- */

async function getAdminMemberLogChannel(guild, eventName = 'memberJoin') {
  const channelId = guildManager.getLogChannelId(guild.id, eventName, 'member');
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  return channel?.isTextBased() ? channel : null;
}

function buildAdminJoinLog(member, addedRoles = []) {
  const guild = member.guild;
  return new EmbedBuilder()
    .setColor('#57F287')
    .setTitle('👥 Member Joined')
    .setThumbnail(getAvatar(member))
    .addFields(
      { name: 'User', value: formatUser(member.user), inline: true },
      { name: 'User ID', value: `\`${member.user.id}\``, inline: true },
      { name: 'Type', value: member.user.bot ? '🤖 Bot' : '👤 User', inline: true },
      { name: 'Account Created', value: `${formatTimestamp(member.user.createdTimestamp, 'R')}\n${formatTimestamp(member.user.createdTimestamp, 'F')}`, inline: true },
      { name: 'Joined Server', value: `${formatTimestamp(member.joinedTimestamp, 'R')}\n${formatTimestamp(member.joinedTimestamp, 'F')}`, inline: true },
      { name: 'Member Count', value: `\`${guild.memberCount}\``, inline: true },
      { name: 'Roles', value: getRolesText(member, addedRoles), inline: false }
    )
    .setFooter({ text: 'Admin Log' })
    .setTimestamp();
}

function buildAdminRemovalLog(member, removal) {
  const guild = member.guild;
  const auditLog = removal?.auditLog || null;
  const reason = auditLog?.reason || removal?.reasonLabel || 'No reason provided';
  const moderator = auditLog?.executor || null;
  const embed = new EmbedBuilder()
    .setColor(removal.color || '#ED4245')
    .setTitle(removal.title || '🚪 Member Removed')
    .setThumbnail(getAvatar(member))
    .addFields(
      { name: 'User', value: formatUser(member.user), inline: true },
      { name: 'User ID', value: `\`${member.user.id}\``, inline: true },
      { name: 'Type', value: member.user.bot ? '🤖 Bot' : '👤 User', inline: true },
      { name: 'Removal Type', value: `\`${removal.key || 'unknown'}\``, inline: true },
      { name: 'Account Created', value: `${formatTimestamp(member.user.createdTimestamp, 'R')}\n${formatTimestamp(member.user.createdTimestamp, 'F')}`, inline: true },
      { name: 'Joined Server', value: member.joinedTimestamp ? `${formatTimestamp(member.joinedTimestamp, 'R')}\n${formatTimestamp(member.joinedTimestamp, 'F')}` : 'Unknown', inline: true },
      { name: 'Member Count', value: `\`${guild.memberCount}\``, inline: true },
      { name: 'Roles', value: getRolesText(member), inline: false },
      { name: 'Reason', value: String(reason).slice(0, 1024), inline: false }
    )
    .setFooter({ text: 'Admin Log' })
    .setTimestamp();
  if (moderator) embed.addFields({ name: 'Moderator', value: formatUser(moderator), inline: true });
  return embed;
}

async function sendAdminMemberJoinLog(member, addedRoles = []) {
  try {
    const guild = member.guild;
    const eventName = 'memberJoin';
    if (!isLogEnabled(guild.id, eventName)) return;
    const channel = await getAdminMemberLogChannel(guild, eventName);
    if (!channel) return;
    await channel.send({ embeds: [buildAdminJoinLog(member, addedRoles)] });
  } catch (error) {
    console.error('[joinLeave] Failed to send admin member join log:', error);
  }
}

async function sendAdminMemberRemovalLog(member, removal) {
  try {
    const guild = member.guild;
    const logEventName = removal?.eventName || 'memberRemove';
    if (!isLogEnabled(guild.id, logEventName) && !isLogEnabled(guild.id, 'memberLeave')) return;
    const channel = await getAdminMemberLogChannel(guild, logEventName);
    if (!channel) return;
    await channel.send({ embeds: [buildAdminRemovalLog(member, removal)] });
  } catch (error) {
    console.error('[joinLeave] Failed to send admin member removal log:', error);
  }
}

/* ---------------- EVENTS ---------------- */

module.exports = [
  {
    name: 'guildMemberAdd',
    async execute(member) {
      await statsManager.handleGuildMemberAdd(member);

      const verificationResult = await verificationManager.handleMemberJoin(member).catch((error) => {
        console.error('[verification] Failed to process member join:', error);
        return { assigned: [] };
      });

      const addedRoles = (await autoRoleManager.applyAutoRoles(member).catch((error) => {
        console.error('[autoRoles] Failed to apply auto roles:', error);
        return [];
      })) || [];

      for (const role of verificationResult?.assigned || []) {
        if (!addedRoles.some((addedRole) => addedRole.id === role.id)) addedRoles.push(role);
      }

      await sendPublicMemberEmbed(member, 'welcome');
      await sendPublicMemberEmbed(member, 'dmWelcome');
      await sendAdminMemberJoinLog(member, addedRoles);
    },
  },
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      await verificationManager.handleMemberUpdate(oldMember, newMember).catch((error) => {
        console.error('[verification] Failed to process member update:', error);
      });
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(member) {
      await statsManager.handleGuildMemberRemove(member);
      const removal = await detectRemoval(member);
      await sendPublicMemberEmbed(member, 'leave');
      await sendAdminMemberRemovalLog(member, removal);
    },
  },
];
