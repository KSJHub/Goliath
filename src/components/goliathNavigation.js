const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/**
 * GOLIATH UNIVERSAL NAVIGATION
 *
 * Every standard Goliath module page ends with:
 *
 *   ⬅️ Back | ⚙️ Settings
 *
 * Destinations remain module-specific.
 */
function navigationButton(customId, label) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary);
}

function goliathNavigation(backId, settingsId) {
  if (!backId) {
    throw new Error(
      'goliathNavigation requires a Back destination.',
    );
  }

  if (!settingsId) {
    throw new Error(
      'goliathNavigation requires a Settings destination.',
    );
  }

  return new ActionRowBuilder().addComponents(
    navigationButton(backId, '⬅️ Back'),
    navigationButton(settingsId, '⚙️ Settings'),
  );
}

module.exports = {
  goliathNavigation,
};
