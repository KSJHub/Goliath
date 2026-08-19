'use strict';

// src/modules/utilityStudio/tempVoice/tempVoiceStore.js

const crypto = require('node:crypto');

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const guildManager = require('../../../core/guild/guildManager');

const SECTION = 'tempVoice';

function now() {
  return new Date().toISOString();
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanString(value, fallback = '', maxLength = 100) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanNonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.floor(cleanNumber(value, fallback)));
}

function cleanDiscordIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanDiscordId).filter(Boolean))];
}

function createId(prefix = 'tempvoice') {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function defaultAnalytics() {
  return {
    totalCreated: 0,
    totalDeleted: 0,
    totalClaimed: 0,
    totalLocked: 0,
    totalUnlocked: 0,
    totalHidden: 0,
    totalShown: 0,
    totalRenamed: 0,
    totalLimitChanges: 0,
    totalStatusChanges: 0,
    totalTransfers: 0,
    totalMembersRemoved: 0,
    totalMembersRestricted: 0,
    lastActivityAt: null,
  };
}

function defaultTempVoiceSection() {
  return {
    hubs: {},
    channels: {},
    settings: {
      defaultUserLimit: 0,
      deleteWhenEmpty: true,
      ownerPanelEnabled: true,
      allowOwnerRename: true,
      allowOwnerStatus: true,
      allowOwnerLock: true,
      allowOwnerHide: true,
      allowOwnerLimit: true,
      allowOwnerPermits: true,
      allowOwnerTransfer: true,
      allowOwnerDelete: true,
    },
    analytics: defaultAnalytics(),
    activity: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeHub(hub = {}) {
  const hubId = cleanString(hub.hubId || hub.id || createId('tv_hub'), 'tv_hub', 80);

  return {
    hubId,
    id: hubId,
    enabled: hub.enabled !== false,
    joinChannelId: cleanDiscordId(hub.joinChannelId || hub.lobbyChannelId),
    joinChannelName: cleanString(hub.joinChannelName || hub.name || '➕ Create Temp Voice', '➕ Create Temp Voice', 80),
    categoryId: cleanDiscordId(hub.categoryId),
    categoryName: cleanString(hub.categoryName || 'Temporary Voice Channels', 'Temporary Voice Channels', 80),
    nameTemplate: cleanString(hub.nameTemplate || '{username}\'s Channel', '{username}\'s Channel', 80),
    userLimit: cleanNonNegativeInt(hub.userLimit, 0),
    bitrate: cleanNonNegativeInt(hub.bitrate, 0),
    lockedByDefault: hub.lockedByDefault === true,
    hiddenByDefault: hub.hiddenByDefault === true,
    ownerControlsEnabled: hub.ownerControlsEnabled !== false,
    managerRoleIds: cleanDiscordIdArray(hub.managerRoleIds),
    createdBy: cleanDiscordId(hub.createdBy),
    createdAt: hub.createdAt || now(),
    updatedAt: hub.updatedAt || hub.createdAt || now(),
  };
}

function normalizeChannel(channel = {}) {
  return {
    channelId: cleanDiscordId(channel.channelId),
    ownerId: cleanDiscordId(channel.ownerId),
    hubId: cleanString(channel.hubId || '', '', 80) || null,
    guildId: cleanDiscordId(channel.guildId),
    name: cleanString(channel.name || '', '', 80),
    activityStatus: cleanString(channel.activityStatus || '', '', 120),
    userLimit: cleanNonNegativeInt(channel.userLimit, 0),
    locked: channel.locked === true,
    hidden: channel.hidden === true,
    allowedUserIds: cleanDiscordIdArray(channel.allowedUserIds),
    blockedUserIds: cleanDiscordIdArray(channel.blockedUserIds),
    allowedRoleIds: cleanDiscordIdArray(channel.allowedRoleIds),
    blockedRoleIds: cleanDiscordIdArray(channel.blockedRoleIds),
    controlMessageId: cleanDiscordId(channel.controlMessageId),
    createdAt: channel.createdAt || now(),
    updatedAt: channel.updatedAt || channel.createdAt || now(),
  };
}

function normalizeActivityEntry(entry = {}) {
  return {
    id: cleanString(entry.id || createId('tv_event'), 'tv_event', 80),
    type: cleanString(entry.type || 'event', 'event', 80),
    label: cleanString(entry.label || 'Temp Voice event', 'Temp Voice event', 180),
    channelId: cleanDiscordId(entry.channelId),
    ownerId: cleanDiscordId(entry.ownerId),
    actorId: cleanDiscordId(entry.actorId),
    targetId: cleanDiscordId(entry.targetId),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    createdAt: entry.createdAt || now(),
  };
}

function normalizeAnalytics(analytics = {}) {
  const base = defaultAnalytics();
  const next = { ...base, ...(analytics && typeof analytics === 'object' ? analytics : {}) };

  for (const key of Object.keys(base)) {
    if (key === 'lastActivityAt') continue;
    next[key] = cleanNonNegativeInt(next[key], 0);
  }

  next.lastActivityAt = next.lastActivityAt || null;
  return next;
}

function buildAdminConfiguredHub(source = {}) {
  const joinChannelId = cleanDiscordId(source.lobbyChannelId || source.joinChannelId);
  if (!joinChannelId) return null;

  return normalizeHub({
    hubId: 'admin_default',
    enabled: true,
    joinChannelId,
    categoryId: source.categoryId,
    managerRoleIds: source.managerRoleIds,
    nameTemplate: source.nameTemplate || '{username}\'s Channel',
    ownerControlsEnabled: true,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  });
}

function normalizeSection(section = {}) {
  const base = defaultTempVoiceSection();
  const source = section && typeof section === 'object' ? section : {};
  const hubs = source.hubs && typeof source.hubs === 'object' ? source.hubs : {};
  const channels = source.channels && typeof source.channels === 'object' ? source.channels : {};
  const adminHub = buildAdminConfiguredHub(source);
  const normalizedHubs = Object.fromEntries(
    Object.entries(hubs)
      .map(([id, hub]) => {
        const normalized = normalizeHub({ ...hub, hubId: hub.hubId || id });
        return [normalized.hubId, normalized];
      })
      .filter(([, hub]) => hub.joinChannelId)
  );

  if (adminHub?.joinChannelId) normalizedHubs[adminHub.hubId] = adminHub;

  const normalized = {
    ...base,
    ...source,
    lobbyChannelId: cleanDiscordId(source.lobbyChannelId || source.joinChannelId),
    categoryId: cleanDiscordId(source.categoryId),
    managerRoleIds: cleanDiscordIdArray(source.managerRoleIds),
    settings: {
      ...base.settings,
      ...(source.settings || {}),
      defaultUserLimit: cleanNonNegativeInt(source.settings?.defaultUserLimit || source.defaultUserLimit, 0),
      deleteWhenEmpty: source.settings?.deleteWhenEmpty !== false && source.autoDeleteEmpty !== false,
      ownerPanelEnabled: source.settings?.ownerPanelEnabled !== false,
      allowOwnerRename: source.settings?.allowOwnerRename !== false && source.allowUserRename !== false,
      allowOwnerStatus: source.settings?.allowOwnerStatus !== false,
      allowOwnerLock: source.settings?.allowOwnerLock !== false,
      allowOwnerHide: source.settings?.allowOwnerHide !== false,
      allowOwnerLimit: source.settings?.allowOwnerLimit !== false && source.allowUserLimit !== false,
      allowOwnerPermits: source.settings?.allowOwnerPermits !== false,
      allowOwnerTransfer: source.settings?.allowOwnerTransfer !== false,
      allowOwnerDelete: source.settings?.allowOwnerDelete !== false,
    },
    hubs: normalizedHubs,
    channels: Object.fromEntries(
      Object.entries(channels)
        .map(([id, channel]) => {
          const normalized = normalizeChannel({ ...channel, channelId: channel.channelId || id });
          return [normalized.channelId, normalized];
        })
        .filter(([, channel]) => channel.channelId && channel.ownerId)
    ),
    analytics: normalizeAnalytics(source.analytics),
    activity: Array.isArray(source.activity) ? source.activity.map(normalizeActivityEntry).slice(-150) : [],
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function isEnabled(guildId) {
  return guildManager.isModuleEnabled(guildId, SECTION) === true;
}

function setEnabled(guildId, enabled, meta = {}) {
  return guildManager.setModuleEnabled(guildId, SECTION, enabled === true, meta);
}

function getTempVoiceSection(guildId) {
  return normalizeSection(getModuleSection(guildId, SECTION, defaultTempVoiceSection()));
}

function exportConfiguration(guildId) {
  return {
    ...getTempVoiceSection(guildId),
    enabled: isEnabled(guildId),
  };
}

function saveTempVoiceSection(guildId, section, meta = {}) {
  return normalizeSection(saveModuleSection(
    guildId,
    SECTION,
    normalizeSection(section),
    meta
  ));
}

function updateTempVoiceSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(
    guildId,
    SECTION,
    (current) => {
      const normalized = normalizeSection(current);
      const next = typeof updater === 'function' ? updater(normalized) : updater;
      return normalizeSection(next);
    },
    defaultTempVoiceSection(),
    meta
  ));
}

function getHubs(guildId) {
  return Object.values(getTempVoiceSection(guildId).hubs || {});
}

function getHub(guildId, hubId) {
  return getTempVoiceSection(guildId).hubs?.[hubId] || null;
}

function addActivity(guildId, event = {}, meta = {}) {
  const entry = normalizeActivityEntry(event);
  const counterMap = {
    channel_created: 'totalCreated',
    channel_deleted: 'totalDeleted',
    channel_claimed: 'totalClaimed',
    channel_locked: 'totalLocked',
    channel_unlocked: 'totalUnlocked',
    channel_hidden: 'totalHidden',
    channel_shown: 'totalShown',
    channel_renamed: 'totalRenamed',
    channel_limit_changed: 'totalLimitChanges',
    channel_status_changed: 'totalStatusChanges',
    channel_transferred: 'totalTransfers',
    member_removed: 'totalMembersRemoved',
    member_restricted: 'totalMembersRestricted',
  };

  return updateTempVoiceSection(
    guildId,
    (section) => {
      const analytics = normalizeAnalytics(section.analytics);
      const counter = counterMap[entry.type];
      if (counter) analytics[counter] = cleanNonNegativeInt(analytics[counter], 0) + 1;
      analytics.lastActivityAt = entry.createdAt;

      return {
        ...section,
        analytics,
        activity: [...(section.activity || []), entry].slice(-150),
        updatedAt: now(),
      };
    },
    meta
  );
}

function saveHub(guildId, hub, meta = {}) {
  const normalized = normalizeHub(hub);

  return updateTempVoiceSection(
    guildId,
    (section) => ({
      ...section,
      hubs: {
        ...(section.hubs || {}),
        [normalized.hubId]: {
          ...(section.hubs?.[normalized.hubId] || {}),
          ...normalized,
          updatedAt: now(),
        },
      },
      updatedAt: now(),
    }),
    meta
  ).hubs[normalized.hubId];
}

function findHubByJoinChannel(guildId, channelId) {
  return getHubs(guildId).find(
    (hub) => hub.enabled !== false && hub.joinChannelId === channelId
  ) || null;
}

function saveTempChannel(guildId, channel, meta = {}) {
  const normalized = normalizeChannel({ ...channel, guildId });

  return updateTempVoiceSection(
    guildId,
    (section) => ({
      ...section,
      channels: {
        ...(section.channels || {}),
        [normalized.channelId]: {
          ...(section.channels?.[normalized.channelId] || {}),
          ...normalized,
          updatedAt: now(),
        },
      },
      updatedAt: now(),
    }),
    meta
  ).channels[normalized.channelId];
}

function getTempChannel(guildId, channelId) {
  return getTempVoiceSection(guildId).channels?.[channelId] || null;
}

function updateTempChannel(guildId, channelId, updater, meta = {}) {
  return updateTempVoiceSection(
    guildId,
    (section) => {
      const current = section.channels?.[channelId];
      if (!current) return section;
      const next = typeof updater === 'function' ? updater(current) : updater;

      return {
        ...section,
        channels: {
          ...(section.channels || {}),
          [channelId]: normalizeChannel({ ...current, ...next, channelId, updatedAt: now() }),
        },
        updatedAt: now(),
      };
    },
    meta
  ).channels?.[channelId] || null;
}

function deleteTempChannel(guildId, channelId, meta = {}) {
  return updateTempVoiceSection(
    guildId,
    (section) => {
      const channels = { ...(section.channels || {}) };
      delete channels[channelId];

      return {
        ...section,
        channels,
        updatedAt: now(),
      };
    },
    meta
  );
}

module.exports = {
  SECTION,
  now,
  cleanDiscordId,
  createId,
  defaultTempVoiceSection,
  normalizeSection,
  isEnabled,
  setEnabled,
  getTempVoiceSection,
  exportConfiguration,
  saveTempVoiceSection,
  updateTempVoiceSection,
  getHubs,
  getHub,
  saveHub,
  findHubByJoinChannel,
  saveTempChannel,
  getTempChannel,
  updateTempChannel,
  deleteTempChannel,
  addActivity,
};
