'use strict';

// Canonical Discord administration entry for Tickets.
// The mature setup implementation remains isolated while the module is
// consolidated behind this stable public file.

const setupPanel = require('./ticketSetupPanel');

module.exports = {
  ...setupPanel,
  buildTicketsAdminPanel: setupPanel.buildTicketsAdminPanel || setupPanel.buildTicketSetupPanel || setupPanel.buildSetupPanel,
  handleTicketsAdminInteraction: setupPanel.handleTicketsAdminInteraction || setupPanel.handleTicketSetupInteraction,
};
