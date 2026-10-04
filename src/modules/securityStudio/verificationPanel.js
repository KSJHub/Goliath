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
  AttachmentBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');
const emojiPayload = require('../utilityStudio/emojis/emojiPayload');

const PAGES = new Set(['overview', 'workflow', 'roles', 'requirements', 'messages', 'panel', 'settings', 'status']);
const WORKFLOW_TOGGLES = new Set(['stagedRoleFlow', 'waitForDiscordScreening', 'skipScreeningIfUnavailable', 'logScreeningCompletion']);
const REQUIREMENT_TOGGLES = new Set(['blockBots', 'allowStaffBypass', 'allowReverification']);
const MESSAGE_TOGGLES = new Set(['dmOnVerify', 'logSuccess', 'logFailure']);

function row(...components) { return new ActionRowBuilder().addComponents(...components.filter(Boolean)); }
function button(id, label, style = ButtonStyle.Primary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));
}
function toggle(id, label, enabled) {
  return button(id, `${enabled ? '🟢' : '🔴'} ${label} ${enabled ? 'ON' : 'OFF'}`, enabled ? ButtonStyle.Success : ButtonStyle.Danger);
}
function cleanArray(value) { return Array.isArray(value) ? [...new Set(value.filter(Boolean))] : []; }
function memberName(i) { return i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User'; }
function yesNo(value) { return value ? 'Yes ✅' : 'No ❌'; }
function formatChannel(id) { return id ? `<#${id}>` : '`Not set`'; }
function formatRoles(guild, ids = []) {
  if (!Array.isArray(ids) || !ids.length) return '`Not set`';
  return ids.map((id) => guild.roles.cache.get(id) ? `<@&${id}>` : `Unknown (${id})`).join(', ');
}
function baseEmbed(title, description, requestedBy, color = 0x5865f2) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: `Requested by ${requestedBy}` }).setTimestamp();
}
function getConfig(guildId) {
  const section = verificationManager.getVerificationStatus(guildId);
  return { enabled: guildManager.isModuleEnabled(guildId, 'verification'), ...(section.settings || {}) };
}
function saveConfig(guild, updater) {
  const current = verificationManager.getVerificationStatus(guild.id);
  const settings = { ...(current.settings || {}) };
  const patch = typeof updater === 'function' ? updater(settings) : { ...(updater || {}) };
  const next = verificationStore.normalizeSettings({ ...settings, ...patch });
  verificationManager.configureVerification(guild.id, { settings: next }, { action: 'verification_admin_config_sync' });
  return getConfig(guild.id);
}
function panelTemplate(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  return section.panelTemplate || verificationStore.defaultPanelTemplate();
}
function nav() {
  return [
    row(
      button('admin:verification:page:overview', '🏠 Overview', ButtonStyle.Secondary),
      button('admin:verification:page:workflow', '🔀 Workflow', ButtonStyle.Secondary),
      button('admin:verification:page:roles', '🎭 Roles', ButtonStyle.Secondary),
      button('admin:verification:page:requirements', '🔒 Requirements', ButtonStyle.Secondary)
    ),
    row(
      button('admin:verification:page:messages', '💬 Messages', ButtonStyle.Secondary),
      button('admin:verification:page:panel', '🧩 Agreement', ButtonStyle.Secondary),
      button('admin:verification:page:settings', '⚙️ Settings', ButtonStyle.Secondary),
      button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)
    ),
  ];
}

