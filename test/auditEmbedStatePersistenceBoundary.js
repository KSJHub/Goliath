'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'goliath-embed-state-boundary-'));
const statePath = path.join(repo, 'src/modules/messageStudio/embed/embedState.js');
const persistencePath = path.join(repo, 'src/modules/messageStudio/embed/embedSessionPersistence.js');

function run(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: tmp,
    env: { ...process.env, BOT_MODE: 'dev' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exit(result.status || 1);
  }
  return String(result.stdout || '').trim();
}

try {
  const common = `
    const state = require(${JSON.stringify(statePath)});
    const persistence = require(${JSON.stringify(persistencePath)});
    state.configure({
      defaultState: () => ({ panels: [{ title: 'Default' }], selectedPanelIndex: 0, hasUnsavedChanges: false }),
      sync: (value) => value,
      basePanel: () => ({ title: 'Template' }),
    });
    persistence.install(state);
    const interaction = { guildId: 'guild-1', user: { id: 'user-1' } };
  `;

  run(`${common}
    const saved = state.markUnsaved(interaction, {
      panels: [{ title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' }],
      mediaV2: { panels: [{ gallery: [{ source: 'https://example.test/faq.gif', placement: 'above' }] }] },
      selectedPanelIndex: 0,
    });
    if (!saved.hasUnsavedChanges) process.exit(2);
  `);

  const restored = JSON.parse(run(`${common}
    process.stdout.write(JSON.stringify(state.getSession(interaction)));
  `));
  assert.equal(restored.panels[0].graphicHeaderTitle, 'FAQ');
  assert.equal(restored.mediaV2.panels[0].gallery[0].placement, 'above');
  assert.equal(restored.hasUnsavedChanges, true);

  run(`${common}
    state.clearSession(interaction);
  `);

  const afterClear = JSON.parse(run(`${common}
    process.stdout.write(JSON.stringify(state.getSession(interaction)));
  `));
  assert.equal(afterClear.panels[0].title, 'Default');

  const entry = fs.readFileSync(path.join(repo, 'src/modules/messageStudio/embed/embed.js'), 'utf8');
  assert(entry.indexOf('sessionPersistence.install(embedState)') < entry.indexOf("require('./embedPanel')"));

  console.log('✅ Embed Studio state persistence boundary audit passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
