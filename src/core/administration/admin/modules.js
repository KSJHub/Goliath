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
const { saveModuleSection } = require('../../guild/moduleSectionManager');

const PANEL_COLOR = '#5865F2';
const ITEMS_PER_ROW = 4;
const CONTROLS_PER_PAGE = 2;
const ADMIN_FIELD_KEYS = new Set(['logChannel', 'managerRoles', 'reviewerRoles', 'levelRoles']);

const CUSTOM_PANEL_KEYS = new Set([
  'autoRoles', 'birthdays', 'embed', 'emojis', 'forms', 'giveaways', 'goodbye', 'invites', 'leveling',
  'polls', 'privateRooms', 'reactionRoles', 'schedule', 'social', 'starboard', 'stats', 'sticky',
  'suggestions', 'tempVoice', 'temporaryRoles', 'tickets', 'timedRoles', 'verification', 'welcome',
]);

const MODULE_CATALOG = [
  // Community Studio
  { key: 'birthdays', studio: 'communityStudio', route: 'admin:birthdays', label: '🎂 Birthdays', title: '🎂 Birthdays', summary: 'Birthday registration, celebrations and member birthday tools.' },
  { key: 'giveaways', studio: 'communityStudio', route: 'admin:giveaways', label: '🎉 Giveaways', title: '🎉 Giveaways', summary: 'Giveaway creation, entries, winners and rerolls.' },
  { key: 'invites', studio: 'communityStudio', route: 'admin:invites', label: '📨 Invite Studio', title: '📨 Invite Studio', summary: 'Create invite links, attach roles and track member joins.' },
  { key: 'leveling', studio: 'communityStudio', route: 'admin:leveling', label: '🏆 Leveling', title: '🏆 Leveling', summary: 'XP, levels, leaderboards and level roles.' },
  { key: 'polls', studio: 'communityStudio', route: 'admin:polls', label: '📊 Polls', title: '📊 Polls', summary: 'Poll creation, voting and results.' },

  // Feedback Studio
  { key: 'forms', studio: 'feedbackStudio', route: 'admin:forms', label: '📝 Forms', title: '📝 Forms', summary: 'Forms, submissions, review and response storage.' },
  { key: 'suggestions', studio: 'feedbackStudio', route: 'admin:suggestions', label: '💡 Suggestions', title: '💡 Suggestions', summary: 'Suggestion intake, voting and review workflow.' },
  { key: 'tickets', studio: 'feedbackStudio', route: 'admin:tickets', label: '🎟️ Tickets', title: '🎟️ Tickets', summary: 'Support tickets and private help channels.' },

  // Message Studio
  { key: 'goodbye', studio: 'messageStudio', route: 'admin:goodbye', label: '👋 Goodbye', title: '👋 Goodbye', summary: 'Public farewell messages and Embed Studio templates.' },
  { key: 'embed', studio: 'messageStudio', route: 'admin:embed', label: '✨ Embed Studio', title: '✨ Embed Studio', summary: 'Build and manage Discord embeds.' },
  { key: 'starboard', studio: 'messageStudio', route: 'admin:starboard', label: '⭐ Starboard', title: '⭐ Starboard', summary: 'Highlight popular server messages.' },
  { key: 'sticky', studio: 'messageStudio', route: 'admin:sticky', label: '💬 Sticky Messages', title: '💬 Sticky Messages', summary: 'Keep important messages at the bottom of chat.' },
  { key: 'welcome', studio: 'messageStudio', route: 'admin:welcome', label: '👋 Welcome', title: '👋 Welcome', summary: 'Welcome messages, member DMs and Embed Studio templates.' },

  // Role Studio
  { key: 'autoRoles', studio: 'roleStudio', route: 'admin:autoRoles', label: '👥 Auto Roles', title: '👥 Auto Roles', summary: 'Assign roles automatically when members join.' },
  { key: 'reactionRoles', studio: 'roleStudio', route: 'admin:reactionRoles', label: '🎭 Reaction Roles', title: '🎭 Reaction Roles', summary: 'Reaction-role panels, emoji mappings and deployments.' },
  { key: 'temporaryRoles', studio: 'roleStudio', route: 'admin:temporaryRoles', label: '⏳ Temporary Roles', title: '⏳ Temporary Roles', summary: 'Assign roles that expire after a configured duration.' },
  { key: 'timedRoles', studio: 'roleStudio', route: 'admin:timedRoles', label: '🕒 Timed Roles', title: '🕒 Timed Roles', summary: 'Progress members through role milestones over time.' },

  // Security Studio
  { key: 'verification', studio: 'securityStudio', route: 'admin:verification', label: '✅ Verification', title: '✅ Verification', summary: 'Member verification and onboarding protection.' },

  // Social Studio
  { key: 'social', studio: 'socialStudio', route: 'admin:social', label: '📣 Social Alerts', title: '📣 Social Alerts', summary: 'Creator alerts for Twitch, YouTube, TikTok, Kick and more.' },

  // Utility Studio
  { key: 'emojis', studio: 'utilityStudio', route: 'admin:module:emojis:panel', label: '😀 Emoji Studio', title: '😀 Emoji Studio', summary: 'Discord-hosted application emojis from Emoji.gg with up to 100 selected per server.' },
  { key: 'privateRooms', studio: 'utilityStudio', route: 'admin:privateRooms', label: '🔒 Private Rooms', title: '🔒 Private Rooms', summary: 'Temporary private conversation rooms, requests, approvals and transcripts.' },
  { key: 'schedule', studio: 'utilityStudio', route: 'admin:schedule', label: '📅 Schedule', title: '📅 Schedule', summary: 'Scheduled messages, recurring tasks and timezone-aware automation.' },
  { key: 'stats', studio: 'utilityStudio', route: 'admin:stats', label: '📊 Server Stats', title: '📊 Server Stats', summary: 'Server activity, growth and member statistics.' },
  { key: 'tempVoice', studio: 'utilityStudio', route: 'admin:tempVoice', label: '🔊 Temp Voice', title: '🔊 Temp Voice', summary: 'Temporary voice channels and room automation.' },
  { key: 'translation', studio: 'utilityStudio', route: 'admin:translation', label: '🌐 Translation', title: '🌐 Translation', summary: 'Language preferences and translation controls.' },
];

