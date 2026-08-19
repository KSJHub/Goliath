'use strict';

const { PermissionFlagsBits } = require('discord.js');
const scheduledWelcome = require('./scheduledWelcome');
const queue = require('./scheduledWelcomeQueue');

async function buildHealth(guild) {
  const config = scheduledWelcome.getScheduledConfig(guild.id);
  const issues = [];
  const warnings = [];
  const role = config.queueRoleId
    ? guild.roles.cache.get(config.queueRoleId) || await guild.roles.fetch(config.queueRoleId).catch(() => null)
    : null;
  const channel = config.channelId ? await scheduledWelcome.resolveChannel(guild, config.channelId) : null;
  const me = guild.members?.me || null;
  const permissions = channel && me ? channel.permissionsFor(me) : null;

  if (config.enabled && !config.queueRoleId) issues.push('Scheduled Welcome needs a queue role.');
  if (config.enabled && config.queueRoleId && !role) issues.push(`Queue role ${config.queueRoleId} no longer exists.`);
  if (config.enabled && !config.channelId) issues.push('Scheduled Welcome needs a destination channel.');
  if (config.enabled && config.channelId && !channel) issues.push(`Scheduled Welcome channel ${config.channelId} is unavailable.`);
  if (channel && !permissions?.has(PermissionFlagsBits.ViewChannel)) issues.push('Goliath cannot view the Scheduled Welcome channel.');
  if (channel && !permissions?.has(PermissionFlagsBits.SendMessages)) issues.push('Goliath cannot send messages in the Scheduled Welcome channel.');
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
  return {
    healthy: issues.length === 0,
    enabled: config.enabled,
    issues,
    warnings,
    queueRoleId: config.queueRoleId,
    queueRoleName: role?.name || null,
    channelId: config.channelId,
    channelName: channel?.name || null,
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

  if (config.queueRoleId && !guild.roles.cache.has(config.queueRoleId)) patch.queueRoleId = null;
  if (config.channelId && !await scheduledWelcome.resolveChannel(guild, config.channelId)) patch.channelId = null;

  const remainingCompleted = [];
  for (const memberId of config.completedMemberIds) {
    const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
    if (!member || !member.roles?.cache?.has(config.queueRoleId)) continue;
    const result = await queue.removeQueueRole(member, config.queueRoleId, 'Scheduled Welcome repair cleanup');
    if (!result.removed && !result.skipped) remainingCompleted.push(memberId);
  }
  patch.completedMemberIds = remainingCompleted;
  config = scheduledWelcome.updateScheduledConfig(guild.id, patch, { ...meta, action: 'scheduled_welcome_repair' });
  return { before, config, health: await buildHealth(guild) };
}

module.exports = {
  buildHealth,
  repair,
};