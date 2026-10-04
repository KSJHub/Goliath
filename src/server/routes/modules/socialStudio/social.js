'use strict';

const crypto = require('crypto');
const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const { replaceVariables } = require('../../../../core/guild/guildVariables');
const { ALERT_TYPES, normalizeTemplates, resolveTemplate } = require('../../../../modules/socialStudio/socialAlerts/socialStudioTemplates');
const { PLATFORMS, providerCatalog, diagnoseAccount, diagnoseAccounts, applyDiagnosticState } = require('../../../../modules/socialStudio/socialAlerts/socialStudioProviders');

const router = express.Router();
const CREATOR_STATUSES = ['active', 'left_server', 'disabled', 'archived'];
const runtime = { startedAt: new Date().toISOString(), checks: 0, deliveries: 0, errors: 0 };

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max = 2000) => String(value || '').trim().slice(0, max);
const asNumber = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const discordId = (value) => /^\d{15,25}$/.test(clean(value, 25)) ? clean(value, 25) : null;
const success = (res, payload = {}) => res.json({ success: true, ...payload });
function failure(res, error, status = 500) {
  console.error('[Social Studio API]', error);
  return res.status(status).json({ success: false, error: error?.message || 'Social Studio request failed.' });
}
function guildId(req) {
  const id = clean(req.params.guildId, 25);
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
const ACCOUNT_INPUT_KEYS = new Set([
  'accountId', 'platform', 'displayName', 'username', 'normalizedUsername', 'externalId',
  'sourceInput', 'url', 'profileUrl', 'avatar', 'alertChannelId', 'alertChannels',
  'mentionRoleId', 'mentionMode', 'alertTypes', 'enabled',
]);
const CREATOR_INPUT_KEYS = new Set([
  'creatorId', 'ownerDiscordId', 'status', 'displayName', 'group', 'tags', 'notes',
  'adminNotes', 'enabled', 'accountIds',
]);
const CONFIG_INPUT_KEYS = new Set([
  'alertsChannelId', 'logChannelId', 'alertChannels', 'platformChannels',
  'managerRoleIds', 'userRoleIds', 'notificationMentionMode', 'notificationRoleId',
  'liveRoleId', 'settings', 'templates',
]);
const pickKeys = (value, allowed) => Object.fromEntries(
  Object.entries(isObject(value) ? value : {}).filter(([key]) => allowed.has(key)),
);
const roleIds = (value, excludedId = null) => [...new Set((Array.isArray(value) ? value : []).map(discordId).filter((id) => id && id !== excludedId))];
const alertChannels = (value) => Object.fromEntries(
  Object.entries(isObject(value) ? value : {})
    .map(([type, id]) => [clean(type, 20).toLowerCase(), discordId(id)])
    .filter(([type, id]) => ALERT_TYPES.includes(type) && id),
);
const platformChannels = (value) => Object.fromEntries(
  Object.entries(isObject(value) ? value : {})
    .map(([platform, id]) => [clean(platform, 20).toLowerCase(), discordId(id)])
    .filter(([platform, id]) => PLATFORMS.includes(platform) && id),
);
function sanitizeAccountInput(value = {}) {
  const input = pickKeys(value, ACCOUNT_INPUT_KEYS);
  input.accountId = clean(input.accountId, 80) || undefined;
  input.platform = clean(input.platform, 20).toLowerCase();
  input.displayName = clean(input.displayName, 120);
  input.username = clean(input.username, 500);
  input.normalizedUsername = clean(input.normalizedUsername, 500);
  input.externalId = clean(input.externalId, 200);
  input.sourceInput = clean(input.sourceInput, 1000);
  input.url = clean(input.url, 1000);
  input.profileUrl = clean(input.profileUrl, 1000);
  input.avatar = clean(input.avatar, 1000);
  if (Object.prototype.hasOwnProperty.call(input, 'alertChannelId')) input.alertChannelId = discordId(input.alertChannelId);
  if (Object.prototype.hasOwnProperty.call(input, 'alertChannels')) input.alertChannels = alertChannels(input.alertChannels);
  if (Object.prototype.hasOwnProperty.call(input, 'mentionRoleId')) input.mentionRoleId = discordId(input.mentionRoleId);
  if (Object.prototype.hasOwnProperty.call(input, 'mentionMode')) input.mentionMode = ['none', 'role', 'everyone', 'here'].includes(input.mentionMode) ? input.mentionMode : 'none';
  if (Object.prototype.hasOwnProperty.call(input, 'alertTypes')) input.alertTypes = [...new Set((Array.isArray(input.alertTypes) ? input.alertTypes : []).map((item) => clean(item, 20).toLowerCase()).filter((item) => ALERT_TYPES.includes(item)))];
  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) input.enabled = input.enabled === true;
  return input;
}
function sanitizeCreatorInput(value = {}) {
  const input = pickKeys(value, CREATOR_INPUT_KEYS);
  input.creatorId = clean(input.creatorId, 80) || undefined;
  if (Object.prototype.hasOwnProperty.call(input, 'ownerDiscordId')) input.ownerDiscordId = discordId(input.ownerDiscordId);
  input.status = clean(input.status, 40).toLowerCase();
  if (!CREATOR_STATUSES.includes(input.status)) input.status = 'active';
  input.displayName = clean(input.displayName, 120);
  input.group = clean(input.group, 120);
  input.tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((item) => clean(item, 60)).filter(Boolean))];
  input.notes = clean(input.notes, 2000);
  input.adminNotes = clean(input.adminNotes, 2000);
  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) input.enabled = input.enabled === true;
  input.accountIds = [...new Set((Array.isArray(input.accountIds) ? input.accountIds : []).map((item) => clean(item, 80)).filter(Boolean))];
  return input;
}
function sanitizeConfigInput(value = {}, guildIdValue = null) {
  const input = pickKeys(value, CONFIG_INPUT_KEYS);
  if (Object.prototype.hasOwnProperty.call(input, 'alertsChannelId')) input.alertsChannelId = discordId(input.alertsChannelId);
  if (Object.prototype.hasOwnProperty.call(input, 'logChannelId')) input.logChannelId = discordId(input.logChannelId);
  if (Object.prototype.hasOwnProperty.call(input, 'alertChannels')) input.alertChannels = alertChannels(input.alertChannels);
  if (Object.prototype.hasOwnProperty.call(input, 'platformChannels')) input.platformChannels = platformChannels(input.platformChannels);
  if (Object.prototype.hasOwnProperty.call(input, 'managerRoleIds')) input.managerRoleIds = roleIds(input.managerRoleIds, guildIdValue);
  if (Object.prototype.hasOwnProperty.call(input, 'userRoleIds')) input.userRoleIds = roleIds(input.userRoleIds, guildIdValue);
  if (Object.prototype.hasOwnProperty.call(input, 'notificationRoleId')) input.notificationRoleId = discordId(input.notificationRoleId);
  if (Object.prototype.hasOwnProperty.call(input, 'liveRoleId')) input.liveRoleId = discordId(input.liveRoleId);
  if (Object.prototype.hasOwnProperty.call(input, 'notificationMentionMode')) input.notificationMentionMode = ['none', 'role', 'everyone', 'here'].includes(input.notificationMentionMode) ? input.notificationMentionMode : 'none';
  if (Object.prototype.hasOwnProperty.call(input, 'settings') && isObject(input.settings)) {
    const allowedSettings = new Set(['checkIntervalMs','retryIntervalMs','retryDeliveries','maxDeliveryAttempts','cooldownMs','suppressDuplicates','editLiveNotifications','deleteEndedNotifications','includeViewerCount','includeLiveDuration','thumbnailPreference','platformPriority','quietHours','liveRefreshEnabled','liveRefreshSeconds']);
    input.settings = pickKeys(input.settings, allowedSettings);
    if (isObject(input.settings.quietHours)) input.settings.quietHours = pickKeys(input.settings.quietHours, new Set(['enabled','start','end','timezone']));
    if (Array.isArray(input.settings.platformPriority)) input.settings.platformPriority = input.settings.platformPriority.map((item) => clean(item, 20).toLowerCase()).filter((item) => PLATFORMS.includes(item));
  }
  if (Object.prototype.hasOwnProperty.call(input, 'templates')) input.templates = normalizeTemplates(input.templates);
  return input;
}
function actor(req) { return { actorId: req.moduleActorId || req.session?.user?.id || null }; }
function client(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null; }
async function requireManageAccess(req, res, next) {
  try {
    const userId = clean(req.session?.user?.id, 25);
    if (!/^\d{15,25}$/.test(userId)) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const id = guildId(req);
    req.moduleActorId = userId;
    if (security.isBotOwner(userId)) return next();

    const discordGuild = await guild(req, id);
    if (!discordGuild) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });

    const member = discordGuild.members.cache.get(userId) || await discordGuild.members.fetch(userId).catch(() => null);
    const storedConfig = guildManager.getGuildSection(id, 'social', {});
    const managerRoleIds = Array.isArray(storedConfig?.managerRoleIds)
      ? storedConfig.managerRoleIds.map(discordId).filter(Boolean)
      : [];

    const allowed = Boolean(
      discordGuild.ownerId === userId
      || member?.permissions?.has(PermissionFlagsBits.Administrator)
      || managerRoleIds.some((roleId) => member?.roles?.cache?.has?.(roleId)),
    );

    if (!allowed) return res.status(403).json({ success: false, error: 'Social Studio management permission is required.' });
    return next();
  } catch (error) {
    return failure(res, error, 403);
  }
}

