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

const emptyDraft = { name: '', roleId: '', value: 1, unit: 'years', startMode: 'original', customStartAt: '', removeRoleIds: [], enabled: true, celebration: {} };

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
  const [schedule,setSchedule]=useState({ruleId:'',startAt:'',dueAt:''});
  async function saveSchedule() {
    const requestedGuild=guildId, memberId=record?.memberId;
    if(!memberId || !schedule.ruleId)return;
    setRecordBusy(true);setRecordError('');
    try {const result=await api.request('/api/timed-roles/'+requestedGuild+'/records/'+memberId+'/overrides/'+encodeURIComponent(schedule.ruleId),{method:'PUT',body:JSON.stringify({startAt:schedule.startAt,dueAt:schedule.dueAt})});if(activeGuild.current===requestedGuild)setRecord(current=>current?.memberId===memberId?{...current,overrides:result.overrides}:current);}
    catch(error){if(activeGuild.current===requestedGuild)setRecordError(error.message || 'Schedule update failed.');}
    finally{if(activeGuild.current===requestedGuild)setRecordBusy(false);}
  }
  const [audit,setAudit]=useState(null);
  const [auditError,setAuditError]=useState('');
  const [auditBusy,setAuditBusy]=useState(false);
  const activeGuild=React.useRef(guildId);
  activeGuild.current=guildId;
  async function loadAudit(page=0) {
    const requestedGuild=guildId;
    setAuditBusy(true);setAuditError('');setAudit(null);
    try {const result=await api.request('/api/timed-roles/'+requestedGuild+'/audit?page='+page);if(activeGuild.current===requestedGuild)setAudit(result);}
    catch(error){if(activeGuild.current===requestedGuild)setAuditError(error.message || 'Audit access unavailable.');}
    finally{if(activeGuild.current===requestedGuild)setAuditBusy(false);}
  }

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

  useEffect(() => { setAudit(null);setAuditError('');setAuditBusy(false);setRecords(null); setRecord(null); setRecordId(''); setRecordError(''); load(); }, [guildId]);

  async function loadRecords(page = 0, id = '') {
    setRecordBusy(true); setRecordError(''); setRecord(null);
    try {
      const result = await api.request('/api/timed-roles/' + guildId + '/records' + (id ? '/' + encodeURIComponent(id) : '?page=' + page));
      if(activeGuild.current!==guildId)return;
      if (id) {setRecord({...result,memberId:id});setSchedule({ruleId:'',startAt:'',dueAt:''});} else setRecords(result);
    } catch (error) { if(activeGuild.current===guildId){setRecords(null); setRecordError(error.message || 'Record access unavailable.');} }
    finally { if(activeGuild.current===guildId)setRecordBusy(false); }
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
    if (draft.celebration?.celebrationGif && !/^https:\/\//i.test(draft.celebration.celebrationGif)) { setError('Use an HTTPS celebration image URL.'); return; }
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
      celebration: {...(rule.celebration || {})},
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
        <details>
          <summary>Individual celebration overrides</summary>
          <p style={{color:theme.mutedText}}>Leave fields inherited to use the server celebration settings.</p>
          <label>Celebration mode<ThemedSelect theme={theme} value={draft.celebration?.announcePromotions === undefined ? 'inherit' : String(draft.celebration.announcePromotions)} onChange={e=>setDraft(current=>{const celebration={...current.celebration};if(e.target.value==='inherit')delete celebration.announcePromotions;else celebration.announcePromotions=e.target.value==='true';return {...current,celebration};})} style={fieldStyle(theme)}><option value="inherit">Inherit</option><option value="true">Enabled</option><option value="false">Disabled</option></ThemedSelect></label>
          <label>Format<ThemedSelect theme={theme} value={draft.celebration?.celebrationEmbed === undefined ? 'inherit' : String(draft.celebration.celebrationEmbed)} onChange={e=>setDraft(current=>{const celebration={...current.celebration};if(e.target.value==='inherit')delete celebration.celebrationEmbed;else celebration.celebrationEmbed=e.target.value==='true';return {...current,celebration};})} style={fieldStyle(theme)}><option value="inherit">Inherit</option><option value="true">Embed</option><option value="false">Message</option></ThemedSelect></label>
          <ChannelSelect theme={theme} resources={channels} value={draft.celebration?.announcementChannelId || ''} onChange={value=>setDraft(current=>{const celebration={...current.celebration};if(value)celebration.announcementChannelId=value;else delete celebration.announcementChannelId;return {...current,celebration};})} label="Override announcement channel (empty inherits)" />
          {['celebrationTitle','announcementMessage','celebrationGif'].map(key=><label key={key} style={{display:'grid',gap:6}}>{({celebrationTitle:'Title',announcementMessage:'Message',celebrationGif:'HTTPS GIF or image URL'})[key]}<input value={draft.celebration?.[key] || ''} placeholder={settings[key] || 'Inherit default'} onChange={e=>setDraft(current=>{const celebration={...current.celebration};if(e.target.value)celebration[key]=e.target.value;else delete celebration[key];return {...current,celebration};})} style={fieldStyle(theme)} /></label>)}
          <button type="button" style={buttonStyle(theme)} onClick={()=>setDraft(current=>({...current,celebration:{}}))}>Restore inherited settings</button>
        </details>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveRule} disabled={saving === 'rule' || !draft.roleId} style={buttonStyle(theme, 'success')}>{saving === 'rule' ? 'Saving...' : editingRuleId ? 'Save Changes' : 'Create Milestone'}</button>
          {!editingRuleId && <button type="button" disabled={!!saving || !draft.name.trim() || !Number.isInteger(draft.value) || draft.value<1 || draft.value>1000000 || (draft.startMode==='custom' && !draft.customStartAt)} style={buttonStyle(theme,'primary')} onClick={async()=>{if(draft.celebration?.celebrationGif && !/^https:\/\//i.test(draft.celebration.celebrationGif)){setError('Use an HTTPS image URL.');return;}if(!await goliathDialog.confirm('Create a new Discord reward role named '+draft.name+' with no additional permissions?',{title:'Create milestone and reward role',confirmLabel:'Create both'}))return;const result=await runAction('rule',()=>api.request('/api/timed-roles/'+guildId+'/rules/create-with-role',{method:'POST',body:JSON.stringify(draft)}),'Milestone and reward role created.');if(result)setDraft(emptyDraft);}}>Create Milestone and New Role</button>}
          {editingRuleId ? <button type="button" onClick={() => { setEditingRuleId(''); setDraft(emptyDraft); }} style={buttonStyle(theme)}>Cancel</button> : null}
        </div>
      </section>

      <section style={{...cardStyle,padding:22,display:'grid',gap:12}}>
        <h2 style={{margin:0}}>Logging</h2>
        <p>Permanent audit records are retained independently of Discord notifications. Choose a restricted channel for member information.</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['channel','thread'].map(mode=><button key={mode} type="button" disabled={!!saving} style={buttonStyle(theme,settings.logging?.mode===mode?'success':'default')} onClick={()=>saveSettings({logging:{...settings.logging,mode:settings.logging?.mode===mode?'off':mode}})}>{mode==='channel'?'Channel Logs':'Thread Logs'}: {settings.logging?.mode===mode?'ON':'OFF'}</button>)}
        </div>
        <ChannelSelect theme={theme} resources={channels} value={settings.logging?.channelId || ''} onChange={channelId=>saveSettings({logging:{...settings.logging,channelId:channelId || null}})} label="Log destination" disabled={!!saving}/>
        <label>Events<ThemedSelect theme={theme} multiple size={6} disabled={!!saving} value={settings.logging?.events || []} onChange={e=>saveSettings({logging:{...settings.logging,events:Array.from(e.target.selectedOptions,o=>o.value)}})} style={fieldStyle(theme)}>{['milestone_created','milestone_updated','milestone_deleted','settings_updated','member_dates_updated','member_roles_changed','celebration_sent','celebration_failed','member_progression_failed'].map(event=><option key={event} value={event}>{event.replace(/_/g,' ')}</option>)}</ThemedSelect></label>
        <label>Notification roles (maximum 10)<ThemedSelect theme={theme} multiple size={5} disabled={!!saving} value={settings.logging?.roleIds || []} onChange={e=>{const roleIds=Array.from(e.target.selectedOptions,o=>o.value);if(roleIds.length>10){setError('Choose at most ten roles.');return;}saveSettings({logging:{...settings.logging,roleIds}});}} style={fieldStyle(theme)}>{roles.filter(role=>String(role.id)!==guildId).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</ThemedSelect></label>
      </section>
      <section style={{...cardStyle,padding:22,display:'grid',gap:12}}>
        <h2 style={{margin:0}}>Membership Record Access</h2>
        <p>Only the guild owner can change these settings. The owner always retains access.</p>
        <label><input type="checkbox" disabled={!!saving} checked={settings.recordsAccess?.allowAdministrators!==false} onChange={e=>saveSettings({recordsAccess:{...settings.recordsAccess,allowAdministrators:e.target.checked}})}/> Allow administrators</label>
        <label>Additional authorised roles (maximum 10)<ThemedSelect theme={theme} multiple size={5} disabled={!!saving} value={settings.recordsAccess?.roleIds || []} onChange={e=>{const roleIds=Array.from(e.target.selectedOptions,o=>o.value);if(roleIds.length>10){setError('Choose at most ten roles.');return;}saveSettings({recordsAccess:{...settings.recordsAccess,roleIds}});}} style={fieldStyle(theme)}>{roles.filter(role=>String(role.id)!==guildId).map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</ThemedSelect></label>
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
        {record && <div><h3>Member details</h3><p>Original join: {record.record.firstJoinedAt || 'Unknown'}</p><p>Latest join: {record.record.lastJoinedAt || 'Unknown'}</p><p>Last departure: {record.record.lastLeftAt || 'Unknown'}</p><h3>Achievements</h3>{Object.entries(record.achievements || {}).map(([id,item])=><p key={id}>{item.milestoneName || config?.rules?.[id]?.name || id} · {item.achievedAt} · {item.celebration}</p>)}<h3>Individual schedules</h3><div style={{display:'grid',gap:8}}><label>Milestone<ThemedSelect theme={theme} value={schedule.ruleId} onChange={e=>{const ruleId=e.target.value,item=record.overrides?.[ruleId];setSchedule({ruleId,startAt:item?.startAt?.slice(0,10)||'',dueAt:item?.dueAt?.slice(0,10)||''});}} style={fieldStyle(theme)}><option value="">Select milestone</option>{rules.map(rule=><option key={rule.ruleId} value={rule.ruleId}>{rule.name}</option>)}</ThemedSelect></label><label>Custom starting date<input type="date" value={schedule.startAt} onChange={e=>setSchedule(current=>({...current,startAt:e.target.value}))} style={fieldStyle(theme)}/></label><label>Custom due date<input type="date" value={schedule.dueAt} onChange={e=>setSchedule(current=>({...current,dueAt:e.target.value}))} style={fieldStyle(theme)}/></label><p>Blank dates restore the default milestone schedule. Administrator access required to save.</p><button type="button" disabled={recordBusy || !schedule.ruleId} onClick={saveSchedule} style={buttonStyle(theme,'primary')}>Save individual schedule</button></div>{Object.entries(record.overrides || {}).map(([id,item])=><p key={id}>{config?.rules?.[id]?.name || id} · {item.startAt || 'Default start'} · {item.dueAt || 'Calculated due date'}</p>)}</div>}
      </section>
      <section style={{...cardStyle,padding:22,display:'grid',gap:12}}>
        <h2 style={{margin:0}}>Audit History</h2>
        <p>Restricted permanent operational records, newest first.</p>
        <div><button type="button" disabled={auditBusy} style={buttonStyle(theme)} onClick={()=>loadAudit()}>Load audit history</button></div>
        {auditError && <p role="alert">{auditError}</p>}
        {audit && <div><p>{audit.total} events · Page {audit.page+1}</p>{audit.events.map((event,index)=><details key={event.id || index} style={{padding:10,borderBottom:'1px solid '+theme.cardBorder}}><summary>{String(event.type || 'Event').replace(/_/g,' ')} · {event.at || 'Unknown time'}</summary><p>Actor: {event.actorId || 'System / unknown'}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(event.details || {},null,2)}</pre></details>)}<button disabled={auditBusy || audit.page===0} style={buttonStyle(theme)} onClick={()=>loadAudit(audit.page-1)}>Previous</button> <button disabled={auditBusy || (audit.page+1)*25>=audit.total} style={buttonStyle(theme)} onClick={()=>loadAudit(audit.page+1)}>Next</button></div>}
      </section>
      <section style={{ ...cardStyle, padding: 22, display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>Milestones</h2>
        {rules.length === 0 ? <EmptyState theme={theme} icon={E.TIMER} title="No milestones configured" description="Create your first custom membership milestone." /> : rules.map((rule) => (
          <div key={rule.ruleId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 950 }}>{rule.enabled ? E.SUCCESS : E.PAUSE} {rule.name}</div>
              <div style={{ marginTop: 4, color: theme.mutedText }}>{roleName(rule.roleId)} after {rule.value} {rule.unit}{rule.removeRoleIds?.length ? ` · removes ${rule.removeRoleIds.map(roleName).join(', ')}` : ''}</div>
              {!loading && roles.length>0 && !roles.some(role=>String(role.id)===String(rule.roleId)) && <div style={{display:'grid',gap:8,marginTop:10}}><strong style={{color:'#fca5a5'}}>Reward role missing</strong><RoleSelect theme={theme} resources={roles.filter(role=>String(role.id)!==guildId && !role.managed && !rules.some(other=>String(other.roleId)===String(role.id)))} value="" label="Link existing replacement role" disabled={!!saving} onChange={async roleId=>{if(!roleId || !await goliathDialog.confirm('Link this replacement role to the milestone?',{title:'Recover reward role',confirmLabel:'Link role'}))return;await runAction('recover-role',()=>api.request('/api/timed-roles/'+guildId+'/rules/'+rule.ruleId+'/recover-role',{method:'POST',body:JSON.stringify({roleId})}),'Reward role linked.');}}/><button type="button" disabled={!!saving} style={buttonStyle(theme,'primary')} onClick={async()=>{if(!await goliathDialog.confirm('Create a new Discord role named '+rule.name+' with no additional permissions?',{title:'Recreate reward role',confirmLabel:'Create role'}))return;await runAction('recover-role',()=>api.request('/api/timed-roles/'+guildId+'/rules/'+rule.ruleId+'/recover-role',{method:'POST',body:JSON.stringify({})}),'Reward role recreated.');}}>Recreate reward role</button></div>}
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