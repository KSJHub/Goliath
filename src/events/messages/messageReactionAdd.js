'use strict';

const { handleReactionAdd } = require('../../modules/reactionroles/reactionRoles');
const { enterGiveaway } = require('../../modules/giveaways/giveawayManager');
const { handleStarReactionAdd } = require('../../modules/starboard/starboardManager');
const { isModuleEnabled } = require('../../core/guild/guildManager');

async function getReactionGuildId(reaction) {
  if (reaction?.partial) await reaction.fetch().catch(() => null);
  if (reaction?.message?.partial) await reaction.message.fetch().catch(() => null);
  return reaction?.message?.guild?.id || null;
}

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user, client) {
    try {
      const guildId = await getReactionGuildId(reaction);
      await handleReactionAdd(reaction, user, client);
      if (isModuleEnabled(guildId, 'giveaways')) await enterGiveaway(reaction, user, client);
      if (isModuleEnabled(guildId, 'starboard')) await handleStarReactionAdd(reaction, user, client);
    } catch (error) {
      console.error('[EVENT: messageReactionAdd]', error);
    }
  },
};
