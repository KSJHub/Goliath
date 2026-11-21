import { goDashboard } from '../../../services/dashboardPath.js';
import React, { useEffect, useState } from 'react';

import { api } from '../../../services/apiClient.js';
import ModuleShell, { MODULE_TABS } from '../../../shared/ModuleShell.jsx';
import { EmptyState, Notice, PrimaryButton, SectionCard, StatGrid, SummaryStat } from '../../../shared/PageShell.jsx';

function idFrom(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function openEmbedStudio() {
  goDashboard('/embed-studio');
}

export default function ModuleResourceMini({ theme, selectedGuild, selectedGuildData, title, description }) {
  const guildId = idFrom(selectedGuild, selectedGuildData);
  const [data, setData] = useState({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function load(sync = false) {
    if (!guildId) return;
    setLoading(true);
    setNote(sync ? 'Refreshing shared Discord resources...' : 'Loading shared Discord resources...');
    try {
      const payload = await api.request(`/api/discord/${guildId}/resources${sync ? '/sync' : ''}`, sync ? { method: 'POST' } : {});
      setData(payload || {});
      setNote(sync ? 'Shared Discord resources refreshed into guild JSON.' : '');
    } catch (error) {
      setNote(error.message || 'Could not load shared Discord resources.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(false); }, [guildId]);

  if (!guildId) return <EmptyState theme={theme} title="Select a server" text={`Select a server to manage ${title}.`} />;

  const resourceCount = (data.channels || []).length + (data.categories || []).length + (data.roles || []).length + (data.emojis || []).length;

  const overviewContent = (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatGrid min="160px">
        <SummaryStat theme={theme} label="Channels" value={(data.channels || []).length} accent="#60a5fa" description="Cached Discord channels" />
        <SummaryStat theme={theme} label="Categories" value={(data.categories || []).length} accent="#a78bfa" description="Cached categories" />
        <SummaryStat theme={theme} label="Roles" value={(data.roles || []).length} accent="#22c55e" description="Cached roles" />
        <SummaryStat theme={theme} label="Emojis" value={(data.emojis || []).length} accent="#f59e0b" description="Cached emojis" />
      </StatGrid>

      <SectionCard theme={theme} title="Overview" subtitle="Reads cached Discord metadata from guild JSON.">
        <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>
          This lightweight module view uses shared Discord resources while its deeper module logic is built out.
        </p>
      </SectionCard>
    </div>
  );

  const configurationContent = (
    <SectionCard theme={theme} title="Configuration" subtitle="Shared resources available to this module.">
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>
        Channels, roles, categories and emojis are ready for module settings. Module-specific configuration can be added here without changing the page structure.
      </p>
    </SectionCard>
  );

  const discordExperienceContent = (
    <SectionCard theme={theme} title="Discord Experience" subtitle="Discord-facing message templates belong in Embed Studio.">
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>
        Use Embed Studio for this module&apos;s Discord panels, embeds, buttons and templates.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={openEmbedStudio}>Open Embed Studio</PrimaryButton>
      </div>
    </SectionCard>
  );

  const activityContent = (
    <SectionCard theme={theme} title="Activity" subtitle="Shared Discord resource sync status.">
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>Last sync: {data.lastSync || 'Not synced yet'}</p>
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>Current state: {loading ? 'Refreshing' : 'Idle'}</p>
    </SectionCard>
  );

  return (
    <ModuleShell
      title={title}
      subtitle={description}
      theme={theme}
      guild={{ id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || title }}
      actions={<PrimaryButton onClick={() => load(true)} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh Discord Resources'}</PrimaryButton>}
      tabs={[
        { key: MODULE_TABS.overview, label: 'Overview' },
        { key: MODULE_TABS.configuration, label: 'Configuration' },
        { key: MODULE_TABS.discordExperience, label: 'Discord Experience' },
        { key: MODULE_TABS.activity, label: 'Activity' },
      ]}
      status={resourceCount ? 'Active' : 'Needs setup'}
      updatedAt={data.lastSync || 'Not synced yet'}
      templateCount={0}
      deploymentCount={0}
      notice={note}
      noticeTone={note.toLowerCase().includes('could not') ? 'danger' : 'info'}
    >
      {{
        [MODULE_TABS.overview]: overviewContent,
        [MODULE_TABS.configuration]: configurationContent,
        [MODULE_TABS.discordExperience]: discordExperienceContent,
        [MODULE_TABS.activity]: activityContent,
      }}
    </ModuleShell>
  );
}
