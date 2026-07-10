'use strict';

const { handleStickyMessage } = require('../../modules/sticky/stickyManager');
const { handlePrefixCommand } = require('../../features/prefix/prefixRouter');
const translationThreadManager = require('../../modules/translation/translationThreadManager');
const statsManager = require('../../modules/stats/statsManager');
const levelingManager = require('../../modules/leveling/levelingManager');

let runAutomod = async () => false;
try {
  const automodService = require('../../modules/automod/functions/service');
  if (typeof automodService?.runAutomod === 'function') runAutomod = automodService.runAutomod;
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  console.warn('[messageCreate] AutoMod service unavailable; continuing without AutoMod hook.');
}

module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    try {
      if (!message.guild || !message.member) return;
      if (!message.content || message.author?.bot) return;

      await runAutomod(message, client);
      await statsManager.handleMessageCreate(message);
      await levelingManager.handleMessageCreate(message);

      const handledPrefixCommand = await handlePrefixCommand(message, client);
      if (handledPrefixCommand) return;

      await translationThreadManager.handleMessageCreate(message, client);
      await handleStickyMessage(message, client);
    } catch (error) {
      console.error('[EVENT: messageCreate]', error);
    }
  },
};
