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
      try {
        templateDeleted = embedTemplates.deleteTemplate(guildId, templateId);
      } catch (error) {
        // A legacy Discord caller expects a boolean result. Preserve that
        // contract for protected templates instead of turning a safe refusal
        // into an unhandled interaction error. The canonical dashboard path
        // still receives TEMPLATE_IN_USE directly from deleteTemplate().
        if (
          error?.code === 'TEMPLATE_IN_USE' ||
          error?.message === 'Default templates cannot be deleted.'
        ) {
          return false;
        }
        throw error;
      }
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
