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
      row(button('invites:official-settings', 'Invite Management', ButtonStyle.Primary), button('invites:public-config', 'Public Panel & Leaderboard', ButtonStyle.Primary)),
      row(button('admin:modules', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function officialView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.officialInvite;
  const member = section.settings.memberInviteTemplate;
  const memberLinks = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal).length;
  const link = config.code ? section.inviteLinks[config.code] : null;
  const state = sessionFor(interaction);
  const info = rolePages(interaction.guild, config.roleIds || [], state.officialRolePage || 0);
  state.officialRolePage = info.page;
  const memberInfo = rolePages(interaction.guild, member.roleIds || [], state.memberRolePage || 0);
  state.memberRolePage = memberInfo.page;
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
  const officialDestination = config.channelId ? `<#${config.channelId}>` : 'Not selected';
  const memberDestination = member.channelId ? `<#${member.channelId}> (override)` : config.channelId ? 'Same as official' : 'Not configured';
  const officialUses = configured ? (live?.exists ? `${live.uses} (Discord)` : `${link?.uses || 0} (recorded)`) : '—';
  const memberExpiry = ageNames[member.maxAge || 0] || 'Never';
  const memberUses = member.maxUses ? String(member.maxUses) : 'Unlimited';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔗 Invite Management')
      .setDescription('Manage the server’s official invite and personal member referral links. Member links use the official destination unless overridden in Settings.')
      .addFields(
        { name: '🌍 OFFICIAL INVITE', value: `**Status:** ${liveStatus}\n**Link:** ${officialUrl(config.code) || 'Not created'}`, inline: false },
        { name: '📍 Destination', value: officialDestination, inline: true },
        { name: '👥 Uses', value: officialUses, inline: true },
        { name: '⏳ Expires', value: configured ? expiryLabel : ageNames[config.maxAge || 0] || 'Never', inline: true },
        { name: '🔢 Use Limit', value: config.maxUses ? String(config.maxUses) : 'Unlimited', inline: true },
        { name: '🎭 Join Roles', value: roleList(config.roleIds), inline: true },
        { name: '👥 MEMBER INVITES', value: `**Status:** ${member.enabled ? '🟢 Enabled' : '🔴 Disabled'}  •  **Personal links:** ${memberLinks}\nMembers receive individual links so their referrals can be tracked.`, inline: false },
        { name: '📍 Destination', value: memberDestination, inline: true },
        { name: '⏳ Expiry / Uses', value: `${memberExpiry} / ${memberUses}`, inline: true },
        { name: '🎭 Join Roles', value: roleList(member.roleIds), inline: true },
        ...(!config.channelId ? [{ name: '⚠️ Setup Required', value: 'Choose an official destination channel to create links.', inline: false }] : []),
        ...(updateArmed ? [{ name: '⚠️ Confirm Replacement', value: 'Updating replaces the existing official link. Confirm within 30 seconds.', inline: false }] : []),
        ...(info.pages > 1 ? [{ name: 'Official Role Page', value: `${info.page + 1}/${info.pages}`, inline: true }] : []),
        ...(memberInfo.pages > 1 ? [{ name: 'Member Role Page', value: `${memberInfo.page + 1}/${memberInfo.pages}`, inline: true }] : []),
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('📍 Official invite destination').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:official-roles:${info.page}`, '🎭 Official join roles (optional)', info))] : []),
      ...(memberInfo.roles.length ? [row(rolePageSelect(`invites:member-roles:${memberInfo.page}`, '🎭 Member join roles (optional)', memberInfo))] : []),
      row(button('invites:official-create', !configured ? 'Create Invite' : updateArmed ? 'Confirm Update' : 'Update Invite', updateArmed ? ButtonStyle.Danger : ButtonStyle.Success, !config.channelId || (configured && !needsUpdate)),
        button('invites:official-limits', 'Official Limits', ButtonStyle.Primary),
        ...(configured ? [button('invites:official-verify', 'Verify Link')] : []),
        button('invites:member-limits', 'Member Limits', ButtonStyle.Primary),
        button('invites:member-dm-modal', 'Member DM', ButtonStyle.Primary)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings'),
        ...(info.pages > 1 ? [button('invites:official-role-next', 'Official Roles ▶')] : []),
        ...(memberInfo.pages > 1 ? [button('invites:member-role-next', 'Member Roles ▶')] : [])),
    ],
  };
}

function inviteLimitsModal(interaction, member = false) {
  const config = invites.getSection(interaction.guildId).settings[member ? 'memberInviteTemplate' : 'officialInvite'];
  return new ModalBuilder().setCustomId(member ? 'invites:member-limits-submit' : 'invites:official-limits-submit').setTitle(member ? 'Member Invite Limits' : 'Official Invite Limits').addComponents(
    row(new TextInputBuilder().setCustomId('maxAge').setLabel('Expiry: Never, 1 hour, 1 day, 7 days...').setStyle(TextInputStyle.Short).setValue(({0:'Never',1800:'30 minutes',3600:'1 hour',21600:'6 hours',43200:'12 hours',86400:'1 day',604800:'7 days',2592000:'30 days'})[config.maxAge || 0] || 'Never').setRequired(true)),
    row(new TextInputBuilder().setCustomId('maxUses').setLabel('Maximum uses: Unlimited, 1, 5, 10...').setStyle(TextInputStyle.Short).setValue(config.maxUses ? String(config.maxUses) : 'Unlimited').setRequired(true)),
  );
}

const officialLimitsModal = (interaction) => inviteLimitsModal(interaction);
const memberLimitsModal = (interaction) => inviteLimitsModal(interaction, true);

function publicView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.publicPanel;
  const member = section.settings.memberInviteTemplate;
  const official = section.settings.officialInvite;
  const ready = Boolean(config.channelId && official.code);
  const deployed = Boolean(config.messageId);
  return {
    embeds: [new EmbedBuilder().setColor(config.color).setTitle('🏆 Public Panel & Leaderboard')
      .setDescription('Publish the community invite panel and referral leaderboard in a server channel. Members can use the official link or request their own tracked referral link.')
      .addFields(
        { name: 'Status', value: deployed ? '🟢 Deployed' : '⚪ Not deployed', inline: true },
        { name: 'Panel Channel', value: (config.channelId ? `<#${config.channelId}>` : '⚠️ Not selected') + '\nWhere Goliath posts the public panel.', inline: true },
        { name: 'Official Invite', value: officialUrl(official.code) || '⚠️ Create an official invite first', inline: false },
        { name: 'Leaderboard', value: `Top ${config.leaderboardLimit} members\nShows referral rankings on the public panel.`, inline: true },
        { name: 'Personal Referral Links', value: member.enabled ? '🟢 Enabled — members can request their own links.' : '🔴 Disabled — members cannot request new links.', inline: true },
        { name: 'Panel Message', value: deployed && config.channelId ? `[View deployed panel](https://discord.com/channels/${interaction.guildId}/${config.channelId}/${config.messageId})` : 'Not posted yet', inline: false },
        ...(!ready ? [{ name: 'Setup Required', value: 'Choose a panel channel and create the official invite before publishing.', inline: false }] : []),
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:panel-channel').setPlaceholder('📍 Where should the public panel be posted?').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new StringSelectMenuBuilder().setCustomId('invites:panel-limit').setPlaceholder(`🏆 Leaderboard size: Top ${config.leaderboardLimit}`).addOptions([5, 10, 15, 20, 25].map((value) => ({ label: `Top ${value}`, value: String(value) })))),
      row(button('invites:panel-deploy', deployed ? 'Update Public Panel' : 'Publish Public Panel', ButtonStyle.Success, !ready),
        button('invites:panel-embed-modal', 'Edit Panel Text', ButtonStyle.Primary)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function memberSettingsView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.memberInviteTemplate;
  const state = sessionFor(interaction);
  const info = rolePages(interaction.guild, config.roleIds || [], state.memberRolePage || 0);
  state.memberRolePage = info.page;
  const personalLinks = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal).length;
  const ageLabels = { 0: 'Never', 1800: '30 minutes', 3600: '1 hour', 21600: '6 hours', 43200: '12 hours', 86400: '1 day', 604800: '7 days', 2592000: '30 days' };
  return {
    embeds: [new EmbedBuilder().setColor(config.enabled ? 0x57F287 : 0xED4245).setTitle('👥 Member Invites')
      .setDescription('Members can request a personal referral link from the public invite panel. Configure where those links lead, which roles Goliath grants after an attributed join, and the message members receive.')
      .addFields(
        { name: 'Status', value: config.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Personal Links', value: `${personalLinks} active personal link(s) managed by Goliath`, inline: true },
        { name: 'Destination', value: (config.channelId ? `<#${config.channelId}>` : '⚠️ Not selected') + '\nChannel that personal invites open.', inline: true },
        { name: 'Expiry', value: (ageLabels[config.maxAge || 0] || 'Never') + '\nHow long a new link remains valid.', inline: true },
        { name: 'Maximum Uses', value: (config.maxUses ? String(config.maxUses) : 'Unlimited') + '\nHow many joins each link permits.', inline: true },
        { name: 'Join Roles', value: roleList(config.roleIds) + '\nOptional roles Goliath assigns after a tracked join; Discord does not grant these automatically.', inline: false },
        { name: 'Member DM', value: 'Edit the title and message sent to members with their personal invite link.', inline: false },
        ...(!config.channelId ? [{ name: 'Setup Required', value: 'Choose a destination channel before members can reliably receive personal links.', inline: false }] : []),
        ...(info.pages > 1 ? [{ name: 'Role Selection', value: `Page ${info.page + 1} of ${info.pages}`, inline: false }] : []),
      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:member-channel').setPlaceholder('📍 Select member invite destination').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:member-roles:${info.page}`, '🎭 Select join roles (optional)', info))] : []),
      row(button('invites:member-limits', 'Link Limits', ButtonStyle.Primary), button('invites:member-dm-modal', 'Edit Member DM', ButtonStyle.Primary)),
      ...(info.pages > 1 ? [row(button('invites:member-role-prev', '◀ Roles', ButtonStyle.Secondary, info.page === 0), button('invites:member-role-next', 'Roles ▶', ButtonStyle.Secondary, info.page >= info.pages - 1))] : []),
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
      row(button('invites:invite-manager', 'Invite Manager', ButtonStyle.Primary), button('invites:health', 'Health'), button('invites:repair', 'Repair'), button('invites:member-enabled', section.settings.memberInviteTemplate.enabled ? 'Disable Member Invites' : 'Enable Member Invites', section.settings.memberInviteTemplate.enabled ? ButtonStyle.Danger : ButtonStyle.Success), button('invites:member-inherit', 'Use Official Destination', ButtonStyle.Secondary, !section.settings.memberInviteTemplate.channelId)),
      row(new ChannelSelectMenuBuilder().setCustomId('invites:member-channel').setPlaceholder('📍 Override member destination (optional)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
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
  const memberEnabled = section.settings.memberInviteTemplate.enabled;
  const url = officialUrl(section.settings.officialInvite.code);
  if (!url) throw new Error('Create the official invite before sending the public panel.');
  const entries = invites.leaderboard(guildId, panel.leaderboardLimit);
  const lines = entries.length
    ? entries.map((entry, index) => `${['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`} <@${entry.inviterId}> — **${entry.score}** valid referral${entry.score === 1 ? '' : 's'}`).join('\n')
    : 'No referrals recorded yet. Be the first to invite someone!';
  const description = panel.description + (memberEnabled
    ? '\n\n**Want to compete?** Get your personal invite link below, share it with friends, and track your progress.'
    : '\n\nPersonal referral link requests are currently disabled.');
  return {
    embeds: [new EmbedBuilder().setColor(panel.color).setTitle(panel.title)
      .setDescription(description)
      .addFields(
        { name: '🔗 Official Server Invite', value: `[Join the server](${url})\nShare this link to invite someone directly.`, inline: false },
        { name: `🏆 Referral Leaderboard · Top ${panel.leaderboardLimit}`, value: lines, inline: false },
      )
      .setFooter({ text: panel.footer }).setTimestamp()],
    components: [row(
      button('invites:member-personal', '🔗 My Invite Link', ButtonStyle.Primary, !memberEnabled),
      button('invites:member-profile', '📊 My Stats'),
      button('invites:member-refresh', '🔄 Refresh Leaderboard'),
    )],
  };
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
  if (state.page === 'member-settings') return officialView(interaction);
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
  officialLimitsModal, memberLimitsModal, sessionFor, buildInviteStudioPayload, buildPublicPayload, profilePayload, personalInvitePayload, embedModal, dmModal };