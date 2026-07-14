'use strict';

const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');

const MODULE = 'invites';

function now() {
  return new Date().toISOString();
}

function defaults() {
  return {
    enabled: false,
    channelId: null,
    inviteCode: null,
    autoRepair: true,
    trackingEnabled: true,
    lastCheckedAt: null,
    analytics: {
      trackedJoins: 0,
      unknownJoins: 0,
      lastJoinAt: null,
      lastInviteCode: null,
      lastInviterId: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function cleanId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function normalize(section = {}) {
  const base = defaults();
  const source = section && typeof section === 'object' ? section : {};
  const analytics = source.analytics && typeof source.analytics === 'object' ? source.analytics : {};

  return {
    ...base,
    ...source,
    enabled: source.enabled === true,
    channelId: cleanId(source.channelId),
    inviteCode: String(source.inviteCode || '').trim().slice(0, 100) || null,
    autoRepair: source.autoRepair !== false,
    trackingEnabled: source.trackingEnabled !== false,
    lastCheckedAt: source.lastCheckedAt || null,
    analytics: {
      ...base.analytics,
      ...analytics,
      trackedJoins: Math.max(0, Number(analytics.trackedJoins || 0)),
      unknownJoins: Math.max(0, Number(analytics.unknownJoins || 0)),
    },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: now(),
  };
}

function get(guildId) {
  return normalize(getModuleSection(guildId, MODULE, defaults()));
}

function set(guildId, patch, meta = {}) {
  return normalize(updateModuleSection(
    guildId,
    MODULE,
    current => normalize({ ...current, ...patch, updatedAt: now() }),
    defaults(),
    meta
  ));
}

function replace(guildId, section, meta = {}) {
  return normalize(saveModuleSection(guildId, MODULE, normalize(section), meta));
}

function recordJoin(guildId, result, meta = {}) {
  return set(guildId, {
    analytics: {
      ...get(guildId).analytics,
      trackedJoins: get(guildId).analytics.trackedJoins + (result ? 1 : 0),
      unknownJoins: get(guildId).analytics.unknownJoins + (result ? 0 : 1),
      lastJoinAt: now(),
      lastInviteCode: result?.code || null,
      lastInviterId: result?.inviterId || null,
    },
  }, meta);
}

function remove(guildId, meta = {}) {
  return replace(guildId, defaults(), meta);
}

module.exports = { get, set, replace, remove, recordJoin, normalize };
