'use strict';

const schedule = require('./schedule');
const deployment = require('./scheduleDeployment');
const guildManager = require('../../../core/guild/guildManager');
const sentinelScheduler = require('../../../owner/sentinel/schedulerRegistry.js');

const REMINDER_TICK_MS = 60 * 1000;
const SCHEDULER_ID = 'schedule:processor:global';
const timers = new WeakMap();
const cleanedRoleEvents = new Set();

function shiftedRsvpCloseAt(parent, occurrence) {
  if (!parent?.rsvpCloseAt) return null;
  const parentStart = new Date(parent.startAt).getTime();
  const parentClose = new Date(parent.rsvpCloseAt).getTime();
  const occurrenceStart = new Date(occurrence.startAt).getTime();
  if (![parentStart, parentClose, occurrenceStart].every(Number.isFinite)) return null;
  return new Date(occurrenceStart + (parentClose - parentStart)).toISOString();
}

function resetRecurringRuntime(parent, occurrence) {
  const rsvps = Object.fromEntries(Object.entries(occurrence.rsvps || {}).map(([userId, entry]) => [userId, {
    ...entry,
    sentReminderMinutes: [],
    promotedAt: null,
    updatedAt: new Date().toISOString(),
  }]));
  return {
    ...occurrence,
    rsvpCloseAt: shiftedRsvpCloseAt(parent, occurrence),
    rsvps,
    startedAt: null,
    startMessageSent: false,
    lastError: null,
  };
}

function roleNeededByAnotherScheduledEvent(guildId, endedEventId, userId, roleId) {
  return schedule.listEvents(guildId, { status: 'scheduled' }).some((event) => {
    if (event.eventId === endedEventId) return false;
    const entry = event.rsvps?.[userId];
    if (!entry || !schedule.isAttendeeStatus(event, entry.status)) return false;
    return schedule.getRsvpOption(event, entry.status)?.roleId === roleId;
  });
}

async function cleanupEndedEventRoles(guild, event) {
  if (!event || event.status === 'scheduled' || cleanedRoleEvents.has(event.eventId)) return;
  const failures = [];
  for (const [userId, entry] of Object.entries(event.rsvps || {})) {
    const roleId = schedule.getRsvpOption(event, entry.status)?.roleId || null;
    if (!roleId || roleNeededByAnotherScheduledEvent(guild.id, event.eventId, userId, roleId)) continue;
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member?.roles?.cache?.has(roleId)) continue;
    try {
      await member.roles.remove(roleId, `Goliath Schedule ${event.status} attendee role cleanup`);
    } catch (error) {
      failures.push(`${userId}:${roleId}:${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.slice(0, 3).join(' | '));
  cleanedRoleEvents.add(event.eventId);
}

async function reconcileProcessedGuild(guild, beforeEvents, action) {
  const before = new Map(beforeEvents.map((event) => [event.eventId, event]));
  let afterEvents = schedule.listEvents(guild.id);
  let after = new Map(afterEvents.map((event) => [event.eventId, event]));

  for (const [eventId, previous] of before.entries()) {
    const current = after.get(eventId);
    if (!current || previous.status === current.status) continue;
    if (current.messageId) {
      await deployment.updateDeployment(guild, eventId).catch((error) => {
        console.warn(`[Schedule] ${guild.id} deployment lifecycle sync failed for ${eventId}: ${error.message}`);
      });
    } else if (current.discordEventId) {
      await deployment.syncDiscordEvent(guild, current).catch((error) => {
        console.warn(`[Schedule] ${guild.id} native lifecycle sync failed for ${eventId}: ${error.message}`);
      });
    }
  }

  for (const original of [...afterEvents]) {
    if (before.has(original.eventId) || original.status !== 'scheduled' || original.messageId) continue;
    const parent = original.parentEventId ? before.get(original.parentEventId) || after.get(original.parentEventId) : null;
    if (!parent?.messageId || !original.channelId) continue;
    const normalizedOccurrence = resetRecurringRuntime(parent, original);
    const current = schedule.saveEvent(guild.id, normalizedOccurrence, { action: `${action}_recurrence_runtime_reset` });
    after.set(current.eventId, current);
    await deployment.deploy(guild, current.eventId, current.channelId, { action: `${action}_recurrence_deploy` }).catch((error) => {
      schedule.saveEvent(guild.id, { ...current, lastError: `Recurring deployment: ${error.message}` }, { action: `${action}_recurrence_deploy_failed` });
      console.warn(`[Schedule] ${guild.id} recurring event deployment failed for ${current.eventId}: ${error.message}`);
    });
  }

  afterEvents = schedule.listEvents(guild.id);
  for (const event of afterEvents) {
    if (event.status === 'scheduled') continue;
    await cleanupEndedEventRoles(guild, event).catch((error) => {
      console.warn(`[Schedule] ${guild.id} attendee role cleanup failed for ${event.eventId}: ${error.message}`);
    });
  }
}

async function processAllGuilds(client, action) {
  if (!client?.guilds?.cache) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  for (const guild of client.guilds.cache.values()) {
    if (!guildManager.isModuleEnabled(guild.id, 'schedule')) continue;
    const beforeEvents = schedule.listEvents(guild.id);
    try {
      await schedule.processGuild(guild, { action });
      await reconcileProcessedGuild(guild, beforeEvents, action);
      processed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[Schedule] ${guild.id}: ${error.message}`);
    }
  }
  return { processed, failed };
}

async function monitoredProcessAllGuilds(client, action) {
  try {
    const result = await processAllGuilds(client, action);
    if (result.failed) {
      sentinelScheduler.fail(SCHEDULER_ID, new Error(`${result.failed} schedule guild processor(s) failed.`), {
        action,
        guildsProcessed: result.processed,
        guildFailures: result.failed,
      });
    } else {
      sentinelScheduler.beat(SCHEDULER_ID, {
        action,
        guildsProcessed: result.processed,
        guildFailures: 0,
      });
    }
    return result;
  } catch (error) {
    sentinelScheduler.fail(SCHEDULER_ID, error, { action });
    throw error;
  }
}

async function startup(client) {
  if (!client?.guilds?.cache) throw new Error('Discord client is unavailable.');
  if (timers.has(client)) return timers.get(client);

  sentinelScheduler.register({
    id: SCHEDULER_ID,
    module: 'schedule',
    component: 'processor',
    intervalMs: REMINDER_TICK_MS,
    staleAfterMs: Math.max(REMINDER_TICK_MS * 3, 180_000),
    details: { scope: 'all-guilds' },
  });

  await monitoredProcessAllGuilds(client, 'schedule_startup_process');

  const timer = setInterval(() => {
    monitoredProcessAllGuilds(client, 'schedule_interval_process').catch((error) => {
      console.warn(`[Schedule] Processing failed: ${error.message}`);
    });
  }, REMINDER_TICK_MS);

  timer.unref?.();
  timers.set(client, timer);
  return timer;
}

function shutdown(client) {
  const timer = timers.get(client);
  if (!timer) return false;
  clearInterval(timer);
  timers.delete(client);
  sentinelScheduler.stop(SCHEDULER_ID, 'schedule processor shutdown');
  return true;
}

module.exports = {
  REMINDER_TICK_MS,
  SCHEDULER_ID,
  startup,
  shutdown,
  processAllGuilds,
  monitoredProcessAllGuilds,
};
