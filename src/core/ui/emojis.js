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
});

function emojiLabel(key, label, { position = 'before' } = {}) {
  const emoji = EMOJIS[key];
  if (!emoji) throw new Error(`Unknown Goliath emoji key: ${key}`);
  return position === 'after' ? `${label} ${emoji}` : `${emoji} ${label}`;
}

module.exports = { EMOJIS, emojiLabel };
