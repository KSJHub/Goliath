const handlerModule = require('../../core/security/protection/system');

module.exports = {
  name: 'guildUpdate',

  async execute(oldGuild, newGuild) {
    try {
      const handler = handlerModule.handleGuildUpdate;

      if (typeof handler !== 'function') {
        return;
      }

      await handler(oldGuild, newGuild);
    } catch (error) {
      console.error('[guildUpdate] Failed to process guild update:', error);
    }
  },
};
