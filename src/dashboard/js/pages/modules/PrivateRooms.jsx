import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}
function fieldStyle(theme) { return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.45)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', width: '100%' }; }
function buttonStyle(theme, tone = 'default') {
  const bg = { primary: 'rgba(37,99,235,0.22)', success: 'rgba(22,163,74,0.22)', danger: 'rgba(220,38,38,0.22)', default: 'rgba(15,23,42,0.45)' }[tone];
  return { border: `1px solid ${theme.cardBorder}`, background: bg, color: theme.cardText, borderRadius: 12, padding: '10px 13px', fontWeight: 900, cursor: 'pointer' };
}
function Stat({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.34)', borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 7, fontSize: 27, fontWeight: 950 }}>{value}</div>{hint ? <div style={{ color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}</div>;
}

export default function PrivateRooms({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [data, setData] = useState(null);
  const [resources, setResources] = useState({ channels: [], categories: [], roles: [] });
  const [draft, setDraft] = useState({ purpose: 'Private Conversation', reason: '', participantIds: [], expiryHours: 0 });
  const [memberSearch, setMemberSearch] = useState('');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cardStyle = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow }), [theme]);

  async function load() {
    if (!guildId) return;
    setError('');
    try {
      const [overview, resourcePayload] = await Promise.all([
        api.request(`/api/private-rooms/${guildId}/overview`),
        api.request(`/api/discord/${guildId}/resources`),
      ]);
      setData(overview);
      setResources({ channels: resourcePayload.channels || [], categories: resourcePayload.categories || [], roles: resourcePayload.roles || [] });
    } catch (e) { setError(e.message || 'Failed to load Private Rooms.'); }
  }
  useEffect(() => { load(); }, [guildId]);

  async function action(key, fn, message) {
    setSaving(key); setError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); await load(); }
    catch (e) { setError(e.message || 'Private Rooms action failed.'); }
    finally { setSaving(''); }
  }
  async function saveSettings(patch) {
    return action('settings', () => api.request(`/api/private-rooms/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: patch }) }), 'Settings saved.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="🔒" title="Select a server" description="Select a server to manage Private Rooms." />;

  const config = data?.config || {};
  const overview = data?.overview || {};
  const settings = config.settings || {};
  const rooms = data?.rooms || [];
  const requests = data?.requests || [];
  const activeRooms = rooms.filter((room) => room.status !== 'closed');
  const pendingRequests = requests.filter((request) => request.status === 'pending');
  const members = (data?.members || []).filter((member) => `${member.name} ${member.username}`.toLowerCase().includes(memberSearch.toLowerCase()));
  const analytics = overview.analytics || {};
  const health = overview.health || {};

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08) 48%, rgba(168,85,247,0.16))' }}>
      <p style={{ margin: '0 0 8px', color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Utility Studio</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)' }}>Private Rooms</h1>
      <p style={{ margin: '10px 0 0', color: theme.mutedText, maxWidth: 900, lineHeight: 1.6 }}>Create temporary private interview, warning, training, onboarding and conversation rooms with approval workflows, participant controls, audit history and transcript-safe closing.</p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      <Stat theme={theme} label="Status" value={overview.enabled ? 'Enabled' : 'Disabled'} />
      <Stat theme={theme} label="Active Rooms" value={overview.activeRooms || 0} />
      <Stat theme={theme} label="Pending Requests" value={overview.pendingRequests || 0} />
      <Stat theme={theme} label="Created" value={analytics.roomsCreated || 0} />
      <Stat theme={theme} label="Transcripts" value={analytics.transcriptsCreated || 0} />
      <Stat theme={theme} label="Health" value={health.healthy ? 'Healthy' : 'Attention'} hint={`${health.issues?.length || 0} issue(s) · ${health.warnings?.length || 0} warning(s)`} />
    </section>

    {(error || notice) ? <section style={{ ...cardStyle, padding: 15, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 15 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Core destinations, approval rules, audit and expiry behaviour.</p></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={saving} style={buttonStyle(theme, 'primary')} onClick={() => action('toggle', () => api.request(`/api/private-rooms/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !overview.enabled }) }), 'Module status updated.')}>{overview.enabled ? 'Disable' : 'Enable'}</button>
        <button disabled={saving} style={buttonStyle(theme, 'success')} onClick={() => action('process', () => api.request(`/api/private-rooms/${guildId}/process`, { method: 'POST' }), 'Expiry processing completed.')}>Process Expiry</button>
        <a href={`/api/private-rooms/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
      </div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Room category<select value={settings.categoryId || ''} onChange={(e) => saveSettings({ categoryId: e.target.value || null })} style={fieldStyle(theme)}><option value="">No category</option>{resources.categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Request channel<select value={settings.requestChannelId || ''} onChange={(e) => saveSettings({ requestChannelId: e.target.value || null })} style={fieldStyle(theme)}><option value="">Not set</option>{resources.channels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Transcript channel<select value={settings.transcriptChannelId || ''} onChange={(e) => saveSettings({ transcriptChannelId: e.target.value || null })} style={fieldStyle(theme)}><option value="">Not set</option>{resources.channels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Audit channel<select value={settings.auditChannelId || ''} onChange={(e) => saveSettings({ auditChannelId: e.target.value || null })} style={fieldStyle(theme)}><option value="">Not set</option>{resources.channels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Room name prefix<input value={settings.roomNamePrefix || 'private-room'} onChange={(e) => setData((d) => ({ ...d, config: { ...d.config, settings: { ...settings, roomNamePrefix: e.target.value } } }))} onBlur={(e) => saveSettings({ roomNamePrefix: e.target.value })} style={fieldStyle(theme)} /></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Default expiry hours<input type="number" min="0" max="720" value={settings.defaultExpiryHours || 0} onChange={(e) => setData((d) => ({ ...d, config: { ...d.config, settings: { ...settings, defaultExpiryHours: Number(e.target.value) } } }))} onBlur={(e) => saveSettings({ defaultExpiryHours: Number(e.target.value) })} style={fieldStyle(theme)} /></label>
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', color: theme.mutedText, fontWeight: 800 }}>
        {[
          ['allowUserRoomRequests', 'Users can request rooms'], ['requireUserRoomApproval', 'User rooms require approval'], ['allowParticipantAddRequests', 'Participants can request additions'], ['requireParticipantAddApproval', 'Participant additions require approval'], ['transcriptsEnabled', 'Transcripts enabled'], ['auditEnabled', 'Audit logging enabled'],
        ].map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key] !== false} onChange={(e) => saveSettings({ [key]: e.target.checked })} /> {label}</label>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Manager roles<select multiple value={settings.managerRoleIds || []} onChange={(e) => saveSettings({ managerRoleIds: [...e.target.selectedOptions].map((o) => o.value) })} style={{ ...fieldStyle(theme), minHeight: 120 }}>{resources.roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Approver roles<select multiple value={settings.approverRoleIds || []} onChange={(e) => saveSettings({ approverRoleIds: [...e.target.selectedOptions].map((o) => o.value) })} style={{ ...fieldStyle(theme), minHeight: 120 }}>{resources.roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>Create Private Room</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Staff-created rooms open immediately and remain visible only to selected participants and configured management.</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Purpose<select value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} style={fieldStyle(theme)}>{(settings.purposes || ['Private Conversation']).map((p) => <option key={p}>{p}</option>)}</select></label>
        <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Expiry hours<input type="number" min="0" max="720" value={draft.expiryHours} onChange={(e) => setDraft((d) => ({ ...d, expiryHours: Number(e.target.value) }))} style={fieldStyle(theme)} /></label>
      </div>
      <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontWeight: 850 }}>Reason<textarea rows={3} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} style={{ ...fieldStyle(theme), resize: 'vertical' }} /></label>
      <input placeholder="Search members" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} style={fieldStyle(theme)} />
      <select multiple value={draft.participantIds} onChange={(e) => setDraft((d) => ({ ...d, participantIds: [...e.target.selectedOptions].map((o) => o.value) }))} style={{ ...fieldStyle(theme), minHeight: 150 }}>{members.slice(0, 200).map((member) => <option key={member.id} value={member.id}>{member.name} · @{member.username}</option>)}</select>
      <button disabled={saving || draft.participantIds.length === 0} style={buttonStyle(theme, 'success')} onClick={() => action('create', () => api.request(`/api/private-rooms/${guildId}/rooms`, { method: 'POST', body: JSON.stringify(draft) }), 'Private room created.')}>Create Private Room</button>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Pending Requests</h2>{pendingRequests.length === 0 ? <p style={{ color: theme.mutedText }}>No pending requests.</p> : pendingRequests.map((request) => <div key={request.requestId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}><div style={{ fontWeight: 950 }}>{request.type === 'add_participant' ? 'Participant Addition' : 'New Private Room'} · {request.purpose}</div><div style={{ color: theme.mutedText }}>Requester: {request.requesterId} · Participants: {request.participantIds.join(', ') || 'None'}</div>{request.reason ? <div>{request.reason}</div> : null}<div style={{ display: 'flex', gap: 8 }}><button disabled={saving} style={buttonStyle(theme, 'success')} onClick={() => action(`approve-${request.requestId}`, () => api.request(`/api/private-rooms/${guildId}/requests/${request.requestId}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), 'Request approved.')}>Approve</button><button disabled={saving} style={buttonStyle(theme, 'danger')} onClick={() => action(`deny-${request.requestId}`, () => api.request(`/api/private-rooms/${guildId}/requests/${request.requestId}/review`, { method: 'POST', body: JSON.stringify({ decision: 'deny' }) }), 'Request denied.')}>Deny</button></div></div>)}</section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Active Rooms</h2>{activeRooms.length === 0 ? <p style={{ color: theme.mutedText }}>No active private rooms.</p> : activeRooms.map((room) => <div key={room.roomId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><strong>{room.name || room.roomId}</strong> · {room.purpose}</div><div style={{ fontWeight: 900 }}>{room.status}</div></div><div style={{ color: theme.mutedText }}>Participants: {room.participantIds.join(', ')}{room.expiresAt ? ` · Expires ${new Date(room.expiresAt).toLocaleString()}` : ''}</div>{room.reason ? <div>{room.reason}</div> : null}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={saving} style={buttonStyle(theme, 'primary')} onClick={() => action(`lock-${room.roomId}`, () => api.request(`/api/private-rooms/${guildId}/rooms/${room.roomId}/lock`, { method: 'POST', body: JSON.stringify({ locked: room.status !== 'locked' }) }), room.status === 'locked' ? 'Room unlocked.' : 'Room locked.')}>{room.status === 'locked' ? 'Unlock' : 'Lock'}</button><button disabled={saving} style={buttonStyle(theme)} onClick={() => { const note = window.prompt('Management note'); if (note) action(`note-${room.roomId}`, () => api.request(`/api/private-rooms/${guildId}/rooms/${room.roomId}/note`, { method: 'POST', body: JSON.stringify({ note }) }), 'Note added.'); }}>Add Note</button><button disabled={saving} style={buttonStyle(theme, 'danger')} onClick={() => { const reason = window.prompt('Close reason', 'Conversation completed'); if (reason !== null) action(`close-${room.roomId}`, () => api.request(`/api/private-rooms/${guildId}/rooms/${room.roomId}/close`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Room closed and transcript processed.'); }}>Close</button></div></div>)}</section>

    <section style={{ ...cardStyle, padding: 22 }}><h2 style={{ marginTop: 0 }}>Health</h2><p style={{ color: theme.mutedText }}>{health.checkedAt ? `Checked ${new Date(health.checkedAt).toLocaleString()}` : 'Health data unavailable.'}</p>{(health.issues || []).length === 0 && (health.warnings || []).length === 0 ? <p style={{ color: '#86efac', fontWeight: 900 }}>No Private Rooms health problems detected.</p> : <div style={{ display: 'grid', gap: 8 }}>{(health.issues || []).map((issue, i) => <div key={`i-${i}`} style={{ color: '#fca5a5' }}>Issue: {issue.code || String(issue)}</div>)}{(health.warnings || []).map((warning, i) => <div key={`w-${i}`} style={{ color: '#fde68a' }}>Warning: {warning.code || String(warning)}</div>)}</div>}</section>
  </div>;
}
