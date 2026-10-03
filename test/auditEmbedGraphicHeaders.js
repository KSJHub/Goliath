'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  graphicHeaderIndex,
  normalizeGraphicHeaderPlacements,
} = require('../src/modules/messageStudio/embed/embedInteractions');

function run() {
  assert.equal(graphicHeaderIndex({ gallery: [] }), null);
  assert.equal(graphicHeaderIndex({ gallery: [{ placement: 'below' }, { placement: 'above' }] }), 1);

  const base = [
    { source: 'https://example.com/a.gif', placement: 'above' },
    { source: 'https://example.com/b.png', placement: 'below' },
    { source: 'https://example.com/c.jpg', placement: 'above' },
  ];
  const switched = normalizeGraphicHeaderPlacements(base, 1);
  assert.deepEqual(switched.map((item) => item.placement), ['below', 'above', 'below']);
  assert.equal(switched[1].source, base[1].source);

  const cleared = normalizeGraphicHeaderPlacements(base, null);
  assert(cleared.every((item) => item.placement === 'below'));

  const renderer = fs.readFileSync(require.resolve('../src/modules/messageStudio/embed/embedRenderer'), 'utf8');
  const above = renderer.indexOf('if (aboveItems.length) container.addMediaGalleryComponents');
  const text = renderer.indexOf('if (text && isHttpsUrl(thumbSource))', above);
  assert(above >= 0 && text > above, 'graphic header must render before panel text');
  assert(!renderer.slice(above, text).includes('Separator'), 'do not add artificial spacing below graphic headers');

  assert(renderer.includes("'image/gif'"));
  assert(renderer.includes('nativeImageShouldPassThrough'));

  const embedRuntime = fs.readFileSync(require.resolve('../src/modules/messageStudio/embed/embed'), 'utf8');
  assert(embedRuntime.includes('function canonicalMediaState'));
  assert(embedRuntime.includes('media.mediaModel.normalizeMedia(state?.media || {}, panels)'));
  assert(embedRuntime.includes('installCanonicalMediaSessions(targetPanel)'));
  assert(
    !embedRuntime.includes("placement: itemIndex === 0 ? 'above' : 'below'"),
    'canonical session normalization must not overwrite an explicit Above/Below media placement'
  );

  // Persistence is owned directly by the canonical embedState boundary.
  // Validate the current consolidated implementation rather than the retired
  // embedSessionStore module that previously supplied these operations.
  const embedState = fs.readFileSync(require.resolve('../src/modules/messageStudio/embed/embedState'), 'utf8');
  assert(embedState.includes('function loadPersistedSession(key)'), 'embedState must own durable session loading');
  assert(embedState.includes('function savePersistedSession(key, state)'), 'embedState must own durable session saving');
  assert(embedState.includes('function removePersistedSession(key)'), 'embedState must own durable session removal');
  assert(embedState.includes('loadPersistedSession(key)'), 'getSession must hydrate from durable storage');
  assert(
    embedState.includes('savePersistedSession(key, state)') &&
    embedState.includes('persistOrThrow(key, synced'),
    'saveSession must persist canonical state'
  );
  assert(embedState.includes('removePersistedSession(key)'), 'clearSession must remove durable state');

  console.log('✅ Embed Graphic Header regression audit passed.');
}

run();

// Sync Goliath and Deploy Goliath execute this file as the shared deep
// regression gate. Keep restart persistence and critical runtime API contracts
// here so a broken cross-module surface cannot reach DEV, BETA or PRODUCTION.
require('./auditEmbedSessionPersistence');
require('./auditEmbedStatePersistenceBoundary');
require('./auditRuntimeContracts');
