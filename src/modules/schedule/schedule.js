'use strict';

const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../core/guild/moduleSectionManager');

const SECTION = 'schedule';
const RSVP_STATES = Object.freeze(['going', 'maybe', 'declined', 'waitlist']);
const RECURRENCE_TYPES = Object.freeze(['none', 'daily', 'weekly', 'monthly']);
const REMINDER_TICK_MS = 60 * 1000;
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const createId = (prefix = 'evt') => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

function defaultSection() {
  return {
    enabled: true,
    settings: { defaultTimezone: 'UTC', defaultReminderMinutes: [1440, 60, 10], createDiscordEvents: false },
    events: {},
    templates: {},
    analytics: { created: 0, completed: 0, cancelled: 0, remindersSent: 0, rsvps: 0, waitlisted: 0, failures: 0, lastProcessedAt: null },
    createdAt: now(),
    updatedAt: now(),
  };
}

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}

function normalizeRecurrence(value = {}) {
  const type = RECURRENCE_TYPES.includes(String(value.type || value).toLowerCase()) ? String(value.type || value).toLowerCase() : 'none';
  return {
    type,
    interval: Math.max(1, Math.min(365, Math.floor(Number(value.interval || 1)))),
    count: value.count == null ? null : Math.max(1, Math.min(500, Math.floor(Number(value.count)))),
    until: value.until && Number.isFinite(new Date(value.until).getTime()) ? new Date(value.until).toISOString() : null,
  };
}

function normalizeEvent(event = {}) {
  const start = new Date(event.startAt || event.start || Date.now() + 3600000);
  if (!Number.isFinite(start.getTime())) throw new Error('A valid event start time is required.');
  const durationMinutes = Math.max(5, Math.min(10080, Math.floor(Number(event.durationMinutes || 60))));
  const end = event.endAt ? new Date(event.endAt) : new Date(start.getTime() + durationMinutes * 60000);
  if (!Number.isFinite(end.getTime()) || end <= start) throw new Error('Event end time must be after the start time.');
  const timezone = clean(event.timezone || 'UTC', 100) || 'UTC';
  if (!validTimezone(timezone)) throw new Error(`Invalid IANA timezone: ${timezone}`);
  const capacity = event.capacity == null || event.capacity === '' ? null : Math.max(1, Math.min(100000, Math.floor(Number(event.capacity))));
  const reminderMinutes = [...new Set((Array.isArray(event.reminderMinutes) ? event.reminderMinutes : [1440, 60, 10]).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 525600))].sort((a, b) => b - a);
  const eventId = clean(event.eventId || event.id, 100) || createId();
  return {
    eventId,
    id: eventId,
    enabled: event.enabled !== false,
    status: ['scheduled', 'cancelled', 'completed'].includes(event.status) ? event.status : 'scheduled',
    title: clean(event.title || 'Scheduled event', 200),
    description: clean(event.description, 4000),
    timezone,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    channelId: cleanId(event.channelId),
    voiceChannelId: cleanId(event.voiceChannelId),
    mentionRoleIds: [...new Set((Array.isArray(event.mentionRoleIds) ? event.mentionRoleIds : []).map(cleanId).filter(Boolean))],
    hostUserId: cleanId(event.hostUserId),
    capacity,
    allowMaybe: event.allowMaybe !== false,
    waitlistEnabled: event.waitlistEnabled !== false,
    recurrence: normalizeRecurrence(event.recurrence),
    parentEventId: clean(event.parentEventId, 100) || null,
    occurrenceIndex: Math.max(0, Number(event.occurrenceIndex || 0)),
    reminderMinutes,
    sentReminders: [...new Set(Array.isArray(event.sentReminders) ? event.sentReminders.map(Number) : [])],
    rsvps: event.rsvps && typeof event.rsvps === 'object' && !Array.isArray(event.rsvps) ? clone(event.rsvps) : {},
    messageId: cleanId(event.messageId),
    discordEventId: cleanId(event.discordEventId),
    createdBy: cleanId(event.createdBy),
    createdAt: event.createdAt || now(),
    updatedAt: now(),
    cancelledAt: event.cancelledAt || null,
    completedAt: event.completedAt || null,
    lastError: clean(event.lastError, 1000) || null,
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const sourceEvents = section.events && typeof section.events === 'object' ? section.events : {};
  return {
    ...base,
    ...clone(section),
    enabled: section.enabled !== false,
    settings: {
      ...base.settings,
      ...(section.settings || {}),
      defaultTimezone: validTimezone(section.settings?.defaultTimezone) ? section.settings.defaultTimezone : 'UTC',
      defaultReminderMinutes: Array.isArray(section.settings?.defaultReminderMinutes) ? section.settings.defaultReminderMinutes : base.settings.defaultReminderMinutes,
      createDiscordEvents: section.settings?.createDiscordEvents === true,
    },
    events: Object.fromEntries(Object.entries(sourceEvents).map(([id, event]) => {
      const normalized = normalizeEvent({ ...event, eventId: event.eventId || id });
      return [normalized.eventId, normalized];
    })),
    templates: section.templates && typeof section.templates === 'object' ? clone(section.templates) : {},
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
}

function getSection(guildId) { return normalizeSection(getModuleSection(guildId, SECTION, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    return normalizeSection(typeof updater === 'function' ? updater(clone(normalized)) : updater);
  }, defaultSection(), meta));
}
function listEvents(guildId, options = {}) {
  const values = Object.values(getSection(guildId).events);
  return values.filter((event) => !options.status || event.status === options.status).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}
