'use strict';

const fs = require('node:fs');
const path = require('node:path');

process.chdir(path.resolve(__dirname, '..'));
require('../src/config/envLoader').loadEnvironment('dev');

const { resolveTokenDetails } = require('../src/config/tokenResolver');
const { REST, Routes } = require('discord.js');

async function main() {
  if (process.stdin.isTTY) {
    throw new Error('Supply the summary through standard input.');
  }

  const summary = fs.readFileSync(0, 'utf8').trim();
  if (!summary) throw new Error('Summary is empty.');
  if (summary.length > 4096) {
    throw new Error('Summary exceeds the 4,096-character embed limit. Nothing posted.');
  }

  const { token } = resolveTokenDetails({ mode: 'DEV' });
  if (!token) throw new Error('DEV bot token is missing.');

  const channelId = '1561885763652685896';
  const guildId = '1515201360386068642';
  const rest = new REST({ version: '10' }).setToken(token);
  const channel = await rest.get(Routes.channel(channelId));

  if (channel.guild_id !== guildId) {
    throw new Error('Destination does not match KSJ Development.');
  }


  const guild = await rest.get(Routes.guild(channel.guild_id));
  const bot = await rest.get(Routes.user('@me'));

  const guildIcon = guild.icon
    ? 'https://cdn.discordapp.com/icons/' + guild.id + '/' + guild.icon + '.png?size=256'
    : null;
  const botAvatar = bot.avatar
    ? 'https://cdn.discordapp.com/avatars/' + bot.id + '/' + bot.avatar + '.png?size=128'
    : null;

  const labels = {
    completed: '✅ Completed',
    'key decisions': '📌 Key Decisions',
    decisions: '📌 Key Decisions',
    'blockers and unfinished work': '🚧 Blockers & Unfinished Work',
    blockers: '🚧 Blockers',
    'in progress': '🔧 In Progress',
    'next priorities': '🎯 Next Priorities'
  };

  const reportFields = [];
  const intro = [];
  let section = null;

  for (const line of summary.split(/\r?\n/)) {
    const heading = line.trim().match(/^\*\*(.+?)\*\*$/);
    const label = heading && labels[heading[1].trim().toLowerCase()];

    if (label) {
      section = { name: label, lines: [] };
      reportFields.push(section);
    } else if (section) {
      section.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  const fields = reportFields.map(section => ({
    name: section.name,
    value: section.lines.join('\n').trim() || 'No update recorded.',
    inline: false
  }));

  if (fields.length > 25 || fields.some(field => field.value.length > 1024)) {
    throw new Error('A report section exceeds Discord field limits. Nothing posted.');
  }

  const embed = {
    author: {
      name: guild.name,
      ...(botAvatar ? { icon_url: botAvatar } : {})
    },
    title: 'Weekly Development Update',
    description: intro.join('\n').trim() || 'KSJ Goliath development progress and priorities.',
    color: 0x004CFF,
    ...(guildIcon ? { thumbnail: { url: guildIcon } } : {}),
    fields,
    footer: { text: 'KSJ Development • Goliath' },
    timestamp: new Date().toISOString()
  };

  const embedLength = embed.title.length + embed.description.length
    + embed.author.name.length + embed.footer.text.length
    + fields.reduce((total, field) => total + field.name.length + field.value.length, 0);

  if (embedLength > 6000) {
    throw new Error('Report exceeds Discord embed limits. Nothing posted.');
  }


  const messageId = process.argv[2];
  if (messageId && !/^\d{17,20}$/.test(messageId)) {
    throw new Error('Invalid message ID. Nothing changed.');
  }

  if (messageId) {
    const existing = await rest.get(Routes.channelMessage(channelId, messageId));
    if (existing.author.id !== bot.id) {
      throw new Error('That message belongs to another account. Nothing changed.');
    }
  }

  const endpoint = messageId
    ? Routes.channelMessage(channelId, messageId)
    : Routes.channelMessages(channelId);
  const method = messageId ? 'patch' : 'post';

  const message = await rest[method](endpoint, {

    body: {
      embeds: [embed],
      allowed_mentions: { parse: [] }
    }
  });

  console.log(`✅ Posted: https://discord.com/channels/${guildId}/${channelId}/${message.id}`);
}

main().catch(error => {
  console.error(`❌ Summary delivery failed: ${error.message}`);
  process.exitCode = 1;
});
