'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, MessageFlags, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} = require('discord.js');
const invites = require('./invites');
const { isModuleEnabled } = require('../../../core/guild/guildManager');

const sessions = new Map();
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(Boolean(disabled));
const sessionFor = (interaction) => {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  if (!sessions.has(key)) sessions.set(key, { page: 'overview', selectedUserId: null, displayLimit: 5, resetConfirmUntil: 0 });
  return sessions.get(key);
};
const officialUrl = (code) => code ? `https://discord.gg/${code}` : null;
const roleList = (ids = []) => ids.length ? ids.map((id) => `<@&${id}>`).join(', ') : 'None';

function overview(interaction) {
  const section = invites.getSection(interaction.guildId);
  const enabled = isModuleEnabled(interaction.guildId, 'invites');
  const official = section.settings.officialInvite;
  const memberLinks = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal).length;
  return {
    embeds: [new EmbedBuilder().setColor(enabled ? 0x57F287 : 0xED4245).setTitle('📨 Invite Studio')
      .setDescription('Configure official invites, member links, the public leaderboard and administration.')
      .addFields(
        { name: 'Status', value: enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Official Invite', value: officialUrl(official.code) || 'Not configured', inline: true },
        { name: 'Member Links', value: String(memberLinks), inline: true },
        { name: 'Public Panel', value: section.settings.publicPanel.messageId ? 'Deployed' : 'Not deployed', inline: true },
      )],
    components: [
      row(button('invites:official-settings', 'Official Invite', ButtonStyle.Primary), button('invites:public-config', 'Public Panel', ButtonStyle.Primary), button('invites:admin-config', 'Admin', ButtonStyle.Primary)),
      row(button('admin:modules', 'Back to Modules')),
    ],
  };
}

function officialView(interaction) {
  const config = invites.getSection(interaction.guildId).settings.officialInvite;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🌍 Official Invite Settings')
      .addFields(
        { name: 'Current Link', value: officialUrl(config.code) || 'None', inline: false },
        { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Roles', value: roleList(config.roleIds), inline: true },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('Select invite channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new RoleSelectMenuBuilder().setCustomId('invites:official-roles').setPlaceholder('Roles granted to invitees').setMinValues(0).setMaxValues(10)),
      row(button('invites:official-create', 'Create / Repair Link', ButtonStyle.Success, !config.channelId), button('invites:official-delete', 'Delete Link', ButtonStyle.Danger, !config.code), button('invites:home', 'Back')),
    ],
  };
}

function publicView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.publicPanel;
  const member = section.settings.memberInviteTemplate;
  return {
    embeds: [new EmbedBuilder().setColor(config.color).setTitle('📣 Public Invite Panel')
      .addFields(
        { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Status', value: config.messageId ? 'Deployed' : 'Not deployed', inline: true },
        { name: 'Leaderboard', value: `Top ${config.leaderboardLimit}`, inline: true },
        { name: 'Member Links', value: member.enabled ? 'Enabled' : 'Disabled', inline: true },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:panel-channel').setPlaceholder('Select panel channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new StringSelectMenuBuilder().setCustomId('invites:panel-limit').setPlaceholder(`Leaderboard: Top ${config.leaderboardLimit}`).addOptions([5, 10, 15, 20, 25].map((value) => ({ label: `Top ${value}`, value: String(value) })))),
      row(button('invites:member-settings', 'Member Link Settings', ButtonStyle.Primary), button('invites:panel-embed-modal', 'Edit Panel Text', ButtonStyle.Primary)),
      row(button('invites:panel-deploy', 'Send / Update Panel', ButtonStyle.Success, !config.channelId || !section.settings.officialInvite.code), button('invites:home', 'Back')),
    ],
  };
}

function memberSettingsView(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Member Link Settings')
      .addFields(
        { name: 'Status', value: config.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Roles', value: roleList(config.roleIds), inline: false },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:member-channel').setPlaceholder('Select member invite channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new RoleSelectMenuBuilder().setCustomId('invites:member-roles').setPlaceholder('Roles granted to invitees').setMinValues(0).setMaxValues(10)),
      row(button('invites:member-enabled', config.enabled ? 'Disable Links' : 'Enable Links'), button('invites:member-dm-modal', 'Edit Member DM', ButtonStyle.Primary), button('invites:public-config', 'Back')),
    ],
  };
}

