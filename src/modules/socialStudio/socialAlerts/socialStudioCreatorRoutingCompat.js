'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const store = require('./socialStudioStore');
const { ALERT_TYPES } = require('./socialStudioTemplates');

const P = 'social:';
const PAGE_SIZE = 25;
const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'kick', 'facebook', 'instagram', 'x'];
const PLATFORM_LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const PLATFORM_EMOJI = { twitch: '🟣', youtube: '🔴', tiktok: '🎵', kick: '🟢', facebook: '🔵', instagram: '🟣', x: '⚪' };
const ALERT_LABEL = { live: 'LIVE', ended: 'Stream Ended', vod: 'VOD', clip: 'Clip', upload: 'Upload', short: 'Short', post: 'Social Post' };
const ALERT_EMOJI = { live: '🔴', ended: '⚫', vod: '🎞️', clip: '🎬', upload: '📺', short: '📱', post: '📝' };
const sessions = new Map();

function sessionKey(interaction) { return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`; }
function getSession(interaction) {
  return sessions.get(sessionKey(interaction)) || { routeType: 'default', creatorId: null, creatorPage: 0, platform: 'youtube', creatorPlatform: 'youtube', view: 'hub' };
}
function setSession(interaction, patch) { const next = { ...getSession(interaction), ...patch }; sessions.set(sessionKey(interaction), next); return next; }
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function who(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function embed(config, title, description, interaction) { return new EmbedBuilder().setColor(config.enabled ? 0x5865F2 : 0x747F8D).setTitle(title).setDescription(description).setFooter({ text: `Requested by ${who(interaction)}` }).setTimestamp(); }
function channelSelect(id, selected, placeholder) {
  const menu = new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
  if (selected) menu.setDefaultChannels([selected]);
  return row(menu);
}
function routeTypeSelect(selected) {
  const copy = {
    default: ['🏠 Default Channel', 'Fallback when no creator, platform or dedicated route applies.'],
    live: ['🔴 LIVE Alerts', 'When a creator starts streaming.'], ended: ['⚫ Stream Ended', 'When a live stream finishes.'],
    vod: ['🎥 VOD Posts', 'When a stream replay is available.'], clip: ['🎬 Clip Posts', 'When a new clip is found.'],
    upload: ['📺 Video Uploads', 'When a new video is uploaded.'], short: ['📱 Shorts', 'When a short-form video is found.'], post: ['📝 Social Posts', 'When a normal social post is found.'],
  };
  return row(new StringSelectMenuBuilder().setCustomId(`${P}channel:type`).setPlaceholder('Choose what you want to configure').setMinValues(1).setMaxValues(1).addOptions(['default', ...ALERT_TYPES].map((type) => ({ label: copy[type]?.[0] || type, value: type, description: copy[type]?.[1] || 'Choose the destination channel.', default: type === selected }))));
}
function platformSelect(selected, customId = `${P}channel:platform:select`, descriptionPrefix = 'Route all') {
  return row(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Choose a platform').setMinValues(1).setMaxValues(1).addOptions(PLATFORMS.map((platform) => ({ label: `${PLATFORM_EMOJI[platform]} ${PLATFORM_LABEL[platform]}`, value: platform, description: `${descriptionPrefix} ${PLATFORM_LABEL[platform]} content to one channel.`.slice(0, 100), default: platform === selected }))));
}
function sortedCreators(config) { return Object.values(config.creators || {}).filter((creator) => creator?.creatorId).sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'en-GB', { sensitivity: 'base' })); }
function clampPage(page, pages) { return Math.max(0, Math.min(Number(page) || 0, Math.max(0, pages - 1))); }
function creatorSelect(config, state) {
  const creators = sortedCreators(config); const pages = Math.max(1, Math.ceil(creators.length / PAGE_SIZE)); const page = clampPage(state.creatorPage, pages); const items = creators.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  if (!items.length) return { row: null, pages, page, creators };
  const menu = new StringSelectMenuBuilder().setCustomId(`${P}channel:creator:select`).setPlaceholder(`Choose creator • page ${page + 1}/${pages}`).setMinValues(1).setMaxValues(1).addOptions(items.map((creator) => ({ label: String(creator.displayName || 'Unnamed creator').slice(0, 100), value: creator.creatorId, description: creator.alertChannelId ? `Override: channel ${creator.alertChannelId}`.slice(0, 100) : 'Uses server routing', default: creator.creatorId === state.creatorId })));
  return { row: row(menu), pages, page, creators };
}
function save(interaction, config) { return store.saveConfig(interaction.guildId, config, { actorId: interaction.user?.id || null, guild: interaction.guild }); }
function cloneObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}; }

function channelsHubPayload(interaction) {
  const config = store.getConfig(interaction.guildId);
  const creatorCount = sortedCreators(config).filter((creator) => creator.alertChannelId || Object.values(cloneObject(creator.platformChannels)).some(Boolean)).length;
  const platformCount = PLATFORMS.filter((platform) => config.platformChannels?.[platform]).length;
  const dedicatedCount = ALERT_TYPES.filter((type) => config.alertChannels?.[type]).length;
  const description = [
    'Choose how Social Studio routes automatic posts. All routing layers work together; configuring one does not disable the others.', '',
    `**🏠 Default Channels** • ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : 'Not set'} • ${dedicatedCount} dedicated content route${dedicatedCount === 1 ? '' : 's'}`,
    `**👤 Creator Overrides** • ${creatorCount} configured`, `**📱 Platform Overrides** • ${platformCount} configured`, '',
    '**Routing Priority**', '1. Creator + Platform override', '2. Creator/User override', '3. Platform override', '4. Dedicated content-type channel', '5. Default channel',
  ].join('\n');
  const components = [row(button(`${P}channel:default:open`, '🏠 Default Channels', ButtonStyle.Primary), button(`${P}channel:creator:open`, '👤 Creator Overrides', ButtonStyle.Primary), button(`${P}channel:platform:open`, '📱 Platform Overrides', ButtonStyle.Primary)), row(button(`${P}main`, '⬅️ Back'), button(`${P}settings`, '⚙️ Settings'))];
  return { embeds: [embed(config, '📂 Channels', description, interaction)], components };
}
function defaultChannelsPayload(interaction) {
  const config = store.getConfig(interaction.guildId); const state = getSession(interaction); const routeType = ALERT_TYPES.includes(state.routeType) ? state.routeType : 'default'; const selected = routeType === 'default' ? config.alertsChannelId : config.alertChannels?.[routeType];
  const routeSummary = ALERT_TYPES.map((type) => `${ALERT_EMOJI[type] || '🔔'} **${ALERT_LABEL[type]}:** ${config.alertChannels?.[type] ? `<#${config.alertChannels[type]}>` : 'Default channel'}`).join('\n');
  const description = ['Configure the server Default Channel and the existing dedicated content-type channels.', '', `**🏠 Default Channel:** ${config.alertsChannelId ? `<#${config.alertsChannelId}>` : 'Not set'}`, '', '**Dedicated Content Channels**', routeSummary, '', 'These routes remain active alongside Creator and Platform Overrides.'].join('\n');
  const components = [routeTypeSelect(routeType), channelSelect(`${P}channel:route`, selected, routeType === 'default' ? 'Choose the default channel' : `Choose where ${ALERT_LABEL[routeType]} posts go`)];
  if (routeType !== 'default' && selected) components.push(row(button(`${P}channel:default`, '🏠 Use Default Channel')));
  components.push(row(button(`${P}channels`, '⬅️ Channels'), button(`${P}main`, '🏠 Social Studio')));
  return { embeds: [embed(config, '🏠 Default Channels', description, interaction)], components };
}
function creatorChannelsPayload(interaction) {
  const config = store.getConfig(interaction.guildId); const state = getSession(interaction); const creatorMenu = creatorSelect(config, state); setSession(interaction, { creatorPage: creatorMenu.page }); const selected = config.creators?.[state.creatorId] || null;
  const overridden = sortedCreators(config).filter((creator) => creator.alertChannelId || Object.values(cloneObject(creator.platformChannels)).some(Boolean));
  const summary = overridden.length ? overridden.slice(0, 12).map((creator) => { const platformRoutes = Object.values(cloneObject(creator.platformChannels)).filter(Boolean).length; const base = creator.alertChannelId ? `<#${creator.alertChannelId}>` : 'Server routing'; return `• **${creator.displayName || creator.creatorId}** → ${base}${platformRoutes ? ` • ${platformRoutes} platform override${platformRoutes === 1 ? '' : 's'}` : ''}`; }).join('\n') + (overridden.length > 12 ? `\n• …and ${overridden.length - 12} more` : '') : 'No creator-specific channels are configured.';
  const description = ['Send every automatic Social Studio post for a selected creator to one Discord channel, with optional platform-specific routes.', '', '**How it works**', 'The main creator override applies to all social accounts linked to that Creator Profile.', 'Creator Platform Overrides can route selected platforms somewhere even more specific.', 'If neither applies, posts continue through server Platform Overrides, Dedicated Content Channels, then the Default Channel.', '', '**Current Overrides**', summary, '', selected ? `**Selected Creator:** ${selected.displayName || selected.creatorId}` : '**Selected Creator:** None', selected ? `**Automatic Post Channel:** ${selected.alertChannelId ? `<#${selected.alertChannelId}>` : 'Uses server routing'}` : 'Choose a creator below.'].join('\n');
  const components = [];
  if (creatorMenu.row) components.push(creatorMenu.row);
  if (selected) {
    components.push(channelSelect(`${P}channel:creator:route`, selected.alertChannelId || null, `Choose ${String(selected.displayName || 'creator').slice(0, 70)}'s automatic post channel`));
    components.push(row(
      button(`${P}channel:creator:clear`, '↩️ Use Server Routing', ButtonStyle.Secondary, !selected.alertChannelId),
      button(`${P}channel:creator:platform:open`, '📱 Platform Overrides', ButtonStyle.Primary),
    ));
  }
  if (creatorMenu.pages > 1) components.push(row(button(`${P}channel:creator:prev`, '⬅️ Previous', ButtonStyle.Secondary, creatorMenu.page <= 0), button(`${P}channel:creator:next`, 'Next ➡️', ButtonStyle.Secondary, creatorMenu.page >= creatorMenu.pages - 1)));
  components.push(row(button(`${P}channels`, '⬅️ Channels'), button(`${P}main`, '🏠 Social Studio')));
  return { embeds: [embed(config, '👤 Creator Channel Overrides', description, interaction)], components };
}
function creatorPlatformChannelsPayload(interaction) {
  const config = store.getConfig(interaction.guildId);
  const state = getSession(interaction);
  const creator = config.creators?.[state.creatorId] || null;
  if (!creator) return creatorChannelsPayload(interaction);
  const selectedPlatform = PLATFORMS.includes(state.creatorPlatform) ? state.creatorPlatform : 'youtube';
  const routes = cloneObject(creator.platformChannels);
  const selectedChannel = routes[selectedPlatform] || null;
  const summary = PLATFORMS.map((platform) => `${PLATFORM_EMOJI[platform]} **${PLATFORM_LABEL[platform]}:** ${routes[platform] ? `<#${routes[platform]}>` : creator.alertChannelId ? 'Creator channel' : config.platformChannels?.[platform] ? 'Server platform route' : 'Server routing'}`).join('\n');
  const description = [
    `Set platform-specific destinations for **${creator.displayName || creator.creatorId}**.`, '',
    'These are the most specific Social Studio routes and only affect this Creator Profile.', '',
    '**Fallback Order**', 'Creator + Platform → Creator/User → Server Platform → Content Type → Default', '',
    '**Current Creator Platform Routes**', summary, '',
    `**Selected Platform:** ${PLATFORM_LABEL[selectedPlatform]}`,
    `**Automatic Post Channel:** ${selectedChannel ? `<#${selectedChannel}>` : creator.alertChannelId ? 'Uses Creator Channel' : 'Uses Server Routing'}`,
  ].join('\n');
  const components = [
    platformSelect(selectedPlatform, `${P}channel:creator:platform:select`, 'Route this creator’s'),
    channelSelect(`${P}channel:creator:platform:route`, selectedChannel, `Choose ${creator.displayName || 'creator'} ${PLATFORM_LABEL[selectedPlatform]} channel`),
    row(button(`${P}channel:creator:platform:clear`, '↩️ Use Creator / Server Routing', ButtonStyle.Secondary, !selectedChannel)),
    row(button(`${P}channel:creator:back`, '⬅️ Creator Overrides'), button(`${P}main`, '🏠 Social Studio')),
  ];
  return { embeds: [embed(config, '👤📱 Creator Platform Overrides', description, interaction)], components };
}
function platformChannelsPayload(interaction) {
  const config = store.getConfig(interaction.guildId); const state = getSession(interaction); const selectedPlatform = PLATFORMS.includes(state.platform) ? state.platform : 'youtube'; const selectedChannel = config.platformChannels?.[selectedPlatform] || null;
  const summary = PLATFORMS.map((platform) => `${PLATFORM_EMOJI[platform]} **${PLATFORM_LABEL[platform]}:** ${config.platformChannels?.[platform] ? `<#${config.platformChannels[platform]}>` : 'Server routing'}`).join('\n');
  const description = ['Route all automatic posts from a social platform to a dedicated Discord channel.', '', 'Platform Overrides work alongside Creator, Content-Type and Default routing. Creator/User overrides remain higher priority.', '', '**Current Platform Overrides**', summary, '', `**Selected Platform:** ${PLATFORM_LABEL[selectedPlatform]}`, `**Automatic Post Channel:** ${selectedChannel ? `<#${selectedChannel}>` : 'Uses server routing'}`].join('\n');
  const components = [platformSelect(selectedPlatform), channelSelect(`${P}channel:platform:route`, selectedChannel, `Choose ${PLATFORM_LABEL[selectedPlatform]} destination channel`), row(button(`${P}channel:platform:clear`, '↩️ Use Server Routing', ButtonStyle.Secondary, !selectedChannel)), row(button(`${P}channels`, '⬅️ Channels'), button(`${P}main`, '🏠 Social Studio'))];
  return { embeds: [embed(config, '📱 Platform Channel Overrides', description, interaction)], components };
}
async function update(interaction, payload) { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
async function handle(interaction) {
  const id = String(interaction?.customId || ''); if (!interaction.guildId) return false;
  if (id === `${P}channels`) { setSession(interaction, { view: 'hub' }); return update(interaction, channelsHubPayload(interaction)); }
  if (id === `${P}channel:default:open`) { setSession(interaction, { view: 'default' }); return update(interaction, defaultChannelsPayload(interaction)); }
  if (id === `${P}channel:type`) { setSession(interaction, { routeType: interaction.values?.[0] || 'default', view: 'default' }); return update(interaction, defaultChannelsPayload(interaction)); }
  if (id === `${P}channel:route`) { const config = store.getConfig(interaction.guildId); const type = getSession(interaction).routeType || 'default'; const channelId = interaction.values?.[0] || null; if (type === 'default') config.alertsChannelId = channelId; else { config.alertChannels = cloneObject(config.alertChannels); config.alertChannels[type] = channelId; } save(interaction, config); return update(interaction, defaultChannelsPayload(interaction)); }
  if (id === `${P}channel:default`) { const config = store.getConfig(interaction.guildId); const type = getSession(interaction).routeType || 'default'; if (type !== 'default') { config.alertChannels = cloneObject(config.alertChannels); delete config.alertChannels[type]; save(interaction, config); } return update(interaction, defaultChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:open`) { setSession(interaction, { view: 'creator', creatorId: null, creatorPage: 0, creatorPlatform: 'youtube' }); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:select`) { setSession(interaction, { view: 'creator', creatorId: interaction.values?.[0] || null, creatorPlatform: 'youtube' }); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:prev` || id === `${P}channel:creator:next`) { const state = getSession(interaction); setSession(interaction, { creatorPage: Math.max(0, state.creatorPage + (id.endsWith('next') ? 1 : -1)), creatorId: null, creatorPlatform: 'youtube', view: 'creator' }); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:route`) { const config = store.getConfig(interaction.guildId); const creatorId = getSession(interaction).creatorId; const creator = config.creators?.[creatorId]; if (!creator) throw new Error('Choose a creator profile first.'); creator.alertChannelId = interaction.values?.[0] || null; creator.updatedAt = new Date().toISOString(); save(interaction, config); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:clear`) { const config = store.getConfig(interaction.guildId); const creatorId = getSession(interaction).creatorId; const creator = config.creators?.[creatorId]; if (!creator) throw new Error('Choose a creator profile first.'); creator.alertChannelId = null; creator.updatedAt = new Date().toISOString(); save(interaction, config); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:platform:open`) { const state = getSession(interaction); if (!state.creatorId) throw new Error('Choose a creator profile first.'); setSession(interaction, { view: 'creatorPlatform', creatorPlatform: 'youtube' }); return update(interaction, creatorPlatformChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:platform:select`) { setSession(interaction, { view: 'creatorPlatform', creatorPlatform: interaction.values?.[0] || 'youtube' }); return update(interaction, creatorPlatformChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:platform:route`) { const config = store.getConfig(interaction.guildId); const state = getSession(interaction); const creator = config.creators?.[state.creatorId]; if (!creator) throw new Error('Choose a creator profile first.'); const platform = PLATFORMS.includes(state.creatorPlatform) ? state.creatorPlatform : 'youtube'; const channelId = interaction.values?.[0] || null; creator.platformChannels = cloneObject(creator.platformChannels); if (channelId) creator.platformChannels[platform] = channelId; else delete creator.platformChannels[platform]; creator.updatedAt = new Date().toISOString(); save(interaction, config); return update(interaction, creatorPlatformChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:platform:clear`) { const config = store.getConfig(interaction.guildId); const state = getSession(interaction); const creator = config.creators?.[state.creatorId]; if (!creator) throw new Error('Choose a creator profile first.'); const platform = PLATFORMS.includes(state.creatorPlatform) ? state.creatorPlatform : 'youtube'; creator.platformChannels = cloneObject(creator.platformChannels); delete creator.platformChannels[platform]; creator.updatedAt = new Date().toISOString(); save(interaction, config); return update(interaction, creatorPlatformChannelsPayload(interaction)); }
  if (id === `${P}channel:creator:back`) { setSession(interaction, { view: 'creator' }); return update(interaction, creatorChannelsPayload(interaction)); }
  if (id === `${P}channel:platform:open`) { setSession(interaction, { view: 'platform', platform: 'youtube' }); return update(interaction, platformChannelsPayload(interaction)); }
  if (id === `${P}channel:platform:select`) { setSession(interaction, { view: 'platform', platform: interaction.values?.[0] || 'youtube' }); return update(interaction, platformChannelsPayload(interaction)); }
  if (id === `${P}channel:platform:route`) { const config = store.getConfig(interaction.guildId); const platform = getSession(interaction).platform || 'youtube'; const channelId = interaction.values?.[0] || null; config.platformChannels = cloneObject(config.platformChannels); if (channelId) config.platformChannels[platform] = channelId; else delete config.platformChannels[platform]; save(interaction, config); return update(interaction, platformChannelsPayload(interaction)); }
  if (id === `${P}channel:platform:clear`) { const config = store.getConfig(interaction.guildId); const platform = getSession(interaction).platform || 'youtube'; config.platformChannels = cloneObject(config.platformChannels); delete config.platformChannels[platform]; save(interaction, config); return update(interaction, platformChannelsPayload(interaction)); }
  return false;
}
module.exports = { handle };