const STUDIO_CATALOG = [
  { key: 'communityStudio', label: '🏘️ Community', title: '🏘️ Community Studio', summary: 'Community engagement, growth and participation modules.' },
  { key: 'feedbackStudio', label: '💬 Feedback', title: '💬 Feedback Studio', summary: 'Forms, suggestions and support workflows.' },
  { key: 'messageStudio', label: '✉️ Messages', title: '✉️ Message Studio', summary: 'Server messages, embeds, highlights and member greetings.' },
  { key: 'roleStudio', label: '🎭 Roles', title: '🎭 Role Studio', summary: 'Automatic, reaction, temporary and timed role management.' },
  { key: 'securityStudio', label: '🛡️ Security', title: '🛡️ Security Studio', summary: 'Verification and member protection controls.' },
  { key: 'socialStudio', label: '📣 Social', title: '📣 Social Studio', summary: 'Creator and social-platform alerting.' },
  { key: 'utilityStudio', label: '🧰 Utility', title: '🧰 Utility Studio', summary: 'Private rooms, scheduling, statistics, translation, temporary voice and Emoji Studio tools.' },
];

const MODULE_BY_KEY = Object.fromEntries(MODULE_CATALOG.map((module) => [module.key, module]));
const STUDIO_BY_KEY = Object.fromEntries(STUDIO_CATALOG.map((studio) => [studio.key, studio]));

function genericModule(config) {
  return { optionMenus: [], selectMenus: [], toggles: [], fields: [], ...config };
}

