import { ThemedSelect } from '../../../ui/DiscordResourceSelects.jsx';
import React, { useMemo, useState } from 'react';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleString();
}

function getTicketId(ticket = {}) {
  return ticket.ticketId || ticket.id || ticket.displayId || ticket.channelId || '';
}

function getStatus(ticket = {}) {
  return String(ticket.status || 'open').toLowerCase();
}

function getAssigned(ticket = {}) {
  return ticket.assignedUserId || ticket.claimedBy || ticket.claimedById || '';
}

function getChannelId(ticket = {}) {
  return ticket.discordChannelId || ticket.channelId || '';
}

function getSubmissionId(ticket = {}) {
  return ticket.formSubmissionId || ticket.metadata?.submissionId || ticket.submissionId || '';
}

function getFormId(ticket = {}) {
  return ticket.metadata?.formId || ticket.sourceId || ticket.formId || '';
}

function statusTone(status = '') {
  const clean = String(status || 'open').toLowerCase();
  if (clean === 'open') return '#86efac';
  if (clean === 'claimed') return '#93c5fd';
  if (clean === 'waiting_user') return '#fcd34d';
  if (clean === 'in_review') return '#c4b5fd';
  if (clean === 'closed') return '#fcd34d';
  if (clean === 'archived') return '#c4b5fd';
  if (clean === 'deleted') return '#fca5a5';
  return '#94a3b8';
}

function priorityTone(priority = '') {
  const clean = String(priority || 'normal').toLowerCase();
  if (clean === 'urgent') return '#fca5a5';
  if (clean === 'high') return '#fcd34d';
  if (clean === 'low') return '#86efac';
  return '#94a3b8';
}

function buttonStyle(theme, variant = 'soft', disabled = false) {
  const variants = {
    soft: { background: 'rgba(15,23,42,0.35)', color: theme.cardText, border: `1px solid ${theme.cardBorder}` },
    primary: { background: 'rgba(37,99,235,0.24)', color: theme.cardText, border: '1px solid rgba(147,197,253,0.35)' },
    success: { background: 'rgba(34,197,94,0.14)', color: '#86efac', border: '1px solid rgba(134,239,172,0.35)' },
    warning: { background: 'rgba(245,158,11,0.13)', color: '#fcd34d', border: '1px solid rgba(252,211,77,0.35)' },
    danger: { background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(252,165,165,0.35)' },
    purple: { background: 'rgba(168,85,247,0.13)', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.35)' },
  };

  return {
    ...variants[variant],
    borderRadius: 12,
    padding: '10px 12px',
    fontWeight: 950,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

function Badge({ tone, children }) {
  return (
    <span style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </span>
  );
}

function Detail({ theme, label, value, hint, tone }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 14, padding: 13, display: 'grid', gap: 4 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: tone || theme.cardText, fontWeight: 950, overflowWrap: 'anywhere' }}>{value || 'None'}</div>
      {hint ? <div style={{ color: theme.mutedText, fontSize: 12, overflowWrap: 'anywhere' }}>{hint}</div> : null}
    </div>
  );
}

