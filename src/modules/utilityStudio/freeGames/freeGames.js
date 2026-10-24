'use strict';
const guildManager = require('../../../core/guild/guildManager');
const { getModuleSection, updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { STORES, TYPES, CURRENCIES } = require('./freeGamesProviders');
const MODULE_KEY = 'freeGames';
const DEFAULTS = { enabled: false, currency: 'GBP', priceMode: 'converted', locale: 'en-GB', timeZone: 'Europe/London', region: 'GB', layout: 'columns', showTimestamps: true, showExpiry: true, showPlatforms: true, showNew: true, showOfferCount: true, channelId: null, stores: Object.keys(STORES), types: ['game'], alerts: false, roleId: null, state: { firstSeen: {}, newSince: {}, observed: {}, deliveries: [], retired: [], initialized: false, lastCheck: null, lastSuccess: null, error: null, offerCount: 0, pricing: null, warning: null } };
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
  showTimestamps: 'Footer timestamps', showExpiry: 'Offer expiry',
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
  const embed = { title: '🎁 Free Games', color: SECTIONS[0].color,
    description: [notice && escape(notice), c.enabled ? '🟢 Enabled' : '⏸ Paused'].filter(Boolean).join('\n\n'),
    fields: [], footer: { text: 'Goliath Free Games · Management' }, timestamp: new Date().toISOString() };
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
    controls = [nav, componentRow(panelButton('preview:0', '👁 Preview'), panelButton('refresh', '🔄 Refresh listing', 1, !c.enabled),
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
  const modalOpen = action === 'regional';
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
    if (modalOpen) { await interaction.showModal(regionalModal(guild)); return true; }
    if (action === 'studio') { await reply(require('../../../core/administration/admin/modules').buildStudioPanel('utilityStudio', member?.displayName || interaction.user.username)); return true; }
    if (['home', 'delivery', 'filters', 'pricing', 'display'].includes(action)) { await reply(buildAdminPanel(guild, action)); return true; }
    if (/^preview:\d+$/.test(action)) {
      const { getOffers, getPricing } = require('./freeGamesProviders');
      const { buildListing, platformPresentation } = require('./freeGamesEmbeds');
      const c = getConfig(guild.id);
      const feed = await getOffers();
      const pricing = await getPricing(c);
      const pages = buildListing(filterOffers(feed.offers, c), { ...c, pricing, listingUpdatedAt: feed.fetchedAt }, Date.now(), platformPresentation(guild.client));
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
    } else if (['stores', 'types', 'layout', 'priceMode', 'displayOptions'].includes(action) && interaction.isStringSelectMenu?.()) {
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
    await applySettings(guild, patch);
    await reply(buildAdminPanel(guild, page, 'Settings saved. The listing updates within five minutes.'));
  } catch (error) {
    const { escape } = require('./freeGamesEmbeds');
    if (modalOpen && !interaction.deferred && !interaction.replied) await interaction.reply({ content: escape(error.message).slice(0, 1500), flags: 64, allowedMentions: { parse: [] } });
    else if (guild) await reply(buildAdminPanel(guild, 'home', 'Unable to apply change: ' + error.message));
    else await reply({ content: 'Open Free Games inside a server.', embeds: [], components: [] });
  }
  return true;
}
module.exports = { MODULE_KEY, DEFAULTS, DISPLAY_OPTIONS, PRICE_MODES, getConfig, update, filterOffers, validateSettings, saveSettings,
  applySettings, buildAdminPanel, regionalModal, handleAdminInteraction };
