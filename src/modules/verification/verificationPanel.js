'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');

const PAGES = ['overview', 'workflow', 'roles', 'requirements', 'messages', 'panel', 'status'];

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function cleanArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean))] : [];
}

function getConfig(guildId) {
  const modules = guildManager.getGuildSection(guildId, 'modules', {});
  const admin = modules?.verification && typeof modules.verification === 'object' ? modules.verification : {};
  const section = verificationStore.getVerificationSection(guildId);
  const settings = verificationStore.normalizeSettings({ ...(section.settings || {}), ...admin, ...(admin.settings || {}) });
  return {
    enabled: typeof admin.enabled === 'boolean' ? admin.enabled : section.enabled,
    ...settings,
  };
}

function saveConfig(guild, updater) {
  const current = getConfig(guild.id);
  const next = verificationStore.normalizeSettings(
    typeof updater === 'function' ? updater({ ...current }) : { ...current, ...(updater || {}) }
  );
  const enabled = typeof updater === 'object' && typeof updater.enabled === 'boolean'
    ? updater.enabled
    : typeof current.enabled === 'boolean' ? current.enabled : true;

  guildManager.updateGuildSection(guild.id, 'modules', (modules = {}) => ({
    ...(modules && typeof modules === 'object' ? modules : {}),
    verification: {
      enabled,
      ...next,
      updatedAt: new Date().toISOString(),
    },
  }), {}, guild);

  verificationManager.configureVerification(guild.id, {
    enabled,
    settings: next,
  }, { action: 'verification_admin_config_sync' });

  return getConfig(guild.id);
}

function resetConfig(guild) {
  guildManager.updateGuildSection(guild.id, 'modules', (modules = {}) => {
    const nextModules = { ...(modules && typeof modules === 'object' ? modules : {}) };
    delete nextModules.verification;
    return nextModules;
  }, {}, guild);
  verificationStore.saveVerificationSection(guild.id, verificationStore.defaultVerificationSection(), {
    action: 'verification_admin_reset',
  });
}

function yesNo(value) {
  return value ? 'Yes ✅' : 'No ❌';
}

function formatChannel(id) {
  return id ? `<#${id}>` : '`Not set`';
}

function formatRoles(ids = []) {
  const list = cleanArray(ids);
  return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

function latestPanel(guildId) {
  return verificationStore.getLatestPanel(guildId);
}

function panelTemplate(guildId) {
  return verificationStore.getVerificationSection(guildId).panelTemplate || verificationStore.defaultPanelTemplate();
}

function navRow(page, config) {
  const index = Math.max(0, PAGES.indexOf(page));
  const components = [];
  if (index > 0) components.push(button(`admin:verification:page:${PAGES[index - 1]}`, '⬅️ Back', ButtonStyle.Secondary));
  components.push(button('admin:verification:page:overview', '🏠 Overview', page === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary));
  if (index < PAGES.length - 1) components.push(button(`admin:verification:page:${PAGES[index + 1]}`, 'Next ➡️', ButtonStyle.Secondary));
  components.push(button(config.enabled ? 'admin:verification:disable' : 'admin:verification:enable', config.enabled ? '⏸️ Disable' : '▶️ Enable', config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success));
  components.push(button('admin:modules', 'Modules', ButtonStyle.Secondary));
  return row(...components.slice(0, 5));
}

function baseEmbed(title, description, memberDisplayName, color = 0x5865f2) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();
}

function buildOverviewPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const section = verificationManager.getVerificationStatus(guild.id);
  const screening = verificationManager.hasDiscordScreening(guild);
  const panels = Object.values(section.panels || {});
  const embed = baseEmbed('✅ Verification · Overview', [
    'Flexible server verification with every stage optional.',
    '',
    `**Module:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Discord Screening:** ${screening ? 'Detected ✅' : 'Not configured'}`,
    `**Wait for Screening:** ${yesNo(config.waitForDiscordScreening)}`,
    `**Method:** \`${config.method}\``,
    `**Verification Channel:** ${formatChannel(config.verificationChannelId)}`,
    `**Verified Roles:** ${formatRoles(config.verifiedRoleIds)}`,
    `**Pending Roles Enabled:** ${yesNo(config.usePendingRoles)}`,
    `**Pending Roles:** ${formatRoles(config.pendingRoleIds)}`,
    `**DM on Success:** ${yesNo(config.dmOnVerify)}`,
    '',
    `Panels: \`${panels.length}\` | Verified: \`${section.analytics?.verified || 0}\` | Failed: \`${section.analytics?.failed || 0}\``,
  ].join('\n'), memberDisplayName, config.enabled ? 0x57f287 : 0x5865f2);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:verification:page:workflow', '🔀 Workflow'),
        button('admin:verification:page:roles', '🎭 Roles'),
        button('admin:verification:page:requirements', '🔒 Requirements'),
        button('admin:verification:page:messages', '💬 Messages'),
        button('admin:verification:page:panel', '🎨 Panel')
      ),
      row(
        button('admin:verification:page:status', '🩺 Health', ButtonStyle.Secondary),
        button('admin:verification:export', '📤 Export', ButtonStyle.Secondary),
        button('admin:verification:resetAll', '♻️ Reset', ButtonStyle.Danger)
      ),
      navRow('overview', config),
    ],
  };
}

function buildWorkflowPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const screening = verificationManager.hasDiscordScreening(guild);
  const embed = baseEmbed('🔀 Verification · Workflow', [
    `**Discord Screening Detected:** ${screening ? 'Yes ✅' : 'No'}`,
    `**Wait for Screening:** ${yesNo(config.waitForDiscordScreening)}`,
    `**Skip if Unavailable:** ${yesNo(config.skipScreeningIfUnavailable)}`,
    `**Log Screening Completion:** ${yesNo(config.logScreeningCompletion)}`,
    '',
    `**Use Pending Roles:** ${yesNo(config.usePendingRoles)}`,
    `**Assign Pending Roles:** ${yesNo(config.assignPendingRoles)}`,
    `**Assignment Timing:** \`${config.pendingRoleTiming}\``,
    `**Require Pending Role:** ${yesNo(config.requirePendingRole)}`,
    `**Remove Pending Roles:** ${yesNo(config.removePendingRoles)}`,
    '',
    'Selecting a pending role does not automatically enable, assign, require or remove it.',
  ].join('\n'), memberDisplayName);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:verification:toggle:waitForDiscordScreening', '📜 Wait Screening', ButtonStyle.Secondary),
        button('admin:verification:toggle:skipScreeningIfUnavailable', '⏭️ Skip Missing', ButtonStyle.Secondary),
        button('admin:verification:toggle:logScreeningCompletion', '📝 Log Screening', ButtonStyle.Secondary)
      ),
      row(
        button('admin:verification:toggle:usePendingRoles', '🎭 Use Pending', ButtonStyle.Secondary),
        button('admin:verification:toggle:assignPendingRoles', '➕ Auto Assign', ButtonStyle.Secondary),
        button('admin:verification:toggle:requirePendingRole', '🔒 Require Pending', ButtonStyle.Secondary),
        button('admin:verification:toggle:removePendingRoles', '🧹 Remove Pending', ButtonStyle.Secondary)
      ),
      row(new StringSelectMenuBuilder()
        .setCustomId('admin:verification:pendingTiming')
        .setPlaceholder('Pending-role assignment timing')
        .addOptions([
          { label: 'On Join', value: 'on_join', description: 'Assign immediately when the member joins' },
          { label: 'After Discord Screening', value: 'after_screening', description: 'Wait until member.pending becomes false' },
          { label: 'Manual Only', value: 'manual', description: 'Never assign automatically' },
        ])),
      navRow('workflow', config),
    ],
  };
}

function buildRolesPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const embed = baseEmbed('🎭 Verification · Roles & Channels', [
    `**Verification Channel:** ${formatChannel(config.verificationChannelId)}`,
    `**Log Channel:** ${formatChannel(config.logChannelId)}`,
    `**Verified Roles:** ${formatRoles(config.verifiedRoleIds)}`,
    `**Pending Roles:** ${formatRoles(config.pendingRoleIds)}`,
    '',
    'All roles are selected from this server. Goliath must be above every role it needs to add or remove.',
  ].join('\n'), memberDisplayName);

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:verification:channel').setPlaceholder('Verification channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:verification:logChannel').setPlaceholder('Optional log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId('admin:verification:verifiedRoles').setPlaceholder('Verified role(s)').setMinValues(0).setMaxValues(10)),
      row(new RoleSelectMenuBuilder().setCustomId('admin:verification:pendingRoles').setPlaceholder('Optional pending role(s)').setMinValues(0).setMaxValues(10)),
      navRow('roles', config),
    ],
  };
}

function buildRequirementsPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const embed = baseEmbed('🔒 Verification · Requirements', [
    `**Block Bots:** ${yesNo(config.blockBots)}`,
    `**Allow Management Bypass:** ${yesNo(config.allowStaffBypass)}`,
    `**Allow Reverification:** ${yesNo(config.allowReverification)}`,
    `**Minimum Account Age:** \`${config.minimumAccountAgeDays}\` day(s)`,
    `**Minimum Server Time:** \`${config.minimumMembershipAgeMinutes}\` minute(s)`,
    `**Attempt Cooldown:** \`${config.attemptCooldownSeconds}\` second(s)`,
    `**Maximum Failed Attempts:** \`${config.maximumFailedAttempts || 'Unlimited'}\``,
    '',
    'A value of 0 disables that numeric requirement.',
  ].join('\n'), memberDisplayName);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:verification:toggle:blockBots', '🤖 Block Bots', ButtonStyle.Secondary),
        button('admin:verification:toggle:allowStaffBypass', '🛡️ Management Bypass', ButtonStyle.Secondary),
        button('admin:verification:toggle:allowReverification', '🔁 Reverification', ButtonStyle.Secondary)
      ),
      row(button('admin:verification:editRequirements', '✏️ Edit Numeric Requirements', ButtonStyle.Primary)),
      navRow('requirements', config),
    ],
  };
}

function buildMessagesPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const section = verificationStore.getVerificationSection(guild.id);
  const messages = section.messages;
  const embed = baseEmbed('💬 Verification · Messages', [
    `**DM on Verification:** ${yesNo(config.dmOnVerify)}`,
    `**DM on Pending Role:** ${yesNo(config.dmOnPendingRole)}`,
    `**Log Success:** ${yesNo(config.logSuccess)}`,
    `**Log Failure:** ${yesNo(config.logFailure)}`,
    '',
    `**Success:** ${messages.success}`,
    `**Screening Required:** ${messages.screeningRequired}`,
    `**Pending Role Required:** ${messages.pendingRoleRequired}`,
    `**Success DM:** ${messages.dmSuccess}`,
    '',
    'Variables: `{user}` `{username}` `{server}` `{verifiedRoles}` `{pendingRoles}` `{reason}` and requirement values.',
  ].join('\n').slice(0, 4096), memberDisplayName);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:verification:toggle:dmOnVerify', '📩 Success DM', ButtonStyle.Secondary),
        button('admin:verification:toggle:dmOnPendingRole', '📨 Pending DM', ButtonStyle.Secondary),
        button('admin:verification:toggle:logSuccess', '✅ Success Logs', ButtonStyle.Secondary),
        button('admin:verification:toggle:logFailure', '❌ Failure Logs', ButtonStyle.Secondary)
      ),
      row(
        button('admin:verification:editMessagesCore', '✏️ Core Messages', ButtonStyle.Primary),
        button('admin:verification:editMessagesRules', '✏️ Requirement Messages', ButtonStyle.Primary),
        button('admin:verification:resetMessages', '♻️ Reset Messages', ButtonStyle.Danger)
      ),
      navRow('messages', config),
    ],
  };
}

function buildPanelPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const current = panelTemplate(guild.id);
  const latest = latestPanel(guild.id);
  const preview = { panelId: 'preview', ...current };
  const embed = baseEmbed('🎨 Verification · Panel Builder', [
    `**Title:** ${current.title}`,
    `**Button:** ${current.buttonEmoji ? `${current.buttonEmoji} ` : ''}${current.buttonLabel} · \`${current.buttonStyle}\``,
    `**Colour:** \`${current.color}\``,
    `**Channel:** ${formatChannel(latest?.channelId)}`,
    `**Latest Panel:** ${latest ? `\`${latest.panelId}\`` : '`None`'}`,
  ].join('\n'), memberDisplayName, current.color || 0x57f287);

  return {
    embeds: [embed, verificationManager.buildVerificationEmbed(preview)],
    components: [
      row(
        button('admin:verification:editEmbed', '✏️ Edit Embed'),
        button('admin:verification:editButton', '🔘 Edit Button'),
        button('admin:verification:preview', '👁️ Preview', ButtonStyle.Secondary),
        button('admin:verification:deploy', '🚀 Deploy', ButtonStyle.Success),
        button('admin:verification:redeploy', '🔄 Redeploy', ButtonStyle.Success)
      ),
      row(
        button('admin:verification:deleteLatest', '🗑️ Delete Latest', ButtonStyle.Danger),
        button('admin:verification:resetTemplate', '♻️ Reset Design', ButtonStyle.Danger)
      ),
      row(new StringSelectMenuBuilder().setCustomId('admin:verification:buttonStyle').setPlaceholder('Button style').addOptions([
        { label: 'Success', value: 'success' },
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
        { label: 'Danger', value: 'danger' },
      ])),
      navRow('panel', config),
    ],
  };
}

async function buildStatusPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);
  const report = await verificationManager.buildHealthReport(guild);
  const embed = baseEmbed('🩺 Verification · Health', [
    `**Overall:** ${report.warnings.length ? 'Needs attention ⚠️' : 'Healthy ✅'}`,
    `**Discord Screening:** ${report.screeningEnabled ? 'Detected ✅' : 'Not configured'}`,
    `**Verified Roles:** \`${report.verifiedRoleCount}\``,
    `**Pending Roles:** \`${report.pendingRoleCount}\``,
    `**Log Channel:** ${report.hasLogChannel ? 'Configured ✅' : 'Optional / not configured'}`,
    '',
    '**Warnings**',
    report.warnings.length ? report.warnings.map((warning) => `• ${warning}`).join('\n') : 'None ✅',
    '',
    '**Panels**',
    report.panels.length ? report.panels.map((panel) => `• \`${panel.panelId}\` — ${panel.status}`).join('\n') : '`No panel records.`',
  ].join('\n').slice(0, 4096), memberDisplayName, report.warnings.length ? 0xfaa61a : 0x57f287);

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:verification:statusRefresh', '🔄 Refresh', ButtonStyle.Primary),
        button('admin:verification:redeploy', '🔧 Repair Latest', ButtonStyle.Success),
        button('admin:verification:test', '🧪 Test Setup', ButtonStyle.Secondary),
        button('admin:verification:export', '📤 Export', ButtonStyle.Secondary)
      ),
      navRow('status', config),
    ],
  };
}

async function buildVerificationAdminPanel(guild, memberDisplayName = 'Unknown User', page = 'overview') {
  const safePage = PAGES.includes(page) ? page : 'overview';
  if (safePage === 'workflow') return buildWorkflowPage(guild, memberDisplayName);
  if (safePage === 'roles') return buildRolesPage(guild, memberDisplayName);
  if (safePage === 'requirements') return buildRequirementsPage(guild, memberDisplayName);
  if (safePage === 'messages') return buildMessagesPage(guild, memberDisplayName);
  if (safePage === 'panel') return buildPanelPage(guild, memberDisplayName);
  if (safePage === 'status') return buildStatusPage(guild, memberDisplayName);
  return buildOverviewPage(guild, memberDisplayName);
}

function textInput(customId, label, value, style = TextInputStyle.Short, maxLength = 1000, required = true) {
  return new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setMaxLength(maxLength).setRequired(required).setValue(String(value || '').slice(0, maxLength));
}

function buildEmbedModal(guildId) {
  const current = panelTemplate(guildId);
  return new ModalBuilder().setCustomId('admin:verification:embedModal').setTitle('Verification Embed').addComponents(
    row(textInput('title', 'Title', current.title, TextInputStyle.Short, 100)),
    row(textInput('description', 'Description', current.description, TextInputStyle.Paragraph, 1000)),
    row(textInput('color', 'Hex colour', current.color, TextInputStyle.Short, 7)),
    row(textInput('footer', 'Footer', current.footer, TextInputStyle.Short, 200, false)),
    row(textInput('imageUrl', 'Image URL optional', current.imageUrl, TextInputStyle.Short, 500, false))
  );
}

