'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const { replaceVars } = require('../../guild/guildVariables');
const { applyPunishmentEngine, normalizePunishments } = require('./engine');
const { normalizeAutomodConfig } = require('./route');
const modStorage = require('../mod/storage');

const AUTOMOD_MODULE = 'automod';
const spamWindows = new Map();

const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  badWords: '⚠️ **{server} AutoMod**\nBad Word Filter triggered: {reason}',
  caps: '⚠️ **{server} AutoMod**\nCaps Protection triggered: {reason}',
  mentions: '⚠️ **{server} AutoMod**\nMention Protection triggered: {reason}',
};

function readAutomodSection(guildId) {
  try {
    const guildData = guildManager.getGuildData(guildId, { forceReload: true });
    return guildData?.modules?.automod || {};
  } catch (error) {
    console.error(`[AutoMod] Failed to read guild config for ${guildId}:`, error?.stack || error?.message || error);
    return {};
  }
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function normalizeDomainList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalizeDomain).filter(Boolean))];
}

function normalizeStringList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeIdList(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function getAutoModConfig(guildId) {
  const config = normalizeAutomodConfig(readAutomodSection(guildId));
  return { ...config, enabled: guildManager.isModuleEnabled(guildId, AUTOMOD_MODULE) };
}

function isIgnored(message, config) {
  if (config.ignoredUsers?.includes(String(message.author?.id))) return true;
  if (config.ignoredChannels.includes(String(message.channelId))) return true;
  if (config.ignoredCategories?.includes(String(message.channel?.parentId || ''))) return true;
  const roleIds = message.member?.roles?.cache ? [...message.member.roles.cache.keys()].map(String) : [];
  return roleIds.some((roleId) => config.ignoredRoles.includes(roleId));
}

function isStaff(message) {
  return Boolean(
    message.member?.permissions?.has(PermissionFlagsBits.Administrator)
    || message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)
    || message.guild?.ownerId === message.author.id
  );
}

function renderDmMessage(template, message, reason) {
  const interaction = {
    guild: message.guild,
    guildId: message.guild?.id,
    user: message.author,
    member: message.member,
    channel: message.channel,
    channelId: message.channelId,
  };

  return replaceVars(template, interaction, false, {
    '{reason}': reason,
    '{user}': message.author.username,
  });
}

function extractDomains(content) {
  const matches = String(content || '').match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  const domains = [];
  for (const raw of matches) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const host = normalizeDomain(url.hostname);
      if (host) domains.push(host);
    } catch {}
  }
  return [...new Set(domains)];
}

function domainMatches(domain, configured) {
  return domain === configured || domain.endsWith(`.${configured}`);
}

function evaluateLinkRule(domains, rule) {
  if (!domains.length) return null;
  const denied = domains.find((domain) => rule.deniedDomains.some((entry) => domainMatches(domain, entry)));
  if (denied) return { blocked: denied, reason: `Denied domain detected: ${denied}` };

  if (rule.allowedDomains.length) {
    const unapproved = domains.find((domain) => !rule.allowedDomains.some((entry) => domainMatches(domain, entry)));
    if (unapproved) return { blocked: unapproved, reason: `Domain is not on the allowed list: ${unapproved}` };
    return null;
  }

  if (!rule.deniedDomains.length) {
    return { blocked: domains[0], reason: `Links are not permitted: ${domains[0]}` };
  }

  return null;
}

function findBadWord(content, words, mode = 'boundary') {
  const lower = String(content || '').normalize('NFKC').toLowerCase();
  if (mode === 'contains') return words.find((word) => lower.includes(word)) || null;
  return words.find((word) => {
    const escaped = String(word).replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(lower);
  }) || null;
}

function evaluateCaps(content, rule) {
  const text = String(content || '');
  if (text.length < rule.minLength) return null;
  const letters = text.match(/[a-z]/gi) || [];
  if (!letters.length) return null;
  const uppercase = letters.filter((letter) => letter === letter.toUpperCase()).length;
  const percent = Math.round((uppercase / letters.length) * 100);
  return percent >= rule.percent ? { percent, reason: `Capital letters reached ${percent}% (limit ${rule.percent}%)` } : null;
}

function countMentions(message) {
  const users = message.mentions?.users?.size || 0;
  const roles = message.mentions?.roles?.size || 0;
  const everyone = message.mentions?.everyone ? 1 : 0;
  return users + roles + everyone;
}

