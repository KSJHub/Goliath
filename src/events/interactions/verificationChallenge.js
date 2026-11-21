'use strict';

// Verification challenge interactions are handled by interactionCreate.js.
// Retain this existing event module as a compatibility shim, without registering
// a second responder for the same Discord interaction.
const { Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute() {
    return;
  },
};
