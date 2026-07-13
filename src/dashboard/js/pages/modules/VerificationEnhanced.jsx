import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

function guildIdFrom(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function list(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buttonStyle(theme, tone = 'default') {
  const backgrounds = {
    success: 'rgba(22,163,74,0.22)',
    danger: 'rgba(220,38,38,0.22)',
    primary: 'rgba(37,99,235,0.22)',
    default: 'rgba(15,23,42,0.45)',
  };
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: backgrounds[tone] || backgrounds.default,
    color: theme.cardText,
    borderRadius: 14,
    padding: '11px 14px',
    fontWeight: 950,
    cursor: 'pointer',
  };
}

function Field({ theme, label, value, onChange, multiline = false, placeholder = '' }) {
  const common = {
    width: '100%',
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.55)',
    color: theme.cardText,
    borderRadius: 14,
    padding: '12px 14px',
    fontWeight: 800,
  };
  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      {multiline
        ? <textarea rows={5} value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={{ ...common, resize: 'vertical' }} />
        : <input value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={common} />}
    </label>
  );
}

function Stat({ theme, label, value, hint }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.32)', borderRadius: 16, padding: 15 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 6, color: theme.cardText, fontSize: 25, fontWeight: 950, overflowWrap: 'anywhere' }}>{value}</div>
      {hint ? <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

export default function VerificationEnhanced({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdFrom(selectedGuild, selectedGuildData);
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [draft, setDraft] = useState({
    channelId: '',
    title: 'Server Verification',
    description: 'Press the button below to verify and unlock the server.',
    color: '#57f287',
    footer: 'Goliath Verification',
    buttonLabel: 'Verify',
    buttonEmoji: '',
    buttonStyle: 'success',
    imageUrl: '',
    thumbnailUrl: '',
  });
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

  const moduleConfig = data?.moduleConfig || {};
  const adminConfig = data?.adminConfig || {};
  const settings = moduleConfig.settings || {};
  const panels = data?.status?.panels || Object.values(moduleConfig.panels || {});
  const analytics = data?.status?.analytics || moduleConfig.analytics || {};
  const health = data?.health || null;
  const usableRoles = roles.filter((role) => String(role.id) !== String(guildId));

  function applyPanel(panel) {
    const template = panel || moduleConfig.panelTemplate || {};
    setDraft({
      channelId: panel?.channelId || adminConfig.verificationChannelId || '',
      title: template.title || 'Server Verification',
      description: template.description || 'Press the button below to verify and unlock the server.',
      color: template.color || '#57f287',
      footer: template.footer || 'Goliath Verification',
      buttonLabel: template.buttonLabel || 'Verify',
      buttonEmoji: template.buttonEmoji || '',
      buttonStyle: template.buttonStyle || 'success',
      imageUrl: template.imageUrl || '',
      thumbnailUrl: template.thumbnailUrl || '',
    });
  }

  async function load() {
    if (!guildId) return;
    setBusy('load');
    setError('');
    try {
      const [overview, rolePayload, channelPayload] = await Promise.all([
        api.getVerificationOverview(guildId),
        api.getGuildRoles(guildId),
        api.getGuildChannels(guildId),
      ]);
      setData(overview);
      setRoles(list(rolePayload, 'roles'));
      setChannels(list(channelPayload, 'channels'));
      const currentPanels = overview?.status?.panels || [];
      const current = currentPanels.find((panel) => String(panel.panelId) === String(selectedPanelId)) || currentPanels[0] || null;
      if (current && !selectedPanelId) setSelectedPanelId(current.panelId || current.id || '');
      applyPanel(current);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load verification.');
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
      await fn();
      if (successText) setNotice(successText);
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Verification action failed.');
    } finally {
      setBusy('');
    }
  }

  async function saveConfig(patch) {
    await act('config', () => api.saveVerificationConfig(guildId, {
      enabled: patch.enabled ?? adminConfig.enabled,
      verificationChannelId: patch.verificationChannelId ?? adminConfig.verificationChannelId,
      logChannelId: patch.logChannelId ?? adminConfig.logChannelId,
      verifiedRoleIds: patch.verifiedRoleIds ?? adminConfig.verifiedRoleIds ?? (settings.verifiedRoleId ? [settings.verifiedRoleId] : []),
      pendingRoleIds: patch.pendingRoleIds ?? adminConfig.pendingRoleIds ?? (settings.unverifiedRoleId ? [settings.unverifiedRoleId] : []),
      dmOnVerify: patch.dmOnVerify ?? adminConfig.dmOnVerify,
      removePendingRole: patch.removePendingRole ?? adminConfig.removePendingRole,
    }), 'Verification configuration saved.');
  }

  function selectPanel(panelId) {
    setSelectedPanelId(panelId);
    const panel = panels.find((item) => String(item.panelId || item.id) === String(panelId));
    applyPanel(panel || null);
  }

  async function deploy() {
    if (!draft.channelId) {
      setError('Choose a verification channel first.');
      return;
    }
    await act('deploy', async () => {
      await api.saveVerificationTemplate(guildId, draft);
      if (selectedPanelId) await api.refreshVerificationPanel(guildId, selectedPanelId, { ...draft, channelId: draft.channelId });
      else await api.deployVerificationPanel(guildId, { ...draft, channelId: draft.channelId });
    }, selectedPanelId ? 'Verification panel repaired and redeployed.' : 'Verification panel deployed.');
  }

  async function removePanel() {
    if (!selectedPanelId) return;
    if (!window.confirm('Delete this verification panel message and its saved record?')) return;
    await act('delete', () => api.deleteVerificationPanel(guildId, selectedPanelId), 'Verification panel deleted.');
    setSelectedPanelId('');
  }

  async function resetModule() {
    if (!window.confirm('Reset all Verification settings, analytics and panel records?')) return;
    await act('reset', () => api.resetVerification(guildId), 'Verification reset to defaults.');
    setSelectedPanelId('');
  }

  if (!guildId) return <EmptyState theme={theme} icon="✅" title="Select a server" description="Select a server to manage Verification." />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08) 46%, rgba(52,211,153,0.14))' }}>
        <div style={{ color: '#93c5fd', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goliath Protection</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px,4vw,42px)' }}>Verification</h1>
        <p style={{ color: theme.mutedText, lineHeight: 1.6 }}>Configure roles, channels, panel design, deployment, repair, exports and module health.</p>
      </section>

      {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}>
        <Stat theme={theme} label="Status" value={data?.status?.enabled ? 'Enabled' : 'Disabled'} />
        <Stat theme={theme} label="Panels" value={panels.length} />
        <Stat theme={theme} label="Verified" value={analytics.verified || 0} />
        <Stat theme={theme} label="Failed" value={analytics.failed || 0} />
        <Stat theme={theme} label="Health" value={health?.warnings?.length ? 'Needs attention' : 'Healthy'} hint={`${health?.warnings?.length || 0} warning(s)`} />
      </section>

      <section style={{ ...card, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0 }}>Module Setup</h2><p style={{ color: theme.mutedText }}>All selections persist through GuildManager.</p></div>
          <button type="button" disabled={busy} onClick={() => saveConfig({ enabled: !data?.status?.enabled })} style={buttonStyle(theme, 'primary')}>{data?.status?.enabled ? 'Disable' : 'Enable'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 14 }}>
          <ChannelSelect theme={theme} resources={channels} value={adminConfig.verificationChannelId || draft.channelId} onChange={(value) => saveConfig({ verificationChannelId: value || null })} label="Verification Channel" />
          <ChannelSelect theme={theme} resources={channels} value={adminConfig.logChannelId || settings.logChannelId || ''} onChange={(value) => saveConfig({ logChannelId: value || null })} label="Log Channel" />
          <RoleSelect theme={theme} resources={usableRoles} value={adminConfig.verifiedRoleIds?.[0] || settings.verifiedRoleId || ''} onChange={(value) => saveConfig({ verifiedRoleIds: value ? [value] : [] })} label="Verified Role" />
          <RoleSelect theme={theme} resources={usableRoles} value={adminConfig.pendingRoleIds?.[0] || settings.unverifiedRoleId || ''} onChange={(value) => saveConfig({ pendingRoleIds: value ? [value] : [] })} label="Pending Role" />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={() => saveConfig({ dmOnVerify: adminConfig.dmOnVerify === false })} style={buttonStyle(theme)}>{adminConfig.dmOnVerify === false ? 'Enable DM' : 'Disable DM'}</button>
          <button type="button" disabled={busy} onClick={() => saveConfig({ removePendingRole: adminConfig.removePendingRole === false })} style={buttonStyle(theme)}>{adminConfig.removePendingRole === false ? 'Remove Pending: Off' : 'Remove Pending: On'}</button>
          <a href={api.getVerificationExportUrl(guildId)} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
          <button type="button" disabled={busy} onClick={resetModule} style={buttonStyle(theme, 'danger')}>Reset Module</button>
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 16 }}>
        <div><h2 style={{ margin: 0 }}>Panel Builder</h2><p style={{ color: theme.mutedText }}>Create a new panel or select an existing panel to edit and redeploy it.</p></div>
        <label style={{ display: 'grid', gap: 8 }}>
          <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>SAVED PANEL</span>
          <select value={selectedPanelId} onChange={(event) => selectPanel(event.target.value)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px' }}>
            <option value="">Create new panel</option>
            {panels.map((panel) => <option key={panel.panelId || panel.id} value={panel.panelId || panel.id}>{panel.title || panel.panelId || panel.id}</option>)}
          </select>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 14 }}>
          <ChannelSelect theme={theme} resources={channels} value={draft.channelId} onChange={(value) => setDraft((current) => ({ ...current, channelId: value }))} label="Deploy Channel" />
          <Field theme={theme} label="Title" value={draft.title} onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
          <Field theme={theme} label="Colour" value={draft.color} onChange={(value) => setDraft((current) => ({ ...current, color: value }))} placeholder="#57f287" />
          <Field theme={theme} label="Footer" value={draft.footer} onChange={(value) => setDraft((current) => ({ ...current, footer: value }))} />
          <Field theme={theme} label="Button Label" value={draft.buttonLabel} onChange={(value) => setDraft((current) => ({ ...current, buttonLabel: value }))} />
          <Field theme={theme} label="Button Emoji" value={draft.buttonEmoji} onChange={(value) => setDraft((current) => ({ ...current, buttonEmoji: value }))} />
          <Field theme={theme} label="Image URL" value={draft.imageUrl} onChange={(value) => setDraft((current) => ({ ...current, imageUrl: value }))} />
          <Field theme={theme} label="Thumbnail URL" value={draft.thumbnailUrl} onChange={(value) => setDraft((current) => ({ ...current, thumbnailUrl: value }))} />
        </div>
        <Field theme={theme} label="Description" value={draft.description} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} multiline />
        <label style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
          <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>BUTTON STYLE</span>
          <select value={draft.buttonStyle} onChange={(event) => setDraft((current) => ({ ...current, buttonStyle: event.target.value }))} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px' }}>
            <option value="success">Success</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="danger">Danger</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy === 'deploy'} onClick={deploy} style={buttonStyle(theme, 'success')}>{busy === 'deploy' ? 'Working...' : selectedPanelId ? 'Repair / Redeploy Panel' : 'Deploy New Panel'}</button>
          {selectedPanelId ? <button type="button" disabled={busy} onClick={removePanel} style={buttonStyle(theme, 'danger')}>Delete Panel</button> : null}
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Health & Diagnostics</h2>
        {health?.warnings?.length
          ? health.warnings.map((warning) => <div key={warning} style={{ color: '#fbbf24', fontWeight: 800 }}>⚠ {warning}</div>)
          : <div style={{ color: '#86efac', fontWeight: 900 }}>✅ Verification configuration is healthy.</div>}
        {(health?.panels || []).map((panel) => <div key={panel.panelId} style={{ color: panel.ok ? '#86efac' : '#fca5a5' }}>{panel.ok ? '✅' : '❌'} {panel.panelId}: {panel.status}</div>)}
        <button type="button" disabled={busy === 'load'} onClick={load} style={{ ...buttonStyle(theme), justifySelf: 'start' }}>Refresh Health</button>
      </section>
    </div>
  );
}
