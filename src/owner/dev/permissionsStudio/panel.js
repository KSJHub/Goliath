'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder,
  ChannelType, EmbedBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder,
} = require('discord.js');

const PREFIX = 'permstudio:';
const cid = (action, guildId) => `${PREFIX}${action}:guild:${guildId}`;
const button = (id, label, emoji, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);

function nav(guildId, active = 'home') {
  return new ActionRowBuilder().addComponents(
    button(cid('audit', guildId), 'Audit', '🔎', active === 'audit' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button(cid('main', guildId), 'Main', '🏠', active === 'main' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button(cid('channels', guildId), 'Channels & Categories', '📁', active === 'channels' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button(cid('clipboard', guildId), 'Clipboard', '📋', active === 'clipboard' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function back(guildId) {
  return new ActionRowBuilder().addComponents(button(cid('back-server-tools', guildId), 'Back to Server Tools', '⬅️'));
}

function home(guild, state = {}) {
  const clip = state.clipboard;
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🛡️ Permissions Studio')
    .setDescription('Build, audit, copy and control Discord permissions from one workspace.\n\n**Configure once. Copy anywhere. Modify only what is different.**')
    .addFields(
      { name: '🔎 Audit', value: 'Scan roles, dangerous permissions, unsynced channels and member overrides.', inline: true },
      { name: '🏠 Main', value: 'Server permission foundation and guild-level role permissions.', inline: true },
      { name: '📁 Channels & Categories', value: 'Category/channel overwrites, inheritance and individual role control.', inline: true },
      { name: '📋 Permission Clipboard', value: clip ? `Loaded: **${clip.label}** (${clip.kind})` : 'Empty — copy a role, channel or category to begin.', inline: false },
    ).setFooter({ text: `${guild.name} • Owner-only Developer Tools` });
  return { embeds: [embed], components: [nav(guild.id), back(guild.id)] };
}

function audit(guild, report = null) {
  const embed = new EmbedBuilder().setColor(report?.critical ? 0xED4245 : 0x5865F2).setTitle('🔎 Permissions Audit')
    .setDescription(report ? 'Latest live scan of the current Discord permission structure.' : 'Scan the server before editing. This is read-only and makes no Discord changes.');
  if (report) embed.addFields(
    { name: 'Scanned', value: `**${report.roles}** roles • **${report.categories}** categories • **${report.channels}** channels`, inline: false },
    { name: 'High-impact roles', value: `Administrator: **${report.administrator}**\nManage Server: **${report.manageGuild}**\nManage Roles: **${report.manageRoles}**\nManage Channels: **${report.manageChannels}**`, inline: true },
    { name: 'Overrides', value: `Unsynced channels: **${report.unsynced}**\nMember overrides: **${report.memberOverrides}**\nExplicit role overrides: **${report.roleOverrides}**`, inline: true },
    { name: 'Status', value: report.notes.length ? report.notes.slice(0, 10).join('\n') : '✅ No notable permission findings from this scan.', inline: false },
  );
  return { embeds: [embed], components: [nav(guild.id, 'audit'), new ActionRowBuilder().addComponents(button(cid('scan', guild.id), 'Scan Server', '🔎', ButtonStyle.Primary), button(cid('search', guild.id), 'Permission Search', '🔍')), back(guild.id)] };
}

function main(guild) {
  const everyone = guild.roles.everyone;
  const bot = guild.members.me;
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🏠 Main Permissions')
    .setDescription('The server-level permission layer. Choose a role to inspect, copy or edit its guild permissions.')
    .addFields(
      { name: '⚙️ Server Foundation', value: `@everyone permissions: **${everyone.permissions.toArray().length}** enabled\nRoles: **${guild.roles.cache.size}**\nGoliath top role: ${bot?.roles?.highest || 'Unavailable'}`, inline: false },
      { name: '👥 Role Permissions', value: 'Select a role below. Guild permissions are separate from channel/category overwrites.', inline: false },
    );
  const rolePicker = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid('role-select', guild.id)).setPlaceholder('Select a role…').setMinValues(1).setMaxValues(1));
  return { embeds: [embed], components: [nav(guild.id, 'main'), rolePicker, back(guild.id)] };
}

function role(guild, role, state = {}) {
  const enabled = role.permissions.toArray();
  const groups = [
    ['High impact', ['Administrator','ManageGuild','ManageRoles','ManageChannels','ViewAuditLog']],
    ['Members', ['KickMembers','BanMembers','ModerateMembers','ManageNicknames']],
    ['Messages', ['ManageMessages','ManageThreads','MentionEveryone','ManageWebhooks']],
    ['Voice', ['MuteMembers','DeafenMembers','MoveMembers','PrioritySpeaker']],
  ];
  const embed = new EmbedBuilder().setColor(role.color || 0x5865F2).setTitle(`👥 Role Permissions • ${role.name}`)
    .setDescription(`Position **${role.position}** • ${enabled.length} enabled permissions${role.managed ? ' • ⚙️ Managed role' : ''}`);
  for (const [name, perms] of groups) embed.addFields({ name, value: perms.map(p => `${enabled.includes(p) ? '✅' : '❌'} ${p}`).join('\n'), inline: true });
  const actions = new ActionRowBuilder().addComponents(
    button(cid(`copy-role-${role.id}`, guild.id), 'Copy Role', '📋', ButtonStyle.Primary, role.managed),
    button(cid(`paste-role-${role.id}`, guild.id), 'Paste to Role', '📥', ButtonStyle.Secondary, !state.clipboard || role.managed),
    button(cid(`compare-role-${role.id}`, guild.id), 'Compare', '↔️'),
    button(cid(`role-back`, guild.id), 'Back', '⬅️'),
  );
  return { embeds: [embed], components: [nav(guild.id, 'main'), actions] };
}

function channels(guild) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📁 Channels & Categories')
    .setDescription('Select any category or channel. Goliath will show its permission overwrites, sync state and copy/paste controls.');
  const picker = new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(cid('channel-select', guild.id)).setPlaceholder('Select a category or channel…').setMinValues(1).setMaxValues(1)
    .addChannelTypes(ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia));
  return { embeds: [embed], components: [nav(guild.id, 'channels'), picker, back(guild.id)] };
}

function channel(guild, channel, state = {}) {
  const parent = channel.parent;
  const synced = channel.type === ChannelType.GuildCategory ? null : channel.permissionsLocked;
  const overwrites = [...channel.permissionOverwrites.cache.values()];
  const roleCount = overwrites.filter(o => o.type === 0).length;
  const memberCount = overwrites.filter(o => o.type === 1).length;
  const lines = overwrites.slice(0, 12).map(o => {
    const target = o.type === 0 ? guild.roles.cache.get(o.id) : guild.members.cache.get(o.id);
    return `${o.type === 0 ? '👥' : '👤'} **${target?.name || target?.displayName || o.id}** — ✅ ${o.allow.toArray().length} / ❌ ${o.deny.toArray().length}`;
  });
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`${channel.type === ChannelType.GuildCategory ? '📁' : '#️⃣'} ${channel.name}`)
    .setDescription(channel.type === ChannelType.GuildCategory ? 'Category permission overwrites.' : `Category: **${parent?.name || 'None'}**\n${synced ? '🔗 Synced with category' : '⚠️ Has individual channel permissions'}`)
    .addFields(
      { name: 'Overrides', value: `Role overrides: **${roleCount}** • Member overrides: **${memberCount}**`, inline: false },
      { name: 'Permission map', value: lines.length ? lines.join('\n') : 'No explicit overwrites.', inline: false },
    );
  const actions = new ActionRowBuilder().addComponents(
    button(cid(`copy-channel-${channel.id}`, guild.id), 'Copy', '📋', ButtonStyle.Primary),
    button(cid(`paste-channel-${channel.id}`, guild.id), 'Paste', '📥', ButtonStyle.Secondary, !state.clipboard),
    button(cid(`compare-channel-${channel.id}`, guild.id), 'Compare', '↔️'),
    button(cid(`sync-channel-${channel.id}`, guild.id), 'Sync Category', '🔗', ButtonStyle.Secondary, channel.type === ChannelType.GuildCategory || !parent),
    button(cid('channels', guild.id), 'Back', '⬅️'),
  );
  const rolePicker = new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(cid(`channel-role-${channel.id}`, guild.id)).setPlaceholder('Inspect role on this channel…').setMinValues(1).setMaxValues(1));
  return { embeds: [embed], components: [nav(guild.id, 'channels'), rolePicker, actions] };
}

