'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  graphicHeaderIndex,
  normalizeHeaderPlacements,
} = require('../src/modules/messageStudio/embed/embedGraphicHeaders');

function run() {
  assert.equal(graphicHeaderIndex({ gallery: [] }), null);
  assert.equal(graphicHeaderIndex({ gallery: [{ placement: 'below' }, { placement: 'above' }] }), 1);

  const base = [
    { source: 'https://example.com/a.gif', placement: 'above' },
    { source: 'https://example.com/b.png', placement: 'below' },
    { source: 'https://example.com/c.jpg', placement: 'above' },
  ];
  const switched = normalizeHeaderPlacements(base, 1);
  assert.deepEqual(switched.map((item) => item.placement), ['below', 'above', 'below']);
  assert.equal(switched[1].source, base[1].source);

  const cleared = normalizeHeaderPlacements(base, null);
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
  assert(embedRuntime.includes('mediaWeight(fromV2) >= mediaWeight(fromStored)'));
  assert(embedRuntime.includes('installCanonicalMediaSessions(targetPanel)'));
  assert(embedRuntime.includes("placement: itemIndex === 0 ? 'above' : 'below'"));

  // Persistence must be installed before embedPanel captures/destructures the
  // state API. This is the regression that caused drafts to disappear after a
  // PM2 restart even though the durable store itself was working correctly.
  assert(embedRuntime.indexOf('sessionPersistence.install(embedState)') < embedRuntime.indexOf("require('./embedPanel')"));

  console.log('✅ Embed Graphic Header regression audit passed.');
}

run();

// Sync Goliath and Deploy Goliath execute this file as the shared deep
// regression gate. Keep restart persistence and critical runtime API contracts
// here so a broken cross-module surface cannot reach DEV, BETA or PRODUCTION.
require('./auditEmbedSessionPersistence');
require('./auditEmbedStatePersistenceBoundary');
require('./auditRuntimeContracts');
