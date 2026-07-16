import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';

const ALERT_TYPES = ['live', 'upload', 'short', 'post'];
const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'kick', 'instagram', 'x'];
const TABS = [['overview', 'Overview'], ['creators', 'Accounts'], ['hub', 'Creator Hub'], ['studio', 'Alert Studio'], ['providers', 'Providers'], ['operations', 'Operations'], ['health', 'Health']];

function getGuildId(selectedGuild, selectedGuildData) { return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim(); }
function field(theme) { return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.35)', color: theme.cardText, borderRadius: 12, padding: 11, minHeight: 44, outline: 'none' }; }
function btn(theme, extra = {}) { return { border: `1px solid ${extra.border || theme.cardBorder}`, background: extra.background || 'rgba(15,23,42,.35)', color: extra.color || theme.cardText, borderRadius: 999, padding: '9px 13px', fontWeight: 900, cursor: extra.disabled ? 'not-allowed' : 'pointer', opacity: extra.disabled ? .55 : 1 }; }
function Card({ theme, children, style = {} }) { return <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 18, ...style }}>{children}</section>; }
function Stat({ theme, label, value, hint }) { return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14 }}><small style={{ color: theme.mutedText, fontWeight: 900 }}>{label}</small><div style={{ fontSize: 27, fontWeight: 950 }}>{value}</div><small style={{ color: theme.mutedText }}>{hint}</small></div>; }
function accountsOf(config) { return Array.isArray(config?.accounts) ? config.accounts : Object.values(config?.accounts || {}); }
function defaultAccount(account = {}) { return { platform: account.platform || 'twitch', displayName: account.displayName || '', username: account.username || account.url || '', alertChannelId: account.alertChannelId || '', mentionRoleId: account.mentionRoleId || '', mentionMode: account.mentionMode || 'none', alertTypes: account.alertTypes?.length ? account.alertTypes : ['live'], enabled: account.enabled !== false, metadata: { ...(account.metadata || {}), routing: { ...(account.metadata?.routing || {}) } } }; }
function defaultProfile(profile = {}) { return { creatorId: profile.creatorId || '', displayName: profile.displayName || '', group: profile.group || '', tags: (profile.tags || []).join(', '), notes: profile.notes || '', enabled: profile.enabled !== false, accountIds: profile.accountIds || [] }; }

