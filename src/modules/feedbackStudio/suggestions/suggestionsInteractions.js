'use strict';

const { MessageFlags } = require('discord.js');
const suggestions = require('./suggestions');
const panel = require('./suggestionsPanel');
const tracking = require('./suggestionsTracking');
const { setModuleEnabled } = require('../../../core/guild/guildManager');

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) return await interaction.editReply({ content });
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (error) {
    console.error('[Suggestions] Failed to respond to interaction:', error);
    return null;
  }
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

function withoutReplyFlags(payload = {}) {
  const { flags, ephemeral, ...rest } = payload;
  return rest;
}

async function handleSuggestionsAdminInteraction(interaction) {
  const id = String(interaction?.customId || '');
  if (!id.startsWith('admin:suggestions')) return false;
  const memberName = interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
  const save = (updater) => suggestions.updateSection(interaction.guild.id, updater, interaction.guild);
  try {
    if (id === 'admin:suggestions' || id === 'admin:suggestions:overview') return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'overview'));
    if (id === 'admin:suggestions:destinations') return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'destinations'));
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const property = id.split(':')[2];
      if (['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel'].includes(property)) {
        save((section) => ({ ...section, [`${property}Id`]: value }));
        const page = ['approvedChannel', 'deniedChannel'].includes(property) ? 'destinations' : 'overview';
        return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, page));
      }
    } else if (interaction.isRoleSelectMenu?.() && id === 'admin:suggestions:reviewerRoles') {
      save((section) => ({ ...section, reviewerRoleIds: [...new Set(interaction.values || [])] }));
    } else if (id === 'admin:suggestions:enable') setModuleEnabled(interaction.guild.id, 'suggestions', true, interaction.guild);
    else if (id === 'admin:suggestions:disable') setModuleEnabled(interaction.guild.id, 'suggestions', false, interaction.guild);
    else if (id === 'admin:suggestions:toggleVoting') save((section) => ({ ...section, voting: !section.voting }));
    else if (id === 'admin:suggestions:toggleReview') save((section) => ({ ...section, requireReview: !section.requireReview }));
    else if (id === 'admin:suggestions:toggleAnonymous') save((section) => ({ ...section, anonymous: !section.anonymous }));
    else if (id === 'admin:suggestions:deploy') {
      await interaction.deferUpdate().catch(() => null);
      await panel.deploySubmitPanel(interaction.guild);
    }
    return safeUpdate(interaction, panel.buildSuggestionsAdminPanel(interaction.guild, memberName, 'overview'));
  } catch (error) {
    await safeReply(interaction, `❌ Suggestions setup failed: ${error.message}`);
    return true;
  }
}

async function handleSuggestionsInteraction(interaction) {
  if (!interaction?.guildId || !String(interaction.customId || '').startsWith('suggestions:')) return false;
  try {
    const parts = String(interaction.customId || '').split(':');
    if (interaction.isButton?.() && interaction.customId === 'suggestions:submit') {
      await interaction.showModal(panel.buildSubmitModal());
      return true;
    }
    if (interaction.isButton?.() && parts[1] === 'mine' && parts[2] === 'page') {
      const payload = panel.buildMySuggestionsPayload(interaction.guildId, interaction.user.id, Number(parts[3] || 0));
      if (interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) await interaction.update(withoutReplyFlags(payload));
      else await interaction.reply(payload);
      return true;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId === 'suggestions:mine:select') {
      const [suggestionId, page = '0'] = String(interaction.values?.[0] || '').split('|');
      await interaction.update(withoutReplyFlags(panel.buildMySuggestionDetail(interaction.guildId, interaction.user.id, suggestionId, Number(page || 0))));
      return true;
    }
    if (interaction.isButton?.() && interaction.customId === 'suggestions:mine:close') {
      await interaction.deferUpdate().catch(() => null);
      await interaction.deleteReply().catch(() => null);
      return true;
    }
    if (interaction.isModalSubmit?.() && interaction.customId === 'suggestions:modal:submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const saved = await tracking.submitSuggestion(interaction, panel);
      await interaction.editReply({ content: `✅ Suggestion submitted. ID: \`${saved.suggestionId}\`` });
      return true;
    }
    if (interaction.isButton?.() && parts[1] === 'vote') {
      if (!parts[2] || !['up', 'down'].includes(parts[3])) throw new Error('Invalid vote interaction.');
      await interaction.deferUpdate();
      await tracking.vote(interaction, parts[2], parts[3], panel);
      return true;
    }
    if (interaction.isButton?.() && parts[1] === 'review') {
      if (!parts[2] || !['approve', 'deny'].includes(parts[3])) throw new Error('Invalid review interaction.');
      const section = tracking.assertEnabled(interaction.guildId);
      if (!tracking.isReviewer(interaction.member, section)) throw new Error('You do not have permission to review suggestions.');
      const current = suggestions.getSuggestion(interaction.guildId, parts[2]);
      if (!current) throw new Error('Suggestion not found.');
      if (current.status !== 'pending') throw new Error(`Suggestion is already ${current.status}.`);
      await interaction.showModal(panel.buildReviewModal(parts[2], parts[3]));
      return true;
    }
    if (interaction.isModalSubmit?.() && parts[1] === 'reviewModal') {
      if (!parts[2] || !['approve', 'deny'].includes(parts[3])) throw new Error('Invalid review interaction.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = String(interaction.fields.getTextInputValue('reason') || '').trim();
      await tracking.review(interaction, parts[2], parts[3], panel, reason);
      await interaction.editReply({ content: `✅ Suggestion ${parts[3] === 'approve' ? 'approved' : 'denied'}.` });
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Suggestions] Interaction failed:', error);
    await safeReply(interaction, `❌ Suggestion action failed: ${error.message || 'Unknown error'}`);
    return true;
  }
}

module.exports = { handleSuggestionsAdminInteraction, handleSuggestionsInteraction };