async function sendAutoModLog(message, ruleName, reason, actions, result) {
  const channelId = typeof guildManager.getLogChannelId === 'function'
    ? guildManager.getLogChannelId(message.guild.id, 'automod')
    : guildManager.getGuildSection(message.guild.id, 'logs', { channels: {} })?.channels?.automod || null;
  if (!channelId) return false;
  const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle(`🤖 AutoMod · ${ruleName}`)
    .addFields(
      { name: 'User', value: `${message.author} (\`${message.author.id}\`)`, inline: false },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Actions', value: actions.join(', ') || 'None', inline: true },
      { name: 'Reason', value: String(reason).slice(0, 1024), inline: false },
      { name: 'Applied', value: result?.applied?.join(', ') || 'None', inline: true },
      { name: 'Failed', value: result?.failed?.join(', ') || 'None', inline: true },
      { name: 'Message', value: String(message.content || '[no text content]').slice(0, 1000), inline: false },
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
  return true;
}

async function applyRule(message, config, ruleKey, ruleName, reason, actions) {
  const dmMessage = renderDmMessage(config.dmMessages[ruleKey], message, reason);
  let result;
  try {
    result = await applyPunishmentEngine(
      {
        message,
        member: message.member,
        user: message.author,
        guild: message.guild,
        channel: message.channel,
      },
      {
        punishments: actions,
        rule: ruleName,
        reason,
        source: 'automod',
        messageContent: message.content,
        dmEnabled: config.dmUser,
        dmMessage,
      }
    );
  } catch (error) {
    console.error(`[AutoMod] ${ruleName} punishment engine failed:`, error?.stack || error?.message || error);
    result = { applied: [], failed: actions };
  }

  await sendAutoModLog(message, ruleName, reason, actions, result);
  return true;
}

async function handleSpam(message, config) {
  if (!config.antiSpam.enabled) return false;
  const now = Date.now();
  const windowMs = config.antiSpam.intervalSeconds * 1000;
  const key = `${message.guild.id}:${message.author.id}`;
  const timestamps = (spamWindows.get(key) || []).filter((timestamp) => now - timestamp <= windowMs);
  timestamps.push(now);
  spamWindows.set(key, timestamps);
  if (timestamps.length < config.antiSpam.maxMessages) return false;
  spamWindows.delete(key);
  return applyRule(message, config, 'antiSpam', 'Spam Protection', `${timestamps.length} messages sent within ${config.antiSpam.intervalSeconds} seconds`, config.antiSpam.actions);
}

async function handleLinks(message, config) {
  if (!config.antiLinks.enabled) return false;
  if (config.antiLinks.allowStaff && isStaff(message)) return false;
  const violation = evaluateLinkRule(extractDomains(message.content), config.antiLinks);
  if (!violation) return false;
  return applyRule(message, config, 'antiLinks', 'Link Protection', violation.reason, config.antiLinks.actions);
}

async function handleBadWords(message, config) {
  if (!config.badWords.enabled || !config.badWords.words.length) return false;
  const blocked = findBadWord(message.content, config.badWords.words, config.badWords.matchMode);
  if (!blocked) return false;
  return applyRule(message, config, 'badWords', 'Bad Word Filter', `Blocked word or phrase detected: ${blocked}`, config.badWords.actions);
}

async function handleCaps(message, config) {
  if (!config.caps.enabled) return false;
  const violation = evaluateCaps(message.content, config.caps);
  if (!violation) return false;
  return applyRule(message, config, 'caps', 'Caps Protection', violation.reason, config.caps.actions);
}

async function handleMentions(message, config) {
  if (!config.mentions.enabled) return false;
  const count = countMentions(message);
  if (count <= config.mentions.maxMentions) return false;
  return applyRule(message, config, 'mentions', 'Mention Protection', `${count} mentions detected (limit ${config.mentions.maxMentions})`, config.mentions.actions);
}


const duplicateWindows = new Map();
const incidentWindows = new Map();

function normalizeMessageText(content) {
  return String(content || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
function inviteCodes(content) {
  return [...String(content || '').matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/gi)].map((match) => match[1].toLowerCase());
}
function countEmoji(content) {
  const custom = (String(content || '').match(/<a?:\w+:\d+>/g) || []).length;
  const unicode = (String(content || '').match(/\p{Extended_Pictographic}/gu) || []).length;
  return custom + unicode;
}
function attachmentExtension(attachment) {
  const name = String(attachment?.name || attachment?.url || '').split('?')[0];
  const match = name.match(/\.([a-z0-9]{1,12})$/i);
  return match ? match[1].toLowerCase() : '';
}
function severityFor(score, risk) {
  if (score >= risk.critical) return 'critical';
  if (score >= risk.high) return 'high';
  if (score >= risk.medium) return 'medium';
  if (score >= risk.low) return 'low';
  return 'notice';
}
function recentIncidentCount(message, config) {
  const key = message.guild.id + ':' + message.author.id;
  const now = Date.now(), windowMs = config.risk.repeatWindowHours * 3600000;
  const recent = (incidentWindows.get(key) || []).filter((time) => now - time <= windowMs);
  return { key, recent, now };
}
function recordIncident(message, config) {
  const state = recentIncidentCount(message, config);
  state.recent.push(state.now);
  incidentWindows.set(state.key, state.recent.slice(-50));
}
function collectAdvancedViolations(message, config) {
  const out = [], content = String(message.content || '');
  if (config.invites?.enabled) {
    const codes = inviteCodes(content);
    const blocked = codes.find((code) => !config.invites.allowedCodes.includes(code));
    if (blocked) out.push({ key:'invites', name:'Invite Protection', reason:'Unapproved Discord invite detected', risk:config.invites.risk, rule:config.invites });
  }
  if (config.duplicates?.enabled) {
    const normalized = normalizeMessageText(content);
    if (normalized) {
      const key = message.guild.id + ':' + message.author.id, now = Date.now(), ms = config.duplicates.intervalSeconds * 1000;
      const recent = (duplicateWindows.get(key) || []).filter((entry) => now - entry.at <= ms);
      recent.push({ at:now, text:normalized }); duplicateWindows.set(key,recent.slice(-50));
      const same = recent.filter((entry) => entry.text === normalized).length;
      if (same >= config.duplicates.maxDuplicates) out.push({ key:'duplicates', name:'Duplicate Message Protection', reason:same+' matching messages within '+config.duplicates.intervalSeconds+' seconds', risk:config.duplicates.risk, rule:config.duplicates });
    }
  }
  if (config.flood?.enabled) {
    const lines = content.split(/\r?\n/).length;
    const repeat = new RegExp('(.)\\1{' + Math.max(2, config.flood.maxRepeatedCharacters - 1) + ',}').test(content);
    if (lines > config.flood.maxLines || content.length > config.flood.maxCharacters || repeat) out.push({ key:'flood', name:'Flood Protection', reason:'Message flooding limits exceeded', risk:config.flood.risk, rule:config.flood });
  }
  if (config.emojiSpam?.enabled) {
    const total = countEmoji(content);
    if (total > config.emojiSpam.maxEmojis) out.push({ key:'emojiSpam', name:'Emoji Protection', reason:total+' emojis detected (limit '+config.emojiSpam.maxEmojis+')', risk:config.emojiSpam.risk, rule:config.emojiSpam });
  }
  if (config.attachments?.enabled) {
    const files = [...(message.attachments?.values?.() || [])];
    const blocked = files.find((file) => config.attachments.blockedExtensions.includes(attachmentExtension(file)));
    if (files.length > config.attachments.maxAttachments || blocked) out.push({ key:'attachments', name:'Attachment Protection', reason:blocked?'Blocked attachment type: .'+attachmentExtension(blocked):files.length+' attachments detected (limit '+config.attachments.maxAttachments+')', risk:config.attachments.risk, rule:config.attachments });
  }
  return out;
}
function collectCoreViolations(message, config) {
  const out = [], content = String(message.content || '');
  if (config.antiLinks.enabled && !(config.antiLinks.allowStaff && isStaff(message))) {
    const hit = evaluateLinkRule(extractDomains(content), config.antiLinks);
    if (hit) out.push({key:'antiLinks',name:'Link Protection',reason:hit.reason,risk:config.antiLinks.risk,rule:config.antiLinks});
  }
  if (config.badWords.enabled && config.badWords.words.length) {
    const hit = findBadWord(content, config.badWords.words, config.badWords.matchMode);
    if (hit) out.push({key:'badWords',name:'Content Protection',reason:'Blocked word or phrase detected: '+hit,risk:config.badWords.risk,rule:config.badWords});
  }
  if (config.caps.enabled) {
    const hit=evaluateCaps(content,config.caps); if(hit) out.push({key:'caps',name:'Caps Protection',reason:hit.reason,risk:config.caps.risk,rule:config.caps});
  }
  if (config.mentions.enabled) {
    const users=message.mentions?.users?.size||0, roles=message.mentions?.roles?.size||0, total=countMentions(message);
    if (total>config.mentions.maxMentions || users>config.mentions.maxUserMentions || roles>config.mentions.maxRoleMentions || (config.mentions.blockEveryone && message.mentions?.everyone)) out.push({key:'mentions',name:'Mention Protection',reason:total+' mentions detected',risk:config.mentions.risk,rule:config.mentions});
  }
  return out;
}
function strongestActions(violations) {
  const order=['dm','delete','warn','timeout','kick','ban'], set=new Set();
  for(const violation of violations) for(const action of violation.rule.actions||[]) set.add(action);
  if(set.has('ban')) { set.delete('kick'); set.delete('timeout'); }
  else if(set.has('kick')) set.delete('timeout');
  return order.filter((action)=>set.has(action));
}
function shouldCreateCase(config, severity, actions) {
  if(config.caseMode==='off') return false;
  if(config.caseMode==='all') return true;
  if(config.caseMode==='medium') return ['medium','high','critical'].includes(severity);
  return actions.some((action)=>['warn','timeout','kick','ban'].includes(action));
}
async function enforceIncident(message, config, violations) {
  const repeat = recentIncidentCount(message,config).recent.length;
  const baseRisk = violations.reduce((sum,item)=>sum+Number(item.risk||0),0);
  const score = Math.min(500,baseRisk+(config.risk.enabled?repeat*config.risk.repeatWeight:0));
  const severity = severityFor(score,config.risk);
  const actions = strongestActions(violations);
  const reason = violations.map((item)=>item.name+': '+item.reason).join(' | ').slice(0,1800);
  const timeoutMinutes = Math.max(...violations.map((item)=>Number(item.rule.timeoutMinutes||10)),10);
  let result;
  try {
    result=await applyPunishmentEngine({message,member:message.member,user:message.author,guild:message.guild,channel:message.channel},{punishments:actions,rule:violations.map((item)=>item.name).join(' + '),reason,source:'automod',messageContent:message.content,dmEnabled:config.dmUser,dmMessage:renderDmMessage(config.dmMessages[violations[0].key]||'',message,reason),timeoutMinutes});
  } catch(error) {
    console.error('[AutoMod] Enforcement failed:',error?.stack||error); result={applied:[],failed:actions};
  }
  let caseId=null;
  if(shouldCreateCase(config,severity,actions)) {
    try {
      const created=modStorage.createCase({guildId:message.guild.id,userId:message.author.id,moderatorId:message.client?.user?.id||'Goliath',action:'automod',reason,metadata:{source:'automod',severity,riskScore:score,rules:violations.map((item)=>item.key),channelId:message.channelId,messageId:message.id,evidence:config.evidenceRetentionDays>0?{content:String(message.content||'').slice(0,2000),attachments:[...(message.attachments?.values?.()||[])].map((a)=>({name:a.name,url:a.url})).slice(0,10),retentionDays:config.evidenceRetentionDays}:null,punishmentReport:result}});
      caseId=created?.caseId||null;
      if(caseId && actions.includes('warn')) modStorage.addWarning({guildId:message.guild.id,userId:message.author.id,moderatorId:message.client?.user?.id||'Goliath',reason,caseId});
    } catch(error) { console.error('[AutoMod] Case creation failed:',error?.stack||error); }
  }
  recordIncident(message,config);
  await sendAutoModLog(message,'Incident · '+severity.toUpperCase(),reason,actions,{...result,caseId,riskScore:score,rules:violations.map((v)=>v.name)});
  return true;
}

async function handleAutoMod(message) {
  if (!message?.guild || !message?.member || message.author?.bot) return false;
  if (!guildManager.isModuleEnabled(message.guild.id, AUTOMOD_MODULE)) return false;
  const config = getAutoModConfig(message.guild.id);
  if (!config.enabled || isIgnored(message, config)) return false;

  const violations = [];
  if (config.antiSpam.enabled) {
    const now=Date.now(), windowMs=config.antiSpam.intervalSeconds*1000, key=message.guild.id+':'+message.author.id;
    const timestamps=(spamWindows.get(key)||[]).filter((timestamp)=>now-timestamp<=windowMs); timestamps.push(now); spamWindows.set(key,timestamps);
    if(timestamps.length>=config.antiSpam.maxMessages){spamWindows.delete(key);violations.push({key:'antiSpam',name:'Spam Protection',reason:timestamps.length+' messages within '+config.antiSpam.intervalSeconds+' seconds',risk:config.antiSpam.risk,rule:config.antiSpam});}
  }
  violations.push(...collectCoreViolations(message,config),...collectAdvancedViolations(message,config));
  if(!violations.length) return false;
  return enforceIncident(message,config,violations);
}

module.exports = {
  handleAutoMod,
  getAutoModConfig,
  normalizeDomain,
  normalizeDomainList,
  extractDomains,
  evaluateLinkRule,
  findBadWord,
  evaluateCaps,
  countMentions,
  collectCoreViolations,
  collectAdvancedViolations,
  severityFor,
};
