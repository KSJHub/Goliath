import React, { useEffect, useMemo, useState } from 'react';
import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const emptyDraft = { memberId: '', roleId: '', value: 1, unit: 'days', reason: 'Temporary role' };
const guildIdOf = (selectedGuild, selectedGuildData) => String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
const listOf = (payload, key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
const fmt = (value) => value ? new Date(value).toLocaleString() : '—';

function fieldStyle(theme) { return { width: '100%', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 12, padding: '11px 12px' }; }
function buttonStyle(theme, tone = 'default') { const bg = { primary: 'rgba(37,99,235,.22)', success: 'rgba(22,163,74,.22)', danger: 'rgba(220,38,38,.22)', default: 'rgba(15,23,42,.45)' }; return { border: `1px solid ${theme.cardBorder}`, background: bg[tone], color: theme.cardText, borderRadius: 14, padding: '11px 14px', fontWeight: 950, cursor: 'pointer' }; }
function Stat({ theme, label, value, hint }) { return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.34)', borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>{value}</div>{hint ? <div style={{ color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}</div>; }

export default function TemporaryRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdOf(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [overview, setOverview] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const card = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow }), [theme]);
  const active = assignments.filter((item) => item.status === 'active');
  const history = assignments.filter((item) => item.status !== 'active').slice(0, 50);
  const settings = config?.settings || {};
  const health = overview.health || null;
  const analytics = overview.analytics || config?.analytics || {};
  const roleName = (id) => roles.find((item) => String(item.id) === String(id))?.name || id;
  const memberName = (id) => members.find((item) => String(item.id) === String(id))?.displayName || id;

  async function load() {
    if (!guildId) return;
    setError('');
    try {
      const [payload, rolePayload] = await Promise.all([
        api.request(`/api/temporary-roles/${guildId}/overview`),
        api.getGuildRoles(guildId),
      ]);
      setConfig(payload.config || {});
      setOverview(payload.overview || {});
      setAssignments(payload.assignments || []);
      setMembers(payload.members || []);
      setRoles(listOf(rolePayload, 'roles'));
    } catch (e) { setError(e.message || 'Failed to load Temporary Roles.'); }
  }
  useEffect(() => { load(); }, [guildId]);

  async function action(name, fn, success) {
    setBusy(name); setError(''); setMessage('');
    try { await fn(); setMessage(success || 'Done.'); await load(); return true; }
    catch (e) { setError(e.message || 'Temporary Roles action failed.'); return false; }
    finally { setBusy(''); }
  }

  const patchSettings = (patch) => action('settings', () => api.request(`/api/temporary-roles/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: patch }) }), 'Settings saved.');
  async function assign() { const saved = await action('assign', () => api.request(`/api/temporary-roles/${guildId}/assignments`, { method: 'POST', body: JSON.stringify(draft) }), 'Temporary role assigned.'); if (saved) setDraft(emptyDraft); }
  async function renew(item) { const value = Number(window.prompt('Renew for how many units?', '1')); if (!Number.isFinite(value) || value <= 0) return; const unit = window.prompt('Unit: minutes, hours, days, weeks, months or years', 'days'); if (!unit) return; await action(`renew-${item.assignmentId}`, () => api.request(`/api/temporary-roles/${guildId}/assignments/${item.assignmentId}/renew`, { method: 'POST', body: JSON.stringify({ value, unit, reason: item.reason }) }), 'Assignment renewed.'); }
  async function remove(item) { if (!window.confirm(`Remove ${roleName(item.roleId)} from ${memberName(item.memberId)} now?`)) return; await action(`remove-${item.assignmentId}`, () => api.request(`/api/temporary-roles/${guildId}/assignments/${item.assignmentId}`, { method: 'DELETE' }), 'Assignment removed.'); }

  if (!guildId) return <EmptyState theme={theme} icon="⏱️" title="Select a server" description="Select a server to manage Temporary Roles." />;
  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...card, padding: 24, background: 'linear-gradient(135deg, rgba(14,165,233,.18), rgba(15,23,42,.08), rgba(34,197,94,.12))' }}><p style={{ margin: '0 0 8px', color: '#7dd3fc', fontWeight: 950 }}>ROLE STUDIO</p><h1 style={{ margin: 0, fontSize: 'clamp(28px,4vw,42px)' }}>Temporary Roles</h1><p style={{ color: theme.mutedText, lineHeight: 1.6 }}>Assign, renew, expire and repair temporary server roles from the canonical guild configuration.</p></section>
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}><Stat theme={theme} label="Status" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} /><Stat theme={theme} label="Active" value={overview.activeCount || 0} /><Stat theme={theme} label="Expiring Soon" value={overview.expiringSoonCount || 0} hint="Within 24 hours" /><Stat theme={theme} label="Assigned" value={analytics.assigned || 0} /><Stat theme={theme} label="Expired" value={analytics.expired || 0} /><Stat theme={theme} label="Failed" value={overview.failedCount || 0} /><Stat theme={theme} label="Health" value={health?.healthy === false ? 'Attention' : 'Healthy'} /></section>
    {(error || message) ? <section style={{ ...card, padding: 14, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || message}</section> : null}
    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Controls & Health</h2><p style={{ color: theme.mutedText }}>Expiry sweep, repair and runtime options.</p></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={busy} style={buttonStyle(theme, 'primary')} onClick={() => action('enabled', () => api.request(`/api/temporary-roles/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !(overview.enabled || config?.enabled) }) }), 'Module status updated.')}>{overview.enabled || config?.enabled ? 'Disable' : 'Enable'}</button><button disabled={busy} style={buttonStyle(theme, 'success')} onClick={() => action('scan', () => api.request(`/api/temporary-roles/${guildId}/scan`, { method: 'POST' }), 'Expiry scan complete.')}>Scan Expired</button><button disabled={busy} style={buttonStyle(theme, 'primary')} onClick={() => action('repair', () => api.request(`/api/temporary-roles/${guildId}/repair`, { method: 'POST' }), 'Repair complete.')}>Repair</button><a href={`/api/temporary-roles/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export JSON</a></div></div><div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}><label><input type="checkbox" checked={settings.removeExpiredOnStartup !== false} onChange={(e) => patchSettings({ removeExpiredOnStartup: e.target.checked })} /> Remove expired on startup</label><label><input type="checkbox" checked={settings.auditLog !== false} onChange={(e) => patchSettings({ auditLog: e.target.checked })} /> Audit logging</label></div>{[...(health?.issues || []), ...(health?.warnings || [])].map((item) => <div key={item} style={{ color: theme.mutedText, fontSize: 13 }}>• {item}</div>)}</section>
    <section style={{ ...card, padding: 22, display: 'grid', gap: 14 }}><div><h2 style={{ margin: 0 }}>Assign Temporary Role</h2><p style={{ color: theme.mutedText }}>Choosing the same active member/role pair renews it instead of duplicating it.</p></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}><label style={{ display: 'grid', gap: 8 }}>Member<select value={draft.memberId} onChange={(e) => setDraft({ ...draft, memberId: e.target.value })} style={fieldStyle(theme)}><option value="">Select member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.bot ? ' [BOT]' : ''}</option>)}</select></label><RoleSelect theme={theme} resources={roles} value={draft.roleId} onChange={(roleId) => setDraft({ ...draft, roleId })} label="Role" disabled={!roles.length} /><label style={{ display: 'grid', gap: 8 }}>Duration<input type="number" min="1" value={draft.value} onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })} style={fieldStyle(theme)} /></label><label style={{ display: 'grid', gap: 8 }}>Unit<select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} style={fieldStyle(theme)}>{['minutes','hours','days','weeks','months','years'].map((u) => <option key={u}>{u}</option>)}</select></label></div><label style={{ display: 'grid', gap: 8 }}>Reason<input maxLength={300} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} style={fieldStyle(theme)} /></label><div><button disabled={busy || !draft.memberId || !draft.roleId || !draft.value} style={buttonStyle(theme, 'success')} onClick={assign}>Assign Role</button></div></section>
    <section style={{ ...card, padding: 22, display: 'grid', gap: 10 }}><h2 style={{ margin: 0 }}>Active Temporary Roles</h2>{active.length ? active.map((item) => <div key={item.assignmentId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14 }}><div><strong>{memberName(item.memberId)}</strong> · {roleName(item.roleId)}</div><div style={{ color: theme.mutedText, fontSize: 13, margin: '5px 0' }}>Expires {fmt(item.expiresAt)} · Assigned by {item.assignedBy || 'unknown'} · {item.reason}</div><div style={{ display: 'flex', gap: 8 }}><button disabled={busy} style={buttonStyle(theme, 'primary')} onClick={() => renew(item)}>Renew</button><button disabled={busy} style={buttonStyle(theme, 'danger')} onClick={() => remove(item)}>Remove Now</button></div></div>) : <div style={{ color: theme.mutedText }}>No active assignments.</div>}</section>
    <section style={{ ...card, padding: 22, display: 'grid', gap: 8 }}><h2 style={{ margin: 0 }}>Recent History</h2>{history.length ? history.map((item) => <div key={item.assignmentId} style={{ borderBottom: `1px solid ${theme.cardBorder}`, padding: '8px 0' }}><strong>{memberName(item.memberId)}</strong> · {roleName(item.roleId)} · {item.status}<div style={{ color: theme.mutedText, fontSize: 12 }}>{fmt(item.updatedAt)}{item.lastError ? ` · ${item.lastError}` : ''}</div></div>) : <div style={{ color: theme.mutedText }}>No completed assignments yet.</div>}</section>
  </div>;
}
