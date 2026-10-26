'use strict';
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { STORES, TYPES, CURRENCIES } = require('./freeGamesProviders');
// Keep the established section key so the Games rename preserves all guild data and authority bindings.
const MODULE_KEY = 'freeGames';
const MODULE_NAME = 'Games';
const DEFAULTS = { enabled: false, currency: 'GBP', priceMode: 'converted', locale: 'en-GB', timeZone: 'Europe/London', region: 'GB', layout: 'columns', featuredMode: 'auto', featuredOfferId: null, featuredArtwork: 'thumbnail', showTimestamps: true, showExpiry: false, showPlatforms: true, showNew: true, showOfferCount: true, channelId: null, stores: Object.keys(STORES), types: ['game'], alerts: false, roleId: null, state: { firstSeen: {}, newSince: {}, observed: {}, deliveries: [], retired: [], initialized: false, lastCheck: null, lastSuccess: null, error: null, offerCount: 0, pricing: null, warning: null } };
function getConfig(guildId) {
  const section = getModuleSection(guildId, MODULE_KEY, DEFAULTS);
  return { ...DEFAULTS, ...section, state: { ...structuredClone(DEFAULTS.state), ...section.state }, enabled: guildManager.isModuleEnabled(guildId, MODULE_KEY) };
}
function update(guildId, fn) { return updateModuleSection(guildId, MODULE_KEY, fn, DEFAULTS); }
function filterOffers(offers, config, now = Date.now()) { return offers.filter((offer) => config.types.includes(offer.type) && offer.stores.some((store) => config.stores.includes(store)) && (!offer.endsAt || offer.endsAt > now)); }
function validateSettings(input, previous) {
  const result = {};
  for (const key of ['enabled', 'alerts', 'showTimestamps', 'showExpiry', 'showPlatforms', 'showNew', 'showOfferCount']) if (Object.hasOwn(input, key)) { if (typeof input[key] !== 'boolean') throw new Error(`${key} must be true or false.`); result[key] = input[key]; }
  for (const [key, known] of [['stores', STORES], ['types', TYPES]]) if (Object.hasOwn(input, key)) {
    if (!Array.isArray(input[key]) || input[key].length > Object.keys(known).length || input[key].some((value) => !Object.hasOwn(known, value))) throw new Error(`Invalid ${key} selection.`);
    result[key] = [...new Set(input[key])];
  }
  for (const key of ['channelId', 'roleId']) if (Object.hasOwn(input, key)) {
    const id = input[key];
    if (id !== null && id !== '' && (typeof id !== 'string' || !/^\d{16,20}$/.test(id))) throw new Error(`Invalid ${key}.`);
    result[key] = id || null;
  }
  if (Object.hasOwn(input, 'featuredMode')) {
    if (!['auto', 'manual', 'off'].includes(input.featuredMode)) throw new Error('Choose automatic, selected game or no featured game.');
    result.featuredMode = input.featuredMode;
  }
  if (Object.hasOwn(input, 'featuredArtwork')) {
    if (!['thumbnail', 'hidden'].includes(input.featuredArtwork)) throw new Error('Choose thumbnail or hidden featured artwork.');
    result.featuredArtwork = input.featuredArtwork;
  }
  if (Object.hasOwn(input, 'featuredOfferId')) {
    if (input.featuredOfferId !== null && !/^gamerpower:\d+$/.test(input.featuredOfferId)) throw new Error('Invalid featured game.');
    result.featuredOfferId = input.featuredOfferId;
  }
  if (Object.hasOwn(input, 'layout')) {
    if (!['columns', 'list'].includes(input.layout)) throw new Error('Choose platform columns or stacked lists.');
    result.layout = input.layout;
  }
  if (Object.hasOwn(input, 'currency')) {
    if (!CURRENCIES.includes(input.currency)) throw new Error('Choose a supported currency.');
    result.currency = input.currency;
  }
  if (Object.hasOwn(input, 'priceMode')) {
    if (!['converted', 'source', 'hidden'].includes(input.priceMode)) throw new Error('Invalid price display.');
    result.priceMode = input.priceMode;
  }
  if (Object.hasOwn(input, 'locale')) {
    if (typeof input.locale !== 'string' || input.locale.length > 40) throw new Error('Invalid formatting locale.');
    try { result.locale = Intl.getCanonicalLocales(input.locale)[0]; if (!result.locale || !Intl.DateTimeFormat.supportedLocalesOf([result.locale]).length) throw new Error(); } catch { throw new Error('Choose a supported formatting locale, such as en-GB.'); }
  }
  if (Object.hasOwn(input, 'timeZone')) {
    try { if (typeof input.timeZone !== 'string' || !input.timeZone || input.timeZone.length > 80) throw new Error(); result.timeZone = new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).resolvedOptions().timeZone; } catch { throw new Error('Choose a valid timezone, such as Europe/London.'); }
  }
  if (Object.hasOwn(input, 'region')) {
    if (typeof input.region !== 'string' || (!/^[A-Z]{2}$/.test(input.region) || input.region === 'ZZ')) throw new Error('Use a two-letter region code, such as GB.');
    try { if (!new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(input.region)) throw new Error(); } catch { throw new Error('Choose a recognised region code.'); }
    result.region = input.region;
  }
  const next = { ...previous, ...result };
  if (next.enabled && (!next.channelId || !next.stores.length || !next.types.length)) throw new Error('Choose a channel, at least one store and one offer type before enabling Free Games.');
  return result;
}
function saveSettings(guildId, patch) {
  return update(guildId, (current) => {
    const config = getConfig(guildId);
    const changes = validateSettings(patch, config);
    const state = { ...config.state };
    if (Object.hasOwn(changes, 'channelId') && changes.channelId !== config.channelId) {
      state.retired = [...state.retired, ...state.deliveries]; state.deliveries = [];
    }
    if (['stores', 'types', 'alerts', 'enabled'].some((key) => Object.hasOwn(changes, key) && JSON.stringify(changes[key]) !== JSON.stringify(config[key]))) state.initialized = false;
    return { ...current, ...changes, state };
  });
}


