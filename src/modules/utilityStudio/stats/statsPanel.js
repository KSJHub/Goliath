'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');

const stats = require('./stats');

const PANEL_COLOR = 0x5865F2;
const SUCCESS_COLOR = 0x57F287;
const DANGER_COLOR = 0xED4245;
const WARNING_COLOR = 0xFAA61A;
const BULK_LIMIT = 25;

const TYPES = Object.freeze({
  channels: ['📁', 'Channels'],
  countdown: ['⏳', 'Countdown / Timer'],
  datetime: ['📅', 'Date & Time'],
  members: ['👥', 'Members'],
  status: ['🟢', 'Members with Status'],
  role: ['🎭', 'Members in Role'],
  roles: ['🏷️', 'Roles'],
  voice: ['🔊', 'Members in Voice'],
  messages: ['💬', 'Message Count'],
  voiceMinutes: ['🎙️', 'Voice Minutes'],
  joins: ['📥', 'Member Joins'],
  leaves: ['📤', 'Member Leaves'],
  boosts: ['🚀', 'Server Boosts'],
  emojis: ['😀', 'Emojis'],
});

const STATUSES = Object.freeze({
  online: ['🟢', 'Online'],
  idle: ['🟡', 'Idle'],
  dnd: ['🔴', 'Do Not Disturb'],
  offline: ['⚫', 'Offline'],
});

const bulkSelections = new Map();

const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style)
  .setDisabled(Boolean(disabled));

function select(customId, placeholder, options, minValues = 1, maxValues = 1) {
  const safeOptions = options.slice(0, 25);
  const safeMax = Math.max(1, Math.min(maxValues, safeOptions.length || 1));
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(Math.max(0, Math.min(minValues, safeMax)))
    .setMaxValues(safeMax)
    .addOptions(safeOptions);
}

function roleSelect(customId, placeholder, values = []) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(25);
  if (values.length) menu.setDefaultRoles(...values.slice(0, 25));
  return menu;
}

const displayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Management';
const listDocks = (guildId) => stats.counters.listCounters(guildId);
const findDock = (guildId, key) => listDocks(guildId).find((item) => item.id === key || item.channelId === key) || null;

function defaultSegment(type) {
  if (type === 'members') return { type, options: { humans: true, bots: true } };
  if (type === 'status') return { type, options: { statuses: ['online'] } };
  if (type === 'role') return { type, options: { roleIds: [], statuses: [] } };
  if (type === 'voice') return { type, options: { mode: 'all', channelIds: [] } };
  if (type === 'channels') return { type, options: { channelTypes: ['text', 'voice', 'category'] } };
  if (type === 'roles') return { type, options: { unmanaged: true, managed: false } };
  if (type === 'datetime') return { type, options: { format: 'weekday-short', timeZone: 'Europe/London' } };
  if (type === 'countdown') return { type, options: { timestamp: Date.now() + 86400000, includeDays: true, includeHours: true, includeMinutes: true, endText: 'Countdown complete!' } };
  return { type, options: {} };
}

function typeOptions(selected = null) {
  return Object.entries(TYPES).map(([value, [emoji, label]]) => ({
    label,
    value,
    emoji,
    default: value === selected,
    description: value === 'role'
      ? 'Count members in selected roles'
      : value === 'status'
        ? 'Online, idle, DND or offline members'
        : `Show ${label.toLowerCase()}`,
  }));
}

function optionDefaults(items, values = []) {
  const selected = new Set(values.filter(Boolean).map(String));
  return items.map((item) => ({ ...item, default: selected.has(String(item.value)) }));
}

function roleName(guild, ids = []) {
  return ids.length === 1 ? (guild.roles.cache.get(ids[0])?.name || 'Role') : 'Roles';
}

function segmentTemplate(guild, segment, placeholder) {
  const options = segment.options || {};
  if (segment.type === 'datetime') return `📅 ${placeholder}`;
  if (segment.type === 'countdown') return `⏳ ${placeholder}`;
  if (segment.type === 'status') {
    const statuses = options.statuses || [];
    if (statuses.length === 1 && STATUSES[statuses[0]]) {
      const [emoji, label] = STATUSES[statuses[0]];
      return `${emoji} ${label}: ${placeholder}`;
    }
    return `🟢 Status: ${placeholder}`;
  }
  if (segment.type === 'role') return `🎭 ${roleName(guild, options.roleIds || [])}: ${placeholder}`;
  const [emoji, label] = TYPES[segment.type] || ['📊', 'Counter'];
  return `${emoji} ${label}: ${placeholder}`;
}

const generatedTemplate = (guild, segments) => segments.map((segment, index) => segmentTemplate(guild, segment, `{${index + 1}}`)).join(' • ').slice(0, 100);
const generatedName = (segments) => segments.length > 1 ? 'Combined Counter' : (TYPES[segments[0]?.type]?.[1] || 'Counter');

function configuredCategory(guild) {
  const all = listDocks(guild.id);
  const storedId = all.find((item) => item.categoryId)?.categoryId;
  if (storedId) {
    const stored = guild.channels.cache.get(storedId);
    if (stored?.type === ChannelType.GuildCategory) return stored;
  }
  const wanted = String(stats.getConfig(guild.id).settings?.categoryName || '📊 SERVER STATS');
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === wanted.toLowerCase())
    || guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && /server\s*stats/i.test(channel.name))
    || null;
}

