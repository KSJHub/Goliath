'use strict';

const welcomeManager = require('../../modules/welcome/welcome');
const welcomeAvatarSync = require('../../modules/welcome/welcomeAvatarSync');

function avatarUrl(member) {
  return member?.displayAvatarURL?.({ extension: 'png', size: 256 }) || '';
}

async function recoverAndSync(oldMember, newMember) {
  const guild = newMember?.guild;
  const userId = newMember?.user?.id;
  if (!guild?.id || !userId) return;

  const previous = avatarUrl(oldMember);
  const next = avatarUrl(newMember);
  if (!next || previous === next) return;

  const direct = await welcomeAvatarSync.syncTrackedWelcomeForGuild(
    guild,
    userId,
    next,
    welcomeManager
  );
  if (direct?.updated || direct?.removed) return;

  const config = welcomeManager.getWelcomeSection(guild.id);
  const channel = config.channelId
    ? (guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null))
    : null;
  if (!channel?.messages?.fetch) return;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages?.size) return;

  const botId = newMember.client?.user?.id;
  const username = String(newMember.user.username || '').toLowerCase();
  const candidates = [...messages.values()]
    .filter((message) => message.author?.id === botId)
    .filter((message) => {
      const haystack = `${message.content || ''} ${JSON.stringify(message.embeds?.map((embed) => embed.toJSON?.() || embed) || [])}`.toLowerCase();
      return haystack.includes(userId) || (username && haystack.includes(`@${username}`));
    })
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  for (const message of candidates) {
    let changed = false;
    const embeds = message.embeds.map((embed) => {
      const result = welcomeAvatarSync.replaceAvatarUrls(embed, userId, previous, next);
      changed ||= result.changed;
      return result.data;
    });
    if (!changed) continue;

    const edited = await message.edit({ embeds }).then(() => true).catch((error) => {
      console.warn('[Welcome] Avatar recovery edit failed:', error.message || error);
      return false;
    });
    if (!edited) continue;

    await welcomeAvatarSync.trackLatestWelcomeMessage(newMember, welcomeManager, message.createdTimestamp)
      .catch(() => null);
    console.info(`[Welcome] Recovered avatar sync for ${userId} in ${guild.id} on message ${message.id}.`);
    return;
  }
}

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    await recoverAndSync(oldMember, newMember).catch((error) => {
      console.warn('[Welcome] Avatar recovery failed:', error.message || error);
    });
  },
};
