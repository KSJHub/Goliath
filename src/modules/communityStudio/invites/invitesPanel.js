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
        { name: 'Official Invite', value: invites.officialDisplayUrl(interaction.guildId) || 'Not configured', inline: true },
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
  const vanity = sessionFor(interaction).vanityStatus;
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
        { name: '🌍 OFFICIAL INVITE', value: `**${liveStatus}**\n${invites.officialDisplayUrl(interaction.guildId) || 'No invite link created'}`, inline: false },
        { name: '⭐ Official Link Type', value: config.linkType === 'vanity' ? `Custom / Vanity${config.vanityCode ? ` · discord.gg/${config.vanityCode}` : ' · Standard fallback active'}` : 'Standard Discord Invite', inline: false },
        { name: '✨ Vanity Availability', value: !vanity ? '🟡 Not checked' : vanity.status === 'active' ? `🟢 ${vanity.detail}` : vanity.status === 'permission' ? `🔴 ${vanity.detail}` : vanity.status === 'unavailable' ? `⚪ ${vanity.detail}` : `🟡 ${vanity.detail}`, inline: false },
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
      row(new StringSelectMenuBuilder().setCustomId('invites:official-link-type').setPlaceholder('⭐ Official invite type').addOptions([{ label: 'Standard Discord Invite', value: 'standard', default: config.linkType !== 'vanity' }, { label: 'Custom / Vanity Invite', value: 'vanity', default: config.linkType === 'vanity', description: 'Uses vanity when available; otherwise standard fallback' }])),
      row(new ChannelSelectMenuBuilder().setCustomId('invites:official-channel').setPlaceholder('📍 Official invite destination').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      ...(info.roles.length ? [row(rolePageSelect(`invites:official-roles:${info.page}`, '🎭 Official join roles (optional)', info))] : []),

      row(button('invites:official-create', !configured ? '📢 Create Invite' : updateArmed ? '⚠️ Confirm Replacement' : needsUpdate ? '🔄 Update Invite' : '💾 Save Invite Settings', updateArmed ? ButtonStyle.Danger : ButtonStyle.Success, !config.channelId),
        button('invites:official-verify', '🔍 Verify Link', ButtonStyle.Secondary),
        button('invites:invite-manager', '👥 Member Invites', ButtonStyle.Secondary)),
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
  const verified = sessionFor(interaction).panelDeployment;
  const deployed = Boolean(config.messageId && config.channelId && verified?.messageId === config.messageId && verified?.channelId === config.channelId && verified.status === 'deployed');
  const panelStatus = !config.messageId ? '⚪ Not Deployed' : verified?.messageId === config.messageId && verified?.channelId === config.channelId ? (verified.status === 'deployed' ? '🟢 Deployed' : verified.status === 'missing' ? '⚪ Not Deployed · Message missing' : '🟡 Not Verified') : '🟡 Not Verified';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🏆 Public Panel & Leaderboard')
      .setDescription('Configure and publish the community invite panel.')
      .addFields(
        { name: 'Panel Status', value: panelStatus, inline: true },
        { name: 'Panel Channel', value: config.channelId ? `<#${config.channelId}>` : '⚠️ Not selected', inline: true },
        { name: 'Leaderboard', value: `Top ${config.leaderboardLimit}`, inline: true },
        { name: 'Member Invites', value: member.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
        { name: 'Official Invite', value: official.code ? '🟢 Configured' : '⚠️ Not configured', inline: true },
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
        button('invites:panel-preview', '👁️ Preview Panel', ButtonStyle.Secondary, !official.code),
        ),
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
  const page = state.settingsPage || 'home';
  const links = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal).length;
  const resetArmed = state.resetConfirmUntil > Date.now();
  const panelResetArmed = state.panelResetConfirmUntil > Date.now();
  const panelDeleteArmed = state.panelDeleteConfirmUntil > Date.now();
  const regenerateArmed = state.officialConfirm?.action === 'regenerate' && state.officialConfirm.until > Date.now();
  const deleteArmed = state.officialConfirm?.action === 'delete' && state.officialConfirm.until > Date.now();
  const pages = {
    home: ['⚙️ Invite Studio Settings', 'Choose an area to manage invites, referrals, diagnostics or the public panel.'],
    health: ['🩺 System Health', 'Run diagnostics and repair supported problems without deliberately replacing permanent links.'],
    members: ['👥 Member Invites', 'Manage member referral access, invite DMs and individual links or scores.'],
    official: ['🔗 Official Invite', 'Advanced official invitation maintenance. Destination, roles and vanity preference are configured in Invite Management.'],
    panel: ['📢 Public Panel', 'Edit, preview, publish and reset the community invitation panel.'],
  };
  const [title, description] = pages[page] || pages.home;
  const embed = new EmbedBuilder().setColor(enabled ? 0x5865F2 : 0xED4245)
    .setTitle(title).setDescription(description)
    .addFields(
      { name: 'Module', value: enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Member Invites', value: `${memberEnabled ? '🟢 On' : '🔴 Off'} · ${links} links`, inline: true },
      { name: 'Official Invite', value: configured ? '🟢 Configured' : '⚪ Not set', inline: true },
    ).setFooter({ text: 'Goliath Invites · Settings' }).setTimestamp();
  const components = [];
  if (page === 'home') {
    components.push(row(
      button('invites:settings-health', '🩺 System Health'),
      button('invites:settings-members', '👥 Member Invites'),
      button('invites:settings-official', '🔗 Official Invite'),
      button('invites:settings-panel', '📢 Public Panel'),
    ));
    // Keep the original Back and module toggle row unchanged.
    components.push(row(button('invites:home', '⬅️ Back'),
      button('invites:toggle', enabled ? '⏸️ Disable Module' : '▶️ Enable Module', enabled ? ButtonStyle.Danger : ButtonStyle.Success)));
  } else {
    if (page === 'health') components.push(row(
      button('invites:health', '🩺 Run Health Check'),
      button('invites:repair', '🔧 Repair Invites'),
    ));
    if (page === 'members') {
      components.push(row(
        button('invites:member-enabled', memberEnabled ? '👥 Member Invites: On' : '👥 Member Invites: Off'),
        button('invites:member-dm-modal', '✏️ Edit Invite DM'),
        button(resetArmed ? 'invites:leaderboard-reset-confirm' : 'invites:leaderboard-reset-arm',
          resetArmed ? '⚠️ Confirm Leaderboard Reset' : '🏆 Reset Leaderboard'),
      ));
      if (resetArmed) embed.addFields({ name: '⚠️ Confirm Score Reset', value: 'Confirm within 30 seconds to clear leaderboard scores. Personal invite links remain.', inline: false });
    }
    if (page === 'official') {
      components.push(row(
        button('invites:official-regenerate', regenerateArmed ? '⚠️ Confirm Replace' : '🔄 Replace Official Invite', ButtonStyle.Secondary, !configured),
        button('invites:official-delete', deleteArmed ? '⚠️ Confirm Delete' : '🗑️ Delete Official Invite', ButtonStyle.Secondary, !configured),
      ));
      if (regenerateArmed) embed.addFields({ name: '⚠️ Confirm Invite Replacement', value: 'Confirm within 30 seconds. The existing official invite URL may stop working.', inline: false });
      if (deleteArmed) embed.addFields({ name: '⚠️ Confirm Invite Deletion', value: 'Confirm within 30 seconds to delete the official invite.', inline: false });
    }
    if (page === 'panel') {
      const config = section.settings.publicPanel;
      const deployment = state.panelDeployment;
      const saved = Boolean(config.channelId && config.messageId);
      const status = !saved ? '⚪ Not deployed' : deployment?.channelId === config.channelId && deployment?.messageId === config.messageId
        ? deployment.status === 'deployed' ? '🟢 Deployed' : deployment.status === 'missing' ? '🔴 Message missing' : '🟡 Verification unavailable'
        : '🟡 Saved · Not yet verified';
      embed.addFields({ name: 'Deployment', value: status, inline: false });
      if (saved) embed.addFields(
        { name: 'Panel Channel', value: `<#${config.channelId}>`, inline: true },
        { name: 'Message ID', value: `\`${config.messageId}\``, inline: true },
        { name: 'Panel Message', value: `[View deployed panel](https://discord.com/channels/${interaction.guildId}/${config.channelId}/${config.messageId})`, inline: false },
      );
      components.push(row(
        button('invites:panel-embed-modal', '✏️ Edit Panel'),
        button('invites:panel-preview', '👁️ Preview Panel', ButtonStyle.Secondary, !configured),
        button('invites:default-panel', panelResetArmed ? '⚠️ Confirm Panel Reset' : '🧹 Reset Public Panel'),
      ));
      if (panelResetArmed) embed.addFields({ name: '⚠️ Confirm Panel Reset', value: 'Confirm within 30 seconds to restore default panel text. Channel, deployed message and invite DM are preserved.', inline: false });
    }
    components.push(row(button('invites:settings-home', '⬅️ Back'), ...(page === 'panel' ? [button('invites:settings-panel-delete', panelDeleteArmed ? '⚠️ Confirm Delete Panel' : '🗑️ Delete Deployed Panel', ButtonStyle.Danger, !section.settings.publicPanel.messageId)] : [])));
    if (page === 'panel' && panelDeleteArmed) embed.addFields({ name: '⚠️ Confirm Deletion', value: 'Confirm within 30 seconds to delete the deployed Discord message and clear its saved deployment IDs. Referral scores and panel design remain intact.', inline: false });
  }
  return { embeds: [embed], components };
}

function managerView(interaction) {
  const state = sessionFor(interaction);
  const links = invites.listInviteLinks(interaction.guildId).filter((link) => link.personal && link.inviterId);
  const selected = links.find((link) => link.inviterId === state.selectedUserId);
  const section = invites.getSection(interaction.guildId);
  const selectedStats = selected ? section.inviters?.[selected.inviterId] || {} : {};
  const selectedScore = Math.max(0, Number(selectedStats.active || 0) + Number(selectedStats.bonus || 0));
  const memberConfirm = selected && state.memberConfirm?.userId === selected.inviterId && state.memberConfirm.until > Date.now() ? state.memberConfirm : null;
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Member Invite Manager')
    .setDescription('Administrator controls for members’ personal referral links and individual invite scores.')
    .addFields(
      { name: 'Personal Links', value: String(links.length), inline: true },
      { name: 'Tracked Joins', value: String(Number(section.analytics?.tracked || 0)), inline: true },
      { name: 'Member Invites', value: section.settings.memberInviteTemplate.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
    );
  if (!links.length) {
    embed.addFields(
      { name: 'ℹ️ What is Member Invite Manager?', value: 'Administrators can manage members’ permanent personal referral links, review invite activity and control individual referral scores. Members create their links using **My Invite Link** on the public community panel; those links appear here automatically.' },
      { name: '🛠️ Management Tools', value: '**Verify Link** — check a member’s invite with Discord.\n**Send Invite DM** — resend their invite message.\n**Remove Member Link** — remove their link without resetting referral history.\n**Reset Member Score** — clear their individual score while keeping the link.' },
      { name: '📭 No Personal Invites Yet', value: 'No members have generated a personal invite link. Once someone creates one, their link and management options will appear here.' },
    );
  } else if (selected) {
    embed.addFields({ name: 'ℹ️ Member Management', value: 'Verify or resend this member’s link, or use the confirmed removal and score-reset actions below.' });
    embed.addFields({ name: 'Selected Member', value: `<@${selected.inviterId}>\n[Personal Invite](${officialUrl(selected.code)}) · ${selected.uses || 0} recorded uses\n**Referral Score:** ${selectedScore}` });
  } else {
    embed.addFields({ name: 'ℹ️ Member Management', value: 'Select a member to verify or resend their personal invite, remove their link or reset their individual score.' });
    const list = links.slice(0, state.displayLimit || links.length).map((link, index) => `${index + 1}. <@${link.inviterId}> — ${link.uses || 0} recorded uses`).join('\n');
    embed.addFields({ name: 'Member Links', value: list.slice(0, 1024) });
  }
  if (memberConfirm) embed.addFields({ name: '⚠️ Confirm Member Action', value: memberConfirm.action === 'delete' ? 'Confirm within 30 seconds to remove this member’s personal link. Their referral history is not reset.' : 'Confirm within 30 seconds to reset this member’s referral score. Their personal link will be kept.' });
  embed.setFooter({ text: 'Goliath Invites · Member Management' }).setTimestamp();
  const components = [];
  if (links.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId('invites:manager-display').setPlaceholder('👥 Members shown').addOptions([5, 10, 15, 20, 0].map((value) => ({ label: value ? `Display ${value}` : 'Display All', value: String(value) })))));
    components.push(row(new UserSelectMenuBuilder().setCustomId('invites:manager-select-member').setPlaceholder('👤 Select a member').setMinValues(1).setMaxValues(1)));
    if (selected) components.push(row(
      button('invites:manager-verify', '🔍 Verify Link'),
      button('invites:manager-resend', '📩 Send Invite DM'),
      button('invites:manager-delete', memberConfirm?.action === 'delete' ? '⚠️ Confirm Removal' : '🗑️ Remove Member Link'),
      button('invites:manager-reset-member', memberConfirm?.action === 'reset' ? '⚠️ Confirm Score Reset' : '🏆 Reset Member Score'),
    ));
  }
  components.push(row(button('invites:official-settings', '⬅️ Back')));
  return { embeds: [embed], components };
}

