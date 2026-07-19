'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const timedRoles = require('./timedRoles');

const PREFIX = 'admin:timedRoles';
const row = (...components) => new ActionRowBuilder().addComponents(...components.filter(Boolean));
const button = (customId, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);

function formatDuration(rule) { return timedRoles.formatDuration(rule); }
function formatTimestamp(value, style = 'R') {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : 'Never';
}
function displayName(interaction) { return interaction.member?.displayName || interaction.user?.username || 'Unknown User'; }

async function buildTimedRolesPanel(guild, memberDisplayName = 'Unknown User') {
  const section = timedRoles.getSection(guild.id);
  const rules = timedRoles.listRules(guild.id);
  const health = await timedRoles.buildHealth(guild);
  const mode = section.settings.progressionMode === 'keep_all' ? 'Keep every earned milestone role' : 'Keep highest milestone role only';
  const lines = rules.length
    ? rules.slice(0, 15).map((rule, index) => [
      `**${index + 1}. ${rule.enabled ? '✅' : '⏸️'} ${rule.name}**`,
      `↳ After **${formatDuration(rule)}** → <@&${rule.roleId}>`,
      rule.removeRoleIds.length ? `↳ Also removes ${rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ')}` : null,
      rule.lastError ? `↳ ⚠️ ${rule.lastError}` : null,
    ].filter(Boolean).join('\n'))
    : ['No milestones configured. Select any role below to create the first one.'];

  const embed = new EmbedBuilder()
    .setColor(health.healthy ? 0x57F287 : 0xFAA61A)
    .setTitle('⏳ Timed Roles · Member Tenure')
    .setDescription([
      'Reward members automatically for how long they have stayed in the server.',
      '',
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Progression:** ${mode}`,
      `**Promotion announcements:** ${section.settings.announcePromotions ? `Enabled in ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : 'no channel selected'} ✅` : 'Disabled'}`,
      `**Scan interval:** ${section.settings.scanIntervalMinutes} minutes`,
      '',
      '### Configured milestones',
      ...lines,
      '',
      `Scans: \`${section.analytics.scans || 0}\` • Awarded: \`${section.analytics.awarded || 0}\` • Removed: \`${section.analytics.removed || 0}\` • Failed: \`${section.analytics.failed || 0}\``,
      `Last scan: ${formatTimestamp(section.analytics.lastScanAt)}`,
      '',
      health.issues.length ? `**Health issues**\n${health.issues.map((issue) => `• ${issue}`).join('\n')}` : '**Health:** Healthy ✅',
      health.warnings.length ? `\n**Warnings**\n${health.warnings.map((warning) => `• ${warning}`).join('\n')}` : '',
    ].join('\n').slice(0, 4096))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  const manageOptions = rules.length ? rules.slice(0, 25) : [{ ruleId: 'none', name: 'No milestones', enabled: false, value: 1, unit: 'day' }];
  return {
    embeds: [embed],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:createRole`).setPlaceholder('Choose any role to create a milestone').setMinValues(1).setMaxValues(1)),
      row(new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}:manage`)
        .setPlaceholder(rules.length ? 'Manage a milestone' : 'No milestones to manage')
        .setDisabled(!rules.length)
        .addOptions(manageOptions.map((rule) => new StringSelectMenuOptionBuilder()
          .setLabel(String(rule.name || 'Timed role').slice(0, 100))
          .setDescription(`${rule.enabled ? 'Enabled' : 'Disabled'} • ${formatDuration(rule)}`.slice(0, 100))
          .setValue(rule.ruleId)))),
      row(new UserSelectMenuBuilder().setCustomId(`${PREFIX}:preview`).setPlaceholder('Preview any member’s progression').setMinValues(1).setMaxValues(1)),
      row(
        button(`${PREFIX}:scan`, '🔎 Scan Now', ButtonStyle.Success),
        button(`${PREFIX}:simulate`, '🧪 Simulate', ButtonStyle.Primary),
        button(`${PREFIX}:settings`, '⚙️ Settings'),
        button(`${PREFIX}:repair`, '🩺 Repair'),
      ),
      row(
        button(section.enabled !== false ? `${PREFIX}:disable` : `${PREFIX}:enable`, section.enabled !== false ? '⏸️ Disable' : '▶️ Enable', section.enabled !== false ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:export`, '📤 Export'),
        button('admin:reactionRoles', '⬅️ Role Studio'),
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
        `**Award role:** <@&${rule.roleId}>`,
        `**Required tenure:** ${formatDuration(rule)}`,
        `**Status:** ${rule.enabled ? 'Enabled ✅' : 'Disabled ⏸️'}`,
        `**Additional roles removed:** ${rule.removeRoleIds.length ? rule.removeRoleIds.map((id) => `<@&${id}>`).join(', ') : '`None`'}`,
        `**Last scan:** ${formatTimestamp(rule.lastRunAt)}`,
        `**Last awarded:** ${rule.lastAwarded || 0}`,
        rule.lastError ? `**Last error:** ${rule.lastError}` : '',
      ].filter(Boolean).join('\n'))],
    components: [
      row(new RoleSelectMenuBuilder().setCustomId(`${PREFIX}:cleanup:${rule.ruleId}`).setPlaceholder('Optional: roles to remove at this milestone').setMinValues(0).setMaxValues(10)),
      row(
        button(`${PREFIX}:edit:${rule.ruleId}`, '✏️ Edit', ButtonStyle.Primary),
        button(`${PREFIX}:duplicate:${rule.ruleId}`, '📋 Duplicate'),
        button(`${PREFIX}:toggle:${rule.ruleId}`, rule.enabled ? '⏸️ Disable' : '▶️ Enable', rule.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:delete:${rule.ruleId}`, '🗑️ Delete', ButtonStyle.Danger),
        button(PREFIX, '⬅️ Back'),
      ),
    ],
  };
}

