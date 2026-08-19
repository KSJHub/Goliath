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
  PermissionFlagsBits,
} = require('discord.js');

const guildManager = require('../../core/guild/guildManager');
const verificationManager = require('./verificationManager');
const verificationStore = require('./verificationStore');

const NAV_PAGES = ['overview', 'workflow', 'roles', 'requirements', 'messages', 'panel'];
const PAGES = [
  ...NAV_PAGES,
  'settings',
  'status',
  'variables',
  'timing',
  'saved_panels',
  'button_style',
];
const PANEL_LIMIT = 25;
const NAV_HISTORY_LIMIT = 20;
const NAV_HISTORY = new Map();

const PAGE_TITLES = new Map([
  ['✅ Verification · Overview', 'overview'],
  ['🔀 Verification · Workflow', 'workflow'],
  ['🕒 Verification · Assignment Timing', 'timing'],
  ['🎭 Verification · Roles & Channels', 'roles'],
  ['🔒 Verification · Requirements', 'requirements'],
  ['💬 Verification · Messages', 'messages'],
  ['🧩 Verification · Variables', 'variables'],
  ['📚 Verification · Saved Panels', 'saved_panels'],
  ['🎨 Verification · Button Style', 'button_style'],
  ['🎨 Verification · Panel Builder', 'panel'],
  ['⚙️ Verification · Settings', 'settings'],
  ['🩺 Verification · Health', 'status'],
]);

const WORKFLOW_TOGGLES = new Set([
  'waitForDiscordScreening',
  'skipScreeningIfUnavailable',
  'logScreeningCompletion',
  'usePendingRoles',
  'assignPendingRoles',
  'requirePendingRole',
  'removePendingRoles',
]);

const REQUIREMENT_TOGGLES = new Set([
  'blockBots',
  'allowStaffBypass',
  'allowReverification',
]);

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

function button(customId, label, style = ButtonStyle.Primary, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(Boolean(disabled));
}

function toggleButton(customId, label, enabled) {
  return button(
    customId,
    `${enabled ? '🟢' : '🔴'} ${label} ${enabled ? 'ON' : 'OFF'}`,
    enabled ? ButtonStyle.Success : ButtonStyle.Danger
  );
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName
    || interaction.user?.displayName
    || interaction.user?.username
    || 'Unknown User';
}

function cleanArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(Boolean))]
    : [];
}

function getConfig(guildId) {
  const section = verificationManager.getVerificationStatus(guildId);
  return {
    enabled: guildManager.isModuleEnabled(guildId, 'verification'),
    ...section.settings,
  };
}

function saveConfig(guild, updater) {
  const current = verificationManager.getVerificationStatus(guild.id);
  const currentSettings = { ...(current.settings || {}) };
  const input = typeof updater === 'function'
    ? updater(currentSettings)
    : { ...(updater || {}) };
  const next = verificationStore.normalizeSettings({
    ...currentSettings,
    ...input,
  });

  verificationManager.configureVerification(
    guild.id,
    { settings: next },
    { action: 'verification_admin_config_sync' }
  );

  return getConfig(guild.id);
}

function resetConfig(guild) {
  verificationStore.saveVerificationSection(
    guild.id,
    verificationStore.defaultVerificationSection(),
    { action: 'verification_admin_reset' }
  );
}

function yesNo(value) {
  return value ? 'Yes ✅' : 'No ❌';
}

function formatChannel(id) {
  return id ? `<#${id}>` : '`Not set`';
}

function formatDate(value) {
  const time = value ? Math.floor(new Date(value).getTime() / 1000) : 0;
  return Number.isFinite(time) && time > 0
    ? `<t:${time}:f>`
    : '`Unknown`';
}

function formatRoles(guild, ids = []) {
  if (!Array.isArray(ids) || !ids.length) return 'None';

  return ids.map((id) => {
    const role = guild.roles.cache.get(id);
    return role ? `<@&${role.id}> (${role.name})` : `Unknown (${id})`;
  }).join(', ');
}

function formatTiming(value) {
  if (value === 'on_join') return 'On Join';
  if (value === 'manual') return 'Manual Only';
  return 'After Discord Screening';
}

function panelTemplate(guildId) {
  const section = verificationStore.getVerificationSection(guildId);
  return section.panelTemplate || verificationStore.defaultPanelTemplate();
}

function getSavedPanelsFromSection(section) {
  return Object.values(section.panels || {}).sort((a, b) => (
    new Date(b.updatedAt || b.createdAt || 0)
    - new Date(a.updatedAt || a.createdAt || 0)
  ));
}

function navigationKey(interaction) {
  return `${interaction.guildId || interaction.guild?.id || 'unknown'}:${interaction.user?.id || 'unknown'}`;
}

function currentPageFromInteraction(interaction) {
  const title = interaction.message?.embeds?.[0]?.title;
  return PAGE_TITLES.get(title) || null;
}

function navigationStack(interaction) {
  const key = navigationKey(interaction);
  const existing = NAV_HISTORY.get(key);
  if (Array.isArray(existing)) return existing;
  const stack = [];
  NAV_HISTORY.set(key, stack);
  return stack;
}

function rememberCurrentPage(interaction, targetPage) {
  const currentPage = currentPageFromInteraction(interaction);
  if (!currentPage || currentPage === targetPage) return;

  const stack = navigationStack(interaction);
  if (stack[stack.length - 1] !== currentPage) stack.push(currentPage);
  if (stack.length > NAV_HISTORY_LIMIT) {
    stack.splice(0, stack.length - NAV_HISTORY_LIMIT);
  }
}

function previousVisitedPage(interaction) {
  const stack = navigationStack(interaction);
  return stack.pop() || 'overview';
}

