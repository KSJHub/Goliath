'use strict';

// Thin bootstrap around the established Duplicator implementation.
// Selective copies must treat Goliath/Operations ACLs as environment-local
// control-plane state even when the source bot is not currently assigned that role.
const implementation = require('./index.base');
const core = require('./core');
const hardening = require('./hardening');

const CONTROL_PLANE_SNAPSHOT_KEY = Symbol.for('goliath.duplicator.snapshot-control-plane');

function isControlPlaneRole(role) {
  return Boolean(role) && /^(?:goliath|operations)$/i.test(String(role.name || '').trim());
}

if (!core[CONTROL_PLANE_SNAPSHOT_KEY]) {
  const originalSnapshot = core.snapshot.bind(core);
  Object.defineProperty(core, CONTROL_PLANE_SNAPSHOT_KEY, { value: true });
  core.snapshot = function goliathControlPlaneSafeSnapshot(guild, selectedOptions) {
    const snap = originalSnapshot(guild, selectedOptions);
    const controlIds = new Set([
      ...(snap.roles || []).filter(isControlPlaneRole).map((role) => String(role.id)),
      ...(snap.managedRoles || []).filter(isControlPlaneRole).map((role) => String(role.id)),
    ]);

    if (!controlIds.size) return snap;

    snap.roles = (snap.roles || []).filter((role) => !controlIds.has(String(role.id)));
    snap.managedRoles = (snap.managedRoles || []).filter((role) => !controlIds.has(String(role.id)));
    snap.channels = (snap.channels || []).map((channel) => ({
      ...channel,
      permissionOverwrites: (channel.permissionOverwrites || []).filter((overwrite) => !(Number(overwrite.type) === 0 && controlIds.has(String(overwrite.id)))),
    }));

    if (snap.stats) {
      snap.stats.roles = snap.roles.length;
      snap.stats.managedRoles = snap.managedRoles.length;
      snap.stats.permissionOverwrites = snap.channels.reduce((sum, channel) => sum + (channel.permissionOverwrites || []).length, 0);
    }
    return snap;
  };
}

hardening.install();

module.exports = implementation;
