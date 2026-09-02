const loggingService = require('./service');

async function handleChannelCreate(channel) {
  try {
    const guild = channel.guild;
    if (!guild) return;

    await loggingService.send(guild, 'channel.create', {
      title: 'Channel Created',
      color: '#57F287',
      fields: [
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Name', value: `\`${channel.name}\``, inline: true },
        { name: 'Channel ID', value: `\`${channel.id}\``, inline: true },
      ],
    });
  } catch (error) {
    console.error('[channelLog] create error:', error);
  }
}

async function handleChannelDelete(channel) {
  try {
    const guild = channel.guild;
    if (!guild) return;

    await loggingService.send(guild, 'channel.delete', {
      title: 'Channel Removed',
      color: '#ED4245',
      fields: [
        { name: 'Name', value: `\`${channel.name || 'Unknown'}\``, inline: true },
        { name: 'Channel ID', value: `\`${channel.id}\``, inline: true },
        { name: 'Type', value: `\`${channel.type}\``, inline: true },
      ],
    });
  } catch (error) {
    console.error('[channelLog] remove error:', error);
  }
}

async function handleChannelUpdate(oldChannel, newChannel) {
  try {
    const guild = newChannel.guild;
    if (!guild) return;

    const changes = [];
    let eventType = 'channel.update';

    if (oldChannel.name !== newChannel.name) {
      eventType = 'channel.nameUpdate';
      changes.push(`Name: \`${oldChannel.name}\` to \`${newChannel.name}\``);
    }

    if (oldChannel.topic !== newChannel.topic) {
      eventType = eventType === 'channel.update' ? 'channel.topicUpdate' : eventType;
      changes.push('Topic changed');
    }

    if (oldChannel.nsfw !== newChannel.nsfw) {
      changes.push(`NSFW: \`${oldChannel.nsfw ? 'Yes' : 'No'}\` to \`${newChannel.nsfw ? 'Yes' : 'No'}\``);
    }

    if (!changes.length) return;

    await loggingService.send(guild, eventType, {
      title: 'Channel Updated',
      color: '#5865F2',
      fields: [
        { name: 'Channel', value: `${newChannel}`, inline: true },
        { name: 'Channel ID', value: `\`${newChannel.id}\``, inline: true },
        { name: 'Changes', value: changes.join('\n'), inline: false },
      ],
    });
  } catch (error) {
    console.error('[channelLog] update error:', error);
  }
}

module.exports = {
  handleChannelCreate,
  handleChannelDelete,
  handleChannelUpdate,
};
