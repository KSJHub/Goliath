import { goDashboard } from '../../services/dashboardPath.js';
import React, { useCallback, useEffect, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { buildNotificationRoute } from '../../utils/notificationLinks.js';

const fallback = { cardBorder: 'rgba(148,163,184,0.22)', cardBg: 'rgba(15,23,42,0.42)', cardText: '#e5e7eb', mutedText: '#94a3b8', shadow: '0 18px 50px rgba(0,0,0,0.25)' };
function themeOf(theme) { return { ...fallback, ...(theme || {}) }; }
function guildIdOf(selectedGuild, selectedGuildData) { return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim(); }
function card(theme, extra = {}) { const t = themeOf(theme); return { border: `1px solid ${t.cardBorder}`, background: t.cardBg, color: t.cardText, borderRadius: 20, padding: 18, boxShadow: t.shadow, ...extra }; }
function button(theme, disabled = false) { const t = themeOf(theme); return { border: `1px solid ${t.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: t.cardText, borderRadius: 12, padding: '9px 11px', fontWeight: 950, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }; }
function tone(level) { return level === 'danger' ? '#fca5a5' : level === 'warning' ? '#fcd34d' : level === 'success' ? '#86efac' : '#93c5fd'; }

export default function Notifications({ theme, selectedGuild, selectedGuildData }) {
  const t = themeOf(theme);
  const guildId = guildIdOf(selectedGuild, selectedGuildData);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, unread: 0, warning: 0, danger: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!guildId) return;
    setBusy(true); setError('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}`);
      setItems(payload.notifications || []);
      setSummary(payload.summary || {});
    } catch (err) { setError(err.message || 'Failed to load notifications.'); }
    finally { setBusy(false); }
  }, [guildId]);

  useEffect(() => { load(); }, [load]);

  async function createTest() {
    if (!guildId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}/test`, { method: 'POST', body: JSON.stringify({ level: 'warning' }) });
      setItems(payload.notifications || []); setSummary(payload.summary || {}); setNotice('Test notification created.');
    } catch (err) { setError(err.message || 'Failed to create test notification.'); }
    finally { setBusy(false); }
  }

  async function markRead(item, read = true) {
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}/${encodeURIComponent(item.id)}/read`, { method: 'PATCH', body: JSON.stringify({ read }) });
      setItems(payload.notifications || []); setSummary(payload.summary || {});
    } catch (err) { setError(err.message || 'Failed to update notification.'); }
    finally { setBusy(false); }
  }

  async function markAllRead() {
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}/mark-all-read`, { method: 'POST' });
      setItems(payload.notifications || []); setSummary(payload.summary || {}); setNotice('All notifications marked as read.');
    } catch (err) { setError(err.message || 'Failed to mark all read.'); }
    finally { setBusy(false); }
  }

  function openNotification(item) {
    goDashboard(buildNotificationRoute(item));
  }

  if (!guildId) return <section style={card(t)}><h2>Select a server</h2><p style={{ color: t.mutedText }}>Select a server to view notifications.</p></section>;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card(t), background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08), rgba(168,85,247,0.12))' }}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Global Notification Centre</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)' }}>Alerts & Activity</h1>
        <p style={{ margin: '8px 0 0', color: t.mutedText }}>One inbox for alerts, warnings and workflow activity.</p>
      </section>

      {(error || notice || busy) ? <section style={{ ...card(t), color: error ? '#fca5a5' : notice ? '#86efac' : t.mutedText, fontWeight: 850 }}>{error || notice || 'Loading notifications...'}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
        <Stat theme={t} label="Total" value={summary.total || 0} />
        <Stat theme={t} label="Unread" value={summary.unread || 0} />
        <Stat theme={t} label="Warnings" value={summary.warning || 0} />
        <Stat theme={t} label="Critical" value={summary.danger || 0} />
      </section>

      <section style={{ ...card(t), display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={load} disabled={busy} style={button(t, busy)}>Refresh</button>
        <button type="button" onClick={createTest} disabled={busy} style={button(t, busy)}>Create test</button>
        <button type="button" onClick={markAllRead} disabled={busy} style={button(t, busy)}>Mark all read</button>
      </section>

      <section style={{ ...card(t), display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Notifications</h3>
        {items.length ? items.map((item) => (
          <article key={item.id} style={{ border: `1px solid ${item.read ? t.cardBorder : `${tone(item.level)}88`}`, borderRadius: 14, padding: 12, display: 'grid', gap: 6 }}>
            <strong style={{ color: tone(item.level) }}>{item.title}</strong>
            <span style={{ color: t.mutedText, fontSize: 12 }}>{item.source} · {item.createdAt}</span>
            <p style={{ margin: 0, color: t.mutedText }}>{item.message || 'No message.'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => openNotification(item)} style={button(t)}>Open</button>
              <button type="button" onClick={() => markRead(item, !item.read)} disabled={busy} style={button(t, busy)}>{item.read ? 'Mark unread' : 'Mark read'}</button>
            </div>
          </article>
        )) : <EmptyState theme={t} icon="🔔" title="You're all caught up" description="Alerts from Tickets, Forms, Automation, Security, Runtime, Deployments and Backups will appear here." />}
      </section>
    </div>
  );
}

function Stat({ theme, label, value }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>{value}</div></div>;
}
