'use strict';

const auditStore = require('./auditStore');

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snapshotMember(member) {
  if (!member) return null;
  const user = member.user || member;
  return {
    id: user.id || member.id || null,
    username: user.username || null,
    globalName: user.globalName || null,
    displayName: member.displayName || user.globalName || user.username || null,
    bot: Boolean(user.bot),
    accountCreatedAt: iso(user.createdAt),
    joinedAt: iso(member.joinedAt),
    nickname: member.nickname || null,
    roles: member.roles?.cache
      ? member.roles.cache
        .filter((role) => role.id !== member.guild?.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => ({ id: role.id, name: role.name, position: role.position, permissions: role.permissions?.bitfield?.toString?.() || null }))
      : [],
    highestRole: member.roles?.highest ? {
      id: member.roles.highest.id,
      name: member.roles.highest.name,
      position: member.roles.highest.position,
    } : null,
    timedOutUntil: iso(member.communicationDisabledUntil),
    pending: Boolean(member.pending),
    permissions: member.permissions?.bitfield?.toString?.() || null,
    voice: member.voice ? {
      channelId: member.voice.channelId || null,
      serverMute: Boolean(member.voice.serverMute),
      serverDeaf: Boolean(member.voice.serverDeaf),
      selfMute: Boolean(member.voice.selfMute),
      selfDeaf: Boolean(member.voice.selfDeaf),
      streaming: Boolean(member.voice.streaming),
      selfVideo: Boolean(member.voice.selfVideo),
    } : null,
  };
}

function snapshotUser(user) {
  if (!user) return null;
  return {
    id: user.id || null,
    username: user.username || null,
    globalName: user.globalName || null,
    displayName: user.globalName || user.username || null,
    bot: Boolean(user.bot),
    accountCreatedAt: iso(user.createdAt),
    avatar: user.avatar || null,
    banner: user.banner || null,
  };
}

function reconcileGuildPresence(stored, liveGuilds) {
  const liveById = new Map((liveGuilds || []).filter((entry) => entry?.guildId).map((entry) => [String(entry.guildId), entry]));
  const storedGuilds = Object.values(stored.guilds || {}).map((guild) => ({ ...guild }));
  const reconciled = [];
  const seen = new Set();

  for (const guild of storedGuilds) {
    const guildId = String(guild.guildId || '');
    if (!guildId) continue;
    const live = liveById.get(guildId) || null;
    seen.add(guildId);
    reconciled.push({
      ...guild,
      guildId,
      guildName: live?.guildName || guild.guildName || guildId,
      storedCurrentMember: guild.currentMember,
      currentMember: Boolean(live) ? true : guild.currentMember === false ? false : null,
      liveVisible: Boolean(live),
      presenceSource: live ? 'live' : guild.currentMember === false ? 'stored-leave' : 'stored-history',
    });
  }

  for (const live of liveGuilds || []) {
    const guildId = String(live?.guildId || '');
    if (!guildId || seen.has(guildId)) continue;
    reconciled.push({
      guildId,
      guildName: live.guildName || guildId,
      firstObservedAt: null,
      lastObservedAt: null,
      eventCount: 0,
      joinCount: 0,
      leaveCount: 0,
      currentMember: true,
      storedCurrentMember: null,
      liveVisible: true,
      presenceSource: 'live',
      eventTypes: {},
    });
  }

  return reconciled.sort((a, b) => String(a.guildName || a.guildId).localeCompare(String(b.guildName || b.guildId)));
}

function summariseStored(stored, liveGuilds = []) {
  const guilds = reconcileGuildPresence(stored, liveGuilds);
  const currentGuilds = guilds.filter((guild) => guild.currentMember === true);
  const formerGuilds = guilds.filter((guild) => guild.currentMember === false);
  const unknownGuilds = guilds.filter((guild) => guild.currentMember !== true && guild.currentMember !== false);
  return {
    firstObservedAt: stored.firstObservedAt || null,
    lastObservedAt: stored.lastObservedAt || null,
    eventCount: Number(stored.eventCount || 0),
    knownGuildCount: guilds.length,
    currentGuildCount: currentGuilds.length,
    formerGuildCount: formerGuilds.length,
    unknownGuildCount: unknownGuilds.length,
    liveVisibleGuildCount: guilds.filter((guild) => guild.liveVisible).length,
    joinCount: (stored.joinHistory || []).length,
    leaveCount: (stored.leaveHistory || []).length,
    moderationCount: (stored.moderationHistory || []).length,
    roleChangeCount: (stored.roleHistory || []).length,
    voiceEventCount: (stored.voiceHistory || []).length,
    actorEventCount: Number(stored.relations?.actor || 0),
    subjectEventCount: Number(stored.relations?.subject || 0),
  };
}

