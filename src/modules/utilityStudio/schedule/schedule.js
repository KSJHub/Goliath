'use strict';

const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, saveModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');

const SECTION = 'schedule';
const RSVP_STATES = Object.freeze(['going', 'maybe', 'declined', 'waitlist']);
const RECURRENCE_TYPES = Object.freeze(['none', 'hourly', 'daily', 'weekly', 'monthly', 'yearly']);
const REMINDER_TICK_MS = 60 * 1000;
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const createId = (prefix = 'evt') => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(new Date()); return true; }
  catch { return false; }
}

function defaultRsvpOptions() {
  return [
    { key: 'going', label: 'Going', emoji: '✅', style: 'success', isAttendee: true, roleId: null, enabled: true },
    { key: 'maybe', label: 'Maybe', emoji: '❔', style: 'primary', isAttendee: false, roleId: null, enabled: true },
    { key: 'declined', label: 'Decline', emoji: '❌', style: 'secondary', isAttendee: false, roleId: null, enabled: true },
  ];
}

function defaultSection() {
  return {
    settings: {
      defaultTimezone: 'UTC',
      defaultChannelId: null,
      defaultReminderMinutes: [1440, 60, 10],
      defaultNotifications: [],
      defaultRsvpOptions: defaultRsvpOptions(),
      createDiscordEvents: false,
      createEventThreads: false,
      closeRsvpsAtStart: true,
      warnOverlaps: true,
      allowMemberReminders: true,
    },
    events: {},
    templates: {},
    analytics: {
      created: 0,
      completed: 0,
      cancelled: 0,
      remindersSent: 0,
      personalRemindersSent: 0,
      notificationsSent: 0,
      rsvps: 0,
      waitlisted: 0,
      waitlistPromotions: 0,
      threadsCreated: 0,
      nativeEventsCreated: 0,
      failures: 0,
      lastProcessedAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeRsvpOptions(value) {
  const source = Array.isArray(value) && value.length ? value : defaultRsvpOptions();
  const seen = new Set();
  const output = [];
  for (const item of source.slice(0, 20)) {
    const key = clean(item?.key || item?.label, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({
      key,
      label: clean(item?.label || key, 80) || key,
      emoji: clean(item?.emoji, 24) || null,
      style: ['primary', 'secondary', 'success', 'danger'].includes(item?.style) ? item.style : 'secondary',
      isAttendee: item?.isAttendee === true || key === 'going',
      roleId: cleanId(item?.roleId),
      enabled: item?.enabled !== false,
    });
  }
  return output.length ? output : defaultRsvpOptions();
}

function normalizeNotifications(value) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, 20).map((item, index) => ({
    id: clean(item?.id, 80) || `note_${index}_${crypto.randomUUID().slice(0, 6)}`,
    minutesBefore: Math.max(0, Math.min(525600, Math.floor(Number(item?.minutesBefore ?? item?.minutes ?? 0)))),
    title: clean(item?.title || 'Event Reminder', 200),
    description: clean(item?.description || '{event} starts {relative}.', 1800),
    channelId: cleanId(item?.channelId),
    mentionRoleIds: [...new Set((Array.isArray(item?.mentionRoleIds) ? item.mentionRoleIds : []).map(cleanId).filter(Boolean))],
    sent: item?.sent === true,
  }));
}

function normalizeRecurrence(value = {}) {
  const requested = String(value?.type || value || 'none').toLowerCase();
  const type = RECURRENCE_TYPES.includes(requested) ? requested : 'none';
  const weekdays = [...new Set((Array.isArray(value?.weekdays) ? value.weekdays : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return {
    type,
    interval: Math.max(1, Math.min(365, Math.floor(Number(value?.interval || 1)))),
    count: value?.count == null || value?.count === '' ? null : Math.max(1, Math.min(500, Math.floor(Number(value.count)))),
    until: value?.until && Number.isFinite(new Date(value.until).getTime()) ? new Date(value.until).toISOString() : null,
    timezone: validTimezone(value?.timezone) ? value.timezone : null,
    weekdays,
    monthMode: ['date', 'weekday'].includes(value?.monthMode) ? value.monthMode : 'date',
    weekOfMonth: Math.max(1, Math.min(5, Math.floor(Number(value?.weekOfMonth || 1)))),
    weekday: Number.isInteger(Number(value?.weekday)) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6 ? Number(value.weekday) : null,
    autoJoinNextAllowed: value?.autoJoinNextAllowed !== false,
  };
}

function normalizeThread(value = {}, defaultEnabled = false) {
  return {
    enabled: value?.enabled === true || (value?.enabled == null && defaultEnabled === true),
    threadId: cleanId(value?.threadId),
    title: clean(value?.title || '{event}', 100),
    addAttendeesOnRsvp: value?.addAttendeesOnRsvp !== false,
    startMessageDestination: value?.startMessageDestination === 'thread' ? 'thread' : 'channel',
    autoArchiveDuration: [60, 1440, 4320, 10080].includes(Number(value?.autoArchiveDuration)) ? Number(value.autoArchiveDuration) : 1440,
  };
}

function normalizeEvent(event = {}, settings = defaultSection().settings) {
  const start = new Date(event.startAt || event.start || Date.now() + 3600000);
  if (!Number.isFinite(start.getTime())) throw new Error('A valid event start time is required.');
  const durationMinutes = Math.max(5, Math.min(10080, Math.floor(Number(event.durationMinutes || 60))));
  const end = event.endAt ? new Date(event.endAt) : new Date(start.getTime() + durationMinutes * 60000);
  if (!Number.isFinite(end.getTime()) || end <= start) throw new Error('Event end time must be after the start time.');
  const timezone = clean(event.timezone || settings.defaultTimezone || 'UTC', 100) || 'UTC';
  if (!validTimezone(timezone)) throw new Error(`Invalid IANA timezone: ${timezone}`);
  const capacity = event.capacity == null || event.capacity === '' ? null : Math.max(1, Math.min(100000, Math.floor(Number(event.capacity))));
  const reminderMinutes = [...new Set((Array.isArray(event.reminderMinutes) ? event.reminderMinutes : settings.defaultReminderMinutes || [1440, 60, 10]).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 525600))].sort((a, b) => b - a);
  const eventId = clean(event.eventId || event.id, 100) || createId();
  const closeAtRaw = event.rsvpCloseAt || (settings.closeRsvpsAtStart ? start.toISOString() : null);
  const rsvpCloseAt = closeAtRaw && Number.isFinite(new Date(closeAtRaw).getTime()) ? new Date(closeAtRaw).toISOString() : null;
  const rsvpOptions = normalizeRsvpOptions(event.rsvpOptions || settings.defaultRsvpOptions);
  const rsvps = event.rsvps && typeof event.rsvps === 'object' && !Array.isArray(event.rsvps) ? clone(event.rsvps) : {};
  for (const [userId, entry] of Object.entries(rsvps)) {
    rsvps[userId] = {
      userId: cleanId(entry?.userId || userId) || userId,
      status: clean(entry?.status || 'going', 40),
      reminderMinutes: [...new Set((Array.isArray(entry?.reminderMinutes) ? entry.reminderMinutes : []).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 525600))].sort((a, b) => b - a),
      sentReminderMinutes: [...new Set((Array.isArray(entry?.sentReminderMinutes) ? entry.sentReminderMinutes : []).map(Number))],
      autoJoinNext: entry?.autoJoinNext === true,
      updatedAt: entry?.updatedAt || now(),
      promotedAt: entry?.promotedAt || null,
    };
  }
  return {
    eventId,
    id: eventId,
    enabled: event.enabled !== false,
    status: ['scheduled', 'cancelled', 'completed'].includes(event.status) ? event.status : 'scheduled',
    title: clean(event.title || 'Scheduled event', 200),
    description: clean(event.description, 4000),
    color: Number.isFinite(Number(event.color)) ? Number(event.color) : 0x5865F2,
    timezone,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    channelId: cleanId(event.channelId || settings.defaultChannelId),
    voiceChannelId: cleanId(event.voiceChannelId),
    location: clean(event.location, 200) || null,
    mentionRoleIds: [...new Set((Array.isArray(event.mentionRoleIds) ? event.mentionRoleIds : []).map(cleanId).filter(Boolean))],
    allowedRoleIds: [...new Set((Array.isArray(event.allowedRoleIds) ? event.allowedRoleIds : []).map(cleanId).filter(Boolean))],
    deniedRoleIds: [...new Set((Array.isArray(event.deniedRoleIds) ? event.deniedRoleIds : []).map(cleanId).filter(Boolean))],
    hostUserId: cleanId(event.hostUserId),
    capacity,
    allowMaybe: event.allowMaybe !== false,
    waitlistEnabled: event.waitlistEnabled !== false,
    rsvpOptions,
    rsvpCloseAt,
    recurrence: normalizeRecurrence({ ...(event.recurrence || {}), timezone: event.recurrence?.timezone || timezone }),
    parentEventId: clean(event.parentEventId, 100) || null,
    occurrenceIndex: Math.max(0, Number(event.occurrenceIndex || 0)),
    reminderMinutes,
    sentReminders: [...new Set(Array.isArray(event.sentReminders) ? event.sentReminders.map(Number) : [])],
    notifications: normalizeNotifications(event.notifications || settings.defaultNotifications),
    rsvps,
    messageId: cleanId(event.messageId),
    discordEventId: cleanId(event.discordEventId),
    mirrorDiscordEvent: event.mirrorDiscordEvent === true || (event.mirrorDiscordEvent == null && settings.createDiscordEvents === true),
    thread: normalizeThread(event.thread, settings.createEventThreads),
    createdBy: cleanId(event.createdBy),
    createdAt: event.createdAt || now(),
    updatedAt: now(),
    cancelledAt: event.cancelledAt || null,
    completedAt: event.completedAt || null,
    startedAt: event.startedAt || null,
    startMessageSent: event.startMessageSent === true,
    lastError: clean(event.lastError, 1000) || null,
  };
}

function normalizeSection(section = {}) {
  const base = defaultSection();
  const settings = {
    ...base.settings,
    ...(section.settings || {}),
    defaultTimezone: validTimezone(section.settings?.defaultTimezone) ? section.settings.defaultTimezone : base.settings.defaultTimezone,
    defaultChannelId: cleanId(section.settings?.defaultChannelId),
    defaultReminderMinutes: Array.isArray(section.settings?.defaultReminderMinutes) ? section.settings.defaultReminderMinutes : base.settings.defaultReminderMinutes,
    defaultNotifications: normalizeNotifications(section.settings?.defaultNotifications),
    defaultRsvpOptions: normalizeRsvpOptions(section.settings?.defaultRsvpOptions),
    createDiscordEvents: section.settings?.createDiscordEvents === true,
    createEventThreads: section.settings?.createEventThreads === true,
    closeRsvpsAtStart: section.settings?.closeRsvpsAtStart !== false,
    warnOverlaps: section.settings?.warnOverlaps !== false,
    allowMemberReminders: section.settings?.allowMemberReminders !== false,
  };
  const sourceEvents = section.events && typeof section.events === 'object' ? section.events : {};
  const normalized = {
    ...base,
    ...clone(section),
    settings,
    events: Object.fromEntries(Object.entries(sourceEvents).map(([id, event]) => {
      const normalizedEvent = normalizeEvent({ ...event, eventId: event.eventId || id }, settings);
      return [normalizedEvent.eventId, normalizedEvent];
    })),
    templates: section.templates && typeof section.templates === 'object' ? clone(section.templates) : {},
    analytics: { ...base.analytics, ...(section.analytics || {}) },
    updatedAt: section.updatedAt || now(),
  };
  delete normalized.enabled;
  return normalized;
}

function getSection(guildId) { return normalizeSection(getModuleSection(guildId, SECTION, defaultSection())); }
function saveSection(guildId, section, meta = {}) { return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta)); }
function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
    return { ...normalizeSection(next), updatedAt: now() };
  }, defaultSection(), meta));
}
function listEvents(guildId, options = {}) {
  const values = Object.values(getSection(guildId).events);
  return values.filter((event) => (!options.status || event.status === options.status) && (!options.futureOnly || new Date(event.endAt).getTime() >= Date.now())).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}
