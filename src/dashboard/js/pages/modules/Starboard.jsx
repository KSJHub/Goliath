import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import PageShell, { EmptyState, LoadingPanel, Notice, PrimaryButton, StatGrid, SummaryStat, DASHBOARD_EMOJIS as E } from '../../shared/PageShell';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function Card({ theme, children }) {
  return <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow, padding: 18 }}>{children}</section>;
}

function inputStyle(theme) {
  return { width: '100%', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.86)', color: theme.cardText, borderRadius: 12, padding: '12px 13px', outline: 'none', fontWeight: 850 };
}

function Toggle({ checked, onChange, disabled }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} style={{ border: checked ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(239,68,68,0.45)', background: checked ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)', color: checked ? '#86efac' : '#fca5a5', borderRadius: 999, padding: '9px 13px', fontWeight: 950, cursor: disabled ? 'not-allowed' : 'pointer' }}>{checked ? 'Enabled' : 'Disabled'}</button>;
}

export default function Starboard({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [channels, setChannels] = useState([]);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState(null);
  const [draft, setDraft] = useState({ enabled: false, channelId: '', threshold: 3, emoji: '⭐', allowBotMessages: false, allowSelfStar: false });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const posts = useMemo(() => Object.values(config?.posts || {}).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), [config]);

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [starboard, resources] = await Promise.all([
        api.request(`/api/starboard/${guildId}`),
        api.request(`/api/discord/${guildId}/resources`).catch(() => ({ channels: [] })),
      ]);

      const nextConfig = starboard.config || {};
      setConfig(nextConfig);
      setOverview(starboard.overview || {});
      setDraft({
        enabled: nextConfig.enabled !== false,
        channelId: nextConfig.channelId || '',
        threshold: nextConfig.threshold || 3,
        emoji: nextConfig.emoji || '⭐',
        allowBotMessages: nextConfig.allowBotMessages === true,
        allowSelfStar: nextConfig.allowSelfStar === true,
      });
      setChannels((resources.channels || []).filter((channel) => channel.type === 0 || channel.type === 5 || channel.type === 'GuildText' || channel.type === 'GuildAnnouncement'));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Starboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function save(nextDraft = draft) {
    if (!guildId) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.request(`/api/starboard/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: nextDraft }) });
      setConfig(result.config || null);
      setOverview(result.overview || null);
      setMessage(`${E.SUCCESS} Starboard settings saved.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save Starboard settings.');
    } finally {
      setSaving(false);
    }
  }

  async function setEnabled(enabled) {
    setSaving(true);
    setError('');
    try {
      const result = await api.request(`/api/starboard/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setConfig(result.config || null);
      setOverview(result.overview || null);
      setDraft((current) => ({ ...current, enabled }));
      setMessage(`${E.SUCCESS} Starboard ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update Starboard state.');
    } finally {
      setSaving(false);
    }
  }

  if (!guildId) return <EmptyState theme={theme} title="Select a guild" text="Select a guild to manage Starboard." />;
  if (loading && !config) return <LoadingPanel theme={theme} text="Loading Starboard..." />;

  return (
    <PageShell title="Starboard" subtitle="Highlight popular community messages using reaction thresholds." theme={theme} guild={{ id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || 'Starboard' }} actions={<><Toggle checked={draft.enabled} onChange={setEnabled} disabled={saving} /><PrimaryButton onClick={() => save()} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</PrimaryButton></>}>
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {message ? <Notice theme={theme} tone="success">{message}</Notice> : null}

      <StatGrid min="160px">
        <SummaryStat theme={theme} label="Status" value={overview?.enabled ? 'Enabled' : 'Disabled'} accent={overview?.enabled ? '#22c55e' : '#ef4444'} description="Module state" />
        <SummaryStat theme={theme} label="Posts" value={overview?.postCount || 0} accent="#60a5fa" description="Saved starboard posts" />
        <SummaryStat theme={theme} label="Total Stars" value={overview?.totalStars || 0} accent="#facc15" description="Tracked reactions" />
        <SummaryStat theme={theme} label="Threshold" value={overview?.threshold || draft.threshold} accent="#a78bfa" description="Required reactions" />
      </StatGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16 }}>
        <Card theme={theme}>
          <h2 style={{ margin: '0 0 14px' }}>Settings</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Starboard Channel<ThemedSelect theme={theme} value={draft.channelId} onChange={(event) => setDraft({ ...draft, channelId: event.target.value })} style={inputStyle(theme)}><option value="">Select channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</ThemedSelect></label>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Reaction Emoji<input value={draft.emoji} onChange={(event) => setDraft({ ...draft, emoji: event.target.value })} style={inputStyle(theme)} /></label>
            <label style={{ display: 'grid', gap: 8, fontWeight: 900 }}>Threshold<input type="number" min="1" value={draft.threshold} onChange={(event) => setDraft({ ...draft, threshold: event.target.value })} style={inputStyle(theme)} /></label>
            <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={draft.allowBotMessages} onChange={(event) => setDraft({ ...draft, allowBotMessages: event.target.checked })} /> Allow bot messages</label>
            <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={draft.allowSelfStar} onChange={(event) => setDraft({ ...draft, allowSelfStar: event.target.checked })} /> Allow users to star their own messages</label>
          </div>
        </Card>

        <Card theme={theme}>
          <h2 style={{ margin: '0 0 14px' }}>How it works</h2>
          <p style={{ color: theme.mutedText, lineHeight: 1.6, margin: 0 }}>When a message reaches the configured reaction threshold, Goliath reposts it into your selected Starboard channel with a jump link back to the original message.</p>
          <div style={{ marginTop: 14, display: 'grid', gap: 10, color: theme.mutedText, fontWeight: 850 }}>
            <span>Current emoji: {draft.emoji || '⭐'}</span>
            <span>Current threshold: {draft.threshold}</span>
            <span>Destination: {channels.find((channel) => channel.id === draft.channelId)?.name ? `#${channels.find((channel) => channel.id === draft.channelId)?.name}` : 'Not selected'}</span>
          </div>
        </Card>
      </div>

      <Card theme={theme}>
        <h2 style={{ margin: '0 0 14px' }}>Tracked Posts</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {posts.length ? posts.slice(0, 20).map((post) => <div key={post.messageId} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.5)', borderRadius: 14, padding: 12, display: 'grid', gap: 4 }}><strong>Message {post.messageId}</strong><span style={{ color: theme.mutedText, fontSize: 13 }}>Stars: {(post.starUserIds || []).length} · Channel: {post.channelId}</span></div>) : <EmptyState theme={theme} title="No tracked posts yet" text="Starred messages will appear here after reaching the threshold." />}
        </div>
      </Card>
    </PageShell>
  );
}
