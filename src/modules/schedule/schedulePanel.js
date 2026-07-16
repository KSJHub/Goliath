'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const schedule = require('./schedule');
const deployment = require('./scheduleDeployment');

const sessions = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const clean = (value, max = 100) => String(value || '').trim().slice(0, max);
const sessionKey = (interaction) => `${interaction.guildId}:${interaction.user.id}`;

function getState(interaction) {
  const events = schedule.listEvents(interaction.guildId);
  const current = sessions.get(sessionKey(interaction)) || { eventId: events.find((event) => event.status === 'scheduled')?.eventId || events[0]?.eventId || null, channelId: null };
  if (current.eventId && !events.some((event) => event.eventId === current.eventId)) current.eventId = events[0]?.eventId || null;
  sessions.set(sessionKey(interaction), current);
  return current;
}

function eventSelect(guildId, state) {
  const events = schedule.listEvents(guildId).slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:schedule:event')
    .setPlaceholder(events.length ? 'Select an event' : 'No events created')
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!events.length);
  if (events.length) menu.addOptions(events.map((event) => ({
    label: clean(event.title, 100),
    description: clean(`${event.status} · ${new Date(event.startAt).toLocaleString('en-GB')}`, 100),
    value: event.eventId,
    default: event.eventId === state.eventId,
  })));
  return row(menu);
}

function channelSelect(state) {
  return row(new ChannelSelectMenuBuilder()
    .setCustomId('admin:schedule:channel')
    .setPlaceholder('Select announcement channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1)
    .setDefaultChannels(state.channelId ? [state.channelId] : []));
}

function buildPanel(interaction) {
  const state = getState(interaction);
  const section = schedule.getSection(interaction.guildId);
  const event = state.eventId ? schedule.getEvent(interaction.guildId, state.eventId) : null;
  const counts = event ? schedule.rsvpCounts(event) : null;
  const upcoming = schedule.listEvents(interaction.guildId, { status: 'scheduled' });
  const embed = new EmbedBuilder()
    .setColor(section.enabled ? 0x5865F2 : 0x747F8D)
    .setTitle('Schedule Studio')
    .setDescription('Create, deploy and operate timezone-aware Discord events with RSVPs, reminders, recurrence and waitlists.')
    .addFields(
      { name: 'Module', value: section.enabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Upcoming', value: String(upcoming.length), inline: true },
      { name: 'Timezone', value: section.settings.defaultTimezone, inline: true },
      ...(event ? [
        { name: 'Selected event', value: `**${event.title}**\n<t:${Math.floor(new Date(event.startAt).getTime() / 1000)}:F>\nStatus: **${event.status}**`, inline: false },
        { name: 'Attendance', value: `Going: **${counts.going}${event.capacity ? `/${event.capacity}` : ''}** · Maybe: **${counts.maybe}** · Waitlist: **${counts.waitlist}**`, inline: false },
        { name: 'Deployment', value: event.messageId && event.channelId ? `<#${event.channelId}> · Message ${event.messageId}` : 'Not deployed', inline: false },
      ] : [{ name: 'Selected event', value: 'Create your first event to begin.', inline: false }]),
    )
    .setFooter({ text: 'Schedule Studio · Manage Server required' });

  return {
    embeds: [embed],
    components: [
      eventSelect(interaction.guildId, state),
      channelSelect(state),
      row(
        button('admin:schedule:create', 'Create Event', ButtonStyle.Success),
        button('admin:schedule:deploy', event?.messageId ? 'Update Deployment' : 'Deploy', ButtonStyle.Primary, !event),
        button('admin:schedule:duplicate', 'Duplicate', ButtonStyle.Secondary, !event),
        button('admin:schedule:cancel', 'Cancel Event', ButtonStyle.Danger, !event || event.status !== 'scheduled'),
      ),
      row(
        button('admin:schedule:toggle', section.enabled ? 'Disable Module' : 'Enable Module', section.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:schedule:process', 'Process Now', ButtonStyle.Primary),
        button('admin:schedule:health', 'Health'),
        button('admin:schedule:repair', 'Repair'),
        button('admin:schedule:refresh', 'Refresh'),
      ),
    ],
  };
}

function createModal() {
  return new ModalBuilder()
    .setCustomId('admin:schedule:createModal')
    .setTitle('Create Schedule Event')
    .addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel('Event title').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
      row(new TextInputBuilder().setCustomId('startAt').setLabel('Start time (ISO or YYYY-MM-DD HH:mm)').setStyle(TextInputStyle.Short).setPlaceholder('2026-07-20 19:00').setRequired(true)),
      row(new TextInputBuilder().setCustomId('timezone').setLabel('IANA timezone').setStyle(TextInputStyle.Short).setPlaceholder('Europe/London').setValue('UTC').setRequired(true)),
      row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setMaxLength(2000).setRequired(false)),
      row(new TextInputBuilder().setCustomId('options').setLabel('Duration, capacity, recurrence').setStyle(TextInputStyle.Short).setPlaceholder('60 | 20 | weekly').setRequired(false)),
    );
}

function parseStart(value, timezone) {
  const raw = String(value || '').trim();
  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime()) && /Z|[+-]\d\d:?\d\d$/.test(raw)) return direct.toISOString();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) {
    if (Number.isFinite(direct.getTime())) return direct.toISOString();
    throw new Error('Use an ISO date or YYYY-MM-DD HH:mm.');
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(target);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(probe);
  const found = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(found.year), Number(found.month) - 1, Number(found.day), Number(found.hour), Number(found.minute));
  return new Date(target + (target - represented)).toISOString();
}

