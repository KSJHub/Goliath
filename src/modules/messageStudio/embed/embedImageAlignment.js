'use strict';

const {
  AttachmentBuilder,
} = require('discord.js');
const fetch = require('node-fetch');
const net = require('node:net');
const sharp = require('sharp');

const VALID_ALIGNMENTS = new Set(['left', 'center', 'right']);
const CANVAS_WIDTH = 600;
const PREVIEW_MAX_HEIGHT = 520;
const PREVIEW_IMAGE_WIDTHS = Object.freeze({ small: 320, medium: 420, large: 520 });
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function previewImageWidth(item) { const size=String(item?.size||'large').toLowerCase(); return PREVIEW_IMAGE_WIDTHS[size]||PREVIEW_IMAGE_WIDTHS.large; }
function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
function alignmentOf(item) { const value=String(item?.alignment||'').toLowerCase(); return VALID_ALIGNMENTS.has(value)?value:'left'; }
function alignmentKey(panelIndex,itemIndex) { return `${Math.max(0,Number(panelIndex)||0)}:${Math.max(0,Number(itemIndex)||0)}`; }
function componentId(component) { return component?.data?.custom_id||component?.customId||component?.custom_id||null; }
function alignmentMap(state={}) { const source=state?.mediaAlignment&&typeof state.mediaAlignment==='object'?state.mediaAlignment:{}; return {...source}; }
function findComponent(payload,id) { for(const actionRow of Array.isArray(payload?.components)?payload.components:[]){ const found=(actionRow?.components||[]).find((component)=>componentId(component)===id); if(found)return found; } return null; }
function sourceLabel(value,fallback='Not set'){ const text=String(value||'').trim(); if(!text)return fallback; try{ const url=new URL(text); const name=decodeURIComponent(url.pathname.split('/').filter(Boolean).pop()||'Media'); return name.length>60?`${name.slice(0,57)}...`:name; }catch{return text.length>60?`${text.slice(0,57)}...`:text;} }

function applyAlignmentMap(mediaState,map={}, {legacyOverride=true}={}) {
  const media=clone(mediaState||{}); const panels=Array.isArray(media?.panels)?media.panels:[];
  panels.forEach((panelMedia,panelIndex)=>{ const gallery=Array.isArray(panelMedia?.gallery)?panelMedia.gallery:[]; gallery.forEach((item,itemIndex)=>{ const current=String(item?.alignment||'').toLowerCase(); const mapped=String(map[alignmentKey(panelIndex,itemIndex)]||'').toLowerCase(); if(legacyOverride&&VALID_ALIGNMENTS.has(mapped))item.alignment=mapped; else item.alignment=VALID_ALIGNMENTS.has(current)?current:(VALID_ALIGNMENTS.has(mapped)?mapped:'left'); }); });
  return media;
}
function mapFromMedia(mediaState={}) { const map={}; const panels=Array.isArray(mediaState?.panels)?mediaState.panels:[]; panels.forEach((panelMedia,panelIndex)=>{ const gallery=Array.isArray(panelMedia?.gallery)?panelMedia.gallery:[]; gallery.forEach((item,itemIndex)=>{ map[alignmentKey(panelIndex,itemIndex)]=alignmentOf(item); }); }); return map; }
function canonicalizeState(state={},migrateLegacy=false) { const media=applyAlignmentMap(state.media||{},alignmentMap(state),{legacyOverride:migrateLegacy}); return {...state,media,mediaAlignment:mapFromMedia(media)}; }

function installPersistence(panel) {
  if (
    !panel ||
    panel.__imageAlignmentPersistenceInstalled
  ) {
    return panel;
  }

  /*
   * Alignment now lives inside canonical media items.
   * Runtime preset/session wrapping is no longer required.
   *
   * Legacy mediaAlignment maps remain readable through
   * canonicalizeState() for migration.
   */
  panel.canonicalizeMediaAlignmentState =
    canonicalizeState;

  panel.__imageAlignmentPersistenceInstalled = true;

  return panel;
}

function installImageAlignment(panel, renderer) {
  installPersistence(panel);
}

