import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import ModuleShell, { MODULE_TABS } from '../../shared/ModuleShell.jsx';
import { EmptyState, LoadingPanel, PrimaryButton, SectionCard, StatGrid, SummaryStat } from '../../shared/PageShell';

const TYPE_OPTIONS = [
  ['members', '👥 Members'], ['status', '🟢 Members with Status'], ['role', '🎭 Members in Role'], ['voice', '🔊 Members in Voice'],
  ['channels', '📁 Channels'], ['roles', '🏷️ Roles'], ['datetime', '📅 Date & Time'], ['countdown', '⏳ Countdown / Timer'],
  ['messages', '💬 Message Count'], ['voiceMinutes', '🎙️ Voice Minutes'], ['joins', '📥 Member Joins'], ['leaves', '📤 Member Leaves'],
  ['boosts', '🚀 Server Boosts'], ['emojis', '😀 Emojis'],
];
const STATUS_OPTIONS = [['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do Not Disturb'], ['offline', 'Offline']];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS);

function guildIdFrom(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}
function control(theme) {
  return { width: '100%', borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.inputBg || theme.cardBg, color: theme.text, padding: '10px 12px', boxSizing: 'border-box' };
}
function Row({ theme, label, value }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${theme.cardBorder}`, padding: '10px 0' }}><span style={{ color: theme.mutedText, fontWeight: 800 }}>{label}</span><strong>{value}</strong></div>;
}
function Toggle({ checked, onChange, label }) {
  return <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontWeight: 750 }}><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function SecondaryButton({ children, onClick, disabled = false, danger = false }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ border: 0, borderRadius: 10, padding: '9px 13px', fontWeight: 850, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, background: danger ? '#ef4444' : 'rgba(148,163,184,0.18)', color: danger ? '#fff' : 'inherit' }}>{children}</button>;
}
function defaultSegment(type = 'members') {
  if (type === 'members') return { type, options: { humans: true, bots: true } };
  if (type === 'status') return { type, options: { statuses: ['online'] } };
  if (type === 'datetime') return { type, options: { format: 'weekday-short', timeZone: 'Europe/London' } };
  if (type === 'channels') return { type, options: { channelTypes: ['text', 'voice', 'category'] } };
  if (type === 'roles') return { type, options: { unmanaged: true, managed: false } };
  if (type === 'voice') return { type, options: { mode: 'all', channelIds: [] } };
  if (type === 'role') return { type, options: { roleIds: [], statuses: [] } };
  if (type === 'countdown') return { type, options: { timestamp: Date.now() + 86400000, includeDays: true, includeHours: true, includeMinutes: true, endText: 'Countdown complete!' } };
  return { type, options: {} };
}
function newDraft(settings = {}) {
  return { name: 'Members', channelType: 'voice', template: '👥 Members: {value}', frequencyMinutes: Number(settings.defaultFrequencyMinutes || 10), segments: [defaultSegment('members')] };
}
function normalizeDraft(counter, settings = {}) {
  if (!counter) return newDraft(settings);
  return {
    id: counter.id,
    name: counter.name || 'Counter',
    channelType: counter.channelType === 'text' ? 'text' : 'voice',
    template: counter.template || '{value}',
    frequencyMinutes: Number(counter.frequencyMinutes || settings.defaultFrequencyMinutes || 10),
    segments: Array.isArray(counter.segments) && counter.segments.length ? counter.segments.map((segment) => ({ ...segment, options: { ...(segment.options || {}) } })) : [defaultSegment('members')],
  };
}
function checkboxSet(values, value, checked) {
  const next = new Set(Array.isArray(values) ? values : []);
  if (checked) next.add(value); else next.delete(value);
  return [...next];
}

function SegmentEditor({ theme, segment, index, roles, channels, onChange, onRemove, canRemove }) {
  const updateOptions = (patch) => onChange({ ...segment, options: { ...(segment.options || {}), ...patch } });
  const options = segment.options || {};
  const isGoalType = !['datetime', 'countdown'].includes(segment.type);
  const voiceChannels = channels.filter((channel) => channel.type === 2 || channel.type === 13);

  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <strong>Counter {index + 1}</strong>
        {canRemove ? <SecondaryButton danger onClick={onRemove}>Remove</SecondaryButton> : null}
      </div>
      <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>What should it show?
        <select value={segment.type} onChange={(event) => onChange(defaultSegment(event.target.value))} style={control(theme)}>
          {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      {segment.type === 'members' ? <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Toggle label="People" checked={options.humans !== false} onChange={(checked) => updateOptions({ humans: checked })} />
        <Toggle label="Bots" checked={options.bots !== false} onChange={(checked) => updateOptions({ bots: checked })} />
      </div> : null}

      {segment.type === 'status' ? <div style={{ display: 'grid', gap: 8 }}><strong>Status</strong><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map(([value, label]) => <Toggle key={value} label={label} checked={(options.statuses || []).includes(value)} onChange={(checked) => updateOptions({ statuses: checkboxSet(options.statuses, value, checked) })} />)}
      </div></div> : null}

      {segment.type === 'role' ? <>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Roles to count
          <select multiple value={options.roleIds || []} onChange={(event) => updateOptions({ roleIds: [...event.target.selectedOptions].map((item) => item.value) })} style={{ ...control(theme), minHeight: 150 }}>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name} ({role.memberCount || 0})</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gap: 8 }}><strong>Optional status filter</strong><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(([value, label]) => <Toggle key={value} label={label} checked={(options.statuses || []).includes(value)} onChange={(checked) => updateOptions({ statuses: checkboxSet(options.statuses, value, checked) })} />)}
        </div></div>
      </> : null}

      {segment.type === 'voice' ? <>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Voice channel filter
          <select value={options.mode || 'all'} onChange={(event) => updateOptions({ mode: event.target.value })} style={control(theme)}>
            <option value="all">All voice channels</option><option value="whitelist">Only selected channels</option><option value="blacklist">All except selected channels</option>
          </select>
        </label>
        {options.mode !== 'all' ? <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Voice channels
          <select multiple value={options.channelIds || []} onChange={(event) => updateOptions({ channelIds: [...event.target.selectedOptions].map((item) => item.value) })} style={{ ...control(theme), minHeight: 120 }}>
            {voiceChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </select>
        </label> : null}
      </> : null}

      {segment.type === 'channels' ? <div style={{ display: 'grid', gap: 8 }}><strong>Channel types</strong><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {[['text', 'Text'], ['voice', 'Voice'], ['category', 'Categories']].map(([value, label]) => <Toggle key={value} label={label} checked={(options.channelTypes || []).includes(value)} onChange={(checked) => updateOptions({ channelTypes: checkboxSet(options.channelTypes, value, checked) })} />)}
      </div></div> : null}

      {segment.type === 'roles' ? <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Toggle label="Server roles" checked={options.unmanaged !== false} onChange={(checked) => updateOptions({ unmanaged: checked })} />
        <Toggle label="Integration roles" checked={options.managed === true} onChange={(checked) => updateOptions({ managed: checked })} />
      </div> : null}

      {segment.type === 'datetime' ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Display
          <select value={options.format || 'weekday-short'} onChange={(event) => updateOptions({ format: event.target.value })} style={control(theme)}>
            <option value="weekday-short">Sat, 12 Sep</option><option value="weekday-long">Saturday, 12 September</option><option value="date">12/09/2026</option><option value="time">05:30</option><option value="date-time">12/09 05:30</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Timezone<input value={options.timeZone || 'Europe/London'} onChange={(event) => updateOptions({ timeZone: event.target.value })} style={control(theme)} /></label>
      </div> : null}

      {segment.type === 'countdown' ? <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Ends at<input type="datetime-local" value={new Date(Number(options.timestamp || Date.now()) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} onChange={(event) => updateOptions({ timestamp: new Date(event.target.value).getTime() })} style={control(theme)} /></label>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}><Toggle label="Days" checked={options.includeDays !== false} onChange={(checked) => updateOptions({ includeDays: checked })} /><Toggle label="Hours" checked={options.includeHours !== false} onChange={(checked) => updateOptions({ includeHours: checked })} /><Toggle label="Minutes" checked={options.includeMinutes !== false} onChange={(checked) => updateOptions({ includeMinutes: checked })} /></div>
        <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Text when finished<input value={options.endText || ''} onChange={(event) => updateOptions({ endText: event.target.value })} style={control(theme)} /></label>
      </div> : null}

      {isGoalType ? <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Countdown to a goal <span style={{ color: theme.mutedText, fontWeight: 600 }}>Optional — leave blank for the normal count.</span><input type="number" min="1" value={options.goal || ''} onChange={(event) => updateOptions({ goal: event.target.value ? Number(event.target.value) : null })} style={control(theme)} /></label> : null}
    </div>
  );
}

export default function Stats({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdFrom(selectedGuild, selectedGuildData);
  const [overview, setOverview] = useState(null);
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!guildId) return;
    setLoading(true); setError('');
    try {
      const [overviewData, configData] = await Promise.all([
        api.request(`/api/stats/${guildId}/overview`),
        api.request(`/api/stats/${guildId}/config`),
      ]);
      setOverview(overviewData); setConfig(configData.config || {});
    } catch (loadError) { setError(loadError.message || 'Could not load server counters.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [guildId]);

  const live = overview?.live || {};
  const counters = config?.counters || [];
  const roles = live.roles?.items || [];
  const channels = live.channels?.items || [];
  const activeCounters = counters.filter((counter) => counter.enabled).length;
  const statusTotal = live.members?.statuses || {};

  async function request(path, options = {}) {
    setBusy(true); setError('');
    try { return await api.request(path, options); }
    catch (requestError) { setError(requestError.message || 'That change could not be saved.'); throw requestError; }
    finally { setBusy(false); }
  }

  async function quickSetup() { await request(`/api/stats/${guildId}/counters/setup`, { method: 'POST', body: '{}' }); await load(); }
  async function refreshCounters() { await request(`/api/stats/${guildId}/refresh`, { method: 'POST', body: '{}' }); await load(); }
  async function toggleCounter(counter) { await request(`/api/stats/${guildId}/counters/${encodeURIComponent(counter.id)}/toggle`, { method: 'POST', body: JSON.stringify({ enabled: !counter.enabled }) }); await load(); }
  async function deleteCounter(counter) { if (!window.confirm(`Delete “${counter.name || 'Counter'}” and its Discord channel?`)) return; await request(`/api/stats/${guildId}/counters/${encodeURIComponent(counter.id)}`, { method: 'DELETE' }); setDraft(null); await load(); }
  async function saveDraft() {
    if (!draft?.segments?.length) return;
    const path = draft.id ? `/api/stats/${guildId}/counters/${encodeURIComponent(draft.id)}` : `/api/stats/${guildId}/counters`;
    const result = await request(path, { method: draft.id ? 'PATCH' : 'POST', body: JSON.stringify(draft) });
    setDraft(normalizeDraft(result.counter, config?.settings)); setPreview(''); await load();
  }
  async function previewDraft() {
    const result = await request(`/api/stats/${guildId}/counters/preview`, { method: 'POST', body: JSON.stringify(draft) });
    setPreview(result.preview || '');
  }
  async function saveSettings(patch) {
    const next = { ...(config?.settings || {}), ...patch };
    const result = await request(`/api/stats/${guildId}/config`, { method: 'PATCH', body: JSON.stringify({ settings: next }) });
    setConfig(result.config || config);
  }

  if (!guildId) return <EmptyState theme={theme} title="Select a server" text="Select a server to manage its counters." />;
  if (loading && !overview) return <LoadingPanel theme={theme} text="Loading server counters..." />;

  const guild = { id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || live.guild?.name || 'Server Counters' };
  const overviewContent = (
    <div style={{ display: 'grid', gap: 16 }}>
      <StatGrid min="160px">
        <SummaryStat theme={theme} label="Members" value={live.members?.total ?? '—'} accent="#60a5fa" description={`${live.members?.humans ?? 0} people · ${live.members?.bots ?? 0} bots`} />
        <SummaryStat theme={theme} label="Online" value={statusTotal.online ?? '—'} accent="#22c55e" description={`${statusTotal.idle || 0} idle · ${statusTotal.dnd || 0} DND`} />
        <SummaryStat theme={theme} label="In Voice" value={live.members?.inVoice ?? '—'} accent="#c084fc" description="Members currently in voice" />
        <SummaryStat theme={theme} label="Counters" value={activeCounters} accent="#f59e0b" description={`${counters.length} saved`} />
      </StatGrid>
      <SectionCard theme={theme} title="Server Counter Setup" subtitle="Live read-only text or voice channels that display your server numbers at a glance.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><PrimaryButton onClick={quickSetup} disabled={busy}>⚡ Quick Setup</PrimaryButton><SecondaryButton onClick={refreshCounters} disabled={busy}>🔄 Refresh Now</SecondaryButton><SecondaryButton onClick={() => setDraft(newDraft(config?.settings))} disabled={busy}>➕ Create Counter</SecondaryButton></div>
      </SectionCard>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 16 }}>
        <SectionCard theme={theme} title="Presence"><Row theme={theme} label="Online" value={statusTotal.online || 0} /><Row theme={theme} label="Idle" value={statusTotal.idle || 0} /><Row theme={theme} label="Do Not Disturb" value={statusTotal.dnd || 0} /><Row theme={theme} label="Offline" value={statusTotal.offline || 0} /></SectionCard>
        <SectionCard theme={theme} title="Server"><Row theme={theme} label="Text Channels" value={live.channels?.text ?? '—'} /><Row theme={theme} label="Voice Channels" value={live.channels?.voice ?? '—'} /><Row theme={theme} label="Roles" value={live.roles?.total ?? '—'} /><Row theme={theme} label="Boosts" value={live.guild?.premiumSubscriptionCount ?? 0} /><Row theme={theme} label="Emojis" value={live.emojis?.total ?? '—'} /></SectionCard>
      </div>
    </div>
  );

  const countersContent = (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionCard theme={theme} title="Your Counters" subtitle="Turn counters on or off, edit them, choose text or voice output, or combine up to four values in one channel name.">
        {counters.length ? <div style={{ display: 'grid', gap: 10 }}>{counters.map((counter) => <div key={counter.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{counter.enabled ? '🟢' : '⚫'} {counter.channelType === 'text' ? '#️⃣' : '🔊'} {counter.name || 'Counter'}</strong><div style={{ color: theme.mutedText, marginTop: 4 }}>{counter.segments?.map((segment) => TYPE_LABEL[segment.type] || segment.type).join(' + ')}</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><SecondaryButton onClick={() => setDraft(normalizeDraft(counter, config?.settings))}>Edit</SecondaryButton><SecondaryButton onClick={() => toggleCounter(counter)} disabled={busy}>{counter.enabled ? 'Turn Off' : 'Turn On'}</SecondaryButton><SecondaryButton danger onClick={() => deleteCounter(counter)} disabled={busy}>Delete</SecondaryButton></div></div>
          <div style={{ borderRadius: 9, padding: '9px 11px', background: 'rgba(148,163,184,0.10)', fontWeight: 800 }}>{counter.template}</div>
        </div>)}</div> : <div style={{ color: theme.mutedText }}>No counters yet. Use Quick Setup or create your first one.</div>}
      </SectionCard>

      {draft ? <SectionCard theme={theme} title={draft.id ? `Edit ${draft.name}` : 'Create Counter'} subtitle="Choose text or voice output, build the channel text, then insert up to four live values.">
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Counter name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} style={control(theme)} /></label>
            <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Channel type<select value={draft.channelType || 'voice'} onChange={(event) => setDraft({ ...draft, channelType: event.target.value })} style={control(theme)}><option value="voice">🔊 Voice Channel</option><option value="text">#️⃣ Text Channel</option></select></label>
            <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Update frequency<select value={draft.frequencyMinutes} onChange={(event) => setDraft({ ...draft, frequencyMinutes: Number(event.target.value) })} style={control(theme)}><option value="10">Every 10 minutes</option><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440">Daily</option></select></label>
          </div>
          <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Channel text<input value={draft.template} onChange={(event) => setDraft({ ...draft, template: event.target.value })} maxLength={100} style={control(theme)} /><span style={{ color: theme.mutedText, fontWeight: 600 }}>Use <code>{'{value}'}</code> for one counter. With multiple counters use <code>{'{1}'}</code>, <code>{'{2}'}</code>, <code>{'{3}'}</code>, <code>{'{4}'}</code>.</span></label>
          {draft.segments.map((segment, index) => <SegmentEditor key={index} theme={theme} segment={segment} index={index} roles={roles} channels={channels} canRemove={draft.segments.length > 1} onRemove={() => setDraft({ ...draft, segments: draft.segments.filter((_, itemIndex) => itemIndex !== index) })} onChange={(next) => setDraft({ ...draft, segments: draft.segments.map((item, itemIndex) => itemIndex === index ? next : item) })} />)}
          {draft.segments.length < 4 ? <SecondaryButton onClick={() => setDraft({ ...draft, segments: [...draft.segments, defaultSegment('members')], template: draft.segments.length === 1 && draft.template.includes('{value}') ? '{1} · {2}' : draft.template })}>➕ Add another value</SecondaryButton> : null}
          {preview ? <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${theme.cardBorder}` }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', marginBottom: 6 }}>Preview</div><strong>{preview}</strong></div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><PrimaryButton onClick={saveDraft} disabled={busy}>{busy ? 'Saving...' : 'Save Counter'}</PrimaryButton><SecondaryButton onClick={previewDraft} disabled={busy}>Preview</SecondaryButton><SecondaryButton onClick={() => { setDraft(null); setPreview(''); }}>Cancel</SecondaryButton></div>
        </div>
      </SectionCard> : null}
    </div>
  );

  const settingsContent = (
    <div style={{ display: 'grid', gap: 16 }}>
      <SectionCard theme={theme} title="Counter Settings" subtitle="Defaults used when Goliath creates new counter channels.">
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Counter category name<input value={config?.settings?.categoryName || '📊 SERVER STATS'} onChange={(event) => setConfig({ ...config, settings: { ...(config?.settings || {}), categoryName: event.target.value } })} onBlur={(event) => saveSettings({ categoryName: event.target.value })} style={control(theme)} /></label>
          <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>Default timezone<input value={config?.settings?.timeZone || 'Europe/London'} onChange={(event) => setConfig({ ...config, settings: { ...(config?.settings || {}), timeZone: event.target.value } })} onBlur={(event) => saveSettings({ timeZone: event.target.value })} style={control(theme)} /></label>
        </div>
      </SectionCard>
      <SectionCard theme={theme} title="Activity Tracking"><Row theme={theme} label="Messages tracked" value={overview?.stored?.activity?.totals?.messages || 0} /><Row theme={theme} label="Voice minutes tracked" value={overview?.stored?.activity?.totals?.voiceMinutes || 0} /><Row theme={theme} label="Joins tracked" value={overview?.stored?.activity?.totals?.joins || 0} /><Row theme={theme} label="Leaves tracked" value={overview?.stored?.activity?.totals?.leaves || 0} /></SectionCard>
    </div>
  );

  return (
    <ModuleShell
      title="Server Counters"
      subtitle="Statbot-style live Discord counters, built directly into Goliath."
      theme={theme}
      guild={guild}
      actions={<PrimaryButton onClick={load} disabled={loading || busy}>{loading ? 'Refreshing...' : 'Refresh'}</PrimaryButton>}
      tabs={[{ key: MODULE_TABS.overview, label: 'Overview' }, { key: 'counters', label: 'Counters' }, { key: 'settings', label: 'Settings' }]}
      status={config?.enabled ? 'Active' : 'Disabled'}
      updatedAt={overview?.updatedAt || 'Current session'}
      templateCount={counters.length}
      deploymentCount={activeCounters}
      notice={error}
      noticeTone="danger"
    >
      {{ [MODULE_TABS.overview]: overviewContent, counters: countersContent, settings: settingsContent }}
    </ModuleShell>
  );
}
