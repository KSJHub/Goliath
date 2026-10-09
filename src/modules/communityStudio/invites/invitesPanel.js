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
  const configured = Boolean(config.code);
  const live = state.officialLive?.code === config.code ? state.officialLive : null;
  const matching = Boolean(link) && link.channelId === config.channelId &&
    Number(link.maxAge || 0) === 0 &&
    Number(link.maxUses || 0) === 0 &&
    JSON.stringify([...(link.roleIds || [])].sort()) === JSON.stringify([...(config.roleIds || [])].sort());
  const needsUpdate = configured && (!matching || live?.exists === false);
  const updateArmed = state.officialConfirm?.action === 'update' && state.officialConfirm.until > Date.now();
  const liveStatus = !configured ? '⚪ Not configured' :
    live?.exists === false ? '🔴 Link unavailable — update required' :
    !matching ? '🟠 Changes saved — update required' :
    live?.exists === true ? '🟢 Verified active' : '🟡 Configured — not recently verified';
  const officialDestination = config.channelId ? `<#${config.channelId}>` : 'Not selected';
  const officialUses = configured ? (live?.exists ? `${live.uses} (Discord)` : `${link?.uses || 0} (recorded)`) : '—';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔗 Invite Management')
      .setDescription('Choose the invite destination and optional join roles. Every official and member referral link is permanent, unlimited, and uses these settings.')
      .addFields(
        { name: '🌍 OFFICIAL INVITE', value: `**${liveStatus}**\n${officialUrl(config.code) || 'No invite link created'}`, inline: false },
        { name: '📍 Destination', value: officialDestination, inline: true },
        { name: '👥 Uses', value: officialUses, inline: true },
        { name: '♾️ Link Policy', value: 'Never expires · Unlimited uses', inline: true },
        { name: '🎭 Join Roles', value: roleList(config.roleIds), inline: true },
        { name: '👥 MEMBER INVITES', value: `${member.enabled ? '🟢 Enabled' : '🔴 Disabled'} · **${memberLinks}** personal links\nMembers share individual links to earn tracked referrals.`, inline: false },
        { name: 'Shared Settings', value: 'Same destination and join roles as the official invite · Never expires · Unlimited uses', inline: false },
        ...(!config.channelId ? [{ name: '⚠️ Setup Required', value: 'Select an official destination channel before creating the invite.', inline: false }] : []),

        ...(updateArmed ? [{ name: '⚠️ Confirm Replacement', value: 'Updating replaces the existing official link. Confirm within 30 seconds.', inline: false }] : []),
        ...(info.pages > 1 ? [{ name: 'Official Role Page', value: `${info.page + 1}/${info.pages}`, inline: true }] : []),

      )],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('📍 Official invite destination').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:official-roles:${info.page}`, '🎭 Official join roles (optional)', info))] : []),

      row(button('invites:official-create', !configured ? 'Create Invite' : updateArmed ? 'Confirm Update' : 'Update Invite', updateArmed ? ButtonStyle.Danger : ButtonStyle.Success, !config.channelId || (configured && !needsUpdate)),
        ...(configured ? [button('invites:official-verify', 'Verify Link')] : []),
        button('invites:invite-manager', 'Manage Links', ButtonStyle.Secondary)),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings'),
        button('invites:official-role-prev', '◀ Roles', ButtonStyle.Secondary, info.page === 0),
        button('invites:official-role-next', 'Roles ▶', ButtonStyle.Secondary, info.page >= info.pages - 1)),
    ],
  };
}

function publicView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const config = section.settings.publicPanel;
  const member = section.settings.memberInviteTemplate;
  const official = section.settings.officialInvite;
  const ready = Boolean(config.channelId && official.code);
  const deployed = Boolean(config.messageId && config.channelId);
  const panelUrl = deployed ? `https://discord.com/channels/${interaction.guildId}/${config.channelId}/${config.messageId}` : null;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏆 Public Panel & Leaderboard')
      .setDescription('Configure and publish the community invite panel.')
      .addFields(
        { name: 'Panel Status', value: deployed ? '🟢 Deployed (saved)' : '⚪ Not deployed', inline: true },
        { name: 'Panel Channel', value: config.channelId ? `<#${config.channelId}>` : '⚠️ Not selected', inline: true },
        { name: 'Leaderboard', value: `Top ${config.leaderboardLimit}`, inline: true },
        { name: 'Member Invites', value: member.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Official Invite', value: official.code ? '🟢 Configured' : '⚠️ Not configured', inline: true },
        ...(panelUrl ? [{ name: 'Deployed Message', value: `[View public panel](${panelUrl})`, inline: false }] : []),
        ...(!ready ? [{ name: '⚠️ Setup Required', value: [
          !config.channelId ? 'Select a panel channel.' : null,
          !official.code ? 'Create the official invite.' : null,
        ].filter(Boolean).join(' '), inline: false }] : []),
      )
      .setFooter({ text: 'Goliath Invites · Public Panel' }).setTimestamp()],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('invites:panel-channel').setPlaceholder('📍 Select panel channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      row(new StringSelectMenuBuilder().setCustomId('invites:panel-limit').setPlaceholder(`🏆 Leaderboard: Top ${config.leaderboardLimit}`).addOptions([5, 10, 15, 20, 25].map((value) => ({ label: `Top ${value}`, value: String(value) })))),
      row(button('invites:panel-deploy', deployed ? '🔄 Update Panel' : '📢 Publish Panel', ButtonStyle.Success, !ready),
        button('invites:panel-embed-modal', '✏️ Edit Panel', ButtonStyle.Secondary),
        ...(panelUrl ? [new ButtonBuilder().setLabel('👁️ View Panel').setStyle(ButtonStyle.Link).setURL(panelUrl)] : [])),
      row(button('invites:home', '⬅️ Back'), button('invites:admin-config', '⚙️ Settings')),
    ],
  };
}

