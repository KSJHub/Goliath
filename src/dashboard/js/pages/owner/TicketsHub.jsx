import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React from 'react';

import useOwnerGuilds from '../../hooks/useOwnerGuilds.js';
import ownerApi from '../../services/ownerApi.js';

const TICKET_WORKFLOWS = ['Support', 'Appeal', 'Application', 'Report', 'Custom'];
const STATUS_FILTERS = ['active', 'open', 'claimed', 'closed', 'archived', 'deleted', 'all'];
const PRIORITY_SLA_MINUTES = {
  urgent: 15,
  high: 120,
  normal: 720,
  low: 1440,
};

function getGuildId(guild = {}) {
  return String(guild.guildId || guild.id || '');
}

function getGuildName(guild = {}) {
  return guild.name || guild.guildName || 'Unknown Guild';
}

function normalizeTickets(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.tickets)) return payload.tickets;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function ticketStatus(ticket = {}) {
  return String(ticket.status || 'open').toLowerCase();
}

function ticketPriority(ticket = {}) {
  const value = String(ticket.priority || 'normal').toLowerCase();
  return ['low', 'normal', 'high', 'urgent'].includes(value) ? value : 'normal';
}

function isActiveTicket(ticket = {}) {
  return ['open', 'claimed'].includes(ticketStatus(ticket));
}

function isFormTicket(ticket = {}) {
  return ticket.source === 'form' || Boolean(ticket.formSubmissionId) || Boolean(ticket.metadata?.submissionId);
}

function isMissingTicketChannel(ticket = {}) {
  const status = ticketStatus(ticket);
  if (['closed', 'archived', 'deleted'].includes(status)) return false;
  return !ticket.discordChannelId && !ticket.channelId;
}

function hasTranscript(ticket = {}) {
  return Boolean(ticket.transcript || ticket.transcriptId || ticket.transcriptUrl || ticket.metadata?.transcriptId || ticket.metadata?.transcriptUrl);
}

function countTickets(tickets = [], predicate) {
  return tickets.filter(predicate).length;
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString();
}