function buildOverviewPage(guild, who) {
  const section = verificationManager.getVerificationStatus(guild.id);
  const c = getConfig(guild.id);
  const staged = Boolean(c.stagedRoleFlow);
  const journey = staged
    ? '`Join` → Visitor → `Discord Screening` → Member → `Agree & Verify` → Verified'
    : '`Verification` → Verified';
  return {
    embeds: [baseEmbed('✅ Verification · Overview', [
      'Manage member onboarding, screening and Terms agreement from one place.', '',
      `**Status:** ${c.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Mode:** ${staged ? 'Staged Onboarding ✅' : 'Standard Verification'}`,
      `**Discord Screening:** ${verificationManager.hasDiscordScreening(guild) ? 'Detected ✅' : 'Not detected ⚠️'}`, '',
      `👋 **Arrival / Visitor:** ${formatRoles(guild, c.arrivalRoleIds)}`,
      `🛡️ **Screened / Member:** ${formatRoles(guild, c.pendingRoleIds)}`,
      `💎 **Agreement / Verified:** ${formatRoles(guild, c.verifiedRoleIds)}`, '',
      `**Journey:** ${journey}`, '',
      `**Verified Members:** \`${section.analytics?.verified || 0}\``,
      `**Failed Attempts:** \`${section.analytics?.failed || 0}\``,
    ].join('\n'), who, c.enabled ? 0x57f287 : 0x5865f2)],
    components: nav(),
  };
}

function buildWorkflowPage(guild, who) {
  const c = getConfig(guild.id);
  const staged = Boolean(c.stagedRoleFlow);
  const description = staged ? [
    '**Staged Onboarding:** Enabled ✅', '',
    '`Join` → 👋 Visitor',
    '`Discord Membership Screening complete` → 🛡️ Member',
    '`Agree & Verify` → 💎 Verified', '',
    `**Discord Screening Detected:** ${verificationManager.hasDiscordScreening(guild) ? 'Yes ✅' : 'No ⚠️'}`,
    `**Wait for Screening:** ${yesNo(c.waitForDiscordScreening)}`,
    `**Skip if Screening unavailable:** ${yesNo(c.skipScreeningIfUnavailable)}`,
    `**Log Screening Completion:** ${yesNo(c.logScreeningCompletion)}`, '',
    'In staged mode the old Pending / Auto Assign / Timing / Require / Remove controls are intentionally replaced by the fixed stage transitions above.',
  ] : [
    '**Staged Onboarding:** Disabled ❌', '',
    'Enable staged onboarding to use the Visitor → Member → Verified journey.',
    'Standard verification remains available for guilds that only need a final Verified role.',
  ];
  return {
    embeds: [baseEmbed('🔀 Verification · Workflow', description.join('\n'), who)],
    components: [
      row(
        toggle('admin:verification:toggle:stagedRoleFlow', 'Staged Onboarding', staged),
        toggle('admin:verification:toggle:waitForDiscordScreening', 'Wait for Screening', c.waitForDiscordScreening),
        toggle('admin:verification:toggle:logScreeningCompletion', 'Screening Log', c.logScreeningCompletion)
      ),
      row(toggle('admin:verification:toggle:skipScreeningIfUnavailable', 'Skip Missing Screening', c.skipScreeningIfUnavailable)),
      ...nav(),
    ],
  };
}

function roleSelect(id, placeholder) {
  return row(new RoleSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).setMinValues(0).setMaxValues(10));
}
function buildRolesPage(guild, who) {
  const c = getConfig(guild.id);
  return {
    embeds: [baseEmbed('🎭 Verification · Roles & Channels', [
      `📍 **Verification / Agreement Channel:** ${formatChannel(c.verificationChannelId)}`,
      `📝 **Log Channel:** ${formatChannel(c.logChannelId)}`, '',
      `👋 **Arrival / Visitor Role(s):** ${formatRoles(guild, c.arrivalRoleIds)}`,
      'Assigned automatically when a member joins.', '',
      `🛡️ **Screened / Member Role(s):** ${formatRoles(guild, c.pendingRoleIds)}`,
      'Added when Discord Membership Screening completes; Arrival role(s) are removed.', '',
      `💎 **Agreement / Verified Role(s):** ${formatRoles(guild, c.verifiedRoleIds)}`,
      'Added after Agree & Verify; Screened role(s) are removed.', '',
      'Selectors are clearable. Clearing a selection removes it from Goliath configuration; it does not delete the Discord role. Goliath must be above every managed role.',
    ].join('\n'), who)],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:verification:channel').setPlaceholder('📍 Agreement channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      roleSelect('admin:verification:arrivalRoles', '👋 Arrival / Visitor role(s)'),
      roleSelect('admin:verification:pendingRoles', '🛡️ Screened / Member role(s)'),
      roleSelect('admin:verification:verifiedRoles', '💎 Agreement / Verified role(s)'),
      ...nav(),
    ],
  };
}

