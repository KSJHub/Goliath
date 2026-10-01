'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const originalMode = process.env.BOT_MODE;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-embed-session-'));

try {
  process.chdir(tmp);
  process.env.BOT_MODE = 'dev';

  const stateStore = require('../src/modules/messageStudio/embed/embedState');
  const key = 'guild-1:user-1';
  const state = {
    panels: [{ title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' }],
    media: { panels: [{ gallery: [{ source: 'https://example.test/faq.gif', placement: 'above' }] }] },
    selectedPanelIndex: 0,
    hasUnsavedChanges: true,
  };

  assert.equal(stateStore.savePersistedSession(key, state), true);
  assert.deepEqual(stateStore.loadPersistedSession(key), state);
  assert.equal(fs.existsSync(stateStore.sessionFileFor(key)), true);
  assert.equal(stateStore.removePersistedSession(key), true);
  assert.equal(stateStore.loadPersistedSession(key), null);

  console.log('✅ Embed Studio session persistence audit passed');
} finally {
  process.chdir(originalCwd);
  if (originalMode === undefined) delete process.env.BOT_MODE;
  else process.env.BOT_MODE = originalMode;
  fs.rmSync(tmp, { recursive: true, force: true });
}
