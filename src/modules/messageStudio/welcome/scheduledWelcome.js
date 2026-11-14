'use strict';

const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const emojiPayload = require('../../utilityStudio/emojis/emojiPayload');
const embedTemplateManager = require('../embed/embedTemplates');
const queue = require('./scheduledWelcomeQueue');
const messages = require('./scheduledWelcomeMessage');

const MODULE = 'welcome';
const TEMPLATE_SLOT = 'scheduled_welcome';
const now = () => new Date().toISOString();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function defaultAnalytics() {
  return {
    runs: 0,
    emptyRuns: 0,
    messagesSent: 0,
    membersWelcomed: 0,
    sendFailed: 0,
    roleRemovalFailed: 0,
    lastRunAt: null,
    lastRunDate: null,
    lastError: null,
  };
}

function defaultScheduledConfig() {
  return {
    enabled: false,
    queueRoleId: null,
    pendingMembers: {},
    channelId: null,
    time: '19:00',
    timezone: 'Europe/London',
    message: '👋 Welcome our newest members!\n\n{members}',
    templateId: null,
    pingMembers: true,
    removeQueueRole: true,
    ignoreBots: true,
    batchSize: 20,
    completedMemberIds: [],
    completedMemberJoins: {},
    analytics: defaultAnalytics(),
    createdAt: now(),
    updatedAt: now(),
  };
}

function cleanTime(value) {
  const match = String(value || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : '19:00';
}

function cleanTimezone(value) {
  const timezone = String(value || 'Europe/London').trim().slice(0, 80);
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'Europe/London';
  }
}

function normalizeScheduledConfig(value = {}) {
  const base = defaultScheduledConfig();
  const source = value && typeof value === 'object' ? value : {};
  const batchSize = Number(source.batchSize ?? base.batchSize);
  return {
    ...base,
    ...clone(source),
    enabled: source.enabled === true,
    queueRoleId: queue.cleanId(source.queueRoleId),
    pendingMembers: Object.fromEntries(Object.entries(source.pendingMembers && typeof source.pendingMembers === 'object' && !Array.isArray(source.pendingMembers) ? source.pendingMembers : {}).filter(([id]) => queue.cleanId(id)).map(([id, entry]) => [id, { joinedAt: typeof entry?.joinedAt === 'string' ? entry.joinedAt : null, queuedAt: typeof entry?.queuedAt === 'string' ? entry.queuedAt : now() }])),
    channelId: queue.cleanId(source.channelId),
    time: cleanTime(source.time),
    timezone: cleanTimezone(source.timezone),
    message: String(source.message || base.message).slice(0, 1800),
    templateId: String(source.templateId || '').trim().slice(0, 120) || null,
    pingMembers: source.pingMembers !== false,
    removeQueueRole: source.removeQueueRole !== false,
    ignoreBots: source.ignoreBots !== false,
    batchSize: Number.isFinite(batchSize) ? Math.min(50, Math.max(1, Math.floor(batchSize))) : base.batchSize,
    // Never discard successful-delivery checkpoints solely because a guild is large.
    // Dropping older IDs can resend welcomes when queue-role cleanup is disabled or fails.
    completedMemberIds: [...new Set((Array.isArray(source.completedMemberIds) ? source.completedMemberIds : []).map(queue.cleanId).filter(Boolean))],
    completedMemberJoins: Object.fromEntries(Object.entries(source.completedMemberJoins && typeof source.completedMemberJoins === 'object' && !Array.isArray(source.completedMemberJoins) ? source.completedMemberJoins : {}).filter(([id, joinedAt]) => queue.cleanId(id) && typeof joinedAt === 'string')),
    analytics: { ...defaultAnalytics(), ...(source.analytics || {}) },
    createdAt: source.createdAt || base.createdAt,
    updatedAt: source.updatedAt || now(),
  };
}

function getScheduledConfig(guildId) {
  const welcome = getModuleSection(guildId, MODULE, {});
  return normalizeScheduledConfig(welcome?.scheduled);
}

function getTemplateBinding(guildId) {
  return embedTemplateManager.getBinding(guildId, MODULE, TEMPLATE_SLOT);
}

function syncTemplateBinding(guildId, templateId) {
  const wantedId = String(templateId || '').trim() || null;
  const current = getTemplateBinding(guildId);
  const template = wantedId ? embedTemplateManager.getTemplate(guildId, wantedId) : null;

  if (!wantedId || !template) {
    if (current) embedTemplateManager.unbindTemplate(guildId, MODULE, TEMPLATE_SLOT);
    return null;
  }
  if (!current || current.templateId !== wantedId) {
    return embedTemplateManager.bindTemplate(guildId, MODULE, TEMPLATE_SLOT, wantedId);
  }
  return current;
}

