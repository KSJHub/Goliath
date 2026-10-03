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
  const above = renderer.indexOf('for (const imageEmbed of above) outputEmbeds.push(imageEmbed)');
  const content = renderer.indexOf('outputEmbeds.push(targetEmbed)', above);
  const below = renderer.indexOf('for (const imageEmbed of below) outputEmbeds.push(imageEmbed)', content);

  assert(
    above >= 0 && content > above && below > content,
    'renderer order must remain Above media -> panel content -> Below media'
  );

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

  /*
   * Legacy media editor contract.
   * The retired Edit Media/Header Type cycle must stay removed; the active
   * media manager owns the media controls directly; the retired Media Options submenu must stay removed.
   */
  const mediaSource = fs.readFileSync(
    require.resolve('../src/modules/messageStudio/embed/embedMedia'),
    'utf8'
  );

  const interactionSource = fs.readFileSync(
    require.resolve('../src/modules/messageStudio/embed/embedInteractions'),
    'utf8'
  );
  const mediaInteractionSource = interactionSource;

  assert(!mediaSource.includes('buildEditMediaPanel'), 'retired Edit Media panel must remain removed');
  assert(!mediaSource.includes("embed:header-type-cycle"), 'retired Header Type cycle button must remain removed');
  assert(interactionSource.includes("customId === 'embed:header-type-cycle'"), 'legacy Header Type cycle interactions must route into the current Media Manager');
  assert(!interactionSource.includes('buildEditMediaPanel'), 'retired Edit Media handler must remain removed');
  assert(
    interactionSource.includes("panel.buildMediaManagerPanel(i, who(i))") &&
    interactionSource.includes("customId === 'embed:header-type-cycle'"),
    'legacy Header Type interaction must bridge to the canonical Media Manager'
  );
  assert(!mediaInteractionSource.includes('updateMediaOptions'), 'retired Media Options submenu updater must be removed');
  assert(!mediaSource.includes('buildMediaOptionsPanel'), 'retired Media Options submenu builder must be removed');
  assert(!mediaInteractionSource.includes("customId === 'embed:media-options'"), 'retired Media Options entry point must be removed');
  assert(mediaInteractionSource.includes("customId.startsWith('embed:media-type:')") && mediaInteractionSource.includes("return updateMediaPanel(i)"), 'media type controls must return to the main Media Manager');

  /*
   * Renderer contract:
   *
   * Text  = suppress graphic header
   * GIF   = direct source / native animation
   * Image = forced static processing
   * Auto  = MIME-driven GIF vs static image behaviour
   */
  assert(
    renderer.includes("if (type === 'image/gif') return 'gif'"),
    'Auto must detect GIF from MIME type'
  );

  assert(
    renderer.includes("if (type.startsWith('image/')) return 'image'"),
    'Auto must detect static image MIME types'
  );

  assert(
    renderer.includes("headerType === 'text'"),
    'Text mode must have an explicit renderer guard'
  );

  assert(
    renderer.includes("headerType === 'gif'") &&
    renderer.includes('imageEmbed.setImage(source)'),
    'GIF mode must preserve the original source instead of rasterising it'
  );

  assert(
    renderer.includes('forcedStaticGalleryAttachment') &&
    renderer.includes("galleryHeaderType(item) === 'image'"),
    'Image mode must force the static-image processing path'
  );

  assert(
    renderer.includes('nativeImageShouldPassThrough(probe.contentType)'),
    'Auto must retain native-image pass-through detection'
  );


  console.log('✅ Embed Graphic Header regression audit passed.');
}

run();

// Sync Goliath and Deploy Goliath execute this file as the shared deep
// regression gate. Keep restart persistence and critical runtime API contracts
// here so a broken cross-module surface cannot reach DEV, BETA or PRODUCTION.
require('./auditEmbedSessionPersistence');
require('./auditEmbedStatePersistenceBoundary');
require('./auditRuntimeContracts');
