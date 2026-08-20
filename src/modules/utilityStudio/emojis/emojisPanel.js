'use strict';

const express = require('express');
const fetch = require('node-fetch');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const emojiProcessor = require('../../../core/mediaTools/emojiMaker/emojiProcessor');
const emojiApi = require('./emojisApi');
const emojis = require('./emojis');
const emojiStore = require('./emojisStore');

const router = express.Router();
const PANEL_COLOR = 0x5865F2;
const MAX_BULK_SOURCE_BYTES = 12 * 1024 * 1024;
const ok = (res, payload = {}) => res.json({ success: true, ...payload });
const fail = (res, error, status = null) => res.status(status || error?.statusCode || 400).json({ success: false, error: error?.message || 'Emoji request failed.' });

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

function actor(req) {
  return String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
}

function authenticatedActor(req) {
  return String(req.session?.user?.id || '').trim() || null;
}

function coreManagerIds() {
  const raw = [
    process.env.OWNER_ID,
    process.env.BOT_OWNER_ID,
    process.env.OWNER_IDS,
    process.env.GOLIATH_OWNER_IDS,
    process.env.GOLIATH_CORE_MANAGER_IDS,
  ].filter(Boolean).join(',');
  return new Set(raw.split(/[\s,]+/).map((value) => value.trim()).filter((value) => /^\d{16,20}$/.test(value)));
}

function isCoreManagerId(userId) {
  return Boolean(userId && coreManagerIds().has(String(userId)));
}

function requireCoreManager(req) {
  const userId = authenticatedActor(req);
  if (!isCoreManagerId(userId)) {
    const error = new Error('Goliath Core emoji management is restricted to configured bot owners.');
    error.statusCode = 403;
    throw error;
  }
  return userId;
}

function requireCoreManagerInteraction(interaction) {
  const userId = String(interaction?.user?.id || '').trim();
  if (!isCoreManagerId(userId)) throw new Error('Goliath Core emoji management is restricted to configured bot owners.');
  return userId;
}

function client(req) {
  return req.client || req.app?.get?.('goliath.client') || null;
}

function decodeBase64Image(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^data:image\/(?:png|gif|jpe?g|webp);base64,(.+)$/i);
  const encoded = match ? match[1] : raw;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw new Error('Core emoji imageBase64 is invalid.');
  const buffer = Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new Error('Core emoji image was empty.');
  if (buffer.length > emojiApi.MAX_BYTES) throw new Error(`Core emoji image is too large (${buffer.length} bytes).`);
  return buffer;
}

async function transientCoreAttachment(body = {}) {
  if (body.imageUrl) return emojiApi.downloadAsset(String(body.imageUrl).trim());
  const buffer = decodeBase64Image(body.imageBase64);
  if (buffer) return buffer;
  throw new Error('Provide imageUrl or imageBase64 for the Core emoji.');
}

async function payload(req, id) {
  const overview = await emojis.overview(client(req), id);
  return { guildId: id, ...overview, source: 'Discord application emojis', imageStorage: 'Discord-hosted' };
}

