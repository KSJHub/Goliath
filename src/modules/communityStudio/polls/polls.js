'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE_KEY = 'polls';
const RENDER_MODES = Object.freeze(['buttons', 'multi_select']);
const DEFAULT_POLLS = {
  defaultChannelId: null,
  resultsChannelId: null,
  managerRoleIds: [],
  anonymousVoting: false,
  allowMultipleChoice: true,
  showResultsLive: true,
  settings: {
    defaultChannelId: null,
    allowMultipleVotes: false,
    anonymousVotes: false,
    autoCloseHours: 24,
  },
  polls: {},
  analytics: {
    created: 0,
    deployed: 0,
    closed: 0,
    votes: 0,
    removed: 0,
    switched: 0,
    multiSelectSubmissions: 0,
  },
};

const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));
const createId = (prefix = 'poll') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const cleanText = (value, max = 4000) => String(value || '').trim().slice(0, max);
function cleanSnowflake(value) {
  const cleaned = String(value || '').replace(/[<#@&!>]/g, '').trim();
  return /^\d{15,25}$/.test(cleaned) ? cleaned : null;
}
function cleanSnowflakeArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanSnowflake).filter(Boolean))];
}
function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 30)) {
    const safeKey = cleanText(key, 64);
    if (!safeKey) continue;
    if (raw == null || ['string', 'number', 'boolean'].includes(typeof raw)) out[safeKey] = typeof raw === 'string' ? cleanText(raw, 500) : raw;
  }
  return out;
}
function normalizeOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .map((option) => ({
      id: cleanText(option?.id, 100) || createId('option'),
      label: cleanText(option?.label || option?.name || option?.value, 80),
      value: cleanText(option?.value || option?.label || option?.name, 100),
      metadata: normalizeMetadata(option?.metadata),
      votes: Array.isArray(option?.votes) ? [...new Set(option.votes.map(String))] : [],
    }))
    .filter((option) => option.label)
    .slice(0, 10);
}
function normalizePoll(poll, fallbackId, defaults = {}) {
  const question = cleanText(poll?.question, 256);
  if (!question) return null;
  const id = String(poll?.id || fallbackId || createId('poll'));
  return {
    id,
    question,
    description: cleanText(poll.description, 1000),
    status: ['draft', 'active', 'closed'].includes(poll.status) ? poll.status : 'draft',
    channelId: cleanSnowflake(poll.channelId),
    messageId: cleanSnowflake(poll.messageId),
    allowMultipleVotes: poll.allowMultipleVotes === true,
    anonymousVotes: poll.anonymousVotes === true,
    renderMode: RENDER_MODES.includes(poll.renderMode) ? poll.renderMode : 'buttons',
    sourceModule: cleanText(poll.sourceModule, 64) || null,
    purpose: cleanText(poll.purpose, 64) || null,
    sourceId: cleanText(poll.sourceId, 100) || null,
    metadata: normalizeMetadata(poll.metadata),
    createdBy: String(poll.createdBy || '').trim() || null,
    createdAt: poll.createdAt || now(),
    updatedAt: poll.updatedAt || poll.createdAt || now(),
    closedAt: poll.closedAt || null,
    options: normalizeOptions(poll.options),
    ...defaults,
  };
}
function normalizeSection(section = {}) {
  const source = section && typeof section === 'object' ? section : {};
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const polls = source.polls && typeof source.polls === 'object' ? source.polls : {};
  const analytics = source.analytics && typeof source.analytics === 'object' ? source.analytics : {};
  const defaultChannelId = cleanSnowflake(source.defaultChannelId || settings.defaultChannelId);
  const allowMultipleVotes = source.allowMultipleChoice === true || settings.allowMultipleVotes === true;
  const anonymousVotes = source.anonymousVoting === true || settings.anonymousVotes === true;
  const normalizedPolls = {};
  for (const [pollId, poll] of Object.entries(polls)) {
    const normalized = normalizePoll(poll, pollId);
    if (normalized) normalizedPolls[normalized.id] = normalized;
  }
  const normalized = {
    ...DEFAULT_POLLS,
    ...source,
    defaultChannelId,
    resultsChannelId: cleanSnowflake(source.resultsChannelId),
    managerRoleIds: cleanSnowflakeArray(source.managerRoleIds),
    anonymousVoting: anonymousVotes,
    allowMultipleChoice: allowMultipleVotes,
    showResultsLive: source.showResultsLive !== false,
    settings: {
      ...DEFAULT_POLLS.settings,
      ...settings,
      defaultChannelId,
      allowMultipleVotes,
      anonymousVotes,
      autoCloseHours: Math.max(0, Number(settings.autoCloseHours ?? DEFAULT_POLLS.settings.autoCloseHours)),
    },
    polls: normalizedPolls,
    analytics: {
      ...DEFAULT_POLLS.analytics,
      ...analytics,
      created: Math.max(0, Number(analytics.created || 0)),
      deployed: Math.max(0, Number(analytics.deployed || 0)),
      closed: Math.max(0, Number(analytics.closed || 0)),
      votes: Math.max(0, Number(analytics.votes || 0)),
      removed: Math.max(0, Number(analytics.removed || 0)),
      switched: Math.max(0, Number(analytics.switched || 0)),
      multiSelectSubmissions: Math.max(0, Number(analytics.multiSelectSubmissions || 0)),
    },
  };
  delete normalized.enabled;
  return normalized;
}
function getSection(guildId) { return normalizeSection(getModuleSection(guildId, MODULE_KEY, DEFAULT_POLLS)); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, MODULE_KEY, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, MODULE_KEY, (current) => {
    const normalized = normalizeSection(current);
    return normalizeSection(typeof updater === 'function' ? updater(clone(normalized)) : updater);
  }, DEFAULT_POLLS, meta));
}
function getPoll(guildId, pollId) { return getSection(guildId).polls[String(pollId)] || null; }
function createPoll(guildId, payload = {}, meta = {}) {
  const section = getSection(guildId);
  if (!guildManager.isModuleEnabled(guildId, MODULE_KEY)) throw new Error('Polls are disabled.');
  const question = cleanText(payload.question, 256);
  if (!question) throw new Error('Poll question is required.');
  const options = normalizeOptions(payload.options);
  if (options.length < 2) throw new Error('A poll needs at least 2 options.');
  const pollId = createId('poll');
  const poll = normalizePoll({
    ...payload,
    id: pollId,
    question,
    options,
    channelId: cleanSnowflake(payload.channelId) || section.settings.defaultChannelId,
    allowMultipleVotes: payload.allowMultipleVotes === true || section.settings.allowMultipleVotes === true,
    anonymousVotes: payload.anonymousVotes === true || section.settings.anonymousVotes === true,
    createdBy: meta.actorId || payload.createdBy || null,
    createdAt: now(),
    updatedAt: now(),
  }, pollId);
  section.polls[pollId] = poll;
  section.analytics.created += 1;
  return { section: saveSection(guildId, section, meta), poll };
}
function updatePoll(guildId, pollId, payload = {}, meta = {}) {
  const section = getSection(guildId);
  const current = section.polls[String(pollId)];
  if (!current) throw new Error('Poll not found.');
  if (current.status === 'closed') throw new Error('Closed polls cannot be edited.');
  const merged = { ...current, ...payload, id: current.id, options: payload.options === undefined ? current.options : payload.options, updatedAt: now() };
  const poll = normalizePoll(merged, current.id);
  if (!poll.question) throw new Error('Poll question is required.');
  if (poll.options.length < 2) throw new Error('A poll needs at least 2 options.');
  if (payload.options !== undefined) poll.options = poll.options.map((option) => ({ ...option, votes: [] }));
  section.polls[poll.id] = poll;
  return { section: saveSection(guildId, section, meta), poll };
}
function deletePollRecord(guildId, pollId, meta = {}) {
  const section = getSection(guildId);
  if (!section.polls[String(pollId)]) throw new Error('Poll not found.');
  delete section.polls[String(pollId)];
  return saveSection(guildId, section, meta);
}
function voterSet(poll) {
  const users = new Set();
  for (const option of poll?.options || []) for (const id of option.votes || []) users.add(String(id));
  return users;
}
function summarizePoll(poll) {
  const totalSelections = poll.options.reduce((sum, option) => sum + option.votes.length, 0);
  const uniqueVoters = voterSet(poll).size;
  return {
    ...clone(poll),
    totalVotes: totalSelections,
    totalSelections,
    uniqueVoters,
    options: poll.options.map((option) => ({
      ...option,
      count: option.votes.length,
      percent: uniqueVoters ? Math.round((option.votes.length / uniqueVoters) * 100) : 0,
      votes: poll.anonymousVotes ? [] : [...option.votes],
    })),
  };
}
function buildPollEmbed(poll) {
  const summary = summarizePoll(poll);
  const lines = summary.options.map((option, index) => {
    const bar = '█'.repeat(Math.max(0, Math.min(10, Math.round(option.percent / 10)))).padEnd(10, '░');
    return `**${index + 1}. ${option.label}**\n${bar} ${option.count} · ${option.percent}% of voters`;
  });
  const mode = poll.renderMode === 'multi_select' ? 'Multi-select' : (poll.allowMultipleVotes ? 'Multiple choice' : 'Single choice');
  return new EmbedBuilder()
    .setColor(poll.status === 'closed' ? '#64748B' : '#3B82F6')
    .setTitle(`${poll.status === 'closed' ? 'Closed Poll' : 'Poll'} · ${poll.question}`.slice(0, 256))
    .setDescription([poll.description, ...lines].filter(Boolean).join('\n\n').slice(0, 4096))
    .setFooter({ text: `Poll ID: ${poll.id} · ${summary.uniqueVoters} voter(s) · ${mode}` })
    .setTimestamp(new Date(poll.updatedAt || poll.createdAt || Date.now()));
}
function buildPollComponents(poll) {
  if (poll.status !== 'active') return [];
  if (poll.renderMode === 'multi_select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`poll_select:${poll.id}`)
      .setPlaceholder(poll.allowMultipleVotes ? 'Select every option that applies' : 'Select one option')
      .setMinValues(1)
      .setMaxValues(poll.allowMultipleVotes ? Math.min(10, poll.options.length) : 1)
      .addOptions(poll.options.map((option, index) => ({
        label: `${index + 1}. ${option.label}`.slice(0, 100),
        value: option.id,
        description: cleanText(option.metadata?.description || option.value || '', 100) || undefined,
      })));
    return [new ActionRowBuilder().addComponents(menu)];
  }
  const buttons = poll.options.slice(0, 10).map((option, index) => new ButtonBuilder()
    .setCustomId(`poll_vote:${poll.id}:${option.id}`)
    .setLabel(`${index + 1}. ${option.label}`.slice(0, 80))
    .setStyle(ButtonStyle.Primary));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
  return rows;
}

module.exports = {
  MODULE_KEY,
  RENDER_MODES,
  DEFAULT_POLLS,
  now,
  cleanSnowflake,
  normalizeMetadata,
  normalizeSection,
  getSection,
  saveSection,
  updateSection,
  getPoll,
  createPoll,
  updatePoll,
  deletePollRecord,
  voterSet,
  summarizePoll,
  buildPollEmbed,
  buildPollComponents,
};