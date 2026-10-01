'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const panel = require('./panel');

const sessions = new Map();
const pending = new Map();
const CHANNEL_PERMISSION_NAMES = new Set([
  'ViewChannel','ManageChannels','ManageRoles','CreateInstantInvite','SendMessages','SendTTSMessages','ManageMessages','EmbedLinks','AttachFiles','ReadMessageHistory','MentionEveryone','UseExternalEmojis','AddReactions','UseApplicationCommands','ManageWebhooks','ManageThreads','CreatePublicThreads','CreatePrivateThreads','SendMessagesInThreads','UseExternalStickers','SendVoiceMessages','SendPolls','Connect','Speak','Stream','UseVAD','PrioritySpeaker','MuteMembers','DeafenMembers','MoveMembers','UseEmbeddedActivities','RequestToSpeak','UseSoundboard','UseExternalSounds','SendMessagesInThreads'
]);

function key(interaction, guild) { return `${interaction.user.id}:${guild.id}`; }
function state(interaction, guild) {
  const k = key(interaction, guild);
  if (!sessions.has(k)) sessions.set(k, { clipboard: null, history: [] });
  return sessions.get(k);
}
function actionId(customId) {
  const raw = String(customId || '');
  if (!raw.startsWith(panel.PREFIX)) return null;
  return raw.slice(panel.PREFIX.length).replace(/:guild:\d{16,25}$/, '');
}
function guildId(customId) { return String(customId || '').match(/:guild:(\d{16,25})$/)?.[1] || null; }
async function guildFor(interaction) {
  const id = guildId(interaction.customId) || interaction.guildId;
  return interaction.client.guilds.cache.get(id) || interaction.client.guilds.fetch(id).catch(() => null);
}
function snapshotRole(role) { return { kind: 'role', id: role.id, label: `@${role.name}`, permissions: role.permissions.bitfield.toString(), copiedAt: Date.now() }; }
function snapshotChannel(channel) {
  return { kind: channel.type === ChannelType.GuildCategory ? 'category' : 'channel', id: channel.id, label: `${channel.type === ChannelType.GuildCategory ? '📁' : '#'} ${channel.name}`, copiedAt: Date.now(), overwrites: [...channel.permissionOverwrites.cache.values()].map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) };
}
function snapshotChannelRole(channel, role) {
  const o = channel.permissionOverwrites.cache.get(role.id);
  return { kind: 'channel-role', id: `${channel.id}:${role.id}`, roleId: role.id, label: `${role.name} @ ${channel.name}`, copiedAt: Date.now(), allow: (o?.allow?.bitfield || 0n).toString(), deny: (o?.deny?.bitfield || 0n).toString() };
}
function report(guild) {
  const roles = [...guild.roles.cache.values()]; const channels = [...guild.channels.cache.values()];
  const unsynced = channels.filter(c => c.type !== ChannelType.GuildCategory && c.parent && !c.permissionsLocked).length;
  let memberOverrides = 0, roleOverrides = 0;
  for (const c of channels) for (const o of c.permissionOverwrites.cache.values()) o.type === 1 ? memberOverrides++ : roleOverrides++;
  const count = p => roles.filter(r => r.permissions.has(p)).length;
  const administrator = count(PermissionFlagsBits.Administrator), manageGuild = count(PermissionFlagsBits.ManageGuild), manageRoles = count(PermissionFlagsBits.ManageRoles), manageChannels = count(PermissionFlagsBits.ManageChannels);
  const notes = [];
  if (administrator) notes.push(`🔴 **${administrator}** role(s) have Administrator.`);
  if (unsynced) notes.push(`🟡 **${unsynced}** channel(s) differ from their category.`);
  if (memberOverrides) notes.push(`🟡 **${memberOverrides}** member-specific overwrite(s) exist.`);
  return { roles: roles.length, categories: channels.filter(c => c.type === ChannelType.GuildCategory).length, channels: channels.filter(c => c.type !== ChannelType.GuildCategory).length, administrator, manageGuild, manageRoles, manageChannels, unsynced, memberOverrides, roleOverrides, notes, critical: administrator > 1 };
}
function roleDiff(a, b) {
  const all = Object.keys(PermissionFlagsBits); return all.filter(p => a.permissions.has(PermissionFlagsBits[p]) !== b.permissions.has(PermissionFlagsBits[p])).map(p => `${a.permissions.has(PermissionFlagsBits[p]) ? '✅' : '❌'} **${p}** → ${b.permissions.has(PermissionFlagsBits[p]) ? '✅' : '❌'}`);
}
function overwriteMap(c) { return new Map([...c.permissionOverwrites.cache.values()].map(o => [o.id, `${o.allow.bitfield}:${o.deny.bitfield}`])); }
function channelDiff(guild, a, b) {
  const am = overwriteMap(a), bm = overwriteMap(b), ids = new Set([...am.keys(), ...bm.keys()]); const lines = [];
  for (const id of ids) if (am.get(id) !== bm.get(id)) lines.push(`• **${guild.roles.cache.get(id)?.name || guild.members.cache.get(id)?.displayName || id}** differs`);
  return lines;
}
function token() { return Math.random().toString(36).slice(2, 10); }
function rememberHistory(s, item) { s.history.push(item); if (s.history.length > 20) s.history.shift(); }

