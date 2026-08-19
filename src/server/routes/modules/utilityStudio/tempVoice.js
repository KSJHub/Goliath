'use strict';

const express = require('express');
const { isModuleEnabled, setModuleEnabled } = require('../../../../core/guild/guildManager');

const tempVoiceStore = require('../../../../modules/utilityStudio/tempVoice/tempVoiceStore');
const tempVoiceManager = require('../../../../modules/utilityStudio/tempVoice/tempVoiceManager');

const router = express.Router();

function success(res, payload = {}) { return res.json({ success: true, ...payload }); }
function failure(res, error, status = 500) { console.error('[TempVoice API]', error); return res.status(status).json({ success: false, error: error.message || 'Temp Voice API request failed.' }); }
function getGuildId(req) { const guildId = String(req.params.guildId || '').trim(); if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.'); return guildId; }
function cleanId(value) { const id = String(value || '').replace(/[<#@&!>]/g, '').trim(); return /^\d{15,25}$/.test(id) ? id : null; }
function cleanString(value, fallback = '', max = 100) { const text = String(value ?? fallback).trim().slice(0, max); return text || fallback; }
function cleanNumber(value, fallback = 0) { const number = Number(value); return Math.max(0, Math.floor(Number.isFinite(number) ? number : fallback)); }
function hasOwn(input, key) { return Object.prototype.hasOwnProperty.call(input || {}, key); }
function cleanIdArray(value) { return Array.isArray(value) ? [...new Set(value.map(cleanId).filter(Boolean))] : undefined; }
function getClient(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || global.client || null; }
async function fetchGuild(req, guildId) { const client = getClient(req); if (!client?.guilds) return null; return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null); }
async function fetchDiscordChannel(guild, channelId) { const id = cleanId(channelId); if (!guild || !id) return null; return guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null); }
function getActorId(req) { return cleanId(req.session?.user?.id || req.body?.actorId || req.query?.actorId); }
function canonicalConfig(guildId) { return tempVoiceStore.exportConfiguration(guildId); }

function overview(guildId, section, guild = null) {
  const hubs = Object.values(section.hubs || {});
  const channels = Object.values(section.channels || {});
  const liveChannels = guild ? channels.filter((channel) => guild.channels.cache.has(channel.channelId)) : channels;
  const activity = Array.isArray(section.activity) ? [...section.activity].slice(-25).reverse() : [];
  return { enabled: isModuleEnabled(guildId, 'tempVoice'), hubs: hubs.length, enabledHubs: hubs.filter((hub) => hub.enabled !== false).length, trackedChannels: channels.length, liveChannels: liveChannels.length, lockedChannels: channels.filter((channel) => channel.locked).length, hiddenChannels: channels.filter((channel) => channel.hidden).length, blockedUsers: channels.reduce((sum, channel) => sum + (channel.blockedUserIds?.length || 0), 0), defaultUserLimit: section.settings?.defaultUserLimit || 0, deleteWhenEmpty: section.settings?.deleteWhenEmpty !== false, ownerPanelEnabled: section.settings?.ownerPanelEnabled !== false, analytics: section.analytics || {}, activity, updatedAt: section.updatedAt || null };
}

function prepareSettings(input = {}) {
  const settings = {};
  if (hasOwn(input, 'defaultUserLimit')) settings.defaultUserLimit = cleanNumber(input.defaultUserLimit, 0);
  for (const key of ['deleteWhenEmpty', 'ownerPanelEnabled', 'allowOwnerRename', 'allowOwnerStatus', 'allowOwnerLock', 'allowOwnerHide', 'allowOwnerLimit', 'allowOwnerPermits', 'allowOwnerTransfer', 'allowOwnerDelete']) if (hasOwn(input, key)) settings[key] = input[key] !== false;
  return settings;
}

function prepareHub(input = {}) {
  return { hubId: input.hubId || input.id, enabled: input.enabled !== false, joinChannelId: cleanId(input.joinChannelId), joinChannelName: cleanString(input.joinChannelName, '➕ Create Temp Voice', 80), categoryId: cleanId(input.categoryId), categoryName: cleanString(input.categoryName, 'Temporary Voice Channels', 80), nameTemplate: cleanString(input.nameTemplate, "{username}'s Channel", 80), userLimit: cleanNumber(input.userLimit, 0), bitrate: cleanNumber(input.bitrate, 0), lockedByDefault: input.lockedByDefault === true, hiddenByDefault: input.hiddenByDefault === true, ownerControlsEnabled: input.ownerControlsEnabled !== false, createCategory: input.createCategory !== false, createdBy: cleanId(input.createdBy || input.actorId), actorId: cleanId(input.actorId) };
}

function prepareChannelControls(input = {}) {
  const controls = {};
  if (hasOwn(input, 'name')) controls.name = cleanString(input.name, 'Temp Voice', 80);
  if (hasOwn(input, 'activityStatus')) controls.activityStatus = cleanString(input.activityStatus, '', 120);
  if (hasOwn(input, 'userLimit')) controls.userLimit = cleanNumber(input.userLimit, 0);
  if (hasOwn(input, 'locked')) controls.locked = input.locked === true;
  if (hasOwn(input, 'hidden')) controls.hidden = input.hidden === true;
  if (hasOwn(input, 'ownerId')) controls.ownerId = cleanId(input.ownerId);
  for (const key of ['allowedUserIds', 'blockedUserIds', 'allowedRoleIds', 'blockedRoleIds']) if (hasOwn(input, key)) controls[key] = cleanIdArray(input[key]) || [];
  return controls;
}

async function syncHubToDiscord(guild, beforeHub = {}, nextHub = {}) {
  const result = { updated: [], warnings: [] };
  if (!guild) return result;
  const joinChannel = await fetchDiscordChannel(guild, nextHub.joinChannelId || beforeHub.joinChannelId);
  if (joinChannel) {
    if (nextHub.joinChannelName && joinChannel.name !== nextHub.joinChannelName) await joinChannel.setName(nextHub.joinChannelName, 'Goliath Temp Voice hub edit').then(() => result.updated.push('joinChannelName')).catch((error) => result.warnings.push(`Join channel rename failed: ${error.message}`));
    if (nextHub.categoryId && joinChannel.parentId !== nextHub.categoryId) await joinChannel.setParent(nextHub.categoryId, { reason: 'Goliath Temp Voice hub category edit' }).then(() => result.updated.push('joinChannelParent')).catch((error) => result.warnings.push(`Join channel category move failed: ${error.message}`));
  } else if (nextHub.joinChannelId) result.warnings.push('Saved hub, but the Discord join channel was not found.');
  const category = await fetchDiscordChannel(guild, nextHub.categoryId || beforeHub.categoryId);
  if (category && nextHub.categoryName && category.name !== nextHub.categoryName) await category.setName(nextHub.categoryName, 'Goliath Temp Voice category edit').then(() => result.updated.push('categoryName')).catch((error) => result.warnings.push(`Category rename failed: ${error.message}`));
  else if (nextHub.categoryId && !category) result.warnings.push('Saved hub, but the Discord category was not found.');
  return result;
}

async function deleteHubDiscordResources(guild, section, hubId, hub = {}) {
  const result = { deleted: [], skipped: [], warnings: [] };
  if (!guild || !hub) return result;
  const trackedChannels = Object.values(section.channels || {}).filter((channel) => channel.hubId === hubId || channel.hubId === hub.hubId);
  for (const trackedChannel of trackedChannels) {
    const channel = await fetchDiscordChannel(guild, trackedChannel.channelId);
    if (channel?.deletable) await channel.delete('Goliath Temp Voice hub removal').then(() => result.deleted.push(`temp:${trackedChannel.channelId}`)).catch((error) => result.warnings.push(`Temp channel delete failed: ${error.message}`));
  }
  const joinChannel = await fetchDiscordChannel(guild, hub.joinChannelId);
  if (joinChannel?.deletable) await joinChannel.delete('Goliath Temp Voice hub removal').then(() => result.deleted.push(`join:${hub.joinChannelId}`)).catch((error) => result.warnings.push(`Join channel delete failed: ${error.message}`));
  else if (hub.joinChannelId) result.skipped.push(`join:${hub.joinChannelId}`);
  const category = await fetchDiscordChannel(guild, hub.categoryId);
  if (category) {
    const remainingChildren = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (remainingChildren.size === 0 && category.deletable) await category.delete('Goliath Temp Voice empty category removal').then(() => result.deleted.push(`category:${hub.categoryId}`)).catch((error) => result.warnings.push(`Category delete failed: ${error.message}`));
    else result.skipped.push(`category:${hub.categoryId}:not-empty-or-not-deletable`);
  }
  return result;
}

async function scanTempVoiceOrphans(guild, section) {
  const hubs = Object.values(section.hubs || {});
  const channels = Object.values(section.channels || {});
  const hubIds = new Set(hubs.map((hub) => hub.hubId));
  const report = { healthy: true, missingJoinChannels: [], missingCategories: [], missingTrackedChannels: [], trackedChannelsWithoutHub: [], orphanDiscordResources: [], counts: {} };

  for (const hub of hubs) {
    if (hub.joinChannelId && !await fetchDiscordChannel(guild, hub.joinChannelId)) report.missingJoinChannels.push({ hubId: hub.hubId, channelId: hub.joinChannelId, name: hub.joinChannelName });
    if (hub.categoryId && !await fetchDiscordChannel(guild, hub.categoryId)) report.missingCategories.push({ hubId: hub.hubId, categoryId: hub.categoryId, name: hub.categoryName });
  }

  for (const channel of channels) {
    if (channel.hubId && !hubIds.has(channel.hubId)) report.trackedChannelsWithoutHub.push({ channelId: channel.channelId, hubId: channel.hubId });
    if (channel.channelId && !await fetchDiscordChannel(guild, channel.channelId)) report.missingTrackedChannels.push({ channelId: channel.channelId, hubId: channel.hubId, name: channel.name });
  }

  if (guild) {
    const knownIds = new Set([...hubs.flatMap((hub) => [hub.joinChannelId, hub.categoryId]), ...channels.map((channel) => channel.channelId)].filter(Boolean));
    for (const channel of guild.channels.cache.values()) {
      const name = String(channel.name || '').toLowerCase();
      const looksTempVoice = name.includes('temp voice') || name.includes('create temp voice') || name.includes('temporary voice');
      if (looksTempVoice && !knownIds.has(channel.id)) report.orphanDiscordResources.push({ channelId: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId || null });
    }
  }

  report.counts = { missingJoinChannels: report.missingJoinChannels.length, missingCategories: report.missingCategories.length, missingTrackedChannels: report.missingTrackedChannels.length, trackedChannelsWithoutHub: report.trackedChannelsWithoutHub.length, orphanDiscordResources: report.orphanDiscordResources.length };
  report.healthy = Object.values(report.counts).every((count) => count === 0);
  return report;
}

async function cleanupTempVoiceOrphans(guild, section, options = {}) {
  const scan = await scanTempVoiceOrphans(guild, section);
  const result = { scan, removedJsonChannels: [], deletedDiscordResources: [], warnings: [] };
  const deleteDiscord = options.deleteDiscord !== false;
  const removeJson = options.removeJson !== false;

  let nextSection = section;
  if (removeJson) {
    nextSection = { ...nextSection, channels: { ...(nextSection.channels || {}) } };
    for (const item of [...scan.missingTrackedChannels, ...scan.trackedChannelsWithoutHub]) {
      delete nextSection.channels[item.channelId];
      result.removedJsonChannels.push(item.channelId);
    }
  }

  if (guild && deleteDiscord) {
    for (const item of scan.orphanDiscordResources) {
      const channel = await fetchDiscordChannel(guild, item.channelId);
      if (channel?.deletable) await channel.delete('Goliath Temp Voice orphan cleanup').then(() => result.deletedDiscordResources.push(item.channelId)).catch((error) => result.warnings.push(`Orphan delete failed: ${error.message}`));
    }
  }

  return { result, section: nextSection };
}

router.get('/:guildId', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); const config = canonicalConfig(guildId); return success(res, { guildId, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/health', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (!guild) throw new Error('Guild is not available to the bot.'); const config = canonicalConfig(guildId); const health = await scanTempVoiceOrphans(guild, config); return success(res, { guildId, health, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/cleanup-orphans', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (!guild) throw new Error('Guild is not available to the bot.'); const section = tempVoiceStore.getTempVoiceSection(guildId); const cleanup = await cleanupTempVoiceOrphans(guild, section, req.body || {}); tempVoiceStore.saveTempVoiceSection(guildId, { ...cleanup.section, updatedAt: tempVoiceStore.now() }, { actorId: req.body?.actorId, action: 'temp_voice_cleanup_orphans' }); const config = canonicalConfig(guildId); const health = await scanTempVoiceOrphans(guild, config); return success(res, { guildId, cleanup: cleanup.result, health, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/enabled', async (req, res) => { try { const guildId = getGuildId(req); const enabled = req.body?.enabled === true; setModuleEnabled(guildId, 'tempVoice', enabled, { actorId: getActorId(req), action: 'temp_voice_api_toggle' }); const config = canonicalConfig(guildId); const guild = await fetchGuild(req, guildId); return success(res, { guildId, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/settings', async (req, res) => { try { const guildId = getGuildId(req); const settings = prepareSettings(req.body?.settings || req.body || {}); tempVoiceStore.updateTempVoiceSection(guildId, (section) => ({ ...section, settings: { ...(section.settings || {}), ...settings }, updatedAt: tempVoiceStore.now() }), { actorId: req.body?.actorId }); const config = canonicalConfig(guildId); const guild = await fetchGuild(req, guildId); return success(res, { guildId, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/hubs/deploy', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (!guild) throw new Error('Guild is not available to the bot.'); const deployment = await tempVoiceManager.deployHub(guild, prepareHub(req.body || {})); const config = canonicalConfig(guildId); return success(res, { guildId, hub: deployment.hub || deployment, deployment, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/hubs', async (req, res) => { try { const guildId = getGuildId(req); const hub = tempVoiceManager.createHub(guildId, prepareHub(req.body || {})); const config = canonicalConfig(guildId); const guild = await fetchGuild(req, guildId); return success(res, { guildId, hub, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.put('/:guildId/hubs/:hubId', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); const beforeConfig = tempVoiceStore.getTempVoiceSection(guildId); const beforeHub = beforeConfig.hubs?.[req.params.hubId] || null; if (!beforeHub) throw new Error('Temp Voice hub was not found.'); const nextHub = tempVoiceStore.saveHub(guildId, prepareHub({ ...(req.body || {}), hubId: req.params.hubId }), { actorId: req.body?.actorId }); const sync = await syncHubToDiscord(guild, beforeHub, nextHub); const config = canonicalConfig(guildId); return success(res, { guildId, hub: nextHub, sync, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/hubs/:hubId', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); const beforeConfig = tempVoiceStore.getTempVoiceSection(guildId); const hub = beforeConfig.hubs?.[req.params.hubId] || null; if (!hub) throw new Error('Temp Voice hub was not found.'); const sync = await deleteHubDiscordResources(guild, beforeConfig, req.params.hubId, hub); tempVoiceStore.updateTempVoiceSection(guildId, (section) => { const hubs = { ...(section.hubs || {}) }; const channels = { ...(section.channels || {}) }; delete hubs[req.params.hubId]; for (const [channelId, channel] of Object.entries(channels)) if (channel.hubId === req.params.hubId || channel.hubId === hub.hubId) delete channels[channelId]; return { ...section, hubs, channels, updatedAt: tempVoiceStore.now() }; }, { actorId: req.body?.actorId }); const config = canonicalConfig(guildId); return success(res, { guildId, sync, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/channels/:channelId/controls', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (!guild) throw new Error('Guild is not available to the bot.'); const channel = await tempVoiceManager.updateTempChannelControls(guild, req.params.channelId, getActorId(req), prepareChannelControls(req.body?.controls || req.body || {})); const config = canonicalConfig(guildId); return success(res, { guildId, channel, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/channels/:channelId/claim', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (!guild) throw new Error('Guild is not available to the bot.'); const channel = await tempVoiceManager.claimTempChannel(guild, req.params.channelId, getActorId(req)); const config = canonicalConfig(guildId); return success(res, { guildId, channel, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/channels/:channelId/kick', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); const targetId = cleanId(req.body?.targetId || req.body?.userId); if (!guild) throw new Error('Guild is not available to the bot.'); if (!targetId) throw new Error('Target user ID is required.'); const channel = await tempVoiceManager.kickMemberFromTempChannel(guild, req.params.channelId, getActorId(req), targetId, req.body?.block === true); const config = canonicalConfig(guildId); return success(res, { guildId, channel, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });
router.delete('/:guildId/channels/:channelId', async (req, res) => { try { const guildId = getGuildId(req); const guild = await fetchGuild(req, guildId); if (guild && getActorId(req)) await tempVoiceManager.deleteOwnedTempChannel(guild, req.params.channelId, getActorId(req)); else { tempVoiceStore.deleteTempChannel(guildId, req.params.channelId, { actorId: req.body?.actorId }); const channel = guild?.channels?.cache?.get(req.params.channelId) || await guild?.channels?.fetch?.(req.params.channelId).catch(() => null); if (channel?.deletable) await channel.delete('Goliath Temp Voice dashboard delete').catch(() => null); } const config = canonicalConfig(guildId); return success(res, { guildId, config, overview: overview(guildId, config, guild) }); } catch (error) { return failure(res, error, 400); } });

module.exports = router;