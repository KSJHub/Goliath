'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const privateRooms = require('../../../../modules/utilityStudio/privateRooms/privateRooms');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });
const fail = (res, error, status = 400) => res.status(status).json({ success: false, error: error?.message || 'Private Rooms request failed.' });

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function actor(req) { return String(req.session?.user?.id || req.body?.actorId || '').trim() || null; }
function client(req) { return req.client || req.app?.get?.('goliath.client') || null; }
async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}
async function members(target) {
  if (!target) return [];
  await target.members.fetch().catch(() => null);
  return [...target.members.cache.values()]
    .filter((member) => !member.user?.bot)
    .map((member) => ({ id: member.id, name: member.displayName || member.user?.globalName || member.user?.username || member.id, username: member.user?.username || '', avatarUrl: member.displayAvatarURL?.({ extension: 'png', size: 64 }) || null }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 1000);
}
async function overview(req, id) {
  const target = await guild(req, id);
  const section = privateRooms.getSection(id);
  const rooms = privateRooms.listRooms(id);
  const requests = privateRooms.listRequests(id);
  return {
    guildId: id,
    config: { ...section, enabled: guildManager.isModuleEnabled(id, 'privateRooms') },
    overview: {
      enabled: guildManager.isModuleEnabled(id, 'privateRooms'),
      activeRooms: rooms.filter((room) => room.status !== 'closed').length,
      closedRooms: rooms.filter((room) => room.status === 'closed').length,
      pendingRequests: requests.filter((request) => request.status === 'pending').length,
      analytics: section.analytics || {},
      health: target ? await privateRooms.buildHealth(target) : null,
    },
    rooms,
    requests,
    members: target ? await members(target) : [],
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { return ok(res, await overview(req, guildId(req))); }
  catch (error) { return fail(res, error); }
});
router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const id = guildId(req);
    guildManager.setModuleEnabled(id, 'privateRooms', req.body?.enabled === true, { actorId: actor(req), action: 'private_rooms_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    privateRooms.updateSettings(id, req.body?.settings || req.body || {}, { actorId: actor(req), action: 'private_rooms_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rooms', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.createRoom(target, { ...(req.body || {}), createdBy: actor(req) }, { actorId: actor(req), action: 'private_room_dashboard_created' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rooms/:roomId/lock', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.setRoomLocked(target, req.params.roomId, req.body?.locked === true, actor(req), { actorId: actor(req), action: 'private_room_dashboard_lock' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rooms/:roomId/participants', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.addParticipants(target, req.params.roomId, req.body?.participantIds || [], actor(req), req.body?.reason || '', { actorId: actor(req), action: 'private_room_dashboard_participants_add' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.delete('/:guildId/rooms/:roomId/participants', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.removeParticipants(target, req.params.roomId, req.body?.participantIds || [], actor(req), req.body?.reason || '', { actorId: actor(req), action: 'private_room_dashboard_participants_remove' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rooms/:roomId/note', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.addRoomNote(target, req.params.roomId, actor(req), req.body?.note || '', { actorId: actor(req), action: 'private_room_dashboard_note' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rooms/:roomId/close', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const room = await privateRooms.closeRoom(target, req.params.roomId, actor(req), req.body?.reason || 'Closed from dashboard', { actorId: actor(req), action: 'private_room_dashboard_closed' });
    return ok(res, { room, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/requests/:requestId/review', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const decision = req.body?.decision === 'approve' ? 'approve' : 'deny';
    let request = await privateRooms.reviewRequest(target, req.params.requestId, decision, actor(req), req.body?.reason || '', { actorId: actor(req), action: 'private_room_dashboard_review' });
    if (decision === 'approve' && request.type === 'create_room') {
      const room = await privateRooms.createRoom(target, { purpose: request.purpose, reason: request.reason, requestedBy: request.requesterId, participantIds: request.participantIds, expiryHours: request.expiryHours, approvedBy: actor(req), createdBy: actor(req) }, { actorId: actor(req), action: 'private_room_dashboard_request_created' });
      request = privateRooms.updateRequest(id, request.requestId, { roomId: room.roomId }, { actorId: actor(req) });
    } else if (decision === 'approve' && request.type === 'add_participant' && request.roomId) {
      await privateRooms.addParticipants(target, request.roomId, request.participantIds, actor(req), request.reason || '', { actorId: actor(req), action: 'private_room_dashboard_request_add' });
    }
    return ok(res, { request, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/process', async (req, res) => {
  try {
    const id = guildId(req); const target = await guild(req, id); if (!target) throw new Error('Guild is unavailable.');
    const result = await privateRooms.processGuild(target, { actorId: actor(req), action: 'private_rooms_dashboard_process' });
    return ok(res, { result, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.get('/:guildId/export', (req, res) => {
  try {
    const id = guildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-private-rooms-${id}.json"`);
    return res.send(JSON.stringify({ ...privateRooms.getSection(id), enabled: guildManager.isModuleEnabled(id, 'privateRooms') }, null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
