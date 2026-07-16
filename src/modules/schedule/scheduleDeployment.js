'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const schedule = require('./schedule');

const STATUS_COLOURS = Object.freeze({ scheduled: 0x5865F2, completed: 0x57F287, cancelled: 0xED4245 });

function unix(value) { return Math.floor(new Date(value).getTime() / 1000); }
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, style, disabled = false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }

function attendeeText(event, status, limit = 12) {
  const users = Object.values(event.rsvps || {}).filter((entry) => entry.status === status);
  if (!users.length) return 'None';
  const shown = users.slice(0, limit).map((entry) => `<@${entry.userId}>`).join(', ');
  return users.length > limit ? `${shown} and ${users.length - limit} more` : shown;
}

function buildEventPayload(event) {
  const counts = schedule.rsvpCounts(event);
  const isOpen = event.status === 'scheduled';
  const capacity = event.capacity ? `${counts.going}/${event.capacity}` : String(counts.going);
  const recurrence = event.recurrence?.type && event.recurrence.type !== 'none'
    ? `${event.recurrence.type} · every ${event.recurrence.interval || 1}`
    : 'One-off';
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOURS[event.status] || STATUS_COLOURS.scheduled)
    .setTitle(event.title)
    .setDescription(event.description || 'No description provided.')
    .addFields(
      { name: 'When', value: `<t:${unix(event.startAt)}:F>\n<t:${unix(event.startAt)}:R>`, inline: true },
      { name: 'Duration', value: `<t:${unix(event.startAt)}:t>–<t:${unix(event.endAt)}:t>`, inline: true },
      { name: 'Timezone', value: event.timezone, inline: true },
      { name: 'Going', value: `${capacity}\n${attendeeText(event, 'going')}`, inline: false },
      ...(event.allowMaybe ? [{ name: 'Maybe', value: `${counts.maybe}\n${attendeeText(event, 'maybe')}`, inline: true }] : []),
      ...(event.waitlistEnabled ? [{ name: 'Waitlist', value: `${counts.waitlist}\n${attendeeText(event, 'waitlist')}`, inline: true }] : []),
      { name: 'Recurrence', value: recurrence, inline: true },
      ...(event.voiceChannelId ? [{ name: 'Voice channel', value: `<#${event.voiceChannelId}>`, inline: true }] : []),
      ...(event.hostUserId ? [{ name: 'Host', value: `<@${event.hostUserId}>`, inline: true }] : []),
    )
    .setFooter({ text: `Schedule · ${event.status.toUpperCase()} · ${event.eventId}` })
    .setTimestamp(new Date(event.updatedAt || Date.now()));

  const components = [row(
    button(`schedule:rsvp:${event.eventId}:going`, counts.going >= event.capacity && event.capacity ? 'Join Waitlist' : 'Going', ButtonStyle.Success, !isOpen),
    button(`schedule:rsvp:${event.eventId}:maybe`, 'Maybe', ButtonStyle.Primary, !isOpen || !event.allowMaybe),
    button(`schedule:rsvp:${event.eventId}:declined`, 'Decline', ButtonStyle.Secondary, !isOpen),
    button(`schedule:rsvp:${event.eventId}:remove`, 'Clear RSVP', ButtonStyle.Danger, !isOpen),
  )];

  return { embeds: [embed], components };
}

async function resolveChannel(guild, event, overrideChannelId = null) {
  const channelId = overrideChannelId || event.channelId;
  if (!channelId) throw new Error('An announcement channel is required.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send || !channel?.messages?.fetch) throw new Error('The selected announcement channel is unavailable.');
  return channel;
}

async function deploy(guild, eventId, channelId = null, meta = {}) {
  const event = schedule.getEvent(guild.id, eventId);
  if (!event) throw new Error('Schedule event not found.');
  const channel = await resolveChannel(guild, event, channelId);
  const mentions = event.mentionRoleIds.map((id) => `<@&${id}>`).join(' ');
  const message = await channel.send({
    content: mentions || undefined,
    allowedMentions: { roles: event.mentionRoleIds },
    ...buildEventPayload(event),
  });
  return schedule.saveEvent(guild.id, { ...event, channelId: channel.id, messageId: message.id, lastError: null }, { ...meta, action: 'schedule_deploy' });
}

async function updateDeployment(guild, eventId) {
  const event = schedule.getEvent(guild.id, eventId);
  if (!event?.channelId || !event?.messageId) return { updated: false, reason: 'not_deployed' };
  const channel = await resolveChannel(guild, event);
  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (!message) return { updated: false, reason: 'message_missing' };
  await message.edit(buildEventPayload(event));
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
  schedule.saveEvent(guild.id, { ...event, messageId: null }, { ...meta, action: 'schedule_remove_deployment' });
  return true;
}

async function handleMemberInteraction(interaction) {
  if (!interaction.isButton?.() || !String(interaction.customId).startsWith('schedule:rsvp:')) return false;
  const [, , eventId, status] = interaction.customId.split(':');
  const result = status === 'remove'
    ? schedule.removeRsvp(interaction.guildId, eventId, interaction.user.id, { actorId: interaction.user.id, action: 'schedule_rsvp_remove' })
    : schedule.setRsvp(interaction.guildId, eventId, interaction.user.id, status, { actorId: interaction.user.id, action: 'schedule_rsvp_set' });
  if (!result) throw new Error('Schedule event not found.');
  await interaction.update(buildEventPayload(result.event));
  const label = status === 'remove' ? 'cleared' : result.status;
  await interaction.followUp({ content: `Your RSVP is now **${label}**.${result.promotedUserId ? ` <@${result.promotedUserId}> was promoted from the waitlist.` : ''}`, flags: 64, allowedMentions: { users: result.promotedUserId ? [result.promotedUserId] : [] } });
  return true;
}

module.exports = { buildEventPayload, deploy, updateDeployment, removeDeployment, handleMemberInteraction };
