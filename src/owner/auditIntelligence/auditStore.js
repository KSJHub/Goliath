'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, getRuntimePaths } = require('../../config/runtimePaths');

const paths = getRuntimePaths(process.env.BOT_MODE || 'DEV');
const root = path.join(paths.data, 'audit');
const HISTORY_LIMIT = 100;
const LEGACY_CONFIG_FILE = path.join(root, 'config.json');
const SHARED_ROOT = path.dirname(PROJECT_ROOT);
const SHARED_CONFIG_FILE = path.join(SHARED_ROOT, '.goliath-audit-control.json');
const COMMAND_CENTER_GUILD_ID = '1515201360386068642';
const REGISTRY_MODES = ['DEV', 'BETA', 'PRODUCTION'];
const LIVE_PROBE_REQUEST_LIMIT = 25;
const LIVE_PROBE_TTL_MS = 30 * 1000;

function runtimeMode() {
  const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  if (mode === 'PROD' || mode === 'PRODUCTION') return 'PRODUCTION';
  if (mode === 'BETA') return 'BETA';
  return 'DEV';
}
function registryFile(mode = runtimeMode()) {
  return path.join(SHARED_ROOT, `.goliath-audit-registry-${String(mode).toLowerCase()}.json`);
}
function scopedGuildIds(mode) {
  const envName = mode === 'PRODUCTION' ? 'PRODUCTION_GUILD_IDS' : `${mode}_GUILD_IDS`;
  return String(process.env[envName] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { ensure(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function defaultConfig() {
  return {
    version: 1,
    commandCenter: {
      guildId: COMMAND_CENTER_GUILD_ID,
      categoryId: null,
      channelId: null,
      messageId: null,
      layoutMode: 'owner-managed',
      channelName: null,
      categoryName: null,
    },
    autoProvision: true,
    guilds: {},
    control: {
      liveProbeRequests: [],
    },
  };
}
function normalizeConfig(current = {}) {
  return {
    ...defaultConfig(),
    ...current,
    commandCenter: {
      ...defaultConfig().commandCenter,
      ...(current.commandCenter || {}),
      guildId: String(current.commandCenter?.guildId || COMMAND_CENTER_GUILD_ID).trim(),
    },
    guilds: current.guilds && typeof current.guilds === 'object' ? current.guilds : {},
    control: {
      ...defaultConfig().control,
      ...(current.control && typeof current.control === 'object' ? current.control : {}),
      liveProbeRequests: Array.isArray(current.control?.liveProbeRequests) ? current.control.liveProbeRequests : [],
    },
  };
}
function bootstrapSharedConfig() {
  if (fs.existsSync(SHARED_CONFIG_FILE)) return;
  if (runtimeMode() !== 'DEV') return;
  const legacy = readJson(LEGACY_CONFIG_FILE, null);
  writeJson(SHARED_CONFIG_FILE, normalizeConfig(legacy || defaultConfig()));
}
function getConfig() {
  bootstrapSharedConfig();
  if (fs.existsSync(SHARED_CONFIG_FILE)) return normalizeConfig(readJson(SHARED_CONFIG_FILE, defaultConfig()));
  return normalizeConfig(readJson(LEGACY_CONFIG_FILE, defaultConfig()));
}
function saveConfig(config) {
  const next = normalizeConfig(config || {});
  if (runtimeMode() === 'DEV') writeJson(SHARED_CONFIG_FILE, next);
  else if (!fs.existsSync(SHARED_CONFIG_FILE)) writeJson(LEGACY_CONFIG_FILE, next);
  return next;
}
function updateConfig(patch = {}) {
  const current = getConfig();
  const next = {
    ...current,
    ...patch,
    commandCenter: patch.commandCenter ? { ...current.commandCenter, ...patch.commandCenter } : current.commandCenter,
    guilds: patch.guilds ? { ...current.guilds, ...patch.guilds } : current.guilds,
    control: patch.control ? { ...current.control, ...patch.control } : current.control,
  };
  return saveConfig(next);
}
function writeSharedControlRequests(requests) {
  const current = getConfig();
  const next = normalizeConfig({
    ...current,
    control: {
      ...(current.control || {}),
      liveProbeRequests: requests.slice(-LIVE_PROBE_REQUEST_LIMIT),
    },
  });
  writeJson(SHARED_CONFIG_FILE, next);
  return next.control.liveProbeRequests;
}
function liveProbeTerminalAt(request) {
  return Date.parse(request?.completedAt || request?.failedAt || request?.expiredAt || '') || 0;
}
function normalizeLiveProbeLifecycle(request, now = Date.now()) {
  if (!request || typeof request !== 'object') return request;
  const status = String(request.status || 'pending').toLowerCase();
  const expiresAt = Date.parse(request.expiresAt || '') || 0;
  if ((status === 'pending' || status === 'claimed') && expiresAt && expiresAt <= now) {
    return {
      ...request,
      status: 'expired',
      expiredAt: request.expiredAt || new Date(now).toISOString(),
      result: request.result || { started: false, reason: 'expired' },
    };
  }
  return request;
}
function mutateLiveProbeRequests(mutator) {
  const now = Date.now();
  const current = getConfig().control?.liveProbeRequests || [];
  const active = current
    .map((request) => normalizeLiveProbeLifecycle(request, now))
    .filter((request) => {
      const status = String(request?.status || 'pending').toLowerCase();
      if (!['completed', 'failed', 'expired'].includes(status)) return true;
      const terminalAt = liveProbeTerminalAt(request);
      return !terminalAt || now - terminalAt < LIVE_PROBE_TTL_MS;
    });
  const next = mutator([...active]);
  return writeSharedControlRequests(Array.isArray(next) ? next : active);
}
function refreshLiveProbeLifecycle() {
  return mutateLiveProbeRequests((requests) => requests);
}
function createLiveProbeRequest(guildId, targetMode, requestedBy = null) {
  const guild = String(guildId || '').trim();
  const target = String(targetMode || '').trim().toUpperCase();
  if (!guild || !REGISTRY_MODES.includes(target)) return null;
  const now = Date.now();
  const request = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    guildId: guild,
    targetMode: target,
    requestedBy: requestedBy ? String(requestedBy) : null,
    requestedFrom: runtimeMode(),
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LIVE_PROBE_TTL_MS).toISOString(),
    claimedAt: null,
    claimedBy: null,
    completedAt: null,
    completedBy: null,
    failedAt: null,
    failedBy: null,
    expiredAt: null,
    result: null,
  };
  mutateLiveProbeRequests((requests) => [...requests, request]);
  return request;
}
function getLiveProbeRequest(requestId) {
  const id = String(requestId || '');
  if (!id) return null;
  const requests = refreshLiveProbeLifecycle();
  return requests.find((request) => String(request?.id || '') === id) || null;
}
function getPendingLiveProbeRequests(mode = runtimeMode()) {
  const target = String(mode || runtimeMode()).toUpperCase();
  return refreshLiveProbeLifecycle().filter((request) => request?.status === 'pending' && String(request?.targetMode || '').toUpperCase() === target);
}
function claimLiveProbeRequest(requestId, claimedBy = runtimeMode()) {
  const id = String(requestId || '');
  const mode = String(claimedBy || runtimeMode()).toUpperCase();
  if (!id || !REGISTRY_MODES.includes(mode)) return null;
  let claimed = null;
  mutateLiveProbeRequests((requests) => requests.map((request) => {
    if (String(request?.id || '') !== id) return request;
    if (request.status !== 'pending' || String(request.targetMode || '').toUpperCase() !== mode) return request;
    claimed = {
      ...request,
      status: 'claimed',
      claimedAt: new Date().toISOString(),
      claimedBy: mode,
    };
    return claimed;
  }));
  return claimed;
}
function completeLiveProbeRequest(requestId, result = {}, completedBy = runtimeMode()) {
  const id = String(requestId || '');
  const mode = String(completedBy || runtimeMode()).toUpperCase();
  if (!id) return null;
  let completed = null;
  mutateLiveProbeRequests((requests) => requests.map((request) => {
    if (String(request?.id || '') !== id) return request;
    const owner = String(request.claimedBy || request.targetMode || '').toUpperCase();
    if (!['claimed', 'pending'].includes(request.status) || owner !== mode) return request;
    completed = {
      ...request,
      status: 'completed',
      completedAt: new Date().toISOString(),
      completedBy: mode,
      failedAt: null,
      failedBy: null,
      result: result && typeof result === 'object' ? result : { started: false, reason: 'invalid-result' },
    };
    return completed;
  }));
  return completed;
}
function failLiveProbeRequest(requestId, result = {}, failedBy = runtimeMode()) {
  const id = String(requestId || '');
  const mode = String(failedBy || runtimeMode()).toUpperCase();
  if (!id) return null;
  let failed = null;
  mutateLiveProbeRequests((requests) => requests.map((request) => {
    if (String(request?.id || '') !== id) return request;
    const owner = String(request.claimedBy || request.targetMode || '').toUpperCase();
    if (!['claimed', 'pending'].includes(request.status) || owner !== mode) return request;
    failed = {
      ...request,
      status: 'failed',
      failedAt: new Date().toISOString(),
      failedBy: mode,
      result: result && typeof result === 'object' ? result : { started: false, reason: 'invalid-result' },
    };
    return failed;
  }));
  return failed;
}

function registryGuild(guild, observedAt) {
  if (!guild?.id) return null;
  return {
    guildId: String(guild.id),
    name: guild.name || String(guild.id),
    ownerId: guild.ownerId || null,
    memberCount: Number.isFinite(guild.memberCount) ? guild.memberCount : null,
    observedAt,
  };
}
function publishGuildRegistry(client) {
  if (!client?.guilds?.cache) return null;
  const observedAt = new Date().toISOString();
  const mode = runtimeMode();
  const guilds = [...client.guilds.cache.values()]
    .map((guild) => registryGuild(guild, observedAt))
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const snapshot = {
    version: 1,
    environment: mode,
    botUserId: client.user?.id || null,
    botTag: client.user?.tag || null,
    observedAt,
    guilds,
  };
  writeJson(registryFile(mode), snapshot);
  return snapshot;
}
function getGuildRegistry() {
  const merged = new Map();
  for (const mode of REGISTRY_MODES) {
    const snapshot = readJson(registryFile(mode), null);
    if (!snapshot || !Array.isArray(snapshot.guilds)) continue;
    for (const item of snapshot.guilds) {
      if (!item?.guildId) continue;
      const guildId = String(item.guildId);
      const current = merged.get(guildId) || {
        guildId,
        name: item.name || guildId,
        ownerId: item.ownerId || null,
        memberCount: item.memberCount ?? null,
        environments: {},
        lastSeenAt: null,
      };
      current.name = item.name || current.name;
      current.ownerId = item.ownerId || current.ownerId;
      if (item.memberCount !== null && item.memberCount !== undefined) current.memberCount = item.memberCount;
      current.environments[mode] = {
        botUserId: snapshot.botUserId || null,
        botTag: snapshot.botTag || null,
        observedAt: item.observedAt || snapshot.observedAt || null,
      };
      const seen = item.observedAt || snapshot.observedAt || null;
      if (seen && (!current.lastSeenAt || seen > current.lastSeenAt)) current.lastSeenAt = seen;
      merged.set(guildId, current);
    }
  }
  for (const mode of REGISTRY_MODES) {
    for (const guildId of scopedGuildIds(mode)) {
      const current = merged.get(guildId) || {
        guildId,
        name: guildId,
        ownerId: null,
        memberCount: null,
        environments: {},
        lastSeenAt: null,
      };
      current.environments[mode] ||= {
        botUserId: null,
        botTag: null,
        observedAt: null,
        source: 'configured-scope',
      };
      merged.set(guildId, current);
    }
  }
  return [...merged.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function pushUnique(items, value, key = (item) => JSON.stringify(item), limit = HISTORY_LIMIT) {
  if (value === undefined || value === null) return items;
  const list = Array.isArray(items) ? items : [];
  const identity = key(value);
  const filtered = list.filter((item) => key(item) !== identity);
  filtered.push(value);
  return filtered.slice(-limit);
}
function increment(map, key) {
  if (!key) return;
  map[key] = Number(map[key] || 0) + 1;
}
function eventSummary(event) {
  return {
    eventId: event.eventId || null,
    timestamp: event.timestamp || null,
    type: event.type || 'unknown',
    category: event.category || 'system',
    action: event.action || 'observe',
    title: event.title || event.type || 'Audit Event',
    guildId: event.guildId || null,
    guildName: event.guildName || null,
    channelId: event.channel?.id || null,
    channelName: event.channel?.name || null,
    reason: event.reason || null,
    relation: event.relation || 'subject',
  };
}

function appendEvent(event) {
  const guildId = String(event.guildId || 'system');
  const file = path.join(ensure(path.join(root, 'events', guildId)), `${monthKey(new Date(event.timestamp || Date.now()))}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  updateGuildIndex(event);
  if (event.user?.id) updateUserIndex(event.user.id, event);
  if (event.actor?.id) {
    if (event.actor.id !== event.user?.id) updateUserIndex(event.actor.id, { ...event, relation: 'actor' });
    else updateActorHistoryOnly(event.actor.id, event);
  }
  return event;
}

function updateGuildIndex(event) {
  if (!event.guildId) return;
  const file = path.join(root, 'guilds', `${event.guildId}.json`);
  const current = readJson(file, {
    guildId: event.guildId,
    guildName: event.guildName || null,
    firstObservedAt: event.timestamp,
    eventCount: 0,
    lastEventAt: null,
    eventTypes: {},
    categories: {},
  });
  current.guildName = event.guildName || current.guildName;
  current.eventCount = Number(current.eventCount || 0) + 1;
  current.lastEventAt = event.timestamp;
  current.eventTypes ||= {};
  current.categories ||= {};
  increment(current.eventTypes, event.type || 'unknown');
  increment(current.categories, event.category || 'system');
  writeJson(file, current);
}

function updateIdentity(current, user, event) {
  if (!user) return;
  if (user.username) current.names = pushUnique(current.names, user.username, (value) => String(value).toLowerCase(), 25);
  if (user.globalName) current.globalNames = pushUnique(current.globalNames, user.globalName, (value) => String(value).toLowerCase(), 25);
  if (user.displayName) current.displayNames = pushUnique(current.displayNames, user.displayName, (value) => String(value).toLowerCase(), 25);
  if (user.nickname) {
    current.nicknames = pushUnique(current.nicknames, {
      guildId: event.guildId || null,
      guildName: event.guildName || null,
      nickname: user.nickname,
      observedAt: event.timestamp,
    }, (item) => `${item.guildId}:${String(item.nickname).toLowerCase()}`);
  }
  current.bot = Boolean(user.bot);
  current.accountCreatedAt = user.accountCreatedAt || current.accountCreatedAt || null;
}

function updateMembershipHistory(current, event, user) {
  if (!event.guildId || event.relation === 'actor') return;
  const guild = current.guilds[event.guildId] || {
    guildId: event.guildId,
    guildName: event.guildName || null,
    firstObservedAt: event.timestamp,
    lastObservedAt: null,
    eventCount: 0,
    firstJoinedAt: null,
    lastJoinedAt: null,
    lastLeftAt: null,
    joinCount: 0,
    leaveCount: 0,
    currentMember: null,
    eventTypes: {},
  };
  guild.guildName = event.guildName || guild.guildName;
  guild.lastObservedAt = event.timestamp;
  guild.eventCount = Number(guild.eventCount || 0) + 1;
  guild.eventTypes ||= {};
  increment(guild.eventTypes, event.type || 'unknown');
  const joinedAt = user?.joinedAt || event.after?.joinedAt || null;
  if (joinedAt && !guild.firstJoinedAt) guild.firstJoinedAt = joinedAt;
  if (event.type === 'member.join') {
    guild.currentMember = true;
    guild.joinCount = Number(guild.joinCount || 0) + 1;
    guild.lastJoinedAt = joinedAt || event.timestamp;
    if (!guild.firstJoinedAt) guild.firstJoinedAt = guild.lastJoinedAt;
    current.joinHistory = pushUnique(current.joinHistory, { guildId: event.guildId, guildName: event.guildName || null, joinedAt: guild.lastJoinedAt, eventId: event.eventId || null }, (item) => `${item.guildId}:${item.eventId || item.joinedAt}`);
  }
  if (['member.leave', 'member.kick', 'member.ban', 'member.prune'].includes(event.type)) {
    guild.currentMember = false;
    guild.leaveCount = Number(guild.leaveCount || 0) + 1;
    guild.lastLeftAt = event.timestamp;
    current.leaveHistory = pushUnique(current.leaveHistory, { guildId: event.guildId, guildName: event.guildName || null, leftAt: event.timestamp, type: event.type, reason: event.reason || null, actorId: event.actor?.id || null, eventId: event.eventId || null }, (item) => `${item.guildId}:${item.eventId || item.leftAt}`);
  }
  current.guilds[event.guildId] = guild;
}

function updateRoleHistory(current, event) {
  if (!event.guildId || event.relation === 'actor') return;
  if (!['member.role.add', 'member.role.remove', 'member.roles'].includes(event.type)) return;
  current.roleHistory = pushUnique(current.roleHistory, { guildId: event.guildId, guildName: event.guildName || null, timestamp: event.timestamp, type: event.type, before: event.before || null, after: event.after || null, actorId: event.actor?.id || null, reason: event.reason || null, eventId: event.eventId || null }, (item) => item.eventId || `${item.guildId}:${item.timestamp}:${item.type}`);
}
function updateModerationHistory(current, event) {
  if (event.relation === 'actor') return;
  if (event.category !== 'moderation' && !/^member\.(ban|unban|kick|timeout|prune)/.test(String(event.type || ''))) return;
  current.moderationHistory = pushUnique(current.moderationHistory, { guildId: event.guildId || null, guildName: event.guildName || null, timestamp: event.timestamp, type: event.type, title: event.title || null, actorId: event.actor?.id || null, actorName: event.actor?.globalName || event.actor?.username || null, reason: event.reason || null, before: event.before || null, after: event.after || null, eventId: event.eventId || null }, (item) => item.eventId || `${item.guildId}:${item.timestamp}:${item.type}`);
}
function updateVoiceHistory(current, event) {
  if (event.relation === 'actor' || event.category !== 'voice') return;
  current.voiceHistory = pushUnique(current.voiceHistory, { guildId: event.guildId || null, guildName: event.guildName || null, timestamp: event.timestamp, type: event.type, before: event.before || null, after: event.after || null, eventId: event.eventId || null }, (item) => item.eventId || `${item.guildId}:${item.timestamp}`);
}
function updateActorHistory(current, event) {
  if (event.relation !== 'actor') return;
  current.actorHistory = pushUnique(current.actorHistory, { guildId: event.guildId || null, guildName: event.guildName || null, timestamp: event.timestamp, type: event.type || 'unknown', category: event.category || 'system', action: event.action || 'observe', title: event.title || event.type || 'Audit Event', target: event.target || (event.user?.id ? { id: event.user.id, label: event.user.globalName || event.user.username || event.user.id } : null), channelId: event.channel?.id || null, channelName: event.channel?.name || null, reason: event.reason || null, source: event.source || null, result: event.result || null, actorSnapshot: event.actor || null, auditLogId: event.metadata?.auditLog?.auditLogId || null, operationId: event.metadata?.operation?.operationId || null, eventId: event.eventId || null }, (item) => item.eventId || `${item.guildId}:${item.timestamp}:${item.type}`, HISTORY_LIMIT);
}
function updateActorHistoryOnly(userId, event) {
  const file = path.join(root, 'users', `${userId}.json`);
  const current = readJson(file, null);
  if (!current) return updateUserIndex(userId, { ...event, relation: 'actor' });
  current.actorHistory ||= [];
  current.relations ||= { subject: 0, actor: 0 };
  increment(current.relations, 'actor');
  current.lastObservedAt = event.timestamp || current.lastObservedAt || null;
  updateActorHistory(current, { ...event, relation: 'actor' });
  writeJson(file, current);
}
function updateUserIndex(userId, event) {
  const file = path.join(root, 'users', `${userId}.json`);
  const current = readJson(file, { userId, firstObservedAt: event.timestamp, lastObservedAt: null, eventCount: 0, names: [], globalNames: [], displayNames: [], nicknames: [], guilds: {}, eventTypes: {}, categories: {}, relations: { subject: 0, actor: 0 }, joinHistory: [], leaveHistory: [], roleHistory: [], moderationHistory: [], voiceHistory: [], actorHistory: [], recentEvents: [] });
  const user = event.user?.id === userId ? event.user : event.actor?.id === userId ? event.actor : null;
  current.firstObservedAt ||= event.timestamp;
  current.lastObservedAt = event.timestamp;
  current.eventCount = Number(current.eventCount || 0) + 1;
  current.eventTypes ||= {};
  current.categories ||= {};
  current.relations ||= { subject: 0, actor: 0 };
  current.actorHistory ||= [];
  increment(current.eventTypes, event.type || 'unknown');
  increment(current.categories, event.category || 'system');
  increment(current.relations, event.relation === 'actor' ? 'actor' : 'subject');
  updateIdentity(current, user, event);
  updateMembershipHistory(current, event, user);
  updateRoleHistory(current, event);
  updateModerationHistory(current, event);
  updateVoiceHistory(current, event);
  updateActorHistory(current, event);
  current.recentEvents = pushUnique(current.recentEvents, eventSummary(event), (item) => item.eventId || `${item.timestamp}:${item.type}`, 50);
  writeJson(file, current);
}

function getUser(userId) { return readJson(path.join(root, 'users', `${String(userId)}.json`), null); }
function modeAuditRoot(mode) {
  const normalized = String(mode || '').toUpperCase();
  if (normalized === runtimeMode()) return root;
  const folder = normalized === 'PRODUCTION' ? 'production' : normalized.toLowerCase();
  return path.join(SHARED_ROOT, folder, 'src', 'runtime', folder, 'data', 'audit');
}
function availableAuditRoots() {
  const roots = [];
  for (const mode of REGISTRY_MODES) {
    const candidate = modeAuditRoot(mode);
    if (!fs.existsSync(candidate)) continue;
    roots.push({ mode, root: candidate });
  }
  if (!roots.some((item) => item.root === root) && fs.existsSync(root)) roots.push({ mode: runtimeMode(), root });
  return roots;
}
function mergeCountMap(target, source) {
  for (const [key, value] of Object.entries(source || {})) target[key] = Number(target[key] || 0) + Number(value || 0);
  return target;
}
function mergeUniqueArray(target, source, keyFn, limit = HISTORY_LIMIT) {
  const map = new Map();
  for (const item of [...(target || []), ...(source || [])]) {
    if (item === undefined || item === null) continue;
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, item);
  }
  return [...map.values()]
    .sort((a, b) => String(a?.timestamp || a?.observedAt || a?.joinedAt || a?.leftAt || '').localeCompare(String(b?.timestamp || b?.observedAt || b?.joinedAt || b?.leftAt || '')))
    .slice(-limit);
}
function mergeGuildMembership(target, source) {
  const next = { ...(target || {}) };
  for (const [guildId, guild] of Object.entries(source || {})) {
    const current = next[guildId] || {};
    const currentLast = String(current.lastObservedAt || '');
    const incomingLast = String(guild.lastObservedAt || '');
    next[guildId] = {
      ...current,
      ...guild,
      firstObservedAt: [current.firstObservedAt, guild.firstObservedAt].filter(Boolean).sort()[0] || null,
      lastObservedAt: currentLast > incomingLast ? current.lastObservedAt : guild.lastObservedAt || current.lastObservedAt || null,
      eventCount: Number(current.eventCount || 0) + Number(guild.eventCount || 0),
      joinCount: Number(current.joinCount || 0) + Number(guild.joinCount || 0),
      leaveCount: Number(current.leaveCount || 0) + Number(guild.leaveCount || 0),
      eventTypes: mergeCountMap({ ...(current.eventTypes || {}) }, guild.eventTypes || {}),
    };
  }
  return next;
}
function getUserAcrossModes(userId) {
  const id = String(userId || '');
  if (!id) return null;
  let merged = null;
  const environments = {};
  for (const item of availableAuditRoots()) {
    const record = readJson(path.join(item.root, 'users', `${id}.json`), null);
    if (!record) continue;
    environments[item.mode] = { firstObservedAt: record.firstObservedAt || null, lastObservedAt: record.lastObservedAt || null, eventCount: Number(record.eventCount || 0) };
    if (!merged) {
      merged = {
        userId: id,
        firstObservedAt: record.firstObservedAt || null,
        lastObservedAt: record.lastObservedAt || null,
        eventCount: 0,
        names: [], globalNames: [], displayNames: [], nicknames: [], guilds: {},
        eventTypes: {}, categories: {}, relations: { subject: 0, actor: 0 },
        joinHistory: [], leaveHistory: [], roleHistory: [], moderationHistory: [], voiceHistory: [], actorHistory: [], recentEvents: [],
      };
    }
    merged.firstObservedAt = [merged.firstObservedAt, record.firstObservedAt].filter(Boolean).sort()[0] || null;
    if (record.lastObservedAt && (!merged.lastObservedAt || record.lastObservedAt > merged.lastObservedAt)) merged.lastObservedAt = record.lastObservedAt;
    merged.eventCount += Number(record.eventCount || 0);
    merged.names = mergeUniqueArray(merged.names, record.names, (value) => String(value).toLowerCase(), 25);
    merged.globalNames = mergeUniqueArray(merged.globalNames, record.globalNames, (value) => String(value).toLowerCase(), 25);
    merged.displayNames = mergeUniqueArray(merged.displayNames, record.displayNames, (value) => String(value).toLowerCase(), 25);
    merged.nicknames = mergeUniqueArray(merged.nicknames, record.nicknames, (entry) => `${entry.guildId || ''}:${String(entry.nickname || '').toLowerCase()}`, 100);
    merged.guilds = mergeGuildMembership(merged.guilds, record.guilds);
    mergeCountMap(merged.eventTypes, record.eventTypes);
    mergeCountMap(merged.categories, record.categories);
    mergeCountMap(merged.relations, record.relations);
    merged.joinHistory = mergeUniqueArray(merged.joinHistory, record.joinHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.joinedAt}`, 100);
    merged.leaveHistory = mergeUniqueArray(merged.leaveHistory, record.leaveHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.leftAt}:${entry.type}`, 100);
    merged.roleHistory = mergeUniqueArray(merged.roleHistory, record.roleHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.timestamp}:${entry.type}`, 100);
    merged.moderationHistory = mergeUniqueArray(merged.moderationHistory, record.moderationHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.timestamp}:${entry.type}`, 100);
    merged.voiceHistory = mergeUniqueArray(merged.voiceHistory, record.voiceHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.timestamp}:${entry.type}`, 100);
    merged.actorHistory = mergeUniqueArray(merged.actorHistory, record.actorHistory, (entry) => entry.eventId || `${entry.guildId}:${entry.timestamp}:${entry.type}`, 100);
    merged.recentEvents = mergeUniqueArray(merged.recentEvents, record.recentEvents, (entry) => entry.eventId || `${entry.guildId}:${entry.timestamp}:${entry.type}:${entry.relation || 'subject'}`, 100);
    if (record.bot !== undefined && record.bot !== null) merged.bot = record.bot;
    if (record.accountCreatedAt && !merged.accountCreatedAt) merged.accountCreatedAt = record.accountCreatedAt;
  }
  if (!merged) return null;
  merged.environments = environments;
  return merged;
}
function searchIdentityValues(userId, record) {
  const values = [{ value: userId, kind: 'id', weight: 100 }];
  for (const value of record.names || []) values.push({ value, kind: 'username', weight: 50 });
  for (const value of record.globalNames || []) values.push({ value, kind: 'globalName', weight: 60 });
  for (const value of record.displayNames || []) values.push({ value, kind: 'displayName', weight: 70 });
  for (const entry of record.nicknames || []) if (entry?.nickname) values.push({ value: entry.nickname, kind: 'nickname', weight: 40 });
  return values.filter((entry) => entry.value !== undefined && entry.value !== null && String(entry.value).trim());
}
function identityMatchScore(value, candidate) {
  const normalized = String(candidate?.value || '').trim().toLowerCase();
  if (!normalized) return 0;
  const weight = Number(candidate?.weight || 0);
  if (normalized === value) return 1000 + weight;
  if (normalized.startsWith(value)) return 700 + weight;
  if (normalized.includes(value)) return 400 + weight;
  return 0;
}
function identityMatchKindLabel(kind) {
  return ({ id: 'ID', username: 'username', globalName: 'global name', displayName: 'display name', nickname: 'nickname' })[kind] || String(kind || 'identity');
}
function searchUsersAcrossModes(query, options = {}) {
  const value = String(query || '').trim().toLowerCase();
  if (!value) return [];
  const limit = Math.min(25, Math.max(1, Number(options.limit || 25)));
  const guildId = options.guildId ? String(options.guildId) : null;
  const found = new Map();

  for (const item of availableAuditRoots()) {
    const dir = path.join(item.root, 'users');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json'))) {
      const userId = name.slice(0, -5);
      const record = readJson(path.join(dir, name), null);
      if (!record) continue;
      if (guildId && !record.guilds?.[guildId]) continue;

      const matches = searchIdentityValues(userId, record)
        .map((candidate) => ({ ...candidate, score: identityMatchScore(value, candidate) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score);
      if (!matches.length) continue;

      const best = matches[0];
      const latestLabel = record.displayNames?.at?.(-1) || record.globalNames?.at?.(-1) || record.names?.at?.(-1) || userId;
      const current = found.get(userId) || {
        id: userId,
        label: latestLabel,
        environments: new Set(),
        score: 0,
        matchedOn: null,
        matchedValue: null,
        lastObservedAt: null,
      };
      current.environments.add(item.mode);
      if (best.score > current.score) {
        current.score = best.score;
        current.matchedOn = best.kind;
        current.matchedValue = String(best.value);
      }
      if (record.lastObservedAt && (!current.lastObservedAt || record.lastObservedAt > current.lastObservedAt)) {
        current.lastObservedAt = record.lastObservedAt;
        current.label = latestLabel;
      }
      found.set(userId, current);
    }
  }

  return [...found.values()]
    .sort((a, b) => b.score - a.score
      || b.environments.size - a.environments.size
      || String(b.lastObservedAt || '').localeCompare(String(a.lastObservedAt || ''))
      || String(a.label || '').localeCompare(String(b.label || ''))
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      label: entry.matchedOn && entry.matchedValue
        ? `${String(entry.label || entry.id).slice(0, 45)} • matched ${identityMatchKindLabel(entry.matchedOn)}: ${String(entry.matchedValue).slice(0, 35)}`
        : entry.label,
      environments: REGISTRY_MODES.filter((mode) => entry.environments.has(mode)),
      matchedOn: entry.matchedOn,
      matchedValue: entry.matchedValue,
    }));
}
function getGuild(guildId) { return readJson(path.join(root, 'guilds', `${String(guildId)}.json`), null); }
function getGuildEvents(guildId, options = {}) {
  const dir = path.join(root, 'events', String(guildId || ''));
  if (!guildId || !fs.existsSync(dir)) return [];
  const limit = Math.min(100, Math.max(1, Number(options.limit || 25)));
  const category = options.category ? String(options.category) : null;
  const prefix = options.typePrefix ? String(options.typePrefix) : null;
  const files = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name)).sort().reverse();
  const found = [];
  for (const name of files) {
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (category && String(event.category || 'system') !== category) continue;
      if (prefix && !String(event.type || '').startsWith(prefix)) continue;
      found.push(event);
      if (found.length >= limit) return found;
    }
  }
  return found;
}
function getRoot() { return root; }
function getControlConfigPath() { return SHARED_CONFIG_FILE; }

module.exports = {
  appendEvent,
  getUser,
  getUserAcrossModes,
  searchUsersAcrossModes,
  getGuild,
  getGuildEvents,
  getRoot,
  getControlConfigPath,
  getConfig,
  saveConfig,
  updateConfig,
  publishGuildRegistry,
  getGuildRegistry,
  runtimeMode,
  createLiveProbeRequest,
  getLiveProbeRequest,
  getPendingLiveProbeRequests,
  claimLiveProbeRequest,
  completeLiveProbeRequest,
  failLiveProbeRequest,
  refreshLiveProbeLifecycle,
};