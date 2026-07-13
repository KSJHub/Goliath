'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const guildManager = require('../../guild/guildManager');

const PANEL_COLOR = '#5865F2';
const MODULES_PER_PAGE = 10;
const MODULES_PER_ROW = 4;
const CONTROLS_PER_PAGE = 3;

const EXTERNAL_MODULE_ROUTES = new Set([
  'admin:autoRoles',
  'admin:embed',
  'admin:goodbye',
  'admin:welcome',
  'admin:stats',
]);

const SERVER_MODULES = [
  ['admin:autoRoles', 'ðŸ‘¥ Auto Roles', 'Auto Roles', 'Assign roles automatically when members join.'],
  ['admin:embed', 'âœ¨ Embed Studio', 'Embed Studio', 'Build and manage Discord embeds.'],
  ['admin:forms', 'ðŸ“ Forms', 'Forms', 'Forms, submissions, review and response storage.'],
  ['admin:fun', 'ðŸŽ® Fun', 'Fun', 'Fun commands and optional community extras.'],
  ['admin:giveaways', 'ðŸŽ‰ Giveaways', 'Giveaways', 'Giveaway creation, entries, winners and rerolls.'],
  ['admin:goodbye', 'ðŸ‘‹ Goodbye', 'Goodbye', 'Public farewell messages and Embed Studio templates.'],
  ['admin:leveling', 'ðŸ† Leveling', 'Leveling', 'XP, levels, leaderboards and level roles.'],
  ['admin:polls', 'ðŸ“Š Polls', 'Polls', 'Poll creation, voting and results.'],
  ['admin:reactionRoles', 'ðŸ˜Š Reaction Roles', 'Reaction Roles', 'Reaction role panels, emoji mappings and deployments.'],
  ['admin:stats', 'ðŸ“Š Server Stats', 'Server Stats', 'Statbot-style server counters and activity tracking.'],
  ['admin:social', 'ðŸ“£ Social Alerts', 'Social Alerts', 'Creator alerts for Twitch, YouTube, TikTok, Kick and more.'],
  ['admin:starboard', 'â­ Starboard', 'Starboard', 'Highlight popular server messages.'],
  ['admin:sticky', 'ðŸ’¬ Sticky Messages', 'Sticky Messages', 'Keep important messages at the bottom of chat.'],
  ['admin:suggestions', 'ðŸ’¡ Suggestions', 'Suggestions', 'Suggestion intake, voting and review workflow.'],
  ['admin:tempVoice', 'ðŸ”Š Temp Voice', 'Temp Voice', 'Temporary voice channels and room automation.'],
  ['admin:tickets', 'ðŸŽŸï¸ Tickets', 'Tickets', 'Ticket panels, claims, transcripts and recovery.'],
  ['admin:translation', 'ðŸŒ Translation', 'Translation', 'Language preferences and translation controls.'],
  ['admin:verification', 'âœ… Verification', 'Verification', 'Member verification and onboarding protection.'],
].sort((a, b) => a[2].localeCompare(b[2]));

function genericModule(config) {
  return {
    optionMenus: [],
    selectMenus: [],
    toggles: [],
    fields: [],
    status: 'Configure this module using the controls below.',
    ...config,
  };
}