function getEvent(guildId, eventId) { return getSection(guildId).events[clean(eventId, 100)] || null; }
function setEnabled(guildId, enabled, meta = {}) { return updateSection(guildId, (section) => ({ ...section, enabled: enabled === true, updatedAt: now() }), meta); }
function updateSettings(guildId, settings = {}, meta = {}) { return updateSection(guildId, (section) => ({ ...section, settings: { ...section.settings, ...settings }, updatedAt: now() }), meta); }

function incrementAnalytics(guildId, patch, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch)) analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    return { ...section, analytics, updatedAt: now() };
  }, meta).analytics;
}

function saveEvent(guildId, input, meta = {}) {
  const section = getSection(guildId);
  const event = normalizeEvent({ ...input, timezone: input.timezone || section.settings.defaultTimezone, reminderMinutes: input.reminderMinutes || section.settings.defaultReminderMinutes });
  const exists = Boolean(section.events[event.eventId]);
  updateSection(guildId, (current) => ({ ...current, events: { ...current.events, [event.eventId]: { ...(current.events[event.eventId] || {}), ...event } }, updatedAt: now() }), meta);
  if (!exists) incrementAnalytics(guildId, { created: 1 }, meta);
  return getEvent(guildId, event.eventId);
}

function removeEvent(guildId, eventId, meta = {}) {
  let removed = false;
  updateSection(guildId, (section) => {
    const events = { ...section.events };
    removed = Boolean(events[eventId]);
    delete events[eventId];
    return { ...section, events, updatedAt: now() };
  }, meta);
  return removed;
}
function cancelEvent(guildId, eventId, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event) return null;
  const updated = saveEvent(guildId, { ...event, status: 'cancelled', cancelledAt: now() }, meta);
  incrementAnalytics(guildId, { cancelled: 1 }, meta);
  return updated;
}
function duplicateEvent(guildId, eventId, startAt, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event) throw new Error('Schedule event not found.');
  const duration = new Date(event.endAt) - new Date(event.startAt);
  const start = new Date(startAt || Date.now() + 3600000);
  return saveEvent(guildId, { ...event, eventId: createId(), status: 'scheduled', startAt: start.toISOString(), endAt: new Date(start.getTime() + duration).toISOString(), rsvps: {}, sentReminders: [], parentEventId: event.eventId, occurrenceIndex: 0, createdAt: now(), cancelledAt: null, completedAt: null }, meta);
}

function rsvpCounts(event) {
  const counts = { going: 0, maybe: 0, declined: 0, waitlist: 0 };
  for (const item of Object.values(event?.rsvps || {})) if (counts[item.status] != null) counts[item.status] += 1;
  return counts;
}

