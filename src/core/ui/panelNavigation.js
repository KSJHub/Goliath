// Goliath - Panel Navigation System
// Compact, history-based navigation that stays within Discord's 100-character custom ID limit.

const ROUTE_TO_TOKEN = Object.freeze({
  'admin:home': 'h',
  'admin:automod': 'a',
  'admin:automod:configure': 'ac',
  'admin:automod:rule:antiSpam': 'as',
  'admin:automod:rule:antiLinks': 'al',
  'admin:automod:rule:badWords': 'aw',
  'admin:automod:rule:caps': 'ap',
  'admin:automod:rule:mentions': 'am',
  'admin:adminpanel': 'ad',
  'admin:modpanel': 'mp',
  'admin:modules': 'mo',
  'admin:logs': 'lo',
  'admin:backups': 'bu',
  'admin:staffroles': 'sr',
  'admin:modroles': 'mr',
  'admin:autoRoles': 'ar',
  'admin:adminsettings': 'st',
  'admin:channel:automodlog': 'ca',
  'admin:channel:adminlog': 'cd',
  'admin:channel:modlog': 'cm',
  'admin:channel:logs': 'cl',
  'admin:channel:memberlog': 'ce',
});

const TOKEN_TO_ROUTE = Object.freeze(
  Object.fromEntries(Object.entries(ROUTE_TO_TOKEN).map(([route, token]) => [token, route]))
);

function cleanHistory(history) {
  const source = Array.isArray(history) ? history : ['admin:home'];
  const cleaned = source
    .map((route) => String(route || '').trim())
    .filter(Boolean);

  if (!cleaned.length) return ['admin:home'];
  const childRoutes = cleaned.filter((route) => route !== 'admin:home');

  // More than six levels is unnecessary for the Discord panels and risks custom ID overflow.
  return ['admin:home', ...childRoutes.slice(-5)];
}

function encodeState(state) {
  const history = cleanHistory(state?.history);
  return history
    .map((route) => ROUTE_TO_TOKEN[route] || `x${Buffer.from(route).toString('base64url')}`)
    .join(',');
}

function decodeLegacyState(encoded) {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString());
    return { history: cleanHistory(parsed?.history) };
  } catch {
    return null;
  }
}

function decodeState(encoded) {
  if (!encoded) return createState();

  try {
    const history = String(encoded)
      .split(',')
      .filter(Boolean)
      .map((token) => {
        if (TOKEN_TO_ROUTE[token]) return TOKEN_TO_ROUTE[token];
        if (token.startsWith('x')) return Buffer.from(token.slice(1), 'base64url').toString();
        return null;
      })
      .filter(Boolean);

    if (history.length) return { history: cleanHistory(history) };
  } catch {
    // Fall through to legacy decoder.
  }

  return decodeLegacyState(encoded) || createState();
}

function createState(start = 'admin:home') {
  return { history: cleanHistory([start]) };
}

function push(state, panel) {
  const history = cleanHistory(state?.history);
  const route = String(panel || '').trim();
  if (!route) return { history };
  if (history[history.length - 1] === route) return { history };
  return { history: cleanHistory([...history, route]) };
}

function back(state) {
  const history = cleanHistory(state?.history);
  if (history.length > 1) history.pop();
  return { history: cleanHistory(history) };
}

function current(state) {
  const history = cleanHistory(state?.history);
  return history[history.length - 1] || 'admin:home';
}

function buildCustomId(state, action) {
  const safeAction = String(action || '').trim() || 'back';
  const customId = `nav|${encodeState(state)}|${safeAction}`;

  // Discord limits component custom IDs to 100 characters.
  if (customId.length <= 100) return customId;

  const route = current(state);
  const compactState = {
    history: route === 'admin:home' ? ['admin:home'] : ['admin:home', route],
  };
  return `nav|${encodeState(compactState)}|${safeAction}`.slice(0, 100);
}

function parseCustomId(customId) {
  try {
    const parts = String(customId || '').split('|');
    if (parts[0] !== 'nav') return null;
    return {
      state: decodeState(parts[1]),
      action: parts[2],
    };
  } catch {
    return null;
  }
}

module.exports = {
  createState,
  encodeState,
  decodeState,
  push,
  back,
  current,
  buildCustomId,
  parseCustomId,
};
