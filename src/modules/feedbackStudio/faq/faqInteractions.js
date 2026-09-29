'use strict';

const { MessageFlags } = require('discord.js');
const faq = require('./faq');
const panel = require('./faqPanel');
const tracking = require('./faqTracking');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

async function reply(interaction, payload) { const p = typeof payload === 'string' ? { content: payload } : { ...payload }; p.flags = MessageFlags.Ephemeral; if (interaction.deferred || interaction.replied) return interaction.followUp(p).catch(() => null); return interaction.reply(p).catch(() => null); }
async function update(interaction, payload) { if (interaction.deferred || interaction.replied) { await interaction.editReply(payload); return true; } await interaction.update(payload); return true; }
const displayName = i => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const field = (interaction, id) => interaction.fields.getTextInputValue(id);

async function handleMember(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('faq:') || !interaction.guildId) return false;
  try {
    if (!isModuleEnabled(interaction.guildId, 'faq')) throw new Error('FAQ is currently disabled on this server.');
    if (id === 'faq:home') { tracking.increment(interaction.guildId, 'views', interaction.guild); return update(interaction, panel.buildHomePanel(interaction.guildId)); }
    if (id.startsWith('faq:back:')) return update(interaction, panel.buildCategoryPanel(interaction.guildId, id.split(':')[2]));
    if (interaction.isStringSelectMenu?.() && id === 'faq:category') { tracking.increment(interaction.guildId, 'views', interaction.guild); return reply(interaction, panel.buildCategoryPanel(interaction.guildId, interaction.values[0])); }
    if (interaction.isStringSelectMenu?.() && id.startsWith('faq:question:')) { tracking.increment(interaction.guildId, 'views', interaction.guild); return update(interaction, panel.buildAnswerPanel(interaction.guildId, interaction.values[0])); }
    return false;
  } catch (error) { await reply(interaction, `❌ FAQ action failed: ${error.message}`); return true; }
}

