'use strict';

const crypto = require('node:crypto');
const {
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const {
  getModuleSection,
  saveModuleSection,
  updateModuleSection,
} = require('../../../core/guild/moduleSectionManager');
const schedulerRegistry = require('../../../owner/sentinel/schedulerRegistry');

const SECTION = 'privateRooms';
const TICK_MS = 60 * 1000;
const PRIVATE_ROOMS_SCHEDULER_ID = 'privateRooms:expiry:global';
const MAX_TRANSCRIPT_MESSAGES = 2000;
const DEFAULT_PURPOSES = Object.freeze([
  'Private Conversation',
  'Interview',
  'Warning / Check-in',
  'Training',
  'Onboarding',
  'Mediation',
  'Other',
]);

const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const cleanId = (value) => {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
};
const cleanIds = (value) => Array.isArray(value) ? [...new Set(value.map(cleanId).filter(Boolean))] : [];
const createId = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

function defaultSection() {
  return {
    settings: {
      categoryId: null,
      requestChannelId: null,
      transcriptChannelId: null,
      auditChannelId: null,
      approverRoleIds: [],
      managerRoleIds: [],
      allowUserRoomRequests: true,
      allowParticipantAddRequests: true,
      requireUserRoomApproval: true,
      requireParticipantAddApproval: true,
      transcriptsEnabled: true,
      auditEnabled: true,
      defaultExpiryHours: 0,
      roomNamePrefix: 'private-room',
      purposes: [...DEFAULT_PURPOSES],
    },
    rooms: {},
    requests: {},
    analytics: {
      roomsCreated: 0,
      roomsClosed: 0,
      requestsCreated: 0,
      requestsApproved: 0,
      requestsDenied: 0,
      participantsAdded: 0,
      participantsRemoved: 0,
      transcriptsCreated: 0,
      failures: 0,
      lastProcessedAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

function normalizeAuditEvent(input = {}) {
  return {
    eventId: clean(input.eventId, 80) || createId('evt'),
    type: clean(input.type, 80) || 'event',
    actorId: cleanId(input.actorId),
    targetUserIds: cleanIds(input.targetUserIds),
    reason: clean(input.reason, 1000),
    detail: clean(input.detail, 1000),
    createdAt: input.createdAt || now(),
  };
}

function normalizeRoom(input = {}) {
  const roomId = clean(input.roomId || input.id, 80) || createId('room');
  const status = ['open', 'locked', 'closed'].includes(input.status) ? input.status : 'open';
  return {
    roomId,
    id: roomId,
    channelId: cleanId(input.channelId),
    controlMessageId: cleanId(input.controlMessageId),
    name: clean(input.name, 100),
    purpose: clean(input.purpose, 100) || 'Private Conversation',
    reason: clean(input.reason, 1500),
    requestedBy: cleanId(input.requestedBy),
    createdBy: cleanId(input.createdBy),
    approvedBy: cleanId(input.approvedBy),
    participantIds: cleanIds(input.participantIds),
    status,
    expiresAt: input.expiresAt || null,
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now(),
    closedAt: input.closedAt || null,
    closedBy: cleanId(input.closedBy),
    closeReason: clean(input.closeReason, 1000),
    transcriptMessageId: cleanId(input.transcriptMessageId),
    transcriptChannelId: cleanId(input.transcriptChannelId),
    audit: Array.isArray(input.audit) ? input.audit.map(normalizeAuditEvent).slice(-500) : [],
  };
}

function normalizeRequest(input = {}) {
  const requestId = clean(input.requestId || input.id, 80) || createId('req');
  const type = input.type === 'add_participant' ? 'add_participant' : 'create_room';
  const status = ['pending', 'approved', 'denied', 'cancelled'].includes(input.status) ? input.status : 'pending';
  return {
    requestId,
    id: requestId,
    type,
    status,
    requesterId: cleanId(input.requesterId),
    roomId: clean(input.roomId, 80) || null,
    purpose: clean(input.purpose, 100) || 'Private Conversation',
    reason: clean(input.reason, 1500),
    participantIds: cleanIds(input.participantIds),
    expiryHours: Math.max(0, Math.min(720, Number(input.expiryHours || 0))),
    messageChannelId: cleanId(input.messageChannelId),
    messageId: cleanId(input.messageId),
    reviewedBy: cleanId(input.reviewedBy),
    reviewedAt: input.reviewedAt || null,
    reviewReason: clean(input.reviewReason, 1000),
    createdAt: input.createdAt || now(),
    updatedAt: input.updatedAt || now(),
  };
}

function normalizeSection(input = {}) {
  const base = defaultSection();
  const raw = input && typeof input === 'object' ? clone(input) : {};
  const settings = {
    ...base.settings,
    ...(raw.settings || {}),
    categoryId: cleanId(raw.settings?.categoryId),
    requestChannelId: cleanId(raw.settings?.requestChannelId),
    transcriptChannelId: cleanId(raw.settings?.transcriptChannelId),
    auditChannelId: cleanId(raw.settings?.auditChannelId),
    approverRoleIds: cleanIds(raw.settings?.approverRoleIds),
    managerRoleIds: cleanIds(raw.settings?.managerRoleIds),
    allowUserRoomRequests: raw.settings?.allowUserRoomRequests !== false,
    allowParticipantAddRequests: raw.settings?.allowParticipantAddRequests !== false,
    requireUserRoomApproval: raw.settings?.requireUserRoomApproval !== false,
    requireParticipantAddApproval: raw.settings?.requireParticipantAddApproval !== false,
    transcriptsEnabled: raw.settings?.transcriptsEnabled !== false,
    auditEnabled: raw.settings?.auditEnabled !== false,
    defaultExpiryHours: Math.max(0, Math.min(720, Number(raw.settings?.defaultExpiryHours || 0))),
    roomNamePrefix: clean(raw.settings?.roomNamePrefix || base.settings.roomNamePrefix, 40).toLowerCase().replace(/[^a-z0-9-]/g, '-') || base.settings.roomNamePrefix,
    purposes: Array.isArray(raw.settings?.purposes) && raw.settings.purposes.length
      ? [...new Set(raw.settings.purposes.map((item) => clean(item, 100)).filter(Boolean))].slice(0, 25)
      : [...DEFAULT_PURPOSES],
  };
  return {
    ...base,
    ...raw,
    settings,
    rooms: Object.fromEntries(Object.entries(raw.rooms || {}).map(([id, room]) => {
      const normalized = normalizeRoom({ ...room, roomId: room?.roomId || id });
      return [normalized.roomId, normalized];
    })),
    requests: Object.fromEntries(Object.entries(raw.requests || {}).map(([id, request]) => {
      const normalized = normalizeRequest({ ...request, requestId: request?.requestId || id });
      return [normalized.requestId, normalized];
    })),
    analytics: { ...base.analytics, ...(raw.analytics || {}) },
    updatedAt: raw.updatedAt || now(),
  };
}

function getSection(guildId) {
  return normalizeSection(getModuleSection(guildId, SECTION, defaultSection()));
}

function saveSection(guildId, section, meta = {}) {
  return normalizeSection(saveModuleSection(guildId, SECTION, normalizeSection(section), meta));
}

function updateSection(guildId, updater, meta = {}) {
  return normalizeSection(updateModuleSection(guildId, SECTION, (current) => {
    const normalized = normalizeSection(current);
    const next = typeof updater === 'function' ? updater(clone(normalized)) : updater;
    return { ...normalizeSection(next), updatedAt: now() };
  }, defaultSection(), meta));
}

function updateSettings(guildId, patch = {}, meta = {}) {
  return updateSection(guildId, (section) => ({ ...section, settings: { ...section.settings, ...patch } }), meta).settings;
}

function incrementAnalytics(guildId, patch = {}, meta = {}) {
  return updateSection(guildId, (section) => {
    const analytics = { ...section.analytics };
    for (const [key, value] of Object.entries(patch)) {
      analytics[key] = typeof value === 'number' ? Number(analytics[key] || 0) + value : value;
    }
    return { ...section, analytics };
  }, meta).analytics;
}

function getRoom(guildId, roomId) { return getSection(guildId).rooms[String(roomId)] || null; }
function getRequest(guildId, requestId) { return getSection(guildId).requests[String(requestId)] || null; }
function listRooms(guildId, status = null) {
  return Object.values(getSection(guildId).rooms)
    .filter((room) => !status || room.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function listRequests(guildId, status = null) {
  return Object.values(getSection(guildId).requests)
    .filter((request) => !status || request.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function listUserRooms(guildId, userId) {
  const id = String(userId);
  return listRooms(guildId).filter((room) => room.participantIds.includes(id) || room.requestedBy === id);
}
function listUserRequests(guildId, userId) {
  return listRequests(guildId).filter((request) => request.requesterId === String(userId));
}

function hasAnyRole(member, roleIds = []) {
  return Boolean(member && cleanIds(roleIds).some((id) => member.roles?.cache?.has(id)));
}

function isManager(member, settings = {}) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ModerateMembers)) return true;
  return hasAnyRole(member, [...(settings.managerRoleIds || []), ...(settings.approverRoleIds || [])]);
}

function isApprover(member, settings = {}) {
  if (isManager(member, settings)) return true;
  return hasAnyRole(member, settings.approverRoleIds || []);
}

function isParticipant(room, userId) {
  return Boolean(room && room.participantIds.includes(String(userId)));
}

function saveRoom(guildId, room, meta = {}) {
  const normalized = normalizeRoom(room);
  return updateSection(guildId, (section) => ({
    ...section,
    rooms: { ...section.rooms, [normalized.roomId]: normalized },
  }), meta).rooms[normalized.roomId];
}

function saveRequest(guildId, request, meta = {}) {
  const normalized = normalizeRequest(request);
  return updateSection(guildId, (section) => ({
    ...section,
    requests: { ...section.requests, [normalized.requestId]: normalized },
  }), meta).requests[normalized.requestId];
}

function setRoomControlMessage(guildId, roomId, messageId, meta = {}) {
  const room = getRoom(guildId, roomId);
  if (!room) return null;
  return saveRoom(guildId, { ...room, controlMessageId: cleanId(messageId), updatedAt: now() }, meta);
}

async function resolveTextChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.send ? channel : null;
}

async function sendAuditLog(guild, entry, room = null) {
  const section = getSection(guild.id);
  if (!section.settings.auditEnabled || !section.settings.auditChannelId) return null;
  const channel = await resolveTextChannel(guild, section.settings.auditChannelId);
  if (!channel) return null;
  const targets = entry.targetUserIds?.length ? entry.targetUserIds.map((id) => `<@${id}>`).join(', ') : 'None';
  const roomText = room?.channelId ? `<#${room.channelId}>` : room?.roomId || 'Not created yet';
  return channel.send({
    embeds: [{
      color: 0x5865F2,
      title: '🔒 Private Rooms Audit',
      description: [
        `**Action:** ${entry.type}`,
        `**Room:** ${roomText}`,
        `**Actor:** ${entry.actorId ? `<@${entry.actorId}>` : 'System'}`,
        `**Users:** ${targets}`,
        entry.reason ? `**Reason:** ${entry.reason}` : null,
        entry.detail ? `**Detail:** ${entry.detail}` : null,
      ].filter(Boolean).join('\n'),
      timestamp: entry.createdAt,
    }],
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

async function appendRoomAudit(guild, roomId, input = {}, meta = {}) {
  const room = getRoom(guild.id, roomId);
  if (!room) return null;
  const entry = normalizeAuditEvent(input);
  const updated = saveRoom(guild.id, { ...room, audit: [...room.audit, entry].slice(-500), updatedAt: now() }, meta);
  await sendAuditLog(guild, entry, updated);
  return updated;
}

async function logRequestAudit(guild, request, type, actorId, reason = '', detail = '') {
  const entry = normalizeAuditEvent({ type, actorId, targetUserIds: request.participantIds, reason, detail });
  await sendAuditLog(guild, entry, request.roomId ? getRoom(guild.id, request.roomId) : { roomId: request.requestId });
  return entry;
}

async function ensureGuildMembers(guild, userIds = []) {
  const found = [];
  for (const userId of cleanIds(userIds)) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user?.bot) continue;
    found.push(member.id);
  }
  return [...new Set(found)];
}

function roomChannelName(section, room) {
  const purpose = clean(room.purpose, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
  const suffix = room.roomId.split('_').pop().slice(-5);
  return `${section.settings.roomNamePrefix}-${purpose}-${suffix}`.slice(0, 90);
}

async function buildPermissionOverwrites(guild, section, participantIds) {
  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  if (guild.members.me?.id) overwrites.push({
    id: guild.members.me.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
  });
  for (const roleId of [...new Set([...(section.settings.managerRoleIds || []), ...(section.settings.approverRoleIds || [])])]) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }
  for (const userId of participantIds) overwrites.push({
    id: userId,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
  });
  return overwrites;
}

async function createRoom(guild, input = {}, meta = {}) {
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) throw new Error('Private Rooms is disabled for this server.');
  const section = getSection(guild.id);
  const requestedBy = cleanId(input.requestedBy);
  const creatorId = cleanId(input.createdBy || meta.actorId);
  const participants = await ensureGuildMembers(guild, [...cleanIds(input.participantIds), requestedBy].filter(Boolean));
  if (!participants.length) throw new Error('Select at least one server member for the room.');
  const expiryHours = Math.max(0, Math.min(720, Number(input.expiryHours ?? section.settings.defaultExpiryHours ?? 0)));
  let room = normalizeRoom({
    purpose: input.purpose,
    reason: input.reason,
    requestedBy,
    createdBy: creatorId,
    approvedBy: input.approvedBy,
    participantIds: participants,
    expiresAt: expiryHours > 0 ? new Date(Date.now() + expiryHours * 3600000).toISOString() : null,
    audit: input.audit || [],
  });
  const category = section.settings.categoryId
    ? (guild.channels.cache.get(section.settings.categoryId) || await guild.channels.fetch(section.settings.categoryId).catch(() => null))
    : null;
  const channel = await guild.channels.create({
    name: roomChannelName(section, room),
    type: ChannelType.GuildText,
    parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
    permissionOverwrites: await buildPermissionOverwrites(guild, section, participants),
    reason: `Goliath Private Room ${room.roomId}`,
  });
  room = saveRoom(guild.id, { ...room, channelId: channel.id, name: channel.name }, { ...meta, action: 'private_room_created' });
  incrementAnalytics(guild.id, { roomsCreated: 1 }, meta);
  await appendRoomAudit(guild, room.roomId, {
    type: input.requestedBy ? 'room_request_approved_and_created' : 'room_created',
    actorId: input.approvedBy || creatorId,
    targetUserIds: participants,
    reason: room.reason,
    detail: `Purpose: ${room.purpose}`,
  }, meta);
  return getRoom(guild.id, room.roomId);
}

function createRequest(guildId, input = {}, meta = {}) {
  const requesterId = cleanId(input.requesterId || meta.actorId);
  if (!requesterId) throw new Error('A valid requester is required.');
  const request = normalizeRequest({
    type: input.type,
    requesterId,
    roomId: input.roomId,
    purpose: input.purpose,
    reason: input.reason,
    participantIds: input.participantIds,
    expiryHours: input.expiryHours,
  });
  saveRequest(guildId, request, meta);
  incrementAnalytics(guildId, { requestsCreated: 1 }, meta);
  return getRequest(guildId, request.requestId);
}

function updateRequest(guildId, requestId, patch = {}, meta = {}) {
  const current = getRequest(guildId, requestId);
  if (!current) return null;
  return saveRequest(guildId, { ...current, ...patch, requestId, updatedAt: now() }, meta);
}

function setRequestMessage(guildId, requestId, channelId, messageId, meta = {}) {
  return updateRequest(guildId, requestId, { messageChannelId: channelId, messageId }, meta);
}

async function reviewRequest(guild, requestId, decision, actorId, reason = '', meta = {}) {
  const request = getRequest(guild.id, requestId);
  if (!request) throw new Error('Private Room request not found.');
  if (request.status !== 'pending') throw new Error(`This request is already ${request.status}.`);
  const status = decision === 'approve' ? 'approved' : 'denied';
  const updated = updateRequest(guild.id, requestId, {
    status,
    reviewedBy: actorId,
    reviewedAt: now(),
    reviewReason: reason,
  }, meta);
  incrementAnalytics(guild.id, status === 'approved' ? { requestsApproved: 1 } : { requestsDenied: 1 }, meta);
  await logRequestAudit(guild, updated, `request_${status}`, actorId, reason, `Type: ${updated.type}`);
  return updated;
}

async function addParticipants(guild, roomId, userIds, actorId, reason = '', meta = {}) {
  let room = getRoom(guild.id, roomId);
  if (!room || !['open', 'locked'].includes(room.status)) throw new Error('Private Room is not active.');
  const valid = await ensureGuildMembers(guild, userIds);
  const additions = valid.filter((id) => !room.participantIds.includes(id));
  if (!additions.length) return room;
  const channel = await resolveTextChannel(guild, room.channelId);
  if (!channel) throw new Error('Private Room channel is unavailable.');
  for (const userId of additions) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: room.status !== 'locked',
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    }, { reason: 'Goliath Private Rooms participant added' });
  }
  room = saveRoom(guild.id, { ...room, participantIds: [...room.participantIds, ...additions], updatedAt: now() }, meta);
  incrementAnalytics(guild.id, { participantsAdded: additions.length }, meta);
  await appendRoomAudit(guild, roomId, { type: 'participants_added', actorId, targetUserIds: additions, reason }, meta);
  return getRoom(guild.id, roomId);
}

async function removeParticipants(guild, roomId, userIds, actorId, reason = '', meta = {}) {
  let room = getRoom(guild.id, roomId);
  if (!room || !['open', 'locked'].includes(room.status)) throw new Error('Private Room is not active.');
  const removals = cleanIds(userIds).filter((id) => room.participantIds.includes(id));
  if (!removals.length) return room;
  const channel = await resolveTextChannel(guild, room.channelId);
  if (!channel) throw new Error('Private Room channel is unavailable.');
  for (const userId of removals) await channel.permissionOverwrites.delete(userId, 'Goliath Private Rooms participant removed').catch(() => null);
  room = saveRoom(guild.id, { ...room, participantIds: room.participantIds.filter((id) => !removals.includes(id)), updatedAt: now() }, meta);
  incrementAnalytics(guild.id, { participantsRemoved: removals.length }, meta);
  await appendRoomAudit(guild, roomId, { type: 'participants_removed', actorId, targetUserIds: removals, reason }, meta);
  return getRoom(guild.id, roomId);
}

async function setRoomLocked(guild, roomId, locked, actorId, meta = {}) {
  let room = getRoom(guild.id, roomId);
  if (!room || room.status === 'closed') throw new Error('Private Room is not active.');
  const section = getSection(guild.id);
  const channel = await resolveTextChannel(guild, room.channelId);
  if (!channel) throw new Error('Private Room channel is unavailable.');
  for (const userId of room.participantIds) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (isManager(member, section.settings)) continue;
    await channel.permissionOverwrites.edit(userId, { SendMessages: locked ? false : true }).catch(() => null);
  }
  room = saveRoom(guild.id, { ...room, status: locked ? 'locked' : 'open', updatedAt: now() }, meta);
  await appendRoomAudit(guild, roomId, { type: locked ? 'room_locked' : 'room_unlocked', actorId }, meta);
  return getRoom(guild.id, roomId);
}