function buildRequirementsPage(guild, who) {
  const c = getConfig(guild.id);
  return {
    embeds: [baseEmbed('🔒 Verification · Requirements', [
      `**Block Bots:** ${yesNo(c.blockBots)}`,
      `**Management Bypass:** ${yesNo(c.allowStaffBypass)}`,
      `**Reverification:** ${yesNo(c.allowReverification)}`,
      `**Minimum Account Age:** \`${c.minimumAccountAgeDays || 0}\` day(s)`,
      `**Minimum Server Time:** \`${c.minimumMembershipAgeMinutes || 0}\` minute(s)`,
      `**Attempt Cooldown:** \`${c.attemptCooldownSeconds || 0}\` second(s)`,
      `**Maximum Failed Attempts:** \`${c.maximumFailedAttempts || 'Unlimited'}\``, '',
      'A value of 0 disables that numeric requirement.',
    ].join('\n'), who)],
    components: [
      row(
        toggle('admin:verification:toggle:blockBots', 'Bots', c.blockBots),
        toggle('admin:verification:toggle:allowStaffBypass', 'Bypass', c.allowStaffBypass),
        toggle('admin:verification:toggle:allowReverification', 'Reverify', c.allowReverification),
        button('admin:verification:editRequirements', '✏️ Limits')
      ),
      ...nav(),
    ],
  };
}

function buildMessagesPage(guild, who) {
  const section = verificationStore.getVerificationSection(guild.id);
  const c = getConfig(guild.id);
  const m = section.messages || {};
  return {
    embeds: [baseEmbed('💬 Verification · Messages', [
      `**DM on Verification:** ${yesNo(c.dmOnVerify)}`,
      `**Log Success:** ${yesNo(c.logSuccess)}`,
      `**Log Failure:** ${yesNo(c.logFailure)}`, '',
      `**Success:** ${m.success || '`Default`'}`,
      `**Already Verified:** ${m.alreadyVerified || '`Default`'}`,
      `**Screening Required:** ${m.screeningRequired || '`Default`'}`,
      `**Stage Required:** ${m.pendingRoleRequired || '`Default`'}`,
      `**Success DM:** ${m.dmSuccess || '`Default`'}`,
    ].join('\n').slice(0, 4096), who)],
    components: [
      row(
        toggle('admin:verification:toggle:dmOnVerify', 'Success DM', c.dmOnVerify),
        toggle('admin:verification:toggle:logSuccess', 'Success Log', c.logSuccess),
        toggle('admin:verification:toggle:logFailure', 'Failure Log', c.logFailure)
      ),
      row(button('admin:verification:editMessagesCore', '✏️ Core Messages'), button('admin:verification:editMessagesRules', '📋 Requirement Messages')),
      ...nav(),
    ],
  };
}

