'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const timedRoles = require('./timedRoles');

const PREFIX = 'admin:timedRoles';
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);

function formatDuration(rule) {
  const value = Number(rule.value || 1);
  const unit = String(rule.unit || 'days');
  return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
}

function formatTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'Never';
}

async function buildTimedRolesPanel(guild, memberDisplayName = 'Unknown User') {
  const section = timedRoles.getSection(guild.id);
  const rules = timedRoles.listRules(guild.id);
  const health = await timedRoles.buildHealth(guild);
  const lines = rules.length
    ? rules.slice(0, 15).map((rule) => [
      `${rule.enabled ? '✅' : '⏸️'} **${rule.name}**`,
      `↳ <@&${rule.roleId}> after **${formatDuration(rule)}**`,
      rule.removeRoleIds.length ? `↳ Removes ${rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ')}` : null,
      rule.lastError ? `↳ ⚠️ ${rule.lastError}` : null,
    ].filter(Boolean).join('\n'))
    : ['No timed role milestones are configured.'];

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57F287 : 0xFAA61A)
    .setTitle('⏳ Timed Roles · Setup')
    .setDescription([
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Include Bots:** ${section.settings.includeBots ? 'Yes ✅' : 'No ❌'}`,
      `**Scan Interval:** ${section.settings.scanIntervalMinutes} minutes`,
      '',
      ...lines,
      '',
      `Scans: \`${section.analytics.scans || 0}\` | Awarded: \`${section.analytics.awarded || 0}\` | Removed: \`${section.analytics.removed || 0}\``,
      `Checked: \`${section.analytics.membersChecked || 0}\` | Skipped: \`${section.analytics.skipped || 0}\` | Failed: \`${section.analytics.failed || 0}\``,
      `Last scan: ${formatTimestamp(section.analytics.lastScanAt)}`,
      '',
      health.issues.length ? `**Health Issues**\n${health.issues.map((issue) => `• ${issue}`).join('\n')}` : '**Health:** Healthy ✅',
      health.warnings.length ? `\n**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:createRole`).setPlaceholder('Choose a role for a new milestone').setMinValues(1).setMaxValues(1)),
      row(new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:manage`)
        .setPlaceholder(rules.length ? 'Manage an existing milestone' : 'No milestones to manage')
        .setDisabled(!rules.length)
        .addOptions((rules.length ? rules.slice(0, 25) : [{ ruleId: 'none', name: 'No milestones', enabled: false, value: 1, unit: 'day' }]).map((rule) => new StringSelectMenuOptionBuilder()
          .setLabel(String(rule.name || 'Timed role').slice(0, 100))
          .setDescription(`${rule.enabled ? 'Enabled' : 'Disabled'} · ${formatDuration(rule)}`.slice(0, 100))
          .setValue(rule.ruleId)))),
      row(
        button(section.enabled !== false ? `${PREFIX}:disable` : `${PREFIX}:enable`, section.enabled !== false ? '⏸️ Disable' : '▶️ Enable', section.enabled !== false ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:toggleBots`, '🤖 Include Bots'),
        button(`${PREFIX}:interval`, '🕒 Scan Interval'),
        button(`${PREFIX}:scan`, '🔎 Scan Now', ButtonStyle.Success),
        button(`${PREFIX}:repair`, '🩺 Repair', ButtonStyle.Primary),
      ),
      row(
        button(`${PREFIX}:export`, '📤 Export'),
        button(`${PREFIX}:reset`, '♻️ Reset', ButtonStyle.Danger),
        button('admin:modules', '⬅️ Modules'),
      ),
    ],
  };
}

function buildRulePanel(guildId, ruleId) {
  const rule = timedRoles.getRule(guildId, ruleId);
  if (!rule) throw new Error('Timed role milestone not found.');
  return {
    embeds: [new EmbedBuilder()
      .setColor(rule.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle(`⏳ ${rule.name}`)
      .setDescription([
        `**Award Role:** <@&${rule.roleId}>`,
        `**Duration:** ${formatDuration(rule)}`,
        `**Status:** ${rule.enabled ? 'Enabled ✅' : 'Disabled ⏸️'}`,
        `**Remove Roles:** ${rule.removeRoleIds.length ? rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ') : '`None`'}`,
        `**Last Run:** ${formatTimestamp(rule.lastRunAt)}`,
        `**Last Awarded:** ${rule.lastAwarded || 0}`,
        rule.lastError ? `**Last Error:** ${rule.lastError}` : '',
      ].filter(Boolean).join('\n'))],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:cleanup:${rule.ruleId}`).setPlaceholder('Choose roles to remove at this milestone').setMinValues(0).setMaxValues(10)),
      row(
        button(`${PREFIX}:edit:${rule.ruleId}`, '✏️ Edit', ButtonStyle.Primary),
        button(`${PREFIX}:toggle:${rule.ruleId}`, rule.enabled ? '⏸️ Disable' : '▶️ Enable', rule.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:delete:${rule.ruleId}`, '🗑️ Delete', ButtonStyle.Danger),
        button(PREFIX, '⬅️ Back'),
      ),
    ],
  };
}

function buildRuleModal(customId, title, rule = {}) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      row(new TextInputBuilder().setCustomId('name').setLabel('Milestone name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(rule.name || 'Veteran')),
      row(new TextInputBuilder().setCustomId('value').setLabel('Duration value').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(rule.value || 1))),
      row(new TextInputBuilder().setCustomId('unit').setLabel('Unit: minutes, hours, days, weeks, months, years').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(rule.unit || 'years')),
    );
}

