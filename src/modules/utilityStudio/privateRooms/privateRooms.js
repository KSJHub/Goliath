'use strict';

const { ChannelType } = require('discord.js');
const base = require('./privateRooms.base');

const cleanIds = (value) => Array.isArray(value)
  ? [...new Set(value.map((id) => String(id || '').trim()).filter((id) => /^\d{15,25}$/.test(id)))]
  : [];

function titleCaseAction(value) {
  return String(value || 'event')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function transformAuditPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.embeds)) return payload;
  return {
    ...payload,
    embeds: payload.embeds.map((embed) => {
      const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : { ...embed };
      if (typeof data.description !== 'string') return data;
      const lines = data.description.split('\n').map((line) => {
        if (line.startsWith('**Action:** ')) return `**Action:** ${titleCaseAction(line.slice('**Action:** '.length))}`;
        if (line.startsWith('**Actor:** ')) return `**Performed by:** ${line.slice('**Actor:** '.length)}`;
        if (line.startsWith('**Users:** ')) return `**Members:** ${line.slice('**Users:** '.length)}`;
        if (line.startsWith('**Detail:** ')) return `**Details:** ${line.slice('**Detail:** '.length)}`;
        return line;
      });
      return { ...data, description: lines.join('\n') };
    }),
  };
}

async function withAuditFormatting(guild, work) {
  const auditId = base.getSection(guild.id).settings.auditChannelId;
  if (!auditId) return work();
  const channel = guild.channels.cache.get(auditId) || await guild.channels.fetch(auditId).catch(() => null);
  if (!channel?.send) return work();

  const originalSend = channel.send;
  channel.send = function patchedPrivateRoomsAuditSend(payload) {
    return originalSend.call(this, transformAuditPayload(payload));
  };
  try {
    return await work();
  } finally {
    channel.send = originalSend;
  }
}

async function memberDisplayName(guild, userId) {
  if (!userId) return 'System';
  const member = guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId)).catch(() => null);
  return member?.displayName || member?.user?.globalName || member?.user?.username || 'Unknown Member';
}

function roomCategoryName(room) {
  const purpose = String(room?.purpose || 'Private Room').trim().replace(/\s+/g, ' ').slice(0, 70);
  return `🔒 PRIVATE ROOM · ${purpose}`.slice(0, 100);
}

function getRoomCategoryId(guildId, roomId) {
  return base.getSection(guildId).roomCategories?.[String(roomId)] || null;
}

function setRoomCategoryId(guildId, roomId, categoryId, meta = {}) {
  base.updateSection(guildId, (section) => {
    const roomCategories = { ...(section.roomCategories || {}) };
    if (categoryId) roomCategories[String(roomId)] = String(categoryId);
    else delete roomCategories[String(roomId)];
    return { ...section, roomCategories };
  }, { ...meta, action: meta.action || 'private_room_category_tracking' });
}

async function resolveRoomCategory(guild, roomId) {
  const categoryId = getRoomCategoryId(guild.id, roomId);
  if (!categoryId) return null;
  const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
  return category?.type === ChannelType.GuildCategory ? category : null;
}

function copyPermissionOverwrites(channel) {
  return [...(channel?.permissionOverwrites?.cache?.values?.() || [])].map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  }));
}

async function ensureDedicatedCategory(guild, room, meta = {}) {
  if (!room?.roomId || !room?.channelId || room.status === 'closed') return null;
  const existing = await resolveRoomCategory(guild, room.roomId);
  if (existing) return existing;

  const channel = guild.channels.cache.get(room.channelId) || await guild.channels.fetch(room.channelId).catch(() => null);
  if (!channel) return null;

  const category = await guild.channels.create({
    name: roomCategoryName(room),
    type: ChannelType.GuildCategory,
    permissionOverwrites: copyPermissionOverwrites(channel),
    reason: `Goliath Private Room category ${room.roomId}`,
  });

  try {
    await channel.setParent(category.id, {
      lockPermissions: true,
      reason: `Goliath Private Room category ${room.roomId}`,
    });
  } catch (error) {
    await category.delete('Private Room category setup failed').catch(() => null);
    throw error;
  }

  setRoomCategoryId(guild.id, room.roomId, category.id, meta);
  return category;
}

async function createRoom(guild, input = {}, meta = {}) {
  const creatorId = String(input.createdBy || meta.actorId || '').trim();
  const requestedBy = String(input.requestedBy || '').trim();
  const participantIds = cleanIds([
    ...(Array.isArray(input.participantIds) ? input.participantIds : []),
    requestedBy || creatorId,
  ]);

  const room = await withAuditFormatting(guild, () => base.createRoom(guild, {
    ...input,
    participantIds,
  }, meta));

  await ensureDedicatedCategory(guild, room, { ...meta, action: 'private_room_category_created' });
  return base.getRoom(guild.id, room.roomId);
}

