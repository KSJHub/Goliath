'use strict';
const { emojiLabel } = require('../../../core/ui/emojis');
const { actionButton, navigationButton } = require('../../../core/guild/goliathNavigation');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const polls = require('./polls');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const { rolePages, rolePageSelect } = require('../../../core/ui/rolePagination');

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => navigationButton(customId, label, style);
const formatChannel = (id) => id ? `<#${id}>` : '`Not set`';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : '`None`';

function buildPollsAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const section = polls.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'polls');
  const pollList = Object.values(section.polls || {});
  const active = pollList.filter((poll) => poll.status === 'active').length;
  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57f287 : 0x5865f2)
    .setTitle(emojiLabel('ANALYTICS', 'Polls'))
    .setDescription([
      'Create, deploy and manage community polls directly in Discord.', '',
      `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Default Channel:** ${formatChannel(section.defaultChannelId || section.settings?.defaultChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Anonymous Voting:** ${section.anonymousVoting ? 'Yes ✅' : 'No ❌'}`,
      `**Multiple Choice:** ${section.allowMultipleChoice ? 'Yes ✅' : 'No ❌'}`,
      `**Live Results:** ${section.showResultsLive !== false ? 'Yes ✅' : 'No ❌'}`,
      `**Auto Close:** ${Number(section.settings?.autoCloseHours || 0) > 0 ? `${section.settings.autoCloseHours} hour(s)` : 'Disabled'}`, '',
      `Polls: \`${pollList.length}\` | Active: \`${active}\` | Votes: \`${section.analytics.votes || 0}\``,
      `Created: \`${section.analytics.created || 0}\` | Deployed: \`${section.analytics.deployed || 0}\` | Closed: \`${section.analytics.closed || 0}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();
  return { embeds: [embed], components: [
    row(button('admin:polls:create', emojiLabel('ADD', 'Create Poll'), ButtonStyle.Success), button('admin:polls:manage', emojiLabel('WORKSPACE', 'Manage Polls')), button(enabled ? 'admin:polls:disable' : 'admin:polls:enable', enabled ? emojiLabel('USER_PAUSE', 'Disable') : emojiLabel('USER_PLAY', 'Enable'), ButtonStyle.Secondary)),
    row(actionButton('admin:polls:settings', 'settings'), button('admin:polls:health', emojiLabel('WELCOME_DIAGNOSTICS', 'Health'), ButtonStyle.Secondary), button('admin:polls:repair', emojiLabel('WELCOME_CUSTOM', 'Repair')), button('admin:polls:export', emojiLabel('MOD_EXPORT', 'Export'), ButtonStyle.Secondary), button('admin:polls:reset', emojiLabel('DELETE', 'Reset'), ButtonStyle.Danger)),
    row(actionButton('admin:modules', 'back')),
  ] };
}
function buildSettingsPanel(guild, memberDisplayName = 'Unknown User', rolePage = 0) {
  const section = polls.getSection(guild.id);
  const roleInfo = rolePages(guild, section.managerRoleIds || [], rolePage);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(emojiLabel('ANALYTICS', 'Poll Settings')).setDescription([
    `**Default Channel:** ${formatChannel(section.defaultChannelId || section.settings?.defaultChannelId)}`,
    `**Results Channel:** ${formatChannel(section.resultsChannelId)}`,
    `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`, `**Role Selection · Page ${roleInfo.page + 1}/${roleInfo.pages}**`, '',
    'Use the selectors and buttons below. Auto-close hours are configured from the dashboard.',
  ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` });
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:polls:defaultChannel').setPlaceholder('Default poll channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:polls:resultsChannel').setPlaceholder('Results channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    ...(roleInfo.roles.length ? [row(rolePageSelect(`admin:polls:managerRoles:${roleInfo.page}`, 'Manager roles', roleInfo))] : []),
    row(button('admin:polls:toggleAnonymous', emojiLabel('USER', 'Anonymous'), ButtonStyle.Secondary), button('admin:polls:toggleMultiple', emojiLabel('CHECKBOX', 'Multiple'), ButtonStyle.Secondary), button('admin:polls:toggleLive', emojiLabel('MOD_RECENT_ACTIVITY', 'Live Results'), ButtonStyle.Secondary)),
    row(actionButton('admin:polls', 'back'),
      button(`admin:polls:roleBrowse:${Math.max(0, roleInfo.page - 1)}`, emojiLabel('ROLE_PREVIOUS', 'Roles'), ButtonStyle.Secondary).setDisabled(roleInfo.page === 0),
      button(`admin:polls:roleBrowse:${Math.min(roleInfo.pages - 1, roleInfo.page + 1)}`, emojiLabel('ROLE_NEXT', 'Roles', { position: 'after' }), ButtonStyle.Secondary).setDisabled(roleInfo.page >= roleInfo.pages - 1)),
  ] };
}
function buildManagePanel(guild) {
  const pollList = Object.values(polls.getSection(guild.id).polls || {}).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 25);
  if (!pollList.length) return { content: 'No polls exist yet. Create one first.', embeds: [], components: [row(button('admin:polls:create', emojiLabel('ADD', 'Create Poll'), ButtonStyle.Success), actionButton('admin:polls', 'back'))] };
  const selector = new StringSelectMenuBuilder().setCustomId('admin:polls:select').setPlaceholder('Select a poll to manage').addOptions(pollList.map((poll) => ({ label: String(poll.question).slice(0, 100), description: `${poll.status} · ${poll.options.length} options`.slice(0, 100), value: poll.id })));
  return { content: 'Select a poll to deploy, close, refresh or delete.', embeds: [], components: [row(selector), row(actionButton('admin:polls', 'back'))] };
}
function buildPollDetailPanel(guild, pollId) {
  const poll = polls.getPoll(guild.id, pollId);
  if (!poll) throw new Error('Poll not found.');
  const summary = polls.summarizePoll(poll);
  const embed = polls.buildPollEmbed(poll).addFields(
    { name: 'Status', value: poll.status, inline: true },
    { name: 'Responses', value: String(summary.totalVotes || 0), inline: true },
    { name: 'Channel', value: formatChannel(poll.channelId), inline: true }
  );
  const actions = [];
  if (poll.status !== 'closed') actions.push(button(`admin:polls:deploy:${poll.id}`, poll.messageId ? emojiLabel('REFRESH', 'Refresh') : emojiLabel('DEPLOY', 'Deploy'), ButtonStyle.Success));
  if (poll.status === 'active') actions.push(button(`admin:polls:close:${poll.id}`, emojiLabel('STOP', 'Close'), ButtonStyle.Danger));
  actions.push(button(`admin:polls:delete:${poll.id}`, emojiLabel('DELETE', 'Delete'), ButtonStyle.Danger), button('admin:polls:manage', emojiLabel('BACK', 'Polls'), ButtonStyle.Secondary));
  return { embeds: [embed], components: [row(...actions)] };
}
function buildCreateModal() {
  return new ModalBuilder().setCustomId('admin:polls:createSubmit').setTitle('Create Poll').addComponents(
    row(new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
    row(new TextInputBuilder().setCustomId('options').setLabel('Options — one per line').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Yes\nNo').setMinLength(3).setMaxLength(800))
  );
}
function buildResetConfirmation() {
  return { content: 'This deletes every tracked poll message and resets Polls. Confirm?', embeds: [], components: [row(button('admin:polls:resetConfirm', 'Confirm Reset', ButtonStyle.Danger), button('admin:polls', 'Cancel', ButtonStyle.Secondary))] };
}

module.exports = {
  buildPollsAdminPanel,
  buildSettingsPanel,
  buildManagePanel,
  buildPollDetailPanel,
  buildCreateModal,
  buildResetConfirmation,
};