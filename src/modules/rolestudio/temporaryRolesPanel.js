'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const temporaryRoles = require('./temporaryRoles');

const PREFIX = 'admin:reactionRoles:temporary';
const selections = new Map();
const keyFor = (guildId, userId) => `${guildId}:${userId}`;
const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);

function formatExpiry(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'Unknown';
}

function getSelection(interaction) {
  return selections.get(keyFor(interaction.guild.id, interaction.user.id)) || { memberId: null, roleId: null };
}

function setSelection(interaction, patch) {
  const key = keyFor(interaction.guild.id, interaction.user.id);
  selections.set(key, { ...getSelection(interaction), ...patch });
  return selections.get(key);
}

function buildTemporaryRolesPanel(guild, userId, memberDisplayName = 'Unknown User') {
  const section = temporaryRoles.getSection(guild.id);
  const assignments = temporaryRoles.listAssignments(guild.id, { activeOnly: true });
  const selection = selections.get(keyFor(guild.id, userId)) || { memberId: null, roleId: null };
  const lines = assignments.length
    ? assignments.slice(0, 12).map((item) => `• <@${item.memberId}> → <@&${item.roleId}> • expires ${formatExpiry(item.expiresAt)}`)
    : ['No active temporary roles.'];

  const embed = new EmbedBuilder()
    .setColor(section.enabled !== false ? 0x57F287 : 0x747F8D)
    .setTitle('⚡ Temporary Roles')
    .setDescription([
      'Assign a role for a fixed amount of time. Goliath removes it automatically when it expires.',
      '',
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ⏸️'}`,
      `**Active assignments:** ${assignments.length}`,
      `**Selected member:** ${selection.memberId ? `<@${selection.memberId}>` : 'Choose below'}`,
      `**Selected role:** ${selection.roleId ? `<@&${selection.roleId}>` : 'Choose below'}`,
      '',
      '### Active assignments',
      ...lines,
      '',
      `Assigned: \`${section.analytics.assigned || 0}\` • Expired: \`${section.analytics.expired || 0}\` • Removed early: \`${section.analytics.removed || 0}\` • Failed: \`${section.analytics.failed || 0}\``,
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  const manage = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:manage`)
    .setPlaceholder(assignments.length ? 'Manage an active temporary role' : 'No active assignments')
    .setMinValues(1).setMaxValues(1).setDisabled(!assignments.length)
    .addOptions((assignments.length ? assignments.slice(0, 25) : [{ assignmentId: 'none', memberId: '0', roleId: '0', expiresAt: null }]).map((item) => new StringSelectMenuOptionBuilder()
      .setLabel(item.assignmentId === 'none' ? 'No active assignments' : `Member ${item.memberId}`.slice(0, 100))
      .setDescription(item.assignmentId === 'none' ? 'Create one above' : `Role ${item.roleId} • expires ${new Date(item.expiresAt).toLocaleString()}`.slice(0, 100))
      .setValue(item.assignmentId)));

  return {
    embeds: [embed],
    components: [
      row(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:member`).setPlaceholder('Choose a member').setMinValues(1).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:role`).setPlaceholder('Choose a temporary role').setMinValues(1).setMaxValues(1)),
      row(
        button(`${PREFIX}:assign`, 'Assign Temporary Role', ButtonStyle.Success, !(selection.memberId && selection.roleId)),
        button(`${PREFIX}:scan`, 'Scan Expired Now', ButtonStyle.Primary),
        button(section.enabled !== false ? `${PREFIX}:disable` : `${PREFIX}:enable`, section.enabled !== false ? 'Disable' : 'Enable'),
      ),
      row(manage),
      row(button('admin:reactionRoles', 'Back to Role Studio')),
    ],
  };
}

function buildDurationModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:assignSubmit`)
    .setTitle('Assign Temporary Role')
    .addComponents(
      row(new TextInputBuilder().setCustomId('value').setLabel('Duration value').setPlaceholder('Example: 24').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)),
      row(new TextInputBuilder().setCustomId('unit').setLabel('Unit: minutes, hours, days, weeks, months').setPlaceholder('hours').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
      row(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setPlaceholder('Optional reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)),
    );
}

function buildAssignmentPanel(guildId, assignmentId) {
  const assignment = temporaryRoles.listAssignments(guildId).find((item) => item.assignmentId === assignmentId);
  if (!assignment) throw new Error('Temporary role assignment not found.');
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⚡ Temporary Role Assignment')
      .setDescription([
        `**Member:** <@${assignment.memberId}>`,
        `**Role:** <@&${assignment.roleId}>`,
        `**Expires:** ${formatExpiry(assignment.expiresAt)}`,
        `**Reason:** ${assignment.reason || 'No reason provided'}`,
        `**Status:** ${assignment.status}`,
      ].join('\n'))],
    components: [row(
      button(`${PREFIX}:remove:${assignment.assignmentId}`, 'Remove Role Now', ButtonStyle.Danger),
      button(PREFIX, 'Back'),
      button('admin:reactionRoles', 'Role Studio'),
    )],
  };
}

