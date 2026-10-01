'use strict';

const assert = require('node:assert/strict');

const guildManagerPath = require.resolve('../src/core/guild/guildManager');
const embedTemplatesPath = require.resolve('../src/modules/messageStudio/embed/embedTemplates');
const originalGuildManagerCache = require.cache[guildManagerPath];
const originalEmbedTemplatesCache = require.cache[embedTemplatesPath];

const sections = new Map();
const keyFor = (guildId, section) => `${guildId}:${section}`;

const guildManagerMock = {
  getGuildSection(guildId, section, fallback = {}) {
    return sections.has(keyFor(guildId, section)) ? sections.get(keyFor(guildId, section)) : fallback;
  },
  updateGuildSection(guildId, section, updater, fallback = {}) {
    const key = keyFor(guildId, section);
    const current = sections.has(key) ? sections.get(key) : fallback;
    const next = updater(current);
    sections.set(key, next);
    return next;
  },
  getEmbedPresets() { return {}; },
  saveGuildSection() { return true; },
  saveEmbedPreset(_guildId, name, embedData) { return { name, ...embedData }; },
  getEmbedPreset() { return null; },
  deleteEmbedPreset() { return false; },
  reloadGuild() { return true; },
};

try {
  require.cache[guildManagerPath] = { id: guildManagerPath, filename: guildManagerPath, loaded: true, exports: guildManagerMock };
  delete require.cache[embedTemplatesPath];

  const templates = require(embedTemplatesPath);
  const guildId = '123456789012345678';
  const templateId = 'lifecycle_test_template';
  const moduleKey = 'welcome';
  const slot = 'welcome';

  templates.saveTemplate(guildId, {
    templateId,
    name: 'Lifecycle Test Template',
    module: moduleKey,
    templateType: slot,
    embed: { title: 'Lifecycle test', description: 'Binding lifecycle contract.' },
  });

  const binding = templates.bindTemplate(guildId, moduleKey, slot, templateId);
  assert.equal(binding.templateId, templateId);
  assert.equal(templates.getBinding(guildId, moduleKey, slot)?.templateId, templateId);

  assert.throws(
    () => templates.deleteTemplate(guildId, templateId),
    (error) => error?.code === 'TEMPLATE_IN_USE' && error?.templateId === templateId,
    'Bound templates must be protected from deletion.'
  );

  const unbound = templates.unbindTemplate(guildId, moduleKey, slot);
  assert.equal(unbound.unbound, true);
  assert.equal(unbound.templateId, templateId);
  assert.equal(templates.getBinding(guildId, moduleKey, slot), null);

  assert.equal(templates.deleteTemplate(guildId, templateId), true, 'Template must be deletable after unbinding.');
  assert.equal(templates.getTemplate(guildId, templateId), null);

  console.log('✅ Embed Studio binding lifecycle audit passed: bind → protected delete → unbind → delete.');
} finally {
  if (originalGuildManagerCache) require.cache[guildManagerPath] = originalGuildManagerCache;
  else delete require.cache[guildManagerPath];
  if (originalEmbedTemplatesCache) require.cache[embedTemplatesPath] = originalEmbedTemplatesCache;
  else delete require.cache[embedTemplatesPath];
}
