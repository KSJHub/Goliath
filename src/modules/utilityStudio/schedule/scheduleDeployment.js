'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const schedule = require('./schedule');

const STATUS_COLOURS = Object.freeze({ scheduled: 0x5865F2, completed: 0x57F287, cancelled: 0xED4245 });
const STYLE = Object.freeze({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger });

function unix(value) { return Math.floor(new Date(value).getTime() / 1000); }
function row(...components) { return new ActionRowBuilder().addComponents(...components.filter(Boolean)); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false, emoji = null) {
  const item = new ButtonBuilder().setCustomId(id).setLabel(String(label).slice(0, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) item.setEmoji(emoji);
  return item;
}
function linkButton(label, url, emoji = null) {
  const item = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  if (emoji) item.setEmoji(emoji);
  return item;
}
function attendeeText(event, status, limit = 12) {
  const users = Object.values(event.rsvps || {}).filter((entry) => entry.status === status);
  if (!users.length) return 'None';
  const shown = users.slice(0, limit).map((entry) => `<@${entry.userId}>`).join(', ');
  return users.length > limit ? `${shown} and ${users.length - limit} more` : shown;
}
function recurrenceText(event) {
  const recurrence = event.recurrence || {};
  if (!recurrence.type || recurrence.type === 'none') return 'One-off';
  const every = recurrence.interval > 1 ? `every ${recurrence.interval} ${recurrence.type}s` : recurrence.type;
  const end = recurrence.count ? ` · ${recurrence.count} occurrence(s)` : recurrence.until ? ` · until <t:${unix(recurrence.until)}:D>` : '';
  return `${every}${end}`;
}
function calendarUrl(event) {
  const compact = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compact(event.startAt)}/${compact(event.endAt)}`,
    details: event.description || '',
    location: event.location || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildEventPayload(event) {
  const counts = schedule.rsvpCounts(event);
  const isOpen = schedule.isRsvpOpen(event);
  const capacity = event.capacity ? `${schedule.attendeeCount(event)}/${event.capacity}` : String(schedule.attendeeCount(event));
  const fields = [
    { name: 'When', value: `<t:${unix(event.startAt)}:F>\n<t:${unix(event.startAt)}:R>`, inline: true },
    { name: 'Duration', value: `<t:${unix(event.startAt)}:t>–<t:${unix(event.endAt)}:t>`, inline: true },
    { name: 'Timezone', value: event.timezone, inline: true },
    { name: 'Attending', value: capacity, inline: true },
    { name: 'RSVPs', value: isOpen ? 'Open ✅' : 'Closed 🔒', inline: true },
    { name: 'Recurrence', value: recurrenceText(event), inline: true },
  ];
  for (const option of (event.rsvpOptions || []).filter((item) => item.enabled !== false).slice(0, 8)) {
    fields.push({ name: `${option.emoji || ''} ${option.label}`.trim(), value: `${counts[option.key] || 0}\n${attendeeText(event, option.key)}`, inline: false });
  }
  if (event.waitlistEnabled) fields.push({ name: '⏳ Waitlist', value: `${counts.waitlist || 0}\n${attendeeText(event, 'waitlist')}`, inline: false });
  if (event.voiceChannelId) fields.push({ name: 'Voice channel', value: `<#${event.voiceChannelId}>`, inline: true });
  if (event.location) fields.push({ name: 'Location', value: event.location, inline: true });
  if (event.hostUserId) fields.push({ name: 'Host', value: `<@${event.hostUserId}>`, inline: true });

  const embed = new EmbedBuilder()
    .setColor(event.color || STATUS_COLOURS[event.status] || STATUS_COLOURS.scheduled)
    .setTitle(event.title)
    .setDescription(event.description || 'No description provided.')
    .addFields(fields.slice(0, 25))
    .setFooter({ text: `Schedule · ${event.status.toUpperCase()} · ${event.eventId}` })
    .setTimestamp(new Date(event.updatedAt || Date.now()));

  const controls = [];
  const options = (event.rsvpOptions || []).filter((item) => item.enabled !== false).slice(0, 18);
  for (let index = 0; index < options.length; index += 4) {
    controls.push(row(...options.slice(index, index + 4).map((option) => button(
      `schedule:rsvp:${event.eventId}:set:${option.key}`,
      option.label,
      STYLE[option.style] || ButtonStyle.Secondary,
      !isOpen,
      option.emoji,
    ))));
  }
  controls.push(row(
    button(`schedule:rsvp:${event.eventId}:manage`, 'Manage RSVP', ButtonStyle.Primary, event.status !== 'scheduled', '⚙️'),
    button(`schedule:rsvp:${event.eventId}:remove`, 'Clear RSVP', ButtonStyle.Secondary, event.status !== 'scheduled', '🧹'),
    linkButton('Add to Calendar', calendarUrl(event), '📅'),
  ));
  return { embeds: [embed], components: controls.slice(0, 5) };
}