function channelRole(guild, channel, role) {
  const overwrite = channel.permissionOverwrites.cache.get(role.id);
  const effective = channel.permissionsFor(role);
  const explicitAllow = overwrite?.allow?.toArray() || [];
  const explicitDeny = overwrite?.deny?.toArray() || [];
  const relevant = ['ViewChannel','SendMessages','ReadMessageHistory','AddReactions','EmbedLinks','AttachFiles','ManageMessages','ManageChannels','Connect','Speak','MoveMembers'];
  const lines = relevant.map(p => `${explicitAllow.includes(p) ? '✅ ALLOW' : explicitDeny.includes(p) ? '❌ DENY' : '➖ INHERIT'} • ${p} → ${effective?.has(p) ? '✅ effective' : '❌ effective'}`);
  const embed = new EmbedBuilder().setColor(role.color || 0x5865F2).setTitle(`🎚️ ${role.name} → ${channel.name}`).setDescription(lines.join('\n'))
    .setFooter({ text: 'Allow / Deny / Inherit are Discord channel overwrite states.' });
  return { embeds: [embed], components: [nav(guild.id, 'channels'), new ActionRowBuilder().addComponents(button(cid(`copy-channel-role-${channel.id}-${role.id}`, guild.id), 'Copy This Role Override', '📋', ButtonStyle.Primary), button(cid(`paste-channel-role-${channel.id}-${role.id}`, guild.id), 'Paste Here', '📥'), button(cid(`open-channel-${channel.id}`, guild.id), 'Back', '⬅️'))] };
}

