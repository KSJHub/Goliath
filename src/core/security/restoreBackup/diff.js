const { PermissionFlagsBits, ChannelType } = require('discord.js');

const DANGEROUS_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageWebhooks',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function toMap(array, keyFn) {
  const map = new Map();

  for (const item of safeArray(array)) {
    map.set(keyFn(item), item);
  }

  return map;
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function roleKey(role) {
  return normalizeName(role?.name);
}

function channelKey(channel) {
  return `${channel?.type}:${normalizeName(channel?.name)}`;
}

function getDangerousPermissions(bitfield) {
  const found = [];

  try {
    const perms = BigInt(bitfield || 0);

    for (const permissionName of DANGEROUS_PERMISSIONS) {
      const flag = PermissionFlagsBits[permissionName];

      if (flag && (perms & flag) === flag) {
        found.push(permissionName);
      }
    }
  } catch {
    return [];
  }

  return found;
}

function compareRoles(currentRoles, backupRoles) {
  const currentMap = toMap(currentRoles, roleKey);
  const backupMap = toMap(backupRoles, roleKey);

  const added = [];
  const removed = [];
  const changed = [];
  const dangerous = [];

  for (const [key, backupRole] of backupMap) {
    if (!currentMap.has(key)) {
      added.push(backupRole);

      const dangerousPermissions = getDangerousPermissions(
        backupRole.permissions
      );

      if (dangerousPermissions.length) {
        dangerous.push({
          type: 'added_role',
          role: backupRole.name,
          permissions: dangerousPermissions,
        });
      }

      continue;
    }

    const currentRole = currentMap.get(key);

    if (
      String(currentRole.permissions) !==
        String(backupRole.permissions) ||
      currentRole.color !== backupRole.color ||
      currentRole.hoist !== backupRole.hoist ||
      currentRole.mentionable !== backupRole.mentionable
    ) {
      changed.push({
        before: currentRole,
        after: backupRole,
      });

      const dangerousPermissions = getDangerousPermissions(
        backupRole.permissions
      );

      if (dangerousPermissions.length) {
        dangerous.push({
          type: 'changed_role',
          role: backupRole.name,
          permissions: dangerousPermissions,
        });
      }
    }
  }

  for (const [key, currentRole] of currentMap) {
    if (!backupMap.has(key)) {
      removed.push(currentRole);
    }
  }

  return {
    added,
    removed,
    changed,
    dangerous,
  };
}

function compareChannels(currentChannels, backupChannels) {
  const currentMap = toMap(currentChannels, channelKey);
  const backupMap = toMap(backupChannels, channelKey);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, backupChannel] of backupMap) {
    if (!currentMap.has(key)) {
      added.push(backupChannel);
      continue;
    }

    const currentChannel = currentMap.get(key);

    const currentOverwriteCount =
      safeArray(currentChannel.permissionOverwrites).length;

    const backupOverwriteCount =
      safeArray(backupChannel.permissionOverwrites).length;

    if (
      currentChannel.parentId !== backupChannel.parentId ||
      currentChannel.topic !== backupChannel.topic ||
      currentChannel.nsfw !== backupChannel.nsfw ||
      currentOverwriteCount !== backupOverwriteCount
    ) {
      changed.push({
        before: currentChannel,
        after: backupChannel,
      });
    }
  }

  for (const [key, currentChannel] of currentMap) {
    if (!backupMap.has(key)) {
      removed.push(currentChannel);
    }
  }

  return {
    added,
    removed,
    changed,
  };
}

function calculateRiskScore(diff) {
  let score = 0;

  score += diff.roles.added.length * 1;
  score += diff.roles.changed.length * 2;
  score += diff.roles.removed.length * 4;

  score += diff.channels.added.length * 1;
  score += diff.channels.changed.length * 2;
  score += diff.channels.removed.length * 5;

  score += diff.roles.dangerous.length * 10;

  return score;
}

