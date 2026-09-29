'use strict';

const guildManager = require('../../../core/guild/guildManager');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE_KEY = 'stats';
const MAX_ITEMS = 10;
const MAX_SNAPSHOTS = 120;
let runtimeConfigListener = null;

const DEFAULT_STATS = {
  trackMessages: true,
  trackVoice: true,
  trackMembers: true,
  ignoreBots: true,
  ignoredChannels: [],
  ignoredRoles: [],
  counters: [],
  settings: {
    retentionDays: 30,
    categoryName: '📊 SERVER STATS',
    timeZone: 'Europe/London',
    defaultFrequencyMinutes: 10,
  },
  data: {
    messages: {},
    voice: {},
    members: { joins: 0, leaves: 0, snapshots: [] },
  },
  analytics: { viewed: 0 },
};

function copy(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function merge(defaults = {}, source = {}) {
  if (!isObject(defaults)) return copy(source);
  if (!isObject(source)) return copy(defaults);
  const output = copy(defaults);
  for (const [key, value] of Object.entries(source)) {
    output[key] = isObject(value) && isObject(output[key]) ? merge(output[key], value) : copy(value);
  }
  return output;
}

function retentionCutoff(retentionDays, now = Date.now()) {
  return new Date(now - (Math.max(1, Number(retentionDays) || 30) - 1) * 86400000).toISOString().slice(0, 10);
}

function pruneDailyMap(map, cutoff) {
  if (!isObject(map)) return {};
  for (const key of Object.keys(map)) if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) delete map[key];
  return map;
}

function applyRetention(stats) {
  const cutoff = retentionCutoff(stats.settings?.retentionDays);
  stats.data = isObject(stats.data) ? stats.data : copy(DEFAULT_STATS.data);
  stats.data.messages = pruneDailyMap(stats.data.messages, cutoff);
  stats.data.voice = pruneDailyMap(stats.data.voice, cutoff);
  stats.data.members = isObject(stats.data.members) ? stats.data.members : copy(DEFAULT_STATS.data.members);
  stats.data.members.snapshots = (Array.isArray(stats.data.members.snapshots) ? stats.data.members.snapshots : [])
    .filter((snapshot) => {
      const at = new Date(snapshot?.at || 0);
      return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) >= cutoff;
    })
    .slice(0, MAX_SNAPSHOTS);
  return stats;
}

function normalizeStats(value = {}) {
  const normalized = merge(DEFAULT_STATS, value);
  delete normalized.enabled;
  normalized.settings = isObject(normalized.settings) ? normalized.settings : copy(DEFAULT_STATS.settings);
  normalized.settings.retentionDays = Math.max(1, Math.min(365, Number(normalized.settings.retentionDays || 30) || 30));
  normalized.settings.categoryName = String(normalized.settings.categoryName || DEFAULT_STATS.settings.categoryName).trim().slice(0, 100) || DEFAULT_STATS.settings.categoryName;
  normalized.settings.timeZone = String(normalized.settings.timeZone || DEFAULT_STATS.settings.timeZone).trim().slice(0, 64) || DEFAULT_STATS.settings.timeZone;
  normalized.settings.defaultFrequencyMinutes = Math.max(10, Math.min(1440, Number(normalized.settings.defaultFrequencyMinutes || 10) || 10));
  normalized.counters = Array.isArray(normalized.counters) ? normalized.counters.slice(0, 100) : [];
  return applyRetention(normalized);
}

function dayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function addToMap(map, key, amount = 1) {
  const safeKey = String(key || 'unknown');
  map[safeKey] = Number(map[safeKey] || 0) + Number(amount || 0);
}

function getStats(guildId) {
  return normalizeStats(getModuleSection(guildId, MODULE_KEY, DEFAULT_STATS));
}

function notifyRuntimeConfigChange(guildId, patch) {
  if (typeof runtimeConfigListener !== 'function') return;
  try { runtimeConfigListener(String(guildId), patch || {}); }
  catch (error) { console.warn('[Stats] Runtime config reconciliation failed:', error?.message || error); }
}

function setRuntimeConfigListener(listener) {
  runtimeConfigListener = typeof listener === 'function' ? listener : null;
}

function saveStats(guildId, stats, guildOrMeta = {}) {
  const before = getStats(guildId);
  const saved = normalizeStats(saveModuleSection(guildId, MODULE_KEY, normalizeStats(stats), guildOrMeta));
  if ((before.trackVoice !== false) !== (saved.trackVoice !== false)) notifyRuntimeConfigChange(guildId, { trackVoice: saved.trackVoice !== false });
  return saved;
}

function updateStats(guildId, updater, guildOrMeta = {}) {
  let voiceChanged = false;
  let nextVoice = true;
  const saved = normalizeStats(updateModuleSection(
    guildId,
    MODULE_KEY,
    (current) => {
      const normalized = normalizeStats(current);
      const previousVoice = normalized.trackVoice !== false;
      const next = typeof updater === 'function' ? updater(copy(normalized)) : updater;
      const finalStats = normalizeStats(next);
      nextVoice = finalStats.trackVoice !== false;
      voiceChanged = previousVoice !== nextVoice;
      return finalStats;
    },
    DEFAULT_STATS,
    guildOrMeta
  ));
  if (voiceChanged) notifyRuntimeConfigChange(guildId, { trackVoice: nextVoice });
  return saved;
}

