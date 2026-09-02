'use strict';

const fetch = require('node-fetch');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const emojiProcessor = require('../../../core/mediaTools/emojiMaker/emojiProcessor');
const emojiApi = require('./emojisApi');
const emojis = require('./emojis');
const emojiStore = require('./emojisStore');

const PANEL_COLOR = 0x5865F2;
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function memberName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
async function discordOverview(interaction) { if (!interaction?.guild?.id || !interaction?.client) throw new Error('Emoji Studio requires a server interaction.'); return emojis.overview(interaction.client, interaction.guild.id); }

function mainEmbed(overview, interaction, notice = '') {
  return new EmbedBuilder().setColor(overview.enabled ? 0x57F287 : PANEL_COLOR).setTitle('😀 Emoji Studio').setDescription([
    'Give your community more emojis without filling this server\'s normal emoji slots. Goliath\'s built-in emojis are always ready to use.', '',
    `**Emoji Studio:** ${overview.enabled ? 'On ✅' : 'Off ❌'}`,
    `**Your Emojis:** ${overview.guildCapacity.used} / ${overview.guildCapacity.max}`,
    `**Built-in Emojis:** ${overview.coreCapacity.used} / ${overview.coreCapacity.max}`,
    `**Status:** ${overview.health?.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`,
    notice ? `\n${notice}` : '',
  ].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp();
}

async function buildDiscordPanel(interaction, notice = '') {
  const overview = await discordOverview(interaction);
  return { embeds: [mainEmbed(overview, interaction, notice)], components: [
    row(button('admin:module:emojis:add', '➕ Add Emojis', ButtonStyle.Primary).setDisabled(!overview.enabled), button('admin:module:emojis:guild', '⭐ Manage Emojis', ButtonStyle.Primary)),
    row(button('admin:studio:utilityStudio', '⬅️ Back', ButtonStyle.Secondary), button('admin:module:emojis:settings', '⚙️ Settings', ButtonStyle.Secondary)),
  ] };
}

function addPanel(interaction) {
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('➕ Add Emojis').setDescription([
    'Choose how you want to add emojis to this server.', '',
    '**Search for Emojis** — browse the online emoji collection.',
    '**Upload Images** — add image files from your device.',
    '**Add from Link** — paste a direct image link.',
  ].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` })], components: [
    row(button('admin:module:emojis:search-open', '🔎 Search for Emojis', ButtonStyle.Primary), button('admin:module:emojis:bulk-open', '📤 Upload Images', ButtonStyle.Primary), button('admin:module:emojis:import-url-open', '🔗 Add from Link', ButtonStyle.Secondary)),
    row(button('admin:module:emojis:panel', '⬅️ Back', ButtonStyle.Secondary), button('admin:module:emojis:settings', '⚙️ Settings', ButtonStyle.Secondary)),
  ] };
}

function settingsPanel(overview, interaction, notice = '') {
  const top = (overview.usage || []).filter((entry) => entry.count > 0).slice(0, 5);
  const health = overview.health || {};
  const attention = (health.brokenFavourites?.length || 0) + (health.brokenAliases?.length || 0) + (health.brokenPackEntries?.length || 0) + (health.expiredTemporary?.length || 0);
  return { embeds: [new EmbedBuilder().setColor(health.healthy ? 0x57F287 : 0xFEE75C).setTitle('⚙️ Emoji Studio Settings').setDescription([
    'Control Emoji Studio and keep everything running smoothly.', '',
    `**Emoji Studio:** ${overview.enabled ? 'On ✅' : 'Off ❌'}`,
    `**Status:** ${health.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`,
    `**Emoji space used:** ${overview.forecast?.used || 0}/${overview.forecast?.max || 2000}`,
    `**Items needing attention:** ${attention}`,
    notice ? `\n${notice}` : '', '', '**Most used emojis**',
    ...(top.length ? top.map((entry) => `• \`:${entry.emoji.alias || entry.emoji.name}:\` — ${entry.count} uses`) : ['No usage has been tracked yet.']),
  ].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp()], components: [
    row(button('admin:module:emojis:storage', '🧹 Manage Storage', ButtonStyle.Primary), button('admin:module:emojis:health', '🩺 Check for Problems', ButtonStyle.Secondary)),
    row(button('admin:module:emojis:export', '📦 Backup Settings', ButtonStyle.Secondary), button('admin:module:emojis:toggle', overview.enabled ? '⏸️ Turn Off Emoji Studio' : '▶️ Turn On Emoji Studio', overview.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)),
    row(button('admin:module:emojis:panel', '⬅️ Back', ButtonStyle.Secondary)),
  ] };
}

