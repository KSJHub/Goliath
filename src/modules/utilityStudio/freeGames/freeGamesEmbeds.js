'use strict';
const { STORES, TYPES } = require('./freeGamesProviders');
const NEW_MS = 24 * 3600_000;
const ENDING_MS = 48 * 3600_000;
function escape(value) { return String(value).replace(/[\\`*_{}\[\]()<>~|]/g, '\\$&').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' '); }
function line(offer, firstSeen = {}, now = Date.now()) {
  const fresh = firstSeen[offer.id] && now - firstSeen[offer.id] < NEW_MS;
  const ending = offer.endsAt && offer.endsAt - now <= ENDING_MS;
  const end = offer.endsAt ? ` · Ends <t:${Math.floor(offer.endsAt / 1000)}:R>` : offer.endDateText ? ` · Ends ${escape(offer.endDateText)} (provider time)` : ' · End not supplied';
  return `${fresh ? '🆕 ' : ''}${ending ? '🔥 ' : ''}[${escape(offer.title)}](${offer.url})${offer.worth ? ` ~~${offer.worth}~~` : ''}${offer.type !== 'game' ? ` · ${TYPES[offer.type]}` : ''}${end}`;
}
function buildListing(offers, config, now = Date.now()) {
  const chunks = [];
  for (const [store, label] of Object.entries(STORES)) {
    if (!config.stores.includes(store)) continue;
    const items = offers.filter((offer) => offer.stores.includes(store));
    if (!items.length) continue;
    let chunk = `**${label} · ${items.length}**\n`;
    for (const offer of items) {
      const text = line(offer, config.state.firstSeen, now) + '\n';
      if (chunk.length + text.length > 3500) { chunks.push(chunk); chunk = `**${label} (continued)**\n`; }
      chunk += text;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) chunks.push('No matching free offers are currently listed.');
  const pages = [];
  for (const chunk of chunks) {
    if (pages.length && pages[pages.length - 1].length + chunk.length + 2 <= 3500) pages[pages.length - 1] += '\n\n' + chunk;
    else pages.push(chunk);
  }
  return pages.map((description, index) => ({ embeds: [{ title: '🎁 Free Games', color: 0xfbbf24, description: description + '\n[Offers provided by GamerPower](https://www.gamerpower.com/)\nCheck the offer page for claim requirements, region and exact availability.', footer: { text: `Goliath Free Games · ${index + 1}/${pages.length}` } }], allowedMentions: { parse: [] } }));
}
module.exports = { NEW_MS, ENDING_MS, escape, line, buildListing };
