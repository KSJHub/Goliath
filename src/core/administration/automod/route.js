'use strict';

const express = require('express');
const { PermissionFlagsBits } = require('discord.js');

const guildManager = require('../../guild/guildManager');
const { emitGuildUpdate } = require('../../../server/sockets/socketHub');

const router = express.Router();
const MODULE = 'automod';

const AUTOMOD_ACTIONS = new Set(['dm', 'delete', 'warn', 'timeout', 'kick', 'ban']);
const CORE_RULE_KEYS = ['antiSpam', 'antiLinks', 'badWords', 'caps', 'mentions'];
const ADVANCED_RULE_KEYS = ['invites', 'duplicates', 'flood', 'emojiSpam', 'attachments', 'scamPatterns'];
const ALL_RULE_KEYS = [...CORE_RULE_KEYS, ...ADVANCED_RULE_KEYS];
const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  badWords: '⚠️ **{server} AutoMod**\nBad Word Filter triggered: {reason}',
  caps: '⚠️ **{server} AutoMod**\nCaps Protection triggered: {reason}',
  mentions: '⚠️ **{server} AutoMod**\nMention Protection triggered: {reason}',
  invites: '⚠️ **{server} AutoMod**\nInvite Protection triggered: {reason}',
  duplicates: '⚠️ **{server} AutoMod**\nDuplicate Message Protection triggered: {reason}',
  flood: '⚠️ **{server} AutoMod**\nFlood Protection triggered: {reason}',
  emojiSpam: '⚠️ **{server} AutoMod**\nEmoji Protection triggered: {reason}',
  attachments: '⚠️ **{server} AutoMod**\nAttachment Protection triggered: {reason}',
  scamPatterns: '⚠️ **{server} AutoMod**\nSuspicious Content Protection triggered: {reason}',
};

function getBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body
    : {};
}

function getGuildId(req, res) {
  const guildId = req.params?.guildId;
  if (guildId) return guildId;

  res.status(400).json({ ok: false, error: 'Missing guild ID.' });
  return null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  )];
}

function normalizeDomainArray(value) {
  return normalizeStringArray(value)
    .map((domain) => domain
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
    )
    .filter(Boolean);
}

function normalizeActions(value, fallback = ['delete']) {
  const source = Array.isArray(value) ? value : value ? [value] : fallback;
  const actions = [...new Set(
    source
      .map((item) => normalizeText(item).toLowerCase())
      .filter((item) => AUTOMOD_ACTIONS.has(item))
  )];

  if (actions.includes('ban')) return actions.filter((action) => action !== 'kick' && action !== 'timeout');
  if (actions.includes('kick')) return actions.filter((action) => action !== 'timeout');

  return actions.length ? actions : [...fallback];
}

function normalizeDmMessages(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};

  return Object.fromEntries(
    Object.entries(DEFAULT_DM_MESSAGES).map(([key, fallback]) => [
      key,
      normalizeText(source[key]) || fallback,
    ])
  );
}

