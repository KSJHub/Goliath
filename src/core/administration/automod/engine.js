const { sendAutoModDM } = require('./dm');
const { shouldBlockOwnerDestructiveAction } = require('../../../owner/dev/DevOverrideManager');

const VALID_PUNISHMENTS = ['dm', 'delete', 'warn', 'timeout', 'kick', 'ban'];
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

const ACTION_LABELS = {
  dm: 'DM user',
  delete: 'Delete message',
  warn: 'Warn user',
  timeout: 'Timeout user',
  kick: 'Kick user',
  ban: 'Ban user',
};

function normalizePunishments(value, fallback = ['delete']) {
  const base = Array.isArray(value) ? value : value ? [value] : fallback;
  const cleaned = base
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter((entry) => VALID_PUNISHMENTS.includes(entry));
  const unique = [...new Set(cleaned)];
  const compatible = unique.includes('ban') ? unique.filter((entry) => entry !== 'kick') : unique;
  return compatible.length ? compatible : [...fallback];
}

function getContext(input = {}) {
  const message = input.message || null;
  const member = input.member || message?.member || null;
  const user = input.user || member?.user || message?.author || null;
  const guild = input.guild || member?.guild || message?.guild || null;
  const channel = input.channel || message?.channel || null;
  return { message, member, user, guild, channel };
}

function formatActionList(punishments = []) {
  return punishments.map((item) => ACTION_LABELS[item] || item).join(', ');
}

function buildActionReason(source, reason, moderator) {
  const finalReason = moderator?.tag ? `${reason} | By ${moderator.tag}` : reason;
  return `${source === 'automod' ? 'AutoMod' : 'Moderation'}: ${finalReason}`;
}

function resolveTimeoutDuration(durationMs, timeoutMinutes) {
  const requestedMs = Number(durationMs);
  const requestedMinutes = Number(timeoutMinutes);
  const rawDuration = Number.isFinite(requestedMs) && requestedMs > 0
    ? requestedMs
    : Number.isFinite(requestedMinutes) && requestedMinutes > 0
      ? requestedMinutes * 60 * 1000
      : 10 * 60 * 1000;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(rawDuration)));
}

function shouldBlockDestructiveAction(context, punishment) {
  return shouldBlockOwnerDestructiveAction({
    guild: context.guild,
    member: context.member,
    user: context.user,
    action: punishment,
  });
}

function recordOutcome(result, punishment, ok) {
  result[ok ? 'applied' : 'failed'].push(punishment);
}

async function safeDelete(message) {
  try {
    if (!message?.deletable) return false;
    await message.delete();
    return true;
  } catch (error) {
    console.error('❌ Punishment engine delete failed:', error);
    return false;
  }
}

async function safeTimeout(member, durationMs, reason) {
  try {
    if (!member?.moderatable) return false;
    await member.timeout(durationMs, reason);
    return true;
  } catch (error) {
    console.error('❌ Punishment engine timeout failed:', error);
    return false;
  }
}

async function safeKick(member, reason) {
  try {
    if (!member?.kickable) return false;
    await member.kick(reason);
    return true;
  } catch (error) {
    console.error('❌ Punishment engine kick failed:', error);
    return false;
  }
}

async function safeBan(member, reason, deleteDays = 0) {
  try {
    if (!member?.bannable) return false;
    const rawDeleteDays = Number(deleteDays);
    const safeDeleteDays = Number.isFinite(rawDeleteDays)
      ? Math.min(7, Math.max(0, Math.trunc(rawDeleteDays)))
      : 0;
    await member.ban({ deleteMessageSeconds: safeDeleteDays * 24 * 60 * 60, reason });
    return true;
  } catch (error) {
    console.error('❌ Punishment engine ban failed:', error);
    return false;
  }
}

async function safeWarnChannel(message, reason) {
  try {
    if (!message?.channel || !message?.author) return false;
    const sent = await message.channel.send({ content: `⚠️ ${message.author}, your message was blocked: ${reason}` });
    setTimeout(() => { sent.delete().catch(() => {}); }, 5000);
    return true;
  } catch (error) {
    console.error('❌ Punishment engine channel warn failed:', error);
    return false;
  }
}

async function sendPunishmentDm(context, options, punishments) {
  if (!context.user || !context.guild || options.dmEnabled === false) return false;
  const action = formatActionList(punishments);
  return sendAutoModDM(context.user, context.guild, {
    rule: options.rule,
    reason: options.reason,
    action,
    messageContent: options.messageContent || context.message?.content || `Moderation action: ${action}`,
    channel: context.channel,
    customMessage: options.dmMessage || '',
  });
}

async function executePunishment(punishment, context, options) {
  if (punishment === 'delete') return safeDelete(context.message);
  if (punishment === 'warn') return context.message ? safeWarnChannel(context.message, options.reason) : true;
  if (punishment === 'timeout') return safeTimeout(context.member, options.timeoutDurationMs, options.actionReason);
  if (punishment === 'kick') return safeKick(context.member, options.actionReason);
  if (punishment === 'ban') return safeBan(context.member, options.actionReason, options.deleteDays);
  return false;
}

async function applyPunishmentEngine(input = {}, options = {}) {
  const {
    punishments,
    rule = 'Moderation',
    reason = 'No reason provided',
    timeoutMinutes = 10,
    durationMs = null,
    deleteDays = 0,
    moderator = null,
    source = 'moderation',
    messageContent = null,
    dmEnabled = true,
    dmMessage = '',
  } = options;

  const context = getContext(input);
  const list = normalizePunishments(punishments);
  const result = { applied: [], failed: [], blockedActions: [], dmSent: false, deleted: false };
  const executionOptions = {
    reason,
    deleteDays,
    timeoutDurationMs: resolveTimeoutDuration(durationMs, timeoutMinutes),
    actionReason: buildActionReason(source, reason, moderator),
  };

  if (list.includes('dm')) {
    if (dmEnabled === false) {
      result.blockedActions.push('dm');
    } else {
      result.dmSent = await sendPunishmentDm(context, { rule, reason, messageContent, dmEnabled, dmMessage }, list);
      recordOutcome(result, 'dm', result.dmSent);
    }
  }

  for (const punishment of list) {
    if (punishment === 'dm') continue;
    if (shouldBlockDestructiveAction(context, punishment)) {
      console.log(`[TEST MODE] ${punishment} blocked for protected owner ${context.user?.tag || context.member?.id || 'unknown'} in guild ${context.guild?.id || 'unknown'}`);
      result.applied.push(punishment);
      result.blockedActions.push(punishment);
      continue;
    }
    const ok = await executePunishment(punishment, context, executionOptions);
    if (punishment === 'delete' && ok) result.deleted = true;
    recordOutcome(result, punishment, ok);
  }

  const applied = [...new Set(result.applied)];
  const failed = [...new Set(result.failed)];
  const blockedActions = [...new Set(result.blockedActions)];
  const blocked = blockedActions.length > 0;
  return {
    ok: failed.length === 0,
    punishments: list,
    applied,
    failed,
    blocked,
    testMode: blockedActions.some((action) => action !== 'dm'),
    blockedActions,
    dmSent: result.dmSent,
    deleted: result.deleted,
    actionText: applied.length ? applied.join(', ') : 'none',
    failedText: failed.length ? failed.join(', ') : 'none',
  };
}

module.exports = { VALID_PUNISHMENTS, ACTION_LABELS, normalizePunishments, applyPunishmentEngine };
