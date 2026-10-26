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

  io.engine.use((req, res, next) => {
    const middleware = options.getSession?.();
    if (!middleware) return next(new Error('Session unavailable'));
    return middleware(req, res, next);
  });
  io.use(async (socket, next) => {
    try {
      const userId = socket.request.session?.user?.id;
      if (!userId) return next(new Error('Authentication required'));
      const { listDashboardGuilds } = require('../middleware/dashboardAccess');
      const security = require('../../core/security/protection/core');
      if (!security.isBotOwner(userId) && !(await listDashboardGuilds(options.client, userId)).length) return next(new Error('Staff access required'));
      return next();
    } catch { return next(new Error('Unable to verify access')); }
  });

  io.on('connection', (socket) => {
    console.log(`🟢 Dashboard connected: ${socket.id}`);
    const security = require('../../core/security/protection/core');
    if (security.isBotOwner(socket.request.session?.user?.id)) socket.join('goliath:tickets');

    async function joinGuildRoom(guildId) {
      const id = normaliseGuildId(guildId);
      if (!id) return;

      try {
        await new Promise((resolve, reject) => socket.request.session.reload((error) => error ? reject(error) : resolve()));
        const access = await options.resolveGuildAccess(options.client, socket.request.session?.user?.id, id);
        if (!access.allowed) return;
      } catch { return; }
      for (const current of socket.rooms) if (current.startsWith('guild:')) socket.leave(current);
      const room = getRoomName(id);
      socket.join(room);

      console.log(`${socket.id} joined ${room}`);
    }

    socket.on('joinGuild', joinGuildRoom);

    const accessTimer = setInterval(async () => {
      try {
        await new Promise((resolve, reject) => socket.request.session.reload((error) => error ? reject(error) : resolve()));
        const userId = socket.request.session?.user?.id;
        if (!userId) return socket.disconnect(true);
        if (!security.isBotOwner(userId)) socket.leave('goliath:tickets');
        for (const room of socket.rooms) {
          if (!room.startsWith('guild:')) continue;
          const access = await options.resolveGuildAccess(options.client, userId, room.slice(6));
          if (!access.allowed) socket.leave(room);
        }
      } catch { socket.disconnect(true); }
    }, 15000);
    accessTimer.unref?.();
    socket.on('disconnect', () => {
      clearInterval(accessTimer);
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

