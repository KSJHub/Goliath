'use strict';

const panel = require('./reactionRolesPanelV7');

const replacements = [
  [/Role Studio Builder/g, 'Reaction Roles Builder'],
  [/Role Studio/g, 'Reaction Roles'],
  [/Exit Studio/g, 'Exit Reaction Roles'],
  [/Role Studio templates/g, 'Reaction Role templates'],
];

function replaceText(value) {
  if (typeof value !== 'string') return value;
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function transformValue(value) {
  if (typeof value === 'string') return replaceText(value);
  if (Array.isArray(value)) return value.map(transformValue);
  if (!value || typeof value !== 'object') return value;

  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, transformValue(item)]));
}

function transformPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return transformValue(payload);
}

async function buildReactionRolesAdminPanel(...args) {
  return transformPayload(await panel.buildReactionRolesAdminPanel(...args));
}

async function handleReactionRolesAdminInteraction(interaction) {
  const originalReply = interaction.reply?.bind(interaction);
  const originalUpdate = interaction.update?.bind(interaction);
  const originalEditReply = interaction.editReply?.bind(interaction);

  if (originalReply) interaction.reply = (payload) => originalReply(transformPayload(payload));
  if (originalUpdate) interaction.update = (payload) => originalUpdate(transformPayload(payload));
  if (originalEditReply) interaction.editReply = (payload) => originalEditReply(transformPayload(payload));

  try {
    return await panel.handleReactionRolesAdminInteraction(interaction);
  } finally {
    if (originalReply) interaction.reply = originalReply;
    if (originalUpdate) interaction.update = originalUpdate;
    if (originalEditReply) interaction.editReply = originalEditReply;
  }
}

module.exports = {
  buildReactionRolesAdminPanel,
  handleReactionRolesAdminInteraction,
};
