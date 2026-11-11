'use strict';
const { EMOJIS, emojiLabel } = require('../../../core/ui/emojis');
const { navigationButton, linkButton } = require('../../../core/guild/goliathNavigation');

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const emojiApi = require('./emojisApi');
const emojiMedia = require('./emojiMedia');
const giphyApi = require('./giphyApi');
const emojis = require('./emojis');
const emojiStore = require('./emojisStore');

const PANEL_COLOR = 0x5865F2;
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label, style = ButtonStyle.Primary) => navigationButton(id, label, style);


const manageFilters = new Map();
function manageFilterKey(interaction) { return `${interaction.guild?.id || interaction.guildId || 'unknown'}:${interaction.user?.id || 'unknown'}`; }
function currentManageFilter(interaction) { const value = manageFilters.get(manageFilterKey(interaction)); return value === 'static' || value === 'animated' ? value : 'all'; }
function setManageFilter(interaction, value) { const filter = value === 'static' || value === 'animated' ? value : 'all'; manageFilters.set(manageFilterKey(interaction), filter); return filter; }


function memberName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
async function discordOverview(interaction) { if (!interaction?.guild?.id || !interaction?.client) throw new Error('Emoji & GIF Studio requires a server interaction.'); return emojis.overview(interaction.client, interaction.guild.id); }

