'use strict';
const { createHash } = require('node:crypto');
const { PermissionFlagsBits: P } = require('discord.js');
const store = require('./freeGames');
const providers = require('./freeGamesProviders');
const { buildListing, SECTIONS, line, loadPlatformPresentation } = require('./freeGamesEmbeds');
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
    const pages = buildListing(offers, { ...config, listingUpdatedAt: feed.fetchedAt }, now, await loadPlatformPresentation(guild.client, guild.id));
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
      const first = fresh[0];
      const detail = fresh.length === 1 && first.description ? first.description.slice(0, 400).replace(/@/g, '@\u200b') + '\n\n' : '';
      await channel.send({ components: [{ type: 1, components: fresh.slice(0, 5).map((offer, index) => ({ type: 2, style: 5, label: fresh.length === 1 ? 'View offer & claim' : `View offer ${index + 1}`, url: offer.url })) }], content: config.roleId ? `<@&${config.roleId}>` : '', embeds: [{ title: `🎁 ${fresh.length} new free offer${fresh.length === 1 ? '' : 's'}`, description: detail + description, ...(first.image ? { thumbnail: { url: first.image } } : {}), color: SECTIONS[0].color, footer: { text: 'Goliath Free Games · New offers' }, ...(config.showTimestamps === false ? {} : { timestamp: new Date(now).toISOString() }) }], allowedMentions: { parse: [], roles: config.roleId ? [config.roleId] : [] } });
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
        if (store.getGameUpdates(guild.id).enabled) await processGameUpdates(guild).catch(error => console.warn('[Games] Updates:', error.message));
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


