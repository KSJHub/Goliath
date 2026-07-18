'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const { updateModuleSection } = require('../../core/guild/moduleSectionManager');
const invites = require('./invites');

const sessions = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));

function sessionFor(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (!sessions.has(key)) sessions.set(key, { selectedUserId: null, displayLimit: 5 });
  return sessions.get(key);
}

function personalLinks(guildId) {
  const byMember = new Map();
  for (const link of invites.listInviteLinks(guildId).filter((item) => item.personal && item.inviterId)) {
    if (!byMember.has(link.inviterId)) byMember.set(link.inviterId, link);
  }
  return [...byMember.values()];
}

function statsFor(section, userId) {
  const stats = section.inviters?.[userId] || {};
  return {
    total: Math.max(0, Number(stats.total || 0)),
    active: Math.max(0, Number(stats.active || 0)),
    left: Math.max(0, Number(stats.left || 0)),
    fake: Math.max(0, Number(stats.fake || 0)),
    bonus: Number(stats.bonus || 0),
    score: Math.max(0, Number(stats.active || 0) + Number(stats.bonus || 0)),
  };
}

function formatDate(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:f>` : 'Unknown';
}

function shortDate(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'Unknown';
  return new Date(timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function roleList(roleIds) {
  return roleIds?.length ? roleIds.map((id) => `<@&${id}>`).join(', ') : 'None';
}

function cleanCell(value, length) {
  const text = String(value ?? '').replace(/[`\n\r]/g, ' ').trim();
  return text.length > length ? `${text.slice(0, Math.max(1, length - 1))}…` : text.padEnd(length, ' ');
}

function rankedRows(interaction, section, links) {
  const ranking = invites.leaderboard(interaction.guildId, 1000);
  const rankMap = new Map(ranking.map((entry, index) => [entry.inviterId, index + 1]));
  return links.map((link) => {
    const member = interaction.guild.members.cache.get(link.inviterId);
    const stats = statsFor(section, link.inviterId);
    return {
      link,
      name: member?.displayName || member?.user?.username || link.inviterId,
      uses: Number(link.uses || 0),
      score: stats.score,
      rank: rankMap.get(link.inviterId) || null,
      created: shortDate(link.createdAt),
    };
  }).sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return b.score - a.score || b.uses - a.uses || a.name.localeCompare(b.name);
  });
}

