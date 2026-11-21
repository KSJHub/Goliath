'use strict';

const {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const { EMOJIS, navigationButton } = require('../../guild/goliathNavigation');
const guildManager = require('../../guild/guildManager');
const lockdown = require('./lockdown');
const quarantine = require('./quarantine');

const ROOT_ID = 'security:protection';
const PANEL_COLOR = 0xED4245;

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(id, label, style = ButtonStyle.Secondary) {
  return navigationButton(id, label, style);
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
    .setTitle(`${EMOJIS.SECURITY} Security Protection`)
    .setDescription('Goliath live protection, containment and incident-response status.')
    .addFields(
      { name: `${EMOJIS.ANTI_NUKE} Anti-Nuke`, value: antiNukeEnabled ? `Enabled ${EMOJIS.SUCCESS}` : `Disabled ${EMOJIS.ERROR}`, inline: true },
      { name: `${EMOJIS.LOCKDOWN} Lockdown`, value: lockdownState.active ? `ACTIVE ${EMOJIS.ISOLATION}` : `Standby ${EMOJIS.SUCCESS}`, inline: true },
      { name: `${EMOJIS.QUARANTINE} Quarantine`, value: `${quarantined} member${quarantined === 1 ? '' : 's'}`, inline: true },
      { name: `${EMOJIS.SECURITY_CORE} Security Core`, value: 'Online', inline: true },
      { name: `${EMOJIS.PERMISSION_GUARD} Permission Guard`, value: 'Online', inline: true },
      { name: `${EMOJIS.INCIDENT_AUDIT} Incident Audit`, value: Array.isArray(config.incidents) ? `${config.incidents.length} recorded` : 'Ready', inline: true },
    )
    .setFooter({ text: `Requested by ${name}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button(`${ROOT_ID}:refresh`, `${EMOJIS.REFRESH} Refresh`, ButtonStyle.Primary),
      ),
    ],
  };
}

async function handleProtectionInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith(`${ROOT_ID}:`)) return false;
  if (!interaction.guild) {
    await interaction.reply({ content: `${EMOJIS.ERROR} Security Protection can only be used inside a server.`, flags: MessageFlags.Ephemeral });
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
