'use strict';

const {
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const suggestions = require('./suggestions');
const panel = require('./suggestionsPanel');
const tracking = require('./suggestionsTracking');
const panelNavigation = require('../../../core/ui/panelNavigation');
const { setModuleEnabled, isModuleEnabled } = require('../../../core/guild/guildManager');

const SUGGESTIONS_COLOR = panel.SUGGESTIONS_COLOR || 0xfee75c;
const ADMIN_RECORD_PAGE_SIZE = 20;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const formatChannel = (id) => id ? `<#${id}>` : '⚠️ Not set';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length
  ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ')
  : 'Administrators / Manage Server only';

async function safeReply(interaction, content) {
  const text = String(content || 'That suggestion action could not be completed.').slice(0, 1900);
  const payload = { content: text, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.replied) return await interaction.followUp(payload);
    if (interaction.deferred) {
      if (interaction.isMessageComponent?.()) return await interaction.followUp(payload);
      return await interaction.editReply({ content: text });
    }
    return await interaction.reply(payload);
  } catch (error) {
    console.error('[Suggestions] Failed to respond to interaction:', error);
    return null;
  }
}

async function safeUpdate(interaction, payload) {
  const cleanPayload = { content: null, ...payload };
  if (interaction.deferred || interaction.replied) await interaction.editReply(cleanPayload);
  else await interaction.update(cleanPayload);
  return true;
}

function withoutReplyFlags(payload = {}) {
  const { flags, ephemeral, ...rest } = payload;
  return rest;
}

async function refreshLiveSuggestionUi(guild, { panelMessage = false, suggestionMessages = false } = {}) {
  if (panelMessage) await panel.refreshDeployedPanel(guild).catch((error) => {
    console.warn('[Suggestions] Could not refresh the published suggestions panel:', error.message || error);
  });
  if (suggestionMessages) await tracking.refreshPendingSuggestions(guild, panel).catch((error) => {
    console.warn('[Suggestions] Could not refresh active suggestion messages:', error.message || error);
  });
}

async function refreshManagementRoleCache(guild) {
  if (!guild?.roles?.fetch) throw new Error('The server role list could not be loaded.');
  try {
    await guild.roles.fetch();
  } catch (error) {
    throw new Error(`The complete server role list could not be loaded: ${error.message || 'Please try again.'}`);
  }
}

async function fetchStoredMessage(guild, channelId, messageId) {
  if (!guild || !channelId || !messageId) return null;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.messages?.fetch) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function reconcilePublishedPanel(guild) {
  const section = suggestions.getSection(guild.id);
  const deployment = section.deployment || {};
  if (!deployment.channelId || !deployment.messageId) return false;
  const message = await fetchStoredMessage(guild, deployment.channelId, deployment.messageId);
  if (message) return true;
  suggestions.saveDeployment(guild.id, { channelId: null, messageId: null, deployedAt: null }, guild);
  return false;
}

function workflowReadiness(section, enabled) {
  const reviewEnabled = section.requireReview !== false;
  const missing = [];
  if (!section.submitChannelId) missing.push('public suggestions channel');
  if (reviewEnabled && !section.reviewChannelId) missing.push('private team discussion channel');
  return { ready: enabled && missing.length === 0, missing, reviewEnabled };
}

function buildOverviewPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const readiness = workflowReadiness(section, enabled);
  const deployed = Boolean(section.deployment?.channelId && section.deployment?.messageId);
  const outcomesConfigured = [section.approvedChannelId, section.deniedChannelId].filter(Boolean).length;
  const managementRoles = Array.isArray(section.reviewerRoleIds) ? section.reviewerRoleIds.filter(Boolean) : [];

  const embed = new EmbedBuilder()
    .setColor(SUGGESTIONS_COLOR)
    .setTitle('💡 Suggestions · Control Centre')
    .setDescription('Manage suggestions, workflow and configuration.')
    .addFields(
      {
        name: 'Status',
        value: `${enabled ? '🟢 Enabled' : '🔴 Disabled'} · ${deployed ? `✅ Panel published in ${formatChannel(section.deployment.channelId)}` : '⚪ Panel not published'}`,
        inline: false,
      },
      {
        name: 'Setup',
        value: [
          `📢 Public: ${formatChannel(section.submitChannelId)}`,
          `💬 Team: ${readiness.reviewEnabled ? formatChannel(section.reviewChannelId) : '⏸️ Review disabled'}`,
          `👥 Management: ${managementRoles.length ? formatRoles(managementRoles) : 'Administrators / Manage Server'}`,
          `📬 Outcomes: ${outcomesConfigured}/2 set · ${section.logChannelId ? '🧾 Audit log set' : '⚠️ Audit log not set'}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Activity',
        value: [
          `💡 Open **${section.analytics.submitted}** · 💬 Discussing **${section.analytics.discussing}** · ✅ Approved **${section.analytics.approved}**`,
          `🚀 Implemented **${section.analytics.implemented}** · ❌ Declined **${section.analytics.denied}**`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: `Suggestions management · Opened by ${memberName}` })
    .setTimestamp();

  const publishButton = button(
    'admin:suggestions:deploy',
    deployed ? '🔄 Update Public Panel' : '🚀 Publish Public Panel',
    ButtonStyle.Success,
  ).setDisabled(!readiness.ready);

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:submitChannel')
        .setPlaceholder('📢 Public suggestions channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder()
        .setCustomId('admin:suggestions:reviewChannel')
        .setPlaceholder(readiness.reviewEnabled ? '💬 Private team discussion channel' : '💬 Team discussion is disabled')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0).setMaxValues(1).setDisabled(!readiness.reviewEnabled)),
      row(
        button('admin:suggestions:records:page:0', '📂 Manage Suggestions', ButtonStyle.Primary),
        button('admin:suggestions:reviewers', '👥 Management Team', ButtonStyle.Primary),
      ),
      row(
        button('admin:suggestions:destinations', '📬 Outcomes & Logs', ButtonStyle.Primary),
        button('admin:suggestions:settings', '⚙️ Settings', ButtonStyle.Secondary),
      ),
      row(
        publishButton,
        button('admin:modules', '⬅️ Back', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSettingsPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'suggestions');
  const voting = section.voting !== false;
  const review = section.requireReview !== false;
  const anonymous = section.anonymous === true;
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Settings')
    .setDescription('These settings control how Suggestions behaves across the whole server. The buttons below describe the action they will perform.')
    .addFields(
      { name: 'Module', value: `Suggestions are currently **${enabled ? 'Enabled ✅' : 'Disabled ❌'}**.\n${enabled ? 'Members can use the published panel and active suggestion controls.' : 'New submissions and active controls are paused.'}`, inline: false },
      { name: 'Community voting', value: voting ? '✅ Enabled · Open suggestions can receive community votes.' : '❌ Disabled · Vote controls are hidden globally.', inline: true },
      { name: 'Management review', value: review ? '✅ Enabled · Suggestions use the managed review workflow.' : '❌ Disabled · Private review workflow is bypassed.', inline: true },
      { name: 'Public identity', value: anonymous ? '🔒 Anonymous · Public suggestion cards hide the member name. Management can still identify the submitter.' : '👤 Named · Public suggestion cards show the submitting member.', inline: false },
    ).setFooter({ text: `Global Suggestions settings · Opened by ${memberName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(button(enabled ? 'admin:suggestions:disable' : 'admin:suggestions:enable', enabled ? '⏸️ Disable Suggestions' : '▶️ Enable Suggestions', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
    row(button('admin:suggestions:toggleVoting', voting ? '⏸️ Disable Voting' : '▶️ Enable Voting', voting ? ButtonStyle.Secondary : ButtonStyle.Success), button('admin:suggestions:toggleReview', review ? '⏸️ Disable Review' : '▶️ Enable Review', review ? ButtonStyle.Secondary : ButtonStyle.Success)),
    row(button('admin:suggestions:toggleAnonymous', anonymous ? '👤 Show Member Names Publicly' : '🔒 Make Public Suggestions Anonymous', ButtonStyle.Secondary)),
    row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)),
  ] };
}

function buildManagementTeamPanel(guild, memberName, page = 0) {
  const section = suggestions.getSection(guild.id);
  const pageCount = panelNavigation.rolePickerPageCount(guild);
  const safePage = Math.min(Math.max(0, Number(page) || 0), pageCount - 1);
  const picker = panelNavigation.buildRolePicker(guild, { customId: 'admin:suggestions:reviewerRoles', placeholder: 'Choose management roles', selectedIds: section.reviewerRoleIds, minValues: 0, maxValues: 25, page: safePage, pagination: true, showManaged: true });
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Management Team')
    .setDescription('Choose the roles that can move suggestions through discussion, approval, decline and implementation.')
    .addFields(
      { name: 'Selected management roles', value: formatRoles(section.reviewerRoleIds), inline: false },
      { name: 'Role list', value: `Roles are ordered **highest → lowest** in the server hierarchy. Page **${safePage + 1} of ${pageCount}**.${pageCount > 1 ? ' Use Previous / Next to view every role.' : ''}`, inline: false },
      { name: 'Built-in access', value: 'Members with **Administrator** or **Manage Server** can always manage suggestions, even if no role is selected here.', inline: false },
    ).setFooter({ text: `Management access · Opened by ${memberName}` }).setTimestamp();
  return { embeds: [embed], components: [...picker.rows, row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary))] };
}

