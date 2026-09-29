'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const faq = require('./faq');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const row = (...items) => new ActionRowBuilder().addComponents(...items);
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

function buildHomePanel(guildId) {
  const categories = faq.listCategories(guildId).slice(0,25);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('❓ FAQ & Support Centre').setDescription(['**Frequently Asked Questions**','','The quickest place to find answers to common questions about the server, community and support.','','Select an FAQ category below to get started. 👇'].join('\n'));
  const components = [];
  if (categories.length) components.push(row(new StringSelectMenuBuilder().setCustomId('faq:category').setPlaceholder('Select an FAQ category').addOptions(categories.map(c => ({ label: c.name.slice(0,100), description: (c.description || 'View questions').slice(0,100), value: c.id, emoji: c.emoji || undefined }))));
  return { embeds: [embed], components };
}

function buildCategoryPanel(guildId, categoryId) {
  const category = faq.listCategories(guildId).find(c => c.id === faq.cleanKey(categoryId));
  if (!category) return buildNotice('FAQ category unavailable', 'This category is no longer available.');
  const entries = faq.listEntries(guildId, category.id).slice(0,25);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${category.emoji || '❓'} ${category.name}`).setDescription(category.description || 'Select a question below.');
  const components = [];
  if (entries.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`faq:question:${category.id}`).setPlaceholder('Select a question').addOptions(entries.map(e => ({ label: e.question.slice(0,100), value: e.id }))));
  components.push(row(button('faq:home','🏠 FAQ Home')));
  return { embeds:[embed], components };
}

function buildAnswerPanel(guildId, entryId) {
  const entry = faq.getEntry(guildId, entryId);
  if (!entry) return buildNotice('FAQ unavailable','This FAQ is no longer available.');
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`❓ ${entry.question}`).setDescription(entry.answer || '_No answer has been configured._').setFooter({ text:'Goliath FAQ' });
  return { embeds:[embed], components:[row(button(`faq:back:${entry.categoryId}`,'⬅️ Back'),button('faq:home','🏠 FAQ Home'))] };
}

function buildNotice(title, description) { return { embeds:[new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(description)], components:[] }; }

function buildAdminPanel(guild, displayName='Unknown User') {
  const s = faq.getSection(guild.id); const enabled = isModuleEnabled(guild.id,'faq');
  const embed = new EmbedBuilder().setColor(enabled ? 0x57f287 : 0x5865f2).setTitle('❓ FAQ').setDescription(['Configure the server FAQ knowledge base and deploy the member panel.','',`**Status:** ${enabled ? 'Enabled ✅':'Disabled ❌'}`,`**FAQ Channel:** ${s.settings.channelId ? `<#${s.settings.channelId}>`:'`Not set`'}`,`**Manager Roles:** ${s.settings.managerRoleIds.length ? s.settings.managerRoleIds.map(id=>`<@&${id}>`).join(', '):'`None`'}`,`**Categories:** \`${Object.keys(s.categories).length}\``,`**Questions:** \`${Object.keys(s.entries).length}\``,`**Panel:** ${s.panel.messageId ? 'Deployed ✅':'Not deployed'}`].join('\n')).setFooter({text:`Requested by ${displayName}`}).setTimestamp();
  return { embeds:[embed], components:[
    row(new ChannelSelectMenuBuilder().setCustomId('admin:faq:channel').setPlaceholder('FAQ channel').setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:faq:managerRoles').setPlaceholder('FAQ manager roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:faq:addCategory','➕ Category',ButtonStyle.Primary),button('admin:faq:addEntry','➕ FAQ',ButtonStyle.Primary),button('admin:faq:manage','📚 Manage',ButtonStyle.Secondary)),
    row(button('admin:faq:deploy','🚀 Deploy FAQ',ButtonStyle.Success),button(enabled?'admin:faq:disable':'admin:faq:enable',enabled?'⏸️ Disable':'▶️ Enable',ButtonStyle.Secondary)),
    row(button('admin:modules','⬅️ Modules',ButtonStyle.Secondary)),
  ]};
}

function buildCategoryModal() { return new ModalBuilder().setCustomId('admin:faq:modal:category').setTitle('Create FAQ Category').addComponents(row(new TextInputBuilder().setCustomId('name').setLabel('Category name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200)),row(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)));
}

function buildEntryModal(categories=[]) { const hint = categories.slice(0,8).map(c=>c.id).join(', '); return new ModalBuilder().setCustomId('admin:faq:modal:entry').setTitle('Create FAQ').addComponents(row(new TextInputBuilder().setCustomId('category').setLabel('Category ID').setPlaceholder(hint.slice(0,100)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),row(new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),row(new TextInputBuilder().setCustomId('answer').setLabel('Answer').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),row(new TextInputBuilder().setCustomId('keywords').setLabel('Keywords (comma separated)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)));
}

function buildManagePanel(guildId) { const cats=faq.listCategories(guildId); const entries=faq.listEntries(guildId); const embed=new EmbedBuilder().setColor(0x5865f2).setTitle('📚 FAQ Manager').setDescription(cats.length?cats.map(c=>`**${c.emoji||'❓'} ${c.name}** — ${entries.filter(e=>e.categoryId===c.id).length} question(s)`).join('\n'):'No FAQ categories created yet.'); return {embeds:[embed],components:[row(button('admin:faq','⬅️ FAQ Settings'))]}; }

module.exports={ buildHomePanel, buildCategoryPanel, buildAnswerPanel, buildAdminPanel, buildCategoryModal, buildEntryModal, buildManagePanel, buildNotice };
