'use strict';

const { Events, PermissionFlagsBits } = require('discord.js');
const { handleStickyMessage } = require('../../modules/messageStudio/sticky/stickyManager');
const { handlePrefixCommand } = require('../../core/commands/prefixRouter');
const translationThreadManager = require('../../modules/utilityStudio/translation/translationThreadManager');
const statsManager = require('../../modules/utilityStudio/stats/statsManager');
const levelingTracking = require('../../modules/communityStudio/leveling/levelingTracking');
const guildManager = require('../../core/guild/guildManager');
const {
  applyPunishmentEngine,
  normalizePunishments,
} = require('../../core/automod/punishmentEngine');

const AUTOMOD_MODULE = 'automod';
const spamWindows = new Map();

const DEFAULT_DM_MESSAGES = {
  antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
  antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
};

async function runHandler(label, handler, ...args) {
  try {
    return await handler(...args);
  } catch (error) {
    console.error(
      `[MessageCreate] ${label} handler failed:`,
      error?.stack || error?.message || error
    );
    return null;
  }
}

function readAutomodSection(guildId) {
  try {
    const guildData = guildManager.getGuildData(guildId, { forceReload: true });
    return guildData?.modules?.automod || {};
  } catch (error) {
    console.error(
      `[AutoMod] Failed to read guild config for ${guildId}:`,
      error?.stack || error?.message || error
    );
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
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map(normalizeDomain)
      .filter(Boolean)
  )];
}

function normalizeIdList(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function getAutoModConfig(guildId) {
  const config = readAutomodSection(guildId);
  const antiSpam = config.antiSpam || {};
  const antiLinks = config.antiLinks || {};

  return {
    enabled: guildManager.isModuleEnabled(guildId, AUTOMOD_MODULE),
    dmUser: config.dmUser !== false,
    dmMessages: {
      antiSpam: String(config.dmMessages?.antiSpam || DEFAULT_DM_MESSAGES.antiSpam),
      antiLinks: String(config.dmMessages?.antiLinks || DEFAULT_DM_MESSAGES.antiLinks),
    },
    ignoredRoles: normalizeIdList(config.ignoredRoles),
    ignoredChannels: normalizeIdList(config.ignoredChannels),
    antiSpam: {
      enabled: antiSpam.enabled === true,
      maxMessages: Math.min(
        100,
        Math.max(2, Number.parseInt(antiSpam.maxMessages, 10) || 5)
      ),
      intervalSeconds: Math.min(
        3600,
        Math.max(1, Number.parseInt(antiSpam.intervalSeconds, 10) || 10)
      ),
      actions: normalizePunishments(
        antiSpam.actions || antiSpam.action || ['delete']
      ),
    },
    antiLinks: {
      enabled: antiLinks.enabled === true,
      allowStaff: antiLinks.allowStaff !== false,
      allowedDomains: normalizeDomainList(antiLinks.allowedDomains),
      deniedDomains: normalizeDomainList(antiLinks.deniedDomains),
      actions: normalizePunishments(
        antiLinks.actions || antiLinks.action || ['delete']
      ),
    },
  };
}

function isIgnored(message, config) {
  if (config.ignoredChannels.includes(String(message.channelId))) return true;

  const roleIds = message.member?.roles?.cache
    ? [...message.member.roles.cache.keys()].map(String)
    : [];

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
    } catch {
      // Ignore malformed URLs and continue checking the remaining matches.
    }
  }

  return [...new Set(domains)];
}

function domainMatches(domain, configured) {
  return domain === configured || domain.endsWith(`.${configured}`);
}