export default function Social({ theme, selectedGuild, selectedGuildData }) {
  const navigate = useNavigate();
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [active, setActive] = useState('overview');
  const [config, setConfig] = useState({});
  const [overview, setOverview] = useState({});
  const [providers, setProviders] = useState([]);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [history, setHistory] = useState([]);
  const [queue, setQueue] = useState([]);
  const [health, setHealth] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [accountForm, setAccountForm] = useState(defaultAccount());
  const [profileForm, setProfileForm] = useState(defaultProfile());
  const [selectedCreatorId, setSelectedCreatorId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [simulationType, setSimulationType] = useState('live');
  const [simulation, setSimulation] = useState(null);
  const [templateType, setTemplateType] = useState('live');
  const [template, setTemplate] = useState({ title: '{creator} is now live', description: '{title}', buttonLabel: 'Watch now' });
  const [quiet, setQuiet] = useState({ enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const accounts = useMemo(() => accountsOf(config), [config]);
  const selectedProfile = profiles.find((item) => item.creatorId === selectedCreatorId) || null;
  const selectedAccount = accounts.find((item) => item.accountId === selectedAccountId) || null;

  async function load() {
    if (!guildId) return;
    setBusy(true); setError('');
    try {
      const [c, o, p, ch, r, h, q, hub] = await Promise.all([
        api.request(`/api/social/${guildId}`), api.request(`/api/social/${guildId}/overview`), api.request(`/api/social/${guildId}/providers`),
        api.request(`/api/discord/${guildId}/channels`), api.request(`/api/discord/${guildId}/roles`),
        api.request(`/api/social/${guildId}/history?limit=100`), api.request(`/api/social/${guildId}/queue?limit=100`), api.request(`/api/social/${guildId}/creator-hub`),
      ]);
      const next = c.config || {};
      setConfig(next); setOverview(o.overview || {}); setProviders(p.providers || []);
      setChannels(Array.isArray(ch) ? ch : ch.channels || []); setRoles(Array.isArray(r) ? r : r.roles || []);
      setHistory(h.history || []); setQueue(q.queue || []); setProfiles(hub.profiles || []);
      setQuiet({ enabled: false, start: '23:00', end: '08:00', timezone: 'Europe/London', ...(next.settings?.quietHours || {}) });
      setTemplate(next.templates?.[templateType] || template);
      if (!selectedCreatorId && hub.profiles?.[0]) setSelectedCreatorId(hub.profiles[0].creatorId);
      if (!selectedAccountId && accountsOf(next)[0]) setSelectedAccountId(accountsOf(next)[0].accountId);
    } catch (e) { setError(e.message || 'Failed to load Social Studio.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [guildId]);
  useEffect(() => { setTemplate(config.templates?.[templateType] || { title: '{creator} alert', description: '{title}', buttonLabel: 'Watch now' }); }, [templateType, config]);
  useEffect(() => { if (selectedProfile) setProfileForm(defaultProfile(selectedProfile)); }, [selectedCreatorId, profiles]);

  async function request(path, options = {}, success = 'Saved.') {
    setBusy(true); setMessage(''); setError('');
    try { const result = await api.request(path, options); setMessage(success); await load(); return result; }
    catch (e) { setError(e.message || 'Action failed.'); return null; }
    finally { setBusy(false); }
  }
  const channelOptions = <>{channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}</>;

  async function saveAccount(e) {
    e.preventDefault();
    await request(`/api/social/${guildId}/accounts`, { method: 'POST', body: JSON.stringify(accountForm) }, 'Creator account saved.');
    setAccountForm(defaultAccount());
  }
  async function saveProfile(e) {
    e.preventDefault();
    const payload = { ...profileForm, tags: profileForm.tags.split(',').map((v) => v.trim()).filter(Boolean) };
    const path = profileForm.creatorId ? `/api/social/${guildId}/creator-hub/${profileForm.creatorId}` : `/api/social/${guildId}/creator-hub`;
    const result = await request(path, { method: profileForm.creatorId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }, 'Creator profile saved.');
    if (result?.profile) setSelectedCreatorId(result.profile.creatorId);
  }
  async function simulate(send = false, force = false) {
    if (!selectedAccountId) return;
    setBusy(true); setError('');
    try {
      const result = await api.request(`/api/social/${guildId}/creator-hub/accounts/${selectedAccountId}/simulate`, { method: 'POST', body: JSON.stringify({ alertType: simulationType, send, force }) });
      setSimulation(result); setMessage(send && result.sent ? 'Simulation sent.' : 'Simulation preview ready.'); await load();
    } catch (e) { setError(e.message || 'Simulation failed.'); }
    finally { setBusy(false); }
  }

  if (!guildId) return <EmptyState theme={theme} icon="📣" title="Select a server" description="Select a server to open Social Studio." />;
  return <div style={{ display: 'grid', gap: 16 }}>
    <Card theme={theme} style={{ background: 'linear-gradient(135deg,rgba(37,99,235,.18),rgba(15,23,42,.08),rgba(236,72,153,.13))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}><button onClick={() => navigate('/modules')} style={btn(theme)}>Back to Modules</button><span style={{ color: theme.mutedText, fontWeight: 900 }}>Modules / Social Studio</span></div>
      <h1 style={{ marginBottom: 4 }}>Social Studio</h1><p style={{ color: theme.mutedText }}>Zero-credential creator monitoring, unified profiles, routing, simulation, operations and health.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{TABS.map(([id, label]) => <button key={id} onClick={() => { setActive(id); if (id === 'health') api.request(`/api/social/${guildId}/health`).then((x) => setHealth(x.health)).catch((e) => setError(e.message)); }} style={btn(theme, active === id ? { background: 'rgba(37,99,235,.28)', border: '#60a5fa' } : {})}>{label}</button>)}</div>
    </Card>
    {(error || message) && <Card theme={theme} style={{ padding: 12, color: error ? '#fca5a5' : '#86efac' }}>{error || message}</Card>}

    {active === 'overview' && <div style={{ display: 'grid', gap: 12 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}><Stat theme={theme} label="Profiles" value={overview.creatorHub?.total || profiles.length} hint="Unified creators" /><Stat theme={theme} label="Accounts" value={overview.accountCount || accounts.length} hint="Platform monitors" /><Stat theme={theme} label="Alerts" value={overview.analytics?.alertsSent || 0} hint="Delivered" /><Stat theme={theme} label="Queue" value={overview.queue?.total || queue.length} hint="Pending/retry" /><Stat theme={theme} label="History" value={overview.history?.total || history.length} hint="Operational events" /></div><Card theme={theme}><button onClick={() => setActive('hub')} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>Open Creator Hub</button> <button onClick={() => request(`/api/social/${guildId}/check`, { method: 'POST' }, 'All creators checked.')} style={btn(theme)}>Check All</button></Card></div>}

    {active === 'creators' && <div style={{ display: 'grid', gap: 12 }}><Card theme={theme}><h2>Add Platform Account</h2><form onSubmit={saveAccount} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}><select value={accountForm.platform} onChange={(e) => setAccountForm({ ...accountForm, platform: e.target.value })} style={field(theme)}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select><input required placeholder="Username, handle, channel ID or URL" value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })} style={field(theme)} /><input placeholder="Display name" value={accountForm.displayName} onChange={(e) => setAccountForm({ ...accountForm, displayName: e.target.value })} style={field(theme)} /><select value={accountForm.alertChannelId} onChange={(e) => setAccountForm({ ...accountForm, alertChannelId: e.target.value })} style={field(theme)}><option value="">Default channel</option>{channelOptions}</select><button disabled={busy} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>Save Account</button></form></Card><Card theme={theme}><h2>Platform Accounts</h2>{accounts.map((a) => <div key={a.accountId} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><strong>{a.displayName || a.username}</strong><div style={{ color: theme.mutedText }}>{a.platform} · {a.username || a.externalId}</div></div><div><button onClick={() => request(`/api/social/${guildId}/accounts/${a.accountId}/check`, { method: 'POST' }, 'Account checked.')} style={btn(theme)}>Check</button> <button onClick={() => { setSelectedAccountId(a.accountId); setActive('hub'); }} style={btn(theme)}>Open in Hub</button> <button onClick={() => window.confirm('Remove this account?') && request(`/api/social/${guildId}/accounts/${a.accountId}`, { method: 'DELETE' }, 'Account removed.')} style={btn(theme, { background: 'rgba(220,38,38,.2)' })}>Remove</button></div></div>)}</Card></div>}

    {active === 'hub' && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,.75fr) minmax(0,1.25fr)', gap: 12 }}><Card theme={theme}><h2>Creator Profiles</h2><button onClick={() => setProfileForm(defaultProfile())} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>New Profile</button> <button onClick={() => request(`/api/social/${guildId}/creator-hub/rebuild`, { method: 'POST' }, 'Profiles rebuilt from accounts.')} style={btn(theme)}>Rebuild</button><div style={{ marginTop: 12 }}>{profiles.map((p) => <button key={p.creatorId} onClick={() => setSelectedCreatorId(p.creatorId)} style={{ ...btn(theme, p.creatorId === selectedCreatorId ? { background: 'rgba(37,99,235,.25)', border: '#60a5fa' } : {}), width: '100%', marginBottom: 7, textAlign: 'left' }}>{p.displayName} · {p.accountIds.length} platform(s)</button>)}</div></Card><div style={{ display: 'grid', gap: 12 }}><Card theme={theme}><h2>{profileForm.creatorId ? 'Edit Creator Profile' : 'Create Creator Profile'}</h2><form onSubmit={saveProfile} style={{ display: 'grid', gap: 10 }}><input required placeholder="Creator display name" value={profileForm.displayName} onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })} style={field(theme)} /><input placeholder="Group" value={profileForm.group} onChange={(e) => setProfileForm({ ...profileForm, group: e.target.value })} style={field(theme)} /><input placeholder="Tags, comma separated" value={profileForm.tags} onChange={(e) => setProfileForm({ ...profileForm, tags: e.target.value })} style={field(theme)} /><textarea placeholder="Notes" rows={5} value={profileForm.notes} onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })} style={field(theme)} /><div><button disabled={busy} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>Save Profile</button>{selectedProfile && <button type="button" onClick={() => window.confirm('Delete this profile? Accounts remain configured.') && request(`/api/social/${guildId}/creator-hub/${selectedProfile.creatorId}`, { method: 'DELETE' }, 'Profile deleted.')} style={btn(theme, { background: 'rgba(220,38,38,.2)' })}>Delete Profile</button>}</div></form></Card><Card theme={theme}><h2>Linked Platforms & Simulator</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}><select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} style={field(theme)}><option value="">Select account</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.platform} · {a.displayName || a.username}</option>)}</select><select value={simulationType} onChange={(e) => setSimulationType(e.target.value)} style={field(theme)}>{ALERT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div><div style={{ marginTop: 10 }}><button disabled={!selectedProfile || !selectedAccount} onClick={() => request(`/api/social/${guildId}/creator-hub/${selectedProfile.creatorId}/accounts/${selectedAccount.accountId}`, { method: selectedProfile?.accountIds?.includes(selectedAccountId) ? 'DELETE' : 'POST' }, selectedProfile?.accountIds?.includes(selectedAccountId) ? 'Account unlinked.' : 'Account linked.')} style={btn(theme)}>{selectedProfile?.accountIds?.includes(selectedAccountId) ? 'Unlink Account' : 'Link Account'}</button> <button disabled={!selectedAccount} onClick={() => simulate(false)} style={btn(theme)}>Preview</button> <button disabled={!selectedAccount} onClick={() => simulate(true)} style={btn(theme, { background: 'rgba(37,99,235,.24)' })}>Send Simulation</button></div>{simulation?.preview && <div style={{ marginTop: 14, borderLeft: '4px solid #5865f2', padding: 12, background: 'rgba(15,23,42,.35)' }}><strong>{simulation.preview.title}</strong><p>{simulation.preview.description}</p><small>Route: {simulation.preview.channelId || 'not configured'} · Quiet hours: {simulation.preview.quietHours ? 'active' : 'inactive'}</small></div>}</Card></div></div>}

    {active === 'studio' && <Card theme={theme}><h2>Alert Studio</h2><div>{ALERT_TYPES.map((t) => <button key={t} onClick={() => setTemplateType(t)} style={btn(theme, t === templateType ? { background: 'rgba(37,99,235,.25)' } : {})}>{t}</button>)}</div><div style={{ display: 'grid', gap: 10, marginTop: 12 }}><input value={template.title || ''} onChange={(e) => setTemplate({ ...template, title: e.target.value })} style={field(theme)} /><textarea rows={6} value={template.description || ''} onChange={(e) => setTemplate({ ...template, description: e.target.value })} style={field(theme)} /><input value={template.buttonLabel || ''} onChange={(e) => setTemplate({ ...template, buttonLabel: e.target.value })} style={field(theme)} /><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ templates: { [templateType]: template } }) }, 'Template saved.')} style={btn(theme)}>Save Template</button></div></Card>}

    {active === 'providers' && <Card theme={theme}><h2>Provider Centre</h2><p style={{ color: theme.mutedText }}>Credentials are managed centrally by Goliath.</p>{providers.map((p) => <div key={p.id} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '12px 0' }}><strong>{p.label}</strong> · {p.status} · {(p.supportedAlertTypes || []).join(', ') || 'No supported alerts'}</div>)}</Card>}

    {active === 'operations' && <div style={{ display: 'grid', gap: 12 }}><Card theme={theme}><h2>Quiet Hours</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}><select value={quiet.enabled ? 'yes' : 'no'} onChange={(e) => setQuiet({ ...quiet, enabled: e.target.value === 'yes' })} style={field(theme)}><option value="no">Disabled</option><option value="yes">Enabled</option></select><input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} style={field(theme)} /><input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} style={field(theme)} /><input value={quiet.timezone || quiet.timeZone || 'Europe/London'} onChange={(e) => setQuiet({ ...quiet, timezone: e.target.value })} style={field(theme)} /></div><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ settings: { quietHours: quiet } }) }, 'Quiet hours saved.')} style={btn(theme)}>Save Quiet Hours</button></Card><Card theme={theme}><h2>Delivery Queue</h2><button onClick={() => request(`/api/social/${guildId}/queue/process`, { method: 'POST' }, 'Queue processed.')} style={btn(theme)}>Process</button>{queue.map((q) => <div key={q.id} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '10px 0' }}>{q.platform} · {q.alertType} · {q.status} <button onClick={() => request(`/api/social/${guildId}/queue/${q.id}/retry`, { method: 'POST' }, 'Retry scheduled.')} style={btn(theme)}>Retry</button></div>)}</Card><Card theme={theme}><h2>History</h2>{history.slice(0, 50).map((h) => <div key={h.id} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '10px 0' }}>{h.status} · {h.creator || h.accountId || 'System'} · {h.alertType}</div>)}</Card></div>}

    {active === 'health' && <Card theme={theme}><h2>Social Health</h2><button onClick={() => api.request(`/api/social/${guildId}/health`).then((x) => setHealth(x.health)).catch((e) => setError(e.message))} style={btn(theme)}>Refresh</button> <button onClick={() => request(`/api/social/${guildId}/repair`, { method: 'POST' }, 'Repair completed.')} style={btn(theme)}>Repair</button>{health ? <div><h3>{health.healthy ? 'Healthy' : 'Needs attention'}</h3>{(health.issues || []).map((i, n) => <div key={`${i.code}-${n}`}>{i.code}{i.accountId ? ` · ${i.accountId}` : ''}</div>)}</div> : <p style={{ color: theme.mutedText }}>Run a health check.</p>}</Card>}
  </div>;
}
