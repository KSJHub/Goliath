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
  if (!Number(value)) return 'Off: mistakes do not reset the run';
  if (Number(value) === 1) return '1 wrong answer: sudden death';
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
  const channel = hasChannel ? '<#' + section.channelId + '>' : '**Not configured**';
  const lastCounter = section.lastCounterId ? '<@' + section.lastCounterId + '>' : 'Nobody yet';
  const status = enabled ? '🟢 Running' : '⚪ Disabled';

  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🔢 Counting Management')
    .setDescription([
      '**' + status + '**  •  ' + channel,
      !hasChannel ? '\n⚠️ Choose a Counting channel to enable the game and deploy the Player Panel.' : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: '📊 Live Game',
        value: [
          '**Current**  \`' + section.currentCount + '\`   •   **Next**  \`' + counting.expectedNext(section) + '\`   •   **Record**  \`' + section.highestCount + '\`',
          '**Last Counter:** ' + lastCounter,
        ].join('\n'),
      },
      {
        name: '🎮 Game Rules',
        value: [
          '**Preset:** ' + (counting.rulesAreDefault(section) ? 'Goliath Defaults' : 'Custom'),
          '**Turns:** ' + formatTurnLimit(section.maxConsecutivePerMember),
          '**Game Over:** ' + formatFailureLimit(section.failureLimit),
          '**Hints:** ' + formatHintThreshold(section.answerAfterFailures) + '   •   **Milestones:** ' + (section.milestoneAnnouncements ? 'Every ' + section.milestoneInterval : 'Off'),
        ].join('\n'),
      },
      {
        name: '🛡️ Channel Behaviour',
        value: [
          '**Numbers Only:** ' + (section.numbersOnly ? 'On' : 'Off') + '   •   **Wrong Counts:** ' + (section.deleteIncorrect ? 'Delete' : 'Keep'),
          '**Banter:** ' + (section.funnyResponses ? 'On' : 'Off') + '   •   **Reply Timing:** ' + formatCleanup(section.responseCleanupSeconds),
        ].join('\n'),
      },
    ));

  return { content: null, embeds: [embed], components: [
    row(channelSelector(section)),
    row(
      button(PREFIX + ':playerPanel', '📢 Player Panel', ButtonStyle.Secondary, !hasChannel),
      button(PREFIX + ':rules', '🎮 Game Rules', ButtonStyle.Primary),
      button(PREFIX + ':reset', '♻️ Reset Game', ButtonStyle.Danger),
    ),
    row(
      button('admin:studio:communityStudio', '⬅️ Back', ButtonStyle.Secondary),
      button(PREFIX + ':settings', '⚙️ Settings', ButtonStyle.Secondary),
    ),
  ] };
}
function buildChannelScreen(guild, memberDisplayName) { return buildPanel(guild, memberDisplayName); }
function buildRulesScreen(guild) {
  const section = counting.getSection(guild.id);
  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🎮 Counting Game Rules')
    .setDescription([
      'Configure how the Counting game plays. Button changes apply immediately.',
      '',
      '**🎮 Core Gameplay**',
      '👤 **Turns:** ' + formatTurnLimit(section.maxConsecutivePerMember),
      '💀 **Game Over:** ' + formatFailureLimit(section.failureLimit),
      '💡 **Hints:** ' + formatHintThreshold(section.answerAfterFailures),
      '',
      '**💬 Message Behaviour**',
      '🔢 **Numbers Only:** ' + (section.numbersOnly ? 'On' : 'Off') + '   •   🗑️ **Wrong Counts:** ' + (section.deleteIncorrect ? 'Delete' : 'Keep'),
      '😂 **Banter:** ' + (section.funnyResponses ? 'On' : 'Off') + '   •   ⏱️ **Reply Timing:** ' + formatCleanup(section.responseCleanupSeconds),
      '',
      '**🎉 Progress**',
      '🎉 **Milestones:** ' + (section.milestoneAnnouncements ? 'Every ' + section.milestoneInterval + ' counts' : 'Off'),
      '',
      '**Preset:** ' + (counting.rulesAreDefault(section) ? 'Goliath Defaults' : 'Custom'),
      'Use **✏️ Advanced Values** when you need a value outside the button presets.',
    ].join('\n')));
  return { content: null, embeds: [embed], components: [
    row(button(PREFIX + ':main:0', '⬅️ Back', ButtonStyle.Secondary)),
    row(
      button(PREFIX + ':rules:cycle:turns', '👤 Turns: ' + (section.maxConsecutivePerMember === null ? 'Unlimited' : section.maxConsecutivePerMember), ButtonStyle.Secondary),
      button(PREFIX + ':rules:cycle:failure', '💀 Game Over: ' + (section.failureLimit === 0 ? 'Off' : section.failureLimit), ButtonStyle.Secondary),
      button(PREFIX + ':rules:cycle:hints', '💡 Hints: ' + (section.answerAfterFailures === null ? 'Off' : section.answerAfterFailures), ButtonStyle.Secondary),
    ),
    row(
      button(PREFIX + ':rules:toggle:numbers', '🔢 Numbers Only: ' + (section.numbersOnly ? 'On' : 'Off'), section.numbersOnly ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(PREFIX + ':rules:toggle:delete', '🗑️ Wrong Counts: ' + (section.deleteIncorrect ? 'Delete' : 'Keep'), section.deleteIncorrect ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(PREFIX + ':rules:toggle:banter', '😂 Banter: ' + (section.funnyResponses ? 'On' : 'Off'), section.funnyResponses ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    row(
      button(PREFIX + ':rules:cycle:timing', '⏱️ Reply Timing: ' + (section.responseCleanupSeconds === null ? 'Keep' : section.responseCleanupSeconds + 's'), ButtonStyle.Secondary),
      button(PREFIX + ':rules:toggle:milestones', '🎉 Milestones: ' + (section.milestoneAnnouncements ? 'On' : 'Off'), section.milestoneAnnouncements ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(PREFIX + ':rules:cycle:milestoneInterval', '🎯 Interval: ' + section.milestoneInterval, ButtonStyle.Secondary, !section.milestoneAnnouncements),
    ),
    row(button(PREFIX + ':rules:advanced', '✏️ Advanced Values', ButtonStyle.Primary)),
  ] };
}
function buildResponsesScreen(guild, memberDisplayName) { return buildPanel(guild, memberDisplayName); }
function buildSettingsScreen(guild) {
  const section = counting.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, counting.MODULE_KEY);
  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('⚙️ Counting Settings')
    .setDescription([
      '**Module Controls**',
      'Manage the Counting module without changing the current game from the main panel.',
      '',
      '**⏸️ Disable Counting**',
      'Pauses Counting in this server. Your channel, rules, current count and record are kept.',
      '',
      '**🔄 Defaults**',
      'Restores Goliath\'s recommended game rules. The current count, record, channel and Player Panel are not reset.',
      '',
      '**🩺 Health**',
      'Checks the Counting setup, channel access and configuration for problems.',
      '',
      '**Status:** ' + (enabled ? '🟢 Running' : '⚪ Disabled') + '   •   **Channel:** ' + (section.channelId ? '<#' + section.channelId + '>' : 'Not configured'),
    ].join('\n')));
  return { content: null, embeds: [embed], components: [
    row(
      button(PREFIX + ':toggle:enabled', enabled ? '⏸️ Disable Counting' : '▶️ Enable Counting', enabled ? ButtonStyle.Danger : ButtonStyle.Success, !section.channelId && !enabled),
      button(PREFIX + ':defaults', '🔄 Defaults', ButtonStyle.Secondary),
      button(PREFIX + ':health', '🩺 Health', ButtonStyle.Secondary),
    ),
    row(button(PREFIX + ':main:0', '⬅️ Back', ButtonStyle.Secondary)),
  ] };
}
function buildDefaultsConfirmation() {
  return {
    content: null,
    embeds: [footer(new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setTitle('🔄 Restore Counting Defaults?')
      .setDescription([
        'This will restore Goliath\'s recommended Counting rules:',
        '',
        '👤 **Turns:** 1 number per member',
        '💀 **Game Over:** 1 wrong answer',
        '💡 **Hints:** Off',
        '🔢 **Numbers Only:** On',
        '🗑️ **Wrong Counts:** Delete',
        '😂 **Banter:** On',
        '⏱️ **Reply Timing:** Delete after 8s',
        '🎉 **Milestones:** Every 5 counts',
        '',
        '**Your current count, server record, Counting channel and Player Panel will be kept.**',
      ].join('\n')))],
    components: [
      row(
        button(PREFIX + ':defaults:confirm', '🔄 Restore Defaults', ButtonStyle.Danger),
        button(PREFIX + ':settings', 'Cancel', ButtonStyle.Secondary),
      ),
    ],
  };
}
function textInput(customId, label, value, { required = false, placeholder = null } = {}) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required);
  if (value !== null && value !== undefined && value !== '') input.setValue(String(value));
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}
function buildAdvancedRulesModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:rules:advanced:save`).setTitle('Counting Advanced Values').addComponents(
    row(textInput('currentCount', 'Current count', section.currentCount, { required: true, placeholder: '0 = next number is 1' })),
    row(textInput('maxConsecutive', 'Custom turns (blank = unlimited)', section.maxConsecutivePerMember, { placeholder: 'Example: 5' })),
    row(textInput('failureLimit', 'Custom Game Over limit (0 = off)', section.failureLimit, { required: true, placeholder: 'Example: 5' })),
    row(textInput('answerAfter', 'Custom hint threshold (blank = off)', section.answerAfterFailures, { placeholder: 'Example: 4' })),
    row(textInput('timingAndMilestone', 'Reply seconds, milestone interval', `${section.responseCleanupSeconds === null ? 'keep' : section.responseCleanupSeconds},${section.milestoneInterval}`, { required: true, placeholder: '8,5 or keep,5' })),
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
  return { content: ['⚠️ **Start the counting game again?**', '', 'This ends the current run and starts again from **1**.', '', 'Goliath will replace the current player panel with one **COUNTING: RESET** panel in the counting channel. Everything above it belongs to the previous run.', '', 'Your counting channel and configured rules stay exactly as they are.', '', '**This cannot be undone.**'].join('\n'), embeds: [], components: [row(button(`${PREFIX}:reset:confirm`, '🔄 Yes, Start Again', ButtonStyle.Danger), button(`${PREFIX}:main:0`, 'Cancel', ButtonStyle.Secondary))] };
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
const HEALTH_LABELS = Object.freeze({
  channel_not_configured: 'Counting is enabled but no channel is configured.',
  channel_missing: 'The configured Counting channel no longer exists.',
  channel_not_text_based: 'The configured Counting channel is not a usable text channel.',
  view_channel_missing: 'Goliath cannot view the Counting channel.',
  send_messages_missing: 'Goliath cannot send messages in the Counting channel.',
  embed_links_missing: 'Goliath cannot send embedded Counting panels in the channel.',
  add_reactions_missing: 'Goliath cannot add the correct-answer reactions.',
  read_history_missing: 'Goliath cannot read message history in the Counting channel.',
  manage_messages_missing: 'Goliath cannot delete wrong answers in the Counting channel.',
  current_count_invalid: 'The saved current count is invalid.',
  record_invalid: 'The saved server record is invalid.',
  turn_state_inconsistent: 'The saved turn state is inconsistent.',
  turn_state_stale: 'The saved turn state is stale.',
  player_panel_not_deployed: 'The Player Panel is not currently deployed.',
  player_panel_unreachable: 'The saved Player Panel cannot be reached.',
  player_panel_missing: 'The saved Player Panel message was deleted or is missing.',
});
function healthLabel(item) { return HEALTH_LABELS[item.code] || item.code; }
async function safeUpdate(interaction, payload) { if (interaction.deferred || interaction.replied) await interaction.editReply(payload); else await interaction.update(payload); return true; }
async function handleInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  const name = displayName(interaction);
  const actorId = interaction.user?.id || null;
  try {
    if (id === `${PREFIX}:main:0`) return safeUpdate(interaction, buildPanel(interaction.guild, name));
    if (id === `${PREFIX}:settings`) return safeUpdate(interaction, buildSettingsScreen(interaction.guild));
    if (id === `${PREFIX}:rules`) return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    if (id === `${PREFIX}:defaults`) return safeUpdate(interaction, buildDefaultsConfirmation());
    if (id === `${PREFIX}:defaults:confirm`) {
      await counting.mutateSection(interaction.guild.id, (section) => ({
        ...section,
        maxConsecutivePerMember: counting.DEFAULTS.maxConsecutivePerMember,
        numbersOnly: counting.DEFAULTS.numbersOnly,
        deleteIncorrect: counting.DEFAULTS.deleteIncorrect,
        funnyResponses: counting.DEFAULTS.funnyResponses,
        answerAfterFailures: counting.DEFAULTS.answerAfterFailures,
        responseCleanupSeconds: counting.DEFAULTS.responseCleanupSeconds,
        milestoneAnnouncements: counting.DEFAULTS.milestoneAnnouncements,
        milestoneInterval: counting.DEFAULTS.milestoneInterval,
        failureLimit: counting.DEFAULTS.failureLimit,
      }), { actorId, action: 'counting_defaults_restored' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildSettingsScreen(interaction.guild));
    }
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
      return safeUpdate(interaction, buildSettingsScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:cycle:turns`) {
      const current = counting.getSection(interaction.guild.id).maxConsecutivePerMember;
      const values = [1, 2, 3, null];
      const index = values.findIndex((value) => value === current);
      const next = values[(index < 0 ? 0 : index + 1) % values.length];
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, maxConsecutivePerMember: next }), { actorId, action: 'counting_cycle_turns' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:cycle:failure`) {
      const current = counting.getSection(interaction.guild.id).failureLimit;
      const values = [1, 2, 3, 0];
      const index = values.indexOf(current);
      const next = values[(index < 0 ? 0 : index + 1) % values.length];
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, failureLimit: next }), { actorId, action: 'counting_cycle_failure_limit' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:cycle:hints`) {
      const current = counting.getSection(interaction.guild.id).answerAfterFailures;
      const values = [null, 1, 2, 3];
      const index = values.findIndex((value) => value === current);
      const next = values[(index < 0 ? 0 : index + 1) % values.length];
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, answerAfterFailures: next }), { actorId, action: 'counting_cycle_hints' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:toggle:numbers` || id === `${PREFIX}:rules:toggle:delete` || id === `${PREFIX}:rules:toggle:banter` || id === `${PREFIX}:rules:toggle:milestones`) {
      const key = id.endsWith(':numbers') ? 'numbersOnly' : id.endsWith(':delete') ? 'deleteIncorrect' : id.endsWith(':banter') ? 'funnyResponses' : 'milestoneAnnouncements';
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, [key]: !section[key] }), { actorId, action: 'counting_toggle_' + key });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:cycle:timing`) {
      const current = counting.getSection(interaction.guild.id).responseCleanupSeconds;
      const values = [5, 8, 10, 15, null];
      const index = values.findIndex((value) => value === current);
      const next = values[(index < 0 ? 0 : index + 1) % values.length];
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, responseCleanupSeconds: next }), { actorId, action: 'counting_cycle_reply_timing' });
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:cycle:milestoneInterval`) {
      const current = counting.getSection(interaction.guild.id).milestoneInterval;
      const values = [5, 10, 25, 50, 100];
      const index = values.indexOf(current);
      const next = values[(index < 0 ? 0 : index + 1) % values.length];
      await counting.mutateSection(interaction.guild.id, (section) => ({ ...section, milestoneInterval: next }), { actorId, action: 'counting_cycle_milestone_interval' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:rules:advanced`) { await interaction.showModal(buildAdvancedRulesModal(interaction.guild.id)); return true; }
    if (interaction.isModalSubmit?.() && id === `${PREFIX}:rules:advanced:save`) {
      const before = counting.getSection(interaction.guild.id);
      const currentCount = parseRequiredInteger(interaction, 'currentCount', 'Current count', 0);
      const maxConsecutivePerMember = parseOptionalPositiveInteger(interaction, 'maxConsecutive', 'Turns per member');
      const failureLimit = parseRequiredInteger(interaction, 'failureLimit', 'Wrong answers before reset', 0);
      const answerAfterFailures = parseOptionalPositiveInteger(interaction, 'answerAfter', 'Hint threshold');
      const combined = interaction.fields.getTextInputValue('timingAndMilestone').split(',').map((value) => value.trim().toLowerCase());
      if (combined.length !== 2) throw new Error('Use reply timing and milestone interval, for example: 8,5 or keep,5.');
      const responseCleanupSeconds = ['keep', 'off'].includes(combined[0]) ? null : Number(combined[0]);
      if (responseCleanupSeconds !== null && (!Number.isSafeInteger(responseCleanupSeconds) || responseCleanupSeconds < 1)) throw new Error('Reply timing must be a whole number of seconds or Keep.');
      const milestoneInterval = Number(combined[1]);
      if (!Number.isSafeInteger(milestoneInterval) || milestoneInterval < 1) throw new Error('Milestone interval must be 1 or higher.');
      if (currentCount !== before.currentCount) await counting.setCurrentCountQueued(interaction.guild.id, currentCount, { actorId, action: 'counting_set_current_from_rules' });
      await counting.mutateSection(interaction.guild.id, (section) => ({
        ...section, maxConsecutivePerMember, failureLimit, answerAfterFailures, responseCleanupSeconds, milestoneInterval,
      }), { actorId, action: 'counting_advanced_rules_saved' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild));
    }
    if (id === `${PREFIX}:health`) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const health = await countingHealth.buildHealthReport(interaction.guild);
      const lines = [
        `**Status:** ${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}`,
        `**Configured:** ${health.configured ? 'Yes' : 'No'} • **Enabled:** ${health.enabled ? 'Yes' : 'No'}`,
        '',
        health.issues.length ? '**Issues**\n' + health.issues.map((item) => `• ${healthLabel(item)}`).join('\n') : '**Issues**\n• None',
        health.warnings.length ? '**Warnings**\n' + health.warnings.map((item) => `• ${healthLabel(item)}`).join('\n') : '**Warnings**\n• None',
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
module.exports = { buildPanel, buildChannelScreen, buildRulesScreen, buildResponsesScreen, buildSettingsScreen, buildDefaultsConfirmation, buildAdvancedRulesModal, buildResetConfirmation, buildCleanupConfirmation, handleInteraction };
