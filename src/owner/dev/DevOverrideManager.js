'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { normalizeBotMode } = require('../../config/botModes');
const { getRuntimePaths } = require('../../config/runtimePaths');

const DEV_MODE = 'DEV';
const FILE_NAME = 'testDevOverride.json';
const PAYWALL_BYPASS_DEFAULT_ENABLED = true;
const PAYWALL_BYPASS_PLAN = 'lifetime';
const DEVELOPMENT_TEST_GUILD_ID = process.env.TEST_GUILD_ID || '1515201360386068642';
const OWNER_PROTECTED_ACTIONS = new Set([
  'timeout',
  'kick',
  'ban',
  'quarantine',
  'role-set',
  'role-remove',
  'remove-roles',
]);

function text(value) {
  return String(value || '').trim();
}

function isBotOwner(userId) {
  const security = require('../../core/security/securityCore');
  return typeof security.isBotOwner === 'function' && security.isBotOwner(userId);
}

function isDevMode() {
  return normalizeBotMode(process.env.BOT_MODE) === DEV_MODE;
}

function guildId(guildOrId) {
  if (!guildOrId) return '';
  if (typeof guildOrId === 'string') return text(guildOrId);
  return text(guildOrId.id || guildOrId.guildId);
}

function subjectId(memberOrUser) {
  if (!memberOrUser) return '';
  return text(memberOrUser.id || memberOrUser.user?.id);
}

function getFilePath() {
  const runtimePaths = getRuntimePaths('dev');
  return path.join(runtimePaths.data, FILE_NAME);
}

function ensureFolder() {
  fs.mkdirSync(path.dirname(getFilePath()), { recursive: true });
}

function defaultState() {
  return {
    enabled: false,
    updatedAt: null,
    updatedBy: null,
    paywallBypass: {
      enabled: PAYWALL_BYPASS_DEFAULT_ENABLED,
      plan: PAYWALL_BYPASS_PLAN,
      updatedAt: null,
      updatedBy: 'system',
      note: 'DEV only. Set enabled false to test real plans, vouchers and locked paywall behaviour.',
    },
  };
}

function normaliseState(state = {}) {
  const defaults = defaultState();
  const paywallBypass = {
    ...defaults.paywallBypass,
    ...(state.paywallBypass || {}),
  };

  return {
    ...defaults,
    ...state,
    enabled: state.enabled === true,
    paywallBypass: {
      ...paywallBypass,
      enabled: paywallBypass.enabled === true,
      plan: String(paywallBypass.plan || PAYWALL_BYPASS_PLAN).trim().toLowerCase(),
    },
  };
}

function readState() {
  if (!isDevMode()) return defaultState();

  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normaliseState(parsed);
  } catch (error) {
    console.warn('[TestDevOverride] Failed to read state:', error.message);
    return defaultState();
  }
}

function writeState(nextState = {}) {
  if (!isDevMode()) return defaultState();

  ensureFolder();
  const state = normaliseState({
    ...readState(),
    ...nextState,
    updatedAt: new Date().toISOString(),
  });

  fs.writeFileSync(getFilePath(), JSON.stringify(state, null, 2));
  return state;
}

function isEnabled() {
  return isDevMode() && readState().enabled === true;
}

function toggle(userId) {
  if (!isDevMode()) {
    return {
      ...defaultState(),
      blocked: true,
      reason: 'Test dev override is only available in DEV mode.',
    };
  }

  if (!isBotOwner(userId)) {
    return {
      ...readState(),
      blocked: true,
      reason: 'Owner only.',
    };
  }

  const current = readState();
  return writeState({
    enabled: current.enabled !== true,
    updatedBy: String(userId),
  });
}

function shouldBypassGuard() {
  return isEnabled();
}

function shouldBypassPaywall() {
  const state = readState();
  return isDevMode() && state.paywallBypass?.enabled === true;
}

function getPaywallBypassPlan() {
  return shouldBypassPaywall() ? readState().paywallBypass.plan || PAYWALL_BYPASS_PLAN : null;
}

function getPaywallBypassState() {
  const state = readState();
  return {
    active: shouldBypassPaywall(),
    ...state.paywallBypass,
  };
}

function devRuntimeActive() {
  return isDevMode();
}

function inDevelopmentTestGuild(guildOrId) {
  return guildId(guildOrId) === DEVELOPMENT_TEST_GUILD_ID;
}

function isOwnerSubject({ guild = null, member = null, user = null, userId = '' } = {}) {
  const id = text(userId || subjectId(member) || subjectId(user));
  if (!id) return false;
  if (text(guild?.ownerId) === id) return true;
  return isBotOwner(id);
}

function isDevOwnerHierarchyOverride({ guild = null, guildId: targetGuildId = '', member = null, user = null, userId = '' } = {}) {
  return (
    isEnabled() &&
    inDevelopmentTestGuild(guild || targetGuildId) &&
    isOwnerSubject({ guild, member, user, userId })
  );
}

function isProtectedOwnerAction(action = '') {
  return OWNER_PROTECTED_ACTIONS.has(text(action).toLowerCase());
}

function shouldBlockOwnerDestructiveAction({ guild = null, guildId: targetGuildId = '', member = null, user = null, userId = '', action = '' } = {}) {
  return (
    isDevOwnerHierarchyOverride({ guild, guildId: targetGuildId, member, user, userId }) &&
    isProtectedOwnerAction(action)
  );
}

function buildBypassMetadata(extra = {}) {
  return {
    ...extra,
    testDevOverride: true,
    warning: 'Goliath DEV safety guard bypassed. Discord API permissions are still enforced by Discord.',
  };
}

function buildPaywallBypassMetadata(extra = {}) {
  return {
    ...extra,
    testDevPaywallBypass: true,
    plan: getPaywallBypassPlan(),
    warning: 'Goliath DEV paywall bypass active. Disable paywallBypass.enabled in testDevOverride.json to test plans, vouchers and locked billing behaviour.',
  };
}

module.exports = {
  DEVELOPMENT_TEST_GUILD_ID,
  OWNER_PROTECTED_ACTIONS,
  isDevMode,
  readState,
  isEnabled,
  toggle,
  shouldBypassGuard,
  shouldBypassPaywall,
  getPaywallBypassPlan,
  getPaywallBypassState,
  devRuntimeActive,
  inDevelopmentTestGuild,
  isOwnerSubject,
  isDevOwnerHierarchyOverride,
  isProtectedOwnerAction,
  shouldBlockOwnerDestructiveAction,
  buildBypassMetadata,
  buildPaywallBypassMetadata,
};