const PANEL_PREFIX = 'admin:module:freeGames:';
const DISPLAY_OPTIONS = Object.freeze({
  showTimestamps: 'Footer timestamps',
  showPlatforms: 'Additional platforms', showNew: 'NEW markers', showOfferCount: 'Offer counts',
});
const PRICE_MODES = Object.freeze({ converted: 'Server currency', source: 'Source USD', hidden: 'Hide original prices' });
function componentRow(...components) { return { type: 1, components }; }
function panelButton(action, label, style = 2, disabled = false) {
  return { type: 2, custom_id: PANEL_PREFIX + action, label, style, disabled };
}
function choiceMenu(action, placeholder, choices, selected = [], multi = false) {
  return componentRow({ type: 3, custom_id: PANEL_PREFIX + action, placeholder, min_values: multi ? 0 : 1,
    max_values: multi ? choices.length : 1,
    options: choices.map(([value, label]) => ({ value, label, default: selected.includes(value) })) });
}
function statusTime(value) { return value ? '<t:' + Math.floor(value / 1000) + ':f>' : 'Never'; }
function buildAdminPanel(guild, page = 'home', notice = '', c = getConfig(guild.id)) {
  const { escape, SECTIONS } = require('./freeGamesEmbeds');
  const back = componentRow(panelButton(page === 'home' ? 'studio' : 'home', '⬅ Back'));
  const nav = componentRow(panelButton('delivery', '📨 Delivery'), panelButton('filters', '🎮 Offers'),
    panelButton('pricing', '💱 Currency'), panelButton('display', '🎨 Display'));
  const embed = { title: page === 'home' ? '🎮 Games' : '🎮 Games · Free Games', color: SECTIONS[0].color,
    description: [notice && escape(notice), page === 'home' ? 'Free Games: ' + (c.enabled ? 'enabled' : 'paused') + ' · Game Updates: ' + (c.gameUpdates?.enabled ? 'enabled' : 'paused') : c.enabled ? '🟢 Enabled' : '⏸ Paused'].filter(Boolean).join('\n\n'),
    fields: [], footer: { text: 'Goliath Games · Management' }, timestamp: new Date().toISOString() };
  let controls = [];
  if (page === 'delivery') {
    embed.title += ' · Delivery';
    embed.description += '\nChanges save immediately. Pausing keeps existing listing messages.';
    embed.fields = [
      { name: 'Listing channel', value: c.channelId ? '<#' + c.channelId + '>' : 'Not configured', inline: true },
      { name: 'Notifications', value: c.alerts ? 'New offers' : 'Off', inline: true },
      { name: 'Notification role', value: c.roleId ? '<@&' + c.roleId + '>' : 'No role ping', inline: true },
    ];
    controls = [
      componentRow({ type: 8, custom_id: PANEL_PREFIX + 'channel', channel_types: [0, 5], min_values: 0, max_values: 1,
        placeholder: 'Choose listing channel', ...(c.channelId ? { default_values: [{ id: c.channelId, type: 'channel' }] } : {}) }),
      componentRow({ type: 6, custom_id: PANEL_PREFIX + 'role', min_values: 0, max_values: 1,
        placeholder: 'Notification role (clear for no ping)', ...(c.roleId ? { default_values: [{ id: c.roleId, type: 'role' }] } : {}) }),
      componentRow(panelButton('enabled', c.enabled ? 'Pause updates' : 'Enable updates', c.enabled ? 2 : 3),
        panelButton('alerts', c.alerts ? 'Alerts: on' : 'Alerts: off')),
    ];
  } else if (page === 'filters') {
    embed.title += ' · Offers';
    embed.description += '\nChoose platforms and offer types. Each offer appears once. Changing filters establishes a quiet notification baseline.';
    controls = [
      choiceMenu('stores', 'Stores and platforms', Object.entries(STORES), c.stores, true),
      choiceMenu('types', 'Offer types', Object.entries(TYPES), c.types, true),
    ];
  } else if (page === 'pricing') {
    embed.title += ' · Currency & Region';
    embed.description += '\nCurrency and regional settings are shared with the dashboard. Converted values are estimates of the provider’s USD values, marked ≈; availability must be checked with the store.';
    embed.fields = [
      { name: 'Currency / prices', value: c.currency + ' · ' + PRICE_MODES[c.priceMode], inline: false },
      { name: 'Formatting', value: escape(c.locale) + ' · ' + escape(c.timeZone) + ' · ' + escape(c.region), inline: false },
    ];
    controls = [
      choiceMenu('priceMode', 'Price display', Object.entries(PRICE_MODES), [c.priceMode]),
      componentRow(panelButton('regional', 'Edit currency & region')),
    ];
  } else if (page === 'display') {
    embed.title += ' · Display';
    embed.description += '\nChoose the public listing presentation. Provider credit is retained; currency explanations stay in management settings.';
    controls = [
      componentRow(panelButton('featured:0', '⭐ Featured main game')),
      choiceMenu('layout', 'Platform layout', [['columns', 'Platform columns'], ['list', 'Stacked platform lists']], [c.layout]),
      choiceMenu('displayOptions', 'Visible details (clear to hide all)', Object.entries(DISPLAY_OPTIONS),
        Object.keys(DISPLAY_OPTIONS).filter(key => c[key] !== false), true),
    ];
  } else {
    embed.description += '\nManage the server’s maintained free-offer catalogue. All settings are shared with the dashboard.';
    embed.fields = [
      { name: '📨 Delivery', value: (c.channelId ? '<#' + c.channelId + '>' : 'Choose a channel') + '\n' + (c.alerts ? 'New-offer alerts enabled' : 'Alerts off'), inline: true },
      { name: '💱 Currency', value: c.currency + ' · ' + PRICE_MODES[c.priceMode], inline: true },
      { name: '🎮 Catalogue', value: c.state.offerCount + ' offers · ' + c.state.deliveries.length + ' messages\n' + c.stores.length + ' platforms · ' + c.types.length + ' types', inline: false },
      { name: '🕒 Updates', value: 'Last check: ' + statusTime(c.state.lastCheck) + '\nLast success: ' + statusTime(c.state.lastSuccess), inline: false },
    ];
    if (c.state.error || c.state.warning) embed.fields.push({ name: '⚠ Attention', value: escape(c.state.error || c.state.warning).slice(0, 1024), inline: false });
    controls = [componentRow(panelButton('updates:home:0', '📰 Game Updates')), nav, componentRow(panelButton('preview:0', '👁 Preview'), panelButton('refresh', '🔄 Refresh listing', 1, !c.enabled),
      panelButton('enabled', c.enabled ? 'Pause updates' : 'Enable updates', c.enabled ? 2 : 3),
      panelButton('home', 'Status'))];
  }
  return { content: null, embeds: [embed], components: [...controls, back], allowedMentions: { parse: [] } };
}
function regionalModal(guild, c = getConfig(guild.id)) {
  return { custom_id: PANEL_PREFIX + 'regionalSubmit', title: 'Free Games · Currency & Region',
    components: [['currency', 'Currency code (GBP, EUR, USD…)', 3], ['locale', 'Formatting locale (en-GB)', 40],
      ['timeZone', 'Timezone (Europe/London)', 80], ['region', 'Region code (GB)', 2]].map(([key, label, max_length]) =>
      componentRow({ type: 4, custom_id: key, label, style: 1, required: true, max_length, value: c[key] })) };
}

