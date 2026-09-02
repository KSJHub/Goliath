// Goliath - Panel Navigation System
// Compact, history-based navigation that stays within Discord's 100-character custom ID limit.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const ROLE_PAGE_SIZE = 25;

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

function guildRolesByHierarchy(guild, { includeEveryone = false } = {}) {
  if (!guild?.roles?.cache) return [];
  return [...guild.roles.cache.values()]
    .filter((role) => includeEveryone || role.id !== guild.id)
    .sort((a, b) => {
      const position = Number(b.rawPosition ?? b.position ?? 0) - Number(a.rawPosition ?? a.position ?? 0);
      if (position) return position;
      try {
        const left = BigInt(a.id);
        const right = BigInt(b.id);
        return left === right ? 0 : left > right ? -1 : 1;
      } catch {
        return String(b.id).localeCompare(String(a.id));
      }
    });
}

function rolePickerCustomId(baseId, kind, page = 0) {
  const suffix = `|rp|${kind}|${Math.max(0, Number(page) || 0)}`;
  const safeBase = String(baseId || 'role').slice(0, Math.max(1, 100 - suffix.length));
  return `${safeBase}${suffix}`;
}

function parseRolePickerId(customId) {
  const match = String(customId || '').match(/^(.*)\|rp\|(select|page)\|(\d+)$/);
  if (!match) return null;
  return {
    baseId: match[1],
    kind: match[2],
    page: Math.max(0, Number.parseInt(match[3], 10) || 0),
  };
}

function rolePickerPageCount(guild) {
  return Math.max(1, Math.ceil(guildRolesByHierarchy(guild).length / ROLE_PAGE_SIZE));
}

function roleIdsOnPage(guild, page = 0) {
  const roles = guildRolesByHierarchy(guild);
  const pageCount = Math.max(1, Math.ceil(roles.length / ROLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  return roles.slice(safePage * ROLE_PAGE_SIZE, (safePage + 1) * ROLE_PAGE_SIZE).map((role) => role.id);
}

function buildRolePicker(guild, {
  customId,
  placeholder = 'Choose a role',
  selectedIds = [],
  minValues = 1,
  maxValues = 1,
  page = 0,
  pagination = true,
  showManaged = true,
} = {}) {
  const roles = guildRolesByHierarchy(guild);
  const pageCount = Math.max(1, Math.ceil(roles.length / ROLE_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  const selected = new Set((selectedIds || []).map(String));
  const visible = roles.slice(safePage * ROLE_PAGE_SIZE, (safePage + 1) * ROLE_PAGE_SIZE);
  const pageSelected = visible.filter((role) => selected.has(role.id)).length;
  const requestedMax = Math.max(1, Number(maxValues) || 1);
  const menuMax = Math.max(1, Math.min(visible.length || 1, requestedMax));
  const menuMin = Math.min(Math.max(0, Number(minValues) || 0), menuMax, pageSelected || menuMax);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(rolePickerCustomId(customId, 'select', safePage))
    .setPlaceholder(`${placeholder}${pageCount > 1 ? ` · Page ${safePage + 1}/${pageCount}` : ''}`.slice(0, 150))
    .setMinValues(menuMin)
    .setMaxValues(menuMax);

  if (!visible.length) {
    menu.setDisabled(true).addOptions({ label: 'No roles available', value: '__none__' });
  } else {
    menu.addOptions(visible.map((role) => ({
      label: String(role.name || 'Unnamed role').slice(0, 100),
      value: role.id,
      description: showManaged && role.managed ? 'Managed by Discord / integration' : `Hierarchy position ${Number(role.rawPosition ?? role.position ?? 0)}`.slice(0, 100),
      default: selected.has(role.id),
    })));
  }

  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (pagination && pageCount > 1) rows.push(buildRolePickerPagination(customId, safePage, pageCount));
  return { rows, page: safePage, pageCount, roles: visible };
}

function buildRolePickerPagination(customId, page = 0, pageCount = 1) {
  const safeCount = Math.max(1, Number(pageCount) || 1);
  const safePage = Math.min(Math.max(0, Number(page) || 0), safeCount - 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(rolePickerCustomId(customId, 'page', Math.max(0, safePage - 1)))
      .setLabel('Previous')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`${String(customId || 'role').slice(0, 70)}|rpinfo|${safePage}`.slice(0, 100))
      .setLabel(`Page ${safePage + 1}/${safeCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(rolePickerCustomId(customId, 'page', Math.min(safeCount - 1, safePage + 1)))
      .setLabel('Next')
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= safeCount - 1),
  );
}

function mergeRolePickerSelection(guild, existingIds = [], selectedValues = [], page = 0) {
  const visible = new Set(roleIdsOnPage(guild, page));
  const next = new Set((existingIds || []).map(String).filter((id) => !visible.has(id)));
  for (const id of selectedValues || []) if (id !== '__none__') next.add(String(id));
  return guildRolesByHierarchy(guild).map((role) => role.id).filter((id) => next.has(id));
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
  ROLE_PAGE_SIZE,
  guildRolesByHierarchy,
  rolePickerCustomId,
  parseRolePickerId,
  rolePickerPageCount,
  roleIdsOnPage,
  buildRolePicker,
  buildRolePickerPagination,
  mergeRolePickerSelection,
};
