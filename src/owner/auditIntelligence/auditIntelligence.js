'use strict';

const crypto = require('crypto');
const { AuditLogEvent, Events } = require('discord.js');
const auditStore = require('./auditStore');
const auditRouter = require('./auditRouter');
const { snapshotMember, snapshotUser } = require('./userIntelligence');

const outputCaptureWired = new WeakSet();
const recentOperations = new Map();
const OPERATION_WINDOW_MS = 15000;
const OPERATION_MAX_PER_GUILD = 50;

const AUDIT_ACTIONS = {
  'role.create': AuditLogEvent.RoleCreate,
  'role.update': AuditLogEvent.RoleUpdate,
  'role.delete': AuditLogEvent.RoleDelete,
  'channel.create': AuditLogEvent.ChannelCreate,
  'channel.update': AuditLogEvent.ChannelUpdate,
  'channel.delete': AuditLogEvent.ChannelDelete,
  'member.kick': AuditLogEvent.MemberKick,
  'member.ban': AuditLogEvent.MemberBanAdd,
  'member.unban': AuditLogEvent.MemberBanRemove,
  'member.prune': AuditLogEvent.MemberPrune,
  'member.update': AuditLogEvent.MemberUpdate,
  'member.nickname': AuditLogEvent.MemberUpdate,
  'member.timeout': AuditLogEvent.MemberUpdate,
  'member.roles': AuditLogEvent.MemberRoleUpdate,
  'invite.create': AuditLogEvent.InviteCreate,
  'invite.delete': AuditLogEvent.InviteDelete,
  'message.delete': AuditLogEvent.MessageDelete,
  'message.bulkDelete': AuditLogEvent.MessageBulkDelete,
  'thread.create': AuditLogEvent.ThreadCreate,
  'thread.update': AuditLogEvent.ThreadUpdate,
  'thread.delete': AuditLogEvent.ThreadDelete,
  'emoji.create': AuditLogEvent.EmojiCreate,
  'emoji.update': AuditLogEvent.EmojiUpdate,
  'emoji.delete': AuditLogEvent.EmojiDelete,
  'sticker.create': AuditLogEvent.StickerCreate,
  'sticker.update': AuditLogEvent.StickerUpdate,
  'sticker.delete': AuditLogEvent.StickerDelete,
  'scheduledEvent.create': AuditLogEvent.GuildScheduledEventCreate,
  'scheduledEvent.update': AuditLogEvent.GuildScheduledEventUpdate,
  'scheduledEvent.delete': AuditLogEvent.GuildScheduledEventDelete,
  'automod.ruleCreate': AuditLogEvent.AutoModerationRuleCreate,
  'automod.ruleUpdate': AuditLogEvent.AutoModerationRuleUpdate,
  'automod.ruleDelete': AuditLogEvent.AutoModerationRuleDelete,
  'guild.update': AuditLogEvent.GuildUpdate,
};

const SYSTEM_RULES = [
  ['Social Studio', ['admin:social', 'social:', '/social']],
  ['Verification', ['admin:verification', 'verification:', '/verification']],
  ['Tickets', ['admin:tickets', 'tickets:', 'ticket_', 'goliath_ticket_', '/ticket']],
  ['Auto Roles', ['admin:autoroles', 'autoroles:', 'autoRoles:', '/autoroles']],
  ['Timed Roles', ['admin:timedroles', 'timedroles:', 'timedRoles:']],
  ['Reaction Roles', ['admin:reactionroles', 'reactionroles:', 'reactionRoles:']],
  ['Role Studio', ['admin:studio:rolestudio', 'admin:role', 'roleStudio:']],
  ['Schedule', ['admin:schedule', 'schedule:', '/schedule']],
  ['Stats', ['admin:stats', 'stats:', '/stats']],
  ['Translation', ['admin:translation', 'translation:', '/translation', '/translate']],
  ['Temp Voice', ['admin:tempvoice', 'tempvoice:', 'tempVoice:']],
  ['Invites', ['admin:invites', 'invites:']],
  ['Giveaways', ['admin:giveaways', 'giveaways:']],
  ['Polls', ['admin:polls', 'poll_vote:', 'polls:']],
  ['Leveling', ['admin:leveling', 'leveling:']],
  ['Forms', ['admin:forms', 'forms:', '/forms']],
  ['Suggestions', ['admin:suggestions', 'suggestions:']],
  ['Welcome', ['admin:welcome', 'welcome:']],
  ['Goodbye', ['admin:goodbye', 'goodbye:']],
  ['Embed Studio', ['admin:embed', 'embed:', '/embed']],
  ['Starboard', ['admin:starboard', 'starboard:']],
  ['Sticky', ['admin:sticky', 'sticky:']],
  ['Security Studio', ['admin:studio:securitystudio', 'admin:automod', 'automod:', '/testsecurity', '/lockdown']],
  ['User Panel', ['user:', '/user']],
  ['Mod Panel', ['mod_', 'mod:', '/mod']],
  ['Admin Panel', ['admin:', '/admin']],
  ['Moderation', ['/purge', '/lockdown']],
  ['Media', ['/media', 'media:']],
  ['Server', ['/server', '/serverinfo']],
  ['Help', ['/help']],
  ['Prefix', ['/prefix']],
];

