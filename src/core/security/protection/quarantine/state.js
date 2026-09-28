'use strict';

const guildManager = require('../../../guild/guildManager');
const { emitGuildUpdate } = require('../../../../server/sockets/socketHub');

const DEFAULT_QUARANTINE_ROLE_NAME = 'Goliath Quarantine';
const DEFAULT_INVESTIGATION_CATEGORY_NAME = 'Goliath Investigations';
const MAX_ARCHIVED_INVESTIGATION_ROOMS = 50;
const MAX_PENDING_INVESTIGATION_ROOM_CLEANUPS = 50;
const QUARANTINE_MODES = Object.freeze({
  INVESTIGATION: 'investigation',
  SECURITY: 'security',
});

function emptyQuarantineState() {
  return {
    enabled: true,
    roleId: null,
    roleName: DEFAULT_QUARANTINE_ROLE_NAME,
    isolationSyncedAt: null,
    investigationCategoryId: null,
    investigationCategoryName: DEFAULT_INVESTIGATION_CATEGORY_NAME,
    archivedRooms: [],
    pendingRoomCleanups: [],
    users: {},
  };
}

function normalizeUsers(users) {
  return users && typeof users === 'object' && !Array.isArray(users) ? users : {};
}

function normalizeArchivedRooms(value) {
  return Array.isArray(value) ? value.slice(-MAX_ARCHIVED_INVESTIGATION_ROOMS) : [];
}

function normalizePendingRoomCleanups(value) {
  if (!Array.isArray(value)) return [];
  const byChannel = new Map();
  for (const entry of value) {
    const channelId = String(entry?.channelId || entry?.interviewChannelId || entry?.previousInterviewChannelId || '').trim();
    if (!channelId) continue;
    byChannel.set(channelId, {
      channelId,
      interviewChannelId: channelId,
      memberId: entry?.memberId ? String(entry.memberId) : null,
      caseId: entry?.caseId ?? null,
      queuedAt: Number(entry?.queuedAt) || Date.now(),
      lastError: entry?.lastError ? String(entry.lastError).slice(0, 500) : null,
    });
  }
  return [...byChannel.values()].slice(-MAX_PENDING_INVESTIGATION_ROOM_CLEANUPS);
}

function getQuarantineState(guildId) {
  const security = guildManager.getSecurityConfig(guildId) || {};
  const raw = security.quarantine && typeof security.quarantine === 'object' && !Array.isArray(security.quarantine)
    ? security.quarantine
    : {};
  return {
    ...emptyQuarantineState(),
    ...raw,
    archivedRooms: normalizeArchivedRooms(raw.archivedRooms),
    pendingRoomCleanups: normalizePendingRoomCleanups(raw.pendingRoomCleanups),
    users: normalizeUsers(raw.users),
  };
}

function saveQuarantineState(guild, state) {
  const normalized = {
    ...emptyQuarantineState(),
    ...(state || {}),
    archivedRooms: normalizeArchivedRooms(state?.archivedRooms),
    pendingRoomCleanups: normalizePendingRoomCleanups(state?.pendingRoomCleanups),
    users: normalizeUsers(state?.users),
  };
  return guildManager.updateSecurityConfig(
    guild.id,
    (security) => ({ ...security, quarantine: normalized }),
    guild,
  );
}

function emitCurrentQuarantineState(guild, action, extra = {}) {
  try {
    emitGuildUpdate(guild.id, {
      module: 'security',
      event: 'security.quarantine.updated',
      data: { action, quarantine: getQuarantineState(guild.id), ...extra },
    });
  } catch (error) {
    console.warn('[QuarantineSystem] Failed to emit quarantine update:', error.message);
  }
}

function getQuarantineMode(snapshot = {}) {
  const value = String(snapshot?.mode || '').trim().toLowerCase();
  if (value === QUARANTINE_MODES.INVESTIGATION) return QUARANTINE_MODES.INVESTIGATION;
  if (value === QUARANTINE_MODES.SECURITY) return QUARANTINE_MODES.SECURITY;
  return QUARANTINE_MODES.SECURITY;
}

module.exports = {
  DEFAULT_QUARANTINE_ROLE_NAME,
  DEFAULT_INVESTIGATION_CATEGORY_NAME,
  MAX_ARCHIVED_INVESTIGATION_ROOMS,
  MAX_PENDING_INVESTIGATION_ROOM_CLEANUPS,
  QUARANTINE_MODES,
  emptyQuarantineState,
  normalizeUsers,
  normalizeArchivedRooms,
  normalizePendingRoomCleanups,
  getQuarantineState,
  saveQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
};