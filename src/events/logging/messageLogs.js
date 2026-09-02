const loggingService = require('../../core/logging/service');

function trim(text, max = 1024) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function formatUser(user) {
  if (!user) return 'Unknown User';
  return `${user} \`${user.tag || user.username || user.id}\``;
}

module.exports = [
  {
    name: 'messageDelete',
    async execute(message) {
      if (!message?.guild || message.author?.bot) return;

      await loggingService.send(message.guild, 'message.delete', {
        title: '💬 Message Deleted',
        color: '#ED4245',
        description: message.content
          ? trim(message.content, 4096)
          : '*No text content available.*',
        fields: [
          { name: 'User', value: formatUser(message.author), inline: true },
          { name: 'Channel', value: `${message.channel}`, inline: true },
          { name: 'Message ID', value: `\`${message.id}\``, inline: true },
        ],
      });
    },
  },
  {
    name: 'messageUpdate',
    async execute(oldMessage, newMessage) {
      if (!newMessage?.guild || newMessage.author?.bot) return;

      const oldContent = oldMessage.content || '';
      const newContent = newMessage.content || '';

      if (!oldContent && !newContent) return;
      if (oldContent === newContent) return;

      await loggingService.send(newMessage.guild, 'message.edit', {
        title: '✏️ Message Edited',
        color: '#3498DB',
        description: newMessage.url ? `[Jump to message](${newMessage.url})` : '',
        fields: [
          { name: 'User', value: formatUser(newMessage.author), inline: true },
          { name: 'Channel', value: `${newMessage.channel}`, inline: true },
          { name: 'Message ID', value: `\`${newMessage.id}\``, inline: true },
          { name: 'Before', value: trim(oldContent || '*No content*') },
          { name: 'After', value: trim(newContent || '*No content*') },
        ],
      });
    },
  },
];
