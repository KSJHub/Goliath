'use strict';

const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const verificationStore = require('./verificationStore');
const guildManager = require('../../core/guild/guildManager');
const {
  QUARANTINE_MODES,
  quarantineMember,
  getQuarantineState,
  getQuarantineMode,
} = require('../../core/security/protection/quarantine');

const cleanIds = value => [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean))];

function safeChannelName(member) {
  const base = String(member?.user?.username || member?.displayName || member?.id || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'member';
  return `verification-${base}`.slice(0, 90);
}

function caseSummary(member) {
  return [
    '## 🛡️ Goliath · Security Review',
    '⏳ **Verification on hold**',
    '',
    `Hello <@${member.id}>, your server access is temporarily restricted because Verification could not be completed.`,
    'This does not necessarily mean you have broken any server rules.',
    '',
    '**What happens next?**',
    'Management can review your case and allow you to retry Verification.',
    'You may send a message here to explain the situation or ask for help.',
    '',
    '🔒 This channel is intended for you and authorised management.',
    'Use **Request Review** once to notify staff, or **View Status** to check your current state.'
  ].join('\\n');
}
function memberCaseButtons(userId) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`verify:quarantine:request:${userId}`).setLabel('Request Review').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`verify:quarantine:status:${userId}`).setLabel('View Status').setStyle(ButtonStyle.Secondary)
  )];
}

async function ensureQuarantineCase(guild, member, reason = 'Verification security policy') {
  if (!guild || !member) return { ok: false, message: 'Quarantine member is unavailable.' };
  if (!guildManager.isModuleEnabled(guild.id, 'verification')) return { ok: false, disabled: true, message: 'Verification is disabled.' };
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = verificationStore.normalizeSettings(section?.settings || {});
  if (settings.quarantine?.enabled === false) return { ok: true, skipped: true };
  const session = verificationStore.getSession(guild.id, member.id) || {};
  const sharedRoomId = getQuarantineState(guild.id)?.users?.[member.id]?.interviewChannelId;
  if (sharedRoomId) {
    const room = await guild.channels.fetch(String(sharedRoomId)).catch(() => null);
    if (!room) return { ok: false, message: 'Shared investigation room is unavailable; Mod Hub recovery required.' };
    verificationStore.upsertSession(guild.id, member.id, { quarantineChannelId: room.id });
    return { ok: true, channel: room, existing: true, shared: true };
  }
  if (session.quarantineChannelId) {
    const existing = guild.channels.cache.get(session.quarantineChannelId) || await guild.channels.fetch(session.quarantineChannelId).catch(() => null);
    if (existing) {
      const permissions = existing.permissionsFor?.(member);
      if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
        try {
          await existing.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Restore Verification case interview access' });
        } catch (error) {
          verificationStore.addSecurityHistory(guild.id, member.id, { type: 'quarantine_case_access_repair_failed', channelId: existing.id, reason: String(error?.message || error).slice(0, 300) });
          return { ok: false, channel: existing, message: 'Existing Verification case access could not be restored.' };
        }
      }
      return { ok: true, channel: existing, existing: true };
    }
  }
  const parentId = settings.quarantine?.categoryId || null;
  if (parentId) {
    const parent = guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) return { ok: false, message: 'Configured Verification quarantine category is unavailable.' };
  }
  const staffRoleIds = cleanIds(settings.quarantine?.staffRoleIds?.length ? settings.quarantine.staffRoleIds : settings.roles?.staff);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  const botId = guild.client?.user?.id;
  if (botId) overwrites.push({ id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] });
  for (const roleId of staffRoleIds) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (role) overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }
  const channel = await guild.channels.create({ name: safeChannelName(member), type: ChannelType.GuildText, parent: parentId || undefined, permissionOverwrites: overwrites, reason: `Goliath Verification quarantine for ${member.user?.tag || member.id}` });
  verificationStore.upsertSession(guild.id, member.id, { quarantineChannelId: channel.id, quarantineCaseCreatedAt: new Date().toISOString() });
  verificationStore.addSecurityHistory(guild.id, member.id, { type: 'quarantine_case_created', channelId: channel.id, reason });
  const refreshed = verificationStore.getSession(guild.id, member.id) || session;
  
  
  try {
    await channel.send({ content: caseSummary(member), allowedMentions: { roles: staffRoleIds, users: [member.id], parse: [] } });
  } catch (error) {
    verificationStore.addSecurityHistory(guild.id, member.id, { type: 'quarantine_case_notification_failed', channelId: channel.id, reason: String(error?.message || error).slice(0, 300) });
    return { ok: false, channel, created: true, message: 'Private quarantine case created, but staff notification failed.' };
  }
  return { ok: true, channel, created: true };
}

