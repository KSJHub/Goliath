import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

function getGuildId(selectedGuild, selectedGuildData) {
  const id = selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '';
  return String(id).split(':').pop().trim();
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function roleName(roles, roleId) {
  return roles.find((role) => String(role.id) === String(roleId))?.name || roleId;
}

function buttonStyle(theme, tone = 'default') {
  const backgrounds = {
    primary: 'rgba(37,99,235,0.22)',
    success: 'rgba(22,163,74,0.22)',
    danger: 'rgba(220,38,38,0.22)',
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

function StatCard({ theme, label, value, hint }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.34)', borderRadius: 18, padding: 16 }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, color: theme.cardText }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function RoleList({ theme, title, roles, selectedRoles, onRemove, removingRole, type = 'join' }) {
  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 18, padding: 16, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      {selectedRoles.length === 0 ? (
        <EmptyState
          theme={theme}
          icon={type === 'bot' ? '🤖' : '👥'}
          title={type === 'bot' ? 'No bot roles configured' : 'No join roles configured'}
          description={type === 'bot' ? 'Add roles for bots that join the server.' : 'Add roles for new members who join the server.'}
        />
      ) : selectedRoles.map((roleId) => (
        <div key={roleId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: '10px 12px' }}>
          <span style={{ fontWeight: 900 }}>{roleName(roles, roleId)}</span>
          <button type="button" onClick={() => onRemove(roleId)} disabled={removingRole === roleId} style={buttonStyle(theme, 'danger')}>{removingRole === roleId ? 'Removing...' : 'Remove'}</button>
        </div>
      ))}
    </section>
  );
}