const MODULE_PANEL_REGISTRY = {
  forms: genericModule({ key: 'forms', title: '📝 Forms', summary: 'Forms, submissions, review and response storage.', defaults: { submitChannelId: null, logChannelId: null, managerRoleIds: [], requireReview: true, anonymousSubmissions: false, storeResponses: true }, fields: ['submitChannel', 'logChannel', 'managerRoles', ['requireReview', 'Require Review'], ['anonymousSubmissions', 'Anonymous Submissions'], ['storeResponses', 'Store Responses']], selectMenus: ['submitChannel', 'logChannel', 'managerRoles'], toggles: [['requireReview', '🔎 Require Review'], ['anonymousSubmissions', '👤 Anonymous'], ['storeResponses', '💾 Store Responses']] }),
  giveaways: genericModule({ key: 'giveaways', title: '🎉 Giveaways', summary: 'Giveaway creation, entries, winners and rerolls.', defaults: { announcementChannelId: null, logChannelId: null, managerRoleIds: [], allowMultipleEntries: false, requireRole: false, pingWinners: true }, fields: ['announcementChannel', 'logChannel', 'managerRoles', ['allowMultipleEntries', 'Multiple Entries'], ['requireRole', 'Require Role'], ['pingWinners', 'Ping Winners']], selectMenus: ['announcementChannel', 'logChannel', 'managerRoles'], toggles: [['allowMultipleEntries', '🎟️ Multiple Entries'], ['requireRole', '🔒 Require Role'], ['pingWinners', '📣 Ping Winners']] }),
  leveling: genericModule({ key: 'leveling', title: '🏆 Leveling', summary: 'XP, levels, leaderboards and level roles.', defaults: { announceChannelId: null, managerRoleIds: [], levelRoleIds: [], trackMessages: true, trackVoice: true, announceLevelUps: true }, fields: ['announceChannel', 'managerRoles', 'levelRoles', ['trackMessages', 'Message XP'], ['trackVoice', 'Voice XP'], ['announceLevelUps', 'Announce Level Ups']], selectMenus: ['announceChannel', 'managerRoles', 'levelRoles'], toggles: [['trackMessages', '💬 Message XP'], ['trackVoice', '🔊 Voice XP'], ['announceLevelUps', '📣 Level Ups']] }),
  polls: genericModule({ key: 'polls', title: '📊 Polls', summary: 'Poll creation, voting and results.', defaults: { defaultChannelId: null, resultsChannelId: null, managerRoleIds: [], anonymousVoting: false, allowMultipleChoice: true, showResultsLive: true }, fields: ['defaultChannel', 'resultsChannel', 'managerRoles', ['anonymousVoting', 'Anonymous Voting'], ['allowMultipleChoice', 'Multiple Choice'], ['showResultsLive', 'Live Results']], selectMenus: ['defaultChannel', 'resultsChannel', 'managerRoles'], toggles: [['anonymousVoting', '👤 Anonymous Voting'], ['allowMultipleChoice', '☑️ Multiple Choice'], ['showResultsLive', '📈 Live Results']] }),
  social: genericModule({ key: 'social', title: '📣 Social Alerts', summary: 'Creator alerts for Twitch, YouTube, TikTok, Kick and more.', defaults: { alertsChannelId: null, logChannelId: null, managerRoleIds: [], twitch: true, youtube: true, tiktok: true, kick: true }, fields: ['alertsChannel', 'logChannel', 'managerRoles', ['twitch', 'Twitch'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['kick', 'Kick']], selectMenus: ['alertsChannel', 'logChannel', 'managerRoles'], toggles: [['twitch', '🟣 Twitch'], ['youtube', '▶️ YouTube'], ['tiktok', '🎵 TikTok'], ['kick', '🟢 Kick']] }),
  starboard: genericModule({ key: 'starboard', title: '⭐ Starboard', summary: 'Highlight popular server messages.', defaults: { starboardChannelId: null, logChannelId: null, managerRoleIds: [], allowSelfStar: false, requireUniqueUsers: true }, fields: ['starboardChannel', 'logChannel', 'managerRoles', ['allowSelfStar', 'Self Star'], ['requireUniqueUsers', 'Unique Users']], selectMenus: ['starboardChannel', 'logChannel', 'managerRoles'], toggles: [['allowSelfStar', '⭐ Self Star'], ['requireUniqueUsers', '👥 Unique Users']] }),
  sticky: genericModule({ key: 'sticky', title: '💬 Sticky Messages', summary: 'Keep important messages at the bottom of chat.', defaults: { channels: [], managerRoleIds: [], mode: 'per-channel', cleanupPrevious: true, allowEmbeds: true }, fields: ['channels', 'managerRoles', ['mode', 'Mode'], ['cleanupPrevious', 'Cleanup Previous'], ['allowEmbeds', 'Allow Embeds']], selectMenus: ['channels', 'managerRoles'], optionMenus: [{ id: 'mode', placeholder: 'Sticky mode', options: [['per-channel', 'Per Channel', 'One sticky note per selected channel'], ['manual', 'Manual', 'Only management-triggered sticky notes']] }], toggles: [['cleanupPrevious', '🧹 Cleanup Previous'], ['allowEmbeds', '🎨 Allow Embeds']] }),
  suggestions: genericModule({ key: 'suggestions', title: '💡 Suggestions', summary: 'Suggestion intake, voting and review workflow.', defaults: { submitChannelId: null, reviewChannelId: null, approvedChannelId: null, deniedChannelId: null, reviewerRoleIds: [], anonymous: false, voting: true, requireReview: true }, fields: ['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'reviewerRoles', ['voting', 'Voting'], ['requireReview', 'Require Review'], ['anonymous', 'Anonymous']], selectMenus: ['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'reviewerRoles'], toggles: [['voting', '🗳️ Voting'], ['requireReview', '🔎 Require Review'], ['anonymous', '👤 Anonymous']] }),
  temporaryRoles: genericModule({ key: 'temporaryRoles', title: '⏳ Temporary Roles', summary: 'Assign roles that expire after a configured duration.', defaults: { managerRoleIds: [], logChannelId: null }, fields: ['logChannel', 'managerRoles'], selectMenus: ['logChannel', 'managerRoles'] }),
  translation: genericModule({ key: 'translation', title: '🌐 Translation', summary: 'Language preferences and translation controls.', defaults: { logChannelId: null, managerRoleIds: [], autoDetect: true, allowUserPreferences: true, ephemeralReplies: true }, fields: ['logChannel', 'managerRoles', ['autoDetect', 'Auto Detect'], ['allowUserPreferences', 'User Preferences'], ['ephemeralReplies', 'Ephemeral Replies']], selectMenus: ['logChannel', 'managerRoles'], toggles: [['autoDetect', '🔎 Auto Detect'], ['allowUserPreferences', '👤 User Preferences'], ['ephemeralReplies', '🙈 Ephemeral']] }),
};

const SERVER_MODULES = MODULE_CATALOG.map((module) => [module.route, module.label, module.title.replace(/^\S+\s*/, ''), module.summary]);

const CHANNEL_FIELDS = {
  alertsChannel: { prop: 'alertsChannelId', label: '📣 Alerts Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  announcementChannel: { prop: 'announcementChannelId', label: '🎉 Announcement Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  approvedChannel: { prop: 'approvedChannelId', label: '✅ Approved Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  channels: { prop: 'channels', label: '💬 Sticky Channels', max: 10, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  defaultChannel: { prop: 'defaultChannelId', label: '📊 Default Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  deniedChannel: { prop: 'deniedChannelId', label: '❌ Denied Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  logChannel: { prop: 'logChannelId', label: '📋 Log Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  announceChannel: { prop: 'announceChannelId', label: '📣 Announce Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  resultsChannel: { prop: 'resultsChannelId', label: '📈 Results Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  reviewChannel: { prop: 'reviewChannelId', label: '🔎 Review Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  starboardChannel: { prop: 'starboardChannelId', label: '⭐ Starboard Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
  submitChannel: { prop: 'submitChannelId', label: '📝 Submit Channel', max: 1, types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
};

const ROLE_FIELDS = {
  managerRoles: { prop: 'managerRoleIds', label: '🛡️ Manager Roles', max: 10 },
  levelRoles: { prop: 'levelRoleIds', label: '🏆 Level Roles', max: 10 },
  reviewerRoles: { prop: 'reviewerRoleIds', label: '🔎 Reviewer Roles', max: 10 },
};

function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(customId, label, style = ButtonStyle.Primary) { return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style); }
function chunkArray(items, size) { const chunks = []; for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size)); return chunks; }
function getMemberDisplayName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function fieldKey(field) { return Array.isArray(field) ? field[0] : field; }
function fieldsForScope(module, scope) { return (module.fields || []).filter((field) => (scope === 'configure') === ADMIN_FIELD_KEYS.has(fieldKey(field))); }
function selectMenusForScope(module, scope) { return (module.selectMenus || []).filter((key) => (scope === 'configure') === ADMIN_FIELD_KEYS.has(key)); }
function navigationRow(customId, label) { return row(button(customId, label, ButtonStyle.Secondary)); }

function getModuleConfig(guildId, moduleKey) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const current = modules?.[moduleKey];
  return {
    ...(module?.defaults || {}),
    ...(current && typeof current === 'object' ? current : {}),
    enabled: guildManager.isModuleEnabled(guildId, moduleKey),
  };
}

function saveModuleConfig(guild, moduleKey, updater) {
  const current = getModuleConfig(guild.id, moduleKey);
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) };
  const { enabled: _enabled, ...config } = next || {};
  const updated = saveModuleSection(guild.id, moduleKey, config, guild);
  return {
    ...updated,
    enabled: guildManager.isModuleEnabled(guild.id, moduleKey),
  };
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => `<@&${item}>`).join(', ') : '`None`';
  if (typeof value === 'boolean') return value ? 'Enabled ✅' : 'Disabled ❌';
  if (value === null || value === undefined || value === '') return '`Not set`';
  return `\`${String(value)}\``;
}