function adminView(interaction) {
  const section = invites.getSection(interaction.guildId);
  const enabled = isModuleEnabled(interaction.guildId, 'invites');
  const memberEnabled = section.settings.memberInviteTemplate.enabled;
  const configured = Boolean(section.settings.officialInvite.code);
  const state = sessionFor(interaction);
  const resetArmed = state.resetConfirmUntil > Date.now();
  const regenerateArmed = state.officialConfirm?.action === 'regenerate' && state.officialConfirm.until > Date.now();
  const deleteArmed = state.officialConfirm?.action === 'delete' && state.officialConfirm.until > Date.now();
  const links = invites.listInviteLinks(interaction.guildId);
  const linkCount = links.filter((link) => link.personal).length;
  const panelResetArmed = state.panelResetConfirmUntil > Date.now();
  return {
    embeds: [new EmbedBuilder()
      .setColor(enabled ? 0x5865F2 : 0xED4245)
      .setTitle('⚙️ Invite Studio Settings')
      .setDescription('Invite health, member links and server-wide controls.')
      .addFields(
        { name: 'Module', value: enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Member Invites', value: `${memberEnabled ? '🟢 On' : '🔴 Off'} · ${linkCount} links`, inline: true },
        { name: 'Official Invite', value: configured ? '🟢 Configured' : '⚪ Not set', inline: true },
        ...(panelResetArmed ? [{ name: '⚠️ Confirm Panel Reset', value: 'Confirm within 30 seconds to restore public panel text. Channel, deployed message and invite DM are preserved.', inline: false }] : []),
        ...(resetArmed ? [{ name: '⚠️ Confirm Score Reset', value: 'Confirm within 30 seconds to clear leaderboard scores.', inline: false }] : []),
        ...(regenerateArmed ? [{ name: '⚠️ Confirm Invite Replacement', value: 'Confirm within 30 seconds. The existing official invite URL may stop working.', inline: false }] : []),
        ...(deleteArmed ? [{ name: '⚠️ Confirm Invite Deletion', value: 'Confirm within 30 seconds to delete the official invite.', inline: false }] : []),
      )
      .setFooter({ text: 'Goliath Invites · Settings' })
      .setTimestamp()],
    components: [
      row(button('invites:health', '🩺 System Health'),
        button('invites:repair', '🔧 Repair Invites'),
        button('invites:member-dm-modal', '✏️ Edit Invite DM', ButtonStyle.Secondary),
        button('invites:member-enabled', memberEnabled ? '👥 Member Invites: On' : '👥 Member Invites: Off', ButtonStyle.Secondary)),
      row(button('invites:official-regenerate', regenerateArmed ? '⚠️ Confirm Replace' : '🔄 Replace Invite', ButtonStyle.Secondary, !configured),
        button('invites:default-panel', panelResetArmed ? '⚠️ Confirm Panel Reset' : '🧹 Reset Panel', ButtonStyle.Secondary),
        button(resetArmed ? 'invites:leaderboard-reset-confirm' : 'invites:leaderboard-reset-arm', resetArmed ? '⚠️ Confirm Reset' : '🏆 Reset Scores', ButtonStyle.Secondary),
        button('invites:official-delete', deleteArmed ? '⚠️ Confirm Delete' : '🗑️ Delete Invite', ButtonStyle.Secondary, !configured)),
      row(button('invites:official-settings', '⬅️ Back'),
        button('invites:toggle', enabled ? '⏸️ Disable Module' : '▶️ Enable Module', enabled ? ButtonStyle.Danger : ButtonStyle.Success)),
    ],
  };
}

function managerView(interaction) {
  const state = sessionFor(interaction);
  const links = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal && link.inviterId);
  const selected = links.find((link) => link.inviterId === state.selectedUserId);
  const section = invites.getSection(interaction.guildId);
  const selectedStats = selected ? section.inviters?.[selected.inviterId] || {} : {};
  const selectedScore = Math.max(0, Number(selectedStats.active || 0) + Number(selectedStats.bonus || 0));
  const memberConfirm = state.memberConfirm?.userId === state.selectedUserId && state.memberConfirm.until > Date.now() ? state.memberConfirm : null;
  const list = links.slice(0, state.displayLimit || links.length).map((link, index) => `${index + 1}. <@${link.inviterId}> — ${officialUrl(link.code)} — ${link.uses || 0} uses`).join('\n') || 'No personal links yet.';
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Manage Links')
    .setDescription('Select a member to view or manage their personal referral link.')
    .addFields(
      { name: 'Personal Links', value: String(links.length), inline: true },
      { name: 'Tracked Joins', value: String(Number(section.analytics?.tracked || 0)), inline: true },
      { name: 'Member Links', value: list.slice(0, 1024), inline: false },
    );
  if (selected) embed.addFields({ name: 'Selected Member', value: `<@${selected.inviterId}>\n${officialUrl(selected.code)}\n**Referral Score:** ${selectedScore}` });
  if (memberConfirm) embed.addFields({ name: '⚠️ Confirm Member Action', value: memberConfirm.action === 'delete' ? 'Confirm within 30 seconds to remove this member’s personal link. Their referral history is not reset.' : 'Confirm within 30 seconds to reset this member’s referral score. Their personal link will be kept.' });
  return { embeds: [embed], components: [
    row(new StringSelectMenuBuilder().setCustomId('invites:manager-display').setPlaceholder('Members shown').addOptions([5, 10, 15, 20, 0].map((value) => ({ label: value ? `Display ${value}` : 'Display All', value: String(value) })))),
    row(new UserSelectMenuBuilder().setCustomId('invites:manager-select-member').setPlaceholder('Select a member').setMinValues(1).setMaxValues(1)),
    row(button('invites:manager-verify', 'Verify Link', ButtonStyle.Secondary, !selected), button('invites:manager-resend', 'Resend DM', ButtonStyle.Secondary, !selected), button('invites:manager-delete', memberConfirm?.action === 'delete' ? 'Confirm Remove' : 'Remove Link', ButtonStyle.Secondary, !selected), button('invites:manager-reset-member', memberConfirm?.action === 'reset' ? 'Confirm Score Reset' : 'Reset Score', ButtonStyle.Secondary, !selected)),
    row(button('invites:official-settings', '⬅️ Back')),
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
    ? entries.map((entry, index) => `${['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`} <@${entry.inviterId}> — **${entry.score}** referral${entry.score === 1 ? '' : 's'}`).join('\n')
    : 'No referrals yet. **Be the first to claim the top spot!**';
  const description = panel.description + '\n\n**Invite friends · Grow the community · Climb the leaderboard**';
  return {
    embeds: [new EmbedBuilder().setColor(panel.color).setTitle(panel.title)
      .setDescription(description)
      .addFields(
        { name: '🔗 Official Server Invite', value: `[Join our community](${url})`, inline: false },
        { name: `🏆 Referral Leaderboard · Top ${panel.leaderboardLimit}`, value: lines, inline: false },
        { name: '💎 Your Personal Invite', value: memberEnabled ? 'Select **My Invite Link** below to share your link and earn referral points.' : 'New personal invite requests are currently disabled.', inline: false },
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
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2)
      .setTitle('💎 My Invite Stats')
      .setDescription(`Referral progress for **${user.displayName || user.username}**.`)
      .setThumbnail(user.displayAvatarURL?.() || null)
      .addFields(
        { name: '🏆 Rank', value: rank >= 0 ? `#${rank + 1}` : 'Unranked', inline: true },
        { name: '💎 Score', value: String(score), inline: true },
        { name: '👥 Active Referrals', value: String(stats.active || 0), inline: true },
        { name: '📈 Lifetime Joins', value: String(stats.total || 0), inline: true },
        { name: '🔗 Personal Invite', value: personal ? `[Open your invite](${officialUrl(personal.code)})\nPermanent · Unlimited uses` : 'No personal link created yet.', inline: false },
      )
      .setFooter({ text: 'Goliath Invites · Member Stats' }).setTimestamp()],
    components: [row(button('invites:member-personal', personal ? '📩 Resend My Link' : '🔗 Get My Link', ButtonStyle.Primary))],
    flags: MessageFlags.Ephemeral,
  };
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
  return new ModalBuilder().setCustomId('invites:member-dm-submit').setTitle('Edit Referral DM').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('DM title').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.dmTitle)),
    row(new TextInputBuilder().setCustomId('message').setLabel('DM message').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(config.dmMessage)),
  );
}
module.exports = {
  sessionFor, buildInviteStudioPayload, buildPublicPayload, profilePayload, personalInvitePayload, embedModal, dmModal };