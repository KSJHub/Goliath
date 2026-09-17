'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const {
  DEFAULT_INVESTIGATION_CATEGORY_NAME,
  getQuarantineState,
  saveQuarantineState,
} = require('./state');
const {
  quarantineDenyOverwrite,
  investigationMemberOverwrite,
  investigationStaffOverwrite,
} = require('./isolation');

function cleanCategoryName(value) {
  const name = String(value || '').trim().slice(0, 100);
  return name || DEFAULT_INVESTIGATION_CATEGORY_NAME;
}

function cleanChannelName(value) {
  const safe = String(value || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return safe || 'member';
}

function getInvestigationStaffRoleIds(guild, options = {}) {
  const explicit = Array.isArray(options.staffRoleIds) ? options.staffRoleIds.map(String) : [];
  const selected = new Set(explicit);
  const staffPermissions = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
  ];
  for (const role of guild.roles.cache.values()) {
    if (role.id === guild.id || role.managed) continue;
    if (staffPermissions.some((permission) => role.permissions.has(permission))) selected.add(String(role.id));
  }
  return [...selected].filter((roleId) => guild.roles.cache.has(roleId)).slice(0, 80);
}

async function ensureInvestigationCategory(guild, options = {}) {
  if (!guild) throw new Error('Missing guild.');
  const state = getQuarantineState(guild.id);
  const categoryName = cleanCategoryName(options.categoryName || state.investigationCategoryName);
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) throw new Error('Goliath guild member is unavailable.');
  let category = state.investigationCategoryId ? guild.channels.cache.get(String(state.investigationCategoryId)) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === categoryName) || null;
  }
  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel] },
      ],
      reason: 'Goliath investigation isolation category',
    });
  }
  await category.permissionOverwrites.edit(botMember.id, { ViewChannel: true }, { reason: 'Ensure Goliath access to investigation category' });
  if (state.investigationCategoryId !== category.id || state.investigationCategoryName !== category.name) {
    saveQuarantineState(guild, { ...state, investigationCategoryId: category.id, investigationCategoryName: category.name });
  }
  return category;
}

async function buildInvestigationRoomOverwrites(guild, member, quarantineRole, options = {}) {
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) throw new Error('Goliath guild member is unavailable.');
  const memberAllow = Object.entries(investigationMemberOverwrite()).filter(([, value]) => value === true).map(([name]) => PermissionFlagsBits[name]).filter(Boolean);
  const staffAllow = Object.entries(investigationStaffOverwrite()).filter(([, value]) => value === true).map(([name]) => PermissionFlagsBits[name]).filter(Boolean);
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: quarantineRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: memberAllow },
    { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (guild.ownerId && guild.ownerId !== member.id && guild.ownerId !== botMember.id) {
    overwrites.push({ id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  for (const roleId of getInvestigationStaffRoleIds(guild, options)) {
    if (roleId === quarantineRole.id) continue;
    overwrites.push({ id: roleId, allow: staffAllow });
  }
  return overwrites.slice(0, 95);
}

async function createInvestigationRoom(guild, member, quarantineRole, options = {}) {
  const category = await ensureInvestigationCategory(guild, options);
  const suffix = String(member.id).slice(-4);
  const subjectName = cleanChannelName(member.displayName || member.user?.globalName || member.user?.username || 'member');
  const channel = await guild.channels.create({
    name: `investigation-${subjectName}-${suffix}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Goliath investigation isolation • Member ${member.id} • ${String(options.reason || 'No reason provided').slice(0, 700)}`,
    permissionOverwrites: await buildInvestigationRoomOverwrites(guild, member, quarantineRole, options),
    reason: `Goliath investigation isolation for ${member.user?.tag || member.id}`,
  });
  const leadId = options.quarantinedBy && /^\d+$/.test(String(options.quarantinedBy)) ? String(options.quarantinedBy) : null;
  const intro = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔎 Private Investigation Room')
    .setDescription([`Hi ${member}. This private room has been opened while the moderation team reviews a concern involving your account.`, '', '**This is not a final decision or punishment.** You can continue speaking with the investigating staff here while the review is active.'].join('\n'))
    .addFields(
      { name: '📋 Why this room was opened', value: String(options.reason || 'No reason provided').slice(0, 1024), inline: false },
      { name: '🧭 What happens next', value: '• Staff will review the available information.\n• You may provide context or ask questions in this room.\n• You will be told when the investigation is concluded or moved to the next stage.', inline: false },
      { name: '👤 Lead investigator', value: leadId ? `<@${leadId}>` : 'An authorised member of the moderation team', inline: true },
      { name: '💬 Your access', value: 'You can read and reply in this room while the investigation is active.', inline: true },
    )
    .setFooter({ text: 'Goliath • Private moderation review' })
    .setTimestamp();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_dashboard:${member.id}:cases`).setLabel('Case File').setEmoji('📁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mod_dashboard:${member.id}:intelligence`).setLabel('Intelligence').setEmoji('🧠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_invroom_note:${member.id}`).setLabel('Add Staff Note').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_remove_quarantine:${member.id}`).setLabel('Clear Investigation').setEmoji('🔓').setStyle(ButtonStyle.Success),
  );
  await channel.send({ content: `${member}`, embeds: [intro], components: [controls], allowedMentions: { users: [member.id], roles: [], repliedUser: false } })
    .catch((error) => console.warn(`[QuarantineSystem] Failed to send investigation room intro in ${guild.id}:`, error.message));
  return channel;
}

async function ensureInvestigationRoomForSnapshot(guild, member, role, snapshot, options = {}) {
  let channel = snapshot?.interviewChannelId ? guild.channels.cache.get(String(snapshot.interviewChannelId)) : null;
  if (!channel && snapshot?.interviewChannelId) channel = await guild.channels.fetch(String(snapshot.interviewChannelId)).catch(() => null);
  if (!channel) {
    channel = await createInvestigationRoom(guild, member, role, { ...options, reason: snapshot?.reason || options.reason });
    const state = getQuarantineState(guild.id);
    if (state.users?.[member.id]) {
      state.users[member.id].interviewChannelId = channel.id;
      saveQuarantineState(guild, state);
    }
  } else {
    await channel.permissionOverwrites.edit(role.id, quarantineDenyOverwrite(), { reason: 'Reasserting investigation quarantine role isolation' });
    await channel.permissionOverwrites.edit(member.id, investigationMemberOverwrite(), { reason: 'Restoring investigation interview access' });
  }
  return channel;
}

module.exports = {
  cleanCategoryName,
  cleanChannelName,
  getInvestigationStaffRoleIds,
  ensureInvestigationCategory,
  buildInvestigationRoomOverwrites,
  createInvestigationRoom,
  ensureInvestigationRoomForSnapshot,
};
