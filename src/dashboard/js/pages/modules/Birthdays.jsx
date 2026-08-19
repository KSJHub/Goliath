import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buttonStyle(theme, tone = 'default') {
  const backgrounds = {
    primary: 'rgba(37,99,235,0.22)',
    success: 'rgba(22,163,74,0.22)',
    danger: 'rgba(220,38,38,0.22)',
    default: 'rgba(15,23,42,0.45)',
  };
  return { border: `1px solid ${theme.cardBorder}`, background: backgrounds[tone] || backgrounds.default, color: theme.cardText, borderRadius: 14, padding: '11px 14px', fontWeight: 950, cursor: 'pointer' };
}

function fieldStyle(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.45)', color: theme.cardText, borderRadius: 12, padding: '11px 12px', width: '100%' };
}

function StatCard({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.34)', borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, color: theme.cardText }}>{value}</div>{hint ? <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}</div>;
}

function formatBirthday(item) {
  return `${String(item.day).padStart(2, '0')}/${String(item.month).padStart(2, '0')}${item.year ? `/${item.year}` : ''}`;
}

export default function Birthdays({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [saving, setSaving] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const settings = config?.settings || {};
  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const upcoming = overview.upcoming || [];
  const members = overview.members || [];
  const cardStyle = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow }), [theme]);

  async function loadResources() {
    const [rolePayload, channelPayload] = await Promise.all([api.getGuildRoles(guildId), api.getGuildChannels(guildId)]);
    let roleList = normalizeList(rolePayload, 'roles');
    let channelList = normalizeList(channelPayload, 'channels');
    if (!roleList.length || !channelList.length) {
      const synced = await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' });
      if (!roleList.length) roleList = normalizeList(synced, 'roles');
      if (!channelList.length) channelList = normalizeList(synced, 'channels');
    }
    return [roleList, channelList];
  }

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [payload, resources] = await Promise.all([api.request(`/api/birthdays/${guildId}/overview`), loadResources()]);
      setConfig(payload.config || {});
      setOverview(payload.overview || {});
      setRoles(resources[0]);
      setChannels(resources[1]);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Birthdays dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function runAction(name, fn, message) {
    setSaving(name); setError(''); setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config);
      if (result?.overview) setOverview(result.overview);
      if (message) setNotice(message);
      await load();
      return result;
    } catch (actionError) {
      setError(actionError.message || 'Birthdays action failed.');
      return null;
    } finally { setSaving(''); }
  }

  async function saveSettings(patch, message = 'Birthday settings saved.') {
    return runAction('settings', () => api.request(`/api/birthdays/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: patch }) }), message);
  }

  async function removeMember(userId) {
    if (!window.confirm('Remove this birthday record?')) return;
    await runAction(`remove-${userId}`, () => api.request(`/api/birthdays/${guildId}/members/${userId}`, { method: 'DELETE' }), 'Birthday record removed.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="🎂" title="Select a server" description="Select a server to manage Birthdays." />;

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(236,72,153,0.16), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.12))' }}>
      <p style={{ margin: '0 0 8px', color: '#f9a8d4', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Community</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Birthdays</h1>
      <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 860 }}>Manage birthday announcements, timezone-aware delivery, optional birthday roles, upcoming dates and stored member preferences.</p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }}>
      <StatCard theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} hint={loading ? 'Loading...' : `${members.length} stored`} />
      <StatCard theme={theme} label="Upcoming" value={upcoming.length} hint="Next 60 days" />
      <StatCard theme={theme} label="Announcements" value={analytics.announcementsSent || 0} />
      <StatCard theme={theme} label="Roles Assigned" value={analytics.rolesAssigned || 0} />
      <StatCard theme={theme} label="Failures" value={analytics.failures || 0} />
      <StatCard theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.issues?.length || 0} issue(s) · ${health?.warnings?.length || 0} warning(s)`} />
    </section>

    {(error || notice) ? <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Runtime state, scheduler processing, health and configuration export.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => runAction('enabled', () => api.request(`/api/birthdays/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !(overview.enabled || config?.enabled) }) }), 'Module status updated.')} disabled={saving} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
          <button type="button" onClick={() => runAction('process', () => api.request(`/api/birthdays/${guildId}/process`, { method: 'POST' }), 'Birthday scheduler processed.')} disabled={saving} style={buttonStyle(theme, 'success')}>Process Now</button>
          <a href={`/api/birthdays/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
        </div>
      </div>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
      <div><h2 style={{ margin: 0 }}>Announcement & Role Settings</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>All values write directly to the canonical Birthdays module section.</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <ChannelSelect theme={theme} resources={channels} value={settings.announcementChannelId || ''} onChange={(announcementChannelId) => saveSettings({ announcementChannelId: announcementChannelId || null })} label="Announcement Channel" disabled={channels.length === 0} />
        <RoleSelect theme={theme} resources={roles} value={settings.birthdayRoleId || ''} onChange={(birthdayRoleId) => saveSettings({ birthdayRoleId: birthdayRoleId || null })} label="Birthday Role" disabled={roles.length === 0} />
        <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Announcement time<input value={settings.announcementTime || '09:00'} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), announcementTime: event.target.value } }))} onBlur={(event) => saveSettings({ announcementTime: event.target.value })} style={fieldStyle(theme)} /></label>
        <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Timezone<input value={settings.timezone || 'UTC'} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), timezone: event.target.value } }))} onBlur={(event) => saveSettings({ timezone: event.target.value })} placeholder="Europe/London" style={fieldStyle(theme)} /></label>
        <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Role duration (hours)<input type="number" min="1" max="168" value={settings.roleDurationHours || 24} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), roleDurationHours: Number(event.target.value) } }))} onBlur={(event) => saveSettings({ roleDurationHours: Number(event.target.value) })} style={fieldStyle(theme)} /></label>
        <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Leap-day handling<select value={settings.leapDayMode || 'feb28'} onChange={(event) => saveSettings({ leapDayMode: event.target.value })} style={fieldStyle(theme)}><option value="feb28">Celebrate on 28 February</option><option value="mar1">Celebrate on 1 March</option></select></label>
      </div>
      <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Birthday message<textarea rows={4} value={settings.messageTemplate || ''} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), messageTemplate: event.target.value } }))} onBlur={(event) => saveSettings({ messageTemplate: event.target.value })} style={{ ...fieldStyle(theme), resize: 'vertical' }} /><span style={{ fontSize: 12, fontWeight: 700 }}>Placeholders: {'{mention}'} · {'{user}'} · {'{server}'} · {'{age}'}</span></label>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={settings.announceByDefault !== false} onChange={(event) => saveSettings({ announceByDefault: event.target.checked })} /> Announce birthdays by default</label>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={settings.showAgeByDefault === true} onChange={(event) => saveSettings({ showAgeByDefault: event.target.checked })} /> Show age by default</label>
      </div>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>Upcoming Birthdays</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Publicly enabled birthdays in the next 60 days.</p></div>
      {upcoming.length ? <div style={{ display: 'grid', gap: 10 }}>{upcoming.slice(0, 20).map((item) => <div key={item.userId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.displayName || item.userId}</strong><div style={{ marginTop: 4, color: theme.mutedText, fontSize: 13 }}>{formatBirthday(item)} · {item.daysUntil === 0 ? 'Today' : `${item.daysUntil} day(s)`}</div></div><div style={{ color: theme.mutedText, fontSize: 13 }}>{item.showAge && item.year ? 'Age shown' : 'Age hidden'}</div></div>)}</div> : <div style={{ color: theme.mutedText }}>No upcoming birthdays in the next 60 days.</div>}
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
      <div><h2 style={{ margin: 0 }}>Stored Birthday Records</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Member self-service remains available in Discord; this view gives admins visibility and removal controls.</p></div>
      {members.length ? <div style={{ display: 'grid', gap: 10 }}>{members.map((item) => <div key={item.userId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><div><strong>{item.displayName || item.userId}</strong><div style={{ marginTop: 4, color: theme.mutedText, fontSize: 13 }}>{formatBirthday(item)} · Announcement {item.announce ? 'On' : 'Off'} · Age {item.showAge && item.year ? 'On' : 'Off'}</div></div><button type="button" onClick={() => removeMember(item.userId)} disabled={saving} style={buttonStyle(theme, 'danger')}>Remove</button></div>)}</div> : <div style={{ color: theme.mutedText }}>No birthday records stored yet.</div>}
    </section>

    <section style={{ ...cardStyle, padding: 22 }}>
      <h2 style={{ marginTop: 0 }}>Health</h2>
      <p style={{ color: theme.mutedText }}>Status: <strong style={{ color: theme.cardText }}>{health?.healthy ? 'Healthy' : 'Needs attention'}</strong></p>
      {(health?.issues || []).map((issue, index) => <div key={`issue-${index}`} style={{ color: '#fca5a5', marginTop: 8 }}>• {issue.code || String(issue)}</div>)}
      {(health?.warnings || []).map((warning, index) => <div key={`warning-${index}`} style={{ color: '#fde68a', marginTop: 8 }}>• {warning.code || String(warning)}</div>)}
      {!health?.issues?.length && !health?.warnings?.length ? <div style={{ color: '#86efac' }}>No Birthday health issues detected.</div> : null}
    </section>
  </div>;
}
