'use strict';

/**
 * Runtime compatibility guard for Embed Studio preset deletion.
 *
 * Legacy preset callers use guildManager.deleteEmbedPreset() directly, while
 * canonical Embed Studio templates enforce binding protection in
 * embedTemplates.deleteTemplate(). Route every legacy deletion through the
 * canonical template deletion first so Discord, dashboard and future callers
 * cannot delete a preset/template that is still bound to a module slot.
 */

const PATCH_FLAG = Symbol.for('goliath.embedPresetDeletionGuard');
const guildManager = require('../core/guild/guildManager');
const embedTemplates = require('../modules/messageStudio/embed/embedTemplates');

if (!guildManager[PATCH_FLAG]) {
  const deleteLegacyPreset = guildManager.deleteEmbedPreset.bind(guildManager);

  guildManager.deleteEmbedPreset = function deleteEmbedPresetGuarded(
    guildId,
    presetName,
    guildOrMeta = {}
  ) {
    const templateId = embedTemplates.cleanKey(presetName);
    let templateDeleted = false;

    if (templateId) {
      // This is intentionally allowed to throw TEMPLATE_IN_USE (and the
      // default-template protection error). The legacy preset must remain
      // untouched when the canonical template cannot be safely deleted.
      templateDeleted = embedTemplates.deleteTemplate(guildId, templateId);
    }

    const presetDeleted = deleteLegacyPreset(guildId, presetName, guildOrMeta);
    return Boolean(templateDeleted || presetDeleted);
  };

  Object.defineProperty(guildManager, PATCH_FLAG, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

module.exports = guildManager;
