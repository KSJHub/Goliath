'use strict';

const schedule = require('./schedule');

const REMINDER_TICK_MS = schedule.REMINDER_TICK_MS;

function dueReminders(event, timestamp = Date.now()) {
  return schedule.dueReminders(event, timestamp);
}

async function sendReminder(guild, event, minutes) {
  const channel = event.channelId ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
  if (!channel?.send) throw new Error('Schedule reminder channel is unavailable.');
  const mentions = event.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
  const unix = Math.floor(new Date(event.startAt).getTime() / 1000);
  await channel.send({
    content: `${mentions ? `${mentions} ` : ''}**${event.title}** starts <t:${unix}:R> (<t:${unix}:F>).`,
    allowedMentions: { roles: event.mentionRoleIds },
  });
}

async function processGuild(guild, meta = {}) {
  return schedule.processGuild(guild, meta);
}

async function buildHealth(guild) {
  return schedule.buildHealth(guild);
}

async function repair(guild, meta = {}) {
  return schedule.repair(guild, meta);
}

async function startup(client) {
  return schedule.startup(client);
}

module.exports = {
  REMINDER_TICK_MS,
  dueReminders,
  sendReminder,
  processGuild,
  buildHealth,
  repair,
  startup,
};