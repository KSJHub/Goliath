import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

function ProviderStatus({ theme, provider }) {
  const ready = provider?.status === 'ready';
  const alertTypes = Array.isArray(provider?.supportedAlertTypes) ? provider.supportedAlertTypes : [];
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 5 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <strong>{provider?.label || provider?.id || 'Provider'}</strong>
      <span style={{ color: ready ? '#86efac' : '#fde68a', fontWeight: 900 }}>{ready ? 'Ready' : 'Setup Required'}</span>
    </div>
    <small style={{ color: theme.mutedText }}>{alertTypes.length ? alertTypes.join(' • ') : 'No alert capabilities reported'}</small>
  </div>;
}

function AccountDiagnostic({ theme, account }) {
  const diagnostic = account?.diagnostic || account?.state?.diagnostic || null;
  const health = diagnostic?.health || {};
  const level = health.level || (diagnostic?.failureCategory ? 'error' : diagnostic ? 'healthy' : 'empty');
  const presentation = stateStyle(level === 'configuration' || level === 'delivery' ? 'attention' : level);
  const liveState = diagnostic?.isLive === true ? 'LIVE' : diagnostic?.isLive === false ? 'Offline' : 'Unknown';
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 5 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <strong>{account.displayName || account.username || account.accountId}</strong>
      <span style={{ color: presentation.color, fontWeight: 900 }}>{diagnostic ? (health.label || presentation.label) : 'Not Checked'}</span>
    </div>
    <small style={{ color: theme.mutedText }}>{String(account.platform || '').toUpperCase()} · {liveState}{Number.isFinite(Number(diagnostic?.latencyMs)) ? ` · ${diagnostic.latencyMs}ms` : ''}</small>
    {diagnostic?.failureCategory && <small style={{ color: '#fca5a5' }}>{diagnostic.failureCategory}: {diagnostic.reason || 'Provider check failed.'}</small>}
    {diagnostic?.deliveryReady === false && <small style={{ color: '#fde68a' }}>{diagnostic.deliveryReason || 'Delivery setup required.'}</small>}
  </div>;
}

export function SocialRuntimeHealthCard({ theme, runtime, health, providers = [], accounts = [], loading, checking, error, checkResult, onRefresh, onCheckAll }) {
  const issues = Array.isArray(health?.issues) && health.issues.length ? health.issues : (runtime?.issues || []);
  const providerSetupCount = providers.filter((provider) => provider?.status !== 'ready').length;
  const diagnosticIssues = accounts.filter((account) => {
    const diagnostic = account?.diagnostic || account?.state?.diagnostic;
    return diagnostic && (diagnostic.failureCategory || diagnostic.deliveryReady === false || ['configuration_required', 'timeout', 'unavailable', 'unsupported'].includes(diagnostic.status));
  }).length;
  const baseState = runtime?.state || (health ? (health.healthy ? (issues.length ? 'attention' : 'healthy') : 'error') : null);
  const state = baseState === 'healthy' && (providerSetupCount > 0 || diagnosticIssues > 0) ? 'attention' : baseState;
  const presentation = stateStyle(state);
  const errorCount = issues.filter((issue) => String(issue?.severity || '').toLowerCase() === 'error').length;
  const warningCount = issues.length - errorCount;

  return <section data-testid="social-runtime-health" style={{ border: `1px solid ${state ? presentation.border : theme.cardBorder}`, background: state ? presentation.background : theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 18, display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <div>
        <h2 style={{ margin: 0 }}>Social Studio Health</h2>
        <small style={{ color: theme.mutedText }}>Provider capability, account diagnostics, delivery and runtime health in one operational view.</small>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: state ? presentation.color : theme.mutedText }}>{loading ? 'Refreshing…' : checking ? 'Checking accounts…' : state ? presentation.label : 'Unavailable'}</strong>
        <button type="button" onClick={onCheckAll} disabled={loading || checking || !accounts.length} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(37,99,235,.22)', color: theme.cardText, borderRadius: 999, padding: '8px 12px', fontWeight: 900, cursor: loading || checking || !accounts.length ? 'not-allowed' : 'pointer', opacity: loading || checking || !accounts.length ? .55 : 1 }}>Run Provider Check</button>
        <button type="button" onClick={onRefresh} disabled={loading || checking} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.35)', color: theme.cardText, borderRadius: 999, padding: '8px 12px', fontWeight: 900, cursor: loading || checking ? 'not-allowed' : 'pointer', opacity: loading || checking ? .55 : 1 }}>Refresh</button>
      </div>
    </div>

    {error && <div style={{ color: '#fca5a5', fontWeight: 800 }}>{error}</div>}
    {checkResult && <div style={{ color: checkResult.summary?.overall === 'error' ? '#fca5a5' : checkResult.summary?.overall === 'attention' ? '#fde68a' : '#86efac', fontWeight: 800 }}>Provider check finished: {checkResult.checked || 0} account(s), {checkResult.summary?.providerErrors || 0} provider error(s), {checkResult.summary?.deliveryIssues || 0} delivery issue(s).</div>}

    {(runtime || health || providers.length > 0 || accounts.length > 0) && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <HealthMetric theme={theme} label="Warnings" value={warningCount} />
        <HealthMetric theme={theme} label="Errors" value={errorCount} />
        <HealthMetric theme={theme} label="Provider Setup" value={providerSetupCount} />
        <HealthMetric theme={theme} label="Account Issues" value={diagnosticIssues} />
        <HealthMetric theme={theme} label="Health Score" value={Number.isFinite(Number(health?.score)) ? `${health.score}%` : '—'} />
        <HealthMetric theme={theme} label="Checked" value={health?.checkedAt ? new Date(health.checkedAt).toLocaleTimeString() : '—'} />
      </div>
      {accounts.length > 0 && <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>Account Diagnostics</strong><small style={{ color: theme.mutedText }}>{accounts.filter((account) => account.enabled !== false).length} enabled</small></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>{accounts.map((account) => <AccountDiagnostic key={account.accountId} theme={theme} account={account} />)}</div>
      </div>}
      {providers.length > 0 && <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <strong>Provider Capabilities</strong>
          <small style={{ color: theme.mutedText }}>{providers.filter((provider) => provider?.status === 'ready').length}/{providers.length} ready</small>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          {providers.map((provider) => <ProviderStatus key={provider.id || provider.label} theme={theme} provider={provider} />)}
        </div>
      </div>}
      {runtime && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <RuntimeService theme={theme} label="Scheduler" service={runtime.scheduler} intervalKey="tickIntervalMs" />
        <RuntimeService theme={theme} label="Delivery Queue" service={runtime.queue} />
        <RuntimeService theme={theme} label="Incident Monitor" service={runtime.incidentMonitor} />
      </div>}
      {runtime?.startedAt && <div style={{ color: theme.mutedText }}>Runtime started: <strong style={{ color: theme.cardText }}>{new Date(runtime.startedAt).toLocaleString()}</strong></div>}
      {issues.length > 0
        ? <div>{issues.map((issue, index) => <div key={`${issue.code || 'issue'}:${index}`} style={{ borderTop: `1px solid ${theme.cardBorder}`, padding: '8px 0' }}><strong>{issue.severity || 'warning'}:</strong> {issue.message || issue.code}</div>)}</div>
        : <div style={{ color: '#86efac', fontWeight: 800 }}>No delivery or runtime issues detected.</div>}
    </>}
  </section>;
}

