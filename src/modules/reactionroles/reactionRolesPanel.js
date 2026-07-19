'use strict';

require('../rolestudio/roleStudioNavigationPatch');
require('../rolestudio/roleStudioChildNavigationPatch');

const reactionPanel = require('./reactionRolesPanelV8');
const roleStudio = require('../rolestudio/roleStudioPanel');
const temporaryRolesPanel = require('../rolestudio/temporaryRolesPanel');

function displayName(interaction) {
  return interaction.member?.displayName || interaction.user?.username || 'Unknown User';
}

async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) return interaction.update(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

async function buildReactionRolesAdminPanel(guild, memberDisplayName = 'Unknown User') {
  return roleStudio.buildRoleStudioPanel(guild, memberDisplayName);
}

async function handleReactionRolesAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:reactionRoles')) return false;

  if (id === 'admin:reactionRoles') {
    return respond(interaction, await roleStudio.buildRoleStudioPanel(interaction.guild, displayName(interaction)));
  }

  if (id === 'admin:reactionRoles:open') {
    interaction.customId = 'admin:reactionRoles';
    return reactionPanel.handleReactionRolesAdminInteraction(interaction);
  }

  if (id === 'admin:reactionRoles:analytics') {
    return respond(interaction, await roleStudio.buildRoleAnalyticsPanel(interaction.guild, displayName(interaction)));
  }

  if (id === 'admin:reactionRoles:health') {
    return respond(interaction, await roleStudio.buildRoleHealthPanel(interaction.guild, displayName(interaction)));
  }

  if (id.startsWith(temporaryRolesPanel.PREFIX)) {
    return temporaryRolesPanel.handleTemporaryRolesInteraction(interaction);
  }

  return reactionPanel.handleReactionRolesAdminInteraction(interaction);
}

module.exports = {
  buildReactionRolesAdminPanel,
  handleReactionRolesAdminInteraction,
};