'use strict';

const timelineStore = require('./timelineStore');
const { isModuleEnabled } = require('../../core/guild/guildManager');

const TYPES = {
  SYSTEM: 'system',
  ADMIN: 'admin',
  MODERATION: 'moderation',
  AUTOMOD: 'automod',
  TICKET: 'ticket',
  ROLE: 'role',
  STICKY: 'sticky',
  SUGGESTION: 'suggestion',
  SECURITY: 'security',
  EMBED: 'embed',
};

const MAX_META_JSON_LENGTH = 8000;

function isDev(client) {
  return String(client?.botMode || process.env.BOT_MODE || '').toUpperCase() === 'DEV';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidGuildId(guildId) {
  return /^\d{15,25}$/.test(String(guildId || '').trim());
}

function timelineEnabled(guildId) {
  if (!isValidGuildId(guildId)) return false;
  try {
    return isModuleEnabled(guildId, 'timeline') === true;
  } catch (error) {
    console.warn(`[Timeline] Failed to resolve module state for guild ${guildId}: ${error?.message || error}`);
    return false;
  }
}

function reportTimelineError(operation, guildId, error, client) {
  const message = error?.stack || error?.message || error;
  console.error(`[Timeline] ${operation} failed for guild ${guildId}:`, message);
  if (isDev(client) && error?.cause) console.error(error.cause);
}

function getActorInfo(actor) {
  if (!actor) {
    return {
      actorId: null,
      actorTag: null,
    };
  }

  return {
    actorId: actor.id || actor.user?.id || null,
    actorTag:
      actor.tag ||
      actor.user?.tag ||
      actor.displayName ||
      actor.username ||
      null,
  };
}

function cleanText(value, fallback, maxLength) {
  const text = String(value || fallback || '').trim();
  return text.slice(0, maxLength);
}

function sanitizeMeta(meta = {}) {
  if (!isPlainObject(meta)) return {};

  try {
    const json = JSON.stringify(meta);
    if (!json || json.length > MAX_META_JSON_LENGTH) return {};
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function createTimelineEvent(guildId, input = {}, client) {
  if (!timelineEnabled(guildId)) return null;

  try {
    const actor = getActorInfo(input.actor);

    const event = timelineStore.addTimelineEvent(
      guildId,
      {
        type: cleanText(input.type, TYPES.SYSTEM, 40),
        title: cleanText(input.title, 'Timeline Event', 120),
        description: input.description
          ? cleanText(input.description, null, 500)
          : null,
        actorId: input.actorId || actor.actorId,
        actorTag: input.actorTag || actor.actorTag,
        channelId: input.channelId || input.channel?.id || null,
        targetId: input.targetId || input.target?.id || null,
        meta: sanitizeMeta(input.meta),
      },
      client
    );

    if (event && isDev(client)) {
      console.log(`[Timeline] ${event.type}: ${event.title} (${guildId})`);
    }

    return event;
  } catch (error) {
    reportTimelineError('create event', guildId, error, client);
    return null;
  }
}

function listTimeline(guildId, options = {}, client) {
  if (!timelineEnabled(guildId)) return [];

  try {
    return timelineStore.listTimelineEvents(guildId, options, client);
  } catch (error) {
    reportTimelineError('list events', guildId, error, client);
    return [];
  }
}

function clearTimeline(guildId, client) {
  if (!timelineEnabled(guildId)) return null;

  try {
    return timelineStore.clearTimeline(guildId, client);
  } catch (error) {
    reportTimelineError('clear events', guildId, error, client);
    return null;
  }
}

module.exports = {
  TYPES,
  createTimelineEvent,
  listTimeline,
  clearTimeline,
};