function nextPageTarget(page) {
  const index = NAV_PAGES.indexOf(page);
  return index >= 0 && index < NAV_PAGES.length - 1
    ? NAV_PAGES[index + 1]
    : 'overview';
}

function workflowNavRow(page, middle = null) {
  if (page === 'overview') {
    return row(
      button('admin:modules', '⬅️ Back', ButtonStyle.Secondary),
      button('admin:verification:page:settings', '⚙️ Settings', ButtonStyle.Secondary)
    );
  }

  return row(
    button('admin:verification:back', '⬅️ Back', ButtonStyle.Secondary),
    button('admin:verification:page:settings', '⚙️ Settings', ButtonStyle.Secondary),
    middle,
    button(`admin:verification:page:${nextPageTarget(page)}`, 'Next ➡️', ButtonStyle.Secondary)
  );
}

function backRow() {
  return row(button('admin:verification:back', '⬅️ Back', ButtonStyle.Secondary));
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
  const section = verificationManager.getVerificationStatus(guild.id);
  const config = {
    enabled: guildManager.isModuleEnabled(guild.id, 'verification'),
    ...section.settings,
  };
  const panels = Object.values(section.panels || {});

  return {
    embeds: [baseEmbed(
      '✅ Verification · Overview',
      [
        'Manage the complete verification flow from one Discord panel.',
        '',
        `**Status:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**Health:** ${verificationManager.hasDiscordScreening(guild) ? 'Discord Screening detected ✅' : 'Discord Screening not configured'}`,
        `**Verification Channel:** ${formatChannel(config.verificationChannelId)}`,
        `**Verified Roles:** ${formatRoles(guild, config.verifiedRoleIds)}`,
        `**Pending Roles:** ${formatRoles(guild, config.pendingRoleIds)}`,
        '',
        `**Saved Panels:** \`${panels.length}\``,
        `**Verified Members:** \`${section.analytics?.verified || 0}\``,
        `**Failed Attempts:** \`${section.analytics?.failed || 0}\``,
      ].join('\n'),
      memberDisplayName,
      config.enabled ? 0x57f287 : 0x5865f2
    )],
    components: [
      row(
        button('admin:verification:page:workflow', '🔀 Workflow'),
        button('admin:verification:page:roles', '🎭 Roles'),
        button('admin:verification:page:requirements', '🔒 Requirements')
      ),
      row(
        button('admin:verification:page:messages', '💬 Messages'),
        button('admin:verification:page:panel', '🎨 Panels')
      ),
      workflowNavRow('overview'),
    ],
  };
}

function buildWorkflowPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);

  return {
    embeds: [baseEmbed(
      '🔀 Verification · Workflow',
      [
        `**Discord Screening Detected:** ${verificationManager.hasDiscordScreening(guild) ? 'Yes ✅' : 'No'}`,
        `**Wait for Screening:** ${yesNo(config.waitForDiscordScreening)}`,
        `**Skip if Unavailable:** ${yesNo(config.skipScreeningIfUnavailable)}`,
        `**Log Screening Completion:** ${yesNo(config.logScreeningCompletion)}`,
        '',
        `**Use Pending Roles:** ${yesNo(config.usePendingRoles)}`,
        `**Assign Pending Roles:** ${yesNo(config.assignPendingRoles)}`,
        `**Assignment Timing:** ${formatTiming(config.pendingRoleTiming)}`,
        `**Require Pending Role:** ${yesNo(config.requirePendingRole)}`,
        `**Remove Pending Roles:** ${yesNo(config.removePendingRoles)}`,
        '',
        'Toggle a setting below. Use Timing to change when pending roles are assigned.',
      ].join('\n'),
      memberDisplayName
    )],
    components: [
      row(
        toggleButton('admin:verification:toggle:waitForDiscordScreening', 'Wait', config.waitForDiscordScreening),
        toggleButton('admin:verification:toggle:skipScreeningIfUnavailable', 'Skip Missing', config.skipScreeningIfUnavailable),
        toggleButton('admin:verification:toggle:logScreeningCompletion', 'Log', config.logScreeningCompletion)
      ),
      row(
        toggleButton('admin:verification:toggle:usePendingRoles', 'Pending', config.usePendingRoles),
        toggleButton('admin:verification:toggle:assignPendingRoles', 'Auto Assign', config.assignPendingRoles),
        toggleButton('admin:verification:toggle:requirePendingRole', 'Require', config.requirePendingRole),
        toggleButton('admin:verification:toggle:removePendingRoles', 'Remove', config.removePendingRoles),
        button('admin:verification:page:timing', '🕒 Timing', ButtonStyle.Secondary)
      ),
      workflowNavRow('workflow'),
    ],
  };
}

function buildTimingPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);

  return {
    embeds: [baseEmbed(
      '🕒 Verification · Assignment Timing',
      [
        `**Current:** ${formatTiming(config.pendingRoleTiming)}`,
        '',
        '**On Join** — assign pending roles immediately when a member joins.',
        '**After Discord Screening** — wait until Discord screening is complete.',
        '**Manual Only** — never assign pending roles automatically.',
      ].join('\n'),
      memberDisplayName
    )],
    components: [
      row(
        button('admin:verification:timing:on_join', '👋 On Join', config.pendingRoleTiming === 'on_join' ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:verification:timing:after_screening', '🛡️ After Screening', config.pendingRoleTiming === 'after_screening' ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('admin:verification:timing:manual', '✋ Manual Only', config.pendingRoleTiming === 'manual' ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
      backRow(),
    ],
  };
}

function buildRolesPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);

  return {
    embeds: [baseEmbed(
      '🎭 Verification · Roles & Channels',
      [
        `📍 **Verification Channel:** ${formatChannel(config.verificationChannelId)}`,
        `📝 **Log Channel:** ${formatChannel(config.logChannelId)}`,
        `🛡️ **Verified Roles:** ${formatRoles(guild, config.verifiedRoleIds)}`,
        `⏳ **Pending Roles:** ${formatRoles(guild, config.pendingRoleIds)}`,
        '',
        'Choose each channel or role below. Goliath must be above every role it needs to add or remove.',
      ].join('\n'),
      memberDisplayName
    )],
    components: [
      row(
        new ChannelSelectMenuBuilder()
          .setCustomId('admin:verification:channel')
          .setPlaceholder('📍 Verification channel')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(0)
          .setMaxValues(1)
      ),
      row(
        new ChannelSelectMenuBuilder()
          .setCustomId('admin:verification:logChannel')
          .setPlaceholder('📝 Optional log channel')
          .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(0)
          .setMaxValues(1)
      ),
      row(
        new RoleSelectMenuBuilder()
          .setCustomId('admin:verification:verifiedRoles')
          .setPlaceholder('🛡️ Verified role(s)')
          .setMinValues(0)
          .setMaxValues(10)
      ),
      row(
        new RoleSelectMenuBuilder()
          .setCustomId('admin:verification:pendingRoles')
          .setPlaceholder('⏳ Optional pending role(s)')
          .setMinValues(0)
          .setMaxValues(10)
      ),
      workflowNavRow('roles'),
    ],
  };
}

function buildRequirementsPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);

  return {
    embeds: [baseEmbed(
      '🔒 Verification · Requirements',
      [
        `**Block Bots:** ${yesNo(config.blockBots)}`,
        `**Management Bypass:** ${yesNo(config.allowStaffBypass)}`,
        `**Reverification:** ${yesNo(config.allowReverification)}`,
        `**Minimum Account Age:** \`${config.minimumAccountAgeDays}\` day(s)`,
        `**Minimum Server Time:** \`${config.minimumMembershipAgeMinutes}\` minute(s)`,
        `**Attempt Cooldown:** \`${config.attemptCooldownSeconds}\` second(s)`,
        `**Maximum Failed Attempts:** \`${config.maximumFailedAttempts || 'Unlimited'}\``,
        '',
        'A value of 0 disables that numeric requirement.',
      ].join('\n'),
      memberDisplayName
    )],
    components: [
      row(
        toggleButton('admin:verification:toggle:blockBots', 'Bots', config.blockBots),
        toggleButton('admin:verification:toggle:allowStaffBypass', 'Bypass', config.allowStaffBypass),
        toggleButton('admin:verification:toggle:allowReverification', 'Reverify', config.allowReverification)
      ),
      workflowNavRow(
        'requirements',
        button('admin:verification:editRequirements', '✏️ Edit Limits', ButtonStyle.Primary)
      ),
    ],
  };
}

function buildMessagesPage(guild, memberDisplayName) {
  const section = verificationStore.getVerificationSection(guild.id);
  const config = {
    enabled: guildManager.isModuleEnabled(guild.id, 'verification'),
    ...section.settings,
  };
  const messages = section.messages;

  return {
    embeds: [baseEmbed(
      '💬 Verification · Messages',
      [
        `**DM on Verification:** ${yesNo(config.dmOnVerify)}`,
        `**DM on Pending Role:** ${yesNo(config.dmOnPendingRole)}`,
        `**Log Success:** ${yesNo(config.logSuccess)}`,
        `**Log Failure:** ${yesNo(config.logFailure)}`,
        '',
        `**Success:** ${messages.success}`,
        `**Verified:** ${messages.alreadyVerified}`,
        `**Screening Required:** ${messages.screeningRequired}`,
        `**Pending Role Required:** ${messages.pendingRoleRequired}`,
        `**Success DM:** ${messages.dmSuccess}`,
        '',
        '💡 Use **Variables** below to view every supported placeholder.',
      ].join('\n').slice(0, 4096),
      memberDisplayName
    )],
    components: [
      row(
        toggleButton('admin:verification:toggle:dmOnVerify', 'Success DM', config.dmOnVerify),
        toggleButton('admin:verification:toggle:dmOnPendingRole', 'Pending DM', config.dmOnPendingRole),
        toggleButton('admin:verification:toggle:logSuccess', 'Success Log', config.logSuccess)
      ),
      row(
        toggleButton('admin:verification:toggle:logFailure', 'Failure Log', config.logFailure),
        button('admin:verification:editMessagesCore', '✏️ Core'),
        button('admin:verification:editMessagesRules', '📋 Requirements')
      ),
      workflowNavRow(
        'messages',
        button('admin:verification:page:variables', '🧩 Variables', ButtonStyle.Secondary)
      ),
    ],
  };
}

function variableGroups() {
  const helpers = Array.isArray(verificationManager.DEFAULT_HELPERS)
    ? verificationManager.DEFAULT_HELPERS
    : [];
  const groups = {
    Member: [],
    Server: [],
    Dates: [],
    Styling: [],
    Other: [],
  };

  for (const helper of helpers) {
    const value = String(helper);
    if (/user|account|membership/i.test(value)) groups.Member.push(value);
    else if (/guild|server|memberCount/i.test(value)) groups.Server.push(value);
    else if (/At}|timestamp|joined|created|left/i.test(value)) groups.Dates.push(value);
    else if (/Emoji|Color/i.test(value)) groups.Styling.push(value);
    else groups.Other.push(value);
  }

  return groups;
}