function getEvent(guildId, eventId) { return getSection(guildId).events[clean(eventId, 100)] || null; }
function setEnabled(guildId, enabled, meta = {}) {
  guildManager.setModuleEnabled(guildId, SECTION, enabled === true, meta);
  return { ...getSection(guildId), enabled: guildManager.isModuleEnabled(guildId, SECTION) };
}
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
  const event = normalizeEvent({ ...input, timezone: input.timezone || section.settings.defaultTimezone, reminderMinutes: input.reminderMinutes || section.settings.defaultReminderMinutes }, section.settings);
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
  return saveEvent(guildId, { ...event, eventId: createId(), status: 'scheduled', startAt: start.toISOString(), endAt: new Date(start.getTime() + duration).toISOString(), rsvps: {}, sentReminders: [], notifications: event.notifications.map((item) => ({ ...item, sent: false })), parentEventId: event.eventId, occurrenceIndex: 0, createdAt: now(), cancelledAt: null, completedAt: null, messageId: null, discordEventId: null, thread: { ...event.thread, threadId: null }, startMessageSent: false }, meta);
}

function saveTemplate(guildId, input = {}, meta = {}) {
  const templateId = clean(input.templateId || input.id, 80) || createId('tpl');
  const name = clean(input.name || input.title || 'Event Template', 100);
  const payload = clone(input.event || input.payload || input);
  delete payload.templateId; delete payload.id; delete payload.name;
  updateSection(guildId, (section) => ({ ...section, templates: { ...section.templates, [templateId]: { templateId, name, event: payload, updatedAt: now(), createdAt: section.templates[templateId]?.createdAt || now() } } }), meta);
  return getSection(guildId).templates[templateId];
}
function removeTemplate(guildId, templateId, meta = {}) {
  let removed = false;
  updateSection(guildId, (section) => { const templates = { ...section.templates }; removed = Boolean(templates[templateId]); delete templates[templateId]; return { ...section, templates }; }, meta);
  return removed;
}
function listTemplates(guildId) { return Object.values(getSection(guildId).templates).sort((a, b) => String(a.name).localeCompare(String(b.name))); }
function createFromTemplate(guildId, templateId, overrides = {}, meta = {}) {
  const template = getSection(guildId).templates[templateId];
  if (!template) throw new Error('Schedule template not found.');
  return saveEvent(guildId, { ...(template.event || {}), ...overrides, eventId: null, id: null, messageId: null, discordEventId: null, rsvps: {}, sentReminders: [], notifications: normalizeNotifications(template.event?.notifications).map((item) => ({ ...item, sent: false })), thread: { ...(template.event?.thread || {}), threadId: null } }, meta);
}

