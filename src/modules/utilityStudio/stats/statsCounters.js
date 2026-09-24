'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const statsStore = require('./statsStore');
const { replaceVariables } = require('../../../core/guild/guildVariables');

const STATUS_VALUES = Object.freeze(['online', 'idle', 'dnd', 'offline']);
const COUNTER_TYPES = Object.freeze([
  'channels',
  'countdown',
  'datetime',
  'members',
  'status',
  'role',
  'roles',
  'voice',
  'messages',
  'voiceMinutes',
  'joins',
  'leaves',
  'boosts',
  'emojis',
]);

const PRESENCE_TRIO_PRESET = Object.freeze({
  name: 'Presence Trio',
  template: '🟢 {1} ⛔ {2} 🌙 {3}',
  segments: [
    { type: 'status', options: { statuses: ['online'] } },
    { type: 'status', options: { statuses: ['dnd'] } },
    { type: 'status', options: { statuses: ['idle'] } },
  ],
});

const DEFAULT_COUNTER_SUITE = Object.freeze([
  { name: 'Date & Time', template: '📅 {value}', segments: [{ type: 'datetime', options: { format: 'weekday-short' } }] },
  { name: 'Members', template: '👥 Members: {value}', segments: [{ type: 'members', options: { humans: true, bots: true } }] },
  PRESENCE_TRIO_PRESET,
  { name: 'In Voice', template: '🔊 In Voice: {value}', segments: [{ type: 'voice', options: {} }] },
]);

const dockSchedules = new Map();
const dockRefreshInFlight = new Set();

function safeString(value, max = 100) {
  return String(value ?? '').trim().slice(0, max);
}

function validId(value) {
  return /^\d{15,25}$/.test(String(value || '').trim());
}

function cleanType(value) {
  const aliases = { date: 'datetime', humans: 'members', bots: 'members', voiceactivity: 'voiceMinutes' };
  const raw = safeString(value, 40);
  const type = aliases[raw] || raw;
  if (!COUNTER_TYPES.includes(type)) throw new Error(`Unknown counter type: ${raw || 'empty'}.`);
  return type;
}

function cleanChannelType(value) {
  return String(value || '').toLowerCase() === 'text' ? 'text' : 'voice';
}

function defaultTemplate(type) {
  const templates = {
    channels: '📁 Channels: {value}', countdown: '⏳ {value}', datetime: '📅 {value}', members: '👥 Members: {value}',
    status: '🟢 Online: {value}', role: '🎭 Role: {value}', roles: '🎭 Roles: {value}', voice: '🔊 In Voice: {value}',
    messages: '💬 Messages: {value}', voiceMinutes: '🎙️ Voice Minutes: {value}', joins: '📥 Joins: {value}', leaves: '📤 Leaves: {value}',
    boosts: '🚀 Boosts: {value}', emojis: '😀 Emojis: {value}',
  };
  return templates[type] || '{value}';
}

function normalizeStatuses(value) {
  const values = Array.isArray(value) ? value : [];
  const cleaned = [...new Set(values.map((item) => safeString(item, 20).toLowerCase()).filter((item) => STATUS_VALUES.includes(item)))];
  return cleaned.length ? cleaned : [...STATUS_VALUES];
}

