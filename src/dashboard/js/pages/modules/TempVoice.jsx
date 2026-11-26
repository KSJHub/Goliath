import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import PageShell, { EmptyState, LoadingPanel, Notice, PrimaryButton, StatGrid, SummaryStat, DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import TempVoiceControlCentre from './tempvoice/TempVoiceControlCentre.jsx';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function Card({ theme, children }) {
  return <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow, padding: 18 }}>{children}</section>;
}

function fieldStyle(theme) {
  return { width: '100%', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.9)', color: theme.cardText, borderRadius: 12, padding: '12px 13px', outline: 'none', fontWeight: 850 };
}

function Toggle({ checked, onChange, disabled }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} style={{ border: checked ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(239,68,68,0.45)', background: checked ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)', color: checked ? '#86efac' : '#fca5a5', borderRadius: 999, padding: '9px 13px', fontWeight: 950, cursor: disabled ? 'not-allowed' : 'pointer' }}>{checked ? 'Enabled' : 'Disabled'}</button>;
}

function ChannelSelect({ theme, label, value, onChange, channels, empty = 'Select channel' }) {
  return <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>{label}<ThemedSelect theme={theme} value={value || ''} onChange={(event) => onChange(event.target.value)} style={fieldStyle(theme)}><option value="">{empty}</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type === 4 ? E.FOLDER : E.VOICE} {channel.name}</option>)}</ThemedSelect></label>;
}