async function closeQuarantineCase(guild, userId, reason = 'Verification quarantine resolved') {
  const session = verificationStore.getSession(guild.id, userId) || {};
  if (!session.quarantineChannelId) return { ok: true, skipped: true };
  const isolation = getQuarantineState(guild.id)?.users?.[String(userId)];
  if (isolation?.interviewChannelId === session.quarantineChannelId) {
    return { ok: false, message: 'Active shared investigation room requires Mod Hub resolution.' };
  }
  let channel = guild.channels.cache.get(session.quarantineChannelId);
  if (!channel) {
    try { channel = await guild.channels.fetch(session.quarantineChannelId); }
    catch (error) {
      if (Number(error?.code) !== 10003) {
        verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_case_close_failed', channelId: session.quarantineChannelId, reason: String(error?.message || error).slice(0, 300) });
        return { ok: false, channelId: session.quarantineChannelId, message: 'Could not confirm whether the quarantine case channel still exists.' };
      }
    }
  }
  if (channel) {
    try { await channel.delete(reason); }
    catch (error) { verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_case_close_failed', channelId: channel.id, reason: String(error?.message || error).slice(0, 300) }); return { ok: false, message: 'Could not delete the quarantine case channel.', channelId: channel.id }; }
  }
  verificationStore.upsertSession(guild.id, userId, { quarantineChannelId: null, quarantineCaseClosedAt: new Date().toISOString() });
  verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_case_closed', reason });
  return { ok: true };
}

function activeModerationIsolation(guildId, userId) {
  const snapshot = getQuarantineState(guildId)?.users?.[String(userId)] || null;
  if (!snapshot) return null;
  return { snapshot, mode: getQuarantineMode(snapshot) };
}

async function escalateToModHub(guild, member, actorId, reason) {
  const existing = activeModerationIsolation(guild.id, member.id);
  if (existing) return { success: true, existing: true, mode: existing.mode, interviewChannelId: existing.snapshot?.interviewChannelId || null };
  return quarantineMember(guild, member, { reason: reason || 'Escalated from Verification quarantine', quarantinedBy: actorId || guild.client?.user?.id || null, source: 'verification', mode: QUARANTINE_MODES.INVESTIGATION });
}

async function restorePendingRoles(member, pendingIds, quarantineIds, reason) {
  const added = [];
  const removed = [];
  try {
    for (const roleId of pendingIds) {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, reason);
        added.push(roleId);
      }
    }
    for (const roleId of quarantineIds) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, reason);
        removed.push(roleId);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const roleId of removed.reverse()) {
      try { await member.roles.add(roleId, 'Goliath Verification role rollback'); }
      catch (rollbackError) { rollbackErrors.push(String(rollbackError?.message || rollbackError)); }
    }
    for (const roleId of added.reverse()) {
      try { await member.roles.remove(roleId, 'Goliath Verification role rollback'); }
      catch (rollbackError) { rollbackErrors.push(String(rollbackError?.message || rollbackError)); }
    }
    if (rollbackErrors.length) {
      verificationStore.addSecurityHistory(member.guild.id, member.id, { type: 'quarantine_role_rollback_failed', failures: rollbackErrors.slice(0, 10) });
      throw new Error('Role transition failed and rollback was incomplete; staff intervention required.');
    }
    throw error;
  }
}

