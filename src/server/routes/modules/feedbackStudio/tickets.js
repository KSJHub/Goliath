// src/server/routes/modules/feedbackStudio/tickets.js

const express = require("express");

const {
  getGuildTickets,
  getTicketById,
  createNewTicket,
  closeTicket,
  reopenTicket,
  claimTicket,
  assignTicket,
  updateTicketStatus,
  addTicketNote,
  archiveTicket,
  removeTicket,
} = require("../../../../modules/feedbackStudio/tickets/ticketsLifecycle");

const ticketRecovery = require("../../../../modules/feedbackStudio/tickets/ticketsTracking");
const ticketPanelManager = require("../../../../modules/feedbackStudio/tickets/ticketsPanel");
const ticketTranscriptManager = require("../../../../modules/feedbackStudio/tickets/ticketsTranscripts");
const guildManager = require("../../../../core/guild/guildManager");

const {
  getPanels,
  getPanel,
  getTicketSettings,
  saveTicketSettings,
} = require("../../../../modules/feedbackStudio/tickets/tickets");

const {
  MANAGE_CHANNEL_PERMISSIONS,
  guardCategoryAccess,
  isGoliathPermissionError,
  validateRoleSelection,
} = require("../../../../core/security/protection/permissions");

const router = express.Router();

function normaliseStatus(status) {
  return String(status || "open").toLowerCase();
}

function countByStatus(tickets = [], status) {
  return tickets.filter((ticket) => normaliseStatus(ticket.status) === status).length;
}

function isDeletedTicket(ticket = {}) {
  return normaliseStatus(ticket.status) === "deleted" || Boolean(ticket.deletedAt);
}

function isFormTicket(ticket = {}) {
  return ticket.source === "form" || Boolean(ticket.formSubmissionId) || Boolean(ticket.metadata?.submissionId);
}

function hasMissingChannelRecord(ticket = {}) {
  const status = normaliseStatus(ticket.status);
  if (["closed", "archived", "deleted"].includes(status)) return false;
  return !ticket.discordChannelId && !ticket.channelId;
}

function isToday(dateValue) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth() && date.getUTCDate() === now.getUTCDate();
}

function cleanDiscordId(value) {
  const id = String(value || "").replace(/[<@#!&>]/g, "").trim();
  return /^\d{15,25}$/.test(id) ? id : null;
}

function cleanDiscordIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(cleanDiscordId).filter(Boolean))];
}

function canonicalTicketSettings(guildId, settings = getTicketSettings(guildId) || {}) {
  return {
    ...settings,
    enabled: guildManager.isModuleEnabled(guildId, "tickets"),
  };
}

async function fetchGuild(req, guildId) {
  const client = req.app?.locals?.client || req.app?.locals?.discordClient || global.client || global.discordClient;
  if (!client?.guilds?.fetch) return null;
  return client.guilds.cache.get(guildId) || client.guilds.fetch(guildId).catch(() => null);
}

function getDiscordClient(req) {
  return req.app?.locals?.client || req.app?.locals?.discordClient || global.client || global.discordClient || null;
}

function getTicketRoleIds(settings = {}) {
  const permissions = settings.permissions || {};
  return cleanDiscordIds([
    ...(settings.staffRoleIds || []),
    ...(settings.managerRoleIds || []),
    ...(settings.viewerRoleIds || []),
    ...(permissions.staffRoles || []),
    ...(permissions.managerRoles || []),
    ...(permissions.viewerRoles || []),
  ]);
}

function getTicketCategoryIds(settings = {}) {
  const tickets = settings.tickets || {};
  return cleanDiscordIds([
    settings.categoryId,
    settings.outputCategoryId,
    settings.archiveCategoryId,
    tickets.categoryId,
    tickets.outputCategoryId,
    tickets.archiveCategoryId,
  ]);
}

