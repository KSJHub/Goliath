'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const rooms = require('./privateRooms');

const sessions = new Map();
const PANEL_COLOR = 0x5865F2;
const SUCCESS_COLOR = 0x57F287;
const WARNING_COLOR = 0xFEE75C;
const DANGER_COLOR = 0xED4245;

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, emoji = null, disabled = false) => {
  const item = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emoji) item.setEmoji(emoji);
  return item;
};
const formatChannel = (id) => id ? `<#${id}>` : '`Not set`';
const formatRoles = (ids = []) => ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`None`';
const sessionKey = (interaction, mode) => `${interaction.guildId}:${interaction.user.id}:${mode}`;

function getSession(interaction, mode) {
  const key = sessionKey(interaction, mode);
  if (!sessions.has(key)) sessions.set(key, {
    purpose: 'Private Conversation',
    participantIds: [],
    expiryHours: 0,
    reason: '',
    customPurpose: '',
  });
  return sessions.get(key);
}

function setSession(interaction, mode, patch = {}) {
  const key = sessionKey(interaction, mode);
  const next = { ...getSession(interaction, mode), ...patch };
  sessions.set(key, next);
  return next;
}

function clearSession(interaction, mode) {
  sessions.delete(sessionKey(interaction, mode));
}

function memberName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

async function safePanelResponse(interaction, payload, ephemeral = false) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(payload);
  return interaction.reply({ ...payload, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
}

async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) return interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function purposeOptions(settings, selected) {
  return settings.purposes.slice(0, 25).map((purpose) => ({
    label: purpose.slice(0, 100),
    value: purpose,
    default: purpose === selected,
  }));
}

function expiryLabel(hours) {
  const value = Number(hours || 0);
  if (!value) return 'Manual close';
  if (value === 1) return '1 hour';
  if (value < 24) return `${value} hours`;
  return `${Math.round(value / 24)} day${value === 24 ? '' : 's'}`;
}