function buildTimeline(ticket = {}) {
  const metadata = asObject(ticket.metadata);
  const events = [
    ...(ticket.createdAt ? [{ type: 'created', label: 'Ticket created', createdAt: ticket.createdAt, actorId: ticket.creatorId || ticket.userId }] : []),
    ...(ticket.claimedAt ? [{ type: 'claimed', label: 'Ticket claimed', createdAt: ticket.claimedAt, actorId: ticket.claimedBy || ticket.claimedById }] : []),
    ...(ticket.assignedAt ? [{ type: 'assigned', label: 'Ticket assigned', createdAt: ticket.assignedAt, actorId: ticket.assignedUserId }] : []),
    ...(ticket.closedAt ? [{ type: 'closed', label: 'Ticket closed', createdAt: ticket.closedAt, actorId: ticket.closedBy }] : []),
    ...(ticket.archivedAt ? [{ type: 'archived', label: 'Ticket archived', createdAt: ticket.archivedAt, actorId: ticket.archivedBy }] : []),
    ...(ticket.deletedAt ? [{ type: 'deleted', label: 'Ticket deleted', createdAt: ticket.deletedAt, actorId: ticket.deletedBy }] : []),
    ...safeArray(ticket.timeline),
    ...safeArray(ticket.notes).map((note) => ({ type: 'note', label: 'Staff note added', createdAt: note.createdAt, actorId: note.actorId || note.authorId, note: note.note || note.content })),
    ...(metadata.submissionId ? [{ type: 'form_linked', label: 'Linked to form submission', createdAt: ticket.createdAt, actorId: null }] : []),
  ];

  const seen = new Set();
  return events
    .filter(Boolean)
    .sort((a, b) => (Date.parse(a.createdAt || 0) || 0) - (Date.parse(b.createdAt || 0) || 0))
    .filter((event) => {
      const key = `${event.type}:${event.label}:${event.createdAt}:${event.actorId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export default function TicketReviewWorkspace({ theme, ticket, acting = false, roles = [], onAction, onAssign, onStatus, onNote }) {
  const [assignedUserId, setAssignedUserId] = useState('');
  const [status, setStatus] = useState('in_review');
  const [note, setNote] = useState('');
  const timeline = useMemo(() => buildTimeline(ticket || {}), [ticket]);

  if (!ticket) {
    return (
      <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.mutedText, borderRadius: 22, padding: 22, boxShadow: theme.shadow }}>
        Select a ticket to view review tools, assignment, notes, workflow links and timeline.
      </section>
    );
  }

  const id = getTicketId(ticket);
  const currentStatus = getStatus(ticket);
  const deleted = currentStatus === 'deleted' || Boolean(ticket.deletedAt);
  const closed = currentStatus === 'closed';
  const archived = currentStatus === 'archived';
  const channelId = getChannelId(ticket);
  const assigned = getAssigned(ticket);
  const metadata = asObject(ticket.metadata);

  async function assignTicket() {
    if (!assignedUserId || !onAssign) return;
    await onAssign(ticket, assignedUserId);
    setAssignedUserId('');
  }

  async function updateStatus() {
    if (!status || !onStatus) return;
    await onStatus(ticket, status);
  }

  async function addNote() {
    if (!note.trim() || !onNote) return;
    await onNote(ticket, note.trim());
    setNote('');
  }

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 22, boxShadow: theme.shadow, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ticket Review Workspace</div>
          <h2 style={{ margin: '6px 0 0' }}>{ticket.title || ticket.subject || ticket.type || `Ticket ${id}`}</h2>
          <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>{ticket.description || 'No ticket description stored.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {ticket.source === 'form' || getSubmissionId(ticket) ? <Badge tone="#c4b5fd">Form Ticket</Badge> : null}
          {!channelId && !['closed', 'archived', 'deleted'].includes(currentStatus) ? <Badge tone="#fca5a5">Missing Channel</Badge> : null}
          <Badge tone={statusTone(currentStatus)}>{currentStatus}</Badge>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10 }}>
        <Detail theme={theme} label="Ticket ID" value={id} />
        <Detail theme={theme} label="Display ID" value={ticket.displayId} />
        <Detail theme={theme} label="Priority" value={ticket.priority || 'normal'} tone={priorityTone(ticket.priority)} />
        <Detail theme={theme} label="Assigned" value={assigned ? `<@${assigned}>` : 'Unassigned'} />
        <Detail theme={theme} label="Channel" value={channelId || 'Missing'} tone={!channelId ? '#fca5a5' : undefined} />
        <Detail theme={theme} label="Transcript" value={ticket.transcriptUrl || ticket.transcriptId || ticket.transcript ? 'Saved' : 'Not saved'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }}>
        <Detail theme={theme} label="Source" value={ticket.source || 'discord'} />
        <Detail theme={theme} label="Form ID" value={getFormId(ticket)} />
        <Detail theme={theme} label="Submission ID" value={getSubmissionId(ticket)} />
        <Detail theme={theme} label="Creator" value={ticket.creatorTag || ticket.creatorName || metadata.creatorTag || metadata.submitterTag || ticket.creatorId || ticket.userId || 'Unknown'} />
      </div>

      <div style={{ display: 'grid', gap: 10, padding: 13, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, background: 'rgba(15,23,42,0.24)' }}>
        <strong>Quick Actions</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" disabled={acting || deleted || currentStatus !== 'open'} onClick={() => onAction?.('claim', ticket)} style={buttonStyle(theme, 'primary', acting || deleted || currentStatus !== 'open')}>Claim</button>
          <button type="button" disabled={acting || deleted || !['open', 'claimed', 'waiting_user', 'in_review'].includes(currentStatus)} onClick={() => onAction?.('close', ticket)} style={buttonStyle(theme, 'warning', acting || deleted || !['open', 'claimed', 'waiting_user', 'in_review'].includes(currentStatus))}>Close</button>
          <button type="button" disabled={acting || deleted || !(closed || archived)} onClick={() => onAction?.('reopen', ticket)} style={buttonStyle(theme, 'success', acting || deleted || !(closed || archived))}>Reopen</button>
          <button type="button" disabled={acting || deleted || !closed} onClick={() => onAction?.('archive', ticket)} style={buttonStyle(theme, 'purple', acting || deleted || !closed)}>Archive</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
        <div style={{ display: 'grid', gap: 10, padding: 13, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, background: 'rgba(15,23,42,0.24)' }}>
          <strong>Assign Ticket</strong>
          <ThemedSelect theme={theme} value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 11px', fontWeight: 850 }}>
            <option value="">Select staff role/member ID</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name || role.id}</option>)}
          </ThemedSelect>
          <button type="button" disabled={acting || !assignedUserId || !onAssign} onClick={assignTicket} style={buttonStyle(theme, 'primary', acting || !assignedUserId || !onAssign)}>Assign</button>
        </div>

        <div style={{ display: 'grid', gap: 10, padding: 13, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, background: 'rgba(15,23,42,0.24)' }}>
          <strong>Update Workflow State</strong>
          <ThemedSelect theme={theme} value={status} onChange={(event) => setStatus(event.target.value)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 11px', fontWeight: 850 }}>
            <option value="open">Open</option>
            <option value="claimed">Claimed</option>
            <option value="waiting_user">Waiting User</option>
            <option value="in_review">In Review</option>
            <option value="closed">Closed</option>
          </ThemedSelect>
          <button type="button" disabled={acting || !onStatus} onClick={updateStatus} style={buttonStyle(theme, 'soft', acting || !onStatus)}>Update Status</button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <strong>Staff Notes</strong>
        {safeArray(ticket.notes).length ? safeArray(ticket.notes).map((entry) => (
          <div key={entry.id || entry.createdAt} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 11, background: 'rgba(15,23,42,0.24)' }}>
            <span style={{ color: theme.mutedText, fontSize: 12 }}>{formatDate(entry.createdAt)} • {entry.actorId || entry.authorId || 'Staff'}</span>
            <p style={{ margin: '6px 0 0', color: theme.cardText, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{entry.note || entry.content || ''}</p>
          </div>
        )) : <div style={{ color: theme.mutedText }}>No notes stored yet.</div>}
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a staff note..." style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 11px', fontWeight: 800 }} />
        <button type="button" disabled={acting || !note.trim() || !onNote} onClick={addNote} style={{ ...buttonStyle(theme, 'soft', acting || !note.trim() || !onNote), justifySelf: 'start' }}>Add Note</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <strong>Timeline</strong>
        {timeline.length ? timeline.map((event, index) => (
          <div key={`${event.type}-${event.createdAt}-${index}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, marginTop: 5, background: '#93c5fd', boxShadow: '0 0 16px rgba(147,197,253,0.45)' }} />
            <div style={{ borderBottom: `1px solid ${theme.cardBorder}`, paddingBottom: 10 }}>
              <strong style={{ color: theme.cardText }}>{event.label || event.type}</strong>
              <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{formatDate(event.createdAt)}{event.actorId ? ` • ${event.actorId}` : ''}</div>
              {event.note ? <p style={{ margin: '6px 0 0', color: theme.mutedText, whiteSpace: 'pre-wrap' }}>{event.note}</p> : null}
            </div>
          </div>
        )) : <div style={{ color: theme.mutedText }}>No timeline events yet.</div>}
      </div>
    </section>
  );
}