export default function AutoRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [roles, setRoles] = useState([]);
  const [joinRoleId, setJoinRoleId] = useState('');
  const [botRoleId, setBotRoleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [removingRole, setRemovingRole] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const settings = config?.settings || {};
  const joinRoles = config?.joinRoles || [];
  const botRoles = config?.botRoles || [];
  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;

  const cardStyle = useMemo(() => ({
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
  }), [theme]);

  async function loadRoles() {
    const rolePayload = await api.getGuildRoles(guildId);
    const cachedRoles = normalizeList(rolePayload, 'roles');
    if (cachedRoles.length > 0) return cachedRoles;
    const syncedResources = await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' });
    return normalizeList(syncedResources, 'roles');
  }

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [autoRoles, roleList] = await Promise.all([
        api.request(`/api/auto-roles/${guildId}/overview`),
        loadRoles(),
      ]);
      setConfig(autoRoles.config || {});
      setOverview(autoRoles.overview || {});
      setRoles(roleList);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Auto Roles dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [guildId]);

  async function runAction(name, fn, message) {
    setSaving(name);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config);
      if (result?.overview) setOverview(result.overview);
      if (message) setNotice(message);
      await load();
    } catch (actionError) {
      setError(actionError.message || 'Auto Roles action failed.');
    } finally {
      setSaving('');
    }
  }

  async function toggleEnabled() {
    const nextEnabled = !(overview.enabled === true || config?.enabled === true);
    await runAction('enabled', () => api.request(`/api/auto-roles/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: nextEnabled }) }), `Auto Roles ${nextEnabled ? 'enabled' : 'disabled'}.`);
  }

  async function saveSettings(patch) {
    const nextSettings = { ...settings, ...patch };
    setConfig((current) => ({ ...(current || {}), settings: nextSettings }));
    await runAction('settings', () => api.request(`/api/auto-roles/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: nextSettings }) }), 'Auto Roles settings saved.');
  }

  async function addRole(type) {
    const roleId = type === 'bot' ? botRoleId : joinRoleId;
    if (!roleId) return;
    const next = [...new Set([...(type === 'bot' ? botRoles : joinRoles), roleId])];
    await runAction(type, () => api.request(`/api/auto-roles/${guildId}/roles/${type === 'bot' ? 'bots' : 'join'}`, { method: 'PUT', body: JSON.stringify({ roleIds: next }) }), `${type === 'bot' ? 'Bot' : 'Join'} role added.`);
    if (type === 'bot') setBotRoleId('');
    else setJoinRoleId('');
  }

  async function removeRole(type, roleId) {
    setRemovingRole(roleId);
    const next = (type === 'bot' ? botRoles : joinRoles).filter((id) => id !== roleId);
    await runAction(`remove-${type}`, () => api.request(`/api/auto-roles/${guildId}/roles/${type === 'bot' ? 'bots' : 'join'}`, { method: 'PUT', body: JSON.stringify({ roleIds: next }) }), `${type === 'bot' ? 'Bot' : 'Join'} role removed.`);
    setRemovingRole('');
  }

  async function resetModule() {
    if (!window.confirm('Reset all Auto Roles settings and analytics?')) return;
    await runAction('reset', () => api.request(`/api/auto-roles/${guildId}/reset`, { method: 'POST' }), 'Auto Roles reset to defaults.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="👥" title="Select a server" description="Select a server to manage Auto Roles." />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(52,211,153,0.18), rgba(15,23,42,0.08) 46%, rgba(59,130,246,0.14))' }}>
        <p style={{ margin: '0 0 8px', color: '#86efac', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Automation</p>
        <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Auto Roles</h1>
        <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 840 }}>Assign join and bot roles automatically, validate hierarchy, repair invalid configuration and reapply roles across the server.</p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12 }}>
        <StatCard theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} hint={loading ? 'Loading...' : 'GuildManager'} />
        <StatCard theme={theme} label="Join Roles" value={overview.joinRoleCount ?? joinRoles.length} />
        <StatCard theme={theme} label="Bot Roles" value={overview.botRoleCount ?? botRoles.length} />
        <StatCard theme={theme} label="Assigned" value={analytics.assigned || 0} />
        <StatCard theme={theme} label="Failed" value={analytics.failed || 0} />
        <StatCard theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.warnings?.length || 0} warning(s)`} />
      </section>

      {(error || notice) ? <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Manage runtime behaviour and recovery.</p></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={toggleEnabled} disabled={saving === 'enabled'} style={buttonStyle(theme, 'primary')}>{saving === 'enabled' ? 'Saving...' : overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
            <button type="button" onClick={() => runAction('repair', () => api.request(`/api/auto-roles/${guildId}/repair`, { method: 'POST' }), 'Configuration repaired.')} disabled={saving} style={buttonStyle(theme, 'primary')}>Repair</button>
            <button type="button" onClick={() => runAction('reapply', () => api.request(`/api/auto-roles/${guildId}/reapply`, { method: 'POST' }), 'Roles reapplied across the server.')} disabled={saving} style={buttonStyle(theme, 'success')}>Reapply Now</button>
            <a href={`/api/auto-roles/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
            <button type="button" onClick={resetModule} disabled={saving} style={buttonStyle(theme, 'danger')}>Reset</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={settings.applyToBots === true} onChange={(event) => saveSettings({ applyToBots: event.target.checked })} /> Apply roles to bots</label>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={settings.reapplyOnStartup === true} onChange={(event) => saveSettings({ reapplyOnStartup: event.target.checked })} /> Reapply on startup</label>
          <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={settings.auditLog !== false} onChange={(event) => saveSettings({ auditLog: event.target.checked })} /> Audit logging</label>
        </div>
      </section>

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Join Roles</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'end' }}>
          <RoleSelect theme={theme} resources={roles} value={joinRoleId} onChange={setJoinRoleId} label="Add Join Role" disabled={roles.length === 0} />
          <button type="button" onClick={() => addRole('join')} disabled={saving === 'join' || !joinRoleId} style={buttonStyle(theme, 'success')}>{saving === 'join' ? 'Adding...' : 'Add'}</button>
        </div>
        <RoleList theme={theme} title="Current Join Roles" roles={roles} selectedRoles={joinRoles} removingRole={removingRole} onRemove={(roleId) => removeRole('join', roleId)} type="join" />
      </section>

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0 }}>Bot Roles</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'end' }}>
          <RoleSelect theme={theme} resources={roles} value={botRoleId} onChange={setBotRoleId} label="Add Bot Role" disabled={roles.length === 0} />
          <button type="button" onClick={() => addRole('bot')} disabled={saving === 'bot' || !botRoleId} style={buttonStyle(theme, 'success')}>{saving === 'bot' ? 'Adding...' : 'Add'}</button>
        </div>
        <RoleList theme={theme} title="Current Bot Roles" roles={roles} selectedRoles={botRoles} removingRole={removingRole} onRemove={(roleId) => removeRole('bot', roleId)} type="bot" />
      </section>

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Health & Diagnostics</h2>
        {health?.warnings?.length
          ? health.warnings.map((warning) => <div key={warning} style={{ color: '#fbbf24', fontWeight: 850 }}>⚠ {warning}</div>)
          : <div style={{ color: '#86efac', fontWeight: 900 }}>✅ Auto Roles configuration is healthy.</div>}
        {(health?.roles || []).map((role) => <div key={role.roleId} style={{ color: role.exists && role.manageable ? '#86efac' : '#fca5a5' }}>{role.exists && role.manageable ? '✅' : '❌'} {role.name || role.roleId}</div>)}
        <button type="button" onClick={load} disabled={loading} style={{ ...buttonStyle(theme), justifySelf: 'start' }}>{loading ? 'Refreshing...' : 'Refresh Health'}</button>
      </section>
    </div>
  );
}
