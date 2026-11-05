const { EMOJIS, emojiLabel } = require('../core/ui/emojis');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/**
 * GOLIATH UNIVERSAL NAVIGATION & ACTION LABELS
 * Discord owns native rendering; these definitions standardise emoji,
 * labels and styles without changing existing interaction custom IDs.
 * Keep destination IDs supplied by each module.
 */
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

module.exports = {
  UI_ACTIONS,
  navigationButton,
  actionButton,
  paginationButtons,
  goliathNavigation,
};
