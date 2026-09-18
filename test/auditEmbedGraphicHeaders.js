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

  // Components V2 controls the intrinsic spacing between adjacent MediaGallery
  // and TextDisplay components. Guard our side of the contract: header gallery
  // must be inserted immediately before panel text with no Separator component.
  const renderer = fs.readFileSync(require.resolve('../src/modules/messageStudio/embed/embedRenderer'), 'utf8');
  const above = renderer.indexOf('if (aboveItems.length) container.addMediaGalleryComponents');
  const text = renderer.indexOf('if (text && isHttpsUrl(thumbSource))', above);
  assert(above >= 0 && text > above, 'graphic header must render before panel text');
  assert(!renderer.slice(above, text).includes('Separator'), 'do not add artificial spacing below graphic headers');

  // Native animated formats must remain URL pass-through so GIF animation and
  // larger remote headers are not forced through the static 8 MB processor.
  assert(renderer.includes("'image/gif'"));
  assert(renderer.includes('nativeImageShouldPassThrough'));

  console.log('✅ Embed Graphic Header regression audit passed.');
}

run();