function evaluateLinkRule(domains, rule) {
  if (!domains.length) return null;

  const denied = domains.find((domain) =>
    rule.deniedDomains.some((entry) => domainMatches(domain, entry))
  );

  if (denied) {
    return {
      blocked: denied,
      reason: `Denied domain detected: ${denied}`,
    };
  }

  if (rule.allowedDomains.length) {
    const unapproved = domains.find((domain) =>
      !rule.allowedDomains.some((entry) => domainMatches(domain, entry))
    );

    if (unapproved) {
      return {
        blocked: unapproved,
        reason: `Domain is not on the allowed list: ${unapproved}`,
      };
    }

    return null;
  }

  if (!rule.deniedDomains.length) {
    return {
      blocked: domains[0],
      reason: `Links are not permitted: ${domains[0]}`,
    };
  }

  return null;
}

async function applyRule(message, config, ruleKey, ruleName, reason, actions) {
  let result = null;
  const dmMessage = renderDmMessage(config.dmMessages[ruleKey], message, reason);

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
        dmMessage,
      }
    );
  } catch (error) {
    console.error(
      `[AutoMod] ${ruleName} punishment engine failed:`,
      error?.stack || error?.message || error
    );
  }

  if (actions.includes('warn') && !result?.applied?.includes('warn')) {
    const warning = await message.channel.send({
      content: `⚠️ ${message.author}, your message was blocked by **${ruleName}**: ${reason}`,
    }).catch(() => null);

    if (warning) {
      setTimeout(() => warning.delete().catch(() => null), 10000);
    }
  }

  if (actions.includes('dm') && config.dmUser && !result?.applied?.includes('dm')) {
    await message.author.send({ content: dmMessage }).catch(() => null);
  }

  if (actions.includes('delete') && !result?.applied?.includes('delete') && message.deletable) {
    await message.delete().catch(() => null);
  }

  return true;
}

async function handleSpam(message, config) {
  if (!config.antiSpam.enabled) return false;

  const now = Date.now();
  const windowMs = config.antiSpam.intervalSeconds * 1000;
  const key = `${message.guild.id}:${message.author.id}`;
  const timestamps = (spamWindows.get(key) || [])
    .filter((timestamp) => now - timestamp <= windowMs);

  timestamps.push(now);
  spamWindows.set(key, timestamps);

  if (timestamps.length < config.antiSpam.maxMessages) return false;

  spamWindows.delete(key);
  const reason = `${timestamps.length} messages sent within ${config.antiSpam.intervalSeconds} seconds`;

  return applyRule(
    message,
    config,
    'antiSpam',
    'Spam Protection',
    reason,
    config.antiSpam.actions
  );
}

async function handleLinks(message, config) {
  if (!config.antiLinks.enabled) return false;
  if (config.antiLinks.allowStaff && isStaff(message)) return false;

  const domains = extractDomains(message.content);
  const violation = evaluateLinkRule(domains, config.antiLinks);
  if (!violation) return false;

  return applyRule(
    message,
    config,
    'antiLinks',
    'Link Protection',
    violation.reason,
    config.antiLinks.actions
  );
}

async function handleAutoMod(message) {
  if (!guildManager.isModuleEnabled(message.guild.id, AUTOMOD_MODULE)) {
    return false;
  }

  const config = getAutoModConfig(message.guild.id);
  if (!config.enabled || isIgnored(message, config)) return false;

  if (await handleLinks(message, config)) return true;
  if (await handleSpam(message, config)) return true;
  return false;
}

module.exports = {
  name: Events.MessageCreate,

  async execute(message, client) {
    if (!message.guild || !message.member || message.author?.bot) return;

    const autoModHandled = await runHandler('AutoMod', handleAutoMod, message);
    if (autoModHandled) return;

    await runHandler('Stats', statsManager.handleMessageCreate, message);
    await runHandler('Leveling', levelingTracking.handleMessageCreate, message);

    if (message.content) {
      const handledPrefixCommand = await runHandler(
        'Prefix Command',
        handlePrefixCommand,
        message,
        client
      );
      if (handledPrefixCommand) return;

      if (guildManager.isModuleEnabled(message.guild.id, 'translation')) {
        await runHandler(
          'Translation',
          translationThreadManager.handleMessageCreate,
          message,
          client
        );
      }
    }

    await runHandler('Sticky', handleStickyMessage, message, client);
  },
};