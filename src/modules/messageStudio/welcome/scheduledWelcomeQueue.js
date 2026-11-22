'use strict';

function cleanId(value) {
  const id = String(value || '').replace(/[<@&#!>]/g, '').trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

async function refreshMembers(guild) {
  if (!guild?.members?.fetch) return;
  try { await guild.members.fetch(); }
  catch (error) { console.warn('[ScheduledWelcome] Could not refresh member cache:', error.message || error); }
}

async function getQueuedMembers(guild, config = {}) {
  const roleId = cleanId(config.queueRoleId);
  if (!guild) return [];
  if (!roleId) {
    const entries = config.pendingMembers && typeof config.pendingMembers === 'object' ? config.pendingMembers : {};
    const members = [];
    for (const [memberId, entry] of Object.entries(entries)) {
      const id = cleanId(memberId);
      if (!id) continue;
      // Verify membership against Discord rather than trusting a possibly stale cache
      // after a restart or a missed leave event.
      const member = await guild.members.fetch({ user: id, force: true }).catch(error => {
        // Discord Unknown Member is a confirmed departure. All other lookup
        // failures leave queue eligibility unknown and must prevent completion.
        if (Number(error?.code) === 10007) return null;
        throw new Error(`Scheduled Welcome member lookup failed for ${id}: ${error?.message || error}`);
      });
      if (!member || (entry?.joinedAt && entry.joinedAt !== member.joinedAt?.toISOString?.())) continue;
      if (config.ignoreBots !== false && member.user?.bot) continue;
      members.push(member);
    }
    return members.sort((a, b) => Number(a.joinedTimestamp || 0) - Number(b.joinedTimestamp || 0));
  }
  const role = guild.roles?.cache?.get(roleId) || await guild.roles?.fetch?.(roleId).catch(() => null);
  if (!role) throw new Error('Selected Scheduled Welcome queue role no longer exists.');
  // Use the REST member list rather than relying on a gateway chunk or role cache.
  // Page through all members; a failed lookup must not masquerade as an empty queue.
  const members = [];
  let after;
  for (;;) {
    const page = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
    for (const member of page.values()) {
      if (!member.roles?.cache?.has(roleId)) continue;
      if (config.ignoreBots !== false && member.user?.bot) continue;
      members.push(member);
    }
    if (page.size < 1000) break;
    const next = page.reduce((max, member) => BigInt(member.id) > BigInt(max) ? member.id : max, '0');
    if (next === after) throw new Error('Scheduled Welcome member pagination did not advance.');
    after = next;
  }
  return members.sort((a, b) => Number(a.joinedTimestamp || 0) - Number(b.joinedTimestamp || 0));
}

async function removeQueueRole(member, roleId, reason = 'Scheduled welcome completed') {
  const id = cleanId(roleId);
  if (!member || !id || !member.roles?.cache?.has(id)) return { removed: false, skipped: true };
  try {
    await member.roles.remove(id, reason);
    return { removed: true, skipped: false };
  } catch (error) {
    return { removed: false, skipped: false, error: error.message || String(error) };
  }
}

module.exports = {
  cleanId,
  refreshMembers,
  getQueuedMembers,
  removeQueueRole,
};