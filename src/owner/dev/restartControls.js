'use strict';

const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const security = require('../../core/security/protection/core');

const PREFIX = 'ownerpanel:restart:';
const TARGETS = Object.freeze({
  dev: 'goliath-dev',
  beta: 'goliath-beta',
  production: 'goliath-production',
});
const pending = new Map();
const cooldowns = new Map();

function buildRow() {
  return new ActionRowBuilder().addComponents(
    ...Object.keys(TARGETS).map(target =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}ask:${target}`)
        .setLabel(`Restart ${target.toUpperCase()}`)
        .setEmoji('🔄')
        .setStyle(target === 'production'
          ? ButtonStyle.Danger : ButtonStyle.Secondary)
    )
  );
}

async function handle(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(PREFIX)) return false;

  if (String(process.env.BOT_MODE || '').trim().toUpperCase() !== 'DEV' ||
      !interaction?.user?.id ||
      !security.isBotOwner(interaction.user.id)) {
    await interaction.reply({
      content: '❌ Restart controls require a configured owner on DEV.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const now = Date.now();
  for (const [key, entry] of pending) {
    if (entry.expires <= now) pending.delete(key);
  }
  for (const [target, expiry] of cooldowns) {
    if (expiry <= now) cooldowns.delete(target);
  }

  const parts = id.slice(PREFIX.length).split(':');
  const [action, value] = parts;

  if (action === 'ask' && parts.length === 2 &&
      Object.hasOwn(TARGETS, value)) {
    const nonce = randomBytes(12).toString('hex');
    pending.set(nonce, {
      target: value,
      owner: interaction.user.id,
      expires: now + 60000,
    });

    await interaction.reply({
      content: `Restart **${value.toUpperCase()}**?\n` +
        'Its bot and dashboard will briefly disconnect. Confirmation expires in 60 seconds.',
      flags: MessageFlags.Ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}confirm:${nonce}`)
          .setLabel(`Confirm Restart ${value.toUpperCase()}`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}cancel:${nonce}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )],
    });
    return true;
  }

  const entry = pending.get(value);
  if (parts.length !== 2 ||
      !['confirm', 'cancel'].includes(action) ||
      !entry || entry.owner !== interaction.user.id ||
      entry.expires <= now) {
    await interaction.reply({
      content: '❌ Invalid or expired confirmation. Open a new restart confirmation.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  pending.delete(value);

  if (action === 'cancel') {
    await interaction.update({
      content: 'Restart cancelled.', components: [],
    });
    return true;
  }

  if (cooldowns.has(entry.target)) {
    await interaction.update({
      content: 'A restart was recently requested for this environment. Wait 60 seconds before retrying.',
      components: [],
    });
    return true;
  }

  cooldowns.set(entry.target, now + 60000);
  await interaction.update({
    content: `⏳ Submitting **${entry.target.toUpperCase()}** restart to PM2…`,
    components: [],
  });

  try {
    // Detached CLI submits the restart to the existing PM2 daemon.
    // Use fixed process names and argument arrays; no shell execution.
    const child = spawn('pm2', [
      'restart', TARGETS[entry.target],
    ], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      env: process.env,
    });

    child.once('error', error => {
      cooldowns.delete(entry.target);
      console.error('[Owner Restart] Launch failed:', error.message);
      interaction.editReply({
        content: `❌ Could not launch ${entry.target.toUpperCase()} restart. Check VPS logs.`,
        components: [],
      }).catch(() => null);
    });

    child.once('spawn', () => {
      console.log(
        `[Owner Restart] owner=${interaction.user.id} target=${entry.target} submitted`
      );
      interaction.editReply({
        content: `🔄 **${entry.target.toUpperCase()}** restart submitted. ` +
          'Check its online status before requesting another restart.',
        components: [],
      }).catch(() => null);
    });

    child.once('exit', code => {
      if (code !== 0) {
        console.error(
          `[Owner Restart] target=${entry.target} PM2 exit=${code}`
        );
        interaction.editReply({
          content: `❌ PM2 did not confirm a successful ${entry.target.toUpperCase()} restart. Check VPS logs.`,
          components: [],
        }).catch(() => null);
      }
    });
    child.unref();
  } catch (error) {
    cooldowns.delete(entry.target);
    console.error('[Owner Restart] Failed:', error.message);
    await interaction.editReply({
      content: '❌ Restart submission failed. Check VPS logs.',
      components: [],
    });
  }
  return true;
}

module.exports = { buildRow, handle };