function buildButtonModal(guildId) {
  const current = panelTemplate(guildId);
  return new ModalBuilder().setCustomId('admin:verification:buttonModal').setTitle('Verification Button').addComponents(
    row(textInput('buttonLabel', 'Button label', current.buttonLabel, TextInputStyle.Short, 80)),
    row(textInput('buttonEmoji', 'Button emoji optional', current.buttonEmoji, TextInputStyle.Short, 80, false)),
    row(textInput('thumbnailUrl', 'Thumbnail URL optional', current.thumbnailUrl, TextInputStyle.Short, 500, false))
  );
}

function buildRequirementsModal(guildId) {
  const config = getConfig(guildId);
  return new ModalBuilder().setCustomId('admin:verification:requirementsModal').setTitle('Verification Requirements').addComponents(
    row(textInput('minimumAccountAgeDays', 'Minimum account age in days', config.minimumAccountAgeDays, TextInputStyle.Short, 5)),
    row(textInput('minimumMembershipAgeMinutes', 'Minimum server time in minutes', config.minimumMembershipAgeMinutes, TextInputStyle.Short, 8)),
    row(textInput('attemptCooldownSeconds', 'Attempt cooldown in seconds', config.attemptCooldownSeconds, TextInputStyle.Short, 6)),
    row(textInput('maximumFailedAttempts', 'Maximum failures, 0 = unlimited', config.maximumFailedAttempts, TextInputStyle.Short, 4))
  );
}

function buildCoreMessagesModal(guildId) {
  const messages = verificationStore.getVerificationSection(guildId).messages;
  return new ModalBuilder().setCustomId('admin:verification:messagesCoreModal').setTitle('Core Verification Messages').addComponents(
    row(textInput('success', 'Success message', messages.success, TextInputStyle.Paragraph, 1000)),
    row(textInput('alreadyVerified', 'Already verified', messages.alreadyVerified, TextInputStyle.Paragraph, 1000)),
    row(textInput('unavailable', 'Unavailable message', messages.unavailable, TextInputStyle.Paragraph, 1000)),
    row(textInput('failed', 'Generic failure message', messages.failed, TextInputStyle.Paragraph, 1000)),
    row(textInput('dmSuccess', 'Success DM', messages.dmSuccess, TextInputStyle.Paragraph, 1000))
  );
}

function buildRuleMessagesModal(guildId) {
  const messages = verificationStore.getVerificationSection(guildId).messages;
  return new ModalBuilder().setCustomId('admin:verification:messagesRulesModal').setTitle('Requirement Messages').addComponents(
    row(textInput('screeningRequired', 'Screening required', messages.screeningRequired, TextInputStyle.Paragraph, 1000)),
    row(textInput('pendingRoleRequired', 'Pending role required', messages.pendingRoleRequired, TextInputStyle.Paragraph, 1000)),
    row(textInput('accountTooNew', 'Account too new', messages.accountTooNew, TextInputStyle.Paragraph, 1000)),
    row(textInput('membershipTooNew', 'Membership too new', messages.membershipTooNew, TextInputStyle.Paragraph, 1000)),
    row(textInput('cooldown', 'Cooldown message', messages.cooldown, TextInputStyle.Paragraph, 1000))
  );
}

async function safeUpdate(interaction, payload) {
  const resolved = await payload;
  if (interaction.deferred || interaction.replied) await interaction.editReply(resolved);
  else await interaction.update(resolved);
  return true;
}

async function replyEphemeral(interaction, content) {
  const payload = { content, flags: 64 };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => null);
  return interaction.reply(payload).catch(() => null);
}

async function deployLatestOrNew(interaction, redeploy = false) {
  const config = getConfig(interaction.guild.id);
  if (!config.verificationChannelId) throw new Error('Choose a verification channel first.');
  const channel = interaction.guild.channels.cache.get(config.verificationChannelId) || await interaction.guild.channels.fetch(config.verificationChannelId).catch(() => null);
  if (!channel?.send) throw new Error('Verification channel is not sendable.');
  const existing = redeploy ? latestPanel(interaction.guild.id) : null;
  return verificationManager.deployVerificationPanel(channel, {
    ...panelTemplate(interaction.guild.id),
    panelId: existing?.panelId,
    createdBy: interaction.user.id,
  }, { actorId: interaction.user.id });
}

function exportAttachment(guildId) {
  const data = {
    exportedAt: new Date().toISOString(),
    guildId,
    config: getConfig(guildId),
    module: verificationStore.getVerificationSection(guildId),
  };
  return new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
    name: `goliath-verification-${guildId}.json`,
  });
}

