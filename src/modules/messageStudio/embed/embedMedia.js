'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fetch = require('node-fetch');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { getRuntimePaths } = require('../../../config/runtimePaths');
const { validatePanelMedia, statusIcon } = require('./embedValidation');

const MEDIA_SCHEMA_VERSION = 2;
const MAX_GALLERY_ITEMS = 10;
const MAX_FILES = 10;
const MAX_COMPONENTS_PER_ROW = 5;
const MAX_ACTION_ROWS = 5;
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

  const cached = getCachedAsset(guildId, url);
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
  const placement = String(value?.placement || '').toLowerCase() === 'above' ? 'above' : 'below';
  const alignment = ['left', 'center', 'right'].includes(String(value?.alignment || '').toLowerCase())
    ? String(value.alignment).toLowerCase()
    : 'left';
  const size = ['small', 'medium', 'large'].includes(String(value?.size || '').toLowerCase())
    ? String(value.size).toLowerCase()
    : 'large';
  return {
    source: cleanSource(source),
    alt: cleanString(value?.alt || value?.description || '', 1024),
    spoiler: value?.spoiler === true,
    type: ['auto', 'image', 'video'].includes(String(value?.type || '').toLowerCase()) ? String(value.type).toLowerCase() : 'auto',
    headerType: ['auto', 'text', 'gif', 'image'].includes(String(value?.headerType || '').toLowerCase())
      ? String(value.headerType).toLowerCase()
      : 'auto',
    placement,
    alignment,
    size,
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

function installStorageNormalization(panel) {
  if (!panel || panel.__mediaStorageNormalized) return panel;
  if (typeof panel.getSession === 'function') {
    const originalGetSession = panel.getSession.bind(panel);
    panel.getSession = (interaction) => normalizeStoredMediaState(originalGetSession(interaction));
  }
  if (typeof panel.saveSession === 'function') {
    const originalSaveSession = panel.saveSession.bind(panel);
    panel.saveSession = (interaction, stateValue) => originalSaveSession(interaction, normalizeStoredMediaState(stateValue));
  }
  if (typeof panel.presetData === 'function') {
    const originalPresetData = panel.presetData.bind(panel);
    panel.presetData = (stateValue) => {
      const normalized = normalizeStoredMediaState(stateValue);
      const preset = originalPresetData(normalized) || {};
      const storedMedia = clone(preset.media || normalized?.media, null);
      const output = { ...preset };
      if (storedMedia) output.media = storedMedia;
      return output;
    };
  }
  if (typeof panel.applyPreset === 'function') {
    const originalApplyPreset = panel.applyPreset.bind(panel);
    panel.applyPreset = (interaction, name, preset = {}) => {
      const source = preset?.media || null;
      const compatiblePreset = source ? { ...preset, media: clone(source) } : preset;
      const result = originalApplyPreset(interaction, name, compatiblePreset);
      return normalizeStoredMediaState(source ? { ...result, media: clone(source) } : result);
    };
  }
  panel.__mediaStorageNormalized = true;
  return panel;
}

function installStateCompatibility(panel) {
  if (!panel || panel.__mediaPatched) return panel;
  if (typeof panel.getSession === 'function') {
    const originalGetSession = panel.getSession.bind(panel);
    panel.getSession = (interaction) => mediaModel.ensureStateMedia(originalGetSession(interaction));
  }
  if (typeof panel.saveSession === 'function') {
    const originalSaveSession = panel.saveSession.bind(panel);
    panel.saveSession = (interaction, stateValue) => originalSaveSession(interaction, mediaModel.ensureStateMedia(stateValue));
  }
  if (typeof panel.markUnsaved === 'function') {
    const originalMarkUnsaved = panel.markUnsaved.bind(panel);
    panel.markUnsaved = (interaction, stateValue) => {
      const previous = panel.getSession(interaction);
      return originalMarkUnsaved(interaction, mediaModel.reconcileMediaByPanels(previous, stateValue));
    };
  }
  if (typeof panel.resetSession === 'function') {
    const originalResetSession = panel.resetSession.bind(panel);
    panel.resetSession = (interaction) => {
      const result = originalResetSession(interaction);
      return panel.saveSession(interaction, mediaModel.ensureStateMedia(result));
    };
  }
  if (typeof panel.applyTemplate === 'function') {
    const originalApplyTemplate = panel.applyTemplate.bind(panel);
    panel.applyTemplate = (interaction, name) => {
      const result = originalApplyTemplate(interaction, name);
      return panel.saveSession(interaction, mediaModel.ensureStateMedia({ ...result, media: undefined }));
    };
  }
  if (typeof panel.applyPreset === 'function') {
    const originalApplyPreset = panel.applyPreset.bind(panel);
    panel.applyPreset = (interaction, name, preset) => {
      const result = originalApplyPreset(interaction, name, preset);
      const restored = mediaModel.ensureStateMedia({ ...result, media: preset?.media || result?.media });
      return panel.saveSession(interaction, restored);
    };
  }
  panel.getPanelMedia = (stateValue, index = null) => mediaModel.mediaForPanel(stateValue, index);
  panel.setPanelMedia = (stateValue, index, media) => mediaModel.setPanelMedia(stateValue, index, media);
  panel.mediaModel = mediaModel;
  panel.__mediaPatched = true;
  return panel;
}

function queuePersistentMediaImport(presetLike) {
  persistPresetMedia('global', presetLike).then((results) => {
    const failed = results.filter((result) => !result.ok);
    if (failed.length) console.warn('[EmbedAssets] persistence import failed:', failed.map((result) => ({ url: String(result.url).slice(0, 120), error: result.error })));
  }).catch((error) => console.warn('[EmbedAssets] persistence import failed:', error?.message || error));
}

function installPersistentMediaCompatibility(panel) {
  if (!panel || panel.__persistentMediaPatched || typeof panel.saveSelected !== 'function') return panel;
  const originalSaveSelected = panel.saveSelected.bind(panel);
  panel.saveSelected = (stateValue, patch = {}) => {
    let result = originalSaveSelected(stateValue, patch);
    result = mediaModel.syncLegacyPatch({ ...result, media: stateValue?.media }, patch);
    if (['image', 'thumbnail', 'authorIcon', 'footerIcon'].some((key) => patch && patch[key])) {
      queuePersistentMediaImport({ panels: [patch], media: result.media });
    }
    return result;
  };
  if (typeof panel.presetData === 'function') {
    const originalPresetData = panel.presetData.bind(panel);
    panel.presetData = (stateValue) => {
      const safeState = mediaModel.ensureStateMedia(stateValue);
      const preset = { ...originalPresetData(safeState), media: safeState.media };
      queuePersistentMediaImport(preset);
      return preset;
    };
  }
  panel.__persistentMediaPatched = true;
  return panel;
}

function enforceLimits(rows = []) {
  return rows.filter(Boolean).slice(0, MAX_ACTION_ROWS).map((row) => {
    if (!Array.isArray(row?.components) || row.components.length <= MAX_COMPONENTS_PER_ROW) return row;
    row.components = row.components.slice(0, MAX_COMPONENTS_PER_ROW);
    return row;
  });
}
function resolveSource(panel, source, interaction) {
  const raw = String(source || '').trim();
  if (!raw) return '';
  try {
    const resolved = typeof panel.replaceVars === 'function' ? panel.replaceVars(raw, interaction) : raw;
    const url = new URL(String(resolved || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch { return ''; }
}
function textInput(id, label, style, value = '', maxLength = 4000) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(false).setMaxLength(maxLength).setValue(String(value || '').slice(0, maxLength));
}

function labelledTextInput(id, style, value = '', maxLength = 4000) {
  return new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(false).setMaxLength(maxLength).setValue(String(value || '').slice(0, maxLength));
}
function componentId(component) { return component?.data?.custom_id || component?.customId || null; }
function componentById(rows, id) {
  for (const row of rows) {
    const component = Array.isArray(row?.components) ? row.components.find((entry) => componentId(entry) === id) : null;
    if (component) return component;
  }
  return null;
}
function rowFromComponents(...components) {
  const safe = components.filter(Boolean).slice(0, MAX_COMPONENTS_PER_ROW);
  return safe.length ? new ActionRowBuilder().addComponents(...safe) : null;
}

function installUploadModals(panel) {
  if (!panel || panel.__mediaUploadModalsBound) return panel;
  panel.mediaAddModal = () => new ModalBuilder()
    .setCustomId('embed:media-add-save')
    .setTitle('Add Media / File')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Source URL / Variable')
        .setDescription('Optional. URL or variable. Images/videos become gallery media; other URLs become attached files.')
        .setTextInputComponent(
          labelledTextInput('source', TextInputStyle.Short, '', 2000)
            .setPlaceholder('https://... or {{variable}}')
        ),
      new LabelBuilder()
        .setLabel('Upload Media / File')
        .setDescription('Optional. Up to 10 files. Images/videos become gallery media; other files become attachments.')
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId('media_files')
            .setMinValues(0)
            .setMaxValues(10)
            .setRequired(false)
        ),
      new LabelBuilder()
        .setLabel('Display name / Alt text')
        .setDescription('Optional. Alt text for gallery media or display filename for an attached file.')
        .setTextInputComponent(
          labelledTextInput('display_name', TextInputStyle.Short, '', 256)
            .setPlaceholder('Optional')
        ),
      new LabelBuilder()
        .setLabel('Description')
        .setDescription('Optional. Adds descriptive information when supported.')
        .setTextInputComponent(
          labelledTextInput('description', TextInputStyle.Paragraph, '', 1024)
            .setPlaceholder('Optional')
        ),
    );
  panel.galleryItemModal = (state, index = null) => {
    const media = getPanelMedia(state);
    const item = Number.isInteger(index) ? (media.gallery[index] || {}) : {};
    const customId = Number.isInteger(index) ? `embed:media-gallery-save:${index}` : 'embed:media-gallery-save-new';
    return new ModalBuilder().setCustomId(customId).setTitle(Number.isInteger(index) ? 'Edit Gallery Media' : 'Add Gallery Media').addComponents(
      new ActionRowBuilder().addComponents(textInput('source', 'Media URL / variable', TextInputStyle.Short, item.source || '')),
      new ActionRowBuilder().addComponents(textInput('alt', 'Alt text / description', TextInputStyle.Paragraph, item.alt || '', 1024)),
    );
  };
  panel.fileItemModal = (state, index = null) => {
    const media = getPanelMedia(state);
    const item = Number.isInteger(index) ? (media.files[index] || {}) : {};
    const customId = Number.isInteger(index) ? `embed:media-file-save:${index}` : 'embed:media-file-save-new';
    return new ModalBuilder().setCustomId(customId).setTitle(Number.isInteger(index) ? 'Edit Attached File' : 'Add Attached File').addComponents(
      new ActionRowBuilder().addComponents(textInput('source', 'File URL / variable', TextInputStyle.Short, item.source || '')),
      new ActionRowBuilder().addComponents(textInput('name', 'Display filename', TextInputStyle.Short, item.name || '', 256)),
      new ActionRowBuilder().addComponents(textInput('description', 'File description', TextInputStyle.Paragraph, item.description || '', 1024)),
    );
  };

  /*
   * PASS 3F — EDIT MEDIA PANEL
   *
   * Keep the main Media Manager clean. Detailed controls for the selected
   * gallery item live here instead.
   */
  panel.buildEditMediaPanel = (interaction) => {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);

    const requestedIndex = Number.isInteger(state.selectedMediaIndex)
      ? state.selectedMediaIndex
      : null;

    const index = media.gallery.length
      ? Math.max(0, Math.min(requestedIndex ?? 0, media.gallery.length - 1))
      : null;

    const item = index == null ? null : media.gallery[index];

    if (!item) {
      return panel.buildMediaManagerPanel(
        interaction,
        panel.memberName(interaction)
      );
    }

    const type = ['auto', 'image', 'video'].includes(item.type)
      ? item.type
      : 'auto';

    const placement = item.placement === 'above'
      ? 'Above Content'
      : 'Below Content';

    const headerType = ['auto', 'text', 'gif', 'image'].includes(
      String(item.headerType || '').toLowerCase()
    )
      ? String(item.headerType).toLowerCase()
      : 'auto';

    const headerTypeLabel = {
      auto: 'Auto',
      text: 'Text',
      gif: 'GIF',
      image: 'Image',
    }[headerType];

    const selectedSize = ['small', 'medium', 'large'].includes(String(item?.size || '').toLowerCase())
      ? String(item.size).toLowerCase()
      : 'large';


    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('✏️ Edit Media')
          .setDescription([
            `**Gallery item:** ${index + 1} / ${media.gallery.length}`,
            `**Type:** ${
              type === 'auto'
                ? 'Auto Detect'
                : type === 'image'
                  ? 'Image'
                  : 'Video'
            }`,
            `**Placement:** ${placement}`,
            '',
            '**Header Type**',
            'Controls how this item behaves when used as the panel header.',
            '**Auto** detects the correct header type automatically. **Text** uses the panel title only. **GIF** forces an animated graphic header. **Image** forces a static graphic header.',
            'Use **Auto** unless you need to override Goliath’s detection.',
            `**Current Header Type:** ${headerTypeLabel}`,
            `**Spoiler:** ${item.spoiler ? 'On' : 'Off'}`,
          ].join('\n')),
      ],
      components: enforceLimits([
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('embed:media-edit-details')
            .setLabel('✏️ Edit Details')
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId('embed:header-type-cycle')
            .setLabel(`🏷️ Type: ${headerTypeLabel}`)
            .setStyle(ButtonStyle.Secondary)
        ),

        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('embed:media-spoiler:off')
            .setLabel('👁️ Normal')
            .setStyle(
              item.spoiler
                ? ButtonStyle.Secondary
                : ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId('embed:media-spoiler:on')
            .setLabel('🙈 Spoiler')
            .setStyle(
              item.spoiler
                ? ButtonStyle.Primary
                : ButtonStyle.Secondary
            )
        ),

        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('embed:media-size:small')
            .setLabel('🔹 Small')
            .setStyle(selectedSize === 'small' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed:media-size:medium')
            .setLabel('🔷 Medium')
            .setStyle(selectedSize === 'medium' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed:media-size:large')
            .setLabel('🔶 Large')
            .setStyle(selectedSize === 'large' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        ),

        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('embed:media-duplicate')
            .setLabel('📑 Duplicate')
            .setStyle(ButtonStyle.Success)
            .setDisabled(media.gallery.length >= MAX_GALLERY_ITEMS)
        ),

        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('embed:media-edit-back')
            .setLabel('⬅️ Back')
            .setStyle(ButtonStyle.Secondary)
        ),
      ]),
    };
  };

  panel.__mediaUploadModalsBound = true;
  return panel;
}

