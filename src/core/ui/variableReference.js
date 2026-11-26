'use strict';
const { EmbedBuilder, ButtonStyle } = require('discord.js');
const { navigationButton } = require('../guild/goliathNavigation');
const { emojiLabel } = require('./emojis');
const guildVariables = require('../guild/guildVariables');

function variablesButton(customId) {
  return navigationButton(customId, emojiLabel('VARIABLES', 'Variables'), ButtonStyle.Secondary);
}

function variableReference(moduleName, { title = 'Message Variables', tokens, note = 'Availability depends on the message context.' } = {}) {
  const source = tokens ?? guildVariables.variablesForModule(moduleName);
  const list = [...new Set(source.filter(token => typeof token === 'string' && /^\{[a-zA-Z][a-zA-Z0-9_.-]*\}$/.test(token)))].sort();
  const chunks = [];
  let chunk = '';
  for (const token of list) {
    if (chunk.length + token.length + 1 > 950) { chunks.push(chunk); chunk = ''; }
    chunk += (chunk ? '\n' : '') + token;
  }
  if (chunk) chunks.push(chunk);
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(title).setDescription('Copy a variable including its braces into your message.\n' + note + (chunks.length > 4 ? '\nThe attached file contains the complete list.' : ''));
  for (const [index, value] of chunks.slice(0, 4).entries()) embed.addFields({ name: 'Variables ' + (index + 1), value: '\x60\x60\x60\n' + value + '\n\x60\x60\x60' });
  return { embeds: [embed], files: [{ attachment: Buffer.from(list.join('\n'), 'utf8'), name: 'message-variables.txt' }], flags: 64, allowedMentions: { parse: [] } };
}
module.exports = { variablesButton, variableReference };
