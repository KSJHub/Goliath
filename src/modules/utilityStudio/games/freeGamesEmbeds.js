'use strict';
const { STORES, TYPES, safeUrl } = require('./freeGamesProviders');
const NEW_MS = 24 * 3600_000;
const ENDING_MS = 48 * 3600_000;
const SECTIONS = [
  { title: '🎁 Free Games', types: ['game'], color: 0xfbbf24 },
  { title: '🧩 Free DLC & Add-ons', types: ['dlc'], color: 0xa78bfa },
  { title: '🎮 Loot, Betas & Other Offers', types: ['loot', 'beta', 'demo', 'weekend'], color: 0x38bdf8 },
];
function escape(value) { return String(value).replace(/[\\`*_{}\[\]()<>~|]/g, '\\$&').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' '); }
function shortTitle(value) {
  return String(value).replace(/\s*\((?:Steam|Epic Games|itch\.io)\)\s*/gi, ' ').replace(/\s+(?:Steam\s+)?(?:Key\s+)?Giveaway\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 110);
}
function price(offer, config) {
  const pricing = config.pricing || config.state?.pricing;
  const amount = Number(String(offer.worth || '').replace(/[$,]/g, ''));
  if (!(amount > 0) || !pricing || ['hidden', 'unavailable'].includes(pricing.mode)) return '';
  const converted = pricing.mode === 'converted';
  const value = amount * (converted ? pricing.rate : 1);
  if (!Number.isFinite(value) || value <= 0) return '';
  const formatted = new Intl.NumberFormat(config.locale || 'en-GB', { style: 'currency', currency: converted ? pricing.currency : 'USD' }).format(value);
  return ` ~~${converted ? '≈' : ''}${escape(formatted)}~~`;
}
function line(offer, newSince = {}, now = Date.now(), config = {}) {
  const fresh = config.showNew !== false && newSince[offer.id] && now >= newSince[offer.id] && now - newSince[offer.id] < NEW_MS;
  const selectedStores = offer.stores.filter((key) => config.stores?.includes(key));
  const platforms = config.showPlatforms !== false && selectedStores.length > 1 ? selectedStores.map((key) => STORES[key]).join(', ') : '';
  return `› ${fresh ? '🆕 ' : ''}[${escape(shortTitle(offer.title))}](${offer.url})${price(offer, config)}${(offer.type !== 'game' && !(offer.type === 'dlc' && config.omitDlcLabel)) ? ` · ${TYPES[offer.type]}` : ''}${platforms ? `\n  ${platforms}` : ''}`;
}
function orderedOffers(offers, now) {
  return [...new Map(offers.map((offer) => [offer.id, offer])).values()].sort((a, b) => {
    const endA = a.endsAt > now && a.endsAt - now <= ENDING_MS ? a.endsAt : Infinity;
    const endB = b.endsAt > now && b.endsAt - now <= ENDING_MS ? b.endsAt : Infinity;
    return (endA === endB ? 0 : endA - endB) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
const PLATFORM_STYLE = Object.freeze({
  steam: { alias: 'steam', emoji: '🚂' }, epic: { alias: 'epic', emoji: '⚡' },
  gog: { emoji: '🟣' }, itchio: { emoji: '🎨' }, xbox: { alias: 'xbox', emoji: '🟢' },
  playstation: { alias: 'playstation', emoji: '🔵' }, switch: { alias: 'nintendo', emoji: '🔴' },
  android: { emoji: '🤖' }, ios: { emoji: '📱' }, drmFree: { emoji: '🔓' }, other: { emoji: '📦' },
});
function platformPresentation(client, bank = client?.application?.emojis?.cache) {
  return Object.fromEntries(Object.entries(STORES).map(([key, label]) => {
    const style = PLATFORM_STYLE[key];
    const core = style.alias && (bank?.get?.(style.alias) || bank?.get?.(`goliath_${style.alias}`) || bank?.find?.((emoji) => emoji.name === `goliath_${style.alias}`));
    // Reuse the existing repo-managed core emoji bank; never create duplicate assets.
    const emoji = core ? require('../emojis/emojis').render(core, style.emoji) : style.emoji;
    return [key, { label, emoji, fallback: style.emoji, imageUrl: core && /^\d{16,20}$/.test(core.id) ? `https://cdn.discordapp.com/emojis/${core.id}.${core.animated ? 'gif' : 'png'}` : null }];
  }));
}
async function loadPlatformPresentation(client, guildId) {
  if (!client?.application?.emojis?.fetch) return platformPresentation(client);
  try {
    // The shared Emoji module fetches the installed bank; a cold application cache is not authoritative.
    const bank = await require('../emojis/emojis').allowedGuildEmojis(client, guildId, 'freeGames');
    return platformPresentation(client, bank);
  } catch (error) {
    console.warn('[Free Games] Emoji bank unavailable; cached platform icons retained:', error.message);
    return platformPresentation(client);
  }
}