async function addRoomNote(guild, roomId, actorId, note, meta = {}) {
  const text = clean(note, 1000);
  if (!text) throw new Error('Enter a note first.');
  const room = await appendRoomAudit(guild, roomId, { type: 'management_note', actorId, detail: text }, meta);
  const channel = await resolveTextChannel(guild, room?.channelId);
  if (channel) await channel.send({ embeds: [{ color: 0xFEE75C, title: '📝 Private Room Note', description: text, footer: { text: `Added by ${actorId}` }, timestamp: now() }] }).catch(() => null);
  return room;
}

async function fetchTranscriptMessages(channel, limit = MAX_TRANSCRIPT_MESSAGES) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), ...(before ? { before } : {}) }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildTranscriptText(guild, room, messages) {
  const lines = [
    'GOLIATH PRIVATE ROOMS TRANSCRIPT',
    `Server: ${guild.name} (${guild.id})`,
    `Room ID: ${room.roomId}`,
    `Channel: ${room.name || room.channelId}`,
    `Purpose: ${room.purpose}`,
    `Reason: ${room.reason || 'None provided'}`,
    `Requested by: ${room.requestedBy || 'N/A'}`,
    `Created by: ${room.createdBy || 'N/A'}`,
    `Approved by: ${room.approvedBy || 'N/A'}`,
    `Participants: ${room.participantIds.join(', ') || 'None'}`,
    `Created: ${room.createdAt}`,
    `Closed: ${room.closedAt || 'Not closed'}`,
    `Closed by: ${room.closedBy || 'N/A'}`,
    `Close reason: ${room.closeReason || 'None provided'}`,
    '',
    '--- ROOM AUDIT TRAIL ---',
  ];
  for (const event of room.audit || []) {
    lines.push(`[${event.createdAt}] ${event.type} | actor=${event.actorId || 'system'} | targets=${event.targetUserIds.join(',') || '-'}${event.reason ? ` | reason=${event.reason}` : ''}${event.detail ? ` | detail=${event.detail}` : ''}`);
  }
  lines.push('', '--- CONVERSATION ---');
  for (const message of messages) {
    const author = `${message.author?.tag || message.author?.username || 'Unknown'} (${message.author?.id || 'unknown'})`;
    const content = String(message.content || '').replace(/\r?\n/g, '\n    ');
    lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${author}: ${content || '[no text]'}`);
    for (const attachment of message.attachments?.values?.() || []) lines.push(`    Attachment: ${attachment.url}`);
    if (message.embeds?.length) lines.push(`    Embeds: ${message.embeds.length}`);
  }
  return lines.join('\n');
}

async function createTranscript(guild, room, meta = {}) {
  const section = getSection(guild.id);
  if (!section.settings.transcriptsEnabled) return { skipped: true, message: null };
  const target = await resolveTextChannel(guild, section.settings.transcriptChannelId);
  if (!target) throw new Error('Transcript channel is unavailable. Configure it before closing this room.');
  const channel = await resolveTextChannel(guild, room.channelId);
  if (!channel) throw new Error('Private Room channel is unavailable for transcription.');
  const messages = await fetchTranscriptMessages(channel);
  const text = buildTranscriptText(guild, room, messages);
  const attachment = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `${room.name || room.roomId}-transcript.txt` });
  const message = await target.send({
    content: `🔒 **Private Room Transcript** — \`${room.roomId}\` — ${room.purpose}`,
    files: [attachment],
    allowedMentions: { parse: [] },
  });
  incrementAnalytics(guild.id, { transcriptsCreated: 1 }, meta);
  return { skipped: false, message };
}

