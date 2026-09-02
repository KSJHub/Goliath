'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const guildManager = require('../../guild/guildManager');
const lockdown = require('./lockdown');
const quarantine = require('./quarantine');

const ROOT_ID = 'security:protection';
const PANEL_COLOR = 0xED4245;

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function displayName(interaction) {
  return interaction.member?.displayName
    || interaction.user?.displayName
    || interaction.user?.username
    || 'Unknown User';
}

function buildProtectionPanel(guild, name = 'Unknown User') {
  const config = guildManager.getSecurityConfig(guild.id) || {};
  const lockdownState = lockdown.getLockdownState?.(guild.id) || {};
  const quarantineState = quarantine.getQuarantineState(guild.id) || { users: {} };
  const quarantined = Object.keys(quarantineState.users || {}).length;
  const antiNukeEnabled = config.antiNuke?.enabled !== false;

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🛡️ Security Protection')
    .setDescription('Goliath live protection, containment and incident-response status.')
    .addFields(
      { name: '💥 Anti-Nuke', value: antiNukeEnabled ? 'Enabled ✅' : 'Disabled ❌', inline: true },
      { name: '🔒 Lockdown', value: lockdownState.active ? 'ACTIVE 🚨' : 'Standby ✅', inline: true },
      { name: '🚧 Quarantine', value: `${quarantined} member${quarantined === 1 ? '' : 's'}`, inline: true },
      { name: '🧠 Security Core', value: 'Online', inline: true },
      { name: '🔐 Permission Guard', value: 'Online', inline: true },
      { name: '📋 Incident Audit', value: Array.isArray(config.incidents) ? `${config.incidents.length} recorded` : 'Ready', inline: true },
    )
    .setFooter({ text: `Requested by ${name}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button(`${ROOT_ID}:refresh`, '🔄 Refresh', ButtonStyle.Primary),
      ),
    ],
  };
}

async function handleProtectionInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(`${ROOT_ID}:`)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Security Protection can only be used inside a server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (id === `${ROOT_ID}:refresh`) {
    const payload = buildProtectionPanel(interaction.guild, displayName(interaction));
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
    return true;
  }

  return false;
}

module.exports = {
  ROOT_ID,
  buildProtectionPanel,
  handleProtectionInteraction,
};