function mainEmbed(overview, interaction, notice = '') {
  return new EmbedBuilder().setColor(overview.enabled ? 0x57F287 : PANEL_COLOR).setTitle(emojiLabel('UTILITY_ANIMATED_EMOJI', 'Emoji & GIF Studio')).setDescription([
    'Give your community a shared library of static emojis and animated GIFs without filling this server\'s normal emoji slots. Goliath handles optimisation and animation automatically.', '',
    `**Emoji & GIF Studio:** ${overview.enabled ? 'On ✅' : 'Off ❌'}`,
    `**Your Emojis & GIFs:** ${overview.guildCapacity.used} / ${overview.guildCapacity.max}`,
    `**Built-in Library:** ${overview.coreCapacity.used} / ${overview.coreCapacity.max}`,
    `**Status:** ${overview.health?.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`,
    notice ? `\n${notice}` : '',
  ].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp();
}

async function buildDiscordPanel(interaction, notice = '') {
  const overview = await discordOverview(interaction);
  return { embeds: [mainEmbed(overview, interaction, notice)], components: [
    row(button('admin:module:emojis:add', emojiLabel('ADD', 'Add Emoji'), ButtonStyle.Primary).setDisabled(!overview.enabled), button('admin:module:emojis:gif-upload-open', emojiLabel('UTILITY_ANIMATION', 'Add GIF'), ButtonStyle.Success).setDisabled(!overview.enabled), button('admin:module:emojis:guild', emojiLabel('USER_STARBOARD', 'Manage Library'), ButtonStyle.Primary)),
    row(button('admin:studio:utilityStudio', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary), button('admin:module:emojis:settings', emojiLabel('MODERATION_DASHBOARD', 'Settings'), ButtonStyle.Secondary)),
  ] };
}

function addPanel(interaction) {
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('ADD', 'Add Emoji')).setDescription([
    'Add static emojis to this server. Animated media is handled separately through the **Add GIF** button on the main panel.', '',
    '**Browse Emojis** — search the online emoji collection.',
    '**Upload Emoji** — add a static image from your device.',
    '**Add Image Link** — paste a direct static image link.',
  ].join('\n')).setFooter({ text: 'Requested by ' + memberName(interaction) })], components: [
    row(button('admin:module:emojis:search-open', emojiLabel('INVESTIGATE', 'Browse Emojis'), ButtonStyle.Primary), button('admin:module:emojis:bulk-open', emojiLabel('MEDIA', 'Upload Emoji'), ButtonStyle.Primary), button('admin:module:emojis:import-url-open', emojiLabel('AUTOMOD_LINKS', 'Add Image Link'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:panel', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary), button('admin:module:emojis:settings', emojiLabel('MODERATION_DASHBOARD', 'Settings'), ButtonStyle.Secondary)),
  ] };
}

function gifPanel(interaction) {
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('UTILITY_ANIMATION', 'Add GIF')).setDescription([
    'Add animated GIFs and other supported animated media to this server. Static images are handled separately through the **Add Emoji** button on the main panel.', '',
    '**Browse GIFs** — search GIPHY for animated GIF discovery.',
    '**Upload GIF** — add an animated file from your device.',
    '**Add GIF Link** — paste a direct animated media link.',
  ].join('\n')).setFooter({ text: 'Requested by ' + memberName(interaction) })], components: [
    row(button('admin:module:emojis:gif-search-open', emojiLabel('INVESTIGATE', 'Browse GIFs'), ButtonStyle.Success), button('admin:module:emojis:gif-upload-file-open', emojiLabel('UTILITY_ANIMATION', 'Upload GIF'), ButtonStyle.Success), button('admin:module:emojis:gif-import-url-open', emojiLabel('AUTOMOD_LINKS', 'Add GIF Link'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:panel', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary), button('admin:module:emojis:settings', emojiLabel('MODERATION_DASHBOARD', 'Settings'), ButtonStyle.Secondary)),
  ] };
}

function settingsPanel(overview, interaction, notice = '') {
  const top = (overview.usage || []).filter((entry) => entry.count > 0).slice(0, 5);
  const health = overview.health || {};
  const attention = (health.brokenFavourites?.length || 0) + (health.brokenAliases?.length || 0) + (health.brokenPackEntries?.length || 0) + (health.expiredTemporary?.length || 0);
  return { embeds: [new EmbedBuilder().setColor(health.healthy ? 0x57F287 : 0xFEE75C).setTitle(emojiLabel('MODERATION_DASHBOARD', 'Emoji & GIF Studio Settings')).setDescription([
    'Control Emoji & GIF Studio and keep static and animated media running smoothly.', '',
    `**Emoji & GIF Studio:** ${overview.enabled ? 'On ✅' : 'Off ❌'}`,
    `**Status:** ${health.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`,
    `**Library space used:** ${overview.forecast?.used || 0}/${overview.forecast?.max || 2000}`,
    `**Items needing attention:** ${attention}`,
    notice ? `\n${notice}` : '', '', '**Most used emojis & GIFs**',
    ...(top.length ? top.map((entry) => `• \`:${entry.emoji.alias || entry.emoji.name}:\` — ${entry.count} uses`) : ['No usage has been tracked yet.']),
  ].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp()], components: [
    row(button('admin:module:emojis:storage', emojiLabel('ADMIN_PURGE', 'Manage Storage'), ButtonStyle.Primary), button('admin:module:emojis:health', emojiLabel('WELCOME_DIAGNOSTICS', 'Check for Problems'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:export', emojiLabel('WELCOME_PRESET', 'Backup Settings'), ButtonStyle.Secondary), button('admin:module:emojis:toggle', overview.enabled ? emojiLabel('USER_PAUSE', 'Turn Off Studio') : emojiLabel('USER_PLAY', 'Turn On Studio'), overview.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)),
    row(button('admin:module:emojis:panel', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}

function storagePanel(interaction) {
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('ADMIN_PURGE', 'Manage Emoji & GIF Storage')).setDescription([
    'Keep your available emoji and GIF library tidy.', '',
    '**Find Unused** — see emojis or GIFs that are not being used.',
    '**Find Duplicates** — find matching static or animated media taking up extra space.',
  ].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` })], components: [
    row(button('admin:module:emojis:cleanup', emojiLabel('ADMIN_PURGE', 'Find Unused'), ButtonStyle.Secondary), button('admin:module:emojis:duplicates', emojiLabel('UTILITY_GROUP', 'Find Duplicates'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:settings', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}

function emojiPreviewUrl(emoji) {
  if (!emoji?.id) return null;
  const animated = emoji.animated ? '&animated=true' : '';
  return `https://cdn.discordapp.com/emojis/${emoji.id}.webp?size=256${animated}`;
}

function managePanel(overview, interaction, selectedKey = '', notice = '') {
  const filter = currentManageFilter(interaction);
  const selectedIds = new Set(overview.effectiveFavourites || []);
  const matchesFilter = (animated) => filter === 'all' || (filter === 'animated' ? Boolean(animated) : !animated);
  const extras = (overview.catalog || []).filter((emoji) => !emoji.core && matchesFilter(emoji.animated)).sort((a, b) => Number(selectedIds.has(String(b.id))) - Number(selectedIds.has(String(a.id))) || String(a.name || '').localeCompare(String(b.name || '')));
  const builtIns = (overview.coreStatus || []).filter((entry) => entry.installed && entry.emoji && matchesFilter(entry.animated ?? entry.emoji?.animated));
  const extraOptions = extras.slice(0, 25).map((emoji) => ({ label: `:${emoji.name}:`.slice(0, 100), value: `extra:${emoji.id}`, description: `${emoji.animated ? emojiLabel('UTILITY_ANIMATION', 'Animated') : emojiLabel('MEDIA', 'Static')} • ${selectedIds.has(String(emoji.id)) ? 'Added' : 'Available'}`.slice(0, 100), emoji: emoji.component || undefined }));
  const coreOptions = builtIns.slice(0, 25).map((entry) => ({ label: `:${entry.alias}:`.slice(0, 100), value: `core:${entry.alias}`, description: `${entry.animated ? emojiLabel('UTILITY_ANIMATION', 'Animated') : emojiLabel('UTILITY_DIAMOND', 'Built-in')} • always available`.slice(0, 100), emoji: entry.emoji?.component || undefined }));
  let chosen = null; let isCore = false;
  if (selectedKey.startsWith('extra:')) chosen = extras.find((emoji) => String(emoji.id) === selectedKey.slice(6)) || null;
  if (selectedKey.startsWith('core:')) { isCore = true; const alias = selectedKey.slice(5); const entry = builtIns.find((item) => item.alias === alias); const catalogEntry = (overview.catalog || []).find((emoji) => emoji.core && String(emoji.alias || emoji.name) === alias); chosen = entry ? { ...catalogEntry, ...entry.emoji, alias: entry.alias, mention: entry.mention || entry.emoji.mention } : null; }
  const chosenAdded = chosen && !isCore ? selectedIds.has(String(chosen.id)) : false;
  const shortcode = chosen ? String(chosen.alias || chosen.name || 'emoji') : '';
  const previewLines = chosen ? [`${chosen.mention || `:${shortcode}:`}  **:${shortcode}:**`, `**Type:** ${chosen.animated ? emojiLabel('UTILITY_ANIMATION', 'Animated') : emojiLabel('MEDIA', 'Static')}`, `**Status:** ${isCore ? `Built-in • always available ${EMOJIS.EMOJI_CORE}` : (chosenAdded ? `Added to this server ${EMOJIS.SUCCESS}` : 'Available to add')}`, `**Type this:** \`:${shortcode}:\``, ...(!isCore && chosen.category ? [`**Category:** ${chosen.category}`] : []), ...(!isCore && Array.isArray(chosen.tags) && chosen.tags.length ? [`**Tags:** ${chosen.tags.join(', ')}`] : []), `**Used:** ${chosen.usage?.count || 0} time(s)`, ...(isCore ? ['', 'Included with Goliath and always available in this server.'] : [])] : [`Showing **${filter === 'all' ? 'All' : filter === 'animated' ? 'Animated' : 'Static'}** emojis. Choose one below to preview and manage it.`];
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('USER_STARBOARD', 'Manage Emojis & GIFs')).setDescription([`**Your emoji & GIF library:** ${overview.guildCapacity.used}/${overview.guildCapacity.max}`, `**Built-in library:** ${overview.coreCapacity.used}/${overview.coreCapacity.max} always available`, `**Filter:** ${filter === 'all' ? 'All' : filter === 'animated' ? emojiLabel('UTILITY_ANIMATION', 'Animated') : emojiLabel('MEDIA', 'Static')}`, '', ...previewLines, notice ? `\n${notice}` : ''].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` });
  const previewUrl = emojiPreviewUrl(chosen); if (previewUrl) embed.setThumbnail(previewUrl);
  const components = [];
  components.push(row(
    button('admin:module:emojis:manage-filter:all', 'All', filter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button('admin:module:emojis:manage-filter:static', emojiLabel('MEDIA', 'Static'), filter === 'static' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button('admin:module:emojis:manage-filter:animated', emojiLabel('UTILITY_ANIMATION', 'Animated'), filter === 'animated' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  ));
  if (extraOptions.length) components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:manage-extra-select').setPlaceholder(filter === 'all' ? 'Your & available emojis / GIFs' : `${filter === 'animated' ? 'Animated' : 'Static'} emojis`).addOptions(extraOptions)));
  if (coreOptions.length) components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:manage-core-select').setPlaceholder(filter === 'all' ? 'Built-in emojis / GIFs' : `Built-in ${filter} emojis`).addOptions(coreOptions)));
  if (chosen && !isCore) components.push(row(chosenAdded ? button(`admin:module:emojis:manage-remove:${chosen.id}`, emojiLabel('REMOVE', 'Remove from Server'), ButtonStyle.Secondary) : button(`admin:module:emojis:manage-add:${chosen.id}`, emojiLabel('ADD', 'Add to Server'), ButtonStyle.Success), button(`admin:module:emojis:delete-open:${chosen.id}`, emojiLabel('DELETE', 'Delete Item'), ButtonStyle.Danger)));
  components.push(row(button('admin:module:emojis:panel', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

function deleteConfirmPanel(emoji, interaction) {
  const name = String(emoji?.name || 'emoji'); const mention = emoji?.mention || `:${name}:`;
  const embed = new EmbedBuilder().setColor(0xED4245).setTitle(emojiLabel('DELETE', 'Delete Emoji / GIF?')).setDescription([`${mention}  **:${name}:**`, `**Type:** ${emoji?.animated ? emojiLabel('UTILITY_ANIMATION', 'Animated') : emojiLabel('MEDIA', 'Static')}`, '', 'This permanently deletes this emoji or GIF from Goliath’s available media library.', 'Servers will no longer be able to add it again unless the media is imported or uploaded again.', '', '**Built-in emojis and GIFs cannot be deleted.**'].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` });
  const previewUrl = emojiPreviewUrl(emoji); if (previewUrl) embed.setThumbnail(previewUrl);
  return { embeds: [embed], components: [row(button(`admin:module:emojis:delete-confirm:${emoji.id}`, emojiLabel('DELETE', 'Delete Permanently'), ButtonStyle.Danger), button(`admin:module:emojis:delete-cancel:${emoji.id}`, 'Cancel', ButtonStyle.Secondary)), row(button('admin:module:emojis:guild', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] };
}

function searchModal() { return new ModalBuilder().setCustomId('admin:module:emojis:search-submit').setTitle('Search Emojis').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('What emoji are you looking for?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))); }
function gifSearchModal() { return new ModalBuilder().setCustomId('admin:module:emojis:gif-search-submit').setTitle('Search GIFs').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('What GIF are you looking for?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))); }
function urlImportModal() { return new ModalBuilder().setCustomId('admin:module:emojis:import-url-submit').setTitle('Add Emoji from Image Link').addComponents(row(new TextInputBuilder().setCustomId('imageUrl').setLabel('Static image link').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1000)), row(new TextInputBuilder().setCustomId('name').setLabel('Emoji name (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32))); }
function gifUrlImportModal() { return new ModalBuilder().setCustomId('admin:module:emojis:gif-import-url-submit').setTitle('Add GIF from Link').addComponents(row(new TextInputBuilder().setCustomId('imageUrl').setLabel('GIF / animated media link').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1000)), row(new TextInputBuilder().setCustomId('name').setLabel('GIF name (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32))); }
function bulkUploadModal() { const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true); return new ModalBuilder().setCustomId('admin:module:emojis:bulk-submit').setTitle('Upload Emoji Images').addComponents(new LabelBuilder().setLabel('Choose static emoji files').setDescription('Upload up to 10 static images. For animated media, use the dedicated Add GIF button.').setFileUploadComponent(upload)); }
function gifUploadModal() { const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true); return new ModalBuilder().setCustomId('admin:module:emojis:gif-bulk-submit').setTitle('Upload GIF / Animation').addComponents(new LabelBuilder().setLabel('Choose animated files').setDescription('GIF, animated WebP, APNG or AVIF. Goliath will optimise while preserving animation where possible.').setFileUploadComponent(upload)); }
function staticFallbackUploadModal() { const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true); return new ModalBuilder().setCustomId('admin:module:emojis:static-fallback-submit').setTitle('Static Fallback Upload').addComponents(new LabelBuilder().setLabel('Choose failed animated files').setDescription('Explicit fallback: Goliath will keep the first frame and remove animation.').setFileUploadComponent(upload)); }
function cleanSearchName(entry) { return String(entry?.title || entry?.slug || 'Emoji').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanSearchCategory(entry) { const provider = String(entry?.provider || '').trim(); if (provider) return provider; const category = String(entry?.category || '').trim(); return category && !/^\d+$/.test(category) ? category : 'Online emoji'; }
function searchResultsPanel(results, query, mode = 'emoji') {
  const gifMode = mode === 'gif';
  const clean = Array.isArray(results) ? results.slice(0, 25) : [];
  const components = [];
  if (clean.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(gifMode ? 'admin:module:emojis:gif-import' : 'admin:module:emojis:import')
      .setPlaceholder(gifMode ? 'Choose a GIF to preview' : 'Choose an emoji to preview')
      .addOptions(clean.map((entry) => ({ label: cleanSearchName(entry).slice(0, 100), value: String(entry.id), description: cleanSearchCategory(entry).slice(0, 100) })));
    components.push(row(menu));
  }
  components.push(row(button(gifMode ? 'admin:module:emojis:gif-search-open' : 'admin:module:emojis:search-open', emojiLabel('INVESTIGATE', 'Search Again'), gifMode ? ButtonStyle.Success : ButtonStyle.Primary)));
  components.push(row(button(gifMode ? 'admin:module:emojis:gif-upload-open' : 'admin:module:emojis:add', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)));
  const description = clean.length
    ? `Found **${clean.length}** ${gifMode ? 'GIPHY ' : ''}result(s) for **${String(query).slice(0, 80)}**. Choose one to preview it before continuing.${gifMode ? '\n\n**Powered by GIPHY** • discovery only; Goliath does not automatically download or re-host these results.' : ''}`
    : `No matching ${gifMode ? 'GIPHY GIFs' : 'emojis'} were found. Try a different search.`;
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(gifMode ? emojiLabel('INVESTIGATE', 'Browse GIFs — GIPHY') : emojiLabel('INVESTIGATE', 'Emoji Search Results')).setDescription(description)], components };
}
function searchPreviewPanel(entry, mode = 'emoji') {
  const gifMode = mode === 'gif';
  const name = cleanSearchName(entry);
  const description = gifMode
    ? `**Name:** ${name}\n**Type:** ${EMOJIS.SOCIAL_ALERT_VOD} Animated GIF\n**Provider:** Powered by GIPHY\n\nPreview this GIF, then choose **Use This GIF** for the safe import options.`
    : `**Name:** ${name}\n**Type:** ${EMOJIS.MEDIA} Static Emoji\n\nCheck the preview below, then choose whether to add it to this server.`;
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${EMOJIS.WELCOME_PREVIEW} ${name}`).setDescription(description);
  const imageUrl = gifMode ? entry?.previewUrl : emojiApi.assetUrl(entry);
  if (imageUrl) embed.setImage(imageUrl);
  if (gifMode) {
    return { embeds: [embed], components: [
      row(button(`admin:module:emojis:gif-import-confirm:${entry.id}`, emojiLabel('HEALTHY', 'Use This GIF'), ButtonStyle.Success), button('admin:module:emojis:gif-search-open', emojiLabel('INVESTIGATE', 'Search Again'), ButtonStyle.Secondary)),
      row(linkButton(emojiLabel('ROLE_UP_RIGHT', 'Open on GIPHY'), entry.pageUrl), button('admin:module:emojis:gif-upload-open', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
    ] };
  }
  return { embeds: [embed], components: [
    row(button(`admin:module:emojis:import-confirm:${entry.id}`, emojiLabel('HEALTHY', 'Add This Emoji'), ButtonStyle.Success), button('admin:module:emojis:search-open', emojiLabel('INVESTIGATE', 'Search Again'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:add', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}

function giphyUnavailablePanel(query, interaction) {
  const searchUrl = giphyApi.searchPageUrl(query);
  return { embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(emojiLabel('INVESTIGATE', 'Browse GIFs — GIPHY')).setDescription([
    '**Powered by GIPHY**', '',
    'GIPHY browsing is ready in Goliath, but this environment does not have a **GIPHY_API_KEY** configured yet.',
    'You can still open this search on GIPHY, upload a permitted GIF file, or add a permitted direct animated-media link.',
  ].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` })], components: [
    row(linkButton(emojiLabel('ROLE_UP_RIGHT', 'Search on GIPHY'), searchUrl), button('admin:module:emojis:gif-upload-file-open', emojiLabel('UTILITY_ANIMATION', 'Upload GIF'), ButtonStyle.Success), button('admin:module:emojis:gif-import-url-open', emojiLabel('AUTOMOD_LINKS', 'Add GIF Link'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:gif-upload-open', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}

function giphyUsePanel(entry, interaction) {
  const name = cleanSearchName(entry);
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`${EMOJIS.SOCIAL_ALERT_VOD} Use ${name}`).setDescription([
    '**Powered by GIPHY**', '',
    'GIPHY is used here for **discovery and preview only**. Goliath will not automatically download, cache, optimise or re-host this GIPHY result.', '',
    'Open it on GIPHY, then use **Upload GIF** if you have a permitted copy of the media, or **Add GIF Link** with a permitted direct animated-media source.',
  ].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` });
  if (entry?.previewUrl) embed.setImage(entry.previewUrl);
  return { embeds: [embed], components: [
    row(linkButton(emojiLabel('ROLE_UP_RIGHT', 'Open on GIPHY'), entry.pageUrl), button('admin:module:emojis:gif-upload-file-open', emojiLabel('UTILITY_ANIMATION', 'Upload GIF'), ButtonStyle.Success), button('admin:module:emojis:gif-import-url-open', emojiLabel('AUTOMOD_LINKS', 'Add GIF Link'), ButtonStyle.Secondary)),
    row(button('admin:module:emojis:gif-search-open', emojiLabel('INVESTIGATE', 'Search Again'), ButtonStyle.Secondary), button('admin:module:emojis:gif-upload-open', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}
function addedEmojiPanel(result, interaction, mode = 'emoji') {
  const gifMode = mode === 'gif';
  const emoji = result?.emoji;
  const name = String(emoji?.name || 'emoji');
  const mention = emoji?.mention || (emoji?.id ? `<${result?.animated ? 'a' : ''}:${name}:${emoji.id}>` : `:${name}:`);
  const details = [`**Type:** ${result?.animated || emoji?.animated ? `${EMOJIS.SOCIAL_ALERT_VOD} ${emojiMedia.mediaTypeLabel({ ...result, animated: true })}` : emojiLabel('MEDIA', 'Static')}`, result?.processed ? `**Processing:** Optimised automatically ${EMOJIS.SUCCESS}` : `**Processing:** Preserved as uploaded ${EMOJIS.SUCCESS}`, ...(result?.animated && result?.pages ? [`**Frames:** ${result.pages}${result.frameRateReduced ? ' • frame rate reduced' : ''}`] : [])];
  return { content: null, embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(gifMode ? emojiLabel('HEALTHY', 'GIF Added') : emojiLabel('HEALTHY', 'Emoji Added')).setDescription(`${mention}  **:${name}:**\n\n${result?.created ? 'Added' : 'Already available and added'} to this server successfully.\n${details.join('\n')}`).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp()], components: [
    row(button(gifMode ? 'admin:module:emojis:gif-search-open' : 'admin:module:emojis:search-open', gifMode ? emojiLabel('INVESTIGATE', 'Add Another GIF') : emojiLabel('INVESTIGATE', 'Add Another'), gifMode ? ButtonStyle.Success : ButtonStyle.Primary), button('admin:module:emojis:guild', emojiLabel('USER_STARBOARD', 'Manage Library'), ButtonStyle.Secondary)),
    row(button(gifMode ? 'admin:module:emojis:gif-upload-open' : 'admin:module:emojis:add', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)),
  ] };
}
async function sendPanel(interaction, data) { if (interaction.deferred || interaction.replied) return interaction.editReply(data); if (interaction.isModalSubmit?.()) return interaction.reply({ ...data, flags: MessageFlags.Ephemeral }); return interaction.update(data); }

async function handleDiscordInteraction(interaction) {
  const id = String(interaction?.customId || ''); if (!id.startsWith('admin:module:emojis:')) return false; const guildId = interaction.guild?.id;
  if (id === 'admin:module:emojis:panel') { await sendPanel(interaction, await buildDiscordPanel(interaction)); return true; }
  if (id === 'admin:module:emojis:add') { await sendPanel(interaction, addPanel(interaction)); return true; }
  if (id === 'admin:module:emojis:settings') { await sendPanel(interaction, settingsPanel(await discordOverview(interaction), interaction)); return true; }
  if (id === 'admin:module:emojis:storage') { await sendPanel(interaction, storagePanel(interaction)); return true; }
  if (id === 'admin:module:emojis:toggle') { const current = emojiStore.getSection(guildId).enabled; guildManager.setModuleEnabled(guildId, 'emojis', !current, { actorId: interaction.user?.id, action: 'emoji_discord_toggle' }); await sendPanel(interaction, settingsPanel(await discordOverview(interaction), interaction, `Emoji Studio ${!current ? 'turned on' : 'turned off'}. Built-in emojis remain available.`)); return true; }
  if (id === 'admin:module:emojis:guild') { await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction)); return true; }
  if (id.startsWith('admin:module:emojis:manage-filter:') && interaction.isButton?.()) { setManageFilter(interaction, id.slice('admin:module:emojis:manage-filter:'.length)); await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction)); return true; }
  if (id === 'admin:module:emojis:search-open') { await interaction.showModal(searchModal()); return true; }
  if (id === 'admin:module:emojis:gif-search-open') { await interaction.showModal(gifSearchModal()); return true; }
  if (id === 'admin:module:emojis:import-url-open') { await interaction.showModal(urlImportModal()); return true; }
  if (id === 'admin:module:emojis:gif-import-url-open') { await interaction.showModal(gifUrlImportModal()); return true; }
  if (id === 'admin:module:emojis:bulk-open') { await interaction.showModal(bulkUploadModal()); return true; }
  if (id === 'admin:module:emojis:gif-upload-open') { await sendPanel(interaction, gifPanel(interaction)); return true; }
  if (id === 'admin:module:emojis:gif-upload-file-open') { await interaction.showModal(gifUploadModal()); return true; }
  if (id === 'admin:module:emojis:static-fallback-open') { await interaction.showModal(staticFallbackUploadModal()); return true; }
  if ((id === 'admin:module:emojis:manage-extra-select' || id === 'admin:module:emojis:manage-core-select') && interaction.isStringSelectMenu?.()) { await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, String(interaction.values?.[0] || ''))); return true; }
  if ((id.startsWith('admin:module:emojis:manage-add:') || id.startsWith('admin:module:emojis:manage-remove:')) && interaction.isButton?.()) { const adding = id.startsWith('admin:module:emojis:manage-add:'); const emojiId = id.slice((adding ? 'admin:module:emojis:manage-add:' : 'admin:module:emojis:manage-remove:').length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); emojiStore.setFavourite(guildId, emojiId, adding, { actorId: interaction.user?.id, action: 'emoji_discord_select' }); await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, `extra:${emojiId}`, `${adding ? emojiLabel('HEALTHY', 'Added') : emojiLabel('REMOVE', 'Removed')} :${emoji.name}: ${adding ? 'to' : 'from'} this server.`)); return true; }
  if (id.startsWith('admin:module:emojis:delete-open:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-open:'.length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); await sendPanel(interaction, deleteConfirmPanel(emoji, interaction)); return true; }
  if (id.startsWith('admin:module:emojis:delete-cancel:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-cancel:'.length); await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, `extra:${emojiId}`)); return true; }
  if (id.startsWith('admin:module:emojis:delete-confirm:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-confirm:'.length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); const wasAdded = new Set(overview.effectiveFavourites || []).has(String(emojiId)); if (wasAdded) emojiStore.setFavourite(guildId, emojiId, false, { actorId: interaction.user?.id, action: 'emoji_delete_prepare' }); try { await emojis.removeFromBank(interaction.client, emojiId); } catch (error) { if (wasAdded) emojiStore.setFavourite(guildId, emojiId, true, { actorId: interaction.user?.id, action: 'emoji_delete_rollback' }); throw error; } await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, '', `${EMOJIS.DELETE} Deleted :${emoji.name}: permanently from the available emoji collection.`)); return true; }
  if (id === 'admin:module:emojis:search-submit' && interaction.isModalSubmit?.()) { if (!emojiStore.getSection(guildId).enabled) throw new Error('Turn on Emoji Studio first.'); const query = interaction.fields.getTextInputValue('query'); await sendPanel(interaction, searchResultsPanel(await emojiApi.search(query, 25), query)); return true; }
  if (id === 'admin:module:emojis:gif-search-submit' && interaction.isModalSubmit?.()) { if (!emojiStore.getSection(guildId).enabled) throw new Error('Turn on Emoji & GIF Studio first.'); const query = interaction.fields.getTextInputValue('query'); const result = await giphyApi.search(query, 25); if (!result.configured) { await sendPanel(interaction, giphyUnavailablePanel(query, interaction)); return true; } await sendPanel(interaction, searchResultsPanel(result.items, query, 'gif')); return true; }
  if (id === 'admin:module:emojis:import' && interaction.isStringSelectMenu?.()) { const entry = await emojiApi.findById(interaction.values?.[0]); if (!entry) throw new Error('That emoji could not be found anymore. Try searching again.'); await sendPanel(interaction, searchPreviewPanel(entry)); return true; }
  if (id === 'admin:module:emojis:gif-import' && interaction.isStringSelectMenu?.()) { const entry = await giphyApi.findById(interaction.values?.[0]); if (!entry) throw new Error('That GIPHY result could not be found anymore. Try searching again.'); await sendPanel(interaction, searchPreviewPanel(entry, 'gif')); return true; }
  if (id.startsWith('admin:module:emojis:import-confirm:') && interaction.isButton?.()) {
    const emojiGgId = id.slice('admin:module:emojis:import-confirm:'.length);
    if (!/^\d+$/.test(emojiGgId)) throw new Error('That emoji could not be identified. Search for it again.');
    await interaction.deferUpdate();
    const entry = await emojiApi.findById(emojiGgId);
    if (!entry) throw new Error('That emoji could not be found anymore. Try searching again.');
    const prepared = await emojiApi.prepareDownloadedAsset(emojiApi.assetUrl(entry), { rejectAnimated: true });
    const created = await emojis.createStudioEmoji(interaction.client, prepared.buffer, cleanSearchName(entry));
    const result = { ...created, ...prepared, emoji: created.emoji };
    emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_discord_import' });
    await interaction.editReply(addedEmojiPanel(result, interaction));
    return true;
  }
  if (id.startsWith('admin:module:emojis:gif-import-confirm:') && interaction.isButton?.()) {
    const giphyId = id.slice('admin:module:emojis:gif-import-confirm:'.length);
    if (!/^[A-Za-z0-9_-]+$/.test(giphyId)) throw new Error('That GIPHY result could not be identified. Search for it again.');
    const entry = await giphyApi.findById(giphyId);
    if (!entry) throw new Error('That GIPHY result could not be found anymore. Try searching again.');
    await sendPanel(interaction, giphyUsePanel(entry, interaction));
    return true;
  }
  if (id === 'admin:module:emojis:import-url-submit' && interaction.isModalSubmit?.()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const imageUrl = interaction.fields.getTextInputValue('imageUrl');
    const requestedName = interaction.fields.getTextInputValue('name') || null;
    const prepared = await emojiApi.prepareDownloadedAsset(imageUrl, { rejectAnimated: true });
    let name = requestedName || 'emoji';
    if (!requestedName) { try { name = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || 'emoji').replace(/\.[a-z0-9]+$/i, '') || 'emoji'; } catch {} }
    const created = await emojis.createStudioEmoji(interaction.client, prepared.buffer, name);
    const result = { ...created, ...prepared, emoji: created.emoji };
    emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_url_import' });
    await interaction.editReply(addedEmojiPanel(result, interaction));
    return true;
  }
  if (id === 'admin:module:emojis:gif-import-url-submit' && interaction.isModalSubmit?.()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const imageUrl = interaction.fields.getTextInputValue('imageUrl');
    const requestedName = interaction.fields.getTextInputValue('name') || null;
    if (giphyApi.isGiphyUrl(imageUrl)) { await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle(emojiLabel('UTILITY_ANIMATION', 'GIPHY Link Is Discovery-Only')).setDescription('Goliath does not automatically download or re-host GIPHY media. Open the GIF on GIPHY, then upload a permitted copy or use a permitted direct animated-media source.')], components: [row(button('admin:module:emojis:gif-upload-file-open', emojiLabel('UTILITY_ANIMATION', 'Upload GIF'), ButtonStyle.Success)), row(button('admin:module:emojis:gif-upload-open', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] }); return true; }
    const prepared = await emojiApi.prepareDownloadedAsset(imageUrl, { requireAnimated: true });
    let name = requestedName || 'gif';
    if (!requestedName) { try { name = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || 'gif').replace(/\.[a-z0-9]+$/i, '') || 'gif'; } catch {} }
    const created = await emojis.createStudioEmoji(interaction.client, prepared.buffer, name);
    const result = { ...created, ...prepared, emoji: created.emoji };
    emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_gif_url_import' });
    await interaction.editReply(addedEmojiPanel(result, interaction, 'gif'));
    return true;
  }
  if ((id === 'admin:module:emojis:bulk-submit' || id === 'admin:module:emojis:gif-bulk-submit') && interaction.isModalSubmit?.()) {
    const uploads = interaction.fields.getUploadedFiles('files', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const gifOnly = id === 'admin:module:emojis:gif-bulk-submit';
    const lines = [];
    let animated = 0; let optimised = 0; let failed = 0; let fallbackEligible = 0;
    for (const attachment of uploads.values()) {
      try {
        const prepared = await emojiApi.prepareAttachmentAsset(attachment, gifOnly ? { requireAnimated: true } : { rejectAnimated: true });
        const name = String(attachment.name || 'emoji').replace(/\.[a-z0-9]+$/i, '');
        const result = await emojis.createStudioEmoji(interaction.client, prepared.buffer, name);
        emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_bulk_import' });
        if (prepared.animated) animated += 1;
        if (prepared.processed) optimised += 1;
        lines.push(`✅ ${result.emoji.mention || `:${result.emoji.name}:`} **${attachment.name}** — ${emojiMedia.processingSummary(prepared)}`);
      } catch (error) {
        failed += 1;
        const message = String(error?.message || error);
        if (gifOnly && message.includes('without flattening the animation')) fallbackEligible += 1;
        lines.push(`❌ **${attachment.name}** — ${message.slice(0, 160)}${message.includes('without flattening the animation') ? ' • static fallback available below' : ''}`);
      }
    }
    const summary = `**${uploads.size - failed} added** • **${animated} animated** • **${optimised} optimised** • **${failed} failed**`;
    const components = [];
    if (fallbackEligible) components.push(row(button('admin:module:emojis:static-fallback-open', emojiLabel('MEDIA', 'Use Static Fallback'), ButtonStyle.Secondary)));
    components.push(row(button('admin:module:emojis:guild', emojiLabel('USER_STARBOARD', 'Manage Library'), ButtonStyle.Primary)));
    components.push(row(button(gifOnly ? 'admin:module:emojis:gif-upload-open' : 'admin:module:emojis:add', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary)));
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(failed ? 0xFEE75C : 0x57F287).setTitle(gifOnly ? emojiLabel('UTILITY_ANIMATION', 'GIF Upload Complete') : emojiLabel('MEDIA', 'Emoji Upload Complete')).setDescription(`${summary}\n\n${lines.join('\n')}`.slice(0, 4000))], components });
    return true;
  }
  if (id === 'admin:module:emojis:static-fallback-submit' && interaction.isModalSubmit?.()) {
  const uploads = interaction.fields.getUploadedFiles('files', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lines = [];
  let added = 0; let failed = 0;
  for (const attachment of uploads.values()) {
    try {
      const prepared = await emojiApi.prepareAttachmentAsset(attachment, { forceStaticFallback: true });
      const name = String(attachment.name || 'emoji').replace(/\.[a-z0-9]+$/i, '');
      const result = await emojis.createStudioEmoji(interaction.client, prepared.buffer, name);
      emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_static_fallback_import' });
      added += 1;
      lines.push(`✅ ${result.emoji.mention || `:${result.emoji.name}:`} **${attachment.name}** — ${emojiMedia.processingSummary(prepared)} • animation removed by explicit choice`);
    } catch (error) {
      failed += 1;
      lines.push(`❌ **${attachment.name}** — ${String(error?.message || error).slice(0, 180)}`);
    }
  }
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(failed ? 0xFEE75C : 0x57F287).setTitle(emojiLabel('MEDIA', 'Static Fallback Complete')).setDescription(`**${added} added as static** • **${failed} failed**\n\n${lines.join('\n')}`.slice(0, 4000)).setFooter({ text: 'Static fallback uses the first animation frame only.' })], components: [row(button('admin:module:emojis:guild', emojiLabel('USER_STARBOARD', 'Manage Library'), ButtonStyle.Primary)), row(button('admin:module:emojis:gif-upload-open', emojiLabel('BACK', 'Back to Add GIF'), ButtonStyle.Secondary))] });
  return true;
}
  if (id === 'admin:module:emojis:health') { const h = (await discordOverview(interaction)).health || {}; await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(h.healthy ? 0x57F287 : 0xFEE75C).setTitle(emojiLabel('WELCOME_DIAGNOSTICS', 'Check for Problems')).setDescription([`**Status:** ${h.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`, `Missing server emojis: **${h.brokenFavourites?.length || 0}**`, `Broken shortcuts: **${h.brokenAliases?.length || 0}**`, `Broken emoji groups: **${h.brokenPackEntries?.length || 0}**`, `Expired temporary emojis: **${h.expiredTemporary?.length || 0}**`, `Emoji spaces remaining: **${h.capacity?.remaining ?? 0}**`].join('\n'))], components: [row(button('admin:module:emojis:settings', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:cleanup') { const section = emojiStore.getSection(guildId); const candidates = await emojis.cleanupCandidates(interaction.client, section.cleanup.unusedDays); await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('ADMIN_PURGE', 'Find Unused Emojis')).setDescription(candidates.length ? candidates.slice(0, 20).map((entry) => `• \`:${entry.emoji.name}:\` — ${entry.count} uses`).join('\n') : 'No unused emojis found.')], components: [row(button('admin:module:emojis:storage', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:duplicates') { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const groups = await emojis.duplicates(interaction.client); await interaction.editReply({ embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('UTILITY_GROUP', 'Find Duplicate Emojis')).setDescription(groups.length ? groups.slice(0, 15).map((group, index) => `**Group ${index + 1}:** ${group.entries.map((entry) => `\`:${entry.name}:\``).join(', ')}`).join('\n') : 'No exact duplicate images were found.')], components: [row(button('admin:module:emojis:storage', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:export') { const exported = emojis.exportGuildConfig(guildId); await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle(emojiLabel('WELCOME_PRESET', 'Backup Emoji Settings')).setDescription(`\`\`\`json\n${JSON.stringify(exported, null, 2).slice(0, 3500)}\n\`\`\``)], components: [row(button('admin:module:emojis:settings', emojiLabel('BACK', 'Back'), ButtonStyle.Secondary))] }); return true; }
  return false;
}

module.exports = {
  buildDiscordPanel,
  handleDiscordInteraction,
};
