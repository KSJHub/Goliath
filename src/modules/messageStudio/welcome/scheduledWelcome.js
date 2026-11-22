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
    message: '**👋 Welcome to our newest members!**\n\nLet\'s give a warm welcome to:\n\n{members}\n\nWe\'re delighted to have you here. Make yourself at home and enjoy the community! 🎉',
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
    pendingMembers: Object.fromEntries(Object.entries(source.pendingMembers && typeof source.pendingMembers === 'object' && !Array.isArray(source.pendingMembers) ? source.pendingMembers : {}).filter(([id]) => queue.cleanId(id)).map(([id, entry]) => [id, { joinedAt: typeof entry?.joinedAt === 'string' ? entry.joinedAt : null, queuedAt: typeof entry?.queuedAt === 'string' ? entry.queuedAt : now(), panelSentAt: typeof entry?.panelSentAt === 'string' ? entry.panelSentAt : null, panelMessageId: queue.cleanId(entry?.panelMessageId) }])),
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
  // A missing departure timestamp cannot prove this queue entry belongs to
  // the departed membership. Keep timestamped entries rather than deleting
  // a newer join's pending welcome after an out-of-order leave event.
  if (pending.joinedAt && (!departedJoinedAt || pending.joinedAt !== departedJoinedAt)) return false;
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

async function getQueueDiagnostics(guild) {
  const config = getScheduledConfig(guild.id);
  const completed = new Set(config.completedMemberIds);
  const members = await queue.getQueuedMembers(guild, config);
  const verificationEnabled = guildManager.isModuleEnabled(guild.id, 'verification');
  const verificationStore = verificationEnabled ? require('../../securityStudio/verification/verificationStore') : null;
  const waiting = [], excluded = [];
  for (const member of members) {
    const joinedAt = member.joinedAt?.toISOString?.() || null;
    const deliveredJoin = config.completedMemberJoins?.[member.id];
    const reasons = [];
    if (member.pending === true) reasons.push('Discord screening pending');
    if (verificationEnabled && verificationStore.getSession(guild.id, member.id)?.state !== 'verified') reasons.push('Verification session not verified');
    if (completed.has(member.id) && !(joinedAt && deliveredJoin && deliveredJoin !== joinedAt)) reasons.push('Already welcomed');
    if (!reasons.length) waiting.push(member);
    else excluded.push({ id: member.id, username: member.user?.username || member.id, displayName: member.displayName || member.id, reasons, canRequeue: reasons.length === 1 && reasons[0] === 'Already welcomed' });
  }
  return { waiting, excluded, candidateCount: members.length };
}

async function getWaitingMembers(guild) {
  return (await getQueueDiagnostics(guild)).waiting;
}

