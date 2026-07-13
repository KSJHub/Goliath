import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect } from '../../ui/DiscordResourceSelects.jsx';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buttonStyle(theme, tone = 'default') {
  const colors = {
    primary: 'rgba(37,99,235,0.22)',
    success: 'rgba(22,163,74,0.22)',
    danger: 'rgba(220,38,38,0.22)',
    default: 'rgba(15,23,42,0.45)',
  };
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: colors[tone] || colors.default,
    color: theme.cardText,
    borderRadius: 14,
    padding: '11px 14px',
    fontWeight: 950,
    cursor: 'pointer',
  };
}

function fieldStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.55)',
    color: theme.cardText,
    borderRadius: 14,
    padding: '12px 14px',
    fontWeight: 800,
    width: '100%',
  };
}

function Stat({ theme, label, value, hint }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.32)', borderRadius: 18, padding: 16 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 7, color: theme.cardText, fontSize: 27, fontWeight: 950 }}>{value}</div>
      {hint ? <div style={{ marginTop: 3, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

export default function Welcome({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [templates, setTemplates] = useState([]);
  const [binding, setBinding] = useState(null);
  const [channels, setChannels] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const card = useMemo(() => ({
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
    padding: 22,
  }), [theme]);

  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const activeTemplateId = binding?.templateId || overview.templateId || config?.templateId || 'welcome_default';
  const activeTemplate = templates.find((template) => String(template.templateId) === String(activeTemplateId)) || binding || null;

  async function load() {
    if (!guildId) return;
    setBusy('load');
    setError('');
    try {
      const [welcomePayload, channelPayload] = await Promise.all([
        api.request(`/api/welcome/${guildId}/overview`),
        api.getGuildChannels(guildId),
      ]);
      setConfig(welcomePayload.config || {});
      setOverview(welcomePayload.overview || {});
      setTemplates(Array.isArray(welcomePayload.templates) ? welcomePayload.templates : []);
      setBinding(welcomePayload.binding || null);
      setChannels(normalizeList(channelPayload, 'channels'));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Welcome.');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    load();
  }, [guildId]);

  async function act(name, fn, successText) {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config);
      if (result?.overview) setOverview(result.overview);
      if (result?.templates) setTemplates(result.templates);
      if (result?.binding) setBinding(result.binding);
      if (successText) setNotice(successText);
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Welcome action failed.');
    } finally {
      setBusy('');
    }
  }

  async function savePatch(patch, message = 'Welcome settings saved.') {
    const next = { ...(config || {}), ...patch };
    setConfig(next);
    await act('save', () => api.request(`/api/welcome/${guildId}/config`, { method: 'PUT', body: JSON.stringify(patch) }), message);
  }

  async function bindTemplate(templateId) {
    if (!templateId) return;
    await act('template', () => api.request(`/api/welcome/${guildId}/template`, {
      method: 'POST',
      body: JSON.stringify({ templateId }),
    }), 'Embed Studio template connected to Welcome.');
  }

  async function resetModule() {
    if (!window.confirm('Reset all Welcome settings and analytics?')) return;
    await act('reset', () => api.request(`/api/welcome/${guildId}/reset`, { method: 'POST' }), 'Welcome reset to defaults.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="👋" title="Select a server" description="Select a server to manage Welcome." />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(52,211,153,0.18), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.14))' }}>
        <div style={{ color: '#86efac', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goliath Onboarding</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px,4vw,42px)' }}>Welcome</h1>
        <p style={{ color: theme.mutedText, lineHeight: 1.6 }}>Design the message in Embed Studio, bind it here, then let Welcome deliver it automatically whenever a member joins.</p>
      </section>

      {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}>
        <Stat theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} />
        <Stat theme={theme} label="Template" value={overview.templateBound ? 'Bound' : 'Fallback'} hint={overview.templateName || activeTemplateId} />
        <Stat theme={theme} label="Public Sent" value={analytics.publicSent || 0} />
        <Stat theme={theme} label="DM Sent" value={analytics.dmSent || 0} />
        <Stat theme={theme} label="Failed" value={(analytics.publicFailed || 0) + (analytics.dmFailed || 0)} />
        <Stat theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.warnings?.length || 0} warning(s)`} />
      </section>

      <section style={{ ...card, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0 }}>Delivery Settings</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Welcome owns when and where the Embed Studio message is sent.</p></div>
          <button type="button" disabled={busy} onClick={() => savePatch({ enabled: !(overview.enabled || config?.enabled) }, overview.enabled || config?.enabled ? 'Welcome disabled.' : 'Welcome enabled.')} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
        </div>

        <ChannelSelect theme={theme} resources={channels} value={config?.channelId || ''} onChange={(value) => savePatch({ channelId: value || null })} label="Public Welcome Channel" />

        <label style={{ display: 'grid', gap: 8 }}>
          <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Embed Studio Welcome Template</span>
          <select value={activeTemplateId} onChange={(event) => bindTemplate(event.target.value)} disabled={busy || templates.length === 0} style={fieldStyle(theme)}>
            {templates.length === 0 ? <option value="">No Welcome templates found</option> : null}
            {templates.map((template) => (
              <option key={template.templateId} value={template.templateId}>{template.name || template.templateId}</option>
            ))}
          </select>
          <span style={{ color: overview.templateBound ? '#86efac' : '#fbbf24', fontSize: 12, fontWeight: 850 }}>
            {overview.templateBound ? 'Connected to the Welcome slot in Embed Studio.' : 'Using a fallback template. Choose one above to create an explicit binding.'}
          </span>
        </label>

        {activeTemplate ? (
          <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 16, padding: 15, display: 'grid', gap: 6 }}>
            <strong>{activeTemplate.name || activeTemplate.templateId}</strong>
            <span style={{ color: theme.mutedText }}>{activeTemplate.embed?.title || 'Untitled welcome embed'}</span>
            <span style={{ color: theme.mutedText, fontSize: 12 }}>Template ID: {activeTemplate.templateId}</span>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.dmEnabled === true} onChange={(event) => savePatch({ dmEnabled: event.target.checked })} /> Send welcome DM</label>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.allowUserPing !== false} onChange={(event) => savePatch({ allowUserPing: event.target.checked })} /> Ping new member</label>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.ignoreBots !== false} onChange={(event) => savePatch({ ignoreBots: event.target.checked })} /> Ignore bots</label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || (!config?.channelId && !config?.dmEnabled)} onClick={() => act('test', () => api.request(`/api/welcome/${guildId}/test`, { method: 'POST', body: JSON.stringify({ userId: selectedGuildData?.userId }) }), 'Test welcome sent using the active template.')} style={buttonStyle(theme, 'success')}>Test Welcome</button>
          <button type="button" disabled={busy} onClick={() => act('repair', () => api.request(`/api/welcome/${guildId}/repair`, { method: 'POST' }), 'Welcome configuration repaired.')} style={buttonStyle(theme, 'primary')}>Repair</button>
          <a href={`/api/welcome/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
          <button type="button" disabled={busy} onClick={resetModule} style={buttonStyle(theme, 'danger')}>Reset</button>
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Health & Diagnostics</h2>
        {health?.warnings?.length
          ? health.warnings.map((warning) => <div key={warning} style={{ color: '#fbbf24', fontWeight: 850 }}>⚠ {warning}</div>)
          : <div style={{ color: '#86efac', fontWeight: 900 }}>✅ Welcome configuration is healthy.</div>}
        <div style={{ color: theme.mutedText }}>Channel: {health?.channelName || health?.channelId || 'Not configured'}</div>
        <div style={{ color: theme.mutedText }}>Template: {health?.templateName || health?.templateId || 'Not configured'} · Bound: {health?.templateBound ? 'Yes' : 'No'}</div>
        <div style={{ color: theme.mutedText }}>View: {health?.canView ? 'Yes' : 'No'} · Send: {health?.canSend ? 'Yes' : 'No'} · Embed: {health?.canEmbed ? 'Yes' : 'No'}</div>
        <button type="button" disabled={busy === 'load'} onClick={load} style={{ ...buttonStyle(theme), justifySelf: 'start' }}>{busy === 'load' ? 'Refreshing...' : 'Refresh Health'}</button>
      </section>
    </div>
  );
}
