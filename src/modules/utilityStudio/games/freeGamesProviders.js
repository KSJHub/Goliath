'use strict';

const STORES = Object.freeze({ steam: 'Steam', epic: 'Epic Games Store', gog: 'GOG', itchio: 'itch.io', xbox: 'Xbox', playstation: 'PlayStation', switch: 'Nintendo Switch', android: 'Android', ios: 'iOS', drmFree: 'DRM-Free', other: 'Other platforms' });
const TYPES = Object.freeze({ game: 'Games to keep', dlc: 'DLC', loot: 'In-game loot', beta: 'Beta / playtest access', demo: 'Demos', weekend: 'Free weekends / temporary access' });
const CURRENCIES = Object.freeze(Intl.supportedValuesOf('currency'));
const rateCache = new Map();
const rateFlights = new Map();
const CACHE_MS = 15 * 60_000;
let cached = null;
let inFlight = null;
let retryAfter = 0;
function safeUrl(value) {
  try { if (typeof value !== 'string' || value.length > 500) return null; const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function expiry(value) {
  // GamerPower supplies timezone-less dates. Do not invent an exact expiry instant.
  if (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(value))) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function classify(row) {
  const type = String(row.type || '').toLowerCase();
  const title = String(row.title || '');
  if (/free[ -]?(weekend|week)|free to play (until|through)|limited.time (access|trial)|free trial/i.test(title)) return 'weekend';
  if (/\bdemo\b/i.test(title)) return 'demo';
  if (/early access|beta/.test(type) || /playtest|\bbeta\b/i.test(title)) return 'beta';
  if (/\bdlc\b|downloadable content/i.test(title + ' ' + String(row.description || ''))) return 'dlc';
  if (/dlc|loot/.test(type)) return 'loot';
  if (type === 'game' && /free weekend|free trial|play for free until/i.test(row.description || '')) return 'weekend';
  if (type === 'game' && !/free.to.play|subscription|prime gaming|game pass|playstation plus/i.test(title + ' ' + row.description)) return 'game';
  return null;
}
function normalize(row, now = Date.now()) {
  if (!row || !/^\d+$/.test(String(row.id)) || String(row.status).toLowerCase() !== 'active') return null;
  const type = classify(row);
  const url = safeUrl(row.gamerpower_url);
  if (!type || !url || new URL(url).hostname !== 'www.gamerpower.com') return null;
  const platforms = String(row.platforms || '').toLowerCase();
  const tests = { steam: /\bsteam\b/, epic: /epic games/, gog: /\bgog\b/, itchio: /itch\.io/, xbox: /xbox/, playstation: /playstation/, switch: /switch/, android: /android/, ios: /\bios\b/, drmFree: /drm.free/ };
  const stores = Object.keys(tests).filter((key) => tests[key].test(platforms));
  if (!stores.length) stores.push('other');
  const endsAt = expiry(row.end_date);
  if (endsAt && endsAt <= now) return null;
  // A date known to be in the past in every timezone can safely be excluded.
  if (/^\d{4}-\d\d-\d\d /.test(String(row.end_date)) && Date.parse(row.end_date.replace(' ', 'T') + 'Z') + 14 * 3600_000 <= now) return null;
  return { id: `gamerpower:${row.id}`, title: String(row.title || 'Free offer').slice(0, 200), type, stores, url, image: safeUrl(row.image), worth: /^\$[\d,.]+$/.test(row.worth) ? row.worth : null, endsAt, endDateText: row.end_date && row.end_date !== 'N/A' ? String(row.end_date).slice(0, 40) : null, description: String(row.description || '').slice(0, 1000) };
}
// Indicative conversions of the provider's USD value, never regional store prices.
async function getPricing(config) {
  if (config.priceMode === 'hidden') return { mode: 'hidden', currency: config.currency };
  if (config.priceMode === 'source' || config.currency === 'USD') return { mode: 'source', currency: 'USD' };
  const currency = config.currency;
  if (!CURRENCIES.includes(currency)) return { mode: 'unavailable', currency, warning: 'Choose a supported currency.' };
  const previous = rateCache.get(currency);
  if (previous && Date.now() < previous.retryAt) return previous.value;
  if (rateFlights.has(currency)) return rateFlights.get(currency);
  const task = (async () => {
    try {
      const response = await fetch(`https://api.frankfurter.dev/v2/rate/USD/${currency}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Rate unavailable');
      const row = await response.json();
      const age = Date.now() - Date.parse(row.date);
      if (row.base !== 'USD' || row.quote !== currency || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(age) || age < -86400000 || age > 7 * 86400000) throw new Error('Invalid or stale rate');
      const value = { mode: 'converted', currency, rate: row.rate, date: row.date };
      rateCache.set(currency, { value, retryAt: Date.now() + 6 * 3600000 });
      return value;
    } catch {
      const value = { mode: 'unavailable', currency, warning: `${currency} conversion unavailable; original prices are hidden. Free offers still update.` };
      rateCache.set(currency, { value, retryAt: Date.now() + 5 * 60000 });
      return value;
    }
  })().finally(() => rateFlights.delete(currency));
  rateFlights.set(currency, task);
  return task;
}
async function getOffers() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  if (inFlight) return inFlight;
  if (Date.now() < retryAfter) throw new Error('GamerPower is temporarily unavailable; automatic retry is scheduled. Existing listing retained.');
  inFlight = (async () => {
    const response = await fetch('https://www.gamerpower.com/api/giveaways?sort-by=popularity', { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (![200, 201].includes(response.status)) throw new Error(`GamerPower returned HTTP ${response.status}. Existing listing retained.`);
    const rows = await response.json();
    if (response.status !== 201 && !Array.isArray(rows)) throw new Error('Invalid GamerPower feed. Existing listing retained.');
    const offers = (Array.isArray(rows) ? rows : []).map((row, popularityRank) => { const offer = normalize(row); return offer ? { ...offer, popularityRank } : null; }).filter(Boolean);
    if (Array.isArray(rows) && rows.length && !rows.some((row) => row && /^\d+$/.test(String(row.id)) && typeof row.title === 'string' && typeof row.type === 'string' && typeof row.platforms === 'string')) throw new Error('GamerPower feed could not be recognised. Existing listing retained.');
    cached = { offers: [...new Map(offers.map((offer) => [offer.id, offer])).values()], fetchedAt: Date.now() };
    return cached;
  })().catch((error) => { retryAfter = Date.now() + 60_000; throw error; }).finally(() => { inFlight = null; });
  return inFlight;
}
module.exports = { CURRENCIES, getPricing, STORES, TYPES, CACHE_MS, safeUrl, normalize, classify, getOffers };


// Game Updates uses publisher announcements, independent of the giveaway feed.
const UPDATE_CATALOG = Object.freeze([
  ['730', 'Counter-Strike 2'], ['570', 'Dota 2'], ['252490', 'Rust'], ['440', 'Team Fortress 2'],
  ['892970', 'Valheim'], ['553850', 'HELLDIVERS 2'], ['1086940', "Baldur's Gate 3"],
  ['1144200', 'Ready or Not'], ['1172470', 'Apex Legends'], ['945360', 'Among Us'],
  ['1245620', 'ELDEN RING'], ['346110', 'ARK: Survival Evolved'], ['271590', 'Grand Theft Auto V Legacy'],
  ['990080', 'Hogwarts Legacy'], ['1623730', 'Palworld'], ['1966720', 'Lethal Company'],
  ['578080', 'PUBG: BATTLEGROUNDS'], ['381210', 'Dead by Daylight'],
  ['230410', 'Warframe'], ['236390', 'War Thunder'], ['444090', 'Paladins'],
  ['304930', 'Unturned'], ['251570', '7 Days to Die'],
  ['359550', "Tom Clancy's Rainbow Six Siege"], ['1085660', 'Destiny 2'],
  ['1091500', 'Cyberpunk 2077'], ['1174180', 'Red Dead Redemption 2'],
  ['413150', 'Stardew Valley'], ['105600', 'Terraria'],
  ['108600', 'Project Zomboid'], ['294100', 'RimWorld'],
  ['255710', 'Cities: Skylines'], ['949230', 'Cities: Skylines II'],
  ['427520', 'Factorio'], ['526870', 'Satisfactory'],
  ['548430', 'Deep Rock Galactic'], ['632360', 'Risk of Rain 2'],
  ['1097150', 'Fall Guys'], ['1938090', 'Call of Duty'],
  ['2357570', 'Overwatch 2'], ['1172620', 'Sea of Thieves'],
  ['1811260', 'EA SPORTS FC 24'], ['2669320', 'EA SPORTS FC 25'],
  ['1238840', 'Battlefield 1'], ['1238810', 'Battlefield V'],
  ['1517290', 'Battlefield 2042'], ['377160', 'Fallout 4'],
  ['489830', 'The Elder Scrolls V: Skyrim Special Edition'],
  ['221100', 'DayZ'], ['394360', 'Hearts of Iron IV'],
  ['289070', 'Sid Meier’s Civilization VI'], ['1293830', 'Forza Horizon 4'],
  ['1551360', 'Forza Horizon 5'], ['1248130', 'Farming Simulator 22'],
  ['227300', 'Euro Truck Simulator 2'], ['270880', 'American Truck Simulator'],
].map(([appId, name]) => Object.freeze({ appId, name, image: steamArtwork(appId), source: Object.freeze({ type: 'steam', provider: 'Steam publisher announcements', appId, url: 'https://store.steampowered.com/app/' + appId + '/', status: 'configured', verified: false }) })));
// Configured official endpoints are not considered verified until their live feeds are checked.
function gameUpdateSourceStatus(game) { return game?.source?.verified === true ? 'verified' : 'unverified'; }
const newsCache = new Map(), newsFlights = new Map();
function steamAppId(value) {
  const raw = String(value || '').trim();
  let id = raw;
  if (!/^\d+$/.test(raw)) {
    let url; try { url = new URL(raw); } catch { throw new Error('Enter a Steam App ID or Steam store game URL.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'store.steampowered.com' || url.username || url.password) throw new Error('Use an official HTTPS Steam store URL.');
    id = url.pathname.match(/^\/app\/(\d+)(?:\/|$)/)?.[1] || '';
  }
  if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 4294967295) throw new Error('Invalid Steam App ID.');
  return String(Number(id));
}
function steamArtwork(appId) { return 'https://cdn.akamai.steamstatic.com/steam/apps/' + steamAppId(appId) + '/header.jpg'; }
function plainNews(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/gi, '$1').replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[(?:\/?[a-z0-9*]+)(?:=[^\]]*)?\]/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
function normalizeNews(row) {
  if (!row || !/^\d{1,30}$/.test(String(row.gid)) || row.feedname !== 'steam_community_announcements') return null;
  const url = safeUrl(row.url);
  if (!url || !['store.steampowered.com', 'steamcommunity.com'].includes(new URL(url).hostname)) return null;
  const publishedAt = Number(row.date) * 1000;
  if (!Number.isFinite(publishedAt) || publishedAt < 0 || publishedAt > Date.now() + 86400000) return null;
  const contents = String(row.contents || '').slice(0, 20000);
  const sourceImage = contents.match(/\[img\]([\s\S]*?)\[\/img\]/i)?.[1] || contents.match(/<img\b[^>]*src=["']([^"']+)/i)?.[1];
  const title = plainNews(row.title).slice(0, 200) || 'Game announcement';
  return { id: String(row.gid), title, url, publishedAt, description: plainNews(contents).slice(0, 3500),
    image: safeUrl(sourceImage?.replace('{STEAM_CLAN_IMAGE}', 'https://clan.akamai.steamstatic.com/images')),
    kind: /\b(patch|hotfix|fixes|bugfix|update|changelog)\b/i.test(title) ? 'patches' : 'announcements' };
}
async function getGameNews(value) {
  const appId = steamAppId(value), previous = newsCache.get(appId);
  if (previous && Date.now() < previous.retryAt) {
    if (previous.error) throw new Error(previous.error);
    return previous.value;
  }
  if (newsFlights.has(appId)) return newsFlights.get(appId);
  const task = (async () => {
    try {
      const url = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=' + appId + '&count=50&maxlength=5000&feeds=steam_community_announcements';
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Steam announcements unavailable (HTTP ' + response.status + ').');
      const data = await response.json();
      if (String(data.appnews?.appid) !== appId || !Array.isArray(data.appnews.newsitems)) throw new Error('Steam returned an invalid announcement feed.');
      const items = [...new Map(data.appnews.newsitems.map(normalizeNews).filter(Boolean).map(item => [item.id, item])).values()]
        .sort((a, b) => b.publishedAt - a.publishedAt || a.id.localeCompare(b.id));
      const value = { appId, items, fetchedAt: Date.now() };
      newsCache.set(appId, { value, retryAt: Date.now() + 5 * 60000 }); return value;
    } catch (error) {
      newsCache.set(appId, { error: String(error.message).slice(0, 300), retryAt: Date.now() + 30000 }); throw error;
    }
  })().finally(() => newsFlights.delete(appId));
  newsFlights.set(appId, task);
  // Cache is shared across guilds, but bounded for servers following different games.
  if (newsCache.size > 500) newsCache.delete(newsCache.keys().next().value);
  return task;
}
Object.assign(module.exports, { UPDATE_CATALOG, gameUpdateSourceStatus, steamAppId, steamArtwork, plainNews, normalizeNews, getGameNews });