function buildDestinationsPanel(guild, memberName) {
  const section = suggestions.getSection(guild.id);
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Outcomes & Logs')
    .setDescription('Choose where final results and the management audit trail are posted. The original public suggestion is always updated with its final status and team response.')
    .addFields(
      { name: '✅ Approved suggestions', value: section.approvedChannelId ? formatChannel(section.approvedChannelId) : 'Optional · no separate approved-results channel selected', inline: false },
      { name: '❌ Declined suggestions', value: section.deniedChannelId ? formatChannel(section.deniedChannelId) : 'Optional · no separate declined-results channel selected', inline: false },
      { name: '🧾 Audit log', value: section.logChannelId ? `${formatChannel(section.logChannelId)} · Management actions are recorded here.` : '⚠️ Not set · recommended so management actions have a permanent channel record.', inline: false },
    ).setFooter({ text: `Outcome routing · Opened by ${memberName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:approvedChannel').setPlaceholder('Approved suggestions channel · optional').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:deniedChannel').setPlaceholder('Declined suggestions channel · optional').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:logChannel').setPlaceholder('Suggestions audit log channel · recommended').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)),
  ] };
}

function suggestionAdminRecords(guildId) {
  return Object.values(suggestions.getSection(guildId).suggestions || {}).filter((item) => item?.suggestionId).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}
function shortRecordDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown date';
}
function buildSuggestionRecordsPanel(guild, memberName, page = 0) {
  const records = suggestionAdminRecords(guild.id);
  const totalPages = Math.max(1, Math.ceil(records.length / ADMIN_RECORD_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const visible = records.slice(safePage * ADMIN_RECORD_PAGE_SIZE, (safePage + 1) * ADMIN_RECORD_PAGE_SIZE);
  const section = suggestions.getSection(guild.id);
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle('💡 Suggestions · Manage Suggestions')
    .setDescription(['Every submitted suggestion stored by Goliath is listed here, even if its Discord message was deleted manually.', '', `**Stored records:** ${records.length}`, `**Discussing:** ${section.analytics.discussing} · **Approved:** ${section.analytics.approved} · **Implemented:** ${section.analytics.implemented} · **Declined:** ${section.analytics.denied}`, '', records.length ? 'Choose a suggestion below to inspect its Discord messages, edit it, repair missing messages or remove stale backend data.' : 'There are no stored suggestion records.'].join('\n'))
    .setFooter({ text: `Page ${safePage + 1} of ${totalPages} · Opened by ${memberName}` }).setTimestamp();
  const components = [];
  if (visible.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:suggestions:records:select:${safePage}`).setPlaceholder('Choose a stored suggestion').setMinValues(1).setMaxValues(1).addOptions(visible.map((item) => ({ label: `${panel.statusEmoji(item.status)} ${item.reference} · ${item.title}`.slice(0, 100), description: `${panel.statusLabel(item.status, section)} · ${shortRecordDate(item.createdAt)}`.slice(0, 100), value: item.suggestionId })))));
  if (totalPages > 1) components.push(row(button(`admin:suggestions:records:page:${Math.max(0, safePage - 1)}`, '⬅️ Previous', ButtonStyle.Secondary).setDisabled(safePage === 0), button(`admin:suggestions:records:page:${Math.min(totalPages - 1, safePage + 1)}`, 'Next ➡️', ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1)));
  components.push(row(button('admin:suggestions:overview', '⬅️ Back to Control Centre', ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

async function buildSuggestionRecordDetail(guild, memberName, suggestionId, page = 0) {
  const item = suggestions.getSuggestion(guild.id, suggestionId);
  if (!item) return buildSuggestionRecordsPanel(guild, memberName, page);
  const section = suggestions.getSection(guild.id);
  const publicMessage = await fetchStoredMessage(guild, item.channelId, item.messageId);
  const reviewMessage = await fetchStoredMessage(guild, item.reviewChannelId, item.reviewMessageId);
  const publicStatus = item.channelId && item.messageId ? (publicMessage ? `✅ Live in ${formatChannel(item.channelId)}` : `⚠️ Missing from ${formatChannel(item.channelId)}`) : '⚪ No public message linked';
  const reviewStatus = item.reviewChannelId && item.reviewMessageId ? (reviewMessage ? `✅ Live in ${formatChannel(item.reviewChannelId)}` : `⚠️ Missing from ${formatChannel(item.reviewChannelId)}`) : (section.requireReview !== false ? '⚪ No management message linked' : '⏸️ Management review is disabled');
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(`💡 ${item.reference} · ${item.title}`).setDescription(item.content || '_No suggestion details were provided._')
    .addFields(
      { name: 'Status', value: `${panel.statusEmoji(item.status)} ${panel.statusLabel(item.status, section)}`, inline: true },
      { name: 'Submitted by', value: item.authorId ? `<@${item.authorId}>${item.anonymous ? ' · 🔒 hidden publicly' : ''}` : 'Unknown member', inline: true },
      { name: 'Created', value: shortRecordDate(item.createdAt), inline: true },
      { name: 'Public Discord message', value: publicStatus, inline: false },
      { name: 'Management Discord message', value: reviewStatus, inline: false },
      { name: 'Stored votes', value: `👍 ${item.upVotes?.length || 0} · 👎 ${item.downVotes?.length || 0}`, inline: true },
      { name: 'Backend record', value: '✅ Stored in Goliath', inline: true },
    ).setFooter({ text: `Stored suggestion management · Opened by ${memberName}` }).setTimestamp(new Date(item.updatedAt || item.createdAt || Date.now()));
  return { embeds: [embed], components: [
    row(button(`admin:suggestions:recordEdit:${item.suggestionId}:${page}`, '📝 Edit', ButtonStyle.Primary), button(`admin:suggestions:recordRefresh:${item.suggestionId}:${page}`, '🛠️ Repair Messages', ButtonStyle.Secondary)),
    row(button(`admin:suggestions:recordDeleteMessages:${item.suggestionId}:${page}`, '🗑️ Delete Discord Messages', ButtonStyle.Danger), button(`admin:suggestions:recordRemove:${item.suggestionId}:${page}`, '🧹 Remove Goliath Record', ButtonStyle.Danger)),
    row(button(`admin:suggestions:records:page:${page}`, '⬅️ Back to Stored Suggestions', ButtonStyle.Secondary)),
  ] };
}

function buildDeleteConfirmation(guild, memberName, suggestionId, page = 0, mode = 'record') {
  const item = suggestions.getSuggestion(guild.id, suggestionId);
  if (!item) return buildSuggestionRecordsPanel(guild, memberName, page);
  const removeRecord = mode === 'record';
  const embed = new EmbedBuilder().setColor(SUGGESTIONS_COLOR).setTitle(removeRecord ? '⚠️ Remove Goliath Suggestion Record?' : '⚠️ Delete Suggestion Messages?')
    .setDescription(removeRecord ? `This permanently removes **${item.reference} · ${item.title}** from Goliath's stored Suggestions data.\n\nUse this when the Discord message was deleted manually or the record is no longer needed. The Open count will update immediately.\n\n**This does not delete any Discord messages that may still exist.**` : `This deletes the public and private management Discord messages for **${item.reference} · ${item.title}**, where Goliath can still access them.\n\nThe backend record will remain so you can edit, inspect or remove it separately.`)
    .setFooter({ text: `Confirmation · Opened by ${memberName}` }).setTimestamp();
  return { embeds: [embed], components: [row(button(`${removeRecord ? 'admin:suggestions:recordRemoveConfirm' : 'admin:suggestions:recordDeleteMessagesConfirm'}:${item.suggestionId}:${page}`, removeRecord ? '🧹 Yes, Remove Record' : '🗑️ Yes, Delete Messages', ButtonStyle.Danger), button(`admin:suggestions:record:${item.suggestionId}:${page}`, 'Cancel', ButtonStyle.Secondary))] };
}

function buildRecordEditModal(item, page = 0) {
  return new ModalBuilder().setCustomId(`admin:suggestions:recordEditModal:${item.suggestionId}:${page}`).setTitle('Edit Stored Suggestion').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Suggestion name').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(100).setRequired(true).setValue(String(item.title || '').slice(0, 100))),
    row(new TextInputBuilder().setCustomId('content').setLabel('Suggestion details').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(1800).setRequired(true).setValue(String(item.content || '').slice(0, 1800))),
  );
}
function removeStoredSuggestion(guild, suggestionId) {
  const id = suggestions.cleanSuggestionId(suggestionId); if (!id) return false;
  const section = suggestions.getSection(guild.id); if (!section.suggestions?.[id]) return false;
  const nextSuggestions = { ...section.suggestions }; delete nextSuggestions[id];
  suggestions.saveSection(guild.id, { ...section, suggestions: nextSuggestions, updatedAt: suggestions.now() }, guild); return true;
}
async function repairSuggestionMessages(guild, suggestionId) {
  let item = suggestions.getSuggestion(guild.id, suggestionId); if (!item) throw new Error('That stored suggestion could not be found.');
  const section = suggestions.getSection(guild.id); const enabled = isModuleEnabled(guild.id, 'suggestions');
  let publicMessage = await fetchStoredMessage(guild, item.channelId, item.messageId);
  if (!publicMessage) {
    if (!section.submitChannelId) throw new Error('Set the public suggestions channel before repairing this suggestion.');
    const publicChannel = await tracking.resolveSendableChannel(guild, section.submitChannelId, 'public suggestions channel', { requireHistory: true });
    publicMessage = await publicChannel.send(panel.buildSuggestionMessagePayload(guild, item, section, enabled, true));
    item = suggestions.updateSuggestion(guild.id, suggestionId, { channelId: publicMessage.channelId, messageId: publicMessage.id }, guild) || item;
  }
  if (section.requireReview !== false) {
    let reviewMessage = await fetchStoredMessage(guild, item.reviewChannelId, item.reviewMessageId);
    if (!reviewMessage) {
      if (!section.reviewChannelId) throw new Error('Set the private team discussion channel before repairing the management message.');
      const reviewChannel = await tracking.resolveSendableChannel(guild, section.reviewChannelId, 'team discussion channel', { requireHistory: true });
      reviewMessage = await reviewChannel.send(panel.buildManagementPayload(guild, item, section));
      item = suggestions.updateSuggestion(guild.id, suggestionId, { reviewChannelId: reviewMessage.channelId, reviewMessageId: reviewMessage.id }, guild) || item;
    }
  }
  await tracking.refreshSuggestionMessage(guild, suggestionId, panel).catch(() => null); await tracking.refreshReviewMessage(guild, suggestionId, panel).catch(() => null);
  return suggestions.getSuggestion(guild.id, suggestionId) || item;
}
async function deleteLinkedMessages(guild, item) {
  const targets = [[item.channelId, item.messageId], [item.reviewChannelId, item.reviewMessageId]]; let deleted = 0;
  for (const [channelId, messageId] of targets) { const message = await fetchStoredMessage(guild, channelId, messageId); if (message?.deletable) { await message.delete().catch(() => null); deleted += 1; } }
  return deleted;
}
async function reconcileAdminState(guild) { await reconcilePublishedPanel(guild).catch(() => false); }
function buildAdminPanel(guild, memberName, page = 'overview', rolePage = 0) {
  if (page === 'settings') return buildSettingsPanel(guild, memberName);
  if (page === 'reviewers') return buildManagementTeamPanel(guild, memberName, rolePage);
  if (page === 'destinations') return buildDestinationsPanel(guild, memberName);
  return buildOverviewPanel(guild, memberName);
}

async function handleSuggestionsAdminInteraction(interaction) {
  const id = String(interaction?.customId || ''); if (!id.startsWith('admin:suggestions')) return false;
  if (!interaction.guild?.id) { await safeReply(interaction, '❌ Suggestions can only be managed inside a server.'); return true; }
  const memberName = interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
  const save = (updater) => suggestions.updateSection(interaction.guild.id, updater, interaction.guild);
  try {
    const rolePicker = panelNavigation.parseRolePickerId(id);
    if (rolePicker?.baseId === 'admin:suggestions:reviewerRoles') {
      await refreshManagementRoleCache(interaction.guild);
      if (rolePicker.kind === 'select' && interaction.isStringSelectMenu?.()) {
        const section = suggestions.getSection(interaction.guild.id);
        const reviewerRoleIds = panelNavigation.mergeRolePickerSelection(interaction.guild, section.reviewerRoleIds, interaction.values || [], rolePicker.page);
        save((current) => ({ ...current, reviewerRoleIds })); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers', rolePicker.page));
      }
      if (rolePicker.kind === 'page' && interaction.isButton?.()) return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers', rolePicker.page));
    }
    if (id === 'admin:suggestions' || id === 'admin:suggestions:overview') { await reconcileAdminState(interaction.guild); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview')); }
    if (id === 'admin:suggestions:settings') return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    if (id === 'admin:suggestions:reviewers') { await refreshManagementRoleCache(interaction.guild); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'reviewers')); }
    if (id === 'admin:suggestions:destinations') return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'destinations'));
    const recordParts = id.split(':');
    if (recordParts[2] === 'records' && recordParts[3] === 'page') return safeUpdate(interaction, buildSuggestionRecordsPanel(interaction.guild, memberName, Number(recordParts[4] || 0)));
    if (interaction.isStringSelectMenu?.() && recordParts[2] === 'records' && recordParts[3] === 'select') { const page = Number(recordParts[4] || 0); const suggestionId = suggestions.cleanSuggestionId(interaction.values?.[0]); if (!suggestionId) throw new Error('That stored suggestion could not be found.'); return safeUpdate(interaction, await buildSuggestionRecordDetail(interaction.guild, memberName, suggestionId, page)); }
    if (recordParts[2] === 'record') { const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); return safeUpdate(interaction, await buildSuggestionRecordDetail(interaction.guild, memberName, suggestionId, page)); }
    if (recordParts[2] === 'recordEdit' && interaction.isButton?.()) { const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); const item = suggestions.getSuggestion(interaction.guild.id, suggestionId); if (!item) throw new Error('That stored suggestion could not be found.'); await interaction.showModal(buildRecordEditModal(item, page)); return true; }
    if (recordParts[2] === 'recordEditModal' && interaction.isModalSubmit?.()) {
      const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); const title = String(interaction.fields.getTextInputValue('title') || '').trim(); const content = String(interaction.fields.getTextInputValue('content') || '').trim();
      if (title.length < 3 || title.length > 100) throw new Error('The suggestion name must be between 3 and 100 characters.'); if (content.length < 5 || content.length > 1800) throw new Error('The suggestion details must be between 5 and 1800 characters.');
      await interaction.deferUpdate(); const updated = suggestions.updateSuggestion(interaction.guild.id, suggestionId, (item) => ({ ...item, title, content, history: suggestions.appendHistory(item.history, { type: 'admin_edited', actorId: interaction.user.id, at: suggestions.now(), fromStatus: item.status, toStatus: item.status, note: 'Suggestion text edited by management.' }) }), interaction.guild);
      if (!updated) throw new Error('That stored suggestion could not be updated.'); await tracking.refreshSuggestionMessage(interaction.guild, suggestionId, panel).catch(() => null); await tracking.refreshReviewMessage(interaction.guild, suggestionId, panel).catch(() => null); return safeUpdate(interaction, await buildSuggestionRecordDetail(interaction.guild, memberName, suggestionId, page));
    }
    if (recordParts[2] === 'recordRefresh' && interaction.isButton?.()) { const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); await interaction.deferUpdate(); await repairSuggestionMessages(interaction.guild, suggestionId); return safeUpdate(interaction, await buildSuggestionRecordDetail(interaction.guild, memberName, suggestionId, page)); }
    if (recordParts[2] === 'recordDeleteMessages' && interaction.isButton?.()) return safeUpdate(interaction, buildDeleteConfirmation(interaction.guild, memberName, suggestions.cleanSuggestionId(recordParts[3]), Number(recordParts[4] || 0), 'messages'));
    if (recordParts[2] === 'recordDeleteMessagesConfirm' && interaction.isButton?.()) { const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); const item = suggestions.getSuggestion(interaction.guild.id, suggestionId); if (!item) throw new Error('That stored suggestion could not be found.'); await interaction.deferUpdate(); await deleteLinkedMessages(interaction.guild, item); return safeUpdate(interaction, await buildSuggestionRecordDetail(interaction.guild, memberName, suggestionId, page)); }
    if (recordParts[2] === 'recordRemove' && interaction.isButton?.()) return safeUpdate(interaction, buildDeleteConfirmation(interaction.guild, memberName, suggestions.cleanSuggestionId(recordParts[3]), Number(recordParts[4] || 0), 'record'));
    if (recordParts[2] === 'recordRemoveConfirm' && interaction.isButton?.()) { const suggestionId = suggestions.cleanSuggestionId(recordParts[3]); const page = Number(recordParts[4] || 0); await interaction.deferUpdate(); if (!removeStoredSuggestion(interaction.guild, suggestionId)) throw new Error('That stored suggestion could not be found.'); return safeUpdate(interaction, buildSuggestionRecordsPanel(interaction.guild, memberName, page)); }
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null; const property = id.split(':')[2];
      if (['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel', 'logChannel'].includes(property)) { save((section) => ({ ...section, [`${property}Id`]: value })); const page = ['approvedChannel', 'deniedChannel', 'logChannel'].includes(property) ? 'destinations' : 'overview'; return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, page)); }
    } else if (id === 'admin:suggestions:enable') { await interaction.deferUpdate(); setModuleEnabled(interaction.guild.id, 'suggestions', true, interaction.guild); await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true }); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:disable') { await interaction.deferUpdate(); setModuleEnabled(interaction.guild.id, 'suggestions', false, interaction.guild); await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true, suggestionMessages: true }); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleVoting') { await interaction.deferUpdate(); save((section) => ({ ...section, voting: section.voting === false })); await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true }); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleReview') { await interaction.deferUpdate(); save((section) => ({ ...section, requireReview: section.requireReview === false })); await refreshLiveSuggestionUi(interaction.guild, { suggestionMessages: true }); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:toggleAnonymous') { await interaction.deferUpdate(); save((section) => ({ ...section, anonymous: section.anonymous !== true })); await refreshLiveSuggestionUi(interaction.guild, { panelMessage: true }); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'settings'));
    } else if (id === 'admin:suggestions:deploy') { await interaction.deferUpdate(); await panel.deploySubmitPanel(interaction.guild); return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview')); }
    return safeUpdate(interaction, buildAdminPanel(interaction.guild, memberName, 'overview'));
  } catch (error) { console.error('[Suggestions] Admin interaction failed:', error); await safeReply(interaction, `❌ Suggestions could not be updated: ${error.message || 'Please try again.'}`); return true; }
}

