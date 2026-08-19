import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import { joinGuildRoom, listenForGuildUpdate } from '../../services/socketClient';
import PageShell, {
  EmptyState,
  LoadingPanel,
  Notice,
  SecondaryButton,
  SectionCard,
  StatGrid,
  SummaryStat,
} from '../../shared/PageShell';

function getGuildId(selectedGuild) {
  if (!selectedGuild) return '';
  if (typeof selectedGuild === 'string' || typeof selectedGuild === 'number') {
    return String(selectedGuild).trim();
  }
  return String(selectedGuild.id || selectedGuild.guildId || '').trim();
}

function normalizeWarning(item = {}, guildId, index = 0) {
  const caseNumber = item.caseNumber || item.case || item.number || item.id || index + 1;
  return {
    ...item,
    guildId: item.guildId || guildId,
    caseNumber,
    userTag: item.userTag || item.targetTag || item.user || item.target,
    userId: item.userId || item.targetId,
    moderatorTag: item.moderatorTag || item.moderator,
    moderatorId: item.moderatorId,
    reason: item.reason || 'No reason provided',
    createdAt: item.createdAt || item.date || item.timestamp,
    cleared: item.cleared === true,
    clearedAt: item.clearedAt,
    stableKey:
      item.id ||
      item.warningId ||
      `${item.guildId || guildId}-${caseNumber}-${item.createdAt || item.timestamp || index}`,
  };
}

function normalizeWarnings(data, guildId) {
  if (!data) return [];
  let source = [];
  if (Array.isArray(data)) source = data;
  else if (Array.isArray(data.warnings)) source = data.warnings;
  else if (data.warnings && typeof data.warnings === 'object') source = Object.values(data.warnings);
  else if (Array.isArray(data.data)) source = data.data;
  else if (typeof data === 'object') {
    source = Object.values(data).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  }

  return source
    .map((item, index) => normalizeWarning(item, guildId, index))
    .sort((a, b) => {
      const caseDelta = Number(b.caseNumber || 0) - Number(a.caseNumber || 0);
      if (caseDelta) return caseDelta;
      return (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0);
    });
}

function getWarningKey(item) {
  if (!item) return '';
  return item.stableKey || `${item.guildId || 'guild'}-${item.caseNumber || item.id || 'warning'}`;
}

function formatUser(tag, id) {
  if (tag && id) return `${tag} (${id})`;
  return tag || id || 'Unknown';
}

function SearchInput({ theme, value, onChange }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Search warnings..."
      style={{
        width: 'min(320px, 100%)',
        maxWidth: '100%',
        border: `1px solid ${theme.cardBorder}`,
        background: 'rgba(10,18,35,0.96)',
        color: theme.cardText,
        borderRadius: 14,
        padding: '11px 13px',
        outline: 'none',
        fontWeight: 700,
        boxSizing: 'border-box',
      }}
    />
  );
}

function Badge({ theme, tone = 'soft', children }) {
  const tones = {
    warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.28)', text: '#fcd34d' },
    success: { bg: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.28)', text: '#86efac' },
    soft: { bg: theme.softBg, border: theme.cardBorder, text: theme.mutedText },
  };
  const current = tones[tone] || tones.soft;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 28,
      padding: '5px 10px',
      borderRadius: 999,
      border: `1px solid ${current.border}`,
      background: current.bg,
      color: current.text,
      fontSize: 12,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

const DetailRow = memo(function DetailRow({ theme, label, value }) {
  return (
    <div style={{ display: 'grid', gap: 6, padding: '13px 14px', borderRadius: 14, background: theme.softBg, border: `1px solid ${theme.cardBorder}`, minWidth: 0 }}>
      <span style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ color: theme.cardText, fontSize: 14, fontWeight: 800, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
});

const WarningItem = memo(function WarningItem({ item, active, theme, formatDate, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        minWidth: 0,
        border: `1px solid ${active ? theme.primaryBorder : theme.cardBorder}`,
        background: active ? theme.primarySoft : theme.softBg,
        borderRadius: 16,
        padding: 16,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'grid',
        gap: 9,
        boxShadow: active ? theme.shadow : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ color: theme.cardText }}>Warning #{item.caseNumber || item.id || 'Unknown'}</strong>
        <Badge theme={theme} tone={item.cleared ? 'success' : 'warning'}>{item.cleared ? 'Cleared' : 'Active'}</Badge>
      </div>
      <span style={{ color: theme.mutedText, fontSize: 13, fontWeight: 700 }}>User: {item.userTag || item.userId || 'Unknown'}</span>
      <span style={{ color: theme.cardText, fontSize: 14, lineHeight: 1.45, fontWeight: 700 }}>{item.reason}</span>
      <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 700 }}>{formatDate(item.createdAt)}</span>
    </button>
  );
});

