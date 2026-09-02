const { EmbedBuilder } = require('discord.js');
const guildManager = require('../guild/guildManager');

async function getLogChannel(guild, eventName) {
  const id = guildManager.getLogChannelId(guild.id, eventName, 'voice');

  if (!id) return null;

  const channel =
    guild.channels.cache.get(id) ||
    (await guild.channels.fetch(id).catch(() => null));

  return channel?.isTextBased() ? channel : null;
}

function formatMember(member) {
  if (!member) return 'Unknown member';
  return `${member} \`${member.user?.tag || member.user?.username || member.id}\``;
}

async function handleVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const member = newState.member || oldState.member;
    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    let eventName = null;
    let title = null;
    let color = null;
    let description = null;

    if (!oldChannel && newChannel) {
      eventName = 'voiceJoin';
      title = '🔊 Voice Joined';
      color = '#57F287';
      description = `${formatMember(member)} joined ${newChannel}.`;
    } else if (oldChannel && !newChannel) {
      eventName = 'voiceLeave';
      title = '🔇 Voice Left';
      color = '#ED4245';
      description = `${formatMember(member)} left ${oldChannel}.`;
    } else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
      eventName = 'voiceMove';
      title = '🔁 Voice Moved';
      color = '#5865F2';
      description = `${formatMember(member)} moved from ${oldChannel} to ${newChannel}.`;
    } else {
      return;
    }

    if (!guildManager.isLogEventEnabled(guild.id, eventName)) return;

    const logChannel = await getLogChannel(guild, eventName);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .addFields(
        { name: 'User ID', value: `\`${member?.id || 'Unknown'}\``, inline: true },
        {
          name: 'Old Channel',
          value: oldChannel ? `${oldChannel}` : 'None',
          inline: true,
        },
        {
          name: 'New Channel',
          value: newChannel ? `${newChannel}` : 'None',
          inline: true,
        }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error('[voiceLog] update error:', error);
  }
}

module.exports = {
  handleVoiceStateUpdate,
};
