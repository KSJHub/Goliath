import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';

import PageShell, {
  SectionCard,
  StatGrid,
  SummaryStat,
  LoadingPanel,
  EmptyState,
  Notice,
} from '../../shared/PageShell';

const REFRESH_MS = 20000;

const INITIAL_STATE = {
  loading: false,
  error: '',
  statusData: null,
  casesData: [],
  warningsData: [],
};

function getGuildAvatar(guild, statusData) {
  return (
    guild?.iconUrl ||
    guild?.iconURL ||
    guild?.avatarUrl ||
    guild?.image ||
    statusData?.guild?.iconUrl ||
    statusData?.guild?.iconURL ||
    ''
  );
}

function getGuildName(guild, statusData, fallback = 'Selected Server') {
  return guild?.name || statusData?.guild?.name || fallback;
}

function getNumber(...values) {
  for (const value of values) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }
  }

  return 0;
}

function getBoolean(...values) {
  return values.some(Boolean);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;

  if (value && typeof value === 'object') {
    return Object.values(value);
  }

  return [];
}

function buildMetrics({
  selectedGuildId,
  selectedGuildData,
  statusData,
  casesData,
  warningsData,
}) {
  const guildStatus =
    statusData?.guild ||
    statusData?.guilds?.[selectedGuildId] ||
    null;

  const cases = normalizeArray(casesData);
  const warnings = normalizeArray(warningsData);

  const activeWarnings = warnings.filter((warning) => {
    const status = String(warning?.status || warning?.state || '').toLowerCase();

    return ![
      'cleared',
      'removed',
      'expired',
      'deleted',
      'inactive',
    ].includes(status);
  });

  const clearedWarnings = warnings.filter((warning) => {
    const status = String(warning?.status || warning?.state || '').toLowerCase();

    return [
      'cleared',
      'removed',
      'expired',
      'deleted',
      'inactive',
    ].includes(status);
  });

  return {
    guildId: selectedGuildId,

    guildName: getGuildName(selectedGuildData, statusData),

    members: getNumber(
      statusData?.members,
      statusData?.memberCount,
      guildStatus?.members,
      guildStatus?.memberCount,
    ),

    humans: getNumber(
      statusData?.humans,
      guildStatus?.humans,
    ),

    bots: getNumber(
      statusData?.bots,
      guildStatus?.bots,
    ),

    botOnline: getBoolean(
      statusData?.botOnline,
      statusData?.bot?.online,
    ),

    backendOnline: getBoolean(
      statusData?.backendOnline,
      statusData?.backend?.online,
      statusData?.success === true,
    ),

    apiOnline: getBoolean(
      statusData?.apiOnline,
      statusData?.api?.online,
      statusData?.success === true,
    ),

    totalCases: cases.length,
    totalWarnings: warnings.length,
    activeWarnings: activeWarnings.length,
    clearedWarnings: clearedWarnings.length,
  };
}

