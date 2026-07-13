'use strict';

// src/modules/verification/verificationStore.js

const crypto = require('crypto');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');

const MODULE = 'verification';
const PENDING_ROLE_TIMINGS = new Set(['on_join', 'after_screening', 'manual']);
const VERIFICATION_METHODS = new Set(['button', 'rules_acceptance', 'math_challenge', 'manual_approval']);

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanDiscordIds(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(cleanDiscordId).filter(Boolean))];
}

function cleanString(value, fallback = '', maxLength = 1000) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function cleanHexColor(value, fallback = '#57f287') {
  const clean = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
}

function cleanButtonStyle(value, fallback = 'success') {
  const clean = String(value || '').trim().toLowerCase();
  return ['primary', 'secondary', 'success', 'danger'].includes(clean) ? clean : fallback;
}

function cleanUrl(value) {
  const clean = String(value || '').trim().slice(0, 500);
  if (!clean) return null;
  return /^https?:\/\//i.test(clean) ? clean : null;
}

function cleanDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanCount(value) {
  return Math.max(0, Number(value || 0));
}

function cleanInteger(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createId(prefix = 'verify') {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function defaultAnalytics() {
  return {
    verified: 0,
    failed: 0,
    alreadyVerified: 0,
    screeningBlocked: 0,
    requirementBlocked: 0,
    accountAgeBlocked: 0,
    membershipAgeBlocked: 0,
    botBlocked: 0,
    cooldownBlocked: 0,
    pendingRolesAssigned: 0,
    unavailable: 0,
    roleManageFailed: 0,
    lastVerificationAt: null,
    lastFailedAt: null,
    lastScreeningCompletedAt: null,
    lastPendingRoleAssignedAt: null,
  };
}

function defaultMessages() {
  return {
    success: 'Verification complete. Welcome to {server}.',
    alreadyVerified: 'You are already verified.',
    unavailable: 'Verification is currently unavailable. Please contact a management member.',
    screeningRequired: 'Please complete Discord Membership Screening before continuing.',
    pendingRoleRequired: 'You do not currently have the required pending role.',
    accountTooNew: 'Your Discord account must be at least {minimumAccountAgeDays} day(s) old.',
    membershipTooNew: 'You must remain in the server for at least {minimumMembershipAgeMinutes} minute(s) before verifying.',
    botBlocked: 'Bot accounts cannot use this verification flow.',
    cooldown: 'Please wait {cooldownSeconds} second(s) before trying again.',
    failed: 'Verification failed. Please contact a management member if this continues.',
    dmSuccess: 'You are now verified in {server}.',
    pendingAssigned: 'Your pending verification role has been assigned in {server}.',
    screeningCompletedLog: '📜 {user} completed Discord Membership Screening.',
    successLog: '✅ {user} completed verification.',
    failureLog: '❌ {user} failed verification: {reason}',
  };
}

function defaultPanelTemplate() {
  return {
    title: 'Server Verification',
    description: 'Press the button below to verify and unlock the server.',
    color: '#57f287',
    footer: 'Goliath Verification',
    thumbnailUrl: null,
    imageUrl: null,
    buttonLabel: 'Verify',
    buttonEmoji: null,
    buttonStyle: 'success',
  };
}

function defaultSettings() {
  return {
    method: 'button',
    verificationChannelId: null,
    logChannelId: null,

    waitForDiscordScreening: false,
    skipScreeningIfUnavailable: true,
    logScreeningCompletion: true,

    usePendingRoles: false,
    assignPendingRoles: false,
    pendingRoleTiming: 'after_screening',
    requirePendingRole: false,
    removePendingRoles: true,
    removePendingRole: true,

    verifiedRoleIds: [],
    pendingRoleIds: [],
    verifiedRoleId: null,
    unverifiedRoleId: null,

    dmOnVerify: true,
    dmOnPendingRole: false,
    logSuccess: true,
    logFailure: true,

    blockBots: true,
    allowStaffBypass: false,
    allowReverification: false,

    minimumAccountAgeDays: 0,
    minimumMembershipAgeMinutes: 0,
    attemptCooldownSeconds: 10,
    maximumFailedAttempts: 0,
  };
}

function defaultVerificationSection() {
  return {
    enabled: false,
    settings: defaultSettings(),
    messages: defaultMessages(),
    panelTemplate: defaultPanelTemplate(),
    panels: {},
    attempts: {},
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAnalytics(analytics = {}) {
  const source = analytics && typeof analytics === 'object' ? analytics : {};
  const base = defaultAnalytics();
  const output = { ...base, ...clone(source) };

  for (const key of Object.keys(base)) {
    if (key.startsWith('last')) output[key] = cleanDate(source[key]);
    else output[key] = cleanCount(source[key]);
  }

  return output;
}

function normalizeMessages(messages = {}) {
  const source = messages && typeof messages === 'object' ? messages : {};
  const base = defaultMessages();
  return Object.fromEntries(
    Object.entries(base).map(([key, fallback]) => [key, cleanString(source[key] || fallback, fallback, 1500)])
  );
}

function normalizePanelTemplate(template = {}) {
  const source = template && typeof template === 'object' ? template : {};
  const base = defaultPanelTemplate();
  return {
    ...base,
    ...clone(source),
    title: cleanString(source.title || base.title, base.title, 100),
    description: cleanString(source.description || base.description, base.description, 1000),
    color: cleanHexColor(source.color, base.color),
    footer: cleanString(source.footer || base.footer, base.footer, 200),
    thumbnailUrl: cleanUrl(source.thumbnailUrl),
    imageUrl: cleanUrl(source.imageUrl),
    buttonLabel: cleanString(source.buttonLabel || base.buttonLabel, base.buttonLabel, 80),
    buttonEmoji: cleanString(source.buttonEmoji || '', '', 80) || null,
    buttonStyle: cleanButtonStyle(source.buttonStyle, base.buttonStyle),
  };
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const base = defaultSettings();
  const legacyVerified = source.verifiedRoleId ? [source.verifiedRoleId] : [];
  const legacyPending = source.unverifiedRoleId ? [source.unverifiedRoleId] : [];
  const method = String(source.method || base.method).toLowerCase();
  const timing = String(source.pendingRoleTiming || base.pendingRoleTiming).toLowerCase();
  const requirePendingRole = source.requirePendingRole === true;
  const verifiedRoleIds = cleanDiscordIds(source.verifiedRoleIds?.length ? source.verifiedRoleIds : legacyVerified);
  const pendingRoleIds = cleanDiscordIds(source.pendingRoleIds?.length ? source.pendingRoleIds : legacyPending);
  const removePendingRoles = source.removePendingRoles !== false && source.removePendingRole !== false;

  return {
    ...base,
    ...clone(source),
    method: VERIFICATION_METHODS.has(method) ? method : base.method,
    verificationChannelId: cleanDiscordId(source.verificationChannelId),
    logChannelId: cleanDiscordId(source.logChannelId),

    waitForDiscordScreening: source.waitForDiscordScreening === true,
    skipScreeningIfUnavailable: source.skipScreeningIfUnavailable !== false,
    logScreeningCompletion: source.logScreeningCompletion !== false,

    usePendingRoles: source.usePendingRoles === true,
    assignPendingRoles: source.assignPendingRoles === true,
    pendingRoleTiming: PENDING_ROLE_TIMINGS.has(timing) ? timing : base.pendingRoleTiming,
    requirePendingRole,
    removePendingRoles,
    removePendingRole: removePendingRoles,

    verifiedRoleIds,
    pendingRoleIds,
    verifiedRoleId: verifiedRoleIds[0] || null,
    unverifiedRoleId: pendingRoleIds[0] || null,

    dmOnVerify: source.dmOnVerify !== false,
    dmOnPendingRole: source.dmOnPendingRole === true,
    logSuccess: source.logSuccess !== false,
    logFailure: source.logFailure !== false,

    blockBots: source.blockBots !== false,
    allowStaffBypass: !requirePendingRole && source.allowStaffBypass === true,
    allowReverification: source.allowReverification === true,

    minimumAccountAgeDays: cleanInteger(source.minimumAccountAgeDays, 0, 0, 3650),
    minimumMembershipAgeMinutes: cleanInteger(source.minimumMembershipAgeMinutes, 0, 0, 525600),
    attemptCooldownSeconds: cleanInteger(source.attemptCooldownSeconds, 10, 0, 86400),
    maximumFailedAttempts: cleanInteger(source.maximumFailedAttempts, 0, 0, 1000),
  };
}

function normalizePanel(panel = {}) {
  const source = panel && typeof panel === 'object' ? panel : {};
  const panelId = cleanString(source.panelId || source.id || createId('verify_panel'), 'verify_panel', 80);
  return {
    panelId,
    id: panelId,
    enabled: source.enabled !== false,
    ...normalizePanelTemplate(source),
    channelId: cleanDiscordId(source.channelId),
    messageId: cleanDiscordId(source.messageId),
    createdBy: cleanDiscordId(source.createdBy),
    createdAt: source.createdAt || now(),
    updatedAt: source.updatedAt || source.createdAt || now(),
    lastDeployedAt: cleanDate(source.lastDeployedAt),
    deletedAt: cleanDate(source.deletedAt),
  };
}

function normalizeAttempts(attempts = {}) {
  if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) return {};
  return Object.fromEntries(Object.entries(attempts).map(([userId, attempt]) => [userId, {
    failed: cleanInteger(attempt?.failed, 0, 0, 100000),
    lastAttemptAt: cleanDate(attempt?.lastAttemptAt),
    lastFailureAt: cleanDate(attempt?.lastFailureAt),
  }]));
}

function normalizeVerificationSection(section = {}) {
  const base = defaultVerificationSection();
  const source = section && typeof section === 'object' ? section : {};
  const panels = source.panels && typeof source.panels === 'object' ? source.panels : {};
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true,
    settings: normalizeSettings(source.settings),
    messages: normalizeMessages(source.messages),
    panelTemplate: normalizePanelTemplate(source.panelTemplate),
    panels: Object.fromEntries(Object.entries(panels).map(([id, panel]) => {
      const normalized = normalizePanel({ ...panel, panelId: panel.panelId || id });
      return [normalized.panelId, normalized];
    })),
    attempts: normalizeAttempts(source.attempts),
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getVerificationSection(guildId) {
  return normalizeVerificationSection(getModuleSection(guildId, MODULE, defaultVerificationSection()));
}

function saveVerificationSection(guildId, section, meta = {}) {
  return normalizeVerificationSection(saveModuleSection(guildId, MODULE, normalizeVerificationSection(section), meta));
}

function updateVerificationSection(guildId, updater, meta = {}) {
  return normalizeVerificationSection(updateModuleSection(
    guildId,
    MODULE,
    (current) => {
      const normalized = normalizeVerificationSection(current);
      const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      return normalizeVerificationSection(next);
    },
    defaultVerificationSection(),
    meta
  ));
}

function savePanel(guildId, panel, meta = {}) {
  const normalized = normalizePanel(panel);
  return updateVerificationSection(guildId, (section) => ({
    ...section,
    panels: {
      ...section.panels,
      [normalized.panelId]: {
        ...(section.panels?.[normalized.panelId] || {}),
        ...normalized,
        updatedAt: now(),
      },
    },
    updatedAt: now(),
  }), meta).panels[normalized.panelId];
}

function getPanel(guildId, panelId) {
  return getVerificationSection(guildId).panels?.[String(panelId || '')] || null;
}

function deletePanel(guildId, panelId, meta = {}) {
  return updateVerificationSection(guildId, (section) => {
    const panels = { ...(section.panels || {}) };
    delete panels[String(panelId || '')];
    return { ...section, panels, updatedAt: now() };
  }, meta);
}

function getLatestPanel(guildId) {
  return Object.values(getVerificationSection(guildId).panels || {})
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
}

function updatePanelTemplate(guildId, template, meta = {}) {
  return updateVerificationSection(guildId, (section) => ({
    ...section,
    panelTemplate: normalizePanelTemplate({ ...(section.panelTemplate || {}), ...(template || {}) }),
    updatedAt: now(),
  }), meta).panelTemplate;
}

function updateMessages(guildId, messages, meta = {}) {
  return updateVerificationSection(guildId, (section) => ({
    ...section,
    messages: normalizeMessages({ ...(section.messages || {}), ...(messages || {}) }),
    updatedAt: now(),
  }), meta).messages;
}

function recordAttempt(guildId, userId, { failed = false } = {}, meta = {}) {
  const timestamp = now();
  return updateVerificationSection(guildId, (section) => {
    const current = section.attempts?.[userId] || { failed: 0, lastAttemptAt: null, lastFailureAt: null };
    return {
      ...section,
      attempts: {
        ...(section.attempts || {}),
        [userId]: {
          failed: cleanCount(current.failed + (failed ? 1 : 0)),
          lastAttemptAt: timestamp,
          lastFailureAt: failed ? timestamp : current.lastFailureAt,
        },
      },
      updatedAt: timestamp,
    };
  }, meta).attempts[userId];
}

function clearAttempts(guildId, userId, meta = {}) {
  return updateVerificationSection(guildId, (section) => {
    const attempts = { ...(section.attempts || {}) };
    delete attempts[userId];
    return { ...section, attempts, updatedAt: now() };
  }, meta);
}

function incrementAnalytics(guildId, increments = {}, meta = {}) {
  const timestamp = now();
  return updateVerificationSection(guildId, (section) => {
    const analytics = normalizeAnalytics(section.analytics);
    const next = { ...analytics };
    for (const [key, amount] of Object.entries(increments)) {
      if (!(key in analytics) || key.startsWith('last')) continue;
      next[key] = cleanCount(Number(analytics[key] || 0) + Number(amount || 0));
    }
    if (Number(increments.verified || 0) > 0) next.lastVerificationAt = timestamp;
    if (Number(increments.failed || 0) > 0) next.lastFailedAt = timestamp;
    if (Number(increments.screeningCompleted || 0) > 0) next.lastScreeningCompletedAt = timestamp;
    if (Number(increments.pendingRolesAssigned || 0) > 0) next.lastPendingRoleAssignedAt = timestamp;
    return { ...section, analytics: next, updatedAt: timestamp };
  }, meta).analytics;
}

module.exports = {
  MODULE,
  PENDING_ROLE_TIMINGS,
  VERIFICATION_METHODS,
  createId,
  defaultAnalytics,
  defaultMessages,
  defaultPanelTemplate,
  defaultSettings,
  defaultVerificationSection,
  normalizeAnalytics,
  normalizeMessages,
  normalizePanelTemplate,
  normalizeSettings,
  normalizeVerificationSection,
  getVerificationSection,
  saveVerificationSection,
  updateVerificationSection,
  savePanel,
  getPanel,
  getLatestPanel,
  deletePanel,
  updatePanelTemplate,
  updateMessages,
  recordAttempt,
  clearAttempts,
  incrementAnalytics,
};
