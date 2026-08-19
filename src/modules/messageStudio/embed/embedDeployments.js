'use strict';

const guildManager = require('../../../core/guild/guildManager');
const { emitGuildUpdate } = require('../../../server/sockets/socketHub');

const EVENTS = Object.freeze({
  EMBED_CREATED: 'embed.created',
  EMBED_UPDATED: 'embed.updated',
  EMBED_DELETED: 'embed.deleted',
  EMBED_STATUS_UPDATED: 'embed.status.updated',
});

const EMBED_DEPLOYMENTS_SECTION = 'embedDeployments';
const LEGACY_EMBED_BUILDER_SECTION = 'embedBuilder';
const DEPLOYMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  NOT_DEPLOYED: 'not_deployed',
  MISSING_MESSAGE: 'missing_message',
  MISSING_CHANNEL: 'missing_channel',
  PERMISSION_ERROR: 'permission_error',
  UNKNOWN: 'unknown',
});

const VALID_STATUSES = new Set(Object.values(DEPLOYMENT_STATUS));
const EMBED_BUTTON_ACTIONS = Object.freeze(['reply', 'toggle-role', 'add-role', 'remove-role', 'user-info', 'server-info']);
const EMBED_ROLE_BUTTON_ACTIONS = new Set(['toggle-role', 'add-role', 'remove-role']);
const now = () => new Date().toISOString();
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function createTrackingPayload(event, guildId, data = {}) {
  const timestamp = now();
  return {
    module: 'embeds',
    event,
    guildId: String(guildId),
    timestamp,
    updatedAt: timestamp,
    data,
  };
}

function emit(event, guildId, data = {}) {
  const payload = createTrackingPayload(event, guildId, data);
  return emitGuildUpdate(guildId, payload) || payload;
}

function deploymentPayload(deployment = {}) {
  return {
    key: deployment.key || null,
    channelId: deployment.channelId || null,
    messageId: deployment.messageId || null,
    template: deployment.template || null,
    preset: deployment.preset || null,
    status: deployment.status || null,
    createdAt: deployment.createdAt || null,
    createdBy: deployment.createdBy || null,
    lastUpdatedAt: deployment.lastUpdatedAt || null,
    lastUpdatedBy: deployment.lastUpdatedBy || null,
    lastCheckedAt: deployment.lastCheckedAt || null,
    missingReason: deployment.missingReason || null,
  };
}

function emitEmbedUpdated(guildId, deployment) {
  return emit(EVENTS.EMBED_UPDATED, guildId, deploymentPayload(deployment));
}

function emitEmbedStatusUpdated(guildId, deployment) {
  return emit(EVENTS.EMBED_STATUS_UPDATED, guildId, deploymentPayload(deployment));
}

function emitEmbedDeleted(guildId, key) {
  return emit(EVENTS.EMBED_DELETED, guildId, { key });
}

function clone(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch {
    return clone(fallback, {});
  }
}