function topCountEntries(map, limit = 8) {
  return Object.entries(map || {})
    .map(([key, value]) => ({ key, count: Number(value || 0) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function buildIdentitySummary(stored, liveUser, liveGuilds) {
  const usernames = [...new Set((stored.names || []).filter(Boolean))];
  const globalNames = [...new Set((stored.globalNames || []).filter(Boolean))];
  const displayNames = [...new Set((stored.displayNames || []).filter(Boolean))];
  const nicknames = [...(stored.nicknames || [])]
    .filter((entry) => entry?.nickname)
    .sort((a, b) => String(a?.observedAt || '').localeCompare(String(b?.observedAt || '')));
  const liveNicknames = liveGuilds
    .filter((entry) => entry?.member?.nickname)
    .map((entry) => ({ guildId: entry.guildId, guildName: entry.guildName, nickname: entry.member.nickname, observedAt: null, live: true }));
  const environments = Object.keys(stored.environments || {});
  return {
    current: {
      username: liveUser?.username || usernames.at?.(-1) || null,
      globalName: liveUser?.globalName || globalNames.at?.(-1) || null,
      displayName: liveUser?.displayName || displayNames.at?.(-1) || null,
    },
    historical: { usernames, globalNames, displayNames, nicknames },
    liveNicknames,
    counts: { usernames: usernames.length, globalNames: globalNames.length, displayNames: displayNames.length, nicknames: nicknames.length, liveNicknames: liveNicknames.length },
    environments,
    firstObservedAt: stored.firstObservedAt || null,
    lastObservedAt: stored.lastObservedAt || null,
    accountCreatedAt: liveUser?.accountCreatedAt || stored.accountCreatedAt || null,
  };
}

function buildAccountMembershipSummary(stored, liveUser, liveGuilds, reconciledGuilds) {
  const current = (reconciledGuilds || []).filter((guild) => guild.currentMember === true);
  const former = (reconciledGuilds || []).filter((guild) => guild.currentMember === false);
  const unknown = (reconciledGuilds || []).filter((guild) => guild.currentMember !== true && guild.currentMember !== false);
  const memberships = (liveGuilds || []).map((entry) => ({
    guildId: entry.guildId,
    guildName: entry.guildName,
    joinedAt: entry.member?.joinedAt || null,
    pending: Boolean(entry.member?.pending),
    timedOutUntil: entry.member?.timedOutUntil || null,
    roleCount: Array.isArray(entry.member?.roles) ? entry.member.roles.length : 0,
    highestRole: entry.member?.highestRole || null,
    permissions: entry.member?.permissions || null,
  }));
  const joined = memberships.map((entry) => entry.joinedAt).filter(Boolean).sort();
  const pendingGuilds = memberships.filter((entry) => entry.pending);
  const timedOutGuilds = memberships.filter((entry) => entry.timedOutUntil && new Date(entry.timedOutUntil).getTime() > Date.now());
  return {
    account: {
      knownToDiscord: Boolean(liveUser),
      bot: liveUser?.bot ?? stored.bot ?? null,
      accountCreatedAt: liveUser?.accountCreatedAt || stored.accountCreatedAt || null,
    },
    membership: {
      knownGuilds: (reconciledGuilds || []).length,
      currentGuilds: current.length,
      formerGuilds: former.length,
      unknownGuilds: unknown.length,
      liveVisibleGuilds: memberships.length,
      pendingGuilds: pendingGuilds.length,
      timedOutGuilds: timedOutGuilds.length,
      earliestLiveJoinAt: joined[0] || null,
      latestLiveJoinAt: joined.at?.(-1) || null,
    },
    currentMemberships: memberships,
    pendingMemberships: pendingGuilds,
    timedOutMemberships: timedOutGuilds,
    formerMemberships: former,
    unknownMemberships: unknown,
  };
}

function buildModerationSummary(stored) {
  const events = [...(stored.moderationHistory || [])].filter(Boolean).sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')));
  const byType = {}; const byGuild = {}; const byActor = {};
  let reasoned = 0; let unresolvedActor = 0;
  for (const event of events) {
    const type = String(event.type || 'moderation');
    byType[type] = Number(byType[type] || 0) + 1;
    const guildKey = String(event.guildName || event.guildId || 'Unknown guild');
    byGuild[guildKey] = Number(byGuild[guildKey] || 0) + 1;
    if (event.reason) reasoned += 1;
    if (event.actorId) byActor[String(event.actorId)] = Number(byActor[String(event.actorId)] || 0) + 1;
    else unresolvedActor += 1;
  }
  const environments = [...new Set(events.map((event) => event.environment || event.mode).filter(Boolean))];
  return {
    total: events.length, first: events[0] || null, latest: events.at?.(-1) || null, reasoned,
    withoutReason: Math.max(0, events.length - reasoned), attributedActorCount: Object.keys(byActor).length,
    unresolvedActor, environments, topTypes: topCountEntries(byType, 8), topGuilds: topCountEntries(byGuild, 8),
    topActors: topCountEntries(byActor, 8), recent: events.slice(-12).reverse(),
  };
}

function buildRoleSummary(stored, liveGuilds) {
  const events = [...(stored.roleHistory || [])].filter(Boolean).sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')));
  const byType = {}; const byGuild = {}; const byActor = {};
  let additions = 0; let removals = 0; let replacements = 0; let unresolvedActor = 0;
  for (const event of events) {
    const type = String(event.type || 'member.roles');
    byType[type] = Number(byType[type] || 0) + 1;
    const guildKey = String(event.guildName || event.guildId || 'Unknown guild');
    byGuild[guildKey] = Number(byGuild[guildKey] || 0) + 1;
    if (type === 'member.role.add') additions += 1;
    else if (type === 'member.role.remove') removals += 1;
    else replacements += 1;
    if (event.actorId) byActor[String(event.actorId)] = Number(byActor[String(event.actorId)] || 0) + 1;
    else unresolvedActor += 1;
  }
  const currentGuilds = liveGuilds.map((entry) => ({ guildId: entry.guildId, guildName: entry.guildName, roles: entry.member?.roles || [], highestRole: entry.member?.highestRole || null, permissions: entry.member?.permissions || null }));
  const uniqueCurrentRoles = new Map();
  for (const guild of currentGuilds) {
    for (const role of guild.roles || []) {
      const key = String(role.id || `${guild.guildId}:${role.name || 'role'}`);
      if (!uniqueCurrentRoles.has(key)) uniqueCurrentRoles.set(key, { ...role, guildId: guild.guildId, guildName: guild.guildName });
    }
  }
  return {
    total: events.length, additions, removals, replacements, first: events[0] || null, latest: events.at?.(-1) || null,
    attributedActorCount: Object.keys(byActor).length, unresolvedActor, topTypes: topCountEntries(byType, 8),
    topGuilds: topCountEntries(byGuild, 8), topActors: topCountEntries(byActor, 8), currentGuildCount: currentGuilds.length,
    currentRoleCount: [...uniqueCurrentRoles.values()].length, currentGuilds,
    currentRoles: [...uniqueCurrentRoles.values()].sort((a, b) => Number(b.position || 0) - Number(a.position || 0)).slice(0, 25),
    recent: events.slice(-12).reverse(),
  };
}

function buildVoiceSummary(stored, liveGuilds) {
  const events = [...(stored.voiceHistory || [])].filter(Boolean).sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')));
  const byType = {}; const byGuild = {}; const byChannel = {};
  let joins = 0; let leaves = 0; let moves = 0; let stateChanges = 0;
  for (const event of events) {
    const type = String(event.type || 'voice.update');
    byType[type] = Number(byType[type] || 0) + 1;
    const guildKey = String(event.guildName || event.guildId || 'Unknown guild');
    byGuild[guildKey] = Number(byGuild[guildKey] || 0) + 1;
    const beforeChannel = event.before?.channelId || null; const afterChannel = event.after?.channelId || null;
    if (!beforeChannel && afterChannel) joins += 1;
    else if (beforeChannel && !afterChannel) leaves += 1;
    else if (beforeChannel && afterChannel && String(beforeChannel) !== String(afterChannel)) moves += 1;
    else stateChanges += 1;
    if (beforeChannel) byChannel[String(beforeChannel)] = Number(byChannel[String(beforeChannel)] || 0) + 1;
    if (afterChannel) byChannel[String(afterChannel)] = Number(byChannel[String(afterChannel)] || 0) + 1;
  }
  const currentGuilds = liveGuilds.map((entry) => ({ guildId: entry.guildId, guildName: entry.guildName, voice: entry.member?.voice || null }));
  const connected = currentGuilds.filter((entry) => entry.voice?.channelId);
  const streaming = currentGuilds.filter((entry) => entry.voice?.streaming);
  const video = currentGuilds.filter((entry) => entry.voice?.selfVideo);
  const serverMuted = currentGuilds.filter((entry) => entry.voice?.serverMute);
  const serverDeafened = currentGuilds.filter((entry) => entry.voice?.serverDeaf);
  const selfMuted = currentGuilds.filter((entry) => entry.voice?.selfMute);
  const selfDeafened = currentGuilds.filter((entry) => entry.voice?.selfDeaf);
  return {
    total: events.length, joins, leaves, moves, stateChanges, first: events[0] || null, latest: events.at?.(-1) || null,
    topTypes: topCountEntries(byType, 8), topGuilds: topCountEntries(byGuild, 8), topChannels: topCountEntries(byChannel, 10),
    current: { visibleGuilds: currentGuilds.length, connectedGuilds: connected.length, streamingGuilds: streaming.length, videoGuilds: video.length, serverMutedGuilds: serverMuted.length, serverDeafenedGuilds: serverDeafened.length, selfMutedGuilds: selfMuted.length, selfDeafenedGuilds: selfDeafened.length, guilds: currentGuilds },
    recent: events.slice(-15).reverse(),
  };
}

function buildDeepSummary(stored, liveGuilds) {
  const guilds = reconcileGuildPresence(stored, liveGuilds);
  const currentStored = guilds.filter((guild) => guild.currentMember === true);
  const formerStored = guilds.filter((guild) => guild.currentMember === false);
  const unknownStored = guilds.filter((guild) => guild.currentMember !== true && guild.currentMember !== false);
  const environments = Object.entries(stored.environments || {}).map(([mode, details]) => ({ mode, firstObservedAt: details?.firstObservedAt || null, lastObservedAt: details?.lastObservedAt || null, eventCount: Number(details?.eventCount || 0) }));
  const recentActivity = [...(stored.recentEvents || [])].sort((a, b) => String(b?.timestamp || '').localeCompare(String(a?.timestamp || ''))).slice(0, 12);
  const moderation = stored.moderationHistory || []; const actions = stored.actorHistory || [];
  return {
    environments,
    guildPresence: {
      known: guilds.length,
      liveVisible: guilds.filter((guild) => guild.liveVisible).length,
      currentStored: currentStored.length,
      formerStored: formerStored.length,
      unknownStored: unknownStored.length,
      currentGuilds: currentStored.slice(-10),
      formerGuilds: formerStored.slice(-10),
      unknownGuilds: unknownStored.slice(-10),
    },
    relations: { subjectEvents: Number(stored.relations?.subject || 0), actorActions: Number(stored.relations?.actor || 0) },
    activity: {
      totalEvents: Number(stored.eventCount || 0), joins: (stored.joinHistory || []).length, leaves: (stored.leaveHistory || []).length,
      moderation: moderation.length, roleChanges: (stored.roleHistory || []).length, voiceEvents: (stored.voiceHistory || []).length,
      actionsPerformed: actions.length, topEventTypes: topCountEntries(stored.eventTypes, 8), topCategories: topCountEntries(stored.categories, 8),
    },
    latest: { moderation: moderation.at?.(-1) || null, action: actions.at?.(-1) || null, event: recentActivity[0] || null },
    recentActivity,
  };
}

function buildEvidenceSummary(stored, liveGuilds, reconciledGuilds) {
  const moderation = [...(stored.moderationHistory || [])].filter(Boolean).sort((a, b) => String(a?.timestamp || '').localeCompare(String(b?.timestamp || '')));
  const currentTimeouts = (liveGuilds || []).filter((entry) => entry.member?.timedOutUntil && new Date(entry.member.timedOutUntil).getTime() > Date.now());
  const pendingScreening = (liveGuilds || []).filter((entry) => entry.member?.pending);
  const identityValues = new Set([...(stored.names || []), ...(stored.globalNames || []), ...(stored.displayNames || [])].filter(Boolean));
  return {
    note: 'Factual evidence summary only. Goliath does not calculate a behavioural or risk score.',
    moderationEvents: moderation.length,
    latestModerationAt: moderation.at?.(-1)?.timestamp || null,
    moderationWithoutAttributedActor: moderation.filter((event) => !event.actorId).length,
    activeTimeouts: currentTimeouts.map((entry) => ({ guildId: entry.guildId, guildName: entry.guildName, timedOutUntil: entry.member?.timedOutUntil || null })),
    pendingScreening: pendingScreening.map((entry) => ({ guildId: entry.guildId, guildName: entry.guildName })),
    observedJoins: (stored.joinHistory || []).length,
    observedLeaves: (stored.leaveHistory || []).length,
    knownGuilds: (reconciledGuilds || []).length,
    currentGuilds: (reconciledGuilds || []).filter((guild) => guild.currentMember === true).length,
    formerGuilds: (reconciledGuilds || []).filter((guild) => guild.currentMember === false).length,
    observedIdentityValues: identityValues.size,
  };
}

async function buildReport(client, userId) {
  const id = String(userId);
  const stored = auditStore.getUserAcrossModes?.(id) || auditStore.getUser(id) || {
    userId: id, eventCount: 0, guilds: {}, eventTypes: {}, categories: {}, relations: { subject: 0, actor: 0 },
    joinHistory: [], leaveHistory: [], roleHistory: [], moderationHistory: [], voiceHistory: [], actorHistory: [], recentEvents: [],
  };
  const liveGuilds = [];
  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (!member) continue;
    liveGuilds.push({ guildId: guild.id, guildName: guild.name, member: snapshotMember(member) });
  }

  let liveUser = null;
  for (const item of liveGuilds) {
    const member = client.guilds.cache.get(item.guildId)?.members.cache.get(id) || null;
    if (member?.user) { liveUser = snapshotUser(member.user); break; }
  }
  if (!liveUser && client?.users?.fetch) {
    const fetched = await client.users.fetch(id).catch(() => null);
    if (fetched) liveUser = snapshotUser(fetched);
  }

  const reconciledGuilds = reconcileGuildPresence(stored, liveGuilds);
  const reconciledGuildMap = Object.fromEntries(reconciledGuilds.map((guild) => [guild.guildId, guild]));
  const currentGuilds = reconciledGuilds.filter((guild) => guild.currentMember === true);
  const formerGuilds = reconciledGuilds.filter((guild) => guild.currentMember === false);
  const unknownGuilds = reconciledGuilds.filter((guild) => guild.currentMember !== true && guild.currentMember !== false);
  return {
    userId: id,
    profile: liveUser || {
      id,
      username: stored.names?.at?.(-1) || null,
      globalName: stored.globalNames?.at?.(-1) || null,
      displayName: stored.displayNames?.at?.(-1) || null,
      bot: stored.bot ?? null,
      accountCreatedAt: stored.accountCreatedAt || null,
    },
    summary: summariseStored(stored, liveGuilds),
    identity: buildIdentitySummary(stored, liveUser, liveGuilds),
    accountMembership: buildAccountMembershipSummary(stored, liveUser, liveGuilds, reconciledGuilds),
    evidenceSummary: buildEvidenceSummary(stored, liveGuilds, reconciledGuilds),
    moderation: buildModerationSummary(stored),
    roles: buildRoleSummary(stored, liveGuilds),
    voice: buildVoiceSummary(stored, liveGuilds),
    deep: buildDeepSummary(stored, liveGuilds),
    guildPresence: {
      all: reconciledGuilds,
      current: currentGuilds,
      former: formerGuilds,
      unknown: unknownGuilds,
    },
    currentState: {
      knownToDiscord: Boolean(liveUser),
      guilds: liveGuilds,
      reconciledGuilds,
      formerGuilds,
      unknownGuilds,
    },
    history: {
      names: stored.names || [], globalNames: stored.globalNames || [], displayNames: stored.displayNames || [], nicknames: stored.nicknames || [],
      joins: stored.joinHistory || [], leaves: stored.leaveHistory || [], roles: stored.roleHistory || [], moderation: stored.moderationHistory || [],
      voice: stored.voiceHistory || [], actions: stored.actorHistory || [], recentEvents: stored.recentEvents || [],
    },
    counts: { byEventType: stored.eventTypes || {}, byCategory: stored.categories || {}, byRelation: stored.relations || { subject: 0, actor: 0 } },
    environments: stored.environments || {},
    stored: { ...stored, guilds: reconciledGuildMap },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { snapshotMember, snapshotUser, buildReport };
