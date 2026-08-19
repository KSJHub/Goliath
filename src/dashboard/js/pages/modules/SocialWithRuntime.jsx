import React, { useCallback, useEffect, useState } from 'react';

import Social from './Social.jsx';
import { api } from '../../services/apiClient.js';

const REFRESH_INTERVAL_MS = 30000;

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function stateStyle(state) {
  if (state === 'healthy') return { label: 'Healthy', color: '#86efac', background: 'rgba(22,163,74,.18)', border: '#22c55e' };
  if (state === 'warning') return { label: 'Warning', color: '#fde68a', background: 'rgba(217,119,6,.18)', border: '#f59e0b' };
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

export function SocialRuntimeHealthCard({ theme, runtime, loading, error, onRefresh }) {
  const presentation = stateStyle(runtime?.state);
  return <section data-testid="social-runtime-health" style={{ border: `1px solid ${runtime ? presentation.border : theme.cardBorder}`, background: runtime ? presentation.background : theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 18, display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0 }}>Runtime Health</h2>
        <small style={{ color: theme.mutedText }}>Scheduler, delivery queue and incident monitoring.</small>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ color: runtime ? presentation.color : theme.mutedText }}>{loading ? 'Checking…' : runtime ? presentation.label : 'Unavailable'}</strong>
        <button type="button" onClick={onRefresh} disabled={loading} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.35)', color: theme.cardText, borderRadius: 999, padding: '8px 12px', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .55 : 1 }}>Refresh</button>
      </div>
    </div>

    {error && <div style={{ color: '#fca5a5', fontWeight: 800 }}>{error}</div>}

    {runtime && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <RuntimeService theme={theme} label="Scheduler" service={runtime.scheduler} intervalKey="tickIntervalMs" />
        <RuntimeService theme={theme} label="Delivery Queue" service={runtime.queue} />
        <RuntimeService theme={theme} label="Incident Monitor" service={runtime.incidentMonitor} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, color: theme.mutedText }}>
        <span>Warnings: <strong style={{ color: theme.cardText }}>{runtime.warningCount || 0}</strong></span>
        <span>Errors: <strong style={{ color: theme.cardText }}>{runtime.errorCount || 0}</strong></span>
        <span>Started: <strong style={{ color: theme.cardText }}>{runtime.startedAt ? new Date(runtime.startedAt).toLocaleString() : 'Not running'}</strong></span>
      </div>
      {(runtime.issues || []).length > 0 && <div>{runtime.issues.map((issue) => <div key={issue.code} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '8px 0' }}><strong>{issue.severity}:</strong> {issue.message || issue.code}</div>)}</div>}
    </>}
  </section>;
}

export default function SocialWithRuntime(props) {
  const { theme, selectedGuild, selectedGuildData } = props;
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [runtime, setRuntime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshRuntime = useCallback(async () => {
    if (!guildId) {
      setRuntime(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.request(`/api/social/${guildId}/creator-hub/diagnostics`);
      setRuntime(result.diagnostics?.runtime || null);
    } catch (runtimeError) {
      setError(runtimeError.message || 'Failed to load Social Studio runtime health.');
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
    {guildId && <SocialRuntimeHealthCard theme={theme} runtime={runtime} loading={loading} error={error} onRefresh={refreshRuntime} />}
    <Social {...props} />
  </div>;
}

export { REFRESH_INTERVAL_MS, formatInterval, getGuildId, stateStyle };
