'use strict';

const crypto = require('crypto');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../core/guild/moduleSectionManager');
const guildManager = require('../../core/guild/guildManager');

const MODULE = 'verification';
const SCHEMA_VERSION = 2;
const CONFIG_HISTORY_LIMIT = 5;
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
    alreadyVerified: 'You are already Verified.',
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
    schemaVersion: SCHEMA_VERSION,
    configRevision: 1,
    lastKnownGoodRevision: 1,
    configHistory: [],
    settings: defaultSettings(),
    messages: defaultMessages(),
    panelTemplate: defaultPanelTemplate(),
    activePanelId: null,
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
  const source = messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {};
  const base = defaultMessages();
  const output = { ...base, ...clone(source) };
  for (const [key, fallback] of Object.entries(base)) {
    output[key] = cleanString(source[key] ?? fallback, fallback, 1500);
  }
  return output;
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
  const removePendingRoles = source.removePendingRoles === true;
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
    allowStaffBypass: source.allowStaffBypass === true,
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
    ...clone(source),
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
    retiredAt: cleanDate(source.retiredAt),
    deletedAt: cleanDate(source.deletedAt),
  };
}

function normalizeAttempts(attempts = {}) {
  if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) return {};
  return Object.fromEntries(Object.entries(attempts).map(([userId, attempt]) => [userId, {
    ...(attempt && typeof attempt === 'object' ? clone(attempt) : {}),
    failed: cleanInteger(attempt?.failed, 0, 0, 100000),
    lastAttemptAt: cleanDate(attempt?.lastAttemptAt),
    lastFailureAt: cleanDate(attempt?.lastFailureAt),
  }]));
}

function normalizeConfigSnapshot(snapshot = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    revision: cleanInteger(source.revision, 1, 1),
    status: cleanString(source.status || 'previous', 'previous', 40),
    savedAt: cleanDate(source.savedAt) || now(),
    settings: normalizeSettings(source.settings),
    messages: normalizeMessages(source.messages),
    panelTemplate: normalizePanelTemplate(source.panelTemplate),
    activePanelId: cleanString(source.activePanelId || '', '', 80) || null,
    panels: source.panels && typeof source.panels === 'object' ? clone(source.panels) : {},
  };
}

function normalizeConfigHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry === 'object')
    .map(normalizeConfigSnapshot)
    .sort((a, b) => b.revision - a.revision)
    .slice(0, CONFIG_HISTORY_LIMIT);
}

function captureConfig(section, status = 'previous') {
  return normalizeConfigSnapshot({
    revision: section.configRevision || 1,
    status,
    savedAt: now(),
    settings: section.settings,
    messages: section.messages,
    panelTemplate: section.panelTemplate,
    activePanelId: section.activePanelId,
    panels: section.panels,
  });
}

function configFingerprint(section = {}) {
  return JSON.stringify({
    settings: normalizeSettings(section.settings),
    messages: normalizeMessages(section.messages),
    panelTemplate: normalizePanelTemplate(section.panelTemplate),
  });
}