function buildPanelPage(guild, who) {
  const section = verificationStore.getVerificationSection(guild.id);
  const current = panelTemplate(guild.id);
  const preview = { panelId: 'preview', ...current };
  return {
    embeds: [
      baseEmbed('🧩 Verification · Agreement', [
        '**Agreement action** is the final step of staged onboarding.', '',
        '**Standalone Panel** remains supported for guilds that want Verification to publish its own embed.',
        '**Existing Goliath Embed** is the target for KSJ Terms: the existing Terms message will carry the Agree & Verify action instead of requiring a second verification embed.', '',
        `**Standalone Title:** ${current.title}`,
        `**Button:** ${current.buttonEmoji ? `${current.buttonEmoji} ` : ''}${current.buttonLabel}`,
        `**Active Standalone Panel:** ${section.activePanelId ? `\`${section.activePanelId}\`` : '`None`'}`,
        `**Agreement Channel:** ${formatChannel(getConfig(guild.id).verificationChannelId)}`,
      ].join('\n'), who),
      verificationManager.buildVerificationEmbed(preview, guild),
    ],
    components: [
      row(
        button('admin:verification:editEmbed', '🎨 Standalone Embed'),
        button('admin:verification:editButton', '🔘 Agree Button'),
        button('admin:verification:preview', '👁️ Preview', ButtonStyle.Secondary)
      ),
      row(button('admin:verification:deploy', '🚀 Deploy Standalone', ButtonStyle.Success)),
      ...nav(),
    ],
  };
}

async function buildStatusPage(guild, who) {
  const report = await verificationManager.buildHealthReport(guild);
  const c = getConfig(guild.id);
  return {
    embeds: [baseEmbed('🩺 Verification · Health', [
      `**Overall:** ${report.warnings.length ? 'Needs attention ⚠️' : 'Healthy ✅'}`,
      `**Staged Onboarding:** ${c.stagedRoleFlow ? 'Enabled ✅' : 'Disabled'}`,
      `**Discord Screening:** ${report.screeningEnabled ? 'Detected ✅' : 'Not configured ⚠️'}`, '',
      `👋 **Arrival Roles:** \`${cleanArray(c.arrivalRoleIds).length}\``,
      `🛡️ **Screened Roles:** \`${cleanArray(c.pendingRoleIds).length}\``,
      `💎 **Verified Roles:** \`${cleanArray(c.verifiedRoleIds).length}\``,
      `📝 **Log Channel:** ${report.hasLogChannel ? 'Configured ✅' : 'Optional / not configured'}`, '',
      '**Warnings**', report.warnings.length ? report.warnings.map((w) => `• ${w}`).join('\n') : 'None ✅',
    ].join('\n').slice(0, 4096), who, report.warnings.length ? 0xfaa61a : 0x57f287)],
    components: [row(button('admin:verification:statusRefresh', '🔄 Refresh', ButtonStyle.Secondary), button('admin:verification:test', '🧪 Test Setup')), ...nav()],
  };
}

