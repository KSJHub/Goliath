'use strict';

// src/modules/embed/embedSocketEvents.js

const EVENTS = Object.freeze({
  EMBED_CREATED: 'embed_created',
  EMBED_UPDATED: 'embed_updated',
  EMBED_DELETED: 'embed_deleted',
  EMBED_STATUS_UPDATED: 'embed_status_updated',
});

const STANDARD_EVENTS = Object.freeze({
  embed_created: 'embed.created',
  embed_updated: 'embed.updated',
  embed_deleted: 'embed.deleted',
  embed_status_updated: 'embed.status.updated',
});

let socketProvider = null;

function now() {
  return new Date().toISOString();
}

function setSocketProvider(provider) {
  socketProvider = provider;
}

function getSocketServer() {
  if (!socketProvider) return null;

  try {
    return typeof socketProvider === 'function'
      ? socketProvider()
      : socketProvider;
  } catch {
    return null;
  }
}

function getRoomName(guildId) {
  return `guild:${guildId}`;
}

function getStandardEvent(event) {
  return STANDARD_EVENTS[event] || event;
}

function createPayload(type, guildId, data = {}) {
  const event = getStandardEvent(type);

  return {
    type,
    event,
    guildId: String(guildId),
    timestamp: now(),
    updatedAt: now(),
    data,
  };
}

function emitToTargets(io, guildId, legacyEvent, standardEvent, payload) {
  const guildRoom = getRoomName(guildId);
  const emitNames = [legacyEvent, standardEvent].filter(
    (eventName, index, list) => eventName && list.indexOf(eventName) === index
  );

  for (const eventName of emitNames) {
    io.to(guildRoom).emit(eventName, payload);
  }

  io.to(guildRoom).emit('guild:update', payload);
  io.to(guildRoom).emit('goliath_realtime_event', payload);
}

function emit(event, guildId, data = {}) {
  const payload = createPayload(event, guildId, data);
  const io = getSocketServer();

  if (!io) return payload;

  try {
    emitToTargets(io, guildId, event, payload.event, payload);
  } catch (error) {
    console.error('[EmbedSockets] Failed to emit event:', event, error);
  }

  return payload;
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

module.exports = {
  EVENTS,
  STANDARD_EVENTS,

  setSocketProvider,
  getSocketServer,

  emit,
  emitEmbedUpdated,
  emitEmbedStatusUpdated,
  emitEmbedDeleted,
};