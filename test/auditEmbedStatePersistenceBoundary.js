'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const originalMode = process.env.BOT_MODE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-embed-state-boundary-'));

try {
  process.chdir(tmp);
  process.env.BOT_MODE = 'dev';

  const embedState = require('../src/modules/messageStudio/embed/embedState');
  const persistence = require('../src/modules/messageStudio/embed/embedSessionPersistence');
  const store = require('../src/modules/messageStudio/embed/embedSessionStore');

  embedState.configure({
    defaultState: () => ({ panels: [{ title: 'Default' }], selectedPanelIndex: 0, hasUnsavedChanges: false }),
    sync: (state) => state,
    basePanel: () => ({ title: 'Template' }),
  });
  persistence.install(embedState);

  const interaction = { guildId: 'guild-1', user: { id: 'user-1' } };
  const key = embedState.sessionKey(interaction);
  const saved = embedState.markUnsaved(interaction, {
    panels: [{ title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' }],
    mediaV2: { panels: [{ gallery: [{ source: 'https://example.test/faq.gif', placement: 'above' }] }] },
    selectedPanelIndex: 0,
  });

  assert.equal(saved.hasUnsavedChanges, true);
  assert.deepEqual(store.load(key), saved);

  // Simulate a process-memory loss while leaving the durable runtime file intact.
  embedState.sessions.delete(key);
  // A fresh process would have a fresh hydration set. Re-load the persistence
  // module to model that boundary without requiring Discord.
  delete require.cache[require.resolve('../src/modules/messageStudio/embed/embedSessionPersistence')];
  delete embedState.__persistentSessionsInstalled;
  const freshPersistence = require('../src/modules/messageStudio/embed/embedSessionPersistence');
  freshPersistence.install(embedState);

  const restored = embedState.getSession(interaction);
  assert.equal(restored.panels[0].graphicHeaderTitle, 'FAQ');
  assert.equal(restored.mediaV2.panels[0].gallery[0].placement, 'above');
  assert.equal(restored.hasUnsavedChanges, true);

  embedState.clearSession(interaction);
  assert.equal(store.load(key), null);

  const entry = fs.readFileSync(path.join(originalCwd, 'src/modules/messageStudio/embed/embed.js'), 'utf8');
  assert(entry.indexOf("sessionPersistence.install(embedState)") < entry.indexOf("require('./embedPanel')"));

  console.log('✅ Embed Studio state persistence boundary audit passed');
} finally {
  process.chdir(originalCwd);
  if (originalMode === undefined) delete process.env.BOT_MODE;
  else process.env.BOT_MODE = originalMode;
  fs.rmSync(tmp, { recursive: true, force: true });
}
