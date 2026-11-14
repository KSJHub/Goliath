import { DASHBOARD_EMOJIS as E } from '../../../shared/PageShell';
import React, { useMemo } from 'react';

import EmptyState from '../../../shared/EmptyState.jsx';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getTicketId(ticket = {}) {
  return ticket.ticketId || ticket.id || ticket.displayId || ticket.channelId || '';
}

function getStatus(ticket = {}) {
  return String(ticket.status || 'open').toLowerCase();
}

function getAssignee(ticket = {}) {
  return ticket.assignedUserId || ticket.claimedBy || ticket.claimedById || ticket.assigneeId || '';
}

function getCreatedAt(ticket = {}) {
  return Date.parse(ticket.createdAt || ticket.openedAt || ticket.updatedAt || 0) || 0;
}

function ageMs(ticket = {}) {
  const created = getCreatedAt(ticket);
  return created ? Date.now() - created : 0;
}

function formatDuration(ms = 0) {
  if (!ms || ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 48) return `${hours}h ${restMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function isOpen(ticket = {}) {
  return !['closed', 'archived', 'deleted'].includes(getStatus(ticket));
}

function isFormTicket(ticket = {}) {
  const metadata = asObject(ticket.metadata);
  return ticket.source === 'form' || Boolean(ticket.formSubmissionId || ticket.submissionId || metadata.submissionId);
}

function hasMissingChannel(ticket = {}) {
  if (!isOpen(ticket)) return false;
  return !ticket.discordChannelId && !ticket.channelId;
}

function toneForAge(ms) {
  const hours = ms / 3600000;
  if (hours >= 24) return '#fca5a5';
  if (hours >= 8) return '#fcd34d';
  return '#86efac';
}

function cardStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.24)',
    borderRadius: 16,
    padding: 14,
    display: 'grid',
    gap: 6,
  };
}

function Stat({ theme, label, value, hint, accent = '#93c5fd' }) {
  return (
    <div style={cardStyle(theme)}>
      <span style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <strong style={{ color: accent, fontSize: 26 }}>{value}</strong>
      {hint ? <span style={{ color: theme.mutedText, fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

function WorkloadRow({ theme, item }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', borderBottom: `1px solid ${theme.cardBorder}`, padding: '9px 0' }}>
      <strong style={{ color: theme.cardText, overflowWrap: 'anywhere' }}>{item.assignee || 'Unassigned'}</strong>
      <span style={{ color: theme.mutedText, fontSize: 12 }}>{item.count} tickets</span>
      <span style={{ color: toneForAge(item.oldestAgeMs), fontSize: 12, fontWeight: 950 }}>{formatDuration(item.oldestAgeMs)}</span>
    </div>
  );
}

export default function TicketQueueAnalytics({ theme, tickets = [] }) {
  const data = useMemo(() => {
    const all = safeArray(tickets);
    const open = all.filter(isOpen);
    const unassigned = open.filter((ticket) => !getAssignee(ticket));
    const formTickets = all.filter(isFormTicket);
    const missingChannel = all.filter(hasMissingChannel);
    const closed = all.filter((ticket) => getStatus(ticket) === 'closed');
    const archived = all.filter((ticket) => getStatus(ticket) === 'archived');
    const oldestOpen = open.reduce((oldest, ticket) => Math.max(oldest, ageMs(ticket)), 0);
    const avgOpenAge = open.length ? Math.round(open.reduce((total, ticket) => total + ageMs(ticket), 0) / open.length) : 0;
    const slaRisk = open.filter((ticket) => ageMs(ticket) >= 8 * 3600000).length;
    const slaBreached = open.filter((ticket) => ageMs(ticket) >= 24 * 3600000).length;
    const byAssignee = new Map();

    open.forEach((ticket) => {
      const assignee = getAssignee(ticket) || 'Unassigned';
      const current = byAssignee.get(assignee) || { assignee, count: 0, oldestAgeMs: 0 };
      current.count += 1;
      current.oldestAgeMs = Math.max(current.oldestAgeMs, ageMs(ticket));
      byAssignee.set(assignee, current);
    });

    return {
      all,
      open,
      unassigned,
      formTickets,
      missingChannel,
      closed,
      archived,
      oldestOpen,
      avgOpenAge,
      slaRisk,
      slaBreached,
      workload: [...byAssignee.values()].sort((a, b) => b.count - a.count || b.oldestAgeMs - a.oldestAgeMs).slice(0, 8),
      recentRisk: open
        .filter((ticket) => ageMs(ticket) >= 8 * 3600000 || hasMissingChannel(ticket) || !getAssignee(ticket))
        .sort((a, b) => ageMs(b) - ageMs(a))
        .slice(0, 8),
    };
  }, [tickets]);

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 20, boxShadow: theme.shadow, display: 'grid', gap: 16 }}>
      <div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ticket Dashboard</div>
        <h3 style={{ margin: '6px 0 0' }}>Queue Analytics</h3>
        <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Live workload, SLA risk, unassigned tickets and recovery warnings from the current ticket store.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 155px), 1fr))', gap: 10 }}>
        <Stat theme={theme} label="Open" value={data.open.length} hint="Active queue" accent="#86efac" />
        <Stat theme={theme} label="Unassigned" value={data.unassigned.length} hint="Needs staff" accent={data.unassigned.length ? '#fcd34d' : '#86efac'} />
        <Stat theme={theme} label="SLA Risk" value={data.slaRisk} hint="8h+ open" accent={data.slaRisk ? '#fcd34d' : '#86efac'} />
        <Stat theme={theme} label="Breached" value={data.slaBreached} hint="24h+ open" accent={data.slaBreached ? '#fca5a5' : '#86efac'} />
        <Stat theme={theme} label="Missing Channels" value={data.missingChannel.length} hint="Needs recovery" accent={data.missingChannel.length ? '#fca5a5' : '#86efac'} />
        <Stat theme={theme} label="Form Tickets" value={data.formTickets.length} hint="Linked workflows" accent="#c4b5fd" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
        <div style={cardStyle(theme)}>
          <strong>Workload</strong>
          {data.workload.length ? data.workload.map((item) => <WorkloadRow key={item.assignee} theme={theme} item={item} />) : <EmptyState theme={theme} icon={E.TICKETS} title="No active tickets" description="Open tickets will appear here with workload, ownership and queue-age details." />}
        </div>

        <div style={cardStyle(theme)}>
          <strong>Queue Health</strong>
          <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.7 }}>
            <div>Oldest open: <strong style={{ color: toneForAge(data.oldestOpen) }}>{formatDuration(data.oldestOpen)}</strong></div>
            <div>Average open age: <strong style={{ color: toneForAge(data.avgOpenAge) }}>{formatDuration(data.avgOpenAge)}</strong></div>
            <div>Closed records: <strong style={{ color: theme.cardText }}>{data.closed.length}</strong></div>
            <div>Archived records: <strong style={{ color: theme.cardText }}>{data.archived.length}</strong></div>
          </div>
        </div>
      </div>

      <div style={cardStyle(theme)}>
        <strong>Needs Attention</strong>
        {data.recentRisk.length ? data.recentRisk.map((ticket) => (
          <div key={getTicketId(ticket)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, borderBottom: `1px solid ${theme.cardBorder}`, padding: '9px 0' }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ color: theme.cardText, overflowWrap: 'anywhere' }}>{ticket.title || ticket.subject || ticket.type || getTicketId(ticket)}</strong>
              <div style={{ color: theme.mutedText, fontSize: 12 }}>Status: {getStatus(ticket)} • {getAssignee(ticket) ? `Assigned ${getAssignee(ticket)}` : 'Unassigned'}{hasMissingChannel(ticket) ? ' • Missing channel' : ''}</div>
            </div>
            <span style={{ color: toneForAge(ageMs(ticket)), fontWeight: 950 }}>{formatDuration(ageMs(ticket))}</span>
          </div>
        )) : <EmptyState theme={theme} icon="✅" title="No ticket risks detected" description="Unassigned, old or recovery-needed tickets will appear here when attention is required." />}
      </div>
    </section>
  );
}
