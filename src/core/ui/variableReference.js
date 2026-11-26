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
  const list = [...new Set((Array.isArray(source) ? source : []).filter(token => typeof token === 'string' && token.length <= 128 && /^\{(?:[a-zA-Z][a-zA-Z0-9_.-]*|[0-9]+)\}$/.test(token)))].sort();
  const chunks = [];
  let chunk = '';
  for (const token of list) {
    if (chunk.length + token.length + 1 > 950) { chunks.push(chunk); chunk = ''; }
    chunk += (chunk ? '\n' : '') + token;
  }
  if (chunk) chunks.push(chunk);
  if (!list.length) chunks.push('No variables available for this context.');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(String(title || 'Message Variables').slice(0, 256)).setDescription('Copy a variable including its braces into your message.\n' + String(note || '').slice(0, 1000) + (chunks.length > 4 ? '\nThe attached file contains the complete list.' : ''));
  for (const [index, value] of chunks.slice(0, 4).entries()) embed.addFields({ name: 'Variables ' + (index + 1), value: '\x60\x60\x60\n' + value + '\n\x60\x60\x60' });
  const examples = list.filter(token => guildVariables.variableExample(token)).slice(0, 5).map(token => '\x60'+token+'\x60 — '+guildVariables.variableExample(token));
  if (examples.length) embed.addFields({name:'Examples',value:examples.join('\n')});
  return { embeds: [embed], files: [{ attachment: Buffer.from(list.join('\n'), 'utf8'), name: 'message-variables.txt' }], flags: 64, allowedMentions: { parse: [] } };
}
module.exports = { variablesButton, variableReference };