function installMediaOptionsUi(panel) {
  if (!panel || panel.__mediaOptionsUiBound) return panel;
  panel.buildMediaOptionsPanel = (interaction) => {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const index = media.gallery.length ? Math.max(0, Math.min(Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : 0, media.gallery.length - 1)) : null;
    const item = index == null ? null : media.gallery[index];
    if (!item) return panel.buildMediaManagerPanel(interaction, panel.memberName(interaction));
    const type = ['auto', 'image', 'video'].includes(item.type) ? item.type : 'auto';
    const placement = item.placement === 'above' ? 'above' : 'below';
    return {
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ Media Options').setDescription([
        `**Gallery item:** ${index + 1} / ${media.gallery.length}`,
        `**Type handling:** ${type === 'auto' ? 'Auto detect' : type === 'image' ? 'Image' : 'Video'}`,
        `**Placement:** ${placement === 'above' ? 'Above Content' : 'Below Content'}`,
        `**Spoiler:** ${item.spoiler ? 'On' : 'Off'}`,
        '',
        'Use placement to position media before or after the panel text. Duplicate Media copies the complete selected item, including its source and current settings.',
      ].join('\n'))],
      components: enforceLimits([
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:media-type:auto').setLabel('✨ Auto Detect').setStyle(type === 'auto' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('embed:media-type:image').setLabel('🖼️ Image').setStyle(type === 'image' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('embed:media-type:video').setLabel('🎬 Video').setStyle(type === 'video' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:media-spoiler:off').setLabel('👁️ Normal').setStyle(item.spoiler ? ButtonStyle.Secondary : ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('embed:media-spoiler:on').setLabel('🙈 Spoiler').setStyle(item.spoiler ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:media-placement:above').setLabel('⬆️ Above Content').setStyle(placement === 'above' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('embed:media-placement:below').setLabel('⬇️ Below Content').setStyle(placement === 'below' ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:media-duplicate').setLabel('📑 Duplicate Media').setStyle(ButtonStyle.Success).setDisabled(media.gallery.length >= MAX_GALLERY_ITEMS),
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('embed:media-options-back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)),
      ]),
    };
  };
  panel.buildFileOptionsPanel = (interaction) => {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const index = media.files.length ? Math.max(0, Math.min(Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : 0, media.files.length - 1)) : null;
    const item = index == null ? null : media.files[index];
    if (!item) return panel.buildMediaManagerPanel(interaction, panel.memberName(interaction));
    const source = resolveSource(panel, item.source, interaction);
    return {
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ File Options').setDescription([
        `**File:** ${index + 1} / ${media.files.length}`,
        `**Name:** ${item.name || 'Automatic filename'}`,
        `**Spoiler:** ${item.spoiler ? 'On' : 'Off'}`,
        item.description ? `**Description:** ${String(item.description).slice(0, 900)}` : '**Description:** Not set',
        '',
        source ? `[Open selected file](${source})` : 'The source will be resolved when the message is sent.',
        '',
        'Use the buttons below to control whether Discord hides the attachment behind a spoiler warning.',
      ].join('\n').slice(0, 4096))],
      components: enforceLimits([
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:file-spoiler:off').setLabel('👁️ Normal').setStyle(item.spoiler ? ButtonStyle.Secondary : ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('embed:file-spoiler:on').setLabel('🙈 Spoiler').setStyle(item.spoiler ? ButtonStyle.Primary : ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('embed:file-options-back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)),
      ]),
    };
  };
  panel.__mediaOptionsUiBound = true;
  return panel;
}

