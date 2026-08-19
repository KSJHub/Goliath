'use strict';

const guildManager = require('../../core/guild/guildManager');
const timedRoles = require('../../modules/roleStudio/timedRoles/timedRoles');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (!guildManager.isModuleEnabled(member.guild.id, 'timedRoles')) return;
    const section = timedRoles.getSection(member.guild.id);
    if (member.user?.bot && section.settings.includeBots !== true) return;
    await timedRoles.applyProgressionToMember(member, section).catch((error) => {
      console.warn(`[TimedRoles] Member join progression failed for ${member.id} in ${member.guild.id}: ${error.message}`);
    });
  },
};