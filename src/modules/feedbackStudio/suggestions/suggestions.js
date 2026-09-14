'use strict';

const crypto = require('node:crypto');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE_KEY = 'suggestions';
const CONFIG_KEYS = Object.freeze([
  'submitChannelId',
  'reviewChannelId',
  'approvedChannelId',
  'deniedChannelId',
  'logChannelId',
  'reviewerRoleIds',
  'anonymous',
  'voting',
  'requireReview',
]);
const SUGGESTION_STATUSES = Object.freeze(['pending', 'discussing', 'approved', 'implemented', 'denied']);
const MAX_HISTORY = 100;

function now() { return new Date().toISOString(); }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function cleanString(value, fallback = '', maxLength = 1000) { return String(value ?? fallback).trim().slice(0, maxLength); }
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
function cleanIdArray(value) { return Array.isArray(value) ? [...new Set(value.map(cleanDiscordId).filter(Boolean))] : []; }
function cleanSuggestionId(value) {
  const id = cleanString(value, '', 80);
  return /^[a-zA-Z0-9_-]{3,80}$/.test(id) ? id : '';
}
function createId(prefix = 'suggestion') {
  const safePrefix = cleanString(prefix, 'suggestion', 24).replace(/[^a-zA-Z0-9_-]/g, '') || 'suggestion';
  return `${safePrefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
function cleanTimestamp(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}
function referenceFromId(suggestionId) {
  const compact = cleanSuggestionId(suggestionId).replace(/^sg_/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `SUG-${compact || crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
function cleanReference(value, suggestionId) {
  const ref = cleanString(value, '', 24).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return ref || referenceFromId(suggestionId);
}
function defaultTitle(content = '') {
  const firstLine = cleanString(content, '', 100).split(/\r?\n/)[0].trim();
  return firstLine || 'Community Suggestion';
}

function normalizeHistoryEvent(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const type = cleanString(source.type || source.action || 'updated', 'updated', 48).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const at = cleanTimestamp(source.at || source.createdAt, now());
  return {
    eventId: cleanSuggestionId(source.eventId) || createId('evt'),
    type,
    actorId: cleanDiscordId(source.actorId || source.userId),
    at,
    fromStatus: SUGGESTION_STATUSES.includes(source.fromStatus) ? source.fromStatus : null,
    toStatus: SUGGESTION_STATUSES.includes(source.toStatus) ? source.toStatus : null,
    note: cleanString(source.note || source.reason || '', '', 500),
  };
}

function appendHistory(history = [], event = {}) {
  const normalized = Array.isArray(history) ? history.map(normalizeHistoryEvent) : [];
  normalized.push(normalizeHistoryEvent(event));
  return normalized.slice(-MAX_HISTORY);
}

function defaultSuggestionsSection() {
  const timestamp = now();
  return {
    submitChannelId: null,
    reviewChannelId: null,
    approvedChannelId: null,
    deniedChannelId: null,
    logChannelId: null,
    reviewerRoleIds: [],
    anonymous: false,
    voting: true,
    requireReview: true,
    deployment: {
      channelId: null,
      messageId: null,
      deployedAt: null,
      updatedAt: null,
    },
    suggestions: {},
    analytics: {
      submitted: 0,
      discussing: 0,
      approved: 0,
      implemented: 0,
      denied: 0,
      votesUp: 0,
      votesDown: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeDeployment(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    channelId: cleanDiscordId(source.channelId),
    messageId: cleanDiscordId(source.messageId),
    deployedAt: cleanTimestamp(source.deployedAt, null),
    updatedAt: cleanTimestamp(source.updatedAt, null),
  };
}

function normalizeSuggestion(input = {}, defaults = {}) {
  const suggestionId = cleanSuggestionId(input.suggestionId || input.id) || createId('sg');
  const createdAt = cleanTimestamp(input.createdAt, now());
  const status = SUGGESTION_STATUSES.includes(input.status) ? input.status : 'pending';
  const upVotes = cleanIdArray(input.upVotes);
  const upVoteSet = new Set(upVotes);
  const downVotes = cleanIdArray(input.downVotes).filter((userId) => !upVoteSet.has(userId));
  const content = cleanString(input.content || '', '', 1800);
  const rawHistory = Array.isArray(input.history) ? input.history.map(normalizeHistoryEvent).slice(-MAX_HISTORY) : [];
  const history = rawHistory.length
    ? rawHistory
    : [normalizeHistoryEvent({ type: 'submitted', actorId: input.authorId, at: createdAt, toStatus: 'pending' })];

  return {
    suggestionId,
    id: suggestionId,
    reference: cleanReference(input.reference, suggestionId),
    title: cleanString(input.title || defaultTitle(content), 'Community Suggestion', 100),
    status,
    content,
    authorId: cleanDiscordId(input.authorId),
    anonymous: typeof input.anonymous === 'boolean' ? input.anonymous : defaults.anonymous === true,
    channelId: cleanDiscordId(input.channelId),
    messageId: cleanDiscordId(input.messageId),
    reviewChannelId: cleanDiscordId(input.reviewChannelId),
    reviewMessageId: cleanDiscordId(input.reviewMessageId),
    discussionThreadId: cleanDiscordId(input.discussionThreadId),
    votePaused: input.votePaused === true || status !== 'pending',
    upVotes,
    downVotes,
    createdAt,
    updatedAt: cleanTimestamp(input.updatedAt, createdAt),
    discussionStartedBy: cleanDiscordId(input.discussionStartedBy),
    discussionStartedAt: cleanTimestamp(input.discussionStartedAt, null),
    reviewedBy: cleanDiscordId(input.reviewedBy),
    reviewedAt: cleanTimestamp(input.reviewedAt, null),
    reviewReason: cleanString(input.reviewReason || '', '', 500),
    implementedBy: cleanDiscordId(input.implementedBy),
    implementedAt: cleanTimestamp(input.implementedAt, null),
    implementationNote: cleanString(input.implementationNote || '', '', 500),
    history,
  };
}

function calculateAnalytics(records = {}) {
  const items = Object.values(records || {});
  return {
    submitted: items.length,
    discussing: items.filter((item) => item.status === 'discussing').length,
    approved: items.filter((item) => ['approved', 'implemented'].includes(item.status)).length,
    implemented: items.filter((item) => item.status === 'implemented').length,
    denied: items.filter((item) => item.status === 'denied').length,
    votesUp: items.reduce((total, item) => total + (Array.isArray(item.upVotes) ? item.upVotes.length : 0), 0),
    votesDown: items.reduce((total, item) => total + (Array.isArray(item.downVotes) ? item.downVotes.length : 0), 0),
  };
}

function normalizeSection(section = {}) {
  const base = defaultSuggestionsSection();
  const source = isPlainObject(section) ? section : {};
  const canonicalStored = isPlainObject(source.suggestions) ? source.suggestions : {};
  const legacyStored = isPlainObject(source.items) ? source.items : {};
  const stored = Object.keys(canonicalStored).length ? canonicalStored : legacyStored;
  const normalizedSuggestions = {};

  for (const [storedId, rawSuggestion] of Object.entries(stored)) {
    if (!isPlainObject(rawSuggestion)) continue;
    const suggestionId = cleanSuggestionId(rawSuggestion.suggestionId || rawSuggestion.id || storedId);
    if (!suggestionId) continue;
    const normalized = normalizeSuggestion(
      { ...rawSuggestion, suggestionId },
      { anonymous: source.anonymous === true },
    );
    normalizedSuggestions[normalized.suggestionId] = normalized;
  }

  const createdAt = cleanTimestamp(source.createdAt, base.createdAt);
  return {
    submitChannelId: cleanDiscordId(source.submitChannelId),
    reviewChannelId: cleanDiscordId(source.reviewChannelId),
    approvedChannelId: cleanDiscordId(source.approvedChannelId),
    deniedChannelId: cleanDiscordId(source.deniedChannelId),
    logChannelId: cleanDiscordId(source.logChannelId),
    reviewerRoleIds: cleanIdArray(source.reviewerRoleIds),
    anonymous: source.anonymous === true,
    voting: source.voting !== false,
    requireReview: source.requireReview !== false,
    deployment: normalizeDeployment(source.deployment),
    suggestions: normalizedSuggestions,
    analytics: calculateAnalytics(normalizedSuggestions),
    createdAt,
    updatedAt: cleanTimestamp(source.updatedAt, createdAt),
  };
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, MODULE_KEY, defaultSuggestionsSection()));
}

function saveSection(guildId, section, guildOrMeta = {}) {
  return normalizeSection(saveModuleSection(
    guildId,
    MODULE_KEY,
    normalizeSection(section),
    guildOrMeta,
  ));
}

function mutateSection(guildId, updater, guildOrMeta = {}) {
  return normalizeSection(updateModuleSection(
    guildId,
    MODULE_KEY,
    (current) => {
      const normalized = normalizeSection(current);
      const next = typeof updater === 'function' ? updater(normalized) : updater;
      return normalizeSection(isPlainObject(next) ? next : normalized);
    },
    defaultSuggestionsSection(),
    guildOrMeta,
  ));
}

function updateSection(guildId, updater, guildOrMeta = {}) {
  return mutateSection(guildId, (section) => {
    const proposed = typeof updater === 'function' ? updater({ ...section }) : updater;
    const source = isPlainObject(proposed) ? proposed : {};
    const next = { ...section };
    for (const key of CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = source[key];
    }
    next.updatedAt = now();
    return next;
  }, guildOrMeta);
}

function saveSuggestion(guildId, suggestion, guildOrMeta = {}) {
  const normalized = normalizeSuggestion(suggestion);
  return mutateSection(guildId, (section) => ({
    ...section,
    suggestions: {
      ...section.suggestions,
      [normalized.suggestionId]: normalizeSuggestion({
        ...(section.suggestions?.[normalized.suggestionId] || {}),
        ...normalized,
        updatedAt: now(),
      }),
    },
    updatedAt: now(),
  }), guildOrMeta).suggestions[normalized.suggestionId];
}

function getSuggestion(guildId, suggestionId) {
  const id = cleanSuggestionId(suggestionId);
  return id ? getSection(guildId).suggestions?.[id] || null : null;
}

function updateSuggestion(guildId, suggestionId, updater, guildOrMeta = {}) {
  const id = cleanSuggestionId(suggestionId);
  if (!id) return null;
  return mutateSection(guildId, (section) => {
    const current = section.suggestions?.[id];
    if (!current) return section;
    const next = typeof updater === 'function' ? updater({ ...current }) : updater;
    return {
      ...section,
      suggestions: {
        ...section.suggestions,
        [id]: normalizeSuggestion({
          ...current,
          ...(isPlainObject(next) ? next : {}),
          suggestionId: id,
          updatedAt: now(),
        }),
      },
      updatedAt: now(),
    };
  }, guildOrMeta).suggestions?.[id] || null;
}

function addHistoryEvent(guildId, suggestionId, event, guildOrMeta = {}) {
  return updateSuggestion(guildId, suggestionId, (current) => ({
    ...current,
    history: appendHistory(current.history, event),
  }), guildOrMeta);
}

function saveDeployment(guildId, deployment, guildOrMeta = {}) {
  return mutateSection(guildId, (section) => ({
    ...section,
    deployment: normalizeDeployment({ ...section.deployment, ...(isPlainObject(deployment) ? deployment : {}), updatedAt: now() }),
    updatedAt: now(),
  }), guildOrMeta).deployment;
}

function incrementAnalytics(guildId, _changes = {}, guildOrMeta = {}) {
  return mutateSection(guildId, (section) => ({ ...section, updatedAt: now() }), guildOrMeta).analytics;
}

module.exports = {
  MODULE_KEY,
  SUGGESTION_STATUSES,
  now,
  cleanDiscordId,
  cleanSuggestionId,
  createId,
  referenceFromId,
  appendHistory,
  defaultSuggestionsSection,
  normalizeSection,
  normalizeSuggestion,
  getSection,
  saveSection,
  updateSection,
  saveSuggestion,
  getSuggestion,
  updateSuggestion,
  addHistoryEvent,
  saveDeployment,
  incrementAnalytics,
};
