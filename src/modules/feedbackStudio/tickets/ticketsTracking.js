'use strict';

/**
 * Canonical Tickets tracking layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketSocketEventsApi;
let ticketAnalyticsApi;
let ticketTimelineApi;
let ticketRecoveryApi;
let ticketStartupApi;

// ============================================================================
// ticketSocketEvents
// ============================================================================
{
  const notifications = require('../../../core/notifications/notificationStore');
  const {
    emitGuildUpdate,
    emitRoomEvent,
  } = require('../../../server/sockets/socketHub');

  const TICKET_ROOM = 'goliath:tickets';

  const EVENTS = Object.freeze({
    TICKET_CREATED: 'ticket.created',
    TICKET_UPDATED: 'ticket.updated',
    TICKET_CLOSED: 'ticket.closed',
    TICKET_REOPENED: 'ticket.reopened',
    TICKET_ARCHIVED: 'ticket.archived',
    TICKET_DELETED: 'ticket.deleted',
    TICKET_CLAIMED: 'ticket.claimed',
    PANEL_CREATED: 'panel.created',
    PANEL_UPDATED: 'panel.updated',
    PANEL_DELETED: 'panel.deleted',
    PANEL_DEPLOYED: 'panel.deployed',
    TIMELINE_ENTRY: 'ticket.timeline.entry',
    ANALYTICS_UPDATED: 'ticket.analytics.updated',
  });

  function notify(guildId, payload = {}) {
    try {
      return notifications.addNotification(guildId, {
        source: 'tickets',
        route: '/tickets',
        ...payload,
      });
    } catch (error) {
      console.warn('[TicketSockets] Notification skipped:', error.message || error);
      return null;
    }
  }

  function emit(event, guildId, data = {}) {
    const timestamp = new Date().toISOString();
    const payload = {
      module: 'tickets',
      event,
      guildId: String(guildId),
      timestamp,
      updatedAt: timestamp,
      data,
    };

    const update = emitGuildUpdate(guildId, payload);
    if (!update) return payload;

    const eventNames = [
      event,
      'goliath_realtime_event',
    ].filter((eventName, index, list) =>
      eventName && list.indexOf(eventName) === index
    );

    for (const eventName of eventNames) {
      emitRoomEvent(TICKET_ROOM, eventName, update);
    }

    return update;
  }

  function emitForTicket(_io, ticket, event, data = {}) {
    if (!ticket?.guildId) return false;

    return emit(event, ticket.guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      status: ticket.status,
      type: ticket.type,
      priority: ticket.priority,
      ...data,
    });
  }

  function emitTicketCreated(guildId, ticket) {
    notify(guildId, {
      level: 'info',
      title: 'Ticket created',
      message: `${ticket.displayId || ticket.ticketId} was opened.`,
      metadata: {
        ticketId: ticket.ticketId,
        displayId: ticket.displayId,
        status: ticket.status,
        type: ticket.type,
      },
    });

    return emit(EVENTS.TICKET_CREATED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      status: ticket.status,
      type: ticket.type,
      priority: ticket.priority,
      creatorId: ticket.creatorId,
      panelId: ticket.metadata?.panelId || null,
      createdAt: ticket.createdAt,
    });
  }

  function emitTicketUpdated(guildId, ticket) {
    return emit(EVENTS.TICKET_UPDATED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      status: ticket.status,
      updatedAt: ticket.updatedAt,
    });
  }

  function emitTicketClosed(guildId, ticket, actorId = null) {
    notify(guildId, {
      level: 'success',
      title: 'Ticket closed',
      message: `${ticket.displayId || ticket.ticketId} was closed.`,
      metadata: { ticketId: ticket.ticketId, displayId: ticket.displayId, actorId },
    });

    return emit(EVENTS.TICKET_CLOSED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      actorId,
      closedAt: ticket.closedAt,
    });
  }

  function emitTicketClaimed(guildId, ticket, actorId = null) {
    notify(guildId, {
      level: 'info',
      title: 'Ticket claimed',
      message: `${ticket.displayId || ticket.ticketId} was claimed.`,
      metadata: { ticketId: ticket.ticketId, displayId: ticket.displayId, actorId },
    });

    return emit(EVENTS.TICKET_CLAIMED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      actorId,
      claimedAt: ticket.claimedAt,
    });
  }

  function emitTicketReopened(guildId, ticket, actorId = null) {
    notify(guildId, {
      level: 'warning',
      title: 'Ticket reopened',
      message: `${ticket.displayId || ticket.ticketId} was reopened.`,
      metadata: { ticketId: ticket.ticketId, displayId: ticket.displayId, actorId },
    });

    return emit(EVENTS.TICKET_REOPENED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      actorId,
      reopenedAt: ticket.reopenedAt,
    });
  }

  function emitTicketArchived(guildId, ticket, actorId = null) {
    notify(guildId, {
      level: 'success',
      title: 'Ticket archived',
      message: `${ticket.displayId || ticket.ticketId} was archived.`,
      metadata: { ticketId: ticket.ticketId, displayId: ticket.displayId, actorId },
    });

    return emit(EVENTS.TICKET_ARCHIVED, guildId, {
      ticketId: ticket.ticketId,
      displayId: ticket.displayId,
      actorId,
      archivedAt: ticket.archivedAt,
    });
  }

  function emitTicketDeleted(guildId, ticketId, displayId = null) {
    notify(guildId, {
      level: 'warning',
      title: 'Ticket deleted',
      message: `${displayId || ticketId} was deleted.`,
      metadata: { ticketId, displayId },
    });

    return emit(EVENTS.TICKET_DELETED, guildId, { ticketId, displayId });
  }

  function emitPanelCreated(guildId, panel) {
    return emit(EVENTS.PANEL_CREATED, guildId, {
      panelId: panel.panelId,
      name: panel.name,
      type: panel.ticketType,
    });
  }

  function emitPanelUpdated(guildId, panel) {
    return emit(EVENTS.PANEL_UPDATED, guildId, {
      panelId: panel.panelId,
      name: panel.name,
      updatedAt: panel.updatedAt,
    });
  }

  function emitPanelDeleted(guildId, panelId) {
    return emit(EVENTS.PANEL_DELETED, guildId, { panelId });
  }

  function emitPanelDeployed(guildId, panel) {
    return emit(EVENTS.PANEL_DEPLOYED, guildId, {
      panelId: panel.panelId,
      deployChannelId: panel.deployChannelId,
      deployMessageId: panel.deployMessageId,
      deployed: panel.deployed === true,
    });
  }

  function emitTimelineEntry(guildId, ticketId, entry) {
    return emit(EVENTS.TIMELINE_ENTRY, guildId, { ticketId, entry });
  }

  function emitAnalyticsUpdated(guildId, analytics) {
    return emit(EVENTS.ANALYTICS_UPDATED, guildId, analytics);
  }

  ticketSocketEventsApi = {
    EVENTS,
    emit,
    emitForTicket,
    emitTicketCreated,
    emitTicketUpdated,
    emitTicketClosed,
    emitTicketClaimed,
    emitTicketReopened,
    emitTicketArchived,
    emitTicketDeleted,
    emitPanelCreated,
    emitPanelUpdated,
    emitPanelDeleted,
    emitPanelDeployed,
    emitTimelineEntry,
    emitAnalyticsUpdated,
  };
}

// ============================================================================
// ticketAnalytics
// ============================================================================
{
  const {
    getGuildSection,
    saveGuildSection,
  } = require('../../../core/guild/guildManager');

  const {
    emitAnalyticsUpdated,
  } = ticketSocketEventsApi;

  function now() {
    return new Date().toISOString();
  }

  function defaultAnalytics() {
    return {
      totals: {
        created: 0,
        closed: 0,
        reopened: 0,
        archived: 0,
        deleted: 0,
      },

      status: {
        open: 0,
        claimed: 0,
        closed: 0,
        archived: 0,
      },

      ticketTypes: {},

      panels: {},

      staff: {},

      performance: {
        averageClaimTimeMs: 0,
        averageCloseTimeMs: 0,
      },

      activity: {
        lastTicketCreatedAt: null,
        lastTicketClosedAt: null,
        lastTicketReopenedAt: null,
      },

      updatedAt: now(),
    };
  }

  function getAnalytics(guildId) {
    const tickets = getGuildSection(
      guildId,
      'tickets',
      {}
    );

    return {
      ...defaultAnalytics(),
      ...(tickets.analytics || {}),
    };
  }

  function saveAnalytics(
    guildId,
    analytics
  ) {
    const tickets = getGuildSection(
      guildId,
      'tickets',
      {}
    );

    tickets.analytics = {
      ...defaultAnalytics(),
      ...(analytics || {}),
      updatedAt: now(),
    };

    saveGuildSection(
      guildId,
      'tickets',
      tickets
    );

    return tickets.analytics;
  }

  function saveAndEmitAnalytics(
    guildId,
    analytics
  ) {
    const saved =
      saveAnalytics(
        guildId,
        analytics
      );

    emitAnalyticsUpdated(
      guildId,
      saved
    );

    return saved;
  }

  function incrementCounter(
    object,
    key,
    amount = 1
  ) {
    object[key] =
      Number(object[key] || 0) + amount;
  }

  function ensureStaffStats(
    analytics,
    actorId
  ) {
    if (!actorId) return null;

    if (!analytics.staff[actorId]) {
      analytics.staff[actorId] = {
        claimed: 0,
        closed: 0,
        reopened: 0,
        archived: 0,
        messages: 0,
      };
    }

    return analytics.staff[actorId];
  }

  function updateRollingAverage(
    currentAverage,
    nextValue
  ) {
    const current =
      Number(currentAverage || 0);

    const next =
      Number(nextValue || 0);

    if (next <= 0) {
      return current;
    }

    if (current <= 0) {
      return next;
    }

    return Math.floor(
      (current + next) / 2
    );
  }

  function getElapsedMsFrom(
    isoDate
  ) {
    if (!isoDate) return 0;

    const start =
      new Date(isoDate).getTime();

    if (!Number.isFinite(start)) {
      return 0;
    }

    return Math.max(
      0,
      Date.now() - start
    );
  }

  function trackTicketCreated(
    guildId,
    ticket
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.totals,
      'created'
    );

    incrementCounter(
      analytics.status,
      'open'
    );

    if (ticket?.type) {
      incrementCounter(
        analytics.ticketTypes,
        ticket.type
      );
    }

    const panelId =
      ticket?.metadata?.panelId;

    if (panelId) {
      incrementCounter(
        analytics.panels,
        panelId
      );
    }

    analytics.activity.lastTicketCreatedAt =
      now();

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  function trackTicketClaimed(
    guildId,
    ticket,
    actorId
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.status,
      'claimed'
    );

    const staffStats =
      ensureStaffStats(
        analytics,
        actorId
      );

    if (staffStats) {
      incrementCounter(
        staffStats,
        'claimed'
      );
    }

    const claimMs =
      getElapsedMsFrom(
        ticket?.createdAt
      );

    analytics.performance.averageClaimTimeMs =
      updateRollingAverage(
        analytics.performance.averageClaimTimeMs,
        claimMs
      );

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  function trackTicketClosed(
    guildId,
    ticket,
    actorId
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.totals,
      'closed'
    );

    incrementCounter(
      analytics.status,
      'closed'
    );

    const staffStats =
      ensureStaffStats(
        analytics,
        actorId
      );

    if (staffStats) {
      incrementCounter(
        staffStats,
        'closed'
      );
    }

    const closeMs =
      getElapsedMsFrom(
        ticket?.createdAt
      );

    analytics.performance.averageCloseTimeMs =
      updateRollingAverage(
        analytics.performance.averageCloseTimeMs,
        closeMs
      );

    analytics.activity.lastTicketClosedAt =
      now();

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  function trackTicketReopened(
    guildId,
    actorId
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.totals,
      'reopened'
    );

    const staffStats =
      ensureStaffStats(
        analytics,
        actorId
      );

    if (staffStats) {
      incrementCounter(
        staffStats,
        'reopened'
      );
    }

    analytics.activity.lastTicketReopenedAt =
      now();

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  function trackTicketArchived(
    guildId,
    ticket = null,
    actorId = null
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.totals,
      'archived'
    );

    incrementCounter(
      analytics.status,
      'archived'
    );

    const staffStats =
      ensureStaffStats(
        analytics,
        actorId
      );

    if (staffStats) {
      incrementCounter(
        staffStats,
        'archived'
      );
    }

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  function trackTicketDeleted(
    guildId
  ) {
    const analytics =
      getAnalytics(guildId);

    incrementCounter(
      analytics.totals,
      'deleted'
    );

    return saveAndEmitAnalytics(
      guildId,
      analytics
    );
  }

  ticketAnalyticsApi = {
    getAnalytics,
    saveAnalytics,
    saveAndEmitAnalytics,

    trackTicketCreated,
    trackTicketClaimed,
    trackTicketClosed,
    trackTicketReopened,
    trackTicketArchived,
    trackTicketDeleted,
  };
}

// ============================================================================
// ticketTimeline
// ============================================================================
{
  const crypto = require('crypto');

  const {
    TICKET_TIMELINE_EVENTS = {},
  } = require('./tickets');

  const {
    getTicket,
    updateTicket,
  } = require('./tickets');

  const {
    emitTimelineEntry,
  } = ticketSocketEventsApi;

  const TIMELINE_EVENTS = Object.freeze({
    CREATED: TICKET_TIMELINE_EVENTS.CREATED || 'ticket_created',
    CLAIMED: TICKET_TIMELINE_EVENTS.CLAIMED || 'ticket_claimed',
    CLOSED: TICKET_TIMELINE_EVENTS.CLOSED || 'ticket_closed',
    REOPENED: TICKET_TIMELINE_EVENTS.REOPENED || 'ticket_reopened',
    ARCHIVED: TICKET_TIMELINE_EVENTS.ARCHIVED || 'ticket_archived',
    DELETED: TICKET_TIMELINE_EVENTS.DELETED || 'ticket_deleted',
    STATUS_CHANGED: TICKET_TIMELINE_EVENTS.STATUS_CHANGED || 'ticket_status_changed',
    PRIORITY_CHANGED: TICKET_TIMELINE_EVENTS.PRIORITY_CHANGED || 'ticket_priority_changed',
    ASSIGNED: TICKET_TIMELINE_EVENTS.ASSIGNED || 'ticket_assigned',
    USER_ADDED: TICKET_TIMELINE_EVENTS.USER_ADDED || 'ticket_user_added',
    USER_REMOVED: TICKET_TIMELINE_EVENTS.USER_REMOVED || 'ticket_user_removed',
    NOTE_ADDED: TICKET_TIMELINE_EVENTS.NOTE_ADDED || 'ticket_note_added',
    STAFF_ACTIVITY: TICKET_TIMELINE_EVENTS.STAFF_ACTIVITY || 'ticket_staff_activity',
    DISCORD_CHANNEL_CREATED: TICKET_TIMELINE_EVENTS.DISCORD_CHANNEL_CREATED || 'discord_channel_created',
    DISCORD_CHANNEL_CLOSED: TICKET_TIMELINE_EVENTS.DISCORD_CHANNEL_CLOSED || 'discord_channel_closed',
    DISCORD_CHANNEL_REOPENED: TICKET_TIMELINE_EVENTS.DISCORD_CHANNEL_REOPENED || 'discord_channel_reopened',
    DISCORD_CHANNEL_ARCHIVED: TICKET_TIMELINE_EVENTS.DISCORD_CHANNEL_ARCHIVED || 'discord_channel_archived',
    DISCORD_CHANNEL_DELETED: TICKET_TIMELINE_EVENTS.DISCORD_CHANNEL_DELETED || 'discord_channel_deleted',
    TRANSCRIPT_CREATED: TICKET_TIMELINE_EVENTS.TRANSCRIPT_CREATED || 'ticket_transcript_created',
    TRANSCRIPT_UPLOADED: TICKET_TIMELINE_EVENTS.TRANSCRIPT_UPLOADED || 'ticket_transcript_uploaded',
    SYSTEM: TICKET_TIMELINE_EVENTS.SYSTEM || 'ticket_system',
  });

  const SEVERITY = Object.freeze({
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
  });

  function now() {
    return new Date().toISOString();
  }

  function normalizeSeverity(severity) {
    const value = String(severity || SEVERITY.INFO).toLowerCase();

    if (Object.values(SEVERITY).includes(value)) {
      return value;
    }

    return SEVERITY.INFO;
  }

  function createTimelineEntry({
    type = TIMELINE_EVENTS.SYSTEM,
    actorId = null,
    actorTag = null,
    message = '',
    metadata = {},
    severity = SEVERITY.INFO,
    source = 'tickets',
  } = {}) {
    return {
      id: crypto.randomUUID(),
      type,
      actorId,
      actorTag,
      message,
      metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
      severity: normalizeSeverity(severity),
      source,
      createdAt: now(),
    };
  }

  function addTimelineEntry(guildId, ticketId, entryData = {}) {
    if (!guildId || !ticketId) {
      return null;
    }

    const ticket = getTicket(guildId, ticketId);

    if (!ticket) {
      return null;
    }

    const entry = createTimelineEntry(entryData);

    const timeline = Array.isArray(ticket.timeline)
      ? [...ticket.timeline]
      : [];

    timeline.push(entry);

    updateTicket(guildId, ticketId, {
      timeline,
      updatedAt: now(),
    });

    emitTimelineEntry(guildId, ticketId, entry);

    return entry;
  }

  function addSystemEntry(guildId, ticketId, type, message, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: type || TIMELINE_EVENTS.SYSTEM,
      actorId: null,
      actorTag: 'System',
      message,
      metadata,
      source: 'system',
    });
  }

  function addUserEntry(guildId, ticketId, actorId, type, message, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type,
      actorId,
      message,
      metadata,
      source: 'user',
    });
  }

  function addStaffActivityEntry(guildId, ticketId, actorId, actorTag, message, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.STAFF_ACTIVITY,
      actorId,
      actorTag,
      message,
      metadata,
      severity: SEVERITY.INFO,
      source: 'staff',
    });
  }

  function getTimeline(guildId, ticketId) {
    const ticket = getTicket(guildId, ticketId);

    if (!ticket) {
      return [];
    }

    return Array.isArray(ticket.timeline)
      ? ticket.timeline.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      : [];
  }

  function clearTimeline(guildId, ticketId) {
    return updateTicket(guildId, ticketId, {
      timeline: [],
      updatedAt: now(),
    });
  }

  function addTicketCreatedEntry(guildId, ticketId, actorId = null, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.CREATED,
      actorId,
      message: 'Ticket created.',
      metadata,
      severity: SEVERITY.SUCCESS,
    });
  }

  function addTicketClaimedEntry(guildId, ticketId, actorId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.CLAIMED,
      actorId,
      message: 'Ticket claimed.',
      metadata,
      severity: SEVERITY.SUCCESS,
    });
  }

  function addTicketClosedEntry(guildId, ticketId, actorId, reason = null, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.CLOSED,
      actorId,
      message: reason || 'Ticket closed.',
      metadata: {
        reason,
        ...metadata,
      },
      severity: SEVERITY.WARNING,
    });
  }

  function addTicketReopenedEntry(guildId, ticketId, actorId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.REOPENED,
      actorId,
      message: 'Ticket reopened.',
      metadata,
      severity: SEVERITY.SUCCESS,
    });
  }

  function addTicketArchivedEntry(guildId, ticketId, actorId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.ARCHIVED,
      actorId,
      message: 'Ticket archived.',
      metadata,
      severity: SEVERITY.WARNING,
    });
  }

  function addTicketDeletedEntry(guildId, ticketId, actorId, reason = null, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.DELETED,
      actorId,
      message: reason || 'Ticket deleted.',
      metadata: {
        reason,
        ...metadata,
      },
      severity: SEVERITY.ERROR,
    });
  }

  function addStatusChangeEntry(guildId, ticketId, actorId, oldStatus, newStatus, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.STATUS_CHANGED,
      actorId,
      message: `Status changed from "${oldStatus}" to "${newStatus}".`,
      metadata: {
        oldStatus,
        newStatus,
        ...metadata,
      },
    });
  }

  function addPriorityChangeEntry(guildId, ticketId, actorId, oldPriority, newPriority, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.PRIORITY_CHANGED,
      actorId,
      message: `Priority changed from "${oldPriority}" to "${newPriority}".`,
      metadata: {
        oldPriority,
        newPriority,
        ...metadata,
      },
    });
  }

  function addAssignmentEntry(guildId, ticketId, actorId, assignedUserId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.ASSIGNED,
      actorId,
      message: `Assigned to ${assignedUserId}.`,
      metadata: {
        assignedUserId,
        ...metadata,
      },
    });
  }

  function addUserAddedEntry(guildId, ticketId, actorId, userId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.USER_ADDED,
      actorId,
      message: `Added user ${userId}.`,
      metadata: {
        userId,
        ...metadata,
      },
    });
  }

  function addUserRemovedEntry(guildId, ticketId, actorId, userId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.USER_REMOVED,
      actorId,
      message: `Removed user ${userId}.`,
      metadata: {
        userId,
        ...metadata,
      },
    });
  }

  function addNoteEntry(guildId, ticketId, actorId, note, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type: TIMELINE_EVENTS.NOTE_ADDED,
      actorId,
      message: note,
      metadata,
    });
  }

  function addDiscordChannelEntry(guildId, ticketId, type, channelId, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type,
      actorId: null,
      actorTag: 'Discord',
      message: `Discord ticket channel updated: ${channelId}`,
      metadata: {
        channelId,
        ...metadata,
      },
      source: 'discord',
    });
  }

  function addTranscriptEntry(guildId, ticketId, actorId, type, transcript = {}, metadata = {}) {
    return addTimelineEntry(guildId, ticketId, {
      type,
      actorId,
      message: 'Ticket transcript generated.',
      metadata: {
        transcript,
        ...metadata,
      },
      source: 'transcripts',
    });
  }

  ticketTimelineApi = {
    TIMELINE_EVENTS,
    SEVERITY,

    createTimelineEntry,
    addTimelineEntry,

    addSystemEntry,
    addUserEntry,
    addStaffActivityEntry,

    getTimeline,
    clearTimeline,

    addTicketCreatedEntry,
    addTicketClaimedEntry,
    addTicketClosedEntry,
    addTicketReopenedEntry,
    addTicketArchivedEntry,
    addTicketDeletedEntry,

    addStatusChangeEntry,
    addPriorityChangeEntry,
    addAssignmentEntry,

    addUserAddedEntry,
    addUserRemovedEntry,

    addNoteEntry,

    addDiscordChannelEntry,
    addTranscriptEntry,
  };
}

// ============================================================================
// ticketRecovery
// ============================================================================
{
  /**
   * GOLIATH TICKET RECOVERY
   *
   * Handles:
   * - restoring ticket cache after reboot
   * - validating active tickets
   * - checking missing Discord channels
   * - tracking Forms → Tickets submission/channel recovery state
   * - preparing future panel redeploy/recovery
   */

  const ticketStore = require('./tickets');
  const ticketChannelManager = new Proxy({}, {
    get(_target, property) {
      return require('./ticketsChannels')[property];
    },
  });
  const sendTicketControlMessage = (...args) =>
    require('./ticketsPanel').sendTicketControlMessage(...args);
  const forms = require('../forms/forms');

  const ACTIVE_STATUSES = [
    'open',
    'claimed',
    'waiting_user',
    'in_review',
    'approved',
    'denied',
  ];

  function now() {
    return new Date().toISOString();
  }

  function isActiveTicket(ticket) {
    return ACTIVE_STATUSES.includes(
      String(ticket.status || 'open').toLowerCase()
    );
  }

  function isFormTicket(ticket = {}) {
    return (
      ticket.source === 'form' ||
      Boolean(ticket.formSubmissionId) ||
      Boolean(ticket.metadata?.submissionId)
    );
  }

  function buildFormTicketPanel(form = {}, ticket = {}) {
    return {
      panelId:
        form.formId ||
        ticket.metadata?.formId ||
        ticket.sourceId ||
        null,

      name:
        form.name ||
        ticket.metadata?.formName ||
        'Form Submission',

      ticketType:
        form.ticketType ||
        ticket.type ||
        'form',

      staffRoleIds:
        form.staffRoleIds ||
        [],

      managerRoleIds:
        form.managerRoleIds ||
        [],

      viewerRoleIds:
        form.viewerRoleIds ||
        [],

      outputCategoryId:
        form.outputCategoryId ||
        null,

      archiveCategoryId:
        form.archiveCategoryId ||
        null,

      logsChannelId:
        form.logsChannelId ||
        form.logChannelId ||
        null,

      transcriptsChannelId:
        form.transcriptsChannelId ||
        null,
    };
  }

  async function fetchGuild(client, guildId) {
    if (!client || !guildId) return null;

    return client.guilds
      .fetch(guildId)
      .catch(() => null);
  }

  async function fetchChannel(guild, channelId) {
    if (!guild || !channelId) return null;

    return guild.channels
      .fetch(channelId)
      .catch(() => null);
  }

  function getFormSubmissionId(ticket = {}) {
    return (
      ticket.formSubmissionId ||
      ticket.metadata?.submissionId ||
      null
    );
  }

  function getFormId(ticket = {}) {
    return (
      ticket.metadata?.formId ||
      ticket.sourceId ||
      null
    );
  }

  function getTicketChannelId(ticket = {}) {
    return ticket.discordChannelId || ticket.channelId || null;
  }

  function getTicketControlMessageId(ticket = {}) {
    return ticket.discordMessageId || ticket.messageId || null;
  }

  function getFormSubmission(guildId, ticket = {}) {
    const submissionId = getFormSubmissionId(ticket);
    if (!guildId || !submissionId) return null;

    const section = forms.getFormsSection(guildId);
    return section.submissions?.[forms.cleanKey(submissionId)] || null;
  }

  function updateSubmissionRecoveryState(guildId, submission, updates = {}, guild = null) {
    if (!guildId || !submission?.submissionId) return null;

    return forms.updateSubmission(
      guildId,
      submission.submissionId,
      {
        ...updates,
        workflow: {
          ...(submission.workflow || {}),
          ...(updates.workflow || {}),
          recoveredAt: now(),
        },
      },
      guild || {}
    );
  }

  async function ensureControlMessage({ guild, channel, ticket, form } = {}) {
    if (!guild || !channel?.send || !ticket) {
      return {
        message: null,
        ticket,
      };
    }

    const existingMessageId = getTicketControlMessageId(ticket);

    if (existingMessageId) {
      const existing = await channel.messages
        ?.fetch(existingMessageId)
        .catch(() => null);

      if (existing) {
        return {
          message: existing,
          ticket,
        };
      }
    }

    const panel = buildFormTicketPanel(form, ticket);

    const message = await sendTicketControlMessage({
      channel,
      ticket,
      panel,
      user: null,
    }).catch((error) => {
      console.error('[Tickets] Failed to recreate form ticket control message:', error);
      return null;
    });

    if (!message?.id) {
      return {
        message: null,
        ticket,
      };
    }

    const updatedTicket = ticketStore.updateTicket(guild.id, ticket.ticketId, {
      discordMessageId: message.id,
      messageId: message.id,
      updatedAt: now(),
    }) || {
      ...ticket,
      discordMessageId: message.id,
      messageId: message.id,
    };

    return {
      message,
      ticket: updatedTicket,
    };
  }

  async function recoverFormTicketSubmission({
    client,
    guild,
    ticket,
    createMissingChannels = false,
  } = {}) {
    if (!guild || !ticket || !isFormTicket(ticket)) return null;

    const submission = getFormSubmission(guild.id, ticket);
    const form = getFormId(ticket)
      ? forms.getForm(guild.id, getFormId(ticket))
      : null;

    if (!submission) {
      return {
        ticketId: ticket.ticketId,
        displayId: ticket.displayId,
        recovered: false,
        reason: 'No linked form submission found.',
      };
    }

    const channelId = getTicketChannelId(ticket) || submission.ticketChannelId;
    let channel = await fetchChannel(guild, channelId);

    if (channel) {
      const control = await ensureControlMessage({
        guild,
        channel,
        ticket,
        form,
      });

      const recoveredTicket = control?.ticket || ticket;
      const controlMessageId =
        control?.message?.id ||
        getTicketControlMessageId(recoveredTicket);

      const updatedSubmission = updateSubmissionRecoveryState(
        guild.id,
        submission,
        {
          ticketId: recoveredTicket.ticketId,
          ticketChannelId: channel.id,
          workflow: {
            ticketCreated: true,
            ticketId: recoveredTicket.ticketId,
            ticketDisplayId: recoveredTicket.displayId,
            ticketChannelId: channel.id,
            ticketControlMessageId: controlMessageId || null,
            channelRecovered: true,
          },
        },
        guild
      );

      forms.addSubmissionTimeline(guild.id, submission.submissionId, {
        type: 'ticket_channel_relinked',
        label: 'Ticket channel relinked during recovery',
        metadata: {
          ticketId: recoveredTicket.ticketId,
          channelId: channel.id,
          controlMessageId: controlMessageId || null,
        },
      }, guild);

      return {
        ticketId: recoveredTicket.ticketId,
        displayId: recoveredTicket.displayId,
        submissionId: submission.submissionId,
        channelId: channel.id,
        controlMessageId: controlMessageId || null,
        recovered: true,
        recreated: false,
        submission: updatedSubmission,
      };
    }

    if (!createMissingChannels) {
      return {
        ticketId: ticket.ticketId,
        displayId: ticket.displayId,
        submissionId: submission.submissionId,
        missingChannelId: channelId || null,
        recovered: false,
        recoverable: true,
        reason: 'Ticket channel missing. Set createMissingChannels=true to recreate it.',
      };
    }

    const panel = buildFormTicketPanel(form, ticket);

    channel = await ticketChannelManager.createTicketChannel({
      client,
      guild,
      ticket,
      panel,
    });

    const control = await ensureControlMessage({
      guild,
      channel,
      ticket,
      form,
    });

    const recoveredTicket = control?.ticket || ticket;
    const controlMessageId =
      control?.message?.id ||
      getTicketControlMessageId(recoveredTicket);

    const updatedSubmission = updateSubmissionRecoveryState(
      guild.id,
      submission,
      {
        ticketId: recoveredTicket.ticketId,
        ticketChannelId: channel?.id || null,
        workflow: {
          ticketCreated: true,
          ticketId: recoveredTicket.ticketId,
          ticketDisplayId: recoveredTicket.displayId,
          ticketChannelId: channel?.id || null,
          ticketControlMessageId: controlMessageId || null,
          channelRecreated: true,
        },
      },
      guild
    );

    forms.addSubmissionTimeline(guild.id, submission.submissionId, {
      type: 'ticket_channel_recreated',
      label: 'Missing ticket channel recreated during recovery',
      metadata: {
        ticketId: recoveredTicket.ticketId,
        channelId: channel?.id || null,
        controlMessageId: controlMessageId || null,
      },
    }, guild);

    return {
      ticketId: recoveredTicket.ticketId,
      displayId: recoveredTicket.displayId,
      submissionId: submission.submissionId,
      channelId: channel?.id || null,
      controlMessageId: controlMessageId || null,
      recovered: true,
      recreated: true,
      submission: updatedSubmission,
    };
  }

  async function recoverGuildTickets(client, guildId, options = {}) {
    ticketStore.reloadGuildTickets(guildId);

    const tickets = ticketStore.getAllTickets(guildId);
    const activeTickets = tickets.filter(isActiveTicket);

    const guild = await fetchGuild(client, guildId);

    const results = {
      guildId,
      totalTickets: tickets.length,
      activeTickets: activeTickets.length,
      missingChannels: [],
      validChannels: [],
      formTicketRecovery: [],
    };

    if (!guild) {
      return {
        ...results,
        guildFound: false,
      };
    }

    for (const ticket of activeTickets) {
      const currentChannelId = getTicketChannelId(ticket);
      const channel = await fetchChannel(guild, currentChannelId);

      if (!channel) {
        results.missingChannels.push({
          ticketId: ticket.ticketId,
          displayId: ticket.displayId,
          discordChannelId: currentChannelId,
        });
      } else {
        results.validChannels.push({
          ticketId: ticket.ticketId,
          displayId: ticket.displayId,
          discordChannelId: channel.id,
        });
      }

      if (isFormTicket(ticket)) {
        const recovery = await recoverFormTicketSubmission({
          client,
          guild,
          ticket,
          createMissingChannels: options.createMissingChannels === true,
        }).catch((error) => ({
          ticketId: ticket.ticketId,
          displayId: ticket.displayId,
          recovered: false,
          error: error.message,
        }));

        if (recovery) {
          results.formTicketRecovery.push(recovery);
        }
      }
    }

    return {
      ...results,
      guildFound: true,
    };
  }

  async function recoverAllClientGuildTickets(client, options = {}) {
    if (!client?.guilds?.cache) {
      return [];
    }

    const guildIds = [...client.guilds.cache.keys()];
    const results = [];

    for (const guildId of guildIds) {
      const result = await recoverGuildTickets(
        client,
        guildId,
        options
      );

      results.push(result);
    }

    return results;
  }

  ticketRecoveryApi = {
    ACTIVE_STATUSES,

    isActiveTicket,
    isFormTicket,

    recoverFormTicketSubmission,
    recoverGuildTickets,
    recoverAllClientGuildTickets,
  };
}