function buildAdminPanel(guild, requester = 'Unknown User', page = 'overview') {
  const section = rooms.getSection(guild.id);
  const enabled = guildManager.isModuleEnabled(guild.id, rooms.SECTION);
  const active = rooms.listRooms(guild.id).filter((roomItem) => roomItem.status !== 'closed');
  const pending = rooms.listRequests(guild.id, 'pending');

  if (page === 'channels') {
    return {
      embeds: [new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle('🔒 Private Rooms · Channels')
        .setDescription([
          `**Room Category:** ${formatChannel(section.settings.categoryId)}`,
          `**New Room Request Channel:** ${formatChannel(section.settings.requestChannelId)}`,
          `**Transcript Channel:** ${formatChannel(section.settings.transcriptChannelId)}`,
          `**Audit / Log Channel:** ${formatChannel(section.settings.auditChannelId)}`,
          '',
          'New room requests go to the Request Channel. Participant-add requests for an active room stay inside that room.',
        ].join('\n'))
        .setFooter({ text: `Requested by ${requester}` })
        .setTimestamp()],
      components: [
        row(new ChannelSelectMenuBuilder().setCustomId('admin:privateRooms:channel:category').setPlaceholder('Room category').setChannelTypes(ChannelType.GuildCategory).setMinValues(0).setMaxValues(1)),
        row(new ChannelSelectMenuBuilder().setCustomId('admin:privateRooms:channel:request').setPlaceholder('New room request channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
        row(new ChannelSelectMenuBuilder().setCustomId('admin:privateRooms:channel:transcript').setPlaceholder('Transcript channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
        row(new ChannelSelectMenuBuilder().setCustomId('admin:privateRooms:channel:audit').setPlaceholder('Audit / log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
        row(button('admin:privateRooms', 'Back', ButtonStyle.Secondary, '⬅️')),
      ],
    };
  }

  if (page === 'permissions') {
    return {
      embeds: [new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle('🔒 Private Rooms · Permissions')
        .setDescription([
          `**Managers:** ${formatRoles(section.settings.managerRoleIds)}`,
          `**Approvers:** ${formatRoles(section.settings.approverRoleIds)}`,
          '',
          `**Users can request rooms:** ${section.settings.allowUserRoomRequests ? '✅' : '❌'}`,
          `**User room approval required:** ${section.settings.requireUserRoomApproval ? '✅' : '❌'}`,
          `**Participants can request people:** ${section.settings.allowParticipantAddRequests ? '✅' : '❌'}`,
          `**Participant-add approval required:** ${section.settings.requireParticipantAddApproval ? '✅' : '❌'}`,
          `**Transcripts:** ${section.settings.transcriptsEnabled ? '✅' : '❌'}`,
          `**Live audit logging:** ${section.settings.auditEnabled ? '✅' : '❌'}`,
        ].join('\n'))
        .setFooter({ text: `Requested by ${requester}` })
        .setTimestamp()],
      components: [
        row(new RoleSelectMenuBuilder().setCustomId('admin:privateRooms:roles:managers').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
        row(new RoleSelectMenuBuilder().setCustomId('admin:privateRooms:roles:approvers').setPlaceholder('Approver roles').setMinValues(0).setMaxValues(10)),
        row(
          button('admin:privateRooms:toggle:userRooms', 'User Room Requests', section.settings.allowUserRoomRequests ? ButtonStyle.Success : ButtonStyle.Secondary),
          button('admin:privateRooms:toggle:userApproval', 'Room Approval', section.settings.requireUserRoomApproval ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
        row(
          button('admin:privateRooms:toggle:addRequests', 'Participant Requests', section.settings.allowParticipantAddRequests ? ButtonStyle.Success : ButtonStyle.Secondary),
          button('admin:privateRooms:toggle:addApproval', 'Add Approval', section.settings.requireParticipantAddApproval ? ButtonStyle.Success : ButtonStyle.Secondary),
          button('admin:privateRooms:toggle:transcripts', 'Transcripts', section.settings.transcriptsEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
          button('admin:privateRooms:toggle:audit', 'Audit', section.settings.auditEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
        row(button('admin:privateRooms', 'Back', ButtonStyle.Secondary, '⬅️')),
      ],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(enabled ? SUCCESS_COLOR : PANEL_COLOR)
    .setTitle('🔒 Private Rooms')
    .setDescription([
      'Temporary private conversation rooms for interviews, warnings, training, onboarding, mediation and informal two-way discussions.',
      '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Active Rooms:** ${active.length}`,
      `**Pending Requests:** ${pending.length}`,
      `**Request Channel:** ${formatChannel(section.settings.requestChannelId)}`,
      `**Transcript Channel:** ${formatChannel(section.settings.transcriptChannelId)}`,
      `**Audit Channel:** ${formatChannel(section.settings.auditChannelId)}`,
      '',
      `Created: \`${section.analytics.roomsCreated}\` · Closed: \`${section.analytics.roomsClosed}\` · Transcripts: \`${section.analytics.transcriptsCreated}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${requester}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('privateRooms:staff:create', 'Create Room', ButtonStyle.Success, '➕'),
        button('privateRooms:staff:active', 'Active Rooms', ButtonStyle.Primary, '🔒'),
        button('privateRooms:staff:requests', 'Requests', ButtonStyle.Primary, '📨'),
      ),
      row(
        button('admin:privateRooms:page:channels', 'Channels', ButtonStyle.Secondary, '📁'),
        button('admin:privateRooms:page:permissions', 'Permissions', ButtonStyle.Secondary, '🛡️'),
        button('admin:privateRooms:health', 'Health', ButtonStyle.Secondary, '🩺'),
      ),
      row(button(enabled ? 'admin:privateRooms:disable' : 'admin:privateRooms:enable', enabled ? 'Disable' : 'Enable', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(button('admin:studio:utilityStudio', 'Back', ButtonStyle.Secondary, '⬅️')),
    ],
  };
}

function buildStaffPanel(interaction) {
  const section = rooms.getSection(interaction.guildId);
  const active = rooms.listRooms(interaction.guildId).filter((roomItem) => roomItem.status !== 'closed');
  const pending = rooms.listRequests(interaction.guildId, 'pending');
  return {
    embeds: [new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('🔒 Private Rooms · Staff')
      .setDescription([
        'Create or manage temporary private rooms without using the formal Tickets workflow.',
        '',
        `**Active Rooms:** ${active.length}`,
        `**Pending Requests:** ${pending.length}`,
        `**Managers:** ${formatRoles(section.settings.managerRoleIds)}`,
        `**Approvers:** ${formatRoles(section.settings.approverRoleIds)}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberName(interaction)}` })
      .setTimestamp()],
    components: [row(
      button('privateRooms:staff:create', 'Create Room', ButtonStyle.Success, '➕'),
      button('privateRooms:staff:active', 'Active Rooms', ButtonStyle.Primary, '🔒'),
      button('privateRooms:staff:requests', 'Requests', ButtonStyle.Primary, '📨'),
    )],
  };
}

function buildUserPanel(interaction) {
  const section = rooms.getSection(interaction.guildId);
  const enabled = guildManager.isModuleEnabled(interaction.guildId, rooms.SECTION);
  const mine = rooms.listUserRooms(interaction.guildId, interaction.user.id).filter((room) => room.status !== 'closed');
  const requests = rooms.listUserRequests(interaction.guildId, interaction.user.id);
  return {
    embeds: [new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('🔒 My Private Rooms')
      .setDescription([
        'Request a temporary private conversation with selected server members. Management approval is used when required by this server.',
        '',
        `**Module:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**My Active Rooms:** ${mine.length}`,
        `**My Requests:** ${requests.length}`,
        `**Room Requests Allowed:** ${section.settings.allowUserRoomRequests ? 'Yes ✅' : 'No ❌'}`,
      ].join('\n'))
      .setFooter({ text: `Requested by ${memberName(interaction)}` })
      .setTimestamp()],
    components: [
      row(
        button('user:privateRooms:request', 'Request a Room', ButtonStyle.Success, '➕', !enabled || !section.settings.allowUserRoomRequests),
        button('user:privateRooms:rooms', 'My Rooms', ButtonStyle.Primary, '🔒'),
        button('user:privateRooms:requests', 'My Requests', ButtonStyle.Secondary, '📨'),
      ),
      row(button('user:category:utility', 'Back', ButtonStyle.Secondary, '⬅️')),
    ],
  };
}

function buildWizard(interaction, mode) {
  const section = rooms.getSection(interaction.guildId);
  const session = getSession(interaction, mode);
  const isUser = mode === 'user';
  const participants = session.participantIds.length ? session.participantIds.map((id) => `<@${id}>`).join(', ') : '`None selected`';
  const purpose = session.purpose === 'Other' && session.customPurpose ? session.customPurpose : session.purpose;
  return {
    embeds: [new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle(isUser ? '🔒 Request Private Room' : '🔒 Create Private Room')
      .setDescription([
        `**Purpose:** ${purpose}`,
        `**Participants:** ${participants}`,
        `**Close:** ${expiryLabel(session.expiryHours)}`,
        `**Reason:** ${session.reason || '`Not set`'}`,
        '',
        'Use the searchable member selector to add anyone who is already in this server.',
      ].join('\n'))
      .setFooter({ text: isUser ? 'Your own account is added automatically.' : 'Staff-created rooms open immediately.' })],
    components: [
      row(new StringSelectMenuBuilder()
        .setCustomId(`privateRooms:wizard:purpose:${mode}`)
        .setPlaceholder('Choose purpose')
        .addOptions(purposeOptions(section.settings, session.purpose))),
      row(new UserSelectMenuBuilder()
        .setCustomId(`privateRooms:wizard:participants:${mode}`)
        .setPlaceholder('Search and select participants')
        .setMinValues(0)
        .setMaxValues(10)),
      row(new StringSelectMenuBuilder()
        .setCustomId(`privateRooms:wizard:expiry:${mode}`)
        .setPlaceholder('Choose room duration')
        .addOptions(
          { label: 'Manual close', value: '0', default: Number(session.expiryHours) === 0 },
          { label: '1 hour', value: '1', default: Number(session.expiryHours) === 1 },
          { label: '6 hours', value: '6', default: Number(session.expiryHours) === 6 },
          { label: '24 hours', value: '24', default: Number(session.expiryHours) === 24 },
          { label: '3 days', value: '72', default: Number(session.expiryHours) === 72 },
          { label: '7 days', value: '168', default: Number(session.expiryHours) === 168 },
        )),
      row(
        button(`privateRooms:wizard:details:${mode}`, 'Reason / Details', ButtonStyle.Secondary, '📝'),
        button(`privateRooms:wizard:submit:${mode}`, isUser ? 'Submit Request' : 'Create Room', ButtonStyle.Success, isUser ? '📨' : '✅'),
      ),
      row(button(isUser ? 'user:module:privateRooms' : 'privateRooms:staff:home', 'Back', ButtonStyle.Secondary, '⬅️')),
    ],
  };
}

function buildDetailsModal(mode, session) {
  return new ModalBuilder()
    .setCustomId(`privateRooms:wizard:details-submit:${mode}`)
    .setTitle('Private Room Details')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason / context')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1500)
        .setRequired(false)
        .setValue(String(session.reason || '').slice(0, 1500))),
      row(new TextInputBuilder()
        .setCustomId('customPurpose')
        .setLabel('Custom purpose (only if needed)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(false)
        .setValue(String(session.customPurpose || '').slice(0, 100))),
    );
}

function buildRoomControl(room) {
  const participantText = room.participantIds.length ? room.participantIds.map((id) => `<@${id}>`).join(', ') : 'None';
  return {
    embeds: [new EmbedBuilder()
      .setColor(room.status === 'locked' ? WARNING_COLOR : PANEL_COLOR)
      .setTitle('🔒 Private Room')
      .setDescription([
        `**Purpose:** ${room.purpose}`,
        `**Status:** ${room.status === 'locked' ? 'Locked 🔐' : 'Open ✅'}`,
        `**Participants:** ${participantText}`,
        room.reason ? `**Reason / Context:** ${room.reason}` : null,
        room.expiresAt ? `**Auto Close:** <t:${Math.floor(new Date(room.expiresAt).getTime() / 1000)}:R>` : '**Auto Close:** Manual',
        '',
        'Participants can request another person using **Add Person**. Staff can add/remove people directly.',
      ].filter(Boolean).join('\n'))
      .setFooter({ text: `Room ID: ${room.roomId}` })
      .setTimestamp()],
    components: [row(
      button(`privateRooms:room:add:${room.roomId}`, 'Add Person', ButtonStyle.Success, '➕'),
      button(`privateRooms:room:remove:${room.roomId}`, 'Remove Person', ButtonStyle.Secondary, '➖'),
      button(`privateRooms:room:note:${room.roomId}`, 'Add Note', ButtonStyle.Secondary, '📝'),
      button(`privateRooms:room:lock:${room.roomId}`, room.status === 'locked' ? 'Unlock' : 'Lock', ButtonStyle.Secondary, room.status === 'locked' ? '🔓' : '🔒'),
      button(`privateRooms:room:close:${room.roomId}`, 'Close Room', ButtonStyle.Danger, '✅'),
    )],
  };
}

async function postRoomControl(guild, room) {
  const channel = await rooms.resolveTextChannel(guild, room.channelId);
  if (!channel) throw new Error('Private Room channel could not be opened.');
  const message = await channel.send(buildRoomControl(room));
  rooms.setRoomControlMessage(guild.id, room.roomId, message.id, { guildId: guild.id, action: 'private_room_control_posted' });
  return message;
}

async function refreshRoomControl(guild, roomId) {
  const roomItem = rooms.getRoom(guild.id, roomId);
  if (!roomItem?.channelId || !roomItem.controlMessageId) return null;
  const channel = await rooms.resolveTextChannel(guild, roomItem.channelId);
  const message = await channel?.messages?.fetch(roomItem.controlMessageId).catch(() => null);
  if (message?.editable) await message.edit(buildRoomControl(roomItem)).catch(() => null);
  return roomItem;
}

function buildRequestCard(request) {
  const statusEmoji = request.status === 'approved' ? '✅' : request.status === 'denied' ? '❌' : '📨';
  const participants = request.participantIds.length ? request.participantIds.map((id) => `<@${id}>`).join(', ') : 'None';
  const title = request.type === 'add_participant' ? 'Participant Addition Request' : 'Private Room Request';
  const components = request.status === 'pending' ? [row(
    button(`privateRooms:request:approve:${request.requestId}`, 'Approve', ButtonStyle.Success, '✅'),
    button(`privateRooms:request:deny:${request.requestId}`, 'Deny', ButtonStyle.Danger, '❌'),
    button(`privateRooms:request:edit:${request.requestId}`, 'Edit Participants', ButtonStyle.Secondary, '✏️'),
  )] : [];
  return {
    embeds: [new EmbedBuilder()
      .setColor(request.status === 'approved' ? SUCCESS_COLOR : request.status === 'denied' ? DANGER_COLOR : PANEL_COLOR)
      .setTitle(`${statusEmoji} ${title}`)
      .setDescription([
        `**Requested by:** <@${request.requesterId}>`,
        request.roomId ? `**Room:** \`${request.roomId}\`` : null,
        `**Purpose:** ${request.purpose}`,
        `**Participants:** ${participants}`,
        `**Duration:** ${expiryLabel(request.expiryHours)}`,
        `**Reason:** ${request.reason || 'No reason provided'}`,
        `**Status:** ${request.status}`,
        request.reviewedBy ? `**Reviewed by:** <@${request.reviewedBy}>` : null,
        request.reviewReason ? `**Decision note:** ${request.reviewReason}` : null,
      ].filter(Boolean).join('\n'))
      .setFooter({ text: `Request ID: ${request.requestId}` })
      .setTimestamp(new Date(request.createdAt))],
    components,
  };
}

async function postRequestCard(guild, request) {
  const section = rooms.getSection(guild.id);
  let channel = null;
  if (request.type === 'add_participant' && request.roomId) {
    const roomItem = rooms.getRoom(guild.id, request.roomId);
    channel = await rooms.resolveTextChannel(guild, roomItem?.channelId);
  } else {
    channel = await rooms.resolveTextChannel(guild, section.settings.requestChannelId);
  }
  if (!channel) throw new Error(request.type === 'add_participant' ? 'Private Room channel is unavailable.' : 'Private Room request channel is not configured or unavailable.');
  const message = await channel.send(buildRequestCard(request));
  rooms.setRequestMessage(guild.id, request.requestId, message.channelId, message.id, { guildId: guild.id, action: 'private_room_request_posted' });
  return message;
}

async function refreshRequestCard(guild, requestId) {
  const request = rooms.getRequest(guild.id, requestId);
  if (!request?.messageChannelId || !request.messageId) return null;
  const channel = await rooms.resolveTextChannel(guild, request.messageChannelId);
  const message = await channel?.messages?.fetch(request.messageId).catch(() => null);
  if (message?.editable) await message.edit(buildRequestCard(request)).catch(() => null);
  return request;
}

function buildListPanel(interaction, kind, userOnly = false) {
  const guildId = interaction.guildId;
  let records;
  let title;
  if (kind === 'requests') {
    records = userOnly ? rooms.listUserRequests(guildId, interaction.user.id) : rooms.listRequests(guildId, 'pending');
    title = userOnly ? '📨 My Private Room Requests' : '📨 Pending Private Room Requests';
  } else {
    records = userOnly ? rooms.listUserRooms(guildId, interaction.user.id).filter((item) => item.status !== 'closed') : rooms.listRooms(guildId).filter((item) => item.status !== 'closed');
    title = userOnly ? '🔒 My Active Private Rooms' : '🔒 Active Private Rooms';
  }
  const lines = records.slice(0, 15).map((record) => {
    if (kind === 'requests') return `• \`${record.requestId}\` — **${record.purpose}** — ${record.status}${record.roomId ? ` — room \`${record.roomId}\`` : ''}`;
    return `• ${record.channelId ? `<#${record.channelId}>` : `\`${record.roomId}\``} — **${record.purpose}** — ${record.status}`;
  });
  return {
    embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(title).setDescription(lines.length ? lines.join('\n') : 'Nothing to show yet.').setTimestamp()],
    components: [row(button(userOnly ? 'user:module:privateRooms' : 'privateRooms:staff:home', 'Back', ButtonStyle.Secondary, '⬅️'))],
  };
}

function requestParticipantsPanel(request) {
  return {
    content: `Edit participants for **${request.purpose}**. Current: ${request.participantIds.length ? request.participantIds.map((id) => `<@${id}>`).join(', ') : 'None'}`,
    components: [row(new UserSelectMenuBuilder()
      .setCustomId(`privateRooms:request:participants-select:${request.requestId}`)
      .setPlaceholder('Select replacement participant list')
      .setMinValues(1)
      .setMaxValues(10))],
  };
}

async function openWizard(interaction, mode) {
  getSession(interaction, mode);
  if (interaction.deferred || interaction.replied) return interaction.editReply(buildWizard(interaction, mode));
  return interaction.update(buildWizard(interaction, mode));
}

async function submitWizard(interaction, mode) {
  const session = getSession(interaction, mode);
  const section = rooms.getSection(interaction.guildId);
  const purpose = session.purpose === 'Other' && session.customPurpose ? session.customPurpose : session.purpose;
  const participantIds = [...new Set(session.participantIds.filter((id) => id !== interaction.user.id))];
  if (mode === 'user') {
    if (!section.settings.allowUserRoomRequests) throw new Error('Member room requests are disabled for this server.');
    const allParticipants = [...new Set([interaction.user.id, ...participantIds])];
    if (section.settings.requireUserRoomApproval) {
      const request = rooms.createRequest(interaction.guildId, {
        type: 'create_room',
        requesterId: interaction.user.id,
        purpose,
        reason: session.reason,
        participantIds: allParticipants,
        expiryHours: session.expiryHours,
      }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_requested' });
      await postRequestCard(interaction.guild, request);
      clearSession(interaction, mode);
      await ephemeral(interaction, '📨 Private Room request sent to management for approval.');
      return true;
    }
    const roomItem = await rooms.createRoom(interaction.guild, {
      requestedBy: interaction.user.id,
      createdBy: interaction.user.id,
      participantIds: allParticipants,
      purpose,
      reason: session.reason,
      expiryHours: session.expiryHours,
    }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_user_created' });
    await postRoomControl(interaction.guild, roomItem);
    clearSession(interaction, mode);
    await ephemeral(interaction, `✅ Private Room created: <#${roomItem.channelId}>`);
    return true;
  }

  if (!rooms.isManager(interaction.member, section.settings)) throw new Error('You do not have permission to create Private Rooms directly.');
  if (!participantIds.length) throw new Error('Select at least one participant.');
  const roomItem = await rooms.createRoom(interaction.guild, {
    createdBy: interaction.user.id,
    participantIds,
    purpose,
    reason: session.reason,
    expiryHours: session.expiryHours,
  }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_staff_created' });
  await postRoomControl(interaction.guild, roomItem);
  clearSession(interaction, mode);
  await ephemeral(interaction, `✅ Private Room created: <#${roomItem.channelId}>`);
  return true;
}

async function approveRequest(interaction, requestId) {
  const section = rooms.getSection(interaction.guildId);
  if (!rooms.isApprover(interaction.member, section.settings)) throw new Error('You are not allowed to approve Private Room requests.');
  let request = await rooms.reviewRequest(interaction.guild, requestId, 'approve', interaction.user.id, '', { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_request_approved' });
  if (request.type === 'create_room') {
    const roomItem = await rooms.createRoom(interaction.guild, {
      requestedBy: request.requesterId,
      createdBy: request.requesterId,
      approvedBy: interaction.user.id,
      participantIds: request.participantIds,
      purpose: request.purpose,
      reason: request.reason,
      expiryHours: request.expiryHours,
    }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_request_created' });
    request = rooms.updateRequest(interaction.guildId, requestId, { roomId: roomItem.roomId }, { guildId: interaction.guildId, actorId: interaction.user.id });
    await postRoomControl(interaction.guild, roomItem);
    const requester = await interaction.guild.members.fetch(request.requesterId).catch(() => null);
    await requester?.user?.send(`✅ Your Private Room request was approved in **${interaction.guild.name}**: <#${roomItem.channelId}>`).catch(() => null);
  } else if (request.roomId) {
    await rooms.addParticipants(interaction.guild, request.roomId, request.participantIds, interaction.user.id, request.reason, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_participant_request_approved' });
    await refreshRoomControl(interaction.guild, request.roomId);
  }
  await refreshRequestCard(interaction.guild, requestId);
  return ephemeral(interaction, '✅ Request approved.');
}

function denyRequestModal(requestId) {
  return new ModalBuilder()
    .setCustomId(`privateRooms:request:deny-submit:${requestId}`)
    .setTitle('Deny Private Room Request')
    .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Decision reason').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)));
}

function roomNoteModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`privateRooms:room:note-submit:${roomId}`)
    .setTitle('Add Private Room Note')
    .addComponents(row(new TextInputBuilder().setCustomId('note').setLabel('Management note').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
}

function roomCloseModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`privateRooms:room:close-submit:${roomId}`)
    .setTitle('Close Private Room')
    .addComponents(row(new TextInputBuilder().setCustomId('reason').setLabel('Close reason').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)));
}

async function handleAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:privateRooms')) return false;
  const section = rooms.getSection(interaction.guildId);
  if (id === 'admin:privateRooms') return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction)));
  if (id.startsWith('admin:privateRooms:page:')) return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction), id.split(':')[3]));
  if (id === 'admin:privateRooms:enable') guildManager.setModuleEnabled(interaction.guildId, rooms.SECTION, true, interaction.guild);
  else if (id === 'admin:privateRooms:disable') guildManager.setModuleEnabled(interaction.guildId, rooms.SECTION, false, interaction.guild);
  else if (id.startsWith('admin:privateRooms:channel:') && interaction.isChannelSelectMenu?.()) {
    const key = id.split(':')[3];
    const map = { category: 'categoryId', request: 'requestChannelId', transcript: 'transcriptChannelId', audit: 'auditChannelId' };
    rooms.updateSettings(interaction.guildId, { [map[key]]: interaction.values?.[0] || null }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_rooms_channel_config' });
    return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction), 'channels'));
  } else if (id.startsWith('admin:privateRooms:roles:') && interaction.isRoleSelectMenu?.()) {
    const key = id.endsWith(':managers') ? 'managerRoleIds' : 'approverRoleIds';
    rooms.updateSettings(interaction.guildId, { [key]: [...new Set(interaction.values || [])] }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_rooms_role_config' });
    return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction), 'permissions'));
  } else if (id.startsWith('admin:privateRooms:toggle:')) {
    const toggle = id.split(':')[3];
    const property = {
      userRooms: 'allowUserRoomRequests',
      userApproval: 'requireUserRoomApproval',
      addRequests: 'allowParticipantAddRequests',
      addApproval: 'requireParticipantAddApproval',
      transcripts: 'transcriptsEnabled',
      audit: 'auditEnabled',
    }[toggle];
    if (property) rooms.updateSettings(interaction.guildId, { [property]: !section.settings[property] }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_rooms_toggle' });
    return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction), 'permissions'));
  } else if (id === 'admin:privateRooms:health') {
    const health = await rooms.buildHealth(interaction.guild);
    return ephemeral(interaction, `${health.healthy ? '✅' : '❌'} Private Rooms health: **${health.healthy ? 'Healthy' : 'Needs attention'}**\nActive rooms: ${health.activeRooms}\nPending requests: ${health.pendingRequests}\nIssues: ${health.issues.map((item) => item.code).join(', ') || 'None'}\nWarnings: ${health.warnings.map((item) => item.code).join(', ') || 'None'}`);
  }
  return safePanelResponse(interaction, buildAdminPanel(interaction.guild, memberName(interaction)));
}