async function applyClipboard(guild, s, target) {
  const clip = s.clipboard;
  if (!clip) throw new Error('Clipboard is empty.');
  if (target.kind === 'role') {
    const role = guild.roles.cache.get(target.id); if (!role || role.managed) throw new Error('Target role cannot be edited.');
    const before = role.permissions.bitfield.toString();
    let next;
    if (clip.kind === 'role') next = BigInt(clip.permissions);
    else throw new Error('Only a copied role can be pasted to a server role.');
    await role.setPermissions(next, 'Goliath Permissions Studio paste');
    return { label: `@${role.name}: role permissions pasted`, undo: { kind: 'role', id: role.id, permissions: before } };
  }
  const channel = guild.channels.cache.get(target.id); if (!channel) throw new Error('Target channel unavailable.');
  const before = snapshotChannel(channel);
  if (clip.kind === 'channel' || clip.kind === 'category') {
    await channel.permissionOverwrites.set(clip.overwrites.map(o => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })), 'Goliath Permissions Studio paste');
  } else if (clip.kind === 'channel-role') {
    await channel.permissionOverwrites.edit(clip.roleId, { allow: BigInt(clip.allow), deny: BigInt(clip.deny) }, { reason: 'Goliath Permissions Studio paste' });
  } else if (clip.kind === 'role') {
    const role = guild.roles.cache.get(clip.id); if (!role) throw new Error('Copied role is unavailable in this server.');
    const allow = Object.entries(PermissionFlagsBits).filter(([name, bit]) => CHANNEL_PERMISSION_NAMES.has(name) && role.permissions.has(bit)).reduce((v, [, bit]) => v | bit, 0n);
    await channel.permissionOverwrites.edit(role.id, { allow, deny: 0n }, { reason: 'Goliath Permissions Studio role-to-channel paste' });
  }
  return { label: `${channel.name}: permissions pasted from ${clip.label}`, undo: { kind: 'channel', id: channel.id, overwrites: before.overwrites } };
}
async function undo(guild, s) {
  const item = s.history.pop(); if (!item?.undo) return false;
  if (item.undo.kind === 'role') { const role = guild.roles.cache.get(item.undo.id); if (role && !role.managed) await role.setPermissions(BigInt(item.undo.permissions), 'Goliath Permissions Studio undo'); }
  if (item.undo.kind === 'channel') { const c = guild.channels.cache.get(item.undo.id); if (c) await c.permissionOverwrites.set(item.undo.overwrites.map(o => ({ id:o.id, type:o.type, allow:BigInt(o.allow), deny:BigInt(o.deny) })), 'Goliath Permissions Studio undo'); }
  return true;
}