function normalizeVerificationSection(section = {}) {
  const base = defaultVerificationSection();
  const source = section && typeof section === 'object' ? section : {};
  const panels = source.panels && typeof source.panels === 'object' ? source.panels : {};
  const normalizedPanels = Object.fromEntries(Object.entries(panels).map(([id, panel]) => {
    const normalizedPanel = normalizePanel({ ...panel, panelId: panel.panelId || id });
    return [normalizedPanel.panelId, normalizedPanel];
  }));

  const requestedActivePanelId = cleanString(source.activePanelId || '', '', 80) || null;
  const livePanels = Object.values(normalizedPanels)
    .filter((panel) => panel.enabled !== false && !panel.deletedAt && panel.channelId && panel.messageId)
    .sort((a, b) => new Date(b.lastDeployedAt || b.updatedAt || 0) - new Date(a.lastDeployedAt || a.updatedAt || 0));
  const activePanelId = requestedActivePanelId && livePanels.some((panel) => panel.panelId === requestedActivePanelId)
    ? requestedActivePanelId
    : livePanels[0]?.panelId || null;

  if (activePanelId) {
    for (const [panelId, panel] of Object.entries(normalizedPanels)) {
      if (panelId === activePanelId) {
        panel.enabled = true;
        panel.retiredAt = null;
      } else if (panel.channelId && panel.messageId && !panel.deletedAt) {
        panel.enabled = false;
      }
    }
  }

  const configRevision = cleanInteger(source.configRevision, 1, 1);
  const lastKnownGoodRevision = cleanInteger(source.lastKnownGoodRevision, configRevision, 1, configRevision);
  const normalized = {
    ...base,
    ...clone(source),
    schemaVersion: SCHEMA_VERSION,
    configRevision,
    lastKnownGoodRevision,
    configHistory: normalizeConfigHistory(source.configHistory),
    settings: normalizeSettings(source.settings),
    messages: normalizeMessages(source.messages),
    panelTemplate: normalizePanelTemplate(source.panelTemplate),
    activePanelId,
    panels: normalizedPanels,
    attempts: normalizeAttempts(source.attempts),
    analytics: normalizeAnalytics(source.analytics),
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
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
      const proposed = typeof updater === 'function' ? updater(clone(normalized)) : updater;
      const next = normalizeVerificationSection(proposed && typeof proposed === 'object' ? proposed : normalized);
      const configChanged = configFingerprint(normalized) !== configFingerprint(next);

      if (configChanged && meta.skipConfigRevision !== true) {
        const previous = captureConfig(normalized, 'last_known_good');
        const history = [previous, ...(normalized.configHistory || [])]
          .filter((entry, index, all) => all.findIndex((candidate) => candidate.revision === entry.revision) === index)
          .slice(0, CONFIG_HISTORY_LIMIT);
        next.configRevision = normalized.configRevision + 1;
        next.lastKnownGoodRevision = normalized.lastKnownGoodRevision || normalized.configRevision;
        next.configHistory = history;
      }

      return normalizeVerificationSection(next);
    },
    defaultVerificationSection(),
    meta
  ));
}

function updateConfiguration(guildId, updater, meta = {}) {
  return updateVerificationSection(guildId, updater, { action: 'verification_config_update', ...meta });
}

function markConfigKnownGood(guildId, meta = {}) {
  return updateVerificationSection(guildId, (section) => ({
    ...section,
    lastKnownGoodRevision: section.configRevision,
    configHistory: (section.configHistory || []).map((entry) => ({
      ...entry,
      status: entry.revision === section.configRevision ? 'last_known_good' : entry.status,
    })),
    updatedAt: now(),
  }), { action: 'verification_config_known_good', skipConfigRevision: true, ...meta });
}

function rollbackToLastKnownGood(guildId, meta = {}) {
  return updateVerificationSection(guildId, (section) => {
    const targetRevision = section.lastKnownGoodRevision;
    if (targetRevision === section.configRevision) return section;
    const target = (section.configHistory || []).find((entry) => entry.revision === targetRevision);
    if (!target) throw new Error(`No verification config backup exists for revision ${targetRevision}.`);

    const currentSnapshot = captureConfig(section, 'rolled_back');
    return {
      ...section,
      settings: normalizeSettings(target.settings),
      messages: normalizeMessages(target.messages),
      panelTemplate: normalizePanelTemplate(target.panelTemplate),
      activePanelId: target.activePanelId,
      panels: target.panels && typeof target.panels === 'object' ? clone(target.panels) : {},
      configRevision: section.configRevision + 1,
      lastKnownGoodRevision: section.configRevision + 1,
      configHistory: [currentSnapshot, ...(section.configHistory || [])].slice(0, CONFIG_HISTORY_LIMIT),
      updatedAt: now(),
    };
  }, { action: 'verification_config_rollback', skipConfigRevision: true, ...meta });
}

function updateSettings(guildId, settings, meta = {}) {
  return updateConfiguration(guildId, (section) => ({
    ...section,
    settings: normalizeSettings({ ...(section.settings || {}), ...(settings || {}) }),
  }), { action: 'verification_settings_update', ...meta }).settings;
}

