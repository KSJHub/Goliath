'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { resolveRuntimePath } = require('../../../config/runtimePaths');

const PREFIX = 'permrestore:';
const sessions = new Map();
const dataDir = resolveRuntimePath(process.env.BOT_MODE, 'database');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'permissions-studio.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS permission_restore_points (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_permission_restore_points_guild ON permission_restore_points(guild_id, created_at DESC);`);

const insert = db.prepare('INSERT INTO permission_restore_points(id,guild_id,owner_id,label,payload,created_at) VALUES(?,?,?,?,?,?)');
const list = db.prepare('SELECT id,label,created_at FROM permission_restore_points WHERE guild_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 25');
const get = db.prepare('SELECT * FROM permission_restore_points WHERE id=? AND guild_id=? AND owner_id=?');
const remove = db.prepare('DELETE FROM permission_restore_points WHERE id=? AND guild_id=? AND owner_id=?');
const cid = (a,g) => `${PREFIX}${a}:guild:${g}`;
const aid = id => String(id||'').replace(/^permrestore:/,'').replace(/:guild:\d{16,25}$/,'');
const gid = (id,i) => String(id||'').match(/:guild:(\d{16,25})$/)?.[1] || i.guildId;
const button = (id,label,emoji,style=ButtonStyle.Secondary,disabled=false) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
function state(i,g){const k=`${i.user.id}:${g.id}`;if(!sessions.has(k))sessions.set(k,{selected:null});return sessions.get(k);}
function snapshot(g){return {roles:[...g.roles.cache.values()].filter(r=>!r.managed).map(r=>({id:r.id,name:r.name,permissions:r.permissions.bitfield.toString()})),channels:[...g.channels.cache.values()].map(c=>({id:c.id,name:c.name,overwrites:[...c.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:o.allow.bitfield.toString(),deny:o.deny.bitfield.toString()}))}))};}
function home(g,s,i){const points=list.all(g.id,i.user.id);const chosen=points.find(x=>x.id===s.selected);const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🕘 Permission Restore Points').setDescription(['Take a complete permission snapshot before major work, then roll the server permission structure back if needed.','',`**Saved restore points:** ${points.length}`,`**Selected:** ${chosen?`**${chosen.label}** • <t:${Math.floor(chosen.created_at/1000)}:R>`:'None'}`,'','Snapshots include editable guild-role permission bitfields and every channel/category overwrite. Roles/channels that no longer exist are safely skipped during restore.'].join('\n')).setFooter({text:'Persistent • owner-only • DEV/BETA/Production storage remains isolated'});const rows=[];if(points.length){rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(cid('select',g.id)).setPlaceholder('Choose restore point…').addOptions(points.map(p=>({label:p.label.slice(0,100),value:p.id,description:new Date(p.created_at).toLocaleString().slice(0,100)})))));}rows.push(new ActionRowBuilder().addComponents(button(cid('create',g.id),'Create Restore Point','📸',ButtonStyle.Primary),button(cid('preview',g.id),'Preview Restore','🔎',ButtonStyle.Secondary,!s.selected),button(cid('delete',g.id),'Delete','🗑️',ButtonStyle.Danger,!s.selected),button(`permstudio:home:guild:${g.id}`,'Back','⬅️')));return{embeds:[embed],components:rows};}
function diff(g,data){let roleChanges=0,channelChanges=0,missingRoles=0,missingChannels=0;for(const r of data.roles||[]){const current=g.roles.cache.get(r.id);if(!current){missingRoles++;continue;}if(current.permissions.bitfield.toString()!==r.permissions)roleChanges++;}for(const c of data.channels||[]){const current=g.channels.cache.get(c.id);if(!current){missingChannels++;continue;}const now=[...current.permissionOverwrites.cache.values()].map(o=>`${o.id}:${o.type}:${o.allow.bitfield}:${o.deny.bitfield}`).sort().join('|');const then=(c.overwrites||[]).map(o=>`${o.id}:${o.type}:${o.allow}:${o.deny}`).sort().join('|');if(now!==then)channelChanges++;}return{roleChanges,channelChanges,missingRoles,missingChannels};}
function preview(g,s,i){const row=get.get(s.selected,g.id,i.user.id);if(!row)return home(g,s,i);const data=JSON.parse(row.payload),d=diff(g,data);const embed=new EmbedBuilder().setColor(0xFEE75C).setTitle('🔎 Restore Preview').setDescription(`**Restore point:** ${row.label}\nCreated: <t:${Math.floor(row.created_at/1000)}:F>\n\n**Guild roles to restore:** ${d.roleChanges}\n**Channels/categories to restore:** ${d.channelChanges}\n**Missing roles skipped:** ${d.missingRoles}\n**Missing channels skipped:** ${d.missingChannels}\n\nNothing has changed yet.`).setFooter({text:'A safety restore point of the current state is created automatically before rollback.'});return{embeds:[embed],components:[new ActionRowBuilder().addComponents(button(cid('apply',g.id),'Restore Permissions','↶',ButtonStyle.Danger),button(cid('home',g.id),'Cancel','✖️'))]};}
function savePoint(g,i,label){const id=`rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;insert.run(id,g.id,i.user.id,label,JSON.stringify(snapshot(g)),Date.now());return id;}
async function restore(g,row){const data=JSON.parse(row.payload);let roles=0,channels=0,skipped=0;for(const r of data.roles||[]){const current=g.roles.cache.get(r.id);if(!current||current.managed||current.id===g.id){skipped++;continue;}if(current.permissions.bitfield.toString()!==r.permissions){await current.setPermissions(BigInt(r.permissions),'Goliath Permissions Studio restore point');roles++;}}for(const c of data.channels||[]){const current=g.channels.cache.get(c.id);if(!current){skipped++;continue;}const mapped=(c.overwrites||[]).filter(o=>o.type===1?g.members.cache.has(o.id):g.roles.cache.has(o.id)).map(o=>({id:o.id,type:o.type,allow:BigInt(o.allow),deny:BigInt(o.deny)}));await current.permissionOverwrites.set(mapped,'Goliath Permissions Studio restore point');channels++;}return{roles,channels,skipped};}
async function handle(i){const raw=String(i.customId||'');if(!raw.startsWith(PREFIX))return false;if(!i.deferred&&!i.replied)await i.deferUpdate();const gId=gid(raw,i),g=i.client.guilds.cache.get(gId)||await i.client.guilds.fetch(gId).catch(()=>null);if(!g)return false;const s=state(i,g),a=aid(raw);if(a==='home'){await i.editReply(home(g,s,i));return true;}if(a==='select'){s.selected=i.values[0];await i.editReply(home(g,s,i));return true;}if(a==='create'){s.selected=savePoint(g,i,`Manual • ${new Date().toLocaleString()}`);await i.editReply(home(g,s,i));return true;}if(a==='delete'){if(s.selected)remove.run(s.selected,g.id,i.user.id);s.selected=null;await i.editReply(home(g,s,i));return true;}if(a==='preview'){await i.editReply(preview(g,s,i));return true;}if(a==='apply'){const row=get.get(s.selected,g.id,i.user.id);if(!row){await i.editReply(home(g,s,i));return true;}savePoint(g,i,`Auto backup before restore • ${new Date().toLocaleString()}`);const result=await restore(g,row);await i.editReply({embeds:[new EmbedBuilder().setColor(0x57F287).setTitle('↶ Permission Restore Complete').setDescription(`Restored **${result.roles}** role permission set(s) and **${result.channels}** channel/category overwrite set(s).\nSkipped unavailable/protected objects: **${result.skipped}**.\n\nA safety backup of the pre-restore state was saved automatically.`)],components:[new ActionRowBuilder().addComponents(button(cid('home',g.id),'Restore Points','🕘'),button(`permstudio:home:guild:${g.id}`,'Back to Studio','⬅️'))]});return true;}return false;}
module.exports={PREFIX,handle,home};
