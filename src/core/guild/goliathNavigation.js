'use strict';

/**
 * GOLIATH PANEL & NAVIGATION SOURCE OF TRUTH
 * Shared Goliath-owned emojis, button styles, navigation rows and labels.
 * Guild variables, user-managed emoji banks, interaction routing and permissions
 * remain owned by their respective systems.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

// 1. Shared emojis and text labels
const EMOJIS = Object.freeze({
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  DASHBOARD: '📊',
  BACK: '⬅️',
  SETTINGS: '⚙️',
  BUILDER: '🛠️',
  PANELS: '🧩',
  PRESETS: '💾',
  MEDIA: '🖼️',
  TEST_SEND: '🧪',
  DEPLOY: '🚀',
  UPDATE: '♻️',
  REVIEW: '📋',
  CHANNEL_PREVIOUS: '◀',
  CHANNEL_NEXT: '▶',
  ROLE_PREVIOUS: '◀',
  ROLE_NEXT: '▶',
  // Moderation and shared legacy UI (kept as separate keys where meanings differ).
  MODERATION_DASHBOARD: '⚙️',
  ACTIONS: '⚖️',
  CASES: '📜',
  TOOLS: '🧰',
  ANALYTICS: '📊',
  USER: '👤',
  MODERATOR: '🔐',
  TIMEOUT: '⏳',
  KICK: '👢',
  BAN: '🔨',
  ACTIVE: '🟢',
  EXPIRED: '⌛',
  REVERSED: '🔁',
  CASE: '🧾',
  NOTE: '📝',
  EDIT: '✏️',
  DELETE: '🗑️',
  SEARCH: '🔍',
  NEXT: '➡️',
  REFRESH: '🔄',
  BULK: '📦',
  FIRE: '🔥',
  INVESTIGATE: '🔎',
  RESTRICTIONS: '🔒',
  ISOLATION: '🚨',
  AUTOMOD: '🤖',
  VERIFICATION: '🛂',
  SECURITY: '🛡️',
  RISK: '🎯',
  WELCOME: '👋',
  WELCOME_INSTANT: '⚡',
  WELCOME_DM: '💌',
  WELCOME_SCHEDULED: '📅',
  WORKSPACE: '🗂️',
  DELIVERY: '🧩',
  STATUS: '🚦',
  NEXT_STEP: '➡️',
  INACTIVE: '⚪',
  SETUP_REQUIRED: '🟠',
  HEALTHY: '✅',
  WELCOME_MENTIONS: '🔔',
  WELCOME_CHANNEL: '📢',
  WELCOME_PRESET: '📦',
  WELCOME_CUSTOM: '🛠️',
  WELCOME_EMBED: '💎',
  WELCOME_INHERIT: '↩️',
  WELCOME_PREVIEW: '👁️',
  WELCOME_DIAGNOSTICS: '🩺',
  WELCOME_EXPORT: '📤',
  WELCOME_DISABLED: '🔴',
  WELCOME_MUTED: '🔕',
  WELCOME_LOCATION: '📍',
  WELCOME_ROLE_PINGS: '📣',
  WELCOME_CLEANUP: '🧹',
  WELCOME_QUEUE: '👥',
  WELCOME_RUN: '▶',
  // Security and protection panel symbols (shared across administration surfaces).
  ENABLED: '🟢',
  DISABLED: '🔴',
  ANTI_NUKE: '💥',
  LOCKDOWN: '🔒',
  QUARANTINE: '🚧',
  SECURITY_CORE: '🧠',
  PERMISSION_GUARD: '🔐',
  INCIDENT_AUDIT: '📋',
  THREAT: '⚡',
  SEVERITY_HIGH: '🟠',
  SEVERITY_MEDIUM: '🟡',
  SEVERITY_LOW: '🔵',
  RULE_INACTIVE: '⚫',
  // AutoMod rule and editor symbols.
  AUTOMOD_SPAM: '🚫',
  AUTOMOD_LINKS: '🔗',
  AUTOMOD_BAD_WORDS: '🤬',
  AUTOMOD_CAPS: '🔠',
  AUTOMOD_MENTIONS: '📣',
  AUTOMOD_INVITES: '✉️',
  AUTOMOD_DUPLICATES: '♻️',
  AUTOMOD_FLOOD: '🌊',
  AUTOMOD_EMOJI: '😀',
  AUTOMOD_ATTACHMENTS: '📎',
  AUTOMOD_SUSPICIOUS: '🚨',
  AUTOMOD_LIMITS: '⏱️',
  AUTOMOD_DOMAINS: '🌐',
  AUTOMOD_THRESHOLDS: '📏',
  ADMIN_CROWN: '👑',
  ADMIN_PIN: '📌',
  ADMIN_STAFF: '👥',
  ADMIN_JUNIOR: '🔰',
  ADMIN_BACKUP: '🧱',
  ADMIN_PURGE: '🧹',
  ADMIN_ROLE_CONTROL: '🎛️',
  ADMIN_JOIN_ROLES: '🎭',
  ADMIN_RESTORE_TEMPLATE: '↩️',
  USER_COMMUNITY: '🏘️',
  USER_FEEDBACK: '💬',
  USER_MESSAGES: '✉️',
  USER_ROLES: '🎭',
  USER_SOCIAL: '📣',
  USER_CASES: '📁',
  USER_BIRTHDAYS: '🎂',
  USER_GIVEAWAYS: '🎉',
  USER_INVITES: '📨',
  USER_LEVELING: '🏆',
  USER_SUGGESTIONS: '💡',
  USER_TICKETS: '🎫',
  USER_STARBOARD: '⭐',
  USER_PING: '🏓',
  USER_SERVER_INFO: '🏰',
  USER_TRANSLATE: '🌐',
  USER_STATS: '📈',
  USER_TEMP_VOICE: '🔊',
  USER_HOME: '🏠',
  USER_LOCKED: '⬜',
  USER_FINISH: '🏁',
  USER_PAUSE: '⏸️',
  USER_PLAY: '▶️',
  USER_HELP_NAVIGATION: '🧭',
  USER_HELP_CATEGORIES: '📂',
  USER_HELP: '❓',
  MOD_EXPORT: '📤',
  MOD_CASE_FOLDER: '📁',
  MOD_QUARANTINE_ACTION: '☢️',
  MOD_KICK_ACTION: '🥾',
  MOD_INTELLIGENCE: '🧠',
  MOD_SCAN_HISTORY: '🕘',
  MOD_APPEAL_PENDING: '📥',
  MOD_APPEAL_EMPTY: '📭',
  MOD_STAFF: '👥',
  MOD_RECENT_ACTIVITY: '📈',
  MOD_TOP_STAFF: '🏆',
  MOD_CASE_OPEN: '📂',
  COMMUNITY_CALENDAR: '🗓️',
  COUNTING_NUMBERS: '🔢',
  COMMUNITY_GAME: '🎮',
  COMMUNITY_LAUGH: '😂',
  COMMUNITY_GAME_OVER: '💀',
  GIVEAWAY_TICKET: '🎟️',
  INVITE_GLOBE: '🌍',
  INVITE_SPARKLES: '✨',
  INVITE_UNLIMITED: '♾️',
  UTILITY_WRENCH: '🔧',
  INFO: 'ℹ️',
  MESSAGE_INBOX: '📩',
  ADD: '➕',
  REMOVE: '➖',
  REPAIR: '🩹',
  ACHIEVEMENT: '🏅',
  CLOSE_X: '✖️',
  STOP: '⏹️',
  CHECKBOX: '☑️',
  ROLE_MAP: '🗺️',
  ROLE_TAG: '🏷️',
  ROLE_RAINBOW: '🌈',
  ROLE_UP: '⬆️',
  ROLE_DOWN: '⬇️',
  ROLE_MAGNET: '🧲',
  ROLE_UP_RIGHT: '↗️',
  ROLE_GOLD_MEDAL: '🥇',
  ROLE_TROPHY: '🏆',
  ROLE_MEMBERS: '👥',
  ROLE_CLOCK: '🕒',
  UTILITY_ANIMATED_EMOJI: '😀🎞️',
  UTILITY_ANIMATION: '🎞️',
  UTILITY_GROUP: '👯',
  UTILITY_DIAMOND: '💠',
  UTILITY_THREAD: '🧵',
  UTILITY_ALARM: '⏰',
  UTILITY_MIC: '🎙️',
  UNLOCK: '🔓',
  BLOCKED: '⛔',
  SECURITY_DOOR: '🚪',
  SECURITY_RADIO: '🔘',
  OWNER_BUILD: '🏗️',
  PERMISSION_HORIZONTAL: '↔️',
  FAQ_BOOKS: '📚',
  FAQ_PURPLE: '🟣',
  WRITE: '✍️',
  SUGGESTION_INBOX: '📬',
  VOTE: '🗳️',
  DESIGN: '🎨',
  PAUSE_PLAIN: '⏸',
  UPDATE_PLAIN: '♻',
  BACK_PLAIN: '⬅',
  DELETE_PLAIN: '🗑',
  HAPPY: '😊',
  SOCIAL_VIDEO: '🎥',
  SOCIAL_CLIP: '🎬',
  SOCIAL_TV: '📺',
  SOCIAL_MOBILE: '📱',
  SOCIAL_BROADCAST: '📡',
  SOCIAL_FORWARD: '↪️',
  DOCUMENT: '📄',
  VARIABLES: '📖',
  MOD_IDENTITY: '🪪',
  ADMIN_SLOWMODE: '🐢',
  ADMIN_COMMAND: '🔏',
  MOD_ACCOUNT_COMPARE: '🧬',
  EMBED_MEDIA_LARGE: '🔶',
  EMBED_MEDIA_MEDIUM: '🔷',
  EMBED_MEDIA_SMALL: '🔹',
  EMBED_DUPLICATE: '📑',
  EMBED_SPOILER: '🙈',
  EMBED_VALIDATION: '🔎',
});

function emojiLabel(key, label, { position = 'before' } = {}) {
  const emoji = EMOJIS[key];
  if (!emoji) throw new Error(`Unknown Goliath emoji key: ${key}`);
  return position === 'after' ? `${label} ${emoji}` : `${emoji} ${label}`;
}


// 2. Shared action definitions and button/navigation builders
const UI_ACTIONS = Object.freeze({
  back: Object.freeze({ label: 'Back', emoji: EMOJIS.BACK, style: ButtonStyle.Secondary }),
  settings: Object.freeze({ label: 'Settings', emoji: EMOJIS.SETTINGS, style: ButtonStyle.Secondary }),
  builder: Object.freeze({ label: 'Builder', emoji: EMOJIS.BUILDER, style: ButtonStyle.Primary }),
  panels: Object.freeze({ label: 'Panels', emoji: EMOJIS.PANELS, style: ButtonStyle.Primary }),
  presets: Object.freeze({ label: 'Presets', emoji: EMOJIS.PRESETS, style: ButtonStyle.Primary }),
  media: Object.freeze({ label: 'Media', emoji: EMOJIS.MEDIA, style: ButtonStyle.Primary }),
  testSend: Object.freeze({ label: 'Test Send', emoji: EMOJIS.TEST_SEND, style: ButtonStyle.Secondary }),
  deploy: Object.freeze({ label: 'Deploy', emoji: EMOJIS.DEPLOY, style: ButtonStyle.Success }),
  update: Object.freeze({ label: 'Update', emoji: EMOJIS.UPDATE, style: ButtonStyle.Success }),
  review: Object.freeze({ label: 'Review', emoji: EMOJIS.REVIEW, style: ButtonStyle.Secondary }),
});

// Render standard Unicode emojis as label text rather than Discord's native
// button emoji field. Discord clients can render native symbols (notably ⚙️)
// as monochrome icons. Custom guild emojis still require the native field.
function applyButtonEmoji(component, label, emoji) {
  const text = String(label);
  if (!emoji) return component.setLabel(text);
  if (typeof emoji !== 'string' || /^<a?:[^:]+:\\d+>$/.test(emoji) || /^\\d{17,20}$/.test(emoji)) {
    return component.setLabel(text).setEmoji(emoji);
  }
  const visible = `${emoji} ${text}`;
  // Discord limits button labels to 80 characters; retain the native emoji
  // field rather than truncating module-owned or dynamic labels.
  return Array.from(visible).length <= 80
    ? component.setLabel(visible)
    : component.setLabel(text).setEmoji(emoji);
}

function navigationButton(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  const component = new ButtonBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setDisabled(Boolean(disabled));
  if (typeof label === 'string') {
    const match = Object.values(EMOJIS)
      .filter((emoji) => label.startsWith(`${emoji} `))
      .sort((a, b) => b.length - a.length)[0];
    if (match) return applyButtonEmoji(component, label.slice(match.length + 1), match);
  }
  return component.setLabel(label);
}

function emojiButton(customId, label, emoji, style = ButtonStyle.Secondary, disabled = false) {
  const component = new ButtonBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setDisabled(Boolean(disabled));
  return applyButtonEmoji(component, label, emoji);
}

// URL buttons have no custom ID and always use Discord's Link style.
function linkButton(label, url, options = {}) {
  const component = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setDisabled(Boolean(options.disabled));
  return options.emoji ? applyButtonEmoji(component, label, options.emoji) : component.setLabel(label);
}

function actionButton(customId, action, options = {}) {
  const definition = UI_ACTIONS[action];
  if (!definition) throw new Error(`Unknown Goliath UI action: ${action}`);
  const suffix = options.suffix == null ? '' : String(options.suffix);
  const label = options.label == null ? definition.label + suffix : String(options.label);
  const component = new ButtonBuilder()
    .setCustomId(customId)
    .setStyle(definition.style)
    .setDisabled(Boolean(options.disabled));
  return applyButtonEmoji(component, label, definition.emoji);
}

function paginationButtons(kind, previousId, nextId, options = {}) {
  const noun = kind === 'channel' ? 'Channel' : kind === 'role' ? 'Role' : null;
  if (!noun) throw new Error('Pagination kind must be channel or role');
  const previousEmoji = EMOJIS[kind === 'channel' ? 'CHANNEL_PREVIOUS' : 'ROLE_PREVIOUS'];
  const nextEmoji = EMOJIS[kind === 'channel' ? 'CHANNEL_NEXT' : 'ROLE_NEXT'];
  return [
    applyButtonEmoji(new ButtonBuilder().setCustomId(previousId)
      .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(options.previousDisabled)), noun, previousEmoji),
    applyButtonEmoji(new ButtonBuilder().setCustomId(nextId)
      .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(options.nextDisabled)), noun, nextEmoji),
  ];
}

function goliathNavigation(backId, settingsId) {
  if (!backId) throw new Error('goliathNavigation requires a Back destination.');
  if (!settingsId) throw new Error('goliathNavigation requires a Settings destination.');
  return new ActionRowBuilder().addComponents(
    actionButton(backId, 'back'),
    actionButton(settingsId, 'settings'),
  );
}


// 3. Generic select-menu and layout builders (IDs/options remain module-owned)
function selectMenu(customId, options, { placeholder = 'Select an option', minValues = 1, maxValues = 1, disabled = false } = {}) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(maxValues)
    .setDisabled(Boolean(disabled))
    .addOptions(options);
}

function componentRow(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

module.exports = {
  EMOJIS, emojiLabel, UI_ACTIONS, navigationButton, emojiButton, linkButton, actionButton,
  paginationButtons, goliathNavigation, selectMenu, componentRow,
};
