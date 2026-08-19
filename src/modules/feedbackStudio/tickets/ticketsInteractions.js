'use strict';

/**
 * Canonical Tickets interactions layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketActionsApi;
let ticketInteractionHandlerApi;

// ============================================================================
// ticketActions
// ============================================================================
{
  const {
    EmbedBuilder,
  } = require('discord.js');

  const ticketManager = require('./ticketsLifecycle');
  const ticketTimeline = require('./ticketsTracking');
  const ticketTranscriptManager = require('./ticketsTranscripts');
  const ticketSocketEvents = require('./ticketsTracking');
  const emojis = require('../../utilityStudio/emojis/emojis');

  const {
    getTicket,
    updateTicket,
    deleteTicket: deleteStoredTicket,
    getPanel,
  } = require('./tickets');

  const {
    buildTicketChannelName,
    closeTicketChannel,
    archiveTicketChannel,
    reopenTicketChannel,
    deleteTicketChannel,
    syncTicketChannelPermissions,
  } = require('./ticketsChannels');

  const {
    getTicketActionRows,
    getClosedTicketActionRows,
    getArchivedTicketActionRows,
  } = require('./ticketsPanel');

  const {
    sendTicketControlMessage,
  } = require('./ticketsPanel');

  const STATUS = {
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

  const PRIORITY = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent',
  };

  const PRIORITY_LABELS = {
    low: 'Low',
    normal: 'Normal',
    high: 'High',
    urgent: 'Urgent',
  };

  function now() {
    return new Date().toISOString();
  }

  function normaliseStatus(status) {
    return String(status || STATUS.OPEN).toLowerCase();
  }

  function normalisePriority(priority) {
    const value = String(priority || PRIORITY.NORMAL).toLowerCase();

    if (Object.values(PRIORITY).includes(value)) {
      return value;
    }

    return PRIORITY.NORMAL;
  }

  function getActor(actor) {
    if (!actor) {
      return {
        id: null,
        tag: 'System',
      };
    }

    return {
      id: actor.id || actor.user?.id || null,
      tag:
        actor.tag ||
        actor.user?.tag ||
        actor.username ||
        actor.user?.username ||
        'Unknown Staff',
    };
  }

  async function fetchTicket(ticketOrId, guildId = null) {
    if (!ticketOrId) {
      throw new Error('Missing ticket.');
    }

    if (typeof ticketOrId === 'object') {
      return ticketOrId;
    }

    if (!guildId) {
      throw new Error('Missing guild id.');
    }

    const ticket = getTicket(guildId, ticketOrId);

    if (!ticket) {
      throw new Error('Ticket not found.');
    }

    return ticket;
  }

  async function saveTicket(ticket, updates = {}) {
    if (!ticket?.guildId || !ticket?.ticketId) {
      throw new Error('Invalid ticket.');
    }

    return updateTicket(
      ticket.guildId,
      ticket.ticketId,
      {
        ...updates,
        updatedAt: now(),
      }
    );
  }

  function getTicketPanel(ticket) {
    if (!ticket?.guildId) return null;

    const panelId =
      ticket.metadata?.panelId ||
      ticket.panelId ||
      ticket.sourceId ||
      null;

    if (!panelId) return null;

    return getPanel(ticket.guildId, panelId);
  }

  function emitAction(io, ticket, event, payload = {}) {
    if (!io || !ticket?.guildId) return false;

    return ticketSocketEvents.emitForTicket(
      io,
      ticket,
      event,
      payload
    );
  }

  async function addStaffActivity(
    ticket,
    actor,
    type,
    message,
    metadata = {}
  ) {
    if (!ticket?.guildId || !ticket?.ticketId) {
      return false;
    }

    try {
      await ticketTimeline.addTimelineEntry(
        ticket.guildId,
        ticket.ticketId,
        {
          type,
          actorId: getActor(actor).id,
          actorTag: getActor(actor).tag,
          message,
          metadata,
        }
      );

      return true;
    } catch {
      return false;
    }
  }

  async function getGuildFromClient(client, guildId) {
    if (!client || !guildId) return null;

    return client.guilds
      .fetch(guildId)
      .catch(() => null);
  }

  async function getDiscordChannel(client, ticket) {
    if (!client || !ticket?.guildId || !ticket?.discordChannelId) {
      return null;
    }

    const guild = await getGuildFromClient(client, ticket.guildId);
    if (!guild) return null;

    return guild.channels
      .fetch(ticket.discordChannelId)
      .catch(() => null);
  }

  async function refreshTicketControlMessage(client, ticket) {
    if (!client || !ticket?.guildId || !ticket?.discordChannelId) {
      return false;
    }

    const guild = await getGuildFromClient(client, ticket.guildId);
    if (!guild) return false;

    const channel = await guild.channels
      .fetch(ticket.discordChannelId)
      .catch(() => null);

    if (!channel) return false;

    const messageId =
      ticket.discordMessageId ||
      ticket.messageId ||
      null;

    let message = null;

    if (messageId) {
      message = await channel.messages
        .fetch(messageId)
        .catch(() => null);
    }

    if (!message) {
      const messages = await channel.messages
        .fetch({ limit: 20 })
        .catch(() => null);

      message = messages?.find(
        (msg) =>
          msg.author?.id === client.user?.id &&
          msg.embeds?.[0]?.title?.startsWith('🎫')
      );
    }

    if (!message?.editable) return false;

    const panel = getTicketPanel(ticket);

    const payload = await sendTicketControlMessage({
      channel: {
        send: async (data) => data,
      },
      ticket,
      panel,
      user: null,
    });

    let components = getTicketActionRows(ticket, {
      allowReopen: true,
      allowDelete: true,
    });

    const status = normaliseStatus(ticket.status);

    if (status === STATUS.CLOSED) {
      components = getClosedTicketActionRows(ticket, {
        allowDelete: true,
      });
    }

    if (status === STATUS.ARCHIVED) {
      components = getArchivedTicketActionRows(ticket, {
        allowDelete: true,
      });
    }

    await message.edit({
      content: payload.content != null
        ? await emojis.resolveText(client, ticket.guildId, payload.content)
        : undefined,
      embeds: await emojis.resolveEmbeds(
        client,
        ticket.guildId,
        payload.embeds || []
      ),
      components,
    });

    return true;
  }

  async function createTranscript(ticket, actor, options = {}) {
    if (!options.client || options.createTranscript === false) {
      return null;
    }

    try {
      const transcript =
        await ticketTranscriptManager.createAndUploadTranscript(
          options.client,
          ticket,
          {
            generatedBy: getActor(actor).id,
            reason: options.reason || 'Ticket action',
            channelId: options.transcriptChannelId,
            transcriptChannelId: options.transcriptChannelId,
            limit: options.transcriptLimit,
          }
        );

      if (transcript) {
        emitAction(
          options.io,
          ticket,
          ticketSocketEvents.EVENTS.TRANSCRIPT_CREATED,
          { transcript }
        );

        if (transcript.upload?.uploaded) {
          emitAction(
            options.io,
            ticket,
            ticketSocketEvents.EVENTS.TRANSCRIPT_UPLOADED,
            {
              upload: transcript.upload,
            }
          );
        }
      }

      return transcript;
    } catch (error) {
      console.error(
        '[TicketActions] Failed to create transcript:',
        error
      );

      return {
        error: true,
        message: error.message,
      };
    }
  }

  async function maybeSyncPermissions(ticket, options = {}) {
    if (!options.client) return false;

    const guild = await getGuildFromClient(options.client, ticket.guildId);
    if (!guild) return false;

    const channel = await getDiscordChannel(options.client, ticket);
    if (!channel) return false;

    const panel = getTicketPanel(ticket);

    return syncTicketChannelPermissions({
      guild,
      channel,
      ticket,
      panel,
    });
  }

  async function maybeCloseChannel(ticket, options = {}) {
    if (!options.client) return null;

    const channel = await getDiscordChannel(options.client, ticket);
    if (!channel) return null;

    const guild = channel.guild;
    const panel = getTicketPanel(ticket);

    return closeTicketChannel({
      guild,
      channel,
      ticket,
      panel,
      actorId: options.actorId || null,
    });
  }

  async function maybeArchiveChannel(ticket, options = {}) {
    if (!options.client) return null;

    const channel = await getDiscordChannel(options.client, ticket);
    if (!channel) return null;

    const guild = channel.guild;
    const panel = getTicketPanel(ticket);

    return archiveTicketChannel({
      guild,
      channel,
      ticket,
      panel,
      actorId: options.actorId || null,
    });
  }

  async function maybeReopenChannel(ticket, options = {}) {
    if (!options.client) return null;

    const channel = await getDiscordChannel(options.client, ticket);
    if (!channel) return null;

    const guild = channel.guild;
    const panel = getTicketPanel(ticket);

    return reopenTicketChannel({
      guild,
      channel,
      ticket,
      panel,
      actorId: options.actorId || null,
    });
  }

  async function maybeDeleteChannel(ticket, options = {}) {
    if (!options.client) return null;

    const channel = await getDiscordChannel(options.client, ticket);
    if (!channel) return null;

    const guild = channel.guild;

    return deleteTicketChannel({
      guild,
      channel,
      ticket,
      actorId: options.actorId || null,
    });
  }

  async function claim(ticketOrId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);

    if (normaliseStatus(ticket.status) === STATUS.ARCHIVED) {
      throw new Error('Archived tickets cannot be claimed.');
    }

    if (normaliseStatus(ticket.status) === STATUS.CLOSED) {
      throw new Error('Closed tickets cannot be claimed.');
    }

    if (ticket.claimedById) {
      return ticket;
    }

    const updated = await saveTicket(ticket, {
      status: STATUS.CLAIMED,
      claimedById: actorData.id,
      claimedAt: now(),
      statusChangedAt: now(),
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_claimed',
      `Ticket claimed by ${actorData.tag}.`,
      {
        claimedById: actorData.id,
      }
    );

    await maybeSyncPermissions(updated, options);

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_CLAIMED,
      {
        actorId: actorData.id,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function close(ticketOrId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);
    const currentStatus = normaliseStatus(ticket.status);

    if (currentStatus === STATUS.CLOSED) {
      return ticket;
    }

    if (currentStatus === STATUS.ARCHIVED) {
      throw new Error('Archived tickets cannot be closed.');
    }

    const updated = await saveTicket(ticket, {
      status: STATUS.CLOSED,
      closedById: actorData.id,
      closedAt: now(),
      closeReason: options.reason || null,
      statusChangedAt: now(),
    });

    await createTranscript(updated, actor, {
      ...options,
      reason: options.reason || 'Ticket closed',
    });

    await maybeCloseChannel(updated, {
      ...options,
      actorId: actorData.id,
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_closed',
      `Ticket closed by ${actorData.tag}.`,
      {
        reason: options.reason || null,
      }
    );

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_CLOSED,
      {
        actorId: actorData.id,
        reason: options.reason || null,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function archive(ticketOrId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);
    const currentStatus = normaliseStatus(ticket.status);

    if (currentStatus === STATUS.ARCHIVED) {
      return ticket;
    }

    const updated = await saveTicket(ticket, {
      status: STATUS.ARCHIVED,
      archivedById: actorData.id,
      archivedAt: now(),
      archiveReason: options.reason || null,
      statusChangedAt: now(),
    });

    await createTranscript(updated, actor, {
      ...options,
      reason: options.reason || 'Ticket archived',
    });

    await maybeArchiveChannel(updated, {
      ...options,
      actorId: actorData.id,
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_archived',
      `Ticket archived by ${actorData.tag}.`,
      {
        reason: options.reason || null,
      }
    );

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_ARCHIVED,
      {
        actorId: actorData.id,
        reason: options.reason || null,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function reopen(ticketOrId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);
    const currentStatus = normaliseStatus(ticket.status);

    if (
      currentStatus !== STATUS.CLOSED &&
      currentStatus !== STATUS.ARCHIVED
    ) {
      return ticket;
    }

    const updated = await saveTicket(ticket, {
      status: STATUS.OPEN,
      reopenedById: actorData.id,
      reopenedAt: now(),
      closedById: null,
      closedAt: null,
      closeReason: null,
      archivedById: null,
      archivedAt: null,
      archiveReason: null,
      statusChangedAt: now(),
    });

    await maybeReopenChannel(updated, {
      ...options,
      actorId: actorData.id,
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_reopened',
      `Ticket reopened by ${actorData.tag}.`,
      {}
    );

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_REOPENED,
      {
        actorId: actorData.id,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function deleteTicket(ticketOrId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);

    await createTranscript(ticket, actor, {
      ...options,
      reason: options.reason || 'Ticket deleted',
    });

    await maybeDeleteChannel(ticket, {
      ...options,
      actorId: actorData.id,
    });

    await addStaffActivity(
      ticket,
      actor,
      'ticket_deleted',
      `Ticket deleted by ${actorData.tag}.`,
      {
        reason: options.reason || null,
      }
    );

    const updated = await saveTicket(ticket, {
      status: STATUS.DELETED,
      deletedById: actorData.id,
      deletedAt: now(),
      statusChangedAt: now(),
    });

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_DELETED,
      {
        actorId: actorData.id,
        reason: options.reason || null,
      }
    );

    if (options.hardDelete === true) {
      deleteStoredTicket(
        ticket.guildId,
        ticket.ticketId
      );
    }

    return updated;
  }

  async function setPriority(
    ticketOrId,
    priority,
    actor,
    options = {}
  ) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);
    const cleanPriority = normalisePriority(priority);
    const previousPriority = normalisePriority(ticket.priority);

    if (previousPriority === cleanPriority) {
      return ticket;
    }

    const updated = await saveTicket(ticket, {
      priority: cleanPriority,
      statusChangedAt: now(),
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_priority_changed',
      `Priority changed from ${PRIORITY_LABELS[previousPriority]} to ${PRIORITY_LABELS[cleanPriority]} by ${actorData.tag}.`,
      {
        previousPriority,
        priority: cleanPriority,
      }
    );

    const channel = await getDiscordChannel(options.client, updated);

    if (channel) {
      const panel = getTicketPanel(updated);

      await channel
        .setName(
          buildTicketChannelName(updated, channel.guild, panel)
        )
        .catch(() => null);
    }

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_UPDATED,
      {
        actorId: actorData.id,
        previousPriority,
        priority: cleanPriority,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function assign(ticketOrId, staffId, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);

    const assignedStaffIds = [
      ...new Set([
        ...(Array.isArray(ticket.assignedStaffIds)
          ? ticket.assignedStaffIds
          : []),
        staffId,
      ].filter(Boolean)),
    ];

    const updated = await saveTicket(ticket, {
      assignedStaffIds,
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_assigned',
      `Ticket assigned by ${actorData.tag}.`,
      {
        staffId,
      }
    );

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_UPDATED,
      {
        actorId: actorData.id,
        assignedStaffIds,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  async function addNote(ticketOrId, note, actor, options = {}) {
    const ticket = await fetchTicket(
      ticketOrId,
      options.guildId
    );

    const actorData = getActor(actor);

    const notes = Array.isArray(ticket.notes)
      ? [...ticket.notes]
      : [];

    notes.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      actorId: actorData.id,
      actorTag: actorData.tag,
      note: String(note || '').slice(0, 2000),
      createdAt: now(),
    });

    const updated = await saveTicket(ticket, {
      notes,
    });

    await addStaffActivity(
      updated,
      actor,
      'ticket_note_added',
      `Internal note added by ${actorData.tag}.`,
      {}
    );

    emitAction(
      options.io,
      updated,
      ticketSocketEvents.EVENTS.TICKET_UPDATED,
      {
        actorId: actorData.id,
      }
    );

    await refreshTicketControlMessage(options.client, updated);

    return updated;
  }

  ticketActionsApi = {
    STATUS,
    PRIORITY,
    PRIORITY_LABELS,

    claim,
    close,
    archive,
    reopen,
    deleteTicket,

    setPriority,
    assign,
    addNote,

    refreshTicketControlMessage,
    createTranscript,

    getTicketPanel,
    fetchTicket,
  };
}

// ============================================================================
// ticketInteractionHandler
// ============================================================================
{
  const {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    MessageFlags,
  } = require('discord.js');

  const ticketActions = ticketActionsApi;
  const ticketManager = require('./ticketsLifecycle');
  const ticketStore = require('./tickets');
  const ticketTranscriptManager = require('./ticketsTranscripts');
  const ticketPermissions = require('./ticketsChannels');
  const emojis = require('../../utilityStudio/emojis/emojis');

  const {
    handleTicketPanelButton,
    refreshDeployedPanel,
  } = require('./ticketsPanel');

  const {
    handleTicketSetupInteraction,
  } = require('./ticketsPanel');

  const {
    CUSTOM_IDS,
    isTicketButton,
    getTicketActionRows,
    getClosedTicketActionRows,
    getArchivedTicketActionRows,
  } = require('./ticketsPanel');

  const { TICKET_ACTIONS } = ticketPermissions;

  const MODAL_IDS = {
    CLOSE: 'goliath_ticket_close_modal',
    ADD_USER: 'goliath_ticket_add_user_modal',
    PANEL_APPEARANCE: 'goliath_ticket_panel_appearance_modal',
    DELETE_CONFIRM: 'goliath_ticket_delete_confirm_modal',
  };

  const INPUT_IDS = {
    CLOSE_REASON: 'close_reason',
    ADD_USER_ID: 'add_user_id',
    APPEARANCE_VALUE: 'appearance_value',
    DELETE_CONFIRM: 'delete_confirm',
  };

  const SELECT_IDS = {
    PRIORITY: 'goliath_ticket_priority_select',
  };

  const PRIORITY_LABELS = {
    low: 'Low',
    normal: 'Normal',
    high: 'High',
    urgent: 'Urgent',
  };

  function alreadyHandled(interaction) {
    return interaction.deferred || interaction.replied;
  }

  function ephemeralPayload(payload = {}) {
    return {
      ...payload,
      flags: MessageFlags.Ephemeral,
    };
  }

  function formatPriority(priority = 'normal') {
    const value = String(priority || 'normal').toLowerCase().trim();
    return PRIORITY_LABELS[value] || 'Normal';
  }

  function normalizePriority(priority = 'normal') {
    const value = String(priority || 'normal').toLowerCase().trim();

    if (Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, value)) {
      return value;
    }

    return 'normal';
  }

  async function resolveInteractionPayload(interaction, payload = {}) {
    if (!interaction?.client || !interaction?.guildId) return payload;

    const resolved = { ...payload };

    if (resolved.content != null) {
      resolved.content = await emojis.resolveText(
        interaction.client,
        interaction.guildId,
        resolved.content
      );
    }

    if (Array.isArray(resolved.embeds)) {
      resolved.embeds = await emojis.resolveEmbeds(
        interaction.client,
        interaction.guildId,
        resolved.embeds
      );
    }

    return resolved;
  }

  async function safeReply(interaction, payload = {}) {
    try {
      const resolvedPayload = await resolveInteractionPayload(interaction, payload);

      if (alreadyHandled(interaction)) {
        return interaction.followUp(resolvedPayload).catch(() => null);
      }

      return interaction.reply(resolvedPayload).catch(() => null);
    } catch {
      return null;
    }
  }

  async function safeEditOrReply(interaction, payload = {}) {
    try {
      const resolvedPayload = await resolveInteractionPayload(interaction, payload);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(resolvedPayload).catch(() => null);
      }

      return interaction.reply(resolvedPayload).catch(() => null);
    } catch {
      return null;
    }
  }

  async function safeDefer(interaction, ephemeral = true) {
    if (alreadyHandled(interaction)) return true;

    try {
      await interaction.deferReply(
        ephemeral
          ? { flags: MessageFlags.Ephemeral }
          : {}
      );

      return true;
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) {
        return false;
      }

      throw error;
    }
  }

  async function refreshPanelEditor(interaction, panelId) {
    try {
      const panel = ticketStore.getPanel(interaction.guildId, panelId);

      if (!panel) {
        return false;
      }

      const {
        buildEditorEmbed,
        buildEditorControlsForPanel,
        buildEditorControls,
      } = require('./ticketsPanel');

      const controls =
        typeof buildEditorControlsForPanel === 'function'
          ? buildEditorControlsForPanel(panel)
          : buildEditorControls(panelId);

      const payload = await resolveInteractionPayload(interaction, {
        embeds: [
          buildEditorEmbed(panel),
        ],
        components: controls,
      });

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
        return true;
      }

      if (typeof interaction.update === 'function') {
        await interaction.update(payload);
        return true;
      }

      await interaction.reply(ephemeralPayload(payload));
      return true;
    } catch {
      return false;
    }
  }

  function isTicketModal(customId) {
    return Object.values(MODAL_IDS).includes(customId);
  }

  function isTicketSelect(customId) {
    return Object.values(SELECT_IDS).includes(customId);
  }

  function isTicketSetupInteraction(interaction) {
    const customId = interaction.customId || '';

    return customId.startsWith('ticket_setup:');
  }

  async function listTickets(guildId) {
    if (!guildId) return [];

    if (typeof ticketManager.getTickets === 'function') {
      return ticketManager.getTickets(guildId);
    }

    if (typeof ticketManager.getAllTickets === 'function') {
      return ticketManager.getAllTickets(guildId);
    }

    if (typeof ticketStore.getAllTickets === 'function') {
      return ticketStore.getAllTickets(guildId);
    }

    return [];
  }

  async function findTicketByChannel(guildId, channelId) {
    if (!guildId || !channelId) return null;

    const tickets = await listTickets(guildId);

    return (
      tickets.find(
        (ticket) =>
          ticket.discordChannelId === channelId ||
          ticket.channelId === channelId
      ) || null
    );
  }

  async function getTicketForInteraction(interaction) {
    return findTicketByChannel(
      interaction.guildId,
      interaction.channelId
    );
  }

  async function refreshTicketButtons(interaction, ticket) {
    if (!interaction.message?.editable || !ticket) return;

    const status = String(ticket.status || 'open').toLowerCase();

    let components = getTicketActionRows(ticket, {
      allowReopen: true,
      allowDelete: true,
    });

    if (status === ticketActions.STATUS.CLOSED) {
      components = getClosedTicketActionRows(ticket, {
        allowDelete: true,
      });
    }

    if (status === ticketActions.STATUS.ARCHIVED) {
      components = getArchivedTicketActionRows(ticket, {
        allowDelete: true,
      });
    }

    await interaction.message
      .edit({ components })
      .catch(() => null);
  }

  function deny(interaction, message) {
    return safeReply(
      interaction,
      ephemeralPayload({
        content: `❌ ${message}`,
      })
    );
  }

  function can(interaction, action, ticket) {
    return ticketPermissions.can(
      interaction.member,
      action,
      ticket
    );
  }

  function ensureTicketPermission(interaction, action, ticket, message) {
    if (!ticket) {
      return deny(interaction, 'Ticket not found.');
    }

    if (!can(interaction, action, ticket)) {
      return deny(interaction, message);
    }

    return null;
  }

  async function handleClaim(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.CLAIM,
      ticket,
      'You cannot claim tickets.'
    );

    if (denied) return denied;

    const updated = await ticketActions.claim(
      ticket,
      interaction.user,
      {
        client: interaction.client,
      }
    );

    await refreshTicketButtons(interaction, updated);

    return safeReply(interaction, {
      content: `🎫 Ticket claimed by <@${interaction.user.id}>.`,
    });
  }

  async function showCloseModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.CLOSE,
      ticket,
      'You cannot close this ticket.'
    );

    if (denied) return denied;

    if (alreadyHandled(interaction)) return true;

    const modal = new ModalBuilder()
      .setCustomId(MODAL_IDS.CLOSE)
      .setTitle('Close Ticket');

    const input = new TextInputBuilder()
      .setCustomId(INPUT_IDS.CLOSE_REASON)
      .setLabel('Close reason')
      .setPlaceholder('Optional reason for closing this ticket')
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);
    return true;
  }

  async function handleCloseModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.CLOSE,
      ticket,
      'You cannot close this ticket.'
    );

    if (denied) return denied;

    const reason =
      interaction.fields.getTextInputValue(INPUT_IDS.CLOSE_REASON) ||
      'No reason provided.';

    const updated = await ticketActions.close(
      ticket,
      interaction.user,
      {
        reason,
        client: interaction.client,
        createTranscript: true,
      }
    );

    await refreshTicketButtons(interaction, updated);

    return safeReply(
      interaction,
      ephemeralPayload({
        content: `🔒 Ticket closed. Reason: ${reason}`,
      })
    );
  }

  async function handleArchive(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.ARCHIVE,
      ticket,
      'You cannot archive this ticket.'
    );

    if (denied) return denied;

    const deferred = await safeDefer(interaction, true);
    if (!deferred) return true;

    const updated = await ticketActions.archive(
      ticket,
      interaction.user,
      {
        client: interaction.client,
        createTranscript: true,
      }
    );

    await refreshTicketButtons(interaction, updated);

    return safeEditOrReply(interaction, {
      content: '📁 Ticket archived.',
    });
  }

  async function handleReopen(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.REOPEN,
      ticket,
      'You cannot reopen this ticket.'
    );

    if (denied) return denied;

    const deferred = await safeDefer(interaction, true);
    if (!deferred) return true;

    const updated = await ticketActions.reopen(
      ticket,
      interaction.user,
      {
        client: interaction.client,
      }
    );

    await refreshTicketButtons(interaction, updated);

    return safeEditOrReply(interaction, {
      content: '🔓 Ticket reopened.',
    });
  }

  async function handleTranscript(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.VIEW,
      ticket,
      'You cannot generate transcripts.'
    );

    if (denied) return denied;

    const deferred = await safeDefer(interaction, true);
    if (!deferred) return true;

    const transcript =
      await ticketTranscriptManager.createAndUploadTranscript(
        interaction.client,
        ticket,
        {
          generatedBy: interaction.user.id,
          reason: 'Manual transcript request',
        }
      );

    if (transcript?.error) {
      return safeEditOrReply(interaction, {
        content: `❌ Transcript failed: ${transcript.message}`,
      });
    }

    return safeEditOrReply(interaction, {
      content: '📄 Transcript generated.',
    });
  }

  async function showAddUserModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.UPDATE,
      ticket,
      'You cannot add users to this ticket.'
    );

    if (denied) return denied;

    if (alreadyHandled(interaction)) return true;

    const modal = new ModalBuilder()
      .setCustomId(MODAL_IDS.ADD_USER)
      .setTitle('Add User To Ticket');

    const input = new TextInputBuilder()
      .setCustomId(INPUT_IDS.ADD_USER_ID)
      .setLabel('User ID')
      .setPlaceholder('Enter the Discord user ID to add')
      .setRequired(true)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(32);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);
    return true;
  }

  async function handleAddUserModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.UPDATE,
      ticket,
      'You cannot add users to this ticket.'
    );

    if (denied) return denied;

    const userId = interaction.fields
      .getTextInputValue(INPUT_IDS.ADD_USER_ID)
      .replace(/[<@!>]/g, '')
      .trim();

    if (!/^\d{15,25}$/.test(userId)) {
      return deny(interaction, 'Invalid user ID.');
    }

    const channel =
      interaction.channel ||
      (ticket.discordChannelId
        ? await interaction.guild.channels
            .fetch(ticket.discordChannelId)
            .catch(() => null)
        : null);

    if (!channel) {
      return deny(interaction, 'Ticket channel not found.');
    }

    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });

    const allowedUserIds = [
      ...new Set([
        ...(Array.isArray(ticket.allowedUserIds)
          ? ticket.allowedUserIds
          : []),
        userId,
      ]),
    ];

    ticketStore.updateTicket(
      interaction.guildId,
      ticket.ticketId,
      {
        allowedUserIds,
        updatedAt: new Date().toISOString(),
      }
    );

    return safeReply(
      interaction,
      ephemeralPayload({
        content: `✅ Added <@${userId}> to this ticket.`,
      })
    );
  }

  async function showPrioritySelect(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.UPDATE,
      ticket,
      'You cannot change ticket priority.'
    );

    if (denied) return denied;

    const current = normalizePriority(ticket.priority);

    const select = new StringSelectMenuBuilder()
      .setCustomId(SELECT_IDS.PRIORITY)
      .setPlaceholder(`Current: ${formatPriority(current)}`)
      .addOptions(
        Object.entries(PRIORITY_LABELS).map(([value, label]) => ({
          label,
          value,
          default: value === current,
        }))
      );

    return safeReply(
      interaction,
      ephemeralPayload({
        content: 'Choose a new ticket priority:',
        components: [
          new ActionRowBuilder().addComponents(select),
        ],
      })
    );
  }

  async function handlePrioritySelect(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.UPDATE,
      ticket,
      'You cannot change ticket priority.'
    );

    if (denied) return denied;

    const priority = normalizePriority(interaction.values?.[0]);

    const updated = await ticketActions.setPriority(
      ticket,
      priority,
      interaction.user,
      {
        client: interaction.client,
      }
    );

    await refreshTicketButtons(interaction, updated);

    return safeReply(
      interaction,
      ephemeralPayload({
        content: `⚠️ Priority updated to **${formatPriority(priority)}**.`,
      })
    );
  }

  async function showDeleteConfirmModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.DELETE,
      ticket,
      'You cannot delete tickets.'
    );

    if (denied) return denied;

    if (alreadyHandled(interaction)) return true;

    const modal = new ModalBuilder()
      .setCustomId(MODAL_IDS.DELETE_CONFIRM)
      .setTitle('Delete Ticket');

    const input = new TextInputBuilder()
      .setCustomId(INPUT_IDS.DELETE_CONFIRM)
      .setLabel('Type DELETE to confirm')
      .setPlaceholder('DELETE')
      .setRequired(true)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20);

    modal.addComponents(
      new ActionRowBuilder().addComponents(input)
    );

    await interaction.showModal(modal);
    return true;
  }

  async function handleDeleteConfirmModal(interaction, ticket) {
    const denied = ensureTicketPermission(
      interaction,
      TICKET_ACTIONS.DELETE,
      ticket,
      'You cannot delete tickets.'
    );

    if (denied) return denied;

    const value = interaction.fields
      .getTextInputValue(INPUT_IDS.DELETE_CONFIRM)
      .trim()
      .toUpperCase();

    if (value !== 'DELETE') {
      return deny(interaction, 'Delete cancelled. Confirmation did not match.');
    }

    const deferred = await safeDefer(interaction, true);
    if (!deferred) return true;

    await ticketActions.deleteTicket(
      ticket,
      interaction.user,
      {
        client: interaction.client,
        createTranscript: true,
      }
    );

    return safeEditOrReply(interaction, {
      content: '🗑️ Ticket deleted.',
    });
  }

  async function routeTicketButton(interaction, ticket) {
    const customId = interaction.customId;

    switch (customId) {
      case CUSTOM_IDS.CLAIM:
        return handleClaim(interaction, ticket);

      case CUSTOM_IDS.CLOSE:
        return showCloseModal(interaction, ticket);

      case CUSTOM_IDS.ARCHIVE:
        return handleArchive(interaction, ticket);

      case CUSTOM_IDS.TRANSCRIPT:
        return handleTranscript(interaction, ticket);

      case CUSTOM_IDS.ADD_USER:
        return showAddUserModal(interaction, ticket);

      case CUSTOM_IDS.PRIORITY:
        return showPrioritySelect(interaction, ticket);

      case CUSTOM_IDS.REOPEN:
        return handleReopen(interaction, ticket);

      case CUSTOM_IDS.DELETE:
      case CUSTOM_IDS.DELETE_CONFIRM:
        return showDeleteConfirmModal(interaction, ticket);

      default:
        return false;
    }
  }

  async function routeTicketModal(interaction, ticket) {
    const customId = interaction.customId;

    switch (customId) {
      case MODAL_IDS.CLOSE:
        return handleCloseModal(interaction, ticket);

      case MODAL_IDS.ADD_USER:
        return handleAddUserModal(interaction, ticket);

      case MODAL_IDS.DELETE_CONFIRM:
        return handleDeleteConfirmModal(interaction, ticket);

      default:
        return false;
    }
  }

  async function routeTicketSelect(interaction, ticket) {
    const customId = interaction.customId;

    switch (customId) {
      case SELECT_IDS.PRIORITY:
        return handlePrioritySelect(interaction, ticket);

      default:
        return false;
    }
  }

  async function handleTicketInteraction(
    interaction,
    client = interaction.client,
    io = null
  ) {
    try {
      if (!interaction?.guildId) {
        return false;
      }

      const customId = interaction.customId || '';

      /*
       * Ticket setup/admin panel interactions.
       * This must run early so setup modals/buttons/selects do not get treated
       * as normal ticket channel controls.
       */

      if (isTicketSetupInteraction(interaction)) {
        return handleTicketSetupInteraction(interaction);
      }

      /*
       * Public deployed panel button.
       */

      if (
        interaction.isButton?.() &&
        customId.startsWith('ticket_open:')
      ) {
        return handleTicketPanelButton(
          interaction,
          client,
          io
        );
      }

      /*
       * Existing ticket channel controls.
       */

      if (
        interaction.isButton?.() &&
        isTicketButton(customId)
      ) {
        const ticket = await getTicketForInteraction(interaction);

        if (!ticket) {
          return deny(interaction, 'Ticket not found for this channel.');
        }

        return routeTicketButton(interaction, ticket);
      }

      /*
       * Ticket modals.
       */

      if (
        interaction.isModalSubmit?.() &&
        isTicketModal(customId)
      ) {
        const ticket = await getTicketForInteraction(interaction);
        return routeTicketModal(interaction, ticket);
      }

      /*
       * Ticket selects.
       */

      if (
        interaction.isStringSelectMenu?.() &&
        isTicketSelect(customId)
      ) {
        const ticket = await getTicketForInteraction(interaction);
        return routeTicketSelect(interaction, ticket);
      }

      return false;
    } catch (error) {
      console.error('[TicketInteractionHandler] Failed:', error);

      await safeReply(
        interaction,
        ephemeralPayload({
          content:
            '❌ Ticket interaction failed. Check VPS logs for details.',
        })
      );

      return true;
    }
  }

  ticketInteractionHandlerApi = {
    MODAL_IDS,
    INPUT_IDS,
    SELECT_IDS,

    handleTicketInteraction,

    refreshPanelEditor,

    getTicketForInteraction,
    findTicketByChannel,
    refreshTicketButtons,
    resolveInteractionPayload,
  };
}

module.exports = {
  ...ticketActionsApi,
  ...ticketInteractionHandlerApi,
  ticketActions: ticketActionsApi,
  ticketInteractionHandler: ticketInteractionHandlerApi,
};
