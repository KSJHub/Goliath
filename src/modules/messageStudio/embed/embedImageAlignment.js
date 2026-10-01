'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const net = require('node:net');
const sharp = require('sharp');

const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
const CANVAS_WIDTH = 600;
const VISIBLE_WIDTH = 360;
const PREVIEW_MAX_HEIGHT = 320;
const PANEL_BG = { r: 19, g: 20, b: 22, alpha: 1 };
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function alignmentOf(item) { const value = String(item?.alignment || '').toLowerCase(); return VALID_ALIGNMENTS.has(value) ? value : 'left'; }
function alignmentKey(panelIndex, itemIndex) { return `${Math.max(0, Number(panelIndex) || 0)}:${Math.max(0, Number(itemIndex) || 0)}`; }
function componentId(component) { return component?.data?.custom_id || component?.customId || component?.custom_id || null; }
function alignmentMap(state = {}) { const source = state?.mediaAlignment && typeof state.mediaAlignment === 'object' ? state.mediaAlignment : {}; return { ...source }; }

function applyAlignmentMap(mediaState, map = {}, { legacyOverride = true } = {}) {
  const media = clone(mediaState || {});
  const panels = Array.isArray(media?.panels) ? media.panels : [];
  panels.forEach((panelMedia, panelIndex) => {
    const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
    gallery.forEach((item, itemIndex) => {
      const current = String(item?.alignment || '').toLowerCase();
      const mapped = String(map[alignmentKey(panelIndex, itemIndex)] || '').toLowerCase();
      if (legacyOverride && VALID_ALIGNMENTS.has(mapped)) item.alignment = mapped;
      else item.alignment = VALID_ALIGNMENTS.has(current) ? current : (VALID_ALIGNMENTS.has(mapped) ? mapped : 'left');
    });
  });
  return media;
}

function mapFromMedia(mediaState = {}) {
  const map = {};
  const panels = Array.isArray(mediaState?.panels) ? mediaState.panels : [];
  panels.forEach((panelMedia, panelIndex) => {
    const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
    gallery.forEach((item, itemIndex) => { map[alignmentKey(panelIndex, itemIndex)] = alignmentOf(item); });
  });
  return map;
}

function canonicalizeState(state = {}, migrateLegacy = false) {
  const media = applyAlignmentMap(state.media || {}, alignmentMap(state), { legacyOverride: migrateLegacy });
  return { ...state, media, mediaAlignment: mapFromMedia(media) };
}

function installPersistence(panel) {
  if (!panel || panel.__imageAlignmentPersistenceInstalled) return;
  if (typeof panel.presetData === 'function') {
    const originalPresetData = panel.presetData.bind(panel);
    panel.presetData = (state) => {
      const canonical = canonicalizeState(state, false);
      return { ...originalPresetData(canonical), media: canonical.media, mediaAlignment: canonical.mediaAlignment };
    };
  }
  if (typeof panel.applyPreset === 'function') {
    const originalApplyPreset = panel.applyPreset.bind(panel);
    panel.applyPreset = (interaction, name, preset = {}) => {
      const migratedPreset = canonicalizeState(preset, true);
      const result = originalApplyPreset(interaction, name, migratedPreset);
      const canonical = canonicalizeState(result, false);
      return typeof panel.saveSession === 'function' ? panel.saveSession(interaction, canonical) : canonical;
    };
  }
  panel.__imageAlignmentPersistenceInstalled = true;
}