function mediaManagerButton(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}
function mediaManagerSourceLabel(value, fallback = 'Not set') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'Media');
    return name.length > 42 ? `${name.slice(0, 39)}...` : name;
  } catch {
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }
}
function mediaManagerClone(value, fallback = null) {
  try { return JSON.parse(JSON.stringify(value ?? fallback)); } catch { return fallback; }
}
function validMediaAlignment(value) {
  const alignment = String(value || '').toLowerCase();
  return ['left', 'center', 'right'].includes(alignment) ? alignment : null;
}
function mediaSourceKey(item) {
  return String(item?.source || '').trim();
}

function installMediaManagerUi(panel) {
  if (!panel || panel.__mediaManagerUiBound || typeof panel.buildMediaManagerPanel !== 'function') return panel;
  if (!panel.__panelLocalMediaWritePatched && typeof panel.setPanelMedia === 'function') {
    panel.setPanelMedia = (stateValue = {}, index, mediaValue = {}) => {
      const panels = Array.isArray(stateValue?.panels) ? stateValue.panels : [];
      const existing = stateValue?.media || {};
      const existingPanels = Array.isArray(existing?.panels) ? existing.panels : [];
      const length = Math.max(panels.length, existingPanels.length, 1);
      const selected = Math.max(0, Math.min(Number(index) || 0, length - 1));
      const mediaPanels = [];

      for (let n = 0; n < length; n += 1) {
        if (n === selected) {
          mediaPanels.push(media.mediaModel.normalizePanelMedia(mediaValue, {}));
          continue;
        }
        if (existingPanels[n]) {
          mediaPanels.push(media.mediaModel.normalizePanelMedia(existingPanels[n], {}));
          continue;
        }
        mediaPanels.push(media.mediaModel.normalizePanelMedia({}, panels[n] || {}));
      }

      return {
        ...stateValue,
        media: {
          version: media.mediaModel.MEDIA_SCHEMA_VERSION,
          panels: mediaPanels,
        },
      };
    };
    panel.__panelLocalMediaWritePatched = true;
  }

  if (!panel.__mediaSessionMirrorPatched && typeof panel.saveSession === 'function') {
    const originalSaveSession = panel.saveSession.bind(panel);
    panel.saveSession = (interaction, stateValue) => {
      if (!stateValue || typeof stateValue !== 'object') return originalSaveSession(interaction, stateValue);
      const authoritative = stateValue.media || null;
      if (!authoritative) return originalSaveSession(interaction, stateValue);

      const previous = typeof panel.getSession === 'function' ? panel.getSession(interaction) : null;
      const previousPanels = Array.isArray(previous?.media?.panels) ? previous.media.panels : [];
      const incomingMap = stateValue.mediaAlignment && typeof stateValue.mediaAlignment === 'object'
        ? stateValue.mediaAlignment
        : {};
      const canonicalMedia = typeof mediaManagerClone === 'function' ? mediaManagerClone(authoritative) : clone(authoritative, {});
      const mediaPanels = Array.isArray(canonicalMedia?.panels) ? canonicalMedia.panels : [];
      const rebuiltMap = {};

      for (let panelIndex = 0; panelIndex < mediaPanels.length; panelIndex += 1) {
        const gallery = Array.isArray(mediaPanels[panelIndex]?.gallery) ? mediaPanels[panelIndex].gallery : [];
        const previousGallery = Array.isArray(previousPanels[panelIndex]?.gallery) ? previousPanels[panelIndex].gallery : [];

        for (let itemIndex = 0; itemIndex < gallery.length; itemIndex += 1) {
          const key = `${panelIndex}:${itemIndex}`;
          const item = gallery[itemIndex];
          let alignment = validMediaAlignment(item?.alignment) || 'left';
          const mapped = validMediaAlignment(incomingMap[key]);
          const sameSlotPrevious = previousGallery[itemIndex];
          const sameSourceInSlot = mediaSourceKey(sameSlotPrevious) && mediaSourceKey(sameSlotPrevious) === mediaSourceKey(item);
          const previousAlignment = sameSourceInSlot ? validMediaAlignment(sameSlotPrevious?.alignment) : null;

          // Editing the URL/alt modal historically rebuilt an item without its alignment.
          // If the same media remains in the same slot and the compatibility map still
          // carries its prior alignment, preserve that prior choice. Reordered items keep
          // their own canonical alignment instead, preventing index-keyed map corruption.
          if (sameSourceInSlot && previousAlignment && mapped === previousAlignment && alignment !== previousAlignment) {
            alignment = previousAlignment;
          }

          item.alignment = alignment;
          rebuiltMap[key] = alignment;
        }
      }

      const storedMedia = typeof mediaManagerClone === 'function' ? mediaManagerClone(canonicalMedia) : clone(canonicalMedia, {});
      return originalSaveSession(interaction, {
        ...stateValue,
        media: storedMedia,
        mediaAlignment: rebuiltMap,
      });
    };
    panel.__mediaSessionMirrorPatched = true;
  }


  function validationSummary(interaction) {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const report = validatePanelMedia(media);
    const lines = ['**Media status**'];
    if (media.thumbnail?.source) lines.push(`${statusIcon(report.thumbnail.status)} Thumbnail — ${report.thumbnail.message}`);
    for (const entry of report.gallery) {
      const placement = media.gallery?.[entry.index]?.placement === 'above' ? 'Above Content' : 'Below Content';
      lines.push(`${statusIcon(entry.status)} Gallery ${entry.index + 1} — ${entry.kind === 'auto' ? 'media' : entry.kind} — ${placement} — ${entry.message}`);
    }
    for (const entry of report.files) lines.push(`${statusIcon(entry.status)} File ${entry.index + 1} — ${entry.kind === 'auto' ? 'file' : entry.kind} — ${entry.message}`);
    if (!media.thumbnail?.source && !report.gallery.length && !report.files.length) lines.push('➖ No media configured yet.');
    lines.push(`Ready: **${report.ready}** • Warnings: **${report.warnings}** • Invalid: **${report.invalid}**`);
    return lines.join('\n').slice(0, 1500);
  }
  function visualPreview(interaction) {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const selected = Number.isInteger(state.selectedMediaIndex) ? media.gallery?.[state.selectedMediaIndex] : null;
    const selectedSource = resolveSource(panel, selected?.source, interaction);
    const thumbnailSource = resolveSource(panel, media.thumbnail?.source, interaction);
    const selectedType = String(selected?.type || 'auto').toLowerCase();
    const placement = selected?.placement === 'above' ? 'Above Content' : 'Below Content';
    if (selected && selectedType === 'video') {
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🎬 Selected Video Preview • ${placement}`);
      if (selectedSource) embed.setDescription(`[Open selected video](${selectedSource})${selected.alt ? `\n\n${String(selected.alt).slice(0, 800)}` : ''}`);
      else embed.setDescription('The selected video uses a variable or source that cannot be previewed here yet. It will be resolved when the message is sent.');
      return embed;
    }
    if (selectedSource) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🖼️ Selected Media Preview • ${placement}`)
        .setDescription(
          selected?.alt
            ? String(selected.alt).slice(0, 800)
            : 'Selected gallery media preview.'
        )
        .setImage(selectedSource);
      return embed;
    }
    if (thumbnailSource) return new EmbedBuilder().setColor(0x5865F2).setTitle('🖼️ Thumbnail Preview').setImage(thumbnailSource);
    return null;
  }
  function filePreview(interaction) {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const index = media.files.length ? Math.max(0, Math.min(Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : 0, media.files.length - 1)) : null;
    if (index == null) return null;
    const file = media.files[index];
    const source = resolveSource(panel, file.source, interaction);
    const lines = [`**File ${index + 1} of ${media.files.length}**`, `**Name:** ${file.name || 'Automatic filename'}`, `**Spoiler:** ${file.spoiler ? 'On' : 'Off'}`];
    if (file.description) lines.push(`**Description:** ${String(file.description).slice(0, 800)}`);
    if (source) lines.push(`[Open selected file](${source})`);
    else lines.push('The file source uses a variable or cannot be previewed here yet. It will be resolved when the message is sent.');
    return new EmbedBuilder().setColor(0x5865F2).setTitle('📎 Selected File').setDescription(lines.join('\n'));
  }

  panel.buildMediaManagerPanel = (interaction, who = 'Unknown User', stateOverride = null) => {
    const state = stateOverride && typeof stateOverride === 'object'
      ? stateOverride
      : panel.getSession(interaction);
    const panelMedia = media.getPanelMedia(state);
    const requestedGalleryIndex = Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : null;
    const galleryIndex = panelMedia.gallery.length ? Math.max(0, Math.min(requestedGalleryIndex ?? 0, panelMedia.gallery.length - 1)) : null;
    const selectedMedia = galleryIndex == null ? null : panelMedia.gallery[galleryIndex];
    const aboveCount = panelMedia.gallery.filter((item) => item?.placement === 'above').length;
    const belowCount = panelMedia.gallery.length - aboveCount;
    const placementLabel = (item) => item?.placement === 'above' ? '⬆️ Above Content' : '⬇️ Below Content';
    const rows = [];

    if (panelMedia.gallery.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('embed:media-gallery-select').setPlaceholder('🎞️ Select media item').addOptions(
          panelMedia.gallery.slice(0, 25).map((item, index) => ({
            label: `${index + 1}. ${panel.trim(item.alt || mediaManagerSourceLabel(item.source, 'Media item'), 80)}`,
            value: String(index),
            description: panel.trim(`${item.type || 'auto'} • ${item.placement === 'above' ? 'Above Content' : 'Below Content'} • ${validMediaAlignment(item.alignment) === 'center' ? 'Centre' : (validMediaAlignment(item.alignment) || 'left').replace(/^./, (c) => c.toUpperCase())}${item.spoiler ? ' • spoiler' : ''}`, 100),
            default: galleryIndex === index,
          }))
        )
      ));
    }

    rows.push(new ActionRowBuilder().addComponents(
      mediaManagerButton('embed:media-add', '➕ Add Media / File', ButtonStyle.Success, panelMedia.gallery.length >= media.mediaModel.MAX_GALLERY_ITEMS && panelMedia.files.length >= media.mediaModel.MAX_FILES),
      mediaManagerButton('embed:media-gallery-edit', '✏️ Edit', ButtonStyle.Primary, galleryIndex == null),
      mediaManagerButton('embed:media-gallery-remove', '🗑️ Remove', ButtonStyle.Danger, galleryIndex == null),
      mediaManagerButton('embed:media-gallery-up', '⬆️ Up', ButtonStyle.Secondary, galleryIndex == null || galleryIndex <= 0),
      mediaManagerButton('embed:media-gallery-down', '⬇️ Down', ButtonStyle.Secondary, galleryIndex == null || galleryIndex >= panelMedia.gallery.length - 1)
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaManagerButton('embed:media-placement:above', '⬆️ Above Content', selectedMedia?.placement === 'above' ? ButtonStyle.Success : ButtonStyle.Secondary, galleryIndex == null),
      mediaManagerButton('embed:media-placement:below', '⬇️ Below Content', selectedMedia?.placement === 'below' ? ButtonStyle.Success : ButtonStyle.Secondary, galleryIndex == null),
      mediaManagerButton('embed:media-thumbnail', panelMedia.thumbnail?.source ? '🖼️ Thumbnail ✓' : '🖼️ Thumbnail', ButtonStyle.Primary)
    ));

    const canonicalAlignment = validMediaAlignment(selectedMedia?.alignment);
    const alignmentMap = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {};
    const alignmentKey = galleryIndex == null ? null : `${Math.max(0, Number(state.selectedPanelIndex) || 0)}:${galleryIndex}`;
    const selectedAlignment = canonicalAlignment || validMediaAlignment(alignmentMap[alignmentKey]) || 'left';
    const alignmentLabel = selectedAlignment === 'center' ? '↔️ Centre' : selectedAlignment === 'right' ? '➡️ Right' : '⬅️ Left';

    rows.push(new ActionRowBuilder().addComponents(
      mediaManagerButton('embed:media-align:left', '⬅️ Left', selectedAlignment === 'left' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null),
      mediaManagerButton('embed:media-align:center', '↔️ Centre', selectedAlignment === 'center' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null),
      mediaManagerButton('embed:media-align:right', '➡️ Right', selectedAlignment === 'right' ? ButtonStyle.Primary : ButtonStyle.Secondary, galleryIndex == null)
    ));

    rows.push(new ActionRowBuilder().addComponents(
      mediaManagerButton('embed:builder', '⬅️ Back'),
      mediaManagerButton('embed:settings', '⚙️ Settings'),
      mediaManagerButton('embed:helpers', '📖 Variables')
    ));

    const summary = [
      `Editing panel **${state.selectedPanelIndex + 1}/${state.panels.length}**`, '',
      `⬆️ **Above Content** — ${aboveCount}`,
      `⬇️ **Below Content** — ${belowCount}`,
      `🖼️ **Thumbnail** — ${panelMedia.thumbnail?.source ? 'Configured' : 'Not set'}`,
      `📎 **Files** — ${panelMedia.files.length}/${media.mediaModel.MAX_FILES}`, '',
      'Images, animated GIFs and supported videos can be placed independently above or below the panel content.',
    ];

    if (selectedMedia) {
      summary.push('',
        `**Selected media:** ${mediaManagerSourceLabel(selectedMedia.alt || selectedMedia.source, `Item ${galleryIndex + 1}`)}`,
        `**Placement:** ${placementLabel(selectedMedia)}`,
        `**Alignment:** ${alignmentLabel}`,
        `**Type:** ${selectedMedia.type || 'auto'}`,
        `**Spoiler:** ${selectedMedia.spoiler ? 'On' : 'Off'}`
      );
    } else if (!panelMedia.thumbnail?.source && !panelMedia.gallery.length && !panelMedia.files.length) {
      summary.push('', 'No media configured for this panel. Media on other panels is unaffected.');
    }

    const validation = validationSummary(interaction);
    summary.push('', validation);
    const embeds = [panel.simplePanel('🖼️ Media Manager', summary.join('\n'), state, who)];
    const preview = visualPreview(interaction);
    const selectedFile = filePreview(interaction);
    if (preview && embeds.length < 10) embeds.push(preview);
    if (selectedFile && embeds.length < 10) embeds.push(selectedFile);
    return {
      embeds,
      components: enforceLimits(rows),
    };
  };


  panel.buildMediaManager = panel.buildMediaManagerPanel;
  panel.validatePanelMedia = validatePanelMedia;
  panel.EMBED_COMPONENT_LIMITS = Object.freeze({ maxComponentsPerRow: MAX_COMPONENTS_PER_ROW, maxActionRows: MAX_ACTION_ROWS });
  panel.__mediaManagerUiBound = true;
  return panel;
}

