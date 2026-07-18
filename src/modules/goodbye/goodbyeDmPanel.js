'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const departureDm = require('./goodbyeDepartureDm');

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
  .setCustomId(customId)
  .setLabel(label)
  .setStyle(style);

function state(value) {
  return value ? 'On ✅' : 'Off ❌';
}

function buildGoodbyeDmPanel(guild, memberDisplayName = 'Unknown User') {
  const dm = departureDm.getConfig(guild.id);
  const analytics = dm.analytics || {};
  const embed = new EmbedBuilder()
    .setColor(dm.enabled ? 0x5865F2 : 0x747F8D)
    .setTitle('💌 Goodbye · Departure DM')
    .setDescription([
      'Configure the private message sent to a member after Goliath identifies how their membership ended.',
      '',
      `**Status:** ${state(dm.enabled)}`,
      '',
      '**📋 Event Delivery**',
      `Voluntary Leave: ${state(dm.sendOnLeave)}`,
      `Kick: ${state(dm.sendOnKick)}`,
      `Ban: ${state(dm.sendOnBan)}`,
      `Prune: ${state(dm.sendOnPrune)}`,
      '',
      '**📅 Included Information**',
      `Join Date: ${state(dm.includeJoinDate)}`,
      `Membership Duration: ${state(dm.includeMembershipDuration)}`,
      `Reason: ${state(dm.includeReason)}`,
      `Moderator: ${state(dm.includeModerator)}`,
      `Appeal Link: ${state(dm.includeAppealLink)}`,
      `Reference ID: ${state(dm.includeReferenceId)}`,
      '',
      `Sent: \`${analytics.sent || 0}\` | Failed: \`${analytics.failed || 0}\` | Skipped: \`${analytics.skipped || 0}\``,
      '',
      'DM delivery is best-effort. A failed DM never blocks the staff departure log.',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(button(dm.enabled ? 'admin:goodbye:dm:disable' : 'admin:goodbye:dm:enable', dm.enabled ? 'Disable Departure DM' : 'Enable Departure DM', dm.enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(
        button('admin:goodbye:dm:leave', `Leave ${dm.sendOnLeave ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:kick', `Kick ${dm.sendOnKick ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:ban', `Ban ${dm.sendOnBan ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:prune', `Prune ${dm.sendOnPrune ? 'On' : 'Off'}`),
      ),
      row(
        button('admin:goodbye:dm:joined', `Join Date ${dm.includeJoinDate ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:duration', `Duration ${dm.includeMembershipDuration ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:reason', `Reason ${dm.includeReason ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:moderator', `Moderator ${dm.includeModerator ? 'On' : 'Off'}`),
      ),
      row(
        button('admin:goodbye:dm:appeal', `Appeal ${dm.includeAppealLink ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:reference', `Reference ${dm.includeReferenceId ? 'On' : 'Off'}`),
        button('admin:goodbye:dm:preview', 'Preview DM', ButtonStyle.Primary),
        button('admin:goodbye:dm:test', 'Send Test DM', ButtonStyle.Success),
      ),
      row(
        button('admin:goodbye:dm:reset', 'Reset DM', ButtonStyle.Danger),
        button('admin:goodbye', 'Back to Goodbye'),
      ),
    ],
  };
}

module.exports = { buildGoodbyeDmPanel };