function buildVariablesPage(memberDisplayName) {
  const lines = [
    'Use these placeholders in supported verification messages and embed fields.',
    '',
  ];

  for (const [name, helpers] of Object.entries(variableGroups())) {
    if (!helpers.length) continue;
    lines.push(`**${name}**`);
    lines.push(helpers.map((helper) => `\`${helper}\``).join(' · '));
    lines.push('');
  }

  return {
    embeds: [baseEmbed(
      '🧩 Verification · Variables',
      lines.join('\n').slice(0, 4096),
      memberDisplayName
    )],
    components: [backRow()],
  };
}

function savedPanelMenu(guild, panels, activePanelId, selectedPanelId = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('admin:verification:savedPanel')
    .setPlaceholder(panels.length ? '📚 Choose a saved panel' : 'No saved panels yet')
    .setDisabled(!panels.length);

  if (!panels.length) {
    menu.addOptions({
      label: 'No saved panels',
      value: 'none',
      description: 'Deploy a panel to create the first saved record',
    });
    return menu;
  }

  menu.addOptions(panels.slice(0, PANEL_LIMIT).map((panel) => ({
    label: `${panel.panelId}${activePanelId === panel.panelId ? ' · ACTIVE' : ''}`.slice(0, 100),
    value: panel.panelId,
    description: `${panel.channelId ? `#${guild.channels.cache.get(panel.channelId)?.name || panel.channelId}` : 'No channel'} · ${panel.messageId ? 'message saved' : 'no message'}`.slice(0, 100),
    default: selectedPanelId === panel.panelId,
  })));
  return menu;
}

function buildSavedPanelsPage(guild, memberDisplayName, selectedPanelId = null) {
  const section = verificationStore.getVerificationSection(guild.id);
  const panels = getSavedPanelsFromSection(section);
  const selected = selectedPanelId ? section.panels?.[selectedPanelId] : null;
  const description = selected
    ? [
      `**Panel:** \`${selected.panelId}\``,
      `**Status:** ${section.activePanelId === selected.panelId ? 'Active ✅' : 'Inactive'}`,
      `**Channel:** ${formatChannel(selected.channelId)}`,
      `**Message ID:** ${selected.messageId ? `\`${selected.messageId}\`` : '`Missing`'}`,
      `**Created:** ${formatDate(selected.createdAt)}`,
      `**Updated:** ${formatDate(selected.updatedAt)}`,
      '',
      'Choose a management action below.',
    ].join('\n')
    : panels.length
      ? `Choose one of the \`${panels.length}\` saved panels below to manage it.`
      : 'No verification panels have been saved yet. Deploy the current design to create one.';

  return {
    embeds: [baseEmbed(
      '📚 Verification · Saved Panels',
      description,
      memberDisplayName
    )],
    components: [
      row(savedPanelMenu(guild, panels, section.activePanelId, selected?.panelId)),
      ...(selected ? [
        row(
          button(`admin:verification:saved:open:${selected.panelId}`, '📂 Open', ButtonStyle.Primary),
          button(`admin:verification:saved:deploy:${selected.panelId}`, '🚀 Deploy', ButtonStyle.Success),
          button(`admin:verification:saved:update:${selected.panelId}`, '📤 Update', ButtonStyle.Primary)
        ),
        row(
          button(`admin:verification:saved:delete:${selected.panelId}`, '🗑️ Delete', ButtonStyle.Danger)
        ),
      ] : []),
      backRow(),
    ],
  };
}

function buildButtonStylePage(guild, memberDisplayName) {
  const current = panelTemplate(guild.id);
  const styles = [
    ['success', '✅ Success', ButtonStyle.Success],
    ['primary', '🔵 Primary', ButtonStyle.Primary],
    ['secondary', '⚪ Secondary', ButtonStyle.Secondary],
    ['danger', '🔴 Danger', ButtonStyle.Danger],
  ];

  return {
    embeds: [baseEmbed(
      '🎨 Verification · Button Style',
      `**Current style:** \`${current.buttonStyle}\`\n\nChoose the style used by the public verification button.`,
      memberDisplayName
    )],
    components: [
      row(...styles.map(([value, label, style]) => button(
        `admin:verification:style:${value}`,
        label,
        current.buttonStyle === value ? ButtonStyle.Success : style
      ))),
      backRow(),
    ],
  };
}

