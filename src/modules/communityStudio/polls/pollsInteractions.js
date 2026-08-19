'use strict';

const { AttachmentBuilder, MessageFlags } = require('discord.js');
const polls = require('./polls');
const tracking = require('./pollsTracking');
const panel = require('./pollsPanel');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');

const getMemberDisplayName = (interaction) => interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User';
async function safeUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}
function updateSection(guild, updater, actorId = null) { return polls.updateSection(guild.id, updater, { actorId }); }

async function handlePollsInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('admin:polls') && !customId.startsWith('poll_vote:') && !customId.startsWith('poll_select:')) return false;
  if (customId.startsWith('poll_vote:') || customId.startsWith('poll_select:')) return tracking.vote(interaction);

  const memberDisplayName = getMemberDisplayName(interaction);
  const actorId = interaction.user?.id || null;
  try {
    if (customId === 'admin:polls:create') {
      if (!isModuleEnabled(interaction.guild.id, 'polls')) throw new Error('Polls are disabled.');
      await interaction.showModal(panel.buildCreateModal());
      return true;
    }
    if (customId === 'admin:polls:createSubmit' && interaction.isModalSubmit?.()) {
      if (!isModuleEnabled(interaction.guild.id, 'polls')) throw new Error('Polls are disabled.');
      const question = interaction.fields.getTextInputValue('question');
      const description = interaction.fields.getTextInputValue('description');
      const options = interaction.fields.getTextInputValue('options').split(/\r?\n/).map((label) => label.trim()).filter(Boolean);
      if (options.length < 2) throw new Error('Enter at least two options on separate lines.');
      if (options.length > 10) throw new Error('A poll supports no more than ten options.');
      const result = polls.createPoll(interaction.guild.id, { question, description, options: options.map((label) => ({ label })) }, { actorId });
      await interaction.reply({ content: `Poll created: **${result.poll.question}**`, flags: MessageFlags.Ephemeral, ...panel.buildPollDetailPanel(interaction.guild, result.poll.id) });
      return true;
    }
    if (customId === 'admin:polls' || customId === 'admin:polls:enable' || customId === 'admin:polls:disable') {
      if (customId.endsWith(':enable')) setModuleEnabled(interaction.guild.id, 'polls', true, { actorId, action: customId });
      if (customId.endsWith(':disable')) setModuleEnabled(interaction.guild.id, 'polls', false, { actorId, action: customId });
      return safeUpdate(interaction, panel.buildPollsAdminPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:polls:settings') return safeUpdate(interaction, panel.buildSettingsPanel(interaction.guild, memberDisplayName));
    if (customId === 'admin:polls:manage') return safeUpdate(interaction, panel.buildManagePanel(interaction.guild));
    if (interaction.isStringSelectMenu?.() && customId === 'admin:polls:select') return safeUpdate(interaction, panel.buildPollDetailPanel(interaction.guild, interaction.values[0]));
    if (interaction.isChannelSelectMenu?.()) {
      const value = interaction.values?.[0] || null;
      const prop = customId.split(':')[2];
      if (prop === 'defaultChannel') updateSection(interaction.guild, (section) => ({ ...section, defaultChannelId: value, settings: { ...(section.settings || {}), defaultChannelId: value } }), actorId);
      if (prop === 'resultsChannel') updateSection(interaction.guild, (section) => ({ ...section, resultsChannelId: value }), actorId);
      return safeUpdate(interaction, panel.buildSettingsPanel(interaction.guild, memberDisplayName));
    }
    if (interaction.isRoleSelectMenu?.() && customId === 'admin:polls:managerRoles') {
      updateSection(interaction.guild, (section) => ({ ...section, managerRoleIds: [...new Set(interaction.values || [])] }), actorId);
      return safeUpdate(interaction, panel.buildSettingsPanel(interaction.guild, memberDisplayName));
    }
    if (customId === 'admin:polls:toggleAnonymous') updateSection(interaction.guild, (section) => ({ ...section, anonymousVoting: !section.anonymousVoting, settings: { ...(section.settings || {}), anonymousVotes: !section.anonymousVoting } }), actorId);
    if (customId === 'admin:polls:toggleMultiple') updateSection(interaction.guild, (section) => ({ ...section, allowMultipleChoice: !section.allowMultipleChoice, settings: { ...(section.settings || {}), allowMultipleVotes: !section.allowMultipleChoice } }), actorId);
    if (customId === 'admin:polls:toggleLive') updateSection(interaction.guild, (section) => ({ ...section, showResultsLive: !section.showResultsLive }), actorId);
    if (['admin:polls:toggleAnonymous', 'admin:polls:toggleMultiple', 'admin:polls:toggleLive'].includes(customId)) return safeUpdate(interaction, panel.buildSettingsPanel(interaction.guild, memberDisplayName));

    const actionMatch = customId.match(/^admin:polls:(deploy|close|delete):(.+)$/);
    if (actionMatch) {
      const [, action, pollId] = actionMatch;
      await interaction.deferUpdate();
      if (action === 'deploy') await tracking.deployPoll(interaction.guild, pollId, null, { actorId });
      if (action === 'close') await tracking.setPollStatus(interaction.guild, pollId, 'closed', { actorId });
      if (action === 'delete') await tracking.deletePoll(interaction.guild, pollId, { actorId });
      return safeUpdate(interaction, action === 'delete' ? panel.buildManagePanel(interaction.guild) : panel.buildPollDetailPanel(interaction.guild, pollId));
    }
    if (customId === 'admin:polls:health') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const health = await tracking.buildHealth(interaction.guild);
      const issueLines = health.issues.length ? health.issues.slice(0, 10).map((issue) => `• ${issue.code}${issue.pollId ? ` — ${issue.pollId}` : ''}`) : ['• No issues found.'];
      await interaction.editReply({ content: `**Polls Health:** ${health.healthy ? 'Healthy ✅' : 'Needs attention ⚠️'}\n${issueLines.join('\n')}` });
      return true;
    }
    if (customId === 'admin:polls:repair') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await tracking.repair(interaction.guild, { actorId });
      await interaction.editReply({ content: `Poll repair complete. Repaired: **${result.repaired.length}** · Failed: **${result.failed.length}**.` });
      return true;
    }
    if (customId === 'admin:polls:export') {
      const exported = tracking.exportConfig(interaction.guild.id);
      const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exported, null, 2)), { name: `polls-${interaction.guild.id}.json` });
      await interaction.reply({ content: 'Poll configuration export.', files: [attachment], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (customId === 'admin:polls:reset') return safeUpdate(interaction, panel.buildResetConfirmation());
    if (customId === 'admin:polls:resetConfirm') {
      const wasEnabled = isModuleEnabled(interaction.guild.id, 'polls');
      await interaction.deferUpdate();
      await tracking.reset(interaction.guild, { actorId });
      if (!wasEnabled) setModuleEnabled(interaction.guild.id, 'polls', false, { actorId, action: 'admin:polls:resetConfirm' });
      return safeUpdate(interaction, panel.buildPollsAdminPanel(interaction.guild, memberDisplayName));
    }
    return safeUpdate(interaction, panel.buildPollsAdminPanel(interaction.guild, memberDisplayName));
  } catch (error) {
    const payload = { content: `❌ Polls setup failed: ${error.message}`, flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
    return true;
  }
}

module.exports = { handlePollsInteraction, handlePollsAdminInteraction: handlePollsInteraction };