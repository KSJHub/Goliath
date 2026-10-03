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
    panels: [
      { title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' },
      { title: 'Second panel', graphicHeaderTitle: '', image: '' },
    ],
    media: {
      version: 2,
      panels: [
        {
          gallery: [
            {
              source: 'https://example.test/faq.gif',
              placement: 'above',
              alignment: 'right',
              size: 'small',
              spoiler: true,
            },
            {
              source: 'https://example.test/body.png',
              placement: 'below',
              alignment: 'center',
              size: 'medium',
              spoiler: false,
            },
          ],
          thumbnail: {
            source: 'https://example.test/thumb.png',
            alt: 'FAQ thumbnail',
          },
          files: [],
        },
        { gallery: [], thumbnail: { source: '', alt: '' }, files: [] },
      ],
    },
    mediaAlignment: { '0:0': 'right', '0:1': 'center' },
    selectedPanelIndex: 0,
    selectedMediaIndex: 1,
    selectedPreset: 'Welcome to KSJ',
    hasUnsavedChanges: false,
  };

  assert.equal(stateStore.savePersistedSession(key, state), true);

  const restored = stateStore.loadPersistedSession(key);
  assert.deepEqual(restored, state);
  assert.equal(restored.selectedPreset, 'Welcome to KSJ', 'Loaded preset identity must survive persistence.');
  assert.equal(restored.selectedMediaIndex, 1, 'Selected media item must survive persistence.');
  assert.equal(restored.media.panels[0].gallery[0].placement, 'above', 'Graphic Header placement must survive persistence.');
  assert.equal(restored.media.panels[0].gallery[0].alignment, 'right', 'Media alignment must survive persistence.');
  assert.equal(restored.media.panels[0].gallery[0].size, 'small', 'Media size must survive persistence.');
  assert.equal(restored.media.panels[0].gallery[0].spoiler, true, 'Media spoiler state must survive persistence.');
  assert.equal(restored.media.panels[0].thumbnail.source, 'https://example.test/thumb.png', 'Thumbnail state must survive persistence.');
  assert.equal(restored.hasUnsavedChanges, false, 'Clean loaded-preset baseline must survive persistence.');

  assert.equal(fs.existsSync(stateStore.sessionFileFor(key)), true);
  assert.equal(stateStore.removePersistedSession(key), true);
  assert.equal(stateStore.loadPersistedSession(key), null);

  console.log('✅ Embed Studio session persistence audit passed: preset identity, panel/media selection, header placement, alignment, size, spoiler and thumbnail state are durable.');
} finally {
  process.chdir(originalCwd);
  if (originalMode === undefined) delete process.env.BOT_MODE;
  else process.env.BOT_MODE = originalMode;
  fs.rmSync(tmp, { recursive: true, force: true });
}