function buildFieldList(module, config, scope) {
  return fieldsForScope(module, scope).map((field) => {
    const key = fieldKey(field);
    const label = Array.isArray(field) ? field[1] : key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    const channel = CHANNEL_FIELDS[key];
    const role = ROLE_FIELDS[key];
    const value = channel ? config[channel.prop] : role ? config[role.prop] : config[key];
    if (channel && channel.max === 1 && value) return `**${label}:** <#${value}>`;
    if (channel && Array.isArray(value)) return `**${label}:** ${value.length ? value.map((id) => `<#${id}>`).join(', ') : '`None`'}`;
    return `**${label}:** ${formatValue(value)}`;
  }).join('\n') || '`No settings in this section.`';
}

function buildModuleListPanel(memberDisplayName = 'Unknown User') {
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🧩 Goliath Studios')
    .setDescription('\n🧩 Select a category to manage its modules.')
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();
  const studioRows = chunkArray(STUDIO_CATALOG.map((studio) => button(`admin:studio:${studio.key}`, studio.label)), ITEMS_PER_ROW).map((items) => row(...items));
  return { embeds: [embed], components: [...studioRows, navigationRow('admin:home', '⬅️ Back to Admin Home')].slice(0, 5) };
}

function buildStudioPanel(studioKey, memberDisplayName = 'Unknown User') {
  const studio = STUDIO_BY_KEY[studioKey];
  if (!studio) return null;
  const modules = MODULE_CATALOG.filter((module) => module.studio === studioKey);
  const embed = new EmbedBuilder().setColor(PANEL_COLOR).setTitle(studio.title).setDescription([studio.summary, '', 'Select a module.'].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  const moduleRows = chunkArray(modules.map((module) => button(CUSTOM_PANEL_KEYS.has(module.key) ? module.route : `admin:module:${module.key}:main:0`, module.label)), ITEMS_PER_ROW).map((items) => row(...items));
  return { embeds: [embed], components: [...moduleRows, navigationRow('admin:modules', '⬅️ Back to Modules')].slice(0, 5) };
}

function buildControlRows(moduleKey, scope) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  const rows = [];
  for (const fieldKeyName of selectMenusForScope(module, scope)) {
    if (CHANNEL_FIELDS[fieldKeyName]) {
      const field = CHANNEL_FIELDS[fieldKeyName];
      rows.push(row(new ChannelSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:channel:${fieldKeyName}:${scope}`).setPlaceholder(field.label).setChannelTypes(...field.types).setMinValues(0).setMaxValues(field.max)));
    } else if (ROLE_FIELDS[fieldKeyName]) {
      const field = ROLE_FIELDS[fieldKeyName];
      rows.push(row(new RoleSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:role:${fieldKeyName}:${scope}`).setPlaceholder(field.label).setMinValues(0).setMaxValues(field.max)));
    }
  }
  if (scope === 'main') {
    for (const menu of module.optionMenus || []) rows.push(row(new StringSelectMenuBuilder().setCustomId(`admin:module:${moduleKey}:option:${menu.id}`).setPlaceholder(menu.placeholder).setMinValues(1).setMaxValues(1).addOptions(menu.options.map(([value, label, description]) => ({ value, label, description })) )));
    for (const items of chunkArray((module.toggles || []).map(([prop, label]) => button(`admin:module:${moduleKey}:toggle:${prop}`, label, ButtonStyle.Secondary)), 3)) rows.push(row(...items));
  }
  return rows;
}

