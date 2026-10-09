'use strict';
const { PermissionFlagsBits } = require('discord.js');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const { buildInviteUsedNotice } = require('../../../core/ui/systemNotices');
const emojis = require('../../utilityStudio/emojis/emojis');
const invites = require('./invites');
const panel = require('./invitesPanel');
const timers = new Map();
const operations = new Map();
function savePanelConfig(guildId, patch, meta = {}) { const section = invites.getSection(guildId); return invites.updateSettings(guildId, { publicPanel: { ...section.settings.publicPanel, ...patch } }, meta).settings.publicPanel; }
async function resolveChannel(guild, id) { const channel = id ? (guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null)) : null; if (!channel?.send) throw new Error('Select a text channel where Goliath can post the panel.'); const me = guild.members.me || await guild.members.fetchMe().catch(() => null); const permissions = channel.permissionsFor(me); if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) throw new Error(`Goliath needs View Channel, Send Messages and Embed Links in ${channel}.`); return channel; }
async function resolvePublicPayload(guild, payload = {}) { return { ...payload, content: payload.content == null ? payload.content : await emojis.resolveText(guild.client, guild.id, payload.content), embeds: await emojis.resolveEmbeds(guild.client, guild.id, payload.embeds || []) }; }
async function verifyPublicInvite(guild) {
  const config = invites.getSection(guild.id).settings.officialInvite;
  if (!config.code) throw new Error('No official invite exists. Create one in Invite Management before publishing.');
  try {
    await guild.invites.fetch(config.code);
  } catch (error) {
    if ([10006, 10008].includes(Number(error?.code))) {
      throw new Error('The saved official invite no longer exists on Discord. Use Invite Management → Update Invite to create a valid link before publishing.');
    }
    throw new Error('Could not verify the official invite with Discord. Check Manage Server permissions or retry before publishing.');
  }
  if (config.linkType === 'vanity') {
    const status = await invites.syncVanityStatus(guild);
    if (!status.verified && config.vanityCode) {
      throw new Error('Vanity URL could not be verified. Switch to Standard Discord Invite or resolve the vanity access issue before publishing.');
    }
  }
}
async function deployPublicPanel(guild, meta = {}) { const section = invites.getSection(guild.id); if (!isModuleEnabled(guild.id, 'invites')) throw new Error('Invite Studio is disabled.'); const config = section.settings.publicPanel; const channel = await resolveChannel(guild, config.channelId); await verifyPublicInvite(guild); let message = config.messageId ? await channel.messages.fetch(config.messageId).catch(() => null) : null; const payload = await resolvePublicPayload(guild, panel.buildPublicPayload(guild.id)); if (message) await message.edit(payload); else message = await channel.send(payload); savePanelConfig(guild.id, { channelId: channel.id, messageId: message.id, lastRefreshedAt: new Date().toISOString() }, meta); return message; }
function refreshPublicPanel(guild, meta = {}) { if (!isModuleEnabled(guild.id, 'invites')) return Promise.resolve(false); if (operations.has(guild.id)) return operations.get(guild.id); const operation = (async () => { const config = invites.getSection(guild.id).settings.publicPanel; if (!config.channelId || !config.messageId) return false; const channel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null); const message = channel?.messages ? await channel.messages.fetch(config.messageId).catch(() => null) : null; if (!message) return false; const payload = await resolvePublicPayload(guild, panel.buildPublicPayload(guild.id)); await message.edit(payload); savePanelConfig(guild.id, { lastRefreshedAt: new Date().toISOString() }, meta); return true; })().finally(() => operations.delete(guild.id)); operations.set(guild.id, operation); return operation; }
function queueLeaderboardRefresh(guild, delay = 3000) { if (!isModuleEnabled(guild.id, 'invites')) return false; const key = `queue:${guild.id}`; clearTimeout(timers.get(key)); const timer = setTimeout(() => { timers.delete(key); refreshPublicPanel(guild, { action: 'invite_panel_refresh' }).catch(() => null); }, delay); timer.unref?.(); timers.set(key, timer); return true; }
function startAutoRefresh(guild, intervalMs = invites.TWO_HOURS_MS) { if (!isModuleEnabled(guild.id, 'invites')) return false; const key = `interval:${guild.id}`; if (timers.has(key)) return true; const timer = setInterval(() => refreshPublicPanel(guild, { action: 'invite_panel_two_hour_refresh' }).catch(() => null), intervalMs); timer.unref?.(); timers.set(key, timer); return true; }
async function notifyInviteUsed(guild, inviterId, member) {
  if (!inviterId) return false;

  const inviter = await guild.members.fetch(inviterId).catch(() => null);
  if (!inviter?.user) return false;

  const stats = invites.getSection(guild.id).inviters[inviterId] || {};
  const score = Number(stats.active || 0) + Number(stats.bonus || 0);

  await inviter.user
    .send(buildInviteUsedNotice({
      guild,
      inviter,
      member,
      score,
    }))
    .catch(() => null);

  return true;
}
async function trackJoin(member, meta = {}) { const section = invites.getSection(member.guild.id); if (!isModuleEnabled(member.guild.id, 'invites') || section.settings.trackingEnabled === false) return null; const result = await invites.trackJoin(member, meta); if (result) { queueLeaderboardRefresh(member.guild); if (result.inviterId) await notifyInviteUsed(member.guild, result.inviterId, member); } return result; }
async function trackLeave(member, meta = {}) { const section = invites.getSection(member.guild.id); if (!isModuleEnabled(member.guild.id, 'invites') || section.settings.trackingEnabled === false) return null; const result = await invites.trackLeave(member, meta); if (result) queueLeaderboardRefresh(member.guild); return result; }
async function startup(client) { if (client.__goliathInvitesStarted) return client.__goliathInvitesStarted; const startedGuilds = []; for (const guild of client.guilds.cache.values()) { const section = invites.getSection(guild.id); if (!isModuleEnabled(guild.id, 'invites') || section.settings.trackingEnabled === false) continue; await invites.syncGuild(guild, { actorId: client.user?.id || null, action: 'invites_startup_sync' }).catch((error) => console.warn(`[Invites] Startup sync failed for guild ${guild.id}: ${error.message || error}`)); startAutoRefresh(guild); startedGuilds.push(guild.id); } client.__goliathInvitesStarted = { startedAt: new Date().toISOString(), guildIds: startedGuilds }; return client.__goliathInvitesStarted; }

// Keep the legacy store export safe for any future caller.
invites.startup = startup;

module.exports = { savePanelConfig, deployPublicPanel, refreshPublicPanel, queueLeaderboardRefresh, startAutoRefresh, notifyInviteUsed, trackJoin, trackLeave, startup };