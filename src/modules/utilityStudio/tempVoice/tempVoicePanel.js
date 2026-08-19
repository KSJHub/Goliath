'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PREFIX = 'tempvoice:';

function isTempVoiceCustomId(customId = '') {
  return String(customId || '').startsWith(PREFIX);
}

function buildControlRows(channelId, tempChannel = {}) {
  const locked = tempChannel.locked === true;
  const hidden = tempChannel.hidden === true;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}claim:${channelId}`).setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}lock:${channelId}`).setLabel(locked ? 'Unlock' : 'Lock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}hide:${channelId}`).setLabel(hidden ? 'Show' : 'Hide').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}limit:${channelId}:0`).setLabel('No Limit').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}limit:${channelId}:2`).setLabel('Limit 2').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}limit:${channelId}:5`).setLabel('Limit 5').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}limit:${channelId}:10`).setLabel('Limit 10').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildPanelContent(tempChannel = {}) {
  return [
    '🎙️ **Temp Voice Controls**',
    `Owner: <@${tempChannel.ownerId}>`,
    `State: ${tempChannel.locked ? 'Locked' : 'Unlocked'} · ${tempChannel.hidden ? 'Hidden' : 'Visible'} · Limit: ${tempChannel.userLimit || 'None'}`,
    '',
    'Use these buttons to manage this temporary voice channel.',
  ].join('\n');
}

module.exports = {
  PREFIX,
  isTempVoiceCustomId,
  buildControlRows,
  buildPanelContent,
};
