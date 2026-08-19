'use strict';

const Discord = require('discord.js');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = Discord;

const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const {
  COLORS,
  EMOJIS,
  baseEmbed,
  createEmbed,
  createPrimaryButton,
  createSecondaryButton,
  createSuccessButton,
  createDangerButton,
} = require('../../../core/ui/embeds');
const {
  getCaseCountForUser,
  getCasesForUser,
  getFilteredCases,
} = require('../../../core/logging/cases/caseStore');
const {
  formatCaseSummary,
  getModerationAnalytics,
  getStatusLabel,
  buildCaseFilterButtons,
  buildCasesPageButtons,
} = require('./cases');
const {
  getWarningCountForUser,
  syncExpiredWarningsToCases,
} = require('./warns');
const {
  canUseModAction,
  getStaffDisplay,
  hasModPermission,
  fetchTarget,
} = require('./permissions');

const DEFAULT_VIEW = 'overview';
const CASES_PER_PAGE = 5;
const ALLOWED_VIEWS = new Set(['overview', 'actions', 'cases', 'tools', 'analytics']);
const DEFAULT_CASES_CONTEXT = Object.freeze({
  view: 'cases',
  actionFilter: 'all',
  statusFilter: 'all',
  page: 0,
});

function canOpenModPanel(interaction) {
  return Boolean(interaction?.guild && interaction?.member && hasModPermission(interaction.member));
}

function noAccessPayload() {
  return { content: '❌ You do not have permission to use the moderation panel.', flags: 64 };
}

function normalizeDashboardContext(context = {}) {
  return {
    view: ALLOWED_VIEWS.has(context.view) ? context.view : DEFAULT_VIEW,
    actionFilter: context.actionFilter || 'all',
    statusFilter: context.statusFilter || 'all',
    page: Number(context.page) || 0,
  };
}

function getEmoji(key, fallback) {
  return EMOJIS?.[key] || fallback;
}

function buildDashboardNav(targetId, activeView = DEFAULT_VIEW) {
  const items = [
    ['overview', 'Overview'],
    ['actions', 'Actions'],
    ['cases', 'Cases'],
    ['tools', 'Tools'],
    ['analytics', 'Analytics'],
  ];

  return [
    new ActionRowBuilder().addComponents(
      items.map(([view, label]) => new ButtonBuilder()
        .setCustomId(`mod_dashboard:${targetId || 'none'}:${view}`)
        .setLabel(label)
        .setStyle(activeView === view ? ButtonStyle.Primary : ButtonStyle.Secondary))
    ),
  ];
}