async function handleAdmin(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:faq') || !interaction.guildId) return false;
  try {
    if (id === 'admin:faq') return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction)));
    if (id === 'admin:faq:addCategory') { await interaction.showModal(panel.buildCategoryModal()); return true; }
    if (id === 'admin:faq:addEntry') { await interaction.showModal(panel.buildEntryModal(faq.listCategories(interaction.guildId))); return true; }
    if (id === 'admin:faq:manage') return update(interaction, panel.buildManagePanel(interaction.guildId));

    if (interaction.isStringSelectMenu?.() && id === 'admin:faq:manageCategory') return update(interaction, panel.buildManageCategoryPanel(interaction.guildId, interaction.values[0]));
    if (interaction.isStringSelectMenu?.() && id === 'admin:faq:manageEntry') return update(interaction, panel.buildManageEntryPanel(interaction.guildId, interaction.values[0]));
    if (id.startsWith('admin:faq:manageCategoryOpen:')) return update(interaction, panel.buildManageCategoryPanel(interaction.guildId, id.split(':')[3]));
    if (id.startsWith('admin:faq:manageEntryOpen:')) return update(interaction, panel.buildManageEntryPanel(interaction.guildId, id.split(':')[3]));

    if (id.startsWith('admin:faq:editCategory:')) {
      const categoryId = id.split(':')[3];
      const category = faq.getSection(interaction.guildId).categories[faq.cleanKey(categoryId)];
      if (!category) throw new Error('That category no longer exists.');
      await interaction.showModal(panel.buildCategoryModal(category));
      return true;
    }
    if (id.startsWith('admin:faq:editEntry:')) {
      const entry = faq.getEntry(interaction.guildId, id.split(':')[3]);
      if (!entry) throw new Error('That FAQ no longer exists.');
      await interaction.showModal(panel.buildEntryModal(faq.listCategories(interaction.guildId), entry));
      return true;
    }
    if (id.startsWith('admin:faq:deleteCategory:')) {
      const category = faq.getSection(interaction.guildId).categories[faq.cleanKey(id.split(':')[3])];
      if (!category) throw new Error('That category no longer exists.');
      return update(interaction, panel.buildDeleteConfirm('category', category.id, category.name));
    }
    if (id.startsWith('admin:faq:deleteEntry:')) {
      const entry = faq.getEntry(interaction.guildId, id.split(':')[3]);
      if (!entry) throw new Error('That FAQ no longer exists.');
      return update(interaction, panel.buildDeleteConfirm('entry', entry.id, entry.question));
    }
    if (id.startsWith('admin:faq:confirmDelete:')) {
      const [, , , kind, targetId] = id.split(':');
      if (kind === 'category') faq.deleteCategory(interaction.guildId, targetId, interaction.guild);
      else if (kind === 'entry') faq.deleteEntry(interaction.guildId, targetId, interaction.guild);
      else throw new Error('Unknown FAQ item type.');
      return update(interaction, panel.buildManagePanel(interaction.guildId));
    }

    if (interaction.isChannelSelectMenu?.() && id === 'admin:faq:channel') { const value = interaction.values?.[0] || null; faq.updateSection(interaction.guildId, s => ({ ...s, settings: { ...s.settings, channelId: value } }), interaction.guild); return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction))); }
    if (interaction.isRoleSelectMenu?.() && id === 'admin:faq:managerRoles') { faq.updateSection(interaction.guildId, s => ({ ...s, settings: { ...s.settings, managerRoleIds: [...new Set(interaction.values || [])] } }), interaction.guild); return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction))); }
    if (id === 'admin:faq:enable') { setModuleEnabled(interaction.guildId, 'faq', true, { actorId: interaction.user.id, action: 'faq_admin_enable' }); return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction))); }
    if (id === 'admin:faq:disable') { setModuleEnabled(interaction.guildId, 'faq', false, { actorId: interaction.user.id, action: 'faq_admin_disable' }); return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction))); }
    if (id === 'admin:faq:deploy') { await interaction.deferUpdate().catch(() => null); await tracking.deploy(interaction.guild, interaction.user.id); return update(interaction, panel.buildAdminPanel(interaction.guild, displayName(interaction))); }

    if (interaction.isModalSubmit?.() && id === 'admin:faq:modal:category') { faq.saveCategory(interaction.guildId, { name: field(interaction, 'name'), description: field(interaction, 'description'), emoji: field(interaction, 'emoji') }, interaction.guild); return reply(interaction, '✅ FAQ category created.'); }
    if (interaction.isModalSubmit?.() && id === 'admin:faq:modal:entry') { const categoryId = faq.cleanKey(field(interaction, 'category')); if (!faq.getSection(interaction.guildId).categories[categoryId]) throw new Error('That category ID does not exist.'); faq.saveEntry(interaction.guildId, { categoryId, question: field(interaction, 'question'), answer: field(interaction, 'answer'), keywords: field(interaction, 'keywords').split(',').map(x => x.trim()).filter(Boolean) }, interaction.guild); return reply(interaction, '✅ FAQ created.'); }

    if (interaction.isModalSubmit?.() && id.startsWith('admin:faq:modal:categoryEdit:')) {
      const categoryId = faq.cleanKey(id.split(':')[4]);
      const existing = faq.getSection(interaction.guildId).categories[categoryId];
      if (!existing) throw new Error('That category no longer exists.');
      faq.saveCategory(interaction.guildId, { ...existing, id: categoryId, name: field(interaction, 'name'), description: field(interaction, 'description'), emoji: field(interaction, 'emoji'), updatedAt: new Date().toISOString() }, interaction.guild);
      return reply(interaction, '✅ FAQ category updated.');
    }
    if (interaction.isModalSubmit?.() && id.startsWith('admin:faq:modal:entryEdit:')) {
      const entryId = faq.cleanKey(id.split(':')[4]);
      const existing = faq.getEntry(interaction.guildId, entryId);
      if (!existing) throw new Error('That FAQ no longer exists.');
      const categoryId = faq.cleanKey(field(interaction, 'category'));
      if (!faq.getSection(interaction.guildId).categories[categoryId]) throw new Error('That category ID does not exist.');
      faq.saveEntry(interaction.guildId, { ...existing, id: entryId, categoryId, question: field(interaction, 'question'), answer: field(interaction, 'answer'), keywords: field(interaction, 'keywords').split(',').map(x => x.trim()).filter(Boolean), updatedAt: new Date().toISOString() }, interaction.guild);
      return reply(interaction, '✅ FAQ updated.');
    }
    return false;
  } catch (error) { await reply(interaction, `❌ FAQ setup failed: ${error.message}`); return true; }
}

async function handleFaqInteraction(interaction) { if (await handleAdmin(interaction)) return true; return handleMember(interaction); }
module.exports = { handleFaqInteraction, handleFaqAdminInteraction: handleAdmin, handleMemberInteraction: handleMember, handleAdminInteraction: handleAdmin };
