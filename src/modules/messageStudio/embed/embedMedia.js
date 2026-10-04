'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { getRuntimePaths } = require('../../../config/runtimePaths');
const { validatePanelMedia, statusIcon } = require('./embedValidation');

const MEDIA_SCHEMA_VERSION = 2;
const DEFAULT_GALLERY_ITEM = Object.freeze({
  type: 'auto',
  headerType: 'auto',
  spoiler: false,
  placement: 'above',
  alignment: 'left',
  size: 'small',
});
const MAX_GALLERY_ITEMS = 10;
const MAX_FILES = 10;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

function assetRoot(guildId) {
  const root = path.join(getRuntimePaths(process.env.BOT_MODE).data, 'embed-assets', String(guildId || 'global'));
  fs.mkdirSync(root, { recursive: true });
  return root;
}
function stableSourceKey(url) {
  const text = String(url || '').trim();
  try {
    const parsed = new URL(text);
    if (parsed.hostname === 'cdn.discordapp.com' || parsed.hostname === 'media.discordapp.net') {
      return `${parsed.hostname.replace('media.', 'cdn.')}${parsed.pathname}`;
    }
  } catch {}
  return text;
}
function assetId(url) {
  return crypto.createHash('sha256').update(stableSourceKey(url)).digest('hex');
}
function pathsFor(guildId, url) {
  const id = assetId(url);
  const root = assetRoot(guildId);
  return { id, data: path.join(root, `${id}.bin`), meta: path.join(root, `${id}.json`) };
}
function getCachedAsset(guildId, url) {
  if (!url) return null;
  const p = pathsFor(guildId, url);
  if (!fs.existsSync(p.data)) return null;
  try {
    const buffer = fs.readFileSync(p.data);
    if (!buffer.length || buffer.length > MAX_ASSET_BYTES) return null;
    let meta = {};
    if (fs.existsSync(p.meta)) meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
    return { buffer, meta, id: p.id };
  } catch { return null; }
}
function saveCachedAsset(guildId, url, buffer, meta = {}) {
  if (!url || !Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ASSET_BYTES) return null;
  const p = pathsFor(guildId, url);
  fs.writeFileSync(p.data, buffer);
  fs.writeFileSync(p.meta, JSON.stringify({
    sourceKey: stableSourceKey(url),
    sourceUrl: String(url),
    contentType: meta.contentType || null,
    bytes: buffer.length,
    savedAt: new Date().toISOString(),
  }, null, 2));
  return { id: p.id, path: p.data };
}
function supportedPersistentType(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!type) return true;
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return true;
  return new Set(['application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream', 'text/plain', 'text/csv']).has(type);
}
async function downloadAsset(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Media fetch failed with HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!supportedPersistentType(contentType)) throw new Error(`Unsupported media type: ${contentType || 'unknown'}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_ASSET_BYTES) throw new Error('Media exceeds the 25 MB persistence limit.');
    const buffer = await response.buffer();
    if (buffer.length > MAX_ASSET_BYTES) throw new Error('Media exceeds the 25 MB persistence limit.');
    return { buffer, contentType };
  } finally { clearTimeout(timer); }
}
async function ensureAssetCached(guildId, url) {
  if (!url || !/^https:\/\//i.test(String(url))) return null;

  const cached = getCachedAsset(guildId, url) || (guildId !== 'global' ? getCachedAsset('global', url) : null);
  const cachedType = String(cached?.meta?.contentType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  // Only reuse cache entries whose MIME metadata is meaningful.
  // Older/stale entries may contain no type or a generic transport type,
  // which can make the renderer reject otherwise valid Discord media.
  if (
    cached &&
    cachedType &&
    cachedType !== 'application/octet-stream' &&
    supportedPersistentType(cachedType)
  ) {
    return { ...cached, cached: true };
  }

  const downloaded = await downloadAsset(url);

  saveCachedAsset(guildId, url, downloaded.buffer, {
    contentType: downloaded.contentType,
  });

  return {
    ...downloaded,
    id: assetId(url),
    cached: false,
  };
}
function addHttpsSource(urls, value) {
  const source = String(value || '').trim();
  if (/^https:\/\//i.test(source)) urls.add(source);
}
function collectMediaUrls(urls, media) {
  for (const panel of Array.isArray(media?.panels) ? media.panels : []) {
    addHttpsSource(urls, panel?.thumbnail?.source);
    for (const item of Array.isArray(panel?.gallery) ? panel.gallery : []) addHttpsSource(urls, item?.source);
    for (const file of Array.isArray(panel?.files) ? panel.files : []) addHttpsSource(urls, file?.source);
  }
}
async function persistPresetMedia(guildId, preset) {
  const urls = new Set();
  const panels = Array.isArray(preset?.panels) ? preset.panels : [preset];
  for (const panel of panels) {
    for (const key of ['image', 'thumbnail', 'authorIcon', 'footerIcon']) addHttpsSource(urls, panel?.[key]);
  }
  collectMediaUrls(urls, preset?.media);
  const results = [];
  for (const url of urls) {
    try {
      const result = await ensureAssetCached(guildId, url);
      results.push({ url, ok: Boolean(result), cached: Boolean(result?.cached) });
    } catch (error) {
      results.push({ url, ok: false, error: error?.message || String(error) });
    }
  }
  return results;
}

function clone(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value ?? fallback)); } catch { return fallback; }
}
function cleanString(value, maxLength = 2048) { return String(value ?? '').trim().slice(0, maxLength); }
function cleanSource(value) { return cleanString(value, 2048); }
function normalizeThumbnail(value = {}, legacySource = '') {
  const source = typeof value === 'string' ? value : value?.source || value?.url || value?.attachment || legacySource;
  return { source: cleanSource(source), alt: cleanString(value?.alt || value?.description || '', 1024) };
}
function normalizeGalleryItem(value = {}) {
  const source = typeof value === 'string' ? value : value?.source || value?.url || value?.attachment || '';
  const rawType = String(value?.type || '').toLowerCase();
  const rawHeaderType = String(value?.headerType || '').toLowerCase();
  const rawPlacement = String(value?.placement || '').toLowerCase();
  const rawAlignment = String(value?.alignment || '').toLowerCase();
  const rawSize = String(value?.size || '').toLowerCase();
  return {
    source: cleanSource(source),
    alt: cleanString(value?.alt || value?.description || '', 1024),
    spoiler: value?.spoiler === true,
    // Media Type is always auto by default. Legacy "text" media values are
    // retired; text is a header mode, not a gallery media type.
    type: ['auto', 'image', 'video'].includes(rawType) ? rawType : DEFAULT_GALLERY_ITEM.type,
    headerType: ['auto', 'text', 'gif', 'image'].includes(rawHeaderType) ? rawHeaderType : DEFAULT_GALLERY_ITEM.headerType,
    placement: rawPlacement === 'above' || rawPlacement === 'below' ? rawPlacement : DEFAULT_GALLERY_ITEM.placement,
    alignment: ['left', 'center', 'right'].includes(rawAlignment) ? rawAlignment : DEFAULT_GALLERY_ITEM.alignment,
    size: ['small', 'medium', 'large'].includes(rawSize) ? rawSize : DEFAULT_GALLERY_ITEM.size,
  };
}
function normalizeFile(value = {}) {
  const source = typeof value === 'string' ? value : value?.source || value?.url || value?.attachment || '';
  return {
    source: cleanSource(source),
    name: cleanString(value?.name || '', 256),
    description: cleanString(value?.description || value?.alt || '', 1024),
    spoiler: value?.spoiler === true,
  };
}
function normalizePanelMedia(value = {}, legacyPanel = {}) {
  const gallery = (Array.isArray(value?.gallery) ? value.gallery : []).map(normalizeGalleryItem).filter((item) => item.source).slice(0, MAX_GALLERY_ITEMS);
  const legacyImage = cleanSource(legacyPanel?.image || legacyPanel?.imageURL || '');
  if (!gallery.length && legacyImage) gallery.push(normalizeGalleryItem({ source: legacyImage, type: 'auto' }));
  const files = (Array.isArray(value?.files) ? value.files : []).map(normalizeFile).filter((item) => item.source).slice(0, MAX_FILES);
  return {
    thumbnail: normalizeThumbnail(value?.thumbnail || {}, legacyPanel?.thumbnail || legacyPanel?.thumbnailURL || ''),
    gallery,
    files,
  };
}
function normalizeMedia(value = {}, panels = []) {
  const panelList = Array.isArray(panels) ? panels : [];
  const inputPanels = Array.isArray(value?.panels) ? value.panels : [];
  const hasMediaState = Array.isArray(value?.panels);
  const length = panelList.length || inputPanels.length || 1;
  const normalizedPanels = [];

  for (let index = 0; index < length; index += 1) {
    // Legacy panel image/thumbnail fields are migration inputs only.
    // Once a media model exists, that model is authoritative: an empty
    // gallery or thumbnail means the user explicitly wants no media.
    normalizedPanels.push(
      normalizePanelMedia(
        inputPanels[index] || {},
        hasMediaState ? {} : (panelList[index] || {})
      )
    );
  }

  return { version: MEDIA_SCHEMA_VERSION, panels: normalizedPanels };
}
function ensureStateMedia(state = {}) {
  const panels = Array.isArray(state?.panels) ? state.panels : [];
  return { ...state, media: normalizeMedia(state?.media || {}, panels) };
}
function syncLegacyPatch(state = {}, patch = {}) {
  const safe = ensureStateMedia(state);
  const index = Math.max(0, Math.min(Number(safe.selectedPanelIndex) || 0, safe.media.panels.length - 1));
  const panelMedia = clone(safe.media.panels[index], normalizePanelMedia());
  if (Object.prototype.hasOwnProperty.call(patch, 'thumbnail')) panelMedia.thumbnail = normalizeThumbnail({ source: patch.thumbnail });
  if (Object.prototype.hasOwnProperty.call(patch, 'image')) {
    const source = cleanSource(patch.image);
    if (source) {
      if (panelMedia.gallery.length) panelMedia.gallery[0] = { ...panelMedia.gallery[0], source };
      else panelMedia.gallery.push(normalizeGalleryItem({ source }));
    } else if (panelMedia.gallery.length <= 1) panelMedia.gallery = [];
    else panelMedia.gallery = panelMedia.gallery.slice(1);
  }
  const mediaPanels = safe.media.panels.map((entry, n) => n === index ? normalizePanelMedia(panelMedia) : entry);
  return { ...safe, media: { version: MEDIA_SCHEMA_VERSION, panels: mediaPanels } };
}
function panelSignature(panel) {
  try { return JSON.stringify(panel || {}); } catch { return ''; }
}
function reconcileMediaByPanels(previous = {}, next = {}) {
  const oldState = ensureStateMedia(previous);
  const nextPanels = Array.isArray(next?.panels) ? next.panels : [];
  if (!nextPanels.length) return ensureStateMedia(next);
  const oldPanels = Array.isArray(oldState.panels) ? oldState.panels : [];
  const oldMedia = oldState.media.panels;
  const oldSignatures = oldPanels.map(panelSignature);
  const nextSignatures = nextPanels.map(panelSignature);
  if (oldPanels.length === nextPanels.length) {
    const sameMultiset = [...oldSignatures].sort().join('\n') === [...nextSignatures].sort().join('\n');
    if (!sameMultiset) return { ...next, media: normalizeMedia(oldState.media, nextPanels) };
  }
  const used = new Set();
  const mapped = nextPanels.map((panel, nextIndex) => {
    const signature = nextSignatures[nextIndex];
    let match = oldSignatures.findIndex((value, index) => value === signature && !used.has(index));
    if (match >= 0) {
      used.add(match);
      return clone(oldMedia[match], normalizePanelMedia({}, panel));
    }
    match = oldSignatures.findIndex((value) => value === signature);
    if (match >= 0) return clone(oldMedia[match], normalizePanelMedia({}, panel));
    return normalizePanelMedia({}, panel);
  });
  return { ...next, media: { version: MEDIA_SCHEMA_VERSION, panels: mapped } };
}
function mediaForPanel(state = {}, index = null) {
  const safe = ensureStateMedia(state);
  const selected = index == null ? Number(safe.selectedPanelIndex) || 0 : Number(index) || 0;
  return clone(safe.media.panels[Math.max(0, Math.min(selected, safe.media.panels.length - 1))], normalizePanelMedia());
}
function setPanelMedia(state = {}, index, media = {}) {
  const safe = ensureStateMedia(state);
  const selected = Math.max(0, Math.min(Number(index) || 0, safe.media.panels.length - 1));
  const nextPanels = safe.media.panels.map((entry, n) => n === selected ? normalizePanelMedia(media, safe.panels?.[n] || {}) : entry);
  return { ...safe, media: { version: MEDIA_SCHEMA_VERSION, panels: nextPanels } };
}
function addPanelMedia(state = {}, afterIndex = null, sourceMedia = null) {
  const safe = ensureStateMedia(state);
  const index = afterIndex == null ? safe.media.panels.length - 1 : Math.max(-1, Math.min(Number(afterIndex), safe.media.panels.length - 1));
  const nextPanels = [...safe.media.panels];
  nextPanels.splice(index + 1, 0, normalizePanelMedia(sourceMedia || {}));
  return { ...safe, media: { version: MEDIA_SCHEMA_VERSION, panels: nextPanels } };
}
function removePanelMedia(state = {}, index) {
  const safe = ensureStateMedia(state);
  const nextPanels = [...safe.media.panels];
  if (nextPanels.length > 1) nextPanels.splice(Math.max(0, Math.min(Number(index) || 0, nextPanels.length - 1)), 1);
  return { ...safe, media: { version: MEDIA_SCHEMA_VERSION, panels: nextPanels } };
}
function movePanelMedia(state = {}, from, to) {
  const safe = ensureStateMedia(state);
  const nextPanels = [...safe.media.panels];
  const a = Number(from), b = Number(to);
  if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < nextPanels.length && b < nextPanels.length) [nextPanels[a], nextPanels[b]] = [nextPanels[b], nextPanels[a]];
  return { ...safe, media: { version: MEDIA_SCHEMA_VERSION, panels: nextPanels } };
}

const mediaModel = Object.freeze({
  MEDIA_SCHEMA_VERSION,
  DEFAULT_GALLERY_ITEM,
  MAX_GALLERY_ITEMS,
  MAX_FILES,
  normalizeThumbnail,
  normalizeGalleryItem,
  normalizeFile,
  normalizePanelMedia,
  normalizeMedia,
  ensureStateMedia,
  syncLegacyPatch,
  reconcileMediaByPanels,
  mediaForPanel,
  setPanelMedia,
  addPanelMedia,
  removePanelMedia,
  movePanelMedia,
});

function getPanelMedia(stateValue, index = null) {
  return mediaModel.mediaForPanel(stateValue, index);
}

function normalizeStoredMediaState(stateValue) {
  if (!stateValue || typeof stateValue !== 'object') return stateValue;
  const source = stateValue.media || null;
  if (!source) return stateValue;
  return { ...stateValue, media: clone(source) };
}

function installMediaRuntimeCompatibility(panel) {
  if (!panel || panel.__mediaRuntimeCompatibilityInstalled) {
    return panel;
  }

  /*
   * Capture the original panel state API once.
   *
   * All media compatibility now passes through this single layer rather
   * than repeatedly wrapping the same functions.
   */
  const base = {
    getSession:
      typeof panel.getSession === "function"
        ? panel.getSession.bind(panel)
        : null,

    saveSession:
      typeof panel.saveSession === "function"
        ? panel.saveSession.bind(panel)
        : null,

    markUnsaved:
      typeof panel.markUnsaved === "function"
        ? panel.markUnsaved.bind(panel)
        : null,

    resetSession:
      typeof panel.resetSession === "function"
        ? panel.resetSession.bind(panel)
        : null,

    applyTemplate:
      typeof panel.applyTemplate === "function"
        ? panel.applyTemplate.bind(panel)
        : null,

    applyPreset:
      typeof panel.applyPreset === "function"
        ? panel.applyPreset.bind(panel)
        : null,

    presetData:
      typeof panel.presetData === "function"
        ? panel.presetData.bind(panel)
        : null,

    saveSelected:
      typeof panel.saveSelected === "function"
        ? panel.saveSelected.bind(panel)
        : null,
  };

  const normalizeState = (stateValue = {}) =>
    normalizeStoredMediaState(
      mediaModel.ensureStateMedia(stateValue || {})
    );

  if (base.getSession) {
    panel.getSession = (interaction) =>
      normalizeState(
        base.getSession(interaction)
      );
  }

  if (base.saveSession) {
    panel.saveSession = (interaction, stateValue) =>
      base.saveSession(
        interaction,
        normalizeState(stateValue)
      );
  }

  if (base.markUnsaved) {
    panel.markUnsaved = (interaction, stateValue) => {
      const previous =
        panel.getSession(interaction);

      const reconciled =
        mediaModel.reconcileMediaByPanels(
          previous,
          stateValue
        );

      return base.markUnsaved(
        interaction,
        normalizeState(reconciled)
      );
    };
  }

  if (base.resetSession) {
    panel.resetSession = (interaction) => {
      const result =
        base.resetSession(interaction);

      const normalized =
        normalizeState(result);

      return base.saveSession
        ? panel.saveSession(interaction, normalized)
        : normalized;
    };
  }

  if (base.applyTemplate) {
    panel.applyTemplate = (interaction, name) => {
      const result =
        base.applyTemplate(interaction, name);

      /*
       * Templates intentionally start with a fresh media model.
       * Legacy panel image fields are then migrated by normalization.
       */
      const normalized =
        normalizeState({
          ...result,
          media: undefined,
        });

      return base.saveSession
        ? panel.saveSession(interaction, normalized)
        : normalized;
    };
  }

  if (base.applyPreset) {
    panel.applyPreset = (
      interaction,
      name,
      preset = {}
    ) => {
      const storedMedia =
        preset?.media
          ? clone(preset.media)
          : null;

      const compatiblePreset =
        storedMedia
          ? {
              ...preset,
              media: clone(storedMedia),
            }
          : preset;

      const result =
        base.applyPreset(
          interaction,
          name,
          compatiblePreset
        );

      const normalized =
        normalizeState(
          storedMedia
            ? {
                ...result,
                media: clone(storedMedia),
              }
            : result
        );

      return base.saveSession
        ? panel.saveSession(interaction, normalized)
        : normalized;
    };
  }

  if (base.saveSelected) {
    panel.saveSelected = (
      stateValue,
      patch = {}
    ) => {
      let result =
        base.saveSelected(
          normalizeState(stateValue),
          patch
        );

      result =
        mediaModel.syncLegacyPatch(
          {
            ...result,
            media: stateValue?.media,
          },
          patch
        );

      if (
        [
          "image",
          "thumbnail",
          "authorIcon",
          "footerIcon",
        ].some(
          (key) =>
            patch &&
            patch[key]
        )
      ) {
        queuePersistentMediaImport({
          panels: [patch],
          media: result.media,
        });
      }

      return normalizeState(result);
    };
  }

  if (base.presetData) {
    panel.presetData = (stateValue) => {
      const normalized =
        normalizeState(stateValue);

      const preset = {
        ...(base.presetData(normalized) || {}),
        media: clone(normalized.media),
      };

      queuePersistentMediaImport(preset);

      return preset;
    };
  }

  panel.getPanelMedia = (
    stateValue,
    index = null
  ) =>
    mediaModel.mediaForPanel(
      normalizeState(stateValue),
      index
    );

  panel.setPanelMedia = (
    stateValue,
    index,
    panelMedia
  ) =>
    normalizeState(
      mediaModel.setPanelMedia(
        normalizeState(stateValue),
        index,
        panelMedia
      )
    );

  panel.mediaModel = mediaModel;

  /*
   * Keep old guards true so nothing elsewhere can accidentally reinstall
   * the retired compatibility layers.
   */
  panel.__mediaStorageNormalized = true;
  panel.__mediaPatched = true;
  panel.__persistentMediaPatched = true;
  panel.__canonicalMediaSessionsInstalled = true;
  panel.__mediaRuntimeCompatibilityInstalled = true;

  return panel;
}

function installStorageNormalization(panel) {
  return installMediaRuntimeCompatibility(panel);
}

function installStateCompatibility(panel) {
  return installMediaRuntimeCompatibility(panel);
}

function installPersistentMediaCompatibility(panel) {
  return installMediaRuntimeCompatibility(panel);
}

function queuePersistentMediaImport(presetLike) {
  persistPresetMedia('global', presetLike).then((results) => {
    const failed = results.filter((result) => !result.ok);
    if (failed.length) console.warn('[EmbedAssets] persistence import failed:', failed.map((result) => ({ url: String(result.url).slice(0, 120), error: result.error })));
  }).catch((error) => console.warn('[EmbedAssets] persistence import failed:', error?.message || error));
}


module.exports = {
  installMediaRuntimeCompatibility,
  ...mediaModel,
  mediaModel,
  clone,
  getPanelMedia,
  normalizeStoredMediaState,
  installStorageNormalization,
  installStateCompatibility,
  installPersistentMediaCompatibility,
  MAX_ASSET_BYTES,
  supportedPersistentType,
  stableSourceKey,
  getCachedAsset,
  saveCachedAsset,
  ensureAssetCached,
  persistPresetMedia,
};