function updateScheduledConfig(guildId, patch = {}, meta = {}) {
  if (patch?.enabled === true && !guildManager.isModuleEnabled(guildId, MODULE)) {
    guildManager.setModuleEnabled(guildId, MODULE, true, { ...meta, action: meta.action || 'scheduled_welcome_enable_parent' });
  }
  let saved = null;
  updateModuleSection(guildId, MODULE, (section = {}) => {
    const current = normalizeScheduledConfig(section.scheduled);
    saved = normalizeScheduledConfig({ ...current, ...(patch || {}), updatedAt: now() });
    return { ...section, scheduled: saved, updatedAt: now() };
  }, {}, meta);
  const result = saved || getScheduledConfig(guildId);
  syncTemplateBinding(guildId, result.templateId);
  return result;
}

function enqueueScheduledMember(member) {
  if (!member?.guild?.id || !member.id) return false;
  const config = getScheduledConfig(member.guild.id);
  if (!config.enabled || config.queueRoleId || (config.ignoreBots && member.user?.bot)) return false;
  const joinedAt = member.joinedAt?.toISOString?.() || null;
  // A new join is a new delivery opportunity, but repeated join events for
  // the same membership must not erase an already successful checkpoint.
  const previous = config.pendingMembers[member.id];
  if (previous && previous.joinedAt === joinedAt) return false;
  const deliveredJoin = config.completedMemberJoins?.[member.id];
  if (config.completedMemberIds.includes(member.id) && (!joinedAt || !deliveredJoin || deliveredJoin === joinedAt)) return false;
  updateScheduledConfig(member.guild.id, {
    completedMemberIds: config.completedMemberIds.filter(id => id !== member.id),
    completedMemberJoins: Object.fromEntries(Object.entries(config.completedMemberJoins || {}).filter(([id]) => id !== member.id)),
    pendingMembers: { ...config.pendingMembers, [member.id]: { joinedAt, queuedAt: now() } },
  }, { action: 'scheduled_welcome_member_queued' });
  return true;
}
function dequeueScheduledMember(guildId, memberId, departedJoinedAt = null) {
  const config = getScheduledConfig(guildId);
  const pending = config.pendingMembers[memberId];
  if (!pending) return false;
  // A delayed leave event must not remove the queue entry for a newer join.
  if (departedJoinedAt && pending.joinedAt && pending.joinedAt !== departedJoinedAt) return false;
  const pendingMembers = { ...config.pendingMembers };
  delete pendingMembers[memberId];
  updateScheduledConfig(guildId, { pendingMembers }, { action: 'scheduled_welcome_member_left' });
  return true;
}
function zonedDateKey(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: cleanTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function resolveChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function clearCompletedWithoutRole(guild, config) {
  if (!config.completedMemberIds.length || !config.queueRoleId) return config;
  await queue.refreshMembers(guild);
  // Missing cache entries are not evidence that a member left the queue.
  // Retain their delivery checkpoint until their role state is known.
  const stillQueued = config.completedMemberIds.filter((memberId) => {
    const member = guild.members.cache.get(memberId);
    return !member || member.roles?.cache?.has(config.queueRoleId);
  });
  if (stillQueued.length === config.completedMemberIds.length) return config;
  return updateScheduledConfig(guild.id, { completedMemberIds: stillQueued }, { action: 'scheduled_welcome_completed_cleanup' });
}

async function getWaitingMembers(guild) {
  let config = getScheduledConfig(guild.id);
  config = await clearCompletedWithoutRole(guild, config);
  const completed = new Set(config.completedMemberIds);
  const members = await queue.getQueuedMembers(guild, config);
  // Scheduled delivery is independent of the queue mechanism, but members
  // must complete Verification before being announced as joined.
  const verificationEnabled = guildManager.isModuleEnabled(guild.id, 'verification');
  const verificationStore = verificationEnabled ? require('../../securityStudio/verificationStore') : null;
  return members.filter((member) => !completed.has(member.id)
    && member.pending !== true
    && (!verificationEnabled || verificationStore.getSession(guild.id, member.id)?.state === 'verified'));
}

async function executeScheduledWelcome(guild, options = {}) {
  let config = getScheduledConfig(guild.id);
  if (!options.force && !guildManager.isModuleEnabled(guild.id, MODULE)) return { skipped: true, reason: 'welcome_disabled' };
  if (!options.force && !config.enabled) return { skipped: true, reason: 'scheduled_disabled' };
  if (!config.channelId) throw new Error('Scheduled Welcome channel is not configured.');

  const channel = await resolveChannel(guild, config.channelId);
  if (!channel) throw new Error('Scheduled Welcome channel is unavailable.');
  if (config.queueRoleId) {
    const role = guild.roles.cache.get(config.queueRoleId) || await guild.roles.fetch(config.queueRoleId).catch(() => null);
    if (!role) throw new Error('Scheduled Welcome queue role is unavailable.');
  }

  const waiting = await getWaitingMembers(guild);
  config = getScheduledConfig(guild.id);
  // A previous send may have succeeded even when queue-role removal failed.
  // Retry that cleanup without sending a duplicate welcome.
  let retryRoleRemovalFailed = 0;
  const retryErrors = [];
  if (config.queueRoleId && config.removeQueueRole && config.completedMemberIds.length) {
    for (const memberId of config.completedMemberIds) {
      const member = guild.members.cache.get(memberId);
      if (!member?.roles?.cache?.has(config.queueRoleId)) continue;
      const removal = await queue.removeQueueRole(member, config.queueRoleId);
      if (!removal.removed && !removal.skipped) {
        retryRoleRemovalFailed += 1;
        retryErrors.push(`${memberId}: queue role cleanup retry failed: ${removal.error || 'Unknown error'}`);
      }
    }
  }
  const runDate = zonedDateKey(config.timezone);
  if (!waiting.length) {
    const analytics = {
      ...config.analytics,
      runs: Number(config.analytics.runs || 0) + 1,
      emptyRuns: Number(config.analytics.emptyRuns || 0) + 1,
      lastRunAt: now(),
      lastRunDate: runDate,
      roleRemovalFailed: Number(config.analytics.roleRemovalFailed || 0) + retryRoleRemovalFailed,
      lastError: retryErrors[0]?.slice(0, 500) || null,
    };
    updateScheduledConfig(guild.id, { analytics }, { actorId: options.actorId, action: 'scheduled_welcome_empty_run' });
    return { skipped: false, empty: true, welcomed: 0, messagesSent: 0, roleRemovalFailed: retryRoleRemovalFailed, errors: retryErrors };
  }

  const batches = messages.splitIntoBatches(waiting, config, guild);
  let welcomed = 0;
  let messagesSent = 0;
  let sendFailed = 0;
  let roleRemovalFailed = retryRoleRemovalFailed;
  const errors = [...retryErrors];
  const completed = new Set(config.completedMemberIds);

  for (const batch of batches) {
    try {
      const built = await messages.buildTemplateBatchPayload(guild, batch, config);
      const payload = await emojiPayload.resolveMessagePayload(guild.client, guild.id, built, 'welcome');
      await channel.send(payload);
      messagesSent += 1;
      welcomed += batch.length;
      // Persist successful delivery before attempting role cleanup. A role
      // removal failure must never make an already-sent welcome eligible again.
      for (const member of batch) completed.add(member.id);
      const pendingMembers = { ...getScheduledConfig(guild.id).pendingMembers };
      for (const member of batch) delete pendingMembers[member.id];
      const completedMemberJoins = { ...getScheduledConfig(guild.id).completedMemberJoins };
      for (const member of batch) if (member.joinedAt?.toISOString?.()) completedMemberJoins[member.id] = member.joinedAt.toISOString();
      updateScheduledConfig(guild.id, { completedMemberIds: [...completed], completedMemberJoins, pendingMembers }, { actorId: options.actorId, action: 'scheduled_welcome_delivery_checkpoint' });
      if (config.queueRoleId && config.removeQueueRole) {
        for (const member of batch) {
          const removal = await queue.removeQueueRole(member, config.queueRoleId);
          if (!removal.removed && !removal.skipped) {
            roleRemovalFailed += 1;
            errors.push(`${member.id}: welcome sent but queue role removal failed: ${removal.error || 'Unknown error'}`);
          }
        }
      }
    } catch (error) {
      sendFailed += batch.length;
      errors.push(`Batch send failed: ${error.message || error}`);
    }
  }

  config = getScheduledConfig(guild.id);
  const analytics = {
    ...config.analytics,
    runs: Number(config.analytics.runs || 0) + 1,
    messagesSent: Number(config.analytics.messagesSent || 0) + messagesSent,
    membersWelcomed: Number(config.analytics.membersWelcomed || 0) + welcomed,
    sendFailed: Number(config.analytics.sendFailed || 0) + sendFailed,
    roleRemovalFailed: Number(config.analytics.roleRemovalFailed || 0) + roleRemovalFailed,
    lastRunAt: now(),
    lastRunDate: sendFailed > 0 ? config.analytics.lastRunDate : runDate,
    lastError: errors.length ? errors[0].slice(0, 500) : null,
  };
  updateScheduledConfig(guild.id, { analytics, completedMemberIds: [...completed] }, { actorId: options.actorId, action: 'scheduled_welcome_run' });

  return { skipped: false, empty: false, welcomed, messagesSent, sendFailed, roleRemovalFailed, errors };
}


const activeRuns = new Set();

async function runScheduledWelcome(guild, options = {}) {
  if (!guild?.id) throw new Error('Scheduled Welcome requires a guild.');
  if (activeRuns.has(guild.id)) return { skipped: true, reason: 'already_running' };
  activeRuns.add(guild.id);
  try {
    return await executeScheduledWelcome(guild, options);
  } finally {
    activeRuns.delete(guild.id);
  }
}

module.exports = {
  MODULE,
  TEMPLATE_SLOT,
  defaultScheduledConfig,
  normalizeScheduledConfig,
  getScheduledConfig,
  getTemplateBinding,
  syncTemplateBinding,
  updateScheduledConfig,
  enqueueScheduledMember,
  dequeueScheduledMember,
  zonedDateKey,
  resolveChannel,
  getWaitingMembers,
  runScheduledWelcome,
};