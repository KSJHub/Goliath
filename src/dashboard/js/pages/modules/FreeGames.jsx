import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient.js';
import ModuleShell from '../../shared/ModuleShell.jsx';
import { SectionCard } from '../../shared/PageShell.jsx';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

function stamp(value) { return value ? new Date(value).toLocaleString() : 'Never'; }
export default function FreeGames({ theme, selectedGuild, selectedGuildData }) {
  const guildId = String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop();
  const generation = useRef(0);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const current = ++generation.current;
    setData(null); setDraft(null); setError(''); setNotice(''); setBusy(false);
    if (!guildId) return;
    api.request(`/api/free-games/${guildId}`).then((payload) => {
      if (generation.current !== current) return;
      setData(payload); setDraft(payload.config);
    }).catch((err) => { if (generation.current === current) setError(err.message); });
    return () => { generation.current++; };
  }, [guildId]);
  async function act(refresh = false) {
    const current = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const settings = Object.fromEntries(['enabled', 'channelId', 'stores', 'types', 'alerts', 'roleId'].map((key) => [key, draft[key]]));
      const payload = await api.request(`/api/free-games/${guildId}${refresh ? '/refresh' : ''}`, refresh ? { method: 'POST' } : { method: 'PATCH', body: JSON.stringify(settings) });
      if (generation.current !== current) return;
      setData((old) => ({ ...old, config: payload.config })); setDraft(payload.config);
      setNotice(refresh ? (payload.result?.skipped ? 'Free Games is disabled.' : 'Discord listing refreshed.') : 'Settings saved. The listing updates automatically within five minutes.');
    } catch (err) { if (generation.current === current) setError(err.message); }
    finally { if (generation.current === current) setBusy(false); }
  }
  const button = { border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, padding: '10px 16px', borderRadius: 12, fontWeight: 800, cursor: 'pointer' };
  if (!guildId) return <p>Select a server to configure Free Games.</p>;
  if (!draft) return <p role={error ? 'alert' : 'status'}>{error || 'Loading Free Games…'}</p>;
  const patch = (value) => setDraft((old) => ({ ...old, ...value }));
  const toggle = (key, value, checked) => patch({ [key]: checked ? [...draft[key], value] : draft[key].filter((item) => item !== value) });
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 };
  const checks = (key, choices) => <div style={grid}>{Object.entries(choices).map(([value, label]) => <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" disabled={busy} checked={draft[key].includes(value)} onChange={(event) => toggle(key, value, event.target.checked)} />{label}</label>)}</div>;
  const configuration = <div style={{ display: 'grid', gap: 18 }}>
    <SectionCard theme={theme} title="Delivery">
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 18 }}>
        <label><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /> Enable Free Games</label>
        <ChannelSelect theme={theme} resources={data.channels} value={draft.channelId || ''} onChange={(channelId) => patch({ channelId: channelId || null })} label="Free Games channel" />
        <p style={{ color: theme.mutedText, margin: 0 }}>One maintained listing, grouped by store. Extra messages are used when needed. Disabling pauses updates and leaves the listing in place. Changing channel moves the listing on its next update.</p>
      </fieldset>
    </SectionCard>
    <SectionCard theme={theme} title="Stores and platforms">{checks('stores', data.stores)}</SectionCard>
    <SectionCard theme={theme} title="Offer types">{checks('types', data.types)}<p style={{ color: theme.mutedText }}>Games to keep is the default. DLC and loot may require a base game. Beta access, demos and free weekends are temporary and labelled separately. Availability depends on the provider feed.</p></SectionCard>
    <SectionCard theme={theme} title="New offer alerts">
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 16 }}>
        <label><input type="checkbox" checked={draft.alerts} onChange={(event) => patch({ alerts: event.target.checked })} /> Post an alert for newly discovered offers</label>
        <RoleSelect theme={theme} resources={data.roles} value={draft.roleId || ''} onChange={(roleId) => patch({ roleId: roleId || null })} placeholder="No role ping" label="Optional notification role" />
        <p style={{ margin: 0, color: theme.mutedText }}>No role selected means no ping. Initial setup and filter changes establish a quiet baseline. Restarts and routine updates do not repeat alerts.</p>
      </fieldset>
    </SectionCard>
    <button style={button} disabled={busy} onClick={() => act(false)}>{busy ? 'Working…' : 'Save settings'}</button>
  </div>;
  const overview = <SectionCard theme={theme} title="Free Games status"><div style={{ display: 'grid', gap: 12 }}>
    <p>{data.config.state.offerCount} matching offers · {data.config.state.deliveries.length} listing messages</p>
    <p>Last check: {stamp(data.config.state.lastCheck)}<br />Last successful update: {stamp(data.config.state.lastSuccess)}</p>
    {data.config.state.error ? <p role="alert" style={{ color: '#fca5a5' }}>{data.config.state.error}</p> : null}
    <button style={button} disabled={busy || !data.config.enabled} onClick={() => act(true)}>Refresh saved listing now</button>
    <p style={{ color: theme.mutedText }}>Checks run every five minutes; the shared offer feed refreshes every 15 minutes. NEW lasts 24 hours. Offers with a reliable expiry instant receive a countdown and an ending-soon marker within 48 hours. When the provider supplies no timezone, its original expiry text is shown instead.</p>
    <a href="https://www.gamerpower.com/" target="_blank" rel="noreferrer">Offers provided by GamerPower</a>
  </div></SectionCard>;
  return <ModuleShell key={guildId} theme={theme} title="Free Games" subtitle="Automatically share free games from your selected stores." guild={selectedGuildData} status={data.config.enabled ? (data.config.state.error ? 'Warning' : 'Enabled') : 'Disabled'} updatedAt={stamp(data.config.state.lastSuccess)} deploymentCount={data.config.state.deliveries.length} notice={error || notice} noticeTone={error ? 'danger' : 'info'} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'configuration', label: 'Configuration' }]}>{{ overview, configuration }}</ModuleShell>;
}
