'use strict';

const crypto = require('node:crypto');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE_KEY = 'suggestions';

function now() { return new Date().toISOString(); }
function createId(prefix = 'suggestion') { return `${prefix}_${crypto.randomUUID().slice(0, 8)}`; }
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
function cleanString(value, fallback = '', maxLength = 1000) { return String(value ?? fallback).trim().slice(0, maxLength); }
function cleanIdArray(value) { return Array.isArray(value) ? [...new Set(value.map(cleanDiscordId).filter(Boolean))] : []; }

function defaultSuggestionsSection() {
  return {
    submitChannelId: null,
    reviewChannelId: null,
    approvedChannelId: null,
    deniedChannelId: null,
    reviewerRoleIds: [],
    anonymous: false,
    voting: true,
    requireReview: true,
    suggestions: {},
    analytics: { submitted: 0, approved: 0, denied: 0, votesUp: 0, votesDown: 0 },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeSuggestion(input = {}) {
  const suggestionId = cleanString(input.suggestionId || input.id || createId('sg'), 'sg', 80);
  return {
    suggestionId,
    id: suggestionId,
    status: ['pending', 'approved', 'denied'].includes(input.status) ? input.status : 'pending',
    content: cleanString(input.content || '', '', 1800),
    authorId: cleanDiscordId(input.authorId),
    channelId: cleanDiscordId(input.channelId),
    messageId: cleanDiscordId(input.messageId),
    reviewMessageId: cleanDiscordId(input.reviewMessageId),
    upVotes: cleanIdArray(input.upVotes),
    downVotes: cleanIdArray(input.downVotes),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || input.createdAt || now(),
    reviewedBy: cleanDiscordId(input.reviewedBy),
    reviewedAt: input.reviewedAt || null,
    reviewReason: cleanString(input.reviewReason || '', '', 500),
  };
}

function normalizeSection(section = {}) {
  const base = defaultSuggestionsSection();
  const source = section && typeof section === 'object' ? section : {};
  const stored = source.suggestions && typeof source.suggestions === 'object' ? source.suggestions : {};
  const normalized = {
    ...base,
    ...source,
    submitChannelId: cleanDiscordId(source.submitChannelId),
    reviewChannelId: cleanDiscordId(source.reviewChannelId),
    approvedChannelId: cleanDiscordId(source.approvedChannelId),
    deniedChannelId: cleanDiscordId(source.deniedChannelId),
    reviewerRoleIds: cleanIdArray(source.reviewerRoleIds),
    anonymous: source.anonymous === true,
    voting: source.voting !== false,
    requireReview: source.requireReview !== false,
    suggestions: Object.fromEntries(Object.entries(stored).map(([id, suggestion]) => {
      const normalizedSuggestion = normalizeSuggestion({ ...suggestion, suggestionId: suggestion.suggestionId || id });
      return [normalizedSuggestion.suggestionId, normalizedSuggestion];
    })),
    analytics: {
      submitted: Math.max(0, Number(source.analytics?.submitted || 0)),
      approved: Math.max(0, Number(source.analytics?.approved || 0)),
      denied: Math.max(0, Number(source.analytics?.denied || 0)),
      votesUp: Math.max(0, Number(source.analytics?.votesUp || 0)),
      votesDown: Math.max(0, Number(source.analytics?.votesDown || 0)),
    },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
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
function updateSection(guildId, updater, guildOrMeta = {}) {
  return normalizeSection(updateModuleSection(
    guildId,
    MODULE_KEY,
    (current) => {
      const normalized = normalizeSection(current);
      const next = typeof updater === 'function' ? updater(normalized) : updater;
      return normalizeSection(next);
    },
    defaultSuggestionsSection(),
    guildOrMeta,
  ));
}
function saveSuggestion(guildId, suggestion, guildOrMeta = {}) {
  const normalized = normalizeSuggestion(suggestion);
  return updateSection(guildId, (section) => ({
    ...section,
    suggestions: {
      ...section.suggestions,
      [normalized.suggestionId]: { ...(section.suggestions?.[normalized.suggestionId] || {}), ...normalized, updatedAt: now() },
    },
    updatedAt: now(),
  }), guildOrMeta).suggestions[normalized.suggestionId];
}
function getSuggestion(guildId, suggestionId) { return getSection(guildId).suggestions?.[cleanString(suggestionId, '', 80)] || null; }
function updateSuggestion(guildId, suggestionId, updater, guildOrMeta = {}) {
  return updateSection(guildId, (section) => {
    const current = section.suggestions?.[suggestionId];
    if (!current) return section;
    const next = typeof updater === 'function' ? updater(current) : updater;
    return {
      ...section,
      suggestions: { ...section.suggestions, [suggestionId]: normalizeSuggestion({ ...current, ...next, suggestionId, updatedAt: now() }) },
      updatedAt: now(),
    };
  }, guildOrMeta).suggestions?.[suggestionId] || null;
}
function incrementAnalytics(guildId, changes = {}, guildOrMeta = {}) {
  return updateSection(guildId, (section) => ({
    ...section,
    analytics: {
      submitted: section.analytics.submitted + Math.max(0, Number(changes.submitted || 0)),
      approved: section.analytics.approved + Math.max(0, Number(changes.approved || 0)),
      denied: section.analytics.denied + Math.max(0, Number(changes.denied || 0)),
      votesUp: section.analytics.votesUp + Math.max(0, Number(changes.votesUp || 0)),
      votesDown: section.analytics.votesDown + Math.max(0, Number(changes.votesDown || 0)),
    },
    updatedAt: now(),
  }), guildOrMeta).analytics;
}

module.exports = { MODULE_KEY, now, cleanDiscordId, createId, defaultSuggestionsSection, normalizeSection, normalizeSuggestion, getSection, saveSection, updateSection, saveSuggestion, getSuggestion, updateSuggestion, incrementAnalytics };
