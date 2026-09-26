'use strict';

const { PermissionFlagsBits } = require('discord.js');
const embedTemplateManager = require('../embed/embedTemplates');
const scheduledWelcome = require('./scheduledWelcome');
const queue = require('./scheduledWelcomeQueue');

async function resolveRole(guild, roleId) {
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
}

async function buildHealth(guild) {
  const config = scheduledWelcome.getScheduledConfig(guild.id);
  const issues = [];
  const warnings = [];
  const role = await resolveRole(guild, config.queueRoleId);
  const channel = config.channelId ? await scheduledWelcome.resolveChannel(guild, config.channelId) : null;
  const template = config.templateId ? embedTemplateManager.getTemplate(guild.id, config.templateId) : null;
  const templateBinding = scheduledWelcome.getTemplateBinding(guild.id);
  const boundTemplate = templateBinding ? embedTemplateManager.getTemplate(guild.id, templateBinding.templateId) : null;
  const me = guild.members?.me || null;
  const permissions = channel && me ? channel.permissionsFor(me) : null;

  if (config.enabled && !config.queueRoleId) issues.push('Scheduled Welcome needs a queue role.');
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

  const stuckMemberIds = [];
  for (const memberId of config.completedMemberIds) {
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
    if (member?.roles?.cache?.has(config.queueRoleId)) stuckMemberIds.push(memberId);
  }
  if (stuckMemberIds.length) warnings.push(`${stuckMemberIds.length} welcomed member(s) still have the queue role and need cleanup.`);

  const waitingMembers = config.queueRoleId ? await scheduledWelcome.getWaitingMembers(guild) : [];
  const templateBindingHealthy = !config.templateId
    ? !templateBinding
    : Boolean(template && templateBinding && boundTemplate && templateBinding.templateId === config.templateId);
  return {
    healthy: issues.length === 0,
    enabled: config.enabled,
    issues,
    warnings,
    queueRoleId: config.queueRoleId,
    queueRoleName: role?.name || null,
    channelId: config.channelId,
    channelName: channel?.name || null,
    templateId: config.templateId,
    templateName: template?.name || null,
    templateBindingId: templateBinding?.templateId || null,
    templateBindingHealthy,
    waitingMembers: waitingMembers.length,
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

  if (config.queueRoleId && !await resolveRole(guild, config.queueRoleId)) patch.queueRoleId = null;
  if (config.channelId && !await scheduledWelcome.resolveChannel(guild, config.channelId)) patch.channelId = null;
  if (config.templateId && !embedTemplateManager.getTemplate(guild.id, config.templateId)) patch.templateId = null;

  const remainingCompleted = [];
  for (const memberId of config.completedMemberIds) {
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
    if (!member || !member.roles?.cache?.has(config.queueRoleId)) continue;
    const result = await queue.removeQueueRole(member, config.queueRoleId, 'Scheduled Welcome repair cleanup');
    if (!result.removed && !result.skipped) remainingCompleted.push(memberId);
  }
  patch.completedMemberIds = remainingCompleted;
  config = scheduledWelcome.updateScheduledConfig(guild.id, patch, { ...meta, action: 'scheduled_welcome_repair' });
  scheduledWelcome.syncTemplateBinding(guild.id, config.templateId);
  return { before, config, health: await buildHealth(guild) };
}

module.exports = {
  buildHealth,
  repair,
};
