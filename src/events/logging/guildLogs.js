const loggingService = require('../../core/logging/service');

function changed(oldValue, newValue) {
  return oldValue !== newValue;
}

async function logGuildUpdate(oldGuild, newGuild) {
  if (!newGuild?.id) return;

  const changes = [];
  let eventType = 'guild.nameUpdate';

  if (changed(oldGuild.name, newGuild.name)) {
    eventType = 'guild.nameUpdate';
    changes.push(`Name: \`${oldGuild.name}\` to \`${newGuild.name}\``);
  }

  if (changed(oldGuild.icon, newGuild.icon)) {
    eventType = changes.length ? eventType : 'guild.iconUpdate';
    changes.push('Icon changed');
  }

  if (changed(oldGuild.banner, newGuild.banner)) {
    eventType = changes.length ? eventType : 'guild.bannerUpdate';
    changes.push('Banner changed');
  }

  if (changed(oldGuild.ownerId, newGuild.ownerId)) {
    eventType = changes.length ? eventType : 'guild.ownerUpdate';
    changes.push(`Owner: \`${oldGuild.ownerId || 'Unknown'}\` to \`${newGuild.ownerId || 'Unknown'}\``);
  }

  if (changed(oldGuild.verificationLevel, newGuild.verificationLevel)) {
    eventType = changes.length ? eventType : 'guild.verificationLevelUpdate';
    changes.push(`Verification Level: \`${oldGuild.verificationLevel}\` to \`${newGuild.verificationLevel}\``);
  }

  if (changed(oldGuild.premiumTier, newGuild.premiumTier) || changed(oldGuild.premiumSubscriptionCount, newGuild.premiumSubscriptionCount)) {
    eventType = changes.length ? eventType : 'guild.boostUpdate';
    changes.push(`Boosts: \`${oldGuild.premiumSubscriptionCount || 0}\` to \`${newGuild.premiumSubscriptionCount || 0}\``);
    changes.push(`Boost Tier: \`${oldGuild.premiumTier}\` to \`${newGuild.premiumTier}\``);
  }

  if (!changes.length) return;

  await loggingService.send(newGuild, eventType, {
    title: 'Server Updated',
    color: '#5865F2',
    fields: [
      { name: 'Server', value: `\`${newGuild.name}\``, inline: true },
      { name: 'Server ID', value: `\`${newGuild.id}\``, inline: true },
      { name: 'Changes', value: changes.join('\n').slice(0, 1024), inline: false },
    ],
  });
}

module.exports = {
  name: 'guildUpdate',
  async execute(oldGuild, newGuild) {
    await logGuildUpdate(oldGuild, newGuild);
  },
};
