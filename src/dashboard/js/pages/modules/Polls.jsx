import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import ModuleShell, { MODULE_TABS } from '../../shared/ModuleShell.jsx';
import { EmptyState, LoadingPanel, PrimaryButton, SectionCard, SecondaryButton, StatGrid, SummaryStat } from '../../shared/PageShell';

function guildIdFrom(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function Input(props) {
  return <input {...props} style={{ width: '100%', border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.76)', color: 'inherit', borderRadius: 12, padding: '12px 13px', outline: 'none', fontWeight: 800, ...(props.style || {}) }} />;
}

function Select(props) {
  return <select {...props} style={{ width: '100%', border: '1px solid rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.95)', color: 'inherit', borderRadius: 12, padding: '12px 13px', outline: 'none', fontWeight: 800, ...(props.style || {}) }} />;
}

function field(theme, label, node) {
  return <label style={{ display: 'grid', gap: 8, color: theme.cardText, fontWeight: 900, fontSize: 13 }}><span>{label}</span>{node}</label>;
}

function Toggle({ label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 850 }}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function PollCard({ theme, poll, saving, onDeploy, onClose, onDelete }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.52)', borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{poll.question}</strong><span style={{ color: poll.status === 'active' ? '#86efac' : '#cbd5e1', fontWeight: 950 }}>{poll.status}</span></div>
      <div style={{ color: theme.mutedText, fontSize: 13 }}>Responses: {poll.totalVotes || 0}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {poll.status !== 'closed' ? <PrimaryButton onClick={() => onDeploy(poll)} disabled={saving}>{poll.messageId ? 'Refresh' : 'Deploy'}</PrimaryButton> : null}
        {poll.status === 'active' ? <button type="button" onClick={() => onClose(poll)} disabled={saving} style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.12)', color: '#fca5a5', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}>Close</button> : null}
        <SecondaryButton theme={theme} onClick={() => onDelete(poll)} disabled={saving}>Delete</SecondaryButton>
      </div>
    </div>
  );
}

const pollsApi = {
  get: (guildId) => api.request(`/api/polls/${guildId}`),
  create: (guildId, payload) => api.request(`/api/polls/${guildId}/polls`, { method: 'POST', body: JSON.stringify(payload) }),
  deploy: (guildId, pollId, payload) => api.request(`/api/polls/${guildId}/polls/${encodeURIComponent(pollId)}/deploy`, { method: 'POST', body: JSON.stringify(payload) }),
  status: (guildId, pollId, status) => api.request(`/api/polls/${guildId}/polls/${encodeURIComponent(pollId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  remove: (guildId, pollId) => api.request(`/api/polls/${guildId}/polls/${encodeURIComponent(pollId)}`, { method: 'DELETE' }),
  settings: (guildId, payload) => api.request(`/api/polls/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify(payload) }),
  health: (guildId) => api.request(`/api/polls/${guildId}/health`),
  repair: (guildId) => api.request(`/api/polls/${guildId}/repair`, { method: 'POST' }),
  reset: (guildId) => api.request(`/api/polls/${guildId}/reset`, { method: 'POST' }),
  export: (guildId) => api.request(`/api/polls/${guildId}/export`),
};

