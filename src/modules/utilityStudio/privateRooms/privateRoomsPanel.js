'use strict';

// Compatibility wrapper around the Private Rooms panel.
// Staff can create a room with no manually selected participants; when the
// wizard is submitted empty, the creator is injected into the existing staff
// session before the original handler runs. Existing participant selections
// are left untouched.
const base = require('./privateRoomsPanel.base');

function shouldPrimeCreator(interaction) {
  if (String(interaction?.customId || '') !== 'privateRooms:wizard:submit:staff') return false;
  if (!interaction?.isButton?.()) return false;

  const description = String(interaction?.message?.embeds?.[0]?.description || '');
  return description.includes('`None selected`');
}

async function primeCreatorAsParticipant(interaction) {
  const creatorId = interaction?.user?.id;
  if (!creatorId) return;

  const syntheticSelect = new Proxy(interaction, {
    get(target, property) {
      if (property === 'customId') return 'privateRooms:wizard:participants:staff';
      if (property === 'values') return [creatorId];
      if (property === 'isUserSelectMenu') return () => true;
      if (property === 'isAnySelectMenu') return () => true;
      if (property === 'isButton') return () => false;
      if (property === 'update') return async () => true;
      return Reflect.get(target, property, target);
    },
  });

  await base.handleInteraction(syntheticSelect);
}

async function handleInteraction(interaction) {
  if (shouldPrimeCreator(interaction)) await primeCreatorAsParticipant(interaction);
  return base.handleInteraction(interaction);
}

module.exports = {
  ...base,
  handleInteraction,
};
