'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const schedule = require('./schedule');

function now() { return new Date().toISOString(); }

async function buildHealthReport(guild) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const section = schedule.getSection(guild.id);
  const issues = [];
  const warnings = [];
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionFlagsBits.SendMessages)) issues.push({ code: 'send_messages_missing' });
  if (!me?.permissions.has(PermissionFlagsBits.EmbedLinks)) warnings.push({ code: 'embed_links_missing' });

  for (const event of schedule.listEvents(guild.id)) {
    if (!event.channelId) warnings.push({ code: 'channel_missing', eventId: event.eventId });
    else {
      const channel = guild.channels.cache.get(event.channelId) || await guild.channels.fetch(event.channelId).catch(() => null);
      if (!channel?.send) issues.push({ code: 'channel_unavailable', eventId: event.eventId, channelId: event.channelId });
    }
    try { new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone }).format(new Date()); }
    catch { issues.push({ code: 'timezone_invalid', eventId: event.eventId, timezone: event.timezone }); }

    if (event.voiceChannelId && !guild.channels.cache.has(event.voiceChannelId)) warnings.push({ code: 'voice_channel_missing', eventId: event.eventId, channelId: event.voiceChannelId });
    for (const roleId of [...event.mentionRoleIds, ...event.allowedRoleIds, ...event.deniedRoleIds]) if (!guild.roles.cache.has(roleId)) warnings.push({ code: 'role_missing', eventId: event.eventId, roleId });
    for (const option of event.rsvpOptions || []) {
      if (!option.roleId) continue;
      const role = guild.roles.cache.get(option.roleId);
      if (!role) warnings.push({ code: 'attendee_role_missing', eventId: event.eventId, roleId: option.roleId });
      else if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) warnings.push({ code: 'attendee_role_unmanageable', eventId: event.eventId, roleId: option.roleId });
    }
    if (event.mirrorDiscordEvent && !me?.permissions.has(PermissionFlagsBits.ManageEvents)) warnings.push({ code: 'manage_events_missing', eventId: event.eventId });
    if (event.thread.enabled && !me?.permissions.has(PermissionFlagsBits.CreatePublicThreads)) warnings.push({ code: 'create_threads_missing', eventId: event.eventId });
    if (event.discordEventId) {
      const native = await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null);
      if (!native) warnings.push({ code: 'native_event_missing', eventId: event.eventId, discordEventId: event.discordEventId });
    }
    if (event.thread.threadId && !guild.channels.cache.has(event.thread.threadId)) warnings.push({ code: 'thread_missing', eventId: event.eventId, threadId: event.thread.threadId });
    if (event.lastError) warnings.push({ code: 'last_error', eventId: event.eventId, error: event.lastError });
  }

  return {
    module: 'schedule', guildId: guild.id, healthy: issues.length === 0,
    enabled: guildManager.isModuleEnabled(guild.id, 'schedule'),
    eventCount: Object.keys(section.events).length,
    upcomingCount: schedule.listEvents(guild.id, { status: 'scheduled' }).length,
    templateCount: schedule.listTemplates(guild.id).length,
    issues, warnings, checkedAt: now(),
  };
}

async function repair(guild, meta = {}) {
  if (!guild?.id) throw new Error('Guild is unavailable.');
  const section = schedule.getSection(guild.id);
  const events = {};
  for (const event of Object.values(section.events)) {
    let channelId = event.channelId;
    if (channelId) {
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.send) channelId = null;
    }
    const voiceChannelId = event.voiceChannelId && guild.channels.cache.has(event.voiceChannelId) ? event.voiceChannelId : null;
    const validRoles = (ids) => (ids || []).filter((id) => guild.roles.cache.has(id));
    const rsvpOptions = (event.rsvpOptions || []).map((option) => ({ ...option, roleId: option.roleId && guild.roles.cache.has(option.roleId) ? option.roleId : null }));
    events[event.eventId] = schedule.normalizeEvent({
      ...event,
      channelId,
      voiceChannelId,
      mentionRoleIds: validRoles(event.mentionRoleIds),
      allowedRoleIds: validRoles(event.allowedRoleIds),
      deniedRoleIds: validRoles(event.deniedRoleIds),
      rsvpOptions,
      discordEventId: event.discordEventId && await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null) ? event.discordEventId : null,
      thread: { ...event.thread, threadId: event.thread.threadId && guild.channels.cache.has(event.thread.threadId) ? event.thread.threadId : null },
      lastError: null,
      updatedAt: now(),
    }, section.settings);
  }
  schedule.saveSection(guild.id, { ...section, events, updatedAt: now() }, { action: 'schedule_health_repair', ...meta });
  return buildHealthReport(guild);
}

module.exports = { buildHealthReport, repair };
