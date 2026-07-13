'use strict';

const guildManager = require('../../core/guild/guildManager');
const {
  emitEmbedUpdated,
  emitEmbedStatusUpdated,
  emitEmbedDeleted,
} = require('./embedSocketEvents');

const EMBED_DEPLOYMENTS_SECTION = 'embedBuilder.deployments';
const DEPLOYMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  NOT_DEPLOYED: 'not_deployed',
  MISSING_MESSAGE: 'missing_message',
  MISSING_CHANNEL: 'missing_channel',
  PERMISSION_ERROR: 'permission_error',
  UNKNOWN: 'unknown',
});

const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value || {}));
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanString = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);
const cleanDiscordId = (value) => {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const cleanKey = (value) => cleanString(value || 'custom', 100) || 'custom';
const comparable = (value) => cleanKey(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function refreshGuild(guildId) {
  if (typeof guildManager.reloadGuild === 'function') guildManager.reloadGuild(guildId);
}

function normalizeDeployment(key, deployment = {}) {
  const source = isPlainObject(deployment) ? deployment : {};
  const createdAt = source.createdAt || source.lastUpdatedAt || now();
  return {
    key: cleanKey(source.key || key),
    guildId: cleanDiscordId(source.guildId),
    channelId: cleanDiscordId(source.channelId),
    messageId: cleanDiscordId(source.messageId),
    template: cleanString(source.template || 'custom', 80) || 'custom',
    preset: cleanString(source.preset || source.presetName || key, 100) || key,
    status: Object.values(DEPLOYMENT_STATUS).includes(source.status)
      ? source.status
      : DEPLOYMENT_STATUS.ACTIVE,
    createdAt,
    createdBy: cleanDiscordId(source.createdBy),
    lastUpdatedAt: source.lastUpdatedAt || createdAt,
    lastUpdatedBy: cleanDiscordId(source.lastUpdatedBy || source.updatedBy || source.createdBy),
    lastCheckedAt: source.lastCheckedAt || null,
    missingReason: cleanString(source.missingReason || '', 500) || null,
  };
}

function getEmbedBuilderSection(guildId) {
  refreshGuild(guildId);
  return guildManager.getGuildSection(guildId, 'embedBuilder', {
    draft: {},
    templates: {},
    deployments: {},
  });
}

function getAllEmbedDeployments(guildId) {
  const deployments = clone(getEmbedBuilderSection(guildId).deployments || {});
  return Object.fromEntries(
    Object.entries(deployments)
      .filter(([, deployment]) => isPlainObject(deployment))
      .map(([key, deployment]) => [key, normalizeDeployment(key, deployment)])
  );
}

function findMatchingDeployment(deployments, key) {
  const safeKey = cleanKey(key);
  if (deployments[safeKey]) return deployments[safeKey];

  const target = comparable(safeKey);
  const templateTarget = comparable(safeKey.replace(/^auto[-_:]?/i, ''));
  const matches = Object.values(deployments).filter(Boolean);

  return matches.find((deployment) => {
    const values = [deployment.key, deployment.preset, deployment.template];
    return values.some((value) => {
      const normalized = comparable(value);
      return normalized === target || normalized === templateTarget || `auto${normalized}` === target;
    });
  }) || null;
}

function getEmbedDeployment(guildId, key) {
  return findMatchingDeployment(getAllEmbedDeployments(guildId), key);
}

function saveDeployments(guildId, deployments) {
  if (typeof guildManager.saveGuildSection !== 'function') return null;
  const current = getEmbedBuilderSection(guildId);
  const next = { ...current, deployments: clone(deployments), updatedAt: now() };
  guildManager.saveGuildSection(guildId, 'embedBuilder', next);
  refreshGuild(guildId);
  return next.deployments;
}

function saveEmbedDeployment(guildId, key, deployment) {
  const safeKey = cleanKey(key);
  const deployments = getAllEmbedDeployments(guildId);
  const previous = deployments[safeKey] || {};
  const timestamp = now();
  deployments[safeKey] = normalizeDeployment(safeKey, {
    ...previous,
    ...deployment,
    guildId,
    key: safeKey,
    createdAt: previous.createdAt || deployment.createdAt || timestamp,
    lastUpdatedAt: timestamp,
    status: deployment.status || DEPLOYMENT_STATUS.ACTIVE,
  });
  const saved = saveDeployments(guildId, deployments);
  const result = saved ? deployments[safeKey] : null;
  if (result) emitEmbedUpdated(guildId, result);
  return result;
}

function markEmbedDeploymentStatus(guildId, key, status, meta = {}) {
  const deployments = getAllEmbedDeployments(guildId);
  const existing = findMatchingDeployment(deployments, key);
  if (!existing) return null;
  const safeKey = existing.key;
  deployments[safeKey] = normalizeDeployment(safeKey, {
    ...existing,
    ...meta,
    status,
    lastCheckedAt: now(),
    missingReason: meta.missingReason === null ? null : (meta.missingReason || existing.missingReason),
  });
  const saved = saveDeployments(guildId, deployments);
  const result = saved ? deployments[safeKey] : null;
  if (result) emitEmbedStatusUpdated(guildId, result);
  return result;
}

function deleteEmbedDeployment(guildId, key) {
  const deployments = getAllEmbedDeployments(guildId);
  const existing = findMatchingDeployment(deployments, key);
  if (!existing) return false;
  delete deployments[existing.key];
  const deleted = Boolean(saveDeployments(guildId, deployments));
  if (deleted) emitEmbedDeleted(guildId, existing.key);
  return deleted;
}

function getDeploymentKeyFromState(state = {}) {
  const template = cleanKey(state.template || 'custom');
  return cleanKey(`auto-${template}`);
}

async function resolveEmbedDeployment(guild, key) {
  if (!guild?.id) {
    return { status: DEPLOYMENT_STATUS.UNKNOWN, deployment: null, channel: null, message: null, reason: 'Guild unavailable.' };
  }

  const deployment = getEmbedDeployment(guild.id, key);
  if (!deployment) {
    return { status: DEPLOYMENT_STATUS.NOT_DEPLOYED, deployment: null, channel: null, message: null, reason: 'No deployment record exists.' };
  }

  const channel = guild.channels.cache.get(deployment.channelId)
    || await guild.channels.fetch(deployment.channelId).catch(() => null);
  if (!channel) {
    const updated = markEmbedDeploymentStatus(guild.id, deployment.key, DEPLOYMENT_STATUS.MISSING_CHANNEL, {
      missingReason: 'Deployment channel could not be found.',
    });
    return { status: DEPLOYMENT_STATUS.MISSING_CHANNEL, deployment: updated || deployment, channel: null, message: null, reason: 'Deployment channel could not be found.' };
  }

  const message = await channel.messages?.fetch(deployment.messageId).catch((error) => (
    error?.code === 50013 ? { __permissionError: true } : null
  ));

  if (message?.__permissionError) {
    const updated = markEmbedDeploymentStatus(guild.id, deployment.key, DEPLOYMENT_STATUS.PERMISSION_ERROR, {
      missingReason: 'Goliath cannot access the deployment message.',
    });
    return { status: DEPLOYMENT_STATUS.PERMISSION_ERROR, deployment: updated || deployment, channel, message: null, reason: 'Goliath cannot access the deployment message.' };
  }

  if (!message) {
    const updated = markEmbedDeploymentStatus(guild.id, deployment.key, DEPLOYMENT_STATUS.MISSING_MESSAGE, {
      missingReason: 'Deployment message could not be found.',
    });
    return { status: DEPLOYMENT_STATUS.MISSING_MESSAGE, deployment: updated || deployment, channel, message: null, reason: 'Deployment message could not be found.' };
  }

  const updated = deployment.status === DEPLOYMENT_STATUS.ACTIVE
    ? deployment
    : markEmbedDeploymentStatus(guild.id, deployment.key, DEPLOYMENT_STATUS.ACTIVE, { missingReason: null });
  return { status: DEPLOYMENT_STATUS.ACTIVE, deployment: updated || deployment, channel, message, reason: null };
}

module.exports = {
  EMBED_DEPLOYMENTS_SECTION,
  DEPLOYMENT_STATUS,
  getAllEmbedDeployments,
  getEmbedDeployment,
  saveEmbedDeployment,
  markEmbedDeploymentStatus,
  deleteEmbedDeployment,
  getDeploymentKeyFromState,
  resolveEmbedDeployment,
};
