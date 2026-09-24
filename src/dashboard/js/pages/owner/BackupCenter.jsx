import React, { useMemo, useState } from 'react';

import useOwnerBackups from '../../hooks/useOwnerBackups.js';

const ENVIRONMENTS = [
  { label: 'All environments', value: 'all' },
  { label: 'DEV', value: 'DEV' },
  { label: 'BETA', value: 'BETA' },
  { label: 'PRODUCTION', value: 'PRODUCTION' },
];

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString();
}

function humanStatus(value = '') {
  const text = String(value || 'unknown').replace(/[_-]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compactId(value = '') {
  const text = String(value || '');
  if (text.length <= 14) return text || 'Unknown';
  return `${text.slice(0, 8)}…${text.slice(-5)}`;
}

export default function BackupCenter({ theme }) {
  const {
    backups,
    recentBackups,
    restoreQueue,
    summary,
    updatedAt,
    environmentFilter,
    loading,
    actionLoading,
    error,
    actionMessage,
    refresh,
    changeEnvironment,
    createManualBackup,
  } = useOwnerBackups();

  const [manualForm, setManualForm] = useState({ environment: 'DEV', guildId: '', reason: 'Manual owner backup' });
  const selectedEnvironment = useMemo(() => backups.find((backup) => backup.environment === manualForm.environment), [backups, manualForm.environment]);

  const card = {
    border: '1px solid ' + theme.cardBorder,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
  };

  async function handleManualBackup(event) {
    event.preventDefault();
    if (!manualForm.guildId.trim()) return;
    await createManualBackup(manualForm).catch(() => null);
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#22c55e', fontWeight: 900, textTransform: 'uppercase' }}>
            Global Backups
          </p>

          <h1 style={{ margin: '8px 0 0', fontSize: 34 }}>
            Backup Center
          </h1>

          <p style={{ marginTop: 8, color: theme.mutedText, maxWidth: 840, lineHeight: 1.6 }}>
            Live backup history, storage health, restore queue visibility, failed backup warnings and owner-only manual backup controls across DEV, BETA and PRODUCTION.
          </p>

          <p style={{ margin: '10px 0 0', color: theme.mutedText, fontSize: 13 }}>
            Last checked: {formatDate(updatedAt)}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={environmentFilter}
            onChange={(event) => changeEnvironment(event.target.value)}
            style={inputStyle(theme)}
          >
            {ENVIRONMENTS.map((environment) => (
              <option key={environment.value} value={environment.value}>{environment.label}</option>
            ))}
          </select>

          <button type="button" onClick={() => refresh()} disabled={loading} style={buttonStyle(loading)}>
            {loading ? 'Refreshing...' : 'Refresh Status'}
          </button>
        </div>
      </section>

      {error ? <section style={{ ...card, color: '#fca5a5' }}>{error}</section> : null}
      {actionMessage ? <section style={{ ...card, color: '#86efac' }}>{actionMessage}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
        <StatCard title="Backup Health" value={loading ? 'Loading' : humanStatus(summary.health)} detail={`${summary.ready || 0}/${summary.environments || 0} environments ready`} tone={summary.health === 'healthy' ? 'good' : 'warn'} theme={theme} />
        <StatCard title="Restore Points" value={String(summary.restorePoints || 0)} detail="Tracked backup files" theme={theme} />
        <StatCard title="Backup Size" value={summary.totalSizeLabel || '0 B'} detail="Local runtime backup storage" theme={theme} />
        <StatCard title="Restore Queue" value={String(summary.restoreQueuePending || 0)} detail="Pending restore requests" tone={summary.restoreQueuePending ? 'warn' : 'good'} theme={theme} />
        <StatCard title="Warnings" value={String(summary.warnings || 0)} detail={`${summary.failed || 0} failed integrity/restore checks`} tone={summary.warnings || summary.failed ? 'warn' : 'good'} theme={theme} />
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Environment Overview</h3>
            <p style={{ margin: '6px 0 0', color: theme.mutedText }}>
              Folder readiness, worker status, restore queue counts and backup storage per runtime.
            </p>
          </div>
          <span style={{ color: summary.warnings || summary.failed ? '#fbbf24' : '#86efac', fontWeight: 900 }}>
            {summary.warnings || summary.failed ? 'Attention required' : 'Healthy'}
          </span>
        </div>

        {backups.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {backups.map((backup, index) => <BackupRow key={backup.id || index} backup={backup} theme={theme} />)}
          </div>
        ) : (
          <EmptyState loading={loading} theme={theme} text="No backup runtime data returned yet." />
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,0.9fr) minmax(320px,1.1fr)', gap: 14 }}>
        <section style={card}>
          <h3 style={{ margin: 0 }}>Manual Backup</h3>
          <p style={{ margin: '8px 0 14px', color: theme.mutedText, lineHeight: 1.6 }}>
            Create an owner-triggered runtime backup for a guild in the selected environment. This uses the existing server backup engine and writes into the runtime backup folder.
          </p>

          <form onSubmit={handleManualBackup} style={{ display: 'grid', gap: 10 }}>
            <label style={labelStyle(theme)}>
              Environment
              <select
                value={manualForm.environment}
                onChange={(event) => setManualForm((current) => ({ ...current, environment: event.target.value }))}
                style={inputStyle(theme)}
              >
                <option value="DEV">DEV</option>
                <option value="BETA">BETA</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </label>

            <label style={labelStyle(theme)}>
              Guild ID
              <input
                value={manualForm.guildId}
                onChange={(event) => setManualForm((current) => ({ ...current, guildId: event.target.value }))}
                placeholder="Discord guild ID"
                style={inputStyle(theme)}
              />
            </label>

            <label style={labelStyle(theme)}>
              Reason
              <input
                value={manualForm.reason}
                onChange={(event) => setManualForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Manual owner backup"
                style={inputStyle(theme)}
              />
            </label>

            <button type="submit" disabled={actionLoading || !manualForm.guildId.trim()} style={buttonStyle(actionLoading || !manualForm.guildId.trim())}>
              {actionLoading ? 'Creating Backup...' : 'Create Manual Backup'}
            </button>
          </form>

          <div style={{ marginTop: 14, color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>
            Selected storage: {selectedEnvironment?.backupPath || 'Environment not loaded'}
          </div>
        </section>

        <section style={card}>
          <h3 style={{ margin: 0 }}>Restore Queue</h3>
          <p style={{ margin: '8px 0 14px', color: theme.mutedText, lineHeight: 1.6 }}>
            Pending restore approval requests from the restore request manager. Failed history counts are surfaced in the warning total.
          </p>

          {restoreQueue.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {restoreQueue.slice(0, 8).map((request, index) => (
                <div key={request.id || index} style={miniRowStyle(theme)}>
                  <div>
                    <strong>{request.guildName || request.guildId || 'Unknown Guild'}</strong>
                    <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 13 }}>
                      {request.environment} · {humanStatus(request.status || 'pending')} · {formatDate(request.createdAt || request.requestedAt)}
                    </div>
                  </div>
                  <span style={{ color: '#fbbf24', fontWeight: 900 }}>{compactId(request.id)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState loading={loading} theme={theme} text="No pending restore requests." />
          )}
        </section>
      </section>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Recent Backup History</h3>
            <p style={{ margin: '6px 0 0', color: theme.mutedText }}>
              Latest backup files scanned from runtime backup folders, including validation and integrity state.
            </p>
          </div>
          <span style={{ color: theme.mutedText, fontSize: 13 }}>{recentBackups.length} visible records</span>
        </div>

        {recentBackups.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ color: theme.mutedText, textAlign: 'left', fontSize: 13 }}>
                  <th style={thStyle(theme)}>Backup</th>
                  <th style={thStyle(theme)}>Guild</th>
                  <th style={thStyle(theme)}>Environment</th>
                  <th style={thStyle(theme)}>Created</th>
                  <th style={thStyle(theme)}>Contents</th>
                  <th style={thStyle(theme)}>Integrity</th>
                </tr>
              </thead>
              <tbody>
                {recentBackups.slice(0, 15).map((backup, index) => (
                  <tr key={`${backup.environment}-${backup.backupId}-${index}`}>
                    <td style={tdStyle(theme)}>
                      <strong>{compactId(backup.backupId)}</strong>
                      <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>{humanStatus(backup.backupType)} · {backup.sizeLabel || '0 B'}</div>
                    </td>
                    <td style={tdStyle(theme)}>{backup.guildName || backup.guildId || 'Unknown'}</td>
                    <td style={tdStyle(theme)}>{backup.environment}</td>
                    <td style={tdStyle(theme)}>{formatDate(backup.createdAt)}</td>
                    <td style={tdStyle(theme)}>{backup.roles || 0} roles · {backup.channels || 0} channels</td>
                    <td style={tdStyle(theme)}>
                      <span style={{ color: backup.validation?.valid !== false && backup.integrity?.exists ? '#86efac' : '#fbbf24', fontWeight: 900 }}>
                        {backup.validation?.valid !== false && backup.integrity?.exists ? 'Verified' : 'Needs Check'}
                      </span>
                      <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>
                        {backup.validation?.warnings || 0} warnings · {backup.validation?.blockers || 0} blockers
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState loading={loading} theme={theme} text="No backup files found yet." />
        )}
      </section>
    </div>
  );
}

function StatCard({ title, value, detail, tone = 'neutral', theme }) {
  const toneColor = tone === 'good' ? '#86efac' : tone === 'warn' ? '#fbbf24' : theme.cardText;

  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, borderRadius: 18, padding: 18 }}>
      <div style={{ color: theme.mutedText }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 900, marginTop: 8, color: toneColor }}>{value}</div>
      {detail ? <div style={{ marginTop: 6, color: theme.mutedText, fontSize: 13 }}>{detail}</div> : null}
    </div>
  );
}

function BackupRow({ backup, theme }) {
  const ready = backup.backupFolderReady && backup.status !== 'offline';
  const statusColor = ready ? '#86efac' : '#fbbf24';

  return (
    <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 14, padding: 14, display: 'grid', gridTemplateColumns: 'minmax(140px,1fr) minmax(220px,1.4fr) minmax(180px,1fr) minmax(140px,0.8fr)', gap: 12, alignItems: 'center' }}>
      <div>
        <strong>{backup.environment}</strong>
        <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 13 }}>Runtime: {humanStatus(backup.status)}</div>
      </div>

      <div style={{ color: theme.mutedText, fontSize: 13, overflowWrap: 'anywhere' }}>
        <strong style={{ color: theme.cardText }}>Backup Folder:</strong> {backup.backupPath || 'Unknown'}
        <div style={{ marginTop: 4 }}>Worker: {humanStatus(backup.backupWorker)} · Size: {backup.backupSizeLabel || '0 B'}</div>
      </div>

      <div style={{ color: theme.mutedText, fontSize: 13 }}>
        <strong style={{ color: theme.cardText }}>Restore Queue:</strong> {backup.restoreQueue?.counts?.pending || 0} pending
        <div style={{ marginTop: 4 }}>{backup.restoreQueue?.counts?.failed || 0} failed · {backup.restoreQueue?.counts?.history || 0} history</div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <span style={{ color: statusColor, fontWeight: 900 }}>{ready ? 'Ready' : 'Needs Check'}</span>
        <div style={{ marginTop: 4, color: backup.warning ? '#fca5a5' : theme.mutedText, fontSize: 13 }}>
          {backup.warning || `${backup.restorePoints || 0} restore points`}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ loading, text, theme }) {
  return (
    <div style={{ border: '1px dashed ' + theme.cardBorder, borderRadius: 14, padding: 20, color: theme.mutedText }}>
      {loading ? 'Loading backup data...' : text}
    </div>
  );
}

function inputStyle(theme) {
  return {
    border: '1px solid ' + theme.cardBorder,
    background: 'rgba(2,6,23,0.55)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '10px 12px',
    outline: 'none',
    width: '100%',
  };
}

function labelStyle(theme) {
  return {
    display: 'grid',
    gap: 6,
    color: theme.mutedText,
    fontSize: 13,
    fontWeight: 800,
  };
}

function buttonStyle(disabled = false) {
  return {
    border: '1px solid rgba(34,197,94,0.45)',
    background: 'rgba(34,197,94,0.12)',
    color: '#86efac',
    borderRadius: 12,
    padding: '10px 14px',
    fontWeight: 900,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function miniRowStyle(theme) {
  return {
    border: '1px solid ' + theme.cardBorder,
    borderRadius: 14,
    padding: 12,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  };
}

function thStyle(theme) {
  return { borderBottom: '1px solid ' + theme.cardBorder, padding: '10px 8px' };
}

function tdStyle(theme) {
  return { borderBottom: '1px solid ' + theme.cardBorder, padding: '12px 8px', color: theme.cardText, verticalAlign: 'top' };
}
