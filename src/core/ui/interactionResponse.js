const { MessageFlags } = require('discord.js');
const { errorEmbed } = require('./embeds');

// ✅ Generic safe reply
async function safeReply(interaction, payload = {}) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp({
        ...payload,
        flags: payload.flags ?? MessageFlags.Ephemeral
      });
    }

    return await interaction.reply(payload);
  } catch (error) {
    console.error('safeReply failed:', error);
    return null;
  }
}

// ✅ Generic safe update
async function safeUpdate(interaction, payload = {}) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }

    if (
      interaction.isButton?.() ||
      interaction.isStringSelectMenu?.() ||
      interaction.isUserSelectMenu?.()
    ) {
      return await interaction.update(payload);
    }

    return await safeReply(interaction, {
      ...payload,
      flags: payload.flags ?? MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('safeUpdate failed:', error);
    return null;
  }
}

// ✅ Generic safe edit reply
async function safeEditReply(interaction, payload = {}) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(payload);
    }

    return await safeReply(interaction, {
      ...payload,
      flags: payload.flags ?? MessageFlags.Ephemeral
    });
  } catch (error) {
    console.error('safeEditReply failed:', error);
    return null;
  }
}

// ❌ Simple ephemeral error response
function ephemeralError(content) {
  return {
    embeds: [errorEmbed(content)],
    flags: MessageFlags.Ephemeral
  };
}

module.exports = {
  safeReply,
  safeUpdate,
  safeEditReply,
  ephemeralError
};
