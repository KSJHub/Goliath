'use strict';

const { handleReactionRemove } = require('../../modules/roleStudio/reactionRoles/reactionRoles');
const { leaveGiveawayReaction } = require('../../modules/communityStudio/giveaways/giveawaysManager');
const giveawaysStore = require('../../modules/communityStudio/giveaways/giveawaysStore');
const { handleStarReactionRemove } = require('../../modules/messageStudio/starboard/starboard');
const starboardStore = require('../../modules/messageStudio/starboard/starboardStore');
const { isModuleEnabled } = require('../../core/guild/guildManager');

async function getReactionGuildId(reaction) {
  if (reaction?.partial) await reaction.fetch().catch(() => null);
  if (reaction?.message?.partial) await reaction.message.fetch().catch(() => null);
  return reaction?.message?.guild?.id || null;
}

async function runHandler(label, handler) {
  try {
    await handler();
  } catch (error) {
    console.error(`[EVENT: messageReactionRemove] ${label} failed:`, error);
  }
}

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user, client) {
    const guildId = await getReactionGuildId(reaction).catch((error) => {
      console.error('[EVENT: messageReactionRemove] Failed to resolve guild:', error);
      return null;
    });

    if (!guildId) return;

    if (isModuleEnabled(guildId, 'reactionRoles')) {
      await runHandler('Reaction Roles', () => handleReactionRemove(reaction, user, client));
    }
    if (giveawaysStore.isEnabled(guildId)) {
      await runHandler('Giveaways', () => leaveGiveawayReaction(reaction, user));
    }
    if (starboardStore.isEnabled(guildId)) {
      await runHandler('Starboard', () => handleStarReactionRemove(reaction, user));
    }
  },
};
