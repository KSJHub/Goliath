'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../../../core/guild/guildManager');
const security = require('../../../../core/security/protection/core');
const timedRoles = require('../../../../modules/roleStudio/timedRoles/timedRolesService');
const timedRolesHealth = require('../../../../modules/roleStudio/timedRoles/timedRolesHealth');
const { validateRoleSelection, isGoliathPermissionError } = require('../../../../core/security/protection/permissions');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });

function fail(res, error, status = 400) {
  if (isGoliathPermissionError(error)) {
    return res.status(403).json({ success: false, code: error.code, error: error.message, ...(error.details || {}) });
  }
  return res.status(status).json({ success: false, error: error.message || 'Timed Roles request failed.' });
}

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{15,25}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}
function cleanDiscordId(value) {
  const id = String(value || '').replace(/[<@#!&>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}
const actor = (req) => cleanDiscordId(req.timedRolesActorId || req.session?.user?.id);
const client = (req) => req.client || req.app?.get?.('goliath.client') || null;

async function guild(req, id) {
  const discord = client(req);
  return discord?.guilds?.cache?.get(id) || await discord?.guilds?.fetch?.(id).catch(() => null);
}

async function requireTimedRolesAccess(req, res, next) {
  try {
    const userId = cleanDiscordId(req.session?.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const id = guildId(req);
    req.timedRolesActorId = userId;
    if (security.isBotOwner(userId)) return next();
    const target = await guild(req, id);
    if (!target) return res.status(403).json({ success: false, error: 'Guild is unavailable or not accessible.' });
    const member = target.members.cache.get(userId) || await target.members.fetch(userId).catch(() => null);
    const allowed = Boolean(
      member?.permissions?.has(PermissionFlagsBits.Administrator)
      || member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    );
    if (!allowed) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    return next();
  } catch (error) {
    return fail(res, error, 403);
  }
}

router.use('/:guildId', (req,res,next) => {
  // Only exact read-only records routes use the independent membership ACL.
  if(req.method==='GET' && /^\/(?:records(?:\/\d{15,25})?|audit)\/?$/.test(req.path)) return next();
  return requireTimedRolesAccess(req,res,next);
});

async function validateRuleRoles(target, input = {}) {
  const roleIds = [input.roleId, ...(Array.isArray(input.removeRoleIds) ? input.removeRoleIds : [])].filter(Boolean);
  if (!roleIds.length) throw new Error('A target role is required.');
  const validation = await validateRoleSelection(target, roleIds, { scope: 'timed_roles.rules', requireManageable: true });
  if (!validation.ok) throw validation.toError();
}

async function overview(req, id) {
  const enabled = guildManager.isModuleEnabled(id, timedRoles.SECTION);
  const { achievementHistory, operationalAudit, memberOverrides, auditDelivery, ...publicConfig } = timedRoles.getSection(id);
  const config = { ...publicConfig, enabled };
  const target = await guild(req, id);
  return {
    guildId: id,
    config,
    overview: {
      enabled,
      ruleCount: timedRoles.listRules(id).length,
      analytics: config.analytics,
      health: target ? await timedRolesHealth.buildTimedRolesHealth(target) : null,
    },
  };
}

router.get('/:guildId/overview', async (req, res) => {
  try { return ok(res, await overview(req, guildId(req))); }
  catch (error) { return fail(res, error); }
});
router.patch('/:guildId/enabled', async (req, res) => {
  try {
    const id = guildId(req);
    timedRoles.setEnabled(id, req.body?.enabled === true, { actorId: actor(req), action: 'timed_roles_dashboard_toggle' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.patch('/:guildId/settings', async (req, res) => {
  try {
    const id = guildId(req);
    const patch = req.body?.settings || req.body || {};
    if (Object.prototype.hasOwnProperty.call(patch,'recordsAccess')) {
      const target = await guild(req,id);
      if (!target || target.ownerId !== actor(req)) return fail(res,new Error('Only the guild owner may change membership record access.'),403);
      const access=patch.recordsAccess;
      if(!access || typeof access.allowAdministrators!=='boolean' || !Array.isArray(access.roleIds) || access.roleIds.length>10)throw new Error('Invalid membership access settings.');
      const roles=await target.roles.fetch();
      if(access.roleIds.some(roleId=>typeof roleId!=='string' || roleId===id || !roles.has(roleId)))throw new Error('Select valid guild access roles other than @everyone.');
      patch.recordsAccess={allowAdministrators:access.allowAdministrators,roleIds:[...new Set(access.roleIds)]};
    }
    timedRoles.updateSettings(id, patch, { actorId: actor(req), action: 'timed_roles_dashboard_settings' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/celebration-preview', async (req,res) => {
  try {
    const id=guildId(req), target=await guild(req,id);
    const member=target && await target.members.fetch(actor(req)).catch(()=>null);
    if(!member)throw new Error('Preview member unavailable.');
    const input=req.body || {}, existing=timedRoles.getRule(id,input.ruleId);
    const rule={...existing,name:String(input.name || existing?.name || 'Example milestone').slice(0,100),roleId:cleanDiscordId(input.roleId)||existing?.roleId||null,value:Math.max(1,Math.min(1000000,Number(input.value)||1)),unit:['minutes','hours','days','weeks','months','years'].includes(input.unit)?input.unit:(existing?.unit || 'months')};
    const settings={...timedRoles.getSection(id).settings,...(input.celebration || {})};
    const role=target.roles.cache.get(rule.roleId);
    const rendered=timedRoles.renderCelebration(member,rule,role,settings,timedRoles.getMemberProgression(member,timedRoles.listRules(id)));
    res.setHeader('Cache-Control','no-store');
    return ok(res,{title:rendered.title.slice(0,256),message:rendered.message.slice(0,settings.celebrationEmbed===false?2000:4096),embed:settings.celebrationEmbed!==false,gif:typeof settings.celebrationGif==='string' && /^https:\/\//i.test(settings.celebrationGif)?settings.celebrationGif:null});
  }catch(error){return fail(res,error);}
});
router.post('/:guildId/rules/create-with-role', async (req,res) => {
  try {
    const id=guildId(req), target=await guild(req,id);
    if(!target)throw new Error('Guild unavailable.');
    const member=await target.members.fetch(actor(req)).catch(()=>null);
    if(!(target.ownerId===actor(req) || member?.permissions.has(PermissionFlagsBits.Administrator)))return fail(res,new Error('Administrator permission required.'),403);
    const input=req.body || {}, name=String(input.name || '').trim(), value=Number(input.value);
    if(!name || name.length>100 || !Number.isInteger(value) || value<1 || value>1000000 || !['minutes','hours','days','weeks','months','years'].includes(input.unit))throw new Error('Invalid milestone name or duration.');
    if(!['original','continuous','custom'].includes(input.startMode || 'original'))throw new Error('Invalid starting point.');
    if(input.startMode==='custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(input.customStartAt || '') || !Number.isFinite(Date.parse(input.customStartAt)) || new Date(input.customStartAt).toISOString().slice(0,10)!==input.customStartAt))throw new Error('Invalid custom date.');
    const rule=await timedRoles.withTimedRolesLock(id,async()=>{
      if(!target.members.me?.permissions.has(PermissionFlagsBits.ManageRoles))throw new Error('Goliath requires Manage Roles.');
      const roles=await target.roles.fetch();
      if(roles.some(role=>role.name.toLowerCase()===name.toLowerCase()))throw new Error('A role with this name exists. Select it instead.');
      if(input.removeRoleIds?.length)await validateRuleRoles(target,{removeRoleIds:input.removeRoleIds});
      const role=await target.roles.create({name,permissions:[],mentionable:false,reason:'Timed Roles milestone creation'});
      try{return timedRoles.saveRule(id,{name,value,unit:input.unit,startMode:input.startMode,customStartAt:input.customStartAt,removeRoleIds:input.removeRoleIds,celebration:input.celebration,enabled:true,roleId:role.id,createdBy:actor(req)},{actorId:actor(req)});}
      catch(error){throw new Error('Role created but milestone save failed. Role ID '+role.id+': '+error.message);}
    });
    return ok(res,{rule,...(await overview(req,id))});
  }catch(error){return fail(res,error);}
});
router.post('/:guildId/rules', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    await validateRuleRoles(target, req.body || {});
    const rule = timedRoles.saveRule(id, { ...(req.body || {}), createdBy: actor(req) }, { actorId: actor(req), action: 'timed_roles_dashboard_create_rule' });
    return ok(res, { rule, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.put('/:guildId/rules/:ruleId', async (req, res) => {
  try {
    const id = guildId(req);
    const current = timedRoles.getRule(id, req.params.ruleId);
    if (!current) return fail(res, new Error('Timed role rule not found.'), 404);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const next = { ...current, ...(req.body || {}), ruleId: current.ruleId };
    await validateRuleRoles(target, next);
    const rule = timedRoles.saveRule(id, next, { actorId: actor(req), action: 'timed_roles_dashboard_update_rule' });
    return ok(res, { rule, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/rules/:ruleId/recover-role', async (req,res) => {
  try {
    const id=guildId(req), target=await guild(req,id);
    if(!target) throw new Error('Guild unavailable.');
    const member=await target.members.fetch(actor(req)).catch(()=>null);
    if(!(target.ownerId===actor(req) || member?.permissions.has(PermissionFlagsBits.Administrator))) return fail(res,new Error('Administrator permission required.'),403);
    const rule=await timedRoles.withTimedRolesLock(id,async()=>{
      const current=timedRoles.getRule(id,req.params.ruleId);
      if(!current)throw new Error('Milestone not found.');
      const roles=await target.roles.fetch();
      if(roles.has(current.roleId))throw new Error('The reward role still exists.');
      if(!target.members.me?.permissions.has(PermissionFlagsBits.ManageRoles))throw new Error('Goliath requires Manage Roles.');
      let role;
      if(req.body?.roleId){
        role=roles.get(cleanDiscordId(req.body.roleId));
        if(!role)throw new Error('Replacement role not found.');
        await validateRuleRoles(target,{...current,roleId:role.id});
      }else{
        const name=String(current.name || '').trim().slice(0,100);
        if(!name || roles.some(item=>item.name.toLowerCase()===name.toLowerCase()))throw new Error('Select an existing role instead; the milestone name is unavailable.');
        role=await target.roles.create({name,permissions:[],mentionable:false,reason:'Timed Roles reward recovery'});
      }
      try{return timedRoles.saveRule(id,{...current,roleId:role.id},{actorId:actor(req),action:'timed_roles_reward_recovery'});}
      catch(error){throw new Error('Reward could not be linked. Role ID '+role.id+': '+error.message);}
    });
    return ok(res,{rule,...(await overview(req,id))});
  }catch(error){return fail(res,error);}
});
router.delete('/:guildId/rules/:ruleId', async (req, res) => {
  try {
    const id = guildId(req);
    if (!timedRoles.getRule(id, req.params.ruleId)) return fail(res, new Error('Timed role rule not found.'), 404);
    timedRoles.removeRule(id, req.params.ruleId, { actorId: actor(req), action: 'timed_roles_dashboard_delete_rule' });
    return ok(res, await overview(req, id));
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/scan', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    return ok(res, { result: await timedRoles.scanGuild(target, { actorId: actor(req), action: 'timed_roles_dashboard_scan' }), ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
router.post('/:guildId/repair', async (req, res) => {
  try {
    const id = guildId(req);
    const target = await guild(req, id);
    if (!target) throw new Error('Guild is unavailable.');
    const repair = await timedRolesHealth.repairTimedRoles(target, { actorId: actor(req), action: 'timed_roles_dashboard_repair' });
    return ok(res, { repair, ...(await overview(req, id)) });
  } catch (error) { return fail(res, error); }
});
async function requireRecordsAccess(req,res,next) {
  try {
    const id = guildId(req);
    const target = await guild(req,id);
    const userId = cleanDiscordId(req.session?.user?.id);
    if(!userId)return res.status(401).json({success:false,error:'Authentication required.'});
    const member = target && await target.members.fetch({user:userId,force:true}).catch(() => null);
    if(!target || !member)return fail(res,new Error('Membership record access denied.'),403);
    req.timedRolesActorId=userId;
    const access = timedRoles.getSection(id).settings.recordsAccess || {};
    if (!target || !(target.ownerId === userId || (access.allowAdministrators !== false && member?.permissions.has(PermissionFlagsBits.Administrator)) || (Array.isArray(access.roleIds) ? access.roleIds : []).some(roleId => roleId !== id && member?.roles.cache.has(roleId)))) return fail(res,new Error('Membership record access denied.'),403);
    res.setHeader('Cache-Control','no-store');
    return next();
  } catch(error) { return fail(res,error,403); }
}
router.get('/:guildId/records', requireRecordsAccess, (req,res) => {
  try {
    const records = guildManager.getGuildSection(guildId(req),'membershipRecords',{}).members || {};
    const ids = Object.keys(records).sort();
    const page = Math.min(Math.max(0,Math.ceil(ids.length/25)-1),Math.max(0,Math.floor(Number(req.query.page)||0)));
    return ok(res,{total:ids.length,page,records:ids.slice(page*25,page*25+25).map(id=>({ ...records[id], id, history:undefined }))});
  } catch(error) { return fail(res,error); }
});
router.get('/:guildId/records/:memberId', requireRecordsAccess, (req,res) => {
  try {
    const id = guildId(req), memberId = cleanDiscordId(req.params.memberId);
    const record = guildManager.getGuildSection(id,'membershipRecords',{}).members?.[memberId];
    if (!record) return fail(res,new Error('Membership record not found.'),404);
    const section = timedRoles.getSection(id);
    return ok(res,{record,achievements:section.achievementHistory?.[memberId] || {},overrides:section.memberOverrides?.[memberId] || {}});
  } catch(error) { return fail(res,error); }
});
router.put('/:guildId/records/:memberId/overrides/:ruleId', requireRecordsAccess, async (req,res) => {
  try {
    const id=guildId(req), memberId=cleanDiscordId(req.params.memberId), target=await guild(req,id);
    const member=target && await target.members.fetch(actor(req)).catch(()=>null);
    if (!target || !(target.ownerId===actor(req) || member?.permissions.has(PermissionFlagsBits.Administrator))) return fail(res,new Error('Administrator permission required.'),403);
    if (!memberId || !guildManager.getGuildSection(id,'membershipRecords',{}).members?.[memberId]) return fail(res,new Error('Membership record not found.'),404);
    if (!timedRoles.getRule(id,req.params.ruleId)) return fail(res,new Error('Milestone not found.'),404);
    const dates={};
    for(const key of ['startAt','dueAt']) {
      const value=req.body?.[key];
      if(value==null || value===''){dates[key]=null;continue;}
      if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw new Error('Enter valid dates in YYYY-MM-DD format.');
      dates[key]=value;
    }
    if(dates.startAt && dates.dueAt && dates.dueAt<dates.startAt) throw new Error('Due date cannot precede the starting date.');
    timedRoles.setMemberMilestoneOverride(id,memberId,req.params.ruleId,dates,{actorId:actor(req)});
    return ok(res,{overrides:timedRoles.getSection(id).memberOverrides?.[memberId] || {}});
  } catch(error){return fail(res,error);}
});
router.get('/:guildId/audit', requireRecordsAccess, (req,res) => {
  try {
    const events = timedRoles.getSection(guildId(req)).operationalAudit || [];
    const page = Math.min(Math.max(0,Math.ceil(events.length/25)-1),Math.max(0,Math.floor(Number(req.query.page)||0)));
    return ok(res,{total:events.length,page,events:events.slice().reverse().slice(page*25,page*25+25)});
  } catch(error) { return fail(res,error); }
});
router.get('/:guildId/export', (req, res) => {
  try {
    const id = guildId(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="goliath-timed-roles-${id}.json"`);
    const { achievementHistory, operationalAudit, memberOverrides, auditDelivery, ...config } = timedRoles.exportConfiguration(id);
    return res.send(JSON.stringify(config, null, 2));
  } catch (error) { return fail(res, error); }
});

module.exports = router;