async function refresh(interaction, payload = null) {
  const next = payload || buildTemporaryRolesPanel(interaction.guild, interaction.user.id, interaction.member?.displayName || interaction.user?.username);
  if (interaction.deferred || interaction.replied) return interaction.editReply(next);
  return interaction.update(next);
}

async function handleTemporaryRolesInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;

  if (id === PREFIX) return refresh(interaction);

  if (interaction.isUserSelectMenu?.() && id === `${PREFIX}:member`) {
    setSelection(interaction, { memberId: interaction.values[0] });
    return refresh(interaction);
  }

  if (interaction.isRoleSelectMenu?.() && id === `${PREFIX}:role`) {
    setSelection(interaction, { roleId: interaction.values[0] });
    return refresh(interaction);
  }

  if (interaction.isStringSelectMenu?.() && id === `${PREFIX}:manage`) {
    return refresh(interaction, buildAssignmentPanel(interaction.guild.id, interaction.values[0]));
  }

  if (id === `${PREFIX}:assign`) return interaction.showModal(buildDurationModal());

  if (interaction.isModalSubmit?.() && id === `${PREFIX}:assignSubmit`) {
    const selection = getSelection(interaction);
    if (!selection.memberId || !selection.roleId) throw new Error('Choose both a member and role first.');
    await temporaryRoles.assignTemporaryRole({
      guild: interaction.guild,
      memberId: selection.memberId,
      roleId: selection.roleId,
      value: interaction.fields.getTextInputValue('value'),
      unit: interaction.fields.getTextInputValue('unit'),
      reason: interaction.fields.getTextInputValue('reason'),
      assignedBy: interaction.user.id,
    });
    selections.delete(keyFor(interaction.guild.id, interaction.user.id));
    return refresh(interaction);
  }

  if (id === `${PREFIX}:scan`) {
    await interaction.deferUpdate();
    await temporaryRoles.scanExpired(interaction.guild, { actorId: interaction.user.id });
    return refresh(interaction);
  }

  if (id === `${PREFIX}:enable`) temporaryRoles.setEnabled(interaction.guild.id, true, { actorId: interaction.user.id });
  if (id === `${PREFIX}:disable`) temporaryRoles.setEnabled(interaction.guild.id, false, { actorId: interaction.user.id });

  if (id.startsWith(`${PREFIX}:remove:`)) {
    await interaction.deferUpdate();
    await temporaryRoles.removeAssignment(interaction.guild, id.split(':').pop(), { actorId: interaction.user.id });
    return refresh(interaction);
  }

  return refresh(interaction);
}

module.exports = {
  PREFIX,
  buildTemporaryRolesPanel,
  handleTemporaryRolesInteraction,
};