async function guild(req, id) {
  const bot = client(req);
  if (!bot?.guilds) return null;
  return bot.guilds.cache.get(id) || bot.guilds.fetch(id).catch(() => null);
}
function defaults() {
  return {
    alertsChannelId: null,
    logChannelId: null,
    managerRoleIds: [],
    userRoleIds: [],
    accounts: {},
    creators: {},
    templates: normalizeTemplates(),
    settings: {
      checkIntervalMs: 300000,
      retryIntervalMs: 60000,
      retryDeliveries: true,
      maxDeliveryAttempts: 5,
      cooldownMs: 300000,
      suppressDuplicates: true,
      editLiveNotifications: true,
      deleteEndedNotifications: true,
      includeViewerCount: true,
      includeLiveDuration: true,
      thumbnailPreference: 'stream',
      platformPriority: [...PLATFORMS],
      quietHours: { enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London' },
    },
    history: [],
    queue: [],
    analytics: { alertsSent: 0, checks: 0, failures: 0, simulations: 0 },
    updatedAt: null,
  };
}
function accountIdentityKey(value = {}) {
  const platform = clean(value.platform, 20).toLowerCase();
  const identity = clean(
    value.canonicalIdentity || value.externalId || value.normalizedUsername || value.username || value.url,
    500,
  ).toLowerCase();
  return platform && identity ? platform + ':' + identity : null;
}
function assertAccountIdentityAvailable(config, account, ignoreAccountId = null) {
  const key = accountIdentityKey(account);
  if (!key) return;
  const duplicate = Object.values(config.accounts || {}).find((item) => item.accountId !== ignoreAccountId && accountIdentityKey(item) === key);
  if (duplicate) throw new Error('That social account is already linked in this server.');
}
function normalizeAccount(value = {}, existingId = null) {
  const platform = clean(value.platform, 20).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error('Unsupported social platform.');
  const username = clean(value.username || value.externalId || value.url, 500);
  if (!username) throw new Error('Username, channel ID or URL is required.');
  const accountId = existingId || clean(value.accountId, 80) || makeId('account');
  return {
    accountId,
    platform,
    displayName: clean(value.displayName || username, 120),
    username,
    normalizedUsername: clean(value.normalizedUsername, 500),
    externalId: clean(value.externalId, 200),
    sourceInput: clean(value.sourceInput, 1000),
    url: clean(value.url || (/^https?:\/\//i.test(username) ? username : ''), 1000),
    profileUrl: clean(value.profileUrl, 1000),
    avatar: clean(value.avatar, 1000),
    alertChannelId: discordId(value.alertChannelId),
    alertChannels: isObject(value.alertChannels) ? { ...value.alertChannels } : {},
    mentionRoleId: discordId(value.mentionRoleId),
    mentionMode: ['none', 'role', 'everyone', 'here'].includes(value.mentionMode) ? value.mentionMode : 'none',
    alertTypes: [...new Set((Array.isArray(value.alertTypes) ? value.alertTypes : ['live']).map((item) => clean(item, 20).toLowerCase()).filter((item) => ALERT_TYPES.includes(item)))],
    enabled: value.enabled !== false,
    metadata: isObject(value.metadata) ? value.metadata : {},
    state: isObject(value.state) ? value.state : {},
    diagnostics: isObject(value.diagnostics) ? value.diagnostics : {},
    createdAt: value.createdAt || now(),
    updatedAt: now(),
  };
}
function normalizeCreator(value = {}, existingId = null, accounts = {}) {
  const displayName = clean(value.displayName, 120);
  if (!displayName) throw new Error('Creator display name is required.');
  const creatorId = existingId || clean(value.creatorId, 80) || makeId('creator');
  const status = clean(value.status, 40).toLowerCase();
  return {
    creatorId,
    ownerDiscordId: discordId(value.ownerDiscordId),
    status: CREATOR_STATUSES.includes(status) ? status : 'active',
    displayName,
    group: clean(value.group, 120),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : []).map((item) => clean(item, 60)).filter(Boolean))],
    notes: clean(value.notes, 2000),
    enabled: value.enabled !== false,
    accountIds: [...new Set((Array.isArray(value.accountIds) ? value.accountIds : []).map((item) => clean(item, 80)).filter((item) => accounts[item]))],
    createdAt: value.createdAt || now(),
    updatedAt: now(),
  };
}
function normalize(raw = {}) {
  const base = defaults();
  const source = isObject(raw) ? raw : {};
  const settings = isObject(source.settings) ? source.settings : {};
  const quiet = isObject(settings.quietHours) ? settings.quietHours : {};
  const accounts = {};
  for (const [key, value] of Object.entries(isObject(source.accounts) ? source.accounts : {})) {
    if (!isObject(value)) continue;
    try { accounts[key] = normalizeAccount({ ...value, accountId: value.accountId || key }, key); } catch { }
  }
  const creators = {};
  for (const [key, value] of Object.entries(isObject(source.creators) ? source.creators : {})) {
    if (!isObject(value)) continue;
    try { creators[key] = normalizeCreator({ ...value, creatorId: value.creatorId || key }, key, accounts); } catch { }
  }
  const priority = [...new Set((Array.isArray(settings.platformPriority) ? settings.platformPriority : PLATFORMS).map((item) => clean(item, 20).toLowerCase()).filter((item) => PLATFORMS.includes(item)))];
  const normalized = {
    ...base,
    ...source,
    alertsChannelId: discordId(source.alertsChannelId),
    logChannelId: discordId(source.logChannelId),
    managerRoleIds: [...new Set((Array.isArray(source.managerRoleIds) ? source.managerRoleIds : []).map(discordId).filter(Boolean))],
    userRoleIds: [...new Set((Array.isArray(source.userRoleIds) ? source.userRoleIds : []).map(discordId).filter(Boolean))],
    accounts,
    creators,
    templates: normalizeTemplates(source.templates),
    settings: {
      ...base.settings,
      ...settings,
      checkIntervalMs: asNumber(settings.checkIntervalMs, 300000, 30000, 86400000),
      retryIntervalMs: asNumber(settings.retryIntervalMs, 60000, 30000, 86400000),
      retryDeliveries: settings.retryDeliveries !== false,
      maxDeliveryAttempts: asNumber(settings.maxDeliveryAttempts, 5, 1, 25),
      cooldownMs: asNumber(settings.cooldownMs, 300000, 0, 86400000),
      suppressDuplicates: settings.suppressDuplicates !== false,
      editLiveNotifications: settings.editLiveNotifications !== false,
      deleteEndedNotifications: settings.deleteEndedNotifications !== false,
      includeViewerCount: settings.includeViewerCount !== false,
      includeLiveDuration: settings.includeLiveDuration !== false,
      thumbnailPreference: ['stream', 'creator', 'none'].includes(settings.thumbnailPreference) ? settings.thumbnailPreference : 'stream',
      platformPriority: [...priority, ...PLATFORMS.filter((item) => !priority.includes(item))],
      quietHours: {
        enabled: quiet.enabled === true,
        start: /^\d{2}:\d{2}$/.test(quiet.start) ? quiet.start : '23:00',
        end: /^\d{2}:\d{2}$/.test(quiet.end) ? quiet.end : '08:00',
        timezone: clean(quiet.timezone || quiet.timeZone || 'Europe/London', 100) || 'Europe/London',
      },
    },
    history: Array.isArray(source.history) ? source.history.slice(-1000) : [],
    queue: Array.isArray(source.queue) ? source.queue.slice(-500) : [],
    analytics: { ...base.analytics, ...(isObject(source.analytics) ? source.analytics : {}) },
  };
  delete normalized.enabled;
  return normalized;
}
function getConfig(id) {
  return {
    ...normalize(guildManager.getGuildSection(id, 'social', defaults())),
    enabled: guildManager.isModuleEnabled(id, 'social'),
  };
}
function saveConfig(id, config, meta = {}) {
  const { enabled: _enabled, ...storedConfig } = isObject(config) ? config : {};
  const next = normalize({ ...storedConfig, updatedAt: now(), lastActorId: meta.actorId || null });
  guildManager.saveGuildSection(id, 'social', next, { guildId: id });
  return { ...next, enabled: guildManager.isModuleEnabled(id, 'social') };
}
function history(config, event) {
  config.history = [...(Array.isArray(config.history) ? config.history : []), { id: makeId('history'), createdAt: now(), ...event }].slice(-1000);
}
function overview(config) {
  const accounts = Object.values(config.accounts);
  const pendingRetries = accounts.filter((item) => item?.state?.pendingDelivery).map((item) => ({
    accountId: item.accountId || null,
    platform: item.platform || null,
    attempts: Number(item.state.pendingDelivery.attempts || 0),
    nextAttemptAt: item.state.pendingDelivery.nextAttemptAt || null,
    error: item.state.lastDeliveryError || null,
  }));
  return { enabled: config.enabled, accountCount: accounts.length, enabledAccountCount: accounts.filter((item) => item.enabled).length, creatorCount: Object.keys(config.creators).length, analytics: config.analytics, queue: { total: config.queue.length + pendingRetries.length, legacy: config.queue.length, pending: config.queue.filter((item) => ['pending', 'retry'].includes(item.status)).length + pendingRetries.length, retries: pendingRetries }, history: { total: config.history.length }, updatedAt: config.updatedAt };
}
function health(config, discordGuild = null) {
  const issues = [];
  if (!config.enabled) issues.push({ severity: 'warning', code: 'module_disabled', message: 'Social Studio is disabled.' });
  const hasRoutedChannel = Boolean(config.alertsChannelId)
    || Object.values(config.alertChannels || {}).some(Boolean)
    || Object.values(config.platformChannels || {}).some(Boolean)
    || Object.values(config.accounts).some((item) => item.alertChannelId || Object.values(item.alertChannels || {}).some(Boolean));
  if (!hasRoutedChannel) issues.push({ severity: 'warning', code: 'alert_channel_missing', message: 'No alert channel is configured.' });
  if (discordGuild) issues.push(...validateDiscordTargets(discordGuild, config));
  if (discordGuild && config.liveRoleId) {
    const role = discordGuild.roles.cache.get(config.liveRoleId);
    if (!role) issues.push({ severity: 'error', code: 'live_role_missing', message: 'Configured LIVE role is unavailable.' });
    else if (role.managed) issues.push({ severity: 'error', code: 'live_role_managed', message: 'Configured LIVE role is a managed Discord role and cannot be assigned by Goliath.' });
    else if (!role.editable) issues.push({ severity: 'error', code: 'live_role_unmanageable', message: 'Goliath cannot manage the configured LIVE role because of Discord role hierarchy or permissions.' });
  }
  if (discordGuild) {
    for (const roleId of [...new Set([...(config.managerRoleIds || []), ...(config.userRoleIds || []), ...(config.notificationRoleId ? [config.notificationRoleId] : [])].map(String))]) {
      if (!discordGuild.roles.cache.has(roleId)) issues.push({ severity: 'warning', code: 'role_missing', roleId, message: 'Configured Social Studio role ' + roleId + ' is unavailable.' });
    }
  }
  for (const account of Object.values(config.accounts)) {
    if (!account.alertTypes.length) issues.push({ severity: 'warning', code: 'alert_types_missing', accountId: account.accountId, message: 'No alert types are enabled.' });
    if (account.alertChannelId && discordGuild) {
      const channel = discordGuild.channels.cache.get(account.alertChannelId);
      if (!channel) issues.push({ severity: 'error', code: 'channel_missing', accountId: account.accountId, message: 'Configured alert channel is unavailable.' });
      else if (!channel.isTextBased?.()) issues.push({ severity: 'error', code: 'channel_not_text_based', accountId: account.accountId, message: 'Configured alert channel is not text based.' });
    }
  }
  if (config.alertsChannelId && discordGuild) {
    const channel = discordGuild.channels.cache.get(config.alertsChannelId);
    if (!channel) issues.push({ severity: 'error', code: 'default_channel_missing', message: 'Configured default alert channel is unavailable.' });
    else if (!channel.isTextBased?.()) issues.push({ severity: 'error', code: 'default_channel_not_text_based', message: 'Configured default alert channel is not text based.' });
  }
  const errors = issues.filter((item) => item.severity === 'error').length;
  const score = Math.max(0, 100 - errors * 25 - (issues.length - errors) * 8);
  return { healthy: errors === 0, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D', score, issues, checkedAt: now() };
}
function render(template, values) { return replaceVariables(String(template || ''), values); }
function validateDiscordTargets(discordGuild, config) {
  const issues = [];
  const channelIds = new Set();
  if (config.alertsChannelId) channelIds.add(config.alertsChannelId);
  for (const account of Object.values(config.accounts || {})) {
    if (account.alertChannelId) channelIds.add(account.alertChannelId);
    for (const id of Object.values(account.alertChannels || {})) if (id) channelIds.add(id);
  }
  for (const channelId of channelIds) {
    const channel = discordGuild?.channels?.cache?.get(channelId);
    if (!channel) issues.push({ code: 'channel_missing', channelId });
    else if (!channel.isTextBased?.()) issues.push({ code: 'channel_not_text_based', channelId });
    else if (typeof channel.send !== 'function') issues.push({ code: 'channel_not_sendable', channelId });
  }
  const roleIds = new Set();
  if (config.notificationRoleId) roleIds.add(config.notificationRoleId);
  for (const account of Object.values(config.accounts || {})) if (account.mentionRoleId) roleIds.add(account.mentionRoleId);
  for (const roleId of roleIds) {
    const role = discordGuild?.roles?.cache?.get(roleId);
    if (!role) issues.push({ code: 'role_missing', roleId });
    else if (role.managed) issues.push({ code: 'role_managed', roleId });
  }
  return issues;
}
function preview(account, config, alertType) {
  const creator = Object.values(config.creators).find((item) => item.accountIds.includes(account.accountId));
  const template = resolveTemplate(config.templates, alertType);
  const values = { creator: creator?.displayName || account.displayName || account.username, title: `Test ${alertType} alert`, platform: account.platform, url: account.url || account.username };
  return { title: render(template.title, values), description: render(template.description, values), buttonLabel: template.buttonLabel, url: values.url, platform: account.platform, alertType };
}
async function sendSimulation(req, id, account, data) {
  const discordGuild = await guild(req, id);
  if (!discordGuild) throw new Error('Discord guild is unavailable.');
  const targetIssues = validateDiscordTargets(discordGuild, getConfig(id));
  if (targetIssues.length) throw new Error('Configured Discord target is unavailable or invalid.');
  const channelId = account.alertChannelId || getConfig(id).alertsChannelId;
  if (!channelId) throw new Error('No alert channel is configured.');
  const channel = discordGuild.channels.cache.get(channelId) || await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('Configured alert channel is unavailable or not text based.');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(data.title || 'Social alert').setDescription(data.description || 'Social Studio simulation').setFooter({ text: `${account.platform} simulation` }).setTimestamp();
  const components = /^https?:\/\//i.test(data.url || '') ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(data.url).setLabel(data.buttonLabel || 'Open'))] : [];
  const content = account.mentionMode === 'everyone' ? '@everyone' : account.mentionMode === 'here' ? '@here' : account.mentionMode === 'role' && account.mentionRoleId ? `<@&${account.mentionRoleId}>` : undefined;
  return channel.send({ content, embeds: [embed], components, allowedMentions: { parse: account.mentionMode === 'everyone' ? ['everyone'] : [], roles: account.mentionRoleId ? [account.mentionRoleId] : [] } });
}

router.use(requireManageAccess);

router.get('/:guildId', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, config: getConfig(id) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/overview', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, overview: overview(getConfig(id)) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/providers', (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, providers: providerCatalog() }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/history', (req, res) => { try { const id = guildId(req); const limit = asNumber(req.query.limit, 100, 1, 500); return success(res, { guildId: id, history: getConfig(id).history.slice(-limit).reverse() }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/queue', (req, res) => { try { const id = guildId(req); const limit = asNumber(req.query.limit, 100, 1, 500); return success(res, { guildId: id, queue: getConfig(id).queue.slice(-limit).reverse() }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/creator-hub', (req, res) => { try { const id = guildId(req); const config = getConfig(id); return success(res, { guildId: id, creators: Object.values(config.creators), accounts: Object.values(config.accounts) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/creator-hub/diagnostics', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const result = health(config); return success(res, { guildId: id, diagnostics: { health: result, runtime: { state: result.healthy ? (result.issues.length ? 'warning' : 'healthy') : 'error', startedAt: runtime.startedAt, warningCount: result.issues.filter((item) => item.severity === 'warning').length, errorCount: result.issues.filter((item) => item.severity === 'error').length, issues: result.issues, scheduler: { started: config.enabled, tickIntervalMs: config.settings.checkIntervalMs }, queue: { started: config.enabled && config.settings.retryDeliveries, intervalMs: config.settings.retryIntervalMs }, incidentMonitor: { started: true, intervalMs: 60000 } } } }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/health', async (req, res) => { try { const id = guildId(req); return success(res, { guildId: id, health: health(getConfig(id), await guild(req, id)) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/config', (req, res) => { try { const id = guildId(req); const current = getConfig(id); const body = isObject(req.body) ? req.body : {}; if (typeof body.enabled === 'boolean') guildManager.setModuleEnabled(id, 'social', body.enabled, actor(req)); const bodyConfig = sanitizeConfigInput(body, id); const incomingTemplates = normalizeTemplates(bodyConfig.templates); const config = { ...current, ...bodyConfig, settings: { ...current.settings, ...(isObject(bodyConfig.settings) ? bodyConfig.settings : {}) }, templates: isObject(bodyConfig.templates) ? { ...current.templates, ...incomingTemplates, defaults: { ...current.templates.defaults, ...incomingTemplates.defaults }, custom: { ...current.templates.custom, ...incomingTemplates.custom } } : current.templates }; history(config, { status: 'config_updated', creator: 'System', alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/accounts', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const account = normalizeAccount(sanitizeAccountInput(req.body || {})); assertAccountIdentityAvailable(config, account); config.accounts[account.accountId] = account; history(config, { status: 'created', accountId: account.accountId, platform: account.platform, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, account, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const accountId = clean(req.params.accountId, 80); const existingAccount = config.accounts[accountId]; if (!existingAccount) throw new Error('Social account was not found.'); delete config.accounts[accountId]; Object.values(config.creators).forEach((creator) => { creator.accountIds = (creator.accountIds || []).filter((item) => item !== accountId); }); config.queue = (config.queue || []).filter((item) => String(item?.accountId || '') !== accountId); history(config, { status: 'deleted', accountId, platform: existingAccount.platform || null, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/check', async (req, res) => {
  try {
    const id = guildId(req);
    const config = getConfig(id);
    const result = await diagnoseAccounts(Object.values(config.accounts), {
      includeDisabled: false,
      includeDelivery: true,
      concurrency: asNumber(req.body?.concurrency, 4, 1, 10),
      resolveDeliveryChannelId: (account) => account.alertChannelId || config.alertsChannelId || null,
    });
    for (const diagnostic of result.diagnostics) {
      const account = config.accounts[diagnostic.accountId];
      if (account) config.accounts[diagnostic.accountId] = applyDiagnosticState(account, diagnostic);
    }
    const checked = result.diagnostics.length;
    const failures = result.summary.providerErrors + result.summary.configuration;
    config.analytics.checks = Number(config.analytics.checks || 0) + checked;
    config.analytics.failures = Number(config.analytics.failures || 0) + failures;
    runtime.checks += checked;
    runtime.errors += failures;
    history(config, { status: 'diagnostic_checked', creator: 'All creators', alertType: null, checked, summary: result.summary });
    const saved = saveConfig(id, config, actor(req));
    return success(res, { guildId: id, checked, diagnostics: result.diagnostics, summary: result.summary, config: saved });
  } catch (error) {
    runtime.errors += 1;
    return failure(res, error, 400);
  }
});
router.post('/:guildId/accounts/:accountId/check', async (req, res) => {
  try {
    const id = guildId(req);
    const config = getConfig(id);
    const accountId = clean(req.params.accountId, 80);
    const account = config.accounts[accountId];
    if (!account) throw new Error('Social account was not found.');
    const diagnostic = await diagnoseAccount(account, {
      includeDelivery: true,
      deliveryChannelId: account.alertChannelId || config.alertsChannelId || null,
    });
    config.accounts[accountId] = applyDiagnosticState(account, diagnostic);
    config.analytics.checks = Number(config.analytics.checks || 0) + 1;
    const failed = diagnostic.health?.healthy === false && diagnostic.health?.level === 'error';
    if (failed) {
      config.analytics.failures = Number(config.analytics.failures || 0) + 1;
      runtime.errors += 1;
    }
    runtime.checks += 1;
    history(config, { status: 'diagnostic_checked', accountId, platform: account.platform, alertType: null, diagnostic: config.accounts[accountId].diagnostics?.provider || null });
    const saved = saveConfig(id, config, actor(req));
    return success(res, { guildId: id, account: saved.accounts[accountId], diagnostic, config: saved });
  } catch (error) {
    runtime.errors += 1;
    return failure(res, error, 400);
  }
});
router.post('/:guildId/creator-hub', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = normalizeCreator(sanitizeCreatorInput(req.body || {}), null, config.accounts); config.creators[creator.creatorId] = creator; history(config, { status: 'creator_created', creator: creator.displayName, creatorId: creator.creatorId, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/creator-hub/:creatorId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creatorId = clean(req.params.creatorId, 80); const existing = config.creators[creatorId]; if (!existing) throw new Error('Creator profile was not found.'); const creator = normalizeCreator({ ...existing, ...sanitizeCreatorInput(req.body || {}), creatorId, ownerDiscordId: existing.ownerDiscordId }, creatorId, config.accounts); config.creators[creatorId] = creator; history(config, { status: 'creator_updated', creator: creator.displayName, creatorId, alertType: null, actorId: actor(req).actorId }); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/:creatorId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = config.creators[clean(req.params.creatorId, 80)]; const accountId = clean(req.params.accountId, 80); if (!creator || !config.accounts[accountId]) throw new Error('Creator or account was not found.'); Object.values(config.creators).forEach((item) => { item.accountIds = (item.accountIds || []).filter((id) => id !== accountId); }); creator.accountIds = [...new Set([...(creator.accountIds || []), accountId])]; creator.updatedAt = now(); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/creator-hub/:creatorId/accounts/:accountId', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const creator = config.creators[clean(req.params.creatorId, 80)]; if (!creator) throw new Error('Creator profile was not found.'); creator.accountIds = creator.accountIds.filter((item) => item !== clean(req.params.accountId, 80)); creator.updatedAt = now(); return success(res, { guildId: id, creator, config: saveConfig(id, config, actor(req)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/rebuild', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const linked = new Set(Object.values(config.creators).flatMap((creator) => creator.accountIds)); let created = 0; for (const account of Object.values(config.accounts)) { if (linked.has(account.accountId)) continue; const creator = normalizeCreator({ displayName: account.displayName || account.username, accountIds: [account.accountId], tags: [account.platform] }, null, config.accounts); config.creators[creator.creatorId] = creator; created += 1; } const saved = saveConfig(id, config, actor(req)); return success(res, { guildId: id, created, creators: Object.values(saved.creators) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/creator-hub/accounts/:accountId/simulate', async (req, res) => { try { const id = guildId(req); const config = getConfig(id); const account = config.accounts[clean(req.params.accountId, 80)]; if (!account) throw new Error('Social account was not found.'); const alertType = ALERT_TYPES.includes(req.body?.alertType) ? req.body.alertType : 'live'; const data = preview(account, config, alertType); let messageId = null; if (req.body?.send === true) { const message = await sendSimulation(req, id, account, data); messageId = message.id; config.analytics.alertsSent = Number(config.analytics.alertsSent || 0) + 1; runtime.deliveries += 1; } config.analytics.simulations = Number(config.analytics.simulations || 0) + 1; history(config, { status: req.body?.send === true ? 'simulation_sent' : 'simulation_previewed', accountId: account.accountId, platform: account.platform, alertType }); saveConfig(id, config, actor(req)); return success(res, { guildId: id, preview: data, sent: req.body?.send === true, messageId }); } catch (error) { runtime.errors += 1; return failure(res, error, 400); } });
router.post('/:guildId/queue/process', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const currentTime = Date.now(); let processed = 0; let skipped = 0; const maxAttempts = Math.max(1, Number(config.settings?.maxDeliveryAttempts || 5)); config.queue = (config.queue || []).map((item) => { if (!item || !['pending', 'retry'].includes(item.status)) return item; const dueAt = item.nextAttemptAt ? new Date(item.nextAttemptAt).getTime() : 0; const attempts = Number(item.attempts || 0); if (dueAt && dueAt > currentTime) { skipped += 1; return item; } if (attempts >= maxAttempts) return { ...item, status: 'failed', failedAt: item.failedAt || now() }; processed += 1; return { ...item, status: 'processed', processedAt: now() }; }); return success(res, { guildId: id, processed, skipped, queue: saveConfig(id, config, actor(req)).queue }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/queue/:itemId/retry', (req, res) => { try { const id = guildId(req); const config = getConfig(id); const item = config.queue.find((entry) => entry.id === clean(req.params.itemId, 100)); if (!item) throw new Error('Queue item was not found.'); const maxAttempts = Math.max(1, Number(config.settings?.maxDeliveryAttempts || 5)); const attempts = Number(item.attempts || 0); if (attempts >= maxAttempts) throw new Error('Queue item has reached the maximum delivery attempts.'); item.status = 'retry'; item.nextAttemptAt = now(); item.attempts = attempts + 1; return success(res, { guildId: id, item, queue: saveConfig(id, config, actor(req)).queue }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/repair', async (req, res) => { try { const id = guildId(req); const discordGuild = await guild(req, id); const config = getConfig(id); let repaired = 0; for (const account of Object.values(config.accounts)) { const validAlertTypes = account.alertTypes.filter((item) => ALERT_TYPES.includes(item)); if (validAlertTypes.length !== account.alertTypes.length) { account.alertTypes = validAlertTypes; repaired += 1; } if (!account.alertTypes.length) { account.alertTypes = ['live']; repaired += 1; } } const validQueue = (config.queue || []).filter((item) => item && item.id && (!item.accountId || config.accounts[item.accountId])).slice(-500); if (validQueue.length !== (config.queue || []).length) { config.queue = validQueue; repaired += 1; } for (const creator of Object.values(config.creators || {})) { const validIds = [...new Set((creator.accountIds || []).filter((accountId) => config.accounts[accountId]))]; if (validIds.length !== (creator.accountIds || []).length) { creator.accountIds = validIds; creator.updatedAt = now(); repaired += 1; } } history(config, { status: 'repair', creator: 'System', alertType: null, repaired }); const saved = saveConfig(id, config, actor(req)); return success(res, { guildId: id, repaired, health: health(saved, discordGuild), config: saved }); } catch (error) { return failure(res, error, 400); } });

module.exports = router;