function normalizeAutomodConfig(config = {}) {
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  // Require distinct ascending thresholds so each severity band remains reachable.
  const low = normalizeNumber(safeConfig.risk?.low, 25, 1, 497);
  const medium = normalizeNumber(safeConfig.risk?.medium, 50, low + 1, 498);
  const high = normalizeNumber(safeConfig.risk?.high, 75, medium + 1, 499);
  const critical = normalizeNumber(safeConfig.risk?.critical, 100, high + 1, 500);

  return {
    dmUser: normalizeBoolean(safeConfig.dmUser, true),
    shadowMode: normalizeBoolean(safeConfig.shadowMode, false),
    dmMessages: normalizeDmMessages(safeConfig.dmMessages),
    preset: ['relaxed', 'balanced', 'strict', 'custom'].includes(safeConfig.preset) ? safeConfig.preset : 'custom',
    caseMode: ['off', 'punishments', 'medium', 'all'].includes(safeConfig.caseMode) ? safeConfig.caseMode : 'punishments',
    evidenceRetentionDays: normalizeNumber(safeConfig.evidenceRetentionDays, 30, 0, 365),
    risk: {
      enabled: normalizeBoolean(safeConfig.risk?.enabled, true),
      low,
      medium,
      high,
      critical,
      repeatWindowHours: normalizeNumber(safeConfig.risk?.repeatWindowHours, 24, 1, 720),
      repeatWeight: normalizeNumber(safeConfig.risk?.repeatWeight, 10, 0, 100),
    },

    antiSpam: {
      enabled: normalizeBoolean(safeConfig.antiSpam?.enabled, false),
      maxMessages: normalizeNumber(safeConfig.antiSpam?.maxMessages, 5, 2, 100),
      intervalSeconds: normalizeNumber(safeConfig.antiSpam?.intervalSeconds, 10, 1, 3600),
      risk: normalizeNumber(safeConfig.antiSpam?.risk, 20, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.antiSpam?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(
        safeConfig.antiSpam?.actions || safeConfig.antiSpam?.action,
        ['delete']
      ),
    },

    antiLinks: {
      enabled: normalizeBoolean(safeConfig.antiLinks?.enabled, false),
      allowStaff: normalizeBoolean(safeConfig.antiLinks?.allowStaff, true),
      allowedDomains: normalizeDomainArray(safeConfig.antiLinks?.allowedDomains),
      deniedDomains: normalizeDomainArray(safeConfig.antiLinks?.deniedDomains),
      risk: normalizeNumber(safeConfig.antiLinks?.risk, 30, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.antiLinks?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(
        safeConfig.antiLinks?.actions || safeConfig.antiLinks?.action,
        ['delete']
      ),
    },

    badWords: {
      enabled: normalizeBoolean(safeConfig.badWords?.enabled, false),
      words: normalizeStringArray(safeConfig.badWords?.words),
      matchMode: safeConfig.badWords?.matchMode === 'contains' ? 'contains' : 'boundary',
      risk: normalizeNumber(safeConfig.badWords?.risk, 25, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.badWords?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(
        safeConfig.badWords?.actions || safeConfig.badWords?.action,
        ['delete']
      ),
    },

    caps: {
      enabled: normalizeBoolean(safeConfig.caps?.enabled, false),
      percent: normalizeNumber(safeConfig.caps?.percent, 70, 1, 100),
      minLength: normalizeNumber(safeConfig.caps?.minLength, 12, 1, 500),
      risk: normalizeNumber(safeConfig.caps?.risk, 10, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.caps?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(
        safeConfig.caps?.actions || safeConfig.caps?.action,
        ['warn']
      ),
    },

    mentions: {
      enabled: normalizeBoolean(safeConfig.mentions?.enabled, false),
      maxMentions: normalizeNumber(safeConfig.mentions?.maxMentions, 5, 1, 100),
      maxUserMentions: normalizeNumber(safeConfig.mentions?.maxUserMentions, 5, 1, 100),
      maxRoleMentions: normalizeNumber(safeConfig.mentions?.maxRoleMentions, 3, 1, 100),
      blockEveryone: normalizeBoolean(safeConfig.mentions?.blockEveryone, true),
      risk: normalizeNumber(safeConfig.mentions?.risk, 35, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.mentions?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(
        safeConfig.mentions?.actions || safeConfig.mentions?.action,
        ['warn']
      ),
    },

    invites: {
      enabled: normalizeBoolean(safeConfig.invites?.enabled, false),
      allowOwnServer: normalizeBoolean(safeConfig.invites?.allowOwnServer, true),
      allowedCodes: normalizeStringArray(safeConfig.invites?.allowedCodes),
      risk: normalizeNumber(safeConfig.invites?.risk, 35, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.invites?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(safeConfig.invites?.actions || safeConfig.invites?.action, ['delete']),
    },
    duplicates: {
      enabled: normalizeBoolean(safeConfig.duplicates?.enabled, false),
      maxDuplicates: normalizeNumber(safeConfig.duplicates?.maxDuplicates, 3, 2, 50),
      intervalSeconds: normalizeNumber(safeConfig.duplicates?.intervalSeconds, 30, 1, 3600),
      risk: normalizeNumber(safeConfig.duplicates?.risk, 25, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.duplicates?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(safeConfig.duplicates?.actions, ['delete']),
    },
    flood: {
      enabled: normalizeBoolean(safeConfig.flood?.enabled, false),
      maxLines: normalizeNumber(safeConfig.flood?.maxLines, 12, 2, 100),
      maxCharacters: normalizeNumber(safeConfig.flood?.maxCharacters, 1800, 50, 4000),
      maxRepeatedCharacters: normalizeNumber(safeConfig.flood?.maxRepeatedCharacters, 12, 3, 100),
      risk: normalizeNumber(safeConfig.flood?.risk, 20, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.flood?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(safeConfig.flood?.actions, ['delete']),
    },
    emojiSpam: {
      enabled: normalizeBoolean(safeConfig.emojiSpam?.enabled, false),
      maxEmojis: normalizeNumber(safeConfig.emojiSpam?.maxEmojis, 15, 2, 100),
      risk: normalizeNumber(safeConfig.emojiSpam?.risk, 15, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.emojiSpam?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(safeConfig.emojiSpam?.actions, ['delete']),
    },
    scamPatterns: {
      enabled: normalizeBoolean(safeConfig.scamPatterns?.enabled, false),
      phrases: normalizeStringArray(safeConfig.scamPatterns?.phrases),
      risk: normalizeNumber(safeConfig.scamPatterns?.risk, 45, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.scamPatterns?.timeoutMinutes, 30, 1, 40320),
      actions: normalizeActions(safeConfig.scamPatterns?.actions, ['delete', 'timeout']),
    },
    accountRisk: {
      enabled: normalizeBoolean(safeConfig.accountRisk?.enabled, false),
      newAccountDays: normalizeNumber(safeConfig.accountRisk?.newAccountDays, 7, 0, 365),
      newMemberHours: normalizeNumber(safeConfig.accountRisk?.newMemberHours, 24, 0, 720),
      riskBoost: normalizeNumber(safeConfig.accountRisk?.riskBoost, 15, 0, 100),
    },
    attachments: {
      enabled: normalizeBoolean(safeConfig.attachments?.enabled, false),
      maxAttachments: normalizeNumber(safeConfig.attachments?.maxAttachments, 5, 1, 10),
      blockedExtensions: normalizeStringArray(safeConfig.attachments?.blockedExtensions).map((item) => item.replace(/^\./, '')),
      risk: normalizeNumber(safeConfig.attachments?.risk, 20, 0, 100),
      timeoutMinutes: normalizeNumber(safeConfig.attachments?.timeoutMinutes, 10, 1, 40320),
      actions: normalizeActions(safeConfig.attachments?.actions, ['delete']),
    },
    ignoredRoles: normalizeStringArray(safeConfig.ignoredRoles),
    ignoredChannels: normalizeStringArray(safeConfig.ignoredChannels),
    ignoredCategories: normalizeStringArray(safeConfig.ignoredCategories),
    ignoredUsers: normalizeStringArray(safeConfig.ignoredUsers),
  };
}

function mergeAutomodConfig(current, patch) {
  return {
    ...current,
    ...patch,
    dmMessages: {
      ...(current.dmMessages || {}),
      ...(patch.dmMessages || {}),
    },
    antiSpam: {
      ...(current.antiSpam || {}),
      ...(patch.antiSpam || {}),
    },
    antiLinks: {
      ...(current.antiLinks || {}),
      ...(patch.antiLinks || {}),
    },
    badWords: {
      ...(current.badWords || {}),
      ...(patch.badWords || {}),
    },
    caps: {
      ...(current.caps || {}),
      ...(patch.caps || {}),
    },
    mentions: {
      ...(current.mentions || {}),
      ...(patch.mentions || {}),
    },
    risk: { ...(current.risk || {}), ...(patch.risk || {}) },
    accountRisk: { ...(current.accountRisk || {}), ...(patch.accountRisk || {}) },
    ...Object.fromEntries(ADVANCED_RULE_KEYS.map((key) => [key, { ...(current[key] || {}), ...(patch[key] || {}) }])),
  };
}

function canonicalConfig(guildId, config) {
  return {
    ...config,
    enabled: guildManager.isModuleEnabled(guildId, MODULE),
  };
}

function readConfig(guildId) {
  return normalizeAutomodConfig(
    guildManager.getGuildSection(guildId, MODULE, {})
  );
}

function saveConfig(guildId, config, { emit = true } = {}) {
  const saved = guildManager.replaceGuildSection(guildId, MODULE, config);
  const responseConfig = canonicalConfig(guildId, saved);

  if (emit) emitGuildUpdate(guildId, {
    section: MODULE,
    data: responseConfig,
  });

  return responseConfig;
}

function sendSuccess(res, guildId, config) {
  return res.json({
    ok: true,
    guildId,
    config,
  });
}

function sendFailure(res, label, error, publicMessage) {
  console.error(`AutoMod ${label} failed:`, error);
  return res.status(500).json({
    ok: false,
    error: publicMessage,
  });
}

router.get('/:guildId', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    return sendSuccess(res, guildId, canonicalConfig(guildId, readConfig(guildId)));
  } catch (error) {
    return sendFailure(res, 'load', error, 'Failed to load automod config.');
  }
});

router.post('/:guildId', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    const body = getBody(req);

    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      if (typeof body.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled must be a boolean.' });
    }

    const { enabled: _enabled, ...configPatch } = body;
    const payload = normalizeAutomodConfig(
      mergeAutomodConfig(readConfig(guildId), configPatch)
    );

    const hasEnabled = Object.prototype.hasOwnProperty.call(body, 'enabled');
    const saved = saveConfig(guildId, payload, { emit: !hasEnabled });
    if (hasEnabled) {
      guildManager.setModuleEnabled(guildId, MODULE, body.enabled);
      emitGuildUpdate(guildId, { section: MODULE, data: canonicalConfig(guildId, saved) });
    }
    return sendSuccess(res, guildId, canonicalConfig(guildId, saved));
  } catch (error) {
    return sendFailure(res, 'save', error, 'Failed to save automod config.');
  }
});

router.post('/:guildId/reset', (req, res) => {
  const guildId = getGuildId(req, res);
  if (!guildId) return undefined;

  try {
    const saved = saveConfig(guildId, normalizeAutomodConfig({}), { emit: false });
    guildManager.setModuleEnabled(guildId, MODULE, false);
    const resetConfig = canonicalConfig(guildId, saved);
    emitGuildUpdate(guildId, { section: MODULE, data: resetConfig });
    return sendSuccess(res, guildId, resetConfig);
  } catch (error) {
    return sendFailure(res, 'reset', error, 'Failed to reset automod config.');
  }
});

async function requestGuild(req, guildId) {
  const client=req.client||req.app?.get?.('goliath.client')||req.app?.locals?.client||req.app?.locals?.discordClient||null;
  if(!client?.guilds) return null;
  return client.guilds.cache.get(guildId)||await client.guilds.fetch(guildId).catch(()=>null);
}
function nativeRule(rule) {
  return {id:rule.id,name:rule.name,enabled:rule.enabled,eventType:rule.eventType,triggerType:rule.triggerType,triggerMetadata:rule.triggerMetadata,actions:rule.actions,exemptRoles:[...(rule.exemptRoles?.keys?.()||[])],exemptChannels:[...(rule.exemptChannels?.keys?.()||[])],creatorId:rule.creatorId||null};
}
router.get('/health/:guildId',async(req,res)=>{
  try{
    const guild=await requestGuild(req,req.params.guildId);if(!guild)return res.status(404).json({ok:false,error:'Guild unavailable.'});
    const me=guild.members.me||await guild.members.fetchMe().catch(()=>null),permissions=me?.permissions;
    const checks=[
      ['Manage Messages',PermissionFlagsBits.ManageMessages],
      ['Moderate Members',PermissionFlagsBits.ModerateMembers],
      ['Kick Members',PermissionFlagsBits.KickMembers],
      ['Ban Members',PermissionFlagsBits.BanMembers],
      ['Manage Guild',PermissionFlagsBits.ManageGuild],
    ].map(([name,flag])=>({name,ok:Boolean(permissions?.has(flag))}));
    const config=readConfig(guild.id),enabled=ALL_RULE_KEYS.filter((key)=>config[key]?.enabled===true).length;
    const logId=typeof guildManager.getLogChannelId==='function'?guildManager.getLogChannelId(guild.id,'automod'):null;
    const logChannel=logId?(guild.channels.cache.get(logId)||await guild.channels.fetch(logId).catch(()=>null)):null;
    const issues=[];if(!guildManager.isModuleEnabled(guild.id,MODULE))issues.push('AutoMod is disabled.');if(!enabled)issues.push('No protections are enabled.');if(!logChannel)issues.push('AutoMod log channel is not configured or unavailable.');for(const check of checks)if(!check.ok)issues.push('Missing '+check.name+' permission.');
    return res.json({ok:true,status:issues.length?'degraded':'healthy',enabledProtections:enabled,logChannelId:logChannel?.id||null,permissions:checks,issues});
  }catch(error){return sendFailure(res,'health check',error,'Failed to check AutoMod health.');}
});

router.get('/native/:guildId',async(req,res)=>{
  try{const guild=await requestGuild(req,req.params.guildId);if(!guild)return res.status(404).json({ok:false,error:'Guild unavailable.'});const rules=await guild.autoModerationRules.fetch();return res.json({ok:true,rules:[...rules.values()].map(nativeRule)});}catch(error){return sendFailure(res,'native AutoMod load',error,'Failed to load Discord AutoMod rules.');}
});
router.patch('/native/:guildId/:ruleId',async(req,res)=>{
  try{const guild=await requestGuild(req,req.params.guildId);if(!guild)return res.status(404).json({ok:false,error:'Guild unavailable.'});const rule=await guild.autoModerationRules.fetch(req.params.ruleId);if(!rule)return res.status(404).json({ok:false,error:'Discord AutoMod rule not found.'});const body=getBody(req),patch={};if(typeof body.enabled==='boolean')patch.enabled=body.enabled;if(typeof body.name==='string'&&body.name.trim())patch.name=body.name.trim().slice(0,100);const updated=await rule.edit(patch,'Goliath AutoMod dashboard');return res.json({ok:true,rule:nativeRule(updated)});}catch(error){return sendFailure(res,'native AutoMod update',error,'Failed to update Discord AutoMod rule.');}
});
router.delete('/native/:guildId/:ruleId',async(req,res)=>{
  try{const guild=await requestGuild(req,req.params.guildId);if(!guild)return res.status(404).json({ok:false,error:'Guild unavailable.'});const rule=await guild.autoModerationRules.fetch(req.params.ruleId);if(!rule)return res.status(404).json({ok:false,error:'Discord AutoMod rule not found.'});await rule.delete('Goliath AutoMod dashboard');return res.json({ok:true,deleted:req.params.ruleId});}catch(error){return sendFailure(res,'native AutoMod delete',error,'Failed to delete Discord AutoMod rule.');}
});

module.exports = router;
module.exports.normalizeAutomodConfig = normalizeAutomodConfig;
module.exports.DEFAULT_DM_MESSAGES = DEFAULT_DM_MESSAGES;
module.exports.RULE_KEYS = ALL_RULE_KEYS;