function getRsvpOption(event, key) { return (event.rsvpOptions || []).find((item) => item.key === key) || null; }
function isAttendeeStatus(event, status) { return status === 'going' || getRsvpOption(event, status)?.isAttendee === true; }
function attendeeCount(event) { return Object.values(event?.rsvps || {}).filter((entry) => isAttendeeStatus(event, entry.status)).length; }
function rsvpCounts(event) {
  const counts = { going: 0, maybe: 0, declined: 0, waitlist: 0 };
  for (const option of event?.rsvpOptions || []) if (counts[option.key] == null) counts[option.key] = 0;
  for (const item of Object.values(event?.rsvps || {})) counts[item.status] = Number(counts[item.status] || 0) + 1;
  return counts;
}
function isRsvpOpen(event, timestamp = Date.now()) {
  if (!event || event.status !== 'scheduled' || event.enabled === false) return false;
  if (event.rsvpCloseAt && timestamp >= new Date(event.rsvpCloseAt).getTime()) return false;
  return timestamp < new Date(event.startAt).getTime();
}
function memberRoleAllowed(event, memberRoleIds = []) {
  const roles = new Set((memberRoleIds || []).map(String));
  if (event.deniedRoleIds?.some((id) => roles.has(id))) return false;
  if (event.allowedRoleIds?.length && !event.allowedRoleIds.some((id) => roles.has(id))) return false;
  return true;
}
function promoteWaitlist(event) {
  if (!event.capacity || !event.waitlistEnabled) return { event, promotedUserId: null };
  if (attendeeCount(event) >= event.capacity) return { event, promotedUserId: null };
  const next = Object.values(event.rsvps || {}).filter((entry) => entry.status === 'waitlist').sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))[0];
  if (!next) return { event, promotedUserId: null };
  const target = (event.rsvpOptions || []).find((item) => item.isAttendee && item.enabled !== false)?.key || 'going';
  return { event: { ...event, rsvps: { ...event.rsvps, [next.userId]: { ...next, status: target, promotedAt: now(), updatedAt: now() } } }, promotedUserId: next.userId };
}
function setRsvp(guildId, eventId, userId, status, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event || event.status !== 'scheduled') throw new Error('Scheduled event not found.');
  if (!isRsvpOpen(event)) throw new Error('RSVPs are closed for this event.');
  if (!memberRoleAllowed(event, meta.memberRoleIds || [])) throw new Error('You do not have an allowed role for this event.');
  const safeUserId = cleanId(userId);
  if (!safeUserId) throw new Error('A valid Discord user is required.');
  let nextStatus = clean(status || 'going', 40);
  const option = getRsvpOption(event, nextStatus);
  if (!option && !RSVP_STATES.includes(nextStatus)) throw new Error('That RSVP option is unavailable.');
  if (option && option.enabled === false) throw new Error('That RSVP option is disabled.');
  if (nextStatus === 'maybe' && !event.allowMaybe) nextStatus = 'going';
  const previousEntry = event.rsvps[safeUserId] || null;
  const previous = previousEntry?.status;
  const incomingAttendee = isAttendeeStatus(event, nextStatus);
  const previousAttendee = previous ? isAttendeeStatus(event, previous) : false;
  const effectiveAttendeeCount = attendeeCount(event) - (previousAttendee ? 1 : 0);
  if (incomingAttendee && event.capacity && effectiveAttendeeCount >= event.capacity) {
    if (!event.waitlistEnabled) throw new Error('This event is full.');
    nextStatus = 'waitlist';
  }
  const newEntry = {
    userId: safeUserId,
    status: nextStatus,
    reminderMinutes: previousEntry?.reminderMinutes || [],
    sentReminderMinutes: previousEntry?.sentReminderMinutes || [],
    autoJoinNext: previousEntry?.autoJoinNext === true,
    updatedAt: now(),
  };
  let updated = saveEvent(guildId, { ...event, rsvps: { ...event.rsvps, [safeUserId]: newEntry } }, meta);
  let promotedUserId = null;
  if (previousAttendee && !isAttendeeStatus(updated, nextStatus)) {
    const promoted = promoteWaitlist(updated);
    updated = saveEvent(guildId, promoted.event, meta);
    promotedUserId = promoted.promotedUserId;
    if (promotedUserId) incrementAnalytics(guildId, { waitlistPromotions: 1 }, meta);
  }
  incrementAnalytics(guildId, { rsvps: 1, ...(nextStatus === 'waitlist' ? { waitlisted: 1 } : {}) }, meta);
  return { event: updated, status: nextStatus, counts: rsvpCounts(updated), promotedUserId, previousStatus: previous };
}
function removeRsvp(guildId, eventId, userId, meta = {}) {
  const event = getEvent(guildId, eventId);
  if (!event) return null;
  const safeUserId = cleanId(userId);
  const previous = event.rsvps[safeUserId]?.status;
  const previousAttendee = previous ? isAttendeeStatus(event, previous) : false;
  const rsvps = { ...event.rsvps }; delete rsvps[safeUserId];
  let updated = saveEvent(guildId, { ...event, rsvps }, meta);
  let promotedUserId = null;
  if (previousAttendee) {
    const promoted = promoteWaitlist(updated);
    updated = saveEvent(guildId, promoted.event, meta);
    promotedUserId = promoted.promotedUserId;
    if (promotedUserId) incrementAnalytics(guildId, { waitlistPromotions: 1 }, meta);
  }
  return { event: updated, counts: rsvpCounts(updated), promotedUserId, previousStatus: previous };
}
function setMemberReminder(guildId, eventId, userId, minutes, meta = {}) {
  const event = getEvent(guildId, eventId);
  const safeUserId = cleanId(userId);
  if (!event || !safeUserId || !event.rsvps[safeUserId]) throw new Error('RSVP to the event before setting reminders.');
  const reminderMinutes = [...new Set((Array.isArray(minutes) ? minutes : [minutes]).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 525600))].sort((a, b) => b - a);
  return saveEvent(guildId, { ...event, rsvps: { ...event.rsvps, [safeUserId]: { ...event.rsvps[safeUserId], reminderMinutes, sentReminderMinutes: [], updatedAt: now() } } }, meta);
}
function setAutoJoinNext(guildId, eventId, userId, enabled, meta = {}) {
  const event = getEvent(guildId, eventId); const safeUserId = cleanId(userId);
  if (!event || !safeUserId || !event.rsvps[safeUserId]) throw new Error('RSVP to the event first.');
  if (!event.recurrence?.autoJoinNextAllowed || event.recurrence?.type === 'none') throw new Error('Auto Join Next is not available for this event.');
  return saveEvent(guildId, { ...event, rsvps: { ...event.rsvps, [safeUserId]: { ...event.rsvps[safeUserId], autoJoinNext: enabled === true, updatedAt: now() } } }, meta);
}
function findOverlaps(guildId, userId, eventId) {
  const target = getEvent(guildId, eventId);
  if (!target) return [];
  const start = new Date(target.startAt).getTime(); const end = new Date(target.endAt).getTime();
  return listEvents(guildId, { status: 'scheduled' }).filter((event) => event.eventId !== eventId && event.rsvps?.[userId] && isAttendeeStatus(event, event.rsvps[userId].status) && new Date(event.startAt).getTime() < end && new Date(event.endAt).getTime() > start);
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function zonedDateToUtc(parts, timezone) {
  const target = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour || 0), Number(parts.minute || 0), Number(parts.second || 0));
  const probe = new Date(target);
  const represented = zonedParts(probe, timezone);
  const representedUtc = Date.UTC(Number(represented.year), Number(represented.month) - 1, Number(represented.day), Number(represented.hour), Number(represented.minute), Number(represented.second));
  return new Date(target + (target - representedUtc));
}
function addLocalRecurrence(date, recurrence, timezone) {
  const p = zonedParts(date, timezone);
  const local = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)));
  const interval = recurrence.interval || 1;
  if (recurrence.type === 'hourly') local.setUTCHours(local.getUTCHours() + interval);
  else if (recurrence.type === 'daily') local.setUTCDate(local.getUTCDate() + interval);
  else if (recurrence.type === 'weekly') local.setUTCDate(local.getUTCDate() + (7 * interval));
  else if (recurrence.type === 'monthly') local.setUTCMonth(local.getUTCMonth() + interval);
  else if (recurrence.type === 'yearly') local.setUTCFullYear(local.getUTCFullYear() + interval);
  const next = { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds() };
  return zonedDateToUtc(next, timezone);
}
function nextOccurrence(event) {
  if (event.recurrence?.type === 'none') return null;
  const timezone = event.recurrence.timezone || event.timezone || 'UTC';
  const duration = new Date(event.endAt).getTime() - new Date(event.startAt).getTime();
  let start = addLocalRecurrence(new Date(event.startAt), event.recurrence, timezone);
  if (event.recurrence.type === 'weekly' && event.recurrence.weekdays?.length) {
    for (let guard = 0; guard < 21; guard += 1) {
      const parts = zonedParts(start, timezone);
      const weekday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay();
      if (event.recurrence.weekdays.includes(weekday)) break;
      start = addLocalRecurrence(start, { ...event.recurrence, type: 'daily', interval: 1 }, timezone);
    }
  }
  if (event.recurrence.until && start > new Date(event.recurrence.until)) return null;
  if (event.recurrence.count && event.occurrenceIndex + 1 >= event.recurrence.count) return null;
  const carry = {};
  for (const [userId, entry] of Object.entries(event.rsvps || {})) if (entry.autoJoinNext && event.recurrence.autoJoinNextAllowed) carry[userId] = { ...entry, sentReminderMinutes: [], updatedAt: now() };
  return normalizeEvent({ ...event, eventId: createId(), parentEventId: event.parentEventId || event.eventId, occurrenceIndex: event.occurrenceIndex + 1, startAt: start.toISOString(), endAt: new Date(start.getTime() + duration).toISOString(), rsvps: carry, sentReminders: [], notifications: event.notifications.map((item) => ({ ...item, sent: false })), createdAt: now(), status: 'scheduled', completedAt: null, cancelledAt: null, messageId: null, discordEventId: null, thread: { ...event.thread, threadId: null }, startMessageSent: false }, defaultSection().settings);
}