async function reconcileModerationRelease(guild, userId, actorId, reason = 'Mod Hub investigation cleared') {
  if (!guild || !userId) return { ok: false, message: 'Verification reconciliation target is unavailable.' };
  const session = verificationStore.getSession(guild.id, userId) || {};
  if (session.state !== 'review' && !(session.state === 'quarantined' && session.moderationIsolationMode)) return { ok: true, skipped: true };
  const member = await guild.members.fetch(userId).catch(() => null);
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = verificationStore.normalizeSettings(section?.settings || {});
  const pendingIds = cleanIds(settings.roles?.pending);
  const quarantineIds = cleanIds(settings.roles?.quarantine);
  if (!member) return { ok: false, message: 'Member is unavailable; Mod Hub release cannot restore Verification roles.' };
  if (!pendingIds.length) return { ok: false, message: 'Pending Verification roles must be configured before Mod Hub release.' };
  for (const roleId of pendingIds) {
    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) return { ok: false, message: 'A configured Pending Verification role no longer exists.' };
  }
  try {
    await restorePendingRoles(member, pendingIds, quarantineIds, 'Goliath Verification moderation review cleared');
  } catch (error) {
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'moderation_release_role_failed', actorId: actorId || null, reason: String(error?.message || error).slice(0, 300) });
    return { ok: false, message: 'Could not restore Pending roles or remove Quarantine roles after Mod Hub review.' };
  }
  verificationStore.clearAttempts(guild.id, userId);
  verificationStore.upsertSession(guild.id, userId, {
    state: 'pending',
    failedAttempts: 0,
    activeChallenge: null,
    activeSecurityMethod: null,
    completedSecurity: [],
    requiredSecurity: [],
    raidPressure: false,
    raidPressureAt: null,
    raidJoinCount: null,
    intelligenceElevationRecordedAt: null,
    intelligenceRequiredSecurity: [],
    moderationIsolationMode: null,
    moderationInterviewChannelId: null,
    moderationReviewClearedAt: new Date().toISOString(),
    moderationReviewClearedBy: actorId || null,
  });
  verificationStore.addSecurityHistory(guild.id, userId, { type: 'moderation_review_cleared', actorId: actorId || null, reason });
  return { ok: true, reconciled: true, member, message: 'Verification returned to Pending after Mod Hub review.' };
}

