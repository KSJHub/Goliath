'use strict';

const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const embedTemplateManager = require('../embed/embedTemplates');
const scheduledWelcome = require('./scheduledWelcome');
const queue = require('./scheduledWelcomeQueue');

async function resolveRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function buildHealth(guild) {
  const config = scheduledWelcome.getScheduledConfig(guild.id);
  const parentEnabled = guildManager.isModuleEnabled(guild.id, 'welcome');
  const issues = [];
  const warnings = [];
  const role = await resolveRole(guild, config.queueRoleId);
  const channel = config.channelId ? await scheduledWelcome.resolveChannel(guild, config.channelId) : null;
  const template = config.templateId ? embedTemplateManager.getTemplate(guild.id, config.templateId) : null;
  const templateBinding = scheduledWelcome.getTemplateBinding(guild.id);
  const boundTemplate = templateBinding ? embedTemplateManager.getTemplate(guild.id, templateBinding.templateId) : null;
  const me = guild.members?.me || null;
  const permissions = channel && me ? channel.permissionsFor(me) : null;

  if (config.enabled && !parentEnabled) issues.push('Scheduled Welcome is enabled but the parent Welcome module is disabled.');
  if (config.enabled && config.queueRoleId && !role) issues.push(`Queue role ${config.queueRoleId} no longer exists.`);
  if (config.enabled && !config.channelId) issues.push('Scheduled Welcome needs a destination channel.');
  if (config.enabled && config.channelId && !channel) issues.push(`Scheduled Welcome channel ${config.channelId} is unavailable.`);
  if (config.templateId && !template) issues.push(`Scheduled Welcome Embed Studio template ${config.templateId} no longer exists.`);
  if (templateBinding && !boundTemplate) issues.push(`Scheduled Welcome binding points to missing template ${templateBinding.templateId}.`);
  if (!config.templateId && templateBinding) issues.push(`Scheduled Welcome has stale template binding ${templateBinding.templateId} while no template is selected.`);
  if (config.templateId && template && !templateBinding) issues.push(`Scheduled Welcome template ${config.templateId} is selected but is not canonically bound.`);
  if (config.templateId && templateBinding && templateBinding.templateId !== config.templateId) issues.push(`Scheduled Welcome binding ${templateBinding.templateId} does not match configured template ${config.templateId}.`);
  if (channel && !permissions?.has(PermissionFlagsBits.ViewChannel)) issues.push('Goliath cannot view the Scheduled Welcome channel.');
  if (channel && !permissions?.has(PermissionFlagsBits.SendMessages)) issues.push('Goliath cannot send messages in the Scheduled Welcome channel.');
  if (channel && template && !permissions?.has(PermissionFlagsBits.EmbedLinks)) issues.push('Goliath cannot embed links in the Scheduled Welcome channel.');
  if (config.removeQueueRole && role) {
    if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) issues.push('Goliath needs Manage Roles to remove the queue role after welcoming members.');
    else if (role.managed || role.position >= me.roles.highest.position) issues.push(`Queue role ${role.name} cannot be managed by Goliath.`);
  }

  let report = null;
  try {
    report = await scheduledWelcome.getQueueDiagnostics(guild);
  } catch (error) {
    issues.push(`Scheduled Welcome queue inspection failed: ${error.message || error}`);
  }
  const alreadyWelcomedMembers = report ? report.excluded.filter(entry => entry.reasons.includes('Already welcomed')).length : null;
  const stuckMemberIds = [];
  if (config.removeQueueRole && config.queueRoleId) {
    for (const memberId of config.completedMemberIds) {
      const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
      const joinedAt = member?.joinedAt?.toISOString?.();
      if (joinedAt && config.completedMemberJoins?.[memberId] === joinedAt && member.roles?.cache?.has(config.queueRoleId)) stuckMemberIds.push(memberId);
    }
  }
  if (stuckMemberIds.length) warnings.push(`${stuckMemberIds.length} welcomed member(s) still have the queue role and need cleanup.`);

  const templateBindingHealthy = !config.templateId
    ? !templateBinding
    : Boolean(template && templateBinding && boundTemplate && templateBinding.templateId === config.templateId);
  return {
    healthy: issues.length === 0,
    enabled: config.enabled,
    parentEnabled,
    issues,
    warnings,
    queueRoleId: config.queueRoleId,
    queueMode: config.queueRoleId ? 'legacy_role' : 'persistent_members',
    queueRoleName: role?.name || null,
    channelId: config.channelId,
    channelName: channel?.name || null,
    templateId: config.templateId,
    templateName: template?.name || null,
    templateBindingId: templateBinding?.templateId || null,
    templateBindingHealthy,
    waitingMembers: report ? report.waiting.length : null,
    queueInspectionHealthy: report !== null,
    alreadyWelcomedMembers,
    stuckMemberIds,
    time: config.time,
    timezone: config.timezone,
    lastRunAt: config.analytics?.lastRunAt || null,
    lastRunDate: config.analytics?.lastRunDate || null,
  };
}

async function repair(guild, meta = {}) {
  const before = await buildHealth(guild);
  let config = scheduledWelcome.getScheduledConfig(guild.id);
  const patch = {};

  if (config.enabled && !guildManager.isModuleEnabled(guild.id, 'welcome')) {
    guildManager.setModuleEnabled(guild.id, 'welcome', true, { ...meta, action: 'scheduled_welcome_repair_parent' });
  }
  if (config.queueRoleId && !await resolveRole(guild, config.queueRoleId)) patch.queueRoleId = null;
  if (config.channelId && !await scheduledWelcome.resolveChannel(guild, config.channelId)) patch.channelId = null;
  if (config.templateId && !embedTemplateManager.getTemplate(guild.id, config.templateId)) patch.templateId = null;

  // Never clear role-free delivery checkpoints during repair: they are the
  // only persistent evidence that a scheduled message was already delivered.
  if (config.queueRoleId && config.removeQueueRole && !Object.prototype.hasOwnProperty.call(patch, 'queueRoleId')) {
    for (const memberId of before.stuckMemberIds) {
      const member = await guild.members.fetch({ user: memberId, force: true }).catch(() => null);
      const joinedAt = member?.joinedAt?.toISOString?.();
      if (!joinedAt || config.completedMemberJoins?.[memberId] !== joinedAt) continue;
      await queue.removeQueueRole(member, config.queueRoleId, 'Scheduled Welcome repair cleanup');
    }
  }
  config = scheduledWelcome.updateScheduledConfig(guild.id, patch, { ...meta, action: 'scheduled_welcome_repair' });
  scheduledWelcome.syncTemplateBinding(guild.id, config.templateId);
  return { before, config, health: await buildHealth(guild) };
}

module.exports = {
  buildHealth,
  repair,
};
