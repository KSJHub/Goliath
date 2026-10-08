import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import OwnerAnalyticsPanel from './OwnerAnalyticsPanel.jsx';
import OwnerCommandCentrePanel from './OwnerCommandCentrePanel.jsx';

const FALLBACK_THEME = {
  mode: 'dark',
  cardBorder: 'rgba(148,163,184,0.22)',
  cardBg: 'rgba(15,23,42,0.42)',
  cardText: '#e5e7eb',
  mutedText: '#94a3b8',
  shadow: '0 18px 50px rgba(0,0,0,0.25)',
};

function safeTheme(theme) { return { ...FALLBACK_THEME, ...(theme || {}) }; }
function guildId(guild = {}) { return guild.guildId || guild.id || 'Unknown'; }
function guildName(guild = {}) { return guild.guildName || guild.name || 'Unknown Guild'; }
function environment(guild = {}) { return String(guild.environment || guild.runtimeMode || 'UNKNOWN').toUpperCase(); }
function connected(guild = {}) { return Boolean(guild.botConnected || guild.connected || guild.isConnected); }
function formatNumber(value = 0) { return Number(value || 0).toLocaleString(); }
function card(theme, extra = {}) {
  const viewTheme = safeTheme(theme);
  return { border: `1px solid ${viewTheme.cardBorder}`, background: viewTheme.cardBg, color: viewTheme.cardText, borderRadius: 20, boxShadow: viewTheme.shadow, minWidth: 0, overflow: 'hidden', ...extra };
}
function envBadge(env = '') {
  const mode = String(env || '').toUpperCase();
  if (mode === 'DEV') return '🔵 DEV';
  if (mode === 'BETA') return '🟡 BETA';
  if (mode === 'PRODUCTION') return '🟢 PROD';
  return '⚪ UNKNOWN';
}
function Stat({ theme, label, value, hint, accent = '#93c5fd' }) {
  const viewTheme = safeTheme(theme);
  return <div style={card(viewTheme, { padding: 16, display: 'grid', gap: 8 })}><span style={{ color: viewTheme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span><strong style={{ color: accent, fontSize: 28, lineHeight: 1 }}>{value}</strong>{hint ? <span style={{ color: viewTheme.mutedText, fontSize: 13 }}>{hint}</span> : null}</div>;
}
function GuildTable({ theme, guilds = [] }) {
  const viewTheme = safeTheme(theme);
  return (
    <section style={card(viewTheme)}>
      <div style={{ padding: 16, borderBottom: `1px solid ${viewTheme.cardBorder}`, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>Global Server Registry</strong><div style={{ color: viewTheme.mutedText, fontSize: 13, marginTop: 4 }}>Guilds known across DEV, BETA and PRODUCTION.</div></div><span style={{ color: viewTheme.mutedText }}>{guilds.length} guild{guilds.length === 1 ? '' : 's'}</span></div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}><thead><tr style={{ color: viewTheme.mutedText, textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}><th style={{ padding: '12px 16px' }}>Environment</th><th style={{ padding: '12px 16px' }}>Guild</th><th style={{ padding: '12px 16px' }}>Guild ID</th><th style={{ padding: '12px 16px' }}>Members</th><th style={{ padding: '12px 16px' }}>Bot</th><th style={{ padding: '12px 16px' }}>Actions</th></tr></thead><tbody>{guilds.map((guild) => {
        const id = guildId(guild); const name = guildName(guild); const env = environment(guild); const isConnected = connected(guild);
        return <tr key={`${env}-${id}`} style={{ borderTop: `1px solid ${viewTheme.cardBorder}` }}><td style={{ padding: '12px 16px', fontWeight: 850 }}>{envBadge(env)}</td><td style={{ padding: '12px 16px' }}><strong>{name}</strong></td><td style={{ padding: '12px 16px', color: viewTheme.mutedText, fontFamily: 'monospace', fontSize: 12 }}>{id}</td><td style={{ padding: '12px 16px' }}>{formatNumber(guild.memberCount)}</td><td style={{ padding: '12px 16px' }}><span style={{ border: `1px solid ${isConnected ? '#22c55e55' : '#f8717155'}`, color: isConnected ? '#86efac' : '#fca5a5', background: isConnected ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)', borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 900 }}>{isConnected ? 'Connected' : 'Missing'}</span></td><td style={{ padding: '12px 16px' }}><button type="button" onClick={() => openGuild(guild, '/overview')} style={{ border: `1px solid ${viewTheme.cardBorder}`, background: 'rgba(15,23,42,0.26)', color: viewTheme.cardText, borderRadius: 10, padding: '7px 10px', cursor: 'pointer', fontWeight: 850, fontSize: 12 }}>Open</button><button type="button" onClick={() => openGuild(guild, '/security')} style={{ marginLeft: 7, border: `1px solid ${viewTheme.cardBorder}`, background: 'rgba(15,23,42,0.26)', color: viewTheme.cardText, borderRadius: 10, padding: '7px 10px', cursor: 'pointer', fontWeight: 850, fontSize: 12 }}>Security</button></td></tr>;
      })}</tbody></table></div>
    </section>
  );
}
function openGuild(guild, path = '/overview') {
  const params = new URLSearchParams(); params.set('ownerGuildId', String(guildId(guild)).split(':').pop()); params.set('ownerGuildName', guildName(guild)); params.set('ownerGuildEnvironment', environment(guild)); window.location.assign(`${path}?${params.toString()}`);
}
export default function OwnerOverview({ theme, currentUser }) {
  const viewTheme = safeTheme(theme); const [ownerPayload, setOwnerPayload] = useState(null); const [runtimePayload, setRuntimePayload] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const isOwner = currentUser?.isOwner === true;
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isOwner) { setLoading(false); setError('Owner access required.'); return; }
      try { setLoading(true); setError(''); const [guilds, runtime] = await Promise.all([api.getOwnerGuilds(), api.getPlatformRuntime().catch(() => null)]); if (!cancelled) { setOwnerPayload(guilds); setRuntimePayload(runtime?.runtime || null); } }
      catch (loadError) { if (!cancelled) { setError(loadError.message || 'Failed to load Owner View.'); setOwnerPayload(null); setRuntimePayload(null); } }
      finally { if (!cancelled) setLoading(false); }
    }
    load(); return () => { cancelled = true; };
  }, [isOwner]);
  const guilds = useMemo(() => Array.isArray(ownerPayload?.guilds) ? ownerPayload.guilds : [], [ownerPayload]);
  const stats = useMemo(() => { const result = { guilds: guilds.length, members: 0, connected: 0, missing: 0, dev: 0, beta: 0, production: 0 }; guilds.forEach((guild) => { result.members += Number(guild.memberCount || 0); if (connected(guild)) result.connected += 1; else result.missing += 1; const env = environment(guild); if (env === 'DEV') result.dev += 1; if (env === 'BETA') result.beta += 1; if (env === 'PRODUCTION') result.production += 1; }); return result; }, [guilds]);
  if (!isOwner) return <section style={card(viewTheme, { padding: 24 })}><h1 style={{ margin: '0 0 8px', fontSize: 26 }}>Owner View</h1><p style={{ margin: 0, color: viewTheme.mutedText }}>You do not have permission to view this page.</p></section>;
  return <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
    <section style={card(viewTheme, { padding: 'clamp(18px, 2.4vw, 24px)', background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.06) 45%, rgba(168,85,247,0.12))' })}><p style={{ margin: '0 0 8px', color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Owner View</p><h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em', lineHeight: 1 }}>👑 Goliath Command Centre</h1><p style={{ margin: '10px 0 0', color: viewTheme.mutedText, lineHeight: 1.55, maxWidth: 820 }}>Platform-level operations across guilds, runtime environments, security, tickets, forms, translation, backups and deployments.</p></section>
    {error ? <section style={card(viewTheme, { padding: 16, color: '#fca5a5' })}>{error}</section> : null}{loading ? <section style={card(viewTheme, { padding: 16, color: viewTheme.mutedText })}>Loading command centre...</section> : null}
    <OwnerCommandCentrePanel theme={viewTheme} guilds={guilds} runtime={runtimePayload || {}} realtimeEvents={[]} onOpenRoute={(route) => window.location.assign(route)} />
    <OwnerAnalyticsPanel theme={viewTheme} guilds={guilds} runtime={runtimePayload || {}} />
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}><Stat theme={viewTheme} label="Total Servers" value={formatNumber(stats.guilds)} hint="registered guilds" accent="#60a5fa" /><Stat theme={viewTheme} label="Members" value={formatNumber(stats.members)} hint="visible members" accent="#34d399" /><Stat theme={viewTheme} label="Connected" value={formatNumber(stats.connected)} hint={`${stats.missing} missing`} accent="#22c55e" /><Stat theme={viewTheme} label="DEV" value={formatNumber(stats.dev)} hint="development" accent="#60a5fa" /><Stat theme={viewTheme} label="BETA" value={formatNumber(stats.beta)} hint="staging" accent="#facc15" /><Stat theme={viewTheme} label="PROD" value={formatNumber(stats.production)} hint="live" accent="#22c55e" /></section>
    <GuildTable theme={viewTheme} guilds={guilds} />
  </div>;
}
