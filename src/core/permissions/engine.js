'use strict';

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

function namesFromBits(bits) {
  try { return new PermissionsBitField(BigInt(bits || 0)).toArray(); } catch { return []; }
}

function bitsFromNames(names) {
  let bits = 0n;
  for (const name of names || []) {
    const bit = PermissionFlagsBits[name];
    if (bit) bits |= BigInt(bit);
  }
  return bits;
}

function missingCapabilityNames(guild, bits) {
  return namesFromBits(bits).filter((name) => {
    const bit = PermissionFlagsBits[name];
    return bit && !guild?.members?.me?.permissions?.has(bit);
  });
}

function copyableBits(guild, bits) {
  let result = 0n;
  for (const name of namesFromBits(bits)) {
    const bit = PermissionFlagsBits[name];
    if (bit && guild?.members?.me?.permissions?.has(bit)) result |= BigInt(bit);
  }
  return result;
}

function applyBasePermissionDraft(currentBits, draft) {
  let bits = BigInt(currentBits || 0);
  for (const [name, value] of draft instanceof Map ? draft.entries() : Object.entries(draft || {})) {
    const bit = PermissionFlagsBits[name];
    if (!bit) continue;
    bits = value ? (bits | BigInt(bit)) : (bits & ~BigInt(bit));
  }
  return bits;
}

async function applyBasePermissionDraftToRole(role, draft, reason) {
  const next = applyBasePermissionDraft(role.permissions.bitfield, draft);
  await role.setPermissions(next, reason);
  return next;
}

async function mergeOverwrite(target, overwrite, reason) {
  await target.permissionOverwrites.edit(
    overwrite.id,
    { allow: BigInt(overwrite.allow || 0), deny: BigInt(overwrite.deny || 0) },
    { reason }
  );
}

async function replaceOverwrites(target, overwrites, reason) {
  await target.permissionOverwrites.set(
    overwrites.map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: BigInt(overwrite.allow || 0),
      deny: BigInt(overwrite.deny || 0),
    })),
    reason
  );
}

module.exports = {
  namesFromBits,
  bitsFromNames,
  missingCapabilityNames,
  copyableBits,
  applyBasePermissionDraft,
  applyBasePermissionDraftToRole,
  mergeOverwrite,
  replaceOverwrites,
};
