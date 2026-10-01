'use strict';

const { buildMemberNotice, COLORS } = require('../../ui/memberNotice');

const clean = (value, fallback, maxLength) => {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return text || fallback;
};

function buildAutoModDMEmbed({ guild, rule, reason, action, messageContent, channel }) {
  const safeRule = clean(rule, 'Unknown Rule', 240);
  const payload = buildMemberNotice(guild, {
    module: 'Goliath AutoMod',
    emoji: '🤖',
    title: `AutoMod Action • ${safeRule}`,
    color: COLORS.danger,
    description: 'Goliath AutoMod detected activity that matched a server rule. This notice records what happened and what action was taken.',
    reference: `Rule • ${safeRule}`,
    status: 'Action Applied',
    fields: [
      { name: '📍 Channel', value: channel ? `<#${channel.id}>` : 'Not available', inline: true },
      { name: '🛡️ Action Taken', value: clean(action, 'Action taken', 1024), inline: true },
      { name: '💬 Message Content', value: clean(messageContent, 'No message content recorded', 1000) },
    ],
    reason: clean(reason, 'Rule triggered', 1024),
    issuedBy: 'Goliath AutoMod',
    meaning: 'An automated server rule was triggered. Any moderation restriction listed above has been applied by Goliath.',
    nextSteps: 'Review the rule and reason above. If this action created an appealable moderation case, use the appeal controls provided with that case notice.',
  });
  return payload.embeds[0];
}

async function sendAutoModDM(user, guild, data = {}) {
  try {
    const embed = buildAutoModDMEmbed({ guild, rule: data.rule, reason: data.reason, action: data.action, messageContent: data.messageContent, channel: data.channel });
    await user.send({ embeds: [embed], allowedMentions: { parse: [] } });
    if (data.customMessage) {
      const extra = clean(data.customMessage, '', 1800);
      if (extra) await user.send({ content: extra, allowedMentions: { parse: [] } });
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { sendAutoModDM, buildAutoModDMEmbed };
