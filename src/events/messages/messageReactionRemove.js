'use strict';

const { handleReactionRemove } = require('../../modules/reactionroles/reactionRoles');
const { leaveGiveaway } = require('../../modules/giveaways/giveawayManager');
const { handleStarReactionRemove } = require('../../modules/starboard/starboardManager');
const { isModuleEnabled } = require('../../core/guild/guildManager');

async function getReactionGuildId(reaction) {
  if (reaction?.partial) await reaction.fetch().catch(() => null);
  if (reaction?.message?.partial) await reaction.message.fetch().catch(() => null);
  return reaction?.message?.guild?.id || null;
}

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user, client) {
    try {
      const guildId = await getReactionGuildId(reaction);
      await handleReactionRemove(reaction, user, client);
      if (isModuleEnabled(guildId, 'giveaways')) await leaveGiveaway(reaction, user, client);
      if (isModuleEnabled(guildId, 'starboard')) await handleStarReactionRemove(reaction, user, client);
    } catch (error) {
      console.error('[EVENT: messageReactionRemove]', error);
    }
  },
};
