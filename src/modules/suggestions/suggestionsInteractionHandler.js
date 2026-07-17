'use strict';

const { MessageFlags } = require('discord.js');
const suggestionsManager = require('./suggestionsManager');

function isSuggestionsInteraction(interaction) {
  return String(interaction?.customId || '').startsWith('suggestions:');
}

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

async function handleSuggestionsInteraction(interaction) {
  if (!interaction?.guildId || !isSuggestionsInteraction(interaction)) return false;

  try {
    const parts = String(interaction.customId || '').split(':');

    if (interaction.isButton?.() && interaction.customId === 'suggestions:submit') {
      await interaction.showModal(suggestionsManager.buildSubmitModal());
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'suggestions:modal:submit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await suggestionsManager.submitSuggestion(interaction);
      await interaction.editReply({ content: '✅ Suggestion submitted.' });
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'vote') {
      if (!parts[2] || !['up', 'down'].includes(parts[3])) throw new Error('Invalid vote interaction.');
      await interaction.deferUpdate();
      await suggestionsManager.vote(interaction, parts[2], parts[3]);
      return true;
    }

    if (interaction.isButton?.() && parts[1] === 'review') {
      if (!parts[2] || !['approve', 'deny'].includes(parts[3])) throw new Error('Invalid review interaction.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await suggestionsManager.review(interaction, parts[2], parts[3]);
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

module.exports = {
  isSuggestionsInteraction,
  handleSuggestionsInteraction,
};