export default function SocialWithRuntime(props) {
  const { theme, selectedGuild, selectedGuildData } = props;
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [runtime, setRuntime] = useState(null);
  const [health, setHealth] = useState(null);
  const [providers, setProviders] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [checkResult, setCheckResult] = useState(null);

  const enabledAccounts = useMemo(() => accounts.filter((account) => account.enabled !== false), [accounts]);

  const refreshRuntime = useCallback(async () => {
    if (!guildId) {
      setRuntime(null);
      setHealth(null);
      setProviders([]);
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [diagnosticsResult, providersResult, hubResult] = await Promise.all([
        api.request(`/api/social/${guildId}/creator-hub/diagnostics`),
        api.request(`/api/social/${guildId}/providers`),
        api.request(`/api/social/${guildId}/creator-hub`),
      ]);
      setRuntime(diagnosticsResult.diagnostics?.runtime || null);
      setHealth(diagnosticsResult.diagnostics?.health || null);
      setProviders(Array.isArray(providersResult.providers) ? providersResult.providers : []);
      setAccounts(Array.isArray(hubResult.accounts) ? hubResult.accounts : []);
    } catch (runtimeError) {
      setRuntime(null);
      setHealth(null);
      setProviders([]);
      setAccounts([]);
      setError(runtimeError.message || 'Failed to load Social Studio health.');
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  const checkAll = useCallback(async () => {
    if (!guildId || !enabledAccounts.length) return;
    setChecking(true);
    setError('');
    setCheckResult(null);
    try {
      const result = await api.request(`/api/social/${guildId}/check`, { method: 'POST' });
      setCheckResult(result);
      await refreshRuntime();
    } catch (checkError) {
      setError(checkError.message || 'Provider check failed.');
    } finally {
      setChecking(false);
    }
  }, [guildId, enabledAccounts.length, refreshRuntime]);

  useEffect(() => {
    refreshRuntime();
    if (!guildId) return undefined;
    const timer = setInterval(refreshRuntime, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [guildId, refreshRuntime]);

  return <div style={{ display: 'grid', gap: 16 }}>
    {guildId && <SocialRuntimeHealthCard theme={theme} runtime={runtime} health={health} providers={providers} accounts={accounts} loading={loading} checking={checking} error={error} checkResult={checkResult} onRefresh={refreshRuntime} onCheckAll={checkAll} />}
    <Social {...props} />
  </div>;
}

export { REFRESH_INTERVAL_MS, formatInterval, getGuildId, stateStyle };
