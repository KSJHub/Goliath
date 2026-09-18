'use strict';

// Backward-compatible public entry point. Quarantine implementation is split
// into focused modules under ./quarantine so existing callers can continue to
// require this path while the subsystem remains maintainable.
const state = require('./quarantine/state');
const roleManager = require('./quarantine/roleManager');
const isolation = require('./quarantine/isolation');
const investigationRooms = require('./quarantine/investigationRooms');
const memberLifecycle = require('./quarantine/memberLifecycle');
const releaseLifecycle = require('./quarantine/releaseLifecycle');
const enforcementRecovery = require('./quarantine/enforcementRecovery');
const expiryScheduler = require('./quarantine/expiryScheduler');

module.exports = {
  ...state,
  ...roleManager,
  ...isolation,
  ...investigationRooms,
  ...memberLifecycle,
  ...releaseLifecycle,
  ...enforcementRecovery,
  QUARANTINE_SWEEP_INTERVAL_MS: expiryScheduler.QUARANTINE_SWEEP_INTERVAL_MS,
  startQuarantineExpiryScheduler: expiryScheduler.startQuarantineExpiryScheduler,
  stopQuarantineExpiryScheduler: expiryScheduler.stopQuarantineExpiryScheduler,
};