function dueReminders(event, timestamp = Date.now()) {
  if (event.status !== 'scheduled' || event.enabled === false) return [];
  const startMs = new Date(event.startAt).getTime();
  return event.reminderMinutes.filter((minutes) => !event.sentReminders.includes(minutes) && timestamp >= startMs - minutes * 60000 && timestamp < startMs);
}
function dueNotifications(event, timestamp = Date.now()) {
  const startMs = new Date(event.startAt).getTime();
  return (event.notifications || []).filter((item) => !item.sent && timestamp >= startMs - item.minutesBefore * 60000 && timestamp < startMs + 60000);
}
function duePersonalReminders(event, timestamp = Date.now()) {
  const startMs = new Date(event.startAt).getTime();
  const due = [];
  for (const entry of Object.values(event.rsvps || {})) for (const minutes of entry.reminderMinutes || []) if (!(entry.sentReminderMinutes || []).includes(minutes) && timestamp >= startMs - minutes * 60000 && timestamp < startMs) due.push({ userId: entry.userId, minutes });
  return due;
}
function renderNotificationText(text, event) {
  const unix = Math.floor(new Date(event.startAt).getTime() / 1000);
  return clean(text, 1800).replaceAll('{event}', event.title).replaceAll('{relative}', `<t:${unix}:R>`).replaceAll('{time}', `<t:${unix}:F>`).replaceAll('{host}', event.hostUserId ? `<@${event.hostUserId}>` : 'the host');
}
async function sendReminder(guild, event, minutes) {
  const channel = event.channelId ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
  if (!channel?.send) throw new Error('Schedule reminder channel is unavailable.');
  const mentions = event.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
  const unix = Math.floor(new Date(event.startAt).getTime() / 1000);
  await channel.send({ content: `${mentions ? `${mentions} ` : ''}**${event.title}** starts <t:${unix}:R> (<t:${unix}:F>).`, allowedMentions: { roles: event.mentionRoleIds } });
}
async function sendCustomNotification(guild, event, notification) {
  const channelId = notification.channelId || event.channelId;
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.send) throw new Error('Schedule notification channel is unavailable.');
  const roles = notification.mentionRoleIds || [];
  const mentions = roles.map((id) => `<@&${id}>`).join(' ');
  await channel.send({ content: mentions || undefined, embeds: [{ color: event.color || 0x5865F2, title: renderNotificationText(notification.title, event), description: renderNotificationText(notification.description, event) }], allowedMentions: { roles } });
}
async function sendPersonalReminder(guild, event, userId, minutes) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.user) return false;
  const unix = Math.floor(new Date(event.startAt).getTime() / 1000);
  await member.user.send(`⏰ **${event.title}** starts <t:${unix}:R> (<t:${unix}:F>).`).catch(() => null);
  return true;
}

