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
   * Header Type contract
   *
   * Canonical cycle:
   * Auto -> Text -> GIF -> Image -> Auto
   *
   * Auto is also the migration/default value for presets created before
   * headerType existed.
   */
  const mediaSource = fs.readFileSync(
    require.resolve('../src/modules/messageStudio/embed/embedMedia'),
    'utf8'
  );

  const interactionSource = fs.readFileSync(
    require.resolve('../src/modules/messageStudio/embed/embedInteractions'),
    'utf8'
  );

  assert(
    mediaSource.includes(
      "['auto', 'text', 'gif', 'image'].includes(String(value?.headerType || '').toLowerCase())"
    ),
    'gallery media must normalize headerType through the canonical four-value set'
  );

  assert(
    mediaSource.includes(": 'auto',"),
    'legacy gallery media without headerType must default to Auto'
  );

  assert(
    interactionSource.includes("auto: 'text'") &&
    interactionSource.includes("text: 'gif'") &&
    interactionSource.includes("gif: 'image'") &&
    interactionSource.includes("image: 'auto'"),
    'Header Type must cycle Auto -> Text -> GIF -> Image -> Auto'
  );

  assert(
    interactionSource.includes(
      "customId === 'embed:header-type-cycle'"
    ),
    'Header Type button must have a canonical interaction owner'
  );

  assert(
    !interactionSource.includes(
      "customId === 'embed:graphic-header-cycle'"
    ),
    'legacy Text/Graphic/Both interaction must not remain active'
  );

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

  /*
   * UI contract.
   */
  assert(
    mediaSource.includes("setCustomId('embed:header-type-cycle')") &&
    mediaSource.includes("Type: ${headerTypeLabel}"),
    'Media editor must expose the new Header Type control'
  );

  assert(
    mediaSource.includes('**Header Type**') &&
    mediaSource.includes('Use **Auto** unless you need to override'),
    'Media editor must explain the purpose of Header Type and recommend Auto'
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
