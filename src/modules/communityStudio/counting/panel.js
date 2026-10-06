'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const counting = require('./counting');
const countingHealth = require('./countingHealth');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const PREFIX = 'admin:module:counting';
const PANEL_COLOR = 0x2f80ed;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary, disabled = false) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style).setDisabled(disabled);
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';

function formatTurnLimit(value) {
  if (value === null || value === undefined || value === '') return 'Unlimited';
  if (Number(value) === 1) return '1 turn per member';
  return `Up to ${value} turns per member`;
}
function formatHintThreshold(value) {
  if (value === null || value === undefined || value === '') return 'Never reveal';
  return `After ${value} mistake${Number(value) === 1 ? '' : 's'}`;
}
function formatFailureLimit(value) {
  if (!Number(value)) return 'Off — mistakes do not reset the run';
  if (Number(value) === 1) return '1 wrong answer — sudden death';
  return `${value} wrong answers before reset`;
}
function formatCleanup(value) {
  if (value === null || value === undefined || value === '') return 'Keep replies';
  return `Delete after ${value}s`;
}
function footer(embed) { return embed.setFooter({ text: 'Goliath Counting' }).setTimestamp(); }
function channelSelector(section) {
  return new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel`).setPlaceholder(section.channelId ? 'Change the counting channel' : 'Choose the counting channel').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1);
}

function buildPanel(guild, memberDisplayName = 'Unknown User') {
  const section = counting.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, counting.MODULE_KEY);
  const hasChannel = Boolean(section.channelId);
  const channel = hasChannel ? `<#${section.channelId}>` : '**Not chosen yet**';
  const lastCounter = section.lastCounterId ? `<@${section.lastCounterId}>` : 'Nobody yet';
  const embed = footer(new EmbedBuilder().setColor(PANEL_COLOR).setTitle('🔢 Counting').setDescription([
    'Set up and manage your server’s counting game from one place.', '',
    `**${enabled ? '🟢 Running' : '⚪ Disabled'}** • ${channel}`,
    !hasChannel ? '\n⚠️ **Choose a counting channel first.** Goliath will unlock **Enable** and **Player Panel** once a channel is selected.' : '',
  ].filter(Boolean).join('\n')).addFields(
    { name: '📊 Current Game', value: [`**Current:** \`${section.currentCount}\`  •  **Next:** \`${counting.expectedNext(section)}\`  •  **Record:** \`${section.highestCount}\``, `**Last Counter:** ${lastCounter}`].join('\n') },
    { name: '🎮 Rules', value: [
      `**Start At:** \`${section.startingNumber}\``, `**Turns:** ${formatTurnLimit(section.maxConsecutivePerMember)}`,
      `**Hint:** ${formatHintThreshold(section.answerAfterFailures)}`, `**Game Over:** ${formatFailureLimit(section.failureLimit)}`,
      `**Numbers Only:** ${section.numbersOnly ? 'On ✅ — non-counting messages are removed' : 'Off — normal chat is allowed'}`,
      `**Wrong Counts:** ${section.deleteIncorrect ? 'Deleted ✅' : 'Kept'}`,
      `**Milestones:** ${section.milestoneAnnouncements ? `Every ${section.milestoneInterval} 🎉` : 'Off'}`,
    ].join('\n') },
    { name: '💬 Goliath Responses', value: [`**Banter:** ${section.funnyResponses ? 'On 😂 — playful rotating reactions' : 'Off — simple responses'}`, `**Reply Timing:** ${formatCleanup(section.responseCleanupSeconds)}`].join('\n') },
    { name: '🧭 What the controls do', value: [
      '**Game Rules** changes where the game starts, turns per member and when hints appear.',
      '**Set Count** moves the current game to a specific number without changing your setup.',
      '**Milestones** controls celebrations and how often they happen.',
      '**Player Panel** posts or refreshes the member-friendly instructions in the counting channel.',
      '**Reset** ends the current run and starts again without changing your channel or rules.',
    ].join('\n') },
  ));
  return { content: null, embeds: [embed], components: [
    row(channelSelector(section)),
    row(button(`${PREFIX}:rules:edit`, '⚙️ Game Rules', ButtonStyle.Primary), button(`${PREFIX}:setCurrent`, '🎯 Set Count', ButtonStyle.Secondary), button(`${PREFIX}:milestones`, '🎉 Milestones', ButtonStyle.Secondary)),
    row(button(`${PREFIX}:toggle:numbersOnly`, section.numbersOnly ? '🔢 Numbers Only: On' : '🔢 Numbers Only: Off', ButtonStyle.Secondary), button(`${PREFIX}:toggle:delete`, section.deleteIncorrect ? '🗑️ Wrong Counts: Delete' : '🗑️ Wrong Counts: Keep', ButtonStyle.Secondary)),
    row(button(`${PREFIX}:toggle:funny`, section.funnyResponses ? '😂 Banter: On' : '😂 Banter: Off', ButtonStyle.Secondary), button(`${PREFIX}:responses:timing`, '⏱️ Reply Timing', ButtonStyle.Secondary), button(`${PREFIX}:playerPanel`, section.playerPanelMessageId ? '📢 Update Player Panel' : '📢 Player Panel', ButtonStyle.Secondary, !hasChannel)),
    row(button(`${PREFIX}:toggle:enabled`, enabled ? '⏸️ Disable' : '▶️ Enable', enabled ? ButtonStyle.Secondary : ButtonStyle.Success, !hasChannel && !enabled), button(`${PREFIX}:health`, '🩺 Health', ButtonStyle.Secondary), button(`${PREFIX}:reset`, '♻️ Reset', ButtonStyle.Danger), button('admin:studio:communityStudio', '⬅️ Back', ButtonStyle.Secondary)),
  ] };
}

