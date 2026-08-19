'use strict';

/**
 * Canonical Tickets core layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketDefaultsApi;
let ticketStoreApi;

// ============================================================================
// ticketDefaults
// ============================================================================
{
  'use strict';

  /*
  |--------------------------------------------------------------------------
  | Ticket Types
  |--------------------------------------------------------------------------
  */

  const TICKET_TYPES = {
    SUPPORT: 'support',
    APPEAL: 'appeal',
    REPORT: 'report',
    APPLICATION: 'application',
    STAFF: 'staff',
    OTHER: 'other',
  };

  /*
  |--------------------------------------------------------------------------
  | Ticket Priority
  |--------------------------------------------------------------------------
  */

  const TICKET_PRIORITY = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent',
  };

  /*
  |--------------------------------------------------------------------------
  | Ticket Status
  |--------------------------------------------------------------------------
  */

  const TICKET_STATUS = {
    OPEN: 'open',
    CLAIMED: 'claimed',
    WAITING_USER: 'waiting_user',
    IN_REVIEW: 'in_review',
    APPROVED: 'approved',
    DENIED: 'denied',
    CLOSED: 'closed',
    ARCHIVED: 'archived',
    DELETED: 'deleted',
  };

  /*
  |--------------------------------------------------------------------------
  | Ticket Sources
  |--------------------------------------------------------------------------
  */

  const TICKET_SOURCE = {
    DISCORD_PANEL: 'discord_panel',
    DISCORD_COMMAND: 'discord_command',
    WEB_PORTAL: 'web_portal',
    FORM_SUBMISSION: 'form_submission',
    API: 'api',
    AUTOMATION: 'automation',
  };

  const TICKET_TIMELINE_EVENTS = Object.freeze({
    CREATED: 'ticket_created', CLAIMED: 'ticket_claimed', CLOSED: 'ticket_closed',
    REOPENED: 'ticket_reopened', ARCHIVED: 'ticket_archived', DELETED: 'ticket_deleted',
    STATUS_CHANGED: 'ticket_status_changed', PRIORITY_CHANGED: 'ticket_priority_changed',
    ASSIGNED: 'ticket_assigned', USER_ADDED: 'ticket_user_added', USER_REMOVED: 'ticket_user_removed',
    NOTE_ADDED: 'ticket_note_added', STAFF_ACTIVITY: 'ticket_staff_activity',
    DISCORD_CHANNEL_CREATED: 'discord_channel_created', DISCORD_CHANNEL_CLOSED: 'discord_channel_closed',
    DISCORD_CHANNEL_REOPENED: 'discord_channel_reopened', DISCORD_CHANNEL_ARCHIVED: 'discord_channel_archived',
    DISCORD_CHANNEL_DELETED: 'discord_channel_deleted', TRANSCRIPT_CREATED: 'ticket_transcript_created',
    TRANSCRIPT_UPLOADED: 'ticket_transcript_uploaded', SYSTEM: 'ticket_system',
  });

  /*
  |--------------------------------------------------------------------------
  | SLA Defaults
  |--------------------------------------------------------------------------
  */

  const DEFAULT_SLA = {
    low: 1440,     // 24h
    normal: 720,   // 12h
    high: 120,     // 2h
    urgent: 15,    // 15m
  };

  /*
  |--------------------------------------------------------------------------
  | Reminder Defaults
  |--------------------------------------------------------------------------
  */

  const DEFAULT_REMINDERS = {
    enabled: true,

    repeat: true,
    repeatMinutes: 60,

    escalationMinutes: 60,

    pingRoleIds: [],
    escalationRoleIds: [],
  };

  /*
  |--------------------------------------------------------------------------
  | Default Ticket Settings
  |--------------------------------------------------------------------------
  */

  const DEFAULT_TICKET_SETTINGS = {
    enabled: true,

    numbering: {
      nextNumber: 1,
      prefix: 'ticket',
      padding: 4,
    },

    tickets: {
      enabled: true,

      createPrivateChannels: true,

      maxActiveTicketsPerUser: 5,

      defaultPriority: TICKET_PRIORITY.LOW,

      defaultCooldownMs: 60 * 1000,

      allowUserClose: false,
      allowUserAddMembers: false,
    },

    permissions: {
      administratorOverride: true,

      staffRoles: [],
      managerRoles: [],
      viewerRoles: [],
    },

    transcripts: {
      enabled: true,

      saveOnClose: true,
      saveOnArchive: true,
      saveOnDelete: true,

      transcriptChannelId: null,
    },

    analytics: {
      enabled: true,
    },
  };

  /*
  |--------------------------------------------------------------------------
  | Default Ticket Panel
  |--------------------------------------------------------------------------
  */

  const DEFAULT_TICKET_PANEL = {
    enabled: true,

    deployed: false,
    status: 'draft',

    name: 'Support Panel',

    ticketType: TICKET_TYPES.SUPPORT,
    ticketPriority: TICKET_PRIORITY.LOW,

    /*
    |--------------------------------------------------------------------------
    | Limits
    |--------------------------------------------------------------------------
    */

    maxOpenTicketsPerUser: 2,

    maxActiveTicketsPerUser: 2,

    oneActivePerType: true,

    cooldownMs: 60 * 1000,

    /*
    |--------------------------------------------------------------------------
    | Routing
    |--------------------------------------------------------------------------
    */

    outputCategoryId: null,
    archiveCategoryId: null,

    logsChannelId: null,
    transcriptsChannelId: null,

    /*
    |--------------------------------------------------------------------------
    | Roles
    |--------------------------------------------------------------------------
    */

    staffRoleIds: [],
    managerRoleIds: [],
    viewerRoleIds: [],

    allowedRoleIds: [],
    blockedRoleIds: [],

    /*
    |--------------------------------------------------------------------------
    | Behaviour
    |--------------------------------------------------------------------------
    */

    createPrivateChannel: true,

    useThreads: false,

    autoAssignStaff: false,

    allowUserClose: false,
    allowUserAddMembers: false,

    autoCloseEnabled: false,
    autoCloseHours: 72,

    autoArchiveEnabled: false,
    autoArchiveHours: 72,

    priorityIndicators: true,

    dmCreatorOnOpen: true,
    dmCreatorOnClose: true,

    notifyStaffOnOpen: true,

    /*
    |--------------------------------------------------------------------------
    | SLA
    |--------------------------------------------------------------------------
    */

    sla: {
      ...DEFAULT_SLA,
    },

    /*
    |--------------------------------------------------------------------------
    | Reminders
    |--------------------------------------------------------------------------
    */

    reminders: {
      ...DEFAULT_REMINDERS,
    },

    /*
    |--------------------------------------------------------------------------
    | Appearance
    |--------------------------------------------------------------------------
    */

    appearance: {
      title: 'Need Support?',
      description:
        'Press the button below to open a private support ticket.',

      color: '#5865F2',

      buttonLabel: 'Open Support Ticket',
      buttonEmoji: '🎫',

      imageUrl: null,
      thumbnailUrl: null,

      footerText: 'Goliath • Ticket System',
    },

    buttonStyle: 'Primary',

    /*
    |--------------------------------------------------------------------------
    | Analytics
    |--------------------------------------------------------------------------
    */

    analytics: {
      opens: 0,
      closes: 0,
      claims: 0,
      archives: 0,
      averageCloseTimeMs: 0,
    },

    metadata: {},
  };

  /*
  |--------------------------------------------------------------------------
  | Utility Helpers
  |--------------------------------------------------------------------------
  */

  function createDefaultPanel(overrides = {}) {
    return {
      ...DEFAULT_TICKET_PANEL,

      ...overrides,

      appearance: {
        ...DEFAULT_TICKET_PANEL.appearance,
        ...(overrides.appearance || {}),
      },

      sla: {
        ...DEFAULT_SLA,
        ...(overrides.sla || {}),
      },

      reminders: {
        ...DEFAULT_REMINDERS,
        ...(overrides.reminders || {}),
      },

      analytics: {
        ...DEFAULT_TICKET_PANEL.analytics,
        ...(overrides.analytics || {}),
      },

      metadata: {
        ...DEFAULT_TICKET_PANEL.metadata,
        ...(overrides.metadata || {}),
      },
    };
  }

  ticketDefaultsApi = {
    TICKET_TYPES,
    TICKET_PRIORITY,
    TICKET_STATUS,
    TICKET_SOURCE,
    TICKET_TIMELINE_EVENTS,

    DEFAULT_SLA,
    DEFAULT_REMINDERS,

    DEFAULT_TICKET_SETTINGS,
    DEFAULT_TICKET_PANEL,

    createDefaultPanel,
  };
}

