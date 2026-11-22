import { ThemedSelect } from '../../../ui/DiscordResourceSelects.jsx';
import React, { useMemo, useState } from 'react';

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function severityTone(severity = '') {
  const clean = String(severity || '').toLowerCase();
  if (['critical', 'danger', 'high'].includes(clean)) return '#fca5a5';
  if (['warning', 'medium', 'elevated'].includes(clean)) return '#fcd34d';
  if (['low', 'info', 'normal'].includes(clean)) return '#93c5fd';
  return '#86efac';
}

function threatTone(threat = '') {
  const clean = String(threat || '').toLowerCase();
  if (['critical', 'high'].includes(clean)) return '#fca5a5';
  if (['medium', 'elevated'].includes(clean)) return '#fcd34d';
  if (['low', 'normal', 'protected'].includes(clean)) return '#86efac';
  return '#93c5fd';
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function card(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.24)',
    borderRadius: 16,
    padding: 14,
    display: 'grid',
    gap: 8,
    minWidth: 0,
  };
}

function calcScore({ incidents, critical, lockdowns, quarantined, webhookEvents }) {
  let score = 100;
  score -= Number(critical || 0) * 18;
  score -= Number(lockdowns || 0) * 16;
  score -= Number(quarantined || 0) * 8;
  score -= Number(webhookEvents || 0) * 6;
  score -= Math.min(25, Number(incidents || 0) * 2);
  return Math.max(0, Math.min(100, score));
}

function scoreTone(score) {
  if (score >= 85) return '#86efac';
  if (score >= 65) return '#fcd34d';
  return '#fca5a5';
}

function Stat({ theme, label, value, hint, accent = '#93c5fd' }) {
  return (
    <div style={card(theme)}>
      <span style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <strong style={{ color: accent, fontSize: 25 }}>{value}</strong>
      {hint ? <span style={{ color: theme.mutedText, fontSize: 12 }}>{hint}</span> : null}
    </div>
  );
}

function GuildRiskRow({ theme, guild }) {
  const tone = threatTone(guild.threatLevel);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'center', borderBottom: `1px solid ${theme.cardBorder}`, padding: '9px 0' }}>
      <strong style={{ overflowWrap: 'anywhere' }}>{guild.guildName || guild.name || guild.guildId}</strong>
      <span style={{ color: theme.mutedText, fontSize: 12 }}>{guild.environment || 'ENV'}</span>
      <span style={{ color: tone, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{guild.threatLevel || 'unknown'}</span>
      <span style={{ gridColumn: '1 / -1', color: theme.mutedText, fontSize: 12 }}>Incidents: {guild.incidentCount || 0} · Critical: {guild.criticalIncidents || 0} · Lockdown: {guild.lockdownActive ? 'active' : 'off'} · Quarantine: {guild.quarantinedCount || 0}</span>
    </div>
  );
}

function IncidentRow({ theme, incident }) {
  const tone = severityTone(incident.severity || incident.level);
  return (
    <div style={{ border: `1px solid ${tone}55`, background: `${tone}12`, borderRadius: 13, padding: 11, display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ color: tone }}>{incident.type || incident.eventType || incident.action || 'Security Event'}</strong>
        <span style={{ color: tone, fontSize: 12, fontWeight: 950, textTransform: 'uppercase' }}>{incident.severity || incident.level || 'info'}</span>
      </div>
      <span style={{ color: theme.mutedText, fontSize: 13 }}>{incident.guildName || incident.guildId || incident.environment || 'Unknown'} · {formatDate(incident.timestamp || incident.createdAt || incident.time)}</span>
      {incident.reason || incident.message || incident.description ? <span style={{ color: theme.cardText, fontSize: 13, lineHeight: 1.45 }}>{incident.reason || incident.message || incident.description}</span> : null}
    </div>
  );
}

