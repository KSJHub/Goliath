import { ThemedSelect } from '../../../ui/DiscordResourceSelects.jsx';
import { DASHBOARD_EMOJIS as E } from '../../../shared/PageShell';
import React, { useMemo, useState } from 'react';

import EmptyState from '../../../shared/EmptyState.jsx';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function statusOf(submission = {}) {
  return String(submission.status || submission.workflow?.status || submission.workflow?.reviewState || 'pending').toLowerCase();
}

function formIdOf(submission = {}) {
  return submission.formId || submission.workflow?.formId || 'unknown';
}

function createdMs(submission = {}) {
  return Date.parse(submission.createdAt || submission.submittedAt || submission.updatedAt || 0) || 0;
}

function ageMs(submission = {}) {
  const created = createdMs(submission);
  return created ? Date.now() - created : 0;
}

function formatDuration(ms = 0) {
  if (!ms || ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function isActive(submission = {}) {
  return ['pending', 'reviewing', 'under_review', 'request_info'].includes(statusOf(submission));
}

function hasTicket(submission = {}) {
  return Boolean(submission.ticketId || submission.ticketChannelId || submission.workflow?.ticketId || submission.workflow?.ticketChannelId);
}

function hasMissingTicketChannel(submission = {}) {
  const ticketId = submission.ticketId || submission.workflow?.ticketId;
  const channelId = submission.ticketChannelId || submission.workflow?.ticketChannelId;
  return Boolean(ticketId && !channelId && isActive(submission));
}

function toneForAge(ms) {
  const hours = ms / 3600000;
  if (hours >= 48) return '#fca5a5';
  if (hours >= 12) return '#fcd34d';
  return '#86efac';
}

function card(theme) {
  return {
    border: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`,
    background: 'rgba(15,23,42,0.24)',
    borderRadius: 16,
    padding: 14,
    display: 'grid',
    gap: 7,
  };
}

function Stat({ theme, label, value, hint, accent = '#93c5fd' }) {
  return (
    <div style={card(theme)}>
      <span style={{ color: theme?.mutedText || '#94a3b8', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <strong style={{ color: accent, fontSize: 26 }}>{value}</strong>
      {hint ? <span style={{ color: theme?.mutedText || '#94a3b8', fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

function StatusBar({ theme, label, count, total, tone }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: theme?.mutedText || '#94a3b8', fontSize: 12 }}>
        <span>{label}</span>
        <strong style={{ color: theme?.cardText || '#e5e7eb' }}>{count} · {percent}%</strong>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'rgba(15,23,42,0.65)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${percent}%`, background: tone, borderRadius: 999 }} />
      </div>
    </div>
  );
}

