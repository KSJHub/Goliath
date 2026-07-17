'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder } = require('discord.js');
const suggestionsStore = require('./suggestionsStore');
const suggestionsManager = require('./suggestionsManager');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const displayName = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const formatChannel = (id) => id ? `<#${id}>` : '`Not set`';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '`None`';
function buildSuggestionsAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const s = suggestionsStore.getSection(guild.id);
  const embed = new EmbedBuilder().setColor(s.enabled !== false ? 0x57f287 : 0x5865f2).setTitle('💡 Suggestions').setDescription([
    'Configure suggestion intake, review and voting.', '',
    `**Status:** ${s.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Submit Channel:** ${formatChannel(s.submitChannelId)}`,
    `**Review Channel:** ${formatChannel(s.reviewChannelId)}`,
    `**Approved Channel:** ${formatChannel(s.approvedChannelId)}`,
    `**Denied Channel:** ${formatChannel(s.deniedChannelId)}`,
    `**Reviewer Roles:** ${formatRoles(s.reviewerRoleIds)}`,
    `**Voting:** ${s.voting !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Require Review:** ${s.requireReview !== false ? 'Yes ✅' : 'No ❌'}`,
    `**Anonymous:** ${s.anonymous === true ? 'Yes ✅' : 'No ❌'}`, '',
    `Submitted: \`${s.analytics.submitted}\` | Approved: \`${s.analytics.approved}\` | Denied: \`${s.analytics.denied}\``,
  ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:submitChannel').setPlaceholder('Submit channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:suggestions:reviewChannel').setPlaceholder('Review channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:suggestions:reviewerRoles').setPlaceholder('Reviewer roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:suggestions:deploy', '🚀 Deploy Submit Panel', ButtonStyle.Success), button(s.enabled !== false ? 'admin:suggestions:disable' : 'admin:suggestions:enable', s.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:suggestions:toggleVoting', '🗳️ Voting', ButtonStyle.Secondary), button('admin:suggestions:toggleReview', '🔎 Review', ButtonStyle.Secondary), button('admin:suggestions:toggleAnonymous', '👤 Anonymous', ButtonStyle.Secondary)),
    row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}
const save = (g, u) => suggestionsStore.updateSection(g.id, u, g);
async function safeUpdate(i, p) { if (i.deferred || i.replied) await i.editReply(p); else await i.update(p); return true; }
async function handleSuggestionsAdminInteraction(i) {
  const id = String(i.customId || ''); if (!id.startsWith('admin:suggestions')) return false; const member = displayName(i);
  try {
    if (id === 'admin:suggestions') return safeUpdate(i, buildSuggestionsAdminPanel(i.guild, member));
    if (i.isChannelSelectMenu?.()) { const value = i.values?.[0] || null; const prop = id.split(':')[2]; if (['submitChannel', 'reviewChannel', 'approvedChannel', 'deniedChannel'].includes(prop)) save(i.guild, (s) => ({ ...s, [`${prop}Id`]: value })); }
    else if (i.isRoleSelectMenu?.() && id === 'admin:suggestions:reviewerRoles') save(i.guild, (s) => ({ ...s, reviewerRoleIds: [...new Set(i.values || [])] }));
    else if (id === 'admin:suggestions:enable') save(i.guild, (s) => ({ ...s, enabled: true }));
    else if (id === 'admin:suggestions:disable') save(i.guild, (s) => ({ ...s, enabled: false }));
    else if (id === 'admin:suggestions:toggleVoting') save(i.guild, (s) => ({ ...s, voting: !s.voting }));
    else if (id === 'admin:suggestions:toggleReview') save(i.guild, (s) => ({ ...s, requireReview: !s.requireReview }));
    else if (id === 'admin:suggestions:toggleAnonymous') save(i.guild, (s) => ({ ...s, anonymous: !s.anonymous }));
    else if (id === 'admin:suggestions:deploy') { await i.deferUpdate().catch(() => null); await suggestionsManager.deploySubmitPanel(i.guild); }
    return safeUpdate(i, buildSuggestionsAdminPanel(i.guild, member));
  } catch (error) { const p = { content: `❌ Suggestions setup failed: ${error.message}`, flags: 64 }; if (i.deferred || i.replied) await i.followUp(p).catch(() => null); else await i.reply(p).catch(() => null); return true; }
}
module.exports = { buildSuggestionsAdminPanel, handleSuggestionsAdminInteraction };