// ============================================================================
// ticketStartup
// ============================================================================
{
  const ticketRecovery = ticketRecoveryApi;

  async function startupTickets(client) {
    if (!client) {
      return {
        ok: false,
        reason: 'Missing Discord client.',
      };
    }

    const results = await ticketRecovery.recoverAllClientGuildTickets(client);

    const summary = {
      ok: true,
      guildsChecked: results.length,
      totalTickets: 0,
      totalActiveTickets: 0,
      totalMissingChannels: 0,
      results,
    };

    for (const result of results) {
      summary.totalTickets += result.totalTickets || 0;
      summary.totalActiveTickets += result.activeTickets || 0;
      summary.totalMissingChannels += result.missingChannels?.length || 0;
    }

    console.log(
      `[Tickets] Startup recovery complete: ${summary.guildsChecked} guild(s), ${summary.totalActiveTickets} active ticket(s), ${summary.totalMissingChannels} missing channel(s).`
    );

    return summary;
  }

  ticketStartupApi = {
    startupTickets,
    recoverTickets: startupTickets,
  };
}

module.exports = {
  ...ticketSocketEventsApi,
  ...ticketAnalyticsApi,
  ...ticketTimelineApi,
  ...ticketRecoveryApi,
  ...ticketStartupApi,
  ticketSocketEvents: ticketSocketEventsApi,
  ticketAnalytics: ticketAnalyticsApi,
  ticketTimeline: ticketTimelineApi,
  ticketRecovery: ticketRecoveryApi,
  ticketStartup: ticketStartupApi,
};