async function buildFeaturedPanel(guild, requestedPage = 0, notice = '') {
  const c = getConfig(guild.id);
  const { getOffers } = require('./freeGamesProviders');
  const { featuredCandidates, selectFeaturedOffer, shortTitle, escape } = require('./freeGamesEmbeds');
  const feed = await getOffers();
  const offers = filterOffers(feed.offers, c);
  const candidates = featuredCandidates(offers, c);
  const selected = selectFeaturedOffer(offers, c);
  const totalPages = Math.max(1, Math.ceil(candidates.length / 25));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const payload = buildAdminPanel(guild, 'display', notice, c);
  payload.embeds[0].title = '🎁 Free Games · Featured main game';
  payload.embeds[0].description = [notice && escape(notice),
    'One main game above the compact list, in the same embed. Automatic selection follows GamerPower’s popularity order among full games on the selected major stores. DLC, loot, demos and trials are excluded.',
    selected ? '**Current feature:** ' + escape(shortTitle(selected.title)) : 'No eligible main game is available.',
    'If a selected title expires or is filtered out, another eligible game is featured automatically.'].filter(Boolean).join('\n\n');
  const rows = [choiceMenu('featuredMode', 'Featured game selection', [['auto', 'Automatic main game'], ['manual', 'Selected main game'], ['off', 'No featured game']], [c.featuredMode])];
  if (candidates.length) rows.push(choiceMenu('featuredOfferId', 'Choose a main game · ' + (page + 1) + '/' + totalPages,
    candidates.slice(page * 25, page * 25 + 25).map(offer => [offer.id, shortTitle(offer.title).slice(0, 100)]), [c.featuredOfferId]));
  rows.push(choiceMenu('featuredArtwork', 'Featured artwork', [['thumbnail', 'Top-right artwork thumbnail'], ['hidden', 'Hide artwork']], [c.featuredArtwork]));
  if (totalPages > 1) rows.push(componentRow(panelButton('featured:' + Math.max(0, page - 1), '◀ Previous', 2, page === 0),
    panelButton('featured:' + (page + 1), 'Next ▶', 2, page === totalPages - 1)));
  rows.push(componentRow(panelButton('display', '⬅ Back')));
  return { ...payload, components: rows };
}

