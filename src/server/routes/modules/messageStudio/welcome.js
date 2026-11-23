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
    const scope = slot === 'dm_welcome' ? 'dm' : 'public';
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) throw new Error('Enter a normal message of 1–2000 characters.');
    welcome.updateWelcomeSection(guildId, section => ({ ...section, normalMessages: { ...section.normalMessages, [scope]: content }, ...(scope === 'dm' ? { dmMessageSource: 'custom', dmTemplateId: section.dmTemplateId || 'dm_welcome_default' } : { messageSource: 'custom' }) }), { actorId: getActorId(req), action: 'welcome_normal_message_save' });
    return success(res, await buildOverview(req, guildId));
  } catch (error) { return failure(res, error, 400); }
});

router.post('/:guildId/normal-presets', async (req,res) => {
  try {
    const guildId=getGuildId(req), {scope,action,id,name,content}=req.body||{};
    if(!['public','dm','scheduled'].includes(scope))throw new Error('Invalid preset workspace.');
    const limit=scope==='scheduled'?1800:2000;
    const validate=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid '+label);return value.trim();};
    const meta={actorId:getActorId(req),action:'welcome_normal_preset'};
    if(action==='activateOriginal'){
      const original=scope==='scheduled'?"**👋 Welcome to our newest members!**\n\nLet's give a warm welcome to our newest arrivals.\n\nWe're delighted to have you here. Make yourself at home and enjoy the community! 🎉":scope==='dm'?'Welcome to {guild}, {username}!':'Welcome {userMention} to **{guild}**! You are member #{memberCount}.';
      if(scope==='scheduled'){
        // Commit the scheduled message and its default in the same module-section write.
        // Preserve queue, checkpoints, schedule and all unrelated Welcome settings.
        welcome.updateWelcomeSection(guildId,s=>({...s,
          scheduled:{...s.scheduled,message:original,templateId:null,updatedAt:new Date().toISOString()},
          normalDefaults:{...s.normalDefaults,[scope]:original}
        }),meta);
        const binding=embedTemplates.getBinding(guildId,'welcome','scheduled_welcome');
        if(binding)embedTemplates.unbindTemplate(guildId,'welcome','scheduled_welcome');
      }else welcome.updateWelcomeSection(guildId,s=>({...s,normalDefaults:{...s.normalDefaults,[scope]:original},normalMessages:{...s.normalMessages,[scope]:original},...(scope==='dm'?{dmMessageSource:'custom',dmTemplateId:s.dmTemplateId||'dm_welcome_default'}:{messageSource:'custom'})}),meta);
      return success(res,{config:canonicalConfig(guildId)});
    }

    welcome.updateWelcomeSection(guildId, section=>{
      const all={...section.normalPresets?.[scope]}, current=Object.hasOwn(all,id)?all[id]:null;
      if(!['saveAs','import','editDefault','restoreDefault'].includes(action)&&!current)throw new Error('Preset no longer exists.');
      const unique=(label,except)=>{if(Object.entries(all).some(([key,v])=>key!==except&&v.name.toLowerCase()===label.toLowerCase()))throw new Error('Preset name already exists.');return label;};
      let defaults=section.normalDefaults;
      if(action==='saveAs'||action==='duplicate'){const label=unique(validate(name,80,'preset name'));all[require('node:crypto').randomUUID()]={name:label,content:validate(action==='duplicate'?current.content:content,limit,'message')};}
      else if(action==='save')all[id]={...current,content:validate(content,limit,'message')};
      else if(action==='rename')all[id]={...current,name:unique(validate(name,80,'preset name'),id)};
      else if(action==='delete')delete all[id];
      else if(action==='default')defaults={...defaults,[scope]:current.content};
      else if(action==='editDefault')defaults={...defaults,[scope]:validate(content,limit,'default message')};
      else if(action==='restoreDefault'){defaults={...defaults};delete defaults[scope];}
      else if(action==='import'){const data=req.body.data;if(data?.version!==1||data.scope!==scope||!Array.isArray(data.presets)||data.presets.length>100)throw new Error('Invalid preset export.');if(data.defaultMessage!==undefined)defaults={...defaults,[scope]:validate(data.defaultMessage,limit,'default message')};const imported=data.presets.map(v=>({name:validate(v?.name,80,'preset name'),content:validate(v?.content,limit,'message')}));const names=new Set(Object.values(all).map(v=>v.name.toLowerCase()));for(const preset of imported){const key=preset.name.toLowerCase();if(names.has(key))throw new Error('Preset name already exists or is duplicated in import.');names.add(key);}for(const preset of imported)all[require('node:crypto').randomUUID()]=preset;}
      else throw new Error('Invalid preset action.');
      return {...section,normalPresets:{...section.normalPresets,[scope]:all},normalDefaults:defaults};
    },meta);
    return success(res,{config:canonicalConfig(guildId)});
  }catch(error){return failure(res,error,400);}
});

