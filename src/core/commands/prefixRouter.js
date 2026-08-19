'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const guildManager = require('../guild/guildManager');

const {
  getGuildPrefix,
  getMentionPrefixes,
  getPrefixInfo,
  setGuildPrefix,
  resetGuildPrefix,
  normalizePrefix,
} = require('./prefixStore');

const BUILT_IN_COMMANDS = new Set([
  'prefix',
  'setprefix',
  'help',
  'commands',
  'ping',
]);

function canManagePrefix(message) {
  return Boolean(
    message.member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
      message.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
  );
}

function getGuildSettings(message) {
  try {
    return guildManager.getGuildSection(
      message.guild.id,
      'generalSettings',
      guildManager.DEFAULT_GENERAL_SETTINGS
    );
  } catch {
    return {};
  }
}

function parsePrefixMessage(message, client) {
  const content = String(message.content || '');
  const guildPrefix = getGuildPrefix(message.guild.id);
  const mentionPrefix = getMentionPrefixes(client).find((prefix) => content.startsWith(prefix));

  let usedPrefix = null;
  let body = '';

  if (mentionPrefix) {
    usedPrefix = mentionPrefix;
    body = content.slice(mentionPrefix.length).trim();
  } else if (content.startsWith(guildPrefix)) {
    usedPrefix = guildPrefix;
    body = content.slice(guildPrefix.length).trim();
  }

  if (!usedPrefix) return null;

  const parts = body.split(/\s+/).filter(Boolean);
  const commandName = String(parts.shift() || '').toLowerCase().slice(0, 80);

  return {
    usedPrefix,
    guildPrefix,
    commandName,
    args: parts.slice(0, 50),
    rawArgs: parts.join(' ').slice(0, 1800),
    mentionTriggered: Boolean(mentionPrefix),
  };
}