async function guardTicketSettings(req, guildId, settings = {}) {
  const roleIds = getTicketRoleIds(settings);
  const categoryIds = getTicketCategoryIds(settings);
  if (!roleIds.length && !categoryIds.length) return null;

  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error("Guild is unavailable.");

  if (roleIds.length) {
    const roleResult = await validateRoleSelection(guild, roleIds, { scope: "ticket_settings.roles", requireManageable: false });
    if (!roleResult.ok) throw roleResult.toError();
  }

  for (const categoryId of categoryIds) {
    await guardCategoryAccess(guild, categoryId, MANAGE_CHANNEL_PERMISSIONS, {
      scope: "ticket_settings.categories",
      autoFix: true,
      throwOnFail: true,
      reason: "Goliath ticket settings permission validation",
    });
  }

  return true;
}

function failure(res, error, fallbackMessage, fallbackStatus = 500) {
  if (isGoliathPermissionError(error)) {
    const details = error.details || {};
    return res.status(403).json({
      success: false,
      code: error.code,
      error: error.message,
      message: details.message || error.message,
      scope: details.scope || null,
      guildId: details.guildId || null,
      channelId: details.channelId || null,
      channelName: details.channelName || null,
      missingPermissions: details.missingPermissions || [],
      failures: details.failures || [],
      metadata: details.metadata || {},
      autoFixAvailable: Boolean(details.autoFixAvailable),
      confirmationRequired: Boolean(details.confirmationRequired),
    });
  }

  return res.status(fallbackStatus).json({ success: false, error: error.message || fallbackMessage });
}

function serialisePanel(panel = {}) {
  return {
    ...panel,
    id: panel.panelId || panel.id || null,
    panelId: panel.panelId || panel.id || null,
    name: panel.name || panel.title || panel.appearance?.title || "Unnamed Panel",
    title: panel.title || panel.appearance?.title || panel.name || "Unnamed Panel",
    type: panel.ticketType || panel.type || "support",
    ticketType: panel.ticketType || panel.type || "support",
    deployed: Boolean(panel.deployed || (panel.deployChannelId && panel.deployMessageId) || (panel.channelId && panel.messageId)),
    channelId: panel.deployChannelId || panel.channelId || null,
    messageId: panel.deployMessageId || panel.messageId || null,
    deployChannelId: panel.deployChannelId || panel.channelId || null,
    deployMessageId: panel.deployMessageId || panel.messageId || null,
    ticketLimit: panel.maxOpenTicketsPerUser ?? panel.maxActiveTicketsPerUser ?? panel.ticketLimit ?? 0,
    cooldown: panel.cooldownMs ?? panel.cooldown ?? 0,
    cooldownMs: panel.cooldownMs ?? panel.cooldown ?? 0,
    staffRoles: Array.isArray(panel.staffRoles) ? panel.staffRoles : panel.staffRoleIds || [],
    staffRoleIds: panel.staffRoleIds || panel.staffRoles || [],
    managerRoleIds: panel.managerRoleIds || [],
    viewerRoleIds: panel.viewerRoleIds || [],
    outputCategoryId: panel.outputCategoryId || null,
    archiveCategoryId: panel.archiveCategoryId || null,
    transcriptsChannelId: panel.transcriptsChannelId || null,
    logsChannelId: panel.logsChannelId || null,
    appearance: panel.appearance || {},
  };
}

function summariseRecovery(result = {}) {
  const formResults = Array.isArray(result.formTicketRecovery) ? result.formTicketRecovery : [];
  return {
    guildId: result.guildId,
    guildFound: result.guildFound !== false,
    totalTickets: result.totalTickets || 0,
    activeTickets: result.activeTickets || 0,
    missingChannels: result.missingChannels?.length || 0,
    validChannels: result.validChannels?.length || 0,
    formTicketsChecked: formResults.length,
    formTicketsRecovered: formResults.filter((item) => item.recovered).length,
    formTicketChannelsRecreated: formResults.filter((item) => item.recreated).length,
    formTicketsRecoverable: formResults.filter((item) => item.recoverable).length,
  };
}