function formatDuration(ms = 0) {
  const value = Math.max(Number(ms || 0), 0);
  if (!value) return '0m';
  const minutes = Math.floor(value / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function ageMs(ticket = {}) {
  const created = new Date(ticket.createdAt || ticket.statusChangedAt || 0).getTime();
  if (!created) return 0;
  return Math.max(Date.now() - created, 0);
}

function firstResponseMs(ticket = {}) {
  const created = new Date(ticket.createdAt || 0).getTime();
  const claimed = new Date(ticket.claimedAt || ticket.analytics?.firstResponseAt || 0).getTime();
  if (!created || !claimed || claimed < created) return null;
  return claimed - created;
}

function closeTimeMs(ticket = {}) {
  const created = new Date(ticket.createdAt || 0).getTime();
  const closed = new Date(ticket.closedAt || ticket.archivedAt || ticket.deletedAt || 0).getTime();
  if (!created || !closed || closed < created) return null;
  return closed - created;
}

function slaState(ticket = {}) {
  if (!isActiveTicket(ticket)) return { label: 'complete', tone: 'success', elapsed: ageMs(ticket), limit: null };
  const priority = ticketPriority(ticket);
  const limit = (ticket.metadata?.slaMinutes || ticket.slaMinutes || PRIORITY_SLA_MINUTES[priority] || 720) * 60000;
  const elapsed = ageMs(ticket);
  if (elapsed >= limit) return { label: 'breached', tone: 'danger', elapsed, limit };
  if (elapsed >= limit * 0.75) return { label: 'at risk', tone: 'warning', elapsed, limit };
  return { label: 'healthy', tone: 'success', elapsed, limit };
}

function statusColor(status, theme) {
  const value = String(status || '').toLowerCase();
  if (['open', 'active', 'healthy', 'success', 'complete'].includes(value)) return '#86efac';
  if (['claimed', 'pending', 'warning', 'at risk'].includes(value)) return '#fcd34d';
  if (['closed', 'archived', 'deleted', 'breached', 'danger', 'missing'].includes(value)) return '#fca5a5';
  if (['form', 'transcript'].includes(value)) return '#93c5fd';
  return theme.mutedText;
}

function StatusPill({ theme, status }) {
  const tone = statusColor(status, theme);
  return (
    <span style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {String(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function StatCard({ title, value, hint, theme, accent }) {
  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, borderRadius: 18, padding: 18, boxShadow: theme.shadow }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
      <div style={{ fontSize: 26, fontWeight: 950, marginTop: 8, color: accent || theme.cardText }}>{value}</div>
      {hint ? <div style={{ marginTop: 5, color: theme.mutedText, fontSize: 13 }}>{hint}</div> : null}
    </div>
  );
}

function MiniMetric({ title, value, theme, hint }) {
  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.22)' }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 21, fontWeight: 950 }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function Pill({ label, theme, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid ' + (active ? '#fde68a' : theme.cardBorder),
        background: active ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.12)',
        color: '#fde68a',
        borderRadius: 999,
        padding: '7px 10px',
        fontSize: 12,
        fontWeight: 850,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {label}
    </button>
  );
}

function average(values = []) {
  const clean = values.filter((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + Number(value), 0) / clean.length;
}

function buildWorkload(tickets = []) {
  const map = new Map();
  tickets.forEach((ticket) => {
    const ids = [...new Set([ticket.claimedById, ...(Array.isArray(ticket.assignedStaffIds) ? ticket.assignedStaffIds : [])].filter(Boolean))];
    ids.forEach((id) => {
      const current = map.get(id) || { id, active: 0, total: 0, closed: 0 };
      current.total += 1;
      if (isActiveTicket(ticket)) current.active += 1;
      if (['closed', 'archived'].includes(ticketStatus(ticket))) current.closed += 1;
      map.set(id, current);
    });
  });
  return [...map.values()].sort((a, b) => b.active - a.active || b.total - a.total).slice(0, 8);
}

function filterTickets(tickets = [], statusFilter, searchTerm, sourceFilter) {
  const term = String(searchTerm || '').trim().toLowerCase();
  return tickets.filter((ticket) => {
    const status = ticketStatus(ticket);
    if (statusFilter === 'active' && !isActiveTicket(ticket)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'active' && status !== statusFilter) return false;
    if (sourceFilter === 'form' && !isFormTicket(ticket)) return false;
    if (sourceFilter === 'missing' && !isMissingTicketChannel(ticket)) return false;
    if (sourceFilter === 'transcripts' && !hasTranscript(ticket)) return false;
    if (!term) return true;
    return [ticket.ticketId, ticket.displayId, ticket.title, ticket.description, ticket.creatorId, ticket.userId, ticket.type, ticket.source, ticket.formSubmissionId, ticket.channelId, ticket.discordChannelId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  }).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
}

function TicketQueue({ theme, tickets, selectedTicketId, setSelectedTicketId }) {
  if (!tickets.length) {
    return <div style={{ border: '1px dashed ' + theme.cardBorder, borderRadius: 16, padding: 18, color: theme.mutedText }}>No tickets match the current filters.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {tickets.slice(0, 40).map((ticket) => {
        const sla = slaState(ticket);
        const selected = selectedTicketId === ticket.ticketId;
        return (
          <button
            key={ticket.ticketId}
            type="button"
            onClick={() => setSelectedTicketId(ticket.ticketId)}
            style={{ textAlign: 'left', border: '1px solid ' + (selected ? '#fde68a' : isMissingTicketChannel(ticket) ? '#fca5a5' : theme.cardBorder), background: selected ? 'rgba(245,158,11,0.14)' : 'rgba(15,23,42,0.22)', color: theme.cardText, borderRadius: 16, padding: 13, cursor: 'pointer', display: 'grid', gap: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <strong>{ticket.displayId || ticket.ticketId}</strong>
              <StatusPill theme={theme} status={ticketStatus(ticket)} />
            </div>
            <span style={{ color: theme.mutedText, lineHeight: 1.45 }}>{ticket.title || ticket.description || 'Untitled ticket'}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatusPill theme={theme} status={ticketPriority(ticket)} />
              {isFormTicket(ticket) ? <StatusPill theme={theme} status="form" /> : null}
              {hasTranscript(ticket) ? <StatusPill theme={theme} status="transcript" /> : null}
              {isMissingTicketChannel(ticket) ? <StatusPill theme={theme} status="missing" /> : <StatusPill theme={theme} status={sla.label} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TicketDetails({ theme, ticket }) {
  if (!ticket) {
    return <div style={{ border: '1px dashed ' + theme.cardBorder, borderRadius: 16, padding: 18, color: theme.mutedText }}>Select a ticket to inspect its SLA, transcript, form link and workload metadata.</div>;
  }

  const sla = slaState(ticket);
  const timeline = Array.isArray(ticket.timeline) ? ticket.timeline : [];
  const transcriptUrl = ticket.transcriptUrl || ticket.transcript?.url || ticket.metadata?.transcriptUrl || null;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{ticket.displayId || ticket.ticketId}</h3>
          <p style={{ margin: '6px 0 0', color: theme.mutedText }}>{ticket.title || ticket.description || 'Untitled ticket'}</p>
        </div>
        <StatusPill theme={theme} status={ticketStatus(ticket)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 10 }}>
        <MiniMetric title="Priority" value={ticketPriority(ticket)} theme={theme} />
        <MiniMetric title="SLA" value={sla.label} hint={sla.limit ? `${formatDuration(sla.elapsed)} / ${formatDuration(sla.limit)}` : 'Complete'} theme={theme} />
        <MiniMetric title="Age" value={formatDuration(ageMs(ticket))} theme={theme} />
        <MiniMetric title="First Response" value={firstResponseMs(ticket) == null ? 'Pending' : formatDuration(firstResponseMs(ticket))} theme={theme} />
        <MiniMetric title="Close Time" value={closeTimeMs(ticket) == null ? 'Open' : formatDuration(closeTimeMs(ticket))} theme={theme} />
        <MiniMetric title="Channel" value={ticket.channelId || ticket.discordChannelId || 'Missing'} theme={theme} />
      </div>

      <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 16, padding: 14, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 8 }}>
        <strong>Linked Workflow</strong>
        <span style={{ color: theme.mutedText }}>Source: {ticket.source || 'manual'} · Type: {ticket.type || 'support'}</span>
        <span style={{ color: theme.mutedText }}>Form Submission: {ticket.formSubmissionId || ticket.metadata?.submissionId || 'None'}</span>
        <span style={{ color: theme.mutedText }}>Creator: {ticket.creatorId || ticket.userId || 'Unknown'} · Claimed: {ticket.claimedById || 'Unclaimed'}</span>
      </div>

      <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 16, padding: 14, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 8 }}>
        <strong>Transcript Entry</strong>
        <span style={{ color: theme.mutedText }}>{hasTranscript(ticket) ? 'Transcript metadata exists for this ticket.' : 'No transcript metadata stored yet.'}</span>
        {transcriptUrl ? <a href={transcriptUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontWeight: 900 }}>Open Transcript</a> : null}
      </div>

      <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 16, padding: 14, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 8 }}>
        <strong>Timeline</strong>
        {timeline.length ? timeline.slice(-6).reverse().map((event) => (
          <span key={event.id || `${event.type}-${event.createdAt}`} style={{ color: theme.mutedText }}>{formatDate(event.createdAt)} · {event.label || event.type || 'Ticket event'}</span>
        )) : <span style={{ color: theme.mutedText }}>No timeline events stored.</span>}
      </div>
    </div>
  );
}

export default function TicketsHub({ theme }) {
  const { guilds, selectedGuild, setSelectedGuild, loading, error } = useOwnerGuilds();
  const [overview, setOverview] = React.useState(null);
  const [tickets, setTickets] = React.useState([]);
  const [ticketsLoading, setTicketsLoading] = React.useState(false);
  const [ticketsError, setTicketsError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('active');
  const [sourceFilter, setSourceFilter] = React.useState('all');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedTicketId, setSelectedTicketId] = React.useState('');
  const [recoveryLoading, setRecoveryLoading] = React.useState(false);

  const selectedGuildRecord = guilds.find((guild) => getGuildId(guild) === selectedGuild);
  const selectedGuildName = selectedGuildRecord ? getGuildName(selectedGuildRecord) : 'No guild selected';

  const loadTicketsOverview = React.useCallback(async () => {
    if (!selectedGuild) return;
    try {
      setTicketsLoading(true);
      setTicketsError('');
      const [overviewPayload, ticketsPayload] = await Promise.all([
        ownerApi.getTicketsOverview(selectedGuild),
        ownerApi.getTickets(selectedGuild),
      ]);
      const nextTickets = normalizeTickets(ticketsPayload);
      setOverview(overviewPayload?.overview || null);
      setTickets(nextTickets);
      setSelectedTicketId((current) => current && nextTickets.some((ticket) => ticket.ticketId === current) ? current : nextTickets[0]?.ticketId || '');
    } catch (err) {
      setOverview(null);
      setTickets([]);
      setTicketsError(err.message || 'Failed to load tickets overview.');
    } finally {
      setTicketsLoading(false);
    }
  }, [selectedGuild]);

  React.useEffect(() => {
    if (!selectedGuild) {
      setOverview(null);
      setTickets([]);
      setSelectedTicketId('');
      return;
    }
    loadTicketsOverview();
  }, [selectedGuild, loadTicketsOverview]);

  async function runRecovery(createMissingChannels = false) {
    if (!selectedGuild) return;
    try {
      setRecoveryLoading(true);
      setTicketsError('');
      setNotice('');
      const result = createMissingChannels
        ? await ownerApi.recreateMissingTicketChannels(selectedGuild)
        : await ownerApi.scanTicketRecovery(selectedGuild);
      const summary = result?.summary || {};
      setNotice(createMissingChannels
        ? `Recovery complete. Recreated ${summary.formTicketChannelsRecreated || 0} form ticket channels.`
        : `Recovery scan complete. Missing channels: ${summary.missingChannels || 0}.`);
      await loadTicketsOverview();
    } catch (err) {
      setTicketsError(err.message || 'Ticket recovery failed.');
    } finally {
      setRecoveryLoading(false);
    }
  }

  const formTicketCount = overview?.formTicketCount ?? countTickets(tickets, isFormTicket);
  const missingChannelCount = overview?.missingChannelRecordCount ?? countTickets(tickets, isMissingTicketChannel);
  const deletedCount = overview?.deletedCount ?? countTickets(tickets, (ticket) => ticketStatus(ticket) === 'deleted' || ticket.deletedAt);
  const activeCount = overview?.activeCount ?? countTickets(tickets, isActiveTicket);
  const transcriptCount = overview?.transcriptCount ?? countTickets(tickets, hasTranscript);
  const filteredTickets = filterTickets(tickets, statusFilter, searchTerm, sourceFilter);
  const selectedTicket = tickets.find((ticket) => ticket.ticketId === selectedTicketId) || filteredTickets[0] || null;
  const slaBreached = countTickets(tickets, (ticket) => slaState(ticket).label === 'breached');
  const slaAtRisk = countTickets(tickets, (ticket) => slaState(ticket).label === 'at risk');
  const avgFirstResponse = average(tickets.map(firstResponseMs));
  const avgClose = average(tickets.map(closeTimeMs));
  const workload = buildWorkload(tickets);

  const card = {
    border: '1px solid ' + theme.cardBorder,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(245,158,11,0.16), rgba(15,23,42,0.10) 48%, rgba(59,130,246,0.10))' }}>
        <p style={{ margin: 0, color: '#f59e0b', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Global Tickets</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 36, letterSpacing: '-0.04em' }}>Tickets Hub</h1>
        <p style={{ marginTop: 8, color: theme.mutedText, lineHeight: 1.6 }}>
          Live queue, SLA health, staff workload, transcript visibility, form-linked tickets and recovery controls for the universal ticket system.
        </p>
      </section>

      {error ? <section style={{ ...card, color: '#fca5a5' }}>{error}</section> : null}
      {ticketsError ? <section style={{ ...card, color: '#fca5a5' }}>{ticketsError}</section> : null}
      {notice ? <section style={{ ...card, color: '#86efac' }}>{notice}</section> : null}

      <section style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>Selected Guild</strong>
          <div style={{ color: theme.mutedText, marginTop: 4 }}>{selectedGuildName}</div>
        </div>
        <ThemedSelect theme={theme} value={selectedGuild} onChange={(event) => setSelectedGuild(event.target.value)} disabled={loading || guilds.length === 0} style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', minWidth: 260, fontWeight: 800 }}>
          {guilds.map((guild) => <option key={getGuildId(guild)} value={getGuildId(guild)}>{getGuildName(guild)}</option>)}
        </ThemedSelect>
      </section>

      <section style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <strong>Ticket Health</strong>
          <div style={{ color: theme.mutedText, marginTop: 4 }}>
            {missingChannelCount ? 'Recovery attention is needed for missing ticket channels.' : slaBreached ? 'SLA breaches need staff attention.' : 'No active missing ticket channels detected.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatusPill theme={theme} status={missingChannelCount ? 'recovery needed' : slaBreached ? 'breached' : slaAtRisk ? 'at risk' : 'healthy'} />
          <button type="button" onClick={() => runRecovery(false)} disabled={recoveryLoading || !selectedGuild} style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.38)', color: theme.cardText, borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' }}>{recoveryLoading ? 'Scanning...' : 'Scan Recovery'}</button>
          <button type="button" onClick={() => runRecovery(true)} disabled={recoveryLoading || !selectedGuild || !missingChannelCount} style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: '#86efac', borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: missingChannelCount ? 'pointer' : 'not-allowed', opacity: missingChannelCount ? 1 : 0.65 }}>Recreate Missing</button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
        <StatCard title="Connected Guilds" value={loading ? 'Loading' : String(guilds.length)} theme={theme} />
        <StatCard title="Active Tickets" value={ticketsLoading ? 'Loading' : String(activeCount)} hint={`${overview?.openCount ?? 0} open · ${overview?.claimedCount ?? 0} claimed`} theme={theme} accent="#fde68a" />
        <StatCard title="SLA Breached" value={ticketsLoading ? 'Loading' : String(slaBreached)} hint={`${slaAtRisk} at risk`} theme={theme} accent={slaBreached ? '#fca5a5' : '#86efac'} />
        <StatCard title="Form Tickets" value={ticketsLoading ? 'Loading' : String(formTicketCount)} hint="Forms bridge" theme={theme} accent="#93c5fd" />
        <StatCard title="Transcripts" value={ticketsLoading ? 'Loading' : String(transcriptCount)} hint="Stored transcript metadata" theme={theme} />
        <StatCard title="Missing Channels" value={ticketsLoading ? 'Loading' : String(missingChannelCount)} hint="Recovery risk" theme={theme} accent={missingChannelCount ? '#fca5a5' : '#86efac'} />
        <StatCard title="Avg Response" value={avgFirstResponse == null ? 'N/A' : formatDuration(avgFirstResponse)} hint="Created → claimed" theme={theme} />
        <StatCard title="Avg Close" value={avgClose == null ? 'N/A' : formatDuration(avgClose)} hint="Created → closed/archive" theme={theme} />
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Live Ticket Queue</h3>
            <p style={{ margin: '6px 0 0', color: theme.mutedText }}>Search, filter and inspect ticket health without leaving the owner dashboard.</p>
          </div>
          <button type="button" onClick={loadTicketsOverview} disabled={ticketsLoading} style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.38)', color: theme.cardText, borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' }}>{ticketsLoading ? 'Refreshing...' : 'Refresh'}</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) auto auto', gap: 10, marginBottom: 14 }}>
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search ID, title, user, type, channel..." style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', fontWeight: 800, minWidth: 0 }} />
          <ThemedSelect theme={theme} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', fontWeight: 800 }}>
            {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status}</option>)}
          </ThemedSelect>
          <ThemedSelect theme={theme} value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} style={{ border: '1px solid ' + theme.cardBorder, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', fontWeight: 800 }}>
            <option value="all">all sources</option>
            <option value="form">form tickets</option>
            <option value="missing">missing channels</option>
            <option value="transcripts">with transcripts</option>
          </ThemedSelect>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(100%,360px),0.9fr) minmax(0,1.1fr)', gap: 14, alignItems: 'start' }}>
          <TicketQueue theme={theme} tickets={filteredTickets} selectedTicketId={selectedTicket?.ticketId || selectedTicketId} setSelectedTicketId={setSelectedTicketId} />
          <TicketDetails theme={theme} ticket={selectedTicket} />
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 14 }}>
        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Staff Workload</h3>
          <p style={{ marginTop: 0, color: theme.mutedText }}>Claimed and assigned ticket distribution from stored ticket metadata.</p>
          {workload.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {workload.map((staff) => <MiniMetric key={staff.id} title={staff.id} value={`${staff.active} active`} hint={`${staff.total} total · ${staff.closed} closed`} theme={theme} />)}
            </div>
          ) : <div style={{ color: theme.mutedText }}>No claimed or assigned staff workload yet.</div>}
        </section>

        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Universal Workflows</h3>
          <p style={{ marginTop: 0, color: theme.mutedText }}>All ticket types use the same universal engine. No hardcoded support, appeal or report system.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{TICKET_WORKFLOWS.map((workflow) => <Pill key={workflow} label={workflow} theme={theme} />)}</div>
        </section>

        <section style={card}>
          <h3 style={{ marginTop: 0 }}>Ticket Analytics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <MiniMetric title="Total" value={overview?.ticketCount ?? tickets.length} theme={theme} />
            <MiniMetric title="Closed Today" value={overview?.closedTodayCount ?? 0} theme={theme} />
            <MiniMetric title="Archived Today" value={overview?.archivedTodayCount ?? 0} theme={theme} />
            <MiniMetric title="Deleted" value={deletedCount} theme={theme} />
            <MiniMetric title="Panels" value={overview?.panelCount ?? 0} theme={theme} />
            <MiniMetric title="Deployed" value={overview?.deployedPanelCount ?? 0} theme={theme} />
          </div>
        </section>
      </section>
    </div>
  );
}