async function applySettings(guild, patch) {
  const monitor = require('./freeGamesMonitor');
  return monitor.withGuildLock(guild.id, async () => {
    const previous = getConfig(guild.id);
    const changes = validateSettings(patch, previous);
    if ({ ...previous, ...changes }.enabled) await monitor.validateDestination(guild, { ...previous, ...changes });
    return saveSettings(guild.id, changes);
  });
}
async function handleAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PANEL_PREFIX)) return false;
  const action = id.slice(PANEL_PREFIX.length);
  const guild = interaction.guild;
  const modalOpen = action === 'regional' || ['updates:add', 'updates:choose', 'updates:quiet'].includes(action) || /^updates:keywords:\d+$/.test(action);
  if (!modalOpen && !interaction.deferred && !interaction.replied) {
    if (interaction.isModalSubmit?.() && !interaction.isFromMessage?.()) await interaction.deferReply({ flags: 64 });
    else await interaction.deferUpdate();
  }
  const reply = async payload => {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
  };
  try {
    if (!guild) throw new Error('Open Free Games inside a server.');
    const security = require('../../../core/security/protection/core');
    const member = await guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
    if (!security.isBotOwner(interaction.user.id) && !member?.permissions.has(require('discord.js').PermissionFlagsBits.ManageGuild)) {
      const denied = { content: 'Manage Server permission is required to configure Free Games.', embeds: [], components: [], allowedMentions: { parse: [] } };
      if (modalOpen) await interaction.reply({ ...denied, flags: 64 }); else await reply(denied);
      return true;
    }
    if (action === 'regional') { await interaction.showModal(regionalModal(guild)); return true; }
    if (action.startsWith('updates:')) return await handleGameUpdatesInteraction(interaction, action.slice(8), reply);
    if (action === 'studio') { await reply(require('../../../core/administration/admin/modules').buildStudioPanel('utilityStudio', member?.displayName || interaction.user.username)); return true; }
    if (/^featured:\d+$/.test(action)) { await reply(await buildFeaturedPanel(guild, Number(action.split(':')[1]))); return true; }
    if (['home', 'delivery', 'filters', 'pricing', 'display'].includes(action)) { await reply(buildAdminPanel(guild, action)); return true; }
    if (/^preview:\d+$/.test(action)) {
      const { getOffers, getPricing } = require('./freeGamesProviders');
      const { buildListing, loadPlatformPresentation } = require('./freeGamesEmbeds');
      const c = getConfig(guild.id);
      const feed = await getOffers();
      const pricing = await getPricing(c);
      const pages = buildListing(filterOffers(feed.offers, c), { ...c, pricing, listingUpdatedAt: feed.fetchedAt }, Date.now(), await loadPlatformPresentation(guild.client, guild.id));
      const page = Math.min(Number(action.split(':')[1]), pages.length - 1);
      await reply({ ...pages[page], content: 'Preview only · saved server settings · no listing or notifications posted',
        components: [componentRow(panelButton('preview:' + Math.max(0, page - 1), '◀ Previous', 2, page === 0),
          panelButton('preview:' + (page + 1), 'Next ▶', 2, page === pages.length - 1)),
          componentRow(panelButton('home', '⬅ Back'))] });
      return true;
    }
    if (action === 'refresh') {
      const result = await require('./freeGamesMonitor').processGuild(guild);
      await reply(buildAdminPanel(guild, 'home', result.skipped ? 'Updates are paused.' : 'Listing refreshed.'));
      return true;
    }
    const c = getConfig(guild.id);
    let patch, page = 'home';
    if (action === 'regionalSubmit' && interaction.isModalSubmit?.()) {
      patch = Object.fromEntries(['currency', 'locale', 'timeZone', 'region'].map(key => [key, interaction.fields.getTextInputValue(key).trim()]));
      patch.currency = patch.currency.toUpperCase(); patch.region = patch.region.toUpperCase(); page = 'pricing';
    } else if (['channel', 'role'].includes(action) && (interaction.isChannelSelectMenu?.() || interaction.isRoleSelectMenu?.())) {
      patch = { [action === 'channel' ? 'channelId' : 'roleId']: interaction.values?.[0] || null }; page = 'delivery';
      if (patch.roleId) {
        const role = await guild.roles.fetch(patch.roleId);
        if (!role || role.id === guild.id || role.managed) throw new Error('Choose a regular notification role.');
      }
    } else if (['stores', 'types', 'layout', 'priceMode', 'displayOptions', 'featuredMode', 'featuredOfferId', 'featuredArtwork'].includes(action) && interaction.isStringSelectMenu?.()) {
      if (action === 'displayOptions') {
        if ((interaction.values || []).some(key => !Object.hasOwn(DISPLAY_OPTIONS, key))) throw new Error('Invalid display option.');
        patch = Object.fromEntries(Object.keys(DISPLAY_OPTIONS).map(key => [key, interaction.values.includes(key)]));
      } else patch = { [action]: ['stores', 'types'].includes(action) ? interaction.values : interaction.values[0] };
      page = ['stores', 'types'].includes(action) ? 'filters' : action === 'priceMode' ? 'pricing' : 'display';
    } else if (['enabled', 'alerts'].includes(action) && interaction.isButton?.()) {
      // Read the latest value inside the delivery lock so concurrent toggles cannot overwrite each other.
      const monitor = require('./freeGamesMonitor');
      await monitor.withGuildLock(guild.id, async () => {
        const current = getConfig(guild.id), changes = validateSettings({ [action]: !current[action] }, current);
        if ({ ...current, ...changes }.enabled) await monitor.validateDestination(guild, { ...current, ...changes });
        saveSettings(guild.id, changes);
      });
      await reply(buildAdminPanel(guild, action === 'alerts' ? 'delivery' : 'home', 'Settings saved.')); return true;
    } else throw new Error('This control is unavailable. Reopen Free Games from Utility Studio.');
    if (action === 'featuredOfferId') patch.featuredMode = 'manual';
    await applySettings(guild, patch);
    if (action.startsWith('featured')) { await reply(await buildFeaturedPanel(guild, 0, 'Settings saved.')); return true; }
    await reply(buildAdminPanel(guild, page, 'Settings saved. The listing updates within five minutes.'));
  } catch (error) {
    const { escape } = require('./freeGamesEmbeds');
    if (modalOpen && !interaction.deferred && !interaction.replied) await interaction.reply({ content: escape(error.message).slice(0, 1500), flags: 64, allowedMentions: { parse: [] } });
    else if (guild) await reply(buildAdminPanel(guild, 'home', 'Unable to apply change: ' + error.message));
    else await reply({ content: 'Open Free Games inside a server.', embeds: [], components: [] });
  }
  return true;
}
module.exports = { MODULE_KEY, MODULE_NAME, DEFAULTS, DISPLAY_OPTIONS, PRICE_MODES, getConfig, update, filterOffers, validateSettings, saveSettings,
  applySettings, buildAdminPanel, buildFeaturedPanel, regionalModal, handleAdminInteraction };