async function resolveChannel(guild, event, overrideChannelId = null) {
  const channelId = overrideChannelId || event.channelId;
  if (!channelId) throw new Error('An announcement channel is required.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || !channel?.messages?.fetch) throw new Error('The selected announcement channel is unavailable.');
  return channel;
}

async function syncDiscordEvent(guild, event) {
  if (!event) return { synced: false, reason: 'missing_event' };
  const shouldRemove = Boolean(event.discordEventId) && (event.status !== 'scheduled' || !event.mirrorDiscordEvent);
  if (shouldRemove) {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageEvents)) return { synced: false, reason: 'missing_permission' };
    await guild.scheduledEvents.delete(event.discordEventId).catch(() => null);
    schedule.saveEvent(guild.id, { ...event, discordEventId: null }, { action: 'schedule_native_event_removed' });
    return { synced: true, removed: true, reason: event.status !== 'scheduled' ? event.status : 'mirror_disabled' };
  }
  if (event.status !== 'scheduled') return { synced: false, reason: event.status };
  if (!event.mirrorDiscordEvent) return { synced: false, reason: 'disabled' };
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageEvents)) return { synced: false, reason: 'missing_permission' };
  const common = {
    name: event.title.slice(0, 100),
    description: (event.description || `Schedule event: ${event.title}`).slice(0, 1000),
    scheduledStartTime: new Date(event.startAt),
    scheduledEndTime: new Date(event.endAt),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    reason: 'Goliath Schedule native event mirror',
  };
  const options = event.voiceChannelId
    ? { ...common, entityType: GuildScheduledEventEntityType.Voice, channel: event.voiceChannelId }
    : { ...common, entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: event.location || 'Discord' } };
  let native = event.discordEventId ? await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null) : null;
  native = native ? await guild.scheduledEvents.edit(native.id, options) : await guild.scheduledEvents.create(options);
  if (!event.discordEventId && native?.id) schedule.incrementAnalytics(guild.id, { nativeEventsCreated: 1 }, { action: 'schedule_native_event_created' });
  if (native?.id !== event.discordEventId) schedule.saveEvent(guild.id, { ...event, discordEventId: native.id }, { action: 'schedule_native_event_synced' });
  return { synced: true, discordEventId: native.id };
}

async function ensureEventThread(guild, event, message) {
  if (!event.thread?.enabled || event.thread.threadId) return event.thread?.threadId || null;
  if (!message?.startThread) return null;
  const name = String(event.thread.title || '{event}').replaceAll('{event}', event.title).slice(0, 100);
  const thread = await message.startThread({ name, autoArchiveDuration: event.thread.autoArchiveDuration || 1440, reason: 'Goliath Schedule event thread' }).catch(() => null);
  if (!thread) return null;
  schedule.saveEvent(guild.id, { ...schedule.getEvent(guild.id, event.eventId), thread: { ...event.thread, threadId: thread.id } }, { action: 'schedule_thread_created' });
  schedule.incrementAnalytics(guild.id, { threadsCreated: 1 }, { action: 'schedule_thread_created' });
  return thread.id;
}

async function deploy(guild, eventId, channelId = null, meta = {}) {
  if (!guild?.id) throw new Error('Guild is required.');
  if (!guildManager.isModuleEnabled(guild.id, 'schedule')) throw new Error('Schedule is disabled for this server.');
  let event = schedule.getEvent(guild.id, eventId);
  if (!event) throw new Error('Schedule event not found.');
  const channel = await resolveChannel(guild, event, channelId);
  const mentions = event.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
  const message = await channel.send({ content: mentions || undefined, allowedMentions: { roles: event.mentionRoleIds }, ...buildEventPayload(event) });
  event = schedule.saveEvent(guild.id, { ...event, channelId: channel.id, messageId: message.id, lastError: null }, { ...meta, action: 'schedule_deploy' });
  await ensureEventThread(guild, event, message);
  await syncDiscordEvent(guild, schedule.getEvent(guild.id, event.eventId) || event).catch((error) => {
    schedule.saveEvent(guild.id, { ...schedule.getEvent(guild.id, event.eventId), lastError: `Native event: ${error.message}` }, meta);
  });
  return schedule.getEvent(guild.id, event.eventId);
}

