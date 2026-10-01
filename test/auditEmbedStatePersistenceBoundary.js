'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const statePath = path.join(repo, 'src/modules/messageStudio/embed/embedState.js');

function run(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: repo,
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

const token = `${process.pid}-${Date.now()}`;
const guildId = `audit-guild-${token}`;
const userId = `audit-user-${token}`;
const common = `
  const state = require(${JSON.stringify(statePath)});
  state.configure({
    defaultState: () => ({ panels: [{ title: 'Default' }], selectedPanelIndex: 0, hasUnsavedChanges: false }),
    sync: (value) => value,
    basePanel: () => ({ title: 'Template' }),
  });
  const interaction = { guildId: ${JSON.stringify(guildId)}, user: { id: ${JSON.stringify(userId)} } };
`;

try {
  run(`${common}
    const saved = state.markUnsaved(interaction, {
      panels: [{ title: '', graphicHeaderTitle: 'FAQ', image: 'https://example.test/faq.gif' }],
      media: { panels: [{ gallery: [{ source: 'https://example.test/faq.gif', placement: 'above' }] }] },
      selectedPanelIndex: 0,
    });
    if (!saved.hasUnsavedChanges) process.exit(2);
  `);

  const restored = JSON.parse(run(`${common}
    process.stdout.write(JSON.stringify(state.getSession(interaction)));
  `));
  assert.equal(restored.panels[0].graphicHeaderTitle, 'FAQ');
  assert.equal(restored.media.panels[0].gallery[0].placement, 'above');
  assert.equal(restored.hasUnsavedChanges, true);

  run(`${common}
    state.clearSession(interaction);
  `);

  const afterClear = JSON.parse(run(`${common}
    process.stdout.write(JSON.stringify(state.getSession(interaction)));
    state.clearSession(interaction);
  `));
  assert.equal(afterClear.panels[0].title, 'Default');

  const entry = fs.readFileSync(path.join(repo, 'src/modules/messageStudio/embed/embed.js'), 'utf8');
  assert.match(entry, /require\('\.\/embedState'\)/, 'Embed entry point must load canonical embedState.');
  assert.doesNotMatch(entry, /sessionPersistence\.install\(embedState\)/, 'Obsolete persistence wrapper must not be installed.');

  console.log('✅ Embed Studio canonical state persistence boundary audit passed');
} finally {
  try {
    run(`${common}
      state.clearSession(interaction);
    `);
  } catch {}
}