async function processGuild(guild, meta = {}) {
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { disabled: true, reminders: 0, personalReminders: 0, notifications: 0, completed: 0, recurrences: 0, failures: 0 };
  const result = { reminders: 0, personalReminders: 0, notifications: 0, completed: 0, recurrences: 0, failures: 0 };
  const timestamp = Date.now();
  for (const original of listEvents(guild.id)) {
    try {
      let event = getEvent(guild.id, original.eventId) || original;
      for (const minutes of dueReminders(event, timestamp)) {
        await sendReminder(guild, event, minutes);
        event = saveEvent(guild.id, { ...event, sentReminders: [...event.sentReminders, minutes] }, meta);
        result.reminders += 1;
      }
      for (const notification of dueNotifications(event, timestamp)) {
        await sendCustomNotification(guild, event, notification);
        event = saveEvent(guild.id, { ...event, notifications: event.notifications.map((item) => item.id === notification.id ? { ...item, sent: true } : item) }, meta);
        result.notifications += 1;
      }
      for (const personal of duePersonalReminders(event, timestamp)) {
        await sendPersonalReminder(guild, event, personal.userId, personal.minutes);
        const latest = getEvent(guild.id, event.eventId) || event;
        const entry = latest.rsvps[personal.userId];
        if (entry) event = saveEvent(guild.id, { ...latest, rsvps: { ...latest.rsvps, [personal.userId]: { ...entry, sentReminderMinutes: [...new Set([...(entry.sentReminderMinutes || []), personal.minutes])] } } }, meta);
        result.personalReminders += 1;
      }
      if (event.status === 'scheduled' && !event.startMessageSent && timestamp >= new Date(event.startAt).getTime()) {
        event = saveEvent(guild.id, { ...event, startedAt: event.startedAt || now(), startMessageSent: true }, meta);
      }
      if (event.status === 'scheduled' && timestamp >= new Date(event.endAt).getTime()) {
        event = saveEvent(guild.id, { ...event, status: 'completed', completedAt: now() }, meta);
        result.completed += 1;
        const next = nextOccurrence(event);
        if (next) { saveEvent(guild.id, next, meta); result.recurrences += 1; }
      }
    } catch (error) {
      saveEvent(guild.id, { ...original, lastError: error.message }, meta);
      result.failures += 1;
    }
  }
  incrementAnalytics(guild.id, { remindersSent: result.reminders, personalRemindersSent: result.personalReminders, notificationsSent: result.notifications, completed: result.completed, failures: result.failures, lastProcessedAt: now() }, meta);
  return result;
}