function cleanPanelPayload(payload = {}) {
  const appearance = payload.appearance || {};
  return {
    ...payload,
    panelId: payload.panelId || payload.id || undefined,
    name: String(payload.name || "Support Panel").trim().slice(0, 80),
    ticketType: String(payload.ticketType || payload.type || "support").trim().toLowerCase(),
    ticketPriority: String(payload.ticketPriority || payload.priority || "low").trim().toLowerCase(),
    deployChannelId: cleanDiscordId(payload.deployChannelId || payload.channelId),
    channelId: cleanDiscordId(payload.channelId || payload.deployChannelId),
    outputCategoryId: cleanDiscordId(payload.outputCategoryId),
    archiveCategoryId: cleanDiscordId(payload.archiveCategoryId),
    logsChannelId: cleanDiscordId(payload.logsChannelId),
    transcriptsChannelId: cleanDiscordId(payload.transcriptsChannelId),
    staffRoleIds: cleanDiscordIds(payload.staffRoleIds || payload.staffRoles),
    managerRoleIds: cleanDiscordIds(payload.managerRoleIds),
    viewerRoleIds: cleanDiscordIds(payload.viewerRoleIds),
    maxOpenTicketsPerUser: Math.max(0, Number(payload.maxOpenTicketsPerUser ?? payload.maxActiveTicketsPerUser ?? 2) || 0),
    maxActiveTicketsPerUser: Math.max(0, Number(payload.maxActiveTicketsPerUser ?? payload.maxOpenTicketsPerUser ?? 2) || 0),
    cooldownMs: Math.max(0, Number(payload.cooldownMs ?? 60000) || 0),
    oneActivePerType: payload.oneActivePerType !== false,
    notifyStaffOnOpen: payload.notifyStaffOnOpen !== false,
    enabled: payload.enabled !== false,
    appearance: {
      title: String(appearance.title || payload.title || "Open a Ticket").slice(0, 256),
      description: String(appearance.description || payload.description || "Need help? Open a ticket and our staff team will assist you.").slice(0, 4000),
      color: String(appearance.color || "#5865F2").slice(0, 16),
      buttonLabel: String(appearance.buttonLabel || "Open Ticket").slice(0, 80),
      buttonEmoji: String(appearance.buttonEmoji || "🎫").slice(0, 32),
      footerText: String(appearance.footerText || "Goliath • Ticket System").slice(0, 2048),
      imageUrl: appearance.imageUrl || null,
      thumbnailUrl: appearance.thumbnailUrl || null,
    },
  };
}

async function resolveDeployChannel(req, guildId, panel, explicitChannelId = null) {
  const guild = await fetchGuild(req, guildId);
  if (!guild) throw new Error("Guild is unavailable.");
  const channelId = cleanDiscordId(explicitChannelId || panel.deployChannelId || panel.channelId);
  if (!channelId) throw new Error("A deployment channel is required.");
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) throw new Error("Deployment channel is unavailable.");
  return { guild, channel };
}

async function createRouteTranscript(req, guildId, ticket, reason = "Dashboard ticket action") {
  const client = getDiscordClient(req);
  if (!client || !ticket) return null;
  try {
    const ticketWithGuild = { ...ticket, guildId: ticket.guildId || guildId };
    return await ticketTranscriptManager.createAndUploadTranscript(client, ticketWithGuild, {
      generatedBy: req.body?.actorId || "dashboard",
      reason,
      transcriptLimit: req.body?.transcriptLimit,
    });
  } catch (error) {
    console.warn("[TicketsRoute] Transcript generation failed:", error.message || error);
    return { error: true, message: error.message || "Transcript generation failed." };
  }
}

router.get("/:guildId/overview", async (req, res) => {
  try {
    const { guildId } = req.params;
    const tickets = getGuildTickets(guildId);
    const panels = getPanels(guildId).panels || [];
    const settings = canonicalTicketSettings(guildId);
    const openCount = countByStatus(tickets, "open");
    const claimedCount = countByStatus(tickets, "claimed");
    const closedCount = countByStatus(tickets, "closed");
    const archivedCount = countByStatus(tickets, "archived");
    const deletedCount = tickets.filter(isDeletedTicket).length;
    const formTicketCount = tickets.filter(isFormTicket).length;
    const missingChannelRecordCount = tickets.filter(hasMissingChannelRecord).length;

    return res.json({ success: true, guildId, overview: {
      enabled: guildManager.isModuleEnabled(guildId, "tickets"),
      ticketCount: tickets.length,
      totalCount: tickets.length,
      openCount,
      claimedCount,
      closedCount,
      archivedCount,
      deletedCount,
      formTicketCount,
      missingChannelRecordCount,
      activeCount: openCount + claimedCount,
      closedTodayCount: tickets.filter((ticket) => isToday(ticket.closedAt)).length,
      archivedTodayCount: tickets.filter((ticket) => isToday(ticket.archivedAt)).length,
      deletedTodayCount: tickets.filter((ticket) => isToday(ticket.deletedAt)).length,
      transcriptCount: tickets.filter((ticket) => ticket.transcript || ticket.transcriptId || ticket.transcriptUrl).length,
      panelCount: panels.length,
      deployedPanelCount: panels.filter((panel) => panel.deployed || (panel.deployChannelId && panel.deployMessageId) || (panel.channelId && panel.messageId)).length,
      panels: panels.map(serialisePanel),
      settings,
    } });
  } catch (error) {
    console.error("[TicketsRoute] OVERVIEW:", error);
    return failure(res, error, "Failed to fetch ticket overview.");
  }
});

