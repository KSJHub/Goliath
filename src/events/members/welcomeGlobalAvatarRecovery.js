'use strict';

const welcomeManager = require('../../modules/welcome/welcome');
const welcomeAvatarSync = require('../../modules/welcome/welcomeAvatarSync');

function globalAvatarUrl(user) {
  return user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
}

async function recoverGlobalAvatar(oldUser, newUser) {
  if (!oldUser?.id || !newUser?.id || oldUser.avatar === newUser.avatar) return;

  const previous = globalAvatarUrl(oldUser);
  const next = globalAvatarUrl(newUser);
  if (!next || previous === next) return;

  for (const guild of newUser.client.guilds.cache.values()) {
    const config = welcomeManager.getWelcomeSection(guild.id);
    if (!config.channelId) continue;

    const channel = guild.channels.cache.get(config.channelId)
      || await guild.channels.fetch(config.channelId).catch(() => null);
    if (!channel?.messages?.fetch) continue;

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) continue;

    const botId = newUser.client.user?.id;
    const username = String(newUser.username || '').toLowerCase();
    const candidates = [...messages.values()]
      .filter((message) => message.author?.id === botId)
      .filter((message) => {
        const haystack = `${message.content || ''} ${JSON.stringify(message.embeds?.map((embed) => embed.toJSON?.() || embed) || [])}`.toLowerCase();
        return haystack.includes(newUser.id) || (username && haystack.includes(`@${username}`));
      })
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    for (const message of candidates) {
      let changed = false;
      const embeds = message.embeds.map((embed) => {
        const result = welcomeAvatarSync.replaceAvatarUrls(embed, newUser.id, previous, next);
        changed ||= result.changed;
        return result.data;
      });
      if (!changed) continue;

      const edited = await message.edit({ embeds }).then(() => true).catch((error) => {
        console.warn('[Welcome] Global avatar recovery edit failed:', error.message || error);
        return false;
      });
      if (!edited) continue;

      await welcomeAvatarSync.trackLatestWelcomeMessage(
        guild.members.cache.get(newUser.id) || await guild.members.fetch(newUser.id).catch(() => null),
        welcomeManager,
        message.createdTimestamp
      ).catch(() => null);

      console.info(`[Welcome] Recovered global avatar sync for ${newUser.id} in ${guild.id} on message ${message.id}.`);
      break;
    }
  }
}

module.exports = {
  name: 'userUpdate',
  async execute(oldUser, newUser) {
    await recoverGlobalAvatar(oldUser, newUser).catch((error) => {
      console.warn('[Welcome] Global avatar recovery failed:', error.message || error);
    });
  },
};
