'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const dotenv = require('dotenv');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const security = require('../../core/security/protection/core');

const ROOT = '/home/goliath';
const PREFIX = 'ownerpanel:guildaccess:';
const MODES = {
  dev: '1490422015763681460',
  beta: '1503950013884137654',
  production: '1503957534166356138',
};
const validId = id => /^\d{17,20}$/.test(String(id));

function readEnv(mode) {
  return dotenv.parse(fs.readFileSync(
    path.join(ROOT, mode, `.env.${mode}`)
  ));
}

function parseIds(value) {
  return [...new Set(String(value || '').split(',')
    .map(id => id.trim()).filter(Boolean))];
}

function appendBetaGuild(id) {
  if (!validId(id)) throw new Error('Enter a valid Discord server ID.');
  const filename = path.join(ROOT, 'beta', '.env.beta');
  const original = fs.readFileSync(filename, 'utf8');
  const parsed = dotenv.parse(original);
  const ids = parseIds(parsed.BETA_GUILD_IDS);
  if (ids.some(value => !validId(value))) {
    throw new Error('Existing beta allowlist contains an invalid ID; no changes made.');
  }
  if (ids.includes(id)) return { added: false, ids };
  const matches = [...original.matchAll(
    /^[ \t]*(?:export[ \t]+)?BETA_GUILD_IDS[ \t]*=.*$/gm
  )];
  if (matches.length > 1) {
    throw new Error('Duplicate beta allowlist entries; no changes made.');
  }

  ids.push(id);
  const line = `BETA_GUILD_IDS=${ids.join(',')}`;
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const updated = matches.length
    ? original.slice(0, matches[0].index) + line +
      original.slice(matches[0].index + matches[0][0].length)
    : original + (original.endsWith('\n') ? '' : eol) + line + eol;

  const stat = fs.statSync(filename);
  const backupDir = path.join(ROOT, 'backups', 'beta-guild-allowlist');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const suffix = `${Date.now()}-${randomBytes(6).toString('hex')}`;
  const backup = path.join(backupDir, `${suffix}.env`);
  fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);

  const temporary = `${filename}.${suffix}.tmp`;
  try {
    fs.writeFileSync(temporary, updated, {
      flag: 'wx', mode: stat.mode & 0o777,
    });
    fs.chownSync(temporary, stat.uid, stat.gid);
    if (fs.readFileSync(filename, 'utf8') !== original) {
      throw new Error('Environment file changed during save; retry.');
    }
    fs.renameSync(temporary, filename);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { added: true, ids };
}

function buildRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}list`)
      .setLabel('Connected Guilds').setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}add`)
      .setLabel('Approve BETA Guild').setEmoji('➕')
      .setStyle(ButtonStyle.Primary)
  );
}

