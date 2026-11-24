import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import { goliathDialog } from '../../shared/GoliathDialogHost.jsx';
import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

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

const emptyDraft = { name: '', roleId: '', value: 1, unit: 'years', startMode: 'original', customStartAt: '', removeRoleIds: [], enabled: true };

export default function TimedRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [saving, setSaving] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [records, setRecords] = useState(null);
  const [record, setRecord] = useState(null);
  const [recordId, setRecordId] = useState('');
  const [recordError, setRecordError] = useState('');
  const [recordBusy, setRecordBusy] = useState(false);

  const rules = Object.values(config?.rules || {}).sort((a, b) => Number(a.value || 0) - Number(b.value || 0));
  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const settings = config?.settings || {};
  const cleanupRoles = roles.filter((role) => String(role.id) !== String(draft.roleId));
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

  async function loadChannels() {
    const payload = await api.getGuildChannels(guildId);
    const current = normalizeList(payload, 'channels');
    if (current.length) return current;
    const synced = await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' });
    return normalizeList(synced, 'channels');
  }

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [timedRolePayload, roleList, channelList] = await Promise.all([
        api.request(`/api/timed-roles/${guildId}/overview`),
        loadRoles(),
        loadChannels(),
      ]);
      setConfig(timedRolePayload.config || {});
      setOverview(timedRolePayload.overview || {});
      setRoles(roleList);
      setChannels(channelList);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Timed Roles dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setRecords(null); setRecord(null); setRecordId(''); setRecordError(''); load(); }, [guildId]);

  async function loadRecords(page = 0, id = '') {
    setRecordBusy(true); setRecordError(''); setRecord(null);
    try {
      const result = await api.request('/api/timed-roles/' + guildId + '/records' + (id ? '/' + encodeURIComponent(id) : '?page=' + page));
      if (id) setRecord(result); else setRecords(result);
    } catch (error) { setRecords(null); setRecordError(error.message || 'Record access unavailable.'); }
    finally { setRecordBusy(false); }
  }

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

  async function saveSettings(patch, message = 'Settings saved.') {
    return runAction('settings', () => api.request(`/api/timed-roles/${guildId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ settings: patch }),
    }), message);
  }

  async function saveRule() {
    if (!draft.roleId || !draft.name.trim() || !Number.isInteger(draft.value) || draft.value < 1 || draft.value > 1000000 || !draft.unit || (draft.startMode === 'custom' && !draft.customStartAt)) { setError('Enter a milestone name, reward role, valid duration and starting date.'); return; }
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
      startMode: rule.startMode || 'original',
      customStartAt: rule.customStartAt?.slice(0,10) || '',
      removeRoleIds: rule.removeRoleIds || [],
      enabled: rule.enabled !== false,
    });
  }

  async function deleteRule(ruleId) {
    if (!await goliathDialog.confirm('Delete this timed role milestone?', { title: 'Delete Timed Role Milestone?', danger: true, confirmLabel: 'Delete Milestone' })) return;
    await runAction(`delete-${ruleId}`, () => api.request(`/api/timed-roles/${guildId}/rules/${ruleId}`, { method: 'DELETE' }), 'Milestone deleted.');
  }

  if (!guildId) return <EmptyState theme={theme} icon={E.TIMER} title="Select a server" description="Select a server to manage Timed Roles." />;

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
        <StatCard theme={theme} label="Announced" value={analytics.announced || 0} />
        <StatCard theme={theme} label="Members Checked" value={analytics.membersChecked || 0} />
        <StatCard theme={theme} label="Failed" value={analytics.failed || 0} />
        <StatCard theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} hint={`${health?.issues?.length || 0} issue(s) · ${health?.warnings?.length || 0} warning(s)`} />
      </section>

      {(error || notice) ? <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h2 style={{ margin: 0 }}>Module Controls</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Runtime, progression, announcements, recovery and scan behaviour.</p></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => runAction('enabled', () => api.request(`/api/timed-roles/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !(overview.enabled || config?.enabled) }) }), 'Module status updated.')} disabled={saving} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button>
            <button type="button" onClick={() => runAction('scan', () => api.request(`/api/timed-roles/${guildId}/scan`, { method: 'POST' }), 'Server scan completed.')} disabled={saving} style={buttonStyle(theme, 'success')}>Scan Now</button>
            <button type="button" onClick={() => runAction('repair', () => api.request(`/api/timed-roles/${guildId}/repair`, { method: 'POST' }), 'Configuration repaired.')} disabled={saving} style={buttonStyle(theme, 'primary')}>Repair</button>
            <a href={`/api/timed-roles/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Scan interval (minutes)
            <input type="number" min="5" max="1440" value={settings.scanIntervalMinutes || 60} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), scanIntervalMinutes: Number(event.target.value) } }))} onBlur={(event) => saveSettings({ scanIntervalMinutes: Number(event.target.value) })} style={fieldStyle(theme)} />
          </label>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Progression mode
            <ThemedSelect theme={theme} value={settings.progressionMode || 'highest_only'} onChange={(event) => saveSettings({ progressionMode: event.target.value })} style={fieldStyle(theme)}>
              <option value="highest_only">Keep highest milestone only</option>
              <option value="keep_all">Keep all earned milestones</option>
            </ThemedSelect>
          </label>
          <label style={{ color: theme.mutedText, fontWeight: 850, alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked={settings.includeBots === true} onChange={(event) => saveSettings({ includeBots: event.target.checked })} /> Include bots</label>
          <label style={{ color: theme.mutedText, fontWeight: 850, alignSelf: 'end', paddingBottom: 12 }}><input type="checkbox" checked={settings.announcePromotions === true} onChange={(event) => saveSettings({ announcePromotions: event.target.checked })} /> Announce promotions</label>
        </div>
        {settings.announcePromotions ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(280px, 1.6fr)', gap: 14, alignItems: 'end' }}>
            <ChannelSelect theme={theme} resources={channels} value={settings.announcementChannelId || ''} onChange={(announcementChannelId) => saveSettings({ announcementChannelId: announcementChannelId || null })} label="Announcement Channel" disabled={channels.length === 0} />
            <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Promotion message
              <textarea rows={3} value={settings.announcementMessage || ''} onChange={(event) => setConfig((current) => ({ ...current, settings: { ...(current?.settings || {}), announcementMessage: event.target.value } }))} onBlur={(event) => saveSettings({ announcementMessage: event.target.value })} style={{ ...fieldStyle(theme), resize: 'vertical' }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Placeholders: {'{member}'} · {'{role}'} · {'{duration}'} · {'{server}'}</span>
            </label>
          </div>
        ) : null}
      </section>

      <section style={{ ...cardStyle, padding:22, display:'grid', gap:12 }}>
        <h2 style={{margin:0}}>Celebration Settings</h2>
        <label><input type="checkbox" disabled={!!saving} checked={settings.celebrationEmbed !== false} onChange={e=>saveSettings({celebrationEmbed:e.target.checked})}/> Use achievement embed</label>
        <label><input type="checkbox" disabled={!!saving} checked={settings.celebrateRetroactive === true} onChange={e=>saveSettings({celebrateRetroactive:e.target.checked})}/> Celebrate historical awards (may send many messages)</label>
        <label>Title<input key={'title-'+guildId} defaultValue={settings.celebrationTitle || ''} onBlur={e=>{if(e.target.value !== (settings.celebrationTitle || '')) saveSettings({celebrationTitle:e.target.value});}} maxLength={256} style={fieldStyle(theme)} /></label>
        <label>GIF or image HTTPS URL<input key={'gif-'+guildId} type="url" defaultValue={settings.celebrationGif || ''} onBlur={e=>{const value=e.target.value.trim();if(value && !/^https:\/\//i.test(value)){setError('Use an HTTPS image URL.');return;}if(value !== (settings.celebrationGif || '')) saveSettings({celebrationGif:value});}} style={fieldStyle(theme)} /></label>
        <p style={{color:theme.mutedText}}>Variables: {'{member}'} · {'{milestone}'} · {'{role}'} · {'{duration}'} · {'{server}'} · {'{joined}'} · {'{achieved}'} · {'{nextMilestone}'} · {'{nextDue}'}</p>
      </section>
      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 16 }}>
        <div><h2 style={{ margin: 0 }}>{editingRuleId ? 'Edit Milestone' : 'Create Milestone'}</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Use a real server role, a calendar-aware duration and optional cleanup roles.</p></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} style={fieldStyle(theme)} /></label>
          <RoleSelect theme={theme} resources={roles.filter(role=>String(role.id)!==guildId && !role.managed && !rules.some(rule=>rule.ruleId!==editingRuleId && String(rule.roleId)===String(role.id)))} value={draft.roleId} onChange={(roleId) => setDraft((current) => ({ ...current, roleId, removeRoleIds: current.removeRoleIds.filter((id) => id !== roleId) }))} label="Award Role" disabled={roles.length === 0} />
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Duration<input type="number" min="1" value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: Number(event.target.value) }))} style={fieldStyle(theme)} /></label>
          <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Unit<ThemedSelect theme={theme} value={draft.unit} onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} style={fieldStyle(theme)}>{['minutes', 'hours', 'days', 'weeks', 'months', 'years'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</ThemedSelect></label>
        </div>
        <label>Starting point <ThemedSelect theme={theme} value={draft.startMode} onChange={event=>setDraft(current=>({...current,startMode:event.target.value}))} style={fieldStyle(theme)}><option value="original">Original known guild join</option><option value="continuous">Latest guild join</option><option value="custom">Custom date</option></ThemedSelect></label>
        {draft.startMode === 'custom' && <label>Custom start date<input type="date" value={draft.customStartAt} onChange={event=>setDraft(current=>({...current,customStartAt:event.target.value}))} style={fieldStyle(theme)} /></label>}
        <label style={{ display: 'grid', gap: 8, color: theme.mutedText, fontWeight: 850 }}>Cleanup roles (optional)
          <ThemedSelect theme={theme} multiple size={Math.min(6, Math.max(3, cleanupRoles.length))} value={draft.removeRoleIds} onChange={(event) => setDraft((current) => ({ ...current, removeRoleIds: Array.from(event.target.selectedOptions, (option) => option.value) }))} style={fieldStyle(theme)}>
            {cleanupRoles.map((role) => <option key={role.id} value={role.id}>{role.name || role.id}</option>)}
          </ThemedSelect>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Hold Ctrl/Cmd to select multiple roles. The award role cannot remove itself.</span>
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveRule} disabled={saving === 'rule' || !draft.roleId} style={buttonStyle(theme, 'success')}>{saving === 'rule' ? 'Saving...' : editingRuleId ? 'Save Changes' : 'Create Milestone'}</button>
          {editingRuleId ? <button type="button" onClick={() => { setEditingRuleId(''); setDraft(emptyDraft); }} style={buttonStyle(theme)}>Cancel</button> : null}
        </div>
      </section>

      <section style={{ ...cardStyle, padding:22, display:'grid', gap:12 }}>
        <h2>Membership Records</h2>
        <p>Restricted historical guild membership and achievements.</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button disabled={recordBusy} style={buttonStyle(theme)} onClick={()=>loadRecords()}>Browse records</button>
          <input aria-label="Discord user ID" placeholder="Discord user ID" value={recordId} onChange={event=>setRecordId(event.target.value)} style={{...fieldStyle(theme),width:'auto'}} />
          <button disabled={recordBusy || !/^\d{15,25}$/.test(recordId.trim())} style={buttonStyle(theme)} onClick={()=>loadRecords(0,recordId.trim())}>Find member</button>
        </div>
        {recordError && <p role="alert">{recordError}</p>}
        {records && <div><p>{records.total} records · Page {records.page+1}</p>{records.records.map(item=><div key={item.id} style={{padding:8}}><button style={buttonStyle(theme)} disabled={recordBusy} onClick={()=>loadRecords(0,item.id)}>{item.id}</button> {item.active===true?'Active':item.active===false?'Departed':'Unknown'} · {item.firstJoinedAt || 'Unknown join'}</div>)}<button style={buttonStyle(theme)} disabled={recordBusy || records.page===0} onClick={()=>loadRecords(records.page-1)}>Previous</button> <button style={buttonStyle(theme)} disabled={recordBusy || (records.page+1)*25>=records.total} onClick={()=>loadRecords(records.page+1)}>Next</button></div>}
        {record && <div><h3>Member details</h3><p>Original join: {record.record.firstJoinedAt || 'Unknown'}</p><p>Latest join: {record.record.lastJoinedAt || 'Unknown'}</p><p>Last departure: {record.record.lastLeftAt || 'Unknown'}</p><h3>Achievements</h3>{Object.entries(record.achievements || {}).map(([id,item])=><p key={id}>{item.milestoneName || config?.rules?.[id]?.name || id} · {item.achievedAt} · {item.celebration}</p>)}<h3>Individual schedules</h3>{Object.entries(record.overrides || {}).map(([id,item])=><p key={id}>{config?.rules?.[id]?.name || id} · {item.startAt || 'Default start'} · {item.dueAt || 'Calculated due date'}</p>)}</div>}
      </section>
      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>Milestones</h2>
        {rules.length === 0 ? <EmptyState theme={theme} icon={E.TIMER} title="No milestones configured" description="Create your first custom membership milestone." /> : rules.map((rule) => (
          <div key={rule.ruleId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 950 }}>{rule.enabled ? E.SUCCESS : E.PAUSE} {rule.name}</div>
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