function buildPublicPayload(guildId, sourceSection = null) {
  const section = sourceSection || invites.getSection(guildId);
  const panel = section.settings.publicPanel;
  const memberEnabled = section.settings.memberInviteTemplate.enabled;
  const url = invites.officialDisplayUrl(guildId);
  if (!url) throw new Error('Create the official invite before sending the public panel.');
  const entries = invites.leaderboard(guildId, panel.leaderboardLimit);
  const lines = entries.length
    ? entries.map((entry, index) => `${['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`} <@${entry.inviterId}> — **${entry.score}** referral${entry.score === 1 ? '' : 's'}`).join('\n')
    : 'No referrals yet — be the first on the board!';
  const description = panel.description;
  return {
    embeds: [new EmbedBuilder().setColor(panel.color).setTitle(panel.title)
      .setDescription(description)
      .addFields(
        { name: '🔗 Official Server Invite', value: `**[Join the community](${url})** · ${url}`, inline: false },
        { name: `🏆 Referral Leaderboard · Top ${panel.leaderboardLimit}`, value: lines, inline: false },
        { name: '💎 Your Personal Invite', value: memberEnabled ? 'Select **My Invite Link** to get your own referral link, share it with friends and climb the rankings. Use **My Stats** to track your progress.' : 'Personal invite creation is currently paused. Your stats and the leaderboard remain available.', inline: false },
      )
      .setFooter({ text: panel.footer }).setTimestamp()],
    components: [row(
      button('invites:member-personal', '🔗 My Invite Link', ButtonStyle.Primary, !memberEnabled),
      button('invites:member-profile', '📊 My Stats'),
      button('invites:member-refresh', '🔄 Refresh Leaderboard'),
      new ButtonBuilder().setLabel('🔗 Join the Community').setStyle(ButtonStyle.Link).setURL(url),
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
  const message = render(template.dmMessage).replaceAll(url, '').trim();
  return { embeds: [new EmbedBuilder().setColor(0x5865F2)
    .setTitle(render(template.dmTitle))
    .setDescription(message || 'Your permanent personal invite is ready to share!')
    .addFields(
      { name: '🔗 Your Referral Link', value: `**[Open and share your invite](${url})**\n${url}\nPermanent · Unlimited uses` },
      { name: '🏆 How Referrals Work', value: 'Share your link with friends. Eligible joins contribute to your referral score and leaderboard position.' },
      { name: '📊 Track Your Progress', value: 'Open the community invite panel and select **My Stats** to view your rank, score and active referrals.' },
    )
    .setFooter({ text: result.created ? 'Goliath Invites · Personal Link Created' : 'Goliath Invites · Your Existing Link' })
    .setTimestamp()] };
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
  return new ModalBuilder().setCustomId('invites:panel-embed-submit').setTitle('Edit Community Invite Panel').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('Panel Title').setPlaceholder('💎 Invite & Climb the Leaderboard').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true).setValue(config.title)),
    row(new TextInputBuilder().setCustomId('description').setLabel('Referral Message').setPlaceholder('Invite friends, earn referrals and climb the leaderboard.').setStyle(TextInputStyle.Paragraph).setMaxLength(1800).setRequired(true).setValue(config.description)),
    row(new TextInputBuilder().setCustomId('footer').setLabel('Footer Message').setPlaceholder('Leaderboard updates every 2 hours').setStyle(TextInputStyle.Short).setMaxLength(2048).setRequired(true).setValue(config.footer)),
    row(new TextInputBuilder().setCustomId('color').setLabel('Embed Colour (6-digit hex)').setPlaceholder('#5865F2').setStyle(TextInputStyle.Short).setMinLength(7).setMaxLength(7).setRequired(true).setValue(config.color)),
  );
}
function dmModal(interaction) {
  const config = invites.getSection(interaction.guildId).settings.memberInviteTemplate;
  return new ModalBuilder().setCustomId('invites:member-dm-submit').setTitle('Edit Personal Invite DM').addComponents(
    row(new TextInputBuilder().setCustomId('title').setLabel('DM Title').setPlaceholder('💎 Your Personal Invite for {server}').setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(true).setValue(config.dmTitle)),
    row(new TextInputBuilder().setCustomId('message').setLabel('Personal Welcome Message').setPlaceholder('Hi {user}! Your personal referral link is ready.').setStyle(TextInputStyle.Paragraph).setMaxLength(3000).setRequired(true).setValue(config.dmMessage)),
  );
}

module.exports = {
  sessionFor, buildInviteStudioPayload, buildPublicPayload, profilePayload, personalInvitePayload, embedModal, dmModal };