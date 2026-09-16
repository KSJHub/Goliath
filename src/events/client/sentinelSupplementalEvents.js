'use strict';

const { Events } = require('discord.js');
const sentinel = require('../../owner/sentinel/eventPipeline');

const recent = new Map();
const DEDUPE_MS = 2500;
function userState(user) { return user ? { id: user.id, username: user.username || null, globalName: user.globalName || null, bot: Boolean(user.bot), avatar: user.avatar || null } : null; }
function stageState(stage) { return stage ? { id: stage.id, guildId: stage.guildId, channelId: stage.channelId, topic: stage.topic || null, privacyLevel: stage.privacyLevel, discoverableDisabled: stage.discoverableDisabled } : null; }
function safe(client, input) { return sentinel.captureEvent(client, input).catch((error) => console.warn('[Sentinel] supplemental event capture failed:', error?.message || error)); }
function once(value) { const now = Date.now(); const previous = recent.get(value) || 0; recent.set(value, now); if (recent.size > 1000) for (const [k, at] of recent) if (now - at > 30000) recent.delete(k); return now - previous > DEDUPE_MS; }
function auditEntryState(entry) { return entry ? { id: entry.id, action: entry.action, actionType: entry.actionType || null, executorId: entry.executorId || entry.executor?.id || null, executorTag: entry.executor?.tag || entry.executor?.username || null, targetId: entry.targetId || entry.target?.id || null, targetType: entry.targetType || null, reason: entry.reason || null, createdAt: entry.createdAt?.toISOString?.() || null, changes: Array.isArray(entry.changes) ? entry.changes : [], extra: entry.extra || null } : null; }
function actionLabel(action) {
  const labels = { 1:'Guild Updated',10:'Channel Created',11:'Channel Updated',12:'Channel Deleted',13:'Channel Permission Added',14:'Channel Permission Updated',15:'Channel Permission Removed',20:'Member Kicked',21:'Members Pruned',22:'Member Banned',23:'Member Unbanned',24:'Member Updated',25:'Member Roles Updated',26:'Members Moved',27:'Members Disconnected',28:'Bot Added',30:'Role Created',31:'Role Updated',32:'Role Deleted',40:'Invite Created',41:'Invite Updated',42:'Invite Deleted',50:'Webhook Created',51:'Webhook Updated',52:'Webhook Deleted',60:'Emoji Created',61:'Emoji Updated',62:'Emoji Deleted',72:'Message Deleted',73:'Messages Bulk Deleted',74:'Message Pinned',75:'Message Unpinned',80:'Integration Created',81:'Integration Updated',82:'Integration Deleted',83:'Stage Created',84:'Stage Updated',85:'Stage Deleted',90:'Sticker Created',91:'Sticker Updated',92:'Sticker Deleted',100:'Scheduled Event Created',101:'Scheduled Event Updated',102:'Scheduled Event Deleted',110:'Thread Created',111:'Thread Updated',112:'Thread Deleted',121:'AutoMod Rule Created',122:'AutoMod Rule Updated',123:'AutoMod Rule Deleted',140:'Voice Channel Status Updated' };
  return labels[Number(action)] || 'Discord Administrative Action';
}
function wire(client, event, handler) { if (!event) return; client.on(event, (...args) => { try { handler(...args); } catch (error) { console.warn(`[Sentinel] ${event} listener failed:`, error?.message || error); } }); }

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    // Existing Audit Intelligence listeners remain the mature gateway collector.
    // This file fills gateway gaps and ingests Discord's own audit-log stream so
    // Sentinel has independent actor/reason evidence as well as observed changes.
    wire(client, Events.MessageCreate, (message) => {
      if (!message?.guild || message.author?.bot) return;
      safe(client, { type:'message.create', category:'message', action:'create', title:'Message Created', icon:'💬', guild:message.guild, channel:message.channel, user:message.author, target:{ id:message.id, label:`Message ${message.id}` }, after:{ id:message.id, content:message.content || null, authorId:message.author.id, channelId:message.channelId, attachments:[...(message.attachments?.values?.() || [])].map((a) => ({ id:a.id, name:a.name, url:a.url, size:a.size })) } });
    });
    wire(client, Events.MessageReactionRemoveAll, (message, reactions) => { if (message?.guild) safe(client, { type:'reaction.clear', category:'message', action:'delete', title:'Message Reactions Cleared', icon:'🧹', guild:message.guild, channel:message.channel, target:{ id:message.id, label:`Message ${message.id}` }, metadata:{ reactionCount:reactions?.size || 0 } }); });
    wire(client, Events.MessageReactionRemoveEmoji, (reaction) => { const message = reaction?.message; if (message?.guild) safe(client, { type:'reaction.emojiClear', category:'message', action:'delete', title:'Emoji Reactions Cleared', icon:'🧹', guild:message.guild, channel:message.channel, target:{ id:message.id, label:`Message ${message.id}` }, metadata:{ emoji:reaction.emoji?.name || null, emojiId:reaction.emoji?.id || null, count:reaction.count || 0 } }); });
    wire(client, Events.GuildIntegrationsUpdate, (guild) => safe(client, { type:'guild.integrationsUpdate', category:'guild', action:'update', title:'Guild Integrations Updated', icon:'🔌', guild, target:{ id:guild.id, label:guild.name } }));
    wire(client, Events.StageInstanceCreate, (stage) => safe(client, { type:'stage.create', category:'voice', action:'create', title:'Stage Created', icon:'🎙️', guild:stage.guild, channel:stage.channel || null, target:{ id:stage.id, label:stage.topic || 'Stage' }, after:stageState(stage) }));
    wire(client, Events.StageInstanceUpdate, (before, after) => safe(client, { type:'stage.update', category:'voice', action:'update', title:'Stage Updated', icon:'🎙️', guild:after.guild, channel:after.channel || null, target:{ id:after.id, label:after.topic || 'Stage' }, before:stageState(before), after:stageState(after) }));
    wire(client, Events.StageInstanceDelete, (stage) => safe(client, { type:'stage.delete', category:'voice', action:'delete', title:'Stage Deleted', icon:'🎙️', guild:stage.guild, channel:stage.channel || null, target:{ id:stage.id, label:stage.topic || 'Stage' }, before:stageState(stage) }));
    wire(client, Events.ThreadMembersUpdate, (added, removed, thread) => { if (thread?.guild) safe(client, { type:'thread.members', category:'guild', action:'update', title:'Thread Membership Updated', icon:'🧵', guild:thread.guild, channel:thread, target:{ id:thread.id, label:thread.name }, metadata:{ added:[...(added?.keys?.() || [])], removed:[...(removed?.keys?.() || [])] } }); });
    wire(client, Events.UserUpdate, (before, after) => { for (const guild of client.guilds.cache.values()) if (guild.members.cache.has(after.id)) safe(client, { type:'user.update', category:'member', action:'update', title:'User Profile Updated', icon:'👤', guild, user:after, target:{ id:after.id, label:after.tag || after.username }, before:userState(before), after:userState(after) }); });
    wire(client, Events.GuildAuditLogEntryCreate, (entry, guild) => {
      if (!entry || !guild || !once(`audit:${guild.id}:${entry.id}`)) return;
      const executor = entry.executor || null; const target = entry.target || null;
      safe(client, { type:`discord.audit.${entry.action}`, category:'guild', action:'audit', title:actionLabel(entry.action), icon:'📹', guild, user:executor, actor:executor ? { id:executor.id, username:executor.username || null, tag:executor.tag || null, bot:Boolean(executor.bot) } : null, target:{ id:entry.targetId || target?.id || guild.id, label:target?.name || target?.username || target?.tag || entry.targetType || 'Discord object' }, reason:entry.reason || null, after:auditEntryState(entry), metadata:{ discordAuditLog:true, auditLogEntryId:entry.id, auditAction:entry.action, auditActionType:entry.actionType || null, executorId:entry.executorId || executor?.id || null, targetId:entry.targetId || target?.id || null, evidenceSource:'Discord Audit Log gateway' } });
    });
    wire(client, Events.GuildAvailable, (guild) => safe(client, { type:'guild.available', category:'guild', action:'available', title:'Guild Connection Available', icon:'🟢', guild, target:{ id:guild.id, label:guild.name }, metadata:{ memberCount:guild.memberCount } }));
    wire(client, Events.GuildUnavailable, (guild) => safe(client, { type:'guild.unavailable', category:'guild', action:'unavailable', title:'Guild Connection Unavailable', icon:'🔴', guild, target:{ id:guild.id, label:guild.name } }));
    wire(client, Events.Invalidated, () => { for (const guild of client.guilds.cache.values()) safe(client, { type:'gateway.invalidated', category:'guild', action:'disconnect', title:'Discord Session Invalidated', icon:'⚠️', guild, target:{ id:guild.id, label:guild.name }, metadata:{ environment:String(process.env.BOT_MODE || 'DEV').toUpperCase() } }); });
    wire(client, Events.Error, (error) => { for (const guild of client.guilds.cache.values()) safe(client, { type:'gateway.error', category:'goliath', action:'error', title:'Discord Gateway Error', icon:'⚠️', guild, target:{ id:guild.id, label:guild.name }, metadata:{ error:String(error?.message || error).slice(0,1000) } }); });
  },
};
