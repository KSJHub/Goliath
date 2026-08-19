'use strict';

const { PermissionFlagsBits } = require('discord.js');
const leveling = require('./leveling');
const panel = require('./levelingPanel');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const voiceSessions = new Map();

function cleanIdSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean));
}

function memberHasIgnoredRole(member, section) {
  const ignored = cleanIdSet(section?.ignoredRoleIds);
  if (!ignored.size || !member?.roles?.cache) return false;
  return [...member.roles.cache.keys()].some((roleId) => ignored.has(String(roleId)));
}

function isIgnoredChannel(channelId, section) {
  if (!channelId) return false;
  return cleanIdSet(section?.ignoredChannelIds).has(String(channelId));
}

function isXpIgnored(member, channelId, section) {
  return isIgnoredChannel(channelId, section) || memberHasIgnoredRole(member, section);
}

function earnedRewards(section, level) {
  const rewards = Array.isArray(section?.levelRewards) ? section.levelRewards : [];
  return rewards
    .filter((reward) => reward?.roleId && Number(reward.level || 0) <= Number(level || 0))
    .sort((left, right) => Number(left.level || 0) - Number(right.level || 0));
}

async function resolveManageableRole(member, roleId, botMember) {
  const role = member.guild.roles.cache.get(roleId)
    || await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role || role.managed || role.id === member.guild.id) return null;
  if (role.position >= botMember.roles.highest.position) return null;
  return role;
}

async function assignLevelRole(member, section, newLevel) {
  if (!member?.roles?.add || !member?.guild) return false;

  const rewards = earnedRewards(section, newLevel);
  if (!rewards.length) return false;

  const me = member.guild.members.me || await member.guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return false;

  const manageable = [];
  for (const reward of rewards) {
    const role = await resolveManageableRole(member, reward.roleId, me);
    if (role) manageable.push({ reward, role });
  }
  if (!manageable.length) return false;

  const highestEarned = manageable[manageable.length - 1];
  const rolesToAdd = section.removePreviousLevelRoles === true
    ? [highestEarned.role]
    : manageable.map((entry) => entry.role);

  const missingRoles = rolesToAdd.filter((role) => !member.roles.cache.has(role.id));
  if (missingRoles.length) {
    await member.roles.add(
      missingRoles,
      `Goliath leveling rewards through level ${newLevel}`,
    ).catch(() => null);
  }

  if (section.removePreviousLevelRoles === true && member.roles?.remove) {
    const keepId = highestEarned.role.id;
    const earnedRoleIds = new Set(rewards.map((reward) => String(reward.roleId)));
    const removable = [...member.roles.cache.values()]
      .filter((role) => earnedRoleIds.has(String(role.id)) && role.id !== keepId)
      .filter((role) => !role.managed && role.position < me.roles.highest.position);

    if (removable.length) {
      await member.roles.remove(
        removable,
        `Goliath replaced previous leveling ranks at level ${newLevel}`,
      ).catch(() => null);
    }
  }

  return rolesToAdd.every((role) => member.roles.cache.has(role.id));
}

async function resolveAnnouncementChannel(guild, section, fallbackChannelId = null) {
  const channelIds = [section.announceChannelId, fallbackChannelId, guild.systemChannelId].filter(Boolean);
  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.send) return channel;
  }
  return null;
}

async function announceMemberLevelUp(member, section, user, fallbackChannelId = null) {
  if (section.announceLevelUps === false || !member?.guild) return false;
  const channel = await resolveAnnouncementChannel(member.guild, section, fallbackChannelId);
  if (!channel) return false;
  await channel.send({ embeds: [panel.buildLevelUpEmbed(member, user)] }).catch(() => null);
  return true;
}

async function announceLevelUp(message, section, user) {
  return announceMemberLevelUp(message.member, section, user, message.channel?.id || null);
}

