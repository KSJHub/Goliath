'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, EmbedBuilder, ModalBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const faq = require('./faq');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function selectRow(customId, placeholder, options) {
  const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options);
  return row(menu);
}

function buildHomePanel(guildId) {
  const categories = faq.listCategories(guildId).slice(0, 25);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('❓ FAQ & Support Centre').setDescription([
    '**Frequently Asked Questions**', '',
    'The quickest place to find answers to common questions, useful information and support.', '',
    '🔎 **Find an Answer**', 'Browse the FAQ categories below.', '',
    '❓ **Can’t find what you need?**', 'Ask the team and your question can become part of the FAQ knowledge base.',
  ].join('\n'));
  const components = [];
  if (categories.length) components.push(selectRow('faq:category', 'Select an FAQ category', categories.map(c => ({ label: c.name.slice(0, 100), description: (c.description || 'View questions').slice(0, 100), value: c.id, emoji: c.emoji || undefined }))));
  components.push(row(button('faq:ask', '❓ Ask a Question', ButtonStyle.Primary), button('faq:search', '🔎 Search FAQs')));
  return { embeds: [embed], components };
}

function buildCategoryPanel(guildId, categoryId) {
  const category = faq.listCategories(guildId).find(c => c.id === faq.cleanKey(categoryId));
  if (!category) return buildNotice('FAQ category unavailable', 'This category is no longer available.');
  const entries = faq.listEntries(guildId, category.id).slice(0, 25);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${category.emoji || '❓'} ${category.name}`).setDescription(category.description || 'Select a question below.');
  const components = [];
  if (entries.length) components.push(selectRow(`faq:question:${category.id}`, 'Select a question', entries.map(e => ({ label: e.question.slice(0, 100), value: e.id }))));
  components.push(row(button('faq:ask', '❓ Ask a Question', ButtonStyle.Primary), button('faq:home', '🏠 FAQ Home')));
  return { embeds: [embed], components };
}

function publicAnswerPayload(entry) {
  const fields = [];
  if (entry.resources?.length) fields.push({ name: '📚 Helpful Resources', value: entry.resources.map(r => `• [${r.label}](${r.url})`).join('\n') });
  if (entry.supportChannelId) fields.push({ name: '💬 Still need help?', value: `Visit <#${entry.supportChannelId}>` });
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`❓ ${entry.question}`).setDescription(entry.answer || '_No answer has been configured._').setFooter({ text: 'KSJ FAQ & Support Centre' });
  if (fields.length) embed.addFields(fields);
  return embed;
}

function buildAnswerPanel(guildId, entryId) {
  const entry = faq.getEntry(guildId, entryId);
  if (!entry) return buildNotice('FAQ unavailable', 'This FAQ is no longer available.');
  return { embeds: [publicAnswerPayload(entry)], components: [row(button(`faq:back:${entry.categoryId}`, '⬅️ Back'), button('faq:home', '🏠 FAQ Home'))] };
}

function buildSubmissionPreview(guildId, submission) {
  const category = submission.categoryId ? faq.getSection(guildId).categories[submission.categoryId] : null;
  const embed = publicAnswerPayload(submission).setAuthor({ name: 'PUBLIC FAQ PREVIEW' });
  if (category) embed.setFooter({ text: `${category.emoji || '❓'} ${category.name} • KSJ FAQ & Support Centre` });
  return { embeds: [embed], components: [] };
}

