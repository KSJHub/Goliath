'use strict';

const { EmbedBuilder } = require('discord.js');
const { replaceVariables } = require('../../../core/guild/guildVariables');
const embedTemplateManager = require('../embed/embedTemplates');
const { buildTemplateDeliveryPayload } = require('../embed/embedTemplateDelivery');

function displayName(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id || 'Unknown';
}

function buildBatchVariables(guild, members, config = {}) {
  const mentions = members.map((member) => `<@${member.id}>`).join(' ');
  const names = members.map((member) => displayName(member)).join(', ');
  const role = config.queueRoleId ? `<@&${config.queueRoleId}>` : '';
  return {
    members: mentions,
    memberNames: names,
    memberCount: members.length,
    server: guild?.name || '',
    guild: guild?.name || '',
    role,
    date: new Date().toLocaleDateString('en-GB'),
  };
}

function renderMessage(template, guild, members, config = {}) {
  const values = buildBatchVariables(guild, members, config);
  const count = members.length;
  // Member mentions are deliberately excluded from the panel. They are sent
  // in a separate follow-up message so Discord can notify each member.
  values.members = count === 1 ? 'our newest arrival' : 'our newest arrivals';
  let output = String(template || '👋 Welcome to our newest members!\\n\\nLet’s give a warm welcome to our newest arrivals.\\n\\nWe’re delighted to have you here. Make yourself at home and enjoy the community! 🎉');
  output = replaceVariables(output, values, { guild, guildId: guild?.id, user: members[0]?.user || null, member: members[0] || null }, false);
  return output.trim();
}

function allowedMentionsForBatch(members, config = {}) {
  const userIds = config.pingMembers === false ? [] : members.map((member) => member.id);
  return { parse: [], users: userIds, roles: [], repliedUser: false };
}

function buildMentionPayload(members, config = {}) {
  return {
    content: members.map((member) => `<@${member.id}>`).join(' '),
    allowedMentions: allowedMentionsForBatch(members, config),
  };
}

function buildPanelPayload(guild, members, config = {}) {
  const description = renderMessage(config.message, guild, members, config);
  if (description.length > 4096) throw new Error('Scheduled Welcome panel exceeds Discord’s 4,096 character embed description limit.');
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(description)
    .setFooter({ text: `Goliath • ${guild?.name || 'Scheduled Welcome'}` })
    .setTimestamp();
  return { embeds: [embed], allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
}

async function buildTemplateBatchPayload(guild, members, config = {}) {
  const templateId = String(config.templateId || '').trim();
  let panelPayload;
  if (!templateId) {
    panelPayload = buildPanelPayload(guild, members, config);
  } else {
    const template = embedTemplateManager.getTemplate(guild.id, templateId);
    if (!template) throw new Error(`Scheduled Welcome Embed Studio template ${templateId} no longer exists.`);
    const firstMember = members[0] || null;
    const interaction = {
      guild,
      guildId: guild.id,
      user: firstMember?.user || null,
      member: firstMember,
      client: guild.client,
    };
    panelPayload = await buildTemplateDeliveryPayload({
      template,
      variables: { ...buildBatchVariables(guild, members, config), members: members.length === 1 ? 'our newest arrival' : 'our newest arrivals' },
      interaction,
      includeComponents: true,
      allowUserPing: false,
      userId: null,
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    });
  }
  return { panelPayload, mentionsPayload: buildMentionPayload(members, config) };
}

function splitIntoBatches(members, config = {}, guild = null) {
  const requested = Number(config.batchSize || 20);
  const maxBatchSize = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 20;
  const batches = [];
  let current = [];

  for (const member of members) {
    const candidate = [...current, member];
    const tooMany = candidate.length > maxBatchSize;
    const tooLong = !config.templateId && guild ? renderMessage(config.message, guild, candidate, config).length > 4096 : false;
    if ((tooMany || tooLong) && current.length) {
      batches.push(current);
      current = [member];
    } else {
      current = candidate;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

module.exports = {
  displayName,
  buildBatchVariables,
  renderMessage,
  buildMentionPayload,
  buildPanelPayload,
  buildTemplateBatchPayload,
  splitIntoBatches,
};