async function closeRoom(guild, roomId, actorId = null, reason = '', meta = {}) {
  const room = getRoom(guild.id, roomId);
  if (!room) throw new Error('Private Room not found.');
  if (room.status === 'closed') return room;

  const closedAt = now();
  const closeReason = clean(reason, 1000);
  const closeEvent = normalizeAuditEvent({ type: 'room_closed', actorId, reason: closeReason, createdAt: closedAt });
  let closingRoom = normalizeRoom({
    ...room,
    status: 'closed',
    closedAt,
    closedBy: cleanId(actorId),
    closeReason,
    updatedAt: closedAt,
    audit: [...room.audit, closeEvent].slice(-500),
  });

  // Transcript first. If this fails, canonical room state remains open/locked so close can be retried safely.
  const transcript = await createTranscript(guild, closingRoom, meta);
  if (transcript.message) {
    closingRoom = normalizeRoom({
      ...closingRoom,
      transcriptMessageId: transcript.message.id,
      transcriptChannelId: transcript.message.channelId,
    });
  }

  closingRoom = saveRoom(guild.id, closingRoom, { ...meta, action: meta.action || 'private_room_closed' });
  await sendAuditLog(guild, closeEvent, closingRoom);

  const channel = await resolveTextChannel(guild, closingRoom.channelId);
  if (channel) {
    await channel.delete(`Goliath Private Room closed: ${closeReason || 'completed'}`);
  }
  incrementAnalytics(guild.id, { roomsClosed: 1 }, meta);
  return getRoom(guild.id, roomId);
}

