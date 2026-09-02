'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../../guild/guildManager');
const { applyPunishmentEngine, normalizePunishments } = require('./engine');

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
  const config = readAutomodSection(guildId);
  const antiSpam = config.antiSpam || {};
  const antiLinks = config.antiLinks || {};
  const badWords = config.badWords || {};
  const caps = config.caps || {};
  const mentions = config.mentions || {};

  return {
    enabled: guildManager.isModuleEnabled(guildId, AUTOMOD_MODULE),
    dmUser: config.dmUser !== false,
    dmMessages: {
      antiSpam: String(config.dmMessages?.antiSpam || DEFAULT_DM_MESSAGES.antiSpam),
      antiLinks: String(config.dmMessages?.antiLinks || DEFAULT_DM_MESSAGES.antiLinks),
      badWords: String(config.dmMessages?.badWords || DEFAULT_DM_MESSAGES.badWords),
      caps: String(config.dmMessages?.caps || DEFAULT_DM_MESSAGES.caps),
      mentions: String(config.dmMessages?.mentions || DEFAULT_DM_MESSAGES.mentions),
    },
    ignoredRoles: normalizeIdList(config.ignoredRoles),
    ignoredChannels: normalizeIdList(config.ignoredChannels),
    antiSpam: {
      enabled: antiSpam.enabled === true,
      maxMessages: Math.min(100, Math.max(2, Number.parseInt(antiSpam.maxMessages, 10) || 5)),
      intervalSeconds: Math.min(3600, Math.max(1, Number.parseInt(antiSpam.intervalSeconds, 10) || 10)),
      actions: normalizePunishments(antiSpam.actions || antiSpam.action || ['delete']),
    },
    antiLinks: {
      enabled: antiLinks.enabled === true,
      allowStaff: antiLinks.allowStaff !== false,
      allowedDomains: normalizeDomainList(antiLinks.allowedDomains),
      deniedDomains: normalizeDomainList(antiLinks.deniedDomains),
      actions: normalizePunishments(antiLinks.actions || antiLinks.action || ['delete']),
    },
    badWords: {
      enabled: badWords.enabled === true,
      words: normalizeStringList(badWords.words),
      actions: normalizePunishments(badWords.actions || badWords.action || ['delete']),
    },
    caps: {
      enabled: caps.enabled === true,
      percent: Math.min(100, Math.max(1, Number.parseInt(caps.percent, 10) || 70)),
      minLength: Math.min(500, Math.max(1, Number.parseInt(caps.minLength, 10) || 12)),
      actions: normalizePunishments(caps.actions || caps.action || ['warn']),
    },
    mentions: {
      enabled: mentions.enabled === true,
      maxMentions: Math.min(100, Math.max(1, Number.parseInt(mentions.maxMentions, 10) || 5)),
      actions: normalizePunishments(mentions.actions || mentions.action || ['warn']),
    },
  };
}

function isIgnored(message, config) {
  if (config.ignoredChannels.includes(String(message.channelId))) return true;
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
  return String(template || '')
    .replaceAll('{server}', message.guild.name)
    .replaceAll('{reason}', reason)
    .replaceAll('{user}', message.author.username)
    .replaceAll('{userMention}', `<@${message.author.id}>`)
    .replaceAll('{channel}', message.channel?.name || 'unknown-channel');
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

function findBadWord(content, words) {
  const lower = String(content || '').toLowerCase();
  return words.find((word) => lower.includes(word)) || null;
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
  const blocked = findBadWord(message.content, config.badWords.words);
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

async function handleAutoMod(message) {
  if (!message?.guild || !message?.member || message.author?.bot) return false;
  if (!guildManager.isModuleEnabled(message.guild.id, AUTOMOD_MODULE)) return false;
  const config = getAutoModConfig(message.guild.id);
  if (!config.enabled || isIgnored(message, config)) return false;

  if (await handleSpam(message, config)) return true;
  if (await handleLinks(message, config)) return true;
  if (await handleBadWords(message, config)) return true;
  if (await handleCaps(message, config)) return true;
  if (await handleMentions(message, config)) return true;
  return false;
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
};
