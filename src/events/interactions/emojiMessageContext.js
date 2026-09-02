'use strict';

const { Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction?.isMessageContextMenuCommand?.()) return;
    if (interaction.commandName !== 'Convert Emoji Shortcodes') return;
    const command = client.commands?.get?.(interaction.commandName);
    if (!command?.execute) return;
    await command.execute(interaction, client);
  },
};
