const { EmbedBuilder } = require('discord.js');

const clean = (value, fallback, maxLength) => {
  const text = String(value ?? '').trim().slice(0, maxLength);
  return text || fallback;
};

function buildAutoModDMEmbed({ guild, rule, reason, action, messageContent, channel }) {
  const safeRule = clean(rule, 'Unknown Rule', 240);
  const safeReason = clean(reason, 'Rule triggered', 1024);
  const safeAction = clean(action, 'Action taken', 1024);
  const safeMessageContent = clean(messageContent, 'None', 1000);

  return new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle(`🤖 AutoMod: ${safeRule}`)
    .addFields(
      { name: 'Server', value: guild.name, inline: true },
      { name: 'Channel', value: channel ? `<#${channel.id}>` : 'Unknown', inline: true },
      { name: 'Rule', value: safeRule, inline: true },
      { name: 'Actions Taken', value: safeAction, inline: true },
      { name: 'Reason', value: safeReason },
      { name: 'Message Content', value: safeMessageContent }
    )
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setTimestamp();
}

async function sendAutoModDM(user, guild, data = {}) {
  try {
    const customMessage = String(data.customMessage || '').trim();
    if (customMessage) {
      await user.send({ content: customMessage.slice(0, 2000) });
      return true;
    }

    const embed = buildAutoModDMEmbed({
      guild,
      rule: data.rule || 'Unknown Rule',
      reason: data.reason || 'Rule triggered',
      action: data.action || 'Action taken',
      messageContent: data.messageContent || '',
      channel: data.channel || null,
    });

    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

module.exports = { sendAutoModDM, buildAutoModDMEmbed };
