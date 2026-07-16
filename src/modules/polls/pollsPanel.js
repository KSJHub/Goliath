'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const polls = require('./polls');
const pollsHealth = require('./pollsHealth');

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(customId, label, style = ButtonStyle.Primary) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function getMemberDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
}

function formatChannel(id) {
  return id ? `<#${id}>` : '`Not set`';
}

function formatRoles(ids = []) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  return list.length ? list.map((id) => `<@&${id}>`).join(', ') : '`None`';
}

function updateSection(guild, updater, actorId = null) {
  const current = polls.getSection(guild.id);
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) };
  return polls.saveSection(guild.id, next, { actorId });
}

function mainPanel(guild, memberDisplayName = 'Unknown User') {
  const section = polls.getSection(guild.id);
  const pollList = Object.values(section.polls || {});
  const active = pollList.filter((poll) => poll.status === 'active').length;

  const embed = new EmbedBuilder()
    .setColor(section.enabled !== false ? 0x57f287 : 0x5865f2)
    .setTitle('📊 Polls')
    .setDescription([
      'Create, deploy and manage community polls directly in Discord.',
      '',
      `**Status:** ${section.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
      `**Default Channel:** ${formatChannel(section.defaultChannelId || section.settings?.defaultChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      `**Anonymous Voting:** ${section.anonymousVoting ? 'Yes ✅' : 'No ❌'}`,
      `**Multiple Choice:** ${section.allowMultipleChoice ? 'Yes ✅' : 'No ❌'}`,
      `**Live Results:** ${section.showResultsLive !== false ? 'Yes ✅' : 'No ❌'}`,
      `**Auto Close:** ${Number(section.settings?.autoCloseHours || 0) > 0 ? `${section.settings.autoCloseHours} hour(s)` : 'Disabled'}`,
      '',
      `Polls: \`${pollList.length}\` | Active: \`${active}\` | Votes: \`${section.analytics.votes || 0}\``,
      `Created: \`${section.analytics.created || 0}\` | Deployed: \`${section.analytics.deployed || 0}\` | Closed: \`${section.analytics.closed || 0}\``,
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      row(
        button('admin:polls:create', '➕ Create Poll', ButtonStyle.Success),
        button('admin:polls:manage', '🗂️ Manage Polls', ButtonStyle.Primary),
        button(section.enabled !== false ? 'admin:polls:disable' : 'admin:polls:enable', section.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary)
      ),
      row(
        button('admin:polls:settings', '⚙️ Settings', ButtonStyle.Secondary),
        button('admin:polls:health', '🩺 Health', ButtonStyle.Secondary),
        button('admin:polls:repair', '🛠️ Repair', ButtonStyle.Primary),
        button('admin:polls:export', '📤 Export', ButtonStyle.Secondary),
        button('admin:polls:reset', '🗑️ Reset', ButtonStyle.Danger)
      ),
      row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
    ],
  };
}

function settingsPanel(guild, memberDisplayName) {
  const section = polls.getSection(guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Poll Settings')
    .setDescription([
      `**Default Channel:** ${formatChannel(section.defaultChannelId || section.settings?.defaultChannelId)}`,
      `**Results Channel:** ${formatChannel(section.resultsChannelId)}`,
      `**Manager Roles:** ${formatRoles(section.managerRoleIds)}`,
      '',
      'Use the selectors and buttons below. Auto-close hours are configured from the dashboard.',
    ].join('\n'))
    .setFooter({ text: `Requested by ${memberDisplayName}` });

  return {
    embeds: [embed],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:polls:defaultChannel').setPlaceholder('Default poll channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new ChannelSelectMenuBuilder().setCustomId('admin:polls:resultsChannel').setPlaceholder('Results channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
      row(new RoleSelectMenuBuilder().setCustomId('admin:polls:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
      row(
        button('admin:polls:toggleAnonymous', '👤 Anonymous', ButtonStyle.Secondary),
        button('admin:polls:toggleMultiple', '☑️ Multiple', ButtonStyle.Secondary),
        button('admin:polls:toggleLive', '📈 Live Results', ButtonStyle.Secondary)
      ),
      row(button('admin:polls', '⬅️ Back', ButtonStyle.Secondary)),
    ],
  };
}

function managePanel(guild) {
  const pollList = Object.values(polls.getSection(guild.id).polls || {})
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 25);

  if (!pollList.length) {
    return {
      content: 'No polls exist yet. Create one first.',
      embeds: [],
      components: [row(button('admin:polls:create', '➕ Create Poll', ButtonStyle.Success), button('admin:polls', '⬅️ Back', ButtonStyle.Secondary))],
    };
  }

  const selector = new StringSelectMenuBuilder()
    .setCustomId('admin:polls:select')
    .setPlaceholder('Select a poll to manage')
    .addOptions(pollList.map((poll) => ({
      label: String(poll.question).slice(0, 100),
      description: `${poll.status} · ${poll.options.length} options`.slice(0, 100),
      value: poll.id,
    })));

  return {
    content: 'Select a poll to deploy, close, refresh or delete.',
    embeds: [],
    components: [row(selector), row(button('admin:polls', '⬅️ Back', ButtonStyle.Secondary))],
  };
}

function pollDetailPanel(guild, pollId) {
  const poll = polls.getPoll(guild.id, pollId);
  if (!poll) throw new Error('Poll not found.');
  const summary = polls.summarizePoll(poll);
  const embed = polls.buildPollEmbed(poll);
  embed.addFields(
    { name: 'Status', value: poll.status, inline: true },
    { name: 'Responses', value: String(summary.totalVotes || 0), inline: true },
    { name: 'Channel', value: formatChannel(poll.channelId), inline: true }
  );

  const actions = [];
  if (poll.status !== 'closed') actions.push(button(`admin:polls:deploy:${poll.id}`, poll.messageId ? '🔄 Refresh' : '🚀 Deploy', ButtonStyle.Success));
  if (poll.status === 'active') actions.push(button(`admin:polls:close:${poll.id}`, '⏹️ Close', ButtonStyle.Danger));
  actions.push(button(`admin:polls:delete:${poll.id}`, '🗑️ Delete', ButtonStyle.Danger));
  actions.push(button('admin:polls:manage', '⬅️ Polls', ButtonStyle.Secondary));

  return { embeds: [embed], components: [row(...actions)] };
}

function createModal() {
  return new ModalBuilder()
    .setCustomId('admin:polls:createSubmit')
    .setTitle('Create Poll')
    .addComponents(
      row(new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)),
      row(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
      row(new TextInputBuilder().setCustomId('options').setLabel('Options — one per line').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Yes\nNo').setMinLength(3).setMaxLength(800))
    );
}

async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return true;
  }
  await interaction.update(payload);
  return true;
}

async function handlePollsAdminInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:polls')) return false;

  const memberDisplayName = getMemberDisplayName(interaction);
  const actorId = interaction.user?.id || null;

  try {
    if (customId === 'admin:polls:create') {
      await interaction.showModal(createModal());
      return true;
    }

    if (customId === 'admin:polls:createSubmit' && interaction.isModalSubmit?.()) {
      const question = interaction.fields.getTextInputValue('question');
      const description = interaction.fields.getTextInputValue('description');
      const options = interaction.fields.getTextInputValue('options').split(/\r?\n/).map((label) => label.trim()).filter(Boolean);
      if (options.length < 2) throw new Error('Enter at least two options on separate lines.');
      if (options.length > 10) throw new Error('A poll supports no more than ten options.');
      const result = polls.createPoll(interaction.guild.id, { question, description, options: options.map((label) => ({ label })) }, { actorId });
      await interaction.reply({ content: `Poll created: **${result.poll.question}**`, flags: MessageFlags.Ephemeral, ...pollDetailPanel(interaction.guild, result.poll.id) });
      return true;
    }

    if (customId === 'admin:polls' || customId === 'admin:polls:enable' || customId === 'admin:polls:disable') {
      if (customId.endsWith(':enable')) updateSection(interaction.guild, (section) => ({ ...section, enabled: true }), actorId);
      if (customId.endsWith(':disable')) updateSection(interaction.guild, (section) => ({ ...section, enabled: false }), actorId);
      return safeUpdate(interaction, mainPanel(interaction.guild, memberDisplayName));
    }

    if (customId === 'admin:polls:settings') return safeUpdate(interaction, settingsPanel(interaction.guild, memberDisplayName));
    if (customId === 'admin:polls:manage') return safeUpdate(interaction, managePanel(interaction.guild));

    if (interaction.isStringSelectMenu?.() && customId === 'admin:polls:select') {
      return safeUpdate(interaction, pollDetailPanel(interaction.guild, interaction.values[0]));
    }

    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'defaultChannel') updateSection(interaction.guild, (section) => ({ ...section, defaultChannelId: value, settings: { ...(section.settings || {}), defaultChannelId: value } }), actorId);
      if (prop === 'resultsChannel') updateSection(interaction.guild, (section) => ({ ...section, resultsChannelId: value }), actorId);
      return safeUpdate(interaction, settingsPanel(interaction.guild, memberDisplayName));
    }

    if (interaction.isRoleSelectMenu?.() && customId === 'admin:polls:managerRoles') {
      updateSection(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }), actorId);
      return safeUpdate(interaction, settingsPanel(interaction.guild, memberDisplayName));
    }

    if (customId === 'admin:polls:toggleAnonymous') updateSection(interaction.guild, (section) => ({ ...section, anonymousVoting: !section.anonymousVoting, settings: { ...(section.settings || {}), anonymousVotes: !section.anonymousVoting } }), actorId);
    if (customId === 'admin:polls:toggleMultiple') updateSection(interaction.guild, (section) => ({ ...section, allowMultipleChoice: !section.allowMultipleChoice, settings: { ...(section.settings || {}), allowMultipleVotes: !section.allowMultipleChoice } }), actorId);
    if (customId === 'admin:polls:toggleLive') updateSection(interaction.guild, (section) => ({ ...section, showResultsLive: !section.showResultsLive }), actorId);
    if (['admin:polls:toggleAnonymous', 'admin:polls:toggleMultiple', 'admin:polls:toggleLive'].includes(customId)) {
      return safeUpdate(interaction, settingsPanel(interaction.guild, memberDisplayName));
    }

    const actionMatch = customId.match(/^admin:polls:(deploy|close|delete):(.+)$/);
    if (actionMatch) {
      const [, action, pollId] = actionMatch;
      await interaction.deferUpdate();
      if (action === 'deploy') await polls.deployPoll(interaction.guild, pollId, null, { actorId });
      if (action === 'close') await polls.setPollStatus(interaction.guild, pollId, 'closed', { actorId });
      if (action === 'delete') await polls.deletePoll(interaction.guild, pollId, { actorId });
      return safeUpdate(interaction, action === 'delete' ? managePanel(interaction.guild) : pollDetailPanel(interaction.guild, pollId));
    }

    if (customId === 'admin:polls:health') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const health = await pollsHealth.buildHealth(interaction.guild);
      const issueLines = health.issues.length ? health.issues.slice(0, 10).map((issue) => `• ${issue.code}${issue.pollId ? ` — ${issue.pollId}` : ''}`) : ['• No issues found.'];
      await interaction.editReply({ content: `**Polls Health:** ${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}\n${issueLines.join('\n')}` });
      return true;
    }

    if (customId === 'admin:polls:repair') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await pollsHealth.repair(interaction.guild, { actorId });
      await interaction.editReply({ content: `Poll repair complete. Repaired: **${result.repaired.length}** · Failed: **${result.failed.length}**.` });
      return true;
    }

    if (customId === 'admin:polls:export') {
      const exported = pollsHealth.exportConfig(interaction.guild.id);
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exported, null, 2)), { name: `polls-${interaction.guild.id}.json` });
      await interaction.reply({ content: 'Poll configuration export.', files: [attachment], flags: MessageFlags.Ephemeral });
      return true;
    }

    if (customId === 'admin:polls:reset') {
      return safeUpdate(interaction, { content: 'This deletes every tracked poll message and resets Polls. Confirm?', embeds: [], components: [row(button('admin:polls:resetConfirm', 'Confirm Reset', ButtonStyle.Danger), button('admin:polls', 'Cancel', ButtonStyle.Secondary))] });
    }

    if (customId === 'admin:polls:resetConfirm') {
      await interaction.deferUpdate();
      await pollsHealth.reset(interaction.guild, { actorId });
      return safeUpdate(interaction, mainPanel(interaction.guild, memberDisplayName));
    }

    return safeUpdate(interaction, mainPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Polls setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = {
  buildPollsAdminPanel: mainPanel,
  handlePollsAdminInteraction,
};