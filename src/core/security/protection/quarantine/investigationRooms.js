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
  QUARANTINE_MODES,
  getQuarantineMode,
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
  return name === 'Goliath Investigations' ? DEFAULT_INVESTIGATION_CATEGORY_NAME : name || DEFAULT_INVESTIGATION_CATEGORY_NAME;
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
  const { canUseModAction } = require('../../../administration/mod/permissions');
  const everyone = guild.roles.everyone || guild.roles.cache.get(guild.id);
  return [...guild.roles.cache.values()].filter(role => {
    if (role.id === guild.id || role.managed || role.id === getQuarantineState(guild.id).roleId) return false;
    // Resolve the actual Goliath authority profile; never infer authority from a role name.
    const probe = { id: 'investigation-role-probe', guild, user: { id: 'investigation-role-probe' },
      roles: { cache: new Map([[guild.id, everyone], [role.id, role]]), highest: role },
      permissions: new (require('discord.js').PermissionsBitField)((role.permissions?.bitfield || 0n) | (everyone?.permissions?.bitfield || 0n)) };
    return canUseModAction(probe, guild, 'quarantine');
  }).map(role => role.id).slice(0, 80);
}

async function ensureInvestigationCategory(guild, options = {}) {
  if (!guild) throw new Error('Missing guild.');
  const state = getQuarantineState(guild.id);
  const categoryName = cleanCategoryName(options.categoryName || state.investigationCategoryName);
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) throw new Error('Goliath guild member is unavailable.');
  let category = state.investigationCategoryId ? guild.channels.cache.get(String(state.investigationCategoryId)) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && (channel.name === categoryName || (categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME && channel.name === 'Goliath Investigations'))) || null;
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
  if (category.name === 'Goliath Investigations' && categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME) await category.setName(categoryName, 'Use generic investigation category name');
  await category.permissionOverwrites.edit(botMember.id, { ViewChannel: true }, { reason: 'Ensure Goliath access to investigation category' });
  if (state.investigationCategoryId !== category.id || state.investigationCategoryName !== category.name) {
    saveQuarantineState(guild, { ...getQuarantineState(guild.id), investigationCategoryId: category.id, investigationCategoryName: category.name });
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

function investigationRoomControls(memberId, channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_invroom_transcript:${memberId}:${channelId}`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_invroom_notify:${memberId}:${channelId}`).setLabel('Notify Management').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_invroom_close:${memberId}:${channelId}`).setLabel('Close Investigation').setEmoji('🔓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mod_invroom_delete:${memberId}:${channelId}`).setLabel('Delete Closed Room').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

async function notifyInvestigationManagement(channel, memberId, leadId = null) {
  const guild = channel.guild;
  await guild.roles.fetch();
  const roleIds = getInvestigationStaffRoleIds(guild);
  for (const id of roleIds) await channel.permissionOverwrites.edit(id, investigationStaffOverwrite(), { reason: 'Authorised management investigation access' });
  const users = [...new Set([guild.ownerId, leadId].filter(id => /^\d{15,25}$/.test(String(id || '')) && id !== memberId))];
  const bot = guild.members.me || await guild.members.fetchMe();
  const pingRoles = roleIds.filter(id => guild.roles.cache.get(id)?.mentionable || (channel.permissionsFor?.(bot) || bot.permissions).has(PermissionFlagsBits.MentionEveryone));
  await channel.send({
    content: `🔔 **Management review requested**\n${[...roleIds.map(id => `<@&${id}>`), ...users.map(id => `<@${id}>`)].join(' ')}\nPlease join this room to review the investigation for <@${memberId}>.${pingRoles.length < roleIds.length ? '\nSome management roles cannot be pinged with my current Discord permissions.' : ''}`,
    allowedMentions: { parse: [], roles: pingRoles, users },
  });
  return { roleIds, pingedRoleIds: pingRoles, userIds: users };
}