router.post("/:guildId/recovery", async (req, res) => {
  try {
    const { guildId } = req.params;
    const client = getDiscordClient(req);
    if (!client) return res.status(503).json({ success: false, error: "Discord client is unavailable." });
    const createMissingChannels = req.body?.createMissingChannels === true;
    const result = await ticketRecovery.recoverGuildTickets(client, guildId, { createMissingChannels });
    return res.json({ success: true, guildId, mode: createMissingChannels ? "recreate_missing_channels" : "scan_only", summary: summariseRecovery(result), result });
  } catch (error) {
    console.error("[TicketsRoute] RECOVERY:", error);
    return failure(res, error, "Failed to run ticket recovery.");
  }
});

router.get("/:guildId/settings", async (req, res) => {
  try {
    const { guildId } = req.params;
    return res.json({ success: true, guildId, settings: canonicalTicketSettings(guildId) });
  } catch (error) {
    console.error("[TicketsRoute] SETTINGS GET:", error);
    return failure(res, error, "Failed to fetch ticket settings.");
  }
});

router.patch("/:guildId/settings", async (req, res) => {
  try {
    const { guildId } = req.params;
    const input = req.body?.settings || req.body || {};
    const { enabled, ...settings } = input;
    await guardTicketSettings(req, guildId, settings);
    if (typeof enabled === "boolean") {
      guildManager.setModuleEnabled(guildId, "tickets", enabled, { actorId: req.body?.actorId });
    }
    const savedSettings = saveTicketSettings(guildId, settings);
    return res.json({ success: true, guildId, settings: canonicalTicketSettings(guildId, savedSettings) });
  } catch (error) {
    console.error("[TicketsRoute] SETTINGS PATCH:", error);
    return failure(res, error, "Failed to update ticket settings.", 400);
  }
});