function normalizeCounterOptions(type, options = {}) {
  const input = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const clean = {};
  if (type === 'channels') {
    clean.channelTypes = Array.isArray(input.channelTypes) ? [...new Set(input.channelTypes.map((item) => safeString(item, 20)).filter((item) => ['text', 'voice', 'category'].includes(item)))] : ['text', 'voice', 'category'];
    if (!clean.channelTypes.length) clean.channelTypes = ['text', 'voice', 'category'];
  }
  if (type === 'countdown') {
    const timestamp = Number(input.timestamp || 0);
    clean.timestamp = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now() + 86400000;
    clean.includeDays = input.includeDays !== false;
    clean.includeHours = input.includeHours !== false;
    clean.includeMinutes = input.includeMinutes !== false;
    clean.endText = safeString(input.endText || 'Countdown complete!', 90);
  }
  if (type === 'datetime') {
    clean.format = safeString(input.format || 'weekday-short', 40);
    clean.timeZone = safeString(input.timeZone || 'Europe/London', 64);
  }
  if (type === 'members') {
    clean.humans = input.humans !== false;
    clean.bots = input.bots !== false;
    if (!clean.humans && !clean.bots) clean.humans = true;
  }
  if (type === 'status') clean.statuses = normalizeStatuses(input.statuses);
  if (type === 'role') {
    clean.roleIds = [...new Set((Array.isArray(input.roleIds) ? input.roleIds : []).map(String).filter(validId))].slice(0, 25);
    clean.statuses = input.statuses == null ? [] : normalizeStatuses(input.statuses);
  }
  if (type === 'roles') {
    clean.unmanaged = input.unmanaged !== false;
    clean.managed = input.managed === true;
    if (!clean.unmanaged && !clean.managed) clean.unmanaged = true;
  }
  if (type === 'voice') {
    clean.mode = ['all', 'whitelist', 'blacklist'].includes(input.mode) ? input.mode : 'all';
    clean.channelIds = [...new Set((Array.isArray(input.channelIds) ? input.channelIds : []).map(String).filter(validId))].slice(0, 25);
  }
  if (type === 'messages' || type === 'voiceMinutes') {
    const periodDays = Number(input.periodDays || 0);
    clean.periodDays = Number.isFinite(periodDays) && periodDays > 0 ? Math.max(1, Math.min(365, Math.floor(periodDays))) : null;
  }
  if (['channels', 'members', 'status', 'role', 'roles', 'voice', 'messages', 'voiceMinutes', 'joins', 'leaves', 'boosts', 'emojis'].includes(type)) {
    const goal = Number(input.goal);
    clean.goal = Number.isFinite(goal) && goal > 0 ? Math.floor(goal) : null;
  }
  return clean;
}

