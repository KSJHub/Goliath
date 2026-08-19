'use strict';

const { MessageFlags } = require('discord.js');
const tempVoiceStore = require('./tempVoiceStore');
const tempVoiceRuntime = require('./tempVoiceManager');
const { PREFIX, isTempVoiceCustomId, buildControlRows, buildPanelContent } = require('./tempVoicePanel');

async function refreshControlMessage(interaction, tempChannel) {
  if (!interaction.message?.editable) return;
  await interaction.message.edit({
    content: buildPanelContent(tempChannel),
    components: buildControlRows(tempChannel.channelId, tempChannel),
  }).catch(() => null);
}

async function replyEphemeral(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => null);
  return interaction.reply(payload).catch(() => null);
}

async function handleTempVoiceInteraction(interaction) {
  if (!interaction?.isButton?.() || !isTempVoiceCustomId(interaction.customId)) return false;

  const [, action, channelId, value] = String(interaction.customId).split(':');
  const guild = interaction.guild;
  const actorId = interaction.user?.id;

  if (!guild?.id || !channelId || !actorId) {
    await replyEphemeral(interaction, '❌ Temp Voice context was not available.');
    return true;
  }

  if (!tempVoiceStore.isEnabled(guild.id)) {
    await replyEphemeral(interaction, '❌ Temp Voice is currently disabled for this server.');
    return true;
  }

  let tempChannel = tempVoiceStore.getTempChannel(guild.id, channelId);
  if (!tempChannel) {
    await replyEphemeral(interaction, '❌ This temporary voice channel is no longer tracked.');
    return true;
  }

  if (action === 'claim') {
    tempChannel = await tempVoiceRuntime.claimTempChannel(guild, channelId, actorId);
    await refreshControlMessage(interaction, tempChannel);
    await replyEphemeral(interaction, '✅ Channel ownership claimed.');
    return true;
  }

  if (action === 'lock') {
    tempChannel = await tempVoiceRuntime.updateTempChannelControls(guild, channelId, actorId, { locked: !tempChannel.locked });
    await refreshControlMessage(interaction, tempChannel);
    await replyEphemeral(interaction, tempChannel.locked ? '✅ Channel locked.' : '✅ Channel unlocked.');
    return true;
  }

  if (action === 'hide') {
    tempChannel = await tempVoiceRuntime.updateTempChannelControls(guild, channelId, actorId, { hidden: !tempChannel.hidden });
    await refreshControlMessage(interaction, tempChannel);
    await replyEphemeral(interaction, tempChannel.hidden ? '✅ Channel hidden.' : '✅ Channel visible.');
    return true;
  }

  if (action === 'limit') {
    const parsedLimit = Number(value);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 0 || parsedLimit > 99) {
      await replyEphemeral(interaction, '❌ Invalid Temp Voice user limit.');
      return true;
    }
    const userLimit = parsedLimit;
    tempChannel = await tempVoiceRuntime.updateTempChannelControls(guild, channelId, actorId, { userLimit });
    await refreshControlMessage(interaction, tempChannel);
    await replyEphemeral(interaction, userLimit ? `✅ User limit set to ${userLimit}.` : '✅ User limit removed.');
    return true;
  }

  await replyEphemeral(interaction, '❌ Unknown Temp Voice action.');
  return true;
}

module.exports = {
  PREFIX,
  isTempVoiceCustomId,
  handleTempVoiceInteraction,
};