function buildSettingsPage(guild, who) {
  const c = getConfig(guild.id);
  return {
    embeds: [baseEmbed('⚙️ Verification · Settings', `**Module:** ${c.enabled ? 'Enabled ✅' : 'Disabled ❌'}\n\nModule controls, health, export and reset tools.`, who, c.enabled ? 0x57f287 : 0x5865f2)],
    components: [
      row(
        button(c.enabled ? 'admin:verification:disable' : 'admin:verification:enable', c.enabled ? '🔴 Disable' : '🟢 Enable', c.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button('admin:verification:page:status', '🩺 Health', ButtonStyle.Secondary),
        button('admin:verification:export', '📤 Export', ButtonStyle.Secondary)
      ),
      row(button('admin:verification:resetMessages', '🗑️ Reset Messages', ButtonStyle.Danger), button('admin:verification:resetAll', '🗑️ Reset Verification', ButtonStyle.Danger)),
      ...nav(),
    ],
  };
}

async function buildVerificationAdminPanel(guild, who = 'Unknown User', page = 'overview') {
  const safe = PAGES.has(page) ? page : 'overview';
  if (safe === 'workflow') return buildWorkflowPage(guild, who);
  if (safe === 'roles') return buildRolesPage(guild, who);
  if (safe === 'requirements') return buildRequirementsPage(guild, who);
  if (safe === 'messages') return buildMessagesPage(guild, who);
  if (safe === 'panel') return buildPanelPage(guild, who);
  if (safe === 'settings') return buildSettingsPage(guild, who);
  if (safe === 'status') return buildStatusPage(guild, who);
  return buildOverviewPage(guild, who);
}

function textInput(id, label, value, style = TextInputStyle.Short, max = 1000, required = true) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setValue(String(value || '').slice(0, max));
}
function embedModal(guildId) {
  const c = panelTemplate(guildId);
  return new ModalBuilder().setCustomId('admin:verification:embedModal').setTitle('Standalone Verification Embed').addComponents(
    row(textInput('title', 'Title', c.title, TextInputStyle.Short, 100)),
    row(textInput('description', 'Description', c.description, TextInputStyle.Paragraph, 1000)),
    row(textInput('color', 'Hex colour', c.color, TextInputStyle.Short, 7)),
    row(textInput('footer', 'Footer', c.footer, TextInputStyle.Short, 200, false)),
    row(textInput('imageUrl', 'Image URL optional', c.imageUrl, TextInputStyle.Short, 500, false))
  );
}
function buttonModal(guildId) {
  const c = panelTemplate(guildId);
  return new ModalBuilder().setCustomId('admin:verification:buttonModal').setTitle('Agree & Verify Button').addComponents(
    row(textInput('buttonLabel', 'Button label', c.buttonLabel || 'Agree & Verify', TextInputStyle.Short, 80)),
    row(textInput('buttonEmoji', 'Button emoji optional', c.buttonEmoji || '✅', TextInputStyle.Short, 80, false))
  );
}
function requirementsModal(guildId) {
  const c = getConfig(guildId);
  return new ModalBuilder().setCustomId('admin:verification:requirementsModal').setTitle('Verification Requirements').addComponents(
    row(textInput('minimumAccountAgeDays', 'Minimum account age in days', c.minimumAccountAgeDays, TextInputStyle.Short, 5)),
    row(textInput('minimumMembershipAgeMinutes', 'Minimum server time in minutes', c.minimumMembershipAgeMinutes, TextInputStyle.Short, 8)),
    row(textInput('attemptCooldownSeconds', 'Attempt cooldown in seconds', c.attemptCooldownSeconds, TextInputStyle.Short, 6)),
    row(textInput('maximumFailedAttempts', 'Maximum failures, 0 = unlimited', c.maximumFailedAttempts, TextInputStyle.Short, 4))
  );
}
function messagesModal(guildId, rules = false) {
  const m = verificationStore.getVerificationSection(guildId).messages || {};
  const modal = new ModalBuilder().setCustomId(rules ? 'admin:verification:messagesRulesModal' : 'admin:verification:messagesCoreModal').setTitle(rules ? 'Requirement Messages' : 'Core Verification Messages');
  return rules ? modal.addComponents(
    row(textInput('screeningRequired', 'Screening required', m.screeningRequired, TextInputStyle.Paragraph, 1000)),
    row(textInput('pendingRoleRequired', 'Screened role required', m.pendingRoleRequired, TextInputStyle.Paragraph, 1000)),
    row(textInput('accountTooNew', 'Account too new', m.accountTooNew, TextInputStyle.Paragraph, 1000)),
    row(textInput('membershipTooNew', 'Membership too new', m.membershipTooNew, TextInputStyle.Paragraph, 1000)),
    row(textInput('cooldown', 'Cooldown', m.cooldown, TextInputStyle.Paragraph, 1000))
  ) : modal.addComponents(
    row(textInput('success', 'Success message', m.success, TextInputStyle.Paragraph, 1000)),
    row(textInput('alreadyVerified', 'Already verified', m.alreadyVerified, TextInputStyle.Paragraph, 1000)),
    row(textInput('unavailable', 'Unavailable', m.unavailable, TextInputStyle.Paragraph, 1000)),
    row(textInput('failed', 'Generic failure', m.failed, TextInputStyle.Paragraph, 1000)),
    row(textInput('dmSuccess', 'Success DM', m.dmSuccess, TextInputStyle.Paragraph, 1000))
  );
}
async function safeUpdate(i, payload) { const p = await payload; if (i.deferred || i.replied) await i.editReply(p); else await i.update(p); return true; }
function canAdmin(i) { return Boolean(i.guild?.ownerId === i.user?.id || i.member?.permissions?.has(PermissionFlagsBits.Administrator)); }
async function deployStandalone(i) {
  const c = getConfig(i.guild.id);
  if (!c.verificationChannelId) throw new Error('Choose an Agreement channel first.');
  const channel = i.guild.channels.cache.get(c.verificationChannelId) || await i.guild.channels.fetch(c.verificationChannelId).catch(() => null);
  if (!channel?.send) throw new Error('Agreement channel is not sendable.');
  return verificationManager.deployVerificationPanel(channel, { ...panelTemplate(i.guild.id), createdBy: i.user.id }, { actorId: i.user.id, action: 'verification_admin_deploy' });
}
function exportAttachment(guildId) {
  return new AttachmentBuilder(Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), guildId, config: getConfig(guildId), module: verificationStore.getVerificationSection(guildId) }, null, 2), 'utf8'), { name: `goliath-verification-${guildId}.json` });
}

