const loggingService = require('../../core/logging/service');

function emojiLabel(emoji) {
  if (!emoji) return 'Unknown Emoji';
  return `${emoji} \`${emoji.name || 'Unknown'}\` (${emoji.id || 'N/A'})`;
}

function roleList(roles) {
  const values = roles?.cache ? [...roles.cache.values()] : [];
  if (!values.length) return 'No role restrictions';
  return values.map((role) => `${role}`).join(', ').slice(0, 1024);
}

async function logEmojiCreate(emoji) {
  if (!emoji?.guild) return;

  await loggingService.send(emoji.guild, 'emoji.create', {
    title: 'Emoji Created',
    color: '#57F287',
    fields: [
      { name: 'Emoji', value: emojiLabel(emoji), inline: false },
      { name: 'Animated', value: emoji.animated ? 'Yes' : 'No', inline: true },
      { name: 'Managed', value: emoji.managed ? 'Yes' : 'No', inline: true },
      { name: 'Roles', value: roleList(emoji.roles), inline: false },
    ],
  });
}

async function logEmojiDelete(emoji) {
  if (!emoji?.guild) return;

  await loggingService.send(emoji.guild, 'emoji.delete', {
    title: 'Emoji Deleted',
    color: '#ED4245',
    fields: [
      { name: 'Name', value: `\`${emoji.name || 'Unknown'}\``, inline: true },
      { name: 'Emoji ID', value: `\`${emoji.id}\``, inline: true },
      { name: 'Animated', value: emoji.animated ? 'Yes' : 'No', inline: true },
    ],
  });
}

async function logEmojiUpdate(oldEmoji, newEmoji) {
  if (!newEmoji?.guild) return;

  const changes = [];
  let eventType = 'emoji.nameUpdate';

  if (oldEmoji.name !== newEmoji.name) {
    eventType = 'emoji.nameUpdate';
    changes.push(`Name: \`${oldEmoji.name || 'Unknown'}\` to \`${newEmoji.name || 'Unknown'}\``);
  }

  const oldRoles = [...(oldEmoji.roles?.cache?.keys?.() || [])].sort().join(',');
  const newRoles = [...(newEmoji.roles?.cache?.keys?.() || [])].sort().join(',');

  if (oldRoles !== newRoles) {
    eventType = eventType === 'emoji.nameUpdate' && changes.length ? eventType : 'emoji.rolesUpdate';
    changes.push('Role restrictions changed');
  }

  if (!changes.length) return;

  await loggingService.send(newEmoji.guild, eventType, {
    title: 'Emoji Updated',
    color: '#5865F2',
    fields: [
      { name: 'Emoji', value: emojiLabel(newEmoji), inline: false },
      { name: 'Changes', value: changes.join('\n').slice(0, 1024), inline: false },
      { name: 'Roles', value: roleList(newEmoji.roles), inline: false },
    ],
  });
}

module.exports = [
  { name: 'emojiCreate', async execute(emoji) { await logEmojiCreate(emoji); } },
  { name: 'emojiDelete', async execute(emoji) { await logEmojiDelete(emoji); } },
  { name: 'emojiUpdate', async execute(oldEmoji, newEmoji) { await logEmojiUpdate(oldEmoji, newEmoji); } },
];
