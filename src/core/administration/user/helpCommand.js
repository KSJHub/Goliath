'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { enforceCommandAccess } = require('../../commands/commandAccess');
const { showHelp } = require('./utilities');

module.exports = {
  category: 'Utility',
  help: {
    name: 'help',
    description: 'Find Goliath features and commands.',
    usage: '/help',
  },
  access: { ownerOnly: false },
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Find Goliath features and commands')
    .setDMPermission(false),

  async execute(interaction) {
    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;
    return showHelp(interaction, { standalone: true });
  },
};
