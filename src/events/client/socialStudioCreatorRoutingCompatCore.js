'use strict';

// Canonical Social Studio creator/account/user routing core.

const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const accountManagement = require('./socialStudioAccountManagementCompat');
const creatorRoutingCompat = require('../../modules/socialStudio/socialAlerts/socialStudioCreatorRoutingCompat');
const store = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const socialPanel = require('../../modules/socialStudio/socialAlerts/socialStudioPanel');
const { normalizeAccountInput, migrateAccount } = require('../../modules/socialStudio/socialAlerts/accountNormalizer');
const { providerInfo } = require('../../modules/socialStudio/socialAlerts/socialStudioProviders');

const P = 'social:';
const USER_ROUTE_P = 'social:userroute:';
const PLATFORMS = ['facebook', 'instagram', 'kick', 'tiktok', 'twitch', 'x', 'youtube'];
const LABEL = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', kick: 'Kick', facebook: 'Facebook', instagram: 'Instagram', x: 'X' };
const ALERT_TYPES = ['live', 'ended', 'vod', 'clip', 'upload', 'short', 'post'];
const TYPE_LABELS = { all: 'All Content', live: 'LIVE', ended: 'Stream Ended', vod: 'VOD', clip: 'Clip', upload: 'Upload', short: 'Short', post: 'Social Post' };
const TYPE_EMOJI = { all: '🌐', live: '🔴', ended: '⚫', vod: '🎞️', clip: '🎬', upload: '📺', short: '📱', post: '📝' };
const sessions = new Map();
const userRouteSessions = new Map();

