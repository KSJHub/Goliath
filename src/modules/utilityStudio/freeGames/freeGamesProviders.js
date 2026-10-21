'use strict';

const STORES = Object.freeze({ steam: 'Steam', epic: 'Epic Games Store', gog: 'GOG', itchio: 'itch.io', xbox: 'Xbox', playstation: 'PlayStation', switch: 'Nintendo Switch', android: 'Android', ios: 'iOS', drmFree: 'DRM-Free', other: 'Other platforms' });
const TYPES = Object.freeze({ game: 'Games to keep', dlc: 'DLC', loot: 'In-game loot', beta: 'Beta / playtest access', demo: 'Demos', weekend: 'Free weekends / temporary access' });
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
  return { id: `gamerpower:${row.id}`, title: String(row.title || 'Free offer').slice(0, 200), type, stores, url, worth: /^\$[\d,.]+$/.test(row.worth) ? row.worth : null, endsAt, endDateText: row.end_date && row.end_date !== 'N/A' ? String(row.end_date).slice(0, 40) : null, description: String(row.description || '').slice(0, 1000) };
}
async function getOffers() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  if (inFlight) return inFlight;
  if (Date.now() < retryAfter) throw new Error('GamerPower is temporarily unavailable; automatic retry is scheduled. Existing listing retained.');
  inFlight = (async () => {
    const response = await fetch('https://www.gamerpower.com/api/giveaways', { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (![200, 201].includes(response.status)) throw new Error(`GamerPower returned HTTP ${response.status}. Existing listing retained.`);
    const rows = await response.json();
    if (response.status !== 201 && !Array.isArray(rows)) throw new Error('Invalid GamerPower feed. Existing listing retained.');
    const offers = (Array.isArray(rows) ? rows : []).map((row) => normalize(row)).filter(Boolean);
    if (Array.isArray(rows) && rows.length && !rows.some((row) => row && /^\d+$/.test(String(row.id)) && typeof row.title === 'string' && typeof row.type === 'string' && typeof row.platforms === 'string')) throw new Error('GamerPower feed could not be recognised. Existing listing retained.');
    cached = { offers: [...new Map(offers.map((offer) => [offer.id, offer])).values()], fetchedAt: Date.now() };
    return cached;
  })().catch((error) => { retryAfter = Date.now() + 60_000; throw error; }).finally(() => { inFlight = null; });
  return inFlight;
}
module.exports = { STORES, TYPES, CACHE_MS, safeUrl, normalize, classify, getOffers };
