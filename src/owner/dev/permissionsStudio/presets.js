'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, EmbedBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
} = require('discord.js');

const PREFIX = 'permpreset:';
const stores = new Map();
const sessions = new Map();
const cid = (action,guildId) => `${PREFIX}${action}:guild:${guildId}`;
const actionId = id => String(id||'').replace(/^permpreset:/,'').replace(/:guild:\d{16,25}$/,'');
const guildId = (id,i) => String(id||'').match(/:guild:(\d{16,25})$/)?.[1] || i.guildId;
const btn = (id,label,emoji,style=ButtonStyle.Secondary,disabled=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
function sk(i,g){return `${i.user.id}:${g.id}`;}
function state(i,g){const k=sk(i,g);if(!sessions.has(k))sessions.set(k,{sourceId:null,sourceRoleId:null,presetId:null,targetIds:[],roleMapId:null,history:[]});return sessions.get(k);}
function store(g){if(!stores.has(g.id))stores.set(g.id,[]);return stores.get(g.id);}
function snapshotChannel(g,c,roleId=null){
  const overwrites=[...c.permissionOverwrites.cache.values()].filter(o=>!roleId||o.id===roleId).map(o=>({id:o.id,type:o.type,allow:o.allow.bitfield.toString(),deny:o.deny.bitfield.toString(),roleName:o.type===0?g.roles.cache.get(o.id)?.name:null}));
  return {id:`p${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`,name:`${c.name}${roleId?` • ${g.roles.cache.get(roleId)?.name||'role'}`:''}`,kind:roleId?'role-override':(c.type===ChannelType.GuildCategory?'category':'channel'),sourceGuildId:g.id,sourceChannelId:c.id,sourceRoleId:roleId,channelType:c.type,overwrites,createdAt:Date.now()};
}
function snap(c){return {id:c.id,overwrites:[...c.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:o.allow.bitfield.toString(),deny:o.deny.bitfield.toString()}))};}
function home(g,s){
  const presets=store(g);const selected=presets.find(p=>p.id===s.presetId);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🧩 Permission Presets & Blueprints').setDescription([
    'Save a finished permission setup once, then reuse it without needing the original channel/category.', '',
    `**Saved presets:** ${presets.length}`,
    `**Selected preset:** ${selected?`**${selected.name}** (${selected.kind})`:'None'}`,
    `**Apply targets:** ${s.targetIds.length}`, '',
    '**Blueprint types**',
    '• Channel — all explicit role/member overwrites from one channel',
    '• Category — all explicit overwrites from one category',
    '• Role Override — one role’s Allow / Inherit / Deny setup on a channel/category',
  ].join('\n')).setFooter({text:'Presets are scoped to the current running Goliath environment and server.'});
  const source=new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid('source',g.id)).setPlaceholder('1. Choose source channel/category…').setMinValues(1).setMaxValues(1).addChannelTypes(ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice,ChannelType.GuildStageVoice,ChannelType.GuildForum,ChannelType.GuildMedia));
  const role=new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid('source-role',g.id)).setPlaceholder('Optional: save only one role override…').setMinValues(1).setMaxValues(1));
  const actions=new ActionRowBuilder().addComponents(btn(cid('save',g.id),'Save Blueprint','💾',ButtonStyle.Primary,!s.sourceId),btn(cid('library',g.id),'Preset Library','📚',ButtonStyle.Secondary,!presets.length),btn(`permstudio:home:guild:${g.id}`,'Back to Studio','⬅️'));
  return {embeds:[embed],components:[source,role,actions]};
}
function library(g,s){
  const presets=store(g);const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('📚 Permission Preset Library').setDescription(presets.length?presets.map((p,n)=>`${n+1}. **${p.name}** — ${p.kind} • ${p.overwrites.length} overwrite(s)`).join('\n'):'No saved presets.');
  const menu=new StringSelectMenuBuilder().setCustomId(cid('select',g.id)).setPlaceholder('Choose a preset…').addOptions(presets.slice(-25).map(p=>({label:p.name.slice(0,100),value:p.id,description:`${p.kind} • ${p.overwrites.length} overwrite(s)`}))).setMinValues(1).setMaxValues(1);
  return {embeds:[embed],components:presets.length?[new ActionRowBuilder().addComponents(menu),new ActionRowBuilder().addComponents(btn(cid('home',g.id),'Back','⬅️'))]:[new ActionRowBuilder().addComponents(btn(cid('home',g.id),'Back','⬅️'))]};
}
function selected(g,s){
  const p=store(g).find(x=>x.id===s.presetId);if(!p)return home(g,s);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(`🧩 ${p.name}`).setDescription(`Type: **${p.kind}**\nExplicit overwrites: **${p.overwrites.length}**\nSaved: <t:${Math.floor(p.createdAt/1000)}:R>\n\nSelect one or more destination channels/categories.`);
  const targets=new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid('targets',g.id)).setPlaceholder('Select up to 25 destinations…').setMinValues(1).setMaxValues(25).addChannelTypes(ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice,ChannelType.GuildStageVoice,ChannelType.GuildForum,ChannelType.GuildMedia));
  const rows=[targets];
  if(p.kind==='role-override') rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid('map-role',g.id)).setPlaceholder('Map saved role to destination role…').setMinValues(1).setMaxValues(1)));
  rows.push(new ActionRowBuilder().addComponents(btn(cid('preview',g.id),'Preview Apply','🔎',ButtonStyle.Primary,!s.targetIds.length||(p.kind==='role-override'&&!s.roleMapId)),btn(cid('delete',g.id),'Delete Preset','🗑️',ButtonStyle.Danger),btn(cid('library',g.id),'Library','⬅️')));
  return {embeds:[embed],components:rows};
}
function preview(g,s){const p=store(g).find(x=>x.id===s.presetId);const targets=s.targetIds.map(id=>g.channels.cache.get(id)).filter(Boolean);const mapped=p.kind==='role-override'?g.roles.cache.get(s.roleMapId):null;const embed=new EmbedBuilder().setColor(0xFEE75C).setTitle('🔎 Blueprint Apply Preview').setDescription(`**Preset:** ${p.name}\n**Targets:** ${targets.length}\n${mapped?`**Mapped role:** @${mapped.name}\n`:''}\n${targets.slice(0,15).map(c=>`• ${c.name}`).join('\n')}${targets.length>15?'\n• …':''}`).addFields({name:'Apply behaviour',value:p.kind==='role-override'?'Only the mapped role overwrite is replaced on each target. Other target overwrites are preserved.':'The target permission-overwrite set is replaced by this blueprint.'}).setFooter({text:'A before-state snapshot is retained for Undo.'});return {embeds:[embed],components:[new ActionRowBuilder().addComponents(btn(cid('apply',g.id),'Apply Blueprint','✅',ButtonStyle.Success),btn(cid('selected',g.id),'Back','⬅️'))]};}
async function apply(g,s){const p=store(g).find(x=>x.id===s.presetId);if(!p)throw new Error('Preset no longer exists.');const targets=s.targetIds.map(id=>g.channels.cache.get(id)).filter(Boolean);const before=targets.map(snap);
  for(const c of targets){if(p.kind==='role-override'){const o=p.overwrites[0];if(!o)continue;await c.permissionOverwrites.edit(s.roleMapId,{allow:BigInt(o.allow),deny:BigInt(o.deny)},{reason:`Goliath permission blueprint: ${p.name}`});}else{const mapped=p.overwrites.filter(o=>o.type===1||g.roles.cache.has(o.id)).map(o=>({id:o.id,type:o.type,allow:BigInt(o.allow),deny:BigInt(o.deny)}));await c.permissionOverwrites.set(mapped,`Goliath permission blueprint: ${p.name}`);}}
  s.history.push({label:`${p.name} → ${targets.length} target(s)`,before});if(s.history.length>10)s.history.shift();return targets.length;
}
async function undo(g,s){const h=s.history.pop();if(!h)return false;for(const x of h.before){const c=g.channels.cache.get(x.id);if(c)await c.permissionOverwrites.set(x.overwrites.map(o=>({id:o.id,type:o.type,allow:BigInt(o.allow),deny:BigInt(o.deny)})),'Goliath permission blueprint undo');}return true;}
function result(g,s,count){return {embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('✅ Blueprint Applied').setDescription(`Applied to **${count}** destination(s).\n\nA complete before-state snapshot is available for Undo.`)],components:[new ActionRowBuilder().addComponents(btn(cid('undo',g.id),'Undo Last Blueprint','↶',ButtonStyle.Danger,!s.history.length),btn(cid('library',g.id),'Preset Library','📚'),btn(cid('home',g.id),'Done','✅'))]};}
async function handle(i){const raw=String(i.customId||'');if(!raw.startsWith(PREFIX))return false;const gid=guildId(raw,i),g=i.client.guilds.cache.get(gid)||await i.client.guilds.fetch(gid).catch(()=>null);if(!g)return false;const s=state(i,g),a=actionId(raw);
  if(a==='home'){await i.update(home(g,s));return true;}if(a==='source'){s.sourceId=i.values[0];s.sourceRoleId=null;await i.update(home(g,s));return true;}if(a==='source-role'){s.sourceRoleId=i.values[0];await i.update(home(g,s));return true;}
  if(a==='save'){const c=g.channels.cache.get(s.sourceId);if(!c)return true;const p=snapshotChannel(g,c,s.sourceRoleId);store(g).push(p);s.presetId=p.id;s.targetIds=[];s.roleMapId=null;await i.update(selected(g,s));return true;}if(a==='library'){await i.update(library(g,s));return true;}if(a==='select'){s.presetId=i.values[0];s.targetIds=[];s.roleMapId=null;await i.update(selected(g,s));return true;}if(a==='selected'){await i.update(selected(g,s));return true;}
  if(a==='targets'){s.targetIds=i.values;await i.update(selected(g,s));return true;}if(a==='map-role'){s.roleMapId=i.values[0];await i.update(selected(g,s));return true;}if(a==='preview'){await i.update(preview(g,s));return true;}if(a==='apply'){await i.deferUpdate();const count=await apply(g,s);await i.editReply(result(g,s,count));return true;}if(a==='undo'){await i.deferUpdate();await undo(g,s);await i.editReply(result(g,s,0));return true;}if(a==='delete'){const list=store(g),idx=list.findIndex(x=>x.id===s.presetId);if(idx>=0)list.splice(idx,1);s.presetId=null;s.targetIds=[];await i.update(library(g,s));return true;}return false;
}
module.exports={PREFIX,handle,home};
