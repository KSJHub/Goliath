import React, { useCallback, useEffect, useState } from 'react';

import Social from './Social.jsx';
import { api } from '../../services/apiClient.js';

const REFRESH_INTERVAL_MS = 30000;

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function stateStyle(state) {
  if (state === 'healthy') return { label: 'Healthy', color: '#86efac', background: 'rgba(22,163,74,.18)', border: '#22c55e' };
  if (state === 'warning' || state === 'attention') return { label: 'Attention', color: '#fde68a', background: 'rgba(217,119,6,.18)', border: '#f59e0b' };
  if (state === 'empty') return { label: 'No Data', color: '#cbd5e1', background: 'rgba(71,85,105,.18)', border: '#64748b' };
  return { label: 'Error', color: '#fca5a5', background: 'rgba(220,38,38,.18)', border: '#ef4444' };
}

function formatInterval(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return 'Unknown';
  if (milliseconds >= 60000 && milliseconds % 60000 === 0) return `${milliseconds / 60000}m`;
  return `${Math.round(milliseconds / 1000)}s`;
}

function RuntimeService({ theme, label, service, intervalKey = 'intervalMs' }) {
  const started = service?.started === true;
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <strong>{label}</strong>
      <span style={{ color: started ? '#86efac' : '#fca5a5', fontWeight: 900 }}>{started ? 'Running' : 'Stopped'}</span>
    </div>
    <small style={{ color: theme.mutedText }}>Interval: {formatInterval(service?.[intervalKey])}</small>
  </div>;
}

function HealthMetric({ theme, label, value }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 4 }}>
    <small style={{ color: theme.mutedText }}>{label}</small>
    <strong style={{ fontSize: 20 }}>{value ?? 0}</strong>
  </div>;
}

export function SocialRuntimeHealthCard({ theme, runtime, health, loading, error, onRefresh }) {
  const issues = Array.isArray(health?.issues) && health.issues.length ? health.issues : (runtime?.issues || []);
  const state = runtime?.state || (health ? (health.healthy ? (issues.length ? 'attention' : 'healthy') : 'error') : null);
  const presentation = stateStyle(state);
  const errorCount = issues.filter((issue) => String(issue?.severity || '').toLowerCase() === 'error').length;
  const warningCount = issues.length - errorCount;

  return <section data-testid="social-runtime-health" style={{ border: `1px solid ${state ? presentation.border : theme.cardBorder}`, background: state ? presentation.background : theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 18, display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0 }}>Social Studio Health</h2>
        <small style={{ color: theme.mutedText }}>Provider, delivery and runtime health from one diagnostics response.</small>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ color: state ? presentation.color : theme.mutedText }}>{loading ? 'Checking…' : state ? presentation.label : 'Unavailable'}</strong>
        <button type="button" onClick={onRefresh} disabled={loading} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.35)', color: theme.cardText, borderRadius: 999, padding: '8px 12px', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .55 : 1 }}>Refresh</button>
      </div>
    </div>

    {error && <div style={{ color: '#fca5a5', fontWeight: 800 }}>{error}</div>}

    {(runtime || health) && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <HealthMetric theme={theme} label="Warnings" value={warningCount} />
        <HealthMetric theme={theme} label="Errors" value={errorCount} />
        <HealthMetric theme={theme} label="Health Score" value={Number.isFinite(Number(health?.score)) ? `${health.score}%` : '—'} />
        <HealthMetric theme={theme} label="Checked" value={health?.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : '—'} />
      </div>
      {runtime && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <RuntimeService theme={theme} label="Scheduler" service={runtime.scheduler} intervalKey="tickIntervalMs" />
        <RuntimeService theme={theme} label="Delivery Queue" service={runtime.queue} />
        <RuntimeService theme={theme} label="Incident Monitor" service={runtime.incidentMonitor} />
      </div>}
      {runtime?.startedAt && <div style={{ color: theme.mutedText }}>Runtime started: <strong style={{ color: theme.cardText }}>{new Date(runtime.startedAt).toLocaleString()}</strong></div>}
      {issues.length > 0
        ? <div>{issues.map((issue, index) => <div key={`${issue.code || 'issue'}:${index}`} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '8px 0' }}><strong>{issue.severity || 'warning'}:</strong> {issue.message || issue.code}</div>)}</div>
        : <div style={{ color: '#86efac', fontWeight: 800 }}>No provider, delivery or runtime issues detected.</div>}
    </>}
  </section>;
}

export default function SocialWithRuntime(props) {
  const { theme, selectedGuild, selectedGuildData } = props;
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [runtime, setRuntime] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshRuntime = useCallback(async () => {
    if (!guildId) {
      setRuntime(null);
      setHealth(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.request(`/api/social/${guildId}/creator-hub/diagnostics`);
      setRuntime(result.diagnostics?.runtime || null);
      setHealth(result.diagnostics?.health || null);
    } catch (runtimeError) {
      setRuntime(null);
      setHealth(null);
      setError(runtimeError.message || 'Failed to load Social Studio health.');
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    refreshRuntime();
    if (!guildId) return undefined;
    const timer = setInterval(refreshRuntime, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [guildId, refreshRuntime]);

  return <div style={{ display: 'grid', gap: 16 }}>
    {guildId && <SocialRuntimeHealthCard theme={theme} runtime={runtime} health={health} loading={loading} error={error} onRefresh={refreshRuntime} />}
    <Social {...props} />
  </div>;
}

export { REFRESH_INTERVAL_MS, formatInterval, getGuildId, stateStyle };
