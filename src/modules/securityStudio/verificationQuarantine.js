'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const verificationStore = require('./verificationStore');

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

function caseSummary(member, reason, session, history) {
  const failures = history.filter(entry => entry?.type === 'security_failed');
  const flags = Array.isArray(session?.flags) ? session.flags : [];
  const lines = [
    '## 🚨 Verification Quarantine',
    `**Member:** <@${member.id}> (\`${member.id}\`)`,
    `**Reason:** ${String(reason || 'Verification security policy').slice(0, 800)}`,
    `**Failed attempts:** ${Number(session?.failedAttempts || failures.length || 0)}`,
    `**Completed security:** ${(session?.completedSecurity || []).join(', ') || 'None'}`,
    `**Flags:** ${flags.length ? flags.map(flag => typeof flag === 'string' ? flag : flag?.reason || flag?.type || 'flag').join(', ') : 'None recorded'}`,
  ];

  if (failures.length) {
    lines.push('', '**Recent failures:**');
    for (const failure of failures.slice(-5)) lines.push(`- ${failure.step || 'security'} — ${String(failure.reason || 'Failed').slice(0, 300)}`);
  }

  lines.push('', 'Use the Goliath Mod Hub to review or escalate this member.');
  return lines.join('\n').slice(0, 1900);
}

async function ensureQuarantineCase(guild, member, reason = 'Verification security policy') {
  if (!guild || !member) return { ok: false, message: 'Quarantine member is unavailable.' };
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = verificationStore.normalizeSettings(section?.settings || {});
  if (settings.quarantine?.enabled === false) return { ok: true, skipped: true };

  const session = verificationStore.getSession(guild.id, member.id) || {};
  if (session.quarantineChannelId) {
    const existing = guild.channels.cache.get(session.quarantineChannelId) || await guild.channels.fetch(session.quarantineChannelId).catch(() => null);
    if (existing) return { ok: true, channel: existing, existing: true };
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

  const channel = await guild.channels.create({
    name: safeChannelName(member),
    type: ChannelType.GuildText,
    parent: parentId || undefined,
    permissionOverwrites: overwrites,
    reason: `Goliath Verification quarantine for ${member.user?.tag || member.id}`,
  });

  verificationStore.upsertSession(guild.id, member.id, { quarantineChannelId: channel.id, quarantineCaseCreatedAt: new Date().toISOString() });
  verificationStore.addSecurityHistory(guild.id, member.id, { type: 'quarantine_case_created', channelId: channel.id, reason });
  const refreshed = verificationStore.getSession(guild.id, member.id) || session;
  const history = verificationStore.getSecurityHistory?.(guild.id, member.id) || section?.securityHistory?.[member.id] || [];
  const staffPing = staffRoleIds.map(id => `<@&${id}>`).join(' ');
  await channel.send({ content: `${staffPing}${staffPing ? '\n' : ''}${caseSummary(member, reason, refreshed, history)}`, allowedMentions: { roles: staffRoleIds, users: [member.id] } }).catch(() => null);
  return { ok: true, channel, created: true };
}

async function closeQuarantineCase(guild, userId, reason = 'Verification quarantine resolved') {
  const session = verificationStore.getSession(guild.id, userId) || {};
  if (!session.quarantineChannelId) return { ok: true, skipped: true };
  const channel = guild.channels.cache.get(session.quarantineChannelId) || await guild.channels.fetch(session.quarantineChannelId).catch(() => null);
  if (channel) await channel.delete(reason).catch(() => null);
  verificationStore.upsertSession(guild.id, userId, { quarantineChannelId: null, quarantineCaseClosedAt: new Date().toISOString() });
  verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_case_closed', reason });
  return { ok: true };
}

async function resolveQuarantineCase(guild, userId, action, actorId, reason = '') {
  const allowed = new Set(['release', 'reject', 'escalate']);
  const resolution = String(action || '').toLowerCase();
  if (!guild || !userId || !allowed.has(resolution)) return { ok: false, message: 'Invalid quarantine resolution.' };
  const section = verificationStore.getVerificationSection(guild.id);
  const settings = verificationStore.normalizeSettings(section?.settings || {});
  const member = await guild.members.fetch(userId).catch(() => null);
  const session = verificationStore.getSession(guild.id, userId) || {};
  const quarantineIds = cleanIds(settings.roles?.quarantine);
  const pendingIds = cleanIds(settings.roles?.pending);

  if (resolution === 'escalate') {
    verificationStore.upsertSession(guild.id, userId, { state: 'review', quarantineEscalatedAt: new Date().toISOString(), quarantineEscalatedBy: actorId || null });
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_escalated', actorId: actorId || null, reason: reason || 'Escalated to Mod Hub' });
    return { ok: true, escalated: true, member, message: 'Quarantine case escalated for moderator review.' };
  }

  if (member) {
    for (const roleId of quarantineIds) if (member.roles.cache.has(roleId)) await member.roles.remove(roleId, `Goliath Verification quarantine ${resolution}`).catch(() => null);
  }

  if (resolution === 'release') {
    if (member) for (const roleId of pendingIds) if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, 'Goliath Verification quarantine released').catch(() => null);
    verificationStore.clearAttempts(guild.id, userId);
    verificationStore.upsertSession(guild.id, userId, {
      state: 'pending',
      failedAttempts: 0,
      activeChallenge: null,
      activeSecurityMethod: null,
      completedSecurity: [],
      quarantineReleasedAt: new Date().toISOString(),
      quarantineReleasedBy: actorId || null,
    });
    verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_released', actorId: actorId || null, reason: reason || 'Released by staff' });
    await closeQuarantineCase(guild, userId, 'Verification quarantine released');
    return { ok: true, released: true, member, message: 'Member released from quarantine and returned to Pending Verification.' };
  }

  verificationStore.upsertSession(guild.id, userId, {
    state: 'rejected',
    activeChallenge: null,
    activeSecurityMethod: null,
    quarantineRejectedAt: new Date().toISOString(),
    quarantineRejectedBy: actorId || null,
  });
  verificationStore.addSecurityHistory(guild.id, userId, { type: 'quarantine_rejected', actorId: actorId || null, reason: reason || 'Rejected by staff' });
  await closeQuarantineCase(guild, userId, 'Verification quarantine rejected');
  return { ok: true, rejected: true, member, message: 'Member rejected from Verification quarantine.' };
}

module.exports = { ensureQuarantineCase, closeQuarantineCase, resolveQuarantineCase };