function buildUserSelectRow() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('mod_user_select')
      .setPlaceholder('👤 Select any server member to moderate')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function buildActionSelect(targetId) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mod_action_select:${targetId || 'none'}`)
        .setPlaceholder('Choose an action')
        .setDisabled(!targetId)
        .addOptions(
          { label: 'Warn', value: 'warn' },
          { label: 'Timeout', value: 'timeout' },
          { label: 'Kick', value: 'kick' },
          { label: 'Ban', value: 'ban' },
          { label: 'Remove Warning', value: 'remove-warning' },
          { label: 'Remove Timeout', value: 'remove-timeout' }
        )
    ),
  ];
}

function buildActionsRows(targetId, member, guild) {
  const id = targetId || 'none';
  const permissions = {
    warn: canUseModAction(member, guild, 'warn'),
    timeout: canUseModAction(member, guild, 'timeout'),
    kick: canUseModAction(member, guild, 'kick'),
    ban: canUseModAction(member, guild, 'ban'),
    removeWarning: canUseModAction(member, guild, 'remove_warning'),
    removeTimeout: canUseModAction(member, guild, 'remove_timeout'),
  };

  return [
    buildUserSelectRow(),
    ...buildActionSelect(targetId),
    new ActionRowBuilder().addComponents(
      createSecondaryButton(`mod_open_warn:${id}`, 'Warn', getEmoji('WARNING', '⚠️'), !targetId || !permissions.warn),
      createSecondaryButton(`mod_open_timeout:${id}`, 'Timeout', getEmoji('TIMEOUT', '⏳'), !targetId || !permissions.timeout),
      createDangerButton(`mod_open_kick:${id}`, 'Kick', getEmoji('KICK', '👢'), !targetId || !permissions.kick),
      createDangerButton(`mod_open_ban:${id}`, 'Ban', getEmoji('BAN', '🔨'), !targetId || !permissions.ban)
    ),
    new ActionRowBuilder().addComponents(
      createSecondaryButton(`mod_remove_warning:${id}`, 'Remove Warning', getEmoji('DELETE', '🗑️'), !targetId || !permissions.removeWarning),
      createSecondaryButton(`mod_remove_timeout:${id}`, 'Remove Timeout', getEmoji('SUCCESS', '✅'), !targetId || !permissions.removeTimeout),
      createSuccessButton(`mod_refresh:${id}:overview`, 'Refresh', getEmoji('REFRESH', '🔄'))
    ),
  ];
}

function buildToolsRows(targetId, member, guild) {
  const id = targetId || 'none';
  const permissions = {
    viewCaseDetail: canUseModAction(member, guild, 'view_case_detail'),
    editCase: canUseModAction(member, guild, 'edit_case'),
    bulkWarn: canUseModAction(member, guild, 'bulk_warn'),
    bulkTimeout: canUseModAction(member, guild, 'bulk_timeout'),
    bulkKick: canUseModAction(member, guild, 'bulk_kick'),
    bulkBan: canUseModAction(member, guild, 'bulk_ban'),
  };

  return [
    buildUserSelectRow(),
    new ActionRowBuilder().addComponents(
      createPrimaryButton('mod_select_user', 'Select User', getEmoji('USER', '👤')),
      createSecondaryButton(`mod_case_detail:${id}`, 'Case Detail', getEmoji('SEARCH', '🔎'), !targetId || !permissions.viewCaseDetail),
      createSecondaryButton(`mod_edit_case:${id}`, 'Edit Case', getEmoji('EDIT', '✏️'), !targetId || !permissions.editCase)
    ),
    new ActionRowBuilder().addComponents(
      createSecondaryButton('mod_bulk_warn', 'Bulk Warn', getEmoji('WARNING', '⚠️'), !permissions.bulkWarn),
      createSecondaryButton('mod_bulk_timeout', 'Bulk Timeout', getEmoji('TIMEOUT', '⏳'), !permissions.bulkTimeout),
      createSecondaryButton('mod_bulk_kick', 'Bulk Kick', getEmoji('KICK', '👢'), !permissions.bulkKick),
      createDangerButton('mod_bulk_ban', 'Bulk Ban', getEmoji('BAN', '🔨'), !permissions.bulkBan)
    ),
  ];
}

function buildOverviewEmbed(guild, moderator, target, stats = {}, staffDisplay = null) {
  return createEmbed({
    title: 'Moderation Command Centre',
    description: target ? `Target: ${target.user}` : 'No target selected.',
    color: COLORS.PRIMARY,
    fields: [
      { name: 'Staff', value: staffDisplay || String(moderator || 'Unknown'), inline: false },
      { name: 'Warnings', value: String(stats.warningCount ?? 0), inline: true },
      { name: 'Cases', value: String(stats.caseCount ?? 0), inline: true },
      { name: 'Latest Case', value: stats.lastCaseSummary || 'No cases found.', inline: false },
    ],
  });
}

function buildActionsEmbed(interaction, target) {
  return baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle('`🔐` Moderation Actions')
    .setDescription(target
      ? [`\`👤\` **Target:** ${target.user}`, `\`🆔\` **User ID:** \`${target.id}\``, `\`🏷️\` **User Tag:** \`${target.user.tag}\``, '', '`⚡` Choose a moderation action below.'].join('\n')
      : ['`⚠️` **No user selected**', '', 'Use the user selector below to choose any member in this server.'].join('\n'));
}