function id() { return `AUD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function operationId() { return `OP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function plain(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function actor(user) { return user ? { id: user.id, username: user.username || null, globalName: user.globalName || null, bot: Boolean(user.bot), accountCreatedAt: user.createdAt?.toISOString?.() || null } : null; }

function actorMemberSnapshot(guild, member, user) {
  const base = actor(user || member?.user);
  if (!base) return null;
  if (!member) return { ...base, guildOwner: String(guild?.ownerId || '') === String(base.id), memberAvailable: false };
  const roles = member.roles?.cache
    ? member.roles.cache.filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position).map((role) => ({ id: role.id, name: role.name, position: role.position, managed: Boolean(role.managed) }))
    : [];
  const permissions = member.permissions?.toArray?.() || [];
  return {
    ...base,
    memberAvailable: true,
    guildOwner: String(guild?.ownerId || '') === String(base.id),
    displayName: member.displayName || null,
    nickname: member.nickname || null,
    joinedAt: member.joinedAt?.toISOString?.() || null,
    highestRole: member.roles?.highest ? { id: member.roles.highest.id, name: member.roles.highest.name, position: member.roles.highest.position } : null,
    roles,
    permissions,
    administrator: permissions.includes('Administrator'),
    manageable: member.manageable ?? null,
    moderatable: member.moderatable ?? null,
    bannable: member.bannable ?? null,
  };
}

async function buildActorSnapshot(guild, user) {
  if (!user) return null;
  let member = guild?.members?.cache?.get?.(user.id) || null;
  if (!member && guild?.members?.fetch) member = await guild.members.fetch(user.id).catch(() => null);
  return actorMemberSnapshot(guild, member, user);
}

function identifyGoliathSystem(event) {
  const metadata = event?.metadata || {};
  const candidates = [metadata.customId, metadata.commandName ? `/${metadata.commandName}` : null, event?.target?.label]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  for (const [system, prefixes] of SYSTEM_RULES) {
    if (candidates.some((candidate) => prefixes.some((prefix) => candidate === prefix.toLowerCase() || candidate.startsWith(prefix.toLowerCase())))) {
      return system;
    }
  }
  return 'Goliath Core';
}

function operationReferences(metadata = {}) {
  const refs = new Set();
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === 'object') return Object.values(value).forEach(visit);
    const text = String(value);
    if (/^\d{15,22}$/.test(text)) refs.add(text);
  };
  visit(metadata.options);
  visit(metadata.values);
  return [...refs];
}

function pruneOperations(guildId, now = Date.now()) {
  const key = String(guildId || '');
  if (!key) return [];
  const active = (recentOperations.get(key) || [])
    .filter((item) => now - item.createdAt <= OPERATION_WINDOW_MS)
    .slice(-OPERATION_MAX_PER_GUILD);
  if (active.length) recentOperations.set(key, active);
  else recentOperations.delete(key);
  return active;
}

function operationSummarySuffix(op, role) {
  if (!op?.operationId) return '';
  const roleLabel = role === 'trigger' ? 'trigger' : role === 'output' ? 'output' : 'confirmed result';
  return `\n\n🤖 **Goliath Operation:** \`${op.operationId}\` • **${op.system || 'Goliath Core'}** • ${roleLabel}`;
}