function isPrivateIpv4(hostname){ const p=hostname.split('.').map(Number); if(p.length!==4||p.some((n)=>!Number.isInteger(n)||n<0||n>255))return false; const[a,b]=p; return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168); }
function isPrivateIpv6(hostname){ const h=hostname.toLowerCase(); return h==='::1'||h==='::'||h.startsWith('fc')||h.startsWith('fd')||/^fe[89ab]/.test(h); }
function safeUrl(value){ try{ const url=new URL(String(value||'')); const host=url.hostname.toLowerCase(); const version=net.isIP(host); if(url.protocol!=='https:'||!host||host==='localhost'||host.endsWith('.localhost'))return null; if((version===4&&isPrivateIpv4(host))||(version===6&&isPrivateIpv6(host)))return null; return url.toString(); }catch{return null;} }
async function fetchImage(url){ const target=safeUrl(url); if(!target)return null; const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS); timer.unref?.(); try{ const response=await fetch(target,{signal:controller.signal,redirect:'error'}); if(!response.ok)return null; const type=String(response.headers.get('content-type')||'').toLowerCase(); if(type&&!type.startsWith('image/'))return null; const declared=Number(response.headers.get('content-length')||0); if(declared>MAX_SOURCE_BYTES)return null; const buffer=await response.buffer(); return buffer.length<=MAX_SOURCE_BYTES?buffer:null; }finally{clearTimeout(timer);} }
function alignmentFor(state,panelIndex,itemIndex,item){ const canonical=String(item?.alignment||'').toLowerCase(); if(VALID_ALIGNMENTS.has(canonical))return canonical; const mapped=String(state?.mediaAlignment?.[alignmentKey(panelIndex,itemIndex)]||'').toLowerCase(); return VALID_ALIGNMENTS.has(mapped)?mapped:'left'; }
async function previewAttachment(source,alignment,item=null){ const input=await fetchImage(source); if(!input)return null; const visibleWidth=previewImageWidth(item); const trimmed=await sharp(input,{failOn:'warning'}).ensureAlpha().trim({background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer(); const visible=await sharp(trimmed,{failOn:'warning'}).resize({width:visibleWidth,height:PREVIEW_MAX_HEIGHT,fit:'inside',withoutEnlargement:false}).ensureAlpha().png().toBuffer(); const meta=await sharp(visible).metadata(); const width=Number(meta.width||visibleWidth),height=Number(meta.height||PREVIEW_MAX_HEIGHT); const left=alignment==='right'?Math.max(0,CANVAS_WIDTH-width):alignment==='center'?Math.max(0,Math.floor((CANVAS_WIDTH-width)/2)):0; const top=Math.max(0,Math.floor((PREVIEW_MAX_HEIGHT-height)/2)); const output=await sharp({create:{width:CANVAS_WIDTH,height:PREVIEW_MAX_HEIGHT,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:visible,left,top}]).png().toBuffer(); return new AttachmentBuilder(output,{name:`embed-alignment-${alignment}-${String(item?.size||'large').toLowerCase()}-${Date.now()}.png`}); }
async function selectedContext(panel,interaction){ const state=panel.getSession(interaction); const panelIndex=Math.max(0,Number(state?.selectedPanelIndex)||0); const media=panel.getPanelMedia(state,panelIndex); let itemIndex=Number.isInteger(state?.selectedMediaIndex)?state.selectedMediaIndex:null; if(itemIndex==null&&Array.isArray(media?.gallery)&&media.gallery.length===1)itemIndex=0; if(itemIndex==null)return{state,panelIndex,itemIndex,item:null,source:null,alignment:'left',panelMedia:media}; const item=media?.gallery?.[itemIndex]||null; let source=String(item?.source||'').trim(); try{source=panel.replaceVars(source,interaction);}catch{} return{state,panelIndex,panelMedia:media,itemIndex,item,source,alignment:alignmentFor(state,panelIndex,itemIndex,item)}; }

async function alignedManagerPayload(
  panel,
  interaction
) {
  const payload =
    panel.buildMediaManagerPanel(
      interaction,
      panel.memberName(interaction)
    );

  const ctx =
    await selectedContext(
      panel,
      interaction
    );

  if (!ctx.item) {
    return payload;
  }

  try {
    const attachment =
      await previewAttachment(
        ctx.source,
        ctx.alignment,
        ctx.item
      );

    if (!attachment) {
      return payload;
    }

    return panel.applyMediaPreviewPresentation(
      payload,
      attachment,
      ctx,
      {
        manager: true,
      }
    );
  } catch (error) {
    console.warn(
      "[Embed Preview] Alignment preview failed:",
      error?.message || error
    );

    return payload;
  }
}


async function alignmentPanelPayload(
  panel,
  interaction
) {
  const ctx =
    await selectedContext(
      panel,
      interaction
    );

  if (!ctx.item) {
    return alignedManagerPayload(
      panel,
      interaction
    );
  }

  const payload =
    panel.buildMediaAlignmentPanel(ctx);

  if (!payload) {
    return alignedManagerPayload(
      panel,
      interaction
    );
  }

  if (
    ctx.item?.type !== "video"
    && safeUrl(ctx.source)
  ) {
    try {
      const attachment =
        await previewAttachment(
          ctx.source,
          ctx.alignment,
          ctx.item
        );

      if (attachment) {
        panel.applyMediaPreviewPresentation(
          payload,
          attachment,
          ctx
        );
      }
    } catch (error) {
      console.warn(
        "[Embed Preview] Alignment page preview failed:",
        error?.message || error
      );
    }
  }

  return payload;
}

function saveSelectedPatch(panel,interaction,ctx,patch){ const gallery=Array.isArray(ctx.panelMedia?.gallery)?ctx.panelMedia.gallery:[]; const nextGallery=gallery.map((item,index)=>index===ctx.itemIndex?{...item,...patch}:item); const nextPanelMedia={...ctx.panelMedia,gallery:nextGallery}; const nextState=panel.setPanelMedia(ctx.state,ctx.panelIndex,nextPanelMedia); const extra=patch.alignment?{mediaAlignment:{...(ctx.state?.mediaAlignment||{}),[alignmentKey(ctx.panelIndex,ctx.itemIndex)]:patch.alignment}}:{}; panel.saveSession(interaction,{...nextState,...extra,selectedMediaIndex:ctx.itemIndex,hasUnsavedChanges:true}); }

function installAlignmentPreview(panel,interactions){
  if(!panel||!interactions||interactions.__alignmentPreviewInstalled)return interactions;
  const original=interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction=async(interaction)=>{ const customId=String(interaction?.customId||'');
    if(customId==='embed:media-alignments'){ await interaction.update(await alignmentPanelPayload(panel,interaction)); return true; }
    if(customId==='embed:media-alignments-back'){ await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    if(customId.startsWith('embed:media-align:')){ const alignment=customId.split(':').pop(); if(!VALID_ALIGNMENTS.has(alignment))return true; const ctx=await selectedContext(panel,interaction); if(ctx.itemIndex==null||!ctx.item)return original(interaction); saveSelectedPatch(panel,interaction,ctx,{alignment}); await interaction.update(await alignmentPanelPayload(panel,interaction)); return true; }
    if(customId.startsWith('embed:media-placement:')){ const placement=customId.split(':').pop(); if(!['above','below'].includes(placement))return original(interaction); const ctx=await selectedContext(panel,interaction); if(ctx.itemIndex==null||!ctx.item)return original(interaction); saveSelectedPatch(panel,interaction,ctx,{placement}); await interaction.update(await alignmentPanelPayload(panel,interaction)); return true; }
    if(customId.startsWith('embed:media-size:')){ const requestedSize=customId.split(':').pop(); if(!['small','medium','large'].includes(requestedSize))return original(interaction); const ctx=await selectedContext(panel,interaction); if(ctx.itemIndex==null||!ctx.item)return original(interaction); saveSelectedPatch(panel,interaction,ctx,{size:requestedSize}); await interaction.update(await alignmentPanelPayload(panel,interaction)); return true; }
    /*
     * Normal Media Manager navigation remains owned by
     * embedInteractions.js. This wrapper only owns the
     * alignment-specific presentation controls above.
     */
    return original(interaction);
  };
  interactions.__alignmentPreviewInstalled=true; return interactions;
}

module.exports={installImageAlignment,installAlignmentPreview,applyAlignmentMap,alignmentOf,alignmentFor,mapFromMedia,canonicalizeState};