function cleanString(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEmbedButtonAction(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-');
}

function parseEmbedButtonActionIndex(customId) {
  const id = String(customId || '');
  let match = id.match(/^embed:action:(\d+)$/);
  if (match) return Number(match[1]);
  match = id.match(/^embed-action:.*:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function legacyEmbedButtonActionFromId(customId) {
  const match = String(customId || '').match(/^embed-action:(.*):(\d+)$/);
  return match ? normalizeEmbedButtonAction(match[1]) : '';
}

async function applyEmbedRoleMutation(member, role, action, actorLabel) {
  const roleId = role.id;
  if (action === 'add-role') {
    if (member.roles.cache.has(roleId)) return { outcome: 'already-has-role' };
    await member.roles.add(role, `Embed Studio button used by ${actorLabel}`);
    return { outcome: 'added' };
  }
  if (action === 'remove-role') {
    if (!member.roles.cache.has(roleId)) return { outcome: 'missing-role' };
    await member.roles.remove(role, `Embed Studio button used by ${actorLabel}`);
    return { outcome: 'removed' };
  }
  const hasRole = member.roles.cache.has(roleId);
  if (hasRole) await member.roles.remove(role, `Embed Studio role toggle used by ${actorLabel}`);
  else await member.roles.add(role, `Embed Studio role toggle used by ${actorLabel}`);
  return { outcome: hasRole ? 'removed' : 'added' };
}

function requireGuildId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

function cleanDiscordId(value) {
  const id = String(value ?? '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function requireDeploymentKey(value) {
  const key = cleanString(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!key) throw new Error('Invalid deployment key.');
  return key;
}

function comparable(value) {
  return requireDeploymentKey(value).replace(/[^a-z0-9]/g, '');
}

function safeDate(value, fallback = null) {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function refreshGuild(guildId) {
  if (typeof guildManager.reloadGuild === 'function') guildManager.reloadGuild(guildId);
}

function normalizeDeployment(key, deployment = {}, expectedGuildId = null) {
  const source = isPlainObject(deployment) ? deployment : {};
  const safeKey = requireDeploymentKey(source.key || key);
  const guildId = cleanDiscordId(source.guildId) || cleanDiscordId(expectedGuildId);
  const createdAt = safeDate(source.createdAt || source.lastUpdatedAt, now());

  return {
    key: safeKey,
    guildId,
    channelId: cleanDiscordId(source.channelId),
    messageId: cleanDiscordId(source.messageId),
    template: requireDeploymentKey(source.template || 'custom'),
    preset: cleanString(source.preset || source.presetName || safeKey, 100) || safeKey,
    status: VALID_STATUSES.has(source.status) ? source.status : DEPLOYMENT_STATUS.UNKNOWN,
    createdAt,
    createdBy: cleanDiscordId(source.createdBy),
    lastUpdatedAt: safeDate(source.lastUpdatedAt, createdAt),
    lastUpdatedBy: cleanDiscordId(source.lastUpdatedBy || source.updatedBy || source.createdBy),
    lastCheckedAt: safeDate(source.lastCheckedAt, null),
    missingReason: cleanString(source.missingReason, 500) || null,
  };
}

function readLegacyDeployments(guildId) {
  const legacy = guildManager.getGuildSection(guildId, LEGACY_EMBED_BUILDER_SECTION, {});
  return isPlainObject(legacy?.deployments) ? legacy.deployments : {};
}

function getDeploymentSection(guildId) {
  const safeGuildId = requireGuildId(guildId);
  refreshGuild(safeGuildId);

  const section = guildManager.getGuildSection(safeGuildId, EMBED_DEPLOYMENTS_SECTION, {
    deployments: {},
  });
  const safeSection = isPlainObject(section) ? section : { deployments: {} };
  const current = isPlainObject(safeSection.deployments) ? safeSection.deployments : {};
  if (Object.keys(current).length) return { ...safeSection, deployments: current };

  const legacy = readLegacyDeployments(safeGuildId);
  if (!Object.keys(legacy).length) return { ...safeSection, deployments: {} };

  const migratedDeployments = {};
  for (const [key, value] of Object.entries(legacy)) {
    try {
      if (!isPlainObject(value)) continue;
      const normalized = normalizeDeployment(key, value, safeGuildId);
      if (!normalized.channelId || !normalized.messageId) continue;
      migratedDeployments[normalized.key] = normalized;
    } catch (error) {
      console.warn(`[Embed Deployments] Skipped malformed legacy deployment ${key}:`, error.message);
    }
  }

  const migrated = {
    deployments: migratedDeployments,
    migratedAt: now(),
    updatedAt: now(),
  };
  guildManager.saveGuildSection(safeGuildId, EMBED_DEPLOYMENTS_SECTION, migrated);
  refreshGuild(safeGuildId);
  return migrated;
}

function getAllEmbedDeployments(guildId) {
  const safeGuildId = requireGuildId(guildId);
  const deployments = clone(getDeploymentSection(safeGuildId).deployments, {});
  const normalized = {};

  for (const [key, deployment] of Object.entries(deployments)) {
    try {
      if (!isPlainObject(deployment)) continue;
      const result = normalizeDeployment(key, deployment, safeGuildId);
      if (result.guildId && result.guildId !== safeGuildId) continue;
      normalized[result.key] = { ...result, guildId: safeGuildId };
    } catch (error) {
      console.warn(`[Embed Deployments] Skipped malformed deployment ${key}:`, error.message);
    }
  }

  return normalized;
}

function findMatchingDeployment(deployments, key) {
  const safeKey = requireDeploymentKey(key);
  if (deployments[safeKey]) return deployments[safeKey];

  const target = comparable(safeKey);
  const aliases = Object.values(deployments).filter((deployment) => {
    if (!deployment) return false;
    return [deployment.key, deployment.preset, deployment.template]
      .filter(Boolean)
      .some((value) => {
        try {
          const normalized = comparable(value);
          return normalized === target || `auto${normalized}` === target || normalized === target.replace(/^auto/, '');
        } catch {
          return false;
        }
      });
  });

  return aliases.length === 1 ? aliases[0] : null;
}

function getEmbedDeployment(guildId, key) {
  return findMatchingDeployment(getAllEmbedDeployments(guildId), key);
}

function getEmbedDeploymentByMessage(guildId, messageId) {
  const safeGuildId = requireGuildId(guildId);
  const safeMessageId = cleanDiscordId(messageId);
  if (!safeMessageId) return null;
  return Object.values(getAllEmbedDeployments(safeGuildId)).find(
    (deployment) => String(deployment?.messageId || '') === safeMessageId,
  ) || null;
}

function getEmbedPresetForDeployment(guildId, deployment) {
  const safeGuildId = requireGuildId(guildId);
  if (!deployment) return null;
  const presets = typeof guildManager.getEmbedPresets === 'function'
    ? guildManager.getEmbedPresets(safeGuildId) || {}
    : {};
  return presets[deployment.preset] || presets[deployment.key] || null;
}

function getEmbedButtonsForPreset(preset) {
  if (!preset || typeof preset !== 'object') return [];
  if (Array.isArray(preset.buttons) && preset.buttons.length) return preset.buttons;
  const panels = Array.isArray(preset.panels) ? preset.panels : [];
  const selectedPanelIndex = Number.isInteger(preset.selectedPanelIndex) ? preset.selectedPanelIndex : null;
  if (selectedPanelIndex != null && Array.isArray(panels[selectedPanelIndex]?.buttons)) {
    return panels[selectedPanelIndex].buttons;
  }
  const panelsWithButtons = panels.filter((entry) => Array.isArray(entry?.buttons) && entry.buttons.length);
  if (panelsWithButtons.length === 1) return panelsWithButtons[0].buttons;
  if (Array.isArray(panels[0]?.buttons)) return panels[0].buttons;
  return [];
}

function resolveEmbedButtonDeployment(guildId, messageId) {
  const deployment = getEmbedDeploymentByMessage(guildId, messageId);
  const preset = getEmbedPresetForDeployment(guildId, deployment);
  return {
    deployment,
    preset,
    buttons: getEmbedButtonsForPreset(preset),
  };
}

function saveDeployments(guildId, deployments) {
  const safeGuildId = requireGuildId(guildId);
  if (typeof guildManager.saveGuildSection !== 'function') {
    throw new Error('Guild deployment storage is unavailable.');
  }

  const normalized = {};
  for (const [key, deployment] of Object.entries(isPlainObject(deployments) ? deployments : {})) {
    const item = normalizeDeployment(key, deployment, safeGuildId);
    if (item.guildId && item.guildId !== safeGuildId) throw new Error('Deployment belongs to another guild.');
    normalized[item.key] = { ...item, guildId: safeGuildId };
  }

  const current = getDeploymentSection(safeGuildId);
  const next = { ...current, deployments: normalized, updatedAt: now() };
  guildManager.saveGuildSection(safeGuildId, EMBED_DEPLOYMENTS_SECTION, next);
  refreshGuild(safeGuildId);

  const persisted = guildManager.getGuildSection(safeGuildId, EMBED_DEPLOYMENTS_SECTION, {});
  if (!isPlainObject(persisted?.deployments)) throw new Error('Embed deployment storage did not persist.');
  return clone(persisted.deployments, {});
}

function saveEmbedDeployment(guildId, key, deployment = {}) {
  const safeGuildId = requireGuildId(guildId);
  const safeKey = requireDeploymentKey(key);
  if (!isPlainObject(deployment)) throw new Error('Invalid deployment payload.');

  const channelId = cleanDiscordId(deployment.channelId);
  const messageId = cleanDiscordId(deployment.messageId);
  if (!channelId || !messageId) throw new Error('A valid deployment channel and message are required.');

  const deployments = getAllEmbedDeployments(safeGuildId);
  const previous = deployments[safeKey] || {};
  const timestamp = now();
  deployments[safeKey] = normalizeDeployment(safeKey, {
    ...previous,
    ...deployment,
    guildId: safeGuildId,
    channelId,
    messageId,
    key: safeKey,
    createdAt: previous.createdAt || deployment.createdAt || timestamp,
    lastUpdatedAt: timestamp,
    status: deployment.status || DEPLOYMENT_STATUS.ACTIVE,
    missingReason: deployment.missingReason ?? null,
  }, safeGuildId);

  const saved = saveDeployments(safeGuildId, deployments);
  const result = normalizeDeployment(safeKey, saved[safeKey], safeGuildId);
  emitEmbedUpdated(safeGuildId, result);
  return result;
}

function markEmbedDeploymentStatus(guildId, key, status, meta = {}) {
  const safeGuildId = requireGuildId(guildId);
  if (!VALID_STATUSES.has(status)) throw new Error('Invalid deployment status.');

  const deployments = getAllEmbedDeployments(safeGuildId);
  const existing = findMatchingDeployment(deployments, key);
  if (!existing) return null;

  const safeKey = existing.key;
  deployments[safeKey] = normalizeDeployment(safeKey, {
    ...existing,
    ...(isPlainObject(meta) ? meta : {}),
    guildId: safeGuildId,
    status,
    lastCheckedAt: now(),
    lastUpdatedAt: now(),
    missingReason: meta.missingReason === null
      ? null
      : cleanString(meta.missingReason || existing.missingReason, 500) || null,
  }, safeGuildId);

  const saved = saveDeployments(safeGuildId, deployments);
  const result = normalizeDeployment(safeKey, saved[safeKey], safeGuildId);
  emitEmbedStatusUpdated(safeGuildId, result);
  return result;
}

function deleteEmbedDeployment(guildId, key) {
  const safeGuildId = requireGuildId(guildId);
  const deployments = getAllEmbedDeployments(safeGuildId);
  const existing = findMatchingDeployment(deployments, key);
  if (!existing) return false;

  delete deployments[existing.key];
  saveDeployments(safeGuildId, deployments);
  emitEmbedDeleted(safeGuildId, existing.key);
  return true;
}

function getDeploymentKeyFromState(state = {}) {
  const template = requireDeploymentKey(state.template || 'custom');
  return requireDeploymentKey(`auto-${template}`);
}

async function resolveEmbedDeployment(guild, key) {
  if (!guild?.id) {
    return { status: DEPLOYMENT_STATUS.UNKNOWN, deployment: null, channel: null, message: null, reason: 'Guild unavailable.' };
  }

  let guildId;
  try {
    guildId = requireGuildId(guild.id);
  } catch {
    return { status: DEPLOYMENT_STATUS.UNKNOWN, deployment: null, channel: null, message: null, reason: 'Invalid guild.' };
  }

  const deployment = getEmbedDeployment(guildId, key);
  if (!deployment) {
    return { status: DEPLOYMENT_STATUS.NOT_DEPLOYED, deployment: null, channel: null, message: null, reason: 'No unique deployment record exists.' };
  }

  if (!deployment.channelId || !deployment.messageId) {
    const updated = markEmbedDeploymentStatus(guildId, deployment.key, DEPLOYMENT_STATUS.UNKNOWN, {
      missingReason: 'Deployment record is incomplete.',
    });
    return { status: DEPLOYMENT_STATUS.UNKNOWN, deployment: updated || deployment, channel: null, message: null, reason: 'Deployment record is incomplete.' };
  }

  let channel;
  try {
    channel = guild.channels.cache.get(deployment.channelId) || await guild.channels.fetch(deployment.channelId);
  } catch (error) {
    const permissionError = error?.code === 50013;
    const status = permissionError ? DEPLOYMENT_STATUS.PERMISSION_ERROR : DEPLOYMENT_STATUS.MISSING_CHANNEL;
    const reason = permissionError ? 'Goliath cannot access the deployment channel.' : 'Deployment channel could not be found.';
    const updated = markEmbedDeploymentStatus(guildId, deployment.key, status, { missingReason: reason });
    return { status, deployment: updated || deployment, channel: null, message: null, reason };
  }

  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    const reason = 'Deployment channel is not a supported text channel.';
    const updated = markEmbedDeploymentStatus(guildId, deployment.key, DEPLOYMENT_STATUS.MISSING_CHANNEL, { missingReason: reason });
    return { status: DEPLOYMENT_STATUS.MISSING_CHANNEL, deployment: updated || deployment, channel, message: null, reason };
  }

  let message;
  try {
    message = await channel.messages.fetch(deployment.messageId);
  } catch (error) {
    const permissionError = error?.code === 50013;
    const status = permissionError ? DEPLOYMENT_STATUS.PERMISSION_ERROR : DEPLOYMENT_STATUS.MISSING_MESSAGE;
    const reason = permissionError ? 'Goliath cannot access the deployment message.' : 'Deployment message could not be found.';
    const updated = markEmbedDeploymentStatus(guildId, deployment.key, status, { missingReason: reason });
    return { status, deployment: updated || deployment, channel, message: null, reason };
  }

  if (!message || message.guildId !== guildId || message.channelId !== deployment.channelId) {
    const reason = 'Deployment message does not match the stored guild or channel.';
    const updated = markEmbedDeploymentStatus(guildId, deployment.key, DEPLOYMENT_STATUS.MISSING_MESSAGE, { missingReason: reason });
    return { status: DEPLOYMENT_STATUS.MISSING_MESSAGE, deployment: updated || deployment, channel, message: null, reason };
  }

  const updated = deployment.status === DEPLOYMENT_STATUS.ACTIVE && !deployment.missingReason
    ? deployment
    : markEmbedDeploymentStatus(guildId, deployment.key, DEPLOYMENT_STATUS.ACTIVE, { missingReason: null });

  return { status: DEPLOYMENT_STATUS.ACTIVE, deployment: updated || deployment, channel, message, reason: null };
}

module.exports = {
  EVENTS,
  emit,
  emitEmbedUpdated,
  emitEmbedStatusUpdated,
  emitEmbedDeleted,
  EMBED_DEPLOYMENTS_SECTION,
  DEPLOYMENT_STATUS,
  EMBED_BUTTON_ACTIONS,
  EMBED_ROLE_BUTTON_ACTIONS,
  normalizeEmbedButtonAction,
  parseEmbedButtonActionIndex,
  legacyEmbedButtonActionFromId,
  applyEmbedRoleMutation,
  getAllEmbedDeployments,
  getEmbedDeployment,
  getEmbedDeploymentByMessage,
  getEmbedPresetForDeployment,
  getEmbedButtonsForPreset,
  resolveEmbedButtonDeployment,
  saveEmbedDeployment,
  markEmbedDeploymentStatus,
  deleteEmbedDeployment,
  getDeploymentKeyFromState,
  resolveEmbedDeployment,
};