const UPDATE_DEFAULTS = Object.freeze({ enabled: false, quietStart: null, quietEnd: null, subscriptions: {}, history: [] });
function getGameUpdates(guildId) {
  const raw = getModuleSection(guildId, MODULE_KEY, DEFAULTS).gameUpdates || {};
  return { ...structuredClone(UPDATE_DEFAULTS), ...raw, subscriptions: { ...(raw.subscriptions || {}) }, history: Array.isArray(raw.history) ? raw.history : [] };
}
function updateGameUpdates(guildId, fn) {
  let result;
  update(guildId, current => {
    result = fn(getGameUpdates(guildId));
    return { ...current, gameUpdates: result };
  });
  return result;
}
function validateUpdateSettings(input, current) {
  const next = { ...current };
  if (Object.hasOwn(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') throw new Error('Updates enabled must be true or false.');
    next.enabled = input.enabled;
  }
  for (const key of ['quietStart', 'quietEnd']) if (Object.hasOwn(input, key)) {
    if (input[key] !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input[key])) throw new Error('Use 24-hour quiet-hour times, such as 22:00.');
    next[key] = input[key];
  }
  if (Boolean(next.quietStart) !== Boolean(next.quietEnd) || (next.quietStart && next.quietStart === next.quietEnd)) throw new Error('Choose different start and end times, or clear both.');
  return next;
}
function keywordList(value) {
  if (typeof value === 'string') { if (value.length > 500) throw new Error('Keyword list is too long.'); value = value.split(','); }
  if (!Array.isArray(value) || value.length > 10 || value.some(word => typeof word !== 'string' || word.length > 50)) throw new Error('Use up to ten keywords, separated by commas.');
  return [...new Set(value.map(word => word.trim().toLowerCase()).filter(Boolean))];
}
function normalizeUpdateSubscription(input, previous = {}) {
  const { steamAppId, UPDATE_CATALOG } = require('./freeGamesProviders');
  const appId = steamAppId(input.appId || previous.appId);
  const next = { appId, name: UPDATE_CATALOG.find(game => game.appId === appId)?.name || 'Steam game ' + appId,
    channelId: null, roleId: null, enabled: false, filter: 'patches', artwork: 'banner', detail: 'compact', includeWords: [], excludeWords: [],
    seenIds: [], pending: [], initialized: false, lastCheck: null, lastSuccess: null, error: null, ...previous, appId };
  if (Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Use a game name between 1 and 100 characters.');
    next.name = input.name.trim();
  }
  for (const key of ['channelId', 'roleId']) if (Object.hasOwn(input, key)) {
    if (input[key] !== null && (typeof input[key] !== 'string' || !/^\d{16,20}$/.test(input[key]))) throw new Error('Choose a valid channel or role.');
    next[key] = input[key];
  }
  if (Object.hasOwn(input, 'enabled')) {
    if (typeof input.enabled !== 'boolean') throw new Error('Subscription enabled must be true or false.');
    next.enabled = input.enabled;
  }
  for (const [key, values] of Object.entries({ filter: ['all', 'patches', 'announcements'], artwork: ['banner', 'thumbnail', 'hidden'], detail: ['compact', 'detailed'] })) {
    if (Object.hasOwn(input, key)) { if (!values.includes(input[key])) throw new Error('Invalid ' + key + ' selection.'); next[key] = input[key]; }
  }
  for (const key of ['includeWords', 'excludeWords']) if (Object.hasOwn(input, key)) next[key] = keywordList(input[key]);
  if (next.enabled && !next.channelId) throw new Error('Choose a destination channel before enabling this subscription.');
  return next;
}
function matchesGameUpdate(item, subscription) {
  if (subscription.filter !== 'all' && item.kind !== subscription.filter) return false;
  const text = (item.title + ' ' + item.description).toLowerCase();
  return (!subscription.includeWords.length || subscription.includeWords.some(word => text.includes(word))) &&
    !subscription.excludeWords.some(word => text.includes(word));
}
Object.assign(module.exports, { UPDATE_DEFAULTS, getGameUpdates, updateGameUpdates, validateUpdateSettings, normalizeUpdateSubscription, matchesGameUpdate });


