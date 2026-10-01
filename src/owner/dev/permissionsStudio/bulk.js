'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, EmbedBuilder, PermissionFlagsBits, RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const PREFIX = 'permbulk:';
const sessions = new Map();
const PERMISSIONS = [
  ['ViewChannel','View Channel'],['SendMessages','Send Messages'],['ReadMessageHistory','Read Message History'],
  ['AddReactions','Add Reactions'],['EmbedLinks','Embed Links'],['AttachFiles','Attach Files'],
  ['MentionEveryone','Mention @everyone / @here'],['ManageMessages','Manage Messages'],['ManageChannels','Manage Channel'],
  ['ManageRoles','Manage Permissions'],['CreateInstantInvite','Create Invite'],['ManageWebhooks','Manage Webhooks'],
  ['ManageThreads','Manage Threads'],['CreatePublicThreads','Create Public Threads'],['CreatePrivateThreads','Create Private Threads'],
  ['SendMessagesInThreads','Send Messages in Threads'],['Connect','Connect'],['Speak','Speak'],['Stream','Video / Stream'],
  ['UseVAD','Use Voice Activity'],['PrioritySpeaker','Priority Speaker'],['MuteMembers','Mute Members'],
  ['DeafenMembers','Deafen Members'],['MoveMembers','Move Members'],['UseEmbeddedActivities','Use Activities'],
];
const cid=(action,guildId)=>`${PREFIX}${action}:guild:${guildId}`;
const actionId=id=>String(id||'').replace(/^permbulk:/,'').replace(/:guild:\d{16,25}$/,'');
const guildId=(id,i)=>String(id||'').match(/:guild:(\d{16,25})$/)?.[1]||i.guildId;
const btn=(id,label,emoji,style=ButtonStyle.Secondary,disabled=false)=>new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
function sk(i,g){return `${i.user.id}:${g.id}`;}
function state(i,g){const k=sk(i,g);if(!sessions.has(k))sessions.set(k,{channelIds:[],roleIds:[],draft:new Map(),mode:'merge',history:[]});return sessions.get(k);}
function targets(g,s){return {channels:s.channelIds.map(id=>g.channels.cache.get(id)).filter(Boolean),roles:s.roleIds.map(id=>g.roles.cache.get(id)).filter(Boolean)};}
function snapshot(channel){return {id:channel.id,overwrites:[...channel.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:o.allow.bitfield.toString(),deny:o.deny.bitfield.toString()}))};}
function home(g,s){
  const {channels,roles}=targets(g,s); const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🧰 Bulk Permission Editor').setDescription([
    'Apply the same **Allow / Inherit / Deny** changes across multiple channels/categories and roles.', '',
    `**Targets:** ${channels.length} channel/category target(s) × ${roles.length} role(s)`,
    `**Mode:** ${s.mode==='merge'?'MERGE — only staged permissions change':'REPLACE — target role overwrites are reset before staged permissions apply'}`,
    `**Staged:** ${s.draft.size} permission change(s)`, '',
    channels.length?`Channels: ${channels.slice(0,8).map(c=>`**${c.name}**`).join(', ')}${channels.length>8?'…':''}`:'Channels: none selected',
    roles.length?`Roles: ${roles.slice(0,8).map(r=>`**${r.name}**`).join(', ')}${roles.length>8?'…':''}`:'Roles: none selected',
  ].join('\n')).setFooter({text:'Bulk changes are always previewed before Discord is modified.'});
  const channelPicker=new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid('channels',g.id)).setPlaceholder('Select up to 25 channels/categories…').setMinValues(1).setMaxValues(25).addChannelTypes(ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice,ChannelType.GuildStageVoice,ChannelType.GuildForum,ChannelType.GuildMedia));
  const rolePicker=new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid('roles',g.id)).setPlaceholder('Select up to 25 roles…').setMinValues(1).setMaxValues(25));
  const actions=new ActionRowBuilder().addComponents(btn(cid('edit',g.id),'Set Permissions','🎚️',ButtonStyle.Primary,!channels.length||!roles.length),btn(cid('mode',g.id),s.mode==='merge'?'Mode: Merge':'Mode: Replace',s.mode==='merge'?'➕':'♻️'),btn(cid('preview',g.id),'Preview','🔎',ButtonStyle.Secondary,!s.draft.size||!channels.length||!roles.length),btn(cid('clear',g.id),'Clear','🗑️',ButtonStyle.Secondary,!s.draft.size),btn(`permstudio:home:guild:${g.id}`,'Studio','⬅️'));
  return {embeds:[embed],components:[channelPicker,rolePicker,actions]};
}
function editor(g,s,page=0){
  const start=page*10,items=PERMISSIONS.slice(start,start+10); const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🎚️ Bulk Permission Changes').setDescription(items.map(([n,l])=>`${s.draft.get(n)==='allow'?'✅':s.draft.get(n)==='deny'?'❌':s.draft.get(n)==='inherit'?'➖':'▫️'} **${l}** — ${s.draft.has(n)?s.draft.get(n).toUpperCase():'UNCHANGED'}`).join('\n')).addFields({name:'Important',value:'**UNCHANGED** leaves that permission alone. **INHERIT** removes an explicit Allow/Deny for the selected role(s).'});
  const menu=new StringSelectMenuBuilder().setCustomId(cid(`permission-${page}`,g.id)).setPlaceholder('Choose a permission…').addOptions(items.map(([value,label])=>({label,value,description:s.draft.has(value)?`Staged: ${s.draft.get(value).toUpperCase()}`:'Unchanged'})));
  const nav=new ActionRowBuilder().addComponents(btn(cid(`page-${Math.max(0,page-1)}`,g.id),'Previous','⬅️',ButtonStyle.Secondary,page===0),btn(cid(`page-${Math.min(2,page+1)}`,g.id),'Next','➡️',ButtonStyle.Secondary,start+10>=PERMISSIONS.length),btn(cid('preview',g.id),'Preview','🔎',ButtonStyle.Primary,!s.draft.size),btn(cid('home',g.id),'Targets','🎯'));
  return {embeds:[embed],components:[new ActionRowBuilder().addComponents(menu),nav]};
}
function choose(g,s,name,page){const label=PERMISSIONS.find(([n])=>n===name)?.[1]||name;const row=new ActionRowBuilder().addComponents(btn(cid(`set-${name}-allow-${page}`,g.id),'Allow','✅',ButtonStyle.Success),btn(cid(`set-${name}-inherit-${page}`,g.id),'Inherit','➖'),btn(cid(`set-${name}-deny-${page}`,g.id),'Deny','❌',ButtonStyle.Danger),btn(cid(`unset-${name}-${page}`,g.id),'Unchanged','▫️'),btn(cid(`page-${page}`,g.id),'Cancel','⬅️'));return {embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(`Bulk • ${label}`).setDescription('Choose what this permission should become for **every selected role × channel target**.')],components:[row]};}
function preview(g,s){const {channels,roles}=targets(g,s);const ops=channels.length*roles.length;const lines=[...s.draft].map(([n,v])=>`• **${PERMISSIONS.find(([x])=>x===n)?.[1]||n}:** ${v.toUpperCase()}`);const embed=new EmbedBuilder().setColor(0xFEE75C).setTitle('🔎 Bulk Change Preview').setDescription(lines.join('\n')).addFields({name:'Scope',value:`**${channels.length}** channels/categories × **${roles.length}** roles = **${ops}** overwrite target(s)`},{name:'Mode',value:s.mode==='merge'?'**MERGE:** preserve every unstaged permission.':'**REPLACE:** clear each selected role overwrite first, then apply the staged states.'}).setFooter({text:'A complete before-state snapshot will be retained for Undo.'});const row=new ActionRowBuilder().addComponents(btn(cid('apply',g.id),'Apply Bulk Changes','✅',ButtonStyle.Success),btn(cid('edit',g.id),'Back','⬅️'),btn(cid('clear',g.id),'Discard Draft','🗑️',ButtonStyle.Danger));return {embeds:[embed],components:[row]};}
async function apply(g,s){
  const {channels,roles}=targets(g,s); const before=channels.map(snapshot);
  for(const channel of channels){for(const role of roles){
    const existing=channel.permissionOverwrites.cache.get(role.id); let allow=s.mode==='replace'?0n:(existing?.allow?.bitfield||0n); let deny=s.mode==='replace'?0n:(existing?.deny?.bitfield||0n);
    for(const [name,value] of s.draft){const bit=PermissionFlagsBits[name];if(!bit)continue;allow&=~bit;deny&=~bit;if(value==='allow')allow|=bit;if(value==='deny')deny|=bit;}
    await channel.permissionOverwrites.edit(role.id,{allow,deny},{reason:`Goliath Permissions Studio bulk ${s.mode}`});
  }}
  s.history.push({label:`Bulk ${s.mode}: ${channels.length} target(s) × ${roles.length} role(s)`,before}); if(s.history.length>10)s.history.shift(); s.draft.clear();
}
async function undo(g,s){const h=s.history.pop();if(!h)return false;for(const snap of h.before){const c=g.channels.cache.get(snap.id);if(c)await c.permissionOverwrites.set(snap.overwrites.map(o=>({id:o.id,type:o.type,allow:BigInt(o.allow),deny:BigInt(o.deny)})),'Goliath Permissions Studio bulk undo');}return true;}
function history(g,s){const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('↶ Bulk Change History').setDescription(s.history.length?s.history.slice().reverse().map((h,i)=>`${i===0?'**Latest:**':'•'} ${h.label}`).join('\n'):'No bulk changes this session.');return {embeds:[embed],components:[new ActionRowBuilder().addComponents(btn(cid('undo',g.id),'Undo Last Bulk Change','↶',ButtonStyle.Danger,!s.history.length),btn(cid('home',g.id),'Back','⬅️'))]};}
async function handle(i){const raw=String(i.customId||'');if(!raw.startsWith(PREFIX))return false;const gid=guildId(raw,i),g=i.client.guilds.cache.get(gid)||await i.client.guilds.fetch(gid).catch(()=>null);if(!g)return false;const s=state(i,g),a=actionId(raw);
  if(a==='home'){await i.update(home(g,s));return true;} if(a==='channels'){s.channelIds=i.values;await i.update(home(g,s));return true;} if(a==='roles'){s.roleIds=i.values;await i.update(home(g,s));return true;}
  if(a==='mode'){s.mode=s.mode==='merge'?'replace':'merge';await i.update(home(g,s));return true;} if(a==='edit'){await i.update(editor(g,s,0));return true;} if(a.startsWith('page-')){await i.update(editor(g,s,Number(a.slice(5))||0));return true;}
  if(a.startsWith('permission-')){const p=Number(a.slice(11))||0;await i.update(choose(g,s,i.values[0],p));return true;} const m=a.match(/^set-(.+)-(allow|inherit|deny)-(\d+)$/);if(m){s.draft.set(m[1],m[2]);await i.update(editor(g,s,Number(m[3])));return true;} const u=a.match(/^unset-(.+)-(\d+)$/);if(u){s.draft.delete(u[1]);await i.update(editor(g,s,Number(u[2])));return true;}
  if(a==='preview'){await i.update(preview(g,s));return true;} if(a==='clear'){s.draft.clear();await i.update(home(g,s));return true;} if(a==='apply'){await i.deferUpdate();await apply(g,s);await i.editReply(history(g,s));return true;} if(a==='history'){await i.update(history(g,s));return true;} if(a==='undo'){await i.deferUpdate();await undo(g,s);await i.editReply(history(g,s));return true;} return false;
}
module.exports={PREFIX,handle,home};