function buildPanelPage(guild, memberDisplayName, selectedPanelId = null) {
  const section = verificationStore.getVerificationSection(guild.id);
  const panels = getSavedPanelsFromSection(section);
  const selected = (
    selectedPanelId && section.panels?.[selectedPanelId]
  ) || (
    section.activePanelId && section.panels?.[section.activePanelId]
  ) || panels[0] || null;
  const current = section.panelTemplate || verificationStore.defaultPanelTemplate();
  const preview = { panelId: 'preview', ...current };
  const active = selected && section.activePanelId === selected.panelId;
  const details = selected
    ? [
      '',
      '**Selected Saved Panel**',
      `**Panel ID:** \`${selected.panelId}\``,
      `**Status:** ${active ? 'Active ✅' : 'Inactive'}`,
      `**Channel:** ${formatChannel(selected.channelId)}`,
      `**Message ID:** ${selected.messageId ? `\`${selected.messageId}\`` : '`Missing`'}`,
      `**Created:** ${formatDate(selected.createdAt)}`,
      `**Updated:** ${formatDate(selected.updatedAt)}`,
    ]
    : ['', '**Selected Saved Panel:** `None`'];

  return {
    embeds: [
      baseEmbed(
        '🎨 Verification · Panel Builder',
        [
          `**Title:** ${current.title}`,
          `**Button:** ${current.buttonEmoji ? `${current.buttonEmoji} ` : ''}${current.buttonLabel} · \`${current.buttonStyle}\``,
          `**Colour:** \`${current.color}\``,
          `**Stored Panels:** \`${panels.length}\``,
          `**Active Panel:** ${section.activePanelId ? `\`${section.activePanelId}\`` : '`None`'}`,
          ...details,
        ].join('\n'),
        memberDisplayName,
        current.color || 0x57f287
      ),
      verificationManager.buildVerificationEmbed(preview, guild),
    ],
    components: [
      row(
        button('admin:verification:editEmbed', '🎨 Edit Embed'),
        button('admin:verification:editButton', '🔘 Edit Button'),
        button('admin:verification:page:button_style', '🎨 Button Style', ButtonStyle.Secondary),
        button('admin:verification:preview', '👁️ Preview', ButtonStyle.Secondary)
      ),
      row(
        button('admin:verification:deploy', '🚀 Deploy', ButtonStyle.Success),
        button(`admin:verification:redeploySelected:${selected?.panelId || 'none'}`, '♻️ Redeploy', ButtonStyle.Success, !selected),
        button(`admin:verification:updateSelected:${selected?.panelId || 'none'}`, '📝 Update', ButtonStyle.Primary, !selected)
      ),
      row(
        button('admin:verification:page:saved_panels', '📚 Saved Panels', ButtonStyle.Secondary)
      ),
      row(
        button(`admin:verification:deleteSelected:${selected?.panelId || 'none'}`, '🗑️ Delete', ButtonStyle.Danger, !selected),
        button('admin:verification:resetTemplate', '🎨 Reset Design', ButtonStyle.Danger)
      ),
      workflowNavRow(
        'panel',
        button('admin:verification:page:variables', '🧩 Variables', ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildSettingsPage(guild, memberDisplayName) {
  const config = getConfig(guild.id);

  return {
    embeds: [baseEmbed(
      '⚙️ Verification · Settings',
      [
        `**Module:** ${config.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        '',
        'Module controls, health checks, exports and reset tools are grouped here.',
      ].join('\n'),
      memberDisplayName,
      config.enabled ? 0x57f287 : 0x5865f2
    )],
    components: [
      row(
        button(
          config.enabled ? 'admin:verification:disable' : 'admin:verification:enable',
          config.enabled ? '🔴 Disable' : '🟢 Enable',
          config.enabled ? ButtonStyle.Danger : ButtonStyle.Success
        ),
        button('admin:verification:page:status', '🩺 Health', ButtonStyle.Secondary),
        button('admin:verification:export', '📤 Export', ButtonStyle.Secondary)
      ),
      row(
        button('admin:verification:resetMessages', '🗑️ Reset Messages', ButtonStyle.Danger),
        button('admin:verification:resetAll', '🗑️ Reset Verification', ButtonStyle.Danger)
      ),
      backRow(),
    ],
  };
}

async function buildStatusPage(guild, memberDisplayName) {
  const report = await verificationManager.buildHealthReport(guild);

  return {
    embeds: [baseEmbed(
      '🩺 Verification · Health',
      [
        `**Overall:** ${report.warnings.length ? 'Needs attention ⚠️' : 'Healthy ✅'}`,
        `**Discord Screening:** ${report.screeningEnabled ? 'Detected ✅' : 'Not configured'}`,
        `**Verified Roles:** \`${report.verifiedRoleCount}\``,
        `**Pending Roles:** \`${report.pendingRoleCount}\``,
        `**Log Channel:** ${report.hasLogChannel ? 'Configured ✅' : 'Optional / not configured'}`,
        '',
        '**Warnings**',
        report.warnings.length
          ? report.warnings.map((warning) => `• ${warning}`).join('\n')
          : 'None ✅',
        '',
        '**Panels**',
        report.panels.length
          ? report.panels.map((panel) => `• \`${panel.panelId}\` — ${panel.status}`).join('\n')
          : '`No panel records.`',
      ].join('\n').slice(0, 4096),
      memberDisplayName,
      report.warnings.length ? 0xfaa61a : 0x57f287
    )],
    components: [
      row(
        button('admin:verification:statusRefresh', '🔄 Refresh', ButtonStyle.Secondary),
        button('admin:verification:redeploy', '🔧 Repair Latest', ButtonStyle.Success),
        button('admin:verification:test', '🧪 Test Setup', ButtonStyle.Primary)
      ),
      backRow(),
    ],
  };
}

async function buildVerificationAdminPanel(
  guild,
  memberDisplayName = 'Unknown User',
  page = 'overview',
  selectedPanelId = null
) {
  const safePage = PAGES.includes(page) ? page : 'overview';

  switch (safePage) {
    case 'workflow': return buildWorkflowPage(guild, memberDisplayName);
    case 'timing': return buildTimingPage(guild, memberDisplayName);
    case 'roles': return buildRolesPage(guild, memberDisplayName);
    case 'requirements': return buildRequirementsPage(guild, memberDisplayName);
    case 'messages': return buildMessagesPage(guild, memberDisplayName);
    case 'variables': return buildVariablesPage(memberDisplayName);
    case 'saved_panels': return buildSavedPanelsPage(guild, memberDisplayName, selectedPanelId);
    case 'button_style': return buildButtonStylePage(guild, memberDisplayName);
    case 'panel': return buildPanelPage(guild, memberDisplayName, selectedPanelId);
    case 'settings': return buildSettingsPage(guild, memberDisplayName);
    case 'status': return buildStatusPage(guild, memberDisplayName);
    default: return buildOverviewPage(guild, memberDisplayName);
  }
}

function textInput(
  customId,
  label,
  value,
  style = TextInputStyle.Short,
  maxLength = 1000,
  required = true
) {
  return new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setMaxLength(maxLength)
    .setRequired(required)
    .setValue(String(value || '').slice(0, maxLength));
}