function storagePanel(interaction) {
  return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🧹 Manage Storage').setDescription([
    'Keep your available emoji collection tidy.', '',
    '**Find Unused** — see emojis that are not being used.',
    '**Find Duplicates** — find identical emoji images taking up extra space.',
  ].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` })], components: [
    row(button('admin:module:emojis:cleanup', '🧹 Find Unused', ButtonStyle.Secondary), button('admin:module:emojis:duplicates', '👯 Find Duplicates', ButtonStyle.Secondary)),
    row(button('admin:module:emojis:settings', '⬅️ Back', ButtonStyle.Secondary)),
  ] };
}

function emojiPreviewUrl(emoji) {
  if (!emoji?.id) return null;
  return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=256&quality=lossless`;
}

function managePanel(overview, interaction, selectedKey = '', notice = '') {
  const selectedIds = new Set(overview.effectiveFavourites || []);
  const extras = (overview.catalog || []).filter((emoji) => !emoji.core).sort((a, b) => Number(selectedIds.has(String(b.id))) - Number(selectedIds.has(String(a.id))) || String(a.name || '').localeCompare(String(b.name || '')));
  const builtIns = (overview.coreStatus || []).filter((entry) => entry.installed && entry.emoji);
  const extraOptions = extras.slice(0, 25).map((emoji) => ({ label: `:${emoji.name}:`.slice(0, 100), value: `extra:${emoji.id}`, description: selectedIds.has(String(emoji.id)) ? '✅ Added to this server' : '➕ Available to add', emoji: emoji.component || undefined }));
  const coreOptions = builtIns.slice(0, 25).map((entry) => ({ label: `:${entry.alias}:`.slice(0, 100), value: `core:${entry.alias}`, description: '💠 Built-in • always available', emoji: entry.emoji?.component || undefined }));
  let chosen = null; let isCore = false;
  if (selectedKey.startsWith('extra:')) chosen = extras.find((emoji) => String(emoji.id) === selectedKey.slice(6)) || null;
  if (selectedKey.startsWith('core:')) { isCore = true; const alias = selectedKey.slice(5); const entry = builtIns.find((item) => item.alias === alias); const catalogEntry = (overview.catalog || []).find((emoji) => emoji.core && String(emoji.alias || emoji.name) === alias); chosen = entry ? { ...catalogEntry, ...entry.emoji, alias: entry.alias, mention: entry.mention || entry.emoji.mention } : null; }
  const chosenAdded = chosen && !isCore ? selectedIds.has(String(chosen.id)) : false;
  const shortcode = chosen ? String(chosen.alias || chosen.name || 'emoji') : '';
  const previewLines = chosen ? [`${chosen.mention || `:${shortcode}:`}  **:${shortcode}:**`, `**Status:** ${isCore ? 'Built-in • always available 💠' : (chosenAdded ? 'Added to this server ✅' : 'Available to add')}`, `**Type this:** \`:${shortcode}:\``, ...(!isCore && chosen.category ? [`**Category:** ${chosen.category}`] : []), ...(!isCore && Array.isArray(chosen.tags) && chosen.tags.length ? [`**Tags:** ${chosen.tags.join(', ')}`] : []), `**Used:** ${chosen.usage?.count || 0} time(s)`, ...(isCore ? ['', 'Included with Goliath and always available in this server.'] : [])] : ['Choose an emoji below to preview and manage it.'];
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle('⭐ Manage Emojis').setDescription([`**Your emojis:** ${overview.guildCapacity.used}/${overview.guildCapacity.max}`, `**Built-in emojis:** ${overview.coreCapacity.used}/${overview.coreCapacity.max} always available`, '', ...previewLines, notice ? `\n${notice}` : ''].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` });
  const previewUrl = emojiPreviewUrl(chosen); if (previewUrl) embed.setThumbnail(previewUrl);
  const components = [];
  if (extraOptions.length) components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:manage-extra-select').setPlaceholder('Your & available emojis').addOptions(extraOptions)));
  if (coreOptions.length) components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:manage-core-select').setPlaceholder('Built-in emojis').addOptions(coreOptions)));
  if (chosen && !isCore) components.push(row(chosenAdded ? button(`admin:module:emojis:manage-remove:${chosen.id}`, '➖ Remove from Server', ButtonStyle.Secondary) : button(`admin:module:emojis:manage-add:${chosen.id}`, '➕ Add to Server', ButtonStyle.Success), button(`admin:module:emojis:delete-open:${chosen.id}`, '🗑️ Delete Emoji', ButtonStyle.Danger)));
  components.push(row(button('admin:module:emojis:panel', '⬅️ Back', ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

function deleteConfirmPanel(emoji, interaction) {
  const name = String(emoji?.name || 'emoji'); const mention = emoji?.mention || `:${name}:`;
  const embed = new EmbedBuilder().setColor(0xED4245).setTitle('🗑️ Delete Emoji?').setDescription([`${mention}  **:${name}:**`, '', 'This permanently deletes this emoji from Goliath’s available emoji collection.', 'Servers will no longer be able to add it again unless the image is imported or uploaded again.', '', '**Built-in emojis cannot be deleted.**'].join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` });
  const previewUrl = emojiPreviewUrl(emoji); if (previewUrl) embed.setThumbnail(previewUrl);
  return { embeds: [embed], components: [row(button(`admin:module:emojis:delete-confirm:${emoji.id}`, '🗑️ Delete Permanently', ButtonStyle.Danger), button(`admin:module:emojis:delete-cancel:${emoji.id}`, 'Cancel', ButtonStyle.Secondary)), row(button('admin:module:emojis:guild', '⬅️ Back', ButtonStyle.Secondary))] };
}

