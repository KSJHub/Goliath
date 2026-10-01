'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const HIGH_IMPACT = [
  ['Administrator', PermissionFlagsBits.Administrator],
  ['ManageGuild', PermissionFlagsBits.ManageGuild],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ManageWebhooks', PermissionFlagsBits.ManageWebhooks],
  ['BanMembers', PermissionFlagsBits.BanMembers],
  ['KickMembers', PermissionFlagsBits.KickMembers],
  ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
  ['MentionEveryone', PermissionFlagsBits.MentionEveryone],
];

function finding(severity, code, title, detail, targetKind, targetId) {
  return { severity, code, title, detail, targetKind, targetId };
}

function sameOverwrite(a, b) {
  if (!a || !b) return false;
  return a.allow.bitfield === b.allow.bitfield && a.deny.bitfield === b.deny.bitfield && a.type === b.type;
}

function scanGuild(guild) {
  const roles = [...guild.roles.cache.values()];
  const channels = [...guild.channels.cache.values()];
  const findings = [];
  let memberOverrides = 0;
  let roleOverrides = 0;
  let unsynced = 0;

  for (const role of roles) {
    if (role.id === guild.id || role.managed) continue;
    const dangerous = HIGH_IMPACT.filter(([, bit]) => role.permissions.has(bit)).map(([name]) => name);
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      findings.push(finding('critical', 'administrator-role', `${role.name} has Administrator`, 'Administrator bypasses channel permission overwrites and grants full server access.', 'role', role.id));
    } else if (role.permissions.has(PermissionFlagsBits.ManageRoles)) {
      findings.push(finding('high', 'manage-roles', `${role.name} can Manage Roles`, 'This role can change roles beneath it and may be able to expand access.', 'role', role.id));
    } else if (role.permissions.has(PermissionFlagsBits.ManageGuild)) {
      findings.push(finding('high', 'manage-guild', `${role.name} can Manage Server`, 'This is a high-impact guild permission and should be intentional.', 'role', role.id));
    }
    if (dangerous.length >= 4 && !role.permissions.has(PermissionFlagsBits.Administrator)) {
      findings.push(finding('high', 'dangerous-combination', `${role.name} has ${dangerous.length} high-impact permissions`, dangerous.join(', '), 'role', role.id));
    }
  }

  const everyone = guild.roles.everyone;
  const everyoneDangerous = HIGH_IMPACT.filter(([, bit]) => everyone.permissions.has(bit)).map(([name]) => name);
  if (everyoneDangerous.length) findings.push(finding('critical', 'everyone-high-impact', '@everyone has high-impact permissions', everyoneDangerous.join(', '), 'role', everyone.id));

  for (const channel of channels) {
    if (channel.type === ChannelType.GuildCategory) continue;
    if (channel.parent && !channel.permissionsLocked) {
      unsynced++;
      const parentMap = channel.parent.permissionOverwrites.cache;
      const childMap = channel.permissionOverwrites.cache;
      const ids = new Set([...parentMap.keys(), ...childMap.keys()]);
      const differences = [...ids].filter(id => !sameOverwrite(parentMap.get(id), childMap.get(id)));
      findings.push(finding('medium', 'broken-inheritance', `${channel.name} differs from ${channel.parent.name}`, `${differences.length} overwrite target(s) differ from the category.`, 'channel', channel.id));
    }

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type === 1) {
        memberOverrides++;
        const member = guild.members.cache.get(overwrite.id);
        findings.push(finding('medium', 'member-override', `${channel.name} has a member-specific override`, member ? `Override for ${member.displayName}.` : `Override for member ${overwrite.id}.`, 'channel', channel.id));
      } else roleOverrides++;

      const both = overwrite.allow.bitfield & overwrite.deny.bitfield;
      if (both !== 0n) findings.push(finding('high', 'conflicting-overwrite', `${channel.name} has a conflicting overwrite`, `Target ${overwrite.id} contains permission bits in both Allow and Deny.`, 'channel', channel.id));
    }

    const everyoneEffective = channel.permissionsFor(everyone);
    if (!everyoneEffective?.has(PermissionFlagsBits.ViewChannel)) {
      const visibleRoles = roles.filter(r => r.id !== guild.id && !r.managed && channel.permissionsFor(r)?.has(PermissionFlagsBits.ViewChannel));
      if (!visibleRoles.length) findings.push(finding('high', 'inaccessible-channel', `${channel.name} may be inaccessible`, 'No non-managed server role currently resolves View Channel for this channel.', 'channel', channel.id));
    }
  }

  const count = bit => roles.filter(r => r.permissions.has(bit)).length;
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.title.localeCompare(b.title));
  const severityCounts = findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; }, { critical: 0, high: 0, medium: 0, low: 0 });

  return {
    roles: roles.length,
    categories: channels.filter(c => c.type === ChannelType.GuildCategory).length,
    channels: channels.filter(c => c.type !== ChannelType.GuildCategory).length,
    administrator: count(PermissionFlagsBits.Administrator),
    manageGuild: count(PermissionFlagsBits.ManageGuild),
    manageRoles: count(PermissionFlagsBits.ManageRoles),
    manageChannels: count(PermissionFlagsBits.ManageChannels),
    unsynced,
    memberOverrides,
    roleOverrides,
    findings,
    severityCounts,
    critical: severityCounts.critical > 0,
  };
}

module.exports = { scanGuild };
