let io = null;

function normaliseGuildId(guildId) {
  const id = String(guildId || '').trim();
  return /^\d{16,20}$/.test(id) ? id : '';
}

function getRoomName(guildId) {
  return `guild:${guildId}`;
}

function initSocketHub(server, options = {}) {
  const { Server } = require('socket.io');

  if (io) {
    return io; // prevent double init
  }

  io = new Server(server, {
    cors: {
      origin:
        options?.clientUrl ||
        'http://localhost:5175',

      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`🟢 Dashboard connected: ${socket.id}`);
    socket.join('goliath:tickets');

    function joinGuildRoom(guildId) {
      const id = normaliseGuildId(guildId);
      if (!id) return;

      const room = getRoomName(id);
      socket.join(room);

      console.log(`${socket.id} joined ${room}`);
    }

    socket.on('joinGuild', joinGuildRoom);

    socket.on('disconnect', () => {
      console.log(`🔴 Dashboard disconnected: ${socket.id}`);
    });
  });

  return io;
}

function buildGuildUpdate(guildId, payload = {}) {
  const id = normaliseGuildId(guildId);

  if (!id) return null;

  const data =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};

  return {
    ...data,
    guildId: id,
    updatedAt: new Date().toISOString(),
  };
}

function emitGuildUpdate(guildId, payload = {}) {
  const update = buildGuildUpdate(guildId, payload);
  if (!update) return null;

  if (io) {
    io.to(getRoomName(update.guildId)).emit('guild:update', update);
  }

  return update;
}

function emitSyncEvent(event, guildId, payload = {}) {
  const eventName = String(event || '').trim();
  if (!eventName) return null;

  const update = buildGuildUpdate(guildId, {
    ...payload,
    event: eventName,
  });
  if (!update) return null;

  if (io) {
    const room = getRoomName(update.guildId);
    io.to(room).emit(eventName, update);
    io.to(room).emit('guild:update', update);
  }

  return update;
}

function emitRoomEvent(room, event, update) {
  const roomName = String(room || '').trim();
  const eventName = String(event || '').trim();
  if (!roomName || !eventName || !io) return false;

  io.to(roomName).emit(eventName, update);
  return true;
}

module.exports = {
  initSocketHub,
  emitGuildUpdate,
  emitSyncEvent,
  emitRoomEvent,
};