function buildCasesEmbed(target, cases = [], page = 0, totalPages = 1, actionFilter = 'all', statusFilter = 'all') {
  const description = cases.length
    ? cases.map((entry) => `#${entry.caseId} - ${entry.action} - ${getStatusLabel(entry)}\nReason: ${entry.reason || 'No reason provided'}`).join('\n\n')
    : 'No cases found for this user.';

  return createEmbed({
    title: target?.user?.tag ? `Cases - ${target.user.tag}` : 'Cases',
    description,
    color: COLORS.PRIMARY,
    footer: `Action: ${actionFilter} | Status: ${statusFilter} | Page ${page + 1} of ${totalPages}`,
  });
}

function buildToolsEmbed(interaction) {
  return baseEmbed(interaction.client, COLORS.PRIMARY)
    .setTitle('`🧰` Moderation Tools')
    .setDescription(['`⚙️` Utility actions and bulk moderation controls.', '', '`👤` Select a user to inspect cases or edit moderation history.', '`📦` Bulk tools are permission-gated for staff safety.'].join('\n'));
}

function buildAnalyticsEmbed(guild, analytics = {}) {
  return createEmbed({
    title: 'Moderation Analytics',
    description: `Stats for ${guild?.name || 'this server'}`,
    color: COLORS.PRIMARY,
    fields: [
      { name: 'Total Cases', value: String(analytics.totalCases ?? 0), inline: true },
      { name: 'Active', value: String(analytics.activeCases ?? 0), inline: true },
      { name: 'Expired', value: String(analytics.expiredCases ?? 0), inline: true },
      { name: 'Warnings', value: String(analytics.warnCount ?? 0), inline: true },
    ],
  });
}

function buildTargetStats(guildId, target) {
  if (!target) return { warningCount: undefined, caseCount: undefined, lastCaseSummary: null };
  const cases = getCasesForUser(guildId, target.id) || [];
  return {
    warningCount: getWarningCountForUser(guildId, target.id),
    caseCount: getCaseCountForUser(guildId, target.id),
    lastCaseSummary: cases[0] ? formatCaseSummary(cases[0]) : null,
  };
}

function getCasesPageData(guildId, targetId, options = {}) {
  const actionFilter = options.actionFilter || 'all';
  const statusFilter = options.statusFilter || 'all';
  const filters = {};
  if (actionFilter !== 'all') filters.action = actionFilter;
  if (statusFilter !== 'all') filters.status = statusFilter;

  const allCases = getFilteredCases(guildId, targetId, filters) || [];
  const totalPages = Math.max(1, Math.ceil(allCases.length / CASES_PER_PAGE));
  const page = Math.max(0, Math.min(Number(options.page) || 0, totalPages - 1));

  return {
    actionFilter,
    statusFilter,
    page,
    totalPages,
    pageCases: allCases.slice(page * CASES_PER_PAGE, (page + 1) * CASES_PER_PAGE),
  };
}

async function buildDashboardPayload(discord, interaction, target, view = DEFAULT_VIEW, options = {}) {
  await syncExpiredWarningsToCases(interaction.guild.id);
  const safeView = ALLOWED_VIEWS.has(view) ? view : DEFAULT_VIEW;
  const targetId = target?.id || null;
  const stats = buildTargetStats(interaction.guild.id, target);
  const staff = getStaffDisplay(interaction.member, interaction.guild);
  const staffDisplay = `${staff.badge} ${staff.label} • ${interaction.member}`;
  const embeds = [];
  const components = [...buildDashboardNav(targetId, safeView)];

  if (safeView === 'overview') {
    embeds.push(buildOverviewEmbed(interaction.guild, interaction.member, target, stats, staffDisplay));
    components.push(...buildActionsRows(targetId, interaction.member, interaction.guild));
  } else if (safeView === 'actions') {
    embeds.push(buildActionsEmbed(interaction, target));
    components.push(...buildActionsRows(targetId, interaction.member, interaction.guild));
  } else if (safeView === 'cases') {
    if (!target) {
      embeds.push(baseEmbed(interaction.client, COLORS.PRIMARY)
        .setTitle('`📁` Cases')
        .setDescription(['`⚠️` **No user selected**', '', 'Use the user selector below to choose any member first.'].join('\n')));
      components.push(buildUserSelectRow());
    } else {
      const pageData = getCasesPageData(interaction.guild.id, target.id, options);
      embeds.push(buildCasesEmbed(target, pageData.pageCases, pageData.page, pageData.totalPages, pageData.actionFilter, pageData.statusFilter));
      components.push(
        buildUserSelectRow(),
        ...buildCasesPageButtons(target.id, pageData.page, pageData.totalPages, pageData.actionFilter, pageData.statusFilter),
        ...buildCaseFilterButtons(target.id, pageData.actionFilter, pageData.statusFilter, pageData.page)
      );
    }
  } else if (safeView === 'tools') {
    embeds.push(buildToolsEmbed(interaction));
    components.push(...buildToolsRows(targetId, interaction.member, interaction.guild));
  } else if (safeView === 'analytics') {
    embeds.push(buildAnalyticsEmbed(interaction.guild, getModerationAnalytics(interaction.guild.id)));
  }

  return { embeds, components: components.slice(0, 5) };
}

