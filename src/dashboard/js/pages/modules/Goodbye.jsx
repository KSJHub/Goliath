import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect } from '../../ui/DiscordResourceSelects.jsx';

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
  const colors = { primary: 'rgba(37,99,235,0.22)', success: 'rgba(22,163,74,0.22)', danger: 'rgba(220,38,38,0.22)', default: 'rgba(15,23,42,0.45)' };
  return { border: `1px solid ${theme.cardBorder}`, background: colors[tone] || colors.default, color: theme.cardText, borderRadius: 14, padding: '11px 14px', fontWeight: 950, cursor: 'pointer' };
}

function Stat({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.32)', borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 7, color: theme.cardText, fontSize: 27, fontWeight: 950 }}>{value}</div>{hint ? <div style={{ marginTop: 3, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}</div>;
}

function Toggle({ theme, label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 9, color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

export default function Goodbye({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [dmConfig, setDmConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [templates, setTemplates] = useState([]);
  const [channels, setChannels] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const card = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow, padding: 22 }), [theme]);
  const analytics = overview.analytics || config?.analytics || {};
  const dmAnalytics = overview.dmAnalytics || dmConfig?.analytics || {};
  const health = overview.health || null;

  async function load() {
    if (!guildId) return;
    setBusy('load'); setError('');
    try {
      const [payload, channelPayload] = await Promise.all([api.request(`/api/goodbye/${guildId}/overview`), api.getGuildChannels(guildId)]);
      setConfig(payload.config || {});
      setDmConfig(payload.dmConfig || {});
      setOverview(payload.overview || {});
      setTemplates(payload.templates || []);
      setChannels(normalizeList(channelPayload, 'channels'));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Goodbye.');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function act(name, fn, successText) {
    setBusy(name); setError(''); setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config);
      if (result?.dmConfig) setDmConfig(result.dmConfig);
      if (result?.overview) setOverview(result.overview);
      if (successText) setNotice(successText);
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Goodbye action failed.');
    } finally {
      setBusy('');
    }
  }

  async function savePatch(patch, message = 'Goodbye settings saved.') {
    setConfig((current) => ({ ...(current || {}), ...patch }));
    await act('save', () => api.request(`/api/goodbye/${guildId}/config`, { method: 'PUT', body: JSON.stringify(patch) }), message);
  }

  async function saveDmPatch(patch, message = 'Departure DM settings saved.') {
    setDmConfig((current) => ({ ...(current || {}), ...patch }));
    await act('save-dm', () => api.request(`/api/goodbye/${guildId}/dm-config`, { method: 'PUT', body: JSON.stringify(patch) }), message);
  }

  if (!guildId) return <EmptyState theme={theme} icon="👋" title="Select a server" description="Select a server to manage Goodbye." />;

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...card, background: 'linear-gradient(135deg, rgba(239,68,68,0.16), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.14))' }}><div style={{ color: '#fca5a5', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goliath Community</div><h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px,4vw,42px)' }}>Goodbye</h1><p style={{ color: theme.mutedText, lineHeight: 1.6 }}>Configure staff departure logs and private member departure DMs from one module.</p></section>
    {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}><Stat theme={theme} label="Module" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} /><Stat theme={theme} label="Logs Sent" value={analytics.sent || 0} /><Stat theme={theme} label="DMs Sent" value={dmAnalytics.sent || 0} /><Stat theme={theme} label="DM Failures" value={dmAnalytics.failed || 0} /><Stat theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.warnings?.length || 0} warning(s)`} /></section>

    <section style={{ ...card, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Staff Departure Log</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Embed Studio owns presentation; Goodbye owns detection and delivery.</p></div><button type="button" disabled={busy} onClick={() => savePatch({ enabled: !(overview.enabled || config?.enabled) }, overview.enabled || config?.enabled ? 'Goodbye disabled.' : 'Goodbye enabled.')} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button></div>
      <ChannelSelect theme={theme} resources={channels} value={config?.channelId || ''} onChange={(value) => savePatch({ channelId: value || null })} label="Staff Departure Log Channel" />
      <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Embed Studio Template</span><select value={overview.templateId || config?.templateId || ''} onChange={(event) => savePatch({ templateId: event.target.value }, 'Goodbye template bound.')} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px', fontWeight: 800 }}><option value="goodbye_default">Default Goodbye</option>{templates.map((template) => <option key={template.templateId} value={template.templateId}>{template.name || template.templateId}</option>)}</select></label>
      <Toggle theme={theme} label="Ignore bots" checked={config?.ignoreBots !== false} onChange={(checked) => savePatch({ ignoreBots: checked })} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" disabled={busy} onClick={() => act('test', () => api.request(`/api/goodbye/${guildId}/test`, { method: 'POST', body: JSON.stringify({ userId: selectedGuildData?.userId }) }), 'Test goodbye sent.')} style={buttonStyle(theme, 'success')}>Test Log</button><button type="button" disabled={busy} onClick={() => act('repair', () => api.request(`/api/goodbye/${guildId}/repair`, { method: 'POST' }), 'Goodbye configuration repaired.')} style={buttonStyle(theme, 'primary')}>Repair</button><a href={`/api/goodbye/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a><button type="button" disabled={busy} onClick={() => window.confirm('Reset all Goodbye settings and analytics?') && act('reset', () => api.request(`/api/goodbye/${guildId}/reset`, { method: 'POST' }), 'Goodbye reset to defaults.')} style={buttonStyle(theme, 'danger')}>Reset Module</button></div>
    </section>

    <section style={{ ...card, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Member Departure DM</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>A user-focused summary of the departure. Failed DMs never block staff logging.</p></div><button type="button" disabled={busy} onClick={() => saveDmPatch({ enabled: !dmConfig?.enabled }, dmConfig?.enabled ? 'Departure DM disabled.' : 'Departure DM enabled.')} style={buttonStyle(theme, dmConfig?.enabled ? 'danger' : 'success')}>{dmConfig?.enabled ? 'Disable DM' : 'Enable DM'}</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 }}>
        <Toggle theme={theme} label="DM on voluntary leave" checked={dmConfig?.sendOnLeave !== false} onChange={(checked) => saveDmPatch({ sendOnLeave: checked })} />
        <Toggle theme={theme} label="DM on kick" checked={dmConfig?.sendOnKick !== false} onChange={(checked) => saveDmPatch({ sendOnKick: checked })} />
        <Toggle theme={theme} label="DM on ban" checked={dmConfig?.sendOnBan !== false} onChange={(checked) => saveDmPatch({ sendOnBan: checked })} />
        <Toggle theme={theme} label="DM on prune" checked={dmConfig?.sendOnPrune === true} onChange={(checked) => saveDmPatch({ sendOnPrune: checked })} />
        <Toggle theme={theme} label="Include join date" checked={dmConfig?.includeJoinDate !== false} onChange={(checked) => saveDmPatch({ includeJoinDate: checked })} />
        <Toggle theme={theme} label="Include membership duration" checked={dmConfig?.includeMembershipDuration !== false} onChange={(checked) => saveDmPatch({ includeMembershipDuration: checked })} />
        <Toggle theme={theme} label="Include reason" checked={dmConfig?.includeReason !== false} onChange={(checked) => saveDmPatch({ includeReason: checked })} />
        <Toggle theme={theme} label="Include moderator" checked={dmConfig?.includeModerator !== false} onChange={(checked) => saveDmPatch({ includeModerator: checked })} />
        <Toggle theme={theme} label="Include appeal link" checked={dmConfig?.includeAppealLink === true} onChange={(checked) => saveDmPatch({ includeAppealLink: checked })} />
        <Toggle theme={theme} label="Include reference ID" checked={dmConfig?.includeReferenceId === true} onChange={(checked) => saveDmPatch({ includeReferenceId: checked })} />
      </div>
      <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Appeal Link</span><input value={dmConfig?.appealLink || ''} onChange={(event) => setDmConfig((current) => ({ ...(current || {}), appealLink: event.target.value }))} onBlur={(event) => saveDmPatch({ appealLink: event.target.value })} placeholder="https://..." style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px', fontWeight: 800 }} /></label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" disabled={busy} onClick={() => act('dm-test', () => api.request(`/api/goodbye/${guildId}/dm-test`, { method: 'POST', body: JSON.stringify({ userId: selectedGuildData?.userId, eventKey: 'left' }) }), 'Test departure DM sent.')} style={buttonStyle(theme, 'success')}>Send Test DM</button><button type="button" disabled={busy} onClick={() => window.confirm('Reset departure DM settings and DM analytics?') && act('dm-reset', () => api.request(`/api/goodbye/${guildId}/dm-reset`, { method: 'POST' }), 'Departure DM reset to defaults.')} style={buttonStyle(theme, 'danger')}>Reset DM</button></div>
    </section>

    <section style={{ ...card, display: 'grid', gap: 12 }}><h2 style={{ margin: 0 }}>Health & Diagnostics</h2>{health?.warnings?.length ? health.warnings.map((warning) => <div key={warning} style={{ color: '#fbbf24', fontWeight: 850 }}>⚠ {warning}</div>) : <div style={{ color: '#86efac', fontWeight: 900 }}>✅ Goodbye configuration is healthy.</div>}<div style={{ color: theme.mutedText }}>Channel: {health?.channelName || health?.channelId || 'Not configured'}</div><div style={{ color: theme.mutedText }}>View: {health?.canView ? 'Yes' : 'No'} · Send: {health?.canSend ? 'Yes' : 'No'} · Embed: {health?.canEmbed ? 'Yes' : 'No'}</div></section>
  </div>;
}
