const channelLog = require('../../core/logging/channelLog');

module.exports = [
  {
    name: 'channelCreate',
    async execute(channel) {
      await channelLog.handleChannelCreate(channel);
    },
  },
  {
    name: 'channelDelete',
    async execute(channel) {
      await channelLog.handleChannelDelete(channel);
    },
  },
  {
    name: 'channelUpdate',
    async execute(oldChannel, newChannel) {
      await channelLog.handleChannelUpdate(oldChannel, newChannel);
    },
  },
];