function updateSubscriptionState(guildId, appId, fn) {
  return store.updateGameUpdates(guildId, current => {
    const subscription = current.subscriptions[appId];
    if (!subscription) throw new Error('Game subscription no longer exists.');
    return { ...current, subscriptions: { ...current.subscriptions, [appId]: fn(structuredClone(subscription)) } };
  });
}
function recordUpdateDelivery(guildId, appId, item, status, detail = '') {
  store.updateGameUpdates(guildId, current => ({ ...current, history: [{ appId, itemId: item.id, title: item.title, url: item.url, status, detail: String(detail).slice(0, 300), at: Date.now() }, ...current.history].slice(0, 100) }));
}
async function saveGameSubscription(guild, patch) {
  return withGuildLock(guild.id, async () => {
    const appId = providers.steamAppId(patch.appId), config = store.getGameUpdates(guild.id), previous = config.subscriptions[appId];
    if (!previous && Object.keys(config.subscriptions).length >= 50) throw new Error('A server can follow up to 50 games.');
    const next = store.normalizeUpdateSubscription({ ...patch, appId }, previous);
    if (previous && next.channelId !== previous.channelId && previous.pending.some(entry => entry.status !== 'pending')) throw new Error('Resolve held deliveries before changing the destination channel.');
    if (next.channelId) await validateDestination(guild, { ...next, alerts: Boolean(next.roleId) });
    if (next.roleId) {
      const role = await guild.roles.fetch(next.roleId);
      if (!role || role.id === guild.id || role.managed) throw new Error('Choose a regular notification role.');
    }
    const rebaseline = !previous || !previous.initialized || ['channelId', 'filter', 'includeWords', 'excludeWords'].some(key => JSON.stringify(next[key]) !== JSON.stringify(previous[key])) || (next.enabled && !previous.enabled);
    if (rebaseline) {
      const feed = await providers.getGameNews(appId);
      next.seenIds = feed.items.map(item => item.id);
      next.initialized = true; next.lastCheck = Date.now();
      // Configuration changes start from the next announcement. Preserve uncertain deliveries for review.
      next.pending = (previous?.pending || []).filter(entry => entry.status !== 'pending');
    }
    next.error = null;
    store.updateGameUpdates(guild.id, current => ({ ...current, subscriptions: { ...current.subscriptions, [appId]: next } }));
    return store.getGameUpdates(guild.id);
  });
}
async function configureGameUpdates(guild, patch) {
  return withGuildLock(guild.id, async () => store.updateGameUpdates(guild.id, current => store.validateUpdateSettings(patch, current)));
}
async function removeGameSubscription(guild, appId) {
  return withGuildLock(guild.id, async () => {
    appId = providers.steamAppId(appId);
    return store.updateGameUpdates(guild.id, current => { const subscriptions = { ...current.subscriptions }; delete subscriptions[appId]; return { ...current, subscriptions }; });
  });
}
function updatesQuietNow(config, timeZone, now = Date.now()) {
  if (!config.quietStart || !config.quietEnd) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const time = parts.find(part => part.type === 'hour').value + ':' + parts.find(part => part.type === 'minute').value;
  return config.quietStart < config.quietEnd ? time >= config.quietStart && time < config.quietEnd : time >= config.quietStart || time < config.quietEnd;
}
async function flushGameUpdates(guild, appId, manual = false, onlyIds = null) {
  let delivered = 0;
  const config = store.getGameUpdates(guild.id);
  if (!manual && updatesQuietNow(config, store.getConfig(guild.id).timeZone)) return { delivered, held: true };
  for (const entry of [...(config.subscriptions[appId]?.pending || [])].filter(entry => entry.status !== 'ambiguous' && (!onlyIds || onlyIds.has(entry.item.id))).slice(0, 5)) {
    if (entry.status === 'ambiguous') continue;
    const subscription = store.getGameUpdates(guild.id).subscriptions[appId];
    if (!subscription) break;
    const channel = await validateDestination(guild, { ...subscription, alerts: Boolean(subscription.roleId) && !entry.suppressMention });
    if (entry.status === 'dispatching') {
      const recent = await channel.messages.fetch({ limit: 100 });
      const recovered = recent.find(message => message.author?.id === guild.client.user.id && message.embeds?.some(embed => embed.url === entry.item.url && embed.footer?.text === 'Game Updates · Steam'));
      if (recovered) {
        updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.filter(record => record.item.id !== entry.item.id), lastSuccess: Date.now() }));
        recordUpdateDelivery(guild.id, appId, entry.item, 'recovered'); continue;
      }
      updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.map(record => record.item.id === entry.item.id ? { ...record, status: 'ambiguous' } : record), error: 'A delivery needs review. Inspect the channel before retrying held updates.' }));
      recordUpdateDelivery(guild.id, appId, entry.item, 'needs_review'); continue;
    }
    updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.map(record => record.item.id === entry.item.id ? { ...record, status: 'dispatching' } : record) }));
    try {
      const payload = require('./freeGamesEmbeds').buildGameUpdate(subscription, entry.item, { suppressMention: entry.suppressMention });
      await channel.send({ ...payload, nonce: hash(['game-update', guild.id, appId, entry.item.id]).slice(0, 24), enforceNonce: true });
      updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.filter(record => record.item.id !== entry.item.id), lastSuccess: Date.now(),
        error: current.pending.some(record => record.status === 'ambiguous') ? 'Some deliveries need review.' : null }));
      recordUpdateDelivery(guild.id, appId, entry.item, 'delivered'); delivered++;
    } catch (error) {
      const rejected = (error.status >= 400 && error.status < 500 && error.status !== 408) || [50013, 50001, 10003].includes(error.code);
      updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.map(record => record.item.id === entry.item.id ? { ...record, status: rejected ? 'pending' : 'ambiguous' } : record),
        error: rejected ? 'Delivery was refused. Check channel and role permissions.' : 'Delivery could not be confirmed. Inspect the channel before retrying held updates.' }));
      recordUpdateDelivery(guild.id, appId, entry.item, rejected ? 'failed' : 'needs_review', error.message);
      break;
    }
  }
  return { delivered };
}
async function processGameUpdatesUnlocked(guild) {
  const config = store.getGameUpdates(guild.id);
  if (!config.enabled) return { skipped: true, delivered: 0 };
  let delivered = 0;
  for (const appId of Object.keys(config.subscriptions)) {
    const subscription = store.getGameUpdates(guild.id).subscriptions[appId];
    if (!subscription?.enabled) continue;
    try {
      const feed = await providers.getGameNews(appId);
      const seen = new Set(subscription.seenIds || []);
      const fresh = subscription.initialized ? feed.items.filter(item => !seen.has(item.id) && store.matchesGameUpdate(item, subscription)).reverse() : [];
      const pending = [...subscription.pending];
      for (const item of fresh) if (!pending.some(entry => entry.item.id === item.id)) pending.push({ item, status: 'pending', suppressMention: false });
      if (pending.length > 100) throw new Error('Too many queued updates. Review the pending deliveries.');
      updateSubscriptionState(guild.id, appId, current => ({ ...current, initialized: true, pending,
        seenIds: [...new Set([...feed.items.map(item => item.id), ...current.seenIds])].slice(0, 500), lastCheck: Date.now() }));
      delivered += (await flushGameUpdates(guild, appId)).delivered;
    } catch (error) {
      updateSubscriptionState(guild.id, appId, current => ({ ...current, lastCheck: Date.now(), error: String(error.message).slice(0, 300) }));
    }
  }
  return { delivered };
}
function processGameUpdates(guild) { return withGuildLock(guild.id, () => processGameUpdatesUnlocked(guild)); }
async function previewGameUpdate(guild, appId) {
  appId = providers.steamAppId(appId);
  const subscription = store.getGameUpdates(guild.id).subscriptions[appId];
  if (!subscription) throw new Error('Choose a saved game subscription.');
  const feed = await providers.getGameNews(appId);
  const item = feed.items.find(item => store.matchesGameUpdate(item, subscription));
  if (!item) throw new Error('No matching publisher announcement is currently available.');
  return { item, payload: require('./freeGamesEmbeds').buildGameUpdate(subscription, item, { suppressMention: true }) };
}
async function sendLatestGameUpdate(guild, appId) {
  return withGuildLock(guild.id, async () => {
    const { item } = await previewGameUpdate(guild, appId);
    appId = providers.steamAppId(appId);
    const current = store.getGameUpdates(guild.id);
    if (current.history.some(record => record.appId === appId && record.itemId === item.id && ['delivered', 'recovered'].includes(record.status))) return { alreadyDelivered: true };
    if (current.subscriptions[appId].pending.some(entry => entry.item.id === item.id && entry.status !== 'pending')) throw new Error('This update has an unresolved delivery. Inspect the channel and use Retry held.');
    updateSubscriptionState(guild.id, appId, subscription => ({ ...subscription, pending: [{ item, status: 'pending', suppressMention: true }, ...subscription.pending.filter(entry => entry.item.id !== item.id)],
      seenIds: [...new Set([item.id, ...subscription.seenIds])].slice(0, 500) }));
    return flushGameUpdates(guild, appId, true, new Set([item.id]));
  });
}
async function retryHeldGameUpdates(guild, appId) {
  return withGuildLock(guild.id, async () => {
    appId = providers.steamAppId(appId);
    updateSubscriptionState(guild.id, appId, subscription => ({ ...subscription, pending: subscription.pending.map(entry => entry.status === 'ambiguous' ? { ...entry, status: 'dispatching', suppressMention: true, retryRequested: true } : entry) }));
    // Recheck uncertain sends before an explicit retry; never repeat role pings.
    const subscription = store.getGameUpdates(guild.id).subscriptions[appId];
    if (!subscription) throw new Error('Game subscription no longer exists.');
    const retryIds = new Set(subscription.pending.filter(entry => entry.retryRequested).map(entry => entry.item.id));
    const channel = await validateDestination(guild, { ...subscription, alerts: false });
    const recent = await channel.messages.fetch({ limit: 100 });
    for (const entry of subscription.pending.filter(entry => entry.retryRequested)) {
      const found = recent.find(message => message.author?.id === guild.client.user.id && message.embeds?.some(embed => embed.url === entry.item.url && embed.footer?.text === 'Game Updates · Steam'));
      if (found) {
        updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.filter(record => record.item.id !== entry.item.id), lastSuccess: Date.now() }));
        recordUpdateDelivery(guild.id, appId, entry.item, 'recovered');
      } else updateSubscriptionState(guild.id, appId, current => ({ ...current, pending: current.pending.map(record => record.item.id === entry.item.id ? { ...record, status: 'pending', suppressMention: true, retryRequested: false } : record) }));
    }
    return flushGameUpdates(guild, appId, true, retryIds);
  });
}
Object.assign(module.exports, { saveGameSubscription, configureGameUpdates, removeGameSubscription, updatesQuietNow,
  processGameUpdates, previewGameUpdate, sendLatestGameUpdate, retryHeldGameUpdates });
