'use strict';

const assert = require('node:assert/strict');
const panel = require('../src/modules/messageStudio/embed/embedPanel');

const interaction = {
  guild: { id: 'guild-preview', name: 'Preview Guild', memberCount: 42 },
  user: { id: 'user-preview', username: 'Preview User', displayAvatarURL: () => 'https://example.com/user.png' },
  member: { displayName: 'Preview User' },
};

function state(placement = 'above') {
  return {
    selectedPanelIndex: 0,
    showTimestamp: false,
    fieldLayout: 'auto',
    color: '#5865F2',
    panels: [{
      title: 'FAQ & Support Centre',
      description: 'Find an answer below.',
      color: '#5865F2',
      image: 'https://example.com/legacy-bottom.png',
      fields: [],
      buttons: [],
    }],
    mediaV2: { version: 2, panels: [{ gallery: [{ source: 'https://example.com/faq.gif', placement }], files: [], thumbnail: { source: '' } }] },
  };
}

const above = panel.buildStudioPreviewEmbeds(state('above'), interaction);
assert.equal(above.length, 2, 'graphic header preview must be a separate first card');
assert.equal(above[0].data.image.url, 'https://example.com/faq.gif', 'first preview card must be the graphic header');
assert.equal(above[0].data.title, undefined, 'graphic header card must not duplicate panel text');
assert.equal(above[1].data.title, 'FAQ & Support Centre', 'content must follow the graphic header');
assert.equal(above[1].data.image, undefined, 'content preview must not duplicate a legacy bottom image');

const below = panel.buildStudioPreviewEmbeds(state('below'), interaction);
assert.equal(below.length, 1, 'below-content media must never be promoted to graphic header in preview');
assert.equal(below[0].data.title, 'FAQ & Support Centre');

const none = state('below');
none.mediaV2.panels[0].gallery = [];
none.panels[0].image = '';
assert.equal(panel.buildStudioPreviewEmbeds(none, interaction).length, 1, 'ordinary embeds keep the normal single-card preview');

console.log('✅ Embed Studio preview parity audit passed.');
