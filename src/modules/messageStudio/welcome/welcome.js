'use strict';

// Stable Welcome entry point. Keep callers on this path while the canonical
// implementation remains in welcomeCore during the migration.
const core = require('./welcomeCore');
const embedTemplateManager = require('../embed/embedTemplates');

function resetWelcome(guildId, meta = {}) {
  // Reset must clear canonical bindings as well as stored configuration.
  // Otherwise getAssignedTemplate() can continue resolving an old Public,
  // DM or Scheduled template after the module appears to have been reset.
  for (const slot of ['welcome', 'dm_welcome', 'scheduled_welcome']) {
    embedTemplateManager.unbindTemplate(guildId, 'welcome', slot);
  }
  return core.resetWelcome(guildId, meta);
}

module.exports = {
  ...core,
  resetWelcome,
};