async function addParticipants(guild, roomId, userIds, actorId, reason = '', meta = {}) {
  const before = base.getRoom(guild.id, roomId);
  const room = await withAuditFormatting(guild, () => base.addParticipants(guild, roomId, userIds, actorId, reason, meta));
  const category = await ensureDedicatedCategory(guild, room, meta);
  if (category) {
    const additions = room.participantIds.filter((id) => !before?.participantIds?.includes(id));
    for (const userId of additions) {
      await category.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        SendMessages: room.status !== 'locked',
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      }, { reason: 'Goliath Private Rooms participant added' }).catch(() => null);
    }
  }
  return base.getRoom(guild.id, roomId);
}

async function removeParticipants(guild, roomId, userIds, actorId, reason = '', meta = {}) {
  const removals = cleanIds(userIds);
  const room = await withAuditFormatting(guild, () => base.removeParticipants(guild, roomId, removals, actorId, reason, meta));
  const category = await resolveRoomCategory(guild, roomId);
  if (category) {
    for (const userId of removals) {
      await category.permissionOverwrites.delete(userId, 'Goliath Private Rooms participant removed').catch(() => null);
    }
  }
  return room;
}

async function setRoomLocked(guild, roomId, locked, actorId, meta = {}) {
  const room = await withAuditFormatting(guild, () => base.setRoomLocked(guild, roomId, locked, actorId, meta));
  await ensureDedicatedCategory(guild, room, meta);
  return room;
}

async function addRoomNote(guild, roomId, actorId, note, meta = {}) {
  const text = String(note || '').trim().slice(0, 1000);
  if (!text) throw new Error('Enter a note first.');

  const room = await withAuditFormatting(guild, () => base.appendRoomAudit(guild, roomId, {
    type: 'management_note',
    actorId,
    detail: text,
  }, meta));

  await ensureDedicatedCategory(guild, room, meta);
  const channel = await base.resolveTextChannel(guild, room?.channelId);
  if (channel) {
    const displayName = await memberDisplayName(guild, actorId);
    await channel.send({
      embeds: [{
        color: 0xFEE75C,
        title: '📝 Private Room Note',
        description: text,
        footer: { text: `Added by ${displayName}` },
        timestamp: new Date().toISOString(),
      }],
      allowedMentions: { parse: [] },
    }).catch(() => null);
  }
  return room;
}

async function appendRoomAudit(guild, roomId, input = {}, meta = {}) {
  return withAuditFormatting(guild, () => base.appendRoomAudit(guild, roomId, input, meta));
}

async function reviewRequest(guild, requestId, decision, actorId, reason = '', meta = {}) {
  return withAuditFormatting(guild, () => base.reviewRequest(guild, requestId, decision, actorId, reason, meta));
}

async function closeRoom(guild, roomId, actorId = null, reason = '', meta = {}) {
  const category = await resolveRoomCategory(guild, roomId);
  const room = await withAuditFormatting(guild, () => base.closeRoom(guild, roomId, actorId, reason, meta));
  if (category) await category.delete(`Goliath Private Room closed: ${reason || 'completed'}`).catch(() => null);
  setRoomCategoryId(guild.id, roomId, null, { ...meta, action: 'private_room_category_removed' });
  return room;
}

async function processGuild(guild, meta = {}) {
  if (!base.getSection || !base.listRooms) return base.processGuild(guild, meta);
  const rooms = base.listRooms(guild.id).filter((item) => item.status !== 'closed' && item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now());
  const result = { expired: 0, failures: 0 };
  for (const room of rooms) {
    try {
      await closeRoom(guild, room.roomId, guild.members.me?.id || null, 'Automatic room expiry', { ...meta, action: 'private_room_expired' });
      result.expired += 1;
    } catch (error) {
      result.failures += 1;
      base.incrementAnalytics(guild.id, { failures: 1 }, meta);
      console.warn(`[PrivateRooms] Failed to expire ${room.roomId}: ${error.message}`);
    }
  }
  base.incrementAnalytics(guild.id, { lastProcessedAt: new Date().toISOString() }, meta);
  return result;
}

async function buildHealth(guild) {
  const health = await base.buildHealth(guild);
  for (const room of base.listRooms(guild.id).filter((item) => item.status !== 'closed')) {
    const categoryId = getRoomCategoryId(guild.id, room.roomId);
    if (!categoryId) {
      health.warnings.push({ code: 'active_room_category_missing', roomId: room.roomId });
      continue;
    }
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      health.issues.push({ code: 'active_room_category_unavailable', roomId: room.roomId, categoryId });
    }
  }
  health.healthy = health.issues.length === 0;
  return health;
}

module.exports = {
  ...base,
  createRoom,
  addParticipants,
  removeParticipants,
  setRoomLocked,
  addRoomNote,
  appendRoomAudit,
  reviewRequest,
  closeRoom,
  processGuild,
  buildHealth,
  getRoomCategoryId,
  ensureDedicatedCategory,
};
