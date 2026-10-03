'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, EmbedBuilder } = require('discord.js');
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
function row(...components) { const safe=components.filter(Boolean).slice(0,5); return safe.length?new ActionRowBuilder().addComponents(...safe):null; }
function findComponent(payload,id) { for(const actionRow of Array.isArray(payload?.components)?payload.components:[]){ const found=(actionRow?.components||[]).find((component)=>componentId(component)===id); if(found)return found; } return null; }
function button(id,label,style=ButtonStyle.Secondary,disabled=false){ return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function sourceLabel(value,fallback='Not set'){ const text=String(value||'').trim(); if(!text)return fallback; try{ const url=new URL(text); const name=decodeURIComponent(url.pathname.split('/').filter(Boolean).pop()||'Media'); return name.length>60?`${name.slice(0,57)}...`:name; }catch{return text.length>60?`${text.slice(0,57)}...`:text;} }

function applyAlignmentMap(mediaState,map={}, {legacyOverride=true}={}) {
  const media=clone(mediaState||{}); const panels=Array.isArray(media?.panels)?media.panels:[];
  panels.forEach((panelMedia,panelIndex)=>{ const gallery=Array.isArray(panelMedia?.gallery)?panelMedia.gallery:[]; gallery.forEach((item,itemIndex)=>{ const current=String(item?.alignment||'').toLowerCase(); const mapped=String(map[alignmentKey(panelIndex,itemIndex)]||'').toLowerCase(); if(legacyOverride&&VALID_ALIGNMENTS.has(mapped))item.alignment=mapped; else item.alignment=VALID_ALIGNMENTS.has(current)?current:(VALID_ALIGNMENTS.has(mapped)?mapped:'left'); }); });
  return media;
}
function mapFromMedia(mediaState={}) { const map={}; const panels=Array.isArray(mediaState?.panels)?mediaState.panels:[]; panels.forEach((panelMedia,panelIndex)=>{ const gallery=Array.isArray(panelMedia?.gallery)?panelMedia.gallery:[]; gallery.forEach((item,itemIndex)=>{ map[alignmentKey(panelIndex,itemIndex)]=alignmentOf(item); }); }); return map; }
function canonicalizeState(state={},migrateLegacy=false) { const media=applyAlignmentMap(state.media||{},alignmentMap(state),{legacyOverride:migrateLegacy}); return {...state,media,mediaAlignment:mapFromMedia(media)}; }

function installPersistence(panel) {
  if(!panel||panel.__imageAlignmentPersistenceInstalled)return;
  if(typeof panel.presetData==='function'){ const originalPresetData=panel.presetData.bind(panel); panel.presetData=(state)=>{ const canonical=canonicalizeState(state,false); return {...originalPresetData(canonical),media:canonical.media,mediaAlignment:canonical.mediaAlignment}; }; }
  if(typeof panel.applyPreset==='function'){ const originalApplyPreset=panel.applyPreset.bind(panel); panel.applyPreset=(interaction,name,preset={})=>{ const migratedPreset=canonicalizeState(preset,true); const result=originalApplyPreset(interaction,name,migratedPreset); const canonical=canonicalizeState(result,false); return typeof panel.saveSession==='function'?panel.saveSession(interaction,canonical):canonical; }; }
  panel.__imageAlignmentPersistenceInstalled=true;
}

function selectedItem(panel,interaction) {
  const state=panel.getSession(interaction); const panelIndex=Math.max(0,Number(state?.selectedPanelIndex)||0); const panelMedia=panel.getPanelMedia(state,panelIndex); const gallery=Array.isArray(panelMedia?.gallery)?panelMedia.gallery:[]; const itemIndex=Number.isInteger(state?.selectedMediaIndex)?state.selectedMediaIndex:(gallery.length?0:null); if(itemIndex==null||!gallery[itemIndex])return null; return {state,panelIndex,panelMedia,gallery,itemIndex,item:gallery[itemIndex]};
}
function selectedAlignment(panel,interaction){ const selected=selectedItem(panel,interaction); return selected?alignmentOf(selected.item):null; }

function installUi(panel) {
  if(!panel||panel.__imageAlignmentUiInstalled)return;

  if(typeof panel.buildEditorPanel==='function'){
    const original=panel.buildEditorPanel.bind(panel);
    panel.buildEditorPanel=(interaction,...args)=>{
      const payload=original(interaction,...args);
      const builder=findComponent(payload,'embed:builder'); const panels=findComponent(payload,'embed:panels'); const presets=findComponent(payload,'embed:presets');
      const deploy=findComponent(payload,'embed:use'); const test=findComponent(payload,'embed:test-send'); const update=findComponent(payload,'embed:update-existing');
      const back=findComponent(payload,'admin:modules'); const settings=findComponent(payload,'embed:settings'); const variables=findComponent(payload,'embed:helpers');
      payload.components=[...payload.components.slice(0,2),row(builder,panels,presets,button('embed:edit-images','🖼️ Media',ButtonStyle.Primary)),row(deploy,test,update),row(back,settings,variables)].filter(Boolean);
      return payload;
    };
  }

  if(typeof panel.buildPanelsPanel==='function'){
    const original=panel.buildPanelsPanel.bind(panel);
    panel.buildPanelsPanel=(interaction,...args)=>{ const payload=original(interaction,...args); const selector=payload.components?.[0]; payload.components=[selector,row(findComponent(payload,'embed:panel-add'),findComponent(payload,'embed:panel-up'),findComponent(payload,'embed:panel-down')),row(findComponent(payload,'embed:panel-duplicate'),findComponent(payload,'embed:panel-remove')),row(findComponent(payload,'embed:builder'),findComponent(payload,'embed:settings'))].filter(Boolean); return payload; };
  }

  if(typeof panel.buildFieldsManagerPanel==='function'){
    const original=panel.buildFieldsManagerPanel.bind(panel);
    panel.buildFieldsManagerPanel=(interaction,...args)=>{ const payload=original(interaction,...args); const layout=findComponent(payload,'embed:field-manager-layout'); const select=findComponent(payload,'embed:field-manager-select'); payload.components=[row(layout),row(select),row(findComponent(payload,'embed:field-manager-add'),findComponent(payload,'embed:field-manager-edit'),findComponent(payload,'embed:field-manager-up'),findComponent(payload,'embed:field-manager-down')),row(findComponent(payload,'embed:field-manager-inline'),findComponent(payload,'embed:field-manager-remove')),row(findComponent(payload,'embed:builder'),findComponent(payload,'embed:settings'),findComponent(payload,'embed:helpers'))].filter(Boolean); return payload; };
  }

  if(typeof panel.buildButtonsManagerPanel==='function'){
    const original=panel.buildButtonsManagerPanel.bind(panel);
    panel.buildButtonsManagerPanel=(interaction,...args)=>{ const payload=original(interaction,...args); const select=findComponent(payload,'embed:button-manager-select'); payload.components=[row(select),row(findComponent(payload,'embed:button-manager-add'),findComponent(payload,'embed:button-manager-edit'),findComponent(payload,'embed:button-manager-up'),findComponent(payload,'embed:button-manager-down')),row(findComponent(payload,'embed:button-manager-options'),findComponent(payload,'embed:button-manager-remove')),row(findComponent(payload,'embed:builder'),findComponent(payload,'embed:settings'))].filter(Boolean); return payload; };
  }

  if(typeof panel.buildMediaManagerPanel==='function'){
    const originalManager=panel.buildMediaManagerPanel.bind(panel);
    panel.buildMediaManagerPanel=(interaction,...args)=>{
      const payload=originalManager(interaction,...args); const selected=selectedItem(panel,interaction); const state=panel.getSession(interaction); const media=panel.getPanelMedia(state); const hasSelected=Boolean(selected);
      const selector=findComponent(payload,'embed:media-gallery-select'); const add=findComponent(payload,'embed:media-add'); const up=findComponent(payload,'embed:media-gallery-up'); const down=findComponent(payload,'embed:media-gallery-down'); const remove=findComponent(payload,'embed:media-gallery-remove'); const thumbnail=findComponent(payload,'embed:media-thumbnail');
      const headerType=['auto','text','gif','image'].includes(String(selected?.item?.headerType||'').toLowerCase())?String(selected.item.headerType).toLowerCase():'auto';
      const headerTypeLabel={auto:'Auto',text:'Text',gif:'GIF',image:'Image'}[headerType];
      const managerEmbed=Array.isArray(payload?.embeds)?payload.embeds[0]:null;
      if(managerEmbed?.data?.description!=null){
        managerEmbed.setDescription(`${managerEmbed.data.description}\n\n**Header Type**\nControls how the selected header is rendered. **Auto** detects the correct type automatically. **Text** uses the panel title only. **GIF** forces an animated graphic header. **Image** forces a static graphic header.\nUse **Auto** unless you need to override Goliath's detection.`.slice(0,4096));
      }
      payload.components=[
        row(selector),
        row(add,button('embed:media-gallery-edit','✏️ Edit',ButtonStyle.Primary,!hasSelected),up,down),
        row(button('embed:media-type:cycle',`🏷️ Type: ${headerTypeLabel}`,ButtonStyle.Secondary,!hasSelected),button('embed:media-spoiler:off','👁️ Normal',selected?.item?.spoiler?ButtonStyle.Secondary:ButtonStyle.Primary,!hasSelected),button('embed:media-spoiler:on','🙈 Spoiler',selected?.item?.spoiler?ButtonStyle.Primary:ButtonStyle.Secondary,!hasSelected),button('embed:media-duplicate','📑 Duplicate',ButtonStyle.Success,!hasSelected||media.gallery.length>=10)),
        row(button('embed:media-alignments','↔️ Alignments',ButtonStyle.Primary,!hasSelected),thumbnail,remove),
        row(findComponent(payload,'embed:builder'),findComponent(payload,'embed:settings'),findComponent(payload,'embed:helpers')),
      ].filter(Boolean);
      return payload;
    };
  }

  if(typeof panel.buildMediaOptionsPanel==='function'){
    const originalOptions=panel.buildMediaOptionsPanel.bind(panel);
    panel.buildMediaOptionsPanel=(interaction,...args)=>{ const payload=originalOptions(interaction,...args); const alignment=selectedAlignment(panel,interaction); if(!alignment)return payload; const embed=payload?.embeds?.[0]; if(embed?.data?.description!=null)embed.setDescription(`${embed.data.description}\n**Image alignment:** ${alignment==='center'?'Centre':alignment[0].toUpperCase()+alignment.slice(1)}`.slice(0,4096)); return payload; };
  }
  panel.__imageAlignmentUiInstalled=true;
}

function installInteraction(panel,interactions) {
  if(!panel||!interactions||interactions.__imageAlignmentInteractionInstalled)return;
  const original=interactions.handleInteraction.bind(interactions);
  interactions.handleInteraction=async(interaction)=>{ const customId=String(interaction?.customId||''); if(!customId.startsWith('embed:media-align:'))return original(interaction); const alignment=customId.split(':').pop(); if(!VALID_ALIGNMENTS.has(alignment))return true; const selected=selectedItem(panel,interaction); if(!selected){ await interaction.update(panel.buildMediaManagerPanel(interaction,panel.memberName(interaction))); return true; } const nextGallery=selected.gallery.map((item,index)=>index===selected.itemIndex?{...item,alignment}:item); const nextPanelMedia={...selected.panelMedia,gallery:nextGallery}; const nextState=panel.setPanelMedia(selected.state,selected.panelIndex,nextPanelMedia); const mapKey=alignmentKey(selected.panelIndex,selected.itemIndex); const explicitState={...nextState,mediaAlignment:{...alignmentMap(nextState),[mapKey]:alignment},hasUnsavedChanges:true}; panel.saveSession(interaction,canonicalizeState(explicitState,false)); await interaction.update(panel.buildMediaManagerPanel(interaction,panel.memberName(interaction))); return true; };
  interactions.__imageAlignmentInteractionInstalled=true;
}
function installImageAlignment(panel,renderer,interactions=null){ installPersistence(panel); installUi(panel); if(interactions)installInteraction(panel,interactions); }

function isPrivateIpv4(hostname){ const p=hostname.split('.').map(Number); if(p.length!==4||p.some((n)=>!Number.isInteger(n)||n<0||n>255))return false; const[a,b]=p; return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168); }
function isPrivateIpv6(hostname){ const h=hostname.toLowerCase(); return h==='::1'||h==='::'||h.startsWith('fc')||h.startsWith('fd')||/^fe[89ab]/.test(h); }
function safeUrl(value){ try{ const url=new URL(String(value||'')); const host=url.hostname.toLowerCase(); const version=net.isIP(host); if(url.protocol!=='https:'||!host||host==='localhost'||host.endsWith('.localhost'))return null; if((version===4&&isPrivateIpv4(host))||(version===6&&isPrivateIpv6(host)))return null; return url.toString(); }catch{return null;} }
async function fetchImage(url){ const target=safeUrl(url); if(!target)return null; const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS); timer.unref?.(); try{ const response=await fetch(target,{signal:controller.signal,redirect:'error'}); if(!response.ok)return null; const type=String(response.headers.get('content-type')||'').toLowerCase(); if(type&&!type.startsWith('image/'))return null; const declared=Number(response.headers.get('content-length')||0); if(declared>MAX_SOURCE_BYTES)return null; const buffer=await response.buffer(); return buffer.length<=MAX_SOURCE_BYTES?buffer:null; }finally{clearTimeout(timer);} }
function alignmentFor(state,panelIndex,itemIndex,item){ const canonical=String(item?.alignment||'').toLowerCase(); if(VALID_ALIGNMENTS.has(canonical))return canonical; const mapped=String(state?.mediaAlignment?.[alignmentKey(panelIndex,itemIndex)]||'').toLowerCase(); return VALID_ALIGNMENTS.has(mapped)?mapped:'left'; }
async function previewAttachment(source,alignment,item=null){ const input=await fetchImage(source); if(!input)return null; const visibleWidth=previewImageWidth(item); const trimmed=await sharp(input,{failOn:'warning'}).ensureAlpha().trim({background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer(); const visible=await sharp(trimmed,{failOn:'warning'}).resize({width:visibleWidth,height:PREVIEW_MAX_HEIGHT,fit:'inside',withoutEnlargement:false}).ensureAlpha().png().toBuffer(); const meta=await sharp(visible).metadata(); const width=Number(meta.width||visibleWidth),height=Number(meta.height||PREVIEW_MAX_HEIGHT); const left=alignment==='right'?Math.max(0,CANVAS_WIDTH-width):alignment==='center'?Math.max(0,Math.floor((CANVAS_WIDTH-width)/2)):0; const top=Math.max(0,Math.floor((PREVIEW_MAX_HEIGHT-height)/2)); const output=await sharp({create:{width:CANVAS_WIDTH,height:PREVIEW_MAX_HEIGHT,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:visible,left,top}]).png().toBuffer(); return new AttachmentBuilder(output,{name:`embed-alignment-${alignment}-${String(item?.size||'large').toLowerCase()}-${Date.now()}.png`}); }
function embedTitle(embed){ return String(embed?.data?.title||embed?.title||''); }
async function selectedContext(panel,interaction){ const state=panel.getSession(interaction); const panelIndex=Math.max(0,Number(state?.selectedPanelIndex)||0); const media=panel.getPanelMedia(state,panelIndex); let itemIndex=Number.isInteger(state?.selectedMediaIndex)?state.selectedMediaIndex:null; if(itemIndex==null&&Array.isArray(media?.gallery)&&media.gallery.length===1)itemIndex=0; if(itemIndex==null)return{state,panelIndex,itemIndex,item:null,source:null,alignment:'left',panelMedia:media}; const item=media?.gallery?.[itemIndex]||null; let source=String(item?.source||'').trim(); try{source=panel.replaceVars(source,interaction);}catch{} return{state,panelIndex,panelMedia:media,itemIndex,item,source,alignment:alignmentFor(state,panelIndex,itemIndex,item)}; }
async function alignedManagerPayload(panel,interaction){ const payload=panel.buildMediaManagerPanel(interaction,panel.memberName(interaction)); const ctx=await selectedContext(panel,interaction); if(!ctx.item)return payload; try{ const attachment=await previewAttachment(ctx.source,ctx.alignment,ctx.item); if(!attachment)return payload; const preview=Array.isArray(payload?.embeds)?payload.embeds.find((embed)=>embedTitle(embed).includes('Selected Media Preview')):null; if(!preview||typeof preview.setImage!=='function')return payload; preview.setImage(`attachment://${attachment.name}`); preview.setTitle(`🖼️ Selected Media Preview • ${ctx.item.placement==='above'?'Above Content':'Below Content'} • ${ctx.alignment==='center'?'Centre':ctx.alignment[0].toUpperCase()+ctx.alignment.slice(1)}`); payload.files=[attachment]; payload.attachments=[]; return payload; }catch(error){ console.warn('[Embed Preview] Alignment preview failed:',error?.message||error); return payload; } }

async function alignmentPanelPayload(panel,interaction){
  const ctx=await selectedContext(panel,interaction); if(!ctx.item)return alignedManagerPayload(panel,interaction);
  const size=['small','medium','large'].includes(String(ctx.item.size||'').toLowerCase())?String(ctx.item.size).toLowerCase():'large';
  const placement=ctx.item.placement==='above'?'above':'below';
  const gallery=Array.isArray(ctx.panelMedia?.gallery)?ctx.panelMedia.gallery:[];
  const aboveCount=gallery.filter((item)=>item?.placement==='above').length;
  const belowCount=gallery.length-aboveCount;
  const thumbnailConfigured=Boolean(ctx.panelMedia?.thumbnail?.source);
  const files=Array.isArray(ctx.panelMedia?.files)?ctx.panelMedia.files:[];
  const panelCount=Array.isArray(ctx.state?.panels)?ctx.state.panels.length:1;
  const type=String(ctx.item?.type||'auto').toLowerCase();
  const typeLabel=type==='image'?'Image':type==='video'?'Video':'Auto Detect';
  const alignmentLabel=ctx.alignment==='center'?'Centre':ctx.alignment[0].toUpperCase()+ctx.alignment.slice(1);
  const selectedName=sourceLabel(ctx.item?.alt||ctx.item?.source,`Item ${ctx.itemIndex+1}`);
  const headerType=['auto','text','gif','image'].includes(String(ctx.item?.headerType||'').toLowerCase())?String(ctx.item.headerType).toLowerCase():'auto';
  const headerTypeLabel={auto:'Auto',text:'Text',gif:'GIF',image:'Image'}[headerType];
  const description=[
    `Editing panel **${ctx.panelIndex+1}/${panelCount}** • Media item **${ctx.itemIndex+1}/${gallery.length}**`,
    '',
    `**Selected media:** ${selectedName}`,
    `**Type:** ${typeLabel}`,
    `**Placement:** ${placement==='above'?'⬆️ Above Content':'⬇️ Below Content'}`,
    `**Alignment:** ${alignmentLabel}`,
    `**Size:** ${size.toUpperCase()}`,
    `**Spoiler:** ${ctx.item?.spoiler?'On':'Off'}`,
    `**Header Type:** ${headerTypeLabel}`,
    '',
    '**Panel media sync**',
    `⬆️ **Above Content** — ${aboveCount}`,
    `⬇️ **Below Content** — ${belowCount}`,
    `🖼️ **Thumbnail** — ${thumbnailConfigured?'Configured':'Not set'}`,
    `📎 **Files** — ${files.length}/10`,
    '',
    'Changes made here update the same selected media item shown in Media Manager. Placement, alignment and size are saved immediately.',
  ].join('\n');
  const preview=new EmbedBuilder().setColor(0x5865F2).setTitle(`↔️ Media Alignments • Item ${ctx.itemIndex+1}`).setDescription(description.slice(0,4096));
  const payload={embeds:[preview],components:[
    row(button('embed:media-placement:above','⬆️ Above Content',placement==='above'?ButtonStyle.Primary:ButtonStyle.Secondary),button('embed:media-placement:below','⬇️ Below Content',placement==='below'?ButtonStyle.Primary:ButtonStyle.Secondary)),
    row(button('embed:media-align:left','⬅️ Left',ctx.alignment==='left'?ButtonStyle.Primary:ButtonStyle.Secondary),button('embed:media-align:center','↔️ Centre',ctx.alignment==='center'?ButtonStyle.Primary:ButtonStyle.Secondary),button('embed:media-align:right','➡️ Right',ctx.alignment==='right'?ButtonStyle.Primary:ButtonStyle.Secondary)),
    row(button('embed:media-size:small','🔹 Small',size==='small'?ButtonStyle.Primary:ButtonStyle.Secondary),button('embed:media-size:medium','🔷 Medium',size==='medium'?ButtonStyle.Primary:ButtonStyle.Secondary),button('embed:media-size:large','🔶 Large',size==='large'?ButtonStyle.Primary:ButtonStyle.Secondary)),
    row(button('embed:media-alignments-back','⬅️ Back')),
  ].filter(Boolean)};
  if(ctx.item?.type!=='video'&&safeUrl(ctx.source)){ try{ const attachment=await previewAttachment(ctx.source,ctx.alignment,ctx.item); if(attachment){ preview.setImage(`attachment://${attachment.name}`); payload.files=[attachment]; payload.attachments=[]; } }catch(error){ console.warn('[Embed Preview] Alignment page preview failed:',error?.message||error); } }
  return payload;
}

async function alignedEditMediaPayload(panel,interaction){ const payload=panel.buildEditMediaPanel(interaction); const ctx=await selectedContext(panel,interaction); if(!ctx.item||ctx.item?.type==='video'||!safeUrl(ctx.source))return payload; try{ const attachment=await previewAttachment(ctx.source,ctx.alignment,ctx.item); if(!attachment)return payload; const embeds=Array.isArray(payload?.embeds)?[...payload.embeds]:[]; const preview=embeds.find((embed)=>embedTitle(embed).includes('Selected Media Preview')); if(preview&&typeof preview.setImage==='function')preview.setImage(`attachment://${attachment.name}`); else embeds.unshift(new EmbedBuilder().setColor(0x5865F2).setTitle(`🖼️ Selected Media Preview • ${String(ctx.item?.size||'large').toUpperCase()}`).setDescription(`**Size:** ${String(ctx.item?.size||'large').toUpperCase()} • **Alignment:** ${ctx.alignment==='center'?'Centre':ctx.alignment[0].toUpperCase()+ctx.alignment.slice(1)}`).setImage(`attachment://${attachment.name}`)); payload.embeds=embeds; payload.files=[attachment]; payload.attachments=[]; return payload; }catch(error){ console.warn('[Embed Preview] Edit Media preview failed:',error?.message||error); return payload; } }

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
    if(customId==='embed:media-options-back'||customId==='embed:edit-images'){ await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    if(customId==='embed:media-gallery-select'&&interaction.isStringSelectMenu?.()){ const state=panel.getSession(interaction); panel.saveSession(interaction,{...state,selectedMediaIndex:Math.max(0,Number(interaction.values?.[0])||0)}); await interaction.update(await alignedManagerPayload(panel,interaction)); return true; }
    return original(interaction);
  };
  interactions.__alignmentPreviewInstalled=true; return interactions;
}

module.exports={installImageAlignment,installInteraction,installAlignmentPreview,applyAlignmentMap,alignmentOf,alignmentFor,mapFromMedia,canonicalizeState};