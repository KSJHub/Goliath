'use strict';

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
  let output = String(template || '👋 Welcome our newest members!\n\n{members}');
  output = replaceVariables(output, values, { guild, guildId: guild?.id, user: members[0]?.user || null, member: members[0] || null }, false);
  return output.trim();
}

function allowedMentionsForBatch(members, config = {}) {
  const userIds = config.pingMembers === false ? [] : members.map((member) => member.id);
  return userIds.length
    ? { parse: [], users: userIds, roles: [], repliedUser: false }
    : { parse: [], users: [], roles: [], repliedUser: false };
}

function buildBatchPayload(guild, members, config = {}) {
  const content = renderMessage(config.message, guild, members, config);
  if (content.length > 2000) throw new Error('Scheduled Welcome message exceeds Discord’s 2,000 character limit for this batch.');
  return {
    content,
    allowedMentions: allowedMentionsForBatch(members, config),
  };
}

async function buildTemplateBatchPayload(guild, members, config = {}) {
  const templateId = String(config.templateId || '').trim();
  if (!templateId) return buildBatchPayload(guild, members, config);
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
  return buildTemplateDeliveryPayload({
    template,
    variables: buildBatchVariables(guild, members, config),
    interaction,
    includeComponents: true,
    allowUserPing: config.pingMembers !== false,
    userId: firstMember?.id || null,
    allowedMentions: allowedMentionsForBatch(members, config),
  });
}

function splitIntoBatches(members, config = {}, guild = null) {
  const requested = Number(config.batchSize || 20);
  const maxBatchSize = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 20;
  const batches = [];
  let current = [];

  for (const member of members) {
    const candidate = [...current, member];
    const tooMany = candidate.length > maxBatchSize;
    const tooLong = !config.templateId && guild ? renderMessage(config.message, guild, candidate, config).length > 2000 : false;
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
  buildBatchPayload,
  buildTemplateBatchPayload,
  splitIntoBatches,
};