function adminView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const enabled = isModuleEnabled(interaction.guildId, 'invites');
  const state = sessionFor(interaction);
  const armed = state.resetConfirmUntil > Date.now();
  return {
    embeds: [new EmbedBuilder().setColor(enabled ? 0x57F287 : 0xED4245).setTitle('🛠️ Invite Studio Admin')
      .setDescription(armed ? '⚠️ Reset armed. Confirm within 30 seconds.' : 'Manage member links, health, repairs and leaderboard data.')],
    components: [
      row(button('invites:invite-manager', 'Invite Manager', ButtonStyle.Primary), button('invites:health', 'Health'), button('invites:repair', 'Repair')),
      row(button(armed ? 'invites:leaderboard-reset-confirm' : 'invites:leaderboard-reset-arm', armed ? 'Confirm Reset' : 'Reset Leaderboard', ButtonStyle.Danger), button('invites:default-panel', 'Restore Defaults'), button('invites:toggle', enabled ? 'Disable' : 'Enable', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(button('invites:home', 'Back')),
    ],
  };
}

function managerView(interaction) {
  const state = sessionFor(interaction);
  const links = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal && link.inviterId);
  const selected = links.find((link) => link.inviterId === state.selectedUserId);
  const list = links.slice(0, state.displayLimit || links.length).map((link, index) => `${index + 1}. <@${link.inviterId}> — ${officialUrl(link.code)} — ${link.uses || 0} uses`).join('\n') || 'No personal links yet.';
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🗂️ Invite Manager').setDescription(list);
  if (selected) embed.addFields({ name: 'Selected', value: `<@${selected.inviterId}>\n${officialUrl(selected.code)}` });
  return { embeds: [embed], components: [
    row(new StringSelectMenuBuilder().setCustomId('invites:manager-display').setPlaceholder('Members shown').addOptions([5, 10, 15, 20, 0].map((value) => ({ label: value ? `Display ${value}` : 'Display All', value: String(value) })))),
    row(new UserSelectMenuBuilder().setCustomId('invites:manager-select-member').setPlaceholder('Select a member').setMinValues(1).setMaxValues(1)),
    row(button('invites:manager-verify', 'Verify', ButtonStyle.Secondary, !selected), button('invites:manager-resend', 'Resend', ButtonStyle.Primary, !selected), button('invites:manager-delete', 'Delete', ButtonStyle.Danger, !selected), button('invites:manager-reset-member', 'Reset Score', ButtonStyle.Danger, !selected)),
    row(button('invites:admin-config', 'Back')),
  ] };
}

function buildPublicPayload(guildId, sourceSection = null) {
  const section = sourceSection || invites.getSection(guildId);
  const panel = section.settings.publicPanel;
  const url = officialUrl(section.settings.officialInvite.code);
  if (!url) throw new Error('Create the official invite before sending the public panel.');
  const entries = invites.leaderboard(guildId, panel.leaderboardLimit);
  const lines = entries.length ? entries.map((entry, index) => `${['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`} <@${entry.inviterId}> — **${entry.score}** valid invite${entry.score === 1 ? '' : 's'}`).join('\n') : 'No member invites have been recorded yet.';
  return { embeds: [new EmbedBuilder().setColor(panel.color).setTitle(panel.title).setDescription(panel.description).addFields({ name: 'Official Server Invite', value: url }, { name: '🏆 Invite Leaderboard', value: lines }).setFooter({ text: panel.footer }).setTimestamp()], components: [row(button('invites:member-personal', 'Create My Link', ButtonStyle.Primary), button('invites:member-profile', 'My Profile'), button('invites:member-refresh', 'Update Leaderboard'))] };
}

function profilePayload(guild, user) {
  const section = invites.getSection(guild.id);
  const stats = section.inviters[user.id] || {};
  const score = Math.max(0, Number(stats.active || 0) + Number(stats.bonus || 0));
  const rank = invites.leaderboard(guild.id, 100).findIndex((entry) => entry.inviterId === user.id);
  const personal = invites.findPersonalInvite(guild.id, user.id);
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`💎 ${user.displayName || user.username}'s Invite Profile`).setThumbnail(user.displayAvatarURL?.() || null).addFields({ name: 'Rank', value: rank >= 0 ? `#${rank + 1}` : 'Unranked', inline: true }, { name: 'Score', value: String(score), inline: true }, { name: 'Lifetime', value: String(stats.total || 0), inline: true }, { name: 'Active', value: String(stats.active || 0), inline: true }, { name: 'Personal Link', value: officialUrl(personal?.code) || 'No personal invite yet' }).setTimestamp()], components: [row(button('invites:member-personal', personal ? 'Resend My Link' : 'Get My Link', ButtonStyle.Primary))], flags: MessageFlags.Ephemeral };
}

function personalInvitePayload(interaction, result) {
  const template = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  const url = result.invite.url || officialUrl(result.record.code);
  const render = (value) => String(value || '').replaceAll('{server}', interaction.guild.name).replaceAll('{user}', interaction.user.username).replaceAll('{invite}', url);
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(render(template.dmTitle)).setDescription(render(template.dmMessage)).setTimestamp()] };
}

function buildInviteStudioPayload(interaction, forcedPage = null) {
  const state = sessionFor(interaction);
  if (forcedPage === 'configure') state.page = 'overview';
  if (state.page === 'official-settings') return officialView(interaction);
  if (state.page === 'public-config') return publicView(interaction);
  if (state.page === 'member-settings') return memberSettingsView(interaction);
  if (state.page === 'admin-config') return adminView(interaction);
  if (state.page === 'invite-manager') return managerView(interaction);
  return overview(interaction);
}

function embedModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.publicPanel;
  return new ModalBuilder().setCustomId('invites:panel-embed-submit').setTitle('Edit Invite Panel').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.title)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(config.description)),
    row(new TextInputBuilder().setCustomId('footer').setLabel('Footer').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.footer)),
    row(new TextInputBuilder().setCustomId('color').setLabel('Colour hex').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.color)),
  );
}
function dmModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  return new ModalBuilder().setCustomId('invites:member-dm-submit').setTitle('Edit Member Invite DM').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('DM title').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.dmTitle)),
    row(new TextInputBuilder().setCustomId('message').setLabel('DM message').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(config.dmMessage)),
  );
}
module.exports = { sessionFor, buildInviteStudioPayload, buildPublicPayload, profilePayload, personalInvitePayload, embedModal, dmModal };