import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';

const ALERT_TYPES = ['live', 'upload', 'short', 'post'];
const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'kick', 'facebook', 'instagram', 'x'];

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}
function field(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.35)', color: theme.cardText, borderRadius: 12, padding: 11, minHeight: 44, outline: 'none', width: '100%' };
}
function btn(theme, extra = {}) {
  return { border: `1px solid ${extra.border || theme.cardBorder}`, background: extra.background || 'rgba(15,23,42,.35)', color: extra.color || theme.cardText, borderRadius: 999, padding: '9px 13px', fontWeight: 900, cursor: extra.disabled ? 'not-allowed' : 'pointer', opacity: extra.disabled ? .55 : 1 };
}
function Card({ theme, children, style = {} }) {
  return <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 18, ...style }}>{children}</section>;
}
function Stat({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14 }}><small style={{ color: theme.mutedText, fontWeight: 900 }}>{label}</small><div style={{ fontSize: 27, fontWeight: 950 }}>{value}</div><small style={{ color: theme.mutedText }}>{hint}</small></div>;
}
function MenuButton({ theme, icon, title, description, onClick }) {
  return <button type="button" onClick={onClick} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.28)', color: theme.cardText, borderRadius: 18, padding: 18, minHeight: 118, textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 7 }}><span style={{ fontSize: 28 }}>{icon}</span><strong style={{ fontSize: 17 }}>{title}</strong><small style={{ color: theme.mutedText, lineHeight: 1.45 }}>{description}</small></button>;
}
function NavRow({ theme, onBack, onSettings, onNext, nextDisabled = true, settingsActive = false }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10 }}><button type="button" onClick={onBack} style={{ ...btn(theme), justifySelf: 'start' }}>◀ Back</button><button type="button" onClick={onSettings} style={btn(theme, settingsActive ? { background: 'rgba(37,99,235,.28)', border: '#60a5fa' } : {})}>⚙️ Settings</button><button type="button" disabled={nextDisabled} onClick={onNext} style={{ ...btn(theme, { disabled: nextDisabled }), justifySelf: 'end' }}>Next ▶</button></div>;
}
function accountsOf(config) {
  return Array.isArray(config?.accounts) ? config.accounts : Object.values(config?.accounts || {});
}
function defaultAccount(account = {}) {
  return { accountId: account.accountId || '', platform: account.platform || 'twitch', displayName: account.displayName || '', username: account.username || account.url || '', alertChannelId: account.alertChannelId || '', mentionRoleId: account.mentionRoleId || '', mentionMode: account.mentionMode || 'none', alertTypes: account.alertTypes?.length ? account.alertTypes : ['live'], enabled: account.enabled !== false, metadata: account.metadata || {} };
}
function defaultProfile(profile = {}) {
  return { creatorId: profile.creatorId || '', displayName: profile.displayName || '', group: profile.group || '', tags: (profile.tags || []).join(', '), notes: profile.notes || '', enabled: profile.enabled !== false, accountIds: profile.accountIds || [] };
}
function defaultOperations(settings = {}) {
  return { retryDeliveries: settings.retryDeliveries !== false, maxDeliveryAttempts: Number(settings.maxDeliveryAttempts || 5), suppressDuplicates: settings.suppressDuplicates !== false, editLiveNotifications: settings.editLiveNotifications !== false, deleteEndedNotifications: settings.deleteEndedNotifications !== false, includeViewerCount: settings.includeViewerCount !== false, includeLiveDuration: settings.includeLiveDuration !== false, thumbnailPreference: settings.thumbnailPreference || 'stream' };
}
function Toggle({ theme, label, checked, onChange, hint }) {
  return <label style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 5 }}><span style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 900 }}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</span>{hint && <small style={{ color: theme.mutedText }}>{hint}</small>}</label>;
}

