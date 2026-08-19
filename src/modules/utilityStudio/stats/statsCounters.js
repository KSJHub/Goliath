'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const statsStore = require('./statsStore');

const COUNTER_TYPES = Object.freeze([
  'members',
  'humans',
  'bots',
  'messages',
  'voice',
  'channels',
  'roles',
  'date',
]);

const DEFAULT_COUNTER_SUITE = Object.freeze([
  { type: 'date', template: '📅 {date}' },
  { type: 'members', template: '👥 {count} MEMBERS' },
  { type: 'bots', template: '🔧 {count} DISCORD SERVICES' },
  { type: 'humans', template: '💎 {count} GEMS' },
]);

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function cleanType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!COUNTER_TYPES.includes(type)) throw new Error(`Counter type must be one of: ${COUNTER_TYPES.join(', ')}.`);
  return type;
}

function defaultTemplate(type) {
  if (type === 'date') return '📅 {date}';
  if (type === 'members') return '👥 {count} MEMBERS';
  if (type === 'humans') return '💎 {count} GEMS';
  if (type === 'bots') return '🔧 {count} DISCORD SERVICES';
  if (type === 'voice') return '🔊 {count} VOICE MINS';
  if (type === 'channels') return '📁 {count} CHANNELS';
  if (type === 'roles') return '🎭 {count} ROLES';
  return '💬 {count} MESSAGES';
}

function cleanCounter(input = {}) {
  const type = cleanType(input.type);
  const channelId = String(input.channelId || '').trim();
  const template = String(input.template || '').trim().slice(0, 90);

  if (!/^\d{15,25}$/.test(channelId)) throw new Error('A valid counter channel ID is required.');

  return {
    type,
    channelId,
    template: template || defaultTemplate(type),
    channelType: input.channelType || 'voice',
    source: input.source || 'custom',
    updatedAt: new Date().toISOString(),
  };
}

function listCounters(guildId) {
  return statsStore.getStats(guildId).counters || [];
}

function addCounter(guildId, input = {}, guildOrMeta = {}) {
  const counter = cleanCounter(input);
  return statsStore.updateStats(guildId, (stats) => ({
    ...stats,
    counters: [
      ...(Array.isArray(stats.counters) ? stats.counters.filter((item) => item.channelId !== counter.channelId) : []),
      counter,
    ],
  }), guildOrMeta);
}

function upsertCounterByType(guildId, input = {}, guildOrMeta = {}) {
  const counter = cleanCounter(input);
  return statsStore.updateStats(guildId, (stats) => ({
    ...stats,
    counters: [
      ...(Array.isArray(stats.counters) ? stats.counters.filter((item) => item.type !== counter.type) : []),
      counter,
    ],
  }), guildOrMeta);
}

function removeCounter(guildId, channelId, guildOrMeta = {}) {
  const cleanChannelId = String(channelId || '').trim();
  return statsStore.updateStats(guildId, (stats) => ({
    ...stats,
    counters: (Array.isArray(stats.counters) ? stats.counters : []).filter((item) => item.channelId !== cleanChannelId),
  }), guildOrMeta);
}

function cachedBotCount(guild) {
  return guild.members.cache.filter((member) => member.user?.bot).size;
}

function cachedHumanCount(guild) {
  const humans = guild.members.cache.filter((member) => !member.user?.bot).size;
  if (humans > 0) return humans;
  return Math.max(0, Number(guild.memberCount || 0) - cachedBotCount(guild));
}

function counterValue(guild, summary, type) {
  if (type === 'date') return { count: 0, date: formatDate() };
  if (type === 'members') return { count: Number(guild.memberCount || 0) };
  if (type === 'humans') return { count: cachedHumanCount(guild) };
  if (type === 'bots') return { count: cachedBotCount(guild) };
  if (type === 'messages') return { count: summary.totals.messages };
  if (type === 'voice') return { count: summary.totals.voiceMinutes };
  if (type === 'channels') return { count: guild.channels.cache.filter((channel) => channel.type !== ChannelType.GuildCategory).size };
  if (type === 'roles') return { count: guild.roles.cache.filter((role) => role.id !== guild.id).size };
  return { count: 0 };
}