function alignmentButtons(alignment) {
  return [
    new ButtonBuilder().setCustomId('embed:media-align:left').setLabel('⬅️ Left').setStyle(alignment === 'left' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed:media-align:center').setLabel('↔️ Centre').setStyle(alignment === 'center' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed:media-align:right').setLabel('➡️ Right').setStyle(alignment === 'right' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  ];
}

function selectedItem(panel, interaction) {
  const state = panel.getSession(interaction);
  const panelIndex = Math.max(0, Number(state?.selectedPanelIndex) || 0);
  const panelMedia = panel.getPanelMedia(state, panelIndex);
  const gallery = Array.isArray(panelMedia?.gallery) ? panelMedia.gallery : [];
  const itemIndex = Number.isInteger(state?.selectedMediaIndex) ? state.selectedMediaIndex : (gallery.length ? 0 : null);
  if (itemIndex == null || !gallery[itemIndex]) return null;
  return { state, panelIndex, panelMedia, gallery, itemIndex, item: gallery[itemIndex] };
}
function selectedAlignment(panel, interaction) { const selected = selectedItem(panel, interaction); return selected ? alignmentOf(selected.item) : null; }

function installUi(panel) {
  if (!panel || panel.__imageAlignmentUiInstalled) return;
  if (typeof panel.buildMediaManagerPanel === 'function') {
    const originalManager = panel.buildMediaManagerPanel.bind(panel);
    panel.buildMediaManagerPanel = (interaction, ...args) => {
      const payload = originalManager(interaction, ...args); const alignment = selectedAlignment(panel, interaction); if (!alignment) return payload;
      const rows = Array.isArray(payload?.components) ? payload.components : []; const buttons = alignmentButtons(alignment);
      const placementRow = rows.find((row) => { const ids = Array.isArray(row?.components) ? row.components.map(componentId) : []; return ids.some((id) => id === 'embed:media-placement:above' || id === 'embed:media-above') && ids.some((id) => id === 'embed:media-placement:below' || id === 'embed:media-below'); });
      if (placementRow && Array.isArray(placementRow.components) && placementRow.components.length <= 2) { placementRow.addComponents(...buttons); return payload; }
      const labelledPlacementRow = rows.find((row) => { const components = Array.isArray(row?.components) ? row.components : []; const labels = components.map((component) => String(component?.data?.label || component?.label || '')); return labels.some((label) => label.includes('Above Content')) && labels.some((label) => label.includes('Below Content')); });
      if (labelledPlacementRow && Array.isArray(labelledPlacementRow.components) && labelledPlacementRow.components.length <= 2) { labelledPlacementRow.addComponents(...buttons); return payload; }
      if (rows.length < 5) { const backIndex = rows.findIndex((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-back')); const optionsBackIndex = rows.findIndex((row) => Array.isArray(row?.components) && row.components.some((c) => componentId(c) === 'embed:media-options-back')); const insertAt = backIndex >= 0 ? backIndex : optionsBackIndex >= 0 ? optionsBackIndex : rows.length; rows.splice(insertAt, 0, new ActionRowBuilder().addComponents(...buttons)); }
      return payload;
    };
  }
  if (typeof panel.buildMediaOptionsPanel === 'function') {
    const originalOptions = panel.buildMediaOptionsPanel.bind(panel);
    panel.buildMediaOptionsPanel = (interaction, ...args) => {
      const payload = originalOptions(interaction, ...args); const alignment = selectedAlignment(panel, interaction); if (!alignment) return payload;
      const embed = payload?.embeds?.[0]; if (embed?.data?.description != null) embed.setDescription(`${embed.data.description}\n**Image alignment:** ${alignment === 'center' ? 'Centre' : alignment[0].toUpperCase() + alignment.slice(1)}`.slice(0, 4096));
      return payload;
    };
  }
  panel.__imageAlignmentUiInstalled = true;
}

function installInteraction(panel, interactions) {
  if (!panel || !interactions || interactions.__imageAlignmentInteractionInstalled) return;
  const original = interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction = async (interaction) => {
    const customId = String(interaction?.customId || ''); if (!customId.startsWith('embed:media-align:')) return original(interaction);
    const alignment = customId.split(':').pop(); if (!VALID_ALIGNMENTS.has(alignment)) return true;
    const selected = selectedItem(panel, interaction);
    if (!selected) { await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction))); return true; }
    const nextGallery = selected.gallery.map((item, index) => index === selected.itemIndex ? { ...item, alignment } : item);
    const nextPanelMedia = { ...selected.panelMedia, gallery: nextGallery };
    const nextState = panel.setPanelMedia(selected.state, selected.panelIndex, nextPanelMedia);
    const mapKey = alignmentKey(selected.panelIndex, selected.itemIndex);
    const explicitState = { ...nextState, mediaAlignment: { ...alignmentMap(nextState), [mapKey]: alignment }, hasUnsavedChanges: true };
    const canonical = canonicalizeState(explicitState, false);
    panel.saveSession(interaction, canonical);
    await interaction.update(panel.buildMediaManagerPanel(interaction, panel.memberName(interaction)));
    return true;
  };
  interactions.__imageAlignmentInteractionInstalled = true;
}

function installImageAlignment(panel, renderer, interactions = null) {
  installPersistence(panel);
  installUi(panel);
  if (interactions) installInteraction(panel, interactions);
}

function isPrivateIpv4(hostname) { const p = hostname.split('.').map(Number); if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false; const [a,b]=p; return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168); }
function isPrivateIpv6(hostname) { const h=hostname.toLowerCase(); return h==='::1'||h==='::'||h.startsWith('fc')||h.startsWith('fd')||/^fe[89ab]/.test(h); }
function safeUrl(value) { try { const url=new URL(String(value||'')); const host=url.hostname.toLowerCase(); const version=net.isIP(host); if(url.protocol!=='https:'||!host||host==='localhost'||host.endsWith('.localhost')) return null; if((version===4&&isPrivateIpv4(host))||(version===6&&isPrivateIpv6(host))) return null; return url.toString(); } catch { return null; } }
async function fetchImage(url) { const target=safeUrl(url); if(!target)return null; const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS); timer.unref?.(); try { const response=await fetch(target,{signal:controller.signal,redirect:'error'}); if(!response.ok)return null; const type=String(response.headers.get('content-type')||'').toLowerCase(); if(type&&!type.startsWith('image/'))return null; const declared=Number(response.headers.get('content-length')||0); if(declared>MAX_SOURCE_BYTES)return null; const buffer=await response.buffer(); return buffer.length<=MAX_SOURCE_BYTES?buffer:null; } finally { clearTimeout(timer); } }
function alignmentFor(state,panelIndex,itemIndex,item){ const canonical=String(item?.alignment||'').toLowerCase(); if(VALID_ALIGNMENTS.has(canonical))return canonical; const mapped=String(state?.mediaAlignment?.[alignmentKey(panelIndex,itemIndex)]||'').toLowerCase(); return VALID_ALIGNMENTS.has(mapped)?mapped:'left'; }
async function previewAttachment(source,alignment){
  const input=await fetchImage(source); if(!input)return null;
  const trimmed=await sharp(input,{failOn:'warning'}).ensureAlpha().trim({background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
  const visible=await sharp(trimmed,{failOn:'warning'}).resize({width:VISIBLE_WIDTH,height:PREVIEW_MAX_HEIGHT,fit:'inside',withoutEnlargement:false}).ensureAlpha().png().toBuffer();
  const meta=await sharp(visible).metadata(); const width=Number(meta.width||VISIBLE_WIDTH),height=Number(meta.height||PREVIEW_MAX_HEIGHT);
  const left=alignment==='right'?Math.max(0,CANVAS_WIDTH-width):alignment==='center'?Math.max(0,Math.floor((CANVAS_WIDTH-width)/2)):0;
  const output=await sharp({create:{width:CANVAS_WIDTH,height,channels:4,background:PANEL_BG}}).composite([{input:visible,left,top:0}]).png().toBuffer();
  return new AttachmentBuilder(output,{name:`embed-alignment-${alignment}-${Date.now()}.png`});
}
function embedTitle(embed){ return String(embed?.data?.title||embed?.title||''); }
async function selectedContext(panel,interaction){ const state=panel.getSession(interaction); const panelIndex=Math.max(0,Number(state?.selectedPanelIndex)||0); const media=panel.getPanelMedia(state,panelIndex); let itemIndex=Number.isInteger(state?.selectedMediaIndex)?state.selectedMediaIndex:null; if(itemIndex==null && Array.isArray(media?.gallery) && media.gallery.length===1)itemIndex=0; if(itemIndex==null)return {state,panelIndex,itemIndex,item:null,source:null,alignment:'left'}; const item=media?.gallery?.[itemIndex]||null; let source=String(item?.source||'').trim(); try{source=panel.replaceVars(source,interaction);}catch{} return {state,panelIndex,itemIndex,item,source,alignment:alignmentFor(state,panelIndex,itemIndex,item)}; }
async function alignedManagerPayload(panel,interaction){ const payload=panel.buildMediaManagerPanel(interaction,panel.memberName(interaction)); const ctx=await selectedContext(panel,interaction); if(!ctx.item)return payload; try { const attachment=await previewAttachment(ctx.source,ctx.alignment); if(!attachment)return payload; const preview=Array.isArray(payload?.embeds)?payload.embeds.find((embed)=>embedTitle(embed).includes('Selected Media Preview')):null; if(!preview||typeof preview.setImage!=='function')return payload; preview.setImage(`attachment://${attachment.name}`); preview.setTitle(`🖼️ Selected Media Preview • ${ctx.item.placement==='above'?'Above Content':'Below Content'} • ${ctx.alignment==='center'?'Centre':ctx.alignment[0].toUpperCase()+ctx.alignment.slice(1)}`); payload.files=[attachment]; payload.attachments=[]; return payload; } catch(error){ console.warn('[Embed Preview] Alignment preview failed:',error?.message||error); return payload; } }
async function alignContentPreview(panel,interaction,payload,label){ const ctx=await selectedContext(panel,interaction); if(!ctx.item?.source||ctx.item?.type==='video'||String(ctx.item?.placement||'below').toLowerCase()==='above'||!safeUrl(ctx.source))return payload; try{ const attachment=await previewAttachment(ctx.source,ctx.alignment); if(!attachment)return payload; const previews=Array.isArray(payload?.embeds)?payload.embeds:[]; const host=previews.find((embed,index)=>index>0&&typeof embed?.setImage==='function'&&embed?.toJSON?.()?.image?.url) || previews.find((embed,index)=>index>0&&typeof embed?.setImage==='function'); if(!host)return payload; host.setImage(`attachment://${attachment.name}`); payload.files=[attachment]; payload.attachments=[]; return payload; }catch(error){ console.warn(`[Embed Preview] ${label} alignment preview failed:`,error?.message||error); return payload; } }
async function alignedBuilderPayload(panel,interaction){ return alignContentPreview(panel,interaction,panel.buildBuilderPanel(interaction,panel.memberName(interaction)),'Builder'); }
async function alignedEditorPayload(panel,interaction){ return alignContentPreview(panel,interaction,panel.buildEditorPanel(interaction,panel.memberName(interaction)),'Studio'); }

function installAlignmentPreview(panel,interactions){
  if(!panel||!interactions||interactions.__alignmentPreviewInstalled)return interactions;
  const original=interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction=async(interaction)=>{ const customId=String(interaction?.customId||'');
    if(customId.startsWith('embed:media-align:')){ const alignment=customId.split(':').pop(); if(!VALID_ALIGNMENTS.has(alignment))return true; const ctx=await selectedContext(panel,interaction); if(ctx.itemIndex==null||!ctx.item)return original(interaction); const gallery=Array.isArray(panel.getPanelMedia(ctx.state,ctx.panelIndex)?.gallery)?panel.getPanelMedia(ctx.state,ctx.panelIndex).gallery:[]; const nextGallery=gallery.map((item,index)=>index===ctx.itemIndex?{...item,alignment}:item); const nextPanelMedia={...panel.getPanelMedia(ctx.state,ctx.panelIndex),gallery:nextGallery}; const nextState=panel.setPanelMedia(ctx.state,ctx.panelIndex,nextPanelMedia); const map={...(ctx.state?.mediaAlignment||{}),[alignmentKey(ctx.panelIndex,ctx.itemIndex)]:alignment}; panel.saveSession(interaction,{...nextState,mediaAlignment:map,hasUnsavedChanges:true}); await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    if(customId==='embed:media-options-back'||customId==='embed:edit-images'){ await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    if(customId==='embed:media-gallery-select'&&interaction.isStringSelectMenu?.()){ const state=panel.getSession(interaction); panel.saveSession(interaction,{...state,selectedMediaIndex:Math.max(0,Number(interaction.values?.[0])||0)}); await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    if(customId==='embed:builder'){ await interaction.update(await alignedBuilderPayload(panel,interaction)); return true; }
    if(customId==='embed:builder-panel-select'&&interaction.isStringSelectMenu?.()){ const state=panel.getSession(interaction); const index=Math.max(0,Math.min(Number(interaction.values?.[0])||0,Math.max(0,(state.panels?.length||1)-1))); panel.saveSession(interaction,{...state,selectedPanelIndex:index,selectedFieldIndex:null}); await interaction.update(await alignedBuilderPayload(panel,interaction)); return true; }
    if(customId==='embed:editor'||customId==='embed:back'){ await interaction.update(await alignedEditorPayload(panel,interaction)); return true; }
    if(customId==='embed:channel'&&interaction.isChannelSelectMenu?.()){ const state=panel.getSession(interaction); panel.markUnsaved(interaction,{...state,channelId:interaction.values[0]}); await interaction.update(await alignedEditorPayload(panel,interaction)); return true; }
    return original(interaction);
  };
  interactions.__alignmentPreviewInstalled=true;
  return interactions;
}

module.exports = { installImageAlignment, installInteraction, installAlignmentPreview, applyAlignmentMap, alignmentOf, alignmentFor, mapFromMedia, canonicalizeState };
