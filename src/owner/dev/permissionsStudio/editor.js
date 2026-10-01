'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, EmbedBuilder, PermissionFlagsBits, RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const PREFIX = 'permedit:';
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

const cid = (action, guildId) => `${PREFIX}${action}:guild:${guildId}`;
function actionId(id) { return String(id || '').replace(/^permedit:/,'').replace(/:guild:\d{16,25}$/,''); }
function guildId(id, interaction) { return String(id || '').match(/:guild:(\d{16,25})$/)?.[1] || interaction.guildId; }
function sk(interaction, guild) { return `${interaction.user.id}:${guild.id}`; }
function state(interaction, guild) {
  const k=sk(interaction,guild); if(!sessions.has(k)) sessions.set(k,{ channelId:null, roleId:null, draft:new Map(), dirty:false }); return sessions.get(k);
}
function btn(id,label,emoji,style=ButtonStyle.Secondary,disabled=false){return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);}
function selected(guild,s){return {channel:guild.channels.cache.get(s.channelId),role:guild.roles.cache.get(s.roleId)};}
function overwriteState(channel,role,name){
  const o=channel?.permissionOverwrites?.cache?.get(role?.id); const bit=PermissionFlagsBits[name];
  if(!bit) return 'inherit'; if(o?.allow?.has(bit)) return 'allow'; if(o?.deny?.has(bit)) return 'deny'; return 'inherit';
}
function effective(channel,role,name){const bit=PermissionFlagsBits[name];return Boolean(bit&&channel?.permissionsFor(role)?.has(bit));}
function currentState(channel,role,s,name){return s.draft.has(name)?s.draft.get(name):overwriteState(channel,role,name);}
function home(guild,s){
  const {channel,role}=selected(guild,s);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🎚️ Permission Editor').setDescription([
    'Discord-style **Allow / Inherit / Deny** editing for one role on one category or channel.', '',
    `**Target:** ${channel ? `${channel.type===ChannelType.GuildCategory?'📁':'#️⃣'} ${channel.name}` : 'Not selected'}`,
    `**Role:** ${role ? `@${role.name}` : 'Not selected'}`,
    s.dirty?'\n🟡 **Unsaved permission changes are staged.**':'\nNo staged changes.',
  ].join('\n')).setFooter({text:'Changes are previewed before Discord is modified.'});
  const channelPicker=new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid('channel',guild.id)).setPlaceholder(channel?`Target: ${channel.name}`:'Select category/channel…').setMinValues(1).setMaxValues(1).addChannelTypes(ChannelType.GuildCategory,ChannelType.GuildText,ChannelType.GuildAnnouncement,ChannelType.GuildVoice,ChannelType.GuildStageVoice,ChannelType.GuildForum,ChannelType.GuildMedia));
  const rolePicker=new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid('role',guild.id)).setPlaceholder(role?`Role: ${role.name}`:'Select role…').setMinValues(1).setMaxValues(1));
  const actions=new ActionRowBuilder().addComponents(btn(cid('open',guild.id),'Edit Permissions','🎚️',ButtonStyle.Primary,!channel||!role),btn(cid('discard',guild.id),'Discard Draft','🗑️',ButtonStyle.Secondary,!s.dirty),btn(`permstudio:home:guild:${guild.id}`,'Back to Studio','⬅️'));
  return {embeds:[embed],components:[channelPicker,rolePicker,actions]};
}
function editor(guild,s,page=0){
  const {channel,role}=selected(guild,s); const start=page*10; const items=PERMISSIONS.slice(start,start+10);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(`🎚️ ${role.name} → ${channel.name}`).setDescription(items.map(([name,label])=>{
    const st=currentState(channel,role,s,name); const icon=st==='allow'?'✅':st==='deny'?'❌':'➖'; const eff=effective(channel,role,name)?'✅ effective':'❌ effective'; return `${icon} **${label}** — ${st.toUpperCase()} • ${eff}`;
  }).join('\n')).addFields({name:'How it works',value:'✅ **Allow** explicitly grants • ➖ **Inherit** removes the explicit overwrite • ❌ **Deny** explicitly blocks.'});
  const menu=new StringSelectMenuBuilder().setCustomId(cid(`permission-${page}`,guild.id)).setPlaceholder('Choose a permission to change…').setMinValues(1).setMaxValues(1).addOptions(items.map(([value,label])=>({label,value,description:`Current: ${currentState(channel,role,s,value).toUpperCase()}`})));
  const nav=new ActionRowBuilder().addComponents(btn(cid(`page-${Math.max(0,page-1)}`,guild.id),'Previous','⬅️',ButtonStyle.Secondary,page===0),btn(cid(`page-${Math.min(2,page+1)}`,guild.id),'Next','➡️',ButtonStyle.Secondary,start+10>=PERMISSIONS.length),btn(cid('preview',guild.id),'Preview Changes','🔎',ButtonStyle.Primary,!s.dirty),btn(cid('home',guild.id),'Targets','🎯'));
  return {embeds:[embed],components:[new ActionRowBuilder().addComponents(menu),nav]};
}
function chooseState(guild,s,name,page){
  const {channel,role}=selected(guild,s); const label=PERMISSIONS.find(([n])=>n===name)?.[1]||name; const now=currentState(channel,role,s,name);
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(`🎚️ ${label}`).setDescription(`**${role.name}** → **${channel.name}**\n\nCurrent explicit state: **${now.toUpperCase()}**\nEffective permission: **${effective(channel,role,name)?'ALLOWED':'DENIED'}**\n\nChoose the explicit overwrite state.`);
  const row=new ActionRowBuilder().addComponents(btn(cid(`set-${name}-allow-${page}`,guild.id),'Allow','✅',ButtonStyle.Success),btn(cid(`set-${name}-inherit-${page}`,guild.id),'Inherit','➖',ButtonStyle.Secondary),btn(cid(`set-${name}-deny-${page}`,guild.id),'Deny','❌',ButtonStyle.Danger),btn(cid(`page-${page}`,guild.id),'Cancel','⬅️'));
  return {embeds:[embed],components:[row]};
}
function preview(guild,s){
  const {channel,role}=selected(guild,s); const changes=[...s.draft.entries()].filter(([name,value])=>value!==overwriteState(channel,role,name));
  const embed=new EmbedBuilder().setColor(0xFEE75C).setTitle('🔎 Permission Change Preview').setDescription(changes.length?changes.map(([name,value])=>{const label=PERMISSIONS.find(([n])=>n===name)?.[1]||name;return `• **${label}:** ${overwriteState(channel,role,name).toUpperCase()} → **${value.toUpperCase()}**`;}).join('\n'):'No effective changes are staged.').addFields({name:'Target',value:`${role.name} → ${channel.name}`}).setFooter({text:'Discord has not been modified yet.'});
  const row=new ActionRowBuilder().addComponents(btn(cid('apply',guild.id),'Apply Changes','✅',ButtonStyle.Success,!changes.length),btn(cid('open',guild.id),'Back to Editor','⬅️'),btn(cid('discard',guild.id),'Discard','🗑️',ButtonStyle.Danger));
  return {embeds:[embed],components:[row]};
}
async function apply(guild,s){
  const {channel,role}=selected(guild,s); if(!channel||!role) throw new Error('Permission target is no longer available.');
  const o=channel.permissionOverwrites.cache.get(role.id); let allow=o?.allow?.bitfield||0n, deny=o?.deny?.bitfield||0n;
  for(const [name,value] of s.draft.entries()) { const bit=PermissionFlagsBits[name]; if(!bit) continue; allow&=~bit; deny&=~bit; if(value==='allow')allow|=bit; if(value==='deny')deny|=bit; }
  await channel.permissionOverwrites.edit(role.id,{allow,deny},{reason:'Goliath Permissions Studio tri-state editor'});
  s.draft.clear(); s.dirty=false;
}
async function handle(interaction){
  const raw=String(interaction.customId||''); if(!raw.startsWith(PREFIX))return false; const gid=guildId(raw,interaction); const guild=interaction.client.guilds.cache.get(gid)||await interaction.client.guilds.fetch(gid).catch(()=>null); if(!guild)return false; const s=state(interaction,guild); const action=actionId(raw);
  if(action==='home'){await interaction.update(home(guild,s));return true;}
  if(action==='channel'){s.channelId=interaction.values[0];s.draft.clear();s.dirty=false;await interaction.update(home(guild,s));return true;}
  if(action==='role'){s.roleId=interaction.values[0];s.draft.clear();s.dirty=false;await interaction.update(home(guild,s));return true;}
  if(action==='open'){await interaction.update(editor(guild,s,0));return true;}
  if(action.startsWith('page-')){await interaction.update(editor(guild,s,Number(action.slice(5))||0));return true;}
  if(action.startsWith('permission-')){const page=Number(action.slice(11))||0;await interaction.update(chooseState(guild,s,interaction.values[0],page));return true;}
  if(action.startsWith('set-')){const m=action.match(/^set-(.+)-(allow|inherit|deny)-(\d+)$/);if(m){s.draft.set(m[1],m[2]);s.dirty=true;await interaction.update(editor(guild,s,Number(m[3])));return true;}}
  if(action==='preview'){await interaction.update(preview(guild,s));return true;}
  if(action==='discard'){s.draft.clear();s.dirty=false;await interaction.update(home(guild,s));return true;}
  if(action==='apply'){await interaction.deferUpdate();await apply(guild,s);await interaction.editReply(home(guild,s));return true;}
  return false;
}
module.exports={PREFIX,handle,home};