export default function Overview({
  selectedGuild,
  selectedGuildId,
  theme,
  guilds = [],
}) {
  const activeGuildId = selectedGuildId || selectedGuild;

  const [state, setState] = useState(INITIAL_STATE);

  const selectedGuildData = useMemo(
    () =>
      guilds.find(
        (guild) => String(guild.id) === String(activeGuildId),
      ) || null,
    [guilds, activeGuildId],
  );

  useEffect(() => {
    if (!activeGuildId) {
      setState(INITIAL_STATE);
      return undefined;
    }

    let cancelled = false;

    async function loadOverview() {
      setState((current) => ({
        ...current,
        loading: true,
        error: '',
      }));

      try {
        const [statusData, casesData, warningsData] = await Promise.all([
          api.getStatus(activeGuildId),
          api.getCases(activeGuildId).catch(() => []),
          api.getWarnings(activeGuildId).catch(() => []),
        ]);

        if (cancelled) return;

        setState({
          loading: false,
          error: '',
          statusData,
          casesData,
          warningsData,
        });
      } catch (error) {
        if (cancelled) return;

        setState((current) => ({
          ...current,
          loading: false,
          error: error.message || 'Failed to load overview.',
        }));
      }
    }

    loadOverview();

    const interval = setInterval(loadOverview, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeGuildId]);

  const metrics = useMemo(
    () =>
      buildMetrics({
        selectedGuildId: activeGuildId,
        selectedGuildData,
        statusData: state.statusData,
        casesData: state.casesData,
        warningsData: state.warningsData,
      }),
    [
      activeGuildId,
      selectedGuildData,
      state.statusData,
      state.casesData,
      state.warningsData,
    ],
  );

  const guildAvatar = getGuildAvatar(
    selectedGuildData,
    state.statusData,
  );

  if (!activeGuildId) {
    return (
      <PageShell
        title="Overview"
        subtitle="Select a server to view stats."
        theme={theme}
      >
        <EmptyState
          theme={theme}
          title="No Server Selected"
          text="Choose a server from the navbar to continue."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Overview"
      subtitle="Live server overview, member metrics, moderation activity, and realtime system status."
      theme={theme}
      guild={{
        id: metrics.guildId,
        name: metrics.guildName,
        iconUrl: guildAvatar,
      }}
    >
      {state.error ? (
        <Notice theme={theme} tone="danger">
          {state.error}
        </Notice>
      ) : null}

      {state.loading && !state.statusData ? (
        <LoadingPanel
          theme={theme}
          text="Loading live server overview..."
        />
      ) : null}

      <SectionCard
        theme={theme}
        title="Overview"
        subtitle={
          state.loading
            ? 'Refreshing live server stats...'
            : 'Live server stats and system status'
        }
      >
        <StatGrid min="220px">
          <SummaryStat
            theme={theme}
            label="Bot Status"
            value={metrics.botOnline ? 'Online' : 'Offline'}
            accent={
              metrics.botOnline
                ? theme.success
                : theme.danger
            }
            description="Current Discord bot connection"
          />

          <SummaryStat
            theme={theme}
            label="Backend"
            value={metrics.backendOnline ? 'Online' : 'Offline'}
            accent={
              metrics.backendOnline
                ? theme.success
                : theme.danger
            }
            description="Dashboard backend runtime"
          />

          <SummaryStat
            theme={theme}
            label="API Status"
            value={metrics.apiOnline ? 'Online' : 'Offline'}
            accent={
              metrics.apiOnline
                ? theme.success
                : theme.danger
            }
            description="Realtime API connectivity"
          />

          <SummaryStat
            theme={theme}
            label="Members"
            value={metrics.members}
            description="Total detected server members"
          />

          <SummaryStat
            theme={theme}
            label="Humans"
            value={metrics.humans}
            accent="#a855f7"
            description="Detected human users"
          />

          <SummaryStat
            theme={theme}
            label="Bots"
            value={metrics.bots}
            accent="#3b82f6"
            description="Detected bot users"
          />
        </StatGrid>
      </SectionCard>

      <SectionCard
        theme={theme}
        title="Moderation Snapshot"
        subtitle="Current moderation activity and warning overview for this guild."
      >
        <StatGrid min="220px">
          <SummaryStat
            theme={theme}
            label="Total Cases"
            value={metrics.totalCases}
            accent="#3b82f6"
            description="Stored moderation case records"
          />

          <SummaryStat
            theme={theme}
            label="Total Warnings"
            value={metrics.totalWarnings}
            accent="#f59e0b"
            description="Total warning records"
          />

          <SummaryStat
            theme={theme}
            label="Active Warnings"
            value={metrics.activeWarnings}
            accent="#ef4444"
            description="Warnings currently active"
          />

          <SummaryStat
            theme={theme}
            label="Cleared Warnings"
            value={metrics.clearedWarnings}
            accent="#22c55e"
            description="Warnings successfully cleared"
          />
        </StatGrid>
      </SectionCard>
    </PageShell>
  );
}
