'use strict';
const { STORES, TYPES } = require('./freeGamesProviders');
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
  const fresh = newSince[offer.id] && now >= newSince[offer.id] && now - newSince[offer.id] < NEW_MS;
  const ending = offer.endsAt && offer.endsAt > now && offer.endsAt - now <= ENDING_MS;
  const end = offer.endsAt ? ` · ${ending ? '⏳ ' : ''}<t:${Math.floor(offer.endsAt / 1000)}:R>` : offer.endDateText ? ` · ${escape(offer.endDateText)} (source time)` : '';
  const selectedStores = offer.stores.filter((key) => config.stores?.includes(key));
  const platforms = selectedStores.length > 1 ? selectedStores.map((key) => STORES[key]).join(', ') : '';
  return `› ${fresh ? '🆕 ' : ''}[${escape(shortTitle(offer.title))}](${offer.url})${price(offer, config)}${(offer.type !== 'game' && !(offer.type === 'dlc' && config.omitDlcLabel)) ? ` · ${TYPES[offer.type]}` : ''}${end}${platforms ? `\n  ${platforms}` : ''}`;
}
function orderedOffers(offers, now) {
  return [...new Map(offers.map((offer) => [offer.id, offer])).values()].sort((a, b) => {
    const endA = a.endsAt > now && a.endsAt - now <= ENDING_MS ? a.endsAt : Infinity;
    const endB = b.endsAt > now && b.endsAt - now <= ENDING_MS ? b.endsAt : Infinity;
    return (endA === endB ? 0 : endA - endB) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
function buildListing(offers, config, now = Date.now()) {
  const pages = [];
  const unique = orderedOffers(offers, now);
  for (const section of SECTIONS) {
    const items = unique.filter((offer) => section.types.includes(offer.type));
    if (!items.length) continue;
    let text = `**${items.length} offer${items.length === 1 ? '' : 's'} available**\n\n`;
    // Assign a multi-platform offer to its first selected store exactly once.
    for (const [key, label] of Object.entries(STORES)) {
      const group = items.filter((offer) => offer.stores.find((store) => config.stores.includes(store)) === key);
      if (!group.length) continue;
      let heading = `**${label} · ${group.length}**\n`;
      for (const offer of group) {
        const entry = line(offer, config.state?.newSince, now, { ...config, omitDlcLabel: true }) + '\n\n';
        if (text.length + heading.length + entry.length > 3200) {
          pages.push({ ...section, description: text }); text = ''; heading = `**${label} (continued)**\n`;
        }
        text += heading + entry; heading = '';
      }
    }
    if (text) pages.push({ ...section, description: text });
  }
  if (!pages.length) pages.push({ ...SECTIONS[0], description: 'No matching free offers are currently listed.\n' });
  const pricing = config.pricing || config.state?.pricing;
  const pricingNote = pricing?.mode === 'converted' ? `\n≈ Estimated ${pricing.currency} values from USD; Frankfurter rate dated ${pricing.date}. These are not regional store prices.` : pricing?.mode === 'source' ? '\nOriginal values supplied in USD.' : '';
  return pages.map((page, index) => ({ embeds: [{ title: page.title, color: page.color, description: page.description + '\n[Offers provided by GamerPower](https://www.gamerpower.com/)\nCheck claim requirements and regional availability. Missing expiry means unknown; source times have no assumed timezone.' + pricingNote, footer: { text: `Goliath Free Games · ${index + 1}/${pages.length}` } }], allowedMentions: { parse: [] } }));
}
module.exports = { NEW_MS, ENDING_MS, SECTIONS, escape, line, price, shortTitle, orderedOffers, buildListing };
