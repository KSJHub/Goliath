import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
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
  incidentPackages: [],
  capabilityHealth: {},
  protectedAssets: { enabled: true, roleIds: [], channelIds: [] },
  lockdown: { active: false },
  quarantine: { users: {} },
  emergencyControls: { invites: { active: false }, roles: { active: false } },
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

function parseIds(value = '') {
  return [...new Set(String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
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

function PackageCard({ theme, incidentPackage }) {
  return (
    <div style={{ background: theme.softBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ overflowWrap: 'anywhere' }}>{incidentPackage?.packageId || 'Incident package'}</strong>
        <StatusPill theme={theme} tone={getSeverityTone(incidentPackage?.severity)}>{incidentPackage?.severity || 'low'}</StatusPill>
      </div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>
        Actor: {incidentPackage?.actorTag || incidentPackage?.actorId || 'Unknown'}<br />
        Threat score: {incidentPackage?.threatScore ?? 0}<br />
        Correlated event types: {incidentPackage?.distinctEventTypes ?? 0}<br />
        Audit entry: {incidentPackage?.auditEvidence?.auditEntryId || 'Unavailable'}
      </div>
    </div>
  );
}

function StateRow({ theme, label, children }) {
  return <div style={{ background: theme.softBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ color: theme.cardText, fontWeight: 900 }}>{label}</span>{children}</div>;
}

function MonitorCard({ theme, monitor }) {
  const enabled = monitor?.enabled !== false;
  const status = monitor?.status || (enabled ? 'online' : 'disabled');
  const tone = status === 'active' || status === 'degraded' ? 'danger' : enabled ? 'success' : 'warning';
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{monitor?.label || 'Monitor'}</strong><StatusPill theme={theme} tone={tone}>{status}</StatusPill></div><p style={{ margin: 0, color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{monitor?.description || 'No description available.'}</p></div>;
}

function AdvancedSecurityLock({ theme, entitlements }) {
  return <PremiumLock theme={theme} title={`${E.SECURITY} Advanced Security Center`} featureKey="security.advanced" currentPlan={entitlements?.plan} requiredPlan={{ name: 'Pro', icon: E.CROWN }} message="Core security remains available. Advanced threat analytics, audit intelligence and security trend tooling require Goliath Pro or Lifetime." unlocks={['Threat analytics', 'Security trends', 'Audit intelligence', 'Owner monitoring views', 'Webhook intelligence', 'Cross-incident correlation']} />;
}

export default function Security({ selectedGuild, selectedGuildId, theme, guilds = [] }) {
  const activeGuildId = getGuildId(selectedGuildId || selectedGuild);
  const [loading, setLoading] = useState(true);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [entitlements, setEntitlements] = useState(null);
  const [data, setData] = useState(INITIAL_STATE);
  const [protectedRoleInput, setProtectedRoleInput] = useState('');
  const [protectedChannelInput, setProtectedChannelInput] = useState('');
  const [protectedSaving, setProtectedSaving] = useState(false);
  const [protectedMessage, setProtectedMessage] = useState('');

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

  async function saveProtectedAssets() {
    if (!activeGuildId) return;
    setProtectedSaving(true);
    setProtectedMessage('');
    try {
      const result = await api.saveSecurityProtectedAssets(activeGuildId, {
        enabled: true,
        roleIds: parseIds(protectedRoleInput),
        channelIds: parseIds(protectedChannelInput),
      });
      setProtectedRoleInput((result.roleIds || []).join('\n'));
      setProtectedChannelInput((result.channelIds || []).join('\n'));
      setProtectedMessage('Protected assets saved. Goliath will apply a higher threat score when these roles or channels are targeted.');
      await loadSecurityOverview();
    } catch (error) {
      setProtectedMessage(error.message || 'Unable to save protected assets. Only the Discord server owner can change this list.');
    } finally {
      setProtectedSaving(false);
    }
  }

  useEffect(() => { loadSecurityOverview(); }, [activeGuildId]);

  useEffect(() => {
    setProtectedRoleInput((data.protectedAssets?.roleIds || []).join('\n'));
    setProtectedChannelInput((data.protectedAssets?.channelIds || []).join('\n'));
  }, [activeGuildId, data.protectedAssets?.roleIds, data.protectedAssets?.channelIds]);

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
  const incidentPackages = Array.isArray(data.incidentPackages) ? data.incidentPackages : [];
  const threatAccent = getThreatAccent(theme, data.threatLevel);
  const lockdownActive = Boolean(data.lockdown?.active);
  const inviteFreezeActive = Boolean(data.emergencyControls?.invites?.active);
  const roleFreezeActive = Boolean(data.emergencyControls?.roles?.active);
  const capabilityHealthy = data.capabilityHealth?.healthy !== false;
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
        <SummaryStat theme={theme} label="Forensic Packages" value={incidentPackages.length} description="Correlated audit evidence" />
        <SummaryStat theme={theme} label="Lockdown" value={lockdownActive ? 'ACTIVE' : 'Inactive'} accent={lockdownActive ? theme.danger || '#ef4444' : theme.success || '#22c55e'} description="Emergency protection" />
        <SummaryStat theme={theme} label="Response Health" value={capabilityHealthy ? 'Healthy' : 'DEGRADED'} accent={capabilityHealthy ? theme.success || '#22c55e' : theme.danger || '#ef4444'} description="Permissions and hierarchy" />
        <SummaryStat theme={theme} label="Quarantined" value={quarantineCount} accent={quarantineCount > 0 ? theme.warning || '#f59e0b' : theme.success || '#22c55e'} description="Users currently isolated" />
      </StatGrid>

      {!capabilityHealthy ? <Notice theme={theme} tone="danger">Goliath security response capability is degraded. Missing permissions: {(data.capabilityHealth?.missingPermissions || []).join(', ') || 'none listed'}{data.capabilityHealth?.hierarchyDegraded ? `. Role hierarchy is blocked by ${data.capabilityHealth?.blockingRoleName || data.capabilityHealth?.blockingRoleId || 'a higher privileged role'}.` : '.'}</Notice> : null}

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
              <StateRow theme={theme} label="Invite Freeze"><StatusPill theme={theme} tone={inviteFreezeActive ? 'danger' : 'success'}>{inviteFreezeActive ? 'Active' : 'Standby'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Role Freeze"><StatusPill theme={theme} tone={roleFreezeActive ? 'danger' : 'success'}>{roleFreezeActive ? 'Active' : 'Standby'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Threat Correlation"><StatusPill theme={theme} tone={data.monitors?.threatCorrelation?.enabled === false ? 'warning' : 'success'}>{data.monitors?.threatCorrelation?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Response Capability"><StatusPill theme={theme} tone={capabilityHealthy ? 'success' : 'danger'}>{capabilityHealthy ? 'Healthy' : 'Degraded'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Anti-Nuke"><StatusPill theme={theme} tone={data.monitors?.antiNuke?.enabled === false ? 'warning' : 'success'}>{data.monitors?.antiNuke?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Webhook Monitor"><StatusPill theme={theme} tone={data.monitors?.webhooks?.enabled === false ? 'warning' : 'success'}>{data.monitors?.webhooks?.status || 'online'}</StatusPill></StateRow>
              <StateRow theme={theme} label="Audit Log Health"><StatusPill theme={theme} tone={data.monitors?.auditLog?.status === 'degraded' ? 'danger' : 'success'}>{data.monitors?.auditLog?.status || 'online'}</StatusPill></StateRow>
            </div>
          </SectionCard>

          <SectionCard theme={theme} title="Automatic Emergency Response" subtitle="Goliath escalates protection according to incident severity and correlated actor behaviour.">
            <Notice theme={theme} tone="info">LOW: log and monitor. MEDIUM: owner alert. HIGH: emergency backup and Full Security Isolation. CRITICAL: backup, Full Security Isolation, lockdown, invite freeze, role freeze, owner alert, then post-incident backup. Multiple different dangerous actions by one actor within 60 seconds increase the threat score automatically.</Notice>
          </SectionCard>
        </div>
      </div>

      <SectionCard theme={theme} title="Protected Security Assets" subtitle="Server-owner controlled. Targeting these roles or channels receives a much higher threat score.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
          <label style={{ display: 'grid', gap: 7, color: theme.cardText, fontWeight: 800 }}>
            Protected Role IDs
            <textarea value={protectedRoleInput} onChange={(event) => setProtectedRoleInput(event.target.value)} rows={5} placeholder="One role ID per line" style={{ width: '100%', borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, padding: 12, resize: 'vertical' }} />
          </label>
          <label style={{ display: 'grid', gap: 7, color: theme.cardText, fontWeight: 800 }}>
            Protected Channel IDs
            <textarea value={protectedChannelInput} onChange={(event) => setProtectedChannelInput(event.target.value)} rows={5} placeholder="One channel ID per line" style={{ width: '100%', borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, padding: 12, resize: 'vertical' }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" disabled={protectedSaving} onClick={saveProtectedAssets} style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 12, padding: '10px 14px', fontWeight: 900 }}>{protectedSaving ? 'Saving...' : 'Save Protected Assets'}</button>
          <span style={{ color: theme.mutedText, fontSize: 13 }}>Goliath's own bot role is protected automatically and does not need to be entered.</span>
        </div>
        {protectedMessage ? <div style={{ marginTop: 10, color: theme.mutedText, fontSize: 13, fontWeight: 700 }}>{protectedMessage}</div> : null}
      </SectionCard>

      <SectionCard theme={theme} title="Forensic Incident Packages" subtitle="Serious correlated security events retain actor, audit-log evidence, threat session and automatic response details.">
        {incidentPackages.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12 }}>{incidentPackages.slice(0, 12).map((incidentPackage) => <PackageCard key={incidentPackage.packageId} theme={theme} incidentPackage={incidentPackage} />)}</div> : <EmptyState theme={theme} text="No correlated incident packages have been created." />}
      </SectionCard>

      {entitlementsLoading ? <LoadingPanel theme={theme} text="Checking Advanced Security access..." /> : null}
      {hasAdvancedSecurity ? <SectionCard theme={theme} title="Advanced Security Intelligence" subtitle="Pro-level security insights for this guild."><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}><StateRow theme={theme} label="Threat Analytics"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Audit Intelligence"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Webhook Intelligence"><StatusPill theme={theme} tone="success">Unlocked</StatusPill></StateRow><StateRow theme={theme} label="Cross-Incident Correlation"><StatusPill theme={theme} tone="success">Active</StatusPill></StateRow></div></SectionCard> : <AdvancedSecurityLock theme={theme} entitlements={entitlements} />}
    </PageShell>
  );
}
