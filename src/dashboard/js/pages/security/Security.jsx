import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import { joinGuildRoom, listenForGuildUpdate } from '../../services/socketClient';
import PremiumLock from '../../shared/PremiumLock.jsx';
import PageShell, { SectionCard, StatGrid, SummaryStat, EmptyState, LoadingPanel, Notice } from '../../shared/PageShell';

const INITIAL_STATE = {
  ok: true,
  threatLevel: 'low',
  protectionScore: 100,
  protectionStatus: 'protected',
  incidents: { total: 0, critical: 0, high: 0, webhook: 0, recent: [] },
  lockdown: { active: false },
  quarantine: { users: {} },
  protectionModules: [],
  monitors: {},
};

function getGuildId(guild) {
  if (!guild) return '';
  if (typeof guild === 'string' || typeof guild === 'number') return String(guild).trim();
  return String(guild.id || guild.guildId || '').trim();
}

function getGuildAvatar(guild) {
  return guild?.iconUrl || guild?.iconURL || guild?.avatarUrl || guild?.image || '';
}

function getThreatAccent(theme, level = 'low') {
  const normalized = String(level || 'low').toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return theme.danger || '#ef4444';
  if (normalized === 'medium') return theme.warning || '#f59e0b';
  return theme.success || '#22c55e';
}

function getSeverityTone(severity = 'low') {
  const normalized = String(severity || 'low').toLowerCase();
  if (normalized === 'critical' || normalized === 'high') return 'danger';
  if (normalized === 'medium') return 'warning';
  return 'success';
}

function scoreAccent(score = 100) {
  if (Number(score) >= 90) return '#22c55e';
  if (Number(score) >= 70) return '#f59e0b';
  return '#ef4444';
}

function hasFeature(entitlements, featureKey) {
  return Array.isArray(entitlements?.features) && entitlements.features.includes(featureKey);
}

function StatusPill({ theme, tone = 'info', children }) {
  const tones = {
    info: { bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.28)', text: '#bfdbfe' },
    success: { bg: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.28)', text: theme.successText || '#86efac' },
    warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.28)', text: theme.warningText || '#fcd34d' },
    danger: { bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.30)', text: theme.dangerText || '#fca5a5' },
  };
  const current = tones[tone] || tones.info;
  return <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '5px 10px', borderRadius: 999, border: `1px solid ${current.border}`, background: current.bg, color: current.text, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{children}</span>;
}

function IncidentCard({ theme, incident }) {
  const severity = incident?.severity || 'low';
  const tone = getSeverityTone(severity);
  return (
    <div style={{ background: theme.softBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: theme.cardText, fontSize: 15, fontWeight: 900, overflowWrap: 'anywhere' }}>{incident?.type || 'Unknown Incident'}</div>
          <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45, fontWeight: 600, overflowWrap: 'anywhere' }}>{incident?.reason || 'No reason provided'}</div>
        </div>
        <StatusPill theme={theme} tone={tone}>{severity}</StatusPill>
      </div>
      {incident?.timestamp ? <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 700 }}>{incident.timestamp}</div> : null}
    </div>
  );
}

function StateRow({ theme, label, children }) {
  return <div style={{ background: theme.softBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ color: theme.cardText, fontWeight: 900 }}>{label}</span>{children}</div>;
}