function registerOperation(event) {
  if (!event?.guildId || !String(event.type || '').startsWith('goliath.interaction.')) return null;
  const system = identifyGoliathSystem(event);
  const op = {
    operationId: operationId(),
    createdAt: new Date(event.timestamp).getTime() || Date.now(),
    guildId: String(event.guildId),
    channelId: event.channel?.id ? String(event.channel.id) : null,
    actorId: event.actor?.id || event.user?.id || null,
    triggerEventId: event.eventId,
    triggerType: event.type,
    triggerLabel: event.target?.label || null,
    system,
    references: operationReferences(event.metadata),
  };
  const active = pruneOperations(op.guildId, op.createdAt);
  active.push(op);
  recentOperations.set(op.guildId, active.slice(-OPERATION_MAX_PER_GUILD));
  event.metadata = {
    ...(event.metadata || {}),
    goliathSystem: system,
    operation: {
      operationId: op.operationId,
      role: 'trigger',
      confidence: 'direct',
      evidence: 'Goliath interaction created the operation',
      system,
    },
  };
  event.summary = `${event.summary || 'Goliath interaction started.'}${operationSummarySuffix(op, 'trigger')}`;
  return op;
}

function findOperationForOutput(event) {
  if (!event?.guildId) return null;
  const now = new Date(event.timestamp).getTime() || Date.now();
  const channelId = event.channel?.id ? String(event.channel.id) : null;
  const candidates = pruneOperations(event.guildId, now)
    .filter((item) => now >= item.createdAt && now - item.createdAt <= 10000)
    .filter((item) => !channelId || !item.channelId || item.channelId === channelId)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!candidates.length) return null;
  const exactChannel = candidates.find((item) => channelId && item.channelId === channelId);
  const op = exactChannel || (candidates.length === 1 ? candidates[0] : null);
  if (!op) return null;
  return {
    op,
    confidence: exactChannel ? 'high' : 'medium',
    evidence: exactChannel ? 'Same guild/channel within 10 seconds' : 'Single recent operation in guild',
  };
}

function findOperationForConfirmedOutcome(event) {
  if (!event?.guildId) return null;
  const now = new Date(event.timestamp).getTime() || Date.now();
  const targetId = event.target?.id || event.user?.id || null;
  const candidates = pruneOperations(event.guildId, now)
    .filter((item) => now >= item.createdAt && now - item.createdAt <= 8000)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!candidates.length) return null;

  if (targetId) {
    const targetMatches = candidates.filter((item) => item.references.includes(String(targetId)));
    if (targetMatches.length === 1) {
      return { op: targetMatches[0], confidence: 'high', evidence: 'Interaction target matches confirmed Discord outcome target' };
    }
  }

  if (candidates.length === 1) {
    return { op: candidates[0], confidence: 'medium', evidence: 'Single Goliath operation within 8 seconds of confirmed outcome' };
  }
  return null;
}

function attachOperation(event, match, role) {
  if (!event || !match?.op) return false;
  event.metadata = {
    ...(event.metadata || {}),
    goliathSystem: match.op.system || event.metadata?.goliathSystem || 'Goliath Core',
    operation: {
      operationId: match.op.operationId,
      role,
      confidence: match.confidence,
      evidence: match.evidence,
      triggerEventId: match.op.triggerEventId,
      triggerType: match.op.triggerType,
      triggerLabel: match.op.triggerLabel,
      triggeredBy: match.op.actorId,
      system: match.op.system || 'Goliath Core',
    },
  };
  event.summary = `${event.summary || event.title || 'Goliath operation event.'}${operationSummarySuffix(match.op, role)}`;
  return true;
}

function outputMessageState(message) {
  if (!message) return null;
  return {
    id: message.id || null,
    channelId: message.channelId || null,
    content: message.content || null,
    createdAt: message.createdAt?.toISOString?.() || null,
    editedAt: message.editedAt?.toISOString?.() || null,
    pinned: Boolean(message.pinned),
    webhookId: message.webhookId || null,
    interaction: message.interactionMetadata ? plain(message.interactionMetadata) : null,
    embeds: (message.embeds || []).slice(0, 10).map((embed) => {
      try { return typeof embed?.toJSON === 'function' ? embed.toJSON() : plain(embed); }
      catch { return null; }
    }).filter(Boolean),
    attachments: [...(message.attachments?.values?.() || [])].slice(0, 25).map((item) => ({
      id: item.id || null,
      name: item.name || null,
      contentType: item.contentType || null,
      description: item.description || null,
      size: item.size ?? null,
      url: item.url || null,
    })),
    components: (message.components || []).slice(0, 5).map((row) => {
      try { return typeof row?.toJSON === 'function' ? row.toJSON() : plain(row); }
      catch { return null; }
    }).filter(Boolean),
    reference: message.reference ? plain(message.reference) : null,
  };
}

