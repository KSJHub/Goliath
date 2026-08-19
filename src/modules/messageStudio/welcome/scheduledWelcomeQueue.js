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
  if (!guild || !roleId) return [];
  await refreshMembers(guild);
  const role = guild.roles?.cache?.get(roleId) || await guild.roles?.fetch?.(roleId).catch(() => null);
  if (!role) return [];
  return [...role.members.values()]
    .filter((member) => config.ignoreBots === false || !member.user?.bot)
    .sort((a, b) => Number(a.joinedTimestamp || 0) - Number(b.joinedTimestamp || 0));
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