async function handleSuggestionsInteraction(interaction) {
  if (!interaction?.guildId || !String(interaction.customId || '').startsWith('suggestions:')) return false;
  try {
    const parts = String(interaction.customId || '').split(':');
    if (interaction.isButton?.() && interaction.customId === 'suggestions:submit') { tracking.assertEnabled(interaction.guildId); await interaction.showModal(panel.buildSubmitModal()); return true; }
    if (interaction.isButton?.() && parts[1] === 'mine' && parts[2] === 'page') { const payload = panel.buildMySuggestionsPayload(interaction.guildId, interaction.user.id, Number(parts[3] || 0)); if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.update(withoutReplyFlags(payload)); else await interaction.reply(payload); return true; }
    if (interaction.isStringSelectMenu?.() && interaction.customId === 'suggestions:mine:select') { const [suggestionId, page = '0'] = String(interaction.values?.[0] || '').split('|'); await interaction.update(withoutReplyFlags(panel.buildMySuggestionDetail(interaction.guildId, interaction.user.id, suggestionId, Number(page || 0)))); return true; }
    if (interaction.isButton?.() && interaction.customId === 'suggestions:mine:close') { await interaction.deferUpdate(); await interaction.deleteReply().catch(() => null); return true; }
    if (interaction.isModalSubmit?.() && interaction.customId === 'suggestions:modal:submit') { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const saved = await tracking.submitSuggestion(interaction, panel); await interaction.editReply({ content: saved.anonymous === true ? `✅ **${saved.title}** was shared anonymously. You can follow its progress from **My Suggestions**.` : `✅ **${saved.title}** was shared. You can follow its progress from **My Suggestions**.` }); return true; }
    if (interaction.isButton?.() && parts[1] === 'vote') { if (!suggestions.cleanSuggestionId(parts[2]) || !['up', 'down'].includes(parts[3])) throw new Error('That vote is no longer available.'); await interaction.deferUpdate(); await tracking.vote(interaction, parts[2], parts[3], panel); return true; }
    if (interaction.isButton?.() && parts[1] === 'manage') {
      const suggestionId = suggestions.cleanSuggestionId(parts[2]); const action = parts[3]; if (!suggestionId || !['discuss', 'resume', 'approve', 'deny', 'implemented'].includes(action)) throw new Error('That management action is no longer available.');
      const section = tracking.assertEnabled(interaction.guildId); if (!tracking.isReviewer(interaction.member, section)) throw new Error('Only the suggestions management team can use these controls.');
      if (['approve', 'deny', 'implemented'].includes(action)) { await interaction.showModal(panel.buildReviewModal(suggestionId, action)); return true; }
      await interaction.deferUpdate(); const updated = await tracking.manage(interaction, suggestionId, action, panel); await interaction.followUp({ content: action === 'discuss' ? `💬 ${updated.reference} is now under team discussion. Community voting has been paused.` : `▶️ ${updated.reference} is open for community voting again.`, flags: MessageFlags.Ephemeral }); return true;
    }
    if (interaction.isButton?.() && parts[1] === 'reviewOpen') { const suggestionId = suggestions.cleanSuggestionId(parts[2]); if (!suggestionId) throw new Error('That review option is no longer available.'); const section = tracking.assertEnabled(interaction.guildId); if (!tracking.isReviewer(interaction.member, section)) throw new Error('Only the suggestions management team can use this button.'); const current = suggestions.getSuggestion(interaction.guildId, suggestionId); if (!current) throw new Error('That suggestion could not be found.'); await interaction.reply(panel.buildReviewerDecisionPayload(interaction.guild, suggestionId)); return true; }
    if (interaction.isButton?.() && interaction.customId === 'suggestions:reviewClose') { await interaction.deferUpdate(); await interaction.deleteReply().catch(() => null); return true; }
    if (interaction.isButton?.() && parts[1] === 'review') { if (!suggestions.cleanSuggestionId(parts[2]) || !['approve', 'deny'].includes(parts[3])) throw new Error('That review action is no longer available.'); const section = tracking.assertEnabled(interaction.guildId); if (!tracking.isReviewer(interaction.member, section)) throw new Error('You are not part of the suggestions management team.'); await interaction.showModal(panel.buildReviewModal(parts[2], parts[3])); return true; }
    if (interaction.isModalSubmit?.() && parts[1] === 'reviewModal') { const suggestionId = suggestions.cleanSuggestionId(parts[2]); const action = parts[3]; if (!suggestionId || !['approve', 'deny', 'implemented'].includes(action)) throw new Error('That management action is no longer available.'); await interaction.deferReply({ flags: MessageFlags.Ephemeral }); const reason = String(interaction.fields.getTextInputValue('reason') || '').trim(); const updated = await tracking.manage(interaction, suggestionId, action, panel, reason); const messages = { approve: `✅ ${updated.reference} has been approved. Voting is closed and the action was logged.`, deny: `❌ ${updated.reference} has been declined. The reason is visible on the original suggestion and the action was logged.`, implemented: `🚀 ${updated.reference} has been marked as implemented. The original suggestion and audit log have been updated.` }; await interaction.editReply({ content: messages[action] }); return true; }
    return false;
  } catch (error) { console.error('[Suggestions] Interaction failed:', error); await safeReply(interaction, `❌ ${error.message || 'That suggestion action could not be completed.'}`); return true; }
}

module.exports = { handleSuggestionsAdminInteraction, handleSuggestionsInteraction };
