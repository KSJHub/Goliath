'use strict';

const fs = require('fs');
const path = require('path');

const { getRuntimePaths } = require('../../config/runtimePaths');
const { clone, ensureDir, read, write } = require('./fileStore');

const {
  DEFAULT_GUILD_DATA = {},
  DEFAULT_LOGS = { enabled: true, channels: {}, events: {} },
  DEFAULT_SECURITY = {},
  DEFAULT_SERVER_BACKUPS = {},
  DEFAULT_EMBED = {},
  DEFAULT_EMBED_DEFAULTS = {},
  DEFAULT_GENERAL_SETTINGS = {},
  DEFAULT_TICKETS = {},
  DEFAULT_MODULES = {},
  DEFAULT_SUBSCRIPTION = {
    plan: 'free',
    status: 'active',
    source: 'system',
    expiresAt: null,
  },
} = require('./defaults');

const {
  getRoutedSection,
  setRoutedSection,
} = require('./sectionRouting');

const runtimePaths = getRuntimePaths(process.env.BOT_MODE || 'DEV');
const GUILDS_DIR = runtimePaths.guilds;

const LOG_CHANNEL_ALIASES = {
  logs: 'general',
  general: 'general',
  mod: 'moderation',
  moderation: 'moderation',
  admin: 'admin',
  automod: 'automod',
  member: 'member',
  message: 'messageDelete',
  messageDelete: 'messageDelete',
  messageEdit: 'messageEdit',
  voice: 'voice',
};

const guildCache = new Map();

function now() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(defaults = {}, source = {}) {
  if (!isPlainObject(defaults)) return clone(source);
  if (!isPlainObject(source)) return clone(defaults);

  const output = clone(defaults);

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeDeep(output[key], value);
    } else {
      output[key] = clone(value);
    }
  }

  return output;
}

function normalizeGuildId(guildId) {
  const id = String(guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error(`Invalid guild ID: ${guildId}`);
  return id;
}

function normalizeDiscordId(value) {
  const id = String(value || '').trim();
  return /^\d{16,20}$/.test(id) ? id : null;
}

function normalizeDiscordIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeDiscordId).filter(Boolean))];
}

function normalizeChannelId(value) {
  return normalizeDiscordId(value);
}