const WarningDetail = memo(function WarningDetail({ item, theme, formatDate, onClose }) {
  return (
    <SectionCard
      theme={theme}
      title={`Warning #${item.caseNumber || item.id || 'Unknown'}`}
      subtitle="Full warning record details."
      actions={<Badge theme={theme} tone={item.cleared ? 'success' : 'warning'}>{item.cleared ? 'Cleared' : 'Active'}</Badge>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <DetailRow theme={theme} label="User" value={formatUser(item.userTag, item.userId)} />
        <DetailRow theme={theme} label="Moderator" value={formatUser(item.moderatorTag, item.moderatorId)} />
        <DetailRow theme={theme} label="Created" value={formatDate(item.createdAt)} />
        <DetailRow theme={theme} label="Reason" value={item.reason} />
        <DetailRow theme={theme} label="Status" value={item.cleared ? 'Cleared' : 'Active'} />
        {item.cleared ? <DetailRow theme={theme} label="Cleared At" value={formatDate(item.clearedAt)} /> : null}
      </div>
      <SecondaryButton theme={theme} onClick={onClose}>Close</SecondaryButton>
    </SectionCard>
  );
});

export default function Warnings({ selectedGuild, theme }) {
  const guildId = getGuildId(selectedGuild);
  const [warnings, setWarnings] = useState([]);
  const [selectedWarning, setSelectedWarning] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  const loadWarnings = useCallback(async ({ quiet = false } = {}) => {
    if (!guildId) {
      setWarnings([]);
      setSelectedWarning(null);
      setError('');
      setSyncMessage('');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError('');
      const nextWarnings = normalizeWarnings(await api.getWarnings(guildId), guildId);
      setWarnings(nextWarnings);
      setSelectedWarning((current) => {
        if (!current) return null;
        return nextWarnings.find((item) => getWarningKey(item) === getWarningKey(current)) || null;
      });
    } catch (err) {
      console.error(err);
      setWarnings([]);
      setSelectedWarning(null);
      setError('Could not load warnings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadWarnings();
  }, [loadWarnings]);

  useEffect(() => {
    if (!guildId) return undefined;
    joinGuildRoom(guildId);
    return listenForGuildUpdate('warnings', (data) => {
      const nextWarnings = normalizeWarnings(data, guildId);
      setWarnings(nextWarnings);
      setSelectedWarning((current) => {
        if (!current) return null;
        return nextWarnings.find((item) => getWarningKey(item) === getWarningKey(current)) || null;
      });
      setSyncMessage('✅ Warnings synced live.');
    });
  }, [guildId]);

  useEffect(() => {
    if (!syncMessage) return undefined;
    const timeout = setTimeout(() => setSyncMessage(''), 3000);
    return () => clearTimeout(timeout);
  }, [syncMessage]);

  const filteredWarnings = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return warnings;
    return warnings.filter((warning) => [
      warning.id,
      warning.caseNumber,
      warning.userTag,
      warning.userId,
      warning.moderatorTag,
      warning.moderatorId,
      warning.reason,
      warning.cleared ? 'cleared' : 'active',
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [warnings, search]);

  const stats = useMemo(() => ({
    total: warnings.length,
    active: warnings.filter((warning) => !warning.cleared).length,
    cleared: warnings.filter((warning) => warning.cleared).length,
  }), [warnings]);

  const formatDate = useCallback((value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
  }, []);

  return (
    <PageShell
      title="Warnings"
      subtitle={guildId ? 'Active and cleared warning records for this guild.' : 'Select a server to view warnings.'}
      theme={theme}
      guild={{ id: guildId, name: 'Warnings' }}
      actions={guildId ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
          <SearchInput theme={theme} value={search} onChange={setSearch} />
          <SecondaryButton theme={theme} onClick={() => loadWarnings({ quiet: true })} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </SecondaryButton>
        </div>
      ) : null}
    >
      {!guildId ? <EmptyState theme={theme} text="Select a server to view warnings." /> : null}
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {syncMessage ? <Notice theme={theme} tone="success">{syncMessage}</Notice> : null}

      {guildId ? (
        <StatGrid min="min(220px, 100%)">
          <SummaryStat theme={theme} label="Total Warnings" value={stats.total} accent="#3b82f6" description="Stored warning records" />
          <SummaryStat theme={theme} label="Active" value={stats.active} accent="#f59e0b" description="Warnings currently active" />
          <SummaryStat theme={theme} label="Cleared" value={stats.cleared} accent="#22c55e" description="Warnings already cleared" />
          <SummaryStat theme={theme} label="Results" value={filteredWarnings.length} description="Filtered warning list" />
        </StatGrid>
      ) : null}

      {guildId && loading ? <LoadingPanel theme={theme} text="Loading warnings..." /> : null}

      {guildId && !loading && filteredWarnings.length === 0 ? (
        <EmptyState theme={theme} title="No warnings found" text="No warning records match this server or search." />
      ) : null}

      {guildId && !loading && filteredWarnings.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 'clamp(16px, 3vw, 24px)', alignItems: 'start', minWidth: 0 }}>
          <SectionCard
            theme={theme}
            title="Warning History"
            subtitle="Select a warning to inspect the full warning record."
            actions={<Badge theme={theme}>{filteredWarnings.length}</Badge>}
          >
            <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
              {filteredWarnings.map((warning) => {
                const key = getWarningKey(warning);
                return (
                  <WarningItem
                    key={key}
                    item={warning}
                    active={getWarningKey(selectedWarning) === key}
                    theme={theme}
                    formatDate={formatDate}
                    onClick={() => setSelectedWarning(warning)}
                  />
                );
              })}
            </div>
          </SectionCard>

          {selectedWarning ? (
            <WarningDetail
              item={selectedWarning}
              theme={theme}
              formatDate={formatDate}
              onClose={() => setSelectedWarning(null)}
            />
          ) : (
            <SectionCard theme={theme} title="Warning Details" subtitle="Select a warning to inspect it.">
              <EmptyState theme={theme} text="Choose a warning from the history list." />
            </SectionCard>
          )}
        </div>
      ) : null}
    </PageShell>
  );
}