async function ensureCategory(guild) {
  const existing = configuredCategory(guild);
  if (existing) return existing;
  const name = String(stats.getConfig(guild.id).settings?.categoryName || '📊 SERVER STATS').slice(0, 100);
  return guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Goliath Stats category setup' });
}

const stripLeadingSymbols = (name) => String(name || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

function detectCounter(guild, channel) {
  const plain = stripLeadingSymbols(channel.name);
  const lower = plain.toLowerCase();
  let type;
  let name;
  let template;
  let options = {};

  if (/countdown|timer/.test(lower)) { type = 'countdown'; name = 'Countdown / Timer'; template = '⏳ Countdown / Timer: {value}'; }
  else if (/\bmember\s+joins?\b|\bjoins?\b/.test(lower)) { type = 'joins'; name = 'Member Joins'; template = '📥 Member Joins: {value}'; }
  else if (/\bmember\s+leaves?\b|\bleaves?\b/.test(lower)) { type = 'leaves'; name = 'Member Leaves'; template = '📤 Member Leaves: {value}'; }
  else if (/\bin\s+voice\b|\bvoice\s+members?\b/.test(lower)) { type = 'voice'; name = 'Members in Voice'; template = '🔊 In Voice: {value}'; options = { mode: 'all', channelIds: [] }; }
  else if (/\bonline\b/.test(lower)) { type = 'status'; name = 'Online'; template = '🟢 Online: {value}'; options = { statuses: ['online'] }; }
  else if (/\bidle\b/.test(lower)) { type = 'status'; name = 'Idle'; template = '🟡 Idle: {value}'; options = { statuses: ['idle'] }; }
  else if (/\b(?:dnd|do not disturb)\b/.test(lower)) { type = 'status'; name = 'Do Not Disturb'; template = '🔴 Do Not Disturb: {value}'; options = { statuses: ['dnd'] }; }
  else if (/\boffline\b/.test(lower)) { type = 'status'; name = 'Offline'; template = '⚫ Offline: {value}'; options = { statuses: ['offline'] }; }
  else if (/\bmembers?\b/.test(lower)) { type = 'members'; name = 'Members'; template = '👥 Members: {value}'; options = { humans: true, bots: true }; }
  else if (/\bvoice\s+minutes?\b/.test(lower)) { type = 'voiceMinutes'; name = 'Voice Minutes'; template = '🎙️ Voice Minutes: {value}'; }
  else if (/\bmessages?\b/.test(lower)) { type = 'messages'; name = 'Message Count'; template = '💬 Messages: {value}'; }
  else if (/\bboosts?\b/.test(lower)) { type = 'boosts'; name = 'Server Boosts'; template = '🚀 Boosts: {value}'; }
  else if (/\bemojis?\b/.test(lower)) { type = 'emojis'; name = 'Emojis'; template = '😀 Emojis: {value}'; }
  else if (/^(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(plain) || /^\d{1,2}[\/-]\d{1,2}/.test(plain)) {
    type = 'datetime'; name = 'Date & Time'; template = '📅 {value}';
    options = { format: 'weekday-short', timeZone: stats.getConfig(guild.id).settings?.timeZone || 'Europe/London' };
  } else {
    const label = plain.split(':')[0]?.trim();
    const role = label && guild.roles.cache.find((item) => item.id !== guild.id && item.name.toLowerCase() === label.toLowerCase());
    if (role) { type = 'role'; name = `Role: ${role.name}`; template = `🎭 ${role.name}: {value}`; options = { roleIds: [role.id], statuses: [] }; }
  }
  return type ? { type, name, template, options } : null;
}

function looksRenderedCounter(channel, spec, statsCategory) {
  if (!spec) return false;
  if (channel.parentId && statsCategory?.id === channel.parentId) return true;
  const plain = stripLeadingSymbols(channel.name);
  return /\d/.test(plain) || (channel.type === ChannelType.GuildVoice && spec.type === 'countdown' && /countdown|timer/i.test(plain));
}

function unsavedCounters(guild) {
  const savedIds = new Set(listDocks(guild.id).map((item) => item.channelId).filter(Boolean));
  const statsCategory = configuredCategory(guild);
  return [...guild.channels.cache.values()]
    .filter((channel) => !savedIds.has(channel.id) && [ChannelType.GuildVoice, ChannelType.GuildText].includes(channel.type))
    .map((channel) => ({ channel, spec: detectCounter(guild, channel) }))
    .filter(({ channel, spec }) => looksRenderedCounter(channel, spec, statsCategory));
}

async function cleanupFalseAdoptions(guild) {
  const statsCategory = configuredCategory(guild);
  for (const item of listDocks(guild.id)) {
    if (!['adopted', 'default-suite'].includes(item.source) || !item.channelId) continue;
    const channel = guild.channels.cache.get(item.channelId) || await guild.channels.fetch(item.channelId).catch(() => null);
    if (!channel) continue;
    const spec = detectCounter(guild, channel);
    if (!looksRenderedCounter(channel, spec, statsCategory))