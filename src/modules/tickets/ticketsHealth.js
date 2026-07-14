'use strict';

const store = require('./ticketStore');
const panelManager = require('./ticketPanelManager');
const recovery = require('./ticketRecovery');

const cleanIds = (values = []) => [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').replace(/[<@#!&>]/g, '').trim()).filter((value) => /^\d{15,25}$/.test(value)))];

function getPanelList(guildId) {
  const value = store.getPanels(guildId);
  return Array.isArray(value?.panels) ? value.panels : [];
}

function getTicketList(guildId) {
  return typeof store.getAllTickets === 'function' ? store.getAllTickets(guildId) : [];
}

async function fetchChannel(guild, channelId) {
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

async function checkPanel(guild, panel) {
  const issues = [];
  const warnings = [];
  const channelId = panel.deployChannelId || panel.channelId || null;
  const messageId = panel.deployMessageId || panel.messageId || null;
  const deployed = Boolean(panel.deployed || (channelId && messageId));
  const channel = await fetchChannel(guild, channelId);

  if (deployed && !channel) issues.push('Deployment channel is missing or inaccessible.');
  if (deployed && channel && !channel.messages?.fetch) issues.push('Deployment channel cannot contain ticket panels.');

  let message = null;
  if (deployed && channel?.messages?.fetch && messageId) {
    message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) issues.push('Deployed panel message is missing or inaccessible.');
  }
  if (deployed && !messageId) issues.push('Panel is marked deployed without a message ID.');

  const categoryIds = cleanIds([panel.outputCategoryId, panel.archiveCategoryId]);
  for (const categoryId of categoryIds) {
    const category = await fetchChannel(guild, categoryId);
    if (!category) issues.push(`Category ${categoryId} is missing or inaccessible.`);
  }

  const channelIds = cleanIds([panel.logsChannelId, panel.transcriptsChannelId]);
  for (const requiredChannelId of channelIds) {
    const requiredChannel = await fetchChannel(guild, requiredChannelId);
    if (!requiredChannel) issues.push(`Configured channel ${requiredChannelId} is missing or inaccessible.`);
    else if (!requiredChannel.send) issues.push(`Configured channel ${requiredChannelId} is not sendable.`);
  }

  const roleIds = cleanIds([
    ...(panel.staffRoleIds || panel.staffRoles || []),
    ...(panel.managerRoleIds || []),
    ...(panel.viewerRoleIds || []),
  ]);
  for (const roleId of roleIds) {
    if (!guild.roles.cache.has(roleId)) issues.push(`Configured role ${roleId} no longer exists.`);
  }

  if (!roleIds.length) warnings.push('No staff, manager or viewer roles are configured.');
  if (!panel.outputCategoryId) warnings.push('No output category is configured.');
  if (!panel.transcriptsChannelId) warnings.push('No transcript channel is configured.');

  return {
    panelId: panel.panelId || panel.id,
    name: panel.name || panel.appearance?.title || 'Ticket Panel',
    deployed,
    healthy: issues.length === 0,
    issues,
    warnings,
    channelId,
    messageId,
    messageUrl: message?.url || null,
  };
}

async function buildHealthReport(guild) {
  const panels = [];
  for (const panel of getPanelList(guild.id)) panels.push(await checkPanel(guild, panel));

  const tickets = getTicketList(guild.id);
  const activeTickets = tickets.filter((ticket) => !['closed', 'archived', 'deleted'].includes(String(ticket.status || 'open').toLowerCase()));
  const missingTicketChannels = [];

  for (const ticket of activeTickets) {
    const channelId = ticket.discordChannelId || ticket.channelId || null;
    if (!channelId) {
      missingTicketChannels.push({ ticketId: ticket.ticketId || ticket.id, displayId: ticket.displayId || null, reason: 'missing_channel_id' });
      continue;
    }
    const channel = await fetchChannel(guild, channelId);
    if (!channel) missingTicketChannels.push({ ticketId: ticket.ticketId || ticket.id, displayId: ticket.displayId || null, channelId, reason: 'channel_missing' });
  }

  return {
    guildId: guild.id,
    healthy: panels.every((panel) => panel.healthy) && missingTicketChannels.length === 0,
    checkedAt: new Date().toISOString(),
    summary: {
      panels: panels.length,
      healthyPanels: panels.filter((panel) => panel.healthy).length,
      deployedPanels: panels.filter((panel) => panel.deployed).length,
      tickets: tickets.length,
      activeTickets: activeTickets.length,
      missingTicketChannels: missingTicketChannels.length,
    },
    panels,
    missingTicketChannels,
  };
}

async function repairPanel(guild, panelId, actorId = null) {
  const panel = store.getPanel(guild.id, panelId);
  if (!panel) throw new Error('Ticket panel not found.');

  if (typeof panelManager.refreshDeployedPanel === 'function' && (panel.deployMessageId || panel.messageId)) {
    await panelManager.refreshDeployedPanel({ guild, panel, actorId });
  }

  return checkPanel(guild, store.getPanel(guild.id, panelId) || panel);
}

async function repairAll(guild, actorId = null) {
  const repairedPanels = [];
  const failedPanels = [];

  for (const panel of getPanelList(guild.id)) {
    try {
      repairedPanels.push(await repairPanel(guild, panel.panelId || panel.id, actorId));
    } catch (error) {
      failedPanels.push({ panelId: panel.panelId || panel.id, error: error.message });
    }
  }

  let recoveryResult = null;
  if (typeof recovery.recoverGuildTickets === 'function') {
    recoveryResult = await recovery.recoverGuildTickets(guild.client, guild.id).catch((error) => ({ error: error.message }));
  } else if (typeof recovery.recoverTicketsForGuild === 'function') {
    recoveryResult = await recovery.recoverTicketsForGuild(guild.client, guild.id).catch((error) => ({ error: error.message }));
  }

  return {
    repairedPanels,
    failedPanels,
    recovery: recoveryResult,
    health: await buildHealthReport(guild),
  };
}

module.exports = {
  buildHealthReport,
  checkPanel,
  repairPanel,
  repairAll,
};
