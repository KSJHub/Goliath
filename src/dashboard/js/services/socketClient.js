import { io } from 'socket.io-client';

let socket = null;

function resolveGuildId(guild) {
  if (!guild) return '';

  if (typeof guild === 'string' || typeof guild === 'number') {
    return String(guild).trim();
  }

  if (typeof guild === 'object') {
    return String(
      guild.id ||
      guild.guildId ||
      guild.serverId ||
      guild.value ||
      ''
    ).trim();
  }

  return String(guild || '').trim();
}

function normaliseScopeVariants(scope) {
  const value = String(scope || '').trim().toLowerCase();

  if (!value) return [];

  const variants = new Set([value]);

  if (value.endsWith('s') && value.length > 1) {
    variants.add(value.slice(0, -1));
  } else {
    variants.add(`${value}s`);
  }

  return [...variants];
}

function eventMatchesModule(event, moduleName) {
  const scopes = normaliseScopeVariants(moduleName);

  if (!scopes.length) return true;

  const names = [
    event?.event,
    event?.type,
    event?.module,
    event?.scope,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return names.some((name) =>
    scopes.some((scope) =>
      name === scope ||
      name.startsWith(`${scope}.`) ||
      name.startsWith(`${scope}_`) ||
      name.includes(scope)
    )
  );
}

function resolveGuildUpdateData(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  return event.data || event.config || event.payload || event.state || event;
}

function getSocket() {
  if (!socket) {
    const socketUrl =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : undefined;

    socket = io(socketUrl, {
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('[Realtime] Connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Realtime] Disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('[Realtime] Connection Error:', error);
    });
  }

  return socket;
}

/*
|--------------------------------------------------------------------------
| Room Joiners
|--------------------------------------------------------------------------
*/

export function joinGuildRoom(guildId) {
  const id = resolveGuildId(guildId);

  if (!id || id === 'null' || id === '[object Object]') {
    return null;
  }

  const activeSocket = getSocket();
  activeSocket.emit('joinGuild', id);
  return activeSocket;
}

/*
|--------------------------------------------------------------------------
| Generic Event Listener
|--------------------------------------------------------------------------
*/

export function onSocketEvent(eventName, callback) {
  if (!eventName || typeof callback !== 'function') {
    return () => {};
  }

  const activeSocket = getSocket();
  activeSocket.on(eventName, callback);

  return () => {
    activeSocket.off(eventName, callback);
  };
}

/*
|--------------------------------------------------------------------------
| Guild Updates
|--------------------------------------------------------------------------
*/

export function listenForGuildUpdate(moduleName, callback) {
  if (!moduleName || typeof callback !== 'function') {
    return () => {};
  }

  return onSocketEvent('guild:update', (event) => {
    if (!eventMatchesModule(event, moduleName)) return;
    callback(resolveGuildUpdateData(event), event);
  });
}

/*
|--------------------------------------------------------------------------
| Disconnect
|--------------------------------------------------------------------------
*/

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