function buildPrefixEmbed(message) {
  const info = getPrefixInfo(message.guild.id);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Goliath Prefix')
    .setDescription([
      `Current prefix: \`${info.prefix}\``,
      `Default prefix: \`${info.defaultPrefix}\``,
      '',
      '**Examples**',
      `\`${info.prefix}help\``,
      `\`${info.prefix}ping\``,
      `\`${info.prefix}prefix set ?\``,
      '',
      'You can also mention Goliath instead of using the prefix.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${message.member?.displayName || message.author.username}` })
    .setTimestamp(new Date());
}

function buildHelpEmbed(message) {
  const info = getPrefixInfo(message.guild.id);
  const commandNames = [...(message.client.commands?.keys?.() || [])].sort();

  return new EmbedBuilder()
    .setColor(0x2f80ed)
    .setTitle('📚 Goliath Prefix Commands')
    .setDescription([
      `Prefix: \`${info.prefix}\``,
      '',
      '**Available prefix shortcuts**',
      `\`${info.prefix}help\` — Show this panel`,
      `\`${info.prefix}ping\` — Check bot latency`,
      `\`${info.prefix}prefix\` — View prefix`,
      `\`${info.prefix}prefix set <new>\` — Change prefix`,
      `\`${info.prefix}prefix reset\` — Reset prefix`,
      '',
      '**Slash commands remain fully supported**',
      commandNames.length
        ? commandNames.map((name) => `\`/${name}\``).join(' ').slice(0, 3500)
        : '`/help`',
    ].join('\n'))
    .setFooter({ text: 'Goliath supports slash commands and server prefixes.' })
    .setTimestamp(new Date());
}

async function reply(message, payload) {
  return message.reply({
    allowedMentions: { repliedUser: false, users: [], roles: [] },
    ...payload,
  }).catch((error) => {
    console.error('[PrefixRouter] Failed to reply:', error?.message || error);
    return null;
  });
}

function shouldReplyUnknownCommand(parsed, client) {
  if (!parsed?.commandName) return false;
  if (BUILT_IN_COMMANDS.has(parsed.commandName)) return true;
  if (client.commands?.has?.(parsed.commandName)) return true;
  return parsed.mentionTriggered;
}

async function handlePrefixCommand(message, client) {
  if (!message?.guild || !message.content || message.author?.bot) return false;

  const parsed = parsePrefixMessage(message, client);
  if (!parsed) return false;

  if (!parsed.commandName) {
    await reply(message, {
      embeds: [buildPrefixEmbed(message)],
    });
    return true;
  }

  if (parsed.commandName === 'setprefix') {
    if (!canManagePrefix(message)) {
      await reply(message, { content: '❌ You need **Manage Server** or **Administrator** to change the prefix.' });
      return true;
    }

    const nextPrefix = parsed.args[0];
    if (!nextPrefix) {
      await reply(message, { content: `⚠️ Usage: \`${parsed.guildPrefix}setprefix ?\`` });
      return true;
    }

    try {
      const saved = setGuildPrefix(message.guild.id, nextPrefix, message.guild);
      await reply(message, { content: `✅ Prefix updated to \`${saved}\`.` });
    } catch (error) {
      await reply(message, { content: `❌ ${error.message}` });
    }

    return true;
  }

  if (parsed.commandName === 'prefix') {
    const subcommand = String(parsed.args[0] || '').toLowerCase();

    if (!subcommand || ['view', 'show', 'current'].includes(subcommand)) {
      await reply(message, { embeds: [buildPrefixEmbed(message)] });
      return true;
    }

    if (subcommand === 'set') {
      if (!canManagePrefix(message)) {
        await reply(message, { content: '❌ You need **Manage Server** or **Administrator** to change the prefix.' });
        return true;
      }

      const nextPrefix = parsed.args[1];

      if (!nextPrefix) {
        await reply(message, { content: `⚠️ Usage: \`${parsed.guildPrefix}prefix set ?\`` });
        return true;
      }

      try {
        const saved = setGuildPrefix(message.guild.id, nextPrefix, message.guild);
        await reply(message, { content: `✅ Prefix updated to \`${saved}\`.` });
      } catch (error) {
        await reply(message, { content: `❌ ${error.message}` });
      }

      return true;
    }

    if (subcommand === 'reset') {
      if (!canManagePrefix(message)) {
        await reply(message, { content: '❌ You need **Manage Server** or **Administrator** to reset the prefix.' });
        return true;
      }

      const saved = resetGuildPrefix(message.guild.id, message.guild);
      await reply(message, { content: `✅ Prefix reset to \`${saved}\`.` });
      return true;
    }

    await reply(message, {
      content: `⚠️ Unknown prefix action. Try \`${parsed.guildPrefix}prefix\`, \`${parsed.guildPrefix}prefix set ?\`, or \`${parsed.guildPrefix}prefix reset\`.`,
    });
    return true;
  }

  if (['help', 'commands'].includes(parsed.commandName)) {
    await reply(message, { embeds: [buildHelpEmbed(message)] });
    return true;
  }

  if (parsed.commandName === 'ping') {
    const apiLatency = Math.round(client.ws.ping);
    await reply(message, { content: `🏓 Pong! Discord API: \`${apiLatency}ms\`` });
    return true;
  }

  const command = client.commands?.get?.(parsed.commandName);

  if (command?.messageExecute) {
    try {
      await command.messageExecute(message, parsed.args, {
        prefix: parsed.guildPrefix,
        usedPrefix: parsed.usedPrefix,
        rawArgs: parsed.rawArgs,
      });
    } catch (error) {
      console.error(`[PrefixRouter] Command failed: ${parsed.commandName}`, error);
      await reply(message, { content: '❌ That prefix command failed. Please try again or use the slash command version.' });
    }
    return true;
  }

  const settings = getGuildSettings(message);
  if (settings.commandNotFoundEnabled !== false && shouldReplyUnknownCommand(parsed, client)) {
    await reply(message, {
      content: `⚠️ Unknown prefix command. Try \`${parsed.guildPrefix}help\` or use slash commands with \`/help\`.`,
    });
    return true;
  }

  return true;
}

module.exports = {
  handlePrefixCommand,
  parsePrefixMessage,
  buildPrefixEmbed,
  normalizePrefix,
};