async function handleMessageCreate(message) {
  if (!message?.guild?.id || !message.member || message.author?.bot || message.webhookId) return false;
  if (!isModuleEnabled(message.guild.id, 'leveling')) return false;
  const section = leveling.getSection(message.guild.id);
  if (section.trackMessages === false || section.xpSources?.message?.enabled === false) return false;
  if (isXpIgnored(message.member, message.channelId, section)) return false;

  const result = leveling.awardMessageXp(message.guild.id, message.author.id, {
    actorId: message.author.id,
    action: 'leveling_message_xp',
  });
  if (!result) return false;

  if (result.levelledUp) {
    const freshSection = leveling.getSection(message.guild.id);
    await assignLevelRole(message.member, freshSection, result.newLevel);
    await announceLevelUp(message, freshSection, result.user);
  }
  return true;
}

function voiceSessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function voiceSchedulerId(guildId, userId) {
  return `leveling:voice-xp:${guildId}:${userId}`;
}

function stopVoiceSession(guildId, userId) {
  const key = voiceSessionKey(guildId, userId);
  const session = voiceSessions.get(key);
  if (!session) return false;
  clearInterval(session.timer);
  schedulerRegistry.stop(session.schedulerId || voiceSchedulerId(guildId, userId), 'voice session ended', {
    channelId: session.channelId,
    userId,
  });
  voiceSessions.delete(key);
  return true;
}

function stopGuildVoiceSessions(guildId) {
  const prefix = `${guildId}:`;
  let stopped = 0;
  for (const [key, session] of voiceSessions.entries()) {
    if (!key.startsWith(prefix)) continue;
    clearInterval(session.timer);
    schedulerRegistry.stop(session.schedulerId || voiceSchedulerId(guildId, key.slice(prefix.length)), 'guild voice sessions refreshed', {
      channelId: session.channelId,
    });
    voiceSessions.delete(key);
    stopped += 1;
  }
  return stopped;
}

function hasEligibleVoiceCompany(channel, userId) {
  if (!channel?.members) return false;
  return channel.members.some((member) => member.id !== userId && !member.user?.bot);
}

function isVoiceStateEligible(state, section = null) {
  const member = state?.member;
  if (!state?.channelId || !state.channel || !member || member.user?.bot) return false;
  if (state.selfDeaf || state.serverDeaf) return false;
  const config = section || (state.guild?.id ? leveling.getSection(state.guild.id) : null);
  if (config && isXpIgnored(member, state.channelId, config)) return false;
  return hasEligibleVoiceCompany(state.channel, member.id);
}

async function awardVoiceInterval(guildId, userId, channelId) {
  if (!isModuleEnabled(guildId, 'leveling')) return false;
  if (!leveling.isUserParticipating(guildId, userId)) return false;

  const section = leveling.getSection(guildId);
  const source = section.xpSources?.voice;
  if (section.trackVoice === false || !source?.enabled) return false;

  const guild = voiceSessions.get(voiceSessionKey(guildId, userId))?.guild;
  if (!guild) return false;
  const member = guild.members.cache.get(userId)
    || await guild.members.fetch(userId).catch(() => null);
  const state = member?.voice;
  if (!state || state.channelId !== channelId || !isVoiceStateEligible(state, section)) return false;

  const intervalMinutes = Math.max(1, Number(source.intervalMinutes || 10));
  const result = leveling.awardVoiceXp(
    guildId,
    userId,
    source.amount,
    intervalMinutes,
    { actorId: userId, action: 'leveling_voice_xp' },
  );
  if (!result) return false;

  if (result.levelledUp) {
    const freshSection = leveling.getSection(guildId);
    await assignLevelRole(member, freshSection, result.newLevel);
    await announceMemberLevelUp(member, freshSection, result.user, channelId);
  }
  return true;
}