async function handle(interaction) {
  const action = actionId(interaction.customId); if (!action) return false;
  const guild = await guildFor(interaction); if (!guild) { await interaction.reply({ content:'❌ Server context unavailable.', ephemeral:true }); return true; }
  const s = state(interaction, guild);
  if (action === 'home') { await interaction.update(panel.home(guild, s)); return true; }
  if (action === 'audit') { await interaction.update(panel.audit(guild)); return true; }
  if (action === 'scan') { await interaction.update(panel.audit(guild, report(guild))); return true; }
  if (action === 'main' || action === 'role-back') { await interaction.update(panel.main(guild)); return true; }
  if (action === 'channels') { await interaction.update(panel.channels(guild)); return true; }
  if (action === 'clipboard') { await interaction.update(panel.clipboard(guild, s)); return true; }
  if (action === 'clear-clipboard') { s.clipboard = null; await interaction.update(panel.clipboard(guild, s)); return true; }
  if (action === 'undo') { await undo(guild, s); await interaction.update(panel.clipboard(guild, s)); return true; }
  if (action === 'role-select') { const role = guild.roles.cache.get(interaction.values[0]); await interaction.update(panel.role(guild, role, s)); return true; }
  if (action === 'channel-select') { const c = guild.channels.cache.get(interaction.values[0]); await interaction.update(panel.channel(guild, c, s)); return true; }
  if (action.startsWith('open-channel-')) { const c = guild.channels.cache.get(action.slice(13)); await interaction.update(panel.channel(guild, c, s)); return true; }
  if (action.startsWith('channel-role-')) { const c = guild.channels.cache.get(action.slice(13)); const r = guild.roles.cache.get(interaction.values[0]); await interaction.update(panel.channelRole(guild, c, r)); return true; }
  if (action.startsWith('copy-role-')) { const r = guild.roles.cache.get(action.slice(10)); s.clipboard = snapshotRole(r); await interaction.update(panel.role(guild, r, s)); return true; }
  if (action.startsWith('copy-channel-role-')) { const [channelId, roleId] = action.slice(18).split('-'); const c = guild.channels.cache.get(channelId), r = guild.roles.cache.get(roleId); s.clipboard = snapshotChannelRole(c, r); await interaction.update(panel.channelRole(guild, c, r)); return true; }
  if (action.startsWith('copy-channel-')) { const c = guild.channels.cache.get(action.slice(13)); s.clipboard = snapshotChannel(c); await interaction.update(panel.channel(guild, c, s)); return true; }
  if (action.startsWith('paste-role-')) { const id = action.slice(11), r = guild.roles.cache.get(id), t = token(); pending.set(`${key(interaction,guild)}:${t}`, { kind:'role', id }); await interaction.update(panel.pastePreview(guild, s.clipboard, `@${r.name}`, t, 'Guild-level role permissions will be replaced by the copied role permissions.')); return true; }
  if (action.startsWith('paste-channel-role-')) { const [channelId, roleId] = action.slice(19).split('-'); const c = guild.channels.cache.get(channelId); const t=token(); pending.set(`${key(interaction,guild)}:${t}`, { kind:'channel', id:channelId }); await interaction.update(panel.pastePreview(guild, s.clipboard, `${guild.roles.cache.get(roleId)?.name} @ ${c.name}`, t, 'The copied permissions will be applied to this channel.')); return true; }
  if (action.startsWith('paste-channel-')) { const id=action.slice(14), c=guild.channels.cache.get(id), t=token(); pending.set(`${key(interaction,guild)}:${t}`, {kind:'channel',id}); await interaction.update(panel.pastePreview(guild,s.clipboard,c.name,t,'Channel/category overwrites will be applied. Role→channel paste creates an overwrite for that role.')); return true; }
  if (action.startsWith('confirm-')) { const t=action.slice(8), pk=`${key(interaction,guild)}:${t}`, target=pending.get(pk); if(!target) throw new Error('Paste preview expired.'); pending.delete(pk); await interaction.deferUpdate(); const h=await applyClipboard(guild,s,target); rememberHistory(s,h); await interaction.editReply(panel.clipboard(guild,s)); return true; }
  if (action.startsWith('sync-channel-')) { const c=guild.channels.cache.get(action.slice(13)); if(c?.parent) { const before=snapshotChannel(c); await c.lockPermissions(); rememberHistory(s,{label:`${c.name}: synced with ${c.parent.name}`,undo:{kind:'channel',id:c.id,overwrites:before.overwrites}}); } await interaction.update(panel.channel(guild,c,s)); return true; }
  if (action.startsWith('compare-role-')) { await interaction.update(panel.comparePicker(guild,'role',action.slice(13))); return true; }
  if (action.startsWith('compare-channel-')) { await interaction.update(panel.comparePicker(guild,'channel',action.slice(16))); return true; }
  if (action.startsWith('compare-target-role-')) { const a=guild.roles.cache.get(action.slice(20)), b=guild.roles.cache.get(interaction.values[0]); await interaction.update(panel.diff(guild,`${a.name} ↔ ${b.name}`,roleDiff(a,b))); return true; }
  if (action.startsWith('compare-target-channel-')) { const a=guild.channels.cache.get(action.slice(23)), b=guild.channels.cache.get(interaction.values[0]); await interaction.update(panel.diff(guild,`${a.name} ↔ ${b.name}`,channelDiff(guild,a,b))); return true; }
  if (action === 'search') { await interaction.update(panel.diff(guild,'Permission Search',['Use the Role and Channels workspaces to inspect effective permissions. Advanced cross-server search and saved blueprints are reserved for the next Permissions Studio expansion.'])); return true; }
  return false;
}

module.exports = { handle, home: (interaction, guild) => panel.home(guild, state(interaction, guild)) };