async function requeueMember(guild, memberId, options = {}) {
  if (!queue.cleanId(memberId)) throw new Error('Invalid member ID.');
  if (activeRuns.has(guild.id)) throw new Error('Scheduled Welcome is already running.');
  activeRuns.add(guild.id);
  try {
    const report = await getQueueDiagnostics(guild);
    if (!report.excluded.some(entry => entry.id === memberId && entry.canRequeue)) throw new Error('Only previously welcomed, otherwise eligible members can be requeued.');
    const member = await guild.members.fetch({ user: memberId, force: true });
    const config = getScheduledConfig(guild.id);
    if (config.queueRoleId && !member.roles.cache.has(config.queueRoleId)) throw new Error('Member no longer holds the selected queue role.');
    const joinedAt = member.joinedAt?.toISOString?.() || null;
    const completedMemberJoins = { ...config.completedMemberJoins };
    delete completedMemberJoins[memberId];
    updateScheduledConfig(guild.id, {
      completedMemberIds: config.completedMemberIds.filter(id => id !== memberId),
      completedMemberJoins,
      pendingMembers: { ...config.pendingMembers, [memberId]: { joinedAt, queuedAt: now() } },
    }, { actorId: options.actorId, action: 'scheduled_welcome_manual_requeue' });
    return { requeued: true, memberId };
  } finally { activeRuns.delete(guild.id); }
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
      const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
      if (!member?.roles?.cache?.has(config.queueRoleId)) continue;
      const joinedAt = member.joinedAt?.toISOString?.() || null;
      const deliveredJoin = config.completedMemberJoins?.[memberId];
      // Never remove the queue role from a newer, not-yet-welcomed membership.
      // Legacy ID-only checkpoints cannot establish which membership received
      // the message, so do not risk removing a role from a subsequent join.
      if (!joinedAt || !deliveredJoin || deliveredJoin !== joinedAt) continue;
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
  let checkpointFailed = 0;
  let roleRemovalFailed = retryRoleRemovalFailed;
  const errors = [...retryErrors];

  for (const batch of batches) {
    let delivered = false;
    let checkpointSaved = false;
    try {
      const built = await messages.buildTemplateBatchPayload(guild, batch, config);
      const panelPayload = await emojiPayload.resolveMessagePayload(guild.client, guild.id, built.panelPayload, 'welcome');
      const currentConfig = getScheduledConfig(guild.id);
      const panelAlreadySent = batch.every((member) => {
        const entry = currentConfig.pendingMembers[member.id];
        return entry && entry.joinedAt === (member.joinedAt?.toISOString?.() || null) && entry.panelSentAt;
      });
      if (!panelAlreadySent) {
        const panelMessage = await channel.send(panelPayload);
        messagesSent += 1;
        // Save the panel checkpoint before sending the ping message. If the
        // mention send fails, a retry sends only the missing mention line.
        const checkpoint = getScheduledConfig(guild.id);
        const pendingMembers = { ...checkpoint.pendingMembers };
        for (const member of batch) {
          const entry = pendingMembers[member.id];
          const joinedAt = member.joinedAt?.toISOString?.() || null;
          if (entry && entry.joinedAt === joinedAt) {
            pendingMembers[member.id] = { ...entry, panelSentAt: now(), panelMessageId: queue.cleanId(panelMessage?.id) };
          }
        }
        updateScheduledConfig(guild.id, { pendingMembers }, { actorId: options.actorId, action: 'scheduled_welcome_panel_checkpoint' });
      }
      const mentionPayload = built.mentionsPayload;
      if (mentionPayload.content) {
        await channel.send(mentionPayload);
        messagesSent += 1;
      }
      delivered = true;
      welcomed += batch.length;
      // Persist successful delivery before attempting role cleanup. A role
      // removal failure must never make an already-sent welcome eligible again.
      const checkpoint = getScheduledConfig(guild.id);
      const completed = new Set(checkpoint.completedMemberIds);
      const pendingMembers = { ...checkpoint.pendingMembers };
      for (const member of batch) {
        const queuedJoin = pendingMembers[member.id]?.joinedAt;
        const deliveredJoin = member.joinedAt?.toISOString?.() || null;
        if (!queuedJoin || queuedJoin === deliveredJoin) {
          delete pendingMembers[member.id];
          completed.add(member.id);
        } else completed.delete(member.id);
      }
      const completedMemberJoins = { ...checkpoint.completedMemberJoins };
      for (const member of batch) {
        const deliveredJoin = member.joinedAt?.toISOString?.() || null;
        const newerJoin = pendingMembers[member.id]?.joinedAt;
        if (deliveredJoin && (!newerJoin || newerJoin === deliveredJoin)) completedMemberJoins[member.id] = deliveredJoin;
      }
      updateScheduledConfig(guild.id, { completedMemberIds: [...completed], completedMemberJoins, pendingMembers }, { actorId: options.actorId, action: 'scheduled_welcome_delivery_checkpoint' });
      checkpointSaved = true;
      if (config.queueRoleId && config.removeQueueRole) {
        for (const member of batch) {
          const currentMember = await guild.members.fetch({ user: member.id, force: true }).catch(() => null);
          if (!currentMember || !member.joinedAt?.toISOString?.() || currentMember.joinedAt?.toISOString?.() !== member.joinedAt.toISOString()) continue;
          const removal = await queue.removeQueueRole(currentMember, config.queueRoleId);
          if (!removal.removed && !removal.skipped) {
            roleRemovalFailed += 1;
            errors.push(`${member.id}: welcome sent but queue role removal failed: ${removal.error || 'Unknown error'}`);
          }
        }
      }
    } catch (error) {
      if (!delivered) sendFailed += batch.length;
      if (delivered && !checkpointSaved) checkpointFailed += batch.length;
      errors.push(`${!delivered ? 'Batch send failed' : !checkpointSaved ? 'Delivery checkpoint failed after send' : 'Post-delivery cleanup failed'}: ${error.message || error}`);
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
    lastRunDate: sendFailed > 0 || checkpointFailed > 0 ? config.analytics.lastRunDate : runDate,
    lastError: errors.length ? errors[0].slice(0, 500) : null,
  };
  updateScheduledConfig(guild.id, { analytics }, { actorId: options.actorId, action: 'scheduled_welcome_run' });

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
  getQueueDiagnostics,
  requeueMember,
  runScheduledWelcome,
};