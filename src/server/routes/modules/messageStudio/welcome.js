'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const welcome = require('../../../../modules/messageStudio/welcome/welcome');
const embedTemplates = require('../../../../modules/messageStudio/embed/embedTemplates');
const scheduledWelcome = require('../../../../modules/messageStudio/welcome/scheduledWelcome');
const scheduledWelcomeHealth = require('../../../../modules/messageStudio/welcome/scheduledWelcomeHealth');

const router = express.Router();

function success(res, payload = {}) { return res.json({ success: true, ...payload }); }
function failure(res, error, status = 500) { console.error('[Welcome API]', error); return res.status(status).json({ success: false, error: error.message || 'Welcome API request failed.' }); }
function getGuildId(req) { const guildId = String(req.params.guildId || '').trim(); if (!/^\d{15,25}$/.test(guildId)) throw new Error('Invalid guild ID.'); return guildId; }
function getActorId(req) { return String(req.session?.user?.id || req.body?.actorId || '').trim() || null; }
function getClient(req) { return req.client || req.app?.get?.('goliath.client') || req.app?.locals?.client || null; }
async function getGuild(req, guildId) { const client = getClient(req); if (!client?.guilds) return null; return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null); }
async function getPreviewMember(req, guild) { const userId = String(req.body?.userId || getActorId(req) || '').trim(); if (!/^\d{15,25}$/.test(userId)) throw new Error('A valid preview user ID is required.'); const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null); if (!member) throw new Error('Preview member could not be found in this server.'); return member; }
function serializePreviewPayload(payload = {}) { return { content: payload.content || '', embeds: (payload.embeds || []).map((embed) => typeof embed?.toJSON === 'function' ? embed.toJSON() : embed), components: (payload.components || []).map((component) => typeof component?.toJSON === 'function' ? component.toJSON() : component), allowedMentions: payload.allowedMentions || { parse: [] } }; }
function canonicalConfig(guildId, config = welcome.getWelcomeSection(guildId)) { return { ...config, enabled: guildManager.isModuleEnabled(guildId, 'welcome') }; }
function canonicalExport(guildId) { const exported = welcome.exportConfiguration(guildId); return { ...exported, config: canonicalConfig(guildId, exported.config) }; }
function customTemplateId(slot) { return slot === 'dm_welcome' ? 'welcome_custom_dm' : 'welcome_custom_public'; }
function customTemplateName(slot) { return slot === 'dm_welcome' ? 'Custom DM Welcome' : 'Custom Public Welcome'; }

async function buildOverview(req, guildId) {
  const config = canonicalConfig(guildId);
  const scheduled = scheduledWelcome.getScheduledConfig(guildId);
  const guild = await getGuild(req, guildId);
  const health = guild ? await welcome.buildHealthReport(guild) : null;
  const scheduledHealth = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null;
  const templates = welcome.getWelcomeTemplates(guildId, 'welcome');
  const binding = welcome.getWelcomeBinding(guildId, 'welcome');
  const dmBinding = welcome.getWelcomeBinding(guildId, 'dm_welcome');
  const dmTemplate = welcome.getAssignedTemplate(guildId, 'dmWelcome', config);
  return { guildId, config, scheduled, templates, binding, dmBinding, overview: { enabled: config.enabled, channelId: config.channelId, dmEnabled: config.dmEnabled === true, messageSource: config.messageSource, dmMessageSource: config.dmMessageSource, analytics: config.analytics, health, scheduledHealth, scheduledEnabled: scheduled.enabled, scheduledWaiting: scheduledHealth?.waitingMembers || 0, templateId: binding?.templateId || config.templateId, templateName: binding?.name || health?.templateName || null, templateBound: Boolean(binding), dmTemplateId: dmTemplate?.templateId || config.dmTemplateId || config.templateId, dmTemplateName: dmTemplate?.name || null, dmTemplateBound: Boolean(dmBinding), dmUsesPublicTemplate: config.dmMessageSource === 'inherit' } };
}