function buildEmbedModal(guildId) {
  const current = panelTemplate(guildId);
  return new ModalBuilder()
    .setCustomId('admin:verification:embedModal')
    .setTitle('Verification Embed')
    .addComponents(
      row(textInput('title', 'Title', current.title, TextInputStyle.Short, 100)),
      row(textInput('description', 'Description', current.description, TextInputStyle.Paragraph, 1000)),
      row(textInput('color', 'Hex colour', current.color, TextInputStyle.Short, 7)),
      row(textInput('footer', 'Footer', current.footer, TextInputStyle.Short, 200, false)),
      row(textInput('imageUrl', 'Image URL optional', current.imageUrl, TextInputStyle.Short, 500, false))
    );
}

function buildButtonModal(guildId) {
  const current = panelTemplate(guildId);
  return new ModalBuilder()
    .setCustomId('admin:verification:buttonModal')
    .setTitle('Verification Button')
    .addComponents(
      row(textInput('buttonLabel', 'Button label', current.buttonLabel, TextInputStyle.Short, 80)),
      row(textInput('buttonEmoji', 'Button emoji optional', current.buttonEmoji, TextInputStyle.Short, 80, false)),
      row(textInput('thumbnailUrl', 'Thumbnail URL optional', current.thumbnailUrl, TextInputStyle.Short, 500, false))
    );
}

function buildRequirementsModal(guildId) {
  const config = getConfig(guildId);
  return new ModalBuilder()
    .setCustomId('admin:verification:requirementsModal')
    .setTitle('Verification Requirements')
    .addComponents(
      row(textInput('minimumAccountAgeDays', 'Minimum account age in days', config.minimumAccountAgeDays, TextInputStyle.Short, 5)),
      row(textInput('minimumMembershipAgeMinutes', 'Minimum server time in minutes', config.minimumMembershipAgeMinutes, TextInputStyle.Short, 8)),
      row(textInput('attemptCooldownSeconds', 'Attempt cooldown in seconds', config.attemptCooldownSeconds, TextInputStyle.Short, 6)),
      row(textInput('maximumFailedAttempts', 'Maximum failures, 0 = unlimited', config.maximumFailedAttempts, TextInputStyle.Short, 4))
    );
}

function buildCoreMessagesModal(guildId) {
  const messages = verificationStore.getVerificationSection(guildId).messages;
  return new ModalBuilder()
    .setCustomId('admin:verification:messagesCoreModal')
    .setTitle('Core Verification Messages')
    .addComponents(
      row(textInput('success', 'Success message', messages.success, TextInputStyle.Paragraph, 1000)),
      row(textInput('alreadyVerified', 'Already verified', messages.alreadyVerified, TextInputStyle.Paragraph, 1000)),
      row(textInput('unavailable', 'Unavailable message', messages.unavailable, TextInputStyle.Paragraph, 1000)),
      row(textInput('failed', 'Generic failure message', messages.failed, TextInputStyle.Paragraph, 1000)),
      row(textInput('dmSuccess', 'Success DM', messages.dmSuccess, TextInputStyle.Paragraph, 1000))
    );
}

function buildRuleMessagesModal(guildId) {
  const messages = verificationStore.getVerificationSection(guildId).messages;
  return new ModalBuilder()
    .setCustomId('admin:verification:messagesRulesModal')
    .setTitle('Requirement Messages')
    .addComponents(
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
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload).catch(() => null);
  }
  return interaction.reply(payload).catch(() => null);
}

