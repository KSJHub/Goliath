import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const baseApi = (guildId) => `/api/role-selector/${guildId}`;
const blankGroup = () => ({ name: '', emoji: '🏷️', description: '', selectionMode: 'single', allowRemove: true, optionsText: '' });
function guildIdFrom(selectedGuild, selectedGuildData) { return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim(); }
function normalizeList(payload, key) { if (Array.isArray(payload)) return payload; if (Array.isArray(payload?.[key])) return payload[key]; if (Array.isArray(payload?.data)) return payload.data; return []; }
function box(theme) { return { border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 20 }; }
function btn(theme, tone = 'default') { return { border: `1px solid ${theme.cardBorder}`, background: tone === 'primary' ? 'rgba(37,99,235,.22)' : tone === 'danger' ? 'rgba(220,38,38,.2)' : 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' }; }
function Input({ theme, ...props }) { return <input {...props} style={{ width: '100%', padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText, ...(props.style || {}) }} />; }
function parseOptions(text, existing = []) {
  const byLabel = new Map((existing || []).map((item) => [String(item.label || '').toLowerCase(), item]));
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 25).map((line, index) => {
    const [emoji, labelRaw, description, roleIdRaw] = line.split('|').map((part) => part.trim());
    const label = labelRaw || emoji;
    const previous = byLabel.get(String(label || '').toLowerCase());
    const roleId = /^\d{15,25}$/.test(roleIdRaw || '') ? roleIdRaw : previous?.roleId || null;
    return { ...(previous || {}), id: previous?.id, emoji, label, description, roleId, managed: roleIdRaw ? false : previous?.managed, enabled: true, order: (index + 1) * 10 };
  });
}
function groupDraft(group) {
  return { name: group?.name || '', emoji: group?.emoji || '🏷️', description: group?.description || '', selectionMode: group?.selectionMode || 'single', allowRemove: group?.allowRemove !== false, optionsText: (group?.options || []).map((item) => `${item.emoji || ''} | ${item.label} | ${item.description || ''} | ${item.managed === false ? item.roleId || '' : ''}`).join('\n') };
}

export default function RoleSelector({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdFrom(selectedGuild, selectedGuildData);
  const card = useMemo(() => box(theme), [theme]);
  const [data, setData] = useState(null);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('colours');
  const [editDraft, setEditDraft] = useState(blankGroup());
  const [newDraft, setNewDraft] = useState(blankGroup());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!guildId) return;
    setBusy(true); setError('');
    try {
      const [overview, channelPayload, rolePayload] = await Promise.all([
        api.request(`${baseApi(guildId)}/overview`), api.getGuildChannels(guildId), api.getGuildRoles(guildId),
      ]);
      setData(overview);
      setChannels(normalizeList(channelPayload, 'channels'));
      setRoles(normalizeList(rolePayload, 'roles'));
      const selected = overview.groups?.find((group) => group.id === selectedGroupId) || overview.groups?.find((group) => group.id === 'colours') || overview.groups?.[0];
      if (selected) { setSelectedGroupId(selected.id); setEditDraft(groupDraft(selected)); }
    } catch (err) { setError(err.message || 'Failed to load Role Selector.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [guildId]);

  async function run(action, message) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (result) setData(result);
      setNotice(message);
      return result;
    } catch (err) {
      const unresolved = Array.isArray(err.data?.unresolvedRoles) ? err.data.unresolvedRoles : [];
      const detail = unresolved.length
        ? ` ${unresolved.slice(0, 5).map((item) => `${item.label || item.roleId}: ${item.reason || 'unresolved'}`).join(' · ')}`
        : '';
      setError(`${err.message || 'Role Selector action failed.'}${detail}`);
      return null;
    }
    finally { setBusy(false); }
  }
  const saveConfig = (patch, message = 'Role Selector saved.') => run(() => api.request(`${baseApi(guildId)}/config`, { method: 'PUT', body: JSON.stringify(patch) }), message);

  if (!guildId) return <EmptyState theme={theme} icon="🎭" title="Select a server" description="Select a server to manage Role Selector." />;
  if (!data) return <div style={card}>{error || 'Loading Role Selector...'}</div>;

  const config = data.config || {};
  const groups = data.groups || [];
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0];
  const colours = groups.find((group) => group.id === 'colours');
  const usage = data.usage || { groups: [], totalUsing: 0, totalMembers: 0 };
  const health = data.health || {};
  const acceptance = health.acceptance || { ready: false, checks: [], failed: [] };
  const selectedUsage = usage.groups?.find((group) => group.groupId === selectedGroupId);

  function chooseGroup(group) { if (!group) return; setSelectedGroupId(group.id); setEditDraft(groupDraft(group)); }
  async function saveSelectedGroup() {
    if (!selectedGroup || selectedGroup.id === 'colours') return;
    const result = await run(() => api.request(`${baseApi(guildId)}/groups`, { method: 'POST', body: JSON.stringify({ ...selectedGroup, ...editDraft, options: parseOptions(editDraft.optionsText, selectedGroup.options) }) }), 'Selector group saved.');
    const saved = result?.groups?.find((group) => group.id === selectedGroup.id) || result?.group;
    if (saved) chooseGroup(saved);
  }
  async function createGroup() {
    const result = await run(() => api.request(`${baseApi(guildId)}/groups`, { method: 'POST', body: JSON.stringify({ ...newDraft, options: parseOptions(newDraft.optionsText, []) }) }), 'Custom selector created.');
    const group = result?.group;
    if (group) { chooseGroup(group); setNewDraft(blankGroup()); }
  }
  async function deleteSelectedGroup() {
    if (!selectedGroup || selectedGroup.id === 'colours') return;
    if (!window.confirm(`Delete ${selectedGroup.name}? Goliath-created roles for this group will also be deleted.`)) return;
    const result = await run(() => api.request(`${baseApi(guildId)}/groups/${encodeURIComponent(selectedGroup.id)}`, { method: 'DELETE' }), 'Selector group deleted.');
    if (!result) return;
    const fallback = result.groups?.find((group) => group.id === 'colours') || result.groups?.[0];
    if (fallback) chooseGroup(fallback);
    else { setSelectedGroupId('colours'); setEditDraft(blankGroup()); }
  }

  return <div style={{ display: 'grid', gap: 16 }}>
    <section style={{ ...card, background: 'linear-gradient(135deg, rgba(139,92,246,.17), rgba(59,130,246,.12))' }}>
      <div style={{ color: '#c4b5fd', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '.08em' }}>Role Studio</div>
      <h1 style={{ margin: '7px 0 5px', fontSize: 'clamp(28px,4vw,42px)' }}>🎭 Role Selector</h1>
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>Universal self-role categories with Colours built in. Add platforms, regions, interests, games, notification roles or any other community choices.</p>
    </section>

    {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Module & Placement</h2><div style={{ color: theme.mutedText }}>Using selectors: {usage.totalUsing}/{usage.totalMembers} · Groups: {groups.length}</div></div><button disabled={busy} onClick={() => saveConfig({ enabled: !data.enabled }, data.enabled ? 'Role Selector disabled.' : 'Role Selector enabled.')} style={btn(theme, 'primary')}>{data.enabled ? 'Disable' : 'Enable'}</button></div>
      <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontWeight: 900 }}>Role format</span><Input theme={theme} value={config.style?.format || '🎭 | {role}'} onChange={(event) => setData({ ...data, config: { ...config, style: { ...config.style, format: event.target.value } } })} onBlur={() => saveConfig({ style: config.style })} /></label>
      <RoleSelect theme={theme} resources={roles} value={config.style?.anchorRoleId || ''} onChange={(value) => saveConfig({ style: { ...config.style, anchorRoleId: value || null } }, 'Anchor saved.')} label="Divider / Anchor Role" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={() => { const name = window.prompt('Divider role name', '🎭 | ROLE SELECTOR'); if (name) run(() => api.request(`${baseApi(guildId)}/create-divider`, { method: 'POST', body: JSON.stringify({ name }) }), 'Divider created.'); }} style={btn(theme)}>Create Divider</button>
        <button disabled={busy} onClick={() => saveConfig({ style: { ...config.style, placement: config.style?.placement === 'above' ? 'below' : 'above' } }, 'Placement updated.')} style={btn(theme)}>{config.style?.placement === 'above' ? 'Switch to Below Anchor' : 'Switch to Above Anchor'}</button>
        <button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/scan-style`, { method: 'POST' }), 'Guild style scanned.')} style={btn(theme)}>Scan Guild Style</button>
        {config.style?.detectedFormat ? <button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/apply-style`, { method: 'POST' }), 'Suggested style applied.')} style={btn(theme)}>Apply Suggestion</button> : null}
      </div>
      <ChannelSelect theme={theme} resources={channels} value={config.deployment?.channelId || ''} onChange={(value) => saveConfig({ deployment: { ...config.deployment, channelId: value || null } }, 'Selector channel saved.')} label="Member Selector Channel" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={busy || !config.deployment?.channelId} onClick={() => run(() => api.request(`${baseApi(guildId)}/deploy`, { method: 'POST', body: JSON.stringify({ channelId: config.deployment.channelId }) }), 'Role Selector deployed.')} style={btn(theme, 'primary')}>Deploy / Update Selector</button><button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/repair`, { method: 'POST' }), 'Health repair complete.')} style={btn(theme)}>Health / Repair</button></div>
    </section>

    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div><h2 style={{ margin: 0 }}>Selector Groups</h2><div style={{ color: theme.mutedText }}>Single-choice and multi-choice groups are isolated from each other.</div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{groups.map((group) => <button key={group.id} onClick={() => chooseGroup(group)} style={btn(theme, group.id === selectedGroupId ? 'primary' : 'default')}>{group.emoji || '🏷️'} {group.name}</button>)}</div>
      {selectedGroup?.id === 'colours' ? <div style={{ display: 'grid', gap: 10 }}>
        <strong>🌈 Built-in Colours</strong>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={colours?.customHexEnabled !== false} onChange={(event) => run(() => api.request(`${baseApi(guildId)}/colours`, { method: 'PUT', body: JSON.stringify({ customHexEnabled: event.target.checked }) }), 'Colour settings saved.')} /> Allow custom HEX</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>{(colours?.palette || []).map((item) => <label key={item.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 9 }}><input type="checkbox" checked={item.enabled !== false} onChange={(event) => run(() => api.request(`${baseApi(guildId)}/colours`, { method: 'PUT', body: JSON.stringify({ palette: colours.palette.map((entry) => entry.id === item.id ? { ...entry, enabled: event.target.checked } : entry) }) }), 'Palette saved.')} /> {item.emoji} <strong>{item.label}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{item.hex}</div></label>)}</div>
      </div> : selectedGroup ? <div style={{ display: 'grid', gap: 9 }}>
        <Input theme={theme} value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} placeholder="Group name" />
        <Input theme={theme} value={editDraft.emoji} onChange={(event) => setEditDraft({ ...editDraft, emoji: event.target.value })} placeholder="Emoji" />
        <Input theme={theme} value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} placeholder="Description" />
        <select value={editDraft.selectionMode} onChange={(event) => setEditDraft({ ...editDraft, selectionMode: event.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }}><option value="single">Single choice</option><option value="multiple">Multiple choices</option></select>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={editDraft.allowRemove} onChange={(event) => setEditDraft({ ...editDraft, allowRemove: event.target.checked })} /> Members can clear this category</label>
        <textarea value={editDraft.optionsText} onChange={(event) => setEditDraft({ ...editDraft, optionsText: event.target.value })} rows={7} placeholder={'🎮 | Xbox | Xbox players |\n🕹️ | PlayStation | PlayStation players |\n💻 | PC | PC players | 123456789012345678'} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }} />
        <div style={{ color: theme.mutedText, fontSize: 12 }}>Format: emoji | label | description | optional existing role ID. Existing roles must have no permissions and sit below Goliath.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={busy || !editDraft.name.trim()} onClick={saveSelectedGroup} style={btn(theme, 'primary')}>Save Group</button><button disabled={busy} onClick={deleteSelectedGroup} style={btn(theme, 'danger')}>Delete Group</button></div>
      </div> : null}
    </section>

    <section style={{ ...card, display: 'grid', gap: 9 }}>
      <h2 style={{ margin: 0 }}>➕ New Custom Group</h2>
      <Input theme={theme} value={newDraft.name} onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })} placeholder="Gaming Platform / Region / Interests" />
      <Input theme={theme} value={newDraft.emoji} onChange={(event) => setNewDraft({ ...newDraft, emoji: event.target.value })} placeholder="Emoji" />
      <Input theme={theme} value={newDraft.description} onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })} placeholder="Description" />
      <select value={newDraft.selectionMode} onChange={(event) => setNewDraft({ ...newDraft, selectionMode: event.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }}><option value="single">Single choice</option><option value="multiple">Multiple choices</option></select>
      <textarea value={newDraft.optionsText} onChange={(event) => setNewDraft({ ...newDraft, optionsText: event.target.value })} rows={5} placeholder={'🎮 | Xbox | Xbox players |\n🕹️ | PlayStation | PlayStation players |\n💻 | PC | PC players |'} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }} />
      <button disabled={busy || !newDraft.name.trim()} onClick={createGroup} style={btn(theme, 'primary')}>Create Custom Group</button>
    </section>

    <section style={{ ...card, display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0 }}>📊 Selector Stats</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(usage.groups || []).map((group) => {
        const target = groups.find((item) => item.id === group.groupId);
        return <button key={group.groupId} onClick={() => chooseGroup(target)} style={btn(theme, group.groupId === selectedGroupId ? 'primary' : 'default')}>{group.emoji} {group.name}</button>;
      })}</div>
      {selectedUsage?.rows?.length ? selectedUsage.rows.map((item, index) => <div key={item.id} style={{ borderTop: index ? `1px solid ${theme.cardBorder}` : 'none', paddingTop: index ? 9 : 0 }}><strong>{index + 1}. {item.label} — {item.count}</strong>{item.members?.length ? <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{item.members.slice(0, 30).map((member) => member.name).join(', ')}{item.members.length > 30 ? ` +${item.members.length - 30} more` : ''}</div> : null}</div>) : <div style={{ color: theme.mutedText }}>No selections yet.</div>}
    </section>

    <section style={{ ...card, display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>Health & Acceptance</h2>
      <strong style={{ color: health.healthy ? '#86efac' : '#fbbf24' }}>{health.healthy ? '✅ Healthy' : '⚠️ Needs attention'}</strong>
      {(health.issues || []).map((item, index) => <div key={`i-${index}`} style={{ color: '#fca5a5' }}>• {item}</div>)}
      {(health.warnings || []).slice(0, 12).map((item, index) => <div key={`w-${index}`} style={{ color: '#fbbf24' }}>• {item}</div>)}
      <div style={{ borderTop: `1px solid ${theme.cardBorder}`, marginTop: 4, paddingTop: 10 }}>
        <strong style={{ color: acceptance.ready ? '#86efac' : '#fbbf24' }}>{acceptance.ready ? '✅ Acceptance Ready' : '⚠️ Acceptance Not Ready'}</strong>
        <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{acceptance.ready ? 'The guild is configured for the manual Role Selector acceptance run.' : `${acceptance.failed?.length || 0} readiness check(s) still need attention.`}</div>
      </div>
      {(acceptance.checks || []).map((check) => <div key={check.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 6, alignItems: 'start' }}><span>{check.passed ? '✅' : '❌'}</span><div><strong>{String(check.id || '').replaceAll('_', ' ')}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{check.detail}</div></div></div>)}
    </section>
  </div>;
}
