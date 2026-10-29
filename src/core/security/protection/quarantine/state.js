'use strict';

const guildManager = require('../../../guild/guildManager');
const { emitGuildUpdate } = require('../../../../server/sockets/socketHub');

const DEFAULT_QUARANTINE_ROLE_NAME = 'Goliath Quarantine';
const DEFAULT_INVESTIGATION_CATEGORY_NAME = 'Investigations';
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
    byChannel.set(`${channelId}:${entry?.memberId || ''}`, {
      channelId,
      interviewChannelId: channelId,
      memberId: entry?.memberId ? String(entry.memberId) : null,
      caseId: entry?.caseId ?? null,
      investigationGroupId: entry?.investigationGroupId || null,
      investigationMemberIds: Array.isArray(entry?.investigationMemberIds) ? entry.investigationMemberIds : null,
      roomTranscript: entry?.roomTranscript || null,
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

function hasOriginalQuarantineRoles(snapshot = {}) {
  return Array.isArray(snapshot?.roles) && snapshot.roles.every(id => typeof id === 'string' && /^\d{15,25}$/.test(id));
}

function isAutomaticQuarantineReleaseDue(snapshot = {}) {
  if (snapshot?.investigationGroupId) return false;
  const expiresAt = Number(snapshot?.expiresAt);
  return snapshot?.autoRelease === true && Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt;
}

// Only explicit, reciprocal group metadata created by the new-case workflow
// authorises shared ownership. Legacy duplicate links remain review failures.
function isSharedInvestigationRoom(users, roomId) {
  if (!roomId) return false;
  const owners = Object.entries(users || {}).filter(([, snapshot]) =>
    [snapshot.interviewChannelId, snapshot.previousInterviewChannelId].some(id => id && String(id) === String(roomId)));
  if (!owners.length) return false;
  const first = owners[0][1];
  const ids = first.investigationMemberIds;
  if (typeof first.investigationGroupId !== 'string' || !first.investigationGroupId
    || !Array.isArray(ids) || ids.length < 2 || ids.length > 6 || new Set(ids).size !== ids.length
    || !ids.every(id => typeof id === 'string' && /^\d{15,25}$/.test(id))) return false;
  const signature = [...ids].sort().join(',');
  return owners.every(([id, snapshot]) => ids.includes(id) && hasOriginalQuarantineRoles(snapshot)
    && snapshot.investigationGroupId === first.investigationGroupId
    && Array.isArray(snapshot.investigationMemberIds)
    && [...snapshot.investigationMemberIds].sort().join(',') === signature);
}

// Read-only reconciliation: never infer original roles or migrate a legacy case.
function auditQuarantineSnapshots(sessions = {}, users = {}) {
  const roomOwners = new Map();
  const link = (roomId, userId) => {
    if (!roomId) return;
    const key = String(roomId);
    if (!roomOwners.has(key)) roomOwners.set(key, new Set());
    roomOwners.get(key).add(userId);
  };
  for (const [userId, snapshot] of Object.entries(users)) link(snapshot?.interviewChannelId, userId);
  for (const [userId, session] of Object.entries(sessions)) {
    if (session?.state === 'quarantined' || (session?.state === 'review' && (session.quarantineChannelId || session.moderationIsolationMode))) link(session.quarantineChannelId, userId);
  }
  const cases = [];
  for (const userId of new Set([...Object.keys(sessions), ...Object.keys(users)])) {
    const session = sessions[userId];
    const snapshot = users[userId];
    const activeSession = session?.state === 'quarantined' || (session?.state === 'review' && (snapshot || session.quarantineChannelId || session.moderationIsolationMode));
    if (!activeSession && !snapshot) continue; // A normal staff-approval review is not a legacy quarantine.
    const reasons = [];
    if (!snapshot) reasons.push('legacy_without_shared_snapshot');
    else {
      if (snapshot.allowedChannelIds?.length) reasons.push('legacy_extra_channel_access');
      if (!Array.isArray(snapshot.roles)) reasons.push('missing_original_roles');
      else if (!hasOriginalQuarantineRoles(snapshot)) reasons.push('invalid_original_roles');
      if (getQuarantineMode(snapshot) === QUARANTINE_MODES.INVESTIGATION && !snapshot.interviewChannelId) reasons.push('missing_shared_room');
      if (session?.quarantineChannelId && snapshot.interviewChannelId && String(session.quarantineChannelId) !== String(snapshot.interviewChannelId)) reasons.push('room_mismatch');
      if (session?.moderationIsolationMode && session.moderationIsolationMode !== getQuarantineMode(snapshot)) reasons.push('isolation_mode_mismatch');
      if ((snapshot.source === 'verification' && !activeSession) || (session?.moderationIsolationMode && !['quarantined', 'review'].includes(session.state))) reasons.push('verification_state_conflict');
    }
    const rooms = [activeSession && session?.quarantineChannelId, snapshot?.interviewChannelId].filter(Boolean).map(String);
    const duplicateRoomIds = [...new Set(rooms.filter(id => roomOwners.get(id)?.size > 1 && !isSharedInvestigationRoom(users, id)))];
    if (duplicateRoomIds.length) reasons.push('duplicate_room_assignment');
    if (reasons.length) cases.push({ userId, reason: reasons[0], reasons, verificationState: session?.state || null, verificationRoomId: session?.quarantineChannelId || null, sharedRoomId: snapshot?.interviewChannelId || null, duplicateRoomIds });
  }
  return { checked: Object.keys(sessions).length, sharedChecked: Object.keys(users).length, needsReview: cases.length, cases };
}

module.exports = {
  DEFAULT_QUARANTINE_ROLE_NAME,
  DEFAULT_INVESTIGATION_CATEGORY_NAME,
  MAX_ARCHIVED_INVESTIGATION_ROOMS,
  MAX_PENDING_INVESTIGATION_ROOM_CLEANUPS,
  QUARANTINE_MODES,
  emptyQuarantineState,
  auditQuarantineSnapshots,
  isSharedInvestigationRoom,
  isAutomaticQuarantineReleaseDue,
  hasOriginalQuarantineRoles,
  normalizeUsers,
  normalizeArchivedRooms,
  normalizePendingRoomCleanups,
  getQuarantineState,
  saveQuarantineState,
  emitCurrentQuarantineState,
  getQuarantineMode,
};