function renderCounterName(guild, summary, counter) {
  const type = cleanType(counter.type);
  const values = counterValue(guild, summary, type);
  return String(counter.template || defaultTemplate(type))
    .replaceAll('{count}', Number(values.count || 0).toLocaleString('en-GB'))
    .replaceAll('{date}', values.date || formatDate())
    .slice(0, 100);
}

async function refreshCounters(guild) {
  if (!guild?.id) return [];

  await guild.channels.fetch().catch(() => null);
  await guild.members.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  const summary = statsStore.getSummary(guild.id);
  const counters = listCounters(guild.id);
  const results = [];

  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId) || await guild.channels.fetch(counter.channelId).catch(() => null);
    if (!channel?.setName) continue;

    const name = renderCounterName(guild, summary, counter);
    if (channel.name !== name) await channel.setName(name).catch(() => null);
    results.push({ channelId: counter.channelId, type: counter.type, name, changed: channel.name !== name });
  }

  return results;
}

async function findOrCreateCategory(guild, name = '📊 SERVER STATS') {
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: 'Goliath stats counter setup',
  });
}

async function createCounterChannel(guild, counter, parentId = null) {
  const summary = statsStore.getSummary(guild.id);
  const name = renderCounterName(guild, summary, counter);

  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: parentId || undefined,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.Connect],
      },
    ],
    reason: 'Goliath stats counter setup',
  });
}

function existingCounterForType(guildId, type) {
  const cleanCounterType = cleanType(type);
  return listCounters(guildId).find((counter) => counter.type === cleanCounterType) || null;
}

async function existingChannelForCounter(guild, counter) {
  if (!counter?.channelId) return null;
  return guild.channels.cache.get(counter.channelId) || await guild.channels.fetch(counter.channelId).catch(() => null);
}

async function createCounterSuite(guild, options = {}) {
  if (!guild?.id) throw new Error('A guild is required to create counter channels.');

  await guild.channels.fetch().catch(() => null);
  await guild.members.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);

  const category = await findOrCreateCategory(guild, options.categoryName || '📊 SERVER STATS');
  const created = [];
  const reused = [];
  const repaired = [];

  for (const preset of DEFAULT_COUNTER_SUITE) {
    const existing = existingCounterForType(guild.id, preset.type);
    const existingChannel = await existingChannelForCounter(guild, existing);

    if (existing && existingChannel) {
      const nextTemplate = existing.template || preset.template;
      upsertCounterByType(guild.id, {
        ...existing,
        type: preset.type,
        channelId: existingChannel.id,
        template: nextTemplate,
        channelType: 'voice',
        source: existing.source || 'default-suite',
      }, guild);
      reused.push({ channelId: existingChannel.id, type: preset.type, name: existingChannel.name });
      continue;
    }

    const channel = await createCounterChannel(guild, preset, category.id);
    upsertCounterByType(guild.id, {
      type: preset.type,
      channelId: channel.id,
      template: preset.template,
      channelType: 'voice',
      source: 'default-suite',
    }, guild);

    if (existing && !existingChannel) repaired.push({ oldChannelId: existing.channelId, channelId: channel.id, type: preset.type, name: channel.name });
    else created.push({ channelId: channel.id, type: preset.type, name: channel.name });
  }

  await refreshCounters(guild);

  return {
    categoryId: category.id,
    created,
    reused,
    repaired,
  };
}

module.exports = {
  COUNTER_TYPES,
  DEFAULT_COUNTER_SUITE,
  cleanCounter,
  listCounters,
  addCounter,
  upsertCounterByType,
  removeCounter,
  refreshCounters,
  createCounterSuite,
  defaultTemplate,
  renderCounterName,
};