function canAdministerPanels(interaction) {
  return Boolean(
    interaction.guild?.ownerId === interaction.user?.id
    || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

async function fetchPanelMessage(guild, panel) {
  if (!panel?.channelId || !panel?.messageId) return null;
  const channel = guild.channels.cache.get(panel.channelId)
    || await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(panel.messageId).catch(() => null);
}

async function deleteSelectedPanel(interaction, panelId) {
  if (!canAdministerPanels(interaction)) {
    throw new Error('Only the server owner or administrators can delete saved verification panels.');
  }

  const guild = interaction.guild;
  const section = verificationStore.getVerificationSection(guild.id);
  const panel = section.panels?.[panelId];
  if (!panel) throw new Error('The selected verification panel no longer exists.');

  const message = await fetchPanelMessage(guild, panel);
  let messageWarning = null;
  if (message?.deletable) {
    await message.delete().catch((error) => { messageWarning = error.message; });
  } else if (message) {
    messageWarning = 'Discord would not allow Goliath to delete the panel message.';
  }

  const deletingActive = section.activePanelId === panelId;
  verificationStore.updateVerificationSection(
    guild.id,
    (current) => {
      const panels = { ...(current.panels || {}) };
      delete panels[panelId];
      if (deletingActive) {
        const retiredAt = new Date().toISOString();
        for (const [id, existing] of Object.entries(panels)) {
          panels[id] = {
            ...existing,
            enabled: false,
            retiredAt: existing.retiredAt || retiredAt,
          };
        }
      }
      return {
        ...current,
        activePanelId: deletingActive ? null : current.activePanelId,
        panels,
        updatedAt: new Date().toISOString(),
      };
    },
    {
      action: 'verification_admin_delete_selected_panel',
      actorId: interaction.user.id,
      skipConfigRevision: true,
    }
  );
  return messageWarning;
}

async function deployPanel(interaction, panelId = null, useTemplate = false) {
  const guild = interaction.guild;
  const config = getConfig(guild.id);
  const stored = panelId ? verificationStore.getPanel(guild.id, panelId) : null;
  const channelId = stored?.channelId || config.verificationChannelId;
  if (!channelId) throw new Error('Choose a verification channel first.');

  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('Verification channel is not sendable.');

  return verificationManager.deployVerificationPanel(
    channel,
    {
      ...(stored || {}),
      ...(useTemplate ? panelTemplate(guild.id) : {}),
      panelId: stored?.panelId,
      createdBy: interaction.user.id,
    },
    {
      actorId: interaction.user.id,
      action: panelId
        ? 'verification_admin_redeploy_selected'
        : 'verification_admin_deploy',
    }
  );
}

function exportAttachment(guildId) {
  const data = {
    exportedAt: new Date().toISOString(),
    guildId,
    config: getConfig(guildId),
    module: verificationStore.getVerificationSection(guildId),
  };
  return new AttachmentBuilder(
    Buffer.from(JSON.stringify(data, null, 2), 'utf8'),
    { name: `goliath-verification-${guildId}.json` }
  );
}

function getTogglePage(key) {
  if (WORKFLOW_TOGGLES.has(key)) return 'workflow';
  if (REQUIREMENT_TOGGLES.has(key)) return 'requirements';
  return 'messages';
}

async function handleModalInteraction(interaction, customId) {
  if (!interaction.isModalSubmit?.()) return false;

  if (customId === 'admin:verification:embedModal') {
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

  if (customId === 'admin:verification:buttonModal') {
    verificationManager.updatePanelTemplate(interaction.guild.id, {
      buttonLabel: interaction.fields.getTextInputValue('buttonLabel'),
      buttonEmoji: interaction.fields.getTextInputValue('buttonEmoji'),
      thumbnailUrl: interaction.fields.getTextInputValue('thumbnailUrl'),
    }, { actorId: interaction.user.id });
    await interaction.reply({ content: '✅ Verification button updated.', flags: 64 });
    return true;
  }

  if (customId === 'admin:verification:requirementsModal') {
    saveConfig(interaction.guild, {
      minimumAccountAgeDays: interaction.fields.getTextInputValue('minimumAccountAgeDays'),
      minimumMembershipAgeMinutes: interaction.fields.getTextInputValue('minimumMembershipAgeMinutes'),
      attemptCooldownSeconds: interaction.fields.getTextInputValue('attemptCooldownSeconds'),
      maximumFailedAttempts: interaction.fields.getTextInputValue('maximumFailedAttempts'),
    });
    await interaction.reply({ content: '✅ Verification requirements updated.', flags: 64 });
    return true;
  }

  if (customId === 'admin:verification:messagesCoreModal') {
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

  if (customId === 'admin:verification:messagesRulesModal') {
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

  return false;
}

async function handleSelectInteraction(interaction, customId, displayName) {
  if (interaction.isStringSelectMenu?.() && customId === 'admin:verification:savedPanel') {
    const panelId = interaction.values?.[0] || null;
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'saved_panels', panelId)
    );
  }

  if (interaction.isChannelSelectMenu?.()) {
    const value = interaction.values?.[0] || null;
    if (customId === 'admin:verification:channel') {
      saveConfig(interaction.guild, { verificationChannelId: value });
    }
    if (customId === 'admin:verification:logChannel') {
      saveConfig(interaction.guild, { logChannelId: value });
    }
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'roles')
    );
  }

  if (interaction.isRoleSelectMenu?.()) {
    if (customId === 'admin:verification:verifiedRoles') {
      saveConfig(interaction.guild, { verifiedRoleIds: cleanArray(interaction.values) });
    }
    if (customId === 'admin:verification:pendingRoles') {
      saveConfig(interaction.guild, { pendingRoleIds: cleanArray(interaction.values) });
    }
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'roles')
    );
  }

  return false;
}

async function handleSelectedPanelAction(interaction, customId, displayName) {
  const match = customId.match(
    /^admin:verification:(updateSelected|redeploySelected|deleteSelected):(.+)$/
  );
  if (!match) return false;

  const [, action, panelId] = match;
  if (!panelId || panelId === 'none') return false;
  await interaction.deferUpdate();

  if (action === 'deleteSelected') {
    const warning = await deleteSelectedPanel(interaction, panelId);
    if (warning) {
      await interaction.followUp({
        content: `⚠️ Panel record removed from the guild JSON, but the Discord message could not be removed: ${warning}`,
        flags: 64,
      }).catch(() => null);
    }
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'panel')
    );
  }

  if (action === 'updateSelected') await deployPanel(interaction, panelId, true);
  if (action === 'redeploySelected') await deployPanel(interaction, panelId, false);

  return safeUpdate(
    interaction,
    buildVerificationAdminPanel(interaction.guild, displayName, 'panel', panelId)
  );
}

async function handleSavedPanelAction(interaction, customId, displayName) {
  const match = customId.match(
    /^admin:verification:saved:(open|deploy|update|delete):(.+)$/
  );
  if (!match) return false;

  const [, action, panelId] = match;
  if (action === 'open') {
    rememberCurrentPage(interaction, 'panel');
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'panel', panelId)
    );
  }

  await interaction.deferUpdate();
  if (action === 'delete') {
    const warning = await deleteSelectedPanel(interaction, panelId);
    if (warning) {
      await interaction.followUp({
        content: `⚠️ Panel record removed, but the Discord message could not be removed: ${warning}`,
        flags: 64,
      }).catch(() => null);
    }
    return safeUpdate(
      interaction,
      buildVerificationAdminPanel(interaction.guild, displayName, 'saved_panels')
    );
  }

  await deployPanel(interaction, panelId, action === 'update');
  return safeUpdate(
    interaction,
    buildVerificationAdminPanel(interaction.guild, displayName, 'saved_panels', panelId)
  );
}

