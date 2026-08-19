import React, { useEffect, useMemo, useState } from 'react';
import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect } from '../../ui/DiscordResourceSelects.jsx';

const DEFAULT_OPTIONS = [
  { key: 'going', label: 'Going', emoji: '✅', style: 'success', isAttendee: true, roleId: '', enabled: true },
  { key: 'maybe', label: 'Maybe', emoji: '❔', style: 'primary', isAttendee: false, roleId: '', enabled: true },
  { key: 'declined', label: 'Decline', emoji: '❌', style: 'secondary', isAttendee: false, roleId: '', enabled: true },
];
const emptyDraft = {
  title: '', description: '', startAt: '', durationMinutes: 60, timezone: 'Europe/London', channelId: '', voiceChannelId: '', location: '', color: 0x5865F2,
  capacity: '', waitlistEnabled: true, rsvpCloseAt: '', rsvpOptions: DEFAULT_OPTIONS, allowedRoleIds: [], deniedRoleIds: [], mentionRoleIds: [],
  recurrence: { type: 'none', interval: 1, count: '', until: '', weekdays: [], autoJoinNextAllowed: true },
  reminderMinutes: [1440, 60, 10], notifications: [], mirrorDiscordEvent: false, thread: { enabled: false, title: '{event}', addAttendeesOnRsvp: true, autoArchiveDuration: 1440 },
};
const getGuildId = (selectedGuild, selectedGuildData) => String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
const fieldStyle = (theme) => ({ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.45)', color: theme.cardText, borderRadius: 12, padding: '11px 12px', width: '100%', boxSizing: 'border-box' });
const buttonStyle = (theme, tone = 'default') => ({ border: `1px solid ${theme.cardBorder}`, background: tone === 'success' ? 'rgba(22,163,74,.22)' : tone === 'danger' ? 'rgba(220,38,38,.22)' : tone === 'primary' ? 'rgba(37,99,235,.22)' : 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 14, padding: '10px 14px', fontWeight: 900, cursor: 'pointer' });
const cardStyle = (theme) => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow });

function toLocalInput(value, timezone = 'UTC') {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
function localInZoneToIso(value, timezone) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const probe = new Date(target);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(probe);
  const found = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(Number(found.year), Number(found.month) - 1, Number(found.day), Number(found.hour), Number(found.minute));
  return new Date(target + (target - represented)).toISOString();
}
function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}
function MultiRoleSelect({ theme, label, roles, value, onChange }) {
  return <label style={{ display: 'grid', gap: 7 }}><span style={{ color: theme.mutedText, fontWeight: 900 }}>{label}</span><select multiple value={value || []} onChange={(e) => onChange([...e.target.selectedOptions].map((option) => option.value))} style={{ ...fieldStyle(theme), minHeight: 120 }}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name || role.label || role.id}</option>)}</select></label>;
}
function TextAreaField({ theme, label, value, onChange, placeholder, rows = 5 }) {
  return <label style={{ display: 'grid', gap: 7 }}><span style={{ color: theme.mutedText, fontWeight: 900 }}>{label}</span><textarea rows={rows} style={fieldStyle(theme)} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
function rsvpOptionsText(options = []) { return options.map((item) => `${item.emoji || ''}|${item.label}|${item.isAttendee ? 'attendee' : 'choice'}|${item.roleId || ''}`).join('\n'); }
function parseRsvpOptions(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [emoji = '', label = '', mode = 'choice', roleId = ''] = line.split('|').map((item) => item.trim());
    const safeLabel = label || `Option ${index + 1}`;
    return { key: safeLabel.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40), label: safeLabel, emoji, style: index === 0 ? 'success' : 'secondary', isAttendee: mode.toLowerCase() === 'attendee', roleId, enabled: true };
  });
}
function notificationsText(items = []) { return items.map((item) => `${item.minutesBefore}|${item.title}|${item.description}`).join('\n'); }
function parseNotifications(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [minutes = '0', title = 'Event Reminder', ...description] = line.split('|');
    return { minutesBefore: Number(minutes.trim()) || 0, title: title.trim() || 'Event Reminder', description: description.join('|').trim() || '{event} starts {relative}.', sent: false };
  });
}