function MonitorCard({ theme, monitor }) {
  const enabled = monitor?.enabled !== false;
  const status = monitor?.status || (enabled ? 'online' : 'disabled');
  const tone = status === 'active' ? 'danger' : enabled ? 'success' : 'warning';
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{monitor?.label || 'Monitor'}</strong><StatusPill theme={theme} tone={tone}>{status}</StatusPill></div><p style={{ margin: 0, color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{monitor?.description || 'No description available.'}</p></div>;
}

function AdvancedSecurityLock({ theme, entitlements }) {
  return <PremiumLock theme={theme} title="🛡️ Advanced Security Center" featureKey="security.advanced" currentPlan={entitlements?.plan} requiredPlan={{ name: 'Pro', icon: '👑' }} message="Core security remains available. Advanced threat analytics, audit intelligence and security trend tooling require Goliath Pro or Lifetime." unlocks={['Threat analytics', 'Security trends', 'Audit intelligence', 'Owner monitoring views', 'Webhook intelligence', 'Cross-incident correlation']} />;
}

export default function Security({ selectedGuild, selectedGuildId, theme, guilds = [] }) {
  const activeGuildId = getGuildId(selectedGuildId || selectedGuild);
  const [loading, setLoading] = useState(true);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [entitlements, setEntitlements] = useState(null);
  const [data, setData] = useState(INITIAL_STATE);

  const selectedGuildData = useMemo(() => guilds.find((guild) => String(guild.id) === activeGuildId) || null, [guilds, activeGuildId]);
  const pageGuild = useMemo(() => ({ id: activeGuildId, name: selectedGuildData?.name || 'Security Center', iconUrl: getGuildAvatar(selectedGuildData) }), [activeGuildId, selectedGuildData]);
  const hasAdvancedSecurity = hasFeature(entitlements, 'security.advanced');

  async function loadSecurityOverview() {
    if (!activeGuildId) {
      setLoading(false);
      setData({ ok: false, error: 'Select a server first.' });
      return;
    }
    try {
      setLoading(true);
      const result = await api.getSecurityOverview(activeGuildId);
      setData({ ...INITIAL_STATE, ...result });
    } catch (error) {
      console.error('[Security] Failed to load:', error);
      setData({ ok: false, error: error.message || 'Failed to load security data.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSecurityOverview(); }, [activeGuildId]);

  useEffect(() => {
    if (!activeGuildId) return;
    let cancelled = false;
    async function loadEntitlements() {
      setEntitlementsLoading(true);
      try {
        const payload = await api.getBillingEntitlements(activeGuildId);
        if (!cancelled) setEntitlements(payload);
      } catch (error) {
        console.error('[Security] Failed to load entitlements:', error);
        if (!cancelled) setEntitlements(null);
      } finally {
        if (!cancelled) setEntitlementsLoading(false);
      }
    }
    loadEntitlements();
    return () => { cancelled = true; };
  }, [activeGuildId]);

  useEffect(() => {
    if (!activeGuildId) return undefined;
    joinGuildRoom(activeGuildId);
    return listenForGuildUpdate('security', (update) => {
      if (!update) return;
      if (update.type === 'security:event' && update.incident) {
        setData((previous) => {
          const incidents = previous?.incidents || {};
          const recent = Array.isArray(incidents.recent) ? incidents.recent : [];
          return { ...previous, threatLevel: update.incident.severity || previous.threatLevel, incidents: { ...incidents, total: Number(incidents.total || 0) + 1, critical: update.incident.severity === 'critical' ? Number(incidents.critical || 0) + 1 : Number(incidents.critical || 0), recent: [update.incident, ...recent].slice(0, 25) } };
        });
      }
      if (update.type === 'security:lockdown') setData((previous) => ({ ...previous, lockdown: { ...(previous.lockdown || {}), ...(update.lockdown || {}) } }));
      if (update.type === 'security:quarantine') setData((previous) => ({ ...previous, quarantine: { ...(previous.quarantine || {}), ...(update.quarantine || {}) } }));
    });
  }, [activeGuildId]);

  const quarantineCount = Number(data.quarantineCount ?? Object.keys(data.quarantine?.users || {}).length);
  const recentIncidents = Array.isArray(data.incidents?.recent) ? data.incidents.recent : [];
  const threatAccent = getThreatAccent(theme, data.threatLevel);
  const lockdownActive = Boolean(data.lockdown?.active);
  const protectionScore = Number(data.protectionScore ?? 100);
  const monitors = Object.values(data.monitors || {}).filter(Boolean);
  const protectionModules = data.protectionModules?.length ? data.protectionModules : monitors;

  if (loading) return <PageShell title="Security Center" subtitle="Loading live Goliath protection overview." theme={theme} guild={pageGuild}><LoadingPanel theme={theme} text="Loading security overview..." /></PageShell>;
  if (!data?.ok) return <PageShell title="Security Center" subtitle="Live Goliath protection overview." theme={theme} guild={pageGuild}><Notice theme={theme} tone="danger">{data?.error || 'Failed to load security data.'}</Notice></PageShell>;

  return (
    <PageShell title="Security Center" subtitle="Live Goliath protection overview, monitor state, incident intelligence, lockdown and quarantine activity." theme={theme} guild={pageGuild} actions={<><StatusPill theme={theme} tone="success">Live</StatusPill><button type="button" onClick={loadSecurityOverview} style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 12, padding: '9px 12px', fontWeight: 900 }}>Refresh</button></>}>
      <StatGrid min="min(180px, 100%)">
        <SummaryStat theme={theme} label="Protection Score" value={`${protectionScore}%`} accent={scoreAccent(protectionScore)} description={data.protectionStatus || 'protected'} />
        <SummaryStat theme={theme} label="Threat Level" value={data.threatLevel || 'low'} accent={threatAccent} description="Current live security level" />
        <SummaryStat theme={theme} label="Total Incidents" value={data.incidents?.total || 0} description="Detected security events" />
        <SummaryStat theme={theme} label="Critical" value={data.incidents?.critical || 0} accent={theme.danger || '#ef4444'} description="Highest severity events" />
        <SummaryStat theme={theme} label="Webhook Events" value={data.incidents?.webhook || 0} accent="#60a5fa" description="Webhook-related incidents" />
        <SummaryStat theme={theme} label="Lockdown" value={lockdownActive ? 'ACTIVE' : 'Inactive'} accent={lockdownActive ? theme.danger || '#ef4444' : theme.success || '#22c55e'} description="Emergency protection" />
        <SummaryStat theme={theme} label="Quarantined" value={quarantineCount} accent={quarantineCount > 0 ? theme.warning || '#f59e0b' : theme.success || '#22c55e'} description="Users currently isolated" />
      </StatGrid>

      <SectionCard theme={theme} title="Protection Monitors" subtitle="Live status from the Goliath security engine.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>{protectionModules.length ? protectionModules.map((monitor) => <MonitorCard key={monitor.key} theme={theme} monitor={monitor} />) : <EmptyState theme={theme} text="No monitor state returned yet." />}</div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 'clamp(16px, 3vw, 24px)', alignItems: 'start' }}>
        <SectionCard theme={theme} title="Live Security Feed" subtitle="Realtime incidents pushed from the Goliath security engine." actions={<StatusPill theme={theme} tone="success">Live Socket</StatusPill>}>
          {recentIncidents.length ? <div style={{ display: 'grid', gap: 12 }}>{recentIncidents.map((incident, index) => <IncidentCard key={incident.id || incident.caseId || index} theme={theme} incident={incident} />)}</div> : <EmptyState theme={theme} text="No incidents detected." />}
        </SectionCard>

        <div style={{ display: 'grid', gap: 'clamp(16px, 3vw, 24px)' }}>
          <SectionCard theme={theme} title="Security State" subtitle="Current protection state for this guild.">
            <div style={{ display: 'grid', gap: 12 }}>
              <StateRow theme={theme} label="Lockdown"><StatusPill theme={theme} tone={lockdownActive ? 'danger' : 'success'}>{lockdownActive ? 'Active' : 'Inactive'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Quarantine"><StatusPill theme={theme} tone={quarantineCount > 0 ? 'warning' : 'success'}>{quarantineCount} Users</StatusPill></StateRow>
              <StateRow theme={theme} label="Anti-Nuke"><StatusPill theme={theme} tone={data.monitors?.antiNuke?.enabled === false ? 'warning' : 'success'}>{data.monitors?.antiNuke?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Webhook Monitor"><StatusPill theme={theme} tone={data.monitors?.webhooks?.enabled === false ? 'warning' : 'success'}>{data.monitors?.webhooks?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Owner Monitoring"><StatusPill theme={theme} tone={data.monitors?.ownerMonitoring?.enabled === false ? 'warning' : 'success'}>{data.monitors?.ownerMonitoring?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Audit Log Health"><StatusPill theme={theme} tone={data.monitors?.auditLog?.enabled === false ? 'warning' : 'success'}>{data.monitors?.auditLog?.status || 'online'}</StatusPill></StateRow>
            </div>
          </SectionCard>

          <SectionCard theme={theme} title="Emergency Actions" subtitle="Core emergency controls remain available to all plans.">
            <Notice theme={theme} tone="info">Controls planned: trigger lockdown, release lockdown, review quarantine, and restore protected permissions.</Notice>
          </SectionCard>
        </div>
      </div>

      {entitlementsLoading ? <LoadingPanel theme={theme} text="Checking Advanced Security access..." /> : null}
      {hasAdvancedSecurity ? <SectionCard theme={theme} title="Advanced Security Intelligence" subtitle="Pro-level security insights for this guild."><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}><StateRow theme={theme} label="Threat Analytics"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Audit Intelligence"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Webhook Intelligence"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Owner Monitoring"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow></div></SectionCard> : <AdvancedSecurityLock theme={theme} entitlements={entitlements} />}
    </PageShell>
  );
}
