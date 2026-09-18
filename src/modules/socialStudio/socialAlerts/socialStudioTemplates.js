'use strict';

const ALERT_TYPES = ['live', 'ended', 'vod', 'clip', 'upload', 'short', 'post'];
const TEMPLATE_VERSION = 1;
const TEMPLATE_SOURCE = 'socialStudioTemplates';

const DEFAULT_TEMPLATES = Object.freeze({
  live: Object.freeze({ title: '🔴 {creator} is LIVE', description: '**{title}**', buttonLabel: 'Watch Live', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  ended: Object.freeze({ title: '⚫ {creator} has ended their stream', description: '**{title}**', buttonLabel: 'View Channel', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  vod: Object.freeze({ title: '🎞️ New VOD from {creator}', description: '**{title}**', buttonLabel: 'Watch VOD', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  clip: Object.freeze({ title: '🎬 New clip from {creator}', description: '**{title}**', buttonLabel: 'Watch Clip', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  upload: Object.freeze({ title: '📺 New upload from {creator}', description: '**{title}**', buttonLabel: 'Watch Now', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  short: Object.freeze({ title: '📱 New short from {creator}', description: '**{title}**', buttonLabel: 'Watch Now', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
  post: Object.freeze({ title: '📝 New post from {creator}', description: '**{title}**', buttonLabel: 'View Post', color: '{platformColor}', footer: 'Social Studio • {platform}' }),
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cloneTemplate = (template = {}) => ({ ...template });
const sameTemplateCopy = (left = {}, right = {}) => (
  String(left.title || '') === String(right.title || '') &&
  String(left.description || '') === String(right.description || '')
);
const legacyPlaceholderTemplate = (template = {}) => (
  String(template.title || '').trim() === '{creator} alert' &&
  String(template.description || '').trim() === '{title}'
);

function normalizeTemplates(source = {}) {
  const raw = isObject(source) ? source : {};
  const rawDefaults = isObject(raw.defaults) ? raw.defaults : {};
  const rawCustom = isObject(raw.custom) ? raw.custom : raw;
  const defaults = {};
  const custom = {};

  for (const type of ALERT_TYPES) {
    defaults[type] = { ...DEFAULT_TEMPLATES[type], ...(isObject(rawDefaults[type]) ? rawDefaults[type] : {}) };
    const legacy = rawCustom === raw && (type === 'defaults' || type === 'custom') ? null : rawCustom[type];
    if (isObject(legacy) && !legacyPlaceholderTemplate(legacy) && !sameTemplateCopy(legacy, defaults[type])) custom[type] = cloneTemplate(legacy);
  }

  return {
    custom,
    defaults,
    lastEditedAt: raw.lastEditedAt || null,
    lastEditedBy: raw.lastEditedBy || null,
    lastEditedType: raw.lastEditedType || null,
    lastResetAt: raw.lastResetAt || null,
    lastResetBy: raw.lastResetBy || null,
    lastResetType: raw.lastResetType || null,
    source: raw.source || TEMPLATE_SOURCE,
    version: Number(raw.version || raw.templateVersion || TEMPLATE_VERSION) || TEMPLATE_VERSION,
  };
}

function resolveTemplate(templates, type) {
  const normalized = normalizeTemplates(templates);
  const fallback = normalized.defaults[type] || normalized.defaults.upload || DEFAULT_TEMPLATES.upload;
  return { ...fallback, ...(isObject(normalized.custom[type]) ? normalized.custom[type] : {}) };
}

function resetTemplate(templates, type) {
  const normalized = normalizeTemplates(templates);
  delete normalized.custom[type];
  return normalized;
}

function creatorFor(config, accountId) {
  return Object.values(isObject(config?.creators) ? config.creators : {}).find((creator) =>
    Array.isArray(creator?.accountIds) && creator.accountIds.map(String).includes(String(accountId || ''))
  ) || null;
}

function linkedUserId(creator, account) {
  return String(creator?.ownerDiscordId || creator?.discordUserId || creator?.userId || account?.ownerDiscordId || account?.discordUserId || account?.userId || '');
}

function explicitAccountRoutes(account) {
  if (!isObject(account)) return { channelId: null, channels: {} };
  if (account.userRouteBaseCaptured) return { channelId: account.userRouteBaseChannelId || null, channels: isObject(account.userRouteBaseChannels) ? account.userRouteBaseChannels : {} };
  if (account.creatorRouteInherited) return { channelId: account.creatorRoutePreviousChannelId || null, channels: isObject(account.creatorRoutePreviousChannels) ? account.creatorRoutePreviousChannels : {} };
  return { channelId: account.alertChannelId || null, channels: isObject(account.alertChannels) ? account.alertChannels : {} };
}

function resolveSocialRoute(config, account, eventType, creatorInput = null) {
  const creator = creatorInput || creatorFor(config, account?.accountId);
  const platform = String(account?.platform || '').toLowerCase();
  const userId = linkedUserId(creator, account);
  const overrides = isObject(config?.userChannelOverrides) ? config.userChannelOverrides : {};
  const userRoutes = isObject(overrides[userId]) ? overrides[userId] : {};
  const accountRoutes = explicitAccountRoutes(account);
  const creatorPlatformChannels = isObject(creator?.platformChannels) ? creator.platformChannels : {};
  const serverPlatformChannels = isObject(config?.platformChannels) ? config.platformChannels : {};
  const serverAlertChannels = isObject(config?.alertChannels) ? config.alertChannels : {};
  const candidates = [
    [creatorPlatformChannels[platform], 'Creator Platform Override'],
    [userRoutes[eventType], 'User Content Override'],
    [userRoutes.all, 'User All Content'],
    [creator?.alertChannelId, 'Creator Override'],
    [accountRoutes.channels[eventType], 'Account Content Override'],
    [accountRoutes.channelId, 'Account Override'],
    [serverPlatformChannels[platform], 'Server Platform Override'],
    [serverAlertChannels[eventType], 'Server Dedicated'],
    [config?.alertsChannelId, 'Server Default'],
  ];
  for (const [channelId, source] of candidates) {
    if (channelId) return { channelId: String(channelId), source, creator, userId, platform };
  }
  return { channelId: null, source: 'Not configured', creator, userId, platform };
}

function projectEffectiveAccounts(config) {
  const projected = {};
  const notificationMentionMode = ['role', 'everyone', 'here'].includes(config?.notificationMentionMode) ? config.notificationMentionMode : 'none';
  const notificationRoleId = notificationMentionMode === 'role' ? String(config?.notificationRoleId || '') || null : null;
  const accounts = isObject(config?.accounts) ? config.accounts : {};
  for (const [accountId, accountValue] of Object.entries(accounts)) {
    const account = { ...accountValue, accountId, alertChannels: { ...(isObject(accountValue?.alertChannels) ? accountValue.alertChannels : {}) }, mentionMode: notificationMentionMode, mentionRoleId: notificationRoleId };
    const creator = creatorFor(config, accountId);
    for (const eventType of ALERT_TYPES) {
      const resolved = resolveSocialRoute(config, account, eventType, creator);
      if (resolved.channelId) account.alertChannels[eventType] = resolved.channelId;
      else delete account.alertChannels[eventType];
    }
    projected[accountId] = account;
  }
  return projected;
}

module.exports = { ALERT_TYPES, normalizeTemplates, resolveTemplate, resetTemplate, projectEffectiveAccounts };