// ============================================================================
// ticketStore
// ============================================================================
{
  const crypto = require('crypto');

  const {
    getGuildSection,
    saveGuildSection,
    updateGuildSection,
  } = require('../../../core/guild/guildManager');
  const planLimitManager = require('../../../core/billing/planLimitManager');

  const {
    DEFAULT_TICKET_SETTINGS,
  } = ticketDefaultsApi;

  function now() {
    return new Date().toISOString();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? [...new Set(value.filter(Boolean))] : [];
  }

  function asObject(value, fallback = {}) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : fallback;
  }

  function asNumber(value, fallback = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return number;
  }

  function asNonNegativeInt(value, fallback = 0) {
    const number = asNumber(value, fallback);

    if (number < 0) {
      return fallback;
    }

    return Math.floor(number);
  }

  function normaliseStatus(status = 'open') {
    return String(status || 'open').toLowerCase();
  }

  function normalisePriority(priority = 'low') {
    const value = String(priority || 'low').toLowerCase();

    if (['low', 'normal', 'high', 'urgent'].includes(value)) {
      return value;
    }

    return 'low';
  }

  function normaliseTicketType(type = 'support') {
    return (
      String(type || 'support')
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'support'
    );
  }

  function defaultTicketSection() {
    return {
      settings: clone(DEFAULT_TICKET_SETTINGS),
      panels: [],
      tickets: [],
      analytics: {},
    };
  }

  function normalizeTicketSection(section = {}) {
    const base = defaultTicketSection();

    return {
      ...base,
      ...(section || {}),

      settings: {
        ...base.settings,
        ...(section.settings || {}),
        numbering: {
          ...(base.settings?.numbering || {}),
          ...(section.settings?.numbering || {}),
        },
        tickets: {
          ...(base.settings?.tickets || {}),
          ...(section.settings?.tickets || {}),
        },
        permissions: {
          ...(base.settings?.permissions || {}),
          ...(section.settings?.permissions || {}),
        },
        transcripts: {
          ...(base.settings?.transcripts || {}),
          ...(section.settings?.transcripts || {}),
        },
        analytics: {
          ...(base.settings?.analytics || {}),
          ...(section.settings?.analytics || {}),
        },
      },

      panels: Array.isArray(section.panels)
        ? section.panels.map(normalizePanel)
        : [],

      tickets: Array.isArray(section.tickets)
        ? section.tickets.map(normalizeTicket)
        : [],

      analytics: asObject(section.analytics, {}),
    };
  }

  function normalizeTicket(ticket = {}) {
    const createdAt = ticket.createdAt || now();

    return {
      ...ticket,
      ticketId: ticket.ticketId || ticket.id || crypto.randomUUID(),
      guildId: ticket.guildId || null,
      number: asNonNegativeInt(ticket.number ?? ticket.ticketNumber ?? 0, 0),
      ticketNumber: asNonNegativeInt(ticket.ticketNumber ?? ticket.number ?? 0, 0),
      displayId: ticket.displayId || ticket.metadata?.displayId || null,
      creatorId: ticket.creatorId || ticket.userId || ticket.createdBy || null,
      userId: ticket.userId || ticket.creatorId || ticket.createdBy || null,
      createdBy: ticket.createdBy || ticket.creatorId || ticket.userId || null,
      type: normaliseTicketType(ticket.type || 'support'),
      title: ticket.title || 'Untitled Ticket',
      description: ticket.description || '',
      status: normaliseStatus(ticket.status || 'open'),
      priority: normalisePriority(ticket.priority || 'low'),
      source: ticket.source || null,
      sourceId: ticket.sourceId || null,
      formSubmissionId: ticket.formSubmissionId || null,
      moderationCaseId: ticket.moderationCaseId || null,
      securityIncidentId: ticket.securityIncidentId || null,
      discordChannelId: ticket.discordChannelId || ticket.channelId || null,
      channelId: ticket.channelId || ticket.discordChannelId || null,
      discordMessageId: ticket.discordMessageId || ticket.messageId || null,
      messageId: ticket.messageId || ticket.discordMessageId || null,
      claimedById: ticket.claimedById || null,
      claimedAt: ticket.claimedAt || null,
      reopenedById: ticket.reopenedById || null,
      reopenedAt: ticket.reopenedAt || null,
      closedById: ticket.closedById || null,
      closedAt: ticket.closedAt || null,
      closeReason: ticket.closeReason || null,
      archivedById: ticket.archivedById || null,
      archivedAt: ticket.archivedAt || null,
      archiveReason: ticket.archiveReason || null,
      deletedById: ticket.deletedById || null,
      deletedAt: ticket.deletedAt || null,
      assignedStaffIds: asArray(ticket.assignedStaffIds),
      allowedUserIds: asArray(ticket.allowedUserIds),
      notes: Array.isArray(ticket.notes) ? ticket.notes : [],
      timeline: Array.isArray(ticket.timeline) ? ticket.timeline : [],
      tags: asArray(ticket.tags),
      metadata: asObject(ticket.metadata, {}),
      analytics: asObject(ticket.analytics, {}),
      transcript: ticket.transcript || null,
      statusChangedAt: ticket.statusChangedAt || ticket.updatedAt || createdAt,
      createdAt,
      updatedAt: ticket.updatedAt || createdAt,
    };
  }

  function defaultPanelAppearance(panel = {}) {
    const type = normaliseTicketType(panel.ticketType || panel.type || 'support');

    let title = 'Open a Ticket';
    let description = 'Need help? Open a ticket and our staff team will assist you.';
    let buttonLabel = 'Open Ticket';
    let buttonEmoji = '🎫';

    if (type === 'support') {
      title = 'Need Support?';
      description = 'Press the button below to open a private support ticket.';
      buttonLabel = 'Open Support Ticket';
      buttonEmoji = '🎫';
    }

    if (type === 'appeal') {
      title = 'Submit an Appeal';
      description = 'Press the button below to open a private appeal ticket.';
      buttonLabel = 'Open Appeal Ticket';
      buttonEmoji = '⚖️';
    }

    if (type === 'report') {
      title = 'Submit a Report';
      description = 'Press the button below to report an issue privately.';
      buttonLabel = 'Open Report Ticket';
      buttonEmoji = '🚨';
    }

    if (type === 'application') {
      title = 'Submit an Application';
      description = 'Press the button below to open a private application ticket.';
      buttonLabel = 'Open Application Ticket';
      buttonEmoji = '📝';
    }

    return {
      title,
      description,
      color: '#5865F2',
      buttonLabel,
      buttonEmoji,
      imageUrl: null,
      thumbnailUrl: null,
      footerText: 'Goliath • Ticket System',
    };
  }

  function defaultPanelLimit(type) {
    const cleanType = normaliseTicketType(type);

    if (cleanType === 'appeal') return 1;
    if (cleanType === 'application') return 1;
    if (cleanType === 'report') return 3;

    return 2;
  }

  function normalizePanel(panel = {}) {
    const ticketType = normaliseTicketType(panel.ticketType || panel.type || 'support');
    const createdAt = panel.createdAt || now();
    const appearance = {
      ...defaultPanelAppearance({ ticketType }),
      ...asObject(panel.appearance, {}),
    };
    const maxOpenTicketsPerUser = asNonNegativeInt(
      panel.maxOpenTicketsPerUser ?? panel.maxActiveTicketsPerUser ?? defaultPanelLimit(ticketType),
      defaultPanelLimit(ticketType)
    );
    const cooldownMs = asNonNegativeInt(panel.cooldownMs ?? 60 * 1000, 60 * 1000);

    return {
      ...panel,
      panelId: panel.panelId || panel.id || `panel_${crypto.randomUUID()}`,
      id: panel.id || panel.panelId || null,
      guildId: panel.guildId || null,
      name: panel.name || `${ticketType.charAt(0).toUpperCase()}${ticketType.slice(1)} Panel`,
      enabled: panel.enabled !== false,
      deployed: panel.deployed === true,
      status: panel.status || (panel.deployed ? 'deployed' : 'draft'),
      deployChannelId: panel.deployChannelId || panel.channelId || null,
      channelId: panel.channelId || panel.deployChannelId || null,
      deployMessageId: panel.deployMessageId || panel.messageId || null,
      messageId: panel.messageId || panel.deployMessageId || null,
      lastDeployAt: panel.lastDeployAt || null,
      lastDeployById: panel.lastDeployById || null,
      ticketType,
      ticketPriority: normalisePriority(panel.ticketPriority || panel.priority || 'low'),
      outputCategoryId: panel.outputCategoryId || null,
      archiveCategoryId: panel.archiveCategoryId || null,
      logsChannelId: panel.logsChannelId || null,
      transcriptsChannelId: panel.transcriptsChannelId || null,
      staffRoleIds: asArray(panel.staffRoleIds),
      managerRoleIds: asArray(panel.managerRoleIds),
      viewerRoleIds: asArray(panel.viewerRoleIds),
      allowedRoleIds: asArray(panel.allowedRoleIds),
      blockedRoleIds: asArray(panel.blockedRoleIds),
      allowUserClose: panel.allowUserClose === true,
      allowUserAddMembers: panel.allowUserAddMembers === true,
      autoAssignStaff: panel.autoAssignStaff === true,
      autoCloseEnabled: panel.autoCloseEnabled === true,
      autoCloseHours: asNonNegativeInt(panel.autoCloseHours ?? 72, 72),
      autoArchiveEnabled: panel.autoArchiveEnabled === true,
      autoArchiveHours: asNonNegativeInt(panel.autoArchiveHours ?? 72, 72),
      createPrivateChannel: panel.createPrivateChannel !== false,
      useThreads: panel.useThreads === true,
      oneActivePerType: panel.oneActivePerType !== false,
      maxOpenTicketsPerUser,
      maxActiveTicketsPerUser: asNonNegativeInt(panel.maxActiveTicketsPerUser ?? maxOpenTicketsPerUser, maxOpenTicketsPerUser),
      cooldownMs,
      priorityIndicators: panel.priorityIndicators !== false,
      sla: {
        low: asNonNegativeInt(panel.sla?.low ?? 1440, 1440),
        normal: asNonNegativeInt(panel.sla?.normal ?? 720, 720),
        high: asNonNegativeInt(panel.sla?.high ?? 120, 120),
        urgent: asNonNegativeInt(panel.sla?.urgent ?? 15, 15),
      },
      reminders: {
        enabled: panel.reminders?.enabled !== false,
        repeat: panel.reminders?.repeat !== false,
        repeatMinutes: asNonNegativeInt(panel.reminders?.repeatMinutes ?? 60, 60),
        pingRoleIds: asArray(panel.reminders?.pingRoleIds),
        escalationRoleIds: asArray(panel.reminders?.escalationRoleIds),
        escalationMinutes: asNonNegativeInt(panel.reminders?.escalationMinutes ?? 60, 60),
      },
      dmCreatorOnOpen: panel.dmCreatorOnOpen !== false,
      dmCreatorOnClose: panel.dmCreatorOnClose !== false,
      notifyStaffOnOpen: panel.notifyStaffOnOpen !== false,
      linkedFormId: panel.linkedFormId || null,
      appearance,
      buttonStyle: panel.buttonStyle || 'Primary',
      analytics: {
        opens: 0,
        closes: 0,
        claims: 0,
        archives: 0,
        averageCloseTimeMs: 0,
        ...asObject(panel.analytics, {}),
      },
      tags: asArray(panel.tags),
      metadata: asObject(panel.metadata, {}),
      createdAt,
      updatedAt: panel.updatedAt || createdAt,
    };
  }

  function getTicketSection(guildId) {
    const section = getGuildSection(guildId, 'tickets', defaultTicketSection());
    return normalizeTicketSection(section);
  }

  function saveTicketSection(guildId, section = {}) {
    const normalized = normalizeTicketSection(section);
    saveGuildSection(guildId, 'tickets', normalized);
    return normalized;
  }

  function assertTicketPanelLimitForNewPanel(guildId, currentCount) {
    return planLimitManager.assertCanCreateResource(guildId, 'ticketPanels', currentCount, {
      upgradeHint: 'Upgrade to Plus for 15 ticket panels or Pro for unlimited ticket panels.',
    });
  }

  function assertTicketPanelLimitForTotal(guildId, nextTotal) {
    const check = planLimitManager.canCreateResource(guildId, 'ticketPanels', Math.max(Number(nextTotal || 0) - 1, 0));
    if (!check.allowed) {
      throw planLimitManager.createLimitError(check, {
        upgradeHint: 'Upgrade to Plus for 15 ticket panels or Pro for unlimited ticket panels.',
      });
    }
    return check;
  }

  function bootstrapGuildTickets(guildId) {
    const section = getTicketSection(guildId);
    saveTicketSection(guildId, section);
    return section;
  }

  function getAllTickets(guildId) {
    return getTicketSection(guildId).tickets;
  }

  function getTicket(guildId, ticketId) {
    return (
      getAllTickets(guildId).find(
        (ticket) =>
          ticket.ticketId === ticketId ||
          ticket.id === ticketId ||
          ticket.displayId === ticketId
      ) || null
    );
  }

  function saveTickets(guildId, data = {}) {
    return updateGuildSection(
      guildId,
      'tickets',
      (section) => ({
        ...normalizeTicketSection(section),
        tickets: Array.isArray(data.tickets) ? data.tickets.map(normalizeTicket) : [],
      }),
      defaultTicketSection()
    );
  }

  function createTicket(guildId, ticketData = {}) {
    const section = getTicketSection(guildId);
    const nextNumber = asNonNegativeInt(section.settings?.numbering?.nextNumber || 1, 1);
    const ticket = normalizeTicket({
      ...ticketData,
      guildId,
      number: ticketData.number || nextNumber,
      ticketNumber: ticketData.ticketNumber || ticketData.number || nextNumber,
    });

    if (!ticket.displayId) {
      const padding = asNonNegativeInt(section.settings?.numbering?.padding || 4, 4);
      ticket.displayId = `${ticket.type}-${String(ticket.number).padStart(padding, '0')}`;
      ticket.metadata = {
        ...(ticket.metadata || {}),
        displayId: ticket.displayId,
      };
    }

    section.tickets.push(ticket);
    section.settings.numbering = {
      ...(section.settings.numbering || {}),
      nextNumber: nextNumber + 1,
    };

    saveTicketSection(guildId, section);
    return ticket;
  }

  function updateTicket(guildId, ticketId, updates = {}) {
    const section = getTicketSection(guildId);
    const index = section.tickets.findIndex(
      (ticket) => ticket.ticketId === ticketId || ticket.id === ticketId || ticket.displayId === ticketId
    );

    if (index === -1) return null;

    const existing = normalizeTicket(section.tickets[index]);
    const updated = normalizeTicket({
      ...existing,
      ...updates,
      metadata: {
        ...(existing.metadata || {}),
        ...(updates.metadata || {}),
      },
      analytics: {
        ...(existing.analytics || {}),
        ...(updates.analytics || {}),
      },
      updatedAt: now(),
    });

    section.tickets[index] = updated;
    saveTicketSection(guildId, section);
    return updated;
  }

  function deleteTicket(guildId, ticketId) {
    const section = getTicketSection(guildId);
    const before = section.tickets.length;

    section.tickets = section.tickets.filter(
      (ticket) => ticket.ticketId !== ticketId && ticket.id !== ticketId && ticket.displayId !== ticketId
    );

    const changed = before !== section.tickets.length;
    if (changed) saveTicketSection(guildId, section);
    return changed;
  }

  function getTicketSettings(guildId) {
    return getTicketSection(guildId).settings;
  }

  function saveTicketSettings(guildId, settings = {}) {
    const section = getTicketSection(guildId);
    section.settings = {
      ...(section.settings || {}),
      ...(settings || {}),
      updatedAt: now(),
    };
    saveTicketSection(guildId, section);
    return section.settings;
  }

  function incrementTicketNumber(guildId) {
    const section = getTicketSection(guildId);

    if (!section.settings.numbering) {
      section.settings.numbering = {
        nextNumber: 1,
        prefix: 'ticket',
        padding: 4,
      };
    }

    section.settings.numbering.nextNumber = asNonNegativeInt(section.settings.numbering.nextNumber || 1, 1) + 1;
    saveTicketSection(guildId, section);
    return section.settings.numbering.nextNumber;
  }

  function getPanels(guildId) {
    const section = getTicketSection(guildId);
    return { panels: section.panels.map(normalizePanel) };
  }

  function savePanels(guildId, data = {}) {
    const section = getTicketSection(guildId);
    const nextPanels = Array.isArray(data.panels)
      ? data.panels.map((panel) => normalizePanel({ ...panel, guildId }))
      : [];

    if (nextPanels.length > section.panels.length) {
      assertTicketPanelLimitForTotal(guildId, nextPanels.length);
    }

    section.panels = nextPanels;
    saveTicketSection(guildId, section);
    return true;
  }

  function getPanel(guildId, panelId) {
    return (
      getPanels(guildId).panels.find(
        (panel) => panel.panelId === panelId || panel.id === panelId
      ) || null
    );
  }

  function createPanel(guildId, panelData = {}) {
    const section = getTicketSection(guildId);
    const panel = normalizePanel({
      ...panelData,
      guildId,
      createdAt: panelData.createdAt || now(),
      updatedAt: now(),
    });
    const existingIndex = section.panels.findIndex(
      (existingPanel) => existingPanel.panelId === panel.panelId || existingPanel.id === panel.panelId
    );

    if (existingIndex !== -1) {
      section.panels[existingIndex] = normalizePanel({
        ...section.panels[existingIndex],
        ...panel,
        guildId,
        updatedAt: now(),
      });
      saveTicketSection(guildId, section);
      return section.panels[existingIndex];
    }

    assertTicketPanelLimitForNewPanel(guildId, section.panels.length);
    section.panels.push(panel);
    saveTicketSection(guildId, section);
    return panel;
  }

  function updatePanel(guildId, panelId, updates = {}) {
    const section = getTicketSection(guildId);
    const index = section.panels.findIndex((panel) => panel.panelId === panelId || panel.id === panelId);
    if (index === -1) return null;

    const existing = normalizePanel(section.panels[index]);
    const updated = normalizePanel({
      ...existing,
      ...updates,
      guildId,
      appearance: {
        ...(existing.appearance || {}),
        ...(updates.appearance || {}),
      },
      sla: {
        ...(existing.sla || {}),
        ...(updates.sla || {}),
      },
      reminders: {
        ...(existing.reminders || {}),
        ...(updates.reminders || {}),
      },
      metadata: {
        ...(existing.metadata || {}),
        ...(updates.metadata || {}),
      },
      analytics: {
        ...(existing.analytics || {}),
        ...(updates.analytics || {}),
      },
      updatedAt: now(),
    });

    section.panels[index] = updated;
    saveTicketSection(guildId, section);
    return updated;
  }

  function deletePanel(guildId, panelId) {
    const section = getTicketSection(guildId);
    const before = section.panels.length;
    section.panels = section.panels.filter((panel) => panel.panelId !== panelId && panel.id !== panelId);
    const changed = before !== section.panels.length;
    if (changed) saveTicketSection(guildId, section);
    return changed;
  }

  function markPanelDeployed(guildId, panelId, deployData = {}) {
    return updatePanel(guildId, panelId, {
      deployed: true,
      status: 'deployed',
      deployChannelId: deployData.deployChannelId || deployData.channelId || null,
      channelId: deployData.channelId || deployData.deployChannelId || null,
      deployMessageId: deployData.deployMessageId || deployData.messageId || null,
      messageId: deployData.messageId || deployData.deployMessageId || null,
      lastDeployAt: now(),
      lastDeployById: deployData.actorId || null,
    });
  }

  function markPanelUndeployed(guildId, panelId) {
    return updatePanel(guildId, panelId, {
      deployed: false,
      status: 'draft',
      deployChannelId: null,
      channelId: null,
      deployMessageId: null,
      messageId: null,
    });
  }

  function clearTicketCache() {
    return true;
  }

  function reloadGuildTickets(guildId) {
    return {
      tickets: getAllTickets(guildId),
      settings: getTicketSettings(guildId),
      panels: getPanels(guildId).panels,
    };
  }

  ticketStoreApi = {
    bootstrapGuildTickets,
    getAllTickets,
    getTicket,
    createTicket,
    updateTicket,
    deleteTicket,
    saveTickets,
    getTicketSettings,
    saveTicketSettings,
    incrementTicketNumber,
    getPanels,
    savePanels,
    getPanel,
    createPanel,
    updatePanel,
    deletePanel,
    markPanelDeployed,
    markPanelUndeployed,
    clearTicketCache,
    reloadGuildTickets,
    normalizeTicket,
    normalizePanel,
    normalizeTicketSection,
  };
}