async function createInvestigationRoom(guild, member, quarantineRole, options = {}) {
  const category = await ensureInvestigationCategory(guild, options);
  const suffix = String(member.id).slice(-4);
  const subjectName = cleanChannelName(member.displayName || member.user?.globalName || member.user?.username || 'member');
  const channel = await guild.channels.create({
    name: `investigation-${subjectName}-${suffix}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Private investigation • Member ${member.id} • ${String(options.reason || 'No reason provided').slice(0, 700)}`,
    permissionOverwrites: await buildInvestigationRoomOverwrites(guild, member, quarantineRole, options),
    reason: `Goliath investigation isolation for ${member.user?.tag || member.id}`,
  });
  const leadId = options.quarantinedBy && /^\d+$/.test(String(options.quarantinedBy)) ? String(options.quarantinedBy) : null;
  const intro = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔎 Private Investigation Room')
    .setDescription([`Hi ${member}. This private room has been opened while the moderation team reviews a concern involving your account.`, '', '**This is not a final decision or punishment.** You can continue speaking with the management team here while the review is active.'].join('\n'))
    .addFields(
      { name: '📋 Why this room was opened', value: String(options.reason || 'No reason provided').slice(0, 1024), inline: false },
      { name: '🧭 What happens next', value: '• Management will review the available information.\n• You may provide context or ask questions in this room.\n• You will be told when the investigation is concluded or moved to the next stage.', inline: false },
      { name: '👤 Lead investigator', value: leadId ? `<@${leadId}>` : 'An authorised member of the moderation team', inline: true },
      { name: '💬 Your access', value: 'You can read and reply in this room while the investigation is active.', inline: true },
    )
    .setFooter({ text: 'Private Moderation Review' })
    .setTimestamp();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_dashboard:${member.id}:cases`).setLabel('Case File').setEmoji('📁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`mod_dashboard:${member.id}:intelligence`).setLabel('Intelligence').setEmoji('🧠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_invroom_note:${member.id}`).setLabel('Add Note').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_invroom_access:${member.id}`).setLabel('Channel Access').setEmoji('🔐').setStyle(ButtonStyle.Secondary),
  );
  await channel.send({ content: `${member}`, embeds: [intro], components: [controls, investigationRoomControls(member.id, channel.id)], allowedMentions: { users: [member.id], roles: [], repliedUser: false } })
    .catch((error) => console.warn(`[QuarantineSystem] Failed to send investigation room intro in ${guild.id}:`, error.message));
  await notifyInvestigationManagement(channel, member.id, options.quarantinedBy).catch(error => console.warn(`[QuarantineSystem] Management notification failed in ${guild.id}:`, error.message));
  return channel;
}

const presentationChecks = new Set();
async function refreshInvestigationPresentation(guild, channel, memberId) {
  const state = getQuarantineState(guild.id);
  const parent = channel.parent || guild.channels.cache.get(channel.parentId);
  if (parent?.id === state.investigationCategoryId && parent?.name === 'Goliath Investigations') {
    await parent.setName(DEFAULT_INVESTIGATION_CATEGORY_NAME, 'Use generic investigation category name');
    const latest = getQuarantineState(guild.id);
    if (latest.investigationCategoryId === parent.id && ['Goliath Investigations', DEFAULT_INVESTIGATION_CATEGORY_NAME].includes(latest.investigationCategoryName)) {
      latest.investigationCategoryName = DEFAULT_INVESTIGATION_CATEGORY_NAME;
      saveQuarantineState(guild, latest);
    }
  }
  if (channel.topic?.startsWith('Goliath investigation isolation • Member ')) {
    await channel.setTopic(channel.topic.replace('Goliath investigation isolation • Member ', 'Private investigation • Member '), 'Use generic investigation room topic');
  }
  const key = `${guild.id}:${channel.id}`;
  if (presentationChecks.has(key) || !channel.messages?.fetch || !guild.client?.user?.id) return;
  const messages = await channel.messages.fetch({ limit: 50 });
  const panel = messages.find(message => message.author?.id === guild.client.user.id
    && message.embeds?.[0]?.title === '🔎 Private Investigation Room'
    && message.components?.some(row => row.components.some(component => component.customId === `mod_invroom_transcript:${memberId}:${channel.id}`)));
  if (panel && (panel.embeds[0].footer?.text?.includes('Goliath') || panel.components.some(row => row.components.some(component => component.label === 'Add Staff Note')))) {
    const embed = EmbedBuilder.from(panel.embeds[0]).setFooter({ text: 'Private Moderation Review' });
    if (embed.data.description) embed.setDescription(embed.data.description.replace('investigating staff here', 'management team here'));
    if (embed.data.fields) embed.setFields(embed.data.fields.map(field => ({ ...field, value: field.value.replace('• Staff will review', '• Management will review') })));
    const components = panel.components.map(row => {
      const updated = ActionRowBuilder.from(row);
      for (const component of updated.components) if (component.data.label === 'Add Staff Note') component.setLabel('Add Note');
      return updated;
    });
    await panel.edit({ embeds: [embed], components });
  }
  presentationChecks.add(key);
}

const roomRecoveries = new Map();
async function ensureInvestigationRoomForSnapshot(guild, member, role, snapshot, options = {}) {
  const key = `${guild.id}:${member.id}`;
  if (roomRecoveries.has(key)) return roomRecoveries.get(key);
  const pending = repairInvestigationRoom(guild, member, role, options);
  roomRecoveries.set(key, pending);
  try { return await pending; } finally { roomRecoveries.delete(key); }
}

async function repairInvestigationRoom(guild, member, role, options = {}) {
  // Event arguments may predate a replacement room or an authorised release.
  const snapshot = getQuarantineState(guild.id)?.users?.[member.id];
  if (!snapshot || getQuarantineMode(snapshot) !== QUARANTINE_MODES.INVESTIGATION) return null;
  let channel = snapshot?.interviewChannelId ? guild.channels.cache.get(String(snapshot.interviewChannelId)) : null;
  if (!channel && snapshot?.interviewChannelId) {
    try { channel = await guild.channels.fetch(String(snapshot.interviewChannelId)); }
    catch (error) { if (Number(error?.code) !== 10003) throw error; }
  }
  if (!channel) {
    if (options.existingRoomOnly) throw new Error('Existing case room is unavailable; reconciliation cannot create a replacement.');
    channel = await createInvestigationRoom(guild, member, role, { ...options, reason: snapshot?.reason || options.reason });
    const state = getQuarantineState(guild.id);
    if (state.users?.[member.id]) {
      state.users[member.id].interviewChannelId = channel.id;
      saveQuarantineState(guild, state);
    }
  } else {
    await channel.permissionOverwrites.edit(role.id, quarantineDenyOverwrite(), { reason: 'Reasserting investigation quarantine role isolation' });
    await channel.permissionOverwrites.edit(member.id, investigationMemberOverwrite(), { reason: 'Restoring investigation interview access' });
    await refreshInvestigationPresentation(guild, channel, member.id).catch(error => console.warn('[QuarantineSystem] Room presentation refresh failed:', error.message));
  }
  return channel;
}

module.exports = {
  cleanCategoryName,
  refreshInvestigationPresentation,
  cleanChannelName,
  getInvestigationStaffRoleIds,
  ensureInvestigationCategory,
  buildInvestigationRoomOverwrites,
  createInvestigationRoom,
  investigationRoomControls,
  notifyInvestigationManagement,
  ensureInvestigationRoomForSnapshot,
};