export default function FormsFinalPolishPanel({ theme, forms = [], submissions = [], onRefresh, refreshing = false }) {
  const [filter, setFilter] = useState('active');

  const data = useMemo(() => {
    const all = arr(submissions);
    const formList = arr(forms);
    const active = all.filter(isActive);
    const approved = all.filter((submission) => statusOf(submission) === 'approved');
    const denied = all.filter((submission) => statusOf(submission) === 'denied');
    const requestInfo = all.filter((submission) => statusOf(submission) === 'request_info');
    const tickets = all.filter(hasTicket);
    const missingChannels = all.filter(hasMissingTicketChannel);
    const oldestActiveAge = active.reduce((oldest, submission) => Math.max(oldest, ageMs(submission)), 0);
    const avgActiveAge = active.length ? Math.round(active.reduce((sum, submission) => sum + ageMs(submission), 0) / active.length) : 0;
    const slaRisk = active.filter((submission) => ageMs(submission) >= 12 * 3600000).length;
    const byForm = new Map();

    all.forEach((submission) => {
      const id = formIdOf(submission);
      const current = byForm.get(id) || { formId: id, total: 0, active: 0, approved: 0, denied: 0, requestInfo: 0, oldestAge: 0 };
      current.total += 1;
      if (isActive(submission)) current.active += 1;
      if (statusOf(submission) === 'approved') current.approved += 1;
      if (statusOf(submission) === 'denied') current.denied += 1;
      if (statusOf(submission) === 'request_info') current.requestInfo += 1;
      current.oldestAge = Math.max(current.oldestAge, ageMs(submission));
      byForm.set(id, current);
    });

    const filtered = all.filter((submission) => {
      if (filter === 'all') return true;
      if (filter === 'active') return isActive(submission);
      if (filter === 'missing') return hasMissingTicketChannel(submission);
      return statusOf(submission) === filter;
    }).sort((a, b) => ageMs(b) - ageMs(a)).slice(0, 10);

    return {
      all,
      formList,
      active,
      approved,
      denied,
      requestInfo,
      tickets,
      missingChannels,
      oldestActiveAge,
      avgActiveAge,
      slaRisk,
      ticketCoverage: all.length ? Math.round((tickets.length / all.length) * 100) : 0,
      byForm: [...byForm.values()].sort((a, b) => b.active - a.active || b.total - a.total).slice(0, 8),
      filtered,
    };
  }, [forms, submissions, filter]);

  return (
    <section style={{ border: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`, background: theme?.cardBg || 'rgba(15,23,42,0.40)', color: theme?.cardText || '#e5e7eb', borderRadius: 22, padding: 20, boxShadow: theme?.shadow || 'none', display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme?.mutedText || '#94a3b8', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Universal Forms</div>
          <h3 style={{ margin: '6px 0 0' }}>Final Polish Dashboard</h3>
          <p style={{ margin: '8px 0 0', color: theme?.mutedText || '#94a3b8', lineHeight: 1.5 }}>Submission workload, ticket-link coverage, review age and per-form activity in one place.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} style={{ border: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`, background: 'rgba(15,23,42,0.35)', color: theme?.cardText || '#e5e7eb', borderRadius: 12, padding: '10px 12px', fontWeight: 950, cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.55 : 1 }}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10 }}>
        <Stat theme={theme} label="Forms" value={data.formList.length} hint="Configured forms" />
        <Stat theme={theme} label="Submissions" value={data.all.length} hint="Total received" accent="#c4b5fd" />
        <Stat theme={theme} label="Active" value={data.active.length} hint="Needs workflow" accent={data.active.length ? '#fcd34d' : '#86efac'} />
        <Stat theme={theme} label="SLA Risk" value={data.slaRisk} hint="12h+ active" accent={data.slaRisk ? '#fca5a5' : '#86efac'} />
        <Stat theme={theme} label="Ticket Coverage" value={`${data.ticketCoverage}%`} hint="Linked to tickets" accent={data.ticketCoverage >= 80 ? '#86efac' : '#fcd34d'} />
        <Stat theme={theme} label="Missing Channels" value={data.missingChannels.length} hint="Recovery needed" accent={data.missingChannels.length ? '#fca5a5' : '#86efac'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 14 }}>
        <div style={card(theme)}>
          <strong>Status Mix</strong>
          <StatusBar theme={theme} label="Active" count={data.active.length} total={data.all.length} tone="#fcd34d" />
          <StatusBar theme={theme} label="Approved" count={data.approved.length} total={data.all.length} tone="#86efac" />
          <StatusBar theme={theme} label="Denied" count={data.denied.length} total={data.all.length} tone="#fca5a5" />
          <StatusBar theme={theme} label="Request Info" count={data.requestInfo.length} total={data.all.length} tone="#93c5fd" />
        </div>

        <div style={card(theme)}>
          <strong>Review Age</strong>
          <div style={{ color: theme?.mutedText || '#94a3b8', fontSize: 13, lineHeight: 1.8 }}>
            <div>Oldest active: <strong style={{ color: toneForAge(data.oldestActiveAge) }}>{formatDuration(data.oldestActiveAge)}</strong></div>
            <div>Average active age: <strong style={{ color: toneForAge(data.avgActiveAge) }}>{formatDuration(data.avgActiveAge)}</strong></div>
            <div>Ticket linked submissions: <strong style={{ color: theme?.cardText || '#e5e7eb' }}>{data.tickets.length}</strong></div>
            <div>Request information: <strong style={{ color: '#93c5fd' }}>{data.requestInfo.length}</strong></div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
        <div style={card(theme)}>
          <strong>Form Workload</strong>
          {data.byForm.length ? data.byForm.map((item) => (
            <div key={item.formId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, borderBottom: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`, padding: '8px 0', alignItems: 'center' }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{item.formId}</strong>
              <span style={{ color: theme?.mutedText || '#94a3b8', fontSize: 12 }}>{item.active} active</span>
              <span style={{ color: toneForAge(item.oldestAge), fontSize: 12, fontWeight: 950 }}>{formatDuration(item.oldestAge)}</span>
            </div>
          )) : <EmptyState theme={theme} icon={E.DOCUMENT} title="No form workload yet" description="Create forms and collect submissions to see workload, review age and ticket-link coverage here." />}
        </div>

        <div style={card(theme)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>Needs Attention</strong>
            <ThemedSelect theme={theme} value={filter} onChange={(event) => setFilter(event.target.value)} style={{ border: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`, background: 'rgba(15,23,42,0.55)', color: theme?.cardText || '#e5e7eb', borderRadius: 10, padding: '7px 9px', fontWeight: 850 }}>
              <option value="active">Active</option>
              <option value="missing">Missing channel</option>
              <option value="request_info">Request info</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="all">All</option>
            </ThemedSelect>
          </div>
          {data.filtered.length ? data.filtered.map((submission) => (
            <div key={submission.submissionId || `${formIdOf(submission)}-${submission.createdAt}`} style={{ borderBottom: `1px solid ${theme?.cardBorder || 'rgba(148,163,184,0.22)'}`, padding: '8px 0', display: 'grid', gap: 4 }}>
              <strong>{formIdOf(submission)} · {statusOf(submission).replace(/_/g, ' ')}</strong>
              <span style={{ color: theme?.mutedText || '#94a3b8', fontSize: 12 }}>User: {submission.userTag || submission.userId || 'Unknown'} · Created: {formatDate(submission.createdAt)}</span>
              <span style={{ color: hasMissingTicketChannel(submission) ? '#fca5a5' : theme?.mutedText || '#94a3b8', fontSize: 12 }}>Ticket: {submission.ticketId || submission.workflow?.ticketId || 'Not linked'} · Age: {formatDuration(ageMs(submission))}</span>
            </div>
          )) : <EmptyState theme={theme} icon={E.SUCCESS} title="Nothing needs attention" description="No submissions match this filter. New reviews, missing ticket links and request-info cases will appear here." />}
        </div>
      </div>
    </section>
  );
}
