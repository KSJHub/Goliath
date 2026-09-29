'use strict';

const assert = require('node:assert/strict');
const media = require('../src/modules/messageStudio/embed/embedMedia');
const alignment = require('../src/modules/messageStudio/embed/embedImageAlignment');

const left = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'left' });
const centre = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'center' });
const right = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'right' });
const invalid = media.normalizeGalleryItem({ source: 'https://example.com/a.png', alignment: 'bogus' });

assert.equal(left.alignment, 'left');
assert.equal(centre.alignment, 'center');
assert.equal(right.alignment, 'right');
assert.equal(invalid.alignment, 'left');

const state = {
  selectedPanelIndex: 0,
  media: { version: 2, panels: [{ gallery: [{ source: 'https://example.com/a.png', placement: 'below', alignment: 'right' }], files: [], thumbnail: { source: '' } }] },
  panels: [{}],
};
const mapped = alignment.applyAlignmentMap(state.media, { '0:0': 'left' });
assert.equal(mapped.panels[0].gallery[0].alignment, 'left');
assert.equal(state.media.panels[0].gallery[0].alignment, 'right');

console.log('✅ Embed media alignment canonical-state audit passed.');
