'use strict';
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const stickyStore = require('./stickyGuildStore');
const stickyManager = require('./stickyManager');
const guildManager = require('../../core/guild/guildManager');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (customId, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const displayName = (i) => i.member?.displayName || i.user?.displayName || i.user?.username || 'Unknown User';
const formatChannels = (data) => Object.keys(data.channels || {}).length ? Object.keys(data.channels || {}).map((id) => `<#${id}>`).join(', ') : '`None`';
const formatRoles = (ids = []) => Array.isArray(ids) && ids.filter(Boolean).length ? ids.filter(Boolean).map((id) => `<@&${id}>`).join(', ') : '`None`';
function getConfig(guildId) {
  const data = stickyStore.loadStickyData(guildId);
  return { enabled: data.enabled !== false, channels: data.channels || {}, managerRoleIds: Array.isArray(data.managerRoleIds) ? data.managerRoleIds : [], defaultContent: data.defaultContent || '📌 Sticky message configured by Goliath.', repostEvery: Number(data.repostEvery || 10), cooldownSeconds: Number(data.cooldownSeconds ?? 60), cleanupPrevious: data.cleanupPrevious !== false, allowEmbeds: data.allowEmbeds !== false, mode: data.mode || 'per-channel' };
}
function saveConfig(guild, updater) {
  const current = getConfig(guild.id); const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) }; const existing = stickyStore.loadStickyData(guild.id);
  const saved = stickyStore.saveStickyData(guild.id, { ...existing, ...next, enabled: next.enabled !== false, updatedAt: new Date().toISOString() });
  guildManager.setModuleEnabled(guild.id, 'sticky', next.enabled !== false, guild); return saved;
}
function buildStickyAdminPanel(guild, memberDisplayName = 'Unknown User') {
  const c = getConfig(guild.id); const active = Object.values(c.channels || {}).filter((s) => s?.enabled !== false).length;
  const embed = new EmbedBuilder().setColor(c.enabled ? 0x57f287 : 0x5865f2).setTitle('💬 Sticky Messages').setDescription([
    'Configure channels that automatically repost a sticky message after chat activity.', '',
    `**Status:** ${c.enabled ? 'Enabled ✅' : 'Disabled ❌'}`,
    `**Sticky Channels:** ${formatChannels(c)}`, `**Active Stickies:** \`${active}\``,
    `**Manager Roles:** ${formatRoles(c.managerRoleIds)}`, `**Repost Every:** \`${c.repostEvery}\` message(s)`,
    `**Cooldown:** \`${c.cooldownSeconds}\` second(s)`, `**Embeds:** ${c.allowEmbeds ? 'Enabled ✅' : 'Disabled ❌'}`, '', '**Default Message**', c.defaultContent.slice(0, 1000),
  ].join('\n')).setFooter({ text: `Requested by ${memberDisplayName}` }).setTimestamp();
  return { embeds: [embed], components: [
    row(new ChannelSelectMenuBuilder().setCustomId('admin:sticky:channels').setPlaceholder('Sticky channels').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(10)),
    row(new RoleSelectMenuBuilder().setCustomId('admin:sticky:managerRoles').setPlaceholder('Manager roles').setMinValues(0).setMaxValues(10)),
    row(button('admin:sticky:message', '✏️ Message', ButtonStyle.Primary), button('admin:sticky:refresh', '🔄 Refresh', ButtonStyle.Success), button(c.enabled ? 'admin:sticky:disable' : 'admin:sticky:enable', c.enabled ? '⏸️ Disable' : '▶️ Enable', ButtonStyle.Secondary), button('admin:sticky:toggleEmbed', '🎨 Embed', ButtonStyle.Secondary)),
    row(button('admin:sticky:repostDown', '➖ Repost', ButtonStyle.Secondary), button('admin:sticky:repostUp', '➕ Repost', ButtonStyle.Secondary), button('admin:sticky:cooldownDown', '➖ Cooldown', ButtonStyle.Secondary), button('admin:sticky:cooldownUp', '➕ Cooldown', ButtonStyle.Secondary)),
    row(button('admin:modules', '⬅️ Modules', ButtonStyle.Secondary)),
  ] };
}
function buildMessageModal(guildId) { const c = getConfig(guildId); return new ModalBuilder().setCustomId('admin:sticky:messageModal').setTitle('Sticky Message').addComponents(row(new TextInputBuilder().setCustomId('content').setLabel('Sticky message content').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1800).setValue(c.defaultContent.slice(0, 1800)))); }
async function safeUpdate(i, p) { if (i.deferred || i.replied) await i.editReply(p); else await i.update(p); return true; }
function upsertSelectedChannels(guild, channelIds) { const c = getConfig(guild.id); const channels = {}; for (const channelId of channelIds || []) channels[channelId] = { ...(c.channels[channelId] || {}), enabled: true, channelId, type: c.allowEmbeds ? 'embed' : 'text', content: c.defaultContent, repostEvery: c.repostEvery, cooldownSeconds: c.cooldownSeconds, messageCount: 0 }; saveConfig(guild, { channels }); }
async function handleStickyAdminInteraction(i) {
  const id = String(i.customId || ''); if (!id.startsWith('admin:sticky')) return false; const member = displayName(i);
  try {
    if (id === 'admin:sticky') return safeUpdate(i, buildStickyAdminPanel(i.guild, member));
    if (id === 'admin:sticky:message') { await i.showModal(buildMessageModal(i.guild.id)); return true; }
    if (i.isModalSubmit?.() && id === 'admin:sticky:messageModal') { const content = i.fields.getTextInputValue('content'); saveConfig(i.guild, (c) => { const channels = { ...(c.channels || {}) }; for (const channelId of Object.keys(channels)) channels[channelId] = { ...channels[channelId], content }; return { ...c, defaultContent: content, channels }; }); await i.reply({ content: '✅ Sticky message updated.', flags: 64 }).catch(() => null); return true; }
    if (i.isChannelSelectMenu?.() && id === 'admin:sticky:channels') upsertSelectedChannels(i.guild, i.values || []);
    else if (i.isRoleSelectMenu?.() && id === 'admin:sticky:managerRoles') saveConfig(i.guild, { managerRoleIds: [...new Set(i.values || [])] });
    else if (id === 'admin:sticky:enable') saveConfig(i.guild, { enabled: true });
    else if (id === 'admin:sticky:disable') saveConfig(i.guild, { enabled: false });
    else if (id === 'admin:sticky:toggleEmbed') saveConfig(i.guild, (c) => ({ ...c, allowEmbeds: !c.allowEmbeds }));
    else if (id === 'admin:sticky:repostUp') saveConfig(i.guild, (c) => ({ ...c, repostEvery: Math.min(100, Number(c.repostEvery || 10) + 1) }));
    else if (id === 'admin:sticky:repostDown') saveConfig(i.guild, (c) => ({ ...c, repostEvery: Math.max(1, Number(c.repostEvery || 10) - 1) }));
    else if (id === 'admin:sticky:cooldownUp') saveConfig(i.guild, (c) => ({ ...c, cooldownSeconds: Math.min(3600, Number(c.cooldownSeconds || 60) + 15) }));
    else if (id === 'admin:sticky:cooldownDown') saveConfig(i.guild, (c) => ({ ...c, cooldownSeconds: Math.max(0, Number(c.cooldownSeconds || 60) - 15) }));
    else if (id === 'admin:sticky:refresh') { await i.deferUpdate().catch(() => null); const c = getConfig(i.guild.id); for (const channelId of Object.keys(c.channels || {})) { const channel = i.guild.channels.cache.get(channelId) || await i.guild.channels.fetch(channelId).catch(() => null); const sticky = stickyStore.getChannelSticky(i.guild.id, channelId); if (channel?.send && sticky) await stickyManager.repostSticky(channel, sticky, i.client, { manual: true, actorId: i.user.id }).catch(() => null); } }
    return safeUpdate(i, buildStickyAdminPanel(i.guild, member));
  } catch (error) { const p = { content: `❌ Sticky setup failed: ${error.message}`, flags: 64 }; if (i.deferred || i.replied) await i.followUp(p).catch(() => null); else await i.reply(p).catch(() => null); return true; }
}
module.exports = { buildStickyAdminPanel, handleStickyAdminInteraction };
