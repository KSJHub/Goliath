const store = require('./invitesStore');

function getPanel(guildId) {
  const config = store.get(guildId);
  return {
    id: 'invites',
    title: 'Invites',
    description: 'Create one permanent guild invite and track which invite members use.',
    enabled: config.enabled,
    fields: {
      channelId: config.channelId,
      inviteUrl: config.inviteCode ? `https://discord.gg/${config.inviteCode}` : null,
      autoRepair: config.autoRepair,
      trackingEnabled: config.trackingEnabled,
      lastCheckedAt: config.lastCheckedAt || null,
    },
  };
}

module.exports = { getPanel };
