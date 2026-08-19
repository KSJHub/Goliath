'use strict';

const crypto = require('node:crypto');
const guildManager = require('../../../core/guild/guildManager');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');

const MODULE_KEY = 'giveaways';

function now() {
  return new Date().toISOString();
}

function createId(prefix = 'giveaway') {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanDiscordId).filter(Boolean))];
}

function cleanString(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function defaultGiveawaysSection() {
  return {
    announcementChannelId: null,
    logChannelId: null,
    managerRoleIds: [],
    allowMultipleEntries: false,
    allowBotEntries: false,
    requireRole: false,
    requiredRoleIds: [],
    blockedRoleIds: [],
    pingWinners: true,
    defaultWinnerCount: 1,
    giveaways: {},
    analytics: {
      created: 0,
      ended: 0,
      entries: 0,
      rerolls: 0,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeGiveaway(input = {}) {
  const giveawayId = cleanString(input.giveawayId || input.id || createId('gw'), 'gw', 80);
  const createdBy = cleanDiscordId(input.createdBy || input.hostId);
  const status = ['draft', 'active', 'ended', 'cancelled'].includes(input.status)
    ? input.status
    : 'active';

  return {
    giveawayId,
    id: giveawayId,
    enabled: input.enabled !== false,
    status,
    prize: cleanString(input.prize || 'Mystery Prize', 'Mystery Prize', 200),
    description: cleanString(input.description || '', '', 1000),
    winnerCount: Math.max(1, Math.min(20, Math.floor(cleanNumber(input.winnerCount, 1)))),
    endsAt: input.endsAt || null,
    channelId: cleanDiscordId(input.channelId),
    messageId: cleanDiscordId(input.messageId),
    createdBy,
    hostId: createdBy,
    entries: cleanIdArray(input.entries),
    winners: cleanIdArray(input.winners),
    requiredRoleIds: cleanIdArray(input.requiredRoleIds),
    blockedRoleIds: cleanIdArray(input.blockedRoleIds),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || input.createdAt || now(),
    endedAt: input.endedAt || null,
  };
}

function normalizeSection(section = {}) {
  const base = defaultGiveawaysSection();
  const source = section && typeof section === 'object' ? section : {};
  const giveaways = source.giveaways && typeof source.giveaways === 'object'
    ? source.giveaways
    : {};

  const normalized = {
    ...base,
    ...source,
    announcementChannelId: cleanDiscordId(source.announcementChannelId),
    logChannelId: cleanDiscordId(source.logChannelId),
    managerRoleIds: cleanIdArray(source.managerRoleIds),
    allowMultipleEntries: source.allowMultipleEntries === true,
    allowBotEntries: source.allowBotEntries === true,
    requireRole: source.requireRole === true,
    requiredRoleIds: cleanIdArray(source.requiredRoleIds),
    blockedRoleIds: cleanIdArray(source.blockedRoleIds),
    pingWinners: source.pingWinners !== false,
    defaultWinnerCount: Math.max(1, Math.min(20, Math.floor(cleanNumber(source.defaultWinnerCount, 1)))),
    giveaways: Object.fromEntries(
      Object.entries(giveaways).map(([id, giveaway]) => {
        const normalizedGiveaway = normalizeGiveaway({ ...giveaway, giveawayId: giveaway.giveawayId || id });
        return [normalizedGiveaway.giveawayId, normalizedGiveaway];
      })
    ),
    analytics: {
      created: Math.max(0, Number(source.analytics?.created || 0)),
      ended: Math.max(0, Number(source.analytics?.ended || 0)),
      entries: Math.max(0, Number(source.analytics?.entries || 0)),
      rerolls: Math.max(0, Number(source.analytics?.rerolls || 0)),
    },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, MODULE_KEY, defaultGiveawaysSection()));
}

function saveSection(guildId, section, guildOrMeta = {}) {
  return normalizeSection(saveModuleSection(
    guildId,
    MODULE_KEY,
    normalizeSection(section),
    guildOrMeta
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
    defaultGiveawaysSection(),
    guildOrMeta
  ));
}

function isEnabled(guildId) {
  return guildManager.isModuleEnabled(guildId, MODULE_KEY);
}

function setEnabled(guildId, enabled = true, guildOrMeta = {}) {
  guildManager.setModuleEnabled(guildId, MODULE_KEY, enabled === true, guildOrMeta);
  return { ...getSection(guildId), enabled: isEnabled(guildId) };
}

function exportConfiguration(guildId) {
  return { ...getSection(guildId), enabled: isEnabled(guildId) };
}

function saveGiveaway(guildId, giveaway, guildOrMeta = {}) {
  const inputId = cleanString(giveaway?.giveawayId || giveaway?.id || '', '', 80);
  const existing = inputId ? getSection(guildId).giveaways?.[inputId] : null;
  const normalized = normalizeGiveaway({ ...(existing || {}), ...(giveaway || {}) });

  return updateSection(guildId, (section) => ({
    ...section,
    giveaways: {
      ...(section.giveaways || {}),
      [normalized.giveawayId]: normalized,
    },
    updatedAt: now(),
  }), guildOrMeta).giveaways[normalized.giveawayId];
}

function getGiveaway(guildId, giveawayId) {
  return getSection(guildId).giveaways?.[cleanString(giveawayId, '', 80)] || null;
}

function getGiveaways(guildId) {
  return Object.values(getSection(guildId).giveaways || {});
}

function getActiveGiveaways(guildId) {
  return getGiveaways(guildId).filter((giveaway) => giveaway.enabled !== false && giveaway.status === 'active');
}

function updateGiveaway(guildId, giveawayId, updater, guildOrMeta = {}) {
  return updateSection(guildId, (section) => {
    const current = section.giveaways?.[giveawayId];
    if (!current) return section;
    const next = typeof updater === 'function' ? updater(current) : updater;
    return {
      ...section,
      giveaways: {
        ...(section.giveaways || {}),
        [giveawayId]: normalizeGiveaway({ ...current, ...(next || {}), giveawayId, updatedAt: now() }),
      },
      updatedAt: now(),
    };
  }, guildOrMeta).giveaways?.[giveawayId] || null;
}

function incrementAnalytics(guildId, changes = {}, guildOrMeta = {}) {
  return updateSection(guildId, (section) => ({
    ...section,
    analytics: {
      created: section.analytics.created + Math.max(0, Number(changes.created || 0)),
      ended: section.analytics.ended + Math.max(0, Number(changes.ended || 0)),
      entries: section.analytics.entries + Math.max(0, Number(changes.entries || 0)),
      rerolls: section.analytics.rerolls + Math.max(0, Number(changes.rerolls || 0)),
    },
    updatedAt: now(),
  }), guildOrMeta).analytics;
}

module.exports = {
  MODULE_KEY,
  now,
  createId,
  cleanDiscordId,
  defaultGiveawaysSection,
  normalizeSection,
  normalizeGiveaway,
  getSection,
  saveSection,
  updateSection,
  isEnabled,
  setEnabled,
  exportConfiguration,
  saveGiveaway,
  getGiveaway,
  getGiveaways,
  getActiveGiveaways,
  updateGiveaway,
  incrementAnalytics,
};
