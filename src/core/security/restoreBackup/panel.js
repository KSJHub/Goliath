'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const {
  createServerBackup,
  listServerBackups,
  readServerBackup,
  validateServerBackup,
} = require('./backup');
const restoreRequestManager = require('./requests');

const PANEL_COLOR = 0x5865F2;
const ROOT_ID = 'security:restoreBackup';

const normalizeBackupId = (backup) => typeof backup === 'string' ? backup : backup?.backupId;
const displayName = (interaction) => interaction.member?.displayName
  || interaction.user?.displayName
  || interaction.user?.username
  || 'Unknown User';

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function getBackupSummary(guildId) {
  const backups = listServerBackups(guildId);
  return {
    backups,
    count: backups.length,
    latestId: normalizeBackupId(backups[0]) || null,
  };
}

function buildRestoreBackupPanel(guild, name = 'Unknown User') {
  const summary = getBackupSummary(guild.id);
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🛡️ Restore & Backup')
    .setDescription('Create, inspect and recover Goliath server backups from the Security system.')
    .addFields(
      { name: '📦 Backups', value: String(summary.count), inline: true },
      { name: '🕘 Latest', value: summary.latestId ? `\`${summary.latestId}\`` : 'None', inline: true },
      { name: '🔐 Restore Safety', value: 'Central approval required', inline: true },
    )
    .setFooter({ text: `Requested by ${name}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button(`${ROOT_ID}:create`, '⚡ Create Backup', ButtonStyle.Success),
        button(`${ROOT_ID}:list`, '📦 View Backups', ButtonStyle.Primary),
        button(`${ROOT_ID}:preview`, '🔍 Preview Latest'),
      ),
      row(
        button(`${ROOT_ID}:download`, '💾 Download Latest'),
        button(`${ROOT_ID}:requestRestore`, '🚨 Request Restore', ButtonStyle.Danger),
      ),
    ],
  };
}

async function refreshPanel(interaction) {
  const payload = buildRestoreBackupPanel(interaction.guild, displayName(interaction));
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleRestoreBackupInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(`${ROOT_ID}:`)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Restore & Backup can only be used inside a server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (id === `${ROOT_ID}:create`) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    await createServerBackup(interaction.guild, {
      createdBy: interaction.user.id,
      reason: 'Manual backup from Security Restore & Backup panel',
    });
    await refreshPanel(interaction);
    return true;
  }

  if (id === `${ROOT_ID}:list`) {
    const backups = listServerBackups(interaction.guild.id).map(normalizeBackupId).filter(Boolean);
    await interaction.reply({
      content: backups.length
        ? `📦 **Backups:**\n${backups.slice(0, 10).map((value) => `\`${value}\``).join('\n')}`
        : '📦 No backups found.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === `${ROOT_ID}:preview`) {
    const latest = normalizeBackupId(listServerBackups(interaction.guild.id)[0]);
    const backup = latest ? readServerBackup(interaction.guild.id, latest) : null;
    const validation = backup ? validateServerBackup(backup, { guildId: interaction.guild.id }) : null;
    await interaction.reply({
      content: backup
        ? `🔍 **Latest Backup**\nID: \`${latest}\`\nValid: ${validation?.valid ? 'YES ✅' : 'NO ❌'}`
        : '🔍 No backups found.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === `${ROOT_ID}:download`) {
    const latest = normalizeBackupId(listServerBackups(interaction.guild.id)[0]);
    const backup = latest ? readServerBackup(interaction.guild.id, latest) : null;
    if (!backup) {
      await interaction.reply({ content: '❌ No backups found.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      content: `💾 Backup: ${latest}`,
      files: [{ attachment: Buffer.from(JSON.stringify(backup, null, 2)), name: `${latest}.json` }],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === `${ROOT_ID}:requestRestore`) {
    await restoreRequestManager.createRestoreRequest(interaction, { cooldownMs: 30 * 60 * 1000 });
    return true;
  }

  if (id === `${ROOT_ID}:restore` || id === `${ROOT_ID}:restore:real`) {
    await interaction.reply({
      content: '❌ Direct restores are disabled. Use the centralized restore approval system.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

module.exports = {
  ROOT_ID,
  buildRestoreBackupPanel,
  handleRestoreBackupInteraction,
  getBackupSummary,
};