const MAIN_STORES = Object.freeze(['steam', 'epic', 'gog', 'xbox', 'playstation', 'switch']);
function featuredCandidates(offers, config) {
  return [...new Map(offers.filter(offer => offer.type === 'game' && safeUrl(offer.image) &&
    offer.stores.some(store => MAIN_STORES.includes(store) && config.stores.includes(store))).map(offer => [offer.id, offer])).values()]
    .sort((a, b) => (Number.isSafeInteger(a.popularityRank) ? a.popularityRank : Infinity) -
      (Number.isSafeInteger(b.popularityRank) ? b.popularityRank : Infinity) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
function selectFeaturedOffer(offers, config) {
  if (config.featuredMode === 'off') return null;
  const candidates = featuredCandidates(offers, config);
  return (config.featuredMode === 'manual' && candidates.find(offer => offer.id === config.featuredOfferId)) || candidates[0] || null;
}
function featuredDescription(offer, config, platforms) {
  const store = offer.stores.find(key => MAIN_STORES.includes(key) && config.stores.includes(key));
  const platform = platforms[store];
  const summary = escape(String(offer.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 220));
  return '**Featured game**\n**[' + escape(shortTitle(offer.title).slice(0, 100)) + '](' + offer.url + ')**\n' +
    (platform?.emoji || PLATFORM_STYLE[store]?.emoji || '🎮') + ' **' + STORES[store] + '** · ' + price(offer, config).trim() + ' **FREE**' +
    (summary ? '\n' + summary : '') + '\n\n';
}

function buildListing(offers, config, now = Date.now(), platforms = platformPresentation()) {
  const pages = [];
  const unique = orderedOffers(offers, now);
  const featured = selectFeaturedOffer(unique, config);
  const attribution = '\n[Offers provided by GamerPower](https://www.gamerpower.com/)';
  for (const section of SECTIONS) {
    const items = unique.filter((offer) => section.types.includes(offer.type));
    if (!items.length) continue;
    const fields = [];
    for (const [key, label] of Object.entries(STORES)) {
      const group = items.filter((offer) => offer.id !== featured?.id && offer.stores.find((store) => config.stores.includes(store)) === key);
      if (!group.length) continue;
      let value = '';
      let part = 1;
      const name = () => `${platforms[key]?.emoji || PLATFORM_STYLE[key].emoji} ${label} · ${group.length}${part > 1 ? ' (continued)' : ''}`;
      for (const offer of group) {
        let entry = line({ ...offer, title: shortTitle(offer.title).slice(0, 70) }, config.state?.newSince, now, { ...config, omitDlcLabel: true }) + '\n\n';
        // Retain the link for extreme provider URLs/titles without cutting Markdown mid-link.
        if (entry.length > 1000) entry = `› [${escape(shortTitle(offer.title).slice(0, 60))}](${offer.url})${price(offer, config)}\n\n`;
        if (value && value.length + entry.length > 1000) { fields.push({ name: name(), value: value.trim(), inline: config.layout !== 'list' }); value = ''; part++; }
        value += entry;
      }
      if (value) fields.push({ name: name(), value: value.trim(), inline: config.layout !== 'list' });
    }
    const spotlight = section.types.includes('game') ? featured : null;
    const description = (config.showOfferCount === false ? '' : `**${items.length} offer${items.length === 1 ? '' : 's'} available**`) + attribution;
    let page = { ...section, description: (spotlight ? featuredDescription(spotlight, config, platforms) : '') + description, featured: spotlight, fields: [] };
    let size = section.title.length + page.description.length + 80;
    for (const field of fields) {
      const length = field.name.length + field.value.length;
      if (page.fields.length && (page.fields.length >= 6 || size + length > 5700)) {
        pages.push(page); page = { ...section, description, fields: [] }; size = section.title.length + description.length + 80;
      }
      page.fields.push(field); size += length;
    }
    if (page.fields.length || page.featured) pages.push(page);
  }
  if (!pages.length) pages.push({ ...SECTIONS[0], description: 'No matching free offers are currently listed.' + attribution, fields: [] });
  return pages.map((page, index) => ({ embeds: [{ title: page.title, color: page.color, description: page.description, fields: page.fields, ...(page.featured && config.featuredArtwork !== 'hidden' ? { thumbnail: { url: safeUrl(page.featured.image) } } : {}), footer: { text: `Goliath Free Games · ${index + 1}/${pages.length}${config.showTimestamps === false ? '' : ' · Updated'}` }, ...(config.showTimestamps === false ? {} : { timestamp: new Date(config.listingUpdatedAt || now).toISOString() }) }], allowedMentions: { parse: [] }, ...(page.featured ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: 'View featured game & claim', url: page.featured.url }] }] } : {}) }));
}

module.exports = { NEW_MS, ENDING_MS, SECTIONS, PLATFORM_STYLE, platformPresentation, loadPlatformPresentation, MAIN_STORES, featuredCandidates, selectFeaturedOffer, featuredDescription, escape, line, price, shortTitle, orderedOffers, buildListing };