export default function Polls({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdFrom(selectedGuild, selectedGuildData);
  const [channels, setChannels] = useState([]);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ question: '', description: '', channelId: '', options: ['Option 1', 'Option 2'] });
  const [settings, setSettings] = useState({ defaultChannelId: '', autoCloseHours: 24, allowMultipleVotes: false, anonymousVotes: false, showResultsLive: true });
  const pollList = useMemo(() => Array.isArray(config?.polls) ? config.polls : [], [config]);

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [pollData, resources, healthData] = await Promise.all([
        pollsApi.get(guildId),
        api.request(`/api/discord/${guildId}/resources`).catch(() => ({ channels: [] })),
        pollsApi.health(guildId).catch(() => null),
      ]);
      const nextConfig = pollData.config || null;
      setConfig(nextConfig);
      setOverview(pollData.overview || null);
      setHealth(healthData?.health || null);
      setChannels((resources.channels || []).filter((channel) => channel.type === 0 || channel.type === 5 || channel.type === 'GuildText' || channel.type === 'GuildAnnouncement'));
      setDraft((current) => ({ ...current, channelId: current.channelId || nextConfig?.settings?.defaultChannelId || '' }));
      setSettings({ defaultChannelId: nextConfig?.settings?.defaultChannelId || '', autoCloseHours: Number(nextConfig?.settings?.autoCloseHours || 0), allowMultipleVotes: nextConfig?.settings?.allowMultipleVotes === true, anonymousVotes: nextConfig?.settings?.anonymousVotes === true, showResultsLive: nextConfig?.showResultsLive !== false });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load polls.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function run(action, successMessage) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
      await load();
      return true;
    } catch (saveError) {
      setError(saveError.message || 'Poll action failed.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createPoll() {
    const ok = await run(() => pollsApi.create(guildId, { question: draft.question, description: draft.description, channelId: draft.channelId, options: draft.options.filter((value) => value.trim()).map((label) => ({ label })) }), 'Poll created.');
    if (ok) setDraft({ question: '', description: '', channelId: settings.defaultChannelId || '', options: ['Option 1', 'Option 2'] });
  }

  async function exportConfig() {
    setSaving(true);
    setError('');
    try {
      const data = await pollsApi.export(guildId);
      const blob = new Blob([JSON.stringify(data.export || data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `polls-${guildId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage('Poll configuration exported.');
    } catch (exportError) {
      setError(exportError.message || 'Export failed.');
    } finally {
      setSaving(false);
    }
  }

  if (!guildId) return <EmptyState theme={theme} title="Select a guild" text="Select a guild to manage polls." />;
  if (loading && !config) return <LoadingPanel theme={theme} text="Loading polls..." />;

  const overviewContent = <div style={{ display: 'grid', gap: 16 }}><StatGrid min="160px"><SummaryStat theme={theme} label="Total" value={overview?.total || 0} accent="#60a5fa" description="Stored polls" /><SummaryStat theme={theme} label="Active" value={overview?.active || 0} accent="#22c55e" description="Open polls" /><SummaryStat theme={theme} label="Closed" value={overview?.closed || 0} accent="#94a3b8" description="Finished polls" /><SummaryStat theme={theme} label="Responses" value={overview?.responses || 0} accent="#f59e0b" description="Recorded votes" /></StatGrid><SectionCard theme={theme} title="Saved Polls" subtitle="Create, deploy, refresh, close and remove polls."><div style={{ display: 'grid', gap: 10 }}>{pollList.length ? pollList.map((poll) => <PollCard key={poll.id} theme={theme} poll={poll} saving={saving} onDeploy={(item) => run(() => pollsApi.deploy(guildId, item.id, { channelId: item.channelId || settings.defaultChannelId }), 'Poll deployed or refreshed.')} onClose={(item) => run(() => pollsApi.status(guildId, item.id, 'closed'), 'Poll closed.')} onDelete={(item) => run(() => pollsApi.remove(guildId, item.id), 'Poll deleted.')} />) : <EmptyState theme={theme} title="No polls yet" text="Create a poll to deploy it to Discord." />}</div></SectionCard></div>;

  const configurationContent = <div style={{ display: 'grid', gap: 16 }}><SectionCard theme={theme} title="Module Settings" subtitle="Control voting defaults and automatic closing."><div style={{ display: 'grid', gap: 12 }}>{field(theme, 'Default Channel', <Select value={settings.defaultChannelId} onChange={(event) => setSettings({ ...settings, defaultChannelId: event.target.value })}><option value="">Select a channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</Select>)}{field(theme, 'Auto-close after hours (0 disables)', <Input type="number" min="0" max="8760" value={settings.autoCloseHours} onChange={(event) => setSettings({ ...settings, autoCloseHours: Number(event.target.value) })} />)}<Toggle label="Allow multiple choices" checked={settings.allowMultipleVotes} onChange={(value) => setSettings({ ...settings, allowMultipleVotes: value })} /><Toggle label="Anonymous results" checked={settings.anonymousVotes} onChange={(value) => setSettings({ ...settings, anonymousVotes: value })} /><Toggle label="Show results live" checked={settings.showResultsLive} onChange={(value) => setSettings({ ...settings, showResultsLive: value })} /><PrimaryButton onClick={() => run(() => pollsApi.settings(guildId, settings), 'Poll settings saved.')} disabled={saving}>Save Settings</PrimaryButton></div></SectionCard><SectionCard theme={theme} title="Create Poll" subtitle="Create a poll record before deploying it to Discord."><div style={{ display: 'grid', gap: 12 }}>{field(theme, 'Question', <Input value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} placeholder="What should we do next?" />)}{field(theme, 'Description', <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Optional context" />)}{field(theme, 'Channel', <Select value={draft.channelId} onChange={(event) => setDraft({ ...draft, channelId: event.target.value })}><option value="">Use default channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</Select>)}{draft.options.map((option, index) => field(theme, `Option ${index + 1}`, <Input key={index} value={option} onChange={(event) => setDraft({ ...draft, options: draft.options.map((value, optionIndex) => optionIndex === index ? event.target.value : value) })} />))}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><SecondaryButton theme={theme} onClick={() => setDraft({ ...draft, options: [...draft.options, `Option ${draft.options.length + 1}`] })} disabled={draft.options.length >= 10}>Add Option</SecondaryButton><SecondaryButton theme={theme} onClick={() => setDraft({ ...draft, options: draft.options.slice(0, Math.max(2, draft.options.length - 1)) })} disabled={draft.options.length <= 2}>Remove Option</SecondaryButton></div><PrimaryButton onClick={createPoll} disabled={saving || !draft.question.trim() || draft.options.filter((value) => value.trim()).length < 2}>{saving ? 'Saving...' : 'Create Poll'}</PrimaryButton></div></SectionCard></div>;

  const discordExperienceContent = <SectionCard theme={theme} title="Discord Administration" subtitle="Full native Polls management is available in Discord."><p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>Administrators can create polls with a modal, select stored polls, deploy or refresh messages, close voting, delete polls, inspect health, repair deployments, export configuration and reset the module.</p></SectionCard>;

  const activityContent = <SectionCard theme={theme} title="Health" subtitle="Validate active Discord poll deployments."><div style={{ display: 'grid', gap: 10, color: theme.mutedText, fontWeight: 800 }}><span>Status: {health?.healthy ? 'Healthy' : 'Needs attention'}</span><span>Issues: {health?.issues?.length || 0}</span>{(health?.issues || []).slice(0, 8).map((issue, index) => <span key={`${issue.code}-${index}`}>• {issue.code}{issue.pollId ? ` — ${issue.pollId}` : ''}</span>)}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}><PrimaryButton onClick={() => run(() => pollsApi.repair(guildId), 'Poll deployments repaired.')} disabled={saving}>Repair</PrimaryButton><SecondaryButton theme={theme} onClick={exportConfig} disabled={saving}>Export</SecondaryButton><button type="button" disabled={saving} onClick={() => { if (window.confirm('Delete tracked poll messages and reset Polls?')) run(() => pollsApi.reset(guildId), 'Polls reset.'); }} style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.12)', color: '#fca5a5', borderRadius: 12, padding: '10px 12px', fontWeight: 900 }}>Reset</button></div></SectionCard>;

  return (
    <ModuleShell title="Polls" subtitle="Create, deploy, close and review Discord community polls." theme={theme} guild={{ id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || 'Polls' }} actions={<PrimaryButton onClick={load} disabled={loading}>Refresh</PrimaryButton>} tabs={[{ key: MODULE_TABS.overview, label: 'Overview' }, { key: MODULE_TABS.configuration, label: 'Configuration' }, { key: MODULE_TABS.discordExperience, label: 'Discord Experience' }, { key: MODULE_TABS.activity, label: 'Health & Activity' }]} status={health?.healthy === false ? 'Needs Attention' : (overview?.active || 0) > 0 ? 'Active' : 'Enabled'} updatedAt={config?.updatedAt || 'Current session'} deploymentCount={overview?.active || 0} notice={error || message} noticeTone={error ? 'danger' : 'success'}>
      {{ [MODULE_TABS.overview]: overviewContent, [MODULE_TABS.configuration]: configurationContent, [MODULE_TABS.discordExperience]: discordExperienceContent, [MODULE_TABS.activity]: activityContent }}
    </ModuleShell>
  );
}