'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, MessageFlags, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} = require('discord.js');
const invites = require('./invites');
const { rolePages, rolePageSelect } = require('../../../core/ui/rolePagination');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const { replaceVars } = require('../../../core/guild/guildVariables');

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
  const trackedJoins = Number(section.analytics?.tracked || 0);
  return {
    embeds: [new EmbedBuilder().setColor(enabled ? 0x57F287 : 0xED4245).setTitle('📨 Invite Studio')
      .setDescription('Manage server invitations, member referrals and invite leaderboards.\n\n' + (enabled ? '🟢 **Module Enabled**' : '🔴 **Module Disabled**'))
      .addFields(
        { name: 'Official Invite', value: officialUrl(official.code) || 'Not configured', inline: true },
        { name: 'Public Panel', value: section.settings.publicPanel.messageId ? 'Deployed' : 'Not deployed', inline: true },
        { name: 'Member Links', value: String(memberLinks), inline: true },
        { name: 'Tracked Joins', value: String(trackedJoins), inline: true },
      )],
    components: [
      row(button('invites:official-settings', 'Official Invite', ButtonStyle.Primary), button('invites:member-settings', 'Member Invites', ButtonStyle.Primary), button('invites:public-config', 'Public Panel & Leaderboard', ButtonStyle.Primary)),
      row(button('admin:modules', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function officialView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.officialInvite;
  const link = config.code ? section.inviteLinks[config.code] : null;
  const state = sessionFor(interaction);
  const info = rolePages(interaction.guild, config.roleIds || [], state.officialRolePage || 0);
  state.officialRolePage = info.page;
  const ageNames = { 0: 'Never', 1800: '30 minutes', 3600: '1 hour', 21600: '6 hours', 43200: '12 hours', 86400: '1 day', 604800: '7 days', 2592000: '30 days' };
  const expires = link?.expiresAt ? new Date(link.expiresAt) : null;
  const expiryLabel = expires && Number.isFinite(expires.getTime()) ? `<t:${Math.floor(expires.getTime() / 1000)}:R>` : 'Never';
  const configured = Boolean(config.code);
  const confirmation = state.officialConfirm && state.officialConfirm.until > Date.now() ? state.officialConfirm.action : null;
  const live = state.officialLive?.code === config.code ? state.officialLive : null;
  const matching = link && link.channelId === config.channelId &&
    Number(link.maxAge || 0) === Number(config.maxAge || 0) &&
    Number(link.maxUses || 0) === Number(config.maxUses || 0) &&
    JSON.stringify([...(link.roleIds || [])].sort()) === JSON.stringify([...(config.roleIds || [])].sort());
  const needsUpdate = configured && (!matching || live?.exists === false);
  const updateArmed = state.officialConfirm?.action === 'update' && state.officialConfirm.until > Date.now();
  const liveStatus = !configured ? '⚪ Not configured' : live?.exists === false ? '🔴 Link missing or expired' : live?.exists === true ? (matching ? '🟢 Verified active' : '🟠 Settings saved — update invite to apply') : (matching ? '🟡 Saved — verify live status' : '🟠 Changes pending — update invite');
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🌍 Official Invite')
      .setDescription('Create and manage your server’s official invitation link.')
      .addFields(
        { name: 'Status', value: liveStatus + (!config.channelId ? '\nChoose a destination channel to enable Create Invite.' : ''), inline: false },
        { name: '🔗 Invite Link', value: officialUrl(config.code) || 'No link created yet', inline: false },
        { name: '📍 Destination', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: '👥 Uses', value: configured ? (live?.exists ? String(live.uses) + ' (Discord)' : String(link?.uses || 0) + ' (recorded)') : '—', inline: true },
        { name: '⏳ Expires', value: configured ? expiryLabel : ageNames[config.maxAge || 0] || 'Never', inline: true },
        { name: '🔢 Maximum Uses', value: config.maxUses ? String(config.maxUses) : 'Unlimited', inline: true },
        { name: '🎭 Join Roles', value: roleList(config.roleIds), inline: false },

        ...(updateArmed ? [{ name: '⚠️ Confirm Replacement', value: 'The current invite will be replaced and its old URL will stop working. Press Confirm Update within 30 seconds.', inline: false }] : []),
        ...(info.pages > 1 ? [{ name: 'Role Selection', value: `Page ${info.page + 1} of ${info.pages}`, inline: false }] : []),
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('📍 Select destination channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:official-roles:${info.page}`, '🎭 Select join roles (optional)', info))] : []),
      row(button('invites:official-create', !configured ? 'Create Invite' : updateArmed ? 'Confirm Update' : 'Update Invite', updateArmed ? ButtonStyle.Danger : ButtonStyle.Success, !config.channelId || (configured && !needsUpdate)),
        button('invites:official-limits', 'Link Limits', ButtonStyle.Primary),
        ...(configured ? [button('invites:official-verify', 'Verify Link')] : [])),
      ...(info.pages > 1 ? [row(button('invites:official-role-prev', '◀ Roles', ButtonStyle.Secondary, info.page === 0), button('invites:official-role-next', 'Roles ▶', ButtonStyle.Secondary, info.page >= info.pages - 1))] : []),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function officialLimitsModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.officialInvite;
  return new ModalBuilder().setCustomId('invites:official-limits-submit').setTitle('Official Invite Limits').addComponents(
    row(new TextInputBuilder().setCustomId('maxAge').setLabel('Expiry: Never, 1 hour, 1 day, 7 days...').setStyle(TextInputStyle.Short).setValue(({0:'Never',1800:'30 minutes',3600:'1 hour',21600:'6 hours',43200:'12 hours',86400:'1 day',604800:'7 days',2592000:'30 days'})[config.maxAge || 0] || 'Never').setRequired(true)),
    row(new TextInputBuilder().setCustomId('maxUses').setLabel('Maximum uses: Unlimited, 1, 5, 10...').setStyle(TextInputStyle.Short).setValue(config.maxUses ? String(config.maxUses) : 'Unlimited').setRequired(true)),
  );
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
      row(button('invites:panel-deploy', 'Send / Update Panel', ButtonStyle.Success, !config.channelId || !section.settings.officialInvite.code)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function memberSettingsView(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  const state = sessionFor(interaction);
  const info = rolePages(interaction.guild, config.roleIds || [], state.memberRolePage || 0);
  state.memberRolePage = info.page;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Member Link Settings')
      .addFields(
        { name: 'Status', value: config.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Roles', value: roleList(config.roleIds), inline: false },
        { name: 'Role Selection', value: `Page ${info.page + 1}/${info.pages}`, inline: true },
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:member-channel').setPlaceholder('Select member invite channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:member-roles:${info.page}`, 'Roles granted to invitees', info))] : []),
      row(button('invites:member-enabled', config.enabled ? 'Disable Links' : 'Enable Links'), button('invites:member-dm-modal', 'Edit Member DM', ButtonStyle.Primary), button('invites:member-role-prev', '◀ Roles', ButtonStyle.Secondary, info.page === 0), button('invites:member-role-next', 'Roles ▶', ButtonStyle.Secondary, info.page >= info.pages - 1)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
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
      row(button('invites:official-regenerate', state.officialConfirm?.action === 'regenerate' && state.officialConfirm.until > Date.now() ? 'Confirm Regenerate' : 'Regenerate Official Invite', ButtonStyle.Secondary, !section.settings.officialInvite.code), button('invites:official-delete', state.officialConfirm?.action === 'delete' && state.officialConfirm.until > Date.now() ? 'Confirm Delete' : 'Delete Official Invite', ButtonStyle.Danger, !section.settings.officialInvite.code)),
      row(button(armed ? 'invites:leaderboard-reset-confirm' : 'invites:leaderboard-reset-arm', armed ? 'Confirm Reset' : 'Reset Leaderboard', ButtonStyle.Danger), button('invites:default-panel', 'Restore Defaults'), button('invites:toggle', enabled ? 'Disable' : 'Enable', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings', ButtonStyle.Secondary, true)),
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
    row(button('invites:admin-config', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings', ButtonStyle.Secondary, true)),
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
  const render = (value) => replaceVars(value, interaction, false, {
    '{user}': interaction.user.username,
    '{invite}': url,
  });
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
module.exports = {
  officialLimitsModal, sessionFor, buildInviteStudioPayload, buildPublicPayload, profilePayload, personalInvitePayload, embedModal, dmModal };