async function updateDeployment(guild, eventId) {
  if (!guild?.id) throw new Error('Guild is required.');
  if (!guildManager.isModuleEnabled(guild.id, 'schedule')) return { updated: false, reason: 'module_disabled' };
  const event = schedule.getEvent(guild.id, eventId);
  if (!event?.channelId || !event?.messageId) {
    if (event?.discordEventId) await syncDiscordEvent(guild, event).catch(() => null);
    return { updated: false, reason: 'not_deployed' };
  }
  const channel = await resolveChannel(guild, event);
  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (!message) {
    await syncDiscordEvent(guild, event).catch(() => null);
    return { updated: false, reason: 'message_missing' };
  }
  await message.edit(buildEventPayload(event));
  await syncDiscordEvent(guild, event).catch(() => null);
  return { updated: true, channelId: channel.id, messageId: message.id };
}

async function removeDeployment(guild, eventId, meta = {}) {
  const event = schedule.getEvent(guild.id, eventId);
  if (!event) return false;
  if (event.channelId && event.messageId) {
    const channel = await resolveChannel(guild, event).catch(() => null);
    const message = channel ? await channel.messages.fetch(event.messageId).catch(() => null) : null;
    await message?.delete().catch(() => null);
  }
  if (event.discordEventId) await guild.scheduledEvents.delete(event.discordEventId).catch(() => null);
  schedule.saveEvent(guild.id, { ...event, messageId: null, discordEventId: null }, { ...meta, action: 'schedule_remove_deployment' });
  return true;
}

async function syncAttendeeRole(member, event, previousStatus, nextStatus) {
  if (!member) return;
  const previousRole = schedule.getRsvpOption(event, previousStatus)?.roleId || null;
  const nextRole = schedule.getRsvpOption(event, nextStatus)?.roleId || null;
  if (previousRole && previousRole !== nextRole && member.roles.cache.has(previousRole)) await member.roles.remove(previousRole, 'Goliath Schedule RSVP role change').catch(() => null);
  if (nextRole && !member.roles.cache.has(nextRole)) await member.roles.add(nextRole, 'Goliath Schedule RSVP role').catch(() => null);
}

async function addToThread(guild, event, member) {
  if (!event.thread?.threadId || !event.thread.addAttendeesOnRsvp || !member) return;
  const thread = guild.channels.cache.get(event.thread.threadId) || await guild.channels.fetch(event.thread.threadId).catch(() => null);
  await thread?.members?.add?.(member.id).catch(() => null);
}

async function syncPromotedMember(guild, event, userId) {
  if (!userId) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return null;
  const status = event.rsvps?.[userId]?.status || null;
  await syncAttendeeRole(member, event, 'waitlist', status);
  if (schedule.isAttendeeStatus(event, status)) await addToThread(guild, event, member);
  await member.user?.send?.(`✅ A place opened up for **${event.title}** and you have been promoted from the waitlist.`).catch(() => null);
  return member;
}

