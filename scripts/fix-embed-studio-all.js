'use strict';

const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(path, oldText, newText) {
  const text = read(path);
  if (!text.includes(oldText)) throw new Error(`Expected block not found in ${path}: ${oldText.slice(0, 80)}`);
  write(path, text.replace(oldText, newText));
}

// Front page: Build together, then Review -> Test -> Deploy -> Update.
{
  const path = 'src/modules/messageStudio/embed/embedPanel.js';
  const text = read(path);
  const startMarker = '      /*\n       * PRIMARY WORKFLOW\n       */';
  const endMarker = '      /*\n       * NAVIGATION\n       */';
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Embed Studio workflow block not found');
  const block = `      /*\n       * BUILD WORKFLOW\n       */\n      new ActionRowBuilder().addComponents(\n        new ButtonBuilder().setCustomId("embed:builder").setLabel("Builder").setEmoji("🛠️").setStyle(ButtonStyle.Primary),\n        new ButtonBuilder().setCustomId("embed:panels").setLabel(\`Panels (\${panels.length})\`).setEmoji("🧩").setStyle(ButtonStyle.Primary),\n        new ButtonBuilder().setCustomId("embed:presets").setLabel("Presets").setEmoji("💾").setStyle(ButtonStyle.Primary)\n      ),\n\n      /*\n       * CHECK / PUBLISH WORKFLOW\n       */\n      new ActionRowBuilder().addComponents(\n        new ButtonBuilder().setCustomId("embed:readiness").setLabel(report.ready ? "Ready" : "Review").setEmoji(report.ready ? "✅" : "⚠️").setStyle(report.ready ? ButtonStyle.Success : ButtonStyle.Secondary),\n        new ButtonBuilder().setCustomId("embed:test-send").setLabel("Test Send").setEmoji("🧪").setStyle(ButtonStyle.Secondary).setDisabled(!report.ready),\n        new ButtonBuilder().setCustomId("embed:use").setLabel("Deploy New").setEmoji("🚀").setStyle(ButtonStyle.Success).setDisabled(!canDeploy),\n        ...(deployment ? [new ButtonBuilder().setCustomId("embed:update-existing").setLabel("Update Existing").setEmoji("♻️").setStyle(ButtonStyle.Success).setDisabled(!canDeploy)] : [])\n      ),\n\n`;
  write(path, text.slice(0, start) + block + text.slice(end));
}

// Visible gallery/file items must have usable option screens even when the cursor is stale.
{
  const path = 'src/modules/messageStudio/embed/embedMedia.js';
  const oldMedia = "const index = Number.isInteger(state.selectedMediaIndex) && media.gallery[state.selectedMediaIndex] ? state.selectedMediaIndex : null;";
  const oldFile = "const index = Number.isInteger(state.selectedFileIndex) && media.files[state.selectedFileIndex] ? state.selectedFileIndex : null;";
  replaceOnce(path, oldMedia, "const index = media.gallery.length ? Math.max(0, Math.min(Number.isInteger(state.selectedMediaIndex) ? state.selectedMediaIndex : 0, media.gallery.length - 1)) : null;");
  replaceOnce(path, oldFile, "const index = media.files.length ? Math.max(0, Math.min(Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : 0, media.files.length - 1)) : null;");
  replaceOnce(path, oldFile, "const index = media.files.length ? Math.max(0, Math.min(Number.isInteger(state.selectedFileIndex) ? state.selectedFileIndex : 0, media.files.length - 1)) : null;");
}

// Clarify that gallery media options and attached-file options are different controls.
replaceOnce('src/modules/messageStudio/embed/embedMediaManagerBase.js', "'⚙️ Options',", "'⚙️ Media Options',");
replaceOnce('src/modules/messageStudio/embed/embedMediaManagerBase.js', "'⚙️ File Options',", "'⚙️ Attachment Options',");