function buildPager(previousId, nextId, page, totalPages) {
  const items = [];
  if (page > 0) items.push(button(previousId, '◀ Previous', ButtonStyle.Secondary));
  if (page < totalPages - 1) items.push(button(nextId, 'Next ▶', ButtonStyle.Secondary));
  return items.length ? row(...items) : null;
}

function buildModuleMainPanel(guild, moduleKey, memberDisplayName = 'Unknown User', controlPage = 0) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  const catalogModule = MODULE_BY_KEY[moduleKey];
  if (!module || !catalogModule) return null;
  const config = getModuleConfig(guild.id, moduleKey);
  const enabled = config.enabled !== false;
  const allControls = buildControlRows(moduleKey, 'main');
  const totalPages = Math.max(1, Math.ceil(allControls.length / CONTROLS_PER_PAGE));
  const page = Math.min(Math.max(Number(controlPage) || 0, 0), totalPages - 1);
  const controls = allControls.slice(page * CONTROLS_PER_PAGE, (page + 1) * CONTROLS_PER_PAGE);
  const embed = new EmbedBuilder().setColor(enabled ? 0x57f287 : PANEL_COLOR).setTitle(module.title).setDescription([module.summary, '', `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`, `**Controls Page:** ${page + 1}/${totalPages}`].join('\n')).addFields({ name: 'Module Controls', value: buildFieldList(module, config, 'main'), inline: false }).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  const pager = buildPager(`admin:module:${moduleKey}:main:${page - 1}`, `admin:module:${moduleKey}:main:${page + 1}`, page, totalPages);
  const components = [
    ...controls,
    row(button(`admin:module:${moduleKey}:configure:0`, '⚙️ Configure')),
    ...(pager ? [pager] : []),
    navigationRow(`admin:studio:${catalogModule.studio}`, '⬅️ Back'),
  ];
  return { embeds: [embed], components: components.slice(0, 5) };
}

