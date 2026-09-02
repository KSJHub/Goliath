'use strict';

const tails = new Map();

function lockKey(guildId) {
  return String(guildId || 'global');
}

async function withAutoRolesLock(guildId, task) {
  if (typeof task !== 'function') throw new TypeError('Auto Roles lock task must be a function.');
  const key = lockKey(guildId);
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  tails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

function pendingLockCount() {
  return tails.size;
}

module.exports = {
  pendingLockCount,
  withAutoRolesLock,
};
