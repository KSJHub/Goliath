import React, { useMemo } from 'react';

const FALLBACK_THEME = {
  mode: 'dark',
  cardBorder: 'rgba(148,163,184,0.22)',
  cardBg: 'rgba(15,23,42,0.42)',
  cardText: '#e5e7eb',
  mutedText: '#94a3b8',
  shadow: '0 18px 50px rgba(0,0,0,0.25)',
};

function safeTheme(theme) {
  return { ...FALLBACK_THEME, ...(theme || {}) };
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function num(value = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function envOf(guild = {}) {
  return String(guild.environment || guild.runtimeMode || 'UNKNOWN').toUpperCase();
}

function connected(guild = {}) {
  return Boolean(guild.botConnected || guild.connected || guild.isConnected);
}

function formatNumber(value = 0) {
  return num(value).toLocaleString();
}

function toneForScore(score) {
  if (score >= 85) return '#86efac';
  if (score >= 65) return '#fcd34d';
  return '#fca5a5';
}

function card(theme, extra = {}) {
  const viewTheme = safeTheme(theme);
  return {
    border: `1px solid ${viewTheme.cardBorder}`,
    background: 'rgba(15,23,42,0.24)',
    borderRadius: 16,
    padding: 14,
    display: 'grid',
    gap: 8,
    minWidth: 0,
    ...extra,
  };
}

function calculateScore({ guilds, runtime, realtimeEvents }) {
  const environments = arr(runtime?.environments);
  const offlineEnv = environments.filter((env) => String(env.status || '').toLowerCase() === 'offline').length;
  const degradedEnv = environments.filter((env) => String(env.status || '').toLowerCase() === 'degraded').length;
  const missingGuilds = guilds.filter((guild) => !connected(guild)).length;
  const securityEvents = arr(realtimeEvents).filter((event) => String(event.event || event.type || '').toLowerCase().startsWith('security')).length;
  const highLatency = environments.filter((env) => num(env.discord?.wsPing) > 300).length;

  let score = 100;
  score -= offlineEnv * 18;
  score -= degradedEnv * 9;
  score -= missingGuilds * 4;
  score -= Math.min(20, securityEvents * 2);
  score -= highLatency * 5;
  return Math.max(0, Math.min(100, score));
}

function Stat({ theme, label, value, hint, accent = '#93c5fd' }) {
  const viewTheme = safeTheme(theme);
  return (
    <div style={card(viewTheme)}>
      <span style={{ color: viewTheme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <strong style={{ color: accent, fontSize: 25 }}>{value}</strong>
      {hint ? <span style={{ color: viewTheme.mutedText, fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

function Alert({ theme, level, title, detail, actionLabel, onAction }) {
  const viewTheme = safeTheme(theme);
  const tone = level === 'danger' ? '#fca5a5' : level === 'warning' ? '#fcd34d' : '#86efac';
  return (
    <div style={{ border: `1px solid ${tone}55`, background: `${tone}12`, borderRadius: 13, padding: 11, display: 'grid', gap: 5 }}>
      <strong style={{ color: tone }}>{title}</strong>
      <span style={{ color: viewTheme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{detail}</span>
      {actionLabel ? <button type="button" onClick={onAction} style={{ justifySelf: 'start', border: `1px solid ${tone}66`, background: 'rgba(15,23,42,0.35)', color: tone, borderRadius: 10, padding: '7px 9px', fontWeight: 900, cursor: 'pointer' }}>{actionLabel}</button> : null}
    </div>
  );
}

function EnvRow({ theme, label, count, members, accent }) {
  const viewTheme = safeTheme(theme);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, borderBottom: `1px solid ${viewTheme.cardBorder}`, padding: '8px 0' }}>
      <strong style={{ color: accent }}>{label}</strong>
      <span style={{ color: viewTheme.cardText, fontWeight: 950 }}>{count}</span>
      <span style={{ gridColumn: '1 / -1', color: viewTheme.mutedText, fontSize: 12 }}>{formatNumber(members)} members</span>
    </div>
  );
}

export default function OwnerCommandCentrePanel({ theme, guilds = [], runtime = {}, realtimeEvents = [], onOpenRoute }) {
  const viewTheme = safeTheme(theme);
  const data = useMemo(() => {
    const allGuilds = arr(guilds);
    const environments = arr(runtime?.environments);
    const byEnv = {
      DEV: { count: 0, members: 0, accent: '#60a5fa' },
      BETA: { count: 0, members: 0, accent: '#facc15' },
      PRODUCTION: { count: 0, members: 0, accent: '#22c55e' },
      UNKNOWN: { count: 0, members: 0, accent: '#94a3b8' },
    };

    allGuilds.forEach((guild) => {
      const env = byEnv[envOf(guild)] ? envOf(guild) : 'UNKNOWN';
      byEnv[env].count += 1;
      byEnv[env].members += num(guild.memberCount);
    });

    const offlineEnv = environments.filter((env) => String(env.status || '').toLowerCase() === 'offline');
    const degradedEnv = environments.filter((env) => String(env.status || '').toLowerCase() === 'degraded');
    const missingGuilds = allGuilds.filter((guild) => !connected(guild));
    const securityEvents = arr(realtimeEvents).filter((event) => String(event.event || event.type || '').toLowerCase().startsWith('security'));
    const ticketEvents = arr(realtimeEvents).filter((event) => String(event.event || event.type || '').toLowerCase().startsWith('ticket'));
    const formEvents = arr(realtimeEvents).filter((event) => String(event.event || event.type || '').toLowerCase().startsWith('form'));
    const translationEvents = arr(realtimeEvents).filter((event) => String(event.event || event.type || '').toLowerCase().startsWith('translation'));
    const score = calculateScore({ guilds: allGuilds, runtime, realtimeEvents });

    const alerts = [];
    if (offlineEnv.length) alerts.push({ level: 'danger', title: 'Environment offline', detail: `${offlineEnv.map((env) => env.environment || env.mode).join(', ')} unavailable from Owner runtime.`, actionLabel: 'Runtime', route: '/owner/runtime' });
    if (degradedEnv.length) alerts.push({ level: 'warning', title: 'Environment degraded', detail: `${degradedEnv.length} environment${degradedEnv.length === 1 ? '' : 's'} reporting degraded state.`, actionLabel: 'Runtime', route: '/owner/runtime' });
    if (missingGuilds.length) alerts.push({ level: 'warning', title: 'Guild connection gaps', detail: `${missingGuilds.length} guild${missingGuilds.length === 1 ? '' : 's'} marked missing/disconnected.`, actionLabel: 'Servers', route: '/owner/servers' });
    if (securityEvents.length) alerts.push({ level: 'warning', title: 'Security activity', detail: `${securityEvents.length} security event${securityEvents.length === 1 ? '' : 's'} in the live feed.`, actionLabel: 'Security', route: '/owner/security' });
    if (!alerts.length) alerts.push({ level: 'success', title: 'Platform stable', detail: 'No command-centre alerts detected from the current owner payload.', actionLabel: null });

    return { byEnv, offlineEnv, degradedEnv, missingGuilds, securityEvents, ticketEvents, formEvents, translationEvents, score, alerts };
  }, [guilds, runtime, realtimeEvents]);

  const scoreTone = toneForScore(data.score);

  return (
    <section style={{ border: `1px solid ${viewTheme.cardBorder}`, background: viewTheme.cardBg, color: viewTheme.cardText, borderRadius: 22, padding: 20, boxShadow: viewTheme.shadow, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: viewTheme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Owner View</div>
          <h3 style={{ margin: '6px 0 0' }}>Command Centre Summary</h3>
          <p style={{ margin: '8px 0 0', color: viewTheme.mutedText, lineHeight: 1.5 }}>A single operational snapshot for servers, environments, live activity and platform alerts.</p>
        </div>
        <div style={{ border: `1px solid ${scoreTone}66`, background: `${scoreTone}12`, borderRadius: 16, padding: '12px 16px', textAlign: 'center', minWidth: 130 }}>
          <div style={{ color: viewTheme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Platform Score</div>
          <strong style={{ display: 'block', color: scoreTone, fontSize: 34, lineHeight: 1, marginTop: 6 }}>{data.score}</strong>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10 }}>
        <Stat theme={viewTheme} label="Guilds" value={formatNumber(arr(guilds).length)} hint="known servers" />
        <Stat theme={viewTheme} label="Offline Envs" value={data.offlineEnv.length} hint="DEV/BETA/PROD" accent={data.offlineEnv.length ? '#fca5a5' : '#86efac'} />
        <Stat theme={viewTheme} label="Disconnected" value={data.missingGuilds.length} hint="guild gaps" accent={data.missingGuilds.length ? '#fcd34d' : '#86efac'} />
        <Stat theme={viewTheme} label="Tickets" value={data.ticketEvents.length} hint="live events" accent="#60a5fa" />
        <Stat theme={viewTheme} label="Forms" value={data.formEvents.length} hint="live events" accent="#c084fc" />
        <Stat theme={viewTheme} label="Security" value={data.securityEvents.length} hint="live events" accent={data.securityEvents.length ? '#fca5a5' : '#86efac'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
        <div style={card(viewTheme)}>
          <strong>Environment Footprint</strong>
          <EnvRow theme={viewTheme} label="DEV" count={data.byEnv.DEV.count} members={data.byEnv.DEV.members} accent={data.byEnv.DEV.accent} />
          <EnvRow theme={viewTheme} label="BETA" count={data.byEnv.BETA.count} members={data.byEnv.BETA.members} accent={data.byEnv.BETA.accent} />
          <EnvRow theme={viewTheme} label="PRODUCTION" count={data.byEnv.PRODUCTION.count} members={data.byEnv.PRODUCTION.members} accent={data.byEnv.PRODUCTION.accent} />
        </div>

        <div style={card(viewTheme)}>
          <strong>Command Alerts</strong>
          {data.alerts.map((alert, index) => (
            <Alert
              key={`${alert.title}-${index}`}
              theme={viewTheme}
              {...alert}
              onAction={alert.route ? () => onOpenRoute?.(alert.route) : undefined}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['Runtime', '/owner/runtime'], ['Security', '/owner/security'], ['Tickets', '/owner/tickets'], ['Forms', '/owner/forms'], ['Translation', '/owner/translation'], ['Backups', '/owner/backups'], ['Deployments', '/owner/deployments']].map(([label, route]) => (
          <button key={route} type="button" onClick={() => onOpenRoute?.(route)} style={{ border: `1px solid ${viewTheme.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: viewTheme.cardText, borderRadius: 12, padding: '9px 11px', fontWeight: 950, cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
    </section>
  );
}
