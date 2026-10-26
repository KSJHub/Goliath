'use strict';

const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
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

function matchInvestigationCategoryStyle(channels) {
  const categories = [...channels.values()].filter(channel => channel.type === ChannelType.GuildCategory
    && !/^(?:Goliath )?Investigations$/i.test(channel.name || ''));
  const styles = new Map();
  for (const category of categories) {
    // A decorative prefix followed by a separator and a name, e.g. "🛡️ | Security".
    // Copy only separator/spacing; never copy another category's title or emoji.
    const match = String(category.name || '').match(/^([^\p{L}\p{N}]*?)([ \t]*[|:·•┃│︱｜][ \t]*)(?=[\p{L}\p{N}])/u);
    if (!match) continue;
    const hasIcon = /\p{Extended_Pictographic}/u.test(match[1]);
    const key = JSON.stringify([match[2], hasIcon]);
    styles.set(key, (styles.get(key) || 0) + 1);
  }
  const ranked = [...styles].sort((a, b) => b[1] - a[1]);
  // Require repeated evidence and a majority; mixed/empty guilds keep the plain default.
  if (!ranked.length || ranked[0][1] < 2 || ranked[0][1] <= categories.length / 2) return DEFAULT_INVESTIGATION_CATEGORY_NAME;
  const [separator, hasIcon] = JSON.parse(ranked[0][0]);
  return `${hasIcon ? '🔎' : ''}${separator}${DEFAULT_INVESTIGATION_CATEGORY_NAME}`;
}

function cleanChannelName(value) {
  const safe = String(value || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
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
  let categoryName = cleanCategoryName(options.categoryName || state.investigationCategoryName);
  const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember) throw new Error('Goliath guild member is unavailable.');
  let category = state.investigationCategoryId ? guild.channels.cache.get(String(state.investigationCategoryId)) : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && (channel.name === categoryName || (categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME && channel.name === 'Goliath Investigations'))) || null;
  }
  if (!category) {
    // Fetch the guild's category inventory before choosing a style or creating anything.
    // Failed scans must not result in duplicate categories.
    await guild.channels.fetch();
    const latest = getQuarantineState(guild.id);
    category = guild.channels.cache.get(String(latest.investigationCategoryId || ''));
    if (category?.type !== ChannelType.GuildCategory) category = null;
    category ||= guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory
      && (channel.name === categoryName || (categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME && channel.name === 'Goliath Investigations')));
    if (!category && categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME && !options.categoryName
      && cleanCategoryName(latest.investigationCategoryName) === DEFAULT_INVESTIGATION_CATEGORY_NAME) {
      categoryName = matchInvestigationCategoryStyle(guild.channels.cache);
    }
    category ||= guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory
      && [categoryName, DEFAULT_INVESTIGATION_CATEGORY_NAME, 'Goliath Investigations'].includes(channel.name)
      && (categoryName === DEFAULT_INVESTIGATION_CATEGORY_NAME || channel.name === categoryName));
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

