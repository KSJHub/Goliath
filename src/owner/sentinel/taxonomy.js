'use strict';

// Canonical Sentinel families. These map observation types onto the existing
// Goliath Control audit routes without changing guild-facing logging.
const FAMILY_RULES = Object.freeze([
  ['members', /^(member\.|invite\.used|verification\.)/],
  ['moderation', /^(moderation\.|member\.(kick|ban|unban|timeout|prune)|quarantine\.)/],
  ['security', /^(security\.|automod\.|anti-nuke\.|sentinel\.security|verification\.security)/],
  ['messages', /^(message\.|reaction\.|embed\.|sticky\.|starboard\.)/],
  ['voice', /^(voice\.|stage\.|tempvoice\.|private-room\.voice)/],
  ['roles', /^(role\.|permission\.|emoji\.|sticker\.)/],
  ['goliath', /^(goliath\.|sentinel\.|runtime\.|scheduler\.|provider\.|persistence\.|module\.|config\.|maintenance\.)/],
  ['guild', /^(guild\.|channel\.|thread\.|forum\.|invite\.|webhook\.|scheduled-event\.)/],
]);

const KINDS = Object.freeze({
  EVENT: 'event',
  ACTION: 'action',
  INCIDENT: 'incident',
  RECOVERY: 'recovery',
  HEALTH: 'health',
});

const ACTION_SURFACE = Object.freeze({
  members: ['join', 'leave', 'kick', 'ban', 'unban', 'timeout', 'untimeout', 'nickname', 'roles', 'screening', 'update'],
  messages: ['create', 'update', 'delete', 'bulk-delete', 'pin', 'unpin', 'goliath-send', 'goliath-edit', 'goliath-delete'],
  reactions: ['add', 'remove', 'clear', 'clear-emoji', 'reaction-role'],
  voice: ['join', 'leave', 'move', 'self-mute', 'self-unmute', 'self-deaf', 'self-undeaf', 'server-mute', 'server-unmute', 'server-deaf', 'server-undeaf', 'stream-start', 'stream-stop', 'camera-start', 'camera-stop', 'stage'],
  roles: ['create', 'update', 'delete', 'position', 'permissions', 'assign', 'remove'],
  channels: ['create', 'update', 'delete', 'position', 'topic', 'nsfw', 'slowmode', 'permissions', 'category'],
  threadsForums: ['create', 'update', 'delete', 'archive', 'unarchive', 'lock', 'unlock', 'member-add', 'member-remove'],
  invites: ['create', 'delete', 'used', 'attribution'],
  webhooks: ['create', 'update', 'delete', 'execute'],
  assets: ['emoji-create', 'emoji-update', 'emoji-delete', 'sticker-create', 'sticker-update', 'sticker-delete'],
  guild: ['update', 'name', 'icon', 'banner', 'verification', 'security', 'community', 'system-channel', 'afk', 'notifications'],
  moderation: ['warn', 'note', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'quarantine', 'release-quarantine'],
  security: ['detection', 'raid', 'anti-nuke', 'suspicious-activity', 'permission-escalation', 'blocked-operation', 'automatic-response', 'recovery'],
  interactions: ['slash-command', 'button', 'select-menu', 'modal', 'context-command', 'panel-action'],
  configuration: ['module-enable', 'module-disable', 'setting-change', 'channel-select', 'role-select', 'threshold-change', 'provider-change', 'migration', 'repair'],
  modules: ['autoroles', 'reactionroles', 'roleselector', 'temporaryroles', 'timedroles', 'social', 'welcome', 'goodbye', 'tickets', 'forms', 'suggestions', 'polls', 'giveaways', 'leveling', 'birthdays', 'notes', 'sticky', 'starboard', 'embed', 'translation', 'privaterooms', 'tempvoice', 'stats', 'verification'],
  background: ['scheduler-start', 'scheduler-stop', 'heartbeat', 'stale', 'success', 'failure', 'repeated-failure', 'recovery', 'overdue'],
  providers: ['request', 'success', 'failure', 'authentication', 'rate-limit', 'malformed-response', 'recovery'],
  persistence: ['read-failure', 'write-failure', 'corruption', 'migration-failure', 'save-failure', 'repair', 'recovery'],
  discordRuntime: ['ready', 'disconnect', 'reconnect', 'client-error', 'shard-error', 'gateway-error', 'rest-error', 'rate-limit'],
  process: ['startup', 'shutdown', 'restart', 'uncaught-exception', 'unhandled-rejection', 'health', 'memory', 'uptime'],
  sentinel: ['start', 'stop', 'cycle', 'coverage', 'incident-open', 'incident-reminder', 'incident-recovery', 'heartbeat', 'cross-environment'],
  audit: ['route', 'delivery', 'provision', 'repair', 'storage', 'failure', 'recovery'],
  maintenance: ['start', 'status-channel-create', 'notice', 'shutdown', 'startup', 'operational', 'downtime', 'status-channel-delete', 'failure'],
});

function familyFor(type, fallback = 'guild') {
  const value = String(type || '').toLowerCase();
  for (const [family, pattern] of FAMILY_RULES) if (pattern.test(value)) return family;
  return fallback;
}

module.exports = { KINDS, FAMILY_RULES, ACTION_SURFACE, familyFor };
