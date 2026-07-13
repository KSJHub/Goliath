'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function backRow() {
  return [row(new ButtonBuilder().setCustomId('admin:modules').setLabel('⬅️ Modules').setStyle(ButtonStyle.Secondary))];
}

function basicEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

const definitions = Object.freeze({
  verification: {
    key: 'verification',
    menu: {
      buildVerificationMenuEmbed: (guildId) => basicEmbed('✅ Verification', `Manage Verification for guild \`${guildId}\` from the current dedicated Admin panel.`),
      buildVerificationMenuRows: backRow,
    },
  },
  autoRoles: {
    key: 'autoRoles',
    menu: {
      buildAutoRolesEmbed: (guildId) => basicEmbed('🎭 Auto Roles', `Manage Auto Roles for guild \`${guildId}\` from the current dedicated Admin panel.`),
      buildAutoRolesMenuRows: backRow,
    },
  },
  giveaways: {
    key: 'giveaways',
    menu: {
      buildGiveawayMenuEmbed: (guildId) => basicEmbed('🎉 Giveaways', `Manage Giveaways for guild \`${guildId}\`.`),
      buildGiveawayMenuRows: backRow,
    },
  },
  starboard: {
    key: 'starboard',
    menu: {
      buildStarboardEmbed: (guildId) => basicEmbed('⭐ Starboard', `Manage Starboard for guild \`${guildId}\` from the current dedicated Admin panel.`),
      buildStarboardMenuRows: backRow,
    },
  },
  tempVoice: {
    key: 'tempVoice',
    menu: {
      buildTempVoiceEmbed: (guildId) => basicEmbed('🎤 Temp Voice', `Manage Temp Voice for guild \`${guildId}\` from the current dedicated Admin panel.`),
      buildTempVoiceMenuRows: backRow,
    },
  },
  sticky: {
    key: 'sticky',
    menu: {
      buildStickyStatusEmbed: (guildId, channelId) => basicEmbed('📌 Sticky Messages', `Manage Sticky Messages for guild \`${guildId}\`${channelId ? ` in <#${channelId}>` : ''}.`),
      buildStickyMenuRows: backRow,
    },
  },
  suggestions: {
    key: 'suggestions',
    menu: {
      buildSuggestionListEmbed: (guildId) => basicEmbed('💡 Suggestions', `Manage Suggestions for guild \`${guildId}\`.`),
      buildSuggestionMenuRows: backRow,
    },
  },
});

function getModuleDefinition(moduleKey) {
  return definitions[String(moduleKey || '').trim()] || null;
}

function requireModuleDefinition(moduleKey) {
  const definition = getModuleDefinition(moduleKey);
  if (!definition) throw new Error(`Unknown Admin module: ${moduleKey}`);
  return definition;
}

function listModuleDefinitions() {
  return Object.values(definitions);
}

module.exports = {
  definitions,
  getModuleDefinition,
  requireModuleDefinition,
  listModuleDefinitions,
};
