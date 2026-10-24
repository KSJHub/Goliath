'use strict';
const { createHash } = require('node:crypto');
const { PermissionFlagsBits: P } = require('discord.js');
const store = require('./freeGames');
const providers = require('./freeGamesProviders');
const { buildListing, SECTIONS, line } = require('./freeGamesEmbeds');
const locks = new Map();
const timers = new WeakMap();
const TICK_MS = 5 * 60_000;
function withGuildLock(guildId, task) {
  const previous = locks.get(guildId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(guildId, next);
  return next.finally(() => { if (locks.get(guildId) === next) locks.delete(guildId); });
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
async function fetchMessage(channel, id) {
  if (!id) return null;
  try { return await channel.messages.fetch(id); } catch (error) { if (error.code === 10008) return null; throw error; }
}
async function validateDestination(guild, config) {
  const channel = await guild.channels.fetch(config.channelId);
  if (!channel || ![0, 5].includes(channel.type)) throw new Error('Choose a text or announcement channel in this server.');
  const me = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);
  if (![P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory].every((permission) => permissions?.has(permission))) throw new Error('Free Games needs View Channel, Send Messages, Embed Links and Read Message History in the destination.');
  if (config.alerts && config.roleId) {
    const role = await guild.roles.fetch(config.roleId);
    if (!role || role.id === guild.id || role.managed) throw new Error('Choose a notification role other than @everyone or an integration role.');
    if (!role.mentionable && !permissions.has(P.MentionEveryone)) throw new Error('Make the notification role mentionable or allow the bot to mention it in this channel.');
  }
  return channel;
}
async function removeDelivery(guild, delivery) {
  let channel;
  try { channel = await guild.channels.fetch(delivery.channelId); } catch (error) { if (error.code === 10003) return; throw error; }
  if (!channel) return;
  const message = await fetchMessage(channel, delivery.messageId);
  if (message?.author?.id === guild.client.user.id) await message.delete();
}
async function processGuildUnlocked(guild) {
  let config = store.getConfig(guild.id);
  if (!config.enabled) return { skipped: true };
  store.update(guild.id, (current) => ({ ...current, state: { ...current.state, lastCheck: Date.now() } }));
  try {
    const feed = await providers.getOffers();
    const now = Date.now();
    const offers = store.filterOffers(feed.offers, config, now);
    const channel = await validateDestination(guild, config);
    const pricing = await providers.getPricing(config);
    const newSince = { ...config.state.newSince };
    const firstSeen = { ...config.state.firstSeen };
    const observed = { ...config.state.observed };
    const fresh = offers.filter((offer) => !observed[offer.id]);
    for (const offer of fresh) if (config.state.initialized) newSince[offer.id] = now;
    for (const id of Object.keys(newSince)) if (now - newSince[id] >= 24 * 3600000) delete newSince[id];
    for (const offer of feed.offers) { firstSeen[offer.id] ||= now; observed[offer.id] = now; }
    // Preserve deduplication across temporary feed omissions and restarts; bound old state.
    for (const id of Object.keys(observed)) if (now - observed[id] > 180 * 86400_000) { delete observed[id]; delete firstSeen[id]; }
    store.update(guild.id, (current) => ({ ...current, state: { ...current.state, firstSeen, newSince, observed, pricing, warning: pricing.warning || null } }));
    config = store.getConfig(guild.id);
    const pages = buildListing(offers, config, now);
    for (const delivery of [...config.state.retired]) {
      await removeDelivery(guild, delivery);
      store.update(guild.id, (current) => ({ ...current, state: { ...current.state, retired: current.state.retired.filter((item) => item.messageId !== delivery.messageId) } }));
    }
    for (let index = 0; index < pages.length; index++) {
      let delivery = store.getConfig(guild.id).state.deliveries[index];
      let message = await fetchMessage(channel, delivery?.messageId);
      if (message && message.author?.id !== guild.client.user.id) throw new Error('Stored listing is not owned by this bot.');
      if (!message) {
        // Recover a successful send whose ID was not persisted before a crash.
        const recent = await channel.messages.fetch({ limit: 100 });
        message = recent.find((item) => item.author?.id === guild.client.user.id && SECTIONS.some((section) => section.title === item.embeds?.[0]?.title) && item.embeds?.[0]?.footer?.text?.startsWith(`Goliath Free Games · ${index + 1}/`));
      }
      const fingerprint = hash(pages[index]);
      if (!message) message = await channel.send({ ...pages[index], nonce: hash([guild.id, channel.id, index, Math.floor(now / 300000)]).slice(0, 24), enforceNonce: true });
      else if (!delivery || delivery.fingerprint !== fingerprint || message.id !== delivery.messageId) await message.edit(pages[index]);
      delivery = { channelId: channel.id, messageId: message.id, fingerprint };
      store.update(guild.id, (current) => { const deliveries = [...current.state.deliveries]; deliveries[index] = delivery; return { ...current, state: { ...current.state, deliveries } }; });
    }
    for (const delivery of store.getConfig(guild.id).state.deliveries.slice(pages.length)) await removeDelivery(guild, delivery);
    store.update(guild.id, (current) => ({ ...current, state: { ...current.state, deliveries: current.state.deliveries.slice(0, pages.length), initialized: true, lastSuccess: now, error: null, offerCount: offers.length } }));
    // Reserve observations before sending. Ambiguous network failures are not retried/pinged again.
    if (config.state.initialized && config.alerts && fresh.length) {
      let description = '';
      let included = 0;
      for (const offer of fresh) {
        const entry = line(offer, newSince, now, config) + '\n';
        if (description.length + entry.length > 3300) break;
        description += entry; included++;
      }
      if (included < fresh.length) description += '\nSee the maintained listing for all offers.';
      description += '\n[Offers provided by GamerPower](https://www.gamerpower.com/)';
      if (pricing.mode === 'converted') description += `\n≈ Estimated ${pricing.currency} values from USD; rate dated ${pricing.date}. Regional prices may differ.`;
      else if (pricing.mode === 'source') description += '\nOriginal values supplied in USD.';
      const first = fresh[0];
      const detail = fresh.length === 1 && first.description ? first.description.slice(0, 400).replace(/@/g, '@\u200b') + '\n\n' : '';
      await channel.send({ components: [{ type: 1, components: fresh.slice(0, 5).map((offer, index) => ({ type: 2, style: 5, label: fresh.length === 1 ? 'View offer & claim' : `View offer ${index + 1}`, url: offer.url })) }], content: config.roleId ? `<@&${config.roleId}>` : '', embeds: [{ title: `🎁 ${fresh.length} new free offer${fresh.length === 1 ? '' : 's'}`, description: detail + description, ...(first.image ? { thumbnail: { url: first.image } } : {}), color: 0xfbbf24 }], allowedMentions: { parse: [], roles: config.roleId ? [config.roleId] : [] } });
    }
    return { offerCount: offers.length, pages: pages.length };
  } catch (error) {
    store.update(guild.id, (current) => ({ ...current, state: { ...current.state, error: String(error.message || error).slice(0, 400) } }));
    throw error;
  }
}
function processGuild(guild) { return withGuildLock(guild.id, () => processGuildUnlocked(guild)); }
function startup(client) {
  if (timers.has(client)) return timers.get(client);
  let running = false;
  const sweep = async () => {
    if (running || !client.isReady()) return;
    running = true;
    try {
      for (const guild of client.guilds.cache.values()) {
        if (!store.getConfig(guild.id).enabled) continue;
        await processGuild(guild).catch((error) => console.warn(`[Free Games] ${guild.id}: ${error.message}`));
      }
    } finally { running = false; }
  };
  const timer = setInterval(() => { void sweep().catch((error) => console.warn('[Free Games]', error.message)); }, TICK_MS);
  timer.unref?.(); timers.set(client, timer);
  void sweep().catch((error) => console.warn('[Free Games]', error.message));
  return timer;
}
function shutdown(client) { clearInterval(timers.get(client)); timers.delete(client); }
module.exports = { TICK_MS, withGuildLock, validateDestination, processGuild, startup, shutdown };