function buildAskModal() {
  return new ModalBuilder().setCustomId('faq:modal:ask').setTitle('Ask the Team').addComponents(
    row(new TextInputBuilder().setCustomId('question').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
    row(new TextInputBuilder().setCustomId('details').setLabel('More details (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1500)),
  );
}

function buildSearchModal() {
  return new ModalBuilder().setCustomId('faq:modal:search').setTitle('Search FAQs').addComponents(row(new TextInputBuilder().setCustomId('query').setLabel('What are you looking for?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)));
}

function buildSearchResults(guildId, query) {
  const results = faq.search(guildId, query);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🔎 FAQ Search').setDescription(results.length ? `Results for **${faq.cleanText(query, 100)}**` : `No FAQ matched **${faq.cleanText(query, 100)}**. You can send the question to the team.`);
  const components = [];
  if (results.length) components.push(selectRow('faq:searchResult', 'Select an answer', results.slice(0, 25).map(e => ({ label: e.question.slice(0, 100), value: e.id }))));
  components.push(row(button('faq:ask', '❓ Ask the Team', ButtonStyle.Primary), button('faq:home', '🏠 FAQ Home')));
  return { embeds: [embed], components };
}

function buildSubmitted(s) {
  return { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('💎 Question Submitted').setDescription(['Thanks! Your question has been sent to the team for review.', '', `**Question**\n${s.question}`, '', `**Reference:** \`${s.id.toUpperCase()}\``, '', 'Once approved, the answer becomes part of the FAQ Centre.'].join('\n'))], components: [] };
}

function statusText(s) {
  return ({ submitted: '🟡 Awaiting Team Response', claimed: '🔵 Claimed', draft: '🟠 Draft — Not Published', review: '🟣 Ready for Review', published: '🟢 Published', dismissed: '⚫ Dismissed', duplicate: '⚪ Duplicate' })[s.status] || s.status;
}

function buildTeamSubmission(guildId, submissionId) {
  const s = faq.getSubmission(guildId, submissionId);
  if (!s) return buildNotice('Submission unavailable', 'This submission no longer exists.');
  const category = s.categoryId ? faq.getSection(guildId).categories[s.categoryId] : null;
  const lines = [`**${s.question}**`];
  if (s.details) lines.push('', `**📝 Details**\n${s.details}`);
  if (s.answer) lines.push('', `**💬 ${s.status === 'published' ? 'Answer' : 'Draft Answer'}**\n${s.answer}`);
  lines.push('', `**👤 Submitted by:** ${s.submittedBy ? `<@${s.submittedBy}>` : 'Unknown'}`, `**✍️ Answered by:** ${s.answeredBy ? `<@${s.answeredBy}>` : 'Not yet'}`, `**📁 Category:** ${category ? `${category.emoji || '❓'} ${category.name}` : 'Not selected'}`, `**📚 Resources:** ${s.resources?.length ? s.resources.map(r => `[${r.label}](${r.url})`).join(' • ') : 'None'}`, `**💬 Support:** ${s.supportChannelId ? `<#${s.supportChannelId}>` : 'None'}`, '', `**Status:** ${statusText(s)}`, `**Reference:** \`${s.id.toUpperCase()}\``);
  const embed = new EmbedBuilder().setColor(s.status === 'published' ? 0x57f287 : ['draft', 'review'].includes(s.status) ? 0xfee75c : 0x5865f2).setTitle('❓ FAQ Question').setDescription(lines.join('\n')).setTimestamp(new Date(s.createdAt));
  const components = [];
  if (!['published', 'dismissed', 'duplicate'].includes(s.status)) {
    components.push(row(button(`faq:team:claim:${s.id}`, s.claimedBy ? '👤 Take Over' : '👤 Claim'), button(`faq:team:answer:${s.id}`, '✍️ Answer', ButtonStyle.Primary), button(`faq:team:category:${s.id}`, '📁 Category')));
    components.push(row(button(`faq:team:resource:${s.id}`, '🔗 Guide / Resource'), button(`faq:team:support:${s.id}`, '💬 Support Channel'), button(`faq:team:preview:${s.id}`, '👁️ Preview')));
    components.push(row(button(`faq:team:publish:${s.id}`, '✅ Publish FAQ', ButtonStyle.Success), button(`faq:team:dismiss:${s.id}`, 'Dismiss', ButtonStyle.Danger)));
  } else if (s.status === 'published' && s.entryId) components.push(row(button(`faq:team:viewPublished:${s.entryId}`, '👁️ View Published FAQ')));
  return { embeds: [embed], components };
}

function buildAnswerModal(s) {
  return new ModalBuilder().setCustomId(`faq:team:modal:answer:${s.id}`).setTitle('Answer FAQ Question').addComponents(row(new TextInputBuilder().setCustomId('answer').setLabel('Answer').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(s.answer || '')));
}

function buildResourceModal(s) {
  return new ModalBuilder().setCustomId(`faq:team:modal:resource:${s.id}`).setTitle('Add Guide / Resource').addComponents(
    row(new TextInputBuilder().setCustomId('label').setLabel('Display name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    row(new TextInputBuilder().setCustomId('url').setLabel('URL').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(500)),
    row(new TextInputBuilder().setCustomId('type').setLabel('Type: guide, link or media').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue('link')),
  );
}

function buildCategoryPicker(guildId, s) {
  const cats = faq.listCategories(guildId).slice(0, 25);
  return { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📁 Select FAQ Category').setDescription(`Choose where **${s.question}** will be published.`)], components: cats.length ? [selectRow(`faq:team:categorySelect:${s.id}`, 'Select category', cats.map(c => ({ label: c.name, value: c.id, emoji: c.emoji || undefined })))] : [] };
}

function buildSupportPicker(s) {
  return { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('💬 Support Destination').setDescription('Select the channel users should visit if they still need help.')], components: [row(new ChannelSelectMenuBuilder().setCustomId(`faq:team:supportSelect:${s.id}`).setPlaceholder('Select support channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1))] };
}

function buildPublishConfirm(guildId, s) {
  const category = s.categoryId ? faq.getSection(guildId).categories[s.categoryId] : null;
  return { embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ Ready to Publish?').setDescription([`**${s.question}**`, '', `Category: **${category?.name || 'Not selected'}**`, `Answer: ${s.answer ? 'Ready' : 'Missing'}`, '', 'Publishing adds this answer to the public FAQ knowledge base and makes it available to browsing and search.'].join('\n'))], components: [row(button(`faq:team:publishConfirm:${s.id}`, '✅ Publish FAQ', ButtonStyle.Success), button(`faq:team:return:${s.id}`, 'Cancel'))] };
}

function buildNotice(title, description) {
  return { embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(description)], components: [] };
}

function buildAdminPanel(guild, displayName = 'Unknown User') {
  const s = faq.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, 'faq');
  const open = faq.listSubmissions(guild.id, ['submitted', 'claimed', 'draft', 'review']).length;
  const embed = new EmbedBuilder().setColor(enabled ? 0x57f287 : 0x5865f2).setTitle('❓ FAQ').setDescription(['Configure the server FAQ knowledge base and question workflow.', '', `**Status:** ${enabled ? 'Enabled ✅' : 'Disabled ❌'}`, `**FAQ Channel:** ${s.settings.channelId ? `<#${s.settings.channelId}>` : '`Not set`'}`, `**Team Inbox:** ${s.settings.inboxChannelId ? `<#${s.settings.inboxChannelId}>` : '`Not set`'}`, `**Manager Roles:** ${s.settings.managerRoleIds.length ? s.settings.managerRoleIds.map(id => `<@&${id}>`).join(', ') : '`None`'}`, `**Categories:** \`${Object.keys(s.categories).length}\``, `**Published FAQs:** \`${Object.keys(s.entries).length}\``, `**Open Questions:** \`${open}\``, `**Panel:** ${s.panel.messageId ? 'Deployed ✅' : 'Not deployed'}`].join('\n')).setFooter({ text: `Requested by ${displayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:faq:channel').setPlaceholder('Public FAQ channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:faq:inboxChannel').setPlaceholder('Private team FAQ inbox').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:faq:managerRoles').setPlaceholder('FAQ manager roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:faq:addCategory', '➕ Category', ButtonStyle.Primary), button('admin:faq:addEntry', '➕ FAQ', ButtonStyle.Primary), button('admin:faq:manage', '📚 Manage')),
    row(button('admin:faq:deploy', '🚀 Deploy FAQ', ButtonStyle.Success), button(enabled ? 'admin:faq:disable' : 'admin:faq:enable', enabled ? '⏸️ Disable' : '▶️ Enable'), button('admin:modules', '⬅️ Modules')),
  ] };
}

function buildCategoryModal(category = null) {
  const editing = Boolean(category);
  return new ModalBuilder().setCustomId(editing ? `admin:faq:modal:categoryEdit:${category.id}` : 'admin:faq:modal:category').setTitle(editing ? 'Edit FAQ Category' : 'Create FAQ Category').addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Category name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(category?.name || '')), row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200).setValue(category?.description || '')), row(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50).setValue(category?.emoji || '')));
}

function buildEntryModal(categories = [], entry = null) {
  const hint = categories.slice(0, 8).map(c => c.id).join(', ');
  const editing = Boolean(entry);
  return new ModalBuilder().setCustomId(editing ? `admin:faq:modal:entryEdit:${entry.id}` : 'admin:faq:modal:entry').setTitle(editing ? 'Edit FAQ' : 'Create FAQ').addComponents(row(new TextInputBuilder().setCustomId('category').setLabel('Category ID').setPlaceholder(hint.slice(0, 100)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(entry?.categoryId || '')), row(new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setValue(entry?.question || '')), row(new TextInputBuilder().setCustomId('answer').setLabel('Answer').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(entry?.answer || '')), row(new TextInputBuilder().setCustomId('keywords').setLabel('Keywords (comma separated)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setValue((entry?.keywords || []).join(', '))));
}

function buildManagePanel(guildId) {
  const cats = faq.listCategories(guildId);
  const entries = faq.listEntries(guildId);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('📚 FAQ Manager').setDescription(cats.length ? cats.map(c => `**${c.emoji || '❓'} ${c.name}** — ${entries.filter(e => e.categoryId === c.id).length} question(s)`).join('\n') : 'No FAQ categories created yet.');
  const components = [];
  if (cats.length) components.push(selectRow('admin:faq:manageCategory', 'Manage a category', cats.slice(0, 25).map(c => ({ label: c.name, value: c.id, description: `${entries.filter(e => e.categoryId === c.id).length} question(s)`, emoji: c.emoji || undefined }))));
  if (entries.length) components.push(selectRow('admin:faq:manageEntry', 'Manage an FAQ', entries.slice(0, 25).map(e => ({ label: e.question.slice(0, 100), value: e.id }))));
  components.push(row(button('admin:faq', '⬅️ FAQ Settings')));
  return { embeds: [embed], components };
}

function buildManageCategoryPanel(guildId, id) {
  const c = faq.getSection(guildId).categories[faq.cleanKey(id)];
  if (!c) return buildNotice('Category unavailable', 'That FAQ category no longer exists.');
  return { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${c.emoji || '❓'} ${c.name}`).setDescription([c.description || '_No description._', '', `**ID:** \`${c.id}\``, `**Questions:** \`${faq.listEntries(guildId, c.id).length}\``].join('\n'))], components: [row(button(`admin:faq:editCategory:${c.id}`, '✏️ Edit', ButtonStyle.Primary), button(`admin:faq:deleteCategory:${c.id}`, '🗑️ Delete', ButtonStyle.Danger)), row(button('admin:faq:manage', '⬅️ FAQ Manager'))] };
}

function buildManageEntryPanel(guildId, id) {
  const e = faq.getEntry(guildId, id);
  if (!e) return buildNotice('FAQ unavailable', 'That FAQ no longer exists.');
  const c = faq.getSection(guildId).categories[e.categoryId];
  return { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`❓ ${e.question}`).setDescription(e.answer || '_No answer configured._').addFields({ name: 'Category', value: c ? `${c.emoji || '❓'} ${c.name}` : `\`${e.categoryId}\``, inline: true }, { name: 'ID', value: `\`${e.id}\``, inline: true })], components: [row(button(`admin:faq:editEntry:${e.id}`, '✏️ Edit', ButtonStyle.Primary), button(`admin:faq:deleteEntry:${e.id}`, '🗑️ Delete', ButtonStyle.Danger)), row(button('admin:faq:manage', '⬅️ FAQ Manager'))] };
}

function buildDeleteConfirm(kind, id, label) {
  return { embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Confirm deletion').setDescription(`Delete **${label}**?\n\nThis cannot be undone.`)], components: [row(button(`admin:faq:confirmDelete:${kind}:${id}`, '🗑️ Delete', ButtonStyle.Danger), button(kind === 'category' ? `admin:faq:manageCategoryOpen:${id}` : `admin:faq:manageEntryOpen:${id}`, 'Cancel'))] };
}

module.exports = {
  buildHomePanel, buildCategoryPanel, buildAnswerPanel, buildSubmissionPreview,
  buildAskModal, buildSearchModal, buildSearchResults, buildSubmitted,
  buildTeamSubmission, buildAnswerModal, buildResourceModal, buildCategoryPicker,
  buildSupportPicker, buildPublishConfirm, buildAdminPanel, buildCategoryModal,
  buildEntryModal, buildManagePanel, buildManageCategoryPanel,
  buildManageEntryPanel, buildDeleteConfirm, buildNotice,
};