'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const counting = require('./counting');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const PREFIX = 'admin:module:counting';
const PANEL_COLOR = 0x2f80ed;
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const displayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';

function formatTurnLimit(value) {
  if (value === null || value === undefined || value === '') return 'Unlimited';
  if (Number(value) === 1) return '1 number per person';
  return `${value} consecutive numbers per person`;
}
function formatHintThreshold(value) {
  if (value === null || value === undefined || value === '') return 'Never reveal';
  return `${value} mistake${Number(value) === 1 ? '' : 's'}`;
}
function formatCleanup(value) {
  if (value === null || value === undefined || value === '') return 'Keep replies';
  return `Delete after ${value}s`;
}
function footer(embed, memberDisplayName) {
  return embed.setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
}

function buildPanel(guild, memberDisplayName = 'Unknown User') {
  const section = counting.getSection(guild.id);
  const enabled = isModuleEnabled(guild.id, counting.MODULE_KEY);
  const channel = section.channelId ? `<#${section.channelId}>` : '**Not chosen yet**';
  const lastCounter = section.lastCounterId ? `<@${section.lastCounterId}>` : 'Nobody yet';

  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('🔢 Counting')
    .setDescription([
      'Set up and manage your server’s counting game.',
      '',
      `**${enabled ? '🟢 Running' : '⚪ Disabled'}** • ${channel}`,
      !section.channelId ? '\n⚠️ **Choose a counting channel before members can play.**' : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      {
        name: '📊 Game',
        value: [
          `**Current:** \`${section.currentCount}\`  •  **Next:** \`${counting.expectedNext(section)}\`  •  **Record:** \`${section.highestCount}\``,
          `**Last Counter:** ${lastCounter}`,
        ].join('\n'),
      },
      {
        name: '🎮 Game Rules',
        value: [
          `**Turn Limit:** ${formatTurnLimit(section.maxConsecutivePerMember)}`,
          `**Hint:** ${formatHintThreshold(section.answerAfterFailures)}`,
          `**Numbers Only:** ${section.numbersOnly ? 'On ✅' : 'Off'}`,
          `**Wrong Counts:** ${section.deleteIncorrect ? 'Deleted ✅' : 'Kept'}`,
          `**Goliath Banter:** ${section.funnyResponses ? 'On 😂' : 'Off'}`,
          `**Milestones:** ${section.milestoneAnnouncements ? `Every ${section.milestoneInterval} 🎉` : 'Off'}`,
        ].join('\n'),
      },
      {
        name: '🧭 Controls',
        value: [
          '**Setup:** choose the channel, game rules and Goliath responses.',
          '**Game:** set the count, milestones or deploy the player panel.',
          '**Management:** pause the game or reset the current run.',
        ].join('\n'),
      },
    ), memberDisplayName);

  return {
    content: null,
    embeds: [embed],
    components: [
      row(
        button(`${PREFIX}:channel:screen`, '📍 Channel', ButtonStyle.Secondary),
        button(`${PREFIX}:rules:screen`, '⚙️ Game Rules', ButtonStyle.Primary),
        button(`${PREFIX}:responses:screen`, '💬 Responses', ButtonStyle.Secondary),
      ),
      row(
        button(`${PREFIX}:setCurrent`, '🎯 Set Count', ButtonStyle.Secondary),
        button(`${PREFIX}:toggle:milestones`, section.milestoneAnnouncements ? '🎉 Milestones: On' : '🎉 Milestones: Off', ButtonStyle.Secondary),
        button(`${PREFIX}:playerPanel`, section.playerPanelMessageId ? '📢 Update Player Panel' : '📢 Player Panel', ButtonStyle.Secondary),
      ),
      row(
        button(`${PREFIX}:toggle:enabled`, enabled ? '⏸️ Disable' : '▶️ Enable', enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(`${PREFIX}:reset`, '♻️ Reset', ButtonStyle.Danger),
        button('admin:studio:communityStudio', '⬅️ Back', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildChannelScreen(guild, memberDisplayName) {
  const section = counting.getSection(guild.id);
  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('📍 Counting Channel')
    .setDescription([
      'Choose the text channel where members will play the counting game.',
      '',
      `**Current Channel:** ${section.channelId ? `<#${section.channelId}>` : 'Not chosen yet'}`,
      '',
      'When **Numbers Only** is enabled, Goliath keeps this channel clean by removing chat, links, GIFs, images and other non-counting messages.',
    ].join('\n')), memberDisplayName);
  return {
    content: null,
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}:channel`).setPlaceholder(section.channelId ? 'Change the counting channel' : 'Choose the counting channel').setChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1)),
      row(button(`${PREFIX}:main:0`, '⬅️ Back to Counting', ButtonStyle.Secondary)),
    ],
  };
}

function buildRulesScreen(guild, memberDisplayName) {
  const section = counting.getSection(guild.id);
  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('⚙️ Counting Rules')
    .setDescription('Control how members are allowed to play. Nothing here resets the current game.')
    .addFields(
      { name: '🔢 Turn Limit', value: `${formatTurnLimit(section.maxConsecutivePerMember)}\nHow many times the same member may count consecutively. Blank means unlimited.` },
      { name: '💡 Hint After', value: `${formatHintThreshold(section.answerAfterFailures)}\nHow many wrong-number attempts happen before Goliath reveals the next number. Blank disables hints.` },
      { name: '🧹 Numbers Only', value: `${section.numbersOnly ? 'On ✅' : 'Off'}\nRemoves non-number chat and media without adding to the failed-count streak.` },
      { name: '🗑️ Wrong Counts', value: `${section.deleteIncorrect ? 'Delete ✅' : 'Keep'}\nChoose whether incorrect numbers stay visible in the channel.` },
    ), memberDisplayName);
  return {
    content: null,
    embeds: [embed],
    components: [
      row(
        button(`${PREFIX}:rules:edit`, '✏️ Edit Number Rules', ButtonStyle.Primary),
        button(`${PREFIX}:toggle:numbersOnly`, section.numbersOnly ? '🔢 Numbers Only: On' : '🔢 Numbers Only: Off', ButtonStyle.Secondary),
        button(`${PREFIX}:toggle:delete`, section.deleteIncorrect ? '🗑️ Wrong Counts: Delete' : '🗑️ Wrong Counts: Keep', ButtonStyle.Secondary),
      ),
      row(button(`${PREFIX}:main:0`, '⬅️ Back to Counting', ButtonStyle.Secondary)),
    ],
  };
}

function buildResponsesScreen(guild, memberDisplayName) {
  const section = counting.getSection(guild.id);
  const embed = footer(new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle('💬 Goliath Responses')
    .setDescription('Choose how Goliath reacts when somebody gets the count wrong or tries to chat in a numbers-only channel.')
    .addFields(
      { name: '😂 Goliath Banter', value: section.funnyResponses ? 'On — Goliath rotates playful responses without immediately repeating itself.' : 'Off — Goliath keeps responses simple.' },
      { name: '⏱️ Reply Cleanup', value: `${formatCleanup(section.responseCleanupSeconds)}\nTemporary responses disappear automatically so the counting channel stays tidy.` },
    ), memberDisplayName);
  return {
    content: null,
    embeds: [embed],
    components: [
      row(
        button(`${PREFIX}:toggle:funny`, section.funnyResponses ? '😂 Banter: On' : '😂 Banter: Off', ButtonStyle.Secondary),
        button(`${PREFIX}:responses:timing`, '⏱️ Reply Timing', ButtonStyle.Primary),
      ),
      row(button(`${PREFIX}:main:0`, '⬅️ Back to Counting', ButtonStyle.Secondary)),
    ],
  };
}

function textInput(customId, label, value, { required = false, placeholder = null } = {}) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required);
  if (value !== null && value !== undefined && value !== '') input.setValue(String(value));
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}

function buildRulesModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:rules:save`)
    .setTitle('Edit Counting Rules')
    .addComponents(
      row(textInput('startingNumber', 'Starting number', section.startingNumber, { required: true, placeholder: '1' })),
      row(textInput('maxConsecutive', 'Consecutive counts per member', section.maxConsecutivePerMember, { placeholder: 'Blank = unlimited' })),
      row(textInput('answerAfter', 'Give hint after mistakes', section.answerAfterFailures, { placeholder: 'Blank = never reveal' })),
      row(textInput('milestoneInterval', 'Milestone interval', section.milestoneInterval, { required: true, placeholder: '100' })),
    );
}

function buildTimingModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:responses:timing:save`)
    .setTitle('Goliath Reply Timing')
    .addComponents(row(textInput('cleanupSeconds', 'Delete replies after seconds', section.responseCleanupSeconds, { placeholder: 'Blank = keep replies' })));
}

function buildSetCurrentModal(guildId) {
  const section = counting.getSection(guildId);
  return new ModalBuilder().setCustomId(`${PREFIX}:setCurrent:save`).setTitle('Set Current Count').addComponents(row(textInput('currentCount', 'Current count', section.currentCount, { required: true, placeholder: '0' })));
}

function buildResetConfirmation(guildId) {
  const section = counting.getSection(guildId);
  return {
    content: [
      '⚠️ **Reset counting progress?**',
      '',
      `This ends the current counting run and starts again from **${section.startingNumber}**.`,
      '',
      'Goliath will post a **COUNT RESET** marker in the counting channel, then deploy a fresh player panel so everyone knows a new game has started.',
      '',
      'Your chosen channel and configured rules will **not** be changed.',
      '',
      '**This cannot be undone.**',
    ].join('\n'),
    embeds: [],
    components: [row(button(`${PREFIX}:reset:confirm`, '🔄 Yes, Start Again', ButtonStyle.Danger), button(`${PREFIX}:main:0`, 'Cancel', ButtonStyle.Secondary))],
  };
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
async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

async function handleInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith(PREFIX)) return false;
  const name = displayName(interaction);
  const actorId = interaction.user?.id || null;

  try {
    if (id === `${PREFIX}:main:0`) return safeUpdate(interaction, buildPanel(interaction.guild, name));
    if (id === `${PREFIX}:channel:screen`) return safeUpdate(interaction, buildChannelScreen(interaction.guild, name));
    if (id === `${PREFIX}:rules:screen`) return safeUpdate(interaction, buildRulesScreen(interaction.guild, name));
    if (id === `${PREFIX}:responses:screen`) return safeUpdate(interaction, buildResponsesScreen(interaction.guild, name));

    if (interaction.isChannelSelectMenu?.() && id === `${PREFIX}:channel`) {
      const channelId = interaction.values?.[0] || null;
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, channelId, playerPanelMessageId: channelId === section.channelId ? section.playerPanelMessageId : null }), { actorId, action: 'counting_channel_changed' });
      return safeUpdate(interaction, buildChannelScreen(interaction.guild, name));
    }

    if (id === `${PREFIX}:toggle:enabled`) {
      setModuleEnabled(interaction.guild.id, counting.MODULE_KEY, !isModuleEnabled(interaction.guild.id, counting.MODULE_KEY), { actorId, action: 'counting_toggle_enabled' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:numbersOnly`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, numbersOnly: !section.numbersOnly }), { actorId, action: 'counting_toggle_numbers_only' });
      return safeUpdate(interaction, buildRulesScreen(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:delete`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, deleteIncorrect: !section.deleteIncorrect }), { actorId, action: 'counting_toggle_delete' });
      return safeUpdate(interaction, buildRulesScreen(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:funny`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, funnyResponses: !section.funnyResponses }), { actorId, action: 'counting_toggle_funny' });
      return safeUpdate(interaction, buildResponsesScreen(interaction.guild, name));
    }
    if (id === `${PREFIX}:toggle:milestones`) {
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, milestoneAnnouncements: !section.milestoneAnnouncements }), { actorId, action: 'counting_toggle_milestones' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:rules:edit`) { await interaction.showModal(buildRulesModal(interaction.guild.id)); return true; }
    if (id === `${PREFIX}:responses:timing`) { await interaction.showModal(buildTimingModal(interaction.guild.id)); return true; }
    if (id === `${PREFIX}:setCurrent`) { await interaction.showModal(buildSetCurrentModal(interaction.guild.id)); return true; }

    if (interaction.isModalSubmit?.() && id === `${PREFIX}:rules:save`) {
      const old = counting.getSection(interaction.guild.id);
      const startingNumber = parseRequiredInteger(interaction, 'startingNumber', 'Starting number', 0);
      const maxConsecutivePerMember = parseOptionalPositiveInteger(interaction, 'maxConsecutive', 'Consecutive-count limit');
      const answerAfterFailures = parseOptionalPositiveInteger(interaction, 'answerAfter', 'Hint threshold');
      const milestoneInterval = parseRequiredInteger(interaction, 'milestoneInterval', 'Milestone interval', 1);
      const hasProgress = old.currentCount >= old.startingNumber || Object.values(old.memberStats || {}).some((stats) => Number(stats?.validCounts || 0) > 0);
      counting.updateSection(interaction.guild.id, (section) => ({
        ...section,
        startingNumber,
        maxConsecutivePerMember,
        answerAfterFailures,
        milestoneInterval,
        ...(!hasProgress ? { currentCount: startingNumber - 1, highestCount: startingNumber - 1, lastCounterId: null, consecutiveCount: 0, failureStreak: 0, acceptedMessages: {} } : {}),
      }), { actorId, action: 'counting_rules_saved' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildRulesScreen(interaction.guild, name));
    }

    if (interaction.isModalSubmit?.() && id === `${PREFIX}:responses:timing:save`) {
      const responseCleanupSeconds = parseOptionalPositiveInteger(interaction, 'cleanupSeconds', 'Reply cleanup time');
      counting.updateSection(interaction.guild.id, (section) => ({ ...section, responseCleanupSeconds }), { actorId, action: 'counting_response_timing_saved' });
      return safeUpdate(interaction, buildResponsesScreen(interaction.guild, name));
    }

    if (interaction.isModalSubmit?.() && id === `${PREFIX}:setCurrent:save`) {
      const currentCount = parseRequiredInteger(interaction, 'currentCount', 'Current count', 0);
      counting.setCurrentCount(interaction.guild.id, currentCount, { actorId, action: 'counting_set_current' });
      await counting.refreshPlayerPanel(interaction.guild).catch(() => null);
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:playerPanel`) {
      await interaction.deferUpdate();
      await counting.deployPlayerPanel(interaction.guild, { actorId });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    if (id === `${PREFIX}:reset`) return safeUpdate(interaction, buildResetConfirmation(interaction.guild.id));
    if (id === `${PREFIX}:reset:confirm`) {
      await interaction.deferUpdate();
      await counting.resetWithMarker(interaction.guild, { actorId, action: 'counting_reset_progress' });
      return safeUpdate(interaction, buildPanel(interaction.guild, name));
    }

    return safeUpdate(interaction, buildPanel(interaction.guild, name));
  } catch (error) {
    const payload = { content: `❌ Counting setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildPanel,
  buildChannelScreen,
  buildRulesScreen,
  buildResponsesScreen,
  buildRulesModal,
  buildTimingModal,
  buildSetCurrentModal,
  buildResetConfirmation,
  handleInteraction,
};