function memberTableFields(rows, displayLimit) {
  const shown = displayLimit === 0 ? rows : rows.slice(0, displayLimit);
  if (!shown.length) return [{ name: 'Members', value: 'No personal invite links have been created yet.', inline: false }];
  const header = `${cleanCell('Member', 18)} ${cleanCell('Uses', 5)} ${cleanCell('Valid', 5)} ${cleanCell('Rank', 5)} ${cleanCell('Created', 8)}`;
  const lines = shown.map((entry) => `${cleanCell(entry.name, 18)} ${cleanCell(entry.uses, 5)} ${cleanCell(entry.score, 5)} ${cleanCell(entry.rank ? `#${entry.rank}` : '—', 5)} ${cleanCell(entry.created, 8)}`);
  const fields = [];
  for (let index = 0; index < lines.length && fields.length < 5; index += 14) {
    const chunk = lines.slice(index, index + 14);
    const value = `\`\`\`text\n${index === 0 ? `${header}\n${'─'.repeat(46)}\n` : ''}${chunk.join('\n')}\n\`\`\``;
    fields.push({ name: index === 0 ? `Members Shown: ${shown.length} of ${rows.length}` : '\u200b', value, inline: false });
  }
  return fields;
}

function buildInviteManagerPayload(interaction) {
  const section = invites.getSection(interaction.guildId);
  const links = personalLinks(interaction.guildId);
  const state = sessionFor(interaction);
  const rows = rankedRows(interaction, section, links);
  const selected = links.find((link) => link.inviterId === state.selectedUserId) || null;
  const stats = selected ? statsFor(section, selected.inviterId) : null;
  const ranking = invites.leaderboard(interaction.guildId, 1000);
  const rankIndex = selected ? ranking.findIndex((entry) => entry.inviterId === selected.inviterId) : -1;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🗂️ Invite Manager')
    .setDescription('View every member-owned invite, choose how many members to display, then select one member to manage their link and score.')
    .addFields(
      { name: 'Personal Links', value: String(links.length), inline: true },
      { name: 'Leaderboard Members', value: String(ranking.length), inline: true },
      { name: 'Tracked Invitees', value: String(Object.values(section.members || {}).filter((record) => record.inviterId).length), inline: true },
      ...memberTableFields(rows, state.displayLimit),
    );

  if (selected) {
    const member = interaction.guild.members.cache.get(selected.inviterId);
    const invitees = Object.values(section.members || {})
      .filter((record) => record.inviterId === selected.inviterId)
      .sort((a, b) => String(b.joinedAt || '').localeCompare(String(a.joinedAt || '')))
      .slice(0, 5);
    const recentInvitees = invitees.length
      ? invitees.map((record) => `• <@${record.memberId}> — ${record.leftAt ? 'Left' : 'Active'} — ${formatDate(record.joinedAt)}`).join('\n')
      : 'No tracked invitees yet.';
    embed.addFields(
      { name: 'Selected Member', value: member ? `${member} (${member.user.username})` : `<@${selected.inviterId}>`, inline: false },
      { name: 'Personal Link', value: `https://discord.gg/${selected.code}`, inline: false },
      { name: 'Discord Uses', value: String(selected.uses || 0), inline: true },
      { name: 'Valid Score', value: String(stats.score), inline: true },
      { name: 'Rank', value: rankIndex >= 0 ? `#${rankIndex + 1}` : 'Unranked', inline: true },
      { name: 'Lifetime / Active / Left', value: `${stats.total} / ${stats.active} / ${stats.left}`, inline: true },
      { name: 'Bonus / Flagged', value: `${stats.bonus} / ${stats.fake}`, inline: true },
      { name: 'Created', value: formatDate(selected.createdAt), inline: true },
      { name: 'Channel', value: selected.channelId ? `<#${selected.channelId}>` : 'Unknown', inline: true },
      { name: 'Expires', value: selected.expiresAt ? formatDate(selected.expiresAt) : 'Never', inline: true },
      { name: 'Roles Granted', value: roleList(selected.roleIds), inline: false },
      { name: 'Recent Invitees', value: recentInvitees, inline: false },
    );
  } else {
    embed.addFields({ name: 'Manage One Member', value: 'Select a member below to verify or delete their link, resend it, or reset only their score.', inline: false });
  }

  const displayMenu = new StringSelectMenuBuilder()
    .setCustomId('invites:manager-display')
    .setPlaceholder(state.displayLimit === 0 ? 'Display: All members' : `Display: ${state.displayLimit} members`)
    .addOptions(
      { label: 'Display 5', value: '5', default: state.displayLimit === 5 },
      { label: 'Display 10', value: '10', default: state.displayLimit === 10 },
      { label: 'Display 15', value: '15', default: state.displayLimit === 15 },
      { label: 'Display 20', value: '20', default: state.displayLimit === 20 },
      { label: 'Display All', value: '0', default: state.displayLimit === 0 },
    );
  const memberMenu = new UserSelectMenuBuilder()
    .setCustomId('invites:manager-select-member')
    .setPlaceholder(selected ? 'Select a different member to manage' : 'Select a member to manage')
    .setMinValues(1).setMaxValues(1);

  return {
    embeds: [embed],
    components: [
      row(displayMenu),
      row(memberMenu),
      row(
        button('invites:manager-verify', 'Verify Link', ButtonStyle.Secondary, !selected),
        button('invites:manager-resend', 'Resend Link', ButtonStyle.Primary, !selected),
        button('invites:manager-delete', 'Delete Link', ButtonStyle.Danger, !selected),
        button('invites:manager-reset-member', 'Reset Member Score', ButtonStyle.Danger, !selected),
      ),
      row(button('invites:admin-config', 'Back')),
    ],
  };
}

function updateRawSection(guildId, updater, meta = {}) {
  return updateModuleSection(guildId, invites.SECTION, updater, invites.defaults(), meta);
}

function resetMemberScore(guildId, userId, meta = {}) {
  return updateRawSection(guildId, (current = {}) => {
    const inviters = { ...(current.inviters || {}) };
    delete inviters[userId];
    const members = {};
    for (const [memberId, record] of Object.entries(current.members || {})) {
      members[memberId] = record?.inviterId === userId ? { ...record, inviterId: null, attribution: 'reset' } : record;
    }
    return { ...current, inviters, members };
  }, meta);
}

function resetLeaderboard(guildId, meta = {}) {
  return updateRawSection(guildId, (current = {}) => ({ ...current, inviters: {}, members: {} }), meta);
}

function useDefaultPanel(guildId, meta = {}) {
  const defaults = invites.defaults().settings;
  const current = invites.getSection(guildId);
  const expected = {
    title: defaults.publicPanel.title,
    description: defaults.publicPanel.description,
    color: defaults.publicPanel.color,
    footer: defaults.publicPanel.footer,
    buttonLabel: defaults.publicPanel.buttonLabel,
    dmTitle: defaults.memberInviteTemplate.dmTitle,
    dmMessage: defaults.memberInviteTemplate.dmMessage,
  };

  invites.updateSettings(guildId, {
    publicPanel: {
      ...current.settings.publicPanel,
      title: expected.title,
      description: expected.description,
      color: expected.color,
      footer: expected.footer,
      buttonLabel: expected.buttonLabel,
    },
    memberInviteTemplate: {
      ...current.settings.memberInviteTemplate,
      dmTitle: expected.dmTitle,
      dmMessage: expected.dmMessage,
    },
  }, meta);

  const saved = invites.getSection(guildId).settings;
  const verified = saved.publicPanel.title === expected.title
    && saved.publicPanel.description === expected.description
    && saved.publicPanel.color === expected.color
    && saved.publicPanel.footer === expected.footer
    && saved.publicPanel.buttonLabel === expected.buttonLabel
    && saved.memberInviteTemplate.dmTitle === expected.dmTitle
    && saved.memberInviteTemplate.dmMessage === expected.dmMessage;

  if (!verified) {
    throw new Error('Invite Studio could not persist the default panel and member DM values. No success response was sent.');
  }

  return {
    publicPanel: saved.publicPanel,
    memberInviteTemplate: saved.memberInviteTemplate,
  };
}

function renderTemplate(text, guild, user, url) {
  return String(text || '').replaceAll('{server}', guild.name).replaceAll('{user}', user.username).replaceAll('{invite}', url);
}

async function resendSelected(interaction, selected) {
  const member = await interaction.guild.members.fetch(selected.inviterId).catch(() => null);
  if (!member?.user) throw new Error('The selected member is no longer available in this server.');
  const live = await interaction.guild.invites.fetch(selected.code).catch(() => null);
  if (!live) throw new Error('The selected personal link no longer exists in Discord.');
  const template = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  const url = live.url || `https://discord.gg/${selected.code}`;
  const embed = new EmbedBuilder().setColor(0x5865F2)
    .setTitle(renderTemplate(template.dmTitle, interaction.guild, member.user, url))
    .setDescription(renderTemplate(template.dmMessage, interaction.guild, member.user, url))
    .setFooter({ text: 'This is your only personal Invite Studio link.' }).setTimestamp();
  await member.user.send({ embeds: [embed] });
  return url;
}

async function publicRefresh(guild, action = 'invite_manager_refresh') {
  const panels = require('./invitesPublicPanels');
  await panels.refreshPublicPanel(guild, { action }).catch(() => null);
}

async function handleInviteManagerInteraction(interaction) {
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('invites:manager-')) return false;
  const state = sessionFor(interaction);

  if (customId === 'invites:manager-display' && interaction.isStringSelectMenu()) {
    state.displayLimit = Number(interaction.values[0]);
    await interaction.update(buildInviteManagerPayload(interaction));
    return true;
  }
  if (customId === 'invites:manager-select-member' && interaction.isUserSelectMenu()) {
    const userId = interaction.values[0];
    const selected = personalLinks(interaction.guildId).find((link) => link.inviterId === userId) || null;
    state.selectedUserId = selected ? userId : null;
    if (!selected) {
      await interaction.reply({ content: '❌ That member does not currently have a personal Invite Studio link.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.update(buildInviteManagerPayload(interaction));
    return true;
  }

  const links = personalLinks(interaction.guildId);
  const selected = links.find((link) => link.inviterId === state.selectedUserId) || null;
  if (!selected) {
    await interaction.reply({ content: '❌ Select a member with a personal invite first.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (customId === 'invites:manager-verify') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const live = await interaction.guild.invites.fetch(selected.code).catch(() => null);
    if (!live) return interaction.editReply('❌ This personal link no longer exists in Discord.');
    await invites.syncGuild(interaction.guild, { actorId: interaction.user.id, action: 'invite_manager_verify' }).catch(() => null);
    await interaction.editReply(`✅ Personal link verified.\n${live.url}\n\nDiscord uses: **${live.uses || 0}**\nOwner in Invite Studio: <@${selected.inviterId}>`);
    return true;
  }
  if (customId === 'invites:manager-resend') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const url = await resendSelected(interaction, selected);
      await interaction.editReply(`✅ Personal link resent to <@${selected.inviterId}>.\n${url}`);
    } catch (error) {
      await interaction.editReply(`❌ ${String(error?.message || error).slice(0, 1800)}`);
    }
    return true;
  }
  if (customId === 'invites:manager-delete') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await invites.deletePersonalInvite(interaction.guild, selected.inviterId, { actorId: interaction.user.id, action: 'invite_manager_delete_personal' });
    state.selectedUserId = null;
    await interaction.editReply('✅ Personal link deleted. The member can create a new link using the current admin template.');
    return true;
  }
  if (customId === 'invites:manager-reset-member') {
    resetMemberScore(interaction.guildId, selected.inviterId, { actorId: interaction.user.id, action: 'invite_manager_reset_member_score' });
    await publicRefresh(interaction.guild, 'invite_manager_member_reset_refresh');
    await interaction.reply({ content: `✅ Invite score reset for <@${selected.inviterId}>. Their personal link was kept.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

module.exports = {
  buildInviteManagerPayload,
  handleInviteManagerInteraction,
  resetLeaderboard,
  resetMemberScore,
  useDefaultPanel,
};