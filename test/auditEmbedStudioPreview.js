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
    media: { version: 2, panels: [{ gallery: [{ source: 'https://example.com/faq.gif', placement }], files: [], thumbnail: { source: '' } }] },
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
none.media.panels[0].gallery = [];
none.panels[0].image = '';
assert.equal(panel.buildStudioPreviewEmbeds(none, interaction).length, 1, 'ordinary embeds keep the normal single-card preview');

// Loading a preset must preserve its identity all the way into Update / Save.
// This guards the bug where the save modal reopened blank and forced the user
// to retype the loaded preset name exactly before it could be overwritten.
const presetModal = panel.presetModal({ selectedPreset: 'Welcome to KSJ' }).toJSON();
const presetNameInput = presetModal.components?.[0]?.components?.[0];
assert.equal(presetNameInput?.value, 'Welcome to KSJ', 'Update / Save must prefill the currently loaded preset name.');

// Multi-panel media must stay isolated. A Graphic Header on panel 1 must not
// promote panel 2 media or mutate its ordinary content preview.
const multi = state('above');
multi.panels.push({
  title: 'Panel Two',
  description: 'Independent panel.',
  color: '#5865F2',
  image: '',
  fields: [],
  buttons: [],
});
multi.media.panels.push({
  gallery: [{ source: 'https://example.com/panel-two.png', placement: 'below' }],
  files: [],
  thumbnail: { source: '' },
});
const multiPreview = panel.buildStudioPreviewEmbeds(multi, interaction);
assert.equal(multiPreview.length, 3, 'one Graphic Header plus two content panels must render as three preview cards.');
assert.equal(multiPreview[0].data.image.url, 'https://example.com/faq.gif');
assert.equal(multiPreview[1].data.title, 'FAQ & Support Centre');
assert.equal(multiPreview[2].data.title, 'Panel Two');

console.log('✅ Embed Studio preview parity, preset identity and multi-panel isolation audit passed.');