export default function Schedule({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [health, setHealth] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [tab, setTab] = useState('basics');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const card = useMemo(() => cardStyle(theme), [theme]);

  async function load() {
    if (!guildId) return;
    setError('');
    try {
      const [payload, healthPayload, channelPayload, rolePayload] = await Promise.all([
        api.request(`/api/schedule/${guildId}`), api.request(`/api/schedule/${guildId}/health`), api.getGuildChannels(guildId), api.getGuildRoles(guildId),
      ]);
      setConfig(payload.config || {}); setEvents(payload.events || []); setTemplates(payload.templates || []); setHealth(healthPayload.health || null);
      setChannels(normalizeList(channelPayload, 'channels')); setRoles(normalizeList(rolePayload, 'roles'));
      if (!editingId && payload.config?.settings?.defaultTimezone) setDraft((current) => ({ ...current, timezone: current.timezone || payload.config.settings.defaultTimezone }));
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
    const startAt = localInZoneToIso(draft.startAt, draft.timezone || 'UTC');
    const body = {
      ...draft,
      startAt,
      endAt: new Date(new Date(startAt).getTime() + Number(draft.durationMinutes || 60) * 60000).toISOString(),
      capacity: draft.capacity === '' ? null : Number(draft.capacity),
      rsvpCloseAt: draft.rsvpCloseAt ? localInZoneToIso(draft.rsvpCloseAt, draft.timezone || 'UTC') : null,
      recurrence: { ...(draft.recurrence || {}), interval: Number(draft.recurrence?.interval || 1), count: draft.recurrence?.count === '' ? null : Number(draft.recurrence?.count), until: draft.recurrence?.until ? `${draft.recurrence.until}T23:59:59Z` : null },
      reminderMinutes: (draft.reminderMinutes || []).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
    };
    const path = editingId ? `/api/schedule/${guildId}/events/${editingId}` : `/api/schedule/${guildId}/events`;
    const result = await action('save', () => api.request(path, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) }), editingId ? 'Event updated.' : 'Event created.');
    if (result) { setEditingId(''); setDraft({ ...emptyDraft, timezone: config?.settings?.defaultTimezone || 'Europe/London' }); setTab('basics'); }
  }
  function editEvent(event) {
    const durationMinutes = Math.max(5, Math.round((new Date(event.endAt) - new Date(event.startAt)) / 60000));
    setEditingId(event.eventId);
    setDraft({ ...emptyDraft, ...event, durationMinutes, startAt: toLocalInput(event.startAt, event.timezone), rsvpCloseAt: event.rsvpCloseAt ? toLocalInput(event.rsvpCloseAt, event.timezone) : '', capacity: event.capacity ?? '', recurrence: { ...emptyDraft.recurrence, ...(event.recurrence || {}), count: event.recurrence?.count ?? '', until: event.recurrence?.until?.slice(0, 10) || '' }, thread: { ...emptyDraft.thread, ...(event.thread || {}) } });
    setTab('basics');
  }
  async function saveSettings(patch, notice = 'Schedule defaults updated.') { return action('settings', () => api.request(`/api/schedule/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }), notice); }
  async function saveTemplate(event) {
    const name = window.prompt('Template name', event.title); if (!name) return;
    await action('template-save', () => api.request(`/api/schedule/${guildId}/templates`, { method: 'POST', body: JSON.stringify({ name, event }) }), 'Template saved.');
  }
  async function createFromTemplate(template) {
    const startAt = window.prompt('New event start (ISO or YYYY-MM-DDTHH:mm)', new Date(Date.now() + 3600000).toISOString()); if (!startAt) return;
    const start = new Date(startAt); if (!Number.isFinite(start.getTime())) { setError('Invalid event start.'); return; }
    const sourceDuration = template.event?.endAt && template.event?.startAt ? new Date(template.event.endAt) - new Date(template.event.startAt) : 3600000;
    await action('template-create', () => api.request(`/api/schedule/${guildId}/templates/${template.templateId}/create-event`, { method: 'POST', body: JSON.stringify({ startAt: start.toISOString(), endAt: new Date(start.getTime() + sourceDuration).toISOString() }) }), 'Event created from template.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="📅" title="Select a server" description="Select a server to manage Schedule." />;
  const upcoming = events.filter((event) => event.status === 'scheduled');
  const analytics = config?.analytics || {};
  const settings = config?.settings || {};
  const tabs = [['basics','Basics'],['rsvp','RSVP & Roles'],['repeat','Repeat & Reminders'],['advanced','Threads & Native']];

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...card, padding: 24, background: 'linear-gradient(135deg, rgba(37,99,235,.2), rgba(15,23,42,.08) 50%, rgba(168,85,247,.16))' }}>
      <p style={{ margin: '0 0 8px', color: '#93c5fd', fontWeight: 950, letterSpacing: '.08em', textTransform: 'uppercase' }}>Utility Studio</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(28px,4vw,42px)' }}>📅 Schedule</h1>
      <p style={{ color: theme.mutedText, maxWidth: 900, lineHeight: 1.6 }}>Create Sesh-style one-off or recurring events with custom RSVPs, capacity/waitlists, role restrictions, personal reminders, event notifications, threads, native Discord event mirroring and reusable templates.</p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 12 }}>
      {[['Status', config?.enabled === false ? 'Disabled' : 'Enabled'], ['Upcoming', upcoming.length], ['Templates', templates.length], ['RSVPs', analytics.rsvps || 0], ['Reminders', (analytics.remindersSent || 0) + (analytics.personalRemindersSent || 0)], ['Health', health?.healthy ? 'Healthy' : 'Attention']].map(([label, value]) => <div key={label} style={{ ...card, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 950, marginTop: 6 }}>{value}</div></div>)}
    </section>

    {(error || message) && <section style={{ ...card, padding: 15, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || message}</section>}

    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Server Defaults</h2><p style={{ color: theme.mutedText }}>Defaults apply to newly created events.</p></div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button style={buttonStyle(theme, 'primary')} disabled={busy} onClick={() => action('enabled', () => api.request(`/api/schedule/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: config?.enabled === false }) }), 'Status updated.')}>{config?.enabled === false ? 'Enable Module' : 'Disable Module'}</button>
        <button style={buttonStyle(theme)} disabled={busy} onClick={() => action('process', () => api.request(`/api/schedule/${guildId}/process`, { method: 'POST' }), 'Schedule processed.')}>Process Now</button>
        <button style={buttonStyle(theme)} disabled={busy} onClick={() => action('repair', () => api.request(`/api/schedule/${guildId}/repair`, { method: 'POST' }), 'Repair completed.')}>Health / Repair</button>
      </div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 7 }}><span>Default timezone</span><input style={fieldStyle(theme)} value={settings.defaultTimezone || 'UTC'} onChange={(e) => setConfig({ ...config, settings: { ...settings, defaultTimezone: e.target.value } })} onBlur={(e) => saveSettings({ defaultTimezone: e.target.value })} /></label>
        <ChannelSelect theme={theme} resources={channels} value={settings.defaultChannelId || ''} onChange={(defaultChannelId) => saveSettings({ defaultChannelId: defaultChannelId || null })} label="Default Event Channel" />
        <label><input type="checkbox" checked={settings.createDiscordEvents === true} onChange={(e) => saveSettings({ createDiscordEvents: e.target.checked })} /> Mirror new events to Discord native events</label>
        <label><input type="checkbox" checked={settings.createEventThreads === true} onChange={(e) => saveSettings({ createEventThreads: e.target.checked })} /> Create event threads by default</label>
        <label><input type="checkbox" checked={settings.warnOverlaps !== false} onChange={(e) => saveSettings({ warnOverlaps: e.target.checked })} /> Warn members about overlapping RSVPs</label>
        <label><input type="checkbox" checked={settings.allowMemberReminders !== false} onChange={(e) => saveSettings({ allowMemberReminders: e.target.checked })} /> Allow member personal reminders</label>
      </div>
    </section>

    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>{editingId ? 'Edit Event' : 'Create Event'}</h2><p style={{ color: theme.mutedText }}>Times are interpreted in the event timezone and displayed by Discord in each member's local timezone.</p></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{tabs.map(([key,label]) => <button key={key} style={buttonStyle(theme, tab === key ? 'primary' : 'default')} onClick={() => setTab(key)}>{label}</button>)}</div>

      {tab === 'basics' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <label>Title<input style={fieldStyle(theme)} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Start<input style={fieldStyle(theme)} type="datetime-local" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} /></label>
          <label>Timezone<input style={fieldStyle(theme)} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
          <label>Duration minutes<input style={fieldStyle(theme)} type="number" min="5" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
          <ChannelSelect theme={theme} resources={channels} value={draft.channelId} onChange={(channelId) => setDraft({ ...draft, channelId })} label="Event Channel" />
          <ChannelSelect theme={theme} resources={channels.filter((channel) => String(channel.type).toLowerCase().includes('voice') || [2,13].includes(Number(channel.type)))} value={draft.voiceChannelId || ''} onChange={(voiceChannelId) => setDraft({ ...draft, voiceChannelId })} label="Voice / Stage Channel" />
          <label>Location<input style={fieldStyle(theme)} value={draft.location || ''} onChange={(e) => setDraft({ ...draft, location: e.target.value })} /></label>
          <label>Embed colour<input style={fieldStyle(theme)} type="color" value={`#${Number(draft.color || 0x5865F2).toString(16).padStart(6,'0')}`} onChange={(e) => setDraft({ ...draft, color: parseInt(e.target.value.slice(1),16) })} /></label>
        </div>
        <TextAreaField theme={theme} label="Description" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} rows={4} />
        <MultiRoleSelect theme={theme} label="Roles to mention on deployment" roles={roles} value={draft.mentionRoleIds} onChange={(mentionRoleIds) => setDraft({ ...draft, mentionRoleIds })} />
      </>}

      {tab === 'rsvp' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <label>Capacity<input style={fieldStyle(theme)} type="number" min="1" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="Unlimited" /></label>
          <label>RSVP closes<input style={fieldStyle(theme)} type="datetime-local" value={draft.rsvpCloseAt || ''} onChange={(e) => setDraft({ ...draft, rsvpCloseAt: e.target.value })} /></label>
          <label><input type="checkbox" checked={draft.waitlistEnabled !== false} onChange={(e) => setDraft({ ...draft, waitlistEnabled: e.target.checked })} /> Enable waitlist</label>
        </div>
        <TextAreaField theme={theme} label="RSVP options" value={rsvpOptionsText(draft.rsvpOptions)} onChange={(text) => setDraft({ ...draft, rsvpOptions: parseRsvpOptions(text) })} placeholder="✅|Going|attendee|ROLE_ID" rows={6} />
        <div style={{ color: theme.mutedText, fontSize: 12 }}>Format: emoji | label | attendee/choice | optional role ID. Attendee options count against event capacity and can grant the selected role.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}><MultiRoleSelect theme={theme} label="Roles allowed to RSVP (none = everyone)" roles={roles} value={draft.allowedRoleIds} onChange={(allowedRoleIds) => setDraft({ ...draft, allowedRoleIds })} /><MultiRoleSelect theme={theme} label="Roles blocked from RSVP" roles={roles} value={draft.deniedRoleIds} onChange={(deniedRoleIds) => setDraft({ ...draft, deniedRoleIds })} /></div>
      </>}

      {tab === 'repeat' && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          <label>Recurrence<select style={fieldStyle(theme)} value={draft.recurrence?.type || 'none'} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, type: e.target.value } })}>{['none','hourly','daily','weekly','monthly','yearly'].map((type) => <option key={type}>{type}</option>)}</select></label>
          <label>Repeat every<input style={fieldStyle(theme)} type="number" min="1" value={draft.recurrence?.interval || 1} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, interval: Number(e.target.value) } })} /></label>
          <label>Stop after occurrences<input style={fieldStyle(theme)} type="number" min="1" value={draft.recurrence?.count ?? ''} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, count: e.target.value } })} /></label>
          <label>Stop on date<input style={fieldStyle(theme)} type="date" value={draft.recurrence?.until || ''} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, until: e.target.value } })} /></label>
          <label>Weekly days (0=Sun..6=Sat)<input style={fieldStyle(theme)} value={(draft.recurrence?.weekdays || []).join(',')} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, weekdays: e.target.value.split(',').map(Number).filter(Number.isInteger) } })} /></label>
          <label><input type="checkbox" checked={draft.recurrence?.autoJoinNextAllowed !== false} onChange={(e) => setDraft({ ...draft, recurrence: { ...draft.recurrence, autoJoinNextAllowed: e.target.checked } })} /> Allow attendees to Auto Join Next</label>
        </div>
        <label>Channel reminder minutes<input style={fieldStyle(theme)} value={(draft.reminderMinutes || []).join(', ')} onChange={(e) => setDraft({ ...draft, reminderMinutes: e.target.value.split(',').map((v) => Number(v.trim())).filter((n) => Number.isFinite(n) && n >= 0) })} /></label>
        <TextAreaField theme={theme} label="Custom event notifications" value={notificationsText(draft.notifications)} onChange={(text) => setDraft({ ...draft, notifications: parseNotifications(text) })} placeholder="30|Starting Soon|{event} starts {relative}." rows={5} />
      </>}

      {tab === 'advanced' && <div style={{ display: 'grid', gap: 12 }}>
        <label><input type="checkbox" checked={draft.mirrorDiscordEvent === true} onChange={(e) => setDraft({ ...draft, mirrorDiscordEvent: e.target.checked })} /> Mirror this event to Discord Native Events</label>
        <label><input type="checkbox" checked={draft.thread?.enabled === true} onChange={(e) => setDraft({ ...draft, thread: { ...draft.thread, enabled: e.target.checked } })} /> Create an event thread</label>
        <label>Thread title<input style={fieldStyle(theme)} value={draft.thread?.title || '{event}'} onChange={(e) => setDraft({ ...draft, thread: { ...draft.thread, title: e.target.value } })} /></label>
        <label><input type="checkbox" checked={draft.thread?.addAttendeesOnRsvp !== false} onChange={(e) => setDraft({ ...draft, thread: { ...draft.thread, addAttendeesOnRsvp: e.target.checked } })} /> Add attendees to the thread when they RSVP</label>
        <label>Thread auto-archive<select style={fieldStyle(theme)} value={draft.thread?.autoArchiveDuration || 1440} onChange={(e) => setDraft({ ...draft, thread: { ...draft.thread, autoArchiveDuration: Number(e.target.value) } })}><option value={60}>1 hour</option><option value={1440}>1 day</option><option value={4320}>3 days</option><option value={10080}>7 days</option></select></label>
      </div>}

      <div style={{ display: 'flex', gap: 10 }}><button style={buttonStyle(theme, 'success')} disabled={busy || !draft.title || !draft.startAt} onClick={saveEvent}>{busy === 'save' ? 'Saving...' : editingId ? 'Save Changes' : 'Create Event'}</button>{editingId && <button style={buttonStyle(theme)} onClick={() => { setEditingId(''); setDraft({ ...emptyDraft, timezone: settings.defaultTimezone || 'Europe/London' }); }}>Cancel</button>}</div>
    </section>

    <section style={{ ...card, padding: 22, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Event Templates</h2>{templates.length ? templates.map((template) => <div key={template.templateId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 13, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><strong>{template.name}</strong><div style={{ display: 'flex', gap: 8 }}><button style={buttonStyle(theme, 'primary')} onClick={() => createFromTemplate(template)}>Create Event</button><button style={buttonStyle(theme, 'danger')} onClick={() => window.confirm('Delete this template?') && action('template-delete', () => api.request(`/api/schedule/${guildId}/templates/${template.templateId}`, { method: 'DELETE' }), 'Template deleted.')}>Delete</button></div></div>) : <div style={{ color: theme.mutedText }}>No templates saved yet. Save any event below as a reusable template.</div>}</section>

    <section style={{ ...card, padding: 22, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Events</h2>{events.length === 0 ? <EmptyState theme={theme} icon="📅" title="No events" description="Create your first scheduled event." /> : events.map((event) => {
      const attending = Object.values(event.rsvps || {}).filter((entry) => (event.rsvpOptions || []).some((option) => option.key === entry.status && option.isAttendee)).length;
      return <article key={event.eventId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{event.title}</strong><div style={{ color: theme.mutedText }}>{new Date(event.startAt).toLocaleString()} · {event.status} · {event.timezone}</div><div style={{ color: theme.mutedText, marginTop: 4 }}>{event.recurrence?.type !== 'none' ? `Repeats ${event.recurrence.type}` : 'One-off'} · Native {event.mirrorDiscordEvent ? 'On' : 'Off'} · Thread {event.thread?.enabled ? 'On' : 'Off'}</div></div><div>{attending}{event.capacity ? `/${event.capacity}` : ''} attending</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={buttonStyle(theme)} onClick={() => editEvent(event)}>Edit</button>
          <button style={buttonStyle(theme, 'success')} disabled={!event.channelId || busy} onClick={() => action(`deploy-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/deploy`, { method: 'POST', body: JSON.stringify({ channelId: event.channelId }) }), event.messageId ? 'Event deployment updated.' : 'Event deployed.')}>{event.messageId ? 'Update Deployment' : 'Deploy'}</button>
          <button style={buttonStyle(theme)} disabled={busy} onClick={() => action(`duplicate-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/duplicate`, { method: 'POST' }), 'Event duplicated.')}>Duplicate</button>
          <button style={buttonStyle(theme)} disabled={busy} onClick={() => saveTemplate(event)}>Save Template</button>
          {event.mirrorDiscordEvent && <button style={buttonStyle(theme, 'primary')} disabled={busy} onClick={() => action(`native-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/native/sync`, { method: 'POST' }), 'Native Discord event synced.')}>Sync Native</button>}
          {event.status === 'scheduled' && <button style={buttonStyle(theme, 'danger')} disabled={busy} onClick={() => window.confirm('Cancel this event?') && action(`cancel-${event.eventId}`, () => api.request(`/api/schedule/${guildId}/events/${event.eventId}/cancel`, { method: 'POST' }), 'Event cancelled.')}>Cancel</button>}
        </div>
      </article>;
    })}</section>
  </div>;
}
