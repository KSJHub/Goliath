'use strict';

/**
 * GOLIATH EMOJI SOURCE OF TRUTH
 * Change an emoji here, not in individual panels. Consumers must reference
 * EMOJIS.KEY; changes take effect when Discord components are rendered again.
 * This is separate from the user-managed application emoji bank.
 */
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
});

function emojiLabel(key, label, { position = 'before' } = {}) {
  const emoji = EMOJIS[key];
  if (!emoji) throw new Error(`Unknown Goliath emoji key: ${key}`);
  return position === 'after' ? `${label} ${emoji}` : `${emoji} ${label}`;
}

module.exports = { EMOJIS, emojiLabel };