function ensureGoliathOutputCapture(client) {
  if (!client || outputCaptureWired.has(client)) return false;
  outputCaptureWired.add(client);

  client.on(Events.MessageCreate, (message) => {
    try {
      if (!message?.guild || !client.user?.id) return;
      if (String(message.guild.id) === String(auditRouter.getOwnerAuditGuildId() || '')) return;
      if (String(message.author?.id || '') !== String(client.user.id)) return;

      const payload = outputMessageState(message);
      captureGoliathAction(client, {
        type: 'goliath.output.message',
        category: 'goliath',
        action: 'send',
        title: 'Goliath Output Sent',
        icon: '📤',
        guild: message.guild,
        channel: message.channel || null,
        actor: actorMemberSnapshot(message.guild, message.member, client.user),
        target: { id: message.id, label: `Message ${message.id}` },
        summary: `Goliath sent a message in <#${message.channelId}>.`,
        result: 'Success',
        after: payload,
        metadata: {
          outputType: 'message',
          embedCount: payload?.embeds?.length || 0,
          attachmentCount: payload?.attachments?.length || 0,
          componentRowCount: payload?.components?.length || 0,
        },
      }).catch((error) => console.warn('[Audit Intelligence] Goliath output capture failed:', error?.message || error));
    } catch (error) {
      console.warn('[Audit Intelligence] Goliath output listener failed:', error?.message || error);
    }
  });

  return true;
}

async function correlate(guild, type, targetId, observedAt = Date.now(), options = {}) {
  const action = AUDIT_ACTIONS[type];
  if (!guild || action === undefined) return null;
  const maxAgeMs = Number(options.maxAgeMs || 15000);
  const limit = Math.min(20, Math.max(1, Number(options.limit || 8)));
  const allowTargetless = options.allowTargetless === true;
  try {
    const logs = await guild.fetchAuditLogs({ type: action, limit });
    const match = logs.entries.find((entry) => {
      const age = Math.abs(observedAt - entry.createdTimestamp);
      const auditTargetId = entry.target?.id ? String(entry.target.id) : null;
      const targetMatches = !targetId || auditTargetId === String(targetId) || (allowTargetless && !auditTargetId);
      return age <= maxAgeMs && targetMatches;
    });
    if (!match) return null;
    return {
      actor: await buildActorSnapshot(guild, match.executor),
      reason: match.reason || null,
      auditLogId: match.id,
      auditCreatedAt: match.createdAt?.toISOString?.() || null,
      extra: plain(match.extra || null),
      changes: plain(match.changes || []),
    };
  } catch {
    return null;
  }
}

function normalize(input = {}) {
  const guild = input.guild || input.member?.guild || input.channel?.guild || null;
  const user = input.user || input.member?.user || null;
  const now = new Date();
  return {
    eventId: input.eventId || id(),
    timestamp: input.timestamp || now.toISOString(),
    type: input.type || 'unknown',
    category: input.category || 'system',
    action: input.action || 'observe',
    title: input.title || input.type || 'Audit Event',
    icon: input.icon || '🧾',
    summary: input.summary || null,
    source: input.source || 'Discord Gateway',
    result: input.result || 'Observed',
    guildId: guild?.id || input.guildId || null,
    guildName: guild?.name || input.guildName || null,
    channel: input.channel ? { id: input.channel.id || null, name: input.channel.name || null, type: input.channel.type ?? null } : null,
    target: plain(input.target || null),
    user: input.member ? snapshotMember(input.member) : snapshotUser(user),
    actor: plain(input.actor || null),
    reason: input.reason || null,
    before: plain(input.before),
    after: plain(input.after),
    metadata: plain(input.metadata || {}),
  };
}

function mention(id, fallback = 'Unknown user') {
  return id ? `<@${id}>` : fallback;
}

function targetLabel(event) {
  return event.user?.id
    ? mention(event.user.id)
    : event.target?.id && /^\d{15,22}$/.test(String(event.target.id))
      ? mention(event.target.id)
      : event.target?.label || event.target?.name || event.target?.id || 'Unknown target';
}