async function buildHealth(guild) {
  const section = getSection(guild.id); const issues = []; const warnings = [];
  for (const event of listEvents(guild.id)) {
    if (event.channelId) {
      const channel = guild.channels.cache.get(event.channelId) || await guild.channels.fetch(event.channelId).catch(() => null);
      if (!channel?.send) issues.push({ code: 'channel_unavailable', eventId: event.eventId, channelId: event.channelId });
    } else warnings.push({ code: 'channel_missing', eventId: event.eventId });
    if (!validTimezone(event.timezone)) issues.push({ code: 'timezone_invalid', eventId: event.eventId, timezone: event.timezone });
    if (event.mirrorDiscordEvent && !guild.members.me?.permissions.has(PermissionFlagsBits.ManageEvents)) warnings.push({ code: 'manage_events_missing', eventId: event.eventId });
    if (event.thread.enabled && !guild.members.me?.permissions.has(PermissionFlagsBits.CreatePublicThreads)) warnings.push({ code: 'create_threads_missing', eventId: event.eventId });
    if (event.lastError) warnings.push({ code: 'last_error', eventId: event.eventId, error: event.lastError });
  }
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) issues.push({ code: 'send_messages_missing' });
  return { module: SECTION, guildId: guild.id, healthy: issues.length === 0, enabled: guildManager.isModuleEnabled(guild.id, SECTION), eventCount: Object.keys(section.events).length, upcomingCount: listEvents(guild.id, { status: 'scheduled' }).length, issues, warnings, checkedAt: now() };
}
async function repair(guild, meta = {}) {
  const section = getSection(guild.id); const events = {};
  for (const event of Object.values(section.events)) {
    let channelId = event.channelId;
    if (channelId) { const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null); if (!channel?.send) channelId = null; }
    events[event.eventId] = normalizeEvent({ ...event, channelId, lastError: null }, section.settings);
  }
  saveSection(guild.id, { ...section, events }, meta);
  return buildHealth(guild);
}
async function startup(client) {
  if (client.__goliathScheduleStarted) return client.__goliathScheduleStarted;
  const run = async () => { for (const guild of client.guilds.cache.values()) await processGuild(guild, { action: 'schedule_startup_process' }).catch((error) => console.warn(`[Schedule] ${guild.id}: ${error.message}`)); };
  await run(); const timer = setInterval(run, REMINDER_TICK_MS); timer.unref?.(); client.__goliathScheduleStarted = timer; return timer;
}

module.exports = {
  SECTION, RSVP_STATES, RECURRENCE_TYPES, REMINDER_TICK_MS,
  defaultSection, defaultRsvpOptions, normalizeEvent, normalizeRecurrence, normalizeRsvpOptions, normalizeNotifications,
  getSection, saveSection, updateSection, listEvents, getEvent, setEnabled, updateSettings, incrementAnalytics,
  saveEvent, removeEvent, cancelEvent, duplicateEvent,
  saveTemplate, removeTemplate, listTemplates, createFromTemplate,
  getRsvpOption, isAttendeeStatus, attendeeCount, rsvpCounts, isRsvpOpen, memberRoleAllowed, promoteWaitlist,
  setRsvp, removeRsvp, setMemberReminder, setAutoJoinNext, findOverlaps,
  nextOccurrence, dueReminders, dueNotifications, duePersonalReminders, processGuild, buildHealth, repair, startup,
  exportConfiguration: getSection,
  reset: (guildId, meta = {}) => saveSection(guildId, defaultSection(), meta),
};