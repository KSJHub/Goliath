import { goDashboard } from '../../services/dashboardPath.js';
import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';

const fallback = { cardBorder: 'rgba(148,163,184,0.22)', cardBg: 'rgba(15,23,42,0.42)', cardText: '#e5e7eb', mutedText: '#94a3b8', shadow: '0 18px 50px rgba(0,0,0,0.25)' };
const MODULE_ICONS = { tickets: E.TICKETS, forms: E.DOCUMENT, automation: E.SETTINGS, security: E.SECURITY, runtime: E.BOT, deployment: E.BOOST, backup: E.SAVE, dashboard: E.CHART, system: E.SYSTEM };
const SEVERITIES = ['info', 'success', 'warning', 'danger'];

function t(theme) { return { ...fallback, ...(theme || {}) }; }
function gid(selectedGuild, selectedGuildData) { return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim(); }
function card(theme, extra = {}) { const x = t(theme); return { border: `1px solid ${x.cardBorder}`, background: x.cardBg, color: x.cardText, borderRadius: 20, padding: 18, boxShadow: x.shadow, ...extra }; }
function button(theme, disabled = false) { const x = t(theme); return { border: `1px solid ${x.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: x.cardText, borderRadius: 12, padding: '9px 11px', fontWeight: 950, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }; }
function field(theme) { const x = t(theme); return { border: `1px solid ${x.cardBorder}`, background: 'rgba(15,23,42,0.42)', color: x.cardText, borderRadius: 12, padding: '9px 11px', fontWeight: 850, outline: 'none' }; }
function tone(severity) { return severity === 'danger' ? '#fca5a5' : severity === 'warning' ? '#fcd34d' : severity === 'success' ? '#86efac' : '#93c5fd'; }
function iconFor(module) { return MODULE_ICONS[String(module || '').toLowerCase()] || MODULE_ICONS.system; }
function label(value) { return String(value || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }
function entryRoute(entry = {}) {
  const metadata = entry.metadata || {};
  const params = new URLSearchParams();
  const set = (key, value) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); };
  set('activityId', entry.id); set('module', entry.module); set('event', entry.event);
  if (metadata.ticketId) { set('ticketId', metadata.ticketId); return `/tickets?${params}`; }
  if (metadata.submissionId || metadata.formId) { set('submissionId', metadata.submissionId); set('formId', metadata.formId); return `/forms?${params}`; }
  if (metadata.ruleId || metadata.executionId) { set('ruleId', metadata.ruleId); set('executionId', metadata.executionId); return `/automation?${params}`; }
  if (entry.module === 'security') return `/security?${params}`;
  if (entry.module === 'runtime') return `/overview?${params}`;
  if (entry.module === 'deployment') return `/owner/deployments?${params}`;
  if (entry.module === 'backup') { set('backupId', metadata.backupId); return `/owner/backups?${params}`; }
  return `${entry.route || '/timeline'}${params.toString() ? `?${params}` : ''}`;
}

export default function Timeline({ theme, selectedGuild, selectedGuildData }) {
  const x = t(theme);
  const guildId = gid(selectedGuild, selectedGuildData);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState({ total: 0, warning: 0, danger: 0, modules: [] });
  const [moduleFilter, setModuleFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const modules = useMemo(() => summary.modules || [...new Set(entries.map((entry) => entry.module))], [summary.modules, entries]);

  const load = useCallback(async () => {
    if (!guildId) return;
    setBusy(true); setError('');
    try {
      const query = api.buildQuery({ module: moduleFilter, severity: severityFilter, search, limit: 150 });
      const payload = await api.request(`/api/activity/${guildId}${query ? `?${query}` : ''}`);
      setEntries(payload.entries || []); setSummary(payload.summary || {});
    } catch (err) { setError(err.message || 'Failed to load timeline.'); }
    finally { setBusy(false); }
  }, [guildId, moduleFilter, severityFilter, search]);

  useEffect(() => { load(); }, [load]);

  async function createTest() {
    if (!guildId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/activity/${guildId}/test`, { method: 'POST' });
      setEntries(payload.entries || []); setSummary(payload.summary || {}); setNotice('Test activity entry created.');
    } catch (err) { setError(err.message || 'Failed to create test activity.'); }
    finally { setBusy(false); }
  }

  async function clearTimeline() {
    if (!guildId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/activity/${guildId}`, { method: 'DELETE' });
      setEntries(payload.entries || []); setSummary(payload.summary || {}); setNotice('Timeline cleared.');
    } catch (err) { setError(err.message || 'Failed to clear timeline.'); }
    finally { setBusy(false); }
  }

  function clearFilters() { setModuleFilter(''); setSeverityFilter(''); setSearch(''); }
  function openEntry(entry) { goDashboard(entryRoute(entry)); }

  if (!guildId) return <section style={card(x)}><h2>Select a server</h2><p style={{ color: x.mutedText }}>Select a server to view the activity timeline.</p></section>;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card(x), background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08), rgba(168,85,247,0.12))' }}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Global Activity Timeline</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)' }}>Platform History</h1>
        <p style={{ margin: '8px 0 0', color: x.mutedText }}>A central record of what happened across tickets, forms, automation, security, deployments and backups.</p>
      </section>

      {(error || notice || busy) ? <section style={{ ...card(x), color: error ? '#fca5a5' : notice ? '#86efac' : x.mutedText, fontWeight: 850 }}>{error || notice || 'Loading timeline...'}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
        <Stat theme={x} label="Events" value={summary.total || 0} />
        <Stat theme={x} label="Modules" value={modules.length || 0} />
        <Stat theme={x} label="Warnings" value={summary.warning || 0} />
        <Stat theme={x} label="Critical" value={summary.danger || 0} />
      </section>

      <section style={{ ...card(x), display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} style={field(x)}><option value="">All modules</option>{modules.map((module) => <option key={module} value={module}>{iconFor(module)} {label(module)}</option>)}</select>
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} style={field(x)}><option value="">All severities</option>{SEVERITIES.map((severity) => <option key={severity} value={severity}>{label(severity)}</option>)}</select>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search timeline" style={{ ...field(x), minWidth: 220 }} />
          <button type="button" onClick={load} disabled={busy} style={button(x, busy)}>Refresh</button>
          <button type="button" onClick={createTest} disabled={busy} style={button(x, busy)}>Create test</button>
          <button type="button" onClick={clearTimeline} disabled={busy} style={button(x, busy)}>Clear</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {modules.slice(0, 10).map((module) => <button key={module} type="button" onClick={() => setModuleFilter(moduleFilter === module ? '' : module)} style={{ ...button(x), borderColor: moduleFilter === module ? '#93c5fd' : x.cardBorder }}>{iconFor(module)} {label(module)}</button>)}
          <button type="button" onClick={clearFilters} style={button(x)}>Clear filters</button>
        </div>
      </section>

      <section style={{ ...card(x), display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Activity</h3>
        {entries.length ? entries.map((entry) => (
          <article key={entry.id} style={{ border: `1px solid ${tone(entry.severity)}66`, background: `${tone(entry.severity)}0f`, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.42)', border: `1px solid ${tone(entry.severity)}55` }}>{iconFor(entry.module)}</span>
                <div>
                  <strong style={{ color: tone(entry.severity), display: 'block' }}>{entry.title}</strong>
                  <span style={{ color: x.mutedText, fontSize: 12 }}>{label(entry.module)} · {label(entry.event)} · {entry.createdAt}</span>
                </div>
              </div>
              <span style={{ color: tone(entry.severity), border: `1px solid ${tone(entry.severity)}66`, borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{entry.severity}</span>
            </div>
            <p style={{ margin: 0, color: x.mutedText }}>{entry.message || 'No details.'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => openEntry(entry)} style={button(x)}>Open</button>
              <button type="button" onClick={() => setModuleFilter(entry.module)} style={button(x)}>{iconFor(entry.module)} Filter module</button>
            </div>
          </article>
        )) : <EmptyState theme={x} icon={E.HISTORY} title="No activity recorded yet" description="Tickets, forms, automation, security, runtime, deployment and backup events will be written here as they happen." />}
      </section>
    </div>
  );
}

function Stat({ theme, label, value }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>{value}</div></div>;
}