function searchModal() { return new ModalBuilder().setCustomId('admin:module:emojis:search-submit').setTitle('Search for Emojis').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('What emoji are you looking for?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80))); }
function urlImportModal() { return new ModalBuilder().setCustomId('admin:module:emojis:import-url-submit').setTitle('Add Emoji from Link').addComponents(row(new TextInputBuilder().setCustomId('imageUrl').setLabel('Image link').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1000)), row(new TextInputBuilder().setCustomId('name').setLabel('Emoji name (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32))); }
function bulkUploadModal() { const upload = new FileUploadBuilder().setCustomId('files').setMinValues(1).setMaxValues(10).setRequired(true); return new ModalBuilder().setCustomId('admin:module:emojis:bulk-submit').setTitle('Upload Emoji Images').addComponents(new LabelBuilder().setLabel('Choose your images').setDescription('Upload up to 10 images. Goliath will prepare them automatically.').setFileUploadComponent(upload)); }
function cleanSearchName(entry) { return String(entry?.title || entry?.slug || 'Emoji').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function cleanSearchCategory(entry) { const category = String(entry?.category || '').trim(); return category && !/^\d+$/.test(category) ? category : 'Online emoji'; }
function searchResultsPanel(results, query) { const clean = Array.isArray(results) ? results.slice(0, 25) : []; const components = []; if (clean.length) components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:import').setPlaceholder('Choose an emoji to preview').addOptions(clean.map((entry) => ({ label: cleanSearchName(entry).slice(0, 100), value: String(entry.id), description: cleanSearchCategory(entry).slice(0, 100) }))))); components.push(row(button('admin:module:emojis:search-open', '🔎 Search Again', ButtonStyle.Primary))); components.push(row(button('admin:module:emojis:add', '⬅️ Back', ButtonStyle.Secondary))); return { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🔎 Search Results').setDescription(clean.length ? `Found **${clean.length}** result(s) for **${String(query).slice(0, 80)}**. Choose one to preview it before adding.` : 'No matching emojis were found. Try a different search.')], components }; }
function searchPreviewPanel(entry) { const name = cleanSearchName(entry); const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`👁️ ${name}`).setDescription(`**Name:** ${name}\n\nCheck the image below, then choose whether to add it to this server.`); const imageUrl = emojiApi.assetUrl(entry); if (imageUrl) embed.setImage(imageUrl); return { embeds: [embed], components: [row(button(`admin:module:emojis:import-confirm:${entry.id}`, '✅ Add This Emoji', ButtonStyle.Success), button('admin:module:emojis:search-open', '🔎 Search Again', ButtonStyle.Secondary)), row(button('admin:module:emojis:add', '⬅️ Back', ButtonStyle.Secondary))] }; }
function addedEmojiPanel(result, interaction) { const emoji = result?.emoji; const name = String(emoji?.name || 'emoji'); const mention = emoji?.mention || (emoji?.id ? `<:${name}:${emoji.id}>` : `:${name}:`); return { content: null, embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Emoji Added').setDescription(`${mention}  **:${name}:**\n\n${result?.created ? 'Added' : 'Already available and added'} to this server successfully.`).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp()], components: [row(button('admin:module:emojis:search-open', '🔎 Add Another', ButtonStyle.Primary), button('admin:module:emojis:guild', '⭐ Manage Emojis', ButtonStyle.Secondary)), row(button('admin:module:emojis:add', '⬅️ Back', ButtonStyle.Secondary))] }; }
async function sendPanel(interaction, data) { if (interaction.deferred || interaction.replied) return interaction.editReply(data); if (interaction.isModalSubmit?.()) return interaction.reply({ ...data, flags: MessageFlags.Ephemeral }); return interaction.update(data); }

async function handleDiscordInteraction(interaction) {
  const id = String(interaction?.customId || ''); if (!id.startsWith('admin:module:emojis:')) return false; const guildId = interaction.guild?.id;
  if (id === 'admin:module:emojis:panel') { await sendPanel(interaction, await buildDiscordPanel(interaction)); return true; }
  if (id === 'admin:module:emojis:add') { await sendPanel(interaction, addPanel(interaction)); return true; }
  if (id === 'admin:module:emojis:settings') { await sendPanel(interaction, settingsPanel(await discordOverview(interaction), interaction)); return true; }
  if (id === 'admin:module:emojis:storage') { await sendPanel(interaction, storagePanel(interaction)); return true; }
  if (id === 'admin:module:emojis:toggle') { const current = emojiStore.getSection(guildId).enabled; guildManager.setModuleEnabled(guildId, 'emojis', !current, { actorId: interaction.user?.id, action: 'emoji_discord_toggle' }); await sendPanel(interaction, settingsPanel(await discordOverview(interaction), interaction, `Emoji Studio ${!current ? 'turned on' : 'turned off'}. Built-in emojis remain available.`)); return true; }
  if (id === 'admin:module:emojis:guild') { await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction)); return true; }
  if (id === 'admin:module:emojis:search-open') { await interaction.showModal(searchModal()); return true; }
  if (id === 'admin:module:emojis:import-url-open') { await interaction.showModal(urlImportModal()); return true; }
  if (id === 'admin:module:emojis:bulk-open') { await interaction.showModal(bulkUploadModal()); return true; }
  if ((id === 'admin:module:emojis:manage-extra-select' || id === 'admin:module:emojis:manage-core-select') && interaction.isStringSelectMenu?.()) { await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, String(interaction.values?.[0] || ''))); return true; }
  if ((id.startsWith('admin:module:emojis:manage-add:') || id.startsWith('admin:module:emojis:manage-remove:')) && interaction.isButton?.()) { const adding = id.startsWith('admin:module:emojis:manage-add:'); const emojiId = id.slice((adding ? 'admin:module:emojis:manage-add:' : 'admin:module:emojis:manage-remove:').length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); emojiStore.setFavourite(guildId, emojiId, adding, { actorId: interaction.user?.id, action: 'emoji_discord_select' }); await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, `extra:${emojiId}`, `${adding ? '✅ Added' : '➖ Removed'} :${emoji.name}: ${adding ? 'to' : 'from'} this server.`)); return true; }
  if (id.startsWith('admin:module:emojis:delete-open:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-open:'.length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); await sendPanel(interaction, deleteConfirmPanel(emoji, interaction)); return true; }
  if (id.startsWith('admin:module:emojis:delete-cancel:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-cancel:'.length); await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, `extra:${emojiId}`)); return true; }
  if (id.startsWith('admin:module:emojis:delete-confirm:') && interaction.isButton?.()) { const emojiId = id.slice('admin:module:emojis:delete-confirm:'.length); const overview = await discordOverview(interaction); const emoji = (overview.catalog || []).find((entry) => !entry.core && String(entry.id) === emojiId); if (!emoji) throw new Error('That emoji is no longer available.'); const wasAdded = new Set(overview.effectiveFavourites || []).has(String(emojiId)); if (wasAdded) emojiStore.setFavourite(guildId, emojiId, false, { actorId: interaction.user?.id, action: 'emoji_delete_prepare' }); try { await emojis.removeFromBank(interaction.client, emojiId); } catch (error) { if (wasAdded) emojiStore.setFavourite(guildId, emojiId, true, { actorId: interaction.user?.id, action: 'emoji_delete_rollback' }); throw error; } await sendPanel(interaction, managePanel(await discordOverview(interaction), interaction, '', `🗑️ Deleted :${emoji.name}: permanently from the available emoji collection.`)); return true; }
  if (id === 'admin:module:emojis:search-submit' && interaction.isModalSubmit?.()) { if (!emojiStore.getSection(guildId).enabled) throw new Error('Turn on Emoji Studio first.'); const query = interaction.fields.getTextInputValue('query'); await sendPanel(interaction, searchResultsPanel(await emojiApi.search(query, 25), query)); return true; }
  if (id === 'admin:module:emojis:import' && interaction.isStringSelectMenu?.()) { const entry = await emojiApi.findById(interaction.values?.[0]); if (!entry) throw new Error('That emoji could not be found anymore. Try searching again.'); await sendPanel(interaction, searchPreviewPanel(entry)); return true; }
  if (id.startsWith('admin:module:emojis:import-confirm:') && interaction.isButton?.()) { const emojiGgId = id.slice('admin:module:emojis:import-confirm:'.length); if (!/^\d+$/.test(emojiGgId)) throw new Error('That emoji could not be identified. Search for it again.'); await interaction.deferUpdate(); const result = await emojis.importFromEmojiGG(interaction.client, emojiGgId); emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_discord_import' }); await interaction.editReply(addedEmojiPanel(result, interaction)); return true; }
  if (id === 'admin:module:emojis:import-url-submit' && interaction.isModalSubmit?.()) { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const result = await emojis.importFromUrl(interaction.client, interaction.fields.getTextInputValue('imageUrl'), interaction.fields.getTextInputValue('name') || null); emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_url_import' }); await interaction.editReply(addedEmojiPanel(result, interaction)); return true; }
  if (id === 'admin:module:emojis:bulk-submit' && interaction.isModalSubmit?.()) { const uploads = interaction.fields.getUploadedFiles('files', true); await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const lines = []; for (const attachment of uploads.values()) { try { const response = await fetch(attachment.url, { headers: { 'User-Agent': 'KSJHub-Goliath/1.0' }, timeout: 15000 }); if (!response.ok) throw new Error(`download failed (${response.status})`); const prepared = await emojiProcessor.prepareEmojiBuffer(await response.buffer(), { size: 512, padding: 32, maxBytes: emojiApi.MAX_BYTES }); const name = String(attachment.name || 'emoji').replace(/\.[a-z0-9]+$/i, ''); const result = await emojis.createStudioEmoji(interaction.client, prepared.buffer, name); emojiStore.setFavourite(guildId, result.emoji.id, true, { actorId: interaction.user?.id, action: 'emoji_bulk_import' }); lines.push(`✅ ${attachment.name} → \`:${result.emoji.name}:\``); } catch (error) { lines.push(`❌ ${attachment.name} — ${String(error?.message || error).slice(0, 120)}`); } } await interaction.editReply({ embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('📤 Upload Complete').setDescription(lines.join('\n').slice(0, 4000))], components: [row(button('admin:module:emojis:guild', '⭐ Manage Emojis', ButtonStyle.Primary)), row(button('admin:module:emojis:add', '⬅️ Back', ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:health') { const h = (await discordOverview(interaction)).health || {}; await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(h.healthy ? 0x57F287 : 0xFEE75C).setTitle('🩺 Check for Problems').setDescription([`**Status:** ${h.healthy ? 'Everything working ✅' : 'Needs attention ⚠️'}`, `Missing server emojis: **${h.brokenFavourites?.length || 0}**`, `Broken shortcuts: **${h.brokenAliases?.length || 0}**`, `Broken emoji groups: **${h.brokenPackEntries?.length || 0}**`, `Expired temporary emojis: **${h.expiredTemporary?.length || 0}**`, `Emoji spaces remaining: **${h.capacity?.remaining ?? 0}**`].join('\n'))], components: [row(button('admin:module:emojis:settings', '⬅️ Back', ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:cleanup') { const section = emojiStore.getSection(guildId); const candidates = await emojis.cleanupCandidates(interaction.client, section.cleanup.unusedDays); await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🧹 Find Unused Emojis').setDescription(candidates.length ? candidates.slice(0, 20).map((entry) => `• \`:${entry.emoji.name}:\` — ${entry.count} uses`).join('\n') : 'No unused emojis found.')], components: [row(button('admin:module:emojis:storage', '⬅️ Back', ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:duplicates') { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const groups = await emojis.duplicates(interaction.client); await interaction.editReply({ embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('👯 Find Duplicate Emojis').setDescription(groups.length ? groups.slice(0, 15).map((group, index) => `**Group ${index + 1}:** ${group.entries.map((entry) => `\`:${entry.name}:\``).join(', ')}`).join('\n') : 'No exact duplicate images were found.')], components: [row(button('admin:module:emojis:storage', '⬅️ Back', ButtonStyle.Secondary))] }); return true; }
  if (id === 'admin:module:emojis:export') { const exported = emojis.exportGuildConfig(guildId); await sendPanel(interaction, { embeds: [new EmbedBuilder().setColor(PANEL_COLOR).setTitle('📦 Backup Emoji Settings').setDescription(`\`\`\`json\n${JSON.stringify(exported, null, 2).slice(0, 3500)}\n\`\`\``)], components: [row(button('admin:module:emojis:settings', '⬅️ Back', ButtonStyle.Secondary))] }); return true; }
  return false;
}

module.exports = {
  buildDiscordPanel,
  handleDiscordInteraction,
};