function setEnabled(guildId, enabled, guildOrMeta = {}) {
  const wasEnabled = guildManager.isModuleEnabled(guildId, MODULE_KEY);
  guildManager.setModuleEnabled(guildId, MODULE_KEY, enabled === true, guildOrMeta);
  const isNowEnabled = guildManager.isModuleEnabled(guildId, MODULE_KEY);
  if (wasEnabled !== isNowEnabled) notifyRuntimeConfigChange(guildId, { enabled: isNowEnabled });
  return { ...getStats(guildId), enabled: isNowEnabled };
}

function isEnabled(guildId) {
  return guildManager.isModuleEnabled(guildId, MODULE_KEY);
}

function ignored(stats, member, channelId) {
  if (stats.ignoreBots !== false && member?.user?.bot) return true;
  if (Array.isArray(stats.ignoredChannels) && stats.ignoredChannels.includes(channelId)) return true;
  const ignoredRoles = new Set(Array.isArray(stats.ignoredRoles) ? stats.ignoredRoles : []);
  return Boolean(ignoredRoles.size && member?.roles?.cache?.some?.((role) => ignoredRoles.has(role.id)));
}

function addMessage(message) {
  if (!message?.guild?.id) return null;
  if (!isEnabled(message.guild.id)) return getStats(message.guild.id);
  return updateStats(message.guild.id, (stats) => {
    if (stats.trackMessages === false || ignored(stats, message.member, message.channelId)) return stats;
    const today = dayKey();
    stats.data.messages[today] = stats.data.messages[today] || { total: 0, users: {}, channels: {} };
    const bucket = stats.data.messages[today];
    bucket.total = Number(bucket.total || 0) + 1;
    addToMap(bucket.users, message.author?.id, 1);
    addToMap(bucket.channels, message.channelId, 1);
    stats.updatedAt = new Date().toISOString();
    return stats;
  }, message.guild);
}

function addVoiceMinutes(member, channelId, minutes) {
  if (!member?.guild?.id) return null;
  const safeMinutes = Math.max(0, Number(minutes || 0));
  if (!safeMinutes) return getStats(member.guild.id);
  if (!isEnabled(member.guild.id)) return getStats(member.guild.id);
  return updateStats(member.guild.id, (stats) => {
    if (stats.trackVoice === false || ignored(stats, member, channelId)) return stats;
    const today = dayKey();
    stats.data.voice[today] = stats.data.voice[today] || { totalMinutes: 0, users: {}, channels: {} };
    const bucket = stats.data.voice[today];
    bucket.totalMinutes = Number(bucket.totalMinutes || 0) + safeMinutes;
    addToMap(bucket.users, member.user?.id || member.id, safeMinutes);
    addToMap(bucket.channels, channelId, safeMinutes);
    stats.updatedAt = new Date().toISOString();
    return stats;
  }, member.guild);
}

function addMemberEvent(member, type) {
  if (!member?.guild?.id) return null;
  if (!isEnabled(member.guild.id)) return getStats(member.guild.id);
  return updateStats(member.guild.id, (stats) => {
    if (stats.trackMembers === false) return stats;
    if (type === 'join') stats.data.members.joins = Number(stats.data.members.joins || 0) + 1;
    if (type === 'leave') stats.data.members.leaves = Number(stats.data.members.leaves || 0) + 1;
    stats.data.members.snapshots = Array.isArray(stats.data.members.snapshots) ? stats.data.members.snapshots : [];
    stats.data.members.snapshots.unshift({ type, memberCount: Number(member.guild.memberCount || 0), at: new Date().toISOString() });
    stats.data.members.snapshots = stats.data.members.snapshots.slice(0, MAX_SNAPSHOTS);
    stats.updatedAt = new Date().toISOString();
    return stats;
  }, member.guild);
}

function resetStats(guildId, guildOrMeta = {}) {
  return saveStats(guildId, DEFAULT_STATS, guildOrMeta);
}

function top(dailyMap = {}, field = 'users') {
  const totals = {};
  for (const day of Object.values(dailyMap || {})) {
    for (const [id, amount] of Object.entries(day?.[field] || {})) addToMap(totals, id, Number(amount || 0));
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, MAX_ITEMS).map(([id, value]) => ({ id, value }));
}

function getSummary(guildId) {
  const stats = getStats(guildId);
  const messageDays = Object.values(stats.data.messages || {});
  const voiceDays = Object.values(stats.data.voice || {});
  return {
    enabled: isEnabled(guildId),
    totals: {
      messages: messageDays.reduce((total, day) => total + Number(day.total || 0), 0),
      voiceMinutes: Math.round(voiceDays.reduce((total, day) => total + Number(day.totalMinutes || 0), 0)),
      joins: Number(stats.data.members?.joins || 0),
      leaves: Number(stats.data.members?.leaves || 0),
    },
    top: {
      messageUsers: top(stats.data.messages, 'users'),
      messageChannels: top(stats.data.messages, 'channels'),
      voiceUsers: top(stats.data.voice, 'users'),
      voiceChannels: top(stats.data.voice, 'channels'),
    },
    members: stats.data.members || DEFAULT_STATS.data.members,
    counters: Array.isArray(stats.counters) ? stats.counters : [],
    settings: stats.settings || {},
    updatedAt: stats.updatedAt || null,
  };
}

module.exports = {
  MODULE_KEY,
  DEFAULT_STATS,
  dayKey,
  getStats,
  saveStats,
  updateStats,
  setEnabled,
  isEnabled,
  setRuntimeConfigListener,
  addMessage,
  addVoiceMinutes,
  addMemberEvent,
  resetStats,
  getSummary,
};