async function handleVerificationAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:verification')) return false;
  const displayName = getMemberDisplayName(interaction);

  try {
    if (customId === 'admin:verification') {
      NAV_HISTORY.delete(navigationKey(interaction));
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName)
      );
    }

    if (customId === 'admin:verification:back') {
      const targetPage = previousVisitedPage(interaction);
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, targetPage)
      );
    }

    const pageMatch = customId.match(/^admin:verification:page:([a-z_]+)$/);
    if (pageMatch && PAGES.includes(pageMatch[1])) {
      const targetPage = pageMatch[1];
      rememberCurrentPage(interaction, targetPage);
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, targetPage)
      );
    }

    const timingMatch = customId.match(/^admin:verification:timing:(on_join|after_screening|manual)$/);
    if (timingMatch) {
      saveConfig(interaction.guild, { pendingRoleTiming: timingMatch[1] });
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'timing')
      );
    }

    const styleMatch = customId.match(/^admin:verification:style:(success|primary|secondary|danger)$/);
    if (styleMatch) {
      verificationManager.updatePanelTemplate(
        interaction.guild.id,
        { buttonStyle: styleMatch[1] },
        { actorId: interaction.user.id }
      );
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'button_style')
      );
    }

    if (customId === 'admin:verification:editEmbed') {
      await interaction.showModal(buildEmbedModal(interaction.guild.id));
      return true;
    }
    if (customId === 'admin:verification:editButton') {
      await interaction.showModal(buildButtonModal(interaction.guild.id));
      return true;
    }
    if (customId === 'admin:verification:editRequirements') {
      await interaction.showModal(buildRequirementsModal(interaction.guild.id));
      return true;
    }
    if (customId === 'admin:verification:editMessagesCore') {
      await interaction.showModal(buildCoreMessagesModal(interaction.guild.id));
      return true;
    }
    if (customId === 'admin:verification:editMessagesRules') {
      await interaction.showModal(buildRuleMessagesModal(interaction.guild.id));
      return true;
    }

    if (await handleModalInteraction(interaction, customId)) return true;
    if (await handleSelectInteraction(interaction, customId, displayName)) return true;
    if (await handleSavedPanelAction(interaction, customId, displayName)) return true;
    if (await handleSelectedPanelAction(interaction, customId, displayName)) return true;

    const toggleMatch = customId.match(/^admin:verification:toggle:([a-zA-Z0-9_]+)$/);
    if (toggleMatch) {
      const key = toggleMatch[1];
      if (key === 'allowStaffBypass' && !canAdministerPanels(interaction)) {
        return interaction.reply({
          content: 'Only the server owner or administrators can change Management Bypass.',
          flags: 64,
        });
      }
      saveConfig(interaction.guild, (config) => ({
        ...config,
        [key]: !Boolean(config[key]),
      }));
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, getTogglePage(key))
      );
    }

    if (customId === 'admin:verification:enable' || customId === 'admin:verification:disable') {
      guildManager.setModuleEnabled(
        interaction.guild.id,
        'verification',
        customId.endsWith(':enable'),
        { actorId: interaction.user.id, action: 'verification_admin_toggle' }
      );
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'settings')
      );
    }

    if (customId === 'admin:verification:resetMessages') {
      verificationManager.updateVerificationMessages(
        interaction.guild.id,
        verificationStore.defaultMessages(),
        { actorId: interaction.user.id }
      );
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'settings')
      );
    }

    if (customId === 'admin:verification:resetTemplate') {
      verificationManager.updatePanelTemplate(
        interaction.guild.id,
        verificationStore.defaultPanelTemplate(),
        { actorId: interaction.user.id }
      );
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'panel')
      );
    }

    if (customId === 'admin:verification:resetAll') {
      await interaction.deferUpdate();
      resetConfig(interaction.guild);
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'settings')
      );
    }

    if (customId === 'admin:verification:export') {
      await interaction.reply({
        content: '📤 Verification configuration export.',
        files: [exportAttachment(interaction.guild.id)],
        flags: 64,
      });
      return true;
    }

    if (customId === 'admin:verification:preview') {
      const preview = { panelId: 'preview', ...panelTemplate(interaction.guild.id) };
      await interaction.reply({
        embeds: [verificationManager.buildVerificationEmbed(preview, interaction.guild)],
        components: verificationManager.buildVerificationRows(preview, interaction.guild),
        flags: 64,
      });
      return true;
    }

    if (customId === 'admin:verification:deploy') {
      await interaction.deferUpdate();
      await deployPanel(interaction, null, true);
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'panel')
      );
    }

    if (customId === 'admin:verification:redeploy') {
      await interaction.deferUpdate();
      const panels = getSavedPanelsFromSection(
        verificationStore.getVerificationSection(interaction.guild.id)
      );
      const latest = panels[0];
      if (!latest) throw new Error('No saved verification panel exists yet.');
      await deployPanel(interaction, latest.panelId, false);
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'panel', latest.panelId)
      );
    }

    if (customId === 'admin:verification:statusRefresh') {
      return safeUpdate(
        interaction,
        buildVerificationAdminPanel(interaction.guild, displayName, 'status')
      );
    }

    if (customId === 'admin:verification:test') {
      const report = await verificationManager.buildHealthReport(interaction.guild);
      await replyEphemeral(
        interaction,
        report.warnings.length
          ? `⚠️ Setup issues:\n${report.warnings.map((warning) => `• ${warning}`).join('\n')}`
          : '✅ Verification setup looks healthy.'
      );
      return true;
    }

    return false;
  } catch (error) {
    const payload = {
      content: `❌ Verification setup failed: ${error.message}`,
      flags: 64,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
    return true;
  }
}

module.exports = {
  buildVerificationAdminPanel,
  handleVerificationAdminInteraction,
};