async function scanMode(mode) {
  const env = readEnv(mode);
  const token = String(env[`DISCORD_BOT_TOKEN_${mode.toUpperCase()}`] || '').trim();
  if (!token) throw new Error('Mode file has no bot token.');

  async function get(route) {
    const response = await fetch(`https://discord.com/api/v10${route}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
    return response.json();
  }

  const bot = await get('/users/@me');
  if (bot.id !== MODES[mode]) throw new Error('Bot identity mismatch.');
  const guilds = [];
  let after = '';
  while (true) {
    const page = await get(`/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`);
    guilds.push(...page);
    if (page.length < 200) break;
    after = page[page.length - 1].id;
  }

  const approved = mode === 'beta' ? parseIds(env.BETA_GUILD_IDS) : [];
  const connected = new Set(guilds.map(guild => guild.id));
  const lines = [
    `=== ${mode.toUpperCase()} ===`,
    `Bot: ${bot.username} (${bot.id})`,
    `Discord membership: ${guilds.length} guild(s)`,
    ...guilds.sort((a, b) => a.name.localeCompare(b.name)).map(guild =>
      `${guild.name.replace(/[\r\n]/g, ' ')} | ${guild.id}` +
      (mode === 'beta'
        ? ` | ${approved.includes(guild.id) ? 'APPROVED IN FILE' : 'NOT APPROVED IN FILE'}`
        : '')
    ),
  ];
  if (mode === 'beta') {
    lines.push('', 'Approved in .env.beta but not connected:',
      ...approved.filter(id => !connected.has(id)));
  }
  return { mode, bot, guilds, approved, count: guilds.length, text: lines.join('\n') };
}

async function handle(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(PREFIX)) return false;

  if (String(process.env.BOT_MODE || '').trim().toUpperCase() !== 'DEV' ||
      !interaction?.user?.id ||
      !security.isBotOwner(interaction.user.id)) {
    await interaction.reply({
      content: '❌ These controls require a configured owner on DEV.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === `${PREFIX}add`) {
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${PREFIX}save`)
        .setTitle('Approve BETA Guild')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('guild_id')
            .setLabel('Discord server ID')
            .setStyle(TextInputStyle.Short)
            .setMinLength(17).setMaxLength(20).setRequired(true)
        ))
    );
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (id === `${PREFIX}save`) {
      const guildId = interaction.fields.getTextInputValue('guild_id').trim();
      const result = appendBetaGuild(guildId);
      console.log(`[Owner Guild Access] owner=${interaction.user.id} beta=${guildId} added=${result.added}`);
      await interaction.editReply({
        content: `${result.added ? '✅ Saved' : 'ℹ️ Already approved'}: **${guildId}**.\n` +
          'Restart BETA to load the saved list, then invite the beta bot. Approval does not invite it automatically.',
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ownerpanel:restart:ask:beta')
            .setLabel('Restart BETA').setEmoji('🔄')
            .setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: { parse: [] },
      });
    } else if (id === `${PREFIX}list`) {
      const modes = Object.keys(MODES);
      const results = await Promise.allSettled(modes.map(scanMode));
      const report = results.map((result, index) =>
        result.status === 'fulfilled'
          ? result.value.text
          : `=== ${modes[index].toUpperCase()} ===\nSCAN FAILED: ${result.reason.message}`
      ).join('\n\n');
      const summary = results.map((result, index) =>
        `${modes[index].toUpperCase()}: ${result.status === 'fulfilled'
          ? result.value.count + ' guild(s)' : 'scan failed'}`
      ).join(' • ');
      await interaction.editReply({
        content: null,
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🌐 Goliath Connected Guilds')
          .setDescription(
            '**' + summary + '**\n\n' +
            '✅ Approved in the BETA file • ⛔ Not approved\n' +
            '🕓 Approved but not connected'
          )
          .addFields(...results.map((result, index) => {
            const mode = modes[index];
            const icon = { dev: '🧪', beta: '🔬', production: '🚀' }[mode];
            if (result.status !== 'fulfilled') {
              return {
                name: `${icon} ${mode.toUpperCase()} — Scan unavailable`,
                value: 'Could not retrieve this bot’s guild membership. See the attached report.',
                inline: false,
              };
            }

            const data = result.value;
            const clean = value => String(value)
              .replace(/[\r\n]/g, ' ')
              .replace(/([\\`*_~|>])/g, '\\$1')
              .slice(0, 120);
            const entries = data.guilds.map(guild => {
              const marker = mode === 'beta'
                ? (data.approved.includes(guild.id) ? '✅' : '⛔')
                : '🏠';
              return `${marker} **${clean(guild.name)}**\n\`${guild.id}\``;
            });

            if (mode === 'beta') {
              const connected = new Set(data.guilds.map(guild => guild.id));
              for (const guildId of data.approved.filter(id => !connected.has(id))) {
                entries.push(`🕓 Approved, awaiting connection\n\`${clean(guildId)}\``);
              }
            }

            let value = '';
            let shown = 0;
            for (const entry of entries) {
              if ((value + '\n\n' + entry).length > 850) break;
              value += (value ? '\n\n' : '') + entry;
              shown++;
            }
            if (!entries.length) value = '*No guilds connected.*';
            if (shown < entries.length) {
              value += `\n\n*${entries.length - shown} more entries in the attached report.*`;
            }
            return {
              name: `${icon} ${mode.toUpperCase()} — ${data.count} connected`,
              value,
              inline: false,
            };
          }))
          .setFooter({
            text: 'Discord membership • BETA approval reflects the saved file; restart BETA after changes.',
          })
          .setTimestamp()
        ],
        files: [{
          attachment: Buffer.from(report, 'utf8'),
          name: 'goliath-connected-guilds.txt',
        }],
        components: [buildRow()],
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.editReply('❌ Unknown Guild Access action.');
    }
  } catch (error) {
    console.error('[Owner Guild Access]', error.message);
    await interaction.editReply({
      content: `❌ ${error.message}`,
      allowedMentions: { parse: [] },
    });
  }
  return true;
}

module.exports = { buildRow, handle, parseIds, validId };