function sessionKey(interaction) { return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`; }
function getSession(interaction) { return sessions.get(sessionKey(interaction)) || { creatorId: null, platforms: [] }; }
function setSession(interaction, patch) { const next = { ...getSession(interaction), ...patch }; sessions.set(sessionKey(interaction), next); return next; }
function getUserRouteState(interaction) { return userRouteSessions.get(sessionKey(interaction)) || { targetUserId: null, type: 'all', pendingChannelId: null }; }
function setUserRouteState(interaction, patch) { const next = { ...getUserRouteState(interaction), ...patch }; userRouteSessions.set(sessionKey(interaction), next); return next; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function overrides(config) { return object(config.userChannelOverrides); }
function routesFor(config, userId) { return object(overrides(config)[String(userId || '')]); }
function save(interaction, config) { return store.saveConfig(interaction.guildId, config, { actorId: interaction.user?.id || null, guild: interaction.guild }); }
function who(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }

async function respondValidation(interaction, content) {
  const payload = { content: `⚠️ ${content}`, flags: 64 };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
  return true;
}
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function makeCreatorId(config) { let creatorId; do { creatorId = `creator_${crypto.randomBytes(8).toString('hex')}`; } while (config.creators?.[creatorId]); return creatorId; }
function makeAccountId(config) { let accountId; do { accountId = `account_${crypto.randomBytes(8).toString('hex')}`; } while (config.accounts?.[accountId]); return accountId; }
function clean(value, max) { return String(value || '').trim().slice(0, max); }
function supportedAlerts(platform) { const raw = providerInfo(platform)?.supportedAlertTypes || []; const supported = raw.filter((type) => ALERT_TYPES.includes(type)); if (supported.includes('live') && !supported.includes('ended')) supported.splice(1, 0, 'ended'); return supported; }
function canonicalKey(account) { const migrated = migrateAccount(account); const identity = String(migrated.canonicalIdentity || migrated.externalId || migrated.normalizedUsername || migrated.username || '').toLowerCase(); return `${String(migrated.platform || '').toLowerCase()}:${identity}`; }
function platformSelect(selected = []) { return row(new StringSelectMenuBuilder().setCustomId(`${P}account:platforms`).setPlaceholder('Select platform(s) to add an account').setMinValues(1).setMaxValues(5).addOptions(PLATFORMS.map((platform) => ({ label: LABEL[platform], value: platform, default: selected.includes(platform) })))); }

function accountAddPayload(interaction, creator, selected = []) {
  const config = store.getConfig(interaction.guildId);
  const selectedText = selected.length ? selected.map((platform) => LABEL[platform] || platform).join(', ') : 'None';
  return { embeds: [new EmbedBuilder().setColor(config.enabled ? 0x5865F2 : 0x747F8D).setTitle('➕ Add Accounts').setDescription([`Add one or more social accounts to **${creator.displayName || creator.creatorId}**.`, '', 'Select up to 5 platforms, then continue. The next form will ask for a username, channel ID or URL for each selected platform.', '', `**Selected:** ${selectedText}`].join('\n')).setFooter({ text: `Requested by ${who(interaction)}` }).setTimestamp()], components: [platformSelect(selected), row(button(`${P}creators`, '⬅️ Back'), button(`${P}account:continue`, '➡️ Continue', ButtonStyle.Success, !selected.length))] };
}
function accountModal(platforms) { const modal = new ModalBuilder().setCustomId(`${P}account:create-multi`).setTitle('Add Social Accounts'); for (const platform of platforms.slice(0, 5)) modal.addComponents(row(new TextInputBuilder().setCustomId(`account_${platform}`).setLabel(`${LABEL[platform]} username, channel ID or URL`).setPlaceholder(`Paste the ${LABEL[platform]} profile URL, username or ID here`).setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(true))); return modal; }

function userDisplay(interaction, userId) { if (!userId) return 'None'; const member = interaction.guild?.members?.cache?.get?.(userId); return member ? `${member.displayName} (<@${userId}>)` : `<@${userId}>`; }
function creatorAccountsForUser(config, userId) { const uid = String(userId || ''); const ids = new Set(); for (const creator of Object.values(config.creators || {})) { const owner = String(creator?.ownerDiscordId || creator?.discordUserId || creator?.userId || ''); if (owner !== uid) continue; for (const id of creator.accountIds || []) ids.add(String(id)); } for (const [id, account] of Object.entries(config.accounts || {})) if (String(account?.discordUserId || account?.ownerDiscordId || '') === uid) ids.add(String(id)); return [...ids]; }
function platformsForUser(config, userId) { return [...new Set(creatorAccountsForUser(config, userId).map((accountId) => String(config.accounts?.[accountId]?.platform || '').toLowerCase()).filter(Boolean))]; }
function routeSummary(routes) { const lines = []; for (const type of ['all', ...ALERT_TYPES]) if (routes[type]) lines.push(`${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}:** <#${routes[type]}>`); return lines.length ? lines.join('\n') : 'No direct user overrides. This user follows the server routing.'; }
function effectiveRoute(config, routes, type, platform = '') { if (routes[type]) return { channelId: routes[type], source: 'User Override' }; if (routes.all) return { channelId: routes.all, source: 'User All Content' }; if (platform && config.platformChannels?.[platform]) return { channelId: config.platformChannels[platform], source: `Server ${platform} Platform Override` }; if (config.alertChannels?.[type]) return { channelId: config.alertChannels[type], source: 'Server Dedicated' }; if (config.alertsChannelId) return { channelId: config.alertsChannelId, source: 'Server Default' }; return { channelId: null, source: 'Not configured' }; }
function effectivePreview(config, routes, userId) { const platforms = platformsForUser(config, userId); const samples = platforms.length ? platforms : ['']; return ALERT_TYPES.map((type) => { const resolved = samples.map((platform) => ({ platform, ...effectiveRoute(config, routes, type, platform) })); const unique = new Map(resolved.map((item) => [`${item.channelId || ''}:${item.source}`, item])); if (unique.size === 1) { const item = [...unique.values()][0]; return `${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}** → ${item.channelId ? `<#${item.channelId}>` : 'Not configured'} *(${item.source})*`; } const details = resolved.map((item) => `${item.platform.toUpperCase()}: ${item.channelId ? `<#${item.channelId}>` : 'Not configured'} (${item.source})`).join(' • '); return `${TYPE_EMOJI[type] || '🔔'} **${TYPE_LABELS[type] || type}** → *varies by platform* — ${details}`; }).join('\n'); }

function userRoutePayload(interaction) {
  const config = store.getConfig(interaction.guildId); const state = getUserRouteState(interaction); const routes = routesFor(config, state.targetUserId); const currentRouteChannel = routes[state.type] || null; const pendingChannelId = state.pendingChannelId || currentRouteChannel || null; const configuredUsers = Object.entries(overrides(config)).filter(([, route]) => Object.values(object(route)).some(Boolean));
  const desc = ['Route each creator\'s automatic Social Studio posts to their own Discord channels. Anything not overridden falls back to the server routing.', '', '**Fallback:** User content route → User All Content → Server Platform Override → Server Dedicated route → Server Default channel.', '', `**Configured Users:** ${configuredUsers.length}`, `**Selected User:** ${userDisplay(interaction, state.targetUserId)}`, state.targetUserId ? `\n**Current User Routes**\n${routeSummary(routes)}` : '\nSelect a Discord user below to manage their routing.', state.targetUserId ? `\n**Effective Routing Preview**\n${effectivePreview(config, routes, state.targetUserId)}` : ''].filter(Boolean).join('\n');
  const userMenu = new UserSelectMenuBuilder().setCustomId(`${USER_ROUTE_P}user`).setPlaceholder('1. Choose the Discord user').setMinValues(1).setMaxValues(1); if (state.targetUserId && typeof userMenu.setDefaultUsers === 'function') userMenu.setDefaultUsers([state.targetUserId]); const components = [row(userMenu)];
  if (state.targetUserId) { const typeMenu = new StringSelectMenuBuilder().setCustomId(`${USER_ROUTE_P}type`).setPlaceholder('2. Choose the content type').setMinValues(1).setMaxValues(1).addOptions(['all', ...ALERT_TYPES].map((type) => ({ label: `${TYPE_EMOJI[type] || '🔔'} ${TYPE_LABELS[type] || type}`, value: type, description: type === 'all' ? 'Send every content type for this user to one channel.' : `Override only ${TYPE_LABELS[type] || type} posts.`, default: type === state.type }))); components.push(row(typeMenu)); const channel = new ChannelSelectMenuBuilder().setCustomId(`${USER_ROUTE_P}channel`).setPlaceholder(`3. Choose destination for ${TYPE_LABELS[state.type] || state.type}`).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1); if (pendingChannelId) channel.setDefaultChannels([pendingChannelId]); components.push(row(channel)); const pendingChanged = Boolean(state.pendingChannelId && state.pendingChannelId !== currentRouteChannel); components.push(row(button(`${USER_ROUTE_P}save`, '💾 Set Route', ButtonStyle.Primary, !state.pendingChannelId || !pendingChanged), button(`${USER_ROUTE_P}clear`, `🧹 Clear ${TYPE_LABELS[state.type] || state.type}`, ButtonStyle.Secondary, !currentRouteChannel), button(`${USER_ROUTE_P}clearall`, '🗑️ Clear All User Routes', ButtonStyle.Danger, !Object.values(routes).some(Boolean)))); }
  components.push(row(button('social:channels', '⬅️ Channels'), button('social:main', '🏠 Social Studio')));
  return { embeds: [new EmbedBuilder().setColor(config.enabled ? 0x5865F2 : 0x747F8D).setTitle('👥 User Automatic Post Routing').setDescription(desc).setFooter({ text: `Requested by ${who(interaction)}` }).setTimestamp()], components };
}
async function updateUserRoute(interaction) { const payload = userRoutePayload(interaction); if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
async function handleUserChannelRouting(interaction) { const id = String(interaction?.customId || ''); if (!interaction.guildId) return false; if (id === `${USER_ROUTE_P}open`) { setUserRouteState(interaction, { targetUserId: null, type: 'all', pendingChannelId: null }); return updateUserRoute(interaction); } if (!id.startsWith(USER_ROUTE_P)) return false; if (id === `${USER_ROUTE_P}user`) { setUserRouteState(interaction, { targetUserId: interaction.values?.[0] || null, type: 'all', pendingChannelId: null }); return updateUserRoute(interaction); } if (id === `${USER_ROUTE_P}type`) { const type = interaction.values?.[0] || 'all'; setUserRouteState(interaction, { type: ['all', ...ALERT_TYPES].includes(type) ? type : 'all', pendingChannelId: null }); return updateUserRoute(interaction); } if (id === `${USER_ROUTE_P}channel`) { setUserRouteState(interaction, { pendingChannelId: interaction.values?.[0] || null }); return updateUserRoute(interaction); } if (id === `${USER_ROUTE_P}save`) { const config = store.getConfig(interaction.guildId); const state = getUserRouteState(interaction); if (!state.targetUserId) throw new Error('Choose a Discord user first.'); if (!state.pendingChannelId) throw new Error('Choose a destination channel first.'); config.userChannelOverrides = { ...overrides(config) }; config.userChannelOverrides[state.targetUserId] = { ...routesFor(config, state.targetUserId), [state.type]: state.pendingChannelId }; save(interaction, config); setUserRouteState(interaction, { pendingChannelId: null }); return updateUserRoute(interaction); } if (id === `${USER_ROUTE_P}clear` || id === `${USER_ROUTE_P}clearall`) { const config = store.getConfig(interaction.guildId); const state = getUserRouteState(interaction); if (!state.targetUserId) throw new Error('Choose a Discord user first.'); config.userChannelOverrides = { ...overrides(config) }; if (id.endsWith('clearall')) delete config.userChannelOverrides[state.targetUserId]; else { const routes = { ...routesFor(config, state.targetUserId) }; delete routes[state.type]; if (Object.values(routes).some(Boolean)) config.userChannelOverrides[state.targetUserId] = routes; else delete config.userChannelOverrides[state.targetUserId]; } save(interaction, config); setUserRouteState(interaction, { pendingChannelId: null }); return updateUserRoute(interaction); } return false; }

async function handleCreatorCreate(interaction) {
  if (String(interaction?.customId || '') !== `${P}creator:create`) return false; if (!interaction.guildId || !interaction.isModalSubmit?.()) return false; if (!socialPanel.canManageSocialStudio(interaction)) { if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: 'You do not have permission to manage Social Studio.', flags: 64 }); return true; }
  const displayName = clean(interaction.fields.getTextInputValue('displayName'), 120); if (!displayName) return respondValidation(interaction, 'Creator display name is required.'); const config = store.getConfig(interaction.guildId); config.creators = config.creators && typeof config.creators === 'object' ? { ...config.creators } : {}; const creatorId = makeCreatorId(config); const timestamp = new Date().toISOString(); config.creators[creatorId] = { creatorId, displayName, group: clean(interaction.fields.getTextInputValue('group'), 120), tags: clean(interaction.fields.getTextInputValue('tags'), 300).split(',').map((value) => value.trim().slice(0, 60)).filter(Boolean), notes: clean(interaction.fields.getTextInputValue('notes'), 1000), adminNotes: clean(interaction.fields.getTextInputValue('adminNotes'), 1000), enabled: true, status: 'active', accountIds: [], createdAt: timestamp, updatedAt: timestamp }; save(interaction, config); const payload = socialPanel.buildSectionPanel(interaction, 'creators'); if (interaction.isFromMessage?.()) { await interaction.update(payload); await interaction.followUp({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 }).catch(() => null); } else if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 }); else await interaction.followUp({ content: `✅ Created creator profile **${displayName}**.`, flags: 64 }).catch(() => null); return true;
}

async function handleAccountCreateFlow(interaction) {
  const id = String(interaction?.customId || ''); if (!interaction.guildId) return false; if (id === `${P}creator:select`) { setSession(interaction, { creatorId: interaction.values?.[0] || null, platforms: [] }); return false; } if (![`${P}account:platforms`, `${P}account:continue`, `${P}account:create-multi`].includes(id)) return false; if (!socialPanel.canManageSocialStudio(interaction)) { if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: 'You do not have permission to manage Social Studio.', flags: 64 }); return true; }
  const state = getSession(interaction); const config = store.getConfig(interaction.guildId); const creator = config.creators?.[state.creatorId] || null; if (!creator) return respondValidation(interaction, 'Select a creator profile first.'); if (id === `${P}account:platforms`) { const platforms = (interaction.values || []).filter((platform) => PLATFORMS.includes(platform)).slice(0, 5); setSession(interaction, { platforms }); const payload = accountAddPayload(interaction, creator, platforms); if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; } if (id === `${P}account:continue`) { const platforms = state.platforms.filter((platform) => PLATFORMS.includes(platform)).slice(0, 5); if (!platforms.length) return respondValidation(interaction, 'Select at least one platform first.'); await interaction.showModal(accountModal(platforms)); return true; } if (!interaction.isModalSubmit?.()) return false;
  const platforms = state.platforms.filter((platform) => PLATFORMS.includes(platform)).slice(0, 5); if (!platforms.length) return respondValidation(interaction, 'The selected platforms expired. Open New Account and choose the platforms again.'); const latest = store.getConfig(interaction.guildId); const latestCreator = latest.creators?.[state.creatorId]; if (!latestCreator) return respondValidation(interaction, 'The selected creator profile no longer exists.'); let created = 0; let updated = 0; let duplicatesRemoved = 0;
  for (const platform of platforms) { const rawValue = clean(interaction.fields.getTextInputValue(`account_${platform}`), 500); if (!rawValue) continue; const normalized = normalizeAccountInput(platform, rawValue); const identity = String(normalized.canonicalIdentity || normalized.externalId || normalized.normalizedUsername || normalized.username || '').toLowerCase(); const key = `${platform}:${identity}`; const matches = Object.values(latest.accounts || {}).filter((account) => { try { return canonicalKey(account) === key; } catch { return false; } }); const primary = matches[0] || null; const duplicateIds = matches.slice(1).map((account) => account.accountId); const accountId = primary?.accountId || makeAccountId(latest); const timestamp = new Date().toISOString(); const account = { ...(primary || {}), accountId, platform, username: normalized.username, normalizedUsername: normalized.normalizedUsername, externalId: primary?.externalId || normalized.externalId || null, inputType: normalized.inputType, canonicalIdentity: normalized.canonicalIdentity, profileUrl: normalized.profileUrl, sourceInput: normalized.sourceInput, displayName: latestCreator.displayName, enabled: primary?.enabled !== false, alertTypes: Array.isArray(primary?.alertTypes) ? primary.alertTypes : supportedAlerts(platform), alertChannelId: primary?.alertChannelId || null, alertChannels: primary?.alertChannels && typeof primary.alertChannels === 'object' ? { ...primary.alertChannels } : {}, createdAt: primary?.createdAt || timestamp, updatedAt: timestamp }; store.upsertCreatorAccount(interaction.guildId, latestCreator.creatorId, account, duplicateIds, { actorId: interaction.user?.id || null, guild: interaction.guild }); if (primary) updated += 1; else created += 1; duplicatesRemoved += duplicateIds.length; }
  setSession(interaction, { platforms: [] }); const message = [`✅ Added ${created} new social account${created === 1 ? '' : 's'}.`, updated ? `Updated ${updated} existing account${updated === 1 ? '' : 's'}.` : null, duplicatesRemoved ? `Removed ${duplicatesRemoved} duplicate account entr${duplicatesRemoved === 1 ? 'y' : 'ies'}.` : null].filter(Boolean).join(' '); if (!interaction.deferred && !interaction.replied) await interaction.reply({ content: message, flags: 64 }); else await interaction.followUp({ content: message, flags: 64 }).catch(() => null); return true;
}

async function handle(interaction) {
  if (await handleCreatorCreate(interaction)) return true;
  if (await handleAccountCreateFlow(interaction)) return true;
  if (await handleUserChannelRouting(interaction)) return true;
  if (await creatorRoutingCompat.handle(interaction)) return true;
  if (await accountManagement.handle(interaction)) return true;
  return false;
}

module.exports = { handle };