async function handleUserInteraction(interaction, updatePanel = null) {
  const id = String(interaction.customId || '');
  if (id === 'user:module:privateRooms') {
    const payload = buildUserPanel(interaction);
    return updatePanel ? updatePanel(interaction, payload) : safePanelResponse(interaction, payload);
  }
  if (!id.startsWith('user:privateRooms:')) return false;
  if (id === 'user:privateRooms:request') return safePanelResponse(interaction, buildWizard(interaction, 'user'));
  if (id === 'user:privateRooms:rooms') return safePanelResponse(interaction, buildListPanel(interaction, 'rooms', true));
  if (id === 'user:privateRooms:requests') return safePanelResponse(interaction, buildListPanel(interaction, 'requests', true));
  return false;
}

async function handleInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('privateRooms:')) return false;
  const section = rooms.getSection(interaction.guildId);

  if (id === 'privateRooms:mod:open' || id === 'privateRooms:staff:home') {
    if (!rooms.isManager(interaction.member, section.settings)) throw new Error('You do not have access to Private Rooms staff controls.');
    return safePanelResponse(interaction, buildStaffPanel(interaction));
  }
  if (id === 'privateRooms:staff:create') {
    if (!rooms.isManager(interaction.member, section.settings)) throw new Error('You do not have permission to create Private Rooms.');
    getSession(interaction, 'staff');
    return safePanelResponse(interaction, buildWizard(interaction, 'staff'));
  }
  if (id === 'privateRooms:staff:active') return safePanelResponse(interaction, buildListPanel(interaction, 'rooms', false));
  if (id === 'privateRooms:staff:requests') return safePanelResponse(interaction, buildListPanel(interaction, 'requests', false));

  const wizardMatch = id.match(/^privateRooms:wizard:(purpose|participants|expiry|details|submit):([a-z]+)$/);
  if (wizardMatch) {
    const [, action, mode] = wizardMatch;
    if (action === 'purpose' && interaction.isStringSelectMenu?.()) {
      setSession(interaction, mode, { purpose: interaction.values?.[0] || 'Private Conversation' });
      return safePanelResponse(interaction, buildWizard(interaction, mode));
    }
    if (action === 'participants' && interaction.isUserSelectMenu?.()) {
      setSession(interaction, mode, { participantIds: [...new Set(interaction.values || [])] });
      return safePanelResponse(interaction, buildWizard(interaction, mode));
    }
    if (action === 'expiry' && interaction.isStringSelectMenu?.()) {
      setSession(interaction, mode, { expiryHours: Number(interaction.values?.[0] || 0) });
      return safePanelResponse(interaction, buildWizard(interaction, mode));
    }
    if (action === 'details' && interaction.isButton?.()) return interaction.showModal(buildDetailsModal(mode, getSession(interaction, mode)));
    if (action === 'submit' && interaction.isButton?.()) return submitWizard(interaction, mode);
  }

  const detailsSubmit = id.match(/^privateRooms:wizard:details-submit:([a-z]+)$/);
  if (detailsSubmit && interaction.isModalSubmit?.()) {
    const mode = detailsSubmit[1];
    setSession(interaction, mode, {
      reason: interaction.fields.getTextInputValue('reason'),
      customPurpose: interaction.fields.getTextInputValue('customPurpose'),
    });
    if (interaction.isFromMessage?.()) return interaction.update(buildWizard(interaction, mode));
    return interaction.reply({ ...buildWizard(interaction, mode), flags: MessageFlags.Ephemeral });
  }

  const requestAction = id.match(/^privateRooms:request:(approve|deny|edit):([^:]+)$/);
  if (requestAction && interaction.isButton?.()) {
    const [, action, requestId] = requestAction;
    if (!rooms.isApprover(interaction.member, section.settings)) throw new Error('You are not allowed to review Private Room requests.');
    if (action === 'approve') return approveRequest(interaction, requestId);
    if (action === 'deny') return interaction.showModal(denyRequestModal(requestId));
    if (action === 'edit') {
      const request = rooms.getRequest(interaction.guildId, requestId);
      if (!request || request.status !== 'pending') throw new Error('That request is no longer pending.');
      return interaction.reply({ ...requestParticipantsPanel(request), flags: MessageFlags.Ephemeral });
    }
  }

  const editRequest = id.match(/^privateRooms:request:participants-select:([^:]+)$/);
  if (editRequest && interaction.isUserSelectMenu?.()) {
    if (!rooms.isApprover(interaction.member, section.settings)) throw new Error('You are not allowed to edit Private Room requests.');
    const requestId = editRequest[1];
    const request = rooms.getRequest(interaction.guildId, requestId);
    if (!request || request.status !== 'pending') throw new Error('That request is no longer pending.');
    const participants = request.type === 'create_room'
      ? [...new Set([request.requesterId, ...(interaction.values || [])])]
      : [...new Set(interaction.values || [])];
    rooms.updateRequest(interaction.guildId, requestId, { participantIds: participants }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_request_participants_edited' });
    await refreshRequestCard(interaction.guild, requestId);
    return interaction.update({ content: '✅ Request participants updated.', components: [] });
  }

  const denySubmit = id.match(/^privateRooms:request:deny-submit:([^:]+)$/);
  if (denySubmit && interaction.isModalSubmit?.()) {
    if (!rooms.isApprover(interaction.member, section.settings)) throw new Error('You are not allowed to review Private Room requests.');
    const requestId = denySubmit[1];
    const reason = interaction.fields.getTextInputValue('reason');
    const request = await rooms.reviewRequest(interaction.guild, requestId, 'deny', interaction.user.id, reason, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_request_denied' });
    await refreshRequestCard(interaction.guild, requestId);
    const requester = await interaction.guild.members.fetch(request.requesterId).catch(() => null);
    await requester?.user?.send(`❌ Your Private Room request in **${interaction.guild.name}** was denied.${reason ? `\nReason: ${reason}` : ''}`).catch(() => null);
    return interaction.reply({ content: '❌ Request denied.', flags: MessageFlags.Ephemeral });
  }

  const roomButton = id.match(/^privateRooms:room:(add|remove|lock|note|close):([^:]+)$/);
  if (roomButton && interaction.isButton?.()) {
    const [, action, roomId] = roomButton;
    const roomItem = rooms.getRoom(interaction.guildId, roomId);
    if (!roomItem || roomItem.status === 'closed') throw new Error('This Private Room is no longer active.');
    const manager = rooms.isManager(interaction.member, section.settings);
    const participant = rooms.isParticipant(roomItem, interaction.user.id);
    if (action === 'add') {
      if (!manager && (!participant || !section.settings.allowParticipantAddRequests)) throw new Error('You cannot request participants for this room.');
      return interaction.reply({
        content: manager ? 'Select member(s) to add directly.' : 'Select member(s) to request. Management will approve or deny the request.',
        components: [row(new UserSelectMenuBuilder().setCustomId(`privateRooms:room:add-select:${roomId}`).setPlaceholder('Search members to add').setMinValues(1).setMaxValues(10))],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!manager) throw new Error('Only room management can use this control.');
    if (action === 'remove') return interaction.reply({
      content: 'Select room participant(s) to remove.',
      components: [row(new UserSelectMenuBuilder().setCustomId(`privateRooms:room:remove-select:${roomId}`).setPlaceholder('Select participants to remove').setMinValues(1).setMaxValues(10))],
      flags: MessageFlags.Ephemeral,
    });
    if (action === 'lock') {
      await rooms.setRoomLocked(interaction.guild, roomId, roomItem.status !== 'locked', interaction.user.id, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_lock_toggle' });
      await refreshRoomControl(interaction.guild, roomId);
      return ephemeral(interaction, roomItem.status === 'locked' ? '🔓 Room unlocked.' : '🔒 Room locked.');
    }
    if (action === 'note') return interaction.showModal(roomNoteModal(roomId));
    if (action === 'close') return interaction.showModal(roomCloseModal(roomId));
  }

  const addSelect = id.match(/^privateRooms:room:add-select:([^:]+)$/);
  if (addSelect && interaction.isUserSelectMenu?.()) {
    const roomId = addSelect[1];
    const roomItem = rooms.getRoom(interaction.guildId, roomId);
    if (!roomItem) throw new Error('Private Room not found.');
    const manager = rooms.isManager(interaction.member, section.settings);
    const participant = rooms.isParticipant(roomItem, interaction.user.id);
    if (!manager && !participant) throw new Error('You are not part of this Private Room.');
    const selected = [...new Set(interaction.values || [])].filter((userId) => !roomItem.participantIds.includes(userId));
    if (!selected.length) return interaction.update({ content: 'Those members are already in the room.', components: [] });
    if (manager || !section.settings.requireParticipantAddApproval) {
      await rooms.addParticipants(interaction.guild, roomId, selected, interaction.user.id, manager ? 'Added by room management' : 'Participant addition without approval requirement', { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_participants_added' });
      await refreshRoomControl(interaction.guild, roomId);
      return interaction.update({ content: '✅ Participant(s) added.', components: [] });
    }
    const request = rooms.createRequest(interaction.guildId, {
      type: 'add_participant',
      requesterId: interaction.user.id,
      roomId,
      purpose: roomItem.purpose,
      reason: `Participant request from ${interaction.user.id}`,
      participantIds: selected,
    }, { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_participant_requested' });
    await rooms.appendRoomAudit(interaction.guild, roomId, { type: 'participant_add_requested', actorId: interaction.user.id, targetUserIds: selected }, { guildId: interaction.guildId, actorId: interaction.user.id });
    await postRequestCard(interaction.guild, request);
    return interaction.update({ content: '📨 Participant request posted in this room for management approval.', components: [] });
  }

  const removeSelect = id.match(/^privateRooms:room:remove-select:([^:]+)$/);
  if (removeSelect && interaction.isUserSelectMenu?.()) {
    if (!rooms.isManager(interaction.member, section.settings)) throw new Error('Only room management can remove participants.');
    const roomId = removeSelect[1];
    await rooms.removeParticipants(interaction.guild, roomId, interaction.values || [], interaction.user.id, 'Removed by room management', { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_participants_removed' });
    await refreshRoomControl(interaction.guild, roomId);
    return interaction.update({ content: '✅ Selected participant(s) removed.', components: [] });
  }

  const noteSubmit = id.match(/^privateRooms:room:note-submit:([^:]+)$/);
  if (noteSubmit && interaction.isModalSubmit?.()) {
    if (!rooms.isManager(interaction.member, section.settings)) throw new Error('Only room management can add notes.');
    await rooms.addRoomNote(interaction.guild, noteSubmit[1], interaction.user.id, interaction.fields.getTextInputValue('note'), { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_note' });
    return interaction.reply({ content: '📝 Note added to the room audit and transcript.', flags: MessageFlags.Ephemeral });
  }

  const closeSubmit = id.match(/^privateRooms:room:close-submit:([^:]+)$/);
  if (closeSubmit && interaction.isModalSubmit?.()) {
    if (!rooms.isManager(interaction.member, section.settings)) throw new Error('Only room management can close Private Rooms.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roomId = closeSubmit[1];
    await rooms.closeRoom(interaction.guild, roomId, interaction.user.id, interaction.fields.getTextInputValue('reason'), { guildId: interaction.guildId, actorId: interaction.user.id, action: 'private_room_closed' });
    await interaction.editReply({ content: '✅ Private Room closed and transcript processed.' });
    return true;
  }

  return false;
}

module.exports = {
  buildAdminPanel,
  buildStaffPanel,
  buildUserPanel,
  buildWizard,
  buildRoomControl,
  buildRequestCard,
  postRoomControl,
  postRequestCard,
  refreshRoomControl,
  refreshRequestCard,
  handleAdminInteraction,
  handleUserInteraction,
  handleInteraction,
  user: {
    buildPanel: buildUserPanel,
    handleInteraction: handleUserInteraction,
  },
};
