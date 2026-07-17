'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder } = require('discord.js');
const starboardStore = require('./starboardStore');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const displayName = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const formatChannel = (id) => id ? `<#${id}>` : '`Not set`';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '`None`';
function buildStarboardAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const s = starboardStore.getStarboardSection(guild.id); const posts = Object.values(s.posts || {});
  const embed = new EmbedBuilder().setColor(s.enabled !== false ? 0x57f287 : 0x5865f2).setTitle('⭐ Starboard').setDescription([
    'Configure highlighted messages powered by reactions.', '',
    `**Status:** ${s.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Starboard Channel:** ${formatChannel(s.channelId || s.starboardChannelId)}`,
    `**Log Channel:** ${formatChannel(s.logChannelId)}`,
    `**Manager Roles:** ${formatRoles(s.managerRoleIds)}`,
    `**Emoji:** ${s.emoji || '⭐'}`, `**Threshold:** \`${s.threshold || 3}\``,
    `**Self Star:** ${s.allowSelfStar ? 'Allowed ✅' : 'Blocked ❌'}`,
    `**Unique Users:** ${s.requireUniqueUsers !== false ? 'Required ✅' : 'Not Required ❌'}`, '',
    `Posts: \`${posts.length}\` | Posted: \`${s.analytics?.posted || 0}\` | Updated: \`${s.analytics?.updated || 0}\``,
  ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:starboard:channel').setPlaceholder('Starboard channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new ChannelSelectMenuBuilder().setCustomId('admin:starboard:logChannel').setPlaceholder('Log channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:starboard:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(button(s.enabled !== false ? 'admin:starboard:disable' : 'admin:starboard:enable', s.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:starboard:thresholdDown', '➖ Threshold', ButtonStyle.Secondary), button('admin:starboard:thresholdUp', '➕ Threshold', ButtonStyle.Secondary), button('admin:starboard:toggleSelf', '⭐ Self Star', ButtonStyle.Secondary), button('admin:starboard:toggleUnique', '👥 Unique', ButtonStyle.Secondary)),
    row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}
const save = (g, u) => starboardStore.updateStarboardSection(g.id, u, g);
async function safeUpdate(i, p) { if (i.deferred || i.replied) await i.editReply(p); else await i.update(p); return true; }
async function handleStarboardAdminInteraction(i) {
  const id = String(i.customId || ''); if (!id.startsWith('admin:starboard')) return false; const member = displayName(i);
  try {
    if (id === 'admin:starboard') return safeUpdate(i, buildStarboardAdminPanel(i.guild, member));
    if (i.isChannelSelectMenu?.()) { const value = i.values?.[0] || null; const prop = id.split(':')[2]; if (prop === 'channel') save(i.guild, (s) => ({ ...s, channelId: value, starboardChannelId: value })); if (prop === 'logChannel') save(i.guild, (s) => ({ ...s, logChannelId: value })); }
    else if (i.isRoleSelectMenu?.() && id === 'admin:starboard:managerRoles') save(i.guild, (s) => ({ ...s, managerRoleIds: [...new Set(i.values || [])] }));
    else if (id === 'admin:starboard:enable') save(i.guild, (s) => ({ ...s, enabled: true }));
    else if (id === 'admin:starboard:disable') save(i.guild, (s) => ({ ...s, enabled: false }));
    else if (id === 'admin:starboard:thresholdUp') save(i.guild, (s) => ({ ...s, threshold: Math.min(50, Number(s.threshold || 3) + 1) }));
    else if (id === 'admin:starboard:thresholdDown') save(i.guild, (s) => ({ ...s, threshold: Math.max(1, Number(s.threshold || 3) - 1) }));
    else if (id === 'admin:starboard:toggleSelf') save(i.guild, (s) => ({ ...s, allowSelfStar: !s.allowSelfStar }));
    else if (id === 'admin:starboard:toggleUnique') save(i.guild, (s) => ({ ...s, requireUniqueUsers: !s.requireUniqueUsers }));
    return safeUpdate(i, buildStarboardAdminPanel(i.guild, member));
  } catch (error) { const p = { content: `❌ Starboard setup failed: ${error.message}`, flags: 64 }; if (i.deferred || i.replied) await i.followUp(p).catch(() => null); else await i.reply(p).catch(() => null); return true; }
}
module.exports = { buildStarboardAdminPanel, handleStarboardAdminInteraction };
