'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');

const statsStore = require('../../modules/utilityStudio/stats/statsStore');
const statsCounters = require('../../modules/utilityStudio/stats/statsCounters');
const { enforceCommandAccess } = require('../../core/commands/commandAccess');

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function formatTop(items = [], mentionType = 'user') {
  if (!items.length) return 'No data yet.';

  return items
    .map((item, index) => {
      const target = mentionType === 'channel' ? `<#${item.id}>` : `<@${item.id}>`;
      return `**${index + 1}.** ${target} — \`${formatNumber(item.value)}\``;
    })
    .join('\n')
    .slice(0, 1024);
}

function buildStatsEmbed(interaction) {
  const summary = statsStore.getSummary(interaction.guild.id);

  return new EmbedBuilder()
    .setColor(summary.enabled ? 0x57f287 : 0xed4245)
    .setTitle('📊 Goliath Server Stats')
    .setDescription(summary.enabled ? 'Stats tracking is enabled.' : 'Stats tracking is disabled.')
    .addFields(
      {
        name: 'Totals',
        value: [
          `Messages: \`${formatNumber(summary.totals.messages)}\``,
          `Voice Minutes: \`${formatNumber(summary.totals.voiceMinutes)}\``,
          `Joins: \`${formatNumber(summary.totals.joins)}\``,
          `Leaves: \`${formatNumber(summary.totals.leaves)}\``,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Top Message Users',
        value: formatTop(summary.top.messageUsers, 'user'),
        inline: false,
      },
      {
        name: 'Top Message Channels',
        value: formatTop(summary.top.messageChannels, 'channel'),
        inline: false,
      },
      {
        name: 'Top Voice Users',
        value: formatTop(summary.top.voiceUsers, 'user'),
        inline: false,
      }
    )
    .setFooter({
      text: `Requested by ${interaction.member?.displayName || interaction.user.username}`,
    })
    .setTimestamp(new Date());
}

function counterTypeOption(option) {
  return option
    .setName('type')
    .setDescription('Counter type')
    .setRequired(true)
    .addChoices(
      { name: 'Members', value: 'members' },
      { name: 'Humans / Gems', value: 'humans' },
      { name: 'Discord Services / Bots', value: 'bots' },
      { name: 'Messages', value: 'messages' },
      { name: 'Voice Minutes', value: 'voice' },
      { name: 'Channels', value: 'channels' },
      { name: 'Roles', value: 'roles' },
      { name: 'Date', value: 'date' }
    );
}

function formatCounterLines(title, counters = []) {
  if (!counters.length) return [];
  return [
    `**${title}**`,
    ...counters.map((counter) => `• <#${counter.channelId}> — \`${counter.name}\``),
    '',
  ];
}

function getCommandParts(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false) || 'view';
  return { group, subcommand };
}

async function safeReply(interaction, payload) {
  const safePayload = {
    ...payload,
    flags: 64,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(safePayload);
  }

  return interaction.reply(safePayload);
}

async function handleCounterSubcommand(interaction, subcommand) {
  if (subcommand === 'setup') {
    statsStore.setEnabled(interaction.guild.id, true, interaction.guild);
    const result = await statsCounters.createCounterSuite(interaction.guild);
    const lines = [
      '✅ Stat counter setup complete.',
      `Category: <#${result.categoryId}>`,
      '',
      ...formatCounterLines('Created', result.created),
      ...formatCounterLines('Reused', result.reused),
      ...formatCounterLines('Repaired', result.repaired),
    ];

    if (!result.created.length && !result.reused.length && !result.repaired.length) {
      lines.push('No counter channels were needed. Everything is already configured.');
    }

    return safeReply(interaction, {
      content: lines.join('\n').slice(0, 1900),
    });
  }

  if (subcommand === 'list') {
    const counters = statsCounters.listCounters(interaction.guild.id);
    const text = counters.length
      ? counters
          .map((counter, index) => `**${index + 1}.** <#${counter.channelId}> — \`${counter.type}\` — \`${counter.template}\``)
          .join('\n')
      : 'No stats counters configured yet. Use `/stats counter setup`.';

    return safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📊 Stats Counters')
          .setDescription(text)
          .setTimestamp(),
      ],
    });
  }

  if (subcommand === 'refresh') {
    const refreshed = await statsCounters.refreshCounters(interaction.guild);
    return safeReply(interaction, {
      content: refreshed.length
        ? ['✅ Refreshed stat counter channels.', '', ...refreshed.map((counter) => `• <#${counter.channelId}> — \`${counter.name}\``)].join('\n')
        : 'No stat counter channels are configured yet. Use `/stats counter setup`.',
    });
  }

  if (subcommand === 'add') {
    const type = interaction.options.getString('type', true);
    const channelId = interaction.options.getString('channel_id', true);
    const template = interaction.options.getString('template', false) || statsCounters.defaultTemplate(type);
    statsCounters.addCounter(interaction.guild.id, { type, channelId, template }, interaction.guild);
    const refreshed = await statsCounters.refreshCounters(interaction.guild);
    return safeReply(interaction, {
      content: `✅ Counter registered for <#${channelId}> using \`${template}\`. Refreshed ${refreshed.length} counter(s).`,
    });
  }

  if (subcommand === 'remove') {
    const channelId = interaction.options.getString('channel_id', true);
    statsCounters.removeCounter(interaction.guild.id, channelId, interaction.guild);
    return safeReply(interaction, {
      content: `✅ Removed counter tracking for <#${channelId}>.`,
    });
  }

  return safeReply(interaction, { content: '❌ Unknown stats counter action.' });
}