async function renderDashboard(interaction, targetId, view = DEFAULT_VIEW, context = {}) {
  const target = targetId && targetId !== 'none'
    ? await fetchTarget(interaction.guild, targetId)
    : null;

  if (targetId && targetId !== 'none' && !target) {
    return safeReply(interaction, ephemeralError('Could not find the selected user.'));
  }

  await interaction.update(
    await buildDashboardPayload(Discord, interaction, target, view, context)
  );
  return true;
}

async function refreshDashboard(discord, interaction, target, context = {}) {
  const safeContext = normalizeDashboardContext(context);
  const payload = await buildDashboardPayload(discord, interaction, target, safeContext.view, safeContext);

  try {
    if (interaction.message) {
      await interaction.message.edit(payload);
      return true;
    }
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload);
      return true;
    }
    await interaction.reply({ ...payload, flags: 64 });
    return true;
  } catch (error) {
    console.error('❌ Failed to refresh moderation dashboard message:', error);
    return false;
  }
}

async function refreshCasesDashboard(interaction, target) {
  if (!target) return false;
  return refreshDashboard(Discord, interaction, target, DEFAULT_CASES_CONTEXT);
}

async function handleDashboardNavigation(interaction) {
  const id = String(interaction.customId || '');
  if (id === 'mod:overview') return renderDashboard(interaction, 'none', 'overview');

  if (id.startsWith('mod_dashboard:') || id.startsWith('mod_refresh:')) {
    const [, targetId = 'none', view = DEFAULT_VIEW] = id.split(':');
    return renderDashboard(interaction, targetId, view);
  }

  if (id.startsWith('mod_filter_cases:') || id.startsWith('mod_case_page:')) {
    const [, targetId = 'none', actionFilter = 'all', statusFilter = 'all', page = '0'] = id.split(':');
    return renderDashboard(interaction, targetId, 'cases', {
      actionFilter,
      statusFilter,
      page,
    });
  }

  return false;
}

async function handleUserSelectMenu(interaction) {
  if (interaction.customId !== 'mod_user_select') return false;

  const target = await fetchTarget(interaction.guild, interaction.values[0]);
  if (!target) return safeReply(interaction, ephemeralError('Could not find that user.'));
  return renderDashboard(interaction, target.id, 'overview');
}

async function handleSelectUserButton(interaction) {
  if (interaction.customId !== 'mod_select_user') return false;

  return safeReply(interaction, {
    content: '👤 Select a user:',
    components: [buildUserSelectRow()],
    flags: 64,
  });
}

async function openModPanel(interaction, options = {}) {
  if (!canOpenModPanel(interaction)) {
    return interaction.deferred || interaction.replied
      ? interaction.editReply(noAccessPayload())
      : interaction.reply(noAccessPayload());
  }

  const view = options.view || DEFAULT_VIEW;
  const target = options.target || null;
  const payload = await buildDashboardPayload(Discord, interaction, target, view, options);
  const finalPayload = { ...payload, flags: 64 };

  return interaction.deferred || interaction.replied
    ? interaction.editReply(finalPayload)
    : interaction.reply(finalPayload);
}

module.exports = {
  openModPanel,
  refreshDashboard,
  refreshCasesDashboard,
  handleDashboardNavigation,
  handleUserSelectMenu,
  handleSelectUserButton,
};
