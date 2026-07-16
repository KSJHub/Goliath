import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

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

function fieldStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.45)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '11px 12px',
    width: '100%',
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

const emptyDraft = { name: 'Veteran', roleId: '', value: 1, unit: 'years', removeRoleIds: [], enabled: true };

export default function TimedRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [roles, setRoles] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [saving, setSaving] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const rules = Object.values(config?.rules || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const settings = config?.settings || {};
  const cardStyle = useMemo(() => ({
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
  }), [theme]);

  function roleName(roleId) {
    return roles.find((role) => String(role.id) === String(roleId))?.name || roleId;
  }

  async function loadRoles() {
    const payload = await api.getGuildRoles(guildId);
    const current = normalizeList(payload, 'roles');
    if (current.length) return current;
    const synced = await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' });
    return normalizeList(synced, 'roles');
  }

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [timedRolePayload, roleList] = await Promise.all([
        api.request(`/api/timed-roles/${guildId}/overview`),
        loadRoles(),
      ]);
      setConfig(timedRolePayload.config || {});
      setOverview(timedRolePayload.overview || {});
      setRoles(roleList);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Timed Roles dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

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
      return result;
    } catch (actionError) {
      setError(actionError.message || 'Timed Roles action failed.');
      return null;
    } finally {
      setSaving('');
    }
  }

  async function saveRule() {
    if (!draft.roleId || !draft.name || !draft.value || !draft.unit) return;
    const path = editingRuleId
      ? `/api/timed-roles/${guildId}/rules/${editingRuleId}`
      : `/api/timed-roles/${guildId}/rules`;
    const method = editingRuleId ? 'PUT' : 'POST';
    const result = await runAction('rule', () => api.request(path, { method, body: JSON.stringify(draft) }), editingRuleId ? 'Milestone updated.' : 'Milestone created.');
    if (result) {
      setDraft(emptyDraft);
      setEditingRuleId('');
    }
  }

  function editRule(rule) {
    setEditingRuleId(rule.ruleId);
    setDraft({
      name: rule.name,
      roleId: rule.roleId,
      value: rule.value,
      unit: rule.unit,
      removeRoleIds: rule.removeRoleIds || [],
      enabled: rule.enabled !== false,
    });
  }

  async function deleteRule(ruleId) {
    if (!window.confirm('Delete this timed role milestone?')) return;
    await runAction(`delete-${ruleId}`, () => api.request(`/api/timed-roles/${guildId}/rules/${ruleId}`, { method: 'DELETE' }), 'Milestone deleted.');
  }

  if (!guildId) return <EmptyState theme={theme} icon="⏳" title="Select a server" description="Select a server to manage Timed Roles." />;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(168,85,247,0.18), rgba(15,23,42,0.08) 46%, rgba(59,130,246,0.14))' }}>
        <p style={{ margin: '0 0 8px', color: '#d8b4fe', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Automation</p>
        <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Timed Roles</h1>
        <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 840 }}>Award milestone roles from real Discord server join dates, backfill existing members, remove previous progression roles and monitor assignment health.</p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }}>
        <StatCard theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} hint={loading ? 'Loading...' : `${rules.length} milestone(s)`} />
        <StatCard theme={theme} label="Awarded" value={analytics.awarded || 0} />
        <StatCard theme={theme} label="Removed" value={analytics.removed || 0} />
        <StatCard theme={theme} label="Members Checked" value={analytics.membersChecked || 0} />
        <StatCard theme={theme} label="Failed" value={analytics.failed || 0} />
        <StatCard theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.issues?.length || 0} issue(s)`} />
      </section>

      {(error || notice) ? <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Runtime, recovery and scan behaviour.</p></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => runAction('enabled', () => api.request(`/api/timed-roles/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !(overview.enabled || config?.enabled) }) }), 'Module status updated.')} disabled={saving} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
            <button type="button" onClick={() => runAction('scan', () => api.request(`/api/timed-roles/${guildId}/scan`, { method: 'POST' }), 'Server scan completed.')} disabled={saving} style={buttonStyle(theme, 'success')}>Scan Now</button>
            <button type="button" onClick={() => runAction('repair', () => api.request(`/api/timed-roles/${guildId}/repair`, { method: 'POST' }), 'Configuration repaired.')} disabled={saving} style={buttonStyle(theme, 'primary')}>Repair</button>
            <a href={`/api/timed-roles/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Scan interval (minutes)
            <input type="number" min="5" max="1440" value={settings.scanIntervalMinutes || 60} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), scanIntervalMinutes: Number(event.target.value) } }))} onBlur={() => runAction('settings', () => api.request(`/api/timed-roles/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: config.settings }) }), 'Settings saved.')} style={fieldStyle(theme)} />
          </label>
          <label style={{ color: theme.mutedText, fontWeight: 850, alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked={settings.includeBots === true} onChange={(event) => runAction('settings', () => api.request(`/api/timed-roles/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: { ...settings, includeBots: event.target.checked } }) }), 'Settings saved.')} /> Include bots</label>
        </div>
      </section>

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <div><h2 style={{ margin: 0 }}>{editingRuleId ? 'Edit Milestone' : 'Create Milestone'}</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Use a real server role and a calendar-aware duration.</p></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} style={fieldStyle(theme)} /></label>
          <RoleSelect theme={theme} resources={roles} value={draft.roleId} onChange={(roleId) => setDraft((current) => ({ ...current, roleId }))} label="Award Role" disabled={roles.length === 0} />
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Duration<input type="number" min="1" value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: Number(event.target.value) }))} style={fieldStyle(theme)} /></label>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Unit<select value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} style={fieldStyle(theme)}>{['minutes', 'hours', 'days', 'weeks', 'months', 'years'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveRule} disabled={saving === 'rule' || !draft.roleId} style={buttonStyle(theme, 'success')}>{saving === 'rule' ? 'Saving...' : editingRuleId ? 'Save Changes' : 'Create Milestone'}</button>
          {editingRuleId ? <button type="button" onClick={() => { setEditingRuleId(''); setDraft(emptyDraft); }} style={buttonStyle(theme)}>Cancel</button> : null}
        </div>
      </section>

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>Milestones</h2>
        {rules.length === 0 ? <EmptyState theme={theme} icon="⏳" title="No milestones configured" description="Create a milestone such as Veteran after one year." /> : rules.map((rule) => (
          <div key={rule.ruleId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 950 }}>{rule.enabled ? '✅' : '⏸️'} {rule.name}</div>
              <div style={{ marginTop: 4, color: theme.mutedText }}>{roleName(rule.roleId)} after {rule.value} {rule.unit}{rule.removeRoleIds?.length ? ` · removes ${rule.removeRoleIds.map(roleName).join(', ')}` : ''}</div>
              {rule.lastError ? <div style={{ marginTop: 4, color: '#fca5a5' }}>{rule.lastError}</div> : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => editRule(rule)} style={buttonStyle(theme, 'primary')}>Edit</button>
              <button type="button" onClick={() => runAction(`toggle-${rule.ruleId}`, () => api.request(`/api/timed-roles/${guildId}/rules/${rule.ruleId}`, { method: 'PUT', body: JSON.stringify({ ...rule, enabled: !rule.enabled }) }), 'Milestone status updated.')} style={buttonStyle(theme)}>{rule.enabled ? 'Disable' : 'Enable'}</button>
              <button type="button" onClick={() => deleteRule(rule.ruleId)} style={buttonStyle(theme, 'danger')}>Delete</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