function buildSettingsPanel(guildId) {
  const section = timedRoles.getSection(guildId);
  const highestOnly = section.settings.progressionMode === 'highest_only';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⚙️ Timed Roles Settings')
      .setDescription([
        `**Progression mode:** ${highestOnly ? 'Highest milestone only' : 'Keep all earned milestones'}`,
        `**Include bots:** ${section.settings.includeBots ? 'Yes' : 'No'}`,
        `**Scan interval:** ${section.settings.scanIntervalMinutes} minutes`,
        `**Announcements:** ${section.settings.announcePromotions ? 'Enabled' : 'Disabled'}`,
        `**Announcement channel:** ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : 'Not selected'}`,
        '',
        '**Message placeholders**',
        '`{member}` • `{role}` • `{duration}` • `{server}`',
        '',
        `**Current message**\n${section.settings.announcementMessage}`,
      ].join('\n').slice(0, 4096))],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}:announcementChannel`)
        .setPlaceholder('Choose promotion announcement channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1)),
      row(
        button(`${PREFIX}:toggleMode`, highestOnly ? '🏅 Use Keep All' : '🥇 Use Highest Only', ButtonStyle.Primary),
        button(`${PREFIX}:toggleAnnouncements`, section.settings.announcePromotions ? '🔕 Disable Announcements' : '📢 Enable Announcements'),
        button(`${PREFIX}:toggleBots`, '🤖 Include Bots'),
      ),
      row(
        button(`${PREFIX}:interval`, '🕒 Scan Interval'),
        button(`${PREFIX}:message`, '💬 Promotion Message'),
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
      row(new TextInputBuilder().setCustomId('value').setLabel('Time value').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(rule.value || 6))),
      row(new TextInputBuilder().setCustomId('unit').setLabel('minutes, hours, days, weeks, months or years').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(rule.unit || 'months')),
    );
}
function buildIntervalModal(current) {
  return new ModalBuilder().setCustomId(`${PREFIX}:intervalSubmit`).setTitle('Timed Roles Scan Interval').addComponents(
    row(new TextInputBuilder().setCustomId('minutes').setLabel('Minutes between scans (5–1440)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(current))),
  );
}
function buildMessageModal(current) {
  return new ModalBuilder().setCustomId(`${PREFIX}:messageSubmit`).setTitle('Promotion Announcement').addComponents(
    row(new TextInputBuilder().setCustomId('message').setLabel('Promotion message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(current)),
  );
}

async function buildPreviewPanel(guild, memberId) {
  const member = guild.members.cache.get(memberId) || await guild.members.fetch(memberId).catch(() => null);
  if (!member) throw new Error('Member not found.');
  const progression = timedRoles.getMemberProgression(member);
  const heldMilestones = timedRoles.listRules(guild.id).filter((rule) => member.roles.cache.has(rule.roleId));
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔍 Member Tenure Preview')
      .setDescription([
        `**Member:** <@${member.id}>`,
        `**Joined:** ${formatTimestamp(member.joinedAt, 'F')}`,
        `**Current milestone:** ${progression.current ? `${progression.current.name} → <@&${progression.current.roleId}>` : 'No milestone reached yet'}`,
        `**Next milestone:** ${progression.next ? `${progression.next.name} → <@&${progression.next.roleId}>` : 'Highest configured milestone reached'}`,
        `**Next promotion:** ${progression.nextAt ? formatTimestamp(progression.nextAt) : 'None'}`,
        `**Milestone roles currently held:** ${heldMilestones.length ? heldMilestones.map((rule) => `<@&${rule.roleId}>`).join(', ') : 'None'}`,
        '',
        '> Preview does not change any roles.',
      ].join('\n'))],
    components: [row(
      button(`${PREFIX}:applyMember:${member.id}`, '✅ Apply Correct Roles', ButtonStyle.Success),
      button(PREFIX, '⬅️ Back'),
    )],
  };
}

function buildSimulationPanel(result) {
  const examples = result.changes.slice(0, 10).map((change) => `• <@${change.memberId}>: +${change.add.length} / -${change.remove.length}`);
  return {
    embeds: [new EmbedBuilder()
      .setColor(result.failed ? 0xFAA61A : 0x57F287)
      .setTitle('🧪 Timed Roles Simulation')
      .setDescription([
        'No roles were changed.',
        '',
        `**Members checked:** ${result.membersChecked}`,
        `**Roles to award:** ${result.awards}`,
        `**Roles to remove:** ${result.removals}`,
        `**Already correct:** ${result.unchanged}`,
        `**Failures:** ${result.failed}`,
        examples.length ? `\n**Example changes**\n${examples.join('\n')}` : '',
        result.changes.length > 10 ? `\n…and ${result.changes.length - 10} more member changes.` : '',
      ].filter(Boolean).join('\n'))],
    components: [row(
      button(`${PREFIX}:scan`, '🚀 Apply Changes', ButtonStyle.Success, !result.changes.length),
      button(PREFIX, '⬅️ Back'),
    )],
  };
}

async function refresh(interaction, payload = null) {
  const next = payload || await buildTimedRolesPanel(interaction.guild, displayName(interaction));
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
        return interaction.showModal(buildRuleModal(`${PREFIX}:createSubmit:${interaction.values[0]}`, 'Create Tenure Milestone'));
      }
      if (customId.startsWith(`${PREFIX}:cleanup:`)) {
        const ruleId = customId.split(':').pop();
        const rule = timedRoles.getRule(interaction.guild.id, ruleId);
        if (!rule) throw new Error('Timed role milestone not found.');
        timedRoles.saveRule(interaction.guild.id, { ...rule, removeRoleIds: interaction.values }, { actorId: interaction.user.id });
        return refresh(interaction, buildRulePanel(interaction.guild.id, ruleId));
      }
    }

    if (interaction.isChannelSelectMenu?.() && customId === `${PREFIX}:announcementChannel`) {
      timedRoles.updateSettings(interaction.guild.id, { announcementChannelId: interaction.values[0] || null }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }

    if (interaction.isUserSelectMenu?.() && customId === `${PREFIX}:preview`) {
      return refresh(interaction, await buildPreviewPanel(interaction.guild, interaction.values[0]));
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
        return refresh(interaction, buildSettingsPanel(interaction.guild.id));
      }
      if (customId === `${PREFIX}:messageSubmit`) {
        timedRoles.updateSettings(interaction.guild.id, { announcementMessage: interaction.fields.getTextInputValue('message') }, { actorId: interaction.user.id });
        return refresh(interaction, buildSettingsPanel(interaction.guild.id));
      }
    }

    if (customId === `${PREFIX}:settings`) return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    if (customId === `${PREFIX}:enable`) timedRoles.setEnabled(interaction.guild.id, true, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:disable`) timedRoles.setEnabled(interaction.guild.id, false, { actorId: interaction.user.id });
    if (customId === `${PREFIX}:toggleBots`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { includeBots: !section.settings.includeBots }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:toggleMode`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { progressionMode: section.settings.progressionMode === 'highest_only' ? 'keep_all' : 'highest_only' }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:toggleAnnouncements`) {
      const section = timedRoles.getSection(interaction.guild.id);
      timedRoles.updateSettings(interaction.guild.id, { announcePromotions: !section.settings.announcePromotions }, { actorId: interaction.user.id });
      return refresh(interaction, buildSettingsPanel(interaction.guild.id));
    }
    if (customId === `${PREFIX}:interval`) return interaction.showModal(buildIntervalModal(timedRoles.getSection(interaction.guild.id).settings.scanIntervalMinutes));
    if (customId === `${PREFIX}:message`) return interaction.showModal(buildMessageModal(timedRoles.getSection(interaction.guild.id).settings.announcementMessage));
    if (customId === `${PREFIX}:simulate`) {
      await interaction.deferUpdate();
      return refresh(interaction, buildSimulationPanel(await timedRoles.simulateGuild(interaction.guild)));
    }
    if (customId === `${PREFIX}:scan`) {
      await interaction.deferUpdate();
      await timedRoles.scanGuild(interaction.guild, { actorId: interaction.user.id });
      return refresh(interaction);
    }
    if (customId.startsWith(`${PREFIX}:applyMember:`)) {
      await interaction.deferUpdate();
      const memberId = customId.split(':').pop();
      const member = interaction.guild.members.cache.get(memberId) || await interaction.guild.members.fetch(memberId).catch(() => null);
      if (!member) throw new Error('Member not found.');
      await timedRoles.applyProgressionToMember(member);
      return refresh(interaction, await buildPreviewPanel(interaction.guild, memberId));
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
      return interaction.showModal(buildRuleModal(`${PREFIX}:editSubmit:${ruleId}`, 'Edit Tenure Milestone', rule));
    }
    if (customId.startsWith(`${PREFIX}:duplicate:`)) {
      const ruleId = customId.split(':').pop();
      const rule = timedRoles.getRule(interaction.guild.id, ruleId);
      if (!rule) throw new Error('Timed role milestone not found.');
      timedRoles.saveRule(interaction.guild.id, { ...rule, ruleId: undefined, name: `${rule.name} Copy`, createdBy: interaction.user.id }, { actorId: interaction.user.id });
      return refresh(interaction);
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
  buildSettingsPanel,
  buildPreviewPanel,
  handleTimedRolesInteraction,
};