const coreApi = {
  ...ticketDefaultsApi,
  ...ticketStoreApi,
  ticketDefaults: ticketDefaultsApi,
  ticketStore: ticketStoreApi,
};

// Publish persistence/defaults before loading dependent layers.
module.exports = coreApi;

const lifecycle = require('./ticketsLifecycle');
const channels = require('./ticketsChannels');
const panel = require('./ticketsPanel');
const transcripts = require('./ticketsTranscripts');
const tracking = require('./ticketsTracking');
const interactions = require('./ticketsInteractions');
const health = require('./ticketsHealth');

function getOverview(guildId) {
  const ticketList = typeof lifecycle.getGuildTickets === 'function'
    ? lifecycle.getGuildTickets(guildId)
    : typeof coreApi.getAllTickets === 'function'
      ? coreApi.getAllTickets(guildId)
      : [];
  const panelData = typeof coreApi.getPanels === 'function' ? coreApi.getPanels(guildId) : { panels: [] };
  const panelList = Array.isArray(panelData?.panels) ? panelData.panels : [];
  const statusCounts = ticketList.reduce((counts, ticket) => {
    const status = String(ticket?.status || 'open').toLowerCase();
    counts[status] = Number(counts[status] || 0) + 1;
    return counts;
  }, {});

  return {
    enabled: true,
    tickets: {
      total: ticketList.length,
      open: statusCounts.open || 0,
      claimed: statusCounts.claimed || 0,
      closed: statusCounts.closed || 0,
      archived: statusCounts.archived || 0,
      deleted: statusCounts.deleted || 0,
    },
    panels: {
      total: panelList.length,
      deployed: panelList.filter((item) => Boolean(
        item?.deployed
        || (item?.deployChannelId && item?.deployMessageId)
        || (item?.channelId && item?.messageId)
      )).length,
    },
    settings: typeof coreApi.getTicketSettings === 'function' ? coreApi.getTicketSettings(guildId) : {},
  };
}

Object.assign(module.exports, lifecycle, {
  getOverview,
  buildHealthReport: health.buildHealthReport,
  repairPanel: health.repairPanel,
  repairAll: health.repairAll,
  handleTicketInteraction: interactions.handleTicketInteraction,
  core: coreApi,
  lifecycle,
  channels,
  panel,
  transcripts,
  tracking,
  interactions,
  health,
  startup: tracking,
});
