'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder } = require('discord.js');
const levelingStore = require('./levelingStore');
const levelingManager = require('./levelingManager');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const name = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const channel = (id) => id ? `<#${id}>` : '`Not set`';
const roles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '`None`';
function leaderboard(guildId) { const top = levelingManager.getLeaderboard(guildId, 5); return top.length ? top.map((u, i) => `**${i + 1}.** <@${u.userId}> — Level \`${u.level}\` · XP \`${u.xp}\``).join('\n') : '`No XP tracked yet.`'; }
function buildLevelingAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const s = levelingStore.getSection(guild.id); const users = Object.values(s.users || {});
  const embed = new EmbedBuilder().setColor(s.enabled !== false ? 0x57f287 : 0x5865f2).setTitle('🏆 Leveling').setDescription([
    'Configure XP tracking, level-up announcements and reward roles.', '',
    `**Status:** ${s.enabled !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Announce Channel:** ${channel(s.announceChannelId)}`,
    `**Manager Roles:** ${roles(s.managerRoleIds)}`,
    `**Level Roles:** ${roles(s.levelRoleIds)}`,
    `**Message XP:** ${s.trackMessages !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Voice XP:** ${s.trackVoice !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Level Up Announcements:** ${s.announceLevelUps !== false ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**XP Per Message:** \`${s.xpPerMessage}\``, `**Cooldown:** \`${s.cooldownSeconds}\` second(s)`, '',
    `Users: \`${users.length}\` | XP Awarded: \`${s.analytics.xpAwarded}\` | Level Ups: \`${s.analytics.levelUps}\``, '', '**Top Members**', leaderboard(guild.id),
  ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:leveling:announceChannel').setPlaceholder('Level-up announcement channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:leveling:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:leveling:levelRoles').setPlaceholder('Level reward roles').setMinValues(0).setMaxValues(10)),
    row(button(s.enabled !== false ? 'admin:leveling:disable' : 'admin:leveling:enable', s.enabled !== false ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:leveling:toggleMessages', '💬 Messages', ButtonStyle.Secondary), button('admin:leveling:toggleVoice', '🔊 Voice', ButtonStyle.Secondary), button('admin:leveling:toggleAnnounce', '📣 Announce', ButtonStyle.Secondary), button('admin:leveling:xpUp', '➕ XP', ButtonStyle.Secondary)),
    row(button('admin:leveling:xpDown', '➖ XP', ButtonStyle.Secondary), button('admin:leveling:cooldownDown', '➖ Cooldown', ButtonStyle.Secondary), button('admin:leveling:cooldownUp', '➕ Cooldown', ButtonStyle.Secondary), button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}
const save = (g, u) => levelingStore.updateSection(g.id, u, g);
async function safeUpdate(i, p) { if (i.deferred || i.replied) await i.editReply(p); else await i.update(p); return true; }
async function handleLevelingAdminInteraction(i) {
  const id = String(i.customId || ''); if (!id.startsWith('admin:leveling')) return false; const member = name(i);
  try {
    if (id === 'admin:leveling') return safeUpdate(i, buildLevelingAdminPanel(i.guild, member));
    if (i.isChannelSelectMenu?.() && id === 'admin:leveling:announceChannel') save(i.guild, (s) => ({ ...s, announceChannelId: i.values?.[0] || null }));
    else if (i.isRoleSelectMenu?.() && id === 'admin:leveling:managerRoles') save(i.guild, (s) => ({ ...s, managerRoleIds: [...new Set(i.values || [])] }));
    else if (i.isRoleSelectMenu?.() && id === 'admin:leveling:levelRoles') save(i.guild, (s) => ({ ...s, levelRoleIds: [...new Set(i.values || [])] }));
    else if (id === 'admin:leveling:enable') save(i.guild, (s) => ({ ...s, enabled: true }));
    else if (id === 'admin:leveling:disable') save(i.guild, (s) => ({ ...s, enabled: false }));
    else if (id === 'admin:leveling:toggleMessages') save(i.guild, (s) => ({ ...s, trackMessages: !s.trackMessages }));
    else if (id === 'admin:leveling:toggleVoice') save(i.guild, (s) => ({ ...s, trackVoice: !s.trackVoice }));
    else if (id === 'admin:leveling:toggleAnnounce') save(i.guild, (s) => ({ ...s, announceLevelUps: !s.announceLevelUps }));
    else if (id === 'admin:leveling:xpUp') save(i.guild, (s) => ({ ...s, xpPerMessage: Math.min(1000, Number(s.xpPerMessage || 10) + 5) }));
    else if (id === 'admin:leveling:xpDown') save(i.guild, (s) => ({ ...s, xpPerMessage: Math.max(1, Number(s.xpPerMessage || 10) - 5) }));
    else if (id === 'admin:leveling:cooldownUp') save(i.guild, (s) => ({ ...s, cooldownSeconds: Math.min(3600, Number(s.cooldownSeconds || 60) + 15) }));
    else if (id === 'admin:leveling:cooldownDown') save(i.guild, (s) => ({ ...s, cooldownSeconds: Math.max(0, Number(s.cooldownSeconds || 60) - 15) }));
    return safeUpdate(i, buildLevelingAdminPanel(i.guild, member));
  } catch (error) { const p = { content: `❌ Leveling setup failed: ${error.message}`, flags: 64 }; if (i.deferred || i.replied) await i.followUp(p).catch(() => null); else await i.reply(p).catch(() => null); return true; }
}
module.exports = { buildLevelingAdminPanel, handleLevelingAdminInteraction };