router.post('/:guildId/repair', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); await welcome.repairConfiguration(guild, { actorId: getActorId(req) }); await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/preview', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const member = await getPreviewMember(req, guild); const config = welcome.getWelcomeSection(guildId); const publicPayload = await welcome.buildDiscordPayload(member, 'welcome', config, { suppressPing: true }); const dmPayload = config.dmEnabled ? await welcome.buildDiscordPayload(member, 'dmWelcome', config, { suppressPing: true, includeComponents: false }) : null; return success(res, { preview: { public: serializePreviewPayload(publicPayload), dm: dmPayload ? serializePreviewPayload(dmPayload) : null } }); } catch (error) { return failure(res, error, 400); } });
// Test-only guard shared by all dashboard sessions in this server process.
const welcomeTestGuards = new Map();
const WELCOME_TEST_COOLDOWN_MS = 10000;
router.post('/:guildId/test', async (req, res) => {
  let guildId;
  let guard;
  try {
    guildId = getGuildId(req);
    const now = Date.now();
    const previous = welcomeTestGuards.get(guildId);
    if (previous && (previous.running || previous.until > now)) {
      const retryAfter = previous.running ? 10 : Math.max(1, Math.ceil((previous.until - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ success: false, error: 'A Welcome test is already running or cooling down. No additional channel message or DM was sent. Please wait before trying again.' });
    }
    guard = { running: true, until: 0 };
    welcomeTestGuards.set(guildId, guard);
    const guild = await getGuild(req, guildId);
    if (!guild) throw new Error('Guild is unavailable.');
    const member = await getPreviewMember(req, guild);
    const config = welcome.getWelcomeSection(guildId);
    if (!config.channelId && !config.dmEnabled) throw new Error('Select a welcome channel or enable welcome DMs before sending a test.');
    const result = await welcome.sendWelcome(member, { silent: false, force: true, previewOnly: true });
    return success(res, { result });
  } catch (error) {
    return failure(res, error, 400);
  } finally {
    if (guard) {
      guard.running = false;
      guard.until = Date.now() + WELCOME_TEST_COOLDOWN_MS;
      const timer = setTimeout(() => { if (welcomeTestGuards.get(guildId) === guard) welcomeTestGuards.delete(guildId); }, WELCOME_TEST_COOLDOWN_MS);
      timer.unref?.();
    }
  }
});
router.get('/:guildId/scheduled', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); const scheduled = scheduledWelcome.getScheduledConfig(guildId); const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null; return success(res, { scheduled, health }); } catch (error) { return failure(res, error, 400); } });
router.put('/:guildId/scheduled', async (req, res) => { try { const guildId = getGuildId(req); const scheduled = scheduledWelcome.updateScheduledConfig(guildId, req.body || {}, { actorId: getActorId(req) }); const guild = await getGuild(req, guildId); const health = guild ? await scheduledWelcomeHealth.buildHealth(guild) : null; return success(res, { scheduled, health }); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/scheduled/queue', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const { waiting: members, excluded, candidateCount } = await scheduledWelcome.getQueueDiagnostics(guild); return success(res, { excluded, candidateCount, count: members.length, members: members.map((member) => ({ id: member.id, username: member.user?.username || member.id, displayName: member.displayName || member.user?.username || member.id })) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/scheduled/requeue', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const result = await scheduledWelcome.requeueMember(guild, String(req.body?.memberId || ''), { actorId: getActorId(req) }); return success(res, { result }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/scheduled/run', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const result = await scheduledWelcome.runScheduledWelcome(guild, { force: true, actorId: getActorId(req) }); return success(res, { result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/scheduled/repair', async (req, res) => { try { const guildId = getGuildId(req); const guild = await getGuild(req, guildId); if (!guild) throw new Error('Guild is unavailable.'); const result = await scheduledWelcomeHealth.repair(guild, { actorId: getActorId(req) }); return success(res, { result, ...(await buildOverview(req, guildId)) }); } catch (error) { return failure(res, error, 400); } });
router.post('/:guildId/reset', async (req, res) => { try { const guildId = getGuildId(req); welcome.resetWelcome(guildId, { actorId: getActorId(req) }); return success(res, await buildOverview(req, guildId)); } catch (error) { return failure(res, error, 400); } });
router.get('/:guildId/export', (req, res) => { try { const guildId = getGuildId(req); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="goliath-welcome-${guildId}.json"`); return res.send(JSON.stringify(canonicalExport(guildId), null, 2)); } catch (error) { return failure(res, error, 400); } });

module.exports = router;