'use strict';
const { navigationButton } = require('../../../core/guild/goliathNavigation');

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
      navigationButton(`${PREFIX}claim:${channelId}`, 'Claim', ButtonStyle.Success),
      navigationButton(`${PREFIX}lock:${channelId}`, locked ? 'Unlock' : 'Lock', ButtonStyle.Secondary),
      navigationButton(`${PREFIX}hide:${channelId}`, hidden ? 'Show' : 'Hide', ButtonStyle.Secondary),
      navigationButton(`${PREFIX}limit:${channelId}:0`, 'No Limit', ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      navigationButton(`${PREFIX}limit:${channelId}:2`, 'Limit 2', ButtonStyle.Secondary),
      navigationButton(`${PREFIX}limit:${channelId}:5`, 'Limit 5', ButtonStyle.Secondary),
      navigationButton(`${PREFIX}limit:${channelId}:10`, 'Limit 10', ButtonStyle.Secondary)
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