function buildUpdatesPanel(guild, page = 0, notice = '') {
  const config = getGameUpdates(guild.id), { escape, SECTIONS } = require('./freeGamesEmbeds');
  const subscriptions = Object.values(config.subscriptions).sort((a, b) => a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(subscriptions.length / 25)); page = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const embed = { title: '📰 Games · Game Updates', color: SECTIONS[2].color,
    description: [notice && escape(notice), config.enabled ? '🟢 Automatic updates enabled' : '⏸ Automatic updates paused',
      'Follow Steam publisher announcements. Choose a game, its destination and the updates you want. New subscriptions start with the next announcement.'].filter(Boolean).join('\n\n'),
    fields: [{ name: 'Subscriptions', value: subscriptions.length + ' games · ' + subscriptions.filter(sub => sub.enabled).length + ' active', inline: true },
      { name: 'Quiet hours', value: config.quietStart ? config.quietStart + '–' + config.quietEnd + ' · ' + getConfig(guild.id).timeZone : 'Off', inline: true }],
    footer: { text: 'Games · Game Updates · ' + (page + 1) + '/' + pages }, timestamp: new Date().toISOString() };
  const rows = [componentRow(panelButton('updates:toggle', config.enabled ? 'Pause updates' : 'Enable updates', config.enabled ? 2 : 3),
    panelButton('updates:check', 'Check now'), panelButton('updates:quiet', 'Quiet hours'))];
  if (subscriptions.length) rows.push(choiceMenu('updates:select', 'Choose a subscribed game', subscriptions.slice(page * 25, page * 25 + 25).map(sub => [sub.appId, (sub.enabled ? '▶ ' : '⏸ ') + sub.name])));
  rows.push(componentRow(panelButton('updates:catalog', 'Browse games'), panelButton('updates:add', 'Add Steam game')));
  if (pages > 1) rows.push(componentRow(panelButton('updates:home:' + Math.max(0, page - 1), '◀ Previous', 2, page === 0), panelButton('updates:home:' + (page + 1), 'Next ▶', 2, page === pages - 1)));
  rows.push(componentRow(panelButton('home', '⬅ Back to Games')));
  return { content: null, embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
function buildUpdateSubscriptionPanel(guild, appId, notice = '', more = false) {
  const sub = getGameUpdates(guild.id).subscriptions[appId];
  if (!sub) return buildUpdatesPanel(guild, 0, 'Game subscription no longer exists.');
  const { escape, SECTIONS } = require('./freeGamesEmbeds');
  const embed = { title: '📰 ' + sub.name, color: SECTIONS[2].color,
    description: [notice && escape(notice), sub.enabled ? '▶ Subscription enabled' : '⏸ Subscription paused',
      sub.error && '⚠ ' + escape(sub.error)].filter(Boolean).join('\n\n'),
    fields: [{ name: 'Destination', value: sub.channelId ? '<#' + sub.channelId + '>' : 'Choose a channel', inline: true },
      { name: 'Notification role', value: sub.roleId ? '<@&' + sub.roleId + '>' : 'No role ping', inline: true },
      { name: 'Updates', value: 'Filter: ' + sub.filter + '\nLast check: ' + statusTime(sub.lastCheck) + '\nLast delivery: ' + statusTime(sub.lastSuccess) + '\nQueued: ' + sub.pending.length, inline: false }],
    footer: { text: 'Games · Steam publisher announcements' }, timestamp: new Date().toISOString() };
  const back = componentRow(panelButton('updates:home:0', '⬅ Back'), panelButton('updates:preview:' + appId, 'Preview'),
    panelButton('updates:send:' + appId, 'Send latest'), panelButton('updates:' + (more ? 'game:' : 'more:') + appId, more ? 'Delivery' : 'Display & filters'));
  const rows = more ? [
    choiceMenu('updates:artwork:' + appId, 'Artwork', [['banner', 'Large artwork'], ['thumbnail', 'Thumbnail'], ['hidden', 'No artwork']], [sub.artwork]),
    choiceMenu('updates:detail:' + appId, 'Text length', [['compact', 'Compact summary'], ['detailed', 'Detailed summary']], [sub.detail]),
    componentRow(panelButton('updates:keywords:' + appId, 'Keyword filters'), panelButton('updates:retry-view:' + appId, 'Retry held')),
    back,
  ] : [
    componentRow(panelButton('updates:enabled:' + appId, sub.enabled ? 'Pause' : 'Enable', sub.enabled ? 2 : 3), panelButton('updates:remove-view:' + appId, 'Unsubscribe', 4)),
    componentRow({ type: 8, custom_id: PANEL_PREFIX + 'updates:channel:' + appId, placeholder: 'Destination channel', channel_types: [0, 5], min_values: 0, max_values: 1, ...(sub.channelId ? { default_values: [{ id: sub.channelId, type: 'channel' }] } : {}) }),
    componentRow({ type: 6, custom_id: PANEL_PREFIX + 'updates:role:' + appId, placeholder: 'Optional notification role', min_values: 0, max_values: 1, ...(sub.roleId ? { default_values: [{ id: sub.roleId, type: 'role' }] } : {}) }),
    choiceMenu('updates:filter:' + appId, 'Announcement filter', [['patches', 'Patch / update titles'], ['all', 'All publisher announcements'], ['announcements', 'Other announcements']], [sub.filter]),
    back,
  ];
  return { content: null, embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}
async function handleGameUpdatesInteraction(i, action, reply) {
  const guild = i.guild, monitor = require('./freeGamesMonitor'), providers = require('./freeGamesProviders');
  const [kind, argument] = action.split(':');
  if (kind === 'home') { await reply(buildUpdatesPanel(guild, Number(argument || 0))); return true; }
  if (kind === 'game' || kind === 'more') { await reply(buildUpdateSubscriptionPanel(guild, providers.steamAppId(argument), '', kind === 'more')); return true; }
  if (kind === 'select') { await reply(buildUpdateSubscriptionPanel(guild, providers.steamAppId(i.values[0]))); return true; }
  if (kind === 'catalog') {
    const payload = buildUpdatesPanel(guild);
    payload.embeds[0].description = 'Choose a game, or use Add Steam game for another App ID. Sources are Steam publisher announcements; titles outside Steam need another verified source.';
    payload.components = [choiceMenu('updates:choose', 'Starter game catalogue', providers.UPDATE_CATALOG.map(game => [game.appId, game.name])),
      componentRow(panelButton('updates:add', 'Add Steam game'), panelButton('updates:home:0', '⬅ Back'))];
    await reply(payload); return true;
  }
  if (kind === 'add' || kind === 'choose') {
    const selected = providers.UPDATE_CATALOG.find(game => game.appId === i.values?.[0]);
    await i.showModal({ custom_id: PANEL_PREFIX + 'updates:add-submit', title: 'Follow a Steam game', components: [
      componentRow({ type: 4, custom_id: 'appId', label: 'Steam App ID or Steam store URL', style: 1, required: true, max_length: 180, ...(selected ? { value: selected.appId } : {}) }),
      componentRow({ type: 4, custom_id: 'name', label: 'Game name', style: 1, required: true, max_length: 100, ...(selected ? { value: selected.name } : {}) }),
    ] }); return true;
  }
  if (kind === 'add-submit') {
    const appId = providers.steamAppId(i.fields.getTextInputValue('appId'));
    if (getGameUpdates(guild.id).subscriptions[appId]) { await reply(buildUpdateSubscriptionPanel(guild, appId, 'This game is already followed.')); return true; }
    await monitor.saveGameSubscription(guild, { appId, name: i.fields.getTextInputValue('name'), enabled: false });
    await reply(buildUpdateSubscriptionPanel(guild, appId, 'Game added. Choose a channel, then enable the subscription.')); return true;
  }
  if (kind === 'toggle') {
    await monitor.configureGameUpdates(guild, { enabled: !getGameUpdates(guild.id).enabled }); await reply(buildUpdatesPanel(guild)); return true;
  }
  if (kind === 'check') {
    const result = await monitor.processGameUpdates(guild);
    await reply(buildUpdatesPanel(guild, 0, result.skipped ? 'Automatic updates are paused.' : 'Check complete. Delivered ' + result.delivered + ' updates.')); return true;
  }
  if (kind === 'quiet') {
    const c = getGameUpdates(guild.id);
    await i.showModal({ custom_id: PANEL_PREFIX + 'updates:quiet-submit', title: 'Quiet hours', components: [
      componentRow({ type: 4, custom_id: 'start', label: 'Start (HH:mm); clear both to disable', style: 1, required: false, max_length: 5, ...(c.quietStart ? { value: c.quietStart } : {}) }),
      componentRow({ type: 4, custom_id: 'end', label: 'End (HH:mm), using server timezone', style: 1, required: false, max_length: 5, ...(c.quietEnd ? { value: c.quietEnd } : {}) }),
    ] }); return true;
  }
  if (kind === 'quiet-submit') {
    await monitor.configureGameUpdates(guild, { quietStart: i.fields.getTextInputValue('start').trim() || null, quietEnd: i.fields.getTextInputValue('end').trim() || null });
    await reply(buildUpdatesPanel(guild, 0, 'Quiet hours saved.')); return true;
  }
  const appId = providers.steamAppId(argument), sub = getGameUpdates(guild.id).subscriptions[appId];
  if (!sub) throw new Error('Choose a current game subscription.');
  if (kind === 'preview') {
    const { payload } = await monitor.previewGameUpdate(guild, appId);
    await reply({ ...payload, content: 'Preview only · no announcement or role notification posted',
      components: [...payload.components, componentRow(panelButton('updates:game:' + appId, '⬅ Back'))] }); return true;
  }
  if (kind === 'send') {
    const result = await monitor.sendLatestGameUpdate(guild, appId);
    await reply(buildUpdateSubscriptionPanel(guild, appId, result.alreadyDelivered ? 'The latest matching update was already delivered.' : 'Latest update processed without a role ping.')); return true;
  }
  if (kind === 'remove-view' || kind === 'retry-view') {
    const payload = buildUpdateSubscriptionPanel(guild, appId);
    payload.embeds[0].description = kind === 'remove-view' ? 'Unsubscribe from this game? Existing messages and delivery history will be kept.' :
      'Inspect the destination channel first. Retry held checks for an existing message, then retries unresolved deliveries without a role ping.';
    payload.components = [componentRow(panelButton('updates:' + (kind === 'remove-view' ? 'remove:' : 'retry:') + appId, kind === 'remove-view' ? 'Confirm unsubscribe' : 'Retry held', 4),
      panelButton('updates:game:' + appId, 'Cancel'))]; await reply(payload); return true;
  }
  if (kind === 'remove') { await monitor.removeGameSubscription(guild, appId); await reply(buildUpdatesPanel(guild, 0, 'Game unsubscribed.')); return true; }
  if (kind === 'retry') { await monitor.retryHeldGameUpdates(guild, appId); await reply(buildUpdateSubscriptionPanel(guild, appId, 'Held deliveries reviewed.')); return true; }
  if (kind === 'keywords') {
    await i.showModal({ custom_id: PANEL_PREFIX + 'updates:keywords-submit:' + appId, title: 'Announcement keyword filters', components: [
      componentRow({ type: 4, custom_id: 'include', label: 'Include any of these (comma-separated)', style: 2, required: false, max_length: 500, ...(sub.includeWords.length ? { value: sub.includeWords.join(', ') } : {}) }),
      componentRow({ type: 4, custom_id: 'exclude', label: 'Exclude any of these (comma-separated)', style: 2, required: false, max_length: 500, ...(sub.excludeWords.length ? { value: sub.excludeWords.join(', ') } : {}) }),
    ] }); return true;
  }
  let patch = { appId };
  if (kind === 'keywords-submit') { patch.includeWords = i.fields.getTextInputValue('include'); patch.excludeWords = i.fields.getTextInputValue('exclude'); }
  else if (kind === 'enabled') patch.enabled = !sub.enabled;
  else if (kind === 'channel') patch.channelId = i.values?.[0] || null;
  else if (kind === 'role') patch.roleId = i.values?.[0] || null;
  else if (['filter', 'artwork', 'detail'].includes(kind)) patch[kind] = i.values[0];
  else throw new Error('Unknown Game Updates control.');
  await monitor.saveGameSubscription(guild, patch);
  await reply(buildUpdateSubscriptionPanel(guild, appId, 'Settings saved.', ['keywords-submit', 'artwork', 'detail'].includes(kind))); return true;
}
Object.assign(module.exports, { buildUpdatesPanel, buildUpdateSubscriptionPanel });
