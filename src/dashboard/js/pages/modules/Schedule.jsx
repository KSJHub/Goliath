import React, { useEffect, useMemo, useState } from 'react';
import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect } from '../../ui/DiscordResourceSelects.jsx';

const emptyDraft = { title: '', description: '', startAt: '', durationMinutes: 60, timezone: 'UTC', channelId: '', capacity: '', recurrence: { type: 'none', interval: 1 }, reminderMinutes: [1440, 60, 10], allowMaybe: true, waitlistEnabled: true };
const getGuildId = (selectedGuild, selectedGuildData) => String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
const fieldStyle = (theme) => ({ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.45)', color: theme.cardText, borderRadius: 12, padding: '11px 12px', width: '100%' });
const buttonStyle = (theme, tone = 'default') => ({ border: `1px solid ${theme.cardBorder}`, background: tone === 'success' ? 'rgba(22,163,74,.22)' : tone === 'danger' ? 'rgba(220,38,38,.22)' : tone === 'primary' ? 'rgba(37,99,235,.22)' : 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 14, padding: '10px 14px', fontWeight: 900, cursor: 'pointer' });

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export default function Schedule({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [health, setHealth] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const card = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow }), [theme]);

  async function load() {
    if (!guildId) return;
    setError('');
    try {
      const [payload, healthPayload, channelPayload] = await Promise.all([
        api.request(`/api/schedule/${guildId}`),
        api.request(`/api/schedule/${guildId}/health`),
        api.getGuildChannels(guildId),
      ]);
      setConfig(payload.config || {});
      setEvents(payload.events || []);
      setHealth(healthPayload.health || null);
      setChannels(Array.isArray(channelPayload) ? channelPayload : channelPayload?.channels || channelPayload?.data || []);
    } catch (loadError) { setError(loadError.message || 'Failed to load Schedule.'); }
  }
  useEffect(() => { load(); }, [guildId]);

  async function action(name, request, notice) {
    setBusy(name); setError(''); setMessage('');
    try { const result = await request(); if (notice) setMessage(notice); await load(); return result; }
    catch (actionError) { setError(actionError.message || 'Schedule action failed.'); return null; }
    finally { setBusy(''); }
  }

  async function saveEvent() {
    const body = { ...draft, startAt: new Date(draft.startAt).toISOString(), capacity: draft.capacity === '' ? null : Number(draft.capacity), recurrence: { ...(draft.recurrence || {}), interval: Number(draft.recurrence?.interval || 1) } };
    const path = editingId ? `/api/schedule/${guildId}/events/${editingId}` : `/api/schedule/${guildId}/events`;
    const result = await action('save', () => api.request(path, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) }), editingId ? 'Event updated.' : 'Event created.');
    if (result) { setEditingId(''); setDraft(emptyDraft); }
  }
  function editEvent(event) {
    setEditingId(event.eventId);
    setDraft({ ...emptyDraft, ...event, startAt: toLocalInput(event.startAt), capacity: event.capacity ?? '', recurrence: event.recurrence || emptyDraft.recurrence });
  }

  if (!guildId) return <EmptyState theme={theme} icon="📅" title="Select a server" description="Select a server to manage Schedule." />;
  const upcoming = events.filter((event) => event.status === 'scheduled');
  const analytics = config?.analytics || {};

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...card, padding: 24, background: 'linear-gradient(135deg, rgba(37,99,235,.2), rgba(15,23,42,.08) 50%, rgba(168,85,247,.16))' }}>
      <p style={{ margin: '0 0 8px', color: '#93c5fd', fontWeight: 950, letterSpacing: '.08em', textTransform: 'uppercase' }}>Goliath Events</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(28px,4vw,42px)' }}>Schedule</h1>
      <p style={{ color: theme.mutedText, maxWidth: 850, lineHeight: 1.6 }}>Create one-off or recurring events, publish RSVP panels, manage capacity and waitlists, and recover reminders after restarts.</p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
      {[['Status', config?.enabled === false ? 'Disabled' : 'Enabled'], ['Upcoming', upcoming.length], ['Created', analytics.created || 0], ['RSVPs', analytics.rsvps || 0], ['Reminders', analytics.remindersSent || 0], ['Health', health?.healthy ? 'Healthy' : 'Attention']].map(([label, value]) => <div key={label} style={{ ...card, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 950, marginTop: 6 }}>{value}</div></div>)}
    </section>

    {(error || message) && <section style={{ ...card, padding: 15, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || message}</section>}

    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Operations</h2><p style={{ color: theme.mutedText }}>Runtime, recovery and data controls.</p></div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button style={buttonStyle(theme, 'primary')} disabled={busy} onClick={() => action('enabled', () => api.request(`/api/schedule/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: config?.enabled === false }) }), 'Status updated.')}>{config?.enabled === false ? 'Enable' : 'Disable'}</button>
        <button style={buttonStyle(theme, 'success')} disabled={busy} onClick={() => action('process', () => api.request(`/api/schedule/${guildId}/process`, { method: 'POST' }), 'Schedule processed.')}>Process Now</button>
        <button style={buttonStyle(theme, 'primary')} disabled={busy} onClick={() => action('repair', () => api.request(`/api/schedule/${guildId}/repair`, { method: 'POST' }), 'Repair completed.')}>Repair</button>
        <a style={{ ...buttonStyle(theme), textDecoration: 'none' }} href={`/api/schedule/${guildId}/export`}>Export</a>
      </div></div>
    </section>

    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>{editingId ? 'Edit Event' : 'Create Event'}</h2><p style={{ color: theme.mutedText }}>Dates are stored as UTC and rendered by Discord in each member's local timezone.</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <label>Title<input style={fieldStyle(theme)} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Start<input style={fieldStyle(theme)} type="datetime-local" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} /></label>
        <label>Timezone<input style={fieldStyle(theme)} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
        <label>Duration minutes<input style={fieldStyle(theme)} type="number" min="5" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
        <label>Capacity<input style={fieldStyle(theme)} type="number" min="1" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="Unlimited" /></label>
        <label>Recurrence<select style={fieldStyle(theme)} value={draft.recurrence?.type || 'none'} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, type: e.target.value } })}>{['none','daily','weekly','monthly'].map((type) => <option key={type}>{type}</option>)}</select></label>
        <ChannelSelect theme={theme} resources={channels} value={draft.channelId} onChange={(channelId) => setDraft({ ...draft, channelId })} label="Announcement Channel" />
      </div>
      <label>Description<textarea style={{ ...fieldStyle(theme), minHeight: 100 }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <div style={{ display: 'flex', gap: 10 }}><button style={buttonStyle(theme, 'success')} disabled={busy || !draft.title || !draft.startAt} onClick={saveEvent}>{busy === 'save' ? 'Saving...' : editingId ? 'Save Changes' : 'Create Event'}</button>{editingId && <button style={buttonStyle(theme)} onClick={() => { setEditingId(''); setDraft(emptyDraft); }}>Cancel</button>}</div>
    </section>

    <section style={{ ...card, padding: 22, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Events</h2>{events.length === 0 ? <EmptyState theme={theme} icon="📅" title="No events" description="Create your first scheduled event." /> : events.map((event) => <article key={event.eventId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 16, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{event.title}</strong><div style={{ color: theme.mutedText }}>{new Date(event.startAt).toLocaleString()} · {event.status} · {event.timezone}</div></div><div>{Object.values(event.rsvps || {}).filter((r) => r.status === 'going').length}{event.capacity ? `/${event.capacity}` : ''} going</div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={buttonStyle(theme)} onClick={() => editEvent(event)}>Edit</button>
        <button style={buttonStyle(theme, 'success')} disabled={!event.channelId || busy} onClick={() => action(`deploy-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/deploy`, { method: 'POST', body: JSON.stringify({ channelId: event.channelId }) }), 'Event deployed.')}>{event.messageId ? 'Redeploy' : 'Deploy'}</button>
        {event.messageId && <button style={buttonStyle(theme, 'primary')} disabled={busy} onClick={() => action(`update-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/deployment/update`, { method: 'POST' }), 'Deployment updated.')}>Update Message</button>}
        <button style={buttonStyle(theme)} disabled={busy} onClick={() => action(`duplicate-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/duplicate`, { method: 'POST' }), 'Event duplicated.')}>Duplicate</button>
        {event.status === 'scheduled' && <button style={buttonStyle(theme, 'danger')} disabled={busy} onClick={() => window.confirm('Cancel this event?') && action(`cancel-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/cancel`, { method: 'POST' }), 'Event cancelled.')}>Cancel</button>}
      </div>
    </article>)}</section>
  </div>;
}
