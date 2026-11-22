import { ThemedSelect } from '../../../ui/DiscordResourceSelects.jsx';
import React, { useMemo, useState } from 'react';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ticketId(ticket = {}) {
  return ticket.ticketId || ticket.id || ticket.displayId || ticket.channelId || '';
}

function status(ticket = {}) {
  return String(ticket.status || 'open').toLowerCase();
}

function type(ticket = {}) {
  return String(ticket.type || ticket.ticketType || ticket.metadata?.type || 'support').toLowerCase();
}

function creator(ticket = {}) {
  return ticket.creatorTag || ticket.creatorName || ticket.metadata?.submitterTag || ticket.metadata?.creatorTag || ticket.creatorId || ticket.userId || 'Unknown';
}

function assignee(ticket = {}) {
  const ids = list(ticket.assignedStaffIds);
  return ticket.claimedById || ticket.assignedUserId || ids[0] || '';
}

function hasTranscript(ticket = {}) {
  return Boolean(ticket.transcript || ticket.transcriptId || ticket.transcriptUrl || ticket.transcriptHtml || ticket.transcriptJson);
}

function transcriptText(ticket = {}) {
  const transcript = ticket.transcript;
  if (typeof transcript === 'string') return transcript;
  if (Array.isArray(transcript?.messages)) {
    return transcript.messages.map((message) => {
      const author = message.authorTag || message.author || message.user || message.userId || 'Unknown';
      const content = message.content || message.text || '';
      return `[${message.createdAt || message.timestamp || ''}] ${author}: ${content}`;
    }).join('\n');
  }
  if (Array.isArray(ticket.messages)) {
    return ticket.messages.map((message) => `${message.author || message.userId || 'Unknown'}: ${message.content || ''}`).join('\n');
  }
  if (ticket.transcriptJson) return JSON.stringify(ticket.transcriptJson, null, 2);
  return ticket.transcriptUrl || ticket.transcriptId || 'Transcript metadata is stored, but no inline preview is available.';
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function duration(start, end) {
  const left = Date.parse(start || 0) || 0;
  const right = Date.parse(end || 0) || 0;
  if (!left || !right || right < left) return 'Unknown';
  const minutes = Math.floor((right - left) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function fieldStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.55)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '10px 11px',
    fontWeight: 850,
    outline: 'none',
    width: '100%',
  };
}

function buttonStyle(theme, disabled = false) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.35)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '9px 11px',
    fontWeight: 950,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

function Stat({ theme, label, value, accent = '#93c5fd' }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 14, padding: 12 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 6, color: accent, fontSize: 24, fontWeight: 950 }}>{value}</div>
    </div>
  );
}

