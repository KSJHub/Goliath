'use strict';

const timedRoles = require('../../modules/timedroles/timedRoles');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    const section = timedRoles.getSection(member.guild.id);
    if (section.enabled === false || (member.user?.bot && section.settings.includeBots !== true)) return;
    await timedRoles.applyProgressionToMember(member, section).catch((error) => {
      console.warn(`[TimedRoles] Member join progression failed for ${member.id} in ${member.guild.id}: ${error.message}`);
    });
  },
};