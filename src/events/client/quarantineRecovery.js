'use strict';

// Compatibility entry point while the legacy quarantine implementation is
// progressively split into focused modules. Keeping this event path stable
// avoids changes to the event loader during the refactor.
module.exports = require('../../core/security/protection/quarantine/recoveryEvents');
