'use strict';

// Compatibility wrapper around the Private Rooms panel.
// Staff can create a room with no manually selected participants; when the
// wizard is submitted empty, the creator is injected into the existing staff
// session before the original handler runs. Existing participant selections
// are left untouched.
const base = require('./privateRoomsPanel.base');
const rooms = require('./privateRooms');
const { buildPrivateRoomDecisionNotice } = require('../../../core/ui/systemNotices');

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

function decisionContext(interaction) {
  const id = String(interaction?.customId || '');
  const match = id.match(/^privateRooms:request:(approve|deny-submit):([^:]+)$/);
  if (!match || !interaction?.guildId) return null;
  const request = rooms.getRequest(interaction.guildId, match[2]);
  if (!request?.requesterId) return null;
  return { action: match[1], requestId: match[2], requesterId: request.requesterId };
}

async function withUniversalDecisionDm(interaction, work) {
  const context = decisionContext(interaction);
  if (!context || !interaction?.guild) return work();

  const requester = await interaction.guild.members.fetch(context.requesterId).catch(() => null);
  if (!requester?.user?.send) return work();

  const originalSend = requester.user.send;
  requester.user.send = async function privateRoomUniversalDm(payload) {
    const legacy = typeof payload === 'string'
      && (payload.startsWith('✅ Your Private Room request was approved')
        || payload.startsWith('❌ Your Private Room request in'));
    if (!legacy) return originalSend.call(this, payload);

    const request = rooms.getRequest(interaction.guildId, context.requestId) || {};
    const approved = context.action === 'approve';
    const room = request.roomId ? rooms.getRoom(interaction.guildId, request.roomId) : null;
    const notice = buildPrivateRoomDecisionNotice({
      guild: interaction.guild,
      member: requester,
      request,
      room,
      approved,
      reviewer: interaction.user?.id ? `<@${interaction.user.id}>` : 'Management',
    });
    return originalSend.call(this, notice);
  };

  try {
    return await work();
  } finally {
    requester.user.send = originalSend;
  }
}

async function handleInteraction(interaction) {
  if (shouldPrimeCreator(interaction)) await primeCreatorAsParticipant(interaction);
  return withUniversalDecisionDm(interaction, () => base.handleInteraction(interaction));
}

module.exports = {
  ...base,
  handleInteraction,
};