function roleChangeSummary(event) {
  const added = Array.isArray(event.metadata?.added) ? event.metadata.added : [];
  const removed = Array.isArray(event.metadata?.removed) ? event.metadata.removed : [];
  const parts = [];
  if (added.length) parts.push(`added ${added.map((role) => `**${role.name || role.id}**`).join(', ')}`);
  if (removed.length) parts.push(`removed ${removed.map((role) => `**${role.name || role.id}**`).join(', ')}`);
  return parts.join(' and ');
}

function shortText(value, max = 180) {
  if (value === null || value === undefined || value === '') return 'No text content';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function locationLabel(event) {
  return event.channel?.id ? `<#${event.channel.id}>` : 'an unknown channel';
}

function changedFieldLabels(before = {}, after = {}, labels = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .map((key) => labels[key] || key)
    .slice(0, 8);
}

function automodActionLabel(action) {
  if (action === null || action === undefined) return 'an AutoMod action';
  if (typeof action === 'object') {
    const type = action.type ?? action.actionType ?? action.kind ?? null;
    return type !== null ? `AutoMod action type **${type}**` : 'an AutoMod action';
  }
  return `AutoMod action **${String(action)}**`;
}

function buildOperationalSummary(event) {
  if (!event || event.summary) return event?.summary || null;
  const actorLabel = event.actor?.id ? mention(event.actor.id) : null;
  const target = targetLabel(event);
  const reason = event.reason ? ` Reason: **${String(event.reason).slice(0, 300)}**.` : '';
  const byActor = actorLabel ? ` by ${actorLabel}` : '';

  switch (event.type) {
    case 'member.join': return `${target} joined **${event.guildName || 'the server'}**.`;
    case 'member.leave': return `${target} left **${event.guildName || 'the server'}**.`;
    case 'member.kick': return `${target} was kicked${byActor}.${reason}`;
    case 'member.ban': return `${target} was banned${byActor}.${reason}`;
    case 'member.unban': return `${target} was unbanned${byActor}.${reason}`;
    case 'member.prune': return `${target} was removed by a member prune${byActor}.${reason}`;
    case 'member.timeout': {
      const before = event.before?.timedOutUntil || null;
      const after = event.after?.timedOutUntil || null;
      if (!before && after) return `${target} was timed out${byActor} until <t:${Math.floor(new Date(after).getTime() / 1000)}:F>.${reason}`;
      if (before && !after) return `${target}'s timeout was removed${byActor}.${reason}`;
      return `${target}'s timeout was changed${byActor}.${reason}`;
    }
    case 'member.nickname': {
      const before = event.before?.nickname || event.before?.displayName || 'None';
      const after = event.after?.nickname || event.after?.displayName || 'None';
      return `${target}'s nickname changed${byActor}: **${before}** → **${after}**.${reason}`;
    }
    case 'member.roles': {
      const changes = roleChangeSummary(event);
      return changes ? `${target} had roles ${changes}${byActor}.${reason}` : `${target}'s roles changed${byActor}.${reason}`;
    }
    case 'member.verification': return `${target}'s membership screening state changed.`;
    case 'role.create': return `Role **${event.target?.label || event.target?.name || event.target?.id || 'Unknown'}** was created${byActor}.${reason}`;
    case 'role.update': return `Role **${event.target?.label || event.target?.name || event.target?.id || 'Unknown'}** was updated${byActor}.${reason}`;
    case 'role.delete': return `Role **${event.target?.label || event.target?.name || event.target?.id || 'Unknown'}** was deleted${byActor}.${reason}`;
    case 'message.update': {
      const author = event.user?.id ? mention(event.user.id) : event.before?.authorTag || event.after?.authorTag || 'Unknown author';
      const before = shortText(event.before?.content);
      const after = shortText(event.after?.content);
      return `A message from ${author} was edited in ${locationLabel(event)}: **${before}** → **${after}**.`;
    }
    case 'message.delete': {
      const author = event.user?.id ? mention(event.user.id) : event.before?.authorTag || 'Unknown author';
      return `A message from ${author} was deleted in ${locationLabel(event)}${byActor}. Content: **${shortText(event.before?.content)}**.${reason}`;
    }
    case 'message.bulkDelete': {
      const count = Number(event.metadata?.count || (Array.isArray(event.before) ? event.before.length : 0));
      return `**${count || 'Multiple'}** messages were bulk deleted in ${locationLabel(event)}${byActor}.${reason}`;
    }
    case 'reaction.add': return `${target} added a reaction in ${locationLabel(event)}.`;
    case 'reaction.remove': return `${target} removed a reaction in ${locationLabel(event)}.`;
    case 'channel.create': return `Channel **#${event.target?.label || event.after?.name || 'unknown'}** was created${byActor}.${reason}`;
    case 'channel.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', parentId: 'category', topic: 'topic', nsfw: 'NSFW setting', rateLimitPerUser: 'slowmode', bitrate: 'bitrate', userLimit: 'user limit', permissionOverwrites: 'permissions' });
      return `Channel **#${event.after?.name || event.target?.label || 'unknown'}** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'channel.delete': return `Channel **#${event.target?.label || event.before?.name || 'unknown'}** was deleted${byActor}.${reason}`;
    case 'thread.create': return `Thread **${event.target?.label || event.after?.name || 'unknown'}** was created${byActor}.${reason}`;
    case 'thread.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', parentId: 'parent channel', archived: 'archived state', locked: 'lock state', autoArchiveDuration: 'auto-archive duration', rateLimitPerUser: 'slowmode' });
      return `Thread **${event.after?.name || event.target?.label || 'unknown'}** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'thread.delete': return `Thread **${event.target?.label || event.before?.name || 'unknown'}** was deleted${byActor}.${reason}`;
    case 'invite.create': return `Invite **${event.target?.label || event.target?.id || 'unknown'}** was created in ${locationLabel(event)}${byActor}.`;
    case 'invite.delete': return `Invite **${event.target?.label || event.target?.id || 'unknown'}** was deleted from ${locationLabel(event)}${byActor}.`;
    case 'emoji.create': return `Emoji **:${event.after?.name || event.target?.label || 'unknown'}:** was created${byActor}.${reason}`;
    case 'emoji.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', animated: 'animated state', available: 'availability', managed: 'managed state', roles: 'role restrictions' });
      return `Emoji **:${event.after?.name || event.target?.label || 'unknown'}:** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'emoji.delete': return `Emoji **:${event.target?.label || event.before?.name || 'unknown'}:** was deleted${byActor}.${reason}`;
    case 'sticker.create': return `Sticker **${event.after?.name || event.target?.label || 'unknown'}** was created${byActor}.${reason}`;
    case 'sticker.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', description: 'description', tags: 'tags', format: 'format', available: 'availability' });
      return `Sticker **${event.after?.name || event.target?.label || 'unknown'}** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'sticker.delete': return `Sticker **${event.target?.label || event.before?.name || 'unknown'}** was deleted${byActor}.${reason}`;
    case 'scheduledEvent.create': return `Scheduled event **${event.target?.label || event.after?.name || 'unknown'}** was created${byActor}.`;
    case 'scheduledEvent.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', description: 'description', channelId: 'channel', status: 'status', privacyLevel: 'privacy', entityType: 'event type', scheduledStartAt: 'start time', scheduledEndAt: 'end time', entityMetadata: 'location/details' });
      return `Scheduled event **${event.after?.name || event.target?.label || 'unknown'}** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.`;
    }
    case 'scheduledEvent.delete': return `Scheduled event **${event.target?.label || event.before?.name || 'unknown'}** was deleted${byActor}.`;
    case 'guild.update': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'server name', ownerId: 'owner', verificationLevel: 'verification level', explicitContentFilter: 'content filter', preferredLocale: 'preferred locale', afkChannelId: 'AFK channel', systemChannelId: 'system channel', rulesChannelId: 'rules channel', publicUpdatesChannelId: 'community updates channel' });
      return `Server settings for **${event.guildName || event.after?.name || 'the guild'}** were updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'voice.update': {
      const beforeChannel = event.before?.channelId || null;
      const afterChannel = event.after?.channelId || null;
      if (!beforeChannel && afterChannel) return `${target} joined voice channel <#${afterChannel}>.`;
      if (beforeChannel && !afterChannel) return `${target} left voice channel <#${beforeChannel}>.`;
      if (beforeChannel && afterChannel && beforeChannel !== afterChannel) return `${target} moved from <#${beforeChannel}> to <#${afterChannel}>.`;
      const changes = [];
      if (event.before?.serverMute !== event.after?.serverMute) changes.push(event.after?.serverMute ? 'server muted' : 'server unmuted');
      if (event.before?.serverDeaf !== event.after?.serverDeaf) changes.push(event.after?.serverDeaf ? 'server deafened' : 'server undeafened');
      return changes.length ? `${target} was **${changes.join(' and ')}**${byActor} in ${afterChannel ? `<#${afterChannel}>` : 'voice'}.${reason}` : `${target}'s voice state changed.`;
    }
    case 'automod.ruleCreate': return `AutoMod rule **${event.target?.label || event.after?.name || event.target?.id || 'unknown'}** was created${byActor}.${reason}`;
    case 'automod.ruleUpdate': {
      const changes = changedFieldLabels(event.before, event.after, { name: 'name', enabled: 'enabled state', eventType: 'event type', triggerType: 'trigger type', actions: 'actions' });
      return `AutoMod rule **${event.after?.name || event.target?.label || event.target?.id || 'unknown'}** was updated${byActor}${changes.length ? ` — changed: **${changes.join(', ')}**` : ''}.${reason}`;
    }
    case 'automod.ruleDelete': return `AutoMod rule **${event.target?.label || event.before?.name || event.target?.id || 'unknown'}** was deleted${byActor}.${reason}`;
    case 'automod.action': {
      const ruleId = event.metadata?.ruleId ? ` rule \`${event.metadata.ruleId}\`` : '';
      const matched = event.metadata?.matchedKeyword || event.metadata?.matchedContent || null;
      const content = event.metadata?.content || null;
      const matchText = matched ? ` Match: **${shortText(matched, 160)}**.` : '';
      const contentText = content ? ` Content: **${shortText(content, 220)}**.` : '';
      return `AutoMod${ruleId} applied ${automodActionLabel(event.metadata?.action)} to ${target} in ${locationLabel(event)}.${matchText}${contentText}`;
    }
    default: return null;
  }
}

