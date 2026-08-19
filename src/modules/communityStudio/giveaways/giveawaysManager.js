'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const giveawaysStore = require('./giveawaysStore');
const guildManager = require('../../../core/guild/guildManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');
const leveling = require('../leveling/leveling');

const ENTER_EMOJI = '🎉';
const GIVEAWAY_SCHEDULER_ID = 'giveaways:expiry:global';

function isManager(member, section = {}) {
  if (!member) return false;
  if (
    member.permissions?.has?.(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has?.(PermissionFlagsBits.ManageMessages) ||
    member.permissions?.has?.(PermissionFlagsBits.Administrator)
  ) return true;
  return (section.managerRoleIds || []).some((roleId) => member.roles?.cache?.has(roleId));
}

function parseDurationMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(60_000, value);
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return 60 * 60 * 1000;
  const amount = Number(match[1]);
  if (match[2] === 'm') return amount * 60 * 1000;
  if (match[2] === 'h') return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function getLevelingEligibility(section = {}) {
  const config = section.levelingEligibility && typeof section.levelingEligibility === 'object'
    ? section.levelingEligibility
    : {};
  const sortBy = ['xp', 'level', 'messages', 'voice'].includes(String(config.sortBy || '').toLowerCase())
    ? String(config.sortBy).toLowerCase()
    : 'xp';
  return {
    enabled: config.enabled === true,
    minLevel: Math.max(0, Math.floor(Number(config.minLevel || 0))),
    minXp: Math.max(0, Math.floor(Number(config.minXp || 0))),
    top: Math.max(0, Math.min(500, Math.floor(Number(config.top || 0)))),
    sortBy,
    activeOnly: config.activeOnly !== false,
  };
}

function levelingEligibilityText(section = {}) {
  const config = getLevelingEligibility(section);
  if (!config.enabled) return null;
  const rules = [];
  if (config.minLevel) rules.push(`Level ${config.minLevel}+`);
  if (config.minXp) rules.push(`${config.minXp.toLocaleString()}+ XP`);
  if (config.top) rules.push(`Top ${config.top} by ${config.sortBy}`);
  if (config.activeOnly) rules.push('Leveling enabled');
  return rules.length ? rules.join(' · ') : 'Active Leveling participant';
}

function getLevelingEligibleUsers(guildId, section = {}) {
  const config = getLevelingEligibility(section);
  if (!config.enabled) return null;
  if (!guildManager.isModuleEnabled(guildId, 'leveling')) return [];
  return leveling.getEligibleUsers(guildId, {
    minLevel: config.minLevel,
    minXp: config.minXp,
    top: config.top || null,
    includePaused: !config.activeOnly,
    sortBy: config.sortBy,
  });
}

function getLevelingEligibilityFailure(guildId, userId, section = {}) {
  const config = getLevelingEligibility(section);
  if (!config.enabled) return null;
  if (!guildManager.isModuleEnabled(guildId, 'leveling')) {
    return 'This giveaway requires Leveling eligibility, but Leveling is currently disabled in this server.';
  }

  const user = leveling.getUser(guildId, userId);
  if (!user) return 'You need a Leveling record before you can enter this giveaway.';
  if (config.activeOnly && !leveling.isUserParticipating(guildId, userId)) {
    return 'You must have Leveling enabled on your account to enter this giveaway.';
  }
  if (Number(user.level || 0) < config.minLevel) {
    return `You must be at least Level ${config.minLevel} to enter this giveaway.`;
  }
  if (Number(user.xp || 0) < config.minXp) {
    return `You must have at least ${config.minXp.toLocaleString()} XP to enter this giveaway.`;
  }
  if (config.top > 0) {
    const eligibleIds = new Set((getLevelingEligibleUsers(guildId, section) || []).map((entry) => String(entry.userId)));
    if (!eligibleIds.has(String(userId))) {
      return `You must be within the top ${config.top} members by ${config.sortBy} to enter this giveaway.`;
    }
  }
  return null;
}

function filterEntriesByLevelingEligibility(guildId, entries = [], section = {}) {
  const config = getLevelingEligibility(section);
  const uniqueEntries = [...new Set(entries)];
  if (!config.enabled) return uniqueEntries;
  const eligibleIds = new Set((getLevelingEligibleUsers(guildId, section) || []).map((entry) => String(entry.userId)));
  return uniqueEntries.filter((userId) => eligibleIds.has(String(userId)));
}

function buildGiveawayEmbed(giveaway, section = {}) {
  const ended = giveaway.status === 'ended';
  const winners = giveaway.winners?.length
    ? giveaway.winners.map((id) => `<@${id}>`).join(', ')
    : 'Not drawn yet';
  const xpEligibility = levelingEligibilityText(section);
  return new EmbedBuilder()
    .setColor(ended ? 0x57f287 : 0xfaa61a)
    .setTitle(`🎉 ${giveaway.prize}`)
    .setDescription([
      giveaway.description || 'Click the button below or react with 🎉 to enter.',
      '',
      `**Status:** ${giveaway.status}`,
      `**Entries:** ${giveaway.entries?.length || 0}`,
      `**Winner Count:** ${giveaway.winnerCount || 1}`,
      xpEligibility ? `**XP Eligibility:** ${xpEligibility}` : null,
      `**Winners:** ${winners}`,
      giveaway.endsAt ? `**Ends:** <t:${Math.floor(new Date(giveaway.endsAt).getTime() / 1000)}:R>` : null,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: `Giveaway ID: ${giveaway.giveawayId}` })
    .setTimestamp(new Date(giveaway.updatedAt || Date.now()));
}

function buildGiveawayRows(giveaway) {
  if (giveaway.status !== 'active') return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaways:enter:${giveaway.giveawayId}`)
        .setLabel(`Enter (${giveaway.entries?.length || 0})`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`giveaways:end:${giveaway.giveawayId}`)
        .setLabel('End')
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function pickWinners(entries = [], count = 1) {
  const pool = [...new Set(entries)];
  const winners = [];
  while (pool.length && winners.length < Math.max(1, Number(count) || 1)) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}

function hasEntryRoles(member, giveaway, section) {
  const requiredRoleIds = giveaway.requiredRoleIds?.length
    ? giveaway.requiredRoleIds
    : section.requiredRoleIds || [];
  const blockedRoleIds = giveaway.blockedRoleIds?.length
    ? giveaway.blockedRoleIds
    : section.blockedRoleIds || [];
  if ((section.requireRole || requiredRoleIds.length) && requiredRoleIds.length) {
    if (!requiredRoleIds.some((roleId) => member?.roles?.cache?.has(roleId))) return false;
  }
  if (blockedRoleIds.some((roleId) => member?.roles?.cache?.has(roleId))) return false;
  return true;
}

async function refreshGiveawayMessage(guild, giveawayId) {
  const section = giveawaysStore.getSection(guild.id);
  const giveaway = giveawaysStore.getGiveaway(guild.id, giveawayId);
  if (!giveaway?.channelId || !giveaway.messageId) return null;
  const channel = guild.channels.cache.get(giveaway.channelId)
    || await guild.channels.fetch(giveaway.channelId).catch(() => null);
  const message = await channel?.messages?.fetch(giveaway.messageId).catch(() => null);
  if (!message?.editable) return null;
  await message.edit({ embeds: [buildGiveawayEmbed(giveaway, section)], components: buildGiveawayRows(giveaway) }).catch(() => null);
  return giveaway;
}

async function createGiveaway(guildOrChannel, input = {}) {
  const guild = guildOrChannel?.guild || guildOrChannel;
  if (!guild?.id) throw new Error('A guild is required to create a giveaway.');
  const section = giveawaysStore.getSection(guild.id);
  if (!guildManager.isModuleEnabled(guild.id, 'giveaways')) throw new Error('Giveaways are disabled.');

  const providedChannel = guildOrChannel?.guild ? guildOrChannel : null;
  const channelId = providedChannel?.id || input.channelId || section.announcementChannelId;
  if (!channelId) throw new Error('Choose an announcement channel first.');
  const channel = providedChannel || guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Announcement channel is not sendable.');

  const endsAt = input.endsAt || new Date(Date.now() + parseDurationMs(input.duration || input.durationMs)).toISOString();
  let giveaway = giveawaysStore.saveGiveaway(guild.id, {
    prize: input.prize || 'Test Giveaway Prize',
    description: input.description || 'Click Enter or react with 🎉 to join this giveaway.',
    winnerCount: input.winnerCount || section.defaultWinnerCount || 1,
    endsAt,
    channelId: channel.id,
    createdBy: input.createdBy || input.hostId,
    requiredRoleIds: input.requiredRoleIds || [],
    blockedRoleIds: input.blockedRoleIds || [],
    status: 'active',
  }, guild);

  const message = await channel.send({ embeds: [buildGiveawayEmbed(giveaway, section)], components: buildGiveawayRows(giveaway) });
  await message.react(ENTER_EMOJI).catch(() => null);
  giveaway = giveawaysStore.saveGiveaway(guild.id, { ...giveaway, messageId: message.id, channelId: channel.id }, guild);
  giveawaysStore.incrementAnalytics(guild.id, { created: 1 }, guild);
  return giveaway;
}

async function addEntry(guild, giveawayId, userId, member = null) {
  const section = giveawaysStore.getSection(guild.id);
  if (!guildManager.isModuleEnabled(guild.id, 'giveaways')) throw new Error('Giveaways are disabled.');
  const giveaway = giveawaysStore.getGiveaway(guild.id, giveawayId);
  if (!giveaway || giveaway.status !== 'active') throw new Error('This giveaway is not active.');
  if (!hasEntryRoles(member, giveaway, section)) throw new Error('You do not have the required role to enter this giveaway.');
  const levelingFailure = getLevelingEligibilityFailure(guild.id, userId, section);
  if (levelingFailure) throw new Error(levelingFailure);

  const entries = Array.isArray(giveaway.entries) ? [...giveaway.entries] : [];
  if (!section.allowMultipleEntries && entries.includes(userId)) return giveaway;
  entries.push(userId);
  const updated = giveawaysStore.updateGiveaway(guild.id, giveawayId, { entries }, guild);
  giveawaysStore.incrementAnalytics(guild.id, { entries: 1 }, guild);
  await refreshGiveawayMessage(guild, giveawayId);
  return updated;
}

async function removeEntry(guild, giveawayId, userId) {
  const giveaway = giveawaysStore.getGiveaway(guild.id, giveawayId);
  if (!giveaway || giveaway.status !== 'active') return null;
  const updated = giveawaysStore.updateGiveaway(guild.id, giveawayId, {
    entries: (giveaway.entries || []).filter((id) => id !== userId),
  }, guild);
  await refreshGiveawayMessage(guild, giveawayId);
  return updated;
}

async function enterGiveaway(interaction, giveawayId) {
  return addEntry(interaction.guild, giveawayId, interaction.user.id, interaction.member);
}

async function enterGiveawayReaction(reaction, user) {
  if (user?.bot || reaction.emoji?.name !== ENTER_EMOJI) return null;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
  const guild = reaction.message?.guild;
  if (!guild?.id) return null;
  const giveaway = giveawaysStore.getActiveGiveaways(guild.id)
    .find((item) => item.messageId === reaction.message.id);
  if (!giveaway) return null;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;
  return addEntry(guild, giveaway.giveawayId, user.id, member).catch(() => null);
}

async function leaveGiveawayReaction(reaction, user) {
  if (user?.bot || reaction.emoji?.name !== ENTER_EMOJI) return null;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
  const guild = reaction.message?.guild;
  if (!guild?.id) return null;
  const giveaway = giveawaysStore.getActiveGiveaways(guild.id)
    .find((item) => item.messageId === reaction.message.id);
  if (!giveaway) return null;
  return removeEntry(guild, giveaway.giveawayId, user.id);
}

async function endGiveawayById(client, guildId, giveawayId, actorMember = null) {
  const section = giveawaysStore.getSection(guildId);
  if (!guildManager.isModuleEnabled(guildId, 'giveaways')) throw new Error('Giveaways are disabled.');
  if (actorMember && !isManager(actorMember, section)) throw new Error('You do not have permission to end giveaways.');
  const giveaway = giveawaysStore.getGiveaway(guildId, giveawayId);
  if (!giveaway || giveaway.status !== 'active') return null;

  const eligibleEntries = filterEntriesByLevelingEligibility(guildId, giveaway.entries || [], section);
  const winners = pickWinners(eligibleEntries, giveaway.winnerCount || 1);
  const updated = giveawaysStore.updateGiveaway(guildId, giveawayId, {
    status: 'ended',
    winners,
    endedAt: new Date().toISOString(),
  });
  giveawaysStore.incrementAnalytics(guildId, { ended: 1 });

  const guild = client?.guilds?.cache?.get(guildId)
    || await client?.guilds?.fetch?.(guildId).catch(() => null);
  if (guild) {
    await refreshGiveawayMessage(guild, giveawayId);
    const channel = guild.channels.cache.get(giveaway.channelId)
      || await guild.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel?.send) {
      await channel.send(winners.length
        ? `🎉 Giveaway ended! Winner(s): ${winners.map((id) => `<@${id}>`).join(', ')}`
        : '🎉 Giveaway ended with no valid entries.').catch(() => null);
    }
  }
  return updated;
}

async function endGiveaway(interaction, giveawayId) {
  return endGiveawayById(interaction.client, interaction.guildId, giveawayId, interaction.member);
}

async function rerollGiveaway(client, guildId, giveawayId) {
  const section = giveawaysStore.getSection(guildId);
  const giveaway = giveawaysStore.getGiveaway(guildId, giveawayId);
  if (!giveaway || giveaway.status !== 'ended') return null;
  const eligibleEntries = filterEntriesByLevelingEligibility(guildId, giveaway.entries || [], section);
  const winners = pickWinners(eligibleEntries, giveaway.winnerCount || 1);
  const updated = giveawaysStore.updateGiveaway(guildId, giveawayId, { winners });
  giveawaysStore.incrementAnalytics(guildId, { rerolls: 1 });
  const guild = client?.guilds?.cache?.get(guildId)
    || await client?.guilds?.fetch?.(guildId).catch(() => null);
  if (guild) await refreshGiveawayMessage(guild, giveawayId);
  return updated;
}

async function checkExpiredGiveaways(client) {
  const ended = [];
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    if (!guildManager.isModuleEnabled(guild.id, 'giveaways')) continue;
    for (const giveaway of giveawaysStore.getActiveGiveaways(guild.id)) {
      if (giveaway.endsAt && new Date(giveaway.endsAt).getTime() <= Date.now()) {
        const result = await endGiveawayById(client, guild.id, giveaway.giveawayId).catch(() => null);
        if (result) ended.push(result);
      }
    }
  }
  return ended;
}

function startGiveawayScheduler(client, intervalMs = 60_000) {
  if (!client || client.__goliathGiveawaySchedulerStarted) return null;
  client.__goliathGiveawaySchedulerStarted = true;
  const cadence = Math.max(30_000, Number(intervalMs) || 60_000);
  sentinelScheduler.register({
    id: GIVEAWAY_SCHEDULER_ID,
    module: 'giveaways',
    component: 'expiry-check',
    intervalMs: cadence,
    staleAfterMs: Math.max(cadence * 3, 180_000),
  });
  const run = async () => {
    try {
      const ended = await checkExpiredGiveaways(client);
      sentinelScheduler.beat(GIVEAWAY_SCHEDULER_ID, { ended: ended.length });
      return ended;
    } catch (error) {
      sentinelScheduler.fail(GIVEAWAY_SCHEDULER_ID, error);
      throw error;
    }
  };
  run().catch((error) => console.error('[Giveaways] Initial scheduler check failed:', error));
  const timer = setInterval(() => {
    run().catch((error) => console.error('[Giveaways] Scheduler failed:', error));
  }, cadence);
  timer.unref?.();
  return timer;
}

async function deployTestGiveaway(guild, actorId = null) {
  return createGiveaway(guild, {
    prize: 'Test Giveaway Prize',
    description: 'This is a test giveaway created from the Goliath Admin Panel.',
    winnerCount: 1,
    createdBy: actorId,
  });
}

module.exports = {
  ENTER_EMOJI,
  isManager,
  canManageGiveaways: isManager,
  parseDurationMs,
  getLevelingEligibility,
  getLevelingEligibilityFailure,
  filterEntriesByLevelingEligibility,
  buildGiveawayEmbed,
  buildGiveawayRows,
  createGiveaway,
  enterGiveaway,
  enterGiveawayReaction,
  leaveGiveawayReaction,
  endGiveaway,
  endGiveawayById,
  rerollGiveaway,
  refreshGiveawayMessage,
  checkExpiredGiveaways,
  startGiveawayScheduler,
  deployTestGiveaway,
};