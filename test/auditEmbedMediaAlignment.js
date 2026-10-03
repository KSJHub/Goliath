'use strict';

const assert = require('node:assert/strict');
const media = require('../src/modules/messageStudio/embed/embedMedia');
const alignment = require('../src/modules/messageStudio/embed/embedImageAlignment');
const preview = alignment;
const renderer = require('../src/modules/messageStudio/embed/embedRenderer');

const mediaManagerSource = require('node:fs').readFileSync(
  require.resolve('../src/modules/messageStudio/embed/embedMedia'),
  'utf8'
);
const mediaManagerStart = mediaManagerSource.indexOf('function installMediaManagerUi(panel) {');
const mediaManagerEnd = mediaManagerSource.indexOf('\nfunction installThumbnailUi(panel)', mediaManagerStart);
const mediaManagerBody = mediaManagerSource.slice(mediaManagerStart, mediaManagerEnd);
assert(!mediaManagerBody.includes('media.mediaModel'), 'Media Manager must not reference an undefined media variable.');
assert(!mediaManagerBody.includes('media.getPanelMedia'), 'Media Manager must use the canonical media model or panel API.');

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
      { source: 'https://example.com/a.png', placement: 'above', alignment: 'right', size: 'small', spoiler: true },
      { source: 'https://example.com/b.png', placement: 'below', alignment: 'center', size: 'medium', spoiler: false },
    ], files: [], thumbnail: { source: 'https://example.com/thumb.png', alt: 'Thumbnail' } }],
  },
  mediaAlignment: { '0:0': 'left', '0:1': 'left' },
  selectedPanelIndex: 0,
  selectedMediaIndex: 1,
};

// Canonical item alignment must win over stale index-keyed compatibility state in both
// the final renderer and the live preview path.
const rendered = renderer.applyMediaAlignmentMap(canonical.media, canonical.mediaAlignment);
assert.equal(rendered.panels[0].gallery[0].alignment, 'right');
assert.equal(rendered.panels[0].gallery[1].alignment, 'center');
assert.equal(preview.alignmentFor(canonical, 0, 0, canonical.media.panels[0].gallery[0]), 'right');
assert.equal(preview.alignmentFor(canonical, 0, 1, canonical.media.panels[0].gallery[1]), 'center');
assert.equal(preview.alignmentFor({ mediaAlignment: { '0:0': 'right' } }, 0, 0, {}), 'right');

// Canonicalisation must not lose unrelated per-item controls or panel thumbnail state.
const canonicalized = alignment.canonicalizeState(canonical, false);
assert.equal(canonicalized.media.panels[0].gallery[0].placement, 'above');
assert.equal(canonicalized.media.panels[0].gallery[0].size, 'small');
assert.equal(canonicalized.media.panels[0].gallery[0].spoiler, true);
assert.equal(canonicalized.media.panels[0].gallery[1].size, 'medium');
assert.equal(canonicalized.media.panels[0].thumbnail.source, 'https://example.com/thumb.png');
assert.equal(canonicalized.selectedMediaIndex, 1);

// Reordering media must carry alignment and all item-owned presentation state with the
// item rather than leaving any of it attached to the old index.
const reorderedMedia = JSON.parse(JSON.stringify(canonical.media));
[reorderedMedia.panels[0].gallery[0], reorderedMedia.panels[0].gallery[1]] = [
  reorderedMedia.panels[0].gallery[1],
  reorderedMedia.panels[0].gallery[0],
];
const reordered = alignment.canonicalizeState({ ...canonical, media: reorderedMedia }, false);
assert.equal(reordered.media.panels[0].gallery[0].alignment, 'center');
assert.equal(reordered.media.panels[0].gallery[0].placement, 'below');
assert.equal(reordered.media.panels[0].gallery[0].size, 'medium');
assert.equal(reordered.media.panels[0].gallery[0].spoiler, false);
assert.equal(reordered.media.panels[0].gallery[1].alignment, 'right');
assert.equal(reordered.media.panels[0].gallery[1].placement, 'above');
assert.equal(reordered.media.panels[0].gallery[1].size, 'small');
assert.equal(reordered.media.panels[0].gallery[1].spoiler, true);
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

console.log('✅ Embed media canonical-state audit passed: alignment precedence/migration plus placement, size, spoiler, thumbnail and reorder state are preserved.');