function promoteWaitlist(event) {
  if (!event.capacity || !event.waitlistEnabled) return { event, promotedUserId: null };
  const counts = rsvpCounts(event);
  if (counts.going >= event.capacity) return { event, promotedUserId: null };
  const next = Object.values(event.rsvps || {})
    .filter((entry) => entry.status === 'waitlist')
    .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))[0];
  if (!next) return { event, promotedUserId: null };
  return {
    event: {
      ...event,
      rsvps: {
        ...event.rsvps,
        [next.userId]: { ...next, status: 'going', promotedAt: now(), updatedAt: now() },
      },
    },
    promotedUserId: next.userId,
  };
}

function setRsvp(guildId, eventId, userId, status, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event || event.status !== 'scheduled') throw new Error('Scheduled event not found.');
  const safeUserId = cleanId(userId);
  if (!safeUserId) throw new Error('A valid Discord user is required.');
  let nextStatus = RSVP_STATES.includes(status) ? status : 'going';
  if (nextStatus === 'maybe' && !event.allowMaybe) nextStatus = 'going';
  const counts = rsvpCounts(event);
  const previous = event.rsvps[safeUserId]?.status;
  const effectiveGoing = counts.going - (previous === 'going' ? 1 : 0);
  if (nextStatus === 'going' && event.capacity && effectiveGoing >= event.capacity) {
    if (!event.waitlistEnabled) throw new Error('This event is full.');
    nextStatus = 'waitlist';
  }
  let updated = saveEvent(guildId, { ...event, rsvps: { ...event.rsvps, [safeUserId]: { userId: safeUserId, status: nextStatus, updatedAt: now() } } }, meta);
  let promotedUserId = null;
  if (previous === 'going' && nextStatus !== 'going') {
    const promoted = promoteWaitlist(updated);
    updated = saveEvent(guildId, promoted.event, meta);
    promotedUserId = promoted.promotedUserId;
  }
  incrementAnalytics(guildId, { rsvps: 1, ...(nextStatus === 'waitlist' ? { waitlisted: 1 } : {}) }, meta);
  return { event: updated, status: nextStatus, counts: rsvpCounts(updated), promotedUserId };
}
function removeRsvp(guildId, eventId, userId, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event) return null;
  const safeUserId = cleanId(userId);
  const previous = event.rsvps[safeUserId]?.status;
  const rsvps = { ...event.rsvps };
  delete rsvps[safeUserId];
  let updated = saveEvent(guildId, { ...event, rsvps }, meta);
  let promotedUserId = null;
  if (previous === 'going') {
    const promoted = promoteWaitlist(updated);
    updated = saveEvent(guildId, promoted.event, meta);
    promotedUserId = promoted.promotedUserId;
  }
  return { event: updated, counts: rsvpCounts(updated), promotedUserId };
}

function nextOccurrence(event) {
  if (event.recurrence?.type === 'none') return null;
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const interval = event.recurrence.interval || 1;
  if (event.recurrence.type === 'daily') { start.setUTCDate(start.getUTCDate() + interval); end.setUTCDate(end.getUTCDate() + interval); }
  else if (event.recurrence.type === 'weekly') { start.setUTCDate(start.getUTCDate() + (7 * interval)); end.setUTCDate(end.getUTCDate() + (7 * interval)); }
  else { start.setUTCMonth(start.getUTCMonth() + interval); end.setUTCMonth(end.getUTCMonth() + interval); }
  if (event.recurrence.until && start > new Date(event.recurrence.until)) return null;
  if (event.recurrence.count && event.occurrenceIndex + 1 >= event.recurrence.count) return null;
  return normalizeEvent({ ...event, eventId: createId(), parentEventId: event.parentEventId || event.eventId, occurrenceIndex: event.occurrenceIndex + 1, startAt: start.toISOString(), endAt: end.toISOString(), rsvps: {}, sentReminders: [], createdAt: now(), status: 'scheduled', completedAt: null, cancelledAt: null });
}

function dueReminders(event, timestamp = Date.now()) {
  if (event.status !== 'scheduled' || event.enabled === false) return [];
  const startMs = new Date(event.startAt).getTime();
  return event.reminderMinutes.filter((minutes) => !event.sentReminders.includes(minutes) && timestamp >= startMs - minutes * 60000 && timestamp < startMs);
}
async function sendReminder(guild, event, minutes) {
  const channel = event.channelId ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
  if (!channel?.send) throw new Error('Schedule reminder channel is unavailable.');
  const mentions = event.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
  const unix = Math.floor(new Date(event.startAt).getTime() / 1000);
  await channel.send({ content: `${mentions ? `${mentions} ` : ''}**${event.title}** starts <t:${unix}:R> (<t:${unix}:F>).`, allowedMentions: { roles: event.mentionRoleIds } });
}