async function handleVerificationAdminInteraction(i) {
  const id = String(i.customId || '');
  if (!id.startsWith('admin:verification')) return false;
  const who = memberName(i);
  try {
    if (id === 'admin:verification') return safeUpdate(i, buildVerificationAdminPanel(i.guild, who));
    const page = id.match(/^admin:verification:page:([a-z_]+)$/)?.[1];
    if (page && PAGES.has(page)) return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, page));

    if (i.isChannelSelectMenu?.()) {
      const value = i.values?.[0] || null;
      if (id === 'admin:verification:channel') saveConfig(i.guild, { verificationChannelId: value });
      if (id === 'admin:verification:logChannel') saveConfig(i.guild, { logChannelId: value });
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'roles'));
    }
    if (i.isRoleSelectMenu?.()) {
      const values = cleanArray(i.values);
      if (id === 'admin:verification:arrivalRoles') saveConfig(i.guild, { arrivalRoleIds: values });
      else if (id === 'admin:verification:pendingRoles') saveConfig(i.guild, { pendingRoleIds: values });
      else if (id === 'admin:verification:verifiedRoles') saveConfig(i.guild, { verifiedRoleIds: values });
      else return false;
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'roles'));
    }

    if (i.isModalSubmit?.()) {
      if (id === 'admin:verification:embedModal') {
        verificationManager.updatePanelTemplate(i.guild.id, { title: i.fields.getTextInputValue('title'), description: i.fields.getTextInputValue('description'), color: i.fields.getTextInputValue('color'), footer: i.fields.getTextInputValue('footer'), imageUrl: i.fields.getTextInputValue('imageUrl') }, { actorId: i.user.id });
        await i.reply({ content: '✅ Standalone verification embed updated.', flags: 64 }); return true;
      }
      if (id === 'admin:verification:buttonModal') {
        verificationManager.updatePanelTemplate(i.guild.id, { buttonLabel: i.fields.getTextInputValue('buttonLabel'), buttonEmoji: i.fields.getTextInputValue('buttonEmoji') }, { actorId: i.user.id });
        await i.reply({ content: '✅ Agree & Verify button updated.', flags: 64 }); return true;
      }
      if (id === 'admin:verification:requirementsModal') {
        saveConfig(i.guild, { minimumAccountAgeDays: i.fields.getTextInputValue('minimumAccountAgeDays'), minimumMembershipAgeMinutes: i.fields.getTextInputValue('minimumMembershipAgeMinutes'), attemptCooldownSeconds: i.fields.getTextInputValue('attemptCooldownSeconds'), maximumFailedAttempts: i.fields.getTextInputValue('maximumFailedAttempts') });
        await i.reply({ content: '✅ Requirements updated.', flags: 64 }); return true;
      }
      if (id === 'admin:verification:messagesCoreModal') {
        verificationManager.updateVerificationMessages(i.guild.id, { success: i.fields.getTextInputValue('success'), alreadyVerified: i.fields.getTextInputValue('alreadyVerified'), unavailable: i.fields.getTextInputValue('unavailable'), failed: i.fields.getTextInputValue('failed'), dmSuccess: i.fields.getTextInputValue('dmSuccess') }, { actorId: i.user.id });
        await i.reply({ content: '✅ Core messages updated.', flags: 64 }); return true;
      }
      if (id === 'admin:verification:messagesRulesModal') {
        verificationManager.updateVerificationMessages(i.guild.id, { screeningRequired: i.fields.getTextInputValue('screeningRequired'), pendingRoleRequired: i.fields.getTextInputValue('pendingRoleRequired'), accountTooNew: i.fields.getTextInputValue('accountTooNew'), membershipTooNew: i.fields.getTextInputValue('membershipTooNew'), cooldown: i.fields.getTextInputValue('cooldown') }, { actorId: i.user.id });
        await i.reply({ content: '✅ Requirement messages updated.', flags: 64 }); return true;
      }
    }

    const toggleKey = id.match(/^admin:verification:toggle:([a-zA-Z0-9_]+)$/)?.[1];
    if (toggleKey && (WORKFLOW_TOGGLES.has(toggleKey) || REQUIREMENT_TOGGLES.has(toggleKey) || MESSAGE_TOGGLES.has(toggleKey))) {
      if (toggleKey === 'allowStaffBypass' && !canAdmin(i)) { await i.reply({ content: 'Only the server owner or administrators can change Management Bypass.', flags: 64 }); return true; }
      saveConfig(i.guild, (c) => ({ ...c, [toggleKey]: !Boolean(c[toggleKey]) }));
      const target = WORKFLOW_TOGGLES.has(toggleKey) ? 'workflow' : REQUIREMENT_TOGGLES.has(toggleKey) ? 'requirements' : 'messages';
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, target));
    }

    if (id === 'admin:verification:editEmbed') { await i.showModal(embedModal(i.guild.id)); return true; }
    if (id === 'admin:verification:editButton') { await i.showModal(buttonModal(i.guild.id)); return true; }
    if (id === 'admin:verification:editRequirements') { await i.showModal(requirementsModal(i.guild.id)); return true; }
    if (id === 'admin:verification:editMessagesCore') { await i.showModal(messagesModal(i.guild.id, false)); return true; }
    if (id === 'admin:verification:editMessagesRules') { await i.showModal(messagesModal(i.guild.id, true)); return true; }

    if (id === 'admin:verification:enable' || id === 'admin:verification:disable') {
      guildManager.setModuleEnabled(i.guild.id, 'verification', id.endsWith(':enable'), { actorId: i.user.id, action: 'verification_admin_toggle' });
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'settings'));
    }
    if (id === 'admin:verification:preview') {
      const preview = { panelId: 'preview', ...panelTemplate(i.guild.id) };
      const payload = await emojiPayload.resolveMessagePayload(i.guild.client, i.guild.id, { embeds: [verificationManager.buildVerificationEmbed(preview, i.guild)], components: verificationManager.buildVerificationRows(preview, i.guild) }, 'verification');
      await i.reply({ ...payload, flags: 64 }); return true;
    }
    if (id === 'admin:verification:deploy') {
      await i.deferUpdate(); await deployStandalone(i); return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'panel'));
    }
    if (id === 'admin:verification:statusRefresh') return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'status'));
    if (id === 'admin:verification:test') {
      const report = await verificationManager.buildHealthReport(i.guild);
      await i.reply({ content: report.warnings.length ? `⚠️ Setup issues:\n${report.warnings.map((w) => `• ${w}`).join('\n')}` : '✅ Verification setup looks healthy.', flags: 64 }); return true;
    }
    if (id === 'admin:verification:export') { await i.reply({ content: '📤 Verification configuration export.', files: [exportAttachment(i.guild.id)], flags: 64 }); return true; }
    if (id === 'admin:verification:resetMessages') {
      verificationManager.updateVerificationMessages(i.guild.id, verificationStore.defaultMessages(), { actorId: i.user.id });
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'settings'));
    }
    if (id === 'admin:verification:resetAll') {
      verificationStore.saveVerificationSection(i.guild.id, verificationStore.defaultVerificationSection(), { action: 'verification_admin_reset', actorId: i.user.id });
      return safeUpdate(i, buildVerificationAdminPanel(i.guild, who, 'settings'));
    }
    return false;
  } catch (error) {
    const payload = { content: `❌ Verification setup failed: ${error.message}`, flags: 64 };
    if (i.deferred || i.replied) await i.followUp(payload).catch(() => null); else await i.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { buildVerificationAdminPanel, handleVerificationAdminInteraction };
