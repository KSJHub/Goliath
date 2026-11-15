import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useEffect, useMemo, useState } from 'react';

import useOwnerGuilds from '../../hooks/useOwnerGuilds.js';
import { api } from '../../services/apiClient.js';

function getGuildId(guild = {}) {
  return String(guild.guildId || guild.id || '');
}

function getGuildName(guild = {}) {
  return guild.name || guild.guildName || 'Unknown Guild';
}

function formatNumber(value = 0) {
  return Number(value || 0).toLocaleString();
}

function formatBool(value) {
  return value ? 'Enabled' : 'Disabled';
}

function formatTime(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

function card(theme, extra = {}) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
    minWidth: 0,
    overflow: 'hidden',
    ...extra,
  };
}

function StatCard({ theme, title, value, detail, accent = '#93c5fd' }) {
  return (
    <div style={card(theme, { padding: 16, minHeight: 118, display: 'grid', gap: 10, alignContent: 'space-between' })}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ color: accent, fontSize: 27, fontWeight: 950, lineHeight: 1, wordBreak: 'break-word' }}>{value}</div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{detail}</div>
    </div>
  );
}

function ProviderRow({ theme, name, priority, configured }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 13, background: 'rgba(15,23,42,0.18)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <strong>{name}</strong>
        <div style={{ color: theme.mutedText, fontSize: 13, marginTop: 4 }}>{configured ? 'Configured and ready for provider wiring.' : 'Missing provider credentials.'}</div>
      </div>
      <span style={{ border: `1px solid ${configured ? '#22c55e55' : '#f8717155'}`, borderRadius: 999, padding: '5px 9px', color: configured ? '#86efac' : '#fca5a5', fontSize: 12, fontWeight: 900 }}>Priority {priority}</span>
    </div>
  );
}

function ConfigRow({ theme, label, value }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.18)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ color: theme.mutedText }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChannelRow({ theme, channelId, channel }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.18)', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong>{channel.name ? `#${channel.name}` : channelId}</strong>
        <span style={{ color: channel.enabled !== false ? '#86efac' : '#fca5a5', fontSize: 12, fontWeight: 950 }}>{channel.enabled !== false ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>
        Mode: {channel.mode || 'auto'} • Threads: {channel.threadMode || channel.autoCreateThreads ? 'On' : 'Off'} • Target: {channel.targetLanguage || channel.target || 'default'}
      </div>
    </div>
  );
}

function ActivityRow({ theme, item }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.18)', display: 'grid', gap: 5 }}>
      <strong>{item.guildName || 'Unknown Guild'}</strong>
      <div style={{ color: theme.mutedText, fontSize: 13 }}>{item.type || item.action || 'translation activity'} • {formatTime(item.timestamp)}</div>
    </div>
  );
}