function cleanSegment(input = {}) {
  const type = cleanType(input.type);
  return { type, label: safeString(input.label, 40) || null, options: normalizeCounterOptions(type, input.options) };
}
function legacySegment(input = {}) {
  const rawType = safeString(input.type, 40);
  if (!rawType) return null;
  if (rawType === 'humans') return cleanSegment({ type: 'members', options: { humans: true, bots: false } });
  if (rawType === 'bots') return cleanSegment({ type: 'members', options: { humans: false, bots: true } });
  return cleanSegment({ type: rawType, options: input.options });
}
function cleanDock(input = {}) {
  const channelId = safeString(input.channelId, 25);
  const segmentsInput = Array.isArray(input.segments) && input.segments.length ? input.segments : [legacySegment(input)].filter(Boolean);
  if (!segmentsInput.length) throw new Error('At least one counter is required.');
  const segments = segmentsInput.slice(0, 4).map(cleanSegment);
  const defaultText = segments.length === 1 ? defaultTemplate(segments[0].type) : segments.map((_, index) => `{${index + 1}}`).join(' · ');
  const template = safeString(input.template || input.channelText || defaultText, 100) || defaultText;
  const frequencyMinutes = Math.max(10, Math.min(1440, Number(input.frequencyMinutes || 10) || 10));
  const now = new Date().toISOString();
  return {
    id: safeString(input.id, 40) || channelId || `dock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    channelId: validId(channelId) ? channelId : null,
    categoryId: validId(input.categoryId) ? String(input.categoryId) : null,
    channelType: cleanChannelType(input.channelType),
    name: safeString(input.name || 'Counter', 60) || 'Counter',
    enabled: input.enabled !== false,
    template,
    segments,
    frequencyMinutes,
    source: safeString(input.source || 'custom', 30) || 'custom',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}
function cleanCounter(input = {}) { return cleanDock(input); }
function normalizeStoredDock(input = {}) { try { return cleanDock(input); } catch { return null; } }
function listCounters(guildId) { return (statsStore.getStats(guildId).counters || []).map(normalizeStoredDock).filter(Boolean); }
function saveDock(guildId, input = {}, guildOrMeta = {}) {
  const dock = cleanDock({ ...input, updatedAt: new Date().toISOString() });
  return statsStore.updateStats(guildId, (stats) => ({ ...stats, counters: [...(Array.isArray(stats.counters) ? stats.counters.filter((item) => String(item.id || item.channelId) !== String(dock.id) && (!dock.channelId || item.channelId !== dock.channelId)) : []), dock] }), guildOrMeta);
}
function addCounter(guildId, input = {}, guildOrMeta = {}) { return saveDock(guildId, input, guildOrMeta); }
function upsertCounterByType(guildId, input = {}, guildOrMeta = {}) {
  const segment = legacySegment(input) || cleanSegment(input);
  const existing = listCounters(guildId).find((dock) => dock.segments?.length === 1 && dock.segments[0].type === segment.type);
  return saveDock(guildId, { ...existing, ...input, id: existing?.id || input.id, segments: [segment] }, guildOrMeta);
}
function removeCounter(guildId, idOrChannelId, guildOrMeta = {}) {
  const target = String(idOrChannelId || '').trim();
  return statsStore.updateStats(guildId, (stats) => ({ ...stats, counters: (Array.isArray(stats.counters) ? stats.counters : []).filter((item) => String(item.id || '') !== target && String(item.channelId || '') !== target) }), guildOrMeta);
}
function cachedBotCount(guild) { return guild.members.cache.filter((member) => member.user?.bot).size; }
function cachedHumanCount(guild) {
  const humans = guild.members.cache.filter((member) => !member.user?.bot).size;
  if (guild.members.cache.size >= Number(guild.memberCount || 0)) return humans;
  return Math.max(0, Number(guild.memberCount || 0) - cachedBotCount(guild));
}
function memberStatus(member) { return member?.presence?.status || 'offline'; }
function matchesStatuses(member, statuses = []) { return !statuses.length || statuses.includes(memberStatus(member)); }
function countChannels(guild, options) {
  const wanted = new Set(options.channelTypes || ['text', 'voice', 'category']);
  return guild.channels.cache.filter((channel) => {
    if (channel.type === ChannelType.GuildCategory) return wanted.has('category');
    if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) return wanted.has('voice');
    if (channel.isTextBased?.() && !channel.isThread?.()) return wanted.has('text');
    return false;
  }).size;
}
function countMembers(guild, options) {
  const humans = options.humans !== false;
  const bots = options.bots !== false;
  if (humans && bots) return Number(guild.memberCount || guild.members.cache.size || 0);
  if (humans) return cachedHumanCount(guild);
  return cachedBotCount(guild);
}
function countStatuses(guild, options) {
  const statuses = normalizeStatuses(options.statuses);
  return guild.members.cache.filter((member) => matchesStatuses(member, statuses)).size;
}
function countRoles(guild, options) { return guild.roles.cache.filter((role) => role.id !== guild.id && ((role.managed && options.managed) || (!role.managed && options.unmanaged))).size; }
function countMembersInRoles(guild, options) {
  const roleIds = new Set(options.roleIds || []);
  if (!roleIds.size) return 0;
  const statuses = Array.isArray(options.statuses) ? options.statuses : [];
  return guild.members.cache.filter((member) => member.roles?.cache?.some((role) => roleIds.has(role.id)) && matchesStatuses(member, statuses)).size;
}
function countVoice(guild, options) {
  const selected = new Set(options.channelIds || []);
  const mode = options.mode || 'all';
  return guild.members.cache.filter((member) => {
    const channelId = member.voice?.channelId;
    if (!channelId) return false;
    if (mode === 'whitelist') return selected.has(channelId);
    if (mode === 'blacklist') return !selected.has(channelId);
    return true;
  }).size;
}
function formatDateTime(options = {}, now = new Date()) {
  const timeZone = options.timeZone || 'Europe/London';
  const presets = {
    'weekday-short': { weekday: 'short', day: 'numeric', month: 'short' }, 'weekday-long': { weekday: 'long', day: 'numeric', month: 'long' },
    date: { day: '2-digit', month: '2-digit', year: 'numeric' }, time: { hour: '2-digit', minute: '2-digit', hour12: false },
    'date-time': { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false },
  };
  const format = presets[options.format] || presets['weekday-short'];
  try { return new Intl.DateTimeFormat('en-GB', { ...format, timeZone }).format(now); }
  catch { return new Intl.DateTimeFormat('en-GB', format).format(now); }
}
function formatCountdown(options = {}, now = Date.now()) {
  const remaining = Math.max(0, Number(options.timestamp || 0) - now);
  if (remaining <= 0) return options.endText || 'Countdown complete!';
  let minutes = Math.ceil(remaining / 60000);
  const parts = [];
  if (options.includeDays !== false) { const days = Math.floor(minutes / 1440); if (days) parts.push(`${days}d`); minutes %= 1440; }
  if (options.includeHours !== false) { const hours = Math.floor(minutes / 60); if (hours || parts.length) parts.push(`${hours}h`); minutes %= 60; }
  if (options.includeMinutes !== false || !parts.length) parts.push(`${minutes}m`);
  return parts.join(' ');
}
function applyGoal(value, options = {}) {
  const goal = Number(options.goal || 0);
  if (!goal) return value;
  return Math.max(0, goal - Number(value || 0));
}
function rollingActivityTotal(guildId, type, periodDays) {
  const days = Math.max(1, Math.min(365, Number(periodDays || 0) || 0));
  if (!days) return null;
  const stats = statsStore.getStats(guildId);
  const source = type === 'messages' ? stats.data?.messages : stats.data?.voice;
  if (!source || typeof source !== 'object') return 0;
  const cutoff = Date.now() - (days - 1) * 86400000;
  return Object.entries(source).reduce((total, [day, value]) => {
    const timestamp = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || timestamp < cutoff) return total;
    return total + Number(type === 'messages' ? value?.total : value?.totalMinutes || 0);
  }, 0);
}
function counterValue(guild, summary, segment) {
  const type = segment.type;
  const options = segment.options || {};
  if (type === 'datetime') return formatDateTime(options);
  if (type === 'countdown') return formatCountdown(options);
  let value = 0;
  if (type === 'channels') value = countChannels(guild, options);
  else if (type === 'members') value = countMembers(guild, options);
  else if (type === 'status') value = countStatuses(guild, options);
  else if (type === 'role') value = countMembersInRoles(guild, options);
  else if (type === 'roles') value = countRoles(guild, options);
  else if (type === 'voice') value = countVoice(guild, options);
  else if (type === 'messages') value = options.periodDays ? rollingActivityTotal(guild.id, 'messages', options.periodDays) : summary.totals.messages;
  else if (type === 'voiceMinutes') value = options.periodDays ? rollingActivityTotal(guild.id, 'voiceMinutes', options.periodDays) : summary.totals.voiceMinutes;
  else if (type === 'joins') value = summary.totals.joins;
  else if (type === 'leaves') value = summary.totals.leaves;
  else if (type === 'boosts') value = guild.premiumSubscriptionCount || 0;
  else if (type === 'emojis') value = guild.emojis.cache.size;
  return Number(applyGoal(value, options) || 0).toLocaleString('en-GB');
}
function renderCounterName(guild, summary, input) {
  const dock = normalizeStoredDock(input);
  if (!dock) return 'Counter unavailable';
  const values = dock.segments.map((segment) => counterValue(guild, summary, segment));
  const variables = Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
  if (values.length === 1) {
    variables.value = values[0];
    variables.count = values[0];
    variables.date = values[0];
  }
  const name = replaceVariables(dock.template, variables, { guild, guildId: guild?.id }, false);
  return safeString(name.replace(/\s+/g, ' '), 100) || 'Counter';
}
async function getBotMember(guild) { return guild.members.me || await guild.members.fetchMe().catch(() => null); }
async function ensureManageChannels(guild, channel, reason = 'manage Stats counters') {
  if (!channel) throw new Error('Stats channel is unavailable.');
  const me = await getBotMember(guild);
  if (!me) throw new Error('Goliath could not resolve its Discord member permissions.');
  if (channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageChannels)) return true;
  if (channel.permissionOverwrites?.edit) await channel.permissionOverwrites.edit(me.id, { ViewChannel: true, ManageChannels: true }, { reason: `Goliath Stats: ${reason}` }).catch(() => null);
  if (channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageChannels)) return true;
  throw new Error(`Goliath needs Manage Channels in ${channel.name || 'this channel/category'} before it can ${reason}.`);
}
async function deleteManagedChannel(guild, channel, reason, actionLabel) {
  if (!channel) return true;
  await ensureManageChannels(guild, channel, actionLabel);
  try {
    await channel.delete(reason);
    return true;
  } catch (firstError) {
    const fresh = await guild.channels.fetch(channel.id).catch(() => null);
    if (!fresh) return true;
    await ensureManageChannels(guild, fresh, actionLabel);
    try {
      await fresh.delete(reason);
      return true;
    } catch (secondError) {
      throw new Error(`Goliath could not ${actionLabel}. Discord returned: ${secondError?.message || firstError?.message || 'Unknown Discord error'}`);
    }
  }
}
function scheduleKey(guildId, dockId) { return `${guildId}:${dockId}`; }
function clearDockSchedule(guildId, dockId) {
  const key = scheduleKey(guildId, dockId);
  const current = dockSchedules.get(key);
  if (current?.timer) clearInterval(current.timer);
  dockSchedules.delete(key); dockRefreshInFlight.delete(key);
}
function markNextDue(guildId, dock) {
  const key = scheduleKey(guildId, dock.id); const current = dockSchedules.get(key) || {};
  current.nextDue = Date.now() + Math.max(10, Number(dock.frequencyMinutes || 10)) * 60000; dockSchedules.set(key, current);
}
async function refreshDock(guild, dockInput, { force = false, fetchMembers = true } = {}) {
  const dock = typeof dockInput === 'string' ? listCounters(guild.id).find((item) => item.id === dockInput || item.channelId === dockInput) : normalizeStoredDock(dockInput);
  if (!dock?.enabled || !dock.channelId) return null;
  const key = scheduleKey(guild.id, dock.id), schedule = dockSchedules.get(key);
  if (!force && schedule?.nextDue && Date.now() < schedule.nextDue) return { id: dock.id, skipped: true };
  if (dockRefreshInFlight.has(key)) return { id: dock.id, skipped: true };
  dockRefreshInFlight.add(key);
  try {
    if (fetchMembers) await guild.members.fetch({ withPresences: true }).catch(() => guild.members.fetch().catch(() => null));
    const channel = guild.channels.cache.get(dock.channelId) || await guild.channels.fetch(dock.channelId).catch(() => null);
    if (!channel?.setName) return null;
    const summary = statsStore.getSummary(guild.id), name = renderCounterName(guild, summary, dock), changed = channel.name !== name;
    if (changed) await channel.setName(name, 'Goliath Stats counter refresh').catch(() => null);
    markNextDue(guild.id, dock);
    return { id: dock.id, channelId: dock.channelId, name, changed, skipped: false };
  } finally { dockRefreshInFlight.delete(key); }
}
function ensureDockSchedule(guild, dock) {
  if (!dock?.enabled || !dock.channelId) { if (dock?.id) clearDockSchedule(guild.id, dock.id); return null; }
  const key = scheduleKey(guild.id, dock.id), frequencyMinutes = Math.max(10, Number(dock.frequencyMinutes || 10)), current = dockSchedules.get(key);
  if (current?.timer && current.frequencyMinutes === frequencyMinutes) return current;
  if (current?.timer) clearInterval(current.timer);
  const timer = setInterval(() => refreshDock(guild, dock.id, { force: true, fetchMembers: true }).catch((error) => console.error(`[Stats] Scheduled refresh failed for ${dock.id}:`, error)), frequencyMinutes * 60000);
  timer.unref?.(); const next = { timer, frequencyMinutes, nextDue: current?.nextDue || Date.now() + frequencyMinutes * 60000 }; dockSchedules.set(key, next); return next;
}
function syncDockSchedules(guild, docks) {
  const activeKeys = new Set();
  for (const dock of docks) { if (!dock.enabled || !dock.channelId) continue; const key = scheduleKey(guild.id, dock.id); activeKeys.add(key); ensureDockSchedule(guild, dock); }
  for (const [key, current] of dockSchedules.entries()) { if (!key.startsWith(`${guild.id}:`) || activeKeys.has(key)) continue; if (current?.timer) clearInterval(current.timer); dockSchedules.delete(key); }
}
async function refreshCounters(guild, options = {}) {
  if (!guild?.id) return [];
  await guild.channels.fetch().catch(() => null);
  await guild.members.fetch({ withPresences: true }).catch(() => guild.members.fetch().catch(() => null));
  await guild.roles.fetch().catch(() => null);
  const docks = listCounters(guild.id), results = [];
  for (const dock of docks) { if (!dock.enabled || !dock.channelId) continue; const result = await refreshDock(guild, dock, { force: options.force === true, fetchMembers: false }); if (result && !result.skipped) results.push(result); }
  syncDockSchedules(guild, docks);
  return results;
}
async function findOrCreateCategory(guild, name = '📊 SERVER STATS') {
  const wanted = safeString(name, 100) || '📊 SERVER STATS';
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === wanted.toLowerCase());
  if (existing) { await ensureManageChannels(guild, existing, 'manage the Stats category'); return existing; }
  const me = await getBotMember(guild);
  const permissionOverwrites = me ? [{ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }] : [];
  const created = await guild.channels.create({ name: wanted, type: ChannelType.GuildCategory, permissionOverwrites, reason: 'Goliath Stats setup' });
  await ensureManageChannels(guild, created, 'manage the Stats category'); return created;
}
async function createCounterChannel(guild, input, parentId = null) {
  const dock = cleanDock(input), summary = statsStore.getSummary(guild.id), name = renderCounterName(guild, summary, dock), isText = dock.channelType === 'text';
  const me = await getBotMember(guild), parent = parentId ? guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId).catch(() => null) : null;
  if (parent) await ensureManageChannels(guild, parent, 'create Stats counters here');
  const permissionOverwrites = [{ id: guild.roles.everyone.id, deny: [isText ? PermissionFlagsBits.SendMessages : PermissionFlagsBits.Connect] }];
  if (me) permissionOverwrites.push({ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] });
  const channel = await guild.channels.create({ name, type: isText ? ChannelType.GuildText : ChannelType.GuildVoice, parent: parentId || dock.categoryId || undefined, permissionOverwrites, reason: 'Goliath Stats counter setup' });
  await ensureManageChannels(guild, channel, 'manage this Stats counter'); return channel;
}
async function createDock(guild, input = {}, guildOrMeta = {}) {
  if (!guild?.id) throw new Error('A guild is required.');
  const base = cleanDock(input), category = base.categoryId ? guild.channels.cache.get(base.categoryId) || await guild.channels.fetch(base.categoryId).catch(() => null) : await findOrCreateCategory(guild, input.categoryName || statsStore.getStats(guild.id).settings?.categoryName || '📊 SERVER STATS');
  if (category) await ensureManageChannels(guild, category, 'create Stats counters here');
  const channel = await createCounterChannel(guild, base, category?.id || null), dock = { ...base, channelId: channel.id, categoryId: category?.id || null, enabled: true };
  saveDock(guild.id, dock, guildOrMeta || guild); ensureDockSchedule(guild, dock); return dock;
}
async function updateDock(guild, id, changes = {}, guildOrMeta = {}) {
  const existing = listCounters(guild.id).find((item) => item.id === id || item.channelId === id);
  if (!existing) throw new Error('Counter not found.');
  let next = cleanDock({ ...existing, ...changes, id: existing.id, channelId: existing.channelId, segments: changes.segments || existing.segments });
  if (existing.channelId && existing.channelType !== next.channelType) {
    const oldChannel = guild.channels.cache.get(existing.channelId) || await guild.channels.fetch(existing.channelId).catch(() => null), parentId = oldChannel?.parentId || existing.categoryId || null;
    if (oldChannel) await deleteManagedChannel(guild, oldChannel, 'Goliath Stats counter channel type changed', 'replace this counter channel');
    const replacement = await createCounterChannel(guild, { ...next, channelId: null }, parentId);
    next = { ...next, channelId: replacement.id, categoryId: parentId || next.categoryId };
  }
  saveDock(guild.id, next, guildOrMeta || guild); clearDockSchedule(guild.id, next.id); ensureDockSchedule(guild, next); await refreshDock(guild, next, { force: true, fetchMembers: true }); return next;
}
async function setDockEnabled(guild, id, enabled, guildOrMeta = {}) {
  const existing = listCounters(guild.id).find((item) => item.id === id || item.channelId === id);
  if (!existing) throw new Error('Counter not found.');
  if (enabled && !existing.channelId) return createDock(guild, { ...existing, id: existing.id }, guildOrMeta || guild);
  if (!enabled && existing.channelId) {
    const channel = guild.channels.cache.get(existing.channelId) || await guild.channels.fetch(existing.channelId).catch(() => null);
    if (channel) await deleteManagedChannel(guild, channel, 'Goliath Stats counter disabled', 'disable this counter');
    clearDockSchedule(guild.id, existing.id); const next = { ...existing, channelId: null, enabled: false }; saveDock(guild.id, next, guildOrMeta || guild); return next;
  }
  const next = { ...existing, enabled: Boolean(enabled) }; saveDock(guild.id, next, guildOrMeta || guild); if (next.enabled) ensureDockSchedule(guild, next); else clearDockSchedule(guild.id, next.id); return next;
}
async function deleteDock(guild, id, guildOrMeta = {}) {
  const existing = listCounters(guild.id).find((item) => item.id === id || item.channelId === id);
  if (!existing) return false;
  if (existing.channelId) { const channel = guild.channels.cache.get(existing.channelId) || await guild.channels.fetch(existing.channelId).catch(() => null); if (channel) await deleteManagedChannel(guild, channel, 'Goliath Stats counter deleted', 'delete this counter'); }
  clearDockSchedule(guild.id, existing.id); removeCounter(guild.id, existing.id, guildOrMeta || guild); return true;
}
function samePreset(dock, preset) {
  if (!dock || !preset) return false;
  const dockTypes = (dock.segments || []).map((segment) => `${segment.type}:${JSON.stringify(segment.options || {})}`);
  const presetTypes = (preset.segments || []).map((segment) => `${segment.type}:${JSON.stringify(normalizeCounterOptions(segment.type, segment.options || {}))}`);
  return JSON.stringify(dockTypes) === JSON.stringify(presetTypes);
}
async function createCounterSuite(guild, options = {}) {
  if (!guild?.id) throw new Error('A guild is required to create counter channels.');
  await guild.channels.fetch().catch(() => null); await guild.members.fetch({ withPresences: true }).catch(() => guild.members.fetch().catch(() => null)); await guild.roles.fetch().catch(() => null);
  const category = await findOrCreateCategory(guild, options.categoryName || statsStore.getStats(guild.id).settings?.categoryName || '📊 SERVER STATS'), created = [], reused = [];
  for (const preset of DEFAULT_COUNTER_SUITE) {
    const existing = listCounters(guild.id).find((dock) => dock.source === 'default-suite' && samePreset(dock, preset));
    if (existing?.channelId) { const channel = guild.channels.cache.get(existing.channelId) || await guild.channels.fetch(existing.channelId).catch(() => null); if (channel) { reused.push(existing); ensureDockSchedule(guild, existing); continue; } }
    const dock = await createDock(guild, { name: preset.name || 'Counter', template: preset.template, segments: preset.segments, categoryId: category.id, channelType: options.channelType || 'voice', frequencyMinutes: Number(options.frequencyMinutes || statsStore.getStats(guild.id).settings?.defaultFrequencyMinutes || 10), source: 'default-suite' }, guild);
    created.push(dock);
  }
  await refreshCounters(guild, { force: true }); return { categoryId: category.id, created, reused };
}
function previewDock(guild, input = {}) { return renderCounterName(guild, statsStore.getSummary(guild.id), cleanDock(input)); }

module.exports = {
  COUNTER_TYPES, STATUS_VALUES, DEFAULT_COUNTER_SUITE, PRESENCE_TRIO_PRESET,
  cleanCounter, cleanDock, cleanSegment, listCounters, addCounter, saveDock, upsertCounterByType, removeCounter,
  refreshCounters, refreshDock, createCounterSuite, createDock, updateDock, setDockEnabled, deleteDock,
  previewDock, defaultTemplate, renderCounterName, ensureManageChannels, findOrCreateCategory,
};