function getOtherIsolatedMemberIds(guildId, memberId) {
  const sessions = require('../../../../modules/securityStudio/verificationStore').getVerificationSection(guildId)?.sessions || {};
  const isolated = id => sessions[id]?.state === 'quarantined' || (sessions[id]?.state === 'review' && Boolean(sessions[id]?.quarantineChannelId));
  return [...new Set([...Object.keys(getQuarantineState(guildId).users || {}), ...Object.keys(sessions).filter(isolated)])].filter(id => id !== memberId);
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
  if (options.invitationSelection === true) {
    const sessions = require('../../../../modules/securityStudio/verificationStore').getVerificationSection(guild.id)?.sessions || {};
    const hasIsolatedVerification = id => sessions[id]?.state === 'quarantined'
      || (sessions[id]?.state === 'review' && Boolean(sessions[id]?.quarantineChannelId));
    const selectedUsers = [...new Set((options.invitedUserIds || []).map(String))].filter(id => id !== member.id && id !== botMember.id && id !== guild.ownerId);
    const selectedRoles = [...new Set((options.invitedRoleIds || []).map(String))];
    if (selectedUsers.length > 5 || selectedRoles.length > 5) throw new Error('Select up to five members and five roles.');
    if (selectedRoles.some(id => id === guild.id || id === quarantineRole.id)) throw new Error('The everyone and quarantine roles cannot be invited.');
    await guild.roles.fetch();
    for (const id of selectedRoles) {
      if (!guild.roles.cache.has(id)) throw new Error('A selected role is no longer available. Please choose it again.');
      overwrites.push({ id, allow: staffAllow });
    }
    for (const id of selectedUsers) {
      if (getQuarantineState(guild.id).users?.[id] || hasIsolatedVerification(id)) throw new Error('A selected member is already quarantined in another case. Their current isolation must be resolved before they can join.');
      const selected = await guild.members.fetch({ user: id, force: true });
      if (!selected?.roles?.cache || selected.roles.cache.has(quarantineRole.id) || getQuarantineState(guild.id).users?.[id] || hasIsolatedVerification(id)) throw new Error('A selected member is unavailable or already quarantined.');
      overwrites.push({ id, allow: memberAllow });
    }
    // A role allow overrides the quarantine-role deny in Discord. Explicit member
    // denies keep every other active case contained, even if roles changed.
    if (selectedRoles.length) {
      const otherCases = getOtherIsolatedMemberIds(guild.id, member.id);
      // Do not assume that every old quarantine has a shared snapshot. A full
      // member inventory catches unlinked quarantine-role holders before a role
      // overwrite could bypass their quarantine-role deny.
      const members = await guild.members.fetch({ force: true });
      if (!members?.values || !Number.isFinite(members.size)
        || (Number.isInteger(guild.memberCount) && members.size < guild.memberCount)) throw new Error('The member list could not be fully checked. Invite individual members instead.');
      for (const current of members.values()) {
        if (!current.roles?.cache) throw new Error('A member’s roles could not be checked. Invite individual members instead.');
        if (current.id !== member.id && current.roles.cache.has(quarantineRole.id) && !otherCases.includes(current.id))
          throw new Error('An isolated member has no linked case. Reconcile that isolation before inviting roles.');
      }
      if (!Array.isArray(options.protectedCaseIds) || otherCases.some(id => !options.protectedCaseIds.includes(id)))
        throw new Error('Another investigation changed while the room was being prepared. Please try again.');
      for (const id of otherCases) {
        const other = await guild.members.fetch({ user: id, force: true }).catch(error => {
          if (Number(error?.code) === 10007) return null;
          throw error;
        });
        if (!other || typeof other.permissions?.has !== 'function') throw new Error('Another isolated member could not be checked. Invite individual members or resolve the isolation first.');
        if (other.permissions.has(PermissionFlagsBits.Administrator)) throw new Error('Another isolated member has administrator access. Resolve that containment issue before inviting roles.');
        overwrites.push({ id, deny: [PermissionFlagsBits.ViewChannel] });
      }
    }
    if (overwrites.length > 95) throw new Error('Too many active investigations to safely invite these roles. Invite individual members instead.');
    return overwrites;
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

async function notifyInvestigationManagement(channel, memberId, leadId = null, options = {}) {
  const guild = channel.guild;
  await guild.roles.fetch();
  const roleIds = options.invitationSelection === true
    ? [...new Set(options.invitedRoleIds || [])].filter(id => guild.roles.cache.has(id)) : getInvestigationStaffRoleIds(guild);
  if (options.invitationSelection !== true) for (const id of roleIds) await channel.permissionOverwrites.edit(id, investigationStaffOverwrite(), { reason: 'Authorised management investigation access' });
  const requestedUsers = options.invitationSelection === true ? [leadId, ...(options.invitedUserIds || [])] : [guild.ownerId, leadId];
  const state = getQuarantineState(guild.id);
  const users = [...new Set(requestedUsers.filter(id => /^\d{15,25}$/.test(String(id || '')) && id !== memberId && !state.users?.[id]))];
  const bot = guild.members.me || await guild.members.fetchMe();
  const pingRoles = roleIds.filter(id => guild.roles.cache.get(id)?.mentionable || (channel.permissionsFor?.(bot) || bot.permissions).has(PermissionFlagsBits.MentionEveryone));
  await channel.send({
    content: options.invitationSelection === true
      ? `🔔 **Investigation room invitation**\n${[...roleIds.map(id => `<@&${id}>`), ...users.map(id => `<@${id}>`)].join(' ')}\nPlease join the investigation room for <@${memberId}>.${pingRoles.length < roleIds.length ? '\nSome selected roles cannot be pinged with my current permissions.' : ''}`
      : `🔔 **Management review requested**\n${[...roleIds.map(id => `<@&${id}>`), ...users.map(id => `<@${id}>`)].join(' ')}\nPlease join this room to review the investigation for <@${memberId}>.${pingRoles.length < roleIds.length ? '\nSome management roles cannot be pinged with my current Discord permissions.' : ''}`,
    allowedMentions: { parse: [], roles: pingRoles, users },
  });
  return { roleIds, pingedRoleIds: pingRoles, userIds: users };
}

async function createInvestigationRoom(guild, member, quarantineRole, options = {}) {
  const category = await ensureInvestigationCategory(guild, options);
  const subjectName = cleanChannelName(member.displayName || member.user?.globalName || member.user?.username || 'member');
  const overwrites = await buildInvestigationRoomOverwrites(guild, member, quarantineRole, options);
  const channel = await guild.channels.create({
    name: subjectName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Private investigation • Member ${member.id} • ${String(options.reason || 'No reason provided').slice(0, 700)}`,
    permissionOverwrites: overwrites,
    reason: `Goliath investigation isolation for ${member.user?.tag || member.id}`,
  });
  channel.__protectedInvestigationMembers = overwrites.filter(entry => entry.id !== guild.id && entry.id !== quarantineRole.id && entry.deny?.includes(PermissionFlagsBits.ViewChannel)).map(entry => entry.id);
  await channel.send({ ...buildInvestigationRoomPanel(member, channel.id, options), allowedMentions: { parse: [], users: [member.id] } })
    .catch((error) => console.warn(`[QuarantineSystem] Failed to send investigation room intro in ${guild.id}:`, error.message));
  await notifyInvestigationManagement(channel, member.id, options.quarantinedBy, options).catch(error => console.warn(`[QuarantineSystem] Management notification failed in ${guild.id}:`, error.message));
  return channel;
}

function buildInvestigationRoomPanel(member, channelId, options = {}) {
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
  return { content: `<@${member.id}>`, embeds: [intro], components: [controls, investigationRoomControls(member.id, channelId)], allowedMentions: { parse: [] } };
}

async function privateInvestigationNavigation(interaction) {
  if (!/^(mod_dashboard:|mod_refresh:|mod_history_back$|mod:close$)/.test(String(interaction.customId || ''))) return interaction;
  const message = interaction.message;
  if (!message || message.flags?.has?.(MessageFlags.Ephemeral) || !interaction.guild
    || message.author?.id !== interaction.guild.client?.user?.id) return interaction;
  const state = getQuarantineState(interaction.guild.id);
  const isRoom = Object.values(state.users || {}).some(snapshot => snapshot.interviewChannelId === interaction.channelId)
    || (state.archivedRooms || []).some(room => room.channelId === interaction.channelId);
  if (!isRoom) return interaction;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const privateMessage = await interaction.fetchReply();
  // All existing workspace routes keep working, but can edit/delete only the
  // moderator's private response. The shared room panel is never their source.
  return new Proxy(interaction, { get(target, key) {
    if (key === 'message') return privateMessage;
    if (key === 'update' || key === 'reply') return payload => target.editReply(payload);
    if (key === 'deferUpdate') return async () => {};
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

const presentationChecks = new Set();
async function refreshInvestigationPresentation(guild, channel, memberId) {
  const state = getQuarantineState(guild.id);
  // Only migrate this member's known generated legacy name. Keep custom names intact.
  const suffix = `-${String(memberId).slice(-4)}`;
  if (state.users?.[memberId]?.interviewChannelId === channel.id
    && /^investigation-[a-z0-9-]+$/.test(channel.name || '') && channel.name.endsWith(suffix)) {
    const name = channel.name.slice('investigation-'.length, -suffix.length);
    if (name) await channel.setName(cleanChannelName(name), 'Simplify investigation room name');
  }
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
  const ownsPanel = message => message?.author?.id === guild.client.user.id
    && message.embeds?.[0]?.title === '🔎 Private Investigation Room'
    && message.components?.some(row => row.components.some(component => component.customId === `mod_invroom_transcript:${memberId}:${channel.id}`));
  let panel = null;
  const snapshot = state.users?.[memberId];
  if (snapshot?.controlMessageId) {
    try { const candidate = await channel.messages.fetch(snapshot.controlMessageId); if (ownsPanel(candidate)) panel = candidate; }
    catch (error) { if (Number(error?.code) !== 10008) throw error; }
  }
  if (!panel) {
    let before;
    for (let page = 0; page < 50; page += 1) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      panel = messages.find(ownsPanel);
      if (panel || messages.size < 100) break;
      if (page === 49) throw new Error('Room history is too large to safely confirm whether its controls are missing.');
      before = messages.last().id;
    }
  }
  if (!panel && snapshot?.interviewChannelId === channel.id) {
    // Recovery changes only the missing message, never the case/room/roles.
    const member = await guild.members.fetch({ user: memberId, force: true });
    const latest = getQuarantineState(guild.id).users?.[memberId];
    if (latest?.interviewChannelId !== channel.id) return;
    panel = await channel.send(buildInvestigationRoomPanel(member, channel.id, latest));
  }
  if (panel?.id) {
    const latest = getQuarantineState(guild.id);
    if (latest.users?.[memberId]?.interviewChannelId === channel.id && latest.users[memberId].controlMessageId !== panel.id) {
      latest.users[memberId].controlMessageId = panel.id;
      saveQuarantineState(guild, latest);
    }
  }
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
    const locks = [];
    const lifecycle = snapshot.invitationSelection ? require('./releaseLifecycle') : null;
    try {
      if (snapshot.invitationSelection) {
        const others = snapshot.invitedRoleIds?.length ? getOtherIsolatedMemberIds(guild.id, member.id) : [];
        const ids = [...new Set([...(snapshot.invitedUserIds || []), ...others])].filter(id => id !== member.id);
        for (const id of ids) {
          if (!lifecycle.tryBeginQuarantineOperation(guild.id, id)) throw new Error('A selected member or investigation is being updated; room recovery will retry.');
          locks.push(id);
        }
      }
      channel = await createInvestigationRoom(guild, member, role, { ...options, reason: snapshot?.reason || options.reason, invitationSelection: snapshot.invitationSelection === true, invitedUserIds: snapshot.invitedUserIds || [], invitedRoleIds: snapshot.invitedRoleIds || [], protectedCaseIds: locks });
      const state = getQuarantineState(guild.id);
      if (state.users?.[member.id]) {
        state.users[member.id].interviewChannelId = channel.id;
        state.users[member.id].protectedInvitationMembers = channel.__protectedInvestigationMembers || [];
        saveQuarantineState(guild, state);
      }
    } finally { for (const id of locks) lifecycle.endQuarantineOperation(guild.id, id); }
  } else {
    await channel.permissionOverwrites.edit(role.id, quarantineDenyOverwrite(), { reason: 'Reasserting investigation quarantine role isolation' });
    await channel.permissionOverwrites.edit(member.id, investigationMemberOverwrite(), { reason: 'Restoring investigation interview access' });
    await refreshInvestigationPresentation(guild, channel, member.id).catch(error => console.warn('[QuarantineSystem] Room presentation refresh failed:', error.message));
  }
  return channel;
}

module.exports = {
  cleanCategoryName,
  matchInvestigationCategoryStyle,
  refreshInvestigationPresentation,
  privateInvestigationNavigation,
  buildInvestigationRoomPanel,
  cleanChannelName,
  getInvestigationStaffRoleIds,
  ensureInvestigationCategory,
  buildInvestigationRoomOverwrites,
  getOtherIsolatedMemberIds,
  createInvestigationRoom,
  investigationRoomControls,
  notifyInvestigationManagement,
  ensureInvestigationRoomForSnapshot,
};
