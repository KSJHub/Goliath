'use strict';

function displayName(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || member?.id || 'Unknown';
}

function renderMessage(template, guild, members, config = {}) {
  const mentions = members.map((member) => `<@${member.id}>`).join(' ');
  const names = members.map((member) => displayName(member)).join(', ');
  const role = config.queueRoleId ? `<@&${config.queueRoleId}>` : '';
  const values = {
    members: mentions,
    memberNames: names,
    memberCount: members.length,
    server: guild?.name || '',
    guild: guild?.name || '',
    role,
    date: new Date().toLocaleDateString('en-GB'),
  };
  let output = String(template || '👋 Welcome our newest members!\n\n{members}');
  for (const [key, value] of Object.entries(values)) output = output.replaceAll(`{${key}}`, String(value));
  return output.trim();
}

function buildBatchPayload(guild, members, config = {}) {
  const content = renderMessage(config.message, guild, members, config);
  if (content.length > 2000) throw new Error('Scheduled Welcome message exceeds Discord’s 2,000 character limit for this batch.');
  const userIds = config.pingMembers === false ? [] : members.map((member) => member.id);
  return {
    content,
    allowedMentions: userIds.length
      ? { users: userIds, roles: [], repliedUser: false }
      : { parse: [], repliedUser: false },
  };
}

function splitIntoBatches(members, config = {}, guild = null) {
  const requested = Number(config.batchSize || 20);
  const maxBatchSize = Number.isFinite(requested) ? Math.min(50, Math.max(1, Math.floor(requested))) : 20;
  const batches = [];
  let current = [];

  for (const member of members) {
    const candidate = [...current, member];
    const tooMany = candidate.length > maxBatchSize;
    const tooLong = guild ? renderMessage(config.message, guild, candidate, config).length > 2000 : false;
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
  renderMessage,
  buildBatchPayload,
  splitIntoBatches,
};