function confirmGoliathOutcome(client, event, correlation) {
  if (!correlation?.auditLogId) return false;
  const botId = String(client?.user?.id || '');
  const actorId = String(correlation.actor?.id || '');
  if (!botId || actorId !== botId) return false;

  event.source = 'Goliath + Discord Audit Log';
  event.result = 'Success';
  event.category = event.category === 'system' ? 'goliath' : event.category;
  event.metadata = {
    ...(event.metadata || {}),
    goliath: {
      confirmed: true,
      botId,
      confirmation: 'Discord Audit Log',
      auditLogId: correlation.auditLogId,
    },
  };
  return true;
}

async function capture(client, input = {}) {
  ensureGoliathOutputCapture(client);
  const event = normalize(input);
  const guild = input.guild || input.member?.guild || input.channel?.guild || client?.guilds?.cache?.get?.(event.guildId) || null;
  let correlation = null;

  if (!event.actor && guild) {
    correlation = await correlate(guild, event.type, event.target?.id || event.user?.id, new Date(event.timestamp).getTime());
    if (correlation) {
      event.actor = correlation.actor;
      event.reason = event.reason || correlation.reason;
      event.metadata.auditLog = correlation;
      event.source = 'Discord Gateway + Audit Log';
    }
  } else if (event.metadata?.auditLog?.auditLogId) {
    correlation = event.metadata.auditLog;
  }

  event.summary = event.summary || buildOperationalSummary(event);
  const confirmedGoliath = confirmGoliathOutcome(client, event, correlation);

  if (String(event.type || '').startsWith('goliath.interaction.')) {
    registerOperation(event);
  } else if (event.type === 'goliath.output.message') {
    attachOperation(event, findOperationForOutput(event), 'output');
  } else if (confirmedGoliath) {
    attachOperation(event, findOperationForConfirmedOutcome(event), 'outcome');
  }

  try {
    auditStore.appendEvent(event);
  } catch (error) {
    console.warn('[Audit Intelligence] storage failed:', error?.message || error);
  }
  if (guild) await auditRouter.deliver(client, guild, event).catch((error) => console.warn('[Audit Intelligence] delivery failed:', error?.message || error));
  return event;
}

function captureGoliathAction(client, input = {}) {
  return capture(client, { ...input, source: 'Goliath', category: input.category || 'goliath', action: input.action || 'execute' });
}

module.exports = {
  capture,
  captureGoliathAction,
  correlate,
  normalize,
  confirmGoliathOutcome,
  ensureGoliathOutputCapture,
  outputMessageState,
  registerOperation,
  findOperationForOutput,
  findOperationForConfirmedOutcome,
  identifyGoliathSystem,
  buildActorSnapshot,
  actorMemberSnapshot,
  buildOperationalSummary,
};
