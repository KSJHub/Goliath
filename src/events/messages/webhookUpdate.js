// src/events/messages/webhookUpdate.js

const guildManager = require('../../core/guild/guildManager');
const {
  handleWebhookUpdate,
} = require('../../core/security/antiNukeManager');

module.exports = {
  name: 'webhookUpdate',

  async execute(channel) {
    if (!channel?.guild) return;
    if (!guildManager.isModuleEnabled(channel.guild.id, 'security')) return;

    try {
      await handleWebhookUpdate(channel);
    } catch (error) {
      console.error(
        '[WebhookUpdate] Failed to process webhook update:',
        error
      );
    }
  },
};