async function handleTrackingSubcommand(interaction, subcommand) {
  if (subcommand === 'enable') {
    statsStore.setEnabled(interaction.guild.id, true, interaction.guild);
    return safeReply(interaction, {
      content: '✅ Stats tracking enabled.',
    });
  }

  if (subcommand === 'disable') {
    statsStore.setEnabled(interaction.guild.id, false, interaction.guild);
    return safeReply(interaction, {
      content: '✅ Stats tracking disabled.',
    });
  }

  if (subcommand === 'reset') {
    statsStore.resetStats(interaction.guild.id, interaction.guild);
    return safeReply(interaction, {
      content: '✅ Stats data reset. The module is now back to default disabled state.',
    });
  }

  return safeReply(interaction, { content: '❌ Unknown stats tracking action.' });
}

module.exports = {
  category: 'Admin',

  help: {
    name: 'stats',
    description: 'Setup, view, counters, and tracking for Goliath server stats.',
    usage: '/stats setup | /stats view | /stats counter setup | /stats tracking enable',
  },

  access: {
    level: 'admin',
    ownerOnly: false,
  },

  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Manage Goliath server stats')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Enable stats and create default counter channels')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View tracked server stats')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('export')
        .setDescription('Export a compact stats summary')
    )
    .addSubcommandGroup((group) =>
      group
        .setName('tracking')
        .setDescription('Enable, disable, or reset stats tracking')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('enable')
            .setDescription('Enable stats tracking')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('disable')
            .setDescription('Disable stats tracking')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('reset')
            .setDescription('Reset all tracked stats data')
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('counter')
        .setDescription('Create and manage Statbot-style counter channels')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('setup')
            .setDescription('Create or repair Statbot-style server stat counter channels')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('list')
            .setDescription('List configured stats counter channels')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('refresh')
            .setDescription('Refresh all configured stat counter channel names')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add')
            .setDescription('Register an existing channel as a stat counter')
            .addStringOption(counterTypeOption)
            .addStringOption((option) =>
              option
                .setName('channel_id')
                .setDescription('Channel ID to rename as a counter')
                .setRequired(true)
            )
            .addStringOption((option) =>
              option
                .setName('template')
                .setDescription('Name template. Use {count} or {date}')
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('remove')
            .setDescription('Remove a stat counter channel from tracking')
            .addStringOption((option) =>
              option
                .setName('channel_id')
                .setDescription('Counter channel ID to remove')
                .setRequired(true)
            )
        )
    ),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 }).catch(() => null);
    }

    const denied = await enforceCommandAccess(interaction, module.exports);
    if (denied) return;

    const { group, subcommand } = getCommandParts(interaction);

    if (group === 'counter') return handleCounterSubcommand(interaction, subcommand);
    if (group === 'tracking') return handleTrackingSubcommand(interaction, subcommand);

    if (subcommand === 'setup') {
      statsStore.setEnabled(interaction.guild.id, true, interaction.guild);
      const result = await statsCounters.createCounterSuite(interaction.guild);
      return safeReply(interaction, {
        content: [
          '✅ Stats setup complete.',
          `Category: <#${result.categoryId}>`,
          '',
          `Created: \`${result.created.length}\``,
          `Reused: \`${result.reused.length}\``,
          `Repaired: \`${result.repaired.length}\``,
        ].join('\n'),
      });
    }

    if (subcommand === 'export') {
      const summary = statsStore.getSummary(interaction.guild.id);
      return safeReply(interaction, {
        content: '```json\n' + JSON.stringify(summary, null, 2).slice(0, 1800) + '\n```',
      });
    }

    return safeReply(interaction, {
      embeds: [buildStatsEmbed(interaction)],
    });
  },
};
