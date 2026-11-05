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
});

function emojiLabel(key, label, { position = 'before' } = {}) {
  const emoji = EMOJIS[key];
  if (!emoji) throw new Error(`Unknown Goliath emoji key: ${key}`);
  return position === 'after' ? `${label} ${emoji}` : `${emoji} ${label}`;
}


// 2. Shared action definitions and button/navigation builders
const UI_ACTIONS = Object.freeze({
  back: Object.freeze({ label: emojiLabel('BACK', 'Back'), style: ButtonStyle.Secondary }),
  settings: Object.freeze({ label: emojiLabel('SETTINGS', 'Settings'), style: ButtonStyle.Secondary }),
  builder: Object.freeze({ label: emojiLabel('BUILDER', 'Builder'), style: ButtonStyle.Primary }),
  panels: Object.freeze({ label: emojiLabel('PANELS', 'Panels'), style: ButtonStyle.Primary }),
  presets: Object.freeze({ label: emojiLabel('PRESETS', 'Presets'), style: ButtonStyle.Primary }),
  media: Object.freeze({ label: emojiLabel('MEDIA', 'Media'), style: ButtonStyle.Primary }),
  testSend: Object.freeze({ label: emojiLabel('TEST_SEND', 'Test Send'), style: ButtonStyle.Secondary }),
  deploy: Object.freeze({ label: emojiLabel('DEPLOY', 'Deploy'), style: ButtonStyle.Success }),
  update: Object.freeze({ label: emojiLabel('UPDATE', 'Update'), style: ButtonStyle.Success }),
  review: Object.freeze({ label: emojiLabel('REVIEW', 'Review'), style: ButtonStyle.Secondary }),
});

function navigationButton(customId, label, style = ButtonStyle.Secondary, disabled = false) {
  const component = new ButtonBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setDisabled(Boolean(disabled));
  const backPrefix = `${EMOJIS.BACK} `;
  if (typeof label === 'string' && label.startsWith(backPrefix)) {
    return component.setEmoji(EMOJIS.BACK).setLabel(label.slice(backPrefix.length));
  }
  return component.setLabel(label);
}

function actionButton(customId, action, options = {}) {
  const definition = UI_ACTIONS[action];
  if (!definition) throw new Error(`Unknown Goliath UI action: ${action}`);
  const suffix = options.suffix == null ? '' : String(options.suffix);
  return navigationButton(customId, `${definition.label}${suffix}`, definition.style, options.disabled);
}

function paginationButtons(kind, previousId, nextId, options = {}) {
  const noun = kind === 'channel' ? 'Chan' : kind === 'role' ? 'Roles' : null;
  if (!noun) throw new Error('Pagination kind must be channel or role');
  return [
    navigationButton(previousId, emojiLabel(kind === 'channel' ? 'CHANNEL_PREVIOUS' : 'ROLE_PREVIOUS', noun), ButtonStyle.Secondary, options.previousDisabled),
    navigationButton(nextId, emojiLabel(kind === 'channel' ? 'CHANNEL_NEXT' : 'ROLE_NEXT', noun, { position: 'after' }), ButtonStyle.Secondary, options.nextDisabled),
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
  EMOJIS, emojiLabel, UI_ACTIONS, navigationButton, actionButton,
  paginationButtons, goliathNavigation, selectMenu, componentRow,
};