function buildModuleConfigurePanel(guild, moduleKey, memberDisplayName = 'Unknown User', controlPage = 0) {
  const module = MODULE_PANEL_REGISTRY[moduleKey];
  if (!module) return null;
  const config = getModuleConfig(guild.id, moduleKey);
  const enabled = config.enabled !== false;
  const allControls = buildControlRows(moduleKey, 'configure');
  const totalPages = Math.max(1, Math.ceil(allControls.length / CONTROLS_PER_PAGE));
  const page = Math.min(Math.max(Number(controlPage) || 0, 0), totalPages - 1);
  const controls = allControls.slice(page * CONTROLS_PER_PAGE, (page + 1) * CONTROLS_PER_PAGE);
  const embed = new EmbedBuilder().setColor(enabled ? 0x57f287 : PANEL_COLOR).setTitle(`${module.title} · Configure`).setDescription([module.summary, '', `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`, `**Module Key:** \`${moduleKey}\``, `**Configure Page:** ${page + 1}/${totalPages}`, '', 'Administrative settings and maintenance controls.'].join('\n')).addFields({ name: 'Administration', value: buildFieldList(module, config, 'configure'), inline: false }).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  const actions = row(
    button(`admin:module:${moduleKey}:${enabled ? 'disable' : 'enable'}`, enabled ? '⏸️ Disable' : '▶️ Enable', enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    button(`admin:module:${moduleKey}:health`, '🩺 Health', ButtonStyle.Secondary),
    button(`admin:module:${moduleKey}:repair`, '🛠️ Repair', ButtonStyle.Secondary),
    button(`admin:module:${moduleKey}:reset`, '♻️ Reset', ButtonStyle.Danger),
  );
  const pager = buildPager(`admin:module:${moduleKey}:configure:${page - 1}`, `admin:module:${moduleKey}:configure:${page + 1}`, page, totalPages);
  const components = [actions, ...controls, ...(pager ? [pager] : []), navigationRow(`admin:module:${moduleKey}:main:0`, '⬅️ Back')];
  return { embeds: [embed], components: components.slice(0, 5) };
}

function buildModuleLandingPanel(guild, moduleKey, memberDisplayName = 'Unknown User') { return buildModuleMainPanel(guild, moduleKey, memberDisplayName, 0); }
async function safeUpdate(interaction, payload) { if (!payload) return false; if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
function updateChannelSelection(guild, moduleKey, fieldKeyName, values = []) { const field = CHANNEL_FIELDS[fieldKeyName]; if (!field) return; const clean = [...new Set(values.filter(Boolean))]; saveModuleConfig(guild, moduleKey, (config) => ({ ...config, [field.prop]: field.max === 1 ? clean[0] || null : clean })); }
function updateRoleSelection(guild, moduleKey, fieldKeyName, values = []) { const field = ROLE_FIELDS[fieldKeyName]; if (!field) return; saveModuleConfig(guild, moduleKey, (config) => ({ ...config, [field.prop]: [...new Set(values.filter(Boolean))] })); }

async function handleModuleAdminInteraction(interaction) {
  const id = String(interaction.customId || '');
  const name = getMemberDisplayName(interaction);
  if (id === 'admin:modules') return safeUpdate(interaction, buildModuleListPanel(name));
  const studio = id.match(/^admin:studio:([a-zA-Z0-9_-]+)$/);
  if (studio && interaction.isButton?.()) return safeUpdate(interaction, buildStudioPanel(studio[1], name));
  if (id.startsWith('admin:module:emojis:')) {
    const emojiPanel = require('../../../modules/utilityStudio/emojis/emojisPanel');
    return emojiPanel.handleDiscordInteraction?.(interaction) || false;
  }
  const main = id.match(/^admin:module:([a-zA-Z0-9_-]+):main:(\d+)$/);
  if (main && interaction.isButton?.()) return safeUpdate(interaction, buildModuleMainPanel(interaction.guild, main[1], name, Number(main[2])));
  const legacy = id.match(/^admin:module:([a-zA-Z0-9_-]+):landing$/);
  if (legacy && interaction.isButton?.()) return safeUpdate(interaction, buildModuleMainPanel(interaction.guild, legacy[1], name, 0));
  const configure = id.match(/^admin:module:([a-zA-Z0-9_-]+):configure(?::(\d+))?$/);
  if (configure && interaction.isButton?.()) return safeUpdate(interaction, buildModuleConfigurePanel(interaction.guild, configure[1], name, Number(configure[2] || 0)));
  const action = id.match(/^admin:module:([a-zA-Z0-9_-]+):(enable|disable|reset|health|repair)$/);
  if (action && interaction.isButton?.()) {
    const [, key, type] = action;
    const module = MODULE_PANEL_REGISTRY[key];
    if (!module) return false;
    if (type === 'enable' || type === 'disable') {
      guildManager.setModuleEnabled(interaction.guild.id, key, type === 'enable', {
        actorId: interaction.user?.id || null,
        action: 'module_admin_toggle',
      });
    }
    if (type === 'reset') saveModuleConfig(interaction.guild, key, module.defaults);
    return safeUpdate(interaction, buildModuleConfigurePanel(interaction.guild, key, name, 0));
  }
  const toggle = id.match(/^admin:module:([a-zA-Z0-9_-]+):toggle:([a-zA-Z0-9_-]+)$/);
  if (toggle && interaction.isButton?.()) { saveModuleConfig(interaction.guild, toggle[1], (config) => ({ ...config, [toggle[2]]: !Boolean(config[toggle[2]]) })); return safeUpdate(interaction, buildModuleMainPanel(interaction.guild, toggle[1], name, 0)); }
  const channel = id.match(/^admin:module:([a-zA-Z0-9_-]+):channel:([a-zA-Z0-9_-]+):(main|configure)$/);
  if (channel && interaction.isChannelSelectMenu?.()) { updateChannelSelection(interaction.guild, channel[1], channel[2], interaction.values || []); return safeUpdate(interaction, channel[3] === 'configure' ? buildModuleConfigurePanel(interaction.guild, channel[1], name, 0) : buildModuleMainPanel(interaction.guild, channel[1], name, 0)); }
  const role = id.match(/^admin:module:([a-zA-Z0-9_-]+):role:([a-zA-Z0-9_-]+):(main|configure)$/);
  if (role && interaction.isRoleSelectMenu?.()) { updateRoleSelection(interaction.guild, role[1], role[2], interaction.values || []); return safeUpdate(interaction, role[3] === 'configure' ? buildModuleConfigurePanel(interaction.guild, role[1], name, 0) : buildModuleMainPanel(interaction.guild, role[1], name, 0)); }
  const option = id.match(/^admin:module:([a-zA-Z0-9_-]+):option:([a-zA-Z0-9_-]+)$/);
  if (option && interaction.isStringSelectMenu?.()) { saveModuleConfig(interaction.guild, option[1], (config) => ({ ...config, [option[2]]: interaction.values?.[0] })); return safeUpdate(interaction, buildModuleMainPanel(interaction.guild, option[1], name, 0)); }
  return false;
}

module.exports = {
  STUDIO_CATALOG,
  MODULE_CATALOG,
  MODULE_PANEL_REGISTRY,
  SERVER_MODULES,
  buildModuleListPanel,
  buildStudioPanel,
  buildModuleMainPanel,
  buildModuleLandingPanel,
  buildModuleConfigurePanel,
  buildModulePanel: buildModuleMainPanel,
  handleModuleAdminInteraction,
};