async function handleVerificationAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:verification')) return false;
  const displayName = getMemberDisplayName(interaction);

  try {
    if (customId === 'admin:verification') return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName));

    const pageMatch = customId.match(/^admin:verification:page:([a-z_]+)$/);
    if (pageMatch && PAGES.includes(pageMatch[1])) return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, pageMatch[1]));

    if (customId === 'admin:verification:editEmbed') return interaction.showModal(buildEmbedModal(interaction.guild.id)).then(() => true);
    if (customId === 'admin:verification:editButton') return interaction.showModal(buildButtonModal(interaction.guild.id)).then(() => true);
    if (customId === 'admin:verification:editRequirements') return interaction.showModal(buildRequirementsModal(interaction.guild.id)).then(() => true);
    if (customId === 'admin:verification:editMessagesCore') return interaction.showModal(buildCoreMessagesModal(interaction.guild.id)).then(() => true);
    if (customId === 'admin:verification:editMessagesRules') return interaction.showModal(buildRuleMessagesModal(interaction.guild.id)).then(() => true);

    if (interaction.isModalSubmit?.() && customId === 'admin:verification:embedModal') {
      verificationManager.updatePanelTemplate(interaction.guild.id, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        color: interaction.fields.getTextInputValue('color'),
        footer: interaction.fields.getTextInputValue('footer'),
        imageUrl: interaction.fields.getTextInputValue('imageUrl'),
      }, { actorId: interaction.user.id });
      await interaction.reply({ content: '✅ Verification embed updated.', flags: 64 });
      return true;
    }

    if (interaction.isModalSubmit?.() && customId === 'admin:verification:buttonModal') {
      verificationManager.updatePanelTemplate(interaction.guild.id, {
        buttonLabel: interaction.fields.getTextInputValue('buttonLabel'),
        buttonEmoji: interaction.fields.getTextInputValue('buttonEmoji'),
        thumbnailUrl: interaction.fields.getTextInputValue('thumbnailUrl'),
      }, { actorId: interaction.user.id });
      await interaction.reply({ content: '✅ Verification button updated.', flags: 64 });
      return true;
    }

    if (interaction.isModalSubmit?.() && customId === 'admin:verification:requirementsModal') {
      saveConfig(interaction.guild, {
        minimumAccountAgeDays: interaction.fields.getTextInputValue('minimumAccountAgeDays'),
        minimumMembershipAgeMinutes: interaction.fields.getTextInputValue('minimumMembershipAgeMinutes'),
        attemptCooldownSeconds: interaction.fields.getTextInputValue('attemptCooldownSeconds'),
        maximumFailedAttempts: interaction.fields.getTextInputValue('maximumFailedAttempts'),
      });
      await interaction.reply({ content: '✅ Verification requirements updated.', flags: 64 });
      return true;
    }

    if (interaction.isModalSubmit?.() && customId === 'admin:verification:messagesCoreModal') {
      verificationManager.updateVerificationMessages(interaction.guild.id, {
        success: interaction.fields.getTextInputValue('success'),
        alreadyVerified: interaction.fields.getTextInputValue('alreadyVerified'),
        unavailable: interaction.fields.getTextInputValue('unavailable'),
        failed: interaction.fields.getTextInputValue('failed'),
        dmSuccess: interaction.fields.getTextInputValue('dmSuccess'),
      }, { actorId: interaction.user.id });
      await interaction.reply({ content: '✅ Core verification messages updated.', flags: 64 });
      return true;
    }

    if (interaction.isModalSubmit?.() && customId === 'admin:verification:messagesRulesModal') {
      verificationManager.updateVerificationMessages(interaction.guild.id, {
        screeningRequired: interaction.fields.getTextInputValue('screeningRequired'),
        pendingRoleRequired: interaction.fields.getTextInputValue('pendingRoleRequired'),
        accountTooNew: interaction.fields.getTextInputValue('accountTooNew'),
        membershipTooNew: interaction.fields.getTextInputValue('membershipTooNew'),
        cooldown: interaction.fields.getTextInputValue('cooldown'),
      }, { actorId: interaction.user.id });
      await interaction.reply({ content: '✅ Requirement messages updated.', flags: 64 });
      return true;
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:verification:pendingTiming') {
      saveConfig(interaction.guild, { pendingRoleTiming: interaction.values?.[0] || 'after_screening' });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'workflow'));
    }

    if (interaction.isStringSelectMenu?.() && customId === 'admin:verification:buttonStyle') {
      verificationManager.updatePanelTemplate(interaction.guild.id, { buttonStyle: interaction.values?.[0] || 'success' }, { actorId: interaction.user.id });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'panel'));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      if (customId === 'admin:verification:channel') saveConfig(interaction.guild, { verificationChannelId: value });
      if (customId === 'admin:verification:logChannel') saveConfig(interaction.guild, { logChannelId: value });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'roles'));
    }

    if (interaction.isRoleSelectMenu?.()) {
      if (customId === 'admin:verification:verifiedRoles') saveConfig(interaction.guild, { verifiedRoleIds: cleanArray(interaction.values) });
      if (customId === 'admin:verification:pendingRoles') saveConfig(interaction.guild, { pendingRoleIds: cleanArray(interaction.values) });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'roles'));
    }

    const toggleMatch = customId.match(/^admin:verification:toggle:([a-zA-Z0-9_]+)$/);
    if (toggleMatch) {
      const key = toggleMatch[1];
      saveConfig(interaction.guild, (config) => ({ ...config, [key]: !Boolean(config[key]) }));
      const page = ['waitForDiscordScreening', 'skipScreeningIfUnavailable', 'logScreeningCompletion', 'usePendingRoles', 'assignPendingRoles', 'requirePendingRole', 'removePendingRoles'].includes(key)
        ? 'workflow'
        : ['blockBots', 'allowStaffBypass', 'allowReverification'].includes(key)
          ? 'requirements'
          : 'messages';
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, page));
    }

    if (customId === 'admin:verification:enable' || customId === 'admin:verification:disable') {
      saveConfig(interaction.guild, { enabled: customId.endsWith(':enable') });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'overview'));
    }

    if (customId === 'admin:verification:resetMessages') {
      verificationManager.updateVerificationMessages(interaction.guild.id, verificationStore.defaultMessages(), { actorId: interaction.user.id });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'messages'));
    }

    if (customId === 'admin:verification:resetTemplate') {
      verificationManager.updatePanelTemplate(interaction.guild.id, verificationStore.defaultPanelTemplate(), { actorId: interaction.user.id });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'panel'));
    }

    if (customId === 'admin:verification:resetAll') {
      await interaction.deferUpdate();
      resetConfig(interaction.guild);
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'overview'));
    }

    if (customId === 'admin:verification:export') {
      await interaction.reply({ content: '📤 Verification configuration export.', files: [exportAttachment(interaction.guild.id)], flags: 64 });
      return true;
    }

    if (customId === 'admin:verification:preview') {
      const preview = { panelId: 'preview', ...panelTemplate(interaction.guild.id) };
      await interaction.reply({ embeds: [verificationManager.buildVerificationEmbed(preview)], components: verificationManager.buildVerificationRows(preview), flags: 64 });
      return true;
    }

    if (customId === 'admin:verification:deploy' || customId === 'admin:verification:redeploy') {
      await interaction.deferUpdate();
      await deployLatestOrNew(interaction, customId.endsWith(':redeploy'));
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'panel'));
    }

    if (customId === 'admin:verification:deleteLatest') {
      await interaction.deferUpdate();
      const latest = latestPanel(interaction.guild.id);
      if (!latest) throw new Error('No verification panel exists yet.');
      await verificationManager.deleteVerificationPanel(interaction.guild, latest.panelId, { actorId: interaction.user.id });
      return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'panel'));
    }

    if (customId === 'admin:verification:statusRefresh') return safeUpdate(interaction, buildVerificationAdminPanel(interaction.guild, displayName, 'status'));

    if (customId === 'admin:verification:test') {
      const report = await verificationManager.buildHealthReport(interaction.guild);
      await replyEphemeral(interaction, report.warnings.length
        ? `⚠️ Setup issues:\n${report.warnings.map((warning) => `• ${warning}`).join('\n')}`
        : '✅ Verification setup looks healthy.');
      return true;
    }

    return false;
  } catch (error) {
    const payload = { content: `❌ Verification setup failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildVerificationAdminPanel,
  handleVerificationAdminInteraction,
};