function buildChannelScreen(guild, memberDisplayName) { return buildPanel(guild, memberDisplayName); }
function buildRulesScreen(guild, memberDisplayName) { return buildPanel(guild, memberDisplayName); }
function buildResponsesScreen(guild, memberDisplayName) { return buildPanel(guild, memberDisplayName); }
function textInput(customId, label, value, { required = false, placeholder = null } = {}) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required);
  if (value !== null && value !== undefined && value !== '') input.setValue(String(value));
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}
function buildRulesModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:rules:save`).setTitle('Counting Game Rules').addComponents(
    row(textInput('startingNumber', 'Start at — default 1', section.startingNumber, { required: true, placeholder: 'Number a new/reset game begins from' })),
    row(textInput('maxConsecutive', 'Turns per member — blank = unlimited', section.maxConsecutivePerMember, { placeholder: '1 = one turn, 3 = up to three turns' })),
    row(textInput('answerAfter', 'Hint after mistakes — blank = never', section.answerAfterFailures, { placeholder: '2 = reveal the answer after two mistakes' })),
    row(textInput('failureLimit', 'Wrong answers before reset — 0 = off', section.failureLimit, { required: true, placeholder: '0 = off, 1 = sudden death, 3 = reset on third' })),
  );
}
function buildTimingModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:responses:timing:save`).setTitle('Goliath Reply Timing').addComponents(row(textInput('cleanupSeconds', 'Keep replies for seconds', section.responseCleanupSeconds, { placeholder: '8 = delete after 8s; blank = keep' })));
}
function buildSetCurrentModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:setCurrent:save`).setTitle('Set Current Count').addComponents(row(textInput('currentCount', 'Game has currently reached', section.currentCount, { required: true, placeholder: 'Example: 50 means the next count must be 51' })));
}
function buildMilestonesModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:milestones:save`).setTitle('Counting Milestones').addComponents(
    row(textInput('enabled', 'Milestones — on or off', section.milestoneAnnouncements ? 'on' : 'off', { required: true, placeholder: 'on or off' })),
    row(textInput('interval', 'Celebrate every how many counts?', section.milestoneInterval, { required: true, placeholder: '100 = 100, 200, 300...' })),
  );
}
function buildCleanupConfirmation(channelId, mode = 'move') {
  const mention = `<#${channelId}>`;
  const reset = mode === 'reset';
  return { content: [
    '🧹 **Clean up the previous Counting messages?**', '',
    reset ? `Would you like Goliath to remove the previous game messages from ${mention} before starting again?` : `Counting has moved. Would you like Goliath to remove the old Counting messages from ${mention}?`,
    '', 'This cleanup is restricted to this Counting channel only.', '**Deleted messages cannot be recovered.**',
  ].join('\n'), embeds: [], components: [row(
    button(`${PREFIX}:cleanup:${reset ? 'reset' : 'move'}:yes:${channelId}`, reset ? '🗑️ Yes, Clear Previous Game' : '🗑️ Yes, Clean Up', ButtonStyle.Danger),
    button(`${PREFIX}:cleanup:${reset ? 'reset' : 'move'}:no:${channelId}`, '➡️ No, Keep Messages', ButtonStyle.Secondary),
  )] };
}
function buildResetConfirmation(guildId) {
  const section = counting.getSection(guildId);
  return { content: ['⚠️ **Start the counting game again?**', '', `This ends the current run and starts again from **${section.startingNumber}**.`, '', 'Goliath will replace the current player panel with one **COUNTING — RESET** panel in the counting channel. Everything above it belongs to the previous run.', '', 'Your counting channel and configured rules stay exactly as they are.', '', '**This cannot be undone.**'].join('\n'), embeds: [], components: [row(button(`${PREFIX}:reset:confirm`, '🔄 Yes, Start Again', ButtonStyle.Danger), button(`${PREFIX}:main:0`, 'Cancel', ButtonStyle.Secondary))] };
}
function parseRequiredInteger(interaction, fieldId, label, min = 0) {
  const raw = interaction.fields.getTextInputValue(fieldId).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${label} must be ${min} or higher.`);
  return value;
}
function parseOptionalPositiveInteger(interaction, fieldId, label) {
  const raw = interaction.fields.getTextInputValue(fieldId).trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number or left blank.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be 1 or higher, or left blank.`);
  return value;
}
function parseOnOff(interaction, fieldId, label) {
  const raw = interaction.fields.getTextInputValue(fieldId).trim().toLowerCase();
  if (['on', 'yes', 'true', 'enabled', 'enable'].includes(raw)) return true;
  if (['off', 'no', 'false', 'disabled', 'disable'].includes(raw)) return false;
  throw new Error(`${label} must be On or Off.`);
}
async function safeUpdate(interaction, payload) { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
async function handleInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  const name = displayName(interaction);
  const actorId = interaction.user?.id || null;
  try {
    if (id === `${PREFIX}:main:0`) return safeUpdate(interaction, buildPanel(interaction.guild, name));
    if (id === `${PREFIX}:channel:screen` || id === `${PREFIX}:rules:screen` || id === `${PREFIX}:responses:screen`) return safeUpdate(interaction, buildPanel(interaction.guild, name));
    if (interaction.isChannelSelectMenu?.() && id === `${PREFIX}:channel`) {
      const channelId = interaction.values?.[0] || null;
      const before = counting.getSection(interaction.guild.id);
      await counting.changeChannel(interaction.guild, channelId, { actorId, action: 'counting_channel_changed' });
      if (before.channelId && before.channelId !== channelId) return safeUpdate(interaction, buildCleanupConfirmation(before.channelId, 'move'));
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:enabled`) {
      const currentlyEnabled = isModuleEnabled(interaction.guild.id, counting.MODULE_KEY);
      if (!currentlyEnabled && !counting.getSection(interaction.guild.id).channelId) throw new Error('Choose a counting channel before enabling the game.');
      setModuleEnabled(interaction.guild.id, counting.MODULE_KEY, !currentlyEnabled, { actorId, action: 'counting_toggle_enabled' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:numbersOnly`) { await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, numbersOnly: !section.numbersOnly }), { actorId, action: 'counting_toggle_numbers_only' }); await counting.refreshPlayerPanel(interaction.guild).catch(() => null); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (id === `${PREFIX}:toggle:delete`) { await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, deleteIncorrect: !section.deleteIncorrect }), { actorId, action: 'counting_toggle_delete' }); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (id === `${PREFIX}:toggle:funny`) { await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, funnyResponses: !section.funnyResponses }), { actorId, action: 'counting_toggle_funny' }); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (id === `${PREFIX}:rules:edit`) { await interaction.showModal(buildRulesModal(interaction.guild.id)); return true; }
    if (id === `${PREFIX}:responses:timing`) { await interaction.showModal(buildTimingModal(interaction.guild.id)); return true; }
    if (id === `${PREFIX}:setCurrent`) { await interaction.showModal(buildSetCurrentModal(interaction.guild.id)); return true; }
    if (id === `${PREFIX}:milestones` || id === `${PREFIX}:toggle:milestones`) { await interaction.showModal(buildMilestonesModal(interaction.guild.id)); return true; }
    if (interaction.isModalSubmit?.() && id === `${PREFIX}:rules:save`) {
      const old = counting.getSection(interaction.guild.id);
      const startingNumber = parseRequiredInteger(interaction, 'startingNumber', 'Starting number', 0);
      const maxConsecutivePerMember = parseOptionalPositiveInteger(interaction, 'maxConsecutive', 'Turns per member');
      const answerAfterFailures = parseOptionalPositiveInteger(interaction, 'answerAfter', 'Hint threshold');
      const failureLimit = parseRequiredInteger(interaction, 'failureLimit', 'Wrong answers before reset', 0);
      const hasProgress = old.currentCount >= old.startingNumber || Object.values(old.memberStats || {}).some((stats) => Number(stats?.validCounts || 0) > 0);
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, startingNumber, maxConsecutivePerMember, answerAfterFailures, failureLimit, ...(!hasProgress ? { currentCount: startingNumber - 1, highestCount: startingNumber - 1, lastCounterId: null, consecutiveCount: 0, failureStreak: 0, acceptedMessages: {} } : {}) }), { actorId, action: 'counting_rules_saved' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null); return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    if (interaction.isModalSubmit?.() && id === `${PREFIX}:responses:timing:save`) { const responseCleanupSeconds = parseOptionalPositiveInteger(interaction, 'cleanupSeconds', 'Reply cleanup time'); await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, responseCleanupSeconds }), { actorId, action: 'counting_response_timing_saved' }); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (interaction.isModalSubmit?.() && id === `${PREFIX}:setCurrent:save`) { const currentCount = parseRequiredInteger(interaction, 'currentCount', 'Current count', 0); await counting.setCurrentCountQueued(interaction.guild.id, currentCount, { actorId, action: 'counting_set_current' }); await counting.refreshPlayerPanel(interaction.guild).catch(() => null); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (interaction.isModalSubmit?.() && id === `${PREFIX}:milestones:save`) { const milestoneAnnouncements = parseOnOff(interaction, 'enabled', 'Milestones'); const milestoneInterval = parseRequiredInteger(interaction, 'interval', 'Milestone interval', 1); await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, milestoneAnnouncements, milestoneInterval }), { actorId, action: 'counting_milestones_saved' }); await counting.refreshPlayerPanel(interaction.guild).catch(() => null); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
    if (id === `${PREFIX}:health`) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const health = await countingHealth.buildHealthReport(interaction.guild);
      const lines = [
        `**Status:** ${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}`,
        `**Configured:** ${health.configured ? 'Yes' : 'No'} • **Enabled:** ${health.enabled ? 'Yes' : 'No'}`,
        '',
        health.issues.length ? '**Issues**\n' + health.issues.map((item) => `• ${item.code}`).join('\n') : '**Issues**\n• None',
        health.warnings.length ? '**Warnings**\n' + health.warnings.map((item) => `• ${item.code}`).join('\n') : '**Warnings**\n• None',
      ];
      await interaction.editReply({ content: lines.join('\n'), components: health.issues.length || health.warnings.length ? [row(button(`${PREFIX}:health:repair`, '🛠️ Safe Repair', ButtonStyle.Primary))] : [] });
      return true;
    }
    if (id === `${PREFIX}:health:repair`) {
      await interaction.deferUpdate();
      const health = await countingHealth.repair(interaction.guild, { actorId });
      const lines = [
        `**Repair complete:** ${health.healthy ? 'Healthy ✅' : 'Still needs attention ⚠️'}`,
        health.issues.length ? '**Remaining issues**\n' + health.issues.map((item) => `• ${item.code}`).join('\n') : '**Remaining issues**\n• None',
        health.warnings.length ? '**Remaining warnings**\n' + health.warnings.map((item) => `• ${item.code}`).join('\n') : '**Remaining warnings**\n• None',
      ];
      await interaction.editReply({ content: lines.join('\n'), components: [] });
      return true;
    }
    if (id === `${PREFIX}:playerPanel`) {
      if (!counting.getSection(interaction.guild.id).channelId) throw new Error('Choose a counting channel before deploying the player panel.');
      await counting.deployPlayerPanel(interaction.guild, { actorId });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    if (id === `${PREFIX}:reset`) return safeUpdate(interaction, buildResetConfirmation(interaction.guild.id));
    if (id === `${PREFIX}:reset:confirm`) {
      const section = counting.getSection(interaction.guild.id);
      if (!section.channelId) { await counting.resetWithMarker(interaction.guild, { actorId, action: 'counting_reset_progress' }); return safeUpdate(interaction, buildPanel(interaction.guild, name)); }
      return safeUpdate(interaction, buildCleanupConfirmation(section.channelId, 'reset'));
    }
    if (id.startsWith(`${PREFIX}:cleanup:`)) {
      const parts = id.split(':');
      const mode = parts[4];
      const choice = parts[5];
      const channelId = parts[6];
      const section = counting.getSection(interaction.guild.id);
      if (mode === 'reset' && String(section.channelId) !== String(channelId)) throw new Error('The Counting channel changed before cleanup could run.');
      if (mode === 'move' && String(section.channelId) === String(channelId)) throw new Error('Cleanup is only available for the previous Counting channel after a move.');
      await interaction.deferUpdate();
      if (choice === 'yes') await counting.purgeCountingChannel(interaction.guild, channelId, { actorId, action: `counting_${mode}_cleanup` });
      if (mode === 'reset') await counting.resetWithMarker(interaction.guild, { actorId, action: 'counting_reset_progress' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    return safeUpdate(interaction, buildPanel(interaction.guild, name));
  } catch (error) {
    const payload = { content: `❌ Counting setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null); else await interaction.reply(payload).catch(() => null);
    return true;
  }
}
module.exports = { buildPanel, buildChannelScreen, buildRulesScreen, buildResponsesScreen, buildRulesModal, buildTimingModal, buildSetCurrentModal, buildMilestonesModal, buildResetConfirmation, buildCleanupConfirmation, handleInteraction };
