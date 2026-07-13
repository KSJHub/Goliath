'use strict';

// functions/embed/embedDeploymentStore.js

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

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanKey(value) {
  return cleanString(value || 'custom', 100) || 'custom';
}

function refreshGuild(guildId) {
  if (typeof guildManager.reloadGuild === 'function') {
    guildManager.reloadGuild(guildId);
  }
}

function normalizeDeployment(key, deployment = {}) {
  const source = isPlainObject(deployment) ? deployment : {};
  const createdAt = source.createdAt || source.lastUpdatedAt || now();
  const lastUpdatedAt = source.lastUpdatedAt || createdAt;

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
    lastUpdatedAt,
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
  const builder = getEmbedBuilderSection(guildId);
  const deployments = clone(builder.deployments || {});

  return Object.fromEntries(
    Object.entries(deployments)
      .filter(([, deployment]) => isPlainObject(deployment))
      .map(([key, deployment]) => [key, normalizeDeployment(key, deployment)])
  );
}

function getEmbedDeployment(guildId, key) {
  const deployments = getAllEmbedDeployments(guildId);
  return deployments[cleanKey(key)] || null;
}

function saveDeployments(guildId, deployments) {
  if (typeof guildManager.saveGuildSection !== 'function') return null;

  const currentBuilder = getEmbedBuilderSection(guildId);
  const nextBuilder = {
    ...currentBuilder,
    deployments: clone(deployments),
    updatedAt: now(),
  };

  guildManager.saveGuildSection(guildId, 'embedBuilder', nextBuilder);
  refreshGuild(guildId);
  return nextBuilder.deployments;
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

  if (result) {
    emitEmbedUpdated(guildId, result);
  }

  return result;
}

function markEmbedDeploymentStatus(guildId, key, status, meta = {}) {
  const safeKey = cleanKey(key);
  const deployments = getAllEmbedDeployments(guildId);

  if (!deployments[safeKey]) return null;

  deployments[safeKey] = normalizeDeployment(safeKey, {
    ...deployments[safeKey],
    ...meta,
    status,
    lastCheckedAt: now(),
    missingReason: meta.missingReason || deployments[safeKey].missingReason,
  });

  const saved = saveDeployments(guildId, deployments);
  const result = saved ? deployments[safeKey] : null;

  if (result) {
    emitEmbedStatusUpdated(guildId, result);
  }

  return result;
}

function deleteEmbedDeployment(guildId, key) {
  const safeKey = cleanKey(key);
  const deployments = getAllEmbedDeployments(guildId);

  if (!deployments[safeKey]) return false;

  delete deployments[safeKey];
  const deleted = Boolean(saveDeployments(guildId, deployments));

  if (deleted) {
    emitEmbedDeleted(guildId, safeKey);
  }

  return deleted;
}

function getDeploymentKeyFromState(state = {}) {
  return cleanKey(state.selectedPreset || `auto-${state.template || 'custom'}`);
}

async function resolveEmbedDeployment(guild, key) {
  if (!guild?.id) {
    return {
      status: DEPLOYMENT_STATUS.UNKNOWN,
      deployment: null,
      channel: null,
      message: null,
      reason: 'Guild unavailable.',
    };
  }

  const deployment = getEmbedDeployment(guild.id, key);

  if (!deployment) {
    return {
      status: DEPLOYMENT_STATUS.NOT_DEPLOYED,
      deployment: null,
      channel: null,
      message: null,
      reason: 'No deployment record exists.',
    };
  }

  const channel = guild.channels.cache.get(deployment.channelId) ||
    await guild.channels.fetch(deployment.channelId).catch(() => null);

  if (!channel) {
    const updated = markEmbedDeploymentStatus(
      guild.id,
      key,
      DEPLOYMENT_STATUS.MISSING_CHANNEL,
      { missingReason: 'Deployment channel could not be found.' }
    );

    return {
      status: DEPLOYMENT_STATUS.MISSING_CHANNEL,
      deployment: updated || deployment,
      channel: null,
      message: null,
      reason: 'Deployment channel could not be found.',
    };
  }

  const message = await channel.messages?.fetch(deployment.messageId).catch((error) => {
    if (error?.code === 50013) {
      return { __permissionError: true };
    }
    return null;
  });

  if (message?.__permissionError) {
    const updated = markEmbedDeploymentStatus(
      guild.id,
      key,
      DEPLOYMENT_STATUS.PERMISSION_ERROR,
      { missingReason: 'Goliath cannot access the deployment message.' }
    );

    return {
      status: DEPLOYMENT_STATUS.PERMISSION_ERROR,
      deployment: updated || deployment,
      channel,
      message: null,
      reason: 'Goliath cannot access the deployment message.',
    };
  }

  if (!message) {
    const updated = markEmbedDeploymentStatus(
      guild.id,
      key,
      DEPLOYMENT_STATUS.MISSING_MESSAGE,
      { missingReason: 'Deployment message could not be found.' }
    );

    return {
      status: DEPLOYMENT_STATUS.MISSING_MESSAGE,
      deployment: updated || deployment,
      channel,
      message: null,
      reason: 'Deployment message could not be found.',
    };
  }

  const updated = deployment.status === DEPLOYMENT_STATUS.ACTIVE
    ? deployment
    : markEmbedDeploymentStatus(guild.id, key, DEPLOYMENT_STATUS.ACTIVE, { missingReason: null });

  return {
    status: DEPLOYMENT_STATUS.ACTIVE,
    deployment: updated || deployment,
    channel,
    message,
    reason: null,
  };
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