async function processGuild(guild, meta = {}) {
  const section = getSection(guild.id);
  if (section.enabled === false) return { disabled: true, reminders: 0, completed: 0, recurrences: 0, failures: 0 };
  const result = { reminders: 0, completed: 0, recurrences: 0, failures: 0 };
  const timestamp = Date.now();
  for (const event of listEvents(guild.id)) {
    try {
      for (const minutes of dueReminders(event, timestamp)) {
        await sendReminder(guild, event, minutes);
        saveEvent(guild.id, { ...getEvent(guild.id, event.eventId), sentReminders: [...event.sentReminders, minutes] }, meta);
        result.reminders += 1;
      }
      if (event.status === 'scheduled' && timestamp >= new Date(event.endAt).getTime()) {
        saveEvent(guild.id, { ...event, status: 'completed', completedAt: now() }, meta);
        result.completed += 1;
        const next = nextOccurrence(event);
        if (next) { saveEvent(guild.id, next, meta); result.recurrences += 1; }
      }
    } catch (error) {
      saveEvent(guild.id, { ...event, lastError: error.message }, meta);
      result.failures += 1;
    }
  }
  incrementAnalytics(guild.id, { remindersSent: result.reminders, completed: result.completed, failures: result.failures, lastProcessedAt: now() }, meta);
  return result;
}

async function buildHealth(guild) {
  const section = getSection(guild.id);
  const issues = [];
  const warnings = [];
  for (const event of listEvents(guild.id)) {
    if (event.channelId) {
      const channel = guild.channels.cache.get(event.channelId) || await guild.channels.fetch(event.channelId).catch(() => null);
      if (!channel?.send) issues.push({ code: 'channel_unavailable', eventId: event.eventId, channelId: event.channelId });
    } else warnings.push({ code: 'channel_missing', eventId: event.eventId });
    if (!validTimezone(event.timezone)) issues.push({ code: 'timezone_invalid', eventId: event.eventId, timezone: event.timezone });
    if (event.lastError) warnings.push({ code: 'last_error', eventId: event.eventId, error: event.lastError });
  }
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) issues.push({ code: 'send_messages_missing' });
  return { module: 'schedule', guildId: guild.id, healthy: issues.length === 0, enabled: section.enabled, eventCount: Object.keys(section.events).length, upcomingCount: listEvents(guild.id, { status: 'scheduled' }).length, issues, warnings, checkedAt: now() };
}
async function repair(guild, meta = {}) {
  const section = getSection(guild.id);
  const events = {};
  for (const event of Object.values(section.events)) {
    if (event.channelId && !guild.channels.cache.has(event.channelId)) events[event.eventId] = normalizeEvent({ ...event, channelId: null, lastError: null });
    else events[event.eventId] = normalizeEvent({ ...event, lastError: null });
  }
  saveSection(guild.id, { ...section, events }, meta);
  return buildHealth(guild);
}

async function startup(client) {
  if (client.__goliathScheduleStarted) return client.__goliathScheduleStarted;
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await processGuild(guild, { action: 'schedule_startup_process' }).catch((error) => console.warn(`[Schedule] ${guild.id}: ${error.message}`));
  };
  await run();
  const timer = setInterval(run, REMINDER_TICK_MS);
  timer.unref?.();
  client.__goliathScheduleStarted = timer;
  return timer;
}

module.exports = {
  SECTION, RSVP_STATES, RECURRENCE_TYPES, defaultSection, getSection, listEvents, getEvent, setEnabled, updateSettings,
  saveEvent, removeEvent, cancelEvent, duplicateEvent, setRsvp, removeRsvp, rsvpCounts, promoteWaitlist, nextOccurrence, dueReminders,
  processGuild, buildHealth, repair, startup,
  exportConfiguration: getSection,
  reset: (guildId, meta = {}) => saveSection(guildId, defaultSection(), meta),
};