router.get("/:guildId/panels", async (req, res) => {
  try {
    const { guildId } = req.params;
    const panels = getPanels(guildId).panels || [];
    return res.json({ success: true, guildId, panels: panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANELS GET:", error);
    return failure(res, error, "Failed to fetch ticket panels.");
  }
});

router.post("/:guildId/panels", async (req, res) => {
  try {
    const { guildId } = req.params;
    const panel = ticketPanelManager.createPanel(guildId, cleanPanelPayload(req.body || {}));
    return res.status(201).json({ success: true, guildId, panel: serialisePanel(panel), panels: getPanels(guildId).panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANEL CREATE:", error);
    return failure(res, error, "Failed to create ticket panel.", 400);
  }
});

router.put("/:guildId/panels/:panelId", async (req, res) => {
  try {
    const { guildId, panelId } = req.params;
    const panel = ticketPanelManager.updatePanel(guildId, panelId, cleanPanelPayload(req.body || {}));
    if (!panel) return res.status(404).json({ success: false, error: "Panel not found." });
    return res.json({ success: true, guildId, panel: serialisePanel(panel), panels: getPanels(guildId).panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANEL UPDATE:", error);
    return failure(res, error, "Failed to update ticket panel.", 400);
  }
});

router.post("/:guildId/panels/:panelId/deploy", async (req, res) => {
  try {
    const { guildId, panelId } = req.params;
    let panel = getPanel(guildId, panelId);
    if (!panel) return res.status(404).json({ success: false, error: "Panel not found." });
    if (req.body && Object.keys(req.body).length) panel = ticketPanelManager.updatePanel(guildId, panelId, cleanPanelPayload({ ...panel, ...req.body }));
    const { guild, channel } = await resolveDeployChannel(req, guildId, panel, req.body?.deployChannelId || req.body?.channelId);
    const deployed = await ticketPanelManager.deployPanel({ guild, channel, panel, actorId: req.body?.actorId || "dashboard" });
    return res.json({ success: true, guildId, panel: serialisePanel(deployed), panels: getPanels(guildId).panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANEL DEPLOY:", error);
    return failure(res, error, "Failed to deploy ticket panel.", 400);
  }
});

router.post("/:guildId/panels/:panelId/refresh", async (req, res) => {
  try {
    const { guildId, panelId } = req.params;
    const panel = getPanel(guildId, panelId);
    if (!panel) return res.status(404).json({ success: false, error: "Panel not found." });
    const guild = await fetchGuild(req, guildId);
    if (!guild) throw new Error("Guild is unavailable.");
    const refreshed = await ticketPanelManager.refreshDeployedPanel({ guild, panel });
    return res.json({ success: true, guildId, refreshed, panel: serialisePanel(getPanel(guildId, panelId)), panels: getPanels(guildId).panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANEL REFRESH:", error);
    return failure(res, error, "Failed to refresh ticket panel.", 400);
  }
});

router.delete("/:guildId/panels/:panelId", async (req, res) => {
  try {
    const { guildId, panelId } = req.params;
    const success = ticketPanelManager.deletePanel(guildId, panelId);
    return res.json({ success, guildId, panels: getPanels(guildId).panels.map(serialisePanel) });
  } catch (error) {
    console.error("[TicketsRoute] PANEL DELETE:", error);
    return failure(res, error, "Failed to delete ticket panel.", 400);
  }
});

router.get("/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const tickets = getGuildTickets(guildId);
    return res.json({ success: true, count: tickets.length, tickets });
  } catch (error) {
    console.error("[TicketsRoute] GET ALL:", error);
    return failure(res, error, "Failed to fetch tickets.");
  }
});

router.post("/:guildId/:ticketId/transcript", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const ticket = getTicketById(guildId, ticketId);
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    const transcript = await createRouteTranscript(req, guildId, ticket, req.body?.reason || "Manual dashboard transcript");
    const updatedTicket = getTicketById(guildId, ticketId) || ticket;
    return res.json({ success: true, guildId, ticket: updatedTicket, transcript });
  } catch (error) {
    console.error("[TicketsRoute] TRANSCRIPT:", error);
    return failure(res, error, "Failed to generate transcript.", 400);
  }
});

router.get("/:guildId/:ticketId/transcript", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const ticket = getTicketById(guildId, ticketId);
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, guildId, ticketId, transcript: ticket.transcript || null });
  } catch (error) {
    console.error("[TicketsRoute] TRANSCRIPT GET:", error);
    return failure(res, error, "Failed to fetch ticket transcript.");
  }
});

router.get("/:guildId/:ticketId", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const ticket = getTicketById(guildId, ticketId);
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error("[TicketsRoute] GET ONE:", error);
    return failure(res, error, "Failed to fetch ticket.");
  }
});

router.post("/:guildId", async (req, res) => {
  try {
    const { guildId } = req.params;
    const { creatorId, type, title, description, priority, source, sourceId, tags, metadata } = req.body;
    const ticket = await createNewTicket({ guildId, creatorId, type, title, description, priority, source, sourceId, tags, metadata });
    return res.status(201).json({ success: true, ticket });
  } catch (error) {
    console.error("[TicketsRoute] CREATE:", error);
    return failure(res, error, "Failed to create ticket.");
  }
});

router.post("/:guildId/:ticketId/claim", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId } = req.body;
    const ticket = await claimTicket({ guildId, ticketId, actorId });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error("[TicketsRoute] CLAIM:", error);
    return failure(res, error, "Failed to claim ticket.");
  }
});

