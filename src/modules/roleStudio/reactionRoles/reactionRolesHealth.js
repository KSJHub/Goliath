'use strict';

const { PermissionsBitField } = require('discord.js');

const REQUIRED_ATTACH_PERMISSIONS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.AddReactions,
];

const REQUIRED_CREATE_PERMISSIONS = [
  ...REQUIRED_ATTACH_PERMISSIONS,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
];

function emojiDescriptor(value) {
  const raw = String(value || '').trim();
  const custom = raw.match(/^<a?:([A-Za-z0-9_]+):(\d{15,25})>$/);
  if (custom) return { raw, id: custom[2], name: custom[1], reaction: custom[2] };
  if (/^\d{15,25}$/.test(raw)) return { raw, id: raw, name: null, reaction: raw };
  return { raw, id: null, name: raw, reaction: raw };
}

function findReaction(message, emoji) {
  return message.reactions.cache.find((reaction) => (
    emoji.id ? reaction.emoji.id === emoji.id : reaction.emoji.id == null && reaction.emoji.name === emoji.name
  )) || null;
}

async function resolveChannel(guild, channelId) {
  return guild.channels.cache.get(String(channelId))
    || await guild.channels.fetch(String(channelId)).catch(() => null);
}

function roleIssues(guild, mappings = []) {
  const me = guild.members.me;
  if (!me) return ['Goliath could not resolve its server member record.'];
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) return ['Goliath requires Manage Roles.'];

  const issues = [];
  for (const mapping of mappings.filter((item) => item?.enabled !== false)) {
    const role = guild.roles.cache.get(String(mapping.roleId));
    if (!role) issues.push(`Role ${mapping.roleId} no longer exists.`);
    else if (role.managed) issues.push(`@${role.name} is managed by another integration.`);
    else if (role.position >= me.roles.highest.position) issues.push(`Move Goliath above @${role.name} in the server role hierarchy.`);
  }
  return issues;
}

async function inspectDeployment({ guild, channelId, mappings = [], createMessage = false }) {
  const channel = await resolveChannel(guild, channelId);
  const issues = [];
  if (!channel) return { channel: null, issues: [`Channel ${channelId} is unavailable or inaccessible.`, ...roleIssues(guild, mappings)] };

  const me = guild.members.me;
  const permissions = me && typeof channel.permissionsFor === 'function' ? channel.permissionsFor(me) : null;
  const required = createMessage ? REQUIRED_CREATE_PERMISSIONS : REQUIRED_ATTACH_PERMISSIONS;
  const labels = new Map([
    [PermissionsBitField.Flags.ViewChannel, 'View Channel'],
    [PermissionsBitField.Flags.ReadMessageHistory, 'Read Message History'],
    [PermissionsBitField.Flags.AddReactions, 'Add Reactions'],
    [PermissionsBitField.Flags.SendMessages, 'Send Messages'],
    [PermissionsBitField.Flags.EmbedLinks, 'Embed Links'],
  ]);

  if (!permissions) issues.push('Discord did not provide effective channel permissions for Goliath.');
  else for (const flag of required) if (!permissions.has(flag)) issues.push(`Goliath is missing ${labels.get(flag)} in #${channel.name}.`);

  issues.push(...roleIssues(guild, mappings));
  return { channel, issues: [...new Set(issues)] };
}

async function assertDeploymentAccess(context) {
  const report = await inspectDeployment(context);
  if (!report.issues.length) return report.channel;
  const error = new Error([
    'Reaction Roles deployment cannot continue:',
    ...report.issues.map((issue) => `• ${issue}`),
    'No configuration was changed. Fix the listed permissions or role hierarchy and retry.',
  ].join('\n'));
  error.code = 'REACTION_ROLE_ACCESS';
  error.userFacing = true;
  error.issues = report.issues;
  throw error;
}

async function fetchMessage(guild, panel) {
  const channel = await resolveChannel(guild, panel.channelId);
  if (!channel?.messages?.fetch) throw new Error('The reaction-role message channel is unavailable.');
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) throw new Error('The reaction-role message no longer exists or is inaccessible.');
  return message;
}

async function ensurePanelReactions(guild, panel) {
  if (!panel || panel.enabled === false) return panel;
  const mappings = (panel.mappings || []).filter((mapping) => mapping.enabled !== false);
  await assertDeploymentAccess({ guild, channelId: panel.channelId, mappings, createMessage: false });
  let message = await fetchMessage(guild, panel);
  const botId = guild.members.me?.id || guild.client.user?.id;

  for (const mapping of mappings) {
    const emoji = emojiDescriptor(mapping.emoji);
    let reaction = findReaction(message, emoji);
    let owned = reaction?.me === true;
    if (!owned && reaction && botId) {
      const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
      owned = Boolean(users?.has(botId));
    }
    if (owned) continue;

    let confirmed = false;
    let lastError = null;
    for (let attempt = 1; attempt <= 3 && !confirmed; attempt += 1) {
      try {
        await message.react(emoji.reaction);
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        message = await fetchMessage(guild, panel);
        reaction = findReaction(message, emoji);
        confirmed = reaction?.me === true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!confirmed) throw lastError || new Error(`Could not confirm reaction ${mapping.emoji}.`);
  }

  return panel;
}

module.exports = {
  inspectDeployment,
  assertDeploymentAccess,
  ensurePanelReactions,
};