export default function TranslationHub({ theme }) {
  const { guilds, selectedGuild, setSelectedGuild, loading, error } = useOwnerGuilds();
  const [overview, setOverview] = useState(null);
  const [channels, setChannels] = useState({});
  const [threads, setThreads] = useState(null);
  const [users, setUsers] = useState({});
  const [analytics, setAnalytics] = useState({});
  const [globalPayload, setGlobalPayload] = useState(null);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');

  const activeGuild = useMemo(
    () => guilds.find((guild) => getGuildId(guild) === String(selectedGuild)) || null,
    [guilds, selectedGuild],
  );

  async function loadTranslationHub() {
    try {
      setHubLoading(true);
      setHubError('');

      const globalRequest = api.request('/api/owner/translation/all');

      if (!selectedGuild) {
        const globalRes = await globalRequest;
        setGlobalPayload(globalRes);
        return;
      }

      const [globalRes, overviewRes, channelsRes, threadsRes, usersRes, analyticsRes] = await Promise.all([
        globalRequest,
        api.request(`/api/translation/${selectedGuild}/overview`),
        api.request(`/api/translation/${selectedGuild}/channels`),
        api.request(`/api/translation/${selectedGuild}/threads`),
        api.request(`/api/translation/${selectedGuild}/users`),
        api.request(`/api/translation/${selectedGuild}/analytics`),
      ]);

      setGlobalPayload(globalRes);
      setOverview(overviewRes?.overview || null);
      setChannels(channelsRes?.channels || {});
      setThreads(threadsRes || null);
      setUsers(usersRes?.userPreferences || {});
      setAnalytics(analyticsRes?.analytics || {});
    } catch (loadError) {
      console.error(loadError);
      setHubError(loadError.message || 'Failed to load translation hub.');
      setOverview(null);
      setChannels({});
      setThreads(null);
      setUsers({});
      setAnalytics({});
      setGlobalPayload(null);
    } finally {
      setHubLoading(false);
    }
  }

  useEffect(() => {
    loadTranslationHub();
  }, [selectedGuild]);

  const channelEntries = Object.entries(channels || {});
  const enabledChannels = channelEntries.filter(([, channel]) => channel.enabled !== false).length;
  const userCount = Object.keys(users || {}).length;
  const threadMappings = threads?.threadMappings || {};
  const mappingCount = Object.values(threadMappings).reduce((total, item) => total + Object.keys(item || {}).length, 0);
  const translatedCount = analytics.totalTranslations || analytics.translations || analytics.messagesTranslated || 0;
  const globalTotals = globalPayload?.totals || {};
  const providerHealth = Object.values(globalPayload?.providerHealth || {});
  const recentActivity = globalPayload?.recentActivity || [];

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <section style={card(theme, { background: 'linear-gradient(135deg, rgba(59,130,246,0.16), rgba(15,23,42,0.08) 48%, rgba(34,197,94,0.12))', padding: 'clamp(18px, 2.4vw, 24px)' })}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 420px' }}>
            <p style={{ margin: 0, color: '#93c5fd', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Owner Translation</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em', lineHeight: 1 }}>{E.GLOBE} Translation Hub</h1>
            <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 860 }}>
              Monitor global translation usage, providers, channels, thread mappings and selected-guild configuration from one owner dashboard.
            </p>
          </div>

          <select
            value={selectedGuild || ''}
            onChange={(event) => setSelectedGuild(event.target.value)}
            style={{ minWidth: 240, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.36)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', fontWeight: 850 }}
          >
            {guilds.map((guild) => (
              <option key={getGuildId(guild)} value={getGuildId(guild)}>{getGuildName(guild)}</option>
            ))}
          </select>
        </div>
      </section>

      {error ? <section style={{ ...card(theme), color: '#fca5a5' }}>{error}</section> : null}
      {hubError ? <section style={{ ...card(theme), color: '#fca5a5' }}>{hubError}</section> : null}
      {loading || hubLoading ? <section style={card(theme)}>Loading translation hub...</section> : null}

      {!loading && !hubLoading ? (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}>
            <StatCard theme={theme} title="Global Guilds" value={formatNumber(globalTotals.guilds || 0)} detail={`${formatNumber(globalTotals.enabledGuilds || 0)} enabled`} />
            <StatCard theme={theme} title="Global Channels" value={`${formatNumber(globalTotals.enabledChannels || 0)}/${formatNumber(globalTotals.configuredChannels || 0)}`} detail="Enabled / configured" accent="#38bdf8" />
            <StatCard theme={theme} title="User Languages" value={formatNumber(globalTotals.userPreferences || 0)} detail="Across all environments" accent="#a78bfa" />
            <StatCard theme={theme} title="Thread Mappings" value={formatNumber(globalTotals.threadMappings || 0)} detail="Cross-guild mappings" accent="#facc15" />
            <StatCard theme={theme} title="Tracked Translations" value={formatNumber(globalTotals.translations || 0)} detail="Global analytics total" accent="#34d399" />
            <StatCard theme={theme} title="Manual Providers" value={formatNumber(globalTotals.manualProviderGuilds || 0)} detail="Guilds still manual" accent="#f97316" />
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
            <StatCard theme={theme} title="Selected Guild" value={activeGuild ? getGuildName(activeGuild) : 'None'} detail={selectedGuild || 'No guild selected'} />
            <StatCard theme={theme} title="Translation" value={formatBool(overview?.enabled)} detail={`Provider: ${overview?.provider || 'manual'}`} accent={overview?.enabled ? '#86efac' : '#fca5a5'} />
            <StatCard theme={theme} title="Channels" value={`${enabledChannels}/${channelEntries.length}`} detail="Enabled / configured" accent="#38bdf8" />
            <StatCard theme={theme} title="Local Users" value={userCount} detail="Saved preferences" accent="#a78bfa" />
            <StatCard theme={theme} title="Local Threads" value={mappingCount} detail="Thread mappings" accent="#facc15" />
            <StatCard theme={theme} title="Local Translations" value={translatedCount} detail="Selected guild analytics" accent="#34d399" />
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 14 }}>
            <section style={card(theme)}>
              <h3 style={{ marginTop: 0 }}>Translation Health</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                <ConfigRow theme={theme} label="Auto Detect" value={formatBool(overview?.autoDetect)} />
                <ConfigRow theme={theme} label="Thread Mode" value={formatBool(overview?.threadMode)} />
                <ConfigRow theme={theme} label="Default Target" value={overview?.defaultTargetLanguage || 'en'} />
                <ConfigRow theme={theme} label="Target Languages" value={(overview?.targetLanguages || ['en']).join(', ')} />
              </div>
            </section>

            <section style={card(theme)}>
              <h3 style={{ marginTop: 0 }}>Provider Health</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {providerHealth.length ? providerHealth.map((provider) => (
                  <ProviderRow key={provider.label} theme={theme} name={provider.label} priority={provider.priority} configured={provider.configured} />
                )) : <div style={{ color: theme.mutedText }}>Provider health unavailable.</div>}
              </div>
            </section>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 14 }}>
            <section style={card(theme)}>
              <h3 style={{ marginTop: 0 }}>Configured Channels</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {channelEntries.length ? channelEntries.slice(0, 10).map(([channelId, channel]) => (
                  <ChannelRow key={channelId} theme={theme} channelId={channelId} channel={channel || {}} />
                )) : <div style={{ color: theme.mutedText }}>No translation channels configured yet.</div>}
              </div>
            </section>

            <section style={card(theme)}>
              <h3 style={{ marginTop: 0 }}>Recent Translation Activity</h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {recentActivity.length ? recentActivity.slice(0, 8).map((item, index) => (
                  <ActivityRow key={`${item.guildId || 'guild'}-${item.timestamp || index}`} theme={theme} item={item} />
                )) : <div style={{ color: theme.mutedText }}>No recent translation activity found.</div>}
              </div>
            </section>
          </section>

          <section style={card(theme)}>
            <h3 style={{ marginTop: 0 }}>Activity & Gaps</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 10 }}>
              <ConfigRow theme={theme} label="Logs Stored" value={formatNumber((threads?.logs || []).length)} />
              <ConfigRow theme={theme} label="Configured Thread Channels" value={formatNumber(Object.keys(threads?.threadChannels || {}).length)} />
              <ConfigRow theme={theme} label="Missing Provider" value={overview?.provider === 'manual' ? 'Yes' : 'No'} />
              <ConfigRow theme={theme} label="Next Build" value="Provider connection + command polish" />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