router.get('/:guildId/overview', async (req, res) => { try { return success(res, await buildOverview(req, getGuildId(req))); } catch (error) { return failure(res, error, 400); } });
router.put('/:guildId/config', async (req, res) => { try { const guildId = getGuildId(req); const patch = req.body || {}; const { enabled, templateId, ...settingsPatch } = patch; if (typeof enabled === 'boolean') guildManager.setModuleEnabled(guildId, 'welcome', enabled, { actorId: getActorId(req) }); if (templateId) welcome.bindWelcomeTemplate(guildId, templateId, 'welcome', { actorId: getActorId(req) }); if (Object.keys(settingsPatch).length) welcome.updateConfig(guildId, settingsPatch, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.patch('/:guildId/enabled', async (req, res) => { try { const guildId = getGuildId(req); guildManager.setModuleEnabled(guildId, 'welcome', req.body?.enabled === true, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/template', async (req, res) => { try { const guildId = getGuildId(req); const templateId = String(req.body?.templateId || '').trim(); if (!templateId) throw new Error('A template ID is required.'); const result = welcome.bindWelcomeTemplate(guildId, templateId, 'welcome', { actorId: getActorId(req) }); return success(res, { ...result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });

router.post('/:guildId/message-source', async (req, res) => {
  try {
    const guildId = getGuildId(req); const source = String(req.body?.source || '').trim(); const slot = String(req.body?.slot || 'welcome').trim() === 'dm_welcome' ? 'dm_welcome' : 'welcome'; const templateId = String(req.body?.templateId || '').trim();
    if (!['embedStudio', 'preset', 'custom', 'inherit'].includes(source)) throw new Error('Invalid Welcome message source.');
    if (slot === 'welcome' && source === 'inherit') throw new Error('Public Welcome cannot inherit a message source.');
    if (slot === 'dm_welcome' && source === 'inherit') { welcome.clearDmTemplate(guildId, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); }
    if (source === 'preset') { welcome.bindWelcomeTemplate(guildId, slot === 'dm_welcome' ? 'dm_welcome_default' : 'welcome_default', slot, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); }
    if (source === 'embedStudio') { if (!templateId) throw new Error('Choose an Embed Studio message first.'); welcome.bindWelcomeTemplate(guildId, templateId, slot, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); }
    const customId = templateId || customTemplateId(slot); if (!embedTemplates.getTemplate(guildId, customId)) throw new Error('Create the Custom Welcome message first.');
    welcome.bindWelcomeTemplate(guildId, customId, slot, { actorId: getActorId(req) });
    welcome.updateConfig(guildId, slot === 'dm_welcome' ? { dmMessageSource: 'custom' } : { messageSource: 'custom' }, { actorId: getActorId(req) });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/custom-message', async (req, res) => {
  try {
    const guildId = getGuildId(req); const slot = String(req.body?.slot || 'welcome').trim() === 'dm_welcome' ? 'dm_welcome' : 'welcome';
    const templateId = customTemplateId(slot); const title = String(req.body?.title || '').trim(); const description = String(req.body?.description || '').trim(); const content = String(req.body?.content || '').trim(); const footer = String(req.body?.footer || '').trim(); const color = String(req.body?.color || '#5865F2').trim();
    if (!title && !description && !content) throw new Error('Custom Welcome needs message content, a title, or a description.');
    const saved = embedTemplates.saveTemplate(guildId, { templateId, name: customTemplateName(slot), module: 'welcome', templateType: slot === 'dm_welcome' ? 'dmWelcome' : 'welcome', content, embed: { title, description: description || (content ? '\u200b' : ''), color, footer: { text: footer, iconURL: '' }, fields: [], buttons: [] }, tags: ['welcome', 'custom'] });
    welcome.bindWelcomeTemplate(guildId, saved.templateId, slot, { actorId: getActorId(req) });
    welcome.updateConfig(guildId, slot === 'dm_welcome' ? { dmMessageSource: 'custom' } : { messageSource: 'custom' }, { actorId: getActorId(req) });
    return success(res, { template: saved, ...(await buildOverview(req, guildId)) });
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/repair', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); await welcome.repairConfiguration(guild, { actorId: getActorId(req) }); await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/preview', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const member = await getPreviewMember(req, guild); const config = welcome.getWelcomeSection(guildId); const publicPayload = await welcome.buildDiscordPayload(member, 'welcome', config, { suppressPing: true }); const dmPayload = config.dmEnabled ? await welcome.buildDiscordPayload(member, 'dmWelcome', config, { suppressPing: true, includeComponents: false }) : null; return success(res, { preview: { public: serializePreviewPayload(publicPayload), dm: dmPayload ? serializePreviewPayload(dmPayload) : null } }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/test', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const member = await getPreviewMember(req, guild); const config = welcome.getWelcomeSection(guildId); if (!config.channelId && !config.dmEnabled) throw new Error('Select a welcome channel or enable welcome DMs before sending a test.'); const result = await welcome.sendWelcome(member, { silent: false, force: true, previewOnly: true }); return success(res, { result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/scheduled', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); const scheduled = scheduledWelcome.getScheduledConfig(guildId); const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null; return success(res, { scheduled, health }); } catch (error) { return failure(res, error, 400); } });
router.put('/:guildId/scheduled', async (req, res) => { try { const guildId = getGuildId(req); const scheduled = scheduledWelcome.updateScheduledConfig(guildId, req.body || {}, { actorId: getActorId(req) }); const guild = await getGuild(req, guildId); const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null; return success(res, { scheduled, health }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/scheduled/queue', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const members = await scheduledWelcome.getWaitingMembers(guild); return success(res, { count: members.length, members: members.map((member) => ({ id: member.id, username: member.user?.username || member.id, displayName: member.displayName || member.user?.username || member.id })) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/scheduled/run', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const result = await scheduledWelcome.runScheduledWelcome(guild, { force: true, actorId: getActorId(req) }); return success(res, { result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/scheduled/repair', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const result = await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) }); return success(res, { result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/reset', async (req, res) => { try { const guildId = getGuildId(req); welcome.resetWelcome(guildId, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/export', (req, res) => { try { const guildId = getGuildId(req); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="goliath-welcome-${guildId}.json"`); return res.send(JSON.stringify(canonicalExport(guildId), null, 2)); } catch (error) { return failure(res, error, 400); } });

module.exports = router;