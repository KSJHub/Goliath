'use strict';

const moduleAdminPanels = require('./moduleAdminPanels');

function isAdminModuleInteraction(interaction) {
  const customId = String(interaction?.customId || '');
  return customId === 'admin:modules'
    || customId.startsWith('admin:modules:page:')
    || customId.startsWith('admin:module:');
}

async function handleAdminModuleInteraction(interaction) {
  if (!interaction?.guildId || !isAdminModuleInteraction(interaction)) return false;
  return moduleAdminPanels.handleModuleAdminInteraction(interaction);
}

module.exports = {
  isAdminModuleInteraction,
  handleAdminModuleInteraction,
};