function Check({ checked, onChange, label, theme }) {
  return <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

const defaultHub = { joinChannelId: '', joinChannelName: `${E.ADD} Create Temp Voice`, categoryId: '', categoryName: 'Temporary Voice Channels', nameTemplate: "{username}'s Channel", userLimit: 0, bitrate: 0, enabled: true, createCategory: true, lockedByDefault: false, hiddenByDefault: false, ownerControlsEnabled: true };

export default function TempVoice({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [config, setConfig] = useState(null);
  const [variables, setVariables] = useState([]);
  const [overview, setOverview] = useState(null);
  const [hubDraft, setHubDraft] = useState(defaultHub);
  const [settingsDraft, setSettingsDraft] = useState({ defaultUserLimit: 0, deleteWhenEmpty: true, ownerPanelEnabled: true, allowOwnerRename: true, allowOwnerStatus: true, allowOwnerLock: true, allowOwnerHide: true, allowOwnerLimit: true, allowOwnerPermits: true, allowOwnerTransfer: true, allowOwnerDelete: true });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hubs = useMemo(() => Object.values(config?.hubs || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), [config]);
  const trackedChannels = useMemo(() => Object.values(config?.channels || {}).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [config]);
  const analytics = overview?.analytics || {};
  const activity = Array.isArray(overview?.activity) ? overview.activity : [];

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [data, resources] = await Promise.all([
        api.request(`/api/temp-voice/${guildId}`),
        api.request(`/api/discord/${guildId}/resources`).catch(() => ({ channels: [], categories: [] })),
      ]);

      const nextConfig = data.config || {};
      const nextSettings = nextConfig.settings || {};
      setConfig(nextConfig);
      setVariables(Array.isArray(data.variables) ? data.variables : []);
      setOverview(data.overview || {});
      setSettingsDraft({
        defaultUserLimit: nextSettings.defaultUserLimit || 0,
        deleteWhenEmpty: nextSettings.deleteWhenEmpty !== false,
        ownerPanelEnabled: nextSettings.ownerPanelEnabled !== false,
        allowOwnerRename: nextSettings.allowOwnerRename !== false,
        allowOwnerStatus: nextSettings.allowOwnerStatus !== false,
        allowOwnerLock: nextSettings.allowOwnerLock !== false,
        allowOwnerHide: nextSettings.allowOwnerHide !== false,
        allowOwnerLimit: nextSettings.allowOwnerLimit !== false,
        allowOwnerPermits: nextSettings.allowOwnerPermits !== false,
        allowOwnerTransfer: nextSettings.allowOwnerTransfer !== false,
        allowOwnerDelete: nextSettings.allowOwnerDelete !== false,
      });
      setVoiceChannels((resources.channels || []).filter((channel) => channel.type === 2 || channel.type === 13 || channel.type === 'GuildVoice' || channel.type === 'GuildStageVoice'));
      setCategories((resources.categories || []).filter((category) => category.id && category.name));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Temp Voice.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function setEnabled(enabled) {
    setSaving(true);
    setError('');
    try {
      const result = await api.request(`/api/temp-voice/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setConfig(result.config || null);
      setOverview(result.overview || null);
      setMessage(`${E.SUCCESS} Temp Voice ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update Temp Voice state.');
    } finally {
      setSaving(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError('');
    try {
      const result = await api.request(`/api/temp-voice/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: settingsDraft }) });
      setConfig(result.config || null);
      setOverview(result.overview || null);
      setMessage(`${E.SUCCESS} Temp Voice settings saved.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save Temp Voice settings.');
    } finally {
      setSaving(false);
    }
  }

  async function saveHub(hub = hubDraft) {
    setSaving(true);
    setError('');
    try {
      await api.request(hub.hubId ? `/api/temp-voice/${guildId}/hubs/${hub.hubId}` : `/api/temp-voice/${guildId}/hubs`, { method: hub.hubId ? 'PUT' : 'POST', body: JSON.stringify(hub) });
      setHubDraft({ ...defaultHub, userLimit: settingsDraft.defaultUserLimit || 0 });
      setMessage(`${E.SUCCESS} Temp Voice hub saved.`);
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save hub.');
    } finally {
      setSaving(false);
    }
  }

  async function deployHub() {
    setSaving(true);
    setError('');
    try {
      await api.request(`/api/temp-voice/${guildId}/hubs/deploy`, { method: 'POST', body: JSON.stringify({ ...hubDraft, enabled: true }) });
      setHubDraft({ ...defaultHub, userLimit: settingsDraft.defaultUserLimit || 0 });
      setMessage(`${E.SUCCESS} Temp Voice deployed to Discord.`);
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Failed to deploy Temp Voice. Check bot permissions: Manage Channels and Move Members.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteHub(hubId) {
    setSaving(true);
    setError('');
    try {
      await api.request(`/api/temp-voice/${guildId}/hubs/${hubId}`, { method: 'DELETE' });
      setMessage(`${E.SUCCESS} Temp Voice hub deleted.`);
      await load();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete hub.');
    } finally {
      setSaving(false);
    }
  }

  if (!guildId) return <EmptyState theme={theme} title="Select a guild" text="Select a guild to manage Temp Voice." />;
  if (loading && !config) return <LoadingPanel theme={theme} text="Loading Temp Voice..." />;

  return (
    <PageShell title="Temp Voice" subtitle="Deploy join-to-create hubs and control temporary voice channels." theme={theme} guild={{ id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || 'Temp Voice' }} actions={<><Toggle checked={overview?.enabled !== false} onChange={setEnabled} disabled={saving} /><PrimaryButton onClick={load} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</PrimaryButton></>}>
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {message ? <Notice theme={theme} tone="success">{message}</Notice> : null}

      <StatGrid min="160px">
        <SummaryStat theme={theme} label="Status" value={overview?.enabled ? 'Enabled' : 'Disabled'} accent={overview?.enabled ? '#22c55e' : '#ef4444'} description="Module state" />
        <SummaryStat theme={theme} label="Hubs" value={`${overview?.enabledHubs || 0}/${overview?.hubs || 0}`} accent="#60a5fa" description="Enabled hubs" />
        <SummaryStat theme={theme} label="Live Channels" value={overview?.liveChannels || 0} accent="#a78bfa" description="Tracked and present" />
        <SummaryStat theme={theme} label="Tracked" value={overview?.trackedChannels || 0} accent="#f59e0b" description="Stored temp channels" />
        <SummaryStat theme={theme} label="Created" value={analytics.totalCreated || 0} accent="#22c55e" description="Lifetime channels" />
        <SummaryStat theme={theme} label="Last Activity" value={analytics.lastActivityAt ? 'Active' : 'None'} accent="#38bdf8" description={formatDate(analytics.lastActivityAt)} />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
        <Card theme={theme}>
          <h2 style={{ margin: '0 0 14px' }}>Create / Deploy Hub</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <ChannelSelect theme={theme} label="Existing Join/Create Voice Channel" value={hubDraft.joinChannelId} onChange={(value) => setHubDraft({ ...hubDraft, joinChannelId: value })} channels={voiceChannels} empty="Create a new hub channel" />
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>New Hub Channel Name<input value={hubDraft.joinChannelName} onChange={(event) => setHubDraft({ ...hubDraft, joinChannelName: event.target.value })} style={fieldStyle(theme)} /></label>
            <ChannelSelect theme={theme} label="Existing Temp Category" value={hubDraft.categoryId} onChange={(value) => setHubDraft({ ...hubDraft, categoryId: value })} channels={categories} empty="Create or use automatic category" />
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>New Category Name<input value={hubDraft.categoryName} onChange={(event) => setHubDraft({ ...hubDraft, categoryName: event.target.value })} style={fieldStyle(theme)} /></label>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Temp Channel Name Template<input value={hubDraft.nameTemplate} onChange={(event) => setHubDraft({ ...hubDraft, nameTemplate: event.target.value })} style={fieldStyle(theme)} /></label><details><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Variables</summary><p>Copy a variable or select it to append it to the channel name template.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{variables.map(token => <button type="button" key={token} onClick={() => setHubDraft(draft => ({ ...draft, nameTemplate: (draft.nameTemplate || '') + token }))} style={{ color: theme.cardText, background: theme.softBg, border: '1px solid ' + theme.cardBorder, borderRadius: 8, padding: 6, cursor: 'pointer' }}>{token}</button>)}</div>{!variables.length && <span>Variable list unavailable.</span>}</details>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Default User Limit<input type="number" min="0" max="99" value={hubDraft.userLimit} onChange={(event) => setHubDraft({ ...hubDraft, userLimit: event.target.value })} style={fieldStyle(theme)} /></label>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Bitrate<input type="number" min="0" value={hubDraft.bitrate} onChange={(event) => setHubDraft({ ...hubDraft, bitrate: event.target.value })} style={fieldStyle(theme)} /></label>
            <div style={{ display: 'grid', gap: 8 }}>
              <Check theme={theme} checked={hubDraft.lockedByDefault} onChange={(value) => setHubDraft({ ...hubDraft, lockedByDefault: value })} label="Created channels start locked" />
              <Check theme={theme} checked={hubDraft.hiddenByDefault} onChange={(value) => setHubDraft({ ...hubDraft, hiddenByDefault: value })} label="Created channels start hidden" />
              <Check theme={theme} checked={hubDraft.ownerControlsEnabled} onChange={(value) => setHubDraft({ ...hubDraft, ownerControlsEnabled: value })} label="Enable owner controls" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PrimaryButton onClick={() => saveHub()} disabled={saving || (!hubDraft.joinChannelId && !hubDraft.hubId)}>{saving ? 'Saving...' : 'Save Existing Hub'}</PrimaryButton>
              <PrimaryButton onClick={deployHub} disabled={saving}>{saving ? 'Deploying...' : 'Deploy to Discord'}</PrimaryButton>
            </div>
          </div>
        </Card>

        <Card theme={theme}>
          <h2 style={{ margin: '0 0 14px' }}>Owner Controls</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Global Default User Limit<input type="number" min="0" max="99" value={settingsDraft.defaultUserLimit} onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultUserLimit: event.target.value })} style={fieldStyle(theme)} /></label>
            <Check theme={theme} checked={settingsDraft.deleteWhenEmpty} onChange={(value) => setSettingsDraft({ ...settingsDraft, deleteWhenEmpty: value })} label="Delete temporary channels when empty" />
            <Check theme={theme} checked={settingsDraft.ownerPanelEnabled} onChange={(value) => setSettingsDraft({ ...settingsDraft, ownerPanelEnabled: value })} label="Enable Discord owner control panel" />
            <Check theme={theme} checked={settingsDraft.allowOwnerRename} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerRename: value })} label="Owners can rename channels" />
            <Check theme={theme} checked={settingsDraft.allowOwnerStatus} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerStatus: value })} label="Owners can set activity/status" />
            <Check theme={theme} checked={settingsDraft.allowOwnerLock} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerLock: value })} label="Owners can lock/unlock" />
            <Check theme={theme} checked={settingsDraft.allowOwnerHide} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerHide: value })} label="Owners can hide/show" />
            <Check theme={theme} checked={settingsDraft.allowOwnerLimit} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerLimit: value })} label="Owners can change user limit" />
            <Check theme={theme} checked={settingsDraft.allowOwnerPermits} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerPermits: value })} label="Owners can manage access exceptions" />
            <Check theme={theme} checked={settingsDraft.allowOwnerTransfer} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerTransfer: value })} label="Owners can transfer ownership" />
            <Check theme={theme} checked={settingsDraft.allowOwnerDelete} onChange={(value) => setSettingsDraft({ ...settingsDraft, allowOwnerDelete: value })} label="Owners can remove their channel" />
            <PrimaryButton onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save Controls'}</PrimaryButton>
          </div>
        </Card>
      </div>

      <Card theme={theme}>
        <h2 style={{ margin: '0 0 14px' }}>Configured Hubs</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {hubs.length ? hubs.map((hub) => <div key={hub.hubId} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.5)', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}><strong>{voiceChannels.find((channel) => channel.id === hub.joinChannelId)?.name || hub.joinChannelName || hub.joinChannelId}</strong><span style={{ color: theme.mutedText, fontSize: 13 }}>Template: {hub.nameTemplate} · Limit: {hub.userLimit || 'None'} · Category: {categories.find((category) => category.id === hub.categoryId)?.name || hub.categoryName || 'Auto'} · Defaults: {hub.lockedByDefault ? 'Locked' : 'Open'} / {hub.hiddenByDefault ? 'Hidden' : 'Visible'}</span><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => setHubDraft({ ...defaultHub, ...hub })} style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 10, padding: '9px 11px', fontWeight: 900 }}>Edit</button><button type="button" onClick={() => deleteHub(hub.hubId)} style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.12)', color: '#fca5a5', borderRadius: 10, padding: '9px 11px', fontWeight: 900 }}>Remove</button></div></div>) : <EmptyState theme={theme} title="No hubs configured" text="Deploy a category and hub channel, or attach an existing voice channel." />}
        </div>
      </Card>

      <Card theme={theme}>
        <h2 style={{ margin: '0 0 14px' }}>Temp Voice Control Centre</h2>
        <TempVoiceControlCentre theme={theme} guildId={guildId} channels={trackedChannels} saving={saving} onRefresh={load} onMessage={setMessage} onError={setError} />
      </Card>

      <Card theme={theme}>
        <h2 style={{ margin: '0 0 14px' }}>Activity Log</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {activity.length ? activity.map((entry) => <div key={entry.id} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.5)', borderRadius: 14, padding: 12, display: 'grid', gap: 5 }}><strong>{entry.label || entry.type}</strong><span style={{ color: theme.mutedText, fontSize: 13 }}>Channel: {entry.channelId || 'Unknown'} · Actor: {entry.actorId || 'System'} · Target: {entry.targetId || 'None'} · {formatDate(entry.createdAt)}</span></div>) : <EmptyState theme={theme} title="No Temp Voice activity yet" text="Created channels and owner controls will appear here." />}
        </div>
      </Card>
    </PageShell>
  );
}