function managePayload(event, userId) {
  const entry = event.rsvps?.[userId];
  const reminderText = entry?.reminderMinutes?.length ? entry.reminderMinutes.map((m) => m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`).join(', ') : 'None';
  return {
    content: [
      `**${event.title}**`,
      `Your RSVP: **${entry?.status || 'None'}**`,
      `Personal reminders: **${reminderText}**`,
      event.recurrence?.type !== 'none' ? `Auto Join Next: **${entry?.autoJoinNext ? 'On' : 'Off'}**` : null,
    ].filter(Boolean).join('\n'),
    components: [row(
      button(`schedule:rsvp:${event.eventId}:reminders`, 'Set Reminders', ButtonStyle.Primary, !entry, '⏰'),
      event.recurrence?.type !== 'none' && event.recurrence?.autoJoinNextAllowed ? button(`schedule:rsvp:${event.eventId}:autojoin`, entry?.autoJoinNext ? 'Auto Join: On' : 'Auto Join: Off', entry?.autoJoinNext ? ButtonStyle.Success : ButtonStyle.Secondary, !entry, '🔁') : null,
      button(`schedule:rsvp:${event.eventId}:attendees`, 'View Attendees', ButtonStyle.Secondary, false, '👥'),
    )],
    flags: 64,
  };
}

function reminderModal(event, entry) {
  const current = entry?.reminderMinutes?.join(', ') || '60, 10';
  return new ModalBuilder().setCustomId(`schedule:rsvp:${event.eventId}:reminderModal`).setTitle('Event Reminders').addComponents(
    row(new TextInputBuilder().setCustomId('minutes').setLabel('Minutes before event').setStyle(TextInputStyle.Short).setRequired(false).setValue(current).setPlaceholder('1440, 60, 10')),
  );
}

async function handleMemberInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('schedule:rsvp:')) return false;
  if (!interaction.guildId || !guildManager.isModuleEnabled(interaction.guildId, 'schedule')) {
    await interaction.reply({ content: '❌ Schedule is currently disabled for this server.', flags: 64 }).catch(() => null);
    return true;
  }
  const parts = id.split(':');
  const eventId = parts[2];
  const action = parts[3] || '';
  const value = parts.slice(4).join(':');
  let event = schedule.getEvent(interaction.guildId, eventId);
  if (!event) throw new Error('Schedule event not found.');

  if (action === 'manage') { await interaction.reply(managePayload(event, interaction.user.id)); return true; }
  if (action === 'attendees') {
    const lines = Object.values(event.rsvps || {}).slice(0, 80).map((entry) => `<@${entry.userId}> — **${entry.status}**`);
    await interaction.reply({ content: lines.length ? lines.join('\n') : 'Nobody has RSVP’d yet.', flags: 64, allowedMentions: { parse: [] } });
    return true;
  }
  if (action === 'reminders') {
    await interaction.showModal(reminderModal(event, event.rsvps?.[interaction.user.id]));
    return true;
  }
  if (action === 'reminderModal' && interaction.isModalSubmit?.()) {
    const raw = interaction.fields.getTextInputValue('minutes');
    const minutes = raw.split(',').map((item) => Number(item.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    event = schedule.setMemberReminder(interaction.guildId, eventId, interaction.user.id, minutes, { actorId: interaction.user.id, action: 'schedule_personal_reminders' });
    await interaction.reply({ content: `✅ Personal reminders updated for **${event.title}**.`, flags: 64 });
    return true;
  }
  if (action === 'autojoin') {
    const current = event.rsvps?.[interaction.user.id];
    event = schedule.setAutoJoinNext(interaction.guildId, eventId, interaction.user.id, !current?.autoJoinNext, { actorId: interaction.user.id, action: 'schedule_auto_join_next' });
    await interaction.reply(managePayload(event, interaction.user.id));
    return true;
  }

  const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const memberRoleIds = member ? [...member.roles.cache.keys()] : [];
  let result;
  if (action === 'remove') {
    result = schedule.removeRsvp(interaction.guildId, eventId, interaction.user.id, { actorId: interaction.user.id, action: 'schedule_rsvp_remove' });
  } else if (action === 'set') {
    result = schedule.setRsvp(interaction.guildId, eventId, interaction.user.id, value, { actorId: interaction.user.id, action: 'schedule_rsvp_set', memberRoleIds });
  } else {
    result = schedule.setRsvp(interaction.guildId, eventId, interaction.user.id, action, { actorId: interaction.user.id, action: 'schedule_rsvp_set', memberRoleIds });
  }
  if (!result) throw new Error('Schedule event not found.');
  event = result.event;
  await syncAttendeeRole(member, event, result.previousStatus, action === 'remove' ? null : result.status);
  if (action !== 'remove' && schedule.isAttendeeStatus(event, result.status)) await addToThread(interaction.guild, event, member);
  if (result.promotedUserId) await syncPromotedMember(interaction.guild, event, result.promotedUserId);
  await interaction.update(buildEventPayload(event));
  const overlaps = schedule.getSection(interaction.guildId).settings.warnOverlaps && action !== 'remove' && schedule.isAttendeeStatus(event, result.status)
    ? schedule.findOverlaps(interaction.guildId, interaction.user.id, eventId)
    : [];
  const label = action === 'remove' ? 'cleared' : result.status;
  await interaction.followUp({
    content: [
      `Your RSVP is now **${label}**.`,
      result.promotedUserId ? `<@${result.promotedUserId}> was promoted from the waitlist.` : null,
      overlaps.length ? `⚠️ This overlaps with: ${overlaps.slice(0, 3).map((item) => `**${item.title}**`).join(', ')}.` : null,
      action !== 'remove' ? 'Use **Manage RSVP** to set personal reminders.' : null,
    ].filter(Boolean).join('\n '),
    flags: 64,
    allowedMentions: { users: result.promotedUserId ? [result.promotedUserId] : [] },
  });
  return true;
}

module.exports = {
  buildEventPayload,
  calendarUrl,
  syncDiscordEvent,
  ensureEventThread,
  deploy,
  updateDeployment,
  removeDeployment,
  handleMemberInteraction,
};
