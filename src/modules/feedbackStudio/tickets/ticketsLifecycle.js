'use strict';

/**
 * Canonical Tickets lifecycle layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketManagerApi;

// ============================================================================
// ticketManager
// ============================================================================
{
  const crypto = require('node:crypto');

  const {
    TICKET_STATUS,
    TICKET_PRIORITY,
  } = require('./tickets');

  const {
    getTicket,
    getAllTickets,
    createTicket,
    updateTicket,
    deleteTicket,
    getTicketSettings,
  } = require('./tickets');

  const {
    addTicketCreatedEntry,
    addStatusChangeEntry,
    addAssignmentEntry,
    addNoteEntry,
  } = require('./ticketsTracking');

  const {
    trackTicketCreated,
    trackTicketClaimed,
    trackTicketClosed,
    trackTicketReopened,
    trackTicketArchived,
    trackTicketDeleted,
  } = require('./ticketsTracking');

  const {
    emitTicketCreated,
    emitTicketUpdated,
    emitTicketClosed,
    emitTicketClaimed,
    emitTicketReopened,
    emitTicketArchived,
    emitTicketDeleted,
  } = require('./ticketsTracking');

  const { isModuleEnabled } = require('../../../core/guild/guildManager');

  function generateTicketId() {
    return crypto.randomUUID();
  }

  function now() {
    return new Date().toISOString();
  }

  function normalizeStatus(status) {
    return String(status || TICKET_STATUS.OPEN).toLowerCase();
  }

  function normalizePriority(priority) {
    return String(priority || TICKET_PRIORITY.NORMAL).toLowerCase();
  }

  function normalizeTicketType(type = 'ticket') {
    return (
      String(type || 'ticket')
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ticket'
    );
  }

  function isValidStatus(status) {
    return Object.values(TICKET_STATUS).includes(normalizeStatus(status));
  }

  function isValidPriority(priority) {
    return Object.values(TICKET_PRIORITY).includes(normalizePriority(priority));
  }

  function uniqueIds(ids = []) {
    return [...new Set((ids || []).filter(Boolean))];
  }

  function getTicketNumberingConfig(guildId) {
    const settings = getTicketSettings(guildId);

    return {
      nextNumber: Number(settings?.numbering?.nextNumber || 1),
      padding: Number(settings?.numbering?.padding || 4),
    };
  }

  function formatTicketDisplayId(type, number, padding = 4) {
    const cleanType = normalizeTicketType(type);
    const cleanNumber = Number(number || 1);
    const paddedNumber = String(cleanNumber).padStart(padding, '0');

    return `${cleanType}-${paddedNumber}`;
  }

  function assertTicketsModuleEnabled(guildId) {
    if (!guildId) {
      throw new Error('Missing guildId');
    }

    if (!isModuleEnabled(guildId, 'tickets')) {
      throw new Error('Tickets module is disabled for this server.');
    }
  }

  async function createNewTicket({
    guildId,
    creatorId,
    type = 'ticket',
    title,
    description = '',
    priority = TICKET_PRIORITY.NORMAL,
    source,
    sourceId = null,
    formSubmissionId = null,
    moderationCaseId = null,
    securityIncidentId = null,
    tags = [],
    metadata = {},
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    if (!isValidPriority(priority)) {
      throw new Error(`Invalid ticket priority: ${priority}`);
    }

    const cleanType = normalizeTicketType(type);
    const numbering = getTicketNumberingConfig(guildId);
    const ticketNumber = numbering.nextNumber;
    const displayId = formatTicketDisplayId(
      cleanType,
      ticketNumber,
      numbering.padding
    );

    const ticket = createTicket(guildId, {
      ticketId: generateTicketId(),

      number: ticketNumber,
      ticketNumber,
      displayId,

      creatorId,

      type: cleanType,
      title: title || 'Untitled Ticket',
      description,

      status: TICKET_STATUS.OPEN,
      priority: normalizePriority(priority),

      source,
      sourceId,

      formSubmissionId,
      moderationCaseId,
      securityIncidentId,

      tags: Array.isArray(tags) ? tags : [],

      metadata: {
        ...metadata,
        displayId,
        createdViaManager: true,
      },

      createdAt: now(),
      statusChangedAt: now(),
    });

    trackTicketCreated(guildId, ticket);
    emitTicketCreated(guildId, ticket);

    addTicketCreatedEntry(
      guildId,
      ticket.ticketId,
      creatorId,
      {
        source,
        sourceId,
        type: cleanType,
        displayId,
      }
    );

    return ticket;
  }

  async function closeTicket({
    guildId,
    ticketId,
    actorId,
    reason = null,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    if (ticket.status === TICKET_STATUS.CLOSED) {
      return ticket;
    }

    const previousStatus = ticket.status;

    const updatedTicket = updateTicket(guildId, ticketId, {
      status: TICKET_STATUS.CLOSED,
      closedAt: now(),
      closedById: actorId || null,
      closeReason: reason || null,
      statusChangedAt: now(),
    });

    trackTicketClosed(guildId, updatedTicket, actorId);
    emitTicketClosed(guildId, updatedTicket, actorId);

    addStatusChangeEntry(
      guildId,
      ticketId,
      actorId,
      previousStatus,
      TICKET_STATUS.CLOSED,
      { reason }
    );

    return updatedTicket;
  }

  async function reopenTicket({
    guildId,
    ticketId,
    actorId,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    const previousStatus = ticket.status;

    if (previousStatus === TICKET_STATUS.OPEN) {
      return ticket;
    }

    const updatedTicket = updateTicket(guildId, ticketId, {
      status: TICKET_STATUS.OPEN,

      reopenedAt: now(),
      reopenedById: actorId || null,

      closedAt: null,
      closedById: null,
      closeReason: null,

      archivedAt: null,
      archivedById: null,
      archiveReason: null,

      statusChangedAt: now(),
    });

    trackTicketReopened(guildId, actorId);
    emitTicketReopened(guildId, updatedTicket, actorId);

    addStatusChangeEntry(
      guildId,
      ticketId,
      actorId,
      previousStatus,
      TICKET_STATUS.OPEN
    );

    return updatedTicket;
  }

  async function claimTicket({
    guildId,
    ticketId,
    actorId,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    if (
      ticket.status === TICKET_STATUS.CLOSED ||
      ticket.status === TICKET_STATUS.ARCHIVED
    ) {
      return ticket;
    }

    const assignedStaffIds = uniqueIds([
      ...(ticket.assignedStaffIds || []),
      actorId,
    ]);

    const previousStatus = ticket.status;

    const updatedTicket = updateTicket(guildId, ticketId, {
      claimedById: actorId || null,
      claimedAt: ticket.claimedAt || now(),
      assignedStaffIds,
      status: TICKET_STATUS.CLAIMED,
      statusChangedAt: now(),
    });

    trackTicketClaimed(guildId, updatedTicket, actorId);
    emitTicketClaimed(guildId, updatedTicket, actorId);

    if (previousStatus !== TICKET_STATUS.CLAIMED) {
      addStatusChangeEntry(
        guildId,
        ticketId,
        actorId,
        previousStatus,
        TICKET_STATUS.CLAIMED
      );
    }

    return updatedTicket;
  }

  async function assignTicket({
    guildId,
    ticketId,
    actorId,
    assignedUserId,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    const assignedStaffIds = uniqueIds([
      ...(ticket.assignedStaffIds || []),
      assignedUserId,
    ]);

    const updatedTicket = updateTicket(guildId, ticketId, {
      assignedStaffIds,
    });

    emitTicketUpdated(guildId, updatedTicket);

    addAssignmentEntry(
      guildId,
      ticketId,
      actorId,
      assignedUserId
    );

    return updatedTicket;
  }

  async function updateTicketStatus({
    guildId,
    ticketId,
    actorId,
    status,
    reason = null,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    const nextStatus = normalizeStatus(status);

    if (!isValidStatus(nextStatus)) {
      throw new Error(`Invalid ticket status: ${status}`);
    }

    const previousStatus = ticket.status;

    if (previousStatus === nextStatus) {
      return ticket;
    }

    const updates = {
      status: nextStatus,
      statusChangedAt: now(),
    };

    if (nextStatus === TICKET_STATUS.CLOSED) {
      updates.closedAt = now();
      updates.closedById = actorId || null;
      updates.closeReason = reason || null;
    }

    if (nextStatus === TICKET_STATUS.ARCHIVED) {
      updates.archivedAt = now();
      updates.archivedById = actorId || null;
      updates.archiveReason = reason || null;
    }

    if (nextStatus === TICKET_STATUS.OPEN) {
      updates.reopenedAt = now();
      updates.reopenedById = actorId || null;
    }

    const updatedTicket = updateTicket(guildId, ticketId, updates);

    if (nextStatus === TICKET_STATUS.CLOSED) {
      trackTicketClosed(guildId, updatedTicket, actorId);
      emitTicketClosed(guildId, updatedTicket, actorId);
    }

    if (nextStatus === TICKET_STATUS.ARCHIVED) {
      trackTicketArchived(guildId, updatedTicket, actorId);
      emitTicketArchived(guildId, updatedTicket, actorId);
    }

    if (nextStatus === TICKET_STATUS.OPEN) {
      trackTicketReopened(guildId, actorId);
      emitTicketReopened(guildId, updatedTicket, actorId);
    }

    emitTicketUpdated(guildId, updatedTicket);

    addStatusChangeEntry(
      guildId,
      ticketId,
      actorId,
      previousStatus,
      nextStatus,
      { reason }
    );

    return updatedTicket;
  }

  async function changeTicketPriority({
    guildId,
    ticketId,
    actorId,
    priority,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    const nextPriority = normalizePriority(priority);

    if (!isValidPriority(nextPriority)) {
      throw new Error(`Invalid ticket priority: ${priority}`);
    }

    const previousPriority = ticket.priority;

    const updatedTicket = updateTicket(guildId, ticketId, {
      priority: nextPriority,
    });

    emitTicketUpdated(guildId, updatedTicket);

    return {
      ticket: updatedTicket,
      previousPriority,
      nextPriority,
      actorId,
    };
  }

  async function addTicketNote({
    guildId,
    ticketId,
    actorId,
    note,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    const content = String(note || '').trim();

    if (!content) {
      throw new Error('Missing note content.');
    }

    const notes = Array.isArray(ticket.notes)
      ? [...ticket.notes]
      : [];

    const noteObject = {
      id: crypto.randomUUID(),
      authorId: actorId || null,
      content,
      createdAt: now(),
    };

    notes.push(noteObject);

    const updatedTicket = updateTicket(guildId, ticketId, {
      notes,
    });

    emitTicketUpdated(guildId, updatedTicket);

    addNoteEntry(
      guildId,
      ticketId,
      actorId,
      content
    );

    return noteObject;
  }

  async function archiveTicket({
    guildId,
    ticketId,
    actorId,
    reason = null,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) return null;

    if (ticket.status === TICKET_STATUS.ARCHIVED) {
      return ticket;
    }

    const previousStatus = ticket.status;

    const updatedTicket = updateTicket(guildId, ticketId, {
      status: TICKET_STATUS.ARCHIVED,
      archivedAt: now(),
      archivedById: actorId || null,
      archiveReason: reason || null,
      statusChangedAt: now(),
    });

    trackTicketArchived(guildId, updatedTicket, actorId);
    emitTicketArchived(guildId, updatedTicket, actorId);

    addStatusChangeEntry(
      guildId,
      ticketId,
      actorId,
      previousStatus,
      TICKET_STATUS.ARCHIVED,
      { reason }
    );

    return updatedTicket;
  }

  async function removeTicket({
    guildId,
    ticketId,
  } = {}) {
    assertTicketsModuleEnabled(guildId);

    const ticket = getTicket(guildId, ticketId);
    const deleted = deleteTicket(guildId, ticketId);

    if (deleted) {
      trackTicketDeleted(guildId);

      emitTicketDeleted(
        guildId,
        ticketId,
        ticket?.displayId || null
      );
    }

    return deleted;
  }

  function getTicketById(guildId, ticketId) {
    return getTicket(guildId, ticketId);
  }

  function getGuildTickets(guildId) {
    return getAllTickets(guildId);
  }

  function getOpenTickets(guildId) {
    return getGuildTickets(guildId).filter(
      (ticket) =>
        ticket.status !== TICKET_STATUS.CLOSED &&
        ticket.status !== TICKET_STATUS.ARCHIVED
    );
  }

  function getClosedTickets(guildId) {
    return getGuildTickets(guildId).filter(
      (ticket) =>
        ticket.status === TICKET_STATUS.CLOSED ||
        ticket.status === TICKET_STATUS.ARCHIVED
    );
  }

  function getTicketsByUser(guildId, userId) {
    return getGuildTickets(guildId).filter(
      (ticket) => ticket.creatorId === userId
    );
  }

  function getTicketsByPanel(guildId, panelId) {
    return getGuildTickets(guildId).filter(
      (ticket) =>
        ticket.sourceId === panelId ||
        ticket.metadata?.panelId === panelId
    );
  }

  /**
   * Aliases for compatibility
   */

  function getTickets(guildId) {
    return getGuildTickets(guildId);
  }

  function getAllGuildTickets(guildId) {
    return getGuildTickets(guildId);
  }

  ticketManagerApi = {
    createNewTicket,

    closeTicket,
    reopenTicket,

    claimTicket,
    assignTicket,

    updateTicketStatus,
    changeTicketPriority,

    addTicketNote,

    archiveTicket,
    removeTicket,

    getTicketById,
    getGuildTickets,

    getOpenTickets,
    getClosedTickets,
    getTicketsByUser,
    getTicketsByPanel,

    getTickets,
    getAllGuildTickets,

    generateTicketId,
    normalizeTicketType,
    formatTicketDisplayId,
  };
}

module.exports = {
  ...ticketManagerApi,
  ticketManager: ticketManagerApi,
};
