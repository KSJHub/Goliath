'use strict';

const { MessageFlags } = require('discord.js');
const giveawaysStore = require('./giveawaysStore');
const guildManager = require('../../../core/guild/guildManager');
const giveawaysManager = require('./giveawaysManager');
const giveawaysPanel = require('./giveawaysAdminPanel');

function getMemberDisplayName(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function save(guild, updater) { return giveawaysStore.updateSection(guild.id, updater, guild); }
async function safeUpdate(interaction, payload) { if (interaction.deferred || interaction.replied) { await interaction.editReply(payload); return true; } await interaction.update(payload); return true; }

function numericField(interaction, id, max = Number.MAX_SAFE_INTEGER) {
  const raw = interaction.fields.getTextInputValue(id).trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error(`${id} must be a number between 0 and ${max}.`);
  return Math.floor(value);
}

async function handleGiveawaysAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:giveaways')) return false;
  const memberDisplayName = getMemberDisplayName(interaction);
  try {
    if (customId === 'admin:giveaways') return safeUpdate(interaction, giveawaysPanel.buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    if (customId === 'admin:giveaways:levelingEligibility') {
      return safeUpdate(interaction, giveawaysPanel.buildLevelingEligibilityPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:giveaways:levelingEligibility:configure' && interaction.isButton?.()) {
      await interaction.showModal(giveawaysPanel.buildLevelingEligibilityModal(giveawaysStore.getSection(interaction.guildId)));
      return true;
    }
    if (customId === 'admin:giveaways:levelingEligibility:toggle') {
      save(interaction.guild, (section) => ({
        ...section,
        levelingEligibility: {
          ...(section.levelingEligibility || {}),
          enabled: section.levelingEligibility?.enabled !== true,
        },
      }));
      return safeUpdate(interaction, giveawaysPanel.buildLevelingEligibilityPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:giveaways:levelingEligibility:toggleActive') {
      save(interaction.guild, (section) => ({
        ...section,
        levelingEligibility: {
          ...(section.levelingEligibility || {}),
          activeOnly: section.levelingEligibility?.activeOnly === false,
        },
      }));
      return safeUpdate(interaction, giveawaysPanel.buildLevelingEligibilityPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:giveaways:levelingEligibility:configure:submit' && interaction.isModalSubmit?.()) {
      const minLevel = numericField(interaction, 'minLevel', 100000);
      const minXp = numericField(interaction, 'minXp', 1_000_000_000);
      const top = numericField(interaction, 'top', 500);
      const sortBy = interaction.fields.getTextInputValue('sortBy').trim().toLowerCase();
      if (!['xp', 'level', 'messages', 'voice'].includes(sortBy)) throw new Error('sortBy must be xp, level, messages or voice.');
      save(interaction.guild, (section) => ({
        ...section,
        levelingEligibility: {
          ...(section.levelingEligibility || {}),
          minLevel,
          minXp,
          top,
          sortBy,
          activeOnly: section.levelingEligibility?.activeOnly !== false,
        },
      }));
      return safeUpdate(interaction, giveawaysPanel.buildLevelingEligibilityPanel(interaction.guild, memberDisplayName));
    }
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'announcementChannel') save(interaction.guild, (section) => ({ ...section, announcementChannelId: value }));
      if (prop === 'logChannel') save(interaction.guild, (section) => ({ ...section, logChannelId: value }));
      return safeUpdate(interaction, giveawaysPanel.buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:giveaways:managerRoles') {
      save(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }));
      return safeUpdate(interaction, giveawaysPanel.buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:giveaways:enable') {
      guildManager.setModuleEnabled(interaction.guild.id, 'giveaways', true);
    }
    if (customId === 'admin:giveaways:disable') {
      guildManager.setModuleEnabled(interaction.guild.id, 'giveaways', false);
    }
    if (customId === 'admin:giveaways:toggleMultiple') save(interaction.guild, (section) => ({ ...section, allowMultipleEntries: !section.allowMultipleEntries }));
    if (customId === 'admin:giveaways:toggleRequireRole') save(interaction.guild, (section) => ({ ...section, requireRole: !section.requireRole }));
    if (customId === 'admin:giveaways:togglePing') save(interaction.guild, (section) => ({ ...section, pingWinners: !section.pingWinners }));
    if (customId === 'admin:giveaways:deployTest') {
      await interaction.deferUpdate().catch(() => null);
      await giveawaysManager.deployTestGiveaway(interaction.guild, interaction.user.id);
    }
    return safeUpdate(interaction, giveawaysPanel.buildGiveawaysAdminPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Giveaways setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

function isGiveawayInteraction(interaction) { return String(interaction?.customId || '').startsWith('giveaways:'); }
async function safeReply(interaction, content) { const payload = { content, flags: MessageFlags.Ephemeral }; if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => null); return interaction.reply(payload).catch(() => null); }
async function handleGiveawayInteraction(interaction) {
  if (!interaction?.guildId || !isGiveawayInteraction(interaction)) return false;
  try {
    if (!guildManager.isModuleEnabled(interaction.guildId, 'giveaways')) {
      await safeReply(interaction, '❌ Giveaways are disabled in this server.');
      return true;
    }
    const [, action, giveawayId] = String(interaction.customId || '').split(':');
    if (interaction.isButton?.() && action === 'enter') { await interaction.deferUpdate().catch(() => null); await giveawaysManager.enterGiveaway(interaction, giveawayId); await safeReply(interaction, '✅ You entered the giveaway.'); return true; }
    if (interaction.isButton?.() && action === 'end') { await interaction.deferUpdate().catch(() => null); await giveawaysManager.endGiveaway(interaction, giveawayId); await safeReply(interaction, '✅ Giveaway ended.'); return true; }
    return false;
  } catch (error) { await safeReply(interaction, `❌ Giveaway action failed: ${error.message}`); return true; }
}

module.exports = { isGiveawayInteraction, handleGiveawayInteraction, handleGiveawaysAdminInteraction };