function calculateRiskLevel(score) {
  if (score >= 60) return 'CRITICAL';
  if (score >= 35) return 'HIGH';
  if (score >= 15) return 'MEDIUM';
  return 'LOW';
}

function createApprovalRecommendation(diff, riskLevel) {
  if (riskLevel === 'CRITICAL') {
    return 'Manual owner approval strongly recommended.';
  }

  if (riskLevel === 'HIGH') {
    return 'Staff review required before restore.';
  }

  if (diff.roles.dangerous.length > 0) {
    return 'Dangerous permissions detected in restore.';
  }

  return 'Restore appears safe.';
}

function buildRestoreDiff(currentData, backupData) {
  const currentRoles = safeArray(currentData?.roles);
  const backupRoles = safeArray(backupData?.roles);

  const currentChannels = safeArray(currentData?.channels);
  const backupChannels = safeArray(backupData?.channels);

  const roleDiff = compareRoles(currentRoles, backupRoles);
  const channelDiff = compareChannels(
    currentChannels,
    backupChannels
  );

  const diff = {
    generatedAt: new Date().toISOString(),

    roles: roleDiff,
    channels: channelDiff,
  };

  diff.summary = {
    rolesAdded: roleDiff.added.length,
    rolesRemoved: roleDiff.removed.length,
    rolesChanged: roleDiff.changed.length,

    channelsAdded: channelDiff.added.length,
    channelsRemoved: channelDiff.removed.length,
    channelsChanged: channelDiff.changed.length,

    dangerousChanges: roleDiff.dangerous.length,
  };

  diff.riskScore = calculateRiskScore(diff);
  diff.riskLevel = calculateRiskLevel(diff.riskScore);

  diff.approvalRecommendation =
    createApprovalRecommendation(diff, diff.riskLevel);

  diff.blockers = [];

  if (diff.summary.rolesRemoved >= 10) {
    diff.blockers.push(
      'Large role removal detected.'
    );
  }

  if (diff.summary.channelsRemoved >= 10) {
    diff.blockers.push(
      'Large channel removal detected.'
    );
  }

  if (diff.riskLevel === 'CRITICAL') {
    diff.blockers.push(
      'Restore risk level is CRITICAL.'
    );
  }

  diff.safe = diff.blockers.length === 0;

  return diff;
}

function createRestoreDiffText(diff) {
  const lines = [];

  lines.push('=== RESTORE DIFF REPORT ===');
  lines.push('');

  lines.push(`Risk Level: ${diff.riskLevel}`);
  lines.push(`Risk Score: ${diff.riskScore}`);
  lines.push('');

  lines.push('--- ROLES ---');
  lines.push(`Added: ${diff.summary.rolesAdded}`);
  lines.push(`Removed: ${diff.summary.rolesRemoved}`);
  lines.push(`Changed: ${diff.summary.rolesChanged}`);
  lines.push('');

  lines.push('--- CHANNELS ---');
  lines.push(`Added: ${diff.summary.channelsAdded}`);
  lines.push(`Removed: ${diff.summary.channelsRemoved}`);
  lines.push(`Changed: ${diff.summary.channelsChanged}`);
  lines.push('');

  lines.push('--- SECURITY ---');
  lines.push(
    `Dangerous Changes: ${diff.summary.dangerousChanges}`
  );

  if (diff.roles.dangerous.length) {
    lines.push('');

    for (const item of diff.roles.dangerous) {
      lines.push(
        `• ${item.role} → ${item.permissions.join(', ')}`
      );
    }
  }

  if (diff.blockers.length) {
    lines.push('');
    lines.push('--- BLOCKERS ---');

    for (const blocker of diff.blockers) {
      lines.push(`• ${blocker}`);
    }
  }

  lines.push('');
  lines.push(
    `Recommendation: ${diff.approvalRecommendation}`
  );

  return lines.join('\n');
}

module.exports = {
  buildRestoreDiff,
  createRestoreDiffText,
};