function installThumbnailUi(panel) {
  if (!panel || panel.__thumbnailMediaUiBound) return panel;
  panel.thumbnailUploadModal = () => new ModalBuilder().setCustomId('embed:thumbnail-upload-save').setTitle('Upload Thumbnail').addLabelComponents(
    new LabelBuilder().setLabel('Thumbnail image').setDescription('Upload one image. GIF and other Discord-supported image formats are preserved.').setFileUploadComponent(
      new FileUploadBuilder().setCustomId('thumbnail_file').setMinValues(1).setMaxValues(1).setRequired(true),
    ),
  );
  panel.buildThumbnailOptionsPanel = (interaction) => {
    const state = panel.getSession(interaction);
    const media = getPanelMedia(state);
    const thumbnail = media.thumbnail || { source: '', alt: '' };
    const source = resolveSource(panel, thumbnail.source, interaction);
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🖼️ Thumbnail').setDescription([
      '**Thumbnail settings**',
      `**Source:** ${thumbnail.source ? String(thumbnail.source).slice(0, 500) : 'Not set'}`,
      `**Alt text:** ${thumbnail.alt ? String(thumbnail.alt).slice(0, 700) : 'Not set'}`,
      '',
      'You can use a direct HTTPS image URL, an Embed Studio variable, or upload the thumbnail directly.',
    ].join('\n'));
    if (source) embed.setThumbnail(source);
    return {
      embeds: [embed],
      components: enforceLimits([
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('embed:thumbnail-edit').setLabel('✏️ Edit URL / Alt').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('embed:thumbnail-upload').setLabel('📤 Upload Thumbnail').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('embed:thumbnail-clear').setLabel('🗑️ Clear').setStyle(ButtonStyle.Danger).setDisabled(!thumbnail.source),
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('embed:thumbnail-back').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)),
      ]),
    };
  };
  panel.__thumbnailMediaUiBound = true;
  return panel;
}

module.exports = {
  ...mediaModel,
  mediaModel,
  clone,
  getPanelMedia,
  normalizeStoredMediaState,
  installStorageNormalization,
  installStateCompatibility,
  installPersistentMediaCompatibility,
  installUploadModals,
  installMediaOptionsUi,
  installMediaManagerUi,
  installThumbnailUi,
  MAX_ASSET_BYTES,
  supportedPersistentType,
  stableSourceKey,
  getCachedAsset,
  saveCachedAsset,
  ensureAssetCached,
  persistPresetMedia,
};