async function respond(interaction, payload) {
  if (interaction.isModalSubmit?.()) return interaction.reply({ ...payload, flags: 64 });
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleScheduleAdminInteraction(interaction) {
  if (!String(interaction.customId || '').startsWith('admin:schedule')) return false;
  const state = getState(interaction);
  const id = interaction.customId;
  const actor = { actorId: interaction.user.id };
  try {
    if (id === 'admin:schedule:event') { state.eventId = interaction.values[0]; return respond(interaction, buildPanel(interaction)); }
    if (id === 'admin:schedule:channel') { state.channelId = interaction.values[0]; return respond(interaction, buildPanel(interaction)); }
    if (id === 'admin:schedule:create') { await interaction.showModal(createModal()); return true; }
    if (id === 'admin:schedule:createModal') {
      const options = interaction.fields.getTextInputValue('options').split('|').map((value) => value.trim());
      const timezone = interaction.fields.getTextInputValue('timezone').trim();
      const event = schedule.saveEvent(interaction.guildId, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        startAt: parseStart(interaction.fields.getTextInputValue('startAt'), timezone),
        timezone,
        durationMinutes: Number(options[0] || 60),
        capacity: options[1] || null,
        recurrence: { type: options[2] || 'none' },
        channelId: state.channelId,
        hostUserId: interaction.user.id,
        createdBy: interaction.user.id,
      }, { ...actor, action: 'schedule_discord_create' });
      state.eventId = event.eventId;
      return interaction.reply({ content: `✅ Created **${event.title}**.`, ...buildPanel(interaction), flags: 64 });
    }
    const event = state.eventId ? schedule.getEvent(interaction.guildId, state.eventId) : null;
    if (id === 'admin:schedule:deploy') {
      if (!event) throw new Error('Select an event first.');
      if (event.messageId) await deployment.updateDeployment(interaction.guild, event.eventId);
      else await deployment.deploy(interaction.guild, event.eventId, state.channelId, actor);
      return respond(interaction, buildPanel(interaction));
    }
    if (id === 'admin:schedule:duplicate') {
      if (!event) throw new Error('Select an event first.');
      const copy = schedule.duplicateEvent(interaction.guildId, event.eventId, new Date(new Date(event.startAt).getTime() + 7 * 86400000), { ...actor, action: 'schedule_discord_duplicate' });
      state.eventId = copy.eventId;
      return respond(interaction, buildPanel(interaction));
    }
    if (id === 'admin:schedule:cancel') {
      if (!event) throw new Error('Select an event first.');
      schedule.cancelEvent(interaction.guildId, event.eventId, { ...actor, action: 'schedule_discord_cancel' });
      await deployment.updateDeployment(interaction.guild, event.eventId).catch(() => null);
      return respond(interaction, buildPanel(interaction));
    }
    if (id === 'admin:schedule:toggle') {
      const section = schedule.getSection(interaction.guildId);
      schedule.setEnabled(interaction.guildId, !section.enabled, { ...actor, action: 'schedule_discord_toggle' });
      return respond(interaction, buildPanel(interaction));
    }
    if (id === 'admin:schedule:process') { await schedule.processGuild(interaction.guild, { ...actor, action: 'schedule_discord_process' }); return respond(interaction, buildPanel(interaction)); }
    if (id === 'admin:schedule:health') {
      const health = await schedule.buildHealth(interaction.guild);
      return interaction.reply({ content: `Schedule health: **${health.healthy ? 'Healthy' : 'Needs attention'}**\nIssues: ${health.issues.length}\nWarnings: ${health.warnings.length}`, flags: 64 });
    }
    if (id === 'admin:schedule:repair') { await schedule.repair(interaction.guild, { ...actor, action: 'schedule_discord_repair' }); return respond(interaction, buildPanel(interaction)); }
    return respond(interaction, buildPanel(interaction));
  } catch (error) {
    const payload = { content: `❌ Schedule Studio failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { buildSchedulePanel: buildPanel, handleScheduleAdminInteraction };
