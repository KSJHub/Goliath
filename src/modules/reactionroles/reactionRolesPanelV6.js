'use strict';

require('./reactionRolesReliabilityPatch');

const panel = require('./reactionRolesPanelV5');

function stripEphemeral(payload = {}) {
  const next = { ...payload };
  delete next.ephemeral;
  return next;
}

async function handleReactionRolesAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:reactionRoles')) return false;

  const modalFromMessage = interaction.isModalSubmit?.()
    && (typeof interaction.isFromMessage !== 'function' || interaction.isFromMessage());

  if (!modalFromMessage) return panel.handleReactionRolesAdminInteraction(interaction);

  const originalReply = interaction.reply?.bind(interaction);
  const originalEditReply = interaction.editReply?.bind(interaction);

  interaction.reply = async (payload) => interaction.update(stripEphemeral(payload));
  interaction.editReply = async (payload) => {
    if (interaction.deferred || interaction.replied) return originalEditReply(stripEphemeral(payload));
    return interaction.update(stripEphemeral(payload));
  };

  try {
    return await panel.handleReactionRolesAdminInteraction(interaction);
  } finally {
    if (originalReply) interaction.reply = originalReply;
    if (originalEditReply) interaction.editReply = originalEditReply;
  }
}

module.exports = {
  buildReactionRolesAdminPanel: panel.buildReactionRolesAdminPanel,
  handleReactionRolesAdminInteraction,
};
