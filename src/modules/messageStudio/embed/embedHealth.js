'use strict';

const { PermissionFlagsBits } = require('discord.js');
const {
  getAllEmbedDeployments,
  getEmbedPresetForDeployment,
  markEmbedDeploymentStatus,
  DEPLOYMENT_STATUS,
} = require('./embedDeployments');
const { listTemplates } = require('./embedTemplates');

function now() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mediaPanels(preset = {}) {
  if (Array.isArray(preset?.media?.panels)) return preset.media.panels;
  if (Array.isArray(preset?.media)) return preset.media;
  return [];
}

function hasAttachmentSource(value) {
  if (!value) return false;
  if (typeof value === 'string') return value.startsWith('attachment://');
  if (Array.isArray(value)) return value.some(hasAttachmentSource);
  if (typeof value === 'object') return Object.values(value).some(hasAttachmentSource);
  return false;
}

function deploymentRequiresAttachments(guildId, deployment) {
  const preset = getEmbedPresetForDeployment(guildId, deployment);
  if (!preset || typeof preset !== 'object') return false;

  if (hasAttachmentSource(preset)) return true;

  const panels = mediaPanels(preset);
  if (panels.some((panel) => asArray(panel?.files).some((file) => file?.source))) return true;

  const alignment = preset.mediaAlignment && typeof preset.mediaAlignment === 'object'
    ? preset.mediaAlignment
    : {};
  if (Object.values(alignment).some((value) => ['left', 'center', 'centre', 'right'].includes(String(value || '').toLowerCase()))) {
    return panels.some((panel) => asArray(panel?.gallery).some((item) => item?.source));
  }

  return false;
}

function requiredPermissions(guildId, deployment) {
  const required = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ];
  if (deploymentRequiresAttachments(guildId, deployment)) {
    required.push(['AttachFiles', PermissionFlagsBits.AttachFiles]);
  }
  return required;
}

async function inspectDeployment(guild, deployment) {
  const issues = [];
  const guildId = String(guild?.id || '');
  const deploymentKey = deployment?.key || deployment?.deploymentKey || null;

  let channel = guild?.channels?.cache?.get?.(deployment?.channelId) || null;
  if (!channel && deployment?.channelId) {
    channel = await guild.channels.fetch(deployment.channelId).catch(() => null);
  }

  if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
    issues.push({ code: 'channel_missing', deploymentKey, channelId: deployment?.channelId || null });
    return { deployment, healthy: false, issues, channel: null, message: null, requiresAttachments: false };
  }

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const permissions = me ? channel.permissionsFor(me) : null;
  const missingPermissions = [];
  for (const [name, permission] of requiredPermissions(guildId, deployment)) {
    if (!permissions?.has(permission)) {
      missingPermissions.push(name);
      issues.push({
        code: 'permission_missing',
        permission: name,
        channelId: channel.id,
        deploymentKey,
      });
    }
  }

  let message = null;
  if (deployment?.messageId && !missingPermissions.includes('ViewChannel') && !missingPermissions.includes('ReadMessageHistory')) {
    message = await channel.messages.fetch(deployment.messageId).catch(() => null);
    if (!message) {
      issues.push({
        code: 'message_missing',
        channelId: channel.id,
        messageId: deployment.messageId,
        deploymentKey,
      });
    }
  }

  return {
    deployment,
    healthy: issues.length === 0,
    issues,
    channel,
    message,
    requiresAttachments: deploymentRequiresAttachments(guildId, deployment),
  };
}

async function inspectAll(guild) {
  const deployments = Object.values(getAllEmbedDeployments(guild.id) || {});
  const checks = [];
  for (const deployment of deployments) {
    checks.push(await inspectDeployment(guild, deployment));
  }
  return { deployments, checks };
}

async function buildHealthReport(guild) {
  const { deployments, checks } = await inspectAll(guild);
  const issues = checks.flatMap((check) => check.issues);
  return {
    module: 'embed',
    healthy: issues.length === 0,
    templates: Object.keys(listTemplates(guild.id) || {}).length,
    deployments: deployments.length,
    active: checks.filter((check) => check.healthy).length,
    unavailable: checks.filter((check) => !check.healthy).length,
    issues,
    checkedAt: now(),
  };
}

function statusForCheck(check) {
  if (check.healthy) return { status: DEPLOYMENT_STATUS.ACTIVE, reason: null };
  if (check.issues.some((issue) => issue.code === 'channel_missing')) {
    return { status: DEPLOYMENT_STATUS.MISSING_CHANNEL, reason: 'channel_missing' };
  }
  if (check.issues.some((issue) => issue.code === 'permission_missing')) {
    const names = check.issues
      .filter((issue) => issue.code === 'permission_missing')
      .map((issue) => issue.permission)
      .filter(Boolean);
    return { status: DEPLOYMENT_STATUS.PERMISSION_ERROR, reason: `permission_missing:${names.join(',')}` };
  }
  if (check.issues.some((issue) => issue.code === 'message_missing')) {
    return { status: DEPLOYMENT_STATUS.MISSING_MESSAGE, reason: 'message_missing' };
  }
  return { status: DEPLOYMENT_STATUS.UNKNOWN, reason: 'unknown' };
}

async function repairAll(guild, actorId = null) {
  const { checks } = await inspectAll(guild);
  const changed = [];
  const unchanged = [];

  for (const check of checks) {
    const deployment = check.deployment;
    if (!deployment?.key) continue;
    const desired = statusForCheck(check);
    const needsUpdate = deployment.status !== desired.status
      || String(deployment.missingReason || '') !== String(desired.reason || '');

    if (!needsUpdate) {
      unchanged.push(deployment.key);
      continue;
    }

    markEmbedDeploymentStatus(guild.id, deployment.key, desired.status, {
      actorId,
      missingReason: desired.reason,
      reconciledAt: now(),
    });
    changed.push(deployment.key);
  }

  const report = await buildHealthReport(guild);
  return { ...report, reconciliation: { changed, unchanged } };
}

module.exports = {
  deploymentRequiresAttachments,
  requiredPermissions,
  inspectDeployment,
  buildHealthReport,
  repairAll,
};
