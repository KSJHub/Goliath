import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient.js';
import ModuleShell from '../../shared/ModuleShell.jsx';
import { SectionCard } from '../../shared/PageShell.jsx';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

function stamp(value, config = {}) { return value ? new Date(value).toLocaleString(config.locale || 'en-GB', { timeZone: config.timeZone || 'Europe/London' }) : 'Never'; }
export default function FreeGames({ theme, selectedGuild, selectedGuildData }) {
  const guildId = String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop();
  const generation = useRef(0);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const current = ++generation.current;
    setData(null); setDraft(null); setPreview(null); setError(''); setNotice(''); setBusy(false);
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
      const settings = Object.fromEntries(['enabled', 'channelId', 'stores', 'types', 'alerts', 'roleId', 'currency', 'priceMode', 'locale', 'timeZone', 'region'].map((key) => [key, draft[key]]));
      const payload = await api.request(`/api/free-games/${guildId}${refresh ? '/refresh' : ''}`, refresh ? { method: 'POST' } : { method: 'PATCH', body: JSON.stringify(settings) });
      if (generation.current !== current) return;
      setData((old) => ({ ...old, config: payload.config })); setDraft(payload.config);
      setNotice(refresh ? (payload.result?.skipped ? 'Free Games is disabled.' : 'Discord listing refreshed.') : 'Settings saved. The listing updates automatically within five minutes.');
    } catch (err) { if (generation.current === current) setError(err.message); }
    finally { if (generation.current === current) setBusy(false); }
  }
  async function previewDraft() {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const settings = Object.fromEntries(['enabled', 'channelId', 'stores', 'types', 'alerts', 'roleId', 'currency', 'priceMode', 'locale', 'timeZone', 'region'].map((key) => [key, draft[key]]));
      const result = await api.request(`/api/free-games/${guildId}/preview`, { method: 'POST', body: JSON.stringify(settings) });
      if (current === generation.current) setPreview(result);
    } catch (err) { if (current === generation.current) setError(err.message); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const button = { border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, padding: '10px 16px', borderRadius: 12, fontWeight: 800, cursor: 'pointer' };
  if (!guildId) return <p>Select a server to configure Free Games.</p>;
  if (!draft) return <p role={error ? 'alert' : 'status'}>{error || 'Loading Free Games…'}</p>;
  const patch = (value) => { setPreview(null); setDraft((old) => ({ ...old, ...value })); };
  const toggle = (key, value, checked) => patch({ [key]: checked ? [...draft[key], value] : draft[key].filter((item) => item !== value) });
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 };
  const checks = (key, choices) => <div style={grid}>{Object.entries(choices).map(([value, label]) => <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" disabled={busy} checked={draft[key].includes(value)} onChange={(event) => toggle(key, value, event.target.checked)} />{label}</label>)}</div>;
  const inputStyle = { ...button, width: '100%', boxSizing: 'border-box', marginTop: 6 };
  const select = (key, label, choices) => <label>{label}<select style={inputStyle} disabled={busy} value={draft[key]} onChange={(event) => patch({ [key]: event.target.value })}>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const previewCard = <SectionCard theme={theme} title="Preview matching offers">
    <p style={{ color: theme.mutedText }}>Preview your current selections before saving. This does not post to Discord or send alerts.</p>
    <button style={button} disabled={busy} onClick={previewDraft}>{busy ? 'Working…' : 'Preview current selections'}</button>
    {preview ? <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <p>{preview.offers.length} unique matching offers · {preview.pages.length} Discord listing messages · Feed checked {stamp(preview.fetchedAt, draft)}</p>
      {preview.pricing.warning ? <p role="status">{preview.pricing.warning}</p> : null}
      {preview.pricing.mode === 'converted' ? <p>≈ {preview.pricing.currency} estimates from USD · Frankfurter rate {preview.pricing.date}. Regional prices and eligibility can differ.</p> : null}
      <p style={{ color: theme.mutedText }}>Discord displays platform columns where space allows; narrow screens may stack them. Additional messages keep every offer accessible.</p>
      {preview.sections.map((section) => {
        const offers = preview.offers.filter((offer) => section.types.includes(offer.type));
        const accent = `#${section.color.toString(16).padStart(6, '0')}`;
        return offers.length ? <section key={section.title} style={{ border: `1px solid ${theme.cardBorder}`, borderLeft: `4px solid ${accent}`, borderRadius: 12, padding: 16, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 16px' }}>{section.title} · {offers.length}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
            {Object.entries(data.stores).map(([key, label]) => {
              const group = offers.filter((offer) => offer.stores.find((store) => draft.stores.includes(store)) === key);
              if (!group.length) return null;
              const platform = preview.platforms[key];
              return <div key={key} style={{ background: theme.softBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }}>{platform.imageUrl ? <img src={platform.imageUrl} alt="" width="22" height="22" /> : <span aria-hidden="true">{platform.fallback}</span>}{label} · {group.length}</h4>
                <ul style={{ paddingLeft: 18, margin: 0 }}>{group.map((offer) => <li key={offer.id} style={{ marginTop: 12, overflowWrap: 'anywhere' }}><a href={offer.url} target="_blank" rel="noreferrer">{offer.displayTitle}</a>{offer.priceText ? <> · <s>{offer.priceText}</s></> : null}<br /><span style={{ color: theme.mutedText }}>{data.types[offer.type]}{offer.stores.filter((store) => draft.stores.includes(store)).length > 1 ? ` · ${offer.stores.filter((store) => draft.stores.includes(store)).map((store) => data.stores[store]).join(', ')}` : ''}{offer.endsAt ? ` · Ends ${stamp(offer.endsAt, draft)}` : offer.endDateText ? ` · ${offer.endDateText} (source time; timezone unknown)` : ' · Expiry unknown'}</span></li>)}</ul>
              </div>;
            })}
          </div>
        </section> : null;
      })}
    </div> : null}
  </SectionCard>;
  const configuration = <div style={{ display: 'grid', gap: 18 }}>
    <SectionCard theme={theme} title="Delivery">
      <fieldset disabled={busy} style={{ border: 0, padding: 0, display: 'grid', gap: 18 }}>
        <label><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /> Enable Free Games</label>
        <ChannelSelect theme={theme} resources={data.channels} value={draft.channelId || ''} onChange={(channelId) => patch({ channelId: channelId || null })} label="Free Games channel" />
        <p style={{ color: theme.mutedText, margin: 0 }}>A maintained catalogue split into Games, DLC & Add-ons, and Loot/Betas. Each offer appears once with its platforms. Extra messages are used when needed. Disabling pauses updates and leaves the listing in place. Changing channel moves the listing on its next update.</p>
      </fieldset>
    </SectionCard>
    <SectionCard theme={theme} title="Currency and regional formatting">
      <div style={grid}>
        {select('currency', 'Display currency', data.currencies.map((code) => [code, code]))}
        {select('priceMode', 'Original price display', [['converted', 'Convert to selected currency (estimate)'], ['source', 'Show source USD'], ['hidden', 'Hide original prices']])}
        <label>Formatting locale<input style={inputStyle} disabled={busy} value={draft.locale} onChange={(event) => patch({ locale: event.target.value })} placeholder="en-GB" /></label>
        <label>Region code<input style={inputStyle} disabled={busy} value={draft.region} onChange={(event) => patch({ region: event.target.value.toUpperCase() })} placeholder="GB" maxLength={2} /></label>
        <label>Timezone<input style={inputStyle} list="free-games-timezones" disabled={busy} value={draft.timeZone} onChange={(event) => patch({ timeZone: event.target.value })} /><datalist id="free-games-timezones">{data.timeZones.map((zone) => <option key={zone} value={zone} />)}</datalist></label>
      </div>
      <p style={{ color: theme.mutedText }}>GBP and UK formatting are the default. Converted values use dated exchange rates and show ≈; they are not verified local store prices. If conversion is unavailable, prices are hidden while offers continue updating. Locale changes number/date formatting; offer text remains in the provider’s language. Region records your preference; check each offer’s regional eligibility.</p>
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
    {previewCard}
    <button style={button} disabled={busy} onClick={() => act(false)}>{busy ? 'Working…' : 'Save settings'}</button>
  </div>;
  const overview = <><SectionCard theme={theme} title="Free Games status"><div style={{ display: 'grid', gap: 12 }}>
    <p>{data.config.state.offerCount} matching offers · {data.config.state.deliveries.length} listing messages</p>
    <p>Last check: {stamp(data.config.state.lastCheck, data.config)}<br />Last successful update: {stamp(data.config.state.lastSuccess, data.config)}</p>
    <p>{!data.config.enabled ? 'Updates are paused.' : !data.config.channelId ? 'Needs setup: choose a destination channel.' : data.config.state.error ? 'Update failed. The last successful listing is retained.' : !data.config.state.lastSuccess ? 'Waiting for the first successful listing update.' : 'The last listing update succeeded.'}</p>
    {data.config.state.warning ? <p role="status">{data.config.state.warning}</p> : null}
    {data.config.state.error ? <p role="alert" style={{ color: '#fca5a5' }}>{data.config.state.error}</p> : null}
    <button style={button} disabled={busy || !data.config.enabled} onClick={() => act(true)}>Refresh saved listing now</button>
    <p style={{ color: theme.mutedText }}>Checks run every five minutes; the shared offer feed refreshes every 15 minutes. NEW marks offers discovered after the initial baseline and lasts 24 hours. Offers with a reliable expiry instant receive a countdown and an ending-soon marker within 48 hours. When the provider supplies no timezone, its original expiry text is shown instead.</p>
    <a href="https://www.gamerpower.com/" target="_blank" rel="noreferrer">Offers provided by GamerPower</a>
  </div></SectionCard>{previewCard}</>;
  return <ModuleShell key={guildId} theme={theme} title="Free Games" subtitle="Automatically share free games from your selected stores." guild={selectedGuildData} status={data.config.enabled ? ((data.config.state.error || data.config.state.warning) ? 'Warning' : !data.config.channelId ? 'Needs setup' : !data.config.state.lastSuccess ? 'Pending' : 'Enabled') : 'Disabled'} updatedAt={stamp(data.config.state.lastSuccess, data.config)} templateCount={3} deploymentCount={data.config.state.deliveries.length} notice={error || notice} noticeTone={error ? 'danger' : 'info'} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'configuration', label: 'Configuration' }]}>{{ overview, configuration }}</ModuleShell>;
}
