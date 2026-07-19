'use strict';

const reactionRoles = require('./reactionRoles');

const installed = Symbol.for('goliath.roleStudio.reliabilityPatch');

function emojiDescriptor(value) {
  const raw = String(value || '').trim();
  const custom = raw.match(/^<a?:([A-Za-z0-9_]+):(\d{15,25})>$/);
  if (custom) return { raw, id: custom[2], name: custom[1], reactValue: custom[2] };
  if (/^\d{15,25}$/.test(raw)) return { raw, id: raw, name: null, reactValue: raw };
  return { raw, id: null, name: raw, reactValue: raw };
}

function findReaction(message, emoji) {
  return message.reactions.cache.find((reaction) => (
    emoji.id ? reaction.emoji.id === emoji.id : reaction.emoji.id == null && reaction.emoji.name === emoji.name
  )) || null;
}

async function fetchMessage(guild, channelId, messageId) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) throw new Error('The selected channel is inaccessible or does not support messages.');
  const message = await channel.messages.fetch({ message: messageId, force: true }).catch(async () => (
    channel.messages.fetch(messageId).catch(() => null)
  ));
  if (!message) throw new Error('The selected message is no longer accessible.');
  return message;
}

async function botOwnsReaction(reaction, botId) {
  if (!reaction) return false;
  if (reaction.me === true) return true;
  const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
  return Boolean(users?.has(botId));
}

async function ensureAllPanelReactions(guild, panel) {
  if (!panel || panel.enabled === false) return panel;
  const activeMappings = (panel.mappings || []).filter((mapping) => mapping.enabled !== false);
  if (!activeMappings.length) return panel;

  const botId = guild.members.me?.id || guild.client.user?.id;
  if (!botId) throw new Error('Goliath could not resolve its own member identity.');

  let message = await fetchMessage(guild, panel.channelId, panel.messageId);
  const failures = [];

  for (const mapping of activeMappings) {
    const emoji = emojiDescriptor(mapping.emoji);
    if (!emoji.raw) {
      failures.push('An empty emoji mapping was found.');
      continue;
    }

    let reaction = findReaction(message, emoji);
    if (!await botOwnsReaction(reaction, botId)) {
      let added = false;
      let lastError = null;
      for (let attempt = 1; attempt <= 3 && !added; attempt += 1) {
        try {
          await message.react(emoji.reactValue);
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          message = await fetchMessage(guild, panel.channelId, panel.messageId);
          reaction = findReaction(message, emoji);
          added = await botOwnsReaction(reaction, botId);
        } catch (error) {
          lastError = error;
        }
      }
      if (!added) failures.push(`${mapping.emoji}: ${lastError?.message || 'Goliath could not confirm its reaction.'}`);
    }
  }

  if (failures.length) {
    throw new Error(`Not every reaction could be applied. ${failures.join(' | ')}`);
  }

  return reactionRoles.savePanel(guild.id, {
    ...panel,
    status: 'healthy',
    lastHealthAt: new Date().toISOString(),
    lastError: null,
  }, guild);
}

async function clearAllPanelReactions(guild, panel) {
  const botId = guild.members.me?.id || guild.client.user?.id;
  if (!botId) throw new Error('Goliath could not resolve its own member identity.');

  const activeMappings = (panel.mappings || []).filter((mapping) => mapping.enabled !== false);
  let message = await fetchMessage(guild, panel.channelId, panel.messageId);
  const failures = [];

  for (const mapping of activeMappings) {
    const emoji = emojiDescriptor(mapping.emoji);
    let cleared = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3 && !cleared; attempt += 1) {
      try {
        const reaction = findReaction(message, emoji);
        if (!reaction || !await botOwnsReaction(reaction, botId)) {
          cleared = true;
          break;
        }

        await reaction.users.remove(botId);
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        message = await fetchMessage(guild, panel.channelId, panel.messageId);
        const refreshed = findReaction(message, emoji);
        cleared = !await botOwnsReaction(refreshed, botId);
      } catch (error) {
        lastError = error;
      }
    }

    if (!cleared) failures.push(`${mapping.emoji}: ${lastError?.message || 'Goliath could not confirm removal.'}`);
  }

  if (failures.length) {
    throw new Error(`Not every configured reaction could be cleared. ${failures.join(' | ')}`);
  }

  return true;
}

function wrap(name) {
  const original = reactionRoles[name];
  if (typeof original !== 'function') return;
  reactionRoles[name] = async (...args) => {
    const result = await original(...args);
    const guild = args[0]?.guild || args[0];
    const panel = result?.panelId ? result : result?.panel;
    if (guild?.id && panel?.panelId) return ensureAllPanelReactions(guild, panel);
    return result;
  };
}

function wrapDetachPanel() {
  const original = reactionRoles.detachPanel;
  if (typeof original !== 'function') return;

  reactionRoles.detachPanel = async (guild, panelId, options = {}) => {
    if (!options.clearReactions) return original(guild, panelId, options);

    const panel = reactionRoles.getPanel(guild.id, panelId);
    if (!panel) throw new Error('Reaction-role panel not found.');

    await clearAllPanelReactions(guild, panel);
    const result = await original(guild, panelId, { ...options, clearReactions: false });
    return { ...result, reactionsCleared: true };
  };
}

if (!reactionRoles[installed]) {
  Object.defineProperty(reactionRoles, installed, { value: true });
  wrap('attachExistingMessage');
  wrap('createFromTemplate');
  wrap('updatePanelMappings');
  wrap('setPanelEnabled');
  wrap('repairPanel');
  wrapDetachPanel();
}

module.exports = { ensureAllPanelReactions, clearAllPanelReactions };
