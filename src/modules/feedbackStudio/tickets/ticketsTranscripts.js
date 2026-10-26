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
      authorDisplayName: message.member?.displayName || message.author?.globalName || message.author?.username || message.author?.tag || 'Unknown',
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

  function buildTranscriptArchive(transcript, expected) {
    const saved = JSON.parse(fs.readFileSync(transcript.jsonPath, 'utf8'));
    if (String(saved.ticket?.guildId) !== String(expected.guildId)
      || String(saved.ticket?.discordChannelId) !== String(expected.channelId)
      || String(saved.ticket?.creatorId) !== String(expected.memberId)) throw Error('Transcript ownership could not be verified.');
    if (fs.statSync(transcript.htmlPath).size > 8_000_000) throw Error('The transcript is too large to download here.');
    const data = fs.readFileSync(transcript.htmlPath);
    const { deflateRawSync, crc32 } = require('node:zlib');
    const compressed = deflateRawSync(data);
    const name = Buffer.from('Investigation-Transcript.html');
    // Single-entry ZIP, UTF-8 filename, fixed DOS date (1 January 1980).
    // Keep the download in memory; no duplicate transcript files are stored.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
    const archive = Buffer.concat([local, name, compressed, central, name, end]);
    if (archive.length > 8_000_000) throw Error('The transcript is too large to download here.');
    return archive;
  }

  async function checkTranscriptCurrent(channel, transcript, options = {}) {
    if (!transcript?.htmlPath || !transcript?.jsonPath || !fs.existsSync(transcript.htmlPath) || !fs.existsSync(transcript.jsonPath)) return { current: false };
    let saved;
    try { saved = JSON.parse(fs.readFileSync(transcript.jsonPath, 'utf8')); } catch { return { current: false }; }
    if (String(saved.ticket?.discordChannelId) !== String(channel.id) || !Array.isArray(saved.messages)) return { current: false };
    const messages = await fetchAllMessages(channel, 10001);
    if (messages.length > 10000) return { current: false };
    const savedIds = new Set(saved.messages.map(message => message.id));
    const ignored = new Set((options.ignoredMessageIds || []).filter(id => id && !savedIds.has(id)));
    // Older archives did not store the closure message ID. Recognise only the exact
    // notice sent by this bot after export; other room messages remain evidence.
    if (options.allowLegacyClosureNotice && !ignored.size) {
      const description = 'Your investigation has ended, and your quarantine restrictions have been lifted.\n\nIf you need any further help, please contact server management.';
      const plain = `🔓 **Investigation Closed**\n\n${description}${options.caseId ? `\n\n**Case reference:** #${options.caseId}` : ''}`;
      const botId = channel.guild?.client?.user?.id;
      const notices = messages.filter(message => !savedIds.has(message.id) && botId && message.author?.id === botId
        && message.createdTimestamp >= Date.parse(transcript.generatedAt || saved.generatedAt)
        && ((message.content === plain && !message.embeds.length)
          || (!message.content && message.embeds.length === 1 && message.embeds[0].title === '🔓 Investigation Closed'
            && message.embeds[0].description === description && message.embeds[0].footer?.text === 'Private Moderation Review'
            && JSON.stringify(message.embeds[0].fields || []) === JSON.stringify(options.caseId ? [{ name: '📁 Case reference', value: `#${options.caseId}`, inline: true }] : [])))
        && !message.attachments.size && !message.components?.length);
      if (notices.length === 1) ignored.add(notices[0].id);
    }
    // Names/avatars and signed attachment URLs can change without the conversation changing.
    const evidence = message => ({ id: message.id, authorId: message.authorId, content: message.content,
      createdAt: message.createdAt, editedAt: message.editedAt, system: message.system,
      attachments: message.attachments?.map(({ id, name, contentType, size }) => ({ id, name, contentType, size })),
      embeds: message.embeds, components: message.components });
    const current = messages.filter(message => !ignored.has(message.id)).map(message => evidence(serializeMessage(message)));
    return { current: JSON.stringify(current) === JSON.stringify(saved.messages.map(evidence)), lastMessageId: messages.at(-1)?.id || null };
  }

  function buildJsonTranscript(ticket, messages, meta = {}) {
    const entries = messages.map(serializeMessage);
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
        messageCount: entries.length,
        userMessages: entries.filter((m) => !m.authorBot).length,
        botMessages: entries.filter((m) => m.authorBot).length,
        attachments: entries.reduce((acc, m) => acc + m.attachments.length, 0),
        embeds: entries.reduce((acc, m) => acc + m.embeds.length, 0),
        participants: new Set(entries.map(m => m.authorId).filter(Boolean)).size,
      },
      meta,
      messages: entries,
    };
  }

  function externalUrl(value) {
    try { const url = new URL(String(value || '')); return ['https:', 'http:'].includes(url.protocol) ? safe(url.href) : ''; }
    catch { return ''; }
  }

  function readableTime(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return 'Not recorded';
    return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(date)} UTC`;
  }

  function richText(value, names = {}) {
    const tokens = [];
    const hold = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    let text = safe(String(value || '').replace(/\u0000/g, ''));
    text = text.replace(/```(?:[a-z0-9_-]+\n)?([\s\S]*?)```/gi, (_, code) => hold(`<pre><code>${code}</code></pre>`));
    text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));
    text = text.replace(/&lt;@!?([0-9]+)&gt;/g, (_, id) => hold(`<span class="mention">@${safe(names.users?.[id] || `User ${id}`)}</span>`));
    text = text.replace(/&lt;@&amp;([0-9]+)&gt;/g, (_, id) => hold(`<span class="mention">@${safe(names.roles?.[id] || `Role ${id}`)}</span>`));
    text = text.replace(/&lt;#([0-9]+)&gt;/g, (_, id) => hold(`<span class="mention">#${safe(names.channels?.[id] || `Channel ${id}`)}</span>`));
    text = text.replace(/&lt;a?:([a-z0-9_]+):[0-9]+&gt;/gi, (_, name) => `:${name}:`);
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<u>$1</u>');
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
    return text.replace(/\u0000([0-9]+)\u0000/g, (_, index) => tokens[Number(index)] || '');
  }

  function renderAttachment(file) {
    const url = externalUrl(file.url);
    if (!url) return `<div class="attachment">${safe(file.name || 'Attachment')} — link unavailable</div>`;
    const image = file.contentType?.startsWith('image/');
    const size = Number.isFinite(file.size) ? ` · ${(file.size / 1024).toFixed(1)} KB` : '';
    return `<div class="attachment"><a href="${url}" target="_blank" rel="noopener noreferrer">📎 ${safe(file.name || 'Attachment')}</a><span class="muted">${size}</span>${image ? `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="attachment-image" loading="lazy" src="${url}" alt="${safe(file.name || 'Image attachment')}" /></a>` : ''}</div>`;
  }

  function renderEmbed(embed, names) {
    const fields = (embed.fields || []).map(field => `<div class="embed-field"><strong>${richText(field.name, names)}</strong><div class="rich">${richText(field.value, names)}</div></div>`).join('');
    return `<section class="embed">${embed.title ? `<h3>${richText(embed.title, names)}</h3>` : ''}${embed.description ? `<div class="rich">${richText(embed.description, names)}</div>` : ''}${fields}</section>`;
  }

  function renderMessage(msg, meta, guildId, channelId) {
    const names = meta.mentionNames || {};
    const attachments = (msg.attachments || []).map(renderAttachment).join('');
    const embeds = (msg.embeds || []).map(embed => renderEmbed(embed, names)).join('');
    const avatar = externalUrl(msg.authorAvatar);
    const permalink = [guildId, channelId, msg.id].every(id => /^\d{15,25}$/.test(String(id || ''))) ? `https://discord.com/channels/${guildId}/${channelId}/${msg.id}` : '';
    return `<article class="message" data-message data-bot="${msg.authorBot ? 'true' : 'false'}"><div class="avatar">${avatar ? `<img loading="lazy" src="${avatar}" alt="" />` : '<span aria-hidden="true">👤</span>'}</div><div class="message-body"><header class="message-header"><strong class="author">${safe(msg.authorDisplayName || msg.authorTag)}</strong>${msg.authorBot ? '<span class="badge">BOT</span>' : ''}${msg.system ? '<span class="badge">SYSTEM</span>' : ''}<time datetime="${safe(msg.createdAt || '')}">${safe(readableTime(msg.createdAt))}</time>${msg.editedAt ? `<span class="muted" title="${safe(readableTime(msg.editedAt))}">edited</span>` : ''}</header>${msg.content ? `<div class="rich">${richText(msg.content, names)}</div>` : !attachments && !embeds ? '<p class="muted">No text was recorded for this message.</p>' : ''}${attachments}${embeds}<details class="message-details"><summary>Message details</summary><div>Author: ${safe(msg.authorTag)} · ID: ${safe(msg.authorId)}</div><div>Message ID: ${safe(msg.id)}</div>${permalink ? `<a href="${permalink}" target="_blank" rel="noopener noreferrer">Open original message in Discord ↗</a>` : ''}</details></div></article>`;
  }

  function buildHtmlTranscript(ticket, json) {
    const investigation = ticket.type === 'investigation';
    const title = investigation ? 'Investigation Transcript' : 'Ticket Transcript';
    const ticketId = ticket.displayId || getTicketId(ticket);
    const meta = json.meta || {};
    const card = (label, value) => `<div class="card"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`;
    const status = String(ticket.status || 'unknown').replace(/_/g, ' ');
    const metadata = [card('Server', meta.guildName || ticket.guildId), card('Room', meta.channelName ? `#${meta.channelName}` : getChannelId(ticket)),
      card(investigation ? 'Case reference' : 'Ticket reference', ticket.metadata?.caseId ? `#${ticket.metadata.caseId}` : ticketId),
      card('Status at export', status.charAt(0).toUpperCase() + status.slice(1)), card('Exported', readableTime(json.generatedAt))];
    if (!investigation && ticket.priority) metadata.push(card('Priority', ticket.priority));
    const entries = json.messages || [];
    // Recompute from the stored message records so older exports with invalid counters render correctly too.
    const counts = { messages: entries.length, people: entries.filter(msg => !msg.authorBot).length, bots: entries.filter(msg => msg.authorBot).length,
      attachments: entries.reduce((sum, msg) => sum + (msg.attachments || []).length, 0), participants: new Set(entries.map(msg => msg.authorId).filter(Boolean)).size };
    let previousDay = '';
    const messagesHtml = entries.map(msg => {
      const day = String(msg.createdAt || '').slice(0, 10);
      const divider = day && day !== previousDay ? `<h2 class="day">${safe(readableTime(msg.createdAt).split(',')[0])}</h2>` : '';
      previousDay = day;
      return divider + renderMessage(msg, meta, ticket.guildId, getChannelId(ticket));
    }).join('\n');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${title} — ${safe(meta.channelName || ticketId)}</title><style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#141d30;--border:#29364d;--text:#e9eff8;--muted:#a8b7cb;--accent:#a5c7ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1120px;margin:auto;padding:32px 20px}h1{font-size:clamp(25px,4vw,36px);line-height:1.2;margin:8px 0 12px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;color:var(--muted);font-size:11px;font-weight:700}.header{border:1px solid var(--border);border-radius:20px;padding:28px;background:var(--panel)}.header p{margin:0 0 22px;color:var(--muted)}.metadata,.analytics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.card{padding:12px 14px;border:1px solid var(--border);border-radius:12px;min-width:0}.card span{display:block;color:var(--muted);font-size:12px}.card strong{display:block;font-size:14px;overflow-wrap:anywhere}.analytics{margin:18px 0}.analytics .card strong{font-size:24px}.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin:22px 0}.toolbar input[type=search]{flex:1;min-width:180px;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font:inherit}.toolbar label,.muted,time,.message-details{color:var(--muted);font-size:12px}.day{font-size:13px;color:var(--muted);margin:28px 0 12px}.message{display:flex;gap:13px;border:1px solid var(--border);border-radius:14px;background:var(--panel);padding:18px;margin-bottom:10px}.avatar{flex:0 0 38px}.avatar img,.avatar span{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#25314a}.message-body{min-width:0;flex:1}.message-header{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:7px}.author{color:var(--accent)}.badge{font-size:10px;border:1px solid #5b6d94;background:#283a63;padding:0 6px;border-radius:5px}.rich{white-space:pre-wrap;overflow-wrap:anywhere}.rich code{white-space:pre-wrap;background:#070d19;border:1px solid var(--border);border-radius:4px;padding:1px 4px}pre{overflow:auto;background:#070d19;padding:12px;border-radius:8px}pre code{border:0!important;padding:0!important}a{color:var(--accent)}.mention{background:#2c3f68;border-radius:4px;padding:0 3px}.attachment{margin-top:12px}.attachment-image{display:block;max-width:min(100%,480px);max-height:360px;object-fit:contain;object-position:left;margin-top:8px;border-radius:8px}.embed{margin-top:12px;padding:14px 16px;border-left:3px solid #82aaff;background:#10182a;border-radius:6px}.embed h3{font-size:15px;margin:0 0 8px}.embed-field{margin-top:12px}.embed-field>strong{display:block;margin-bottom:2px}.message-details{margin-top:12px}.message-details summary{cursor:pointer}.footer{font-size:12px;color:var(--muted);padding:26px 0}.empty{color:var(--muted);padding:24px;text-align:center}[hidden]{display:none!important}@media(max-width:600px){.wrap{padding:16px 10px}.header{padding:18px}.message{padding:12px;gap:9px}.avatar{flex-basis:28px}.avatar img,.avatar span{width:28px;height:28px}.metadata,.analytics{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{align-items:stretch}.toolbar input[type=search]{width:100%}}@media print{:root{color-scheme:light;--bg:#fff;--panel:#fff;--border:#ccc;--text:#111;--muted:#444;--accent:#17478a}.wrap{max-width:none;padding:0}.toolbar,.message-details,#no-results{display:none}.header{padding:16px}.message{break-inside:avoid}.avatar{display:none}.embed{background:#f5f5f5}.mention{background:#eee}.attachment-image{max-height:250px}a{color:#111}.message[hidden]{display:flex!important}}
</style></head><body><main class="wrap"><section class="header"><div class="eyebrow">Private conversation record</div><h1>${investigation ? '🔎' : '📄'} ${title}</h1><p>A chronological record of the conversation, captured at the time shown below.</p><div class="metadata">${metadata.join('')}</div></section><section class="analytics" aria-label="Conversation totals">${card('Total messages', counts.messages)}${card('Member messages', counts.people)}${card('Bot messages', counts.bots)}${card('Participants', counts.participants)}${card('Attachments', counts.attachments)}</section><section class="toolbar" aria-label="Transcript filters"><input id="search" type="search" placeholder="Search messages or names…" aria-label="Search messages or names" /><label><input id="bots" type="checkbox" checked /> Include bot messages</label><output id="visible" aria-live="polite">${counts.messages} messages</output></section><section class="messages" aria-label="Conversation">${messagesHtml || '<p class="empty">No messages were recorded.</p>'}</section><p class="empty" id="no-results" hidden>No messages match your search.</p><footer class="footer">Private conversation record · All times are shown in UTC.<br>Original message content and author identities are retained. Attachment links point to the original files and may expire.</footer></main><script>
const search=document.getElementById('search'),bots=document.getElementById('bots'),rows=[...document.querySelectorAll('[data-message]')];function filter(){const query=search.value.toLocaleLowerCase();let count=0;for(const row of rows){row.hidden=(!bots.checked&&row.dataset.bot==='true')||!row.textContent.toLocaleLowerCase().includes(query);if(!row.hidden)count++;}document.getElementById('visible').textContent=count+' of '+rows.length+' messages';document.getElementById('no-results').hidden=count!==0;}search.addEventListener('input',filter);bots.addEventListener('change',filter);
</script></body></html>`;
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
    if (options.requireComplete && messages.length >= (options.limit || 1000)) {
      const older = await channel.messages.fetch({ limit: 1, before: messages[0]?.id });
      if (older.size) throw new Error('This room exceeds the transcript limit. The room was not deleted; export its complete history before continuing.');
    }
    const mentionNames = { users: {}, roles: {}, channels: {} };
    for (const member of guild.members?.cache?.values?.() || []) mentionNames.users[member.id] = member.displayName || member.user?.username || member.id;
    for (const role of guild.roles?.cache?.values?.() || []) mentionNames.roles[role.id] = role.name;
    for (const item of guild.channels?.cache?.values?.() || []) mentionNames.channels[item.id] = item.name;
    for (const message of messages) for (const user of message.mentions?.users?.values?.() || []) mentionNames.users[user.id] ||= user.globalName || user.username;
    const jsonTranscript = buildJsonTranscript(ticket, messages, { mentionNames, channelName: channel.name, guildName: guild.name, generatedBy: options.generatedBy || null, reason: options.reason || null });
    const htmlTranscript = buildHtmlTranscript(ticket, jsonTranscript);
    const dir = getTranscriptDir(ticket.guildId);
    ensureDir(dir);
    const htmlFileName = formatFileName(ticket, 'html');
    const jsonFileName = formatFileName(ticket, 'json');
    const htmlPath = path.join(dir, htmlFileName);
    const jsonPath = path.join(dir, jsonFileName);
    fs.writeFileSync(htmlPath, htmlTranscript, 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonTranscript, null, 2), 'utf8');
    return { ticketId: getTicketId(ticket), displayId: ticket.displayId || null, guildId: ticket.guildId, discordChannelId: channelId, messageCount: messages.length, lastMessageId: messages.at(-1)?.id || null, htmlPath, jsonPath, htmlFileName, jsonFileName, generatedAt: jsonTranscript.generatedAt, analytics: jsonTranscript.analytics };
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
    checkTranscriptCurrent,
    buildTranscriptArchive,
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
