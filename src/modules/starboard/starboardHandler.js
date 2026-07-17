'use strict';

const { ModalBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const {
  cleanDiscordId,
  getModalValue,
  modalInput,
  numberOr,
  showModalSafe,
  updateOrReply,
} = require('../../core/admin/functions/handlers/adminHandlerUtils');
const { buildStarboardPayload } = require('../../core/admin/functions/adminRegisteredModulePayloads');

function buildStarboardConfigModal() {
  return new ModalBuilder()
    .setCustomId('starboard:configureModal')
    .setTitle('Configure Starboard')
    .addComponents(
      modalInput('channelId', 'Starboard channel ID / mention', TextInputStyle.Short, { placeholder: '#starboard or channel ID', maxLength: 40 }),
      modalInput('threshold', 'Star threshold', TextInputStyle.Short, { placeholder: '3', value: '3', maxLength: 3 }),
      modalInput('emoji', 'Emoji', TextInputStyle.Short, { placeholder: '⭐', value: '⭐', required: false, maxLength: 40 })
    );
}

async function handleStarboardConfigureButton(interaction) {
  return showModalSafe(interaction, buildStarboardConfigModal());
}

async function handleStarboardConfigModal(interaction) {
  const starboardManager = require('./starboardManager');
  const channelId = cleanDiscordId(getModalValue(interaction, 'channelId'));
  if (!channelId) {
    await updateOrReply(interaction, { content: '❌ Please provide a valid starboard channel ID or mention.', flags: MessageFlags.Ephemeral });
    return true;
  }
  starboardManager.configureStarboard(interaction.guildId, {
    enabled: true,
    channelId,
    threshold: numberOr(getModalValue(interaction, 'threshold'), 3, 1, 50),
    emoji: getModalValue(interaction, 'emoji', '⭐'),
  });
  await updateOrReply(interaction, buildStarboardPayload(interaction));
  return true;
}

module.exports = { buildStarboardConfigModal, handleStarboardConfigureButton, handleStarboardConfigModal };