function buildIntervalModal(current) {
  return new ModalBuilder().setCustomId(`${PREFIX}:intervalSubmit`).setTitle('Timed Roles Scan Interval').addComponents(
    row(new TextInputBuilder().setCustomId('minutes').setLabel('Minutes between scans (5–1440)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(current))),
  );
}

async function refresh(interaction, payload = null) {
  const next = payload || await buildTimedRolesPanel(interaction.guild, interaction.member?.displayName || interaction.user?.username);
  if (interaction.deferred || interaction.replied) return interaction.editReply(next);
  return interaction.update(next);
}

async function handleTimedRolesInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith(PREFIX)) return false;
  try {
    if (customId === PREFIX) return refresh(interaction);

    if (interaction.isRoleSelectMenu?.()) {
      if (customId === `${PREFIX}:createRole`) {
        return interaction.showModal(buildRuleModal(`${PREFIX}:createSubmit:${interaction.values[0]}`, 'Create Timed Role Milestone'));
      }
      if (customId.startsWith(`${PREFIX}:cleanup:`)) {
        const ruleId = customId.split(':').pop();
        const rule = timedRoles.getRule(interaction.guild.id, ruleId);
        if (!rule) throw new Error('Timed role milestone not found.');
        timedRoles.saveRule(interaction.guild.id, { ...rule, removeRoleIds: interaction.values }, { actorId: interaction.user.id });
        return refresh(interaction, buildRulePanel(interaction.guild.id, ruleId));
      }
    }

    if (interaction.isStringSelectMenu?.() && customId === `${PREFIX}:manage`) {
      return refresh(interaction, buildRulePanel(interaction.guild.id, interaction.values[0]));
    }

    if (interaction.isModalSubmit?.()) {
      if (customId.startsWith(`${PREFIX}:createSubmit:`)) {
        const roleId = customId.split(':').pop();
        timedRoles.saveRule(interaction.guild.id, {
          name: interaction.fields.getTextInputValue('name'),
          roleId,
          value: interaction.fields.getTextInputValue('value'),
          unit: interaction.fields.getTextInputValue('unit'),
          createdBy: interaction.user.id,
        }, { actorId: interaction.user.id });
        return refresh(interaction);
      }
      if (customId.startsWith(`${PREFIX}:editSubmit:`)) {
        const ruleId = customId.split(':').pop();
        const rule = timedRoles.getRule(interaction.guild.id, ruleId);
        if (!rule) throw new Error('Timed role milestone not found.');
        timedRoles.saveRule(interaction.guild.id, {
          ...rule,
          name: interaction.fields.getTextInputValue('name'),
          value: interaction.fields.getTextInputValue('value'),
          unit: interaction.fields.getTextInputValue('unit'),
        }, { actorId: interaction.user.id });
        return refresh(interaction, buildRulePanel(interaction.guild.id, ruleId));
      }
      if (customId === `${PREFIX}:intervalSubmit`) {
        timedRoles.updateSettings(interaction.guild.id, { scanIntervalMinutes: interaction.fields.getTextInputValue('minutes') }, { actorId: interaction.user.id });
        return refresh(interaction);
      }
    }

    if (customId === `${PREFIX}:enable`) timedRoles.setEnabled(interaction.guild.id, true, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:disable`) timedRoles.setEnabled(interaction.guild.id, false, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:toggleBots`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { includeBots: !section.settings.includeBots }, { actorId: interaction.user.id });
    }
    if (customId === `${PREFIX}:interval`) return interaction.showModal(buildIntervalModal(timedRoles.getSection(interaction.guild.id).settings.scanIntervalMinutes));
    if (customId === `${PREFIX}:scan`) {
      await interaction.deferUpdate();
      await timedRoles.scanGuild(interaction.guild, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId === `${PREFIX}:repair`) {
      await interaction.deferUpdate();
      await timedRoles.repair(interaction.guild, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId === `${PREFIX}:reset`) {
      await interaction.deferUpdate();
      timedRoles.reset(interaction.guild.id, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId === `${PREFIX}:export`) {
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(timedRoles.exportConfiguration(interaction.guild.id), null, 2), 'utf8'), { name: `goliath-timed-roles-${interaction.guild.id}.json` });
      await interaction.reply({ content: '📤 Timed Roles configuration export.', files: [attachment], ephemeral: true });
      return true;
    }
    if (customId.startsWith(`${PREFIX}:edit:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      return interaction.showModal(buildRuleModal(`${PREFIX}:editSubmit:${ruleId}`, 'Edit Timed Role Milestone', rule));
    }
    if (customId.startsWith(`${PREFIX}:toggle:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      timedRoles.saveRule(interaction.guild.id, { ...rule, enabled: !rule.enabled }, { actorId: interaction.user.id });
      return refresh(interaction, buildRulePanel(interaction.guild.id, ruleId));
    }
    if (customId.startsWith(`${PREFIX}:delete:`)) {
      const ruleId = customId.split(':').pop();
      timedRoles.removeRule(interaction.guild.id, ruleId, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    return refresh(interaction);
  } catch (error) {
    const payload = { content: `❌ Timed Roles setup failed: ${error.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  PREFIX,
  formatDuration,
  buildOverview: buildTimedRolesPanel,
  buildTimedRolesPanel,
  handleTimedRolesInteraction,
};