export default function Social({ theme, selectedGuild, selectedGuildData }) {
  const navigate = useNavigate();
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [panel, setPanel] = useState('home');
  const [config, setConfig] = useState({});
  const [overview, setOverview] = useState({});
  const [channels, setChannels] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [accountForm, setAccountForm] = useState(defaultAccount());
  const [profileForm, setProfileForm] = useState(defaultProfile());
  const [selectedCreatorId, setSelectedCreatorId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [simulationType, setSimulationType] = useState('live');
  const [simulation, setSimulation] = useState(null);
  const [templateType, setTemplateType] = useState('live');
  const [template, setTemplate] = useState({ title: '{creator} is now live', description: '{title}', buttonLabel: 'Watch now' });
  const [operations, setOperations] = useState(defaultOperations());
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
      const [c, o, ch, hub] = await Promise.all([
        api.request(`/api/social/${guildId}`),
        api.request(`/api/social/${guildId}/overview`),
        api.request(`/api/discord/${guildId}/channels`),
        api.request(`/api/social/${guildId}/creator-hub`),
      ]);
      const next = c.config || {};
      const nextProfiles = hub.creators || hub.profiles || [];
      setConfig(next); setOverview(o.overview || {}); setChannels(Array.isArray(ch) ? ch : ch.channels || []); setProfiles(nextProfiles); setOperations(defaultOperations(next.settings || {}));
      if (!selectedCreatorId && nextProfiles[0]) setSelectedCreatorId(nextProfiles[0].creatorId);
      if (!selectedAccountId && accountsOf(next)[0]) setSelectedAccountId(accountsOf(next)[0].accountId);
    } catch (loadError) { setError(loadError.message || 'Failed to load Social Studio.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { load(); }, [guildId]);
  useEffect(() => { setTemplate(config.templates?.[templateType] || { title: '{creator} alert', description: '{title}', buttonLabel: 'Watch now' }); }, [templateType, config]);
  useEffect(() => { if (selectedProfile) setProfileForm(defaultProfile(selectedProfile)); }, [selectedCreatorId, profiles]);
  useEffect(() => { if (selectedAccount) setAccountForm(defaultAccount(selectedAccount)); }, [selectedAccountId, config]);

  async function request(path, options = {}, success = 'Saved.') {
    setBusy(true); setMessage(''); setError('');
    try { const result = await api.request(path, options); setMessage(success); await load(); return result; }
    catch (requestError) { setError(requestError.message || 'Action failed.'); return null; }
    finally { setBusy(false); }
  }
  async function saveAccount(event) {
    event.preventDefault();
    const editing = Boolean(accountForm.accountId);
    if (editing) {
      const nextAccounts = { ...(config.accounts || {}), [accountForm.accountId]: accountForm };
      await request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ accounts: nextAccounts }) }, 'Account updated.');
    } else {
      await request(`/api/social/${guildId}/accounts`, { method: 'POST', body: JSON.stringify(accountForm) }, 'Account added.');
    }
    if (!editing) setAccountForm(defaultAccount());
  }
  async function saveProfile(event) {
    event.preventDefault();
    const payload = { ...profileForm, tags: profileForm.tags.split(',').map((value) => value.trim()).filter(Boolean) };
    const editing = Boolean(profileForm.creatorId);
    await request(editing ? `/api/social/${guildId}/creator-hub/${profileForm.creatorId}` : `/api/social/${guildId}/creator-hub`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }, 'Creator profile saved.');
  }
  async function simulate(send = false) {
    if (!selectedAccountId) return;
    const result = await request(`/api/social/${guildId}/creator-hub/accounts/${selectedAccountId}/simulate`, { method: 'POST', body: JSON.stringify({ alertType: simulationType, send }) }, send ? 'Test notification sent.' : 'Preview ready.');
    if (result) setSimulation(result);
  }
  async function saveSettings() {
    await request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ settings: operations }) }, 'Automation settings saved.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="📣" title="Select a server" description="Select a server to open Social Studio." />;

  const channelOptions = channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>);
  const goBack = () => panel === 'home' ? navigate('/modules') : setPanel('home');
  const openSettings = () => setPanel(panel === 'settings' ? 'home' : 'settings');

  return <div style={{ display: 'grid', gap: 16 }}>
    <Card theme={theme} style={{ background: 'linear-gradient(135deg,rgba(37,99,235,.18),rgba(15,23,42,.08),rgba(236,72,153,.13))' }}>
      <div style={{ color: theme.mutedText, fontWeight: 900 }}>Modules / Social Studio{panel !== 'home' ? ` / ${panel.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}` : ''}</div>
      <h1 style={{ marginBottom: 4 }}>📣 Social Studio</h1>
      <p style={{ color: theme.mutedText, marginBottom: 0 }}>Manage creator profiles, connected accounts, notifications, templates, feeds and Discord channels.</p>
    </Card>
    {(error || message) && <Card theme={theme} style={{ padding: 12, color: error ? '#fca5a5' : '#86efac' }}>{error || message}</Card>}

    {panel === 'home' && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
        <Stat theme={theme} label="Creator Profiles" value={profiles.length} hint="Managed creators" />
        <Stat theme={theme} label="Linked Accounts" value={overview.accountCount || accounts.length} hint="Platform accounts" />
        <Stat theme={theme} label="Enabled Accounts" value={overview.enabledAccountCount || 0} hint="Currently monitored" />
        <Stat theme={theme} label="Module" value={config.enabled ? 'On' : 'Off'} hint="Guild status" />
      </div>
      <Card theme={theme}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <MenuButton theme={theme} icon="👥" title="Creator Profiles" description="Create and manage unified creator profiles." onClick={() => setPanel('creators')} />
        <MenuButton theme={theme} icon="🔗" title="Accounts" description="Connect Twitch, YouTube, TikTok, Kick and other accounts." onClick={() => { setAccountForm(defaultAccount()); setPanel('accounts'); }} />
        <MenuButton theme={theme} icon="📢" title="Notifications" description="Choose alert types, channels and role mentions per account." onClick={() => setPanel('notifications')} />
        <MenuButton theme={theme} icon="🎨" title="Templates" description="Design the message used for each notification type." onClick={() => setPanel('templates')} />
        <MenuButton theme={theme} icon="📡" title="Feeds" description="Set the default feed channel and enable Social Studio." onClick={() => setPanel('feeds')} />
        <MenuButton theme={theme} icon="📂" title="Channels" description="Review and configure Discord delivery channels." onClick={() => setPanel('channels')} />
      </div></Card>
    </>}

    {panel === 'creators' && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,.8fr) minmax(0,1.2fr)', gap: 12 }}>
      <Card theme={theme}><h2>Creator Profiles</h2><button onClick={() => { setSelectedCreatorId(''); setProfileForm(defaultProfile()); }} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>New Creator</button><div style={{ marginTop: 12 }}>{profiles.map((profile) => <button key={profile.creatorId} onClick={() => setSelectedCreatorId(profile.creatorId)} style={{ ...btn(theme, profile.creatorId === selectedCreatorId ? { background: 'rgba(37,99,235,.25)', border: '#60a5fa' } : {}), width: '100%', marginBottom: 7, textAlign: 'left' }}>{profile.displayName} · {profile.accountIds?.length || 0} account(s)</button>)}</div></Card>
      <Card theme={theme}><h2>{profileForm.creatorId ? 'Edit Creator' : 'Create Creator'}</h2><form onSubmit={saveProfile} style={{ display: 'grid', gap: 10 }}><input required placeholder="Creator display name" value={profileForm.displayName} onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })} style={field(theme)} /><input placeholder="Group" value={profileForm.group} onChange={(e) => setProfileForm({ ...profileForm, group: e.target.value })} style={field(theme)} /><input placeholder="Tags, comma separated" value={profileForm.tags} onChange={(e) => setProfileForm({ ...profileForm, tags: e.target.value })} style={field(theme)} /><textarea rows={5} placeholder="Notes" value={profileForm.notes} onChange={(e) => setProfileForm({ ...profileForm, notes: e.target.value })} style={field(theme)} /><button disabled={busy} style={btn(theme, { background: 'rgba(22,163,74,.23)', disabled: busy })}>Save Creator</button></form>{profileForm.creatorId && <button onClick={() => window.confirm('Delete this creator profile?') && request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ creators: Object.fromEntries(Object.entries(config.creators || {}).filter(([id]) => id !== profileForm.creatorId)) }) }, 'Creator deleted.')} style={{ ...btn(theme, { background: 'rgba(220,38,38,.2)' }), marginTop: 10 }}>Delete Creator</button>}</Card>
    </div>}

    {panel === 'accounts' && <div style={{ display: 'grid', gap: 12 }}><Card theme={theme}><h2>{accountForm.accountId ? 'Edit Account' : 'Add Platform Account'}</h2><form onSubmit={saveAccount} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}><select value={accountForm.platform} onChange={(e) => setAccountForm({ ...accountForm, platform: e.target.value })} style={field(theme)}>{PLATFORMS.map((platform) => <option key={platform}>{platform}</option>)}</select><input required placeholder="Username, channel ID or URL" value={accountForm.username} onChange={(e) => setAccountForm({ ...accountForm, username: e.target.value })} style={field(theme)} /><input placeholder="Display name" value={accountForm.displayName} onChange={(e) => setAccountForm({ ...accountForm, displayName: e.target.value })} style={field(theme)} /><button disabled={busy} style={btn(theme, { background: 'rgba(22,163,74,.23)', disabled: busy })}>{accountForm.accountId ? 'Update Account' : 'Add Account'}</button></form></Card><Card theme={theme}><h2>Connected Accounts</h2>{accounts.length === 0 && <p style={{ color: theme.mutedText }}>No accounts connected yet.</p>}{accounts.map((account) => <div key={account.accountId} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><strong>{account.displayName || account.username}</strong><div style={{ color: theme.mutedText }}>{account.platform} · {account.username}</div></div><div><button onClick={() => { setSelectedAccountId(account.accountId); setAccountForm(defaultAccount(account)); }} style={btn(theme)}>Edit</button> <button onClick={() => request(`/api/social/${guildId}/accounts/${account.accountId}/check`, { method: 'POST' }, 'Account checked.')} style={btn(theme)}>Check</button> <button onClick={() => window.confirm('Remove this account?') && request(`/api/social/${guildId}/accounts/${account.accountId}`, { method: 'DELETE' }, 'Account removed.')} style={btn(theme, { background: 'rgba(220,38,38,.2)' })}>Remove</button></div></div>)}</Card></div>}

    {panel === 'notifications' && <Card theme={theme}><h2>Notification Routing</h2><select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} style={field(theme)}><option value="">Select account</option>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.platform} · {account.displayName || account.username}</option>)}</select>{selectedAccount && <form onSubmit={saveAccount} style={{ display: 'grid', gap: 12, marginTop: 12 }}><select value={accountForm.alertChannelId} onChange={(e) => setAccountForm({ ...accountForm, alertChannelId: e.target.value })} style={field(theme)}><option value="">Use default feed channel</option>{channelOptions}</select><select value={accountForm.mentionMode} onChange={(e) => setAccountForm({ ...accountForm, mentionMode: e.target.value })} style={field(theme)}><option value="none">No mention</option><option value="role">Mention role</option><option value="everyone">@everyone</option><option value="here">@here</option></select>{accountForm.mentionMode === 'role' && <input placeholder="Discord role ID" value={accountForm.mentionRoleId} onChange={(e) => setAccountForm({ ...accountForm, mentionRoleId: e.target.value })} style={field(theme)} />}<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>{ALERT_TYPES.map((type) => <Toggle key={type} theme={theme} label={type[0].toUpperCase() + type.slice(1)} checked={accountForm.alertTypes.includes(type)} onChange={(checked) => setAccountForm({ ...accountForm, alertTypes: checked ? [...new Set([...accountForm.alertTypes, type])] : accountForm.alertTypes.filter((item) => item !== type) })} />)}</div><Toggle theme={theme} label="Notifications enabled" checked={accountForm.enabled} onChange={(value) => setAccountForm({ ...accountForm, enabled: value })} /><button disabled={busy} style={btn(theme, { background: 'rgba(22,163,74,.23)', disabled: busy })}>Save Notifications</button></form>}</Card>}

    {panel === 'templates' && <Card theme={theme}><h2>Notification Templates</h2><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{ALERT_TYPES.map((type) => <button key={type} onClick={() => setTemplateType(type)} style={btn(theme, type === templateType ? { background: 'rgba(37,99,235,.25)', border: '#60a5fa' } : {})}>{type}</button>)}</div><div style={{ display: 'grid', gap: 10, marginTop: 12 }}><input value={template.title || ''} onChange={(e) => setTemplate({ ...template, title: e.target.value })} style={field(theme)} /><textarea rows={6} value={template.description || ''} onChange={(e) => setTemplate({ ...template, description: e.target.value })} style={field(theme)} /><input value={template.buttonLabel || ''} onChange={(e) => setTemplate({ ...template, buttonLabel: e.target.value })} style={field(theme)} /><small style={{ color: theme.mutedText }}>Variables: {'{creator}'} {'{title}'} {'{platform}'} {'{url}'}</small><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ templates: { [templateType]: template } }) }, 'Template saved.')} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>Save Template</button></div></Card>}

    {panel === 'feeds' && <Card theme={theme}><h2>Feeds</h2><p style={{ color: theme.mutedText }}>The default feed is used whenever an account does not have its own notification channel.</p><div style={{ display: 'grid', gap: 12 }}><Toggle theme={theme} label="Enable Social Studio" checked={config.enabled === true} onChange={(enabled) => setConfig({ ...config, enabled })} /><select value={config.alertsChannelId || ''} onChange={(e) => setConfig({ ...config, alertsChannelId: e.target.value })} style={field(theme)}><option value="">Select default feed channel</option>{channelOptions}</select><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ enabled: config.enabled === true, alertsChannelId: config.alertsChannelId || null }) }, 'Feed settings saved.')} style={btn(theme, { background: 'rgba(22,163,74,.23)' })}>Save Feed</button></div></Card>}

    {panel === 'channels' && <Card theme={theme}><h2>Discord Channels</h2><p style={{ color: theme.mutedText }}>Choose the default delivery channel here, or override it per account under Notifications.</p><select value={config.alertsChannelId || ''} onChange={(e) => setConfig({ ...config, alertsChannelId: e.target.value })} style={field(theme)}><option value="">No default channel</option>{channelOptions}</select><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ alertsChannelId: config.alertsChannelId || null }) }, 'Channel saved.')} style={{ ...btn(theme, { background: 'rgba(22,163,74,.23)' }), marginTop: 12 }}>Save Channel</button></Card>}

    {panel === 'settings' && <Card theme={theme}><h2>⚙️ Social Studio Settings</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}><MenuButton theme={theme} icon="🔐" title="Permissions" description="Set which Discord roles can manage Social Studio." onClick={() => setPanel('permissions')} /><MenuButton theme={theme} icon="👥" title="Roles" description="Configure Social Studio manager roles for this guild." onClick={() => setPanel('roles')} /><MenuButton theme={theme} icon="⚡" title="Automation" description="Control retries, duplicate protection and live message behaviour." onClick={() => setPanel('automation')} /><MenuButton theme={theme} icon="🧪" title="Testing" description="Preview and send safe test notifications." onClick={() => setPanel('testing')} /><MenuButton theme={theme} icon="🗄️" title="Data" description="Refresh or rebuild creator data for this guild." onClick={() => setPanel('data')} /></div></Card>}

    {(panel === 'permissions' || panel === 'roles') && <Card theme={theme}><h2>{panel === 'permissions' ? '🔐 Permissions' : '👥 Roles'}</h2><p style={{ color: theme.mutedText }}>Add Discord role IDs that may manage Social Studio for this server.</p><textarea rows={5} value={(config.managerRoleIds || []).join('\n')} onChange={(e) => setConfig({ ...config, managerRoleIds: e.target.value.split(/\s+/).filter(Boolean) })} style={field(theme)} /><button onClick={() => request(`/api/social/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ managerRoleIds: config.managerRoleIds || [] }) }, 'Manager roles saved.')} style={{ ...btn(theme, { background: 'rgba(22,163,74,.23)' }), marginTop: 12 }}>Save Roles</button></Card>}

    {panel === 'automation' && <Card theme={theme}><h2>⚡ Automation</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}><Toggle theme={theme} label="Retry failed deliveries" checked={operations.retryDeliveries} onChange={(value) => setOperations({ ...operations, retryDeliveries: value })} /><Toggle theme={theme} label="Suppress duplicate alerts" checked={operations.suppressDuplicates} onChange={(value) => setOperations({ ...operations, suppressDuplicates: value })} /><Toggle theme={theme} label="Edit active live messages" checked={operations.editLiveNotifications} onChange={(value) => setOperations({ ...operations, editLiveNotifications: value })} /><Toggle theme={theme} label="Delete messages when streams end" checked={operations.deleteEndedNotifications} onChange={(value) => setOperations({ ...operations, deleteEndedNotifications: value })} /><Toggle theme={theme} label="Show viewer count" checked={operations.includeViewerCount} onChange={(value) => setOperations({ ...operations, includeViewerCount: value })} /><Toggle theme={theme} label="Show live duration" checked={operations.includeLiveDuration} onChange={(value) => setOperations({ ...operations, includeLiveDuration: value })} /></div><label style={{ display: 'grid', gap: 5, marginTop: 12 }}>Maximum delivery attempts<input type="number" min="1" max="25" value={operations.maxDeliveryAttempts} onChange={(e) => setOperations({ ...operations, maxDeliveryAttempts: Number(e.target.value) })} style={field(theme)} /></label><label style={{ display: 'grid', gap: 5, marginTop: 12 }}>Thumbnail preference<select value={operations.thumbnailPreference} onChange={(e) => setOperations({ ...operations, thumbnailPreference: e.target.value })} style={field(theme)}><option value="stream">Stream thumbnail</option><option value="creator">Creator avatar</option><option value="none">No thumbnail</option></select></label><button onClick={saveSettings} style={{ ...btn(theme, { background: 'rgba(22,163,74,.23)' }), marginTop: 12 }}>Save Automation</button></Card>}

    {panel === 'testing' && <Card theme={theme}><h2>🧪 Testing</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}><select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} style={field(theme)}><option value="">Select account</option>{accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.platform} · {account.displayName || account.username}</option>)}</select><select value={simulationType} onChange={(e) => setSimulationType(e.target.value)} style={field(theme)}>{ALERT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div><div style={{ marginTop: 10 }}><button disabled={!selectedAccount} onClick={() => simulate(false)} style={btn(theme, { disabled: !selectedAccount })}>Preview</button> <button disabled={!selectedAccount} onClick={() => simulate(true)} style={btn(theme, { background: 'rgba(37,99,235,.24)', disabled: !selectedAccount })}>Send Test</button></div>{simulation?.preview && <div style={{ marginTop: 14, borderLeft: '4px solid #5865f2', padding: 12, background: 'rgba(15,23,42,.35)' }}><strong>{simulation.preview.title}</strong><p>{simulation.preview.description}</p><small>{simulation.preview.buttonLabel}</small></div>}</Card>}

    {panel === 'data' && <Card theme={theme}><h2>🗄️ Data</h2><p style={{ color: theme.mutedText }}>Refresh current data or rebuild missing creator profiles from connected accounts.</p><button onClick={load} disabled={busy} style={btn(theme, { disabled: busy })}>Refresh Data</button> <button onClick={() => request(`/api/social/${guildId}/creator-hub/rebuild`, { method: 'POST' }, 'Creator profiles rebuilt.')} style={btn(theme)}>Rebuild Profiles</button></Card>}

    <Card theme={theme} style={{ padding: 12 }}><NavRow theme={theme} onBack={goBack} onSettings={openSettings} onNext={() => {}} settingsActive={panel === 'settings'} /></Card>
  </div>;
}