router.get('/:guildId/overview', async (req, res) => { try { return ok(res, await payload(req, guildId(req))); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/enabled', async (req, res) => { try { const id = guildId(req); guildManager.setModuleEnabled(id, 'emojis', req.body?.enabled === true, { actorId: actor(req), action: 'emoji_panel_toggle' }); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });
router.get('/:guildId/search', async (req, res) => { try { const id = guildId(req); const results = await emojiApi.search(req.query?.q || '', Number(req.query?.limit) || 25); return ok(res, { guildId: id, results }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/import', async (req, res) => { try { const id = guildId(req); if (!emojiStore.getSection(id).enabled) throw new Error('Emoji Studio is disabled for this server.'); const result = await emojis.importFromEmojiGG(client(req), req.body?.emojiGgId, req.body?.name || null); if (req.body?.selectForGuild !== false) emojiStore.setFavourite(id, result.emoji.id, true, { actorId: actor(req), action: 'emoji_panel_import' }); return ok(res, { result, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/core', async (req, res) => { try { const id = guildId(req); const ownerId = requireCoreManager(req); const alias = String(req.body?.alias || '').trim(); if (!emojis.isApprovedCoreAlias(alias)) throw new Error('Use one of the locked Goliath Core emoji aliases.'); const attachment = await transientCoreAttachment(req.body || {}); const result = await emojis.createCoreEmoji(client(req), attachment, alias); return ok(res, { actorId: ownerId, result, transientUpload: true, permanentGoliathStorage: 0, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/core/:emojiId', async (req, res) => { try { const id = guildId(req); const ownerId = requireCoreManager(req); const emoji = await emojis.renameInBank(client(req), req.params.emojiId, req.body?.alias || req.body?.name, { allowCore: true }); if (!emoji.core) throw new Error('That application emoji is not part of Goliath Core.'); return ok(res, { actorId: ownerId, emoji, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/core/:emojiId/replace', async (req, res) => { try { const id = guildId(req); const ownerId = requireCoreManager(req); const attachment = await transientCoreAttachment(req.body || {}); const result = await emojis.replaceCoreEmoji(client(req), req.params.emojiId, attachment); return ok(res, { actorId: ownerId, result, transientUpload: true, permanentGoliathStorage: 0, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.delete('/:guildId/core/:emojiId', async (req, res) => { try { const id = guildId(req); const ownerId = requireCoreManager(req); const overview = await emojis.overview(client(req), id); const target = (overview.core || []).find((emoji) => String(emoji.id) === String(req.params.emojiId)); if (!target) throw new Error('That application emoji is not part of Goliath Core.'); await emojis.removeFromBank(client(req), req.params.emojiId, { allowCore: true }); return ok(res, { actorId: ownerId, removed: target, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/favourites/:emojiId', async (req, res) => { try { const id = guildId(req); emojiStore.setFavourite(id, req.params.emojiId, req.body?.selected !== false, { actorId: actor(req), action: 'emoji_panel_favourite' }); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/bank/:emojiId', async (req, res) => { try { const id = guildId(req); const emoji = await emojis.renameInBank(client(req), req.params.emojiId, req.body?.name); return ok(res, { emoji, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.delete('/:guildId/bank/:emojiId', async (req, res) => { try { const id = guildId(req); await emojis.removeFromBank(client(req), req.params.emojiId); const section = emojiStore.getSection(id); if (section.favourites.includes(String(req.params.emojiId))) emojiStore.setFavourite(id, req.params.emojiId, false, { actorId: actor(req), action: 'emoji_panel_delete' }); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });

function row(...items) { return new ActionRowBuilder().addComponents(...items); }
function button(id, label, style = ButtonStyle.Primary) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style); }
function memberName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
async function discordOverview(interaction) { if (!interaction?.guild?.id || !interaction?.client) throw new Error('Emoji Studio requires a server interaction.'); return emojis.overview(interaction.client, interaction.guild.id); }

function coreAliasFromFilename(filename) {
  const raw = String(filename || '').toLowerCase().replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const rules = [
    ['activision', /\bactiv(?:ision|id)\b/],
    ['blizzard', /\bblizzard\b/],
    ['epic', /\bepic\b/],
    ['facebook', /\b(?:facebook|fb)\b/],
    ['instagram', /\b(?:instagram|insta)\b/],
    ['kick', /\bkick\b/],
    ['nintendo', /\b(?:nintendo|nswitch|switch)\b/],
    ['playstation', /\b(?:playstation|ps)\b/],
    ['snapchat', /\b(?:snapchat|snap)\b/],
    ['steam', /\bsteam\b/],
    ['tiktok', /\btik\s*tok\b/],
    ['twitch', /\btwitch\b/],
    ['whatsapp', /\bwhats\s*app\b/],
    ['xbox', /\bxbox\b/],
    ['youtube', /\b(?:youtube|yt)\b/],
    ['pc', /\bpc\b/],
    ['x', /\b(?:twitter|x)\b/],
  ];
  for (const [alias, pattern] of rules) if (pattern.test(raw)) return alias;
  const stripped = raw.replace(/\b(?:discord|emoji|emote|icon|logo)\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+/g, '_');
  if (emojis.isApprovedCoreAlias(stripped)) return stripped;
  if (/\bdiscord\b/.test(raw)) return 'discord';
  return null;
}

async function downloadDiscordAttachment(attachment) {
  if (!attachment?.url) throw new Error('Discord upload URL is missing.');
  if (attachment.contentType && !/^image\//i.test(String(attachment.contentType))) throw new Error('Only image files can be uploaded as Core emojis.');
  const response = await fetch(attachment.url, { headers: { 'User-Agent': 'KSJHub-Goliath/1.0' }, timeout: 15000 });
  if (!response.ok) throw new Error(`Discord upload download failed (${response.status}).`);
  const buffer = await response.buffer();
  if (!buffer.length) throw new Error('Uploaded image was empty.');
  if (buffer.length > MAX_BULK_SOURCE_BYTES) throw new Error(`Source image is too large (${buffer.length} bytes; max ${MAX_BULK_SOURCE_BYTES}).`);
  return buffer;
}

function coreBulkUploadModal() {
  const upload = new FileUploadBuilder().setCustomId('coreFiles').setMinValues(1).setMaxValues(10).setRequired(true);
  const label = new LabelBuilder().setLabel('Core emoji files').setDescription('Upload up to 10 images. Filenames are matched to Core aliases automatically.').setFileUploadComponent(upload);
  return new ModalBuilder().setCustomId('admin:module:emojis:core-bulk-submit').setTitle('Bulk Upload Goliath Core').addComponents(label);
}

function mainEmbed(overview, interaction, notice = '') { return new EmbedBuilder().setColor(overview.enabled ? 0x57F287 : PANEL_COLOR).setTitle('😀 Emoji Studio').setDescription(['Discord-hosted Goliath emojis with a built-in Core set plus optional server favourites.','',`**Emoji Studio:** ${overview.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,`**💠 Goliath Core:** ${overview.coreCapacity.used} / ${overview.coreCapacity.max} — always available`,`**🌐 Studio Bank:** ${overview.studioCapacity.used} / ${overview.studioCapacity.max}`,`**🏠 This Server:** ${overview.guildCapacity.used} / ${overview.guildCapacity.max}`,`**📦 Total application emojis:** ${overview.capacity.used} / ${overview.capacity.max}`,'**💾 Goliath image storage:** 0 bytes',notice ? `\n${notice}` : ''].filter(Boolean).join('\n')).setFooter({ text: `Requested by ${memberName(interaction)}` }).setTimestamp(); }
async function buildDiscordPanel(interaction, notice = '') { const overview = await discordOverview(interaction); return { embeds:[mainEmbed(overview,interaction,notice)], components:[row(button('admin:module:emojis:core','💠 Goliath Core',ButtonStyle.Secondary),button('admin:module:emojis:search-open','🔎 Browse Emoji.gg',ButtonStyle.Primary).setDisabled(!overview.enabled),button('admin:module:emojis:guild','😀 Server Emojis',ButtonStyle.Secondary)),row(button('admin:module:emojis:bank','🌐 Studio Bank',ButtonStyle.Secondary),button('admin:module:emojis:toggle',overview.enabled?'⏸️ Disable Studio':'▶️ Enable Studio',overview.enabled?ButtonStyle.Secondary:ButtonStyle.Success),button('admin:studio:utilityStudio','⬅️ Utility Studio',ButtonStyle.Secondary))] }; }
function searchModal(){return new ModalBuilder().setCustomId('admin:module:emojis:search-submit').setTitle('Search Emoji.gg').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('Search').setPlaceholder('dolphin, gaming, pepe...').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));}
function coreSourceModal(alias){return new ModalBuilder().setCustomId(`admin:module:emojis:core-add-submit:${alias}`).setTitle(`Add Core :${alias}:`).addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('Emoji.gg search (optional)').setPlaceholder('success, check, ticket...').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),row(new TextInputBuilder().setCustomId('imageUrl').setLabel('OR direct image URL (optional)').setPlaceholder('https://.../emoji.png').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(1000)));}
function coreRenameModal(emoji){return new ModalBuilder().setCustomId(`admin:module:emojis:core-rename-submit:${emoji.id}`).setTitle('Rename Core emoji').addComponents(row(new TextInputBuilder().setCustomId('alias').setLabel('Core alias').setPlaceholder('success, ticket, discord...').setValue(String(emoji.alias||'')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));}
function coreReplaceModal(emoji){return new ModalBuilder().setCustomId(`admin:module:emojis:core-replace-submit:${emoji.id}`).setTitle(`Replace :${emoji.alias}: image`).addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('Emoji.gg search (optional)').setPlaceholder('success, check, ticket...').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)),row(new TextInputBuilder().setCustomId('imageUrl').setLabel('OR direct image URL (optional)').setPlaceholder('https://.../emoji.png').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(1000)));}
function resultLabel(entry){return String(entry?.title||entry?.slug||`Emoji ${entry?.id||''}`).slice(0,100);} function resultDescription(entry){const bits=[entry?.category,entry?.id?`Emoji.gg #${entry.id}`:null].filter(Boolean);return String(bits.join(' • ')||'Emoji.gg result').slice(0,100);}
function searchResultsPanel(results,query,interaction){const clean=Array.isArray(results)?results.slice(0,25):[];const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🔎 Emoji.gg Results').setDescription(clean.length?`Found **${clean.length}** result(s) for **${String(query).slice(0,80)}**. Select one to import it into Emoji Studio and add it to this server.`:`No results found for **${String(query).slice(0,80)}**.`).setFooter({text:`Requested by ${memberName(interaction)}`});const components=[];if(clean.length)components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:import').setPlaceholder('Choose an emoji to import').setMinValues(1).setMaxValues(1).addOptions(clean.map(entry=>({label:resultLabel(entry),value:String(entry.id),description:resultDescription(entry)})))));components.push(row(button('admin:module:emojis:search-open','🔎 Search Again',ButtonStyle.Primary),button('admin:module:emojis:panel','⬅️ Emoji Studio',ButtonStyle.Secondary)));return{embeds:[embed],components};}
function coreSearchResultsPanel(alias,results,query,interaction){const clean=Array.isArray(results)?results.slice(0,25):[];const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`🔎 Choose image for :${alias}:`).setDescription(clean.length?`Found **${clean.length}** Emoji.gg result(s) for **${String(query).slice(0,80)}**. The selected image will become Goliath Core \`:${alias}:\`.`:`No Emoji.gg results found for **${String(query).slice(0,80)}**.`).setFooter({text:`Requested by ${memberName(interaction)}`});const components=[];if(clean.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:emojis:core-search-import:${alias}`).setPlaceholder(`Choose Emoji.gg image for :${alias}:`).setMinValues(1).setMaxValues(1).addOptions(clean.map(entry=>({label:resultLabel(entry),value:String(entry.id),description:resultDescription(entry)})))));components.push(row(button('admin:module:emojis:core','⬅️ Goliath Core',ButtonStyle.Secondary)));return{embeds:[embed],components};}
function coreReplaceSearchResultsPanel(emoji,results,query,interaction){const clean=Array.isArray(results)?results.slice(0,25):[];const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`🔄 Replace :${emoji.alias}: image`).setDescription(clean.length?`Found **${clean.length}** Emoji.gg result(s) for **${String(query).slice(0,80)}**. Select one to replace the current Core image while keeping the alias \`:${emoji.alias}:\`.`:`No Emoji.gg results found for **${String(query).slice(0,80)}**.`).setFooter({text:`Requested by ${memberName(interaction)}`});const components=[];if(clean.length)components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:emojis:core-replace-search-import:${emoji.id}`).setPlaceholder(`Choose replacement for :${emoji.alias}:`).setMinValues(1).setMaxValues(1).addOptions(clean.map(entry=>({label:resultLabel(entry),value:String(entry.id),description:resultDescription(entry)})))));components.push(row(button('admin:module:emojis:core','⬅️ Goliath Core',ButtonStyle.Secondary)));return{embeds:[embed],components};}
function corePanel(overview,interaction,notice=''){const status=Array.isArray(overview.coreStatus)?overview.coreStatus:[];const missing=status.filter(entry=>!entry.installed);const installed=status.filter(entry=>entry.installed&&entry.emoji).map(entry=>entry.emoji);const integrity=overview.coreIntegrity||{healthy:true,rogue:[],duplicates:[]};const isManager=isCoreManagerId(interaction?.user?.id);const statusLine=entry=>`${entry.installed?'✅':'⬜'} **${String(entry.slot).padStart(2,'0')}**  \`:${entry.alias}:\``;const firstHalf=status.slice(0,20).map(statusLine).join('\n')||'No Core slots found.';const secondHalf=status.slice(20,40).map(statusLine).join('\n')||'No Core slots found.';const integrityLine=integrity.healthy?'✅ **Integrity:** Healthy':`⚠️ **Integrity:** ${integrity.duplicates?.length||0} duplicate alias(es), ${integrity.rogue?.length||0} rogue Core name(s)`;const embed=new EmbedBuilder().setColor(integrity.healthy?PANEL_COLOR:0xFEE75C).setTitle('💠 Goliath Core Emojis').setDescription([`**Core usage:** ${overview.coreCapacity.used}/${overview.coreCapacity.max}`,`**Missing:** ${missing.length}`,integrityLine,`**Owner recognised:** ${isManager?'✅ Yes':'❌ No'}`,`**Core uploads:** ${isManager?'✅ Ready':'🔒 Owner only'}`,'**Availability:** Every Goliath guild automatically','**Guild slots used:** 0','**Server favourites used:** 0',isManager?'\n**Owner controls:** Add missing aliases, bulk upload files, replace images, rename, delete, or inspect installed Core emojis below.':'',notice?`\n${notice}`:''].filter(Boolean).join('\n')).addFields({name:'Core Slots 01–20',value:firstHalf,inline:true},{name:'Core Slots 21–40',value:secondHalf,inline:true}).setFooter({text:`Requested by ${memberName(interaction)}`});const components=[];if(isManager&&missing.length){[missing.slice(0,25),missing.slice(25,50)].filter(c=>c.length).forEach((chunk,index)=>components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:emojis:core-add-select:${index}`).setPlaceholder(index===0?'Add missing Core emoji (1)':'Add missing Core emoji (2)').addOptions(chunk.map(entry=>({label:`:${entry.alias}:`,value:entry.alias,description:`Core slot ${String(entry.slot).padStart(2,'0')} • Emoji.gg or image URL`.slice(0,100)}))))));}if(isManager&&installed.length){[installed.slice(0,25),installed.slice(25,50)].filter(c=>c.length).forEach((chunk,index)=>components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:emojis:core-manage-select:${index}`).setPlaceholder(index===0?'Manage installed Core emoji (1)':'Manage installed Core emoji (2)').addOptions(chunk.map(emoji=>({label:`:${emoji.alias}:`.slice(0,100),value:String(emoji.id),description:emoji.animated?'Animated Core emoji':'Static Core emoji',emoji:emoji.component||undefined}))))));}const nav=[button('admin:module:emojis:core-preview','👁️ Preview Core',ButtonStyle.Primary)];if(isManager)nav.push(button('admin:module:emojis:core-bulk-open','📤 Bulk Upload',ButtonStyle.Success));nav.push(button('admin:module:emojis:panel','⬅️ Emoji Studio',ButtonStyle.Secondary));components.push(row(...nav));return{embeds:[embed],components};}
function corePreviewPanel(overview,interaction){const installed=(Array.isArray(overview.coreStatus)?overview.coreStatus:[]).filter(entry=>entry.installed&&entry.emoji);const lines=installed.map(entry=>`${entry.mention||entry.emoji.mention||`:${entry.alias}:`}  \`:${entry.alias}:\`  •  ${entry.animated?'Animated':'Static'}`);const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle('👁️ Goliath Core Emoji Preview').setDescription([`**Installed:** ${installed.length}/${overview.coreCapacity.max}`,'These are the real Discord application emoji mentions Goliath will render.','',lines.length?lines.join('\n'):'No Goliath Core emojis are installed yet.'].join('\n')).setFooter({text:`Requested by ${memberName(interaction)}`}).setTimestamp();return{embeds:[embed],components:[row(button('admin:module:emojis:core-preview','🔄 Refresh Preview',ButtonStyle.Primary),button('admin:module:emojis:core','⬅️ Goliath Core',ButtonStyle.Secondary))]};}
function coreManagePanel(overview,interaction,emoji,notice=''){const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle(`💠 Manage :${emoji.alias}:`).setDescription([emoji.mention||`:${emoji.name}:`,'',`**Alias:** :${emoji.alias}:`,`**Discord name:** ${emoji.name}`,`**ID:** ${emoji.id}`,`**Type:** ${emoji.animated?'Animated':'Static'}`,notice?`\n${notice}`:''].filter(Boolean).join('\n'));return{embeds:[embed],components:[row(button(`admin:module:emojis:core-replace:${emoji.id}`,'🔄 Replace Image',ButtonStyle.Success),button(`admin:module:emojis:core-rename:${emoji.id}`,'✏️ Rename',ButtonStyle.Primary),button(`admin:module:emojis:core-delete:${emoji.id}`,'🗑️ Delete',ButtonStyle.Danger)),row(button('admin:module:emojis:core','⬅️ Goliath Core',ButtonStyle.Secondary))]};}
function bankPanel(overview,interaction){const bank=Array.isArray(overview.studio)?overview.studio:[];const selected=new Set((overview.favourites||[]).map(String));const options=bank.slice(0,25).map(emoji=>({label:`:${emoji.name}:`.slice(0,100),value:String(emoji.id),description:`${selected.has(String(emoji.id))?'Selected for this server':'Not selected'} • ${emoji.animated?'Animated':'Static'}`.slice(0,100),emoji:emoji.component||undefined}));const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🌐 Emoji Studio Bank').setDescription([`**Studio usage:** ${overview.studioCapacity.used}/${overview.studioCapacity.max}`,`**Reserved Core:** ${overview.coreCapacity.used}/${overview.coreCapacity.max}`,`**This server:** ${overview.guildCapacity.used}/${overview.guildCapacity.max}`,'',options.length?'Select an Emoji Studio emoji to add/remove it from this server. Showing the first 25 Studio entries.':'The Emoji Studio bank is empty.'].join('\n'));const components=[];if(options.length)components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:bank-toggle').setPlaceholder('Add/remove a Studio emoji').addOptions(options)));components.push(row(button('admin:module:emojis:panel','⬅️ Emoji Studio',ButtonStyle.Secondary)));return{embeds:[embed],components};}
function guildPanel(overview,interaction){const selectedIds=new Set((overview.favourites||[]).map(String));const selected=(overview.studio||[]).filter(emoji=>selectedIds.has(String(emoji.id))).slice(0,25);const embed=new EmbedBuilder().setColor(PANEL_COLOR).setTitle('😀 This Server\'s Emoji Studio Favourites').setDescription([`**Selected:** ${overview.guildCapacity.used}/${overview.guildCapacity.max}`,`**Plus Goliath Core:** ${overview.coreCapacity.used} always available`,'',selected.length?'Select an emoji below to remove it from this server. Showing up to 25 at a time.':'No optional Emoji Studio emojis are selected for this server yet.'].join('\n'));const components=[];if(selected.length)components.push(row(new StringSelectMenuBuilder().setCustomId('admin:module:emojis:guild-remove').setPlaceholder('Remove a server emoji').addOptions(selected.map(emoji=>({label:`:${emoji.name}:`.slice(0,100),value:String(emoji.id),description:emoji.animated?'Animated application emoji':'Static application emoji',emoji:emoji.component||undefined})) )));components.push(row(button('admin:module:emojis:panel','⬅️ Emoji Studio',ButtonStyle.Secondary)));return{embeds:[embed],components};}
async function sendPanel(interaction,payload){if(interaction.deferred||interaction.replied)return interaction.editReply(payload);if(interaction.isModalSubmit?.())return interaction.reply({...payload,flags:MessageFlags.Ephemeral});return interaction.update(payload);}

async function handleDiscordInteraction(interaction){
  const id=String(interaction?.customId||''); if(!id.startsWith('admin:module:emojis:'))return false;
  if(id==='admin:module:emojis:panel'){await sendPanel(interaction,await buildDiscordPanel(interaction));return true;}
  if(id==='admin:module:emojis:toggle'&&interaction.isButton?.()){const current=emojiStore.getSection(interaction.guild.id).enabled;guildManager.setModuleEnabled(interaction.guild.id,'emojis',!current,{actorId:interaction.user?.id||null,action:'emoji_discord_toggle'});await sendPanel(interaction,await buildDiscordPanel(interaction,`Emoji Studio ${!current?'enabled':'disabled'}. Goliath Core remains available.`));return true;}
  if(id==='admin:module:emojis:search-open'&&interaction.isButton?.()){await interaction.showModal(searchModal());return true;}
  if(id==='admin:module:emojis:search-submit'&&interaction.isModalSubmit?.()){if(!emojiStore.getSection(interaction.guild.id).enabled)throw new Error('Enable Emoji Studio before importing emojis.');const query=interaction.fields.getTextInputValue('query');const results=await emojiApi.search(query,25);await sendPanel(interaction,searchResultsPanel(results,query,interaction));return true;}
  if(id==='admin:module:emojis:import'&&interaction.isStringSelectMenu?.()){if(!emojiStore.getSection(interaction.guild.id).enabled)throw new Error('Enable Emoji Studio before importing emojis.');await interaction.deferUpdate();const result=await emojis.importFromEmojiGG(interaction.client,interaction.values?.[0]);emojiStore.setFavourite(interaction.guild.id,result.emoji.id,true,{actorId:interaction.user?.id||null,action:'emoji_discord_import'});await interaction.editReply(await buildDiscordPanel(interaction,`${result.created?'✅ Imported':'✅ Reused'} :${result.emoji.name}: and selected it for this server.`));return true;}
  if(id==='admin:module:emojis:core'&&interaction.isButton?.()){await sendPanel(interaction,corePanel(await discordOverview(interaction),interaction));return true;}
  if(id==='admin:module:emojis:core-preview'&&interaction.isButton?.()){await sendPanel(interaction,corePreviewPanel(await discordOverview(interaction),interaction));return true;}
  if(id==='admin:module:emojis:core-bulk-open'&&interaction.isButton?.()){requireCoreManagerInteraction(interaction);await interaction.showModal(coreBulkUploadModal());return true;}
  if(id==='admin:module:emojis:core-bulk-submit'&&interaction.isModalSubmit?.()){
    requireCoreManagerInteraction(interaction);
    const uploads=interaction.fields.getUploadedFiles('coreFiles',true);
    if(!uploads?.size)throw new Error('Upload at least one Core emoji image.');
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const before=await discordOverview(interaction);
    const installed=new Set((before.coreStatus||[]).filter(entry=>entry.installed).map(entry=>entry.alias));
    const lines=[];let added=0;let skipped=0;let failed=0;
    for(const attachment of uploads.values()){
      const alias=coreAliasFromFilename(attachment.name);
      if(!alias){failed+=1;lines.push(`❌ **${String(attachment.name).slice(0,60)}** — filename did not match a Core alias.`);continue;}
      if(installed.has(alias)){skipped+=1;lines.push(`⏭️ **${String(attachment.name).slice(0,60)}** — :${alias}: already installed.`);continue;}
      try{
        const source=await downloadDiscordAttachment(attachment);
        const prepared=await emojiProcessor.prepareEmojiBuffer(source,{size:512,padding:32});
        if(prepared.buffer.length>emojiApi.MAX_BYTES)throw new Error(`processed image is ${prepared.buffer.length} bytes; Discord limit is ${emojiApi.MAX_BYTES}`);
        const result=await emojis.createCoreEmoji(interaction.client,prepared.buffer,alias);
        if(result.created){added+=1;installed.add(alias);lines.push(`✅ **${String(attachment.name).slice(0,60)}** → :${alias}: ${prepared.processed?'512×512 centred':'preserved'}`);}else{skipped+=1;installed.add(alias);lines.push(`⏭️ **${String(attachment.name).slice(0,60)}** — :${alias}: already installed.`);}
      }catch(error){failed+=1;lines.push(`❌ **${String(attachment.name).slice(0,60)}** → :${alias}: ${String(error?.message||error).slice(0,120)}`);}
    }
    const notice=[`📤 **Bulk upload:** ${added} added • ${skipped} skipped • ${failed} failed`,...lines,'','Files were processed in memory and uploaded as Discord application emojis. Guild emoji slots used: **0**.'].join('\n');
    await interaction.editReply(corePanel(await discordOverview(interaction),interaction,notice));
    return true;
  }
  if(id.startsWith('admin:module:emojis:core-add-select')&&interaction.isStringSelectMenu?.()){requireCoreManagerInteraction(interaction);const alias=String(interaction.values?.[0]||'');if(!emojis.isApprovedCoreAlias(alias))throw new Error('Unknown Goliath Core emoji alias.');await interaction.showModal(coreSourceModal(alias));return true;}
  if(id.startsWith('admin:module:emojis:core-add-submit:')&&interaction.isModalSubmit?.()){requireCoreManagerInteraction(interaction);const alias=id.slice('admin:module:emojis:core-add-submit:'.length);if(!emojis.isApprovedCoreAlias(alias))throw new Error('Unknown Goliath Core emoji alias.');const query=String(interaction.fields.getTextInputValue('query')||'').trim();const imageUrl=String(interaction.fields.getTextInputValue('imageUrl')||'').trim();if(!query&&!imageUrl)throw new Error('Enter an Emoji.gg search or a direct image URL.');if(imageUrl){await interaction.deferReply({flags:MessageFlags.Ephemeral});const attachment=await emojiApi.downloadAsset(imageUrl);const result=await emojis.createCoreEmoji(interaction.client,attachment,alias);await interaction.editReply(corePanel(await discordOverview(interaction),interaction,`${result.created?'✅ Added':'✅ Already installed'} :${alias}:`));return true;}await interaction.deferReply({flags:MessageFlags.Ephemeral});const results=await emojiApi.search(query,25);await interaction.editReply(coreSearchResultsPanel(alias,results,query,interaction));return true;}
  if(id.startsWith('admin:module:emojis:core-search-import:')&&interaction.isStringSelectMenu?.()){requireCoreManagerInteraction(interaction);const alias=id.slice('admin:module:emojis:core-search-import:'.length);if(!emojis.isApprovedCoreAlias(alias))throw new Error('Unknown Goliath Core emoji alias.');await interaction.deferUpdate();const source=await emojiApi.findById(interaction.values?.[0]);if(!source)throw new Error('Emoji.gg emoji was not found.');const url=emojiApi.assetUrl(source);if(!url)throw new Error('Emoji.gg did not provide an image URL for this emoji.');const attachment=await emojiApi.downloadAsset(url);const result=await emojis.createCoreEmoji(interaction.client,attachment,alias);await interaction.editReply(corePanel(await discordOverview(interaction),interaction,`${result.created?'✅ Imported':'✅ Already installed'} :${alias}: from Emoji.gg.`));return true;}
  if(id.startsWith('admin:module:emojis:core-manage-select')&&interaction.isStringSelectMenu?.()){requireCoreManagerInteraction(interaction);const overview=await discordOverview(interaction);const emoji=(overview.core||[]).find(entry=>String(entry.id)===String(interaction.values?.[0]||''));if(!emoji)throw new Error('That Goliath Core emoji no longer exists.');await sendPanel(interaction,coreManagePanel(overview,interaction,emoji));return true;}
  if(id.startsWith('admin:module:emojis:core-replace:')&&interaction.isButton?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-replace:'.length);const overview=await discordOverview(interaction);const emoji=(overview.core||[]).find(entry=>String(entry.id)===emojiId);if(!emoji)throw new Error('That Goliath Core emoji no longer exists.');await interaction.showModal(coreReplaceModal(emoji));return true;}
  if(id.startsWith('admin:module:emojis:core-replace-submit:')&&interaction.isModalSubmit?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-replace-submit:'.length);const overview=await discordOverview(interaction);const emoji=(overview.core||[]).find(entry=>String(entry.id)===emojiId);if(!emoji)throw new Error('That Goliath Core emoji no longer exists.');const query=String(interaction.fields.getTextInputValue('query')||'').trim();const imageUrl=String(interaction.fields.getTextInputValue('imageUrl')||'').trim();if(!query&&!imageUrl)throw new Error('Enter an Emoji.gg search or a direct image URL.');if(imageUrl){await interaction.deferReply({flags:MessageFlags.Ephemeral});const attachment=await emojiApi.downloadAsset(imageUrl);const result=await emojis.replaceCoreEmoji(interaction.client,emojiId,attachment);await interaction.editReply(coreManagePanel(await discordOverview(interaction),interaction,result.emoji,`✅ Replaced image for :${result.emoji.alias}:`));return true;}await interaction.deferReply({flags:MessageFlags.Ephemeral});const results=await emojiApi.search(query,25);await interaction.editReply(coreReplaceSearchResultsPanel(emoji,results,query,interaction));return true;}
  if(id.startsWith('admin:module:emojis:core-replace-search-import:')&&interaction.isStringSelectMenu?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-replace-search-import:'.length);await interaction.deferUpdate();const source=await emojiApi.findById(interaction.values?.[0]);if(!source)throw new Error('Emoji.gg emoji was not found.');const url=emojiApi.assetUrl(source);if(!url)throw new Error('Emoji.gg did not provide an image URL for this emoji.');const attachment=await emojiApi.downloadAsset(url);const result=await emojis.replaceCoreEmoji(interaction.client,emojiId,attachment);await interaction.editReply(coreManagePanel(await discordOverview(interaction),interaction,result.emoji,`✅ Replaced image for :${result.emoji.alias}: from Emoji.gg.`));return true;}
  if(id.startsWith('admin:module:emojis:core-rename:')&&interaction.isButton?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-rename:'.length);const overview=await discordOverview(interaction);const emoji=(overview.core||[]).find(entry=>String(entry.id)===emojiId);if(!emoji)throw new Error('That Goliath Core emoji no longer exists.');await interaction.showModal(coreRenameModal(emoji));return true;}
  if(id.startsWith('admin:module:emojis:core-rename-submit:')&&interaction.isModalSubmit?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-rename-submit:'.length);const alias=interaction.fields.getTextInputValue('alias');if(!emojis.isApprovedCoreAlias(alias))throw new Error('Use one of the locked Goliath Core emoji aliases.');await interaction.deferReply({flags:MessageFlags.Ephemeral});const emoji=await emojis.renameInBank(interaction.client,emojiId,alias,{allowCore:true});await interaction.editReply(coreManagePanel(await discordOverview(interaction),interaction,emoji,`✅ Renamed to :${emoji.alias}:`));return true;}
  if(id.startsWith('admin:module:emojis:core-delete:')&&interaction.isButton?.()){requireCoreManagerInteraction(interaction);const emojiId=id.slice('admin:module:emojis:core-delete:'.length);const overview=await discordOverview(interaction);const target=(overview.core||[]).find(entry=>String(entry.id)===emojiId);if(!target)throw new Error('That Goliath Core emoji no longer exists.');await emojis.removeFromBank(interaction.client,emojiId,{allowCore:true});await sendPanel(interaction,corePanel(await discordOverview(interaction),interaction,`🗑️ Removed :${target.alias}: from Goliath Core.`));return true;}
  if(id==='admin:module:emojis:bank'&&interaction.isButton?.()){await sendPanel(interaction,bankPanel(await discordOverview(interaction),interaction));return true;}
  if(id==='admin:module:emojis:guild'&&interaction.isButton?.()){await sendPanel(interaction,guildPanel(await discordOverview(interaction),interaction));return true;}
  if(id==='admin:module:emojis:bank-toggle'&&interaction.isStringSelectMenu?.()){const emojiId=String(interaction.values?.[0]||'');const overview=await discordOverview(interaction);if((overview.core||[]).some(emoji=>String(emoji.id)===emojiId))throw new Error('Goliath Core emojis are already available to every server and do not use favourites.');const current=emojiStore.getSection(interaction.guild.id);emojiStore.setFavourite(interaction.guild.id,emojiId,!current.favourites.includes(emojiId),{actorId:interaction.user?.id||null,action:'emoji_discord_select'});await sendPanel(interaction,bankPanel(await discordOverview(interaction),interaction));return true;}
  if(id==='admin:module:emojis:guild-remove'&&interaction.isStringSelectMenu?.()){emojiStore.setFavourite(interaction.guild.id,interaction.values?.[0],false,{actorId:interaction.user?.id||null,action:'emoji_discord_remove'});await sendPanel(interaction,guildPanel(await discordOverview(interaction),interaction));return true;}
  return false;
}

router.buildDiscordPanel=buildDiscordPanel;
router.handleDiscordInteraction=handleDiscordInteraction;
module.exports=router;