async function processGuild(guild, meta = {}) {
  if (!guildManager.isModuleEnabled(guild.id, SECTION)) return { disabled: true, expired: 0, failures: 0 };
  const result = { expired: 0, failures: 0 };
  for (const room of listRooms(guild.id).filter((item) => item.status !== 'closed' && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now())) {
    try {
      await closeRoom(guild, room.roomId, guild.members.me?.id || null, 'Automatic room expiry', { ...meta, action: 'private_room_expired' });
      result.expired += 1;
    } catch (error) {
      result.failures += 1;
      incrementAnalytics(guild.id, { failures: 1 }, meta);
      console.warn(`[PrivateRooms] Failed to expire ${room.roomId}: ${error.message}`);
    }
  }
  incrementAnalytics(guild.id, { lastProcessedAt: now() }, meta);
  return result;
}

async function startup(client) {
  if (client.__goliathPrivateRoomsStarted) return client.__goliathPrivateRoomsStarted;

  schedulerRegistry.register({
    id: PRIVATE_ROOMS_SCHEDULER_ID,
    module: SECTION,
    component: 'expiry',
    intervalMs: TICK_MS,
    staleAfterMs: Math.max(TICK_MS * 3, 180_000),
    environment: client.botMode || process.env.BOT_MODE || null,
  });

  const run = async () => {
    let expired = 0;
    let failures = 0;
    let guildsChecked = 0;

    try {
      for (const guild of client.guilds.cache.values()) {
        guildsChecked += 1;
        try {
          const result = await processGuild(guild, { action: 'private_rooms_tick' });
          expired += Number(result?.expired || 0);
          failures += Number(result?.failures || 0);
        } catch (error) {
          failures += 1;
          console.warn(`[PrivateRooms] Scheduler failed for ${guild.id}: ${error.message}`);
        }
      }

      const details = { guildsChecked, expired, failures };
      if (failures > 0) {
        schedulerRegistry.fail(
          PRIVATE_ROOMS_SCHEDULER_ID,
          new Error(`Private Rooms expiry cycle completed with ${failures} failure(s).`),
          details,
        );
      } else {
        schedulerRegistry.beat(PRIVATE_ROOMS_SCHEDULER_ID, details);
      }
      return details;
    } catch (error) {
      schedulerRegistry.fail(PRIVATE_ROOMS_SCHEDULER_ID, error, { guildsChecked, expired, failures });
      throw error;
    }
  };

  await run();
  const timer = setInterval(() => {
    run().catch((error) => console.warn(`[PrivateRooms] Expiry scheduler failed: ${error.message}`));
  }, TICK_MS);
  timer.unref?.();
  client.__goliathPrivateRoomsStarted = timer;
  return timer;
}

