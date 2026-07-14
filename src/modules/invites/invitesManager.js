const store = require('./invitesStore');

async function resolveChannel(guild, channelId) {
  const selected = channelId && guild.channels.cache.get(channelId);
  if (selected?.isTextBased() && selected.permissionsFor(guild.members.me)?.has('CreateInstantInvite')) return selected;
  return guild.channels.cache.find(channel => channel.isTextBased() && channel.permissionsFor(guild.members.me)?.has('CreateInstantInvite')) || null;
}

async function fetchManagedInvite(guild, code) {
  if (!code) return null;
  try {
    const invites = await guild.invites.fetch();
    return invites.get(code) || null;
  } catch {
    return null;
  }
}

async function create(guild, channelId) {
  const channel = await resolveChannel(guild, channelId);
  if (!channel) throw new Error('Goliath needs View Channel and Create Instant Invite in at least one text channel.');
  const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, temporary: false, unique: true, reason: 'Goliath managed permanent invite' });
  store.set(guild.id, { enabled: true, channelId: channel.id, inviteCode: invite.code, lastCheckedAt: new Date().toISOString() });
  return invite;
}

async function validate(guild) {
  const config = store.get(guild.id);
  if (!config.enabled) return { valid: false, reason: 'disabled' };
  const invite = await fetchManagedInvite(guild, config.inviteCode);
  if (invite) {
    store.set(guild.id, { lastCheckedAt: new Date().toISOString() });
    return { valid: true, invite };
  }
  if (!config.autoRepair) return { valid: false, reason: 'missing' };
  const repaired = await create(guild, config.channelId);
  return { valid: true, invite: repaired, repaired: true };
}

async function regenerate(guild) {
  const config = store.get(guild.id);
  const existing = await fetchManagedInvite(guild, config.inviteCode);
  if (existing) await existing.delete('Goliath invite regenerated').catch(() => null);
  return create(guild, config.channelId);
}

async function validateAll(client) {
  for (const guild of client.guilds.cache.values()) {
    await validate(guild).catch(() => null);
  }
}

module.exports = { create, validate, regenerate, validateAll, fetchManagedInvite };
