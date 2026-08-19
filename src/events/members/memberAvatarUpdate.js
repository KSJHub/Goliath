'use strict';

const welcomeManager = require('../../modules/messageStudio/welcome/welcome');
const welcomeAvatarSync = require('../../modules/messageStudio/welcome/welcomeAvatarSync');

module.exports = [
  {
    name: 'userUpdate',
    async execute(oldUser, newUser) {
      await welcomeAvatarSync
        .handleUserAvatarUpdate(oldUser, newUser, welcomeManager)
        .catch((error) => {
          console.warn('[Welcome] Failed to process global avatar update:', error.message || error);
        });
    },
  },
  {
    name: 'guildMemberUpdate',
    async execute(oldMember, newMember) {
      await welcomeAvatarSync
        .handleGuildMemberAvatarUpdate(oldMember, newMember, welcomeManager)
        .catch((error) => {
          console.warn('[Welcome] Failed to process server avatar update:', error.message || error);
        });
    },
  },
];