function savePanel(guildId, panel, meta = {}) {
  const normalized = normalizePanel(panel);
  const timestamp = now();
  return updateVerificationSection(guildId, (section) => {
    const current = section.panels?.[normalized.panelId] || null;
    const merged = {
      ...(current || {}),
      ...normalized,
      updatedAt: timestamp,
    };
    const isLive = Boolean(merged.channelId && merged.messageId && !merged.deletedAt);
    const nextPanels = { ...(section.panels || {}) };

    if (isLive) {
      for (const [panelId, existingPanel] of Object.entries(nextPanels)) {
        if (panelId === normalized.panelId || existingPanel.deletedAt) continue;
        if (existingPanel.enabled !== false) {
          nextPanels[panelId] = {
            ...existingPanel,
            enabled: false,
            retiredAt: existingPanel.retiredAt || timestamp,
          };
        }
      }
      merged.enabled = true;
      merged.retiredAt = null;
    } else if (!current) {
      merged.enabled = false;
    }

    nextPanels[normalized.panelId] = merged;
    return {
      ...section,
      activePanelId: isLive ? normalized.panelId : section.activePanelId,
      panels: nextPanels,
      updatedAt: timestamp,
    };
  }, { skipConfigRevision: true, ...meta }).panels[normalized.panelId];
}

function getPanel(guildId, panelId) {
  return getVerificationSection(guildId).panels?.[String(panelId || '')] || null;
}

function deletePanel(guildId, panelId, meta = {}) {
  const safePanelId = String(panelId || '');
  const currentSection = getVerificationSection(guildId);

  if (guildManager.isModuleEnabled(guildId, MODULE) && currentSection.activePanelId === safePanelId) {
    throw new Error(
      'This panel is currently the active verification panel. Deploy another panel first or disable Verification before deleting this one.'
    );
  }

  return updateVerificationSection(guildId, (section) => {
    const panels = { ...(section.panels || {}) };
    delete panels[safePanelId];
    return {
      ...section,
      activePanelId: section.activePanelId === safePanelId ? null : section.activePanelId,
      panels,
      updatedAt: now(),
    };
  }, { skipConfigRevision: true, ...meta });
}

function getLatestPanel(guildId) {
  const section = getVerificationSection(guildId);
  const active = section.activePanelId ? section.panels?.[section.activePanelId] : null;
  if (active && active.enabled !== false && !active.deletedAt && active.channelId && active.messageId) return active;
  return Object.values(section.panels || {})
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
}

function updatePanelTemplate(guildId, template, meta = {}) {
  return updateConfiguration(guildId, (section) => ({
    ...section,
    panelTemplate: normalizePanelTemplate({ ...(section.panelTemplate || {}), ...(template || {}) }),
  }), { action: 'verification_panel_template_update', ...meta }).panelTemplate;
}

function updateMessages(guildId, messages, meta = {}) {
  return updateConfiguration(guildId, (section) => ({
    ...section,
    messages: normalizeMessages({ ...(section.messages || {}), ...(messages || {}) }),
  }), { action: 'verification_messages_update', ...meta }).messages;
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
          ...current,
          failed: cleanCount(current.failed + (failed ? 1 : 0)),
          lastAttemptAt: timestamp,
          lastFailureAt: failed ? timestamp : current.lastFailureAt,
        },
      },
      updatedAt: timestamp,
    };
  }, { skipConfigRevision: true, ...meta }).attempts[userId];
}

function clearAttempts(guildId, userId, meta = {}) {
  return updateVerificationSection(guildId, (section) => {
    const attempts = { ...(section.attempts || {}) };
    delete attempts[userId];
    return { ...section, attempts, updatedAt: now() };
  }, { skipConfigRevision: true, ...meta });
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
    return {
      ...section,
      analytics: next,
      lastKnownGoodRevision: Number(increments.verified || 0) > 0 ? section.configRevision : section.lastKnownGoodRevision,
      updatedAt: timestamp,
    };
  }, { skipConfigRevision: true, ...meta }).analytics;
}

module.exports = {
  MODULE,
  SCHEMA_VERSION,
  CONFIG_HISTORY_LIMIT,
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
  updateConfiguration,
  updateSettings,
  markConfigKnownGood,
  rollbackToLastKnownGood,
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