function startVoiceSession(state) {
  const guildId = state?.guild?.id;
  const userId = state?.member?.id;
  if (!guildId || !userId) return false;
  if (!isModuleEnabled(guildId, 'leveling')) return false;
  if (!leveling.isUserParticipating(guildId, userId)) return false;

  const section = leveling.getSection(guildId);
  const source = section.xpSources?.voice;
  if (section.trackVoice === false || !source?.enabled || !isVoiceStateEligible(state, section)) return false;

  stopVoiceSession(guildId, userId);
  const intervalMinutes = Math.max(1, Number(source.intervalMinutes || 10));
  const intervalMs = intervalMinutes * 60 * 1000;
  const channelId = state.channelId;
  const schedulerId = voiceSchedulerId(guildId, userId);
  schedulerRegistry.register({
    id: schedulerId,
    module: 'leveling',
    component: 'voice-xp',
    guildId,
    guildName: state.guild?.name || null,
    intervalMs,
    staleAfterMs: Math.max(intervalMs * 3, 180_000),
    details: { userId, channelId, intervalMinutes },
  });
  const timer = setInterval(() => {
    awardVoiceInterval(guildId, userId, channelId)
      .then((awarded) => schedulerRegistry.beat(schedulerId, { awarded: awarded === true, channelId, userId }))
      .catch((error) => {
        schedulerRegistry.fail(schedulerId, error, { channelId, userId });
        console.error('[Leveling] Voice XP interval failed:', error?.stack || error?.message || error);
      });
  }, intervalMs);
  timer.unref?.();

  voiceSessions.set(voiceSessionKey(guildId, userId), {
    guild: state.guild,
    channelId,
    startedAt: Date.now(),
    intervalMinutes,
    schedulerId,
    timer,
  });
  return true;
}

function refreshGuildVoiceSessions(guild) {
  if (!guild?.id) return 0;
  stopGuildVoiceSessions(guild.id);
  if (!isModuleEnabled(guild.id, 'leveling')) return 0;

  const section = leveling.getSection(guild.id);
  if (section.trackVoice === false || section.xpSources?.voice?.enabled === false) return 0;

  let started = 0;
  for (const state of guild.voiceStates?.cache?.values?.() || []) {
    if (isVoiceStateEligible(state, section) && startVoiceSession(state)) started += 1;
  }
  return started;
}

function bootstrapVoiceSessions(client) {
  let started = 0;
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    started += refreshGuildVoiceSessions(guild);
  }
  return started;
}

async function handleVoiceStateUpdate(oldState, newState) {
  const guildId = newState?.guild?.id || oldState?.guild?.id;
  const userId = newState?.member?.id || oldState?.member?.id;
  if (!guildId || !userId) return false;

  const section = leveling.getSection(guildId);
  const movedChannel = oldState?.channelId !== newState?.channelId;
  const eligibilityChanged = isVoiceStateEligible(oldState, section) !== isVoiceStateEligible(newState, section);
  if (!movedChannel && !eligibilityChanged) return false;

  stopVoiceSession(guildId, userId);
  if (isVoiceStateEligible(newState, section)) startVoiceSession(newState);

  // Re-evaluate other members when someone joins or leaves, because solo users do not earn voice XP.
  const affectedChannels = [oldState?.channel, newState?.channel].filter(Boolean);
  for (const channel of affectedChannels) {
    for (const member of channel.members.values()) {
      if (member.user?.bot || member.id === userId) continue;
      stopVoiceSession(guildId, member.id);
      if (isVoiceStateEligible(member.voice, section)) startVoiceSession(member.voice);
    }
  }
  return true;
}

module.exports = {
  handleMessageCreate,
  handleVoiceStateUpdate,
  assignLevelRole,
  announceLevelUp,
  announceMemberLevelUp,
  earnedRewards,
  isXpIgnored,
  isVoiceStateEligible,
  startVoiceSession,
  stopVoiceSession,
  stopGuildVoiceSessions,
  refreshGuildVoiceSessions,
  bootstrapVoiceSessions,
};