const MODULE_PANEL_REGISTRY = {
  forms: genericModule({ route: 'admin:forms', key: 'forms', title: 'ðŸ“ Forms', summary: 'Forms, submissions, review and response storage.', defaults: { enabled: true, submitChannelId: null, logChannelId: null, managerRoleIds: [], requireReview: true, anonymousSubmissions: false, storeResponses: true }, fields: ['submitChannel', 'logChannel', 'managerRoles', ['requireReview', 'Require Review'], ['anonymousSubmissions', 'Anonymous Submissions'], ['storeResponses', 'Store Responses']], selectMenus: ['submitChannel', 'logChannel', 'managerRoles'], toggles: [['requireReview', 'ðŸ”Ž Require Review'], ['anonymousSubmissions', 'ðŸ‘¤ Anonymous'], ['storeResponses', 'ðŸ’¾ Store Responses']] }),
  fun: genericModule({ route: 'admin:fun', key: 'fun', title: 'ðŸŽ® Fun', summary: 'Fun commands and optional community extras.', defaults: { enabled: true, allowedChannelIds: [], blockedChannelIds: [], managerRoleIds: [], allowImages: true, allowGames: true, familyFriendly: true }, fields: ['allowedChannels', 'blockedChannels', 'managerRoles', ['allowImages', 'Images'], ['allowGames', 'Games'], ['familyFriendly', 'Family Friendly']], selectMenus: ['allowedChannels', 'blockedChannels', 'managerRoles'], toggles: [['allowImages', 'ðŸ–¼ï¸ Images'], ['allowGames', 'ðŸŽ® Games'], ['familyFriendly', 'ðŸ›¡ï¸ Family Friendly']] }),
  giveaways: genericModule({ route: 'admin:giveaways', key: 'giveaways', title: 'ðŸŽ‰ Giveaways', summary: 'Giveaway creation, entries, winners and rerolls.', defaults: { enabled: true, announcementChannelId: null, logChannelId: null, managerRoleIds: [], allowMultipleEntries: false, requireRole: false, pingWinners: true }, fields: ['announcementChannel', 'logChannel', 'managerRoles', ['allowMultipleEntries', 'Multiple Entries'], ['requireRole', 'Require Role'], ['pingWinners', 'Ping Winners']], selectMenus: ['announcementChannel', 'logChannel', 'managerRoles'], toggles: [['allowMultipleEntries', 'ðŸŽŸï¸ Multiple Entries'], ['requireRole', 'ðŸ”’ Require Role'], ['pingWinners', 'ðŸ“£ Ping Winners']] }),
  leveling: genericModule({ route: 'admin:leveling', key: 'leveling', title: 'ðŸ† Leveling', summary: 'XP, levels, leaderboards and level roles.', defaults: { enabled: true, announceChannelId: null, managerRoleIds: [], levelRoleIds: [], trackMessages: true, trackVoice: true, announceLevelUps: true }, fields: ['announceChannel', 'managerRoles', 'levelRoles', ['trackMessages', 'Message XP'], ['trackVoice', 'Voice XP'], ['announceLevelUps', 'Announce Level Ups']], selectMenus: ['announceChannel', 'managerRoles', 'levelRoles'], toggles: [['trackMessages', 'ðŸ’¬ Message XP'], ['trackVoice', 'ðŸ”Š Voice XP'], ['announceLevelUps', 'ðŸ“£ Level Ups']] }),
  polls: genericModule({ route: 'admin:polls', key: 'polls', title: 'ðŸ“Š Polls', summary: 'Poll creation, voting and results.', defaults: { enabled: true, defaultChannelId: null, resultsChannelId: null, managerRoleIds: [], anonymousVoting: false, allowMultipleChoice: true, showResultsLive: true }, fields: ['defaultChannel', 'resultsChannel', 'managerRoles', ['anonymousVoting', 'Anonymous Voting'], ['allowMultipleChoice', 'Multiple Choice'], ['showResultsLive', 'Live Results']], selectMenus: ['defaultChannel', 'resultsChannel', 'managerRoles'], toggles: [['anonymousVoting', 'ðŸ‘¤ Anonymous Voting'], ['allowMultipleChoice', 'â˜‘ï¸ Multiple Choice'], ['showResultsLive', 'ðŸ“ˆ Live Results']] }),
  reactionRoles: genericModule({ route: 'admin:reactionRoles', key: 'reactionRoles', title: 'ðŸ˜Š Reaction Roles', summary: 'Reaction role panels, emoji mappings and deployments.', defaults: { enabled: true, panelChannelId: null, logChannelId: null, managerRoleIds: [], allowMultipleRoles: true, removeOnUnreact: true }, fields: ['panelChannel', 'logChannel', 'managerRoles', ['allowMultipleRoles', 'Multiple Roles'], ['removeOnUnreact', 'Remove On Unreact']], selectMenus: ['panelChannel', 'logChannel', 'managerRoles'], toggles: [['allowMultipleRoles', 'ðŸ˜Š Multiple Roles'], ['removeOnUnreact', 'â†©ï¸ Remove On Unreact']] }),
  social: genericModule({ route: 'admin:social', key: 'social', title: 'ðŸ“£ Social Alerts', summary: 'Creator alerts for Twitch, YouTube, TikTok, Kick and more.', defaults: { enabled: true, alertsChannelId: null, logChannelId: null, managerRoleIds: [], twitch: true, youtube: true, tiktok: true, kick: true }, fields: ['alertsChannel', 'logChannel', 'managerRoles', ['twitch', 'Twitch'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['kick', 'Kick']], selectMenus: ['alertsChannel', 'logChannel', 'managerRoles'], toggles: [['twitch', 'ðŸŸ£ Twitch'], ['youtube', 'â–¶ï¸ YouTube'], ['tiktok', 'ðŸŽµ TikTok'], ['kick', 'ðŸŸ¢ Kick']] }),
  starboard: genericModule({ route: 'admin:starboard', key: 'starboard', title: 'â­ Starboard', summary: 'Highlight popular server messages.', defaults: { enabled: true, starboardChannelId: null, logChannelId: null, managerRoleIds: [], allowSelfStar: false, requireUniqueUsers: true }, fields: ['starboardChannel', 'logChannel', 'managerRoles', ['allowSelfStar', 'Self Star'], ['requireUniqueUsers', 'Unique Users']], selectMenus: ['starboardChannel', 'logChannel', 'managerRoles'], toggles: [['allowSelfStar', 'â­ Self Star'], ['requireUniqueUsers', 'ðŸ‘¥ Unique Users']] }),
  sticky: genericModule({ route: 'admin:sticky', key: 'sticky', title: 'ðŸ’¬ Sticky Messages', summary: 'Keep important messages at the bottom of chat.', defaults: { enabled: true, channels: [], managerRoleIds: [], mode: 'per-channel', cleanupPrevious: true, allowEmbeds: true }, fields: ['channels', 'managerRoles', ['mode', 'Mode'], ['cleanupPrevious', 'Cleanup Previous'], ['allowEmbeds', 'Allow Embeds']], selectMenus: ['channels', 'managerRoles'], optionMenus: [{ id: 'mode', placeholder: 'Sticky mode', options: [['per-channel', 'Per Channel', 'One sticky note per selected channel'], ['manual', 'Manual', 'Only staff-triggered sticky notes']] }], toggles: [['cleanupPrevious', 'ðŸ§¹ Cleanup Previous'], ['allowEmbeds', 'ðŸŽ¨ Allow Embeds']] }),
  suggestions: genericModule({ route: 'admin:suggestions', key: 'suggestions', title: 'ðŸ’¡ Suggestions', summary: 'Suggestion intake, voting and review workflow.', defaults: { enabled: true, submitChannelId: null, reviewChannelId: null, approvedChannelId: null, deniedChannelId: null, reviewerRoleIds: [], anonymous: false, voting: true, requireReview: true }, fields: ['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'reviewerRoles', ['voting', 'Voting'], ['requireReview', 'Require Review'], ['anonymous', 'Anonymous']], selectMenus: ['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'reviewerRoles'], toggles: [['voting', 'ðŸ—³ï¸ Voting'], ['requireReview', 'ðŸ”Ž Require Review'], ['anonymous', 'ðŸ‘¤ Anonymous']] }),
  tempVoice: genericModule({ route: 'admin:tempVoice', key: 'tempVoice', title: 'ðŸ”Š Temp Voice', summary: 'Temporary voice channels and room automation.', defaults: { enabled: true, lobbyChannelId: null, categoryId: null, managerRoleIds: [], autoDeleteEmpty: true, allowUserRename: true, allowUserLimit: true }, fields: ['lobbyVoiceChannel', 'category', 'managerRoles', ['autoDeleteEmpty', 'Auto Delete Empty'], ['allowUserRename', 'User Rename'], ['allowUserLimit', 'User Limit']], selectMenus: ['lobbyVoiceChannel', 'category', 'managerRoles'], toggles: [['autoDeleteEmpty', 'ðŸ—‘ï¸ Auto Delete'], ['allowUserRename', 'âœï¸ User Rename'], ['allowUserLimit', 'ðŸ‘¥ User Limit']] }),
  translation: genericModule({ route: 'admin:translation', key: 'translation', title: 'ðŸŒ Translation', summary: 'Language preferences and translation controls.', defaults: { enabled: true, logChannelId: null, managerRoleIds: [], autoDetect: true, allowUserPreferences: true, ephemeralReplies: true }, fields: ['logChannel', 'managerRoles', ['autoDetect', 'Auto Detect'], ['allowUserPreferences', 'User Preferences'], ['ephemeralReplies', 'Ephemeral Replies']], selectMenus: ['logChannel', 'managerRoles'], toggles: [['autoDetect', 'ðŸ”Ž Auto Detect'], ['allowUserPreferences', 'ðŸ‘¤ User Preferences'], ['ephemeralReplies', 'ðŸ™ˆ Ephemeral']] }),
  verification: genericModule({ route: 'admin:verification', key: 'verification', title: 'âœ… Verification', summary: 'Member verification and onboarding protection.', defaults: { enabled: true, verificationChannelId: null, logChannelId: null, verifiedRoleIds: [], pendingRoleIds: [], dmOnVerify: true, removePendingRole: true }, fields: ['verificationChannel', 'logChannel', 'verifiedRoles', 'pendingRoles', ['dmOnVerify', 'DM On Verify'], ['removePendingRole', 'Remove Pending Role']], selectMenus: ['verificationChannel', 'logChannel', 'verifiedRoles', 'pendingRoles'], toggles: [['dmOnVerify', 'ðŸ“© DM On Verify'], ['removePendingRole', 'ðŸ§¹ Remove Pending']] }),
};

const ROUTE_TO_KEY = Object.fromEntries(Object.values(MODULE_PANEL_REGISTRY).map((module) => [module.route, module.key]));

const CHANNEL_FIELDS = {
  alertsChannel: { prop: 'alertsChannelId', label: 'ðŸ“£ Alerts Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  allowedChannels: { prop: 'allowedChannelIds', label: 'âœ… Allowed Channels', max: 10, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  announcementChannel: { prop: 'announcementChannelId', label: 'ðŸŽ‰ Announcement Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  approvedChannel: { prop: 'approvedChannelId', label: 'âœ… Approved Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  blockedChannels: { prop: 'blockedChannelIds', label: 'ðŸš« Blocked Channels', max: 10, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  category: { prop: 'categoryId', label: 'ðŸ“ Category', max: 1, types: [ChannelType.GuildCategory] },
  channels: { prop: 'channels', label: 'ðŸ’¬ Sticky Channels', max: 10, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  defaultChannel: { prop: 'defaultChannelId', label: 'ðŸ“Š Default Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  deniedChannel: { prop: 'deniedChannelId', label: 'âŒ Denied Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  logChannel: { prop: 'logChannelId', label: 'ðŸ“‹ Log Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  announceChannel: { prop: 'announceChannelId', label: 'ðŸ“£ Announce Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  lobbyVoiceChannel: { prop: 'lobbyChannelId', label: 'ðŸ”Š Lobby Voice Channel', max: 1, types: [ChannelType.GuildVoice] },
  panelChannel: { prop: 'panelChannelId', label: 'ðŸ˜Š Panel Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  resultsChannel: { prop: 'resultsChannelId', label: 'ðŸ“ˆ Results Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  reviewChannel: { prop: 'reviewChannelId', label: 'ðŸ”Ž Review Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  starboardChannel: { prop: 'starboardChannelId', label: 'â­ Starboard Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  submitChannel: { prop: 'submitChannelId', label: 'ðŸ“ Submit Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  verificationChannel: { prop: 'verificationChannelId', label: 'âœ… Verification Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
};

const ROLE_FIELDS = {
  managerRoles: { prop: 'managerRoleIds', label: 'ðŸ›¡ï¸ Manager Roles', max: 10 },
  levelRoles: { prop: 'levelRoleIds', label: 'ðŸ† Level Roles', max: 10 },
  reviewerRoles: { prop: 'reviewerRoleIds', label: 'ðŸ”Ž Reviewer Roles', max: 10 },
  verifiedRoles: { prop: 'verifiedRoleIds', label: 'âœ… Verified Roles', max: 10 },
  pendingRoles: { prop: 'pendingRoleIds', label: 'â³ Pending Roles', max: 10 },
};

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function getModuleConfig(guildId, moduleKey) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const current = modules?.[moduleKey];
  return { ...(module?.defaults || {}), ...(current && typeof current === 'object' ? current : {}), enabled: current === false ? false : current?.enabled !== false };
}

function saveModuleConfig(guild, moduleKey, updater) {
  const current = getModuleConfig(guild.id, moduleKey);
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) };
  guildManager.updateGuildSection(guild.id, 'modules', (modules = {}) => ({ ...modules, [moduleKey]: next }), {}, guild);
  return next;
}

function setModuleEnabled(guild, moduleKey, enabled) {
  return saveModuleConfig(guild, moduleKey, (config) => ({ ...config, enabled }));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => `<@&${item}>`).join(', ') : '`None`';
  if (typeof value === 'boolean') return value ? 'Enabled âœ…' : 'Disabled âŒ';
  if (value === null || value === undefined || value === '') return '`Not set`';
  return `\`${String(value)}\``;
}

function buildFieldList(module, config) {
  return (module.fields || []).map((field) => {
    const key = Array.isArray(field) ? field[0] : field;
    const label = Array.isArray(field) ? field[1] : key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    const channel = CHANNEL_FIELDS[key];
    const role = ROLE_FIELDS[key];
    const value = channel ? config[channel.prop] : role ? config[role.prop] : config[key];
    if (channel && channel.max === 1 && value) return `**${label}:** <#${value}>`;
    if (channel && Array.isArray(value)) return `**${label}:** ${value.length ? value.map((id) => `<#${id}>`).join(', ') : '`None`'}`;
    return `**${label}:** ${formatValue(value)}`;
  }).join('\n') || '`No settings yet.`';
}

function buildModuleListPanel(page = 0, memberDisplayName = 'Unknown User') {
  const totalPages = Math.max(1, Math.ceil(SERVER_MODULES.length / MODULES_PER_PAGE));
  const currentPage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageItems = SERVER_MODULES.slice(currentPage * MODULES_PER_PAGE, (currentPage + 1) * MODULES_PER_PAGE);
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle('ðŸ§© Goliath Modules').setDescription(`Select a module to configure.\n\nPage ${currentPage + 1}/${totalPages}`).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  const moduleRows = chunkArray(pageItems.map(([customId, label]) => button(customId, label, ButtonStyle.Primary)), MODULES_PER_ROW).map((buttons) => row(...buttons));
  const navButtons = [];
  if (currentPage > 0) navButtons.push(button(`admin:modules:page:${currentPage - 1}`, 'â¬…ï¸ Back', ButtonStyle.Secondary));
  if (currentPage < totalPages - 1) navButtons.push(button(`admin:modules:page:${currentPage + 1}`, 'Next âž¡ï¸', ButtonStyle.Secondary));
  navButtons.push(button('admin:home', 'ðŸ  Admin Home', ButtonStyle.Secondary));
  return { embeds: [embed], components: [...moduleRows, row(...navButtons)].slice(0, 5) };
}

function buildControlRows(moduleKey) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  const rows = [];
  for (const fieldKey of module.selectMenus || []) {
    if (CHANNEL_FIELDS[fieldKey]) {
      const field = CHANNEL_FIELDS[fieldKey];
      rows.push(row(new ChannelSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:channel:${fieldKey}`).setPlaceholder(field.label).setChannelTypes(...field.types).setMinValues(0).setMaxValues(field.max)));
      continue;
    }
    if (ROLE_FIELDS[fieldKey]) {
      const field = ROLE_FIELDS[fieldKey];
      rows.push(row(new RoleSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:role:${fieldKey}`).setPlaceholder(field.label).setMinValues(0).setMaxValues(field.max)));
    }
  }
  for (const optionMenu of module.optionMenus || []) {
    const options = optionMenu.options.map(([value, label, description]) => ({ value, label, description }));
    rows.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:option:${optionMenu.id}`).setPlaceholder(optionMenu.placeholder).setMinValues(1).setMaxValues(1).addOptions(options)));
  }
  for (const buttons of chunkArray((module.toggles || []).map(([prop, label]) => button(`admin:module:${moduleKey}:toggle:${prop}`, label, ButtonStyle.Secondary)), 3)) rows.push(row(...buttons));
  return rows;
}

function buildModulePanel(guild, moduleKey, memberDisplayName = 'Unknown User', controlPage = 0) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  if (!module) return null;
  const config = getModuleConfig(guild.id, module.key);
  const enabled = config.enabled !== false;
  const controlRows = buildControlRows(module.key);
  const totalPages = Math.max(1, Math.ceil(controlRows.length / CONTROLS_PER_PAGE));
  const currentPage = Math.min(Math.max(Number(controlPage) || 0, 0), totalPages - 1);
  const controls = controlRows.slice(currentPage * CONTROLS_PER_PAGE, (currentPage + 1) * CONTROLS_PER_PAGE);
  const embed = new EmbedBuilder().setColor(enabled ? 0x57f287 : PANEL_COLOR).setTitle(module.title).setDescription([module.summary, '', `**Status:** ${enabled ? 'Enabled âœ…' : 'Disabled âŒ'}`, `**Module Key:** \`${module.key}\``, `**Setup Page:** ${currentPage + 1}/${totalPages}`, '', module.status].join('\n')).addFields({ name: 'Current Setup', value: buildFieldList(module, config), inline: false }).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  const navButtons = [button('admin:modules', 'â¬…ï¸ Modules', ButtonStyle.Secondary)];
  if (currentPage > 0) navButtons.push(button(`admin:module:${module.key}:configpage:${currentPage - 1}`, 'â¬…ï¸ Prev Setup', ButtonStyle.Secondary));
  if (currentPage < totalPages - 1) navButtons.push(button(`admin:module:${module.key}:configpage:${currentPage + 1}`, 'Next Setup âž¡ï¸', ButtonStyle.Secondary));
  return { embeds: [embed], components: [row(button(`admin:module:${module.key}:enable`, 'â–¶ï¸ Enable', ButtonStyle.Success), button(`admin:module:${module.key}:disable`, 'â¸ï¸ Disable', ButtonStyle.Secondary), button(`admin:module:${module.key}:reset`, 'â™»ï¸ Reset', ButtonStyle.Danger)), ...controls, row(...navButtons)].slice(0, 5) };
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) { await interaction.editReply(payload); return true; }
  await interaction.update(payload);
  return true;
}

async function openTicketsPanel(interaction) {
  const { sendSetupPanel } = require('../../../modules/tickets/ticketSetupPanel');
  await sendSetupPanel(interaction);
  return true;
}

function updateChannelSelection(guild, moduleKey, fieldKey, values = []) {
  const field = CHANNEL_FIELDS[fieldKey];
  if (!field) return;
  const cleanValues = [...new Set(values.filter(Boolean))];
  saveModuleConfig(guild, moduleKey, (config) => ({ ...config, [field.prop]: field.max === 1 ? cleanValues[0] || null : cleanValues }));
}

function updateRoleSelection(guild, moduleKey, fieldKey, values = []) {
  const field = ROLE_FIELDS[fieldKey];
  if (!field) return;
  saveModuleConfig(guild, moduleKey, (config) => ({ ...config, [field.prop]: [...new Set(values.filter(Boolean))] }));
}

async function handleModuleAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (customId === 'admin:modules') return safeUpdate(interaction, buildModuleListPanel(0, getMemberDisplayName(interaction)));
  const pageMatch = customId.match(/^admin:modules:page:(\d+)$/);
  if (pageMatch) return safeUpdate(interaction, buildModuleListPanel(Number(pageMatch[1]), getMemberDisplayName(interaction)));
  if (customId === 'admin:tickets') return openTicketsPanel(interaction);
  if (EXTERNAL_MODULE_ROUTES.has(customId)) return false;
  const routeKey = ROUTE_TO_KEY[customId];
  if (routeKey) return safeUpdate(interaction, buildModulePanel(interaction.guild, routeKey, getMemberDisplayName(interaction), 0));
  const configPageMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):configpage:(\d+)$/);
  if (configPageMatch && interaction.isButton?.()) return safeUpdate(interaction, buildModulePanel(interaction.guild, configPageMatch[1], getMemberDisplayName(interaction), Number(configPageMatch[2])));
  const buttonMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):(enable|disable|reset)$/);
  if (buttonMatch && interaction.isButton?.()) {
    const [, moduleKey, action] = buttonMatch;
    if (!MODULE_PANEL_REGISTRY[moduleKey]) return false;
    if (action === 'enable') setModuleEnabled(interaction.guild, moduleKey, true);
    if (action === 'disable') setModuleEnabled(interaction.guild, moduleKey, false);
    if (action === 'reset') saveModuleConfig(interaction.guild, moduleKey, MODULE_PANEL_REGISTRY[moduleKey].defaults);
    return safeUpdate(interaction, buildModulePanel(interaction.guild, moduleKey, getMemberDisplayName(interaction), 0));
  }
  const toggleMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):toggle:([a-zA-Z0-9_-]+)$/);
  if (toggleMatch && interaction.isButton?.()) {
    const [, moduleKey, prop] = toggleMatch;
    if (!MODULE_PANEL_REGISTRY[moduleKey]) return false;
    saveModuleConfig(interaction.guild, moduleKey, (config) => ({ ...config, [prop]: !Boolean(config[prop]) }));
    return safeUpdate(interaction, buildModulePanel(interaction.guild, moduleKey, getMemberDisplayName(interaction), 0));
  }
  const channelMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):channel:([a-zA-Z0-9_-]+)$/);
  if (channelMatch && interaction.isChannelSelectMenu?.()) {
    updateChannelSelection(interaction.guild, channelMatch[1], channelMatch[2], interaction.values || []);
    return safeUpdate(interaction, buildModulePanel(interaction.guild, channelMatch[1], getMemberDisplayName(interaction), 0));
  }
  const roleMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):role:([a-zA-Z0-9_-]+)$/);
  if (roleMatch && interaction.isRoleSelectMenu?.()) {
    updateRoleSelection(interaction.guild, roleMatch[1], roleMatch[2], interaction.values || []);
    return safeUpdate(interaction, buildModulePanel(interaction.guild, roleMatch[1], getMemberDisplayName(interaction), 0));
  }
  const optionMatch = customId.match(/^admin:module:([a-zA-Z0-9_-]+):option:([a-zA-Z0-9_-]+)$/);
  if (optionMatch && interaction.isStringSelectMenu?.()) {
    saveModuleConfig(interaction.guild, optionMatch[1], (config) => ({ ...config, [optionMatch[2]]: interaction.values?.[0] }));
    return safeUpdate(interaction, buildModulePanel(interaction.guild, optionMatch[1], getMemberDisplayName(interaction), 0));
  }
  return false;
}

module.exports = {
  MODULE_PANEL_REGISTRY,
  SERVER_MODULES,
  buildModuleListPanel,
  buildModulePanel,
  handleModuleAdminInteraction,
};

