'use strict';

/**
 * Canonical Tickets transcripts layer.
 *
 * This file is the single source of truth for the responsibilities
 * consolidated below. Legacy ticket implementation files were removed.
 */

let ticketTranscriptManagerApi;

// ============================================================================
// ticketTranscriptManager
// ============================================================================
{
  const fs = require('fs');
  const path = require('path');
  const { getRuntimeRoot } = require('../../../config/runtimePaths');

  const {
    AttachmentBuilder,
    ChannelType,
  } = require('discord.js');

  const {
    getTicketSettings,
    updateTicket,
    getAllTickets,
  } = require('./tickets');

  function now() {
    return new Date().toISOString();
  }

  function safe(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTicketId(ticket) {
    return ticket?.ticketId || ticket?.id || 'unknown-ticket';
  }

  function getChannelId(ticket) {
    return ticket?.discordChannelId || ticket?.channelId || null;
  }

  function getCreatorId(ticket) {
    return ticket?.creatorId || ticket?.createdBy || ticket?.userId || null;
  }

  function getTranscriptDir(guildId) {
    return path.join(getRuntimeRoot(process.env.BOT_MODE || process.env.NODE_ENV || 'dev'), 'guilds', String(guildId), 'transcripts');
  }

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  function formatFileName(ticket, ext) {
    const ticketId = ticket.displayId || getTicketId(ticket);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${ticketId}-${stamp}.${ext}`;
  }

  async function fetchAllMessages(channel, limit = 1000) {
    const messages = [];
    let before;

    while (messages.length < limit) {
      const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), before });
      if (!batch.size) break;
      const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      messages.push(...sorted);
      before = batch.last()?.id;
      if (batch.size < 100) break;
    }

    return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }

  function serializeMessage(message) {
    return {
      id: message.id,
      authorId: message.author?.id || null,
      authorTag: message.author?.tag || message.author?.username || 'Unknown',
      authorAvatar: message.author?.displayAvatarURL?.() || null,
      authorBot: Boolean(message.author?.bot),
      content: message.content || '',
      createdAt: message.createdAt?.toISOString?.() || null,
      editedAt: message.editedAt?.toISOString?.() || null,
      system: message.system || false,
      attachments: [...message.attachments.values()].map((file) => ({ id: file.id, name: file.name, url: file.url, contentType: file.contentType, size: file.size, proxyURL: file.proxyURL })),
      embeds: message.embeds.map((embed) => ({ title: embed.title || null, description: embed.description || null, url: embed.url || null, color: embed.color || null, fields: embed.fields || [] })),
      components: message.components?.map((row) => row.toJSON?.() || row) || [],
    };
  }

  function buildJsonTranscript(ticket, messages, meta = {}) {
    return {
      generatedAt: now(),
      ticket: {
        ticketId: getTicketId(ticket),
        displayId: ticket.displayId || null,
        guildId: ticket.guildId,
        discordChannelId: getChannelId(ticket),
        title: ticket.title || null,
        type: ticket.type || null,
        status: ticket.status || null,
        priority: ticket.priority || null,
        creatorId: getCreatorId(ticket),
        claimedById: ticket.claimedById || null,
        createdAt: ticket.createdAt || null,
        updatedAt: ticket.updatedAt || null,
        closedAt: ticket.closedAt || null,
        archivedAt: ticket.archivedAt || null,
        reopenedAt: ticket.reopenedAt || null,
        source: ticket.source || null,
        sourceId: ticket.sourceId || null,
        metadata: ticket.metadata || {},
      },
      analytics: {
        messageCount: messages.length,
        userMessages: messages.filter((m) => !m.authorBot).length,
        botMessages: messages.filter((m) => m.authorBot).length,
        attachments: messages.reduce((acc, m) => acc + m.attachments.length, 0),
        embeds: messages.reduce((acc, m) => acc + m.embeds.length, 0),
      },
      meta,
      messages: messages.map(serializeMessage),
    };
  }

  function renderAttachment(file) {
    const isImage = file.contentType?.startsWith('image/');
    return `<div class="attachment"><a href="${safe(file.url)}" target="_blank">${safe(file.name || 'Attachment')}</a>${isImage ? `<div class="attachment-preview"><img src="${safe(file.url)}" alt="${safe(file.name)}" /></div>` : ''}</div>`;
  }

  function renderEmbed(embed) {
    const fields = Array.isArray(embed.fields) ? embed.fields.map((field) => `<div class="embed-field"><strong>${safe(field.name)}</strong><div>${safe(field.value)}</div></div>`).join('') : '';
    return `<div class="embed">${embed.title ? `<div class="embed-title">${safe(embed.title)}</div>` : ''}${embed.description ? `<div class="embed-description">${safe(embed.description)}</div>` : ''}${fields}</div>`;
  }

  function renderMessage(msg) {
    const attachments = msg.attachments.map(renderAttachment).join('');
    const embeds = msg.embeds.map(renderEmbed).join('');
    return `<div class="message"><div class="message-avatar">${msg.authorAvatar ? `<img src="${safe(msg.authorAvatar)}" />` : '<div class="avatar-fallback"></div>'}</div><div class="message-body"><div class="message-header"><span class="author">${safe(msg.authorTag)}</span>${msg.authorBot ? '<span class="bot-badge">BOT</span>' : ''}${msg.system ? '<span class="system-badge">SYSTEM</span>' : ''}<span class="time">${safe(msg.createdAt || '')}</span></div><div class="content">${safe(msg.content || '') || '<em>No text content</em>'}</div>${attachments}${embeds}</div></div>`;
  }

  function buildHtmlTranscript(ticket, json) {
    const ticketId = ticket.displayId || getTicketId(ticket);
    const messagesHtml = json.messages.map(renderMessage).join('\n');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Goliath Transcript - ${safe(ticketId)}</title><style>body{margin:0;padding:0;background:#0b0f19;color:#e5e7eb;font-family:Inter,Arial,sans-serif}.wrap{max-width:1200px;margin:0 auto;padding:32px}.header{background:linear-gradient(135deg,#111827,#0f172a);border:1px solid #1f2937;border-radius:20px;padding:28px;margin-bottom:24px}h1{margin:0 0 18px;font-size:30px}.meta,.analytics{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.meta-card,.analytics-card{background:#0f172a;border:1px solid #1f2937;border-radius:14px;padding:14px}.messages{display:flex;flex-direction:column;gap:14px;margin-top:24px}.message{display:flex;gap:14px;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:16px}.message-avatar img,.avatar-fallback{width:42px;height:42px;border-radius:50%;background:#1f2937}.message-body{flex:1}.message-header{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px}.author{font-weight:700;color:#60a5fa}.bot-badge,.system-badge{color:white;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}.bot-badge{background:#4f46e5}.system-badge{background:#64748b}.time{color:#6b7280;font-size:12px}.content{white-space:pre-wrap;line-height:1.5}.attachment{margin-top:12px}.attachment a{color:#93c5fd}.attachment-preview img{margin-top:8px;max-width:320px;border-radius:10px}.embed{margin-top:10px;padding:12px;border-left:4px solid #6366f1;background:#0f172a;border-radius:10px}.embed-title{font-weight:700;margin-bottom:6px}.embed-description{color:#d1d5db;white-space:pre-wrap}.embed-field{margin-top:8px;padding-top:8px;border-top:1px solid #1f2937}.footer{margin-top:36px;color:#6b7280;text-align:center}</style></head><body><main class="wrap"><section class="header"><h1>🎫 Goliath Ticket Transcript</h1><div class="meta"><div class="meta-card"><strong>Ticket</strong><br>${safe(ticketId)}</div><div class="meta-card"><strong>Status</strong><br>${safe(ticket.status || 'unknown')}</div><div class="meta-card"><strong>Priority</strong><br>${safe(ticket.priority || 'normal')}</div><div class="meta-card"><strong>Generated</strong><br>${safe(json.generatedAt)}</div></div></section><section class="analytics"><div class="analytics-card"><strong>Messages</strong><br>${safe(json.analytics.messageCount)}</div><div class="analytics-card"><strong>User Messages</strong><br>${safe(json.analytics.userMessages)}</div><div class="analytics-card"><strong>Bot Messages</strong><br>${safe(json.analytics.botMessages)}</div><div class="analytics-card"><strong>Attachments</strong><br>${safe(json.analytics.attachments)}</div><div class="analytics-card"><strong>Embeds</strong><br>${safe(json.analytics.embeds)}</div></section><section class="messages">${messagesHtml || '<p>No messages found.</p>'}</section><div class="footer">Generated by Goliath</div></main></body></html>`;
  }

  function getTranscriptTargetChannelId(ticket, options = {}) {
    if (options.channelId) return options.channelId;
    if (options.transcriptChannelId) return options.transcriptChannelId;
    if (ticket.transcriptsChannelId) return ticket.transcriptsChannelId;
    if (ticket.logsChannelId) return ticket.logsChannelId;
    const panelMeta = ticket.metadata || {};
    if (panelMeta.transcriptsChannelId) return panelMeta.transcriptsChannelId;
    if (panelMeta.logsChannelId) return panelMeta.logsChannelId;
    const settings = getTicketSettings(ticket.guildId);
    return settings?.discord?.transcriptsChannelId || settings?.discord?.logsChannelId || null;
  }

  async function createTranscript(client, ticket, options = {}) {
    if (!client) throw new Error('Missing Discord client.');
    if (!ticket?.guildId) throw new Error('Missing ticket guildId.');
    const channelId = getChannelId(ticket);
    if (!channelId) throw new Error('Missing ticket Discord channel id.');
    const guild = await client.guilds.fetch(ticket.guildId).catch(() => null);
    if (!guild) throw new Error('Guild not found.');
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Ticket channel not found or invalid.');
    const messages = await fetchAllMessages(channel, options.limit || 1000);
    const jsonTranscript = buildJsonTranscript(ticket, messages, { channelName: channel.name, guildName: guild.name, generatedBy: options.generatedBy || null, reason: options.reason || null });
    const htmlTranscript = buildHtmlTranscript(ticket, jsonTranscript);
    const dir = getTranscriptDir(ticket.guildId);
    ensureDir(dir);
    const htmlFileName = formatFileName(ticket, 'html');
    const jsonFileName = formatFileName(ticket, 'json');
    const htmlPath = path.join(dir, htmlFileName);
    const jsonPath = path.join(dir, jsonFileName);
    fs.writeFileSync(htmlPath, htmlTranscript, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonTranscript, null, 2), 'utf8');
    return { ticketId: getTicketId(ticket), displayId: ticket.displayId || null, guildId: ticket.guildId, discordChannelId: channelId, messageCount: messages.length, htmlPath, jsonPath, htmlFileName, jsonFileName, generatedAt: jsonTranscript.generatedAt, analytics: jsonTranscript.analytics };
  }

  async function uploadTranscript(client, ticket, transcript, options = {}) {
    if (!client) throw new Error('Missing Discord client.');
    const targetChannelId = getTranscriptTargetChannelId(ticket, options);
    if (!targetChannelId) return { uploaded: false, reason: 'No transcript channel configured.' };
    const guild = await client.guilds.fetch(ticket.guildId).catch(() => null);
    if (!guild) throw new Error('Guild not found.');
    const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return { uploaded: false, reason: 'Transcript channel not found.' };
    const htmlAttachment = new AttachmentBuilder(transcript.htmlPath, { name: transcript.htmlFileName });
    const jsonAttachment = new AttachmentBuilder(transcript.jsonPath, { name: transcript.jsonFileName });
    const message = await channel.send({ content: `📄 **Ticket Transcript Generated**\n> Ticket: \`${ticket.displayId || getTicketId(ticket)}\`\n> Status: \`${ticket.status || 'unknown'}\`\n> Messages: \`${transcript.messageCount}\``, files: [htmlAttachment, jsonAttachment] });
    return { uploaded: true, channelId: channel.id, messageId: message.id, url: message.url };
  }

  async function createAndUploadTranscript(client, ticket, options = {}) {
    const transcript = await createTranscript(client, ticket, options);
    const upload = await uploadTranscript(client, ticket, transcript, options);
    const transcriptData = { generatedAt: transcript.generatedAt, htmlPath: transcript.htmlPath, jsonPath: transcript.jsonPath, htmlFileName: transcript.htmlFileName, jsonFileName: transcript.jsonFileName, messageCount: transcript.messageCount, analytics: transcript.analytics, uploaded: upload.uploaded === true, uploadChannelId: upload.channelId || null, uploadMessageId: upload.messageId || null, uploadUrl: upload.url || null };
    updateTicket(ticket.guildId, ticket.ticketId, { transcript: transcriptData });
    return { ...transcript, upload, transcriptData };
  }

  function fileSize(filePath) {
    try { return fs.statSync(filePath).size; } catch { return 0; }
  }

  function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function getStoredTranscriptPath(guildId, fileName) {
    const safeName = path.basename(String(fileName || ''));
    const fullPath = path.join(getTranscriptDir(guildId), safeName);
    if (!fullPath.startsWith(getTranscriptDir(guildId))) throw new Error('Invalid transcript path.');
    return fullPath;
  }

  function listStoredTranscriptFiles(guildId) {
    const dir = getTranscriptDir(guildId);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
    return files.map((jsonFileName) => {
      const jsonPath = path.join(dir, jsonFileName);
      let transcript = null;
      try { transcript = readJsonFile(jsonPath); } catch { transcript = null; }
      const htmlFileName = jsonFileName.replace(/\.json$/i, '.html');
      const htmlPath = path.join(dir, htmlFileName);
      return {
        source: 'file',
        guildId,
        ticketId: transcript?.ticket?.ticketId || null,
        displayId: transcript?.ticket?.displayId || null,
        ticketType: transcript?.ticket?.type || null,
        status: transcript?.ticket?.status || null,
        creatorId: transcript?.ticket?.creatorId || null,
        channelId: transcript?.ticket?.discordChannelId || null,
        generatedAt: transcript?.generatedAt || null,
        messageCount: transcript?.analytics?.messageCount || 0,
        attachments: transcript?.analytics?.attachments || 0,
        embeds: transcript?.analytics?.embeds || 0,
        jsonFileName,
        htmlFileName: fs.existsSync(htmlPath) ? htmlFileName : null,
        jsonSize: fileSize(jsonPath),
        htmlSize: fs.existsSync(htmlPath) ? fileSize(htmlPath) : 0,
      };
    });
  }

  function listTicketTranscriptRecords(guildId) {
    const ticketRecords = getAllTickets(guildId)
      .filter((ticket) => ticket.transcript)
      .map((ticket) => ({
        source: 'ticket',
        guildId,
        ticketId: ticket.ticketId,
        displayId: ticket.displayId || null,
        ticketType: ticket.type || null,
        status: ticket.status || null,
        creatorId: getCreatorId(ticket),
        channelId: getChannelId(ticket),
        generatedAt: ticket.transcript?.generatedAt || null,
        messageCount: ticket.transcript?.messageCount || ticket.transcript?.analytics?.messageCount || 0,
        attachments: ticket.transcript?.analytics?.attachments || 0,
        embeds: ticket.transcript?.analytics?.embeds || 0,
        uploaded: ticket.transcript?.uploaded === true,
        uploadUrl: ticket.transcript?.uploadUrl || null,
        jsonFileName: ticket.transcript?.jsonFileName || null,
        htmlFileName: ticket.transcript?.htmlFileName || null,
        jsonPath: ticket.transcript?.jsonPath || null,
        htmlPath: ticket.transcript?.htmlPath || null,
        jsonSize: ticket.transcript?.jsonPath ? fileSize(ticket.transcript.jsonPath) : 0,
        htmlSize: ticket.transcript?.htmlPath ? fileSize(ticket.transcript.htmlPath) : 0,
      }));

    const fileRecords = listStoredTranscriptFiles(guildId);
    const seen = new Set(ticketRecords.map((record) => record.jsonFileName).filter(Boolean));
    return [...ticketRecords, ...fileRecords.filter((record) => !seen.has(record.jsonFileName))]
      .sort((a, b) => (Date.parse(b.generatedAt || 0) || 0) - (Date.parse(a.generatedAt || 0) || 0));
  }

  function readTranscript(guildId, jsonFileName) {
    const jsonPath = getStoredTranscriptPath(guildId, jsonFileName);
    if (!fs.existsSync(jsonPath)) throw new Error('Transcript not found.');
    return readJsonFile(jsonPath);
  }

  function readTranscriptHtml(guildId, htmlFileName) {
    const htmlPath = getStoredTranscriptPath(guildId, htmlFileName);
    if (!fs.existsSync(htmlPath)) throw new Error('Transcript HTML not found.');
    return fs.readFileSync(htmlPath, 'utf8');
  }

  function getTranscriptOverview(guildId) {
    const records = listTicketTranscriptRecords(guildId);
    const storageBytes = records.reduce((total, record) => total + Number(record.jsonSize || 0) + Number(record.htmlSize || 0), 0);
    const byType = records.reduce((acc, record) => {
      const type = record.ticketType || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    return { total: records.length, storageBytes, uploaded: records.filter((record) => record.uploaded).length, byType };
  }

  ticketTranscriptManagerApi = {
    createTranscript,
    uploadTranscript,
    createAndUploadTranscript,
    buildJsonTranscript,
    buildHtmlTranscript,
    fetchAllMessages,
    getTicketId,
    getChannelId,
    getTranscriptDir,
    listTicketTranscriptRecords,
    readTranscript,
    readTranscriptHtml,
    getTranscriptOverview,
  };
}

module.exports = {
  ...ticketTranscriptManagerApi,
  ticketTranscriptManager: ticketTranscriptManagerApi,
};
