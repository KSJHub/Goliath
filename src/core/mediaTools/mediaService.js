'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { DISCORD_LIMITS, UPLOAD_LIMITS } = require('./mediaConfig');
const {
  assertGuildId,
  getToolDir,
  addAsset,
  readLibrary,
  removeAsset,
  findAsset,
} = require('./mediaLibrary');
const { createGif, getGifProcessorStatus } = require('./gifMaker/gifProcessor');
const { createEmoji, getEmojiProcessorStatus } = require('./emojiMaker/emojiProcessor');

const ALLOWED_TOOLS = new Set(['gif', 'emoji']);

function cleanFilename(filename = 'upload.bin') {
  const base = path.basename(String(filename || 'upload.bin'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90) || 'upload.bin';
}

function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Upload must be a base64 data URL.');

  const encoded = String(match[2] || '').replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Upload data could not be decoded.');
  }

  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    throw new Error('Upload data could not be decoded.');
  }

  if (!buffer.length || buffer.toString('base64') !== encoded) {
    throw new Error('Upload data could not be decoded.');
  }

  return {
    mimeType: String(match[1] || '').toLowerCase(),
    buffer,
  };
}

function extensionFor(filename, fallback = 'bin') {
  const ext = path.extname(cleanFilename(filename)).replace('.', '').toLowerCase();
  return ext || fallback;
}

function validateUpload(tool, upload, filename) {
  const limits = UPLOAD_LIMITS[tool];
  if (!limits) throw new Error('Unsupported media tool.');

  const ext = extensionFor(filename);
  if (!limits.mimeTypes.includes(upload.mimeType)) {
    throw new Error(`Unsupported ${tool} upload type: ${upload.mimeType || 'unknown'}.`);
  }

  if (!limits.extensions.includes(ext)) {
    throw new Error(`Unsupported ${tool} file extension: .${ext}.`);
  }

  if (upload.buffer.length > limits.maxBytes) {
    throw new Error(`${tool.toUpperCase()} upload is too large. Max upload size is ${Math.round(limits.maxBytes / 1024 / 1024)}MB.`);
  }

  return { ext, maxBytes: limits.maxBytes };
}

function validateOptions(tool, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {};

  if (tool === 'gif') {
    return {
      fps: Number(options.fps),
      width: Number(options.width),
      start: Number(options.start),
      duration: Number(options.duration),
    };
  }

  if (tool === 'emoji') {
    const preset = String(options.preset || 'emoji') === 'roleIcon' ? 'roleIcon' : 'emoji';
    const format = String(options.format || 'png').toLowerCase() === 'webp' ? 'webp' : 'png';
    const size = Number(options.size);
    return { preset, format, size };
  }

  return {};
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function publicAsset(asset) {
  if (!asset) return null;
  return {
    ...asset,
    path: undefined,
    inputPath: undefined,
  };
}

async function getMediaToolsStatus() {
  const processors = [
    await getGifProcessorStatus(),
    getEmojiProcessorStatus(),
  ];

  return {
    ok: processors.every((processor) => processor.available),
    checkedAt: new Date().toISOString(),
    processors,
    warnings: processors.filter((processor) => processor.warning).map((processor) => processor.warning),
    uploadLimits: UPLOAD_LIMITS,
    discordLimits: DISCORD_LIMITS,
  };
}

async function createMediaAsset(guildId, tool, payload = {}) {
  const cleanGuildId = assertGuildId(guildId);
  const cleanTool = String(tool || '').trim();
  if (!ALLOWED_TOOLS.has(cleanTool)) throw new Error('Unsupported media tool.');

  const upload = decodeDataUrl(payload.fileData);
  const originalName = cleanFilename(payload.filename || `${cleanTool}-upload`);
  const validated = validateUpload(cleanTool, upload, originalName);
  const safeOptions = validateOptions(cleanTool, payload.options || {});
  const id = makeId(cleanTool);

  const uploadDir = getToolDir(cleanGuildId, cleanTool, 'uploads');
  const outputDir = getToolDir(cleanGuildId, cleanTool, 'outputs');
  const inputPath = path.join(uploadDir, `${id}.${validated.ext}`);
  fs.writeFileSync(inputPath, upload.buffer);

  const outputExt = cleanTool === 'gif'
    ? 'gif'
    : (safeOptions.format === 'webp' ? 'webp' : 'png');
  const outputPath = path.join(outputDir, `${id}.${outputExt}`);

  let result;
  try {
    result = cleanTool === 'gif'
      ? await createGif({ inputPath, outputPath, options: safeOptions })
      : await createEmoji({ inputPath, outputPath, options: safeOptions });
  } catch (error) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }

  const stats = fs.statSync(outputPath);
  const asset = {
    id,
    tool: cleanTool,
    type: cleanTool === 'gif' ? 'gif' : String(safeOptions.preset || 'emoji'),
    name: String(payload.name || originalName).trim().slice(0, 80) || originalName,
    filename: path.basename(outputPath),
    originalName,
    mimeType: cleanTool === 'gif' ? 'image/gif' : `image/${outputExt}`,
    sizeBytes: stats.size,
    path: outputPath,
    inputPath,
    downloadUrl: `/api/media/${cleanGuildId}/assets/${id}/download`,
    discordReady: cleanTool === 'gif'
      ? stats.size <= DISCORD_LIMITS.gif.maxBytes
      : stats.size <= (safeOptions.preset === 'roleIcon' ? DISCORD_LIMITS.roleIcon.maxBytes : DISCORD_LIMITS.emoji.maxBytes),
    fallback: Boolean(result.fallback),
    warning: result.warning || null,
    metadata: {
      uploadMimeType: upload.mimeType,
      uploadBytes: upload.buffer.length,
      options: safeOptions,
      outputExt,
    },
  };

  const saved = addAsset(cleanGuildId, asset);
  return { asset: publicAsset(saved.asset), library: saved.library.assets.map(publicAsset) };
}

function listMediaAssets(guildId) {
  return readLibrary(guildId).assets.map(publicAsset);
}

function deleteMediaAsset(guildId, assetId) {
  const { asset, library } = removeAsset(guildId, String(assetId || ''));
  if (asset?.path && fs.existsSync(asset.path)) fs.unlinkSync(asset.path);
  if (asset?.inputPath && fs.existsSync(asset.inputPath)) fs.unlinkSync(asset.inputPath);
  return { asset: publicAsset(asset), library: library.assets.map(publicAsset) };
}

function resolveAssetDownload(guildId, assetId) {
  const asset = findAsset(guildId, String(assetId || ''));
  if (!asset?.path || !fs.existsSync(asset.path)) throw new Error('Media asset not found.');
  return asset;
}

module.exports = {
  getMediaToolsStatus,
  createMediaAsset,
  listMediaAssets,
  deleteMediaAsset,
  resolveAssetDownload,
};