// Components V2: create attachment-backed canvases for Centre/Right before Discord builds the gallery.
{
  const path = 'src/modules/messageStudio/embed/embedRenderer.js';
  const oldGallery = `async function galleryItems(media, interaction, placement = null) {\n  const output = [];\n  for (const item of (Array.isArray(media?.gallery) ? media.gallery : []).slice(0, 10)) {\n    if (placement && itemPlacement(item) !== placement) continue;\n    const source = resolveSource(item?.source, interaction);\n    if (!source) continue;\n    await probeRemoteSource(source, 'media');\n    const builder = new MediaGalleryItemBuilder().setURL(source).setSpoiler(item?.spoiler === true);\n    if (item?.alt) builder.setDescription(String(item.alt).slice(0, 1024));\n    output.push(builder);\n  }\n  return output;\n}`;
  const newGallery = `function galleryAlignment(item) {\n  const value = String(item?.alignment || 'left').toLowerCase();\n  return value === 'center' || value === 'right' ? value : 'left';\n}\nasync function alignedGalleryAttachment(source, alignment, panelIndex, itemIndex) {\n  const cached = await ensureAssetCached('global', source);\n  if (!cached?.buffer) return null;\n  const type = contentTypeBase(cached.meta?.contentType || '');\n  if (type && !STATIC_RASTER_TYPES.has(type)) return null;\n  const trimmed = await sharp(cached.buffer, { failOn: 'warning' }).ensureAlpha().trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();\n  const visible = await sharp(trimmed, { failOn: 'warning' }).resize({ width: SINGLE_IMAGE_VISIBLE_WIDTH, height: SINGLE_IMAGE_VISIBLE_WIDTH, fit: 'inside', withoutEnlargement: false }).ensureAlpha().png().toBuffer();\n  const meta = await sharp(visible).metadata();\n  const width = Number(meta.width || SINGLE_IMAGE_VISIBLE_WIDTH);\n  const height = Number(meta.height || SINGLE_IMAGE_VISIBLE_WIDTH);\n  const left = alignment === 'right' ? Math.max(0, SINGLE_IMAGE_CANVAS_WIDTH - width) : alignment === 'center' ? Math.max(0, Math.floor((SINGLE_IMAGE_CANVAS_WIDTH - width) / 2)) : 0;\n  const output = await sharp({ create: { width: SINGLE_IMAGE_CANVAS_WIDTH, height, channels: 4, background: PANEL_BG } }).composite([{ input: visible, left, top: 0 }]).png().toBuffer();\n  const name = \`embed-panel-\${panelIndex + 1}-media-\${itemIndex + 1}.png\`;\n  return { attachment: new AttachmentBuilder(output, { name }), url: \`attachment://\${name}\` };\n}\nasync function galleryItems(media, interaction, placement = null, payloadFiles = null, panelIndex = 0) {\n  const output = [];\n  const gallery = (Array.isArray(media?.gallery) ? media.gallery : []).slice(0, 10);\n  for (let itemIndex = 0; itemIndex < gallery.length; itemIndex += 1) {\n    const item = gallery[itemIndex];\n    if (placement && itemPlacement(item) !== placement) continue;\n    const source = resolveSource(item?.source, interaction);\n    if (!source) continue;\n    const probe = await probeRemoteSource(source, 'media');\n    let url = source;\n    const alignment = galleryAlignment(item);\n    const isStaticImage = String(item?.type || 'auto').toLowerCase() !== 'video' && !nativeImageShouldPassThrough(probe.contentType);\n    if (isStaticImage && alignment !== 'left' && Array.isArray(payloadFiles)) {\n      const prepared = await alignedGalleryAttachment(source, alignment, panelIndex, itemIndex);\n      if (prepared) { payloadFiles.push(prepared.attachment); url = prepared.url; }\n    }\n    const builder = new MediaGalleryItemBuilder().setURL(url).setSpoiler(item?.spoiler === true);\n    if (item?.alt) builder.setDescription(String(item.alt).slice(0, 1024));\n    output.push(builder);\n  }\n  return output;\n}`;
  replaceOnce(path, oldGallery, newGallery);
  replaceOnce(path, "const aboveItems = await galleryItems(media, interaction, 'above');", "const aboveItems = await galleryItems(media, interaction, 'above', files, index);");
  replaceOnce(path, "const belowItems = await galleryItems(media, interaction, 'below');", "const belowItems = await galleryItems(media, interaction, 'below', files, index);");
}

console.log('Applied all reported Embed Studio repairs.');
