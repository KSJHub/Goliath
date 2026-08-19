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

export default function Suggestions({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const suggestions = overview.suggestions || [];
  const cardStyle = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow }), [theme]);

  async function loadResources() {
    const [channelPayload, rolePayload] = await Promise.all([api.getGuildChannels(guildId), api.getGuildRoles(guildId)]);
    let channelList = normalizeList(channelPayload, 'channels');
    let roleList = normalizeList(rolePayload, 'roles');
    if (!channelList.length || !roleList.length) {
      const synced = await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' });
      if (!channelList.length) channelList = normalizeList(synced, 'channels');
      if (!roleList.length) roleList = normalizeList(synced, 'roles');
    }
    return [channelList, roleList];
  }

  async function load() {
    if (!guildId) return;
    setLoading(true); setError('');
    try {
      const [payload, resources] = await Promise.all([api.request(`/api/suggestions/${guildId}/overview`), loadResources()]);
      setConfig(payload.config || {});
      setOverview(payload.overview || {});
      setChannels(resources[0]);
      setRoles(resources[1]);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Suggestions dashboard.');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [guildId]);

  async function runAction(name, fn, message) {
    setSaving(name); setError(''); setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config);
      if (result?.overview) setOverview(result.overview);
      if (message) setNotice(message);
      return result;
    } catch (actionError) {
      setError(actionError.message || 'Suggestions action failed.');
      return null;
    } finally { setSaving(''); }
  }

  async function saveSettings(patch, message = 'Suggestion settings saved.') {
    return runAction('settings', () => api.request(`/api/suggestions/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: patch }) }), message);
  }

  async function reviewSuggestion(item, action) {
    const reason = window.prompt(`${action === 'approve' ? 'Approve' : 'Deny'} suggestion ${item.suggestionId}. Optional reason:`, item.reviewReason || '');
    if (reason === null) return;
    await runAction(`review-${item.suggestionId}`, () => api.request(`/api/suggestions/${guildId}/suggestions/${item.suggestionId}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) }), `Suggestion ${action === 'approve' ? 'approved' : 'denied'}.`);
  }

  const filtered = suggestions.filter((item) => {
    const statusOk = statusFilter === 'all' || item.status === statusFilter;
    const needle = search.trim().toLowerCase();
    const searchOk = !needle || `${item.suggestionId} ${item.content} ${item.authorName || ''} ${item.authorId || ''}`.toLowerCase().includes(needle);
    return statusOk && searchOk;
  });

  if (!guildId) return <EmptyState theme={theme} icon="💡" title="Select a server" description="Select a server to manage Suggestions." />;

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(250,204,21,0.14), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.12))' }}>
      <p style={{ margin: '0 0 8px', color: '#fde047', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Feedback Studio</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Suggestions</h1>
      <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 860 }}>Configure submission/review destinations, reviewer access, anonymous mode and voting, then moderate the same canonical suggestions used by Discord.</p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }}>
      <StatCard theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} hint={loading ? 'Loading...' : `${suggestions.length} total`} />
      <StatCard theme={theme} label="Pending" value={overview.pending || 0} />
      <StatCard theme={theme} label="Approved" value={overview.approved || 0} />
      <StatCard theme={theme} label="Denied" value={overview.denied || 0} />
      <StatCard theme={theme} label="Votes" value={(analytics.votesUp || 0) + (analytics.votesDown || 0)} hint={`${analytics.votesUp || 0} up · ${analytics.votesDown || 0} down`} />
      <StatCard theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.issues?.length || 0} issue(s) · ${health?.warnings?.length || 0} warning(s)`} />
    </section>

    {(error || notice) ? <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Enable/disable Suggestions and export the canonical guild configuration.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => runAction('enabled', () => api.request(`/api/suggestions/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !(overview.enabled || config?.enabled) }) }), 'Module status updated.')} disabled={saving} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
          <a href={`/api/suggestions/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
        </div>
      </div>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
      <div><h2 style={{ margin: 0 }}>Channels & Behaviour</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>These settings write directly to <code>guild.modules.suggestions</code>.</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        <ChannelSelect theme={theme} resources={channels} value={config?.submitChannelId || ''} onChange={(submitChannelId) => saveSettings({ submitChannelId: submitChannelId || null })} label="Submit Channel" disabled={!channels.length} />
        <ChannelSelect theme={theme} resources={channels} value={config?.reviewChannelId || ''} onChange={(reviewChannelId) => saveSettings({ reviewChannelId: reviewChannelId || null })} label="Review Channel" disabled={!channels.length} />
        <ChannelSelect theme={theme} resources={channels} value={config?.approvedChannelId || ''} onChange={(approvedChannelId) => saveSettings({ approvedChannelId: approvedChannelId || null })} label="Approved Channel" disabled={!channels.length} />
        <ChannelSelect theme={theme} resources={channels} value={config?.deniedChannelId || ''} onChange={(deniedChannelId) => saveSettings({ deniedChannelId: deniedChannelId || null })} label="Denied Channel" disabled={!channels.length} />
      </div>
      <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Reviewer roles<select multiple value={config?.reviewerRoleIds || []} onChange={(event) => saveSettings({ reviewerRoleIds: Array.from(event.target.selectedOptions).map((option) => option.value) })} style={{ ...fieldStyle(theme), minHeight: 120 }}>{roles.map((role) => <option key={role.id || role.roleId} value={role.id || role.roleId}>{role.name || role.label || role.id}</option>)}</select><span style={{ fontSize: 12, fontWeight: 700 }}>Ctrl/Cmd-click to select multiple roles. Manage Server and Administrator can always review.</span></label>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.voting !== false} onChange={(event) => saveSettings({ voting: event.target.checked })} /> Voting enabled</label>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.requireReview !== false} onChange={(event) => saveSettings({ requireReview: event.target.checked })} /> Require review</label>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.anonymous === true} onChange={(event) => saveSettings({ anonymous: event.target.checked })} /> Anonymous suggestions</label>
      </div>
    </section>

    <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Suggestion Queue & History</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Review pending items and inspect completed decisions.</p></div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={fieldStyle(theme)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="all">All</option></select><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suggestions" style={fieldStyle(theme)} /></div>
      </div>
      {filtered.length ? <div style={{ display: 'grid', gap: 12 }}>{filtered.map((item) => <article key={item.suggestionId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 16, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.suggestionId}</strong><div style={{ marginTop: 4, color: theme.mutedText, fontSize: 13 }}>{config?.anonymous ? 'Anonymous' : (item.authorName || item.authorId || 'Unknown')} · {new Date(item.createdAt).toLocaleString()}</div></div><div style={{ fontWeight: 950, textTransform: 'capitalize' }}>{item.status}</div></div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{item.content}</div>
        <div style={{ color: theme.mutedText, fontSize: 13 }}>👍 {item.upVoteCount || 0} · 👎 {item.downVoteCount || 0}{item.reviewedBy ? ` · Reviewed by ${item.reviewedBy}` : ''}{item.reviewReason ? ` · ${item.reviewReason}` : ''}</div>
        {item.status === 'pending' ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" onClick={() => reviewSuggestion(item, 'approve')} disabled={saving} style={buttonStyle(theme, 'success')}>Approve</button><button type="button" onClick={() => reviewSuggestion(item, 'deny')} disabled={saving} style={buttonStyle(theme, 'danger')}>Deny</button></div> : null}
      </article>)}</div> : <div style={{ color: theme.mutedText }}>No suggestions match this view.</div>}
    </section>

    <section style={{ ...cardStyle, padding: 22 }}>
      <h2 style={{ marginTop: 0 }}>Health</h2>
      <p style={{ color: theme.mutedText }}>Checks configured destinations and reviewer-role references against the live guild.</p>
      {!health ? <div style={{ color: theme.mutedText }}>Guild health is unavailable.</div> : <div style={{ display: 'grid', gap: 8 }}><strong>{health.healthy ? 'Healthy' : 'Needs attention'}</strong>{[...(health.issues || []), ...(health.warnings || [])].map((item, index) => <div key={`${item.code}-${index}`} style={{ color: theme.mutedText }}>{item.code}{item.channelId ? ` · ${item.channelId}` : ''}{item.roleId ? ` · ${item.roleId}` : ''}</div>)}</div>}
    </section>
  </div>;
}
