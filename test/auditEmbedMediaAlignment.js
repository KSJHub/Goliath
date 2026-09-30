'use strict';

const assert = require('node:assert/strict');
const media = require('../src/modules/messageStudio/embed/embedMedia');
const alignment = require('../src/modules/messageStudio/embed/embedImageAlignment');
const renderer = require('../src/modules/messageStudio/embed/embedRenderer');

const left = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'left' });
const centre = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'center' });
const right = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'right' });
const invalid = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'bogus' });
assert.equal(left.alignment, 'left');
assert.equal(centre.alignment, 'center');
assert.equal(right.alignment, 'right');
assert.equal(invalid.alignment, 'left');

const canonical = {
  media: {
    version: 2,
    panels: [{ gallery: [
      { source: 'https://example.com/a.png', placement: 'below', alignment: 'right' },
      { source: 'https://example.com/b.png', placement: 'below', alignment: 'center' },
    ], files: [], thumbnail: { source: '' } }],
  },
  mediaAlignment: { '0:0': 'left', '0:1': 'left' },
};

// Canonical item alignment must win over stale index-keyed compatibility state.
const rendered = renderer.applyMediaAlignmentMap(canonical.media, canonical.mediaAlignment);
assert.equal(rendered.panels[0].gallery[0].alignment, 'right');
assert.equal(rendered.panels[0].gallery[1].alignment, 'center');

// Reordering media must carry alignment with the item rather than the old index.
const reorderedMedia = JSON.parse(JSON.stringify(canonical.media));
[reorderedMedia.panels[0].gallery[0], reorderedMedia.panels[0].gallery[1]] = [
  reorderedMedia.panels[0].gallery[1],
  reorderedMedia.panels[0].gallery[0],
];
const reordered = alignment.canonicalizeState({ ...canonical, media: reorderedMedia }, false);
assert.equal(reordered.media.panels[0].gallery[0].alignment, 'center');
assert.equal(reordered.media.panels[0].gallery[1].alignment, 'right');
assert.deepEqual(reordered.mediaAlignment, { '0:0': 'center', '0:1': 'right' });

// Legacy presets that stored alignment only in mediaAlignment migrate once into canonical media.
const legacy = {
  media: { version: 2, panels: [{ gallery: [
    { source: 'https://example.com/a.png', placement: 'below' },
    { source: 'https://example.com/b.png', placement: 'below' },
  ], files: [], thumbnail: { source: '' } }] },
  mediaAlignment: { '0:0': 'right', '0:1': 'center' },
};
const migrated = alignment.canonicalizeState(legacy, true);
assert.equal(migrated.media.panels[0].gallery[0].alignment, 'right');
assert.equal(migrated.media.panels[0].gallery[1].alignment, 'center');
assert.deepEqual(migrated.mediaAlignment, { '0:0': 'right', '0:1': 'center' });

// Compatibility application remains immutable.
const mapped = alignment.applyAlignmentMap(legacy.media, { '0:0': 'left' });
assert.equal(mapped.panels[0].gallery[0].alignment, 'left');
assert.equal(legacy.media.panels[0].gallery[0].alignment, undefined);

console.log('✅ Embed media alignment canonical-state, migration and reorder audit passed.');
