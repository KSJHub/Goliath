'use strict';

const welcomeManager = require('../../modules/welcome/welcome');
const welcomeAvatarSync = require('../../modules/welcome/welcomeAvatarSync');

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    await welcomeAvatarSync
      .handleGuildMemberAvatarUpdate(oldMember, newMember, welcomeManager)
      .catch((error) => {
        console.warn('[Welcome] Failed to process server avatar update:', error.message || error);
      });
  },
};