function Recommendation({ theme, level, title, detail }) {
  const tone = level === 'danger' ? '#fca5a5' : level === 'warning' ? '#fcd34d' : '#86efac';
  return (
    <div style={{ border: `1px solid ${tone}55`, background: `${tone}12`, borderRadius: 13, padding: 11 }}>
      <strong style={{ color: tone }}>{title}</strong>
      <div style={{ color: theme.mutedText, fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>{detail}</div>
    </div>
  );
}

export default function SecurityPolishPanel({ theme, security = {}, guilds = [], selectedGuildName = 'No guild selected', loading = false, onRefresh }) {
  const [filter, setFilter] = useState('all');

  const data = useMemo(() => {
    const totals = obj(security.totals);
    const securityGuilds = arr(security.guilds).length ? arr(security.guilds) : arr(guilds).map((guild) => ({
      guildId: guild.guildId || guild.id,
      guildName: guild.guildName || guild.name,
      environment: guild.environment || guild.runtimeMode,
      threatLevel: 'unknown',
      incidentCount: 0,
      criticalIncidents: 0,
      lockdownActive: false,
      quarantinedCount: 0,
    }));

    const incidents = [
      ...arr(security.recentIncidents),
      ...arr(security.incidents),
    ].filter(Boolean);
    const lockdowns = arr(security.lockdowns);
    const quarantines = arr(security.quarantines);
    const webhookEvents = arr(security.webhookEvents);
    const channelEvents = arr(security.channelEvents);

    const incidentCount = Number(totals.incidents ?? incidents.length ?? 0);
    const critical = Number(totals.critical ?? incidents.filter((incident) => String(incident.severity || '').toLowerCase() === 'critical').length ?? 0);
    const lockdownCount = Number(totals.lockdowns ?? lockdowns.length ?? securityGuilds.filter((guild) => guild.lockdownActive).length ?? 0);
    const quarantined = Number(totals.quarantinedUsers ?? quarantines.length ?? securityGuilds.reduce((sum, guild) => sum + Number(guild.quarantinedCount || 0), 0));
    const webhookCount = Number(totals.webhookIncidents ?? webhookEvents.length ?? 0);
    const score = calcScore({ incidents: incidentCount, critical, lockdowns: lockdownCount, quarantined, webhookEvents: webhookCount });

    const recommendations = [];
    if (critical) recommendations.push({ level: 'danger', title: 'Critical incidents need review', detail: `${critical} critical incident${critical === 1 ? '' : 's'} detected. Review recent incidents and affected guilds.` });
    if (lockdownCount) recommendations.push({ level: 'danger', title: 'Lockdown active', detail: `${lockdownCount} guild${lockdownCount === 1 ? ' has' : 's have'} lockdown active. Verify this is expected.` });
    if (quarantined) recommendations.push({ level: 'warning', title: 'Quarantine queue active', detail: `${quarantined} user${quarantined === 1 ? '' : 's'} currently quarantined or recorded in quarantine state.` });
    if (webhookCount) recommendations.push({ level: 'warning', title: 'Webhook activity detected', detail: `${webhookCount} webhook-related incident${webhookCount === 1 ? '' : 's'} found. Confirm webhook audit logs are clean.` });
    if (!recommendations.length) recommendations.push({ level: 'success', title: 'Security posture looks clean', detail: 'No active lockdown, quarantine, critical or webhook warnings in the current payload.' });

    const filteredGuilds = securityGuilds.filter((guild) => {
      if (filter === 'all') return true;
      if (filter === 'risky') return Number(guild.incidentCount || 0) || Number(guild.criticalIncidents || 0) || guild.lockdownActive || Number(guild.quarantinedCount || 0);
      if (filter === 'lockdown') return guild.lockdownActive;
      if (filter === 'critical') return Number(guild.criticalIncidents || 0) > 0;
      return String(guild.threatLevel || '').toLowerCase() === filter;
    }).sort((a, b) => Number(b.criticalIncidents || 0) - Number(a.criticalIncidents || 0) || Number(b.incidentCount || 0) - Number(a.incidentCount || 0));

    return { securityGuilds, incidents, lockdownCount, quarantined, webhookCount, channelEvents, incidentCount, critical, score, recommendations, filteredGuilds };
  }, [security, guilds, filter]);

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 20, boxShadow: theme.shadow, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Security Centre</div>
          <h3 style={{ margin: '6px 0 0' }}>Global Security Posture</h3>
          <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Threat score, lockdowns, quarantines, webhook incidents and risky guilds from the current security payload.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: theme.cardText, borderRadius: 12, padding: '10px 12px', fontWeight: 950, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.55 : 1 }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(100%, 220px), 0.42fr) minmax(0, 1fr)', gap: 14 }}>
        <div style={{ ...card(theme), placeItems: 'center', textAlign: 'center' }}>
          <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Security Score</span>
          <strong style={{ color: scoreTone(data.score), fontSize: 56, lineHeight: 1 }}>{data.score}</strong>
          <span style={{ color: theme.mutedText, fontSize: 13 }}>{selectedGuildName}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 145px), 1fr))', gap: 10 }}>
          <Stat theme={theme} label="Guilds" value={data.securityGuilds.length || guilds.length} hint="monitored" />
          <Stat theme={theme} label="Incidents" value={data.incidentCount} hint="recorded" accent={data.incidentCount ? '#fcd34d' : '#86efac'} />
          <Stat theme={theme} label="Critical" value={data.critical} hint="high priority" accent={data.critical ? '#fca5a5' : '#86efac'} />
          <Stat theme={theme} label="Lockdowns" value={data.lockdownCount} hint="active" accent={data.lockdownCount ? '#fca5a5' : '#86efac'} />
          <Stat theme={theme} label="Quarantine" value={data.quarantined} hint="users" accent={data.quarantined ? '#fcd34d' : '#86efac'} />
          <Stat theme={theme} label="Webhooks" value={data.webhookCount} hint="events" accent={data.webhookCount ? '#fcd34d' : '#86efac'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
        <div style={card(theme)}>
          <strong>Recommendations</strong>
          {data.recommendations.map((item, index) => <Recommendation key={`${item.title}-${index}`} theme={theme} {...item} />)}
        </div>

        <div style={card(theme)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong>Guild Risk</strong>
            <ThemedSelect theme={theme} value={filter} onChange={(event) => setFilter(event.target.value)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 10, padding: '7px 9px', fontWeight: 850 }}>
              <option value="all">All</option>
              <option value="risky">Risky</option>
              <option value="critical">Critical</option>
              <option value="lockdown">Lockdown</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </ThemedSelect>
          </div>
          {data.filteredGuilds.length ? data.filteredGuilds.slice(0, 12).map((guild) => <GuildRiskRow key={guild.guildId || guild.id || guild.guildName} theme={theme} guild={guild} />) : <span style={{ color: theme.mutedText }}>No guilds match this risk filter.</span>}
        </div>
      </div>

      <div style={card(theme)}>
        <strong>Recent Security Incidents</strong>
        {data.incidents.length ? data.incidents.slice(0, 10).map((incident, index) => <IncidentRow key={incident.id || `${incident.type}-${index}`} theme={theme} incident={incident} />) : <span style={{ color: theme.mutedText }}>No recent incidents in the current payload.</span>}
      </div>
    </section>
  );
}