function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function TicketTranscriptCentre({ theme, tickets = [] }) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedId, setSelectedId] = useState('');

  const data = useMemo(() => {
    const all = list(tickets);
    const withTranscript = all.filter(hasTranscript);
    const types = [...new Set(all.map(type).filter(Boolean))].sort();
    const filtered = withTranscript.filter((ticket) => {
      const haystack = [ticketId(ticket), ticket.displayId, ticket.title, ticket.description, creator(ticket), assignee(ticket), type(ticket), status(ticket), transcriptText(ticket)].join(' ').toLowerCase();
      const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
      const matchesType = filterType === 'all' || type(ticket) === filterType;
      const matchesStatus = filterStatus === 'all' || status(ticket) === filterStatus;
      return matchesQuery && matchesType && matchesStatus;
    }).sort((a, b) => (Date.parse(b.closedAt || b.updatedAt || b.createdAt || 0) || 0) - (Date.parse(a.closedAt || a.updatedAt || a.createdAt || 0) || 0));

    return { all, withTranscript, types, filtered };
  }, [tickets, query, filterType, filterStatus]);

  const selected = data.filtered.find((ticket) => ticketId(ticket) === selectedId) || data.filtered[0] || null;
  const preview = selected ? transcriptText(selected) : '';
  const jsonPayload = selected ? JSON.stringify({ ticket: selected, transcript: selected.transcript || selected.transcriptJson || null }, null, 2) : '';

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 20, boxShadow: theme.shadow, display: 'grid', gap: 16 }}>
      <div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ticket Dashboard</div>
        <h3 style={{ margin: '6px 0 0' }}>Transcript Centre</h3>
        <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Search, inspect and export saved ticket transcript records.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: 10 }}>
        <Stat theme={theme} label="Tickets" value={data.all.length} />
        <Stat theme={theme} label="Transcripts" value={data.withTranscript.length} accent="#86efac" />
        <Stat theme={theme} label="Filtered" value={data.filtered.length} accent="#c4b5fd" />
        <Stat theme={theme} label="Coverage" value={`${data.all.length ? Math.round((data.withTranscript.length / data.all.length) * 100) : 0}%`} accent="#fcd34d" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(min(100%, 180px), 0.4fr) minmax(min(100%, 180px), 0.4fr)', gap: 10 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by user, ticket ID, title, staff or transcript text..." style={fieldStyle(theme)} />
        <ThemedSelect theme={theme} value={filterType} onChange={(event) => setFilterType(event.target.value)} style={fieldStyle(theme)}>
          <option value="all">All types</option>
          {data.types.map((item) => <option key={item} value={item}>{item}</option>)}
        </ThemedSelect>
        <ThemedSelect theme={theme} value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} style={fieldStyle(theme)}>
          <option value="all">All statuses</option>
          <option value="closed">Closed</option>
          <option value="archived">Archived</option>
          <option value="open">Open</option>
          <option value="claimed">Claimed</option>
        </ThemedSelect>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(100%, 320px), 0.8fr) minmax(0, 1.2fr)', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          {data.filtered.length ? data.filtered.map((ticket) => {
            const id = ticketId(ticket);
            const active = selected && ticketId(selected) === id;
            return (
              <button key={id} type="button" onClick={() => setSelectedId(id)} style={{ textAlign: 'left', border: `1px solid ${active ? '#93c5fd' : theme.cardBorder}`, background: active ? 'rgba(59,130,246,0.13)' : 'rgba(15,23,42,0.24)', color: theme.cardText, borderRadius: 14, padding: 12, display: 'grid', gap: 5, cursor: 'pointer' }}>
                <strong>{ticket.displayId || id}</strong>
                <span style={{ color: theme.mutedText, fontSize: 12 }}>{ticket.title || type(ticket)} • {creator(ticket)}</span>
                <span style={{ color: theme.mutedText, fontSize: 12 }}>Closed: {formatDate(ticket.closedAt || ticket.archivedAt)} • Resolution: {duration(ticket.createdAt, ticket.closedAt || ticket.archivedAt)}</span>
              </button>
            );
          }) : <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 14, color: theme.mutedText }}>No transcript records match your filters.</div>}
        </div>

        <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 16, padding: 14, display: 'grid', gap: 12, minWidth: 0 }}>
          {selected ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ fontSize: 18 }}>{selected.displayId || ticketId(selected)}</strong>
                  <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>{selected.title || type(selected)} • {status(selected)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.transcriptUrl ? <a href={selected.transcriptUrl} target="_blank" rel="noreferrer" style={buttonStyle(theme)}>Open</a> : null}
                  <button type="button" onClick={() => downloadText(`${selected.displayId || ticketId(selected)}.txt`, preview)} style={buttonStyle(theme)}>TXT</button>
                  <button type="button" onClick={() => downloadText(`${selected.displayId || ticketId(selected)}.json`, jsonPayload, 'application/json')} style={buttonStyle(theme)}>JSON</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 8, color: theme.mutedText, fontSize: 13 }}>
                <div><strong style={{ color: theme.cardText }}>Creator:</strong> {creator(selected)}</div>
                <div><strong style={{ color: theme.cardText }}>Staff:</strong> {assignee(selected) || 'None'}</div>
                <div><strong style={{ color: theme.cardText }}>Type:</strong> {type(selected)}</div>
                <div><strong style={{ color: theme.cardText }}>Resolution:</strong> {duration(selected.createdAt, selected.closedAt || selected.archivedAt)}</div>
              </div>

              <pre style={{ margin: 0, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: `1px solid ${theme.cardBorder}`, background: 'rgba(2,6,23,0.45)', borderRadius: 12, padding: 12, color: theme.cardText, lineHeight: 1.5 }}>{preview}</pre>
            </>
          ) : <span style={{ color: theme.mutedText }}>Select a transcript to preview it.</span>}
        </div>
      </div>
    </section>
  );
}