async function resolveQuarantineCase(guild, userId, action, actorId, reason = '') {
  const allowed = new Set(['release', 'reject', 'escalate']);
  const resolution = String(action || '').toLowerCase();
  if (!guild || !userId || !allowed.has(resolution)) return { ok: false, message: 'Invalid quarantine resolution.' };
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = verificationStore.normalizeSettings(section?.settings || {});
  const member = await guild.members.fetch(userId).catch(() => null);
  const session = verificationStore.getSession(guild.id, userId) || {};
  if (session.state !== 'quarantined') return { ok: false, message: 'This member is not in active Verification quarantine. Mod Hub investigations must be resolved through Mod Hub.' };
  const quarantineIds = cleanIds(settings.roles?.quarantine);
  const pendingIds = cleanIds(settings.roles?.pending);
  if (resolution === 'escalate') {
    if (!member) return { ok: false, message: 'Member is no longer available for Mod Hub escalation.' };
    const escalationReason = reason || 'Escalated from Verification quarantine';
    const result = await escalateToModHub(guild, member, actorId, escalationReason).catch(error => ({ success: false, error: error?.message || 'Unknown escalation error' }));
    if (!result?.success) {
      verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_escalation_failed', actorId: actorId || null, reason: result?.error || result?.reason || 'Mod Hub escalation failed' });
      return { ok: false, message: `Unable to escalate this Verification case to Mod Hub: ${result?.error || result?.reason || 'Unknown error'}` };
    }
    verificationStore.upsertSession(guild.id, userId, { state: 'review', quarantineEscalatedAt: new Date().toISOString(), quarantineEscalatedBy: actorId || null, moderationIsolationMode: result.mode || QUARANTINE_MODES.INVESTIGATION, moderationInterviewChannelId: result.interviewChannelId || null });
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_escalated', actorId: actorId || null, reason: escalationReason, moderationIsolationMode: result.mode || QUARANTINE_MODES.INVESTIGATION, interviewChannelId: result.interviewChannelId || null, reusedExistingIsolation: result.existing === true });
    const sharedRoomId = activeModerationIsolation(guild.id, userId)?.snapshot?.interviewChannelId || null;
    const verificationRoomId = (verificationStore.getSession(guild.id, userId) || {}).quarantineChannelId || null;
    const closure = sharedRoomId && String(sharedRoomId) === String(verificationRoomId)
      ? { ok: true, retainedSharedRoom: true }
      : await closeQuarantineCase(guild, userId, 'Verification case escalated to Mod Hub').catch(error => ({ ok: false, message: error?.message || 'Case cleanup failed' }));
    if (!closure?.ok) {
      verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_escalation_cleanup_failed', actorId: actorId || null, reason: closure?.message || 'Case cleanup failed' });
      return { ok: true, escalated: true, cleanupPending: true, member, interviewChannelId: result.interviewChannelId || null, message: 'Mod Hub escalation succeeded, but the old Verification case channel requires manual cleanup.' };
    }
    return { ok: true, escalated: true, member, interviewChannelId: result.interviewChannelId || null, message: 'Verification quarantine escalated into the Mod Hub investigation workflow.' };
  }
  if (activeModerationIsolation(guild.id, userId)) return { ok: false, message: 'An active Mod Hub isolation must be resolved through Mod Hub before Verification can release or reject this member.' };
  if (!member) return { ok: false, message: 'Member is unavailable; quarantine roles cannot be reconciled.' };
  if (resolution === 'release') {
    if (!pendingIds.length) return { ok: false, message: 'A Pending role must be configured before releasing quarantine.' };
    const missing = [];
    for (const roleId of pendingIds) {
      const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
      if (!role) missing.push(roleId);
    }
    if (missing.length) return { ok: false, message: 'Configured Pending roles are missing; release was not applied.' };
    try {
      await restorePendingRoles(member, pendingIds, quarantineIds, 'Goliath Verification quarantine released');
    } catch (error) {
      verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_release_role_failed', actorId: actorId || null, reason: String(error?.message || error).slice(0, 300) });
      return { ok: false, message: 'Could not restore Pending roles and remove Quarantine roles; check permissions.' };
    }
    verificationStore.clearAttempts(guild.id, userId);
    verificationStore.upsertSession(guild.id, userId, { state: 'pending', failedAttempts: 0, activeChallenge: null, activeSecurityMethod: null, completedSecurity: [], requiredSecurity: [], raidPressure: false, raidPressureAt: null, raidJoinCount: null, intelligenceElevationRecordedAt: null, intelligenceRequiredSecurity: [], quarantineReleasedAt: new Date().toISOString(), quarantineReleasedBy: actorId || null });
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_released', actorId: actorId || null, reason: reason || 'Released by staff' });
    const closure = await closeQuarantineCase(guild, userId, 'Verification quarantine released').catch(error => ({ ok: false, message: String(error?.message || error) }));
    if (!closure?.ok) return { ok: true, released: true, cleanupPending: true, member, message: 'Member released to Pending Verification, but the quarantine case channel requires manual cleanup.' };
    return { ok: true, released: true, member, message: 'Member released from quarantine and returned to Pending Verification.' };
  }
  try {
    for (const roleId of quarantineIds) if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Goliath Verification quarantine rejected');
  } catch (error) {
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_rejection_role_failed', actorId: actorId || null, reason: String(error?.message || error).slice(0, 300) });
    return { ok: false, message: 'Could not remove Quarantine roles; check permissions.' };
  }
  verificationStore.upsertSession(guild.id, userId, { state: 'rejected', activeChallenge: null, activeSecurityMethod: null, quarantineRejectedAt: new Date().toISOString(), quarantineRejectedBy: actorId || null });
  verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_rejected', actorId: actorId || null, reason: reason || 'Rejected by staff' });
  const closure = await closeQuarantineCase(guild, userId, 'Verification quarantine rejected').catch(error => ({ ok: false, message: String(error?.message || error) }));
  if (!closure?.ok) return { ok: true, rejected: true, cleanupPending: true, member, message: 'Member rejected from Verification quarantine, but the quarantine case channel requires manual cleanup.' };
  return { ok: true, rejected: true, member, message: 'Member rejected from Verification quarantine.' };
}

module.exports = { ensureQuarantineCase, closeQuarantineCase, resolveQuarantineCase, escalateToModHub, reconcileModerationRelease };