router.post("/:guildId/:ticketId/assign", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId, assignedUserId } = req.body;
    const ticket = await assignTicket({ guildId, ticketId, actorId, assignedUserId });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error("[TicketsRoute] ASSIGN:", error);
    return failure(res, error, "Failed to assign ticket.");
  }
});

router.patch("/:guildId/:ticketId/status", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId, status } = req.body;
    const ticket = await updateTicketStatus({ guildId, ticketId, actorId, status });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    let transcript = null;
    if (["closed", "archived"].includes(normaliseStatus(status)) && req.body?.createTranscript !== false) {
      transcript = await createRouteTranscript(req, guildId, ticket, `Ticket status changed to ${normaliseStatus(status)}`);
    }
    return res.json({ success: true, ticket: getTicketById(guildId, ticketId) || ticket, transcript });
  } catch (error) {
    console.error("[TicketsRoute] STATUS:", error);
    return failure(res, error, "Failed to update status.");
  }
});

router.post("/:guildId/:ticketId/note", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId, note } = req.body;
    const noteData = await addTicketNote({ guildId, ticketId, actorId, note });
    if (!noteData) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, note: noteData });
  } catch (error) {
    console.error("[TicketsRoute] NOTE:", error);
    return failure(res, error, "Failed to add note.");
  }
});

router.post("/:guildId/:ticketId/close", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId, reason } = req.body;
    const ticket = await closeTicket({ guildId, ticketId, actorId, reason });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    const transcript = req.body?.createTranscript === false ? null : await createRouteTranscript(req, guildId, ticket, reason || "Ticket closed");
    return res.json({ success: true, ticket: getTicketById(guildId, ticketId) || ticket, transcript });
  } catch (error) {
    console.error("[TicketsRoute] CLOSE:", error);
    return failure(res, error, "Failed to close ticket.");
  }
});

router.post("/:guildId/:ticketId/reopen", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId } = req.body;
    const ticket = await reopenTicket({ guildId, ticketId, actorId });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error("[TicketsRoute] REOPEN:", error);
    return failure(res, error, "Failed to reopen ticket.");
  }
});

router.post("/:guildId/:ticketId/archive", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const { actorId } = req.body;
    const ticket = await archiveTicket({ guildId, ticketId, actorId });
    if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found." });
    const transcript = req.body?.createTranscript === false ? null : await createRouteTranscript(req, guildId, ticket, "Ticket archived");
    return res.json({ success: true, ticket: getTicketById(guildId, ticketId) || ticket, transcript });
  } catch (error) {
    console.error("[TicketsRoute] ARCHIVE:", error);
    return failure(res, error, "Failed to archive ticket.");
  }
});

router.delete("/:guildId/:ticketId", async (req, res) => {
  try {
    const { guildId, ticketId } = req.params;
    const success = await removeTicket({ guildId, ticketId });
    return res.json({ success });
  } catch (error) {
    console.error("[TicketsRoute] DELETE:", error);
    return failure(res, error, "Failed to delete ticket.");
  }
});

router.get("/:guildId/health", async (req, res) => {
  try {
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: "Guild is unavailable." });
    const health = await require("../../../../modules/feedbackStudio/tickets/ticketsHealth").buildHealthReport(guild);
    return res.json({ success: true, health });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Unable to check Tickets health." });
  }
});

router.post("/:guildId/health/repair", async (req, res) => {
  try {
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: "Guild is unavailable." });
    const result = await require("../../../../modules/feedbackStudio/tickets/ticketsHealth").repairAll(guild, req.body?.actorId || null);
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || "Unable to repair Tickets." });
  }
});

router.post("/:guildId/panels/:panelId/repair", async (req, res) => {
  try {
    const guild = await fetchGuild(req, req.params.guildId);
    if (!guild) return res.status(404).json({ success: false, error: "Guild is unavailable." });
    const panel = await require("../../../../modules/feedbackStudio/tickets/ticketsHealth").repairPanel(guild, req.params.panelId, req.body?.actorId || null);
    return res.json({ success: true, panel });
  } catch (error) {
    const status = /not found/i.test(String(error.message || "")) ? 404 : 500;
    return res.status(status).json({ success: false, error: error.message || "Unable to repair ticket panel." });
  }
});

module.exports = router;