function clipboard(guild, state = {}) {
  const clip = state.clipboard;
  const history = state.history || [];
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Permission Clipboard')
    .setDescription(clip ? `**${clip.label}**\nType: \`${clip.kind}\`\nCopied: <t:${Math.floor(clip.copiedAt / 1000)}:R>` : 'Clipboard is empty.')
    .addFields({ name: 'Recent changes', value: history.length ? history.slice(-6).reverse().map(h => `• ${h.label}`).join('\n') : 'No Permissions Studio changes this session.' });
  const row = new ActionRowBuilder().addComponents(button(cid('clear-clipboard', guild.id), 'Clear Clipboard', '🗑️', ButtonStyle.Danger, !clip), button(cid('undo', guild.id), 'Undo Last Paste', '↶', ButtonStyle.Secondary, !history.length));
  return { embeds: [embed], components: [nav(guild.id, 'clipboard'), row, back(guild.id)] };
}

function pastePreview(guild, source, targetLabel, token, summary) {
  const embed = new EmbedBuilder().setColor(0xFEE75C).setTitle('📥 Paste Preview').setDescription(`**From:** ${source.label}\n**To:** ${targetLabel}\n\n${summary}\n\nNothing has changed yet.`)
    .setFooter({ text: 'Review before applying. Existing permissions may be replaced.' });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button(cid(`confirm-${token}`, guild.id), 'Apply Changes', '✅', ButtonStyle.Success), button(cid('clipboard', guild.id), 'Cancel', '✖️', ButtonStyle.Secondary))] };
}

function comparePicker(guild, kind, sourceId) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('↔️ Compare Permissions').setDescription('Choose the second item. Goliath will show only the differences.');
  const picker = kind === 'role'
    ? new RoleSelectMenuBuilder().setCustomId(cid(`compare-target-role-${sourceId}`, guild.id)).setPlaceholder('Compare with role…')
    : new ChannelSelectMenuBuilder().setCustomId(cid(`compare-target-channel-${sourceId}`, guild.id)).setPlaceholder('Compare with channel/category…');
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(picker)] };
}

function diff(guild, title, lines) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`↔️ ${title}`).setDescription(lines.length ? lines.slice(0, 35).join('\n') : '✅ No permission differences found.');
  return { embeds: [embed], components: [nav(guild.id)] };
}

module.exports = { PREFIX, home, audit, main, role, channels, channel, channelRole, clipboard, pastePreview, comparePicker, diff };
