import { goliathDialog } from '../../shared/GoliathDialogHost.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const DEFAULT_PANEL_DRAFT = Object.freeze({
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

function guildIdFrom(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '')
    .split(':')
    .pop()
    .trim();
}

function list(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function panelDraft(panel, moduleConfig, adminConfig) {
  const template = panel || moduleConfig.panelTemplate || {};
  return {
    channelId: panel?.channelId || adminConfig.verificationChannelId || DEFAULT_PANEL_DRAFT.channelId,
    title: template.title || DEFAULT_PANEL_DRAFT.title,
    description: template.description || DEFAULT_PANEL_DRAFT.description,
    color: template.color || DEFAULT_PANEL_DRAFT.color,
    footer: template.footer || DEFAULT_PANEL_DRAFT.footer,
    buttonLabel: template.buttonLabel || DEFAULT_PANEL_DRAFT.buttonLabel,
    buttonEmoji: template.buttonEmoji || DEFAULT_PANEL_DRAFT.buttonEmoji,
    buttonStyle: template.buttonStyle || DEFAULT_PANEL_DRAFT.buttonStyle,
    imageUrl: template.imageUrl || DEFAULT_PANEL_DRAFT.imageUrl,
    thumbnailUrl: template.thumbnailUrl || DEFAULT_PANEL_DRAFT.thumbnailUrl,
  };
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

const SECURITY_OPTIONS = [
  ['simple', 'Simple button'], ['captcha', 'CAPTCHA'], ['minigame', 'Mini-games'],
  ['accountAge', 'Account age'], ['discordScreening', 'Discord screening'],
  ['botProtection', 'Bot protection'], ['staffApproval', 'Staff approval'],
  ['oneTimeChallenge', 'One-time challenge'], ['riskBased', 'Risk-based checks'],
  ['rejoinHistory', 'Rejoin history'],
];
const FLOW_NAMES = {
  simple: 'simple', captcha: 'captcha', minigame: 'minigame',
  accountAge: 'account_age', discordScreening: 'discord_screening',
  botProtection: 'bot_protection', staffApproval: 'staff_approval',
  oneTimeChallenge: 'one_time_challenge', riskBased: 'risk_based',
  rejoinHistory: 'rejoin_history',
};
function readPath(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}
function writePath(source, path, value) {
  const keys = path.split('.');
  const result = { ...source };
  let node = result;
  let previous = source;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) node[key] = value;
    else {
      node[key] = { ...(previous?.[key] || {}) };
      node = node[key];
      previous = previous?.[key];
    }
  });
  return result;
}
function Toggle({ theme, label, checked, onChange }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.cardText, fontWeight: 750 }}>
    <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
    {label}
  </label>;
}
function NumberSetting({ theme, label, value, min = 0, max = 10080, onChange }) {
  return <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontSize: 12, fontWeight: 850 }}>
    {label}
    <input type="number" min={min} max={max} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 10, padding: 10, width: '100%' }} />
  </label>;
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
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_PANEL_DRAFT }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [advanced, setAdvanced] = useState(null);
  const advancedDirty = useRef(false);
  const loadedGuild = useRef('');

  const card = useMemo(() => ({
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
    padding: 22,
  }), [theme]);

  const moduleConfig = data?.moduleConfig || {};
  const status = data?.status || {};
  const adminConfig = data?.adminConfig || {};
  const settings = moduleConfig.settings || {};
  const panels = useMemo(
    () => data?.status?.panels || Object.values(moduleConfig.panels || {}),
    [data?.status?.panels, moduleConfig.panels]
  );
  const analytics = data?.status?.analytics || moduleConfig.analytics || {};
  const health = data?.health || null;
  const usableRoles = useMemo(
    () => roles.filter((role) => String(role.id) !== String(guildId)),
    [roles, guildId]
  );

  function applyPanel(panel) {
    setDraft(panelDraft(panel, moduleConfig, adminConfig));
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
      // The Verification API returns flat config/panels/analytics fields.
      // Adapt them for this dashboard without modifying the server's response contract.
      const config = overview?.config || {};
      const adapted = {
        ...overview,
        status: { enabled: config.enabled === true, panels: overview?.panels || [], analytics: overview?.analytics || {} },
        moduleConfig: { settings: config, panelTemplate: overview?.panelTemplate || {}, panels: overview?.panels || [], analytics: overview?.analytics || {} },
        adminConfig: config,
      };
      setData(adapted);
      if (loadedGuild.current !== guildId || !advancedDirty.current) {
        setAdvanced(config);
        advancedDirty.current = false;
        loadedGuild.current = guildId;
      }
      setRoles(list(rolePayload, 'roles'));
      setChannels(list(channelPayload, 'channels'));
      const currentPanels = Array.isArray(overview?.panels) ? overview.panels : [];
      const current = currentPanels.find((panel) => String(panel.panelId) === String(selectedPanelId)) || currentPanels[0] || null;
      if (current && !selectedPanelId) setSelectedPanelId(current.panelId || current.id || '');
      setDraft(panelDraft(current, adapted.moduleConfig, adapted.adminConfig));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load verification.');
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (loadedGuild.current !== guildId) advancedDirty.current = false;
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
    await act('config', () => api.saveVerificationConfig(guildId, patch), 'Verification configuration saved.');
  }

  function setAdvancedPath(path, value) {
    setError('');
    advancedDirty.current = true;
    setAdvanced((current) => writePath(current || settings, path, value));
  }

  function toggleSecurity(key, enabled) {
    setError('');
    advancedDirty.current = true;
    setAdvanced((current) => {
      const next = writePath(current || settings, `security.${key}`, enabled);
      const method = FLOW_NAMES[key];
      const ordered = [...(next.flow?.orderedSecurity || ['simple'])];
      if (enabled && !ordered.includes(method)) ordered.push(method);
      if (!enabled && ordered.includes(method)) ordered.splice(ordered.indexOf(method), 1);
      return writePath(next, 'flow.orderedSecurity', ordered);
    });
  }

  async function saveAdvanced() {
    if (!advanced) {
      setError('Verification settings have not loaded yet.');
      return;
    }
    if (busy) return;
    setError('');
    setNotice('');

    // Keep the user's existing step order, append newly enabled methods and
    // remove disabled or duplicate methods. Legacy defaults may enable checks
    // without including them in the saved flow.
    const enabledMethods = SECURITY_OPTIONS
      .filter(([key]) => advanced.security?.[key] === true)
      .map(([key]) => FLOW_NAMES[key]);
    const existingOrder = Array.isArray(advanced.flow?.orderedSecurity)
      ? advanced.flow.orderedSecurity : [];
    const order = [
      ...existingOrder.filter((method, index) =>
        enabledMethods.includes(method) && existingOrder.indexOf(method) === index),
      ...enabledMethods.filter((method) => !existingOrder.includes(method)),
    ];
    const staffRoles = advanced.roles?.staff || [];
    if (advanced.security?.staffApproval && staffRoles.length === 0) {
      setError('Select at least one Staff Approval role before saving.');
      return;
    }
    if (advanced.flow?.enabled && order.length === 0) {
      setError('Enable at least one security method before saving an active verification flow.');
      return;
    }

    const normalized = writePath(advanced, 'flow.orderedSecurity', order);
    const { enabled: _enabled, ...settingsPayload } = normalized;
    setBusy('config');
    try {
      await api.saveVerificationConfig(guildId, { settings: settingsPayload });
      // Only clear the dirty flag after the API confirms persistence.
      // Refresh once, rather than calling act() and loading twice.
      advancedDirty.current = false;
      setAdvanced(normalized);
      await load();
      setNotice('Advanced verification settings saved.');
    } catch (saveError) {
      advancedDirty.current = true;
      setError(saveError.message || 'Failed to save advanced verification settings.');
    } finally {
      setBusy('');
    }
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
    if (!await goliathDialog.confirm('Delete this verification panel message and its saved record?', { title: 'Delete Verification Panel?', danger: true, confirmLabel: 'Delete Panel' })) return;
    await act('delete', () => api.deleteVerificationPanel(guildId, selectedPanelId), 'Verification panel deleted.');
    setSelectedPanelId('');
  }

  async function resetModule() {
    if (!await goliathDialog.confirm('Reset all Verification settings, analytics and panel records?', { title: 'Reset Verification?', danger: true, confirmLabel: 'Reset Verification' })) return;
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

      <section style={{ ...card, display: 'grid', gap: 18 }}>
        <div><h2 style={{ margin: 0 }}>Security Methods & Verification Flow</h2>
          <p style={{ color: theme.mutedText }}>Per-server security methods. Staff Approval is optional and can be placed anywhere in the flow.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
          {SECURITY_OPTIONS.map(([key, label]) => <Toggle key={key} theme={theme} label={label}
            checked={readPath(advanced, `security.${key}`)} onChange={(value) => toggleSecurity(key, value)} />)}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Ordered Verification Steps</h3>
          {(advanced?.flow?.orderedSecurity || []).map((method, index, items) => (
            <div key={method} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }}>{index + 1}. {SECURITY_OPTIONS.find(([key]) => FLOW_NAMES[key] === method)?.[1] || method}</span>
              <button type="button" disabled={busy || index === 0} style={buttonStyle(theme)} onClick={() => {
                const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                setAdvancedPath('flow.orderedSecurity', next);
              }}>Move up</button>
              <button type="button" disabled={busy || index === items.length - 1} style={buttonStyle(theme)} onClick={() => {
                const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]];
                setAdvancedPath('flow.orderedSecurity', next);
              }}>Move down</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 14 }}>
          <NumberSetting theme={theme} label="Maximum failed attempts" value={readPath(advanced, 'security.maximumFailedAttempts')} min={0} max={1000} onChange={(v) => setAdvancedPath('security.maximumFailedAttempts', v)} />
          <NumberSetting theme={theme} label="Cooldown (seconds)" value={readPath(advanced, 'security.attemptCooldownSeconds')} max={86400} onChange={(v) => setAdvancedPath('security.attemptCooldownSeconds', v)} />
          <NumberSetting theme={theme} label="Session timeout (minutes)" value={readPath(advanced, 'security.sessionTimeoutMinutes')} min={1} onChange={(v) => setAdvancedPath('security.sessionTimeoutMinutes', v)} />
          <NumberSetting theme={theme} label="Minimum account age (days)" value={readPath(advanced, 'security.minimumAccountAgeDays')} max={3650} onChange={(v) => setAdvancedPath('security.minimumAccountAgeDays', v)} />
          <NumberSetting theme={theme} label="CAPTCHA timeout (seconds)" value={readPath(advanced, 'security.captchaConfig.timeLimitSeconds')} min={15} max={900} onChange={(v) => setAdvancedPath('security.captchaConfig.timeLimitSeconds', v)} />
          <NumberSetting theme={theme} label="CAPTCHA attempts" value={readPath(advanced, 'security.captchaConfig.maxChallengeAttempts')} min={1} max={20} onChange={(v) => setAdvancedPath('security.captchaConfig.maxChallengeAttempts', v)} />
          <NumberSetting theme={theme} label="Mini-game rounds" value={readPath(advanced, 'security.minigameConfig.rounds')} min={1} max={10} onChange={(v) => setAdvancedPath('security.minigameConfig.rounds', v)} />
          <NumberSetting theme={theme} label="Mini-game timeout (seconds)" value={readPath(advanced, 'security.minigameConfig.timeLimitSeconds')} min={1} onChange={(v) => setAdvancedPath('security.minigameConfig.timeLimitSeconds', v)} />
          <NumberSetting theme={theme} label="One-time challenge timeout (seconds)" value={readPath(advanced, 'security.oneTimeChallengeConfig.timeLimitSeconds')} min={15} max={1800} onChange={(v) => setAdvancedPath('security.oneTimeChallengeConfig.timeLimitSeconds', v)} />
          <NumberSetting theme={theme} label="Staff approval timeout (minutes)" value={readPath(advanced, 'security.staffApprovalConfig.timeoutMinutes')} min={1} onChange={(v) => setAdvancedPath('security.staffApprovalConfig.timeoutMinutes', v)} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Toggle theme={theme} label="Random mini-games" checked={readPath(advanced, 'security.minigameConfig.random')} onChange={(v) => setAdvancedPath('security.minigameConfig.random', v)} />
          <Toggle theme={theme} label="Quarantine after failed attempts" checked={readPath(advanced, 'security.quarantineOnLimit')} onChange={(v) => setAdvancedPath('security.quarantineOnLimit', v)} />
          <Toggle theme={theme} label="Enable verification flow" checked={readPath(advanced, 'flow.enabled')} onChange={(v) => setAdvancedPath('flow.enabled', v)} />
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Staff Approval</h2>
        <p style={{ color: theme.mutedText, margin: 0 }}>Optional per server. Choose which staff role can approve members when this method is enabled.</p>
        <Toggle theme={theme} label="Require Staff Approval" checked={readPath(advanced, 'security.staffApproval')} onChange={(v) => toggleSecurity('staffApproval', v)} />
        <RoleSelect theme={theme} resources={usableRoles} value={advanced?.roles?.staff?.[0] || ''} label="Staff approval role"
          onChange={(value) => setAdvancedPath('roles.staff', value ? [value] : [])} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {['allowApprove', 'allowReject', 'allowQuarantine'].map((key) => <Toggle key={key} theme={theme} label={key.replace('allow', 'Allow ')}
            checked={readPath(advanced, `security.staffApprovalConfig.${key}`)}
            onChange={(value) => setAdvancedPath(`security.staffApprovalConfig.${key}`, value)} />)}
        </div>
      </section>

      <section style={{ ...card, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Quarantine, Raid Protection & Logs</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {[
            ['quarantine.enabled', 'Enable quarantine'], ['raid.enabled', 'Enable raid protection'],
            ['raid.automatic', 'Automatic raid response'], ['raid.elevateSecurity', 'Elevate security during raids'],
            ['logSuccess', 'Log successful verification'], ['logFailure', 'Log failed verification'],
          ].map(([key, label]) => <Toggle key={key} theme={theme} label={label}
            checked={readPath(advanced, key)} onChange={(value) => setAdvancedPath(key, value)} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 14 }}>
          <NumberSetting theme={theme} label="Quarantine threshold" value={readPath(advanced, 'quarantine.attemptThreshold')} min={1} onChange={(v) => setAdvancedPath('quarantine.attemptThreshold', v)} />
          <NumberSetting theme={theme} label="Raid join threshold" value={readPath(advanced, 'raid.joinThreshold')} min={1} onChange={(v) => setAdvancedPath('raid.joinThreshold', v)} />
          <NumberSetting theme={theme} label="Raid window (seconds)" value={readPath(advanced, 'raid.windowSeconds')} min={1} onChange={(v) => setAdvancedPath('raid.windowSeconds', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          {['join', 'intelligence', 'attempt', 'failure', 'success', 'roles', 'bot', 'raid', 'quarantine', 'staff', 'error'].map((name) =>
            <ChannelSelect key={name} theme={theme} resources={channels} label={`${name} log channel`}
              value={advanced?.logs?.[`${name}ChannelId`] || ''}
              onChange={(value) => setAdvancedPath(`logs.${name}ChannelId`, value || null)} />)}
        </div>
      </section>

      <section style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Save Advanced Verification Settings</h2>
          <p style={{ color: theme.mutedText, marginBottom: 0 }}>Changes are saved only for this server. Existing panels and analytics are preserved.</p>
        </div>
        <button type="button" disabled={Boolean(busy) || !advanced} style={buttonStyle(theme, 'success')} onClick={saveAdvanced}>{busy === 'config' ? 'Saving...' : 'Save Advanced Settings'}</button>
        {(error || notice) ? <div role={error ? 'alert' : 'status'} style={{ flexBasis: '100%', color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</div> : null}
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