async function buildHealth(guild) {
  const section = getSection(guild.id);
  const issues = [];
  const warnings = [];
  const me = guild.members.me;

  const checkTextChannel = async (key, required, requiredPermissions = []) => {
    const id = section.settings[key];
    if (!id) {
      if (required) warnings.push({ code: `${key}_missing` });
      return;
    }
    const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
    if (!channel?.send) {
      issues.push({ code: `${key}_unavailable`, channelId: id });
      return;
    }
    const permissions = me && channel.permissionsFor?.(me);
    for (const permission of requiredPermissions) {
      if (!permissions?.has(permission)) issues.push({ code: `${key}_permission_missing`, channelId: id, permission: String(permission) });
    }
  };

  await checkTextChannel('requestChannelId', section.settings.allowUserRoomRequests, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]);
  await checkTextChannel('transcriptChannelId', section.settings.transcriptsEnabled, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ]);
  await checkTextChannel('auditChannelId', section.settings.auditEnabled && Boolean(section.settings.auditChannelId), [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]);

  if (section.settings.categoryId) {
    const category = guild.channels.cache.get(section.settings.categoryId) || await guild.channels.fetch(section.settings.categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      issues.push({ code: 'categoryId_unavailable', channelId: section.settings.categoryId });
    } else {
      const permissions = me && category.permissionsFor?.(me);
      if (!permissions?.has(PermissionFlagsBits.ViewChannel)) issues.push({ code: 'category_view_channel_missing', channelId: category.id });
      if (!permissions?.has(PermissionFlagsBits.ManageChannels)) issues.push({ code: 'category_manage_channels_missing', channelId: category.id });
    }
  }

  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) issues.push({ code: 'manage_channels_missing' });
  if (!me?.permissions.has(PermissionFlagsBits.ViewChannel)) issues.push({ code: 'view_channel_missing' });

  for (const roleId of [...new Set([...(section.settings.managerRoleIds || []), ...(section.settings.approverRoleIds || [])])]) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) warnings.push({ code: 'configured_role_missing', roleId });
  }

  for (const room of listRooms(guild.id).filter((item) => item.status !== 'closed')) {
    const channel = room.channelId ? (guild.channels.cache.get(room.channelId) || await guild.channels.fetch(room.channelId).catch(() => null)) : null;
    if (!channel) issues.push({ code: 'active_room_channel_missing', roomId: room.roomId, channelId: room.channelId });
  }

  return {
    module: SECTION,
    guildId: guild.id,
    enabled: guildManager.isModuleEnabled(guild.id, SECTION),
    healthy: issues.length === 0,
    activeRooms: listRooms(guild.id).filter((room) => room.status !== 'closed').length,
    pendingRequests: listRequests(guild.id, 'pending').length,
    issues,
    warnings,
    checkedAt: now(),
  };
}

module.exports = {
  SECTION,
  TICK_MS,
  DEFAULT_PURPOSES,
  defaultSection,
  normalizeSection,
  normalizeRoom,
  normalizeRequest,
  getSection,
  saveSection,
  updateSection,
  updateSettings,
  incrementAnalytics,
  getRoom,
  getRequest,
  listRooms,
  listRequests,
  listUserRooms,
  listUserRequests,
  saveRoom,
  saveRequest,
  updateRequest,
  setRequestMessage,
  setRoomControlMessage,
  createRequest,
  reviewRequest,
  createRoom,
  addParticipants,
  removeParticipants,
  setRoomLocked,
  addRoomNote,
  appendRoomAudit,
  closeRoom,
  createTranscript,
  processGuild,
  startup,
  buildHealth,
  isManager,
  isApprover,
  isParticipant,
  resolveTextChannel,
};
