'use strict';

// Canonical public surface for the Goliath Tickets flagship module.
// Internal files remain focused by responsibility while external consumers
// import this file instead of reaching into implementation details.

const manager = require('./ticketManager');
const store = require('./ticketStore');
const panels = require('./ticketPanelManager');
const recovery = require('./ticketRecovery');
const transcripts = require('./ticketTranscriptManager');
const analytics = require('./ticketAnalytics');
const actions = require('./ticketActions');
const permissions = require('./ticketPermissions');
const startup = require('./ticketStartup');
const interactions = require('./ticketInteractionHandler');
const health = require('./ticketsHealth');

function getOverview(guildId) {
  const tickets = typeof manager.getGuildTickets === 'function'
    ? manager.getGuildTickets(guildId)
    : typeof store.getAllTickets === 'function'
      ? store.getAllTickets(guildId)
      : [];
  const panelData = typeof store.getPanels === 'function' ? store.getPanels(guildId) : { panels: [] };
  const panelList = Array.isArray(panelData?.panels) ? panelData.panels : [];

  const statusCounts = tickets.reduce((counts, ticket) => {
    const status = String(ticket?.status || 'open').toLowerCase();
    counts[status] = Number(counts[status] || 0) + 1;
    return counts;
  }, {});

  return {
    enabled: true,
    tickets: {
      total: tickets.length,
      open: statusCounts.open || 0,
      claimed: statusCounts.claimed || 0,
      closed: statusCounts.closed || 0,
      archived: statusCounts.archived || 0,
      deleted: statusCounts.deleted || 0,
    },
    panels: {
      total: panelList.length,
      deployed: panelList.filter((panel) => Boolean(
        panel?.deployed ||
        (panel?.deployChannelId && panel?.deployMessageId) ||
        (panel?.channelId && panel?.messageId)
      )).length,
    },
    settings: typeof store.getTicketSettings === 'function' ? store.getTicketSettings(guildId) : {},
  };
}

module.exports = {
  ...manager,
  getOverview,
  buildHealthReport: health.buildHealthReport,
  repairPanel: health.repairPanel,
  repairAll: health.repairAll,
  handleTicketInteraction: interactions.handleTicketInteraction,
  manager,
  store,
  panels,
  recovery,
  transcripts,
  analytics,
  actions,
  permissions,
  startup,
  interactions,
  health,
};