function cleanString(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanGuildName(value) {
  const name = cleanString(value, 120);
  return name || null;
}

function sanitizeKey(value, label = 'Key') {
  const key = String(value || '').trim();
  if (!key) throw new Error(`${label} is required.`);
  return key.slice(0, 80);
}

function cleanEmbedUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';

  const placeholders = new Set([
    '{guildIcon}',
    '{guildBanner}',
    '{botAvatar}',
    '{userAvatar}',
    '{memberAvatar}',
    '{serverIcon}',
    '{serverBanner}',
  ]);

  if (placeholders.has(url)) return url;

  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function resolveGuildMeta(guildOrMeta = {}) {
  if (!isPlainObject(guildOrMeta)) return {};
  return {
    guildId: guildOrMeta.id || guildOrMeta.guildId || null,
    guildName: cleanGuildName(guildOrMeta.name || guildOrMeta.guildName),
  };
}

function ensureGuildsDir() {
  ensureDir(GUILDS_DIR);
}

function getGuildFilePath(guildId) {
  return path.join(GUILDS_DIR, `${normalizeGuildId(guildId)}.json`);
}

function normalizeEmbed(embed = {}) {
  const source = isPlainObject(embed) ? embed : {};
  const merged = mergeDeep(DEFAULT_EMBED, source);

  merged.title = cleanString(merged.title, 256);
  merged.description = cleanString(merged.description, 4096);
  merged.color = cleanString(merged.color || '#5865F2', 20) || '#5865F2';

  merged.author = isPlainObject(merged.author) ? merged.author : {};
  merged.author.name = cleanString(merged.author.name || merged.authorName, 256);
  merged.author.iconURL = cleanEmbedUrl(merged.author.iconURL || merged.authorIcon);
  merged.author.url = cleanEmbedUrl(merged.author.url || merged.authorUrl);

  merged.thumbnailURL = cleanEmbedUrl(merged.thumbnailURL || merged.thumbnail);
  merged.imageURL = cleanEmbedUrl(merged.imageURL || merged.image);

  merged.footer = isPlainObject(merged.footer) ? merged.footer : { text: merged.footer };
  merged.footer.text = cleanString(merged.footer.text || '', 2048);
  merged.footer.iconURL = cleanEmbedUrl(merged.footer.iconURL || merged.footerIcon);

  merged.fields = Array.isArray(merged.fields)
    ? merged.fields
        .filter(isPlainObject)
        .slice(0, 25)
        .map((field) => ({
          name: cleanString(field.name, 256),
          value: cleanString(field.value, 1024),
          inline: field.inline === true,
        }))
        .filter((field) => field.name && field.value)
    : [];

  merged.buttons = Array.isArray(merged.buttons)
    ? merged.buttons
        .filter(isPlainObject)
        .slice(0, 25)
        .map((button) => ({
          id: cleanString(button.id, 100),
          label: cleanString(button.label, 80),
          emoji: cleanString(button.emoji, 50),
          style: cleanString(button.style || 'Primary', 20),
          url: cleanEmbedUrl(button.url),
          action: cleanString(button.action, 100),
          data: isPlainObject(button.data) ? button.data : {},
        }))
    : [];

  return merged;
}

function normalizeEmbedPresets(source = {}) {
  const raw = getRoutedSection(source, 'embedPresets', {});
  if (!isPlainObject(raw)) return {};

  return Object.entries(raw).reduce((presets, [name, preset]) => {
    if (!isPlainObject(preset)) return presets;
    const cleanName = sanitizeKey(preset.name || name, 'Preset name');
    presets[cleanName] = {
      ...normalizeEmbed(preset),
      name: cleanName,
      updatedAt: preset.updatedAt || now(),
    };
    return presets;
  }, {});
}

function normalizeEmbedBuilder(source = {}) {
  const builder = getRoutedSection(source, 'embedBuilder', {});
  const templates = {};

  if (isPlainObject(builder.templates)) {
    for (const [templateKey, templateData] of Object.entries(builder.templates)) {
      if (isPlainObject(templateData)) {
        templates[sanitizeKey(templateKey, 'Template key')] = normalizeEmbed(templateData);
      }
    }
  }

  return {
    draft: normalizeEmbed(builder.draft || {}),
    templates,
  };
}

function normalizeGeneralSettings(source = {}) {
  const settings = mergeDeep(DEFAULT_GENERAL_SETTINGS, getRoutedSection(source, 'generalSettings', {}));
  settings.prefix = String(settings.prefix || '!').trim() || '!';
  settings.appealUrl = String(settings.appealUrl || '').trim();
  settings.dashboardEnabled = settings.dashboardEnabled !== false;
  settings.managerRoleIds = normalizeDiscordIdArray(settings.managerRoleIds);
  settings.dashboardAccessRoleIds = normalizeDiscordIdArray(settings.dashboardAccessRoleIds);
  settings.commandManagerRoleIds = normalizeDiscordIdArray(settings.commandManagerRoleIds);
  settings.restrictedChannelIds = normalizeDiscordIdArray(settings.restrictedChannelIds);
  settings.commandNotFoundEnabled = settings.commandNotFoundEnabled !== false;
  settings.wrongCommandUsageEnabled = settings.wrongCommandUsageEnabled !== false;
  settings.noCommandPermissionsEnabled = settings.noCommandPermissionsEnabled !== false;
  settings.disabledInChannelEnabled = settings.disabledInChannelEnabled === true;
  settings.commandCooldownEnabled = settings.commandCooldownEnabled !== false;
  settings.instantDeleteDataEnabled = settings.instantDeleteDataEnabled === true;
  return settings;
}

function normalizeLogs(source = {}) {
  const logs = mergeDeep(DEFAULT_LOGS, getRoutedSection(source, 'logs', {}));
  const channels = isPlainObject(logs.channels) ? logs.channels : {};
  const events = isPlainObject(logs.events) ? logs.events : {};

  logs.enabled = logs.enabled !== false;
  logs.channels = mergeDeep(DEFAULT_LOGS.channels || {}, channels);
  logs.events = mergeDeep(DEFAULT_LOGS.events || {}, events);

  logs.channels.general = normalizeChannelId(logs.channels.general);
  logs.channels.moderation = normalizeChannelId(logs.channels.moderation);
  logs.channels.admin = normalizeChannelId(logs.channels.admin);
  logs.channels.automod = normalizeChannelId(logs.channels.automod);
  logs.channels.member = normalizeChannelId(logs.channels.member);
  logs.channels.messageDelete = normalizeChannelId(logs.channels.messageDelete);
  logs.channels.messageEdit = normalizeChannelId(logs.channels.messageEdit);
  logs.channels.voice = normalizeChannelId(logs.channels.voice);

  return logs;
}

function normalizeSecurity(source = {}) {
  const security = mergeDeep(DEFAULT_SECURITY, getRoutedSection(source, 'security', {}));
  security.enabled = security.enabled !== false;
  security.threatLevel = String(security.threatLevel || 'low').toLowerCase();
  if (!['low', 'medium', 'high', 'critical'].includes(security.threatLevel)) security.threatLevel = 'low';
  security.incidents = Array.isArray(security.incidents) ? security.incidents.slice(0, 250) : [];
  security.totalIncidents = Number(security.totalIncidents || 0);
  security.criticalIncidents = Number(security.criticalIncidents || 0);
  return security;
}

function normalizeServerBackups(source = {}) {
  const config = mergeDeep(DEFAULT_SERVER_BACKUPS, getRoutedSection(source, 'serverBackups', {}));
  config.enabled = config.enabled !== false;
  config.storage = mergeDeep(DEFAULT_SERVER_BACKUPS.storage || {}, isPlainObject(config.storage) ? config.storage : {});
  config.retention = mergeDeep(DEFAULT_SERVER_BACKUPS.retention || {}, isPlainObject(config.retention) ? config.retention : {});
  config.retention.maxBackups = Number(config.retention.maxBackups || process.env.SERVER_BACKUP_RETENTION || 4);
  config.retention.autoCleanup = config.retention.autoCleanup !== false;
  config.storage.path = config.storage.path || process.env.SERVER_BACKUP_DIR || runtimePaths.backups;
  return config;
}

function normalizeTickets(source = {}) {
  const tickets = mergeDeep(DEFAULT_TICKETS, getRoutedSection(source, 'tickets', {}));
  tickets.settings = isPlainObject(tickets.settings) ? tickets.settings : {};
  tickets.panels = Array.isArray(tickets.panels) ? tickets.panels : [];
  tickets.tickets = Array.isArray(tickets.tickets) ? tickets.tickets : [];
  tickets.analytics = isPlainObject(tickets.analytics) ? tickets.analytics : {};
  return tickets;
}

function normalizeSubscription(source = {}) {
  const subscription = mergeDeep(DEFAULT_SUBSCRIPTION, isPlainObject(source) ? source : {});
  subscription.plan = String(subscription.plan || 'free').trim().toLowerCase() || 'free';
  if (!['free', 'plus', 'pro', 'lifetime'].includes(subscription.plan)) subscription.plan = 'free';
  subscription.status = String(subscription.status || 'active').trim().toLowerCase() || 'active';
  subscription.source = String(subscription.source || 'system').trim().toLowerCase() || 'system';
  subscription.expiresAt = subscription.expiresAt || null;
  return subscription;
}

function buildModules(source = {}) {
  const modules = mergeDeep(DEFAULT_MODULES, isPlainObject(source.modules) ? source.modules : {});
  modules.generalSettings = normalizeGeneralSettings(source);
  modules.logs = normalizeLogs(source);
  modules.security = normalizeSecurity(source);
  modules.serverBackups = normalizeServerBackups(source);
  modules.embedDefaults = mergeDeep(DEFAULT_EMBED_DEFAULTS, getRoutedSection(source, 'embedDefaults', {}));
  modules.embedPresets = normalizeEmbedPresets(source);
  modules.embedBuilder = normalizeEmbedBuilder(source);
  modules.tickets = normalizeTickets(source);
  return modules;
}

function mergeDefaults(data = {}) {
  const source = isPlainObject(data) ? data : {};
  const base = mergeDeep(DEFAULT_GUILD_DATA, source);

  return {
    guildId: source.guildId || base.guildId || null,
    guildName: cleanGuildName(source.guildName || source.name || base.guildName),
    createdAt: source.createdAt || base.createdAt || now(),
    updatedAt: source.updatedAt || base.updatedAt || now(),
    subscription: normalizeSubscription(source.subscription || base.subscription),
    modules: buildModules(source),
  };
}

function hasMissingDefaultModules(rawData = {}) {
  if (!isPlainObject(DEFAULT_MODULES)) return false;
  if (!isPlainObject(rawData.modules)) return true;
  return Object.keys(DEFAULT_MODULES).some((moduleName) => !isPlainObject(rawData.modules[moduleName]));
}

function cacheGuildData(guildId, data) {
  const safeGuildId = normalizeGuildId(guildId);
  const nextData = mergeDefaults(data);
  nextData.guildId = safeGuildId;
  guildCache.set(safeGuildId, clone(nextData));
  return clone(nextData);
}

function getGuildData(guildId, options = {}) {
  const safeGuildId = normalizeGuildId(guildId);
  const filePath = getGuildFilePath(safeGuildId);

  if (!options.forceReload && guildCache.has(safeGuildId)) return clone(guildCache.get(safeGuildId));

  ensureGuildsDir();

  const exists = fs.existsSync(filePath);
  const rawData = read(filePath, DEFAULT_GUILD_DATA);
  const data = mergeDefaults(rawData);
  data.guildId = safeGuildId;

  const needsRewrite =
    !exists ||
    !isPlainObject(rawData.modules) ||
    !isPlainObject(rawData.subscription) ||
    hasMissingDefaultModules(rawData);

  if (needsRewrite) {
    data.updatedAt = now();
    write(filePath, data);
  }

  return cacheGuildData(safeGuildId, data);
}

function saveGuildData(guildId, data = {}, guildOrMeta = {}) {
  const safeGuildId = normalizeGuildId(guildId);
  const filePath = getGuildFilePath(safeGuildId);
  const current = getGuildData(safeGuildId);
  const meta = resolveGuildMeta(guildOrMeta);

  const nextData = mergeDefaults({
    ...current,
    ...(isPlainObject(data) ? data : {}),
  });
  nextData.guildId = safeGuildId;
  nextData.guildName = meta.guildName || cleanGuildName(nextData.guildName) || null;
  nextData.updatedAt = now();

  write(filePath, nextData);
  return cacheGuildData(safeGuildId, nextData);
}

async function getGuildConfig(guildId) {
  return getGuildData(guildId);
}

async function saveGuildConfig(guildId, data = {}, guildOrMeta = {}) {
  return saveGuildData(guildId, data, guildOrMeta);
}

function syncGuildMeta(guildOrMeta = {}) {
  const meta = resolveGuildMeta(guildOrMeta);
  if (!meta.guildId) throw new Error('Cannot sync guild meta without a guild ID.');
  return saveGuildData(meta.guildId, { guildName: meta.guildName });
}

function getGuildSection(guildId, sectionName, fallback = {}) {
  const data = getGuildData(guildId);
  return mergeDeep(fallback, getRoutedSection(data, sectionName, fallback));
}

function replaceGuildSection(guildId, sectionName, sectionData = {}, guildOrMeta = {}) {
  const nextSection = {
    ...(isPlainObject(sectionData) ? clone(sectionData) : {}),
    updatedAt: now(),
  };

  const current = getGuildData(guildId);
  const routedGuild = setRoutedSection(current, sectionName, nextSection);
  const updatedGuild = saveGuildData(guildId, routedGuild, guildOrMeta);
  return getRoutedSection(updatedGuild, sectionName, {});
}

function saveGuildSection(guildId, sectionName, sectionData = {}, guildOrMeta = {}) {
  const current = getGuildSection(guildId, sectionName);
  return replaceGuildSection(
    guildId,
    sectionName,
    {
      ...current,
      ...(isPlainObject(sectionData) ? sectionData : {}),
    },
    guildOrMeta
  );
}

function updateGuildSection(guildId, sectionName, updater, fallback = {}, guildOrMeta = {}) {
  const current = getGuildSection(guildId, sectionName, fallback);
  const next = typeof updater === 'function' ? updater(clone(current)) : updater;
  return replaceGuildSection(guildId, sectionName, isPlainObject(next) ? next : {}, guildOrMeta);
}

function normalizeLogType(type = 'general') {
  const key = String(type || '').trim();
  return LOG_CHANNEL_ALIASES[key] || key || 'general';
}

function getLogChannelId(guildId, type = 'general', fallbackType = 'general') {
  const logs = getGuildSection(guildId, 'logs', DEFAULT_LOGS);
  const requested = String(type || '').trim();
  const logType = normalizeLogType(requested);
  const fallback = normalizeLogType(fallbackType);

  return (
    normalizeChannelId(logs.channels?.[requested]) ||
    normalizeChannelId(logs.channels?.[logType]) ||
    normalizeChannelId(logs.channels?.[fallback]) ||
    normalizeChannelId(logs.channels?.general) ||
    null
  );
}

function setLogChannelId(guildId, type = 'general', channelId = null, guildOrMeta = {}) {
  const logType = normalizeLogType(type);
  const safeChannelId = normalizeChannelId(channelId);
  return updateGuildSection(
    guildId,
    'logs',
    (logs) => ({
      ...logs,
      channels: {
        ...(logs.channels || {}),
        [logType]: safeChannelId,
      },
    }),
    DEFAULT_LOGS,
    guildOrMeta
  );
}

function isLogEventEnabled(guildId, eventName) {
  const logs = getGuildSection(guildId, 'logs', DEFAULT_LOGS);
  if (logs.enabled === false) return false;
  return logs.events?.[eventName] !== false;
}

function setLogEventEnabled(guildId, eventName, enabled = true, guildOrMeta = {}) {
  const key = sanitizeKey(eventName, 'Log event name');
  return updateGuildSection(
    guildId,
    'logs',
    (logs) => ({
      ...logs,
      events: {
        ...(logs.events || {}),
        [key]: Boolean(enabled),
      },
    }),
    DEFAULT_LOGS,
    guildOrMeta
  );
}

function getSecurityConfig(guildId) {
  return getGuildSection(guildId, 'security', DEFAULT_SECURITY);
}

function saveSecurityConfig(guildId, config = {}, guildOrMeta = {}) {
  return saveGuildSection(guildId, 'security', config, guildOrMeta);
}

function updateSecurityConfig(guildId, updater, guildOrMeta = {}) {
  return updateGuildSection(guildId, 'security', updater, DEFAULT_SECURITY, guildOrMeta);
}

function getServerBackupConfig(guildId) {
  return getGuildSection(guildId, 'serverBackups', DEFAULT_SERVER_BACKUPS);
}

function saveServerBackupConfig(guildId, config = {}, guildOrMeta = {}) {
  return saveGuildSection(guildId, 'serverBackups', config, guildOrMeta);
}

function updateServerBackupConfig(guildId, updater, guildOrMeta = {}) {
  return updateGuildSection(guildId, 'serverBackups', updater, DEFAULT_SERVER_BACKUPS, guildOrMeta);
}

function isModuleEnabled(guildId, moduleName) {
  const key = sanitizeKey(moduleName, 'Module name');
  const modules = getGuildSection(guildId, 'modules', {});
  const config = modules[key];
  if (config == null) return true;
  if (typeof config === 'boolean') return config !== false;
  if (isPlainObject(config)) return config.enabled !== false;
  return true;
}

function setModuleEnabled(guildId, moduleName, enabled = true, guildOrMeta = {}) {
  const key = sanitizeKey(moduleName, 'Module name');
  return updateGuildSection(
    guildId,
    'modules',
    (modules) => ({
      ...modules,
      [key]: {
        ...(isPlainObject(modules[key]) ? modules[key] : {}),
        enabled: Boolean(enabled),
      },
    }),
    {},
    guildOrMeta
  );
}

function getEmbedPresets(guildId) {
  return getGuildSection(guildId, 'embedPresets', {});
}

function getEmbedPreset(guildId, presetName) {
  const name = sanitizeKey(presetName, 'Preset name');
  const preset = getEmbedPresets(guildId)[name];
  return isPlainObject(preset) ? clone(preset) : null;
}

function saveEmbedPreset(guildId, presetName, presetData = {}, guildOrMeta = {}) {
  const name = sanitizeKey(presetName, 'Preset name');
  const updatedPresets = updateGuildSection(
    guildId,
    'embedPresets',
    (presets) => ({
      ...presets,
      [name]: {
        ...normalizeEmbed(presetData),
        name,
        updatedAt: now(),
      },
    }),
    {},
    guildOrMeta
  );
  return clone(updatedPresets[name]);
}

function deleteEmbedPreset(guildId, presetName, guildOrMeta = {}) {
  const name = sanitizeKey(presetName, 'Preset name');
  const presets = getEmbedPresets(guildId);
  if (!presets[name]) return false;
  delete presets[name];
  saveGuildSection(guildId, 'embedPresets', presets, guildOrMeta);
  return true;
}

function getEmbedDefaults(guildId) {
  return mergeDeep(DEFAULT_EMBED_DEFAULTS, getGuildSection(guildId, 'embedDefaults', {}));
}

function setEmbedDefault(guildId, templateKey, presetName, guildOrMeta = {}) {
  const key = sanitizeKey(templateKey, 'Template key');
  const name = sanitizeKey(presetName, 'Preset name');
  if (!getEmbedPreset(guildId, name)) throw new Error(`Cannot set default. Preset "${name}" does not exist.`);
  return updateGuildSection(
    guildId,
    'embedDefaults',
    (defaults) => ({ ...mergeDeep(DEFAULT_EMBED_DEFAULTS, defaults), [key]: name }),
    DEFAULT_EMBED_DEFAULTS,
    guildOrMeta
  );
}

function clearEmbedDefault(guildId, templateKey, guildOrMeta = {}) {
  const key = sanitizeKey(templateKey, 'Template key');
  return updateGuildSection(
    guildId,
    'embedDefaults',
    (defaults) => ({ ...mergeDeep(DEFAULT_EMBED_DEFAULTS, defaults), [key]: null }),
    DEFAULT_EMBED_DEFAULTS,
    guildOrMeta
  );
}

function getEmbedDefaultPresetName(guildId, templateKey) {
  const key = sanitizeKey(templateKey, 'Template key');
  return getEmbedDefaults(guildId)[key] || null;
}

function getEmbedDefaultPreset(guildId, templateKey) {
  const presetName = getEmbedDefaultPresetName(guildId, templateKey);
  return presetName ? getEmbedPreset(guildId, presetName) : null;
}

function saveEmbedBuilderDraft(guildId, draft = {}, guildOrMeta = {}) {
  return updateGuildSection(
    guildId,
    'embedBuilder',
    (builder) => ({ ...builder, draft: normalizeEmbed(draft) }),
    { draft: DEFAULT_EMBED, templates: {} },
    guildOrMeta
  );
}

function getEmbedBuilderDraft(guildId) {
  return normalizeEmbed(getGuildSection(guildId, 'embedBuilder', { draft: DEFAULT_EMBED, templates: {} }).draft || {});
}

function saveEmbedTemplate(guildId, templateKey, templateData = {}, guildOrMeta = {}) {
  const key = sanitizeKey(templateKey, 'Template key');
  return updateGuildSection(
    guildId,
    'embedBuilder',
    (builder) => ({
      ...builder,
      templates: {
        ...(builder.templates || {}),
        [key]: normalizeEmbed(templateData),
      },
    }),
    { draft: DEFAULT_EMBED, templates: {} },
    guildOrMeta
  );
}

function getEmbedTemplate(guildId, templateKey) {
  const key = sanitizeKey(templateKey, 'Template key');
  const builder = getGuildSection(guildId, 'embedBuilder', { draft: DEFAULT_EMBED, templates: {} });
  return builder.templates?.[key] ? normalizeEmbed(builder.templates[key]) : null;
}

function reloadGuild(guildId) {
  const safeGuildId = normalizeGuildId(guildId);
  guildCache.delete(safeGuildId);
  return getGuildData(safeGuildId, { forceReload: true });
}

function clearGuildCache(guildId) {
  if (guildId) {
    guildCache.delete(normalizeGuildId(guildId));
    return;
  }
  guildCache.clear();
}

function listGuildFiles() {
  ensureGuildsDir();
  return fs
    .readdirSync(GUILDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{16,20}\.json$/.test(entry.name))
    .map((entry) => path.join(GUILDS_DIR, entry.name));
}

module.exports = {
  GUILDS_DIR,

  DEFAULT_GUILD_DATA,
  DEFAULT_SUBSCRIPTION,
  DEFAULT_LOGS,
  DEFAULT_SECURITY,
  DEFAULT_EMBED,
  DEFAULT_EMBED_DEFAULTS,
  DEFAULT_SERVER_BACKUPS,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_TICKETS,
  DEFAULT_MODULES,

  getGuildFilePath,

  getGuildConfig,
  saveGuildConfig,

  getGuildData,
  saveGuildData,
  syncGuildMeta,

  getGuildSection,
  saveGuildSection,
  replaceGuildSection,
  updateGuildSection,

  getLogChannelId,
  setLogChannelId,
  isLogEventEnabled,
  setLogEventEnabled,

  getSecurityConfig,
  saveSecurityConfig,
  updateSecurityConfig,

  getServerBackupConfig,
  saveServerBackupConfig,
  updateServerBackupConfig,

  isModuleEnabled,
  setModuleEnabled,

  getEmbedPresets,
  getEmbedPreset,
  saveEmbedPreset,
  deleteEmbedPreset,

  getEmbedDefaults,
  setEmbedDefault,
  clearEmbedDefault,
  getEmbedDefaultPresetName,
  getEmbedDefaultPreset,

  saveEmbedBuilderDraft,
  getEmbedBuilderDraft,
  saveEmbedTemplate,
  getEmbedTemplate,

  reloadGuild,
  clearGuildCache,

  listGuildFiles,
};
