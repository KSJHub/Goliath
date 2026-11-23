import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import { goliathDialog } from '../../shared/GoliathDialogHost.jsx';
import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const baseApi = (guildId) => `/api/role-selector/${guildId}`;
const blankGroup = () => ({ name: '', emoji: E.ROLE_TAG, description: '', selectionMode: 'single', allowRemove: true, optionsText: '' });
function guildIdFrom(selectedGuild, selectedGuildData) { return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim(); }
function normalizeList(payload, key) { if (Array.isArray(payload)) return payload; if (Array.isArray(payload?.[key])) return payload[key]; if (Array.isArray(payload?.data)) return payload.data; return []; }
function box(theme) { return { border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 20 }; }
function btn(theme, tone = 'default') { return { border: `1px solid ${theme.cardBorder}`, background: tone === 'primary' ? 'rgba(37,99,235,.22)' : tone === 'danger' ? 'rgba(220,38,38,.2)' : 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 12, padding: '9px 12px', fontWeight: 900, cursor: 'pointer' }; }
function Input({ theme, ...props }) { return <input {...props} style={{ width: '100%', padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText, ...(props.style || {}) }} />; }
function optionLineCount(text) { return String(text || '').split(/\r?\n/).filter(line => line.trim()).length; }
function parseOptions(text, existing = []) {
  const byLabel = new Map((existing || []).map((item) => [String(item.label || '').toLowerCase(), item]));
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 25).map((line, index) => {
    const [emoji, labelRaw, description, roleIdRaw] = line.split('|').map((part) => part.trim());
    const label = labelRaw || emoji;
    const previous = byLabel.get(String(label || '').toLowerCase());
    const roleId = /^\d{15,25}$/.test(roleIdRaw || '') ? roleIdRaw : previous?.roleId || null;
    return { ...(previous || {}), id: previous?.id, emoji, label, description, roleId, managed: roleIdRaw ? false : previous?.managed, enabled: previous?.enabled !== false, order: (index + 1) * 10 };
  });
}
function groupDraft(group) {
  return { name: group?.name || '', emoji: group?.emoji || E.ROLE_TAG, description: group?.description || '', selectionMode: group?.selectionMode || 'single', allowRemove: group?.allowRemove !== false, controlMode: group?.controlMode || 'dropdown', minSelections: group?.minSelections || 0, maxSelections: group?.maxSelections || (group?.selectionMode === 'multiple' ? 25 : 1), appearance: { ...(group?.appearance || {}) }, optionsText: (group?.options || []).map((item) => `${item.emoji || ''} | ${item.label} | ${item.description || ''} | ${item.managed === false ? item.roleId || '' : ''}`).join('\n') };
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
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardPreviewChoices, setWizardPreviewChoices] = useState([]);
  useEffect(() => { setWizardStep(0); setNewDraft(blankGroup()); setWizardPreviewChoices([]); }, [guildId]);
  useEffect(() => { setWizardPreviewChoices([]); }, [newDraft.optionsText, newDraft.selectionMode]);
  const [previewChoices, setPreviewChoices] = useState([]);
  useEffect(() => { setPreviewChoices([]); }, [guildId, selectedGroupId, editDraft.optionsText, editDraft.selectionMode]);
  const [panelDraft, setPanelDraft] = useState({id:null,channelId:'',groupIds:[],optionIdsByGroup:{}});
  useEffect(() => { setPanelDraft({id:null,channelId:'',groupIds:[],optionIdsByGroup:{}}); }, [guildId]);
  const [templatePayload, setTemplatePayload] = useState({});
  const [templateChoice, setTemplateChoice] = useState('');
  useEffect(() => { setTemplateChoice(''); setTemplatePayload({}); if (!guildId) return; let active=true; api.getEmbedTemplates(guildId).then(value=>{if(active)setTemplatePayload(value || {});}).catch(()=>{}); return ()=>{active=false;}; }, [guildId]);
  useEffect(()=>setTemplateChoice(''),[selectedGroupId]);
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

  if (!guildId) return <EmptyState theme={theme} icon={E.ROLES} title="Select a server" description="Select a server to manage Role Selector." />;
  if (!data) return <div style={card}>{error || 'Loading Role Selector...'}</div>;

  const config = data.config || {};
  const groups = data.groups || [];
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0];
  const colours = groups.find((group) => group.id === 'colours');
  const usage = data.usage || { groups: [], totalUsing: 0, totalMembers: 0 };
  const health = data.health || {};
  const acceptance = health.acceptance || { ready: false, checks: [], failed: [] };
  const selectedUsage = usage.groups?.find((group) => group.groupId === selectedGroupId);

  function togglePreview(key) {
    setPreviewChoices(old => {
      const next = editDraft.selectionMode === 'single' ? [key] : old.includes(key) ? old.filter(x => x !== key) : [...old, key];
      const min = Math.max(0, Number(editDraft.minSelections) || 0);
      const max = editDraft.selectionMode === 'single' ? 1 : Math.max(1, Number(editDraft.maxSelections) || 25);
      if (next.length > max || (next.length < min && next.length < old.length) || (!next.length && !editDraft.allowRemove)) return old;
      return next;
    });
  }
  function chooseGroup(group) { if (!group) return; setSelectedGroupId(group.id); setEditDraft(groupDraft(group)); setPreviewChoices([]); }
  async function saveSelectedGroup() {
    if (!selectedGroup || selectedGroup.id === 'colours') return;
    if (optionLineCount(editDraft.optionsText) > 25) { setError('A selector supports at most 25 options. Remove excess lines before saving.'); return; }
    if (editDraft.controlMode === 'buttons' && optionLineCount(editDraft.optionsText) > 15) { setError('Button selectors support at most 15 options.'); return; }
    if (editDraft.selectionMode === 'multiple' && (Number(editDraft.minSelections) < 0 || Number(editDraft.maxSelections) < 1 || Number(editDraft.minSelections) > Number(editDraft.maxSelections))) { setError('Minimum and maximum selections are invalid.'); return; }
    const result = await run(() => api.request(`${baseApi(guildId)}/groups`, { method: 'POST', body: JSON.stringify({ ...selectedGroup, ...editDraft, maxSelections: editDraft.selectionMode === 'single' ? 1 : editDraft.maxSelections, options: parseOptions(editDraft.optionsText, selectedGroup.options) }) }), 'Selector group saved.');
    const saved = result?.groups?.find((group) => group.id === selectedGroup.id) || result?.group;
    if (saved) chooseGroup(saved);
  }
  async function createGroup() {
    if (optionLineCount(newDraft.optionsText) > 25 || (newDraft.controlMode === 'buttons' && optionLineCount(newDraft.optionsText) > 15)) { setError('The selector exceeds the supported option limit.'); return; }
    const result = await run(() => api.request(`${baseApi(guildId)}/groups`, { method: 'POST', body: JSON.stringify({ ...newDraft, options: parseOptions(newDraft.optionsText, []) }) }), 'Custom selector created.');
    const group = result?.group;
    if (group) { chooseGroup(group); setNewDraft(blankGroup()); setWizardStep(0); }
  }
  async function deleteSelectedGroup() {
    if (!selectedGroup || selectedGroup.id === 'colours') return;
    if (!await goliathDialog.confirm(`Delete ${selectedGroup.name}? Goliath-created roles for this group will also be deleted.`, { title: 'Delete Role Group?', danger: true, confirmLabel: 'Delete Group' })) return;
    const result = await run(() => api.request(`${baseApi(guildId)}/groups/${encodeURIComponent(selectedGroup.id)}`, { method: 'DELETE' }), 'Selector group deleted.');
    if (!result) return;
    const fallback = result.groups?.find((group) => group.id === 'colours') || result.groups?.[0];
    if (fallback) chooseGroup(fallback);
    else { setSelectedGroupId('colours'); setEditDraft(blankGroup()); }
  }

  return <div style={{ display: 'grid', gap: 16 }}>
    <section style={{ ...card, background: 'linear-gradient(135deg, rgba(139,92,246,.17), rgba(59,130,246,.12))' }}>
      <div style={{ color: '#c4b5fd', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '.08em' }}>Role Studio</div>
      <h1 style={{ margin: '7px 0 5px', fontSize: 'clamp(28px,4vw,42px)' }}>{E.ROLES} Role Selector</h1>
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>Universal self-role categories with Colours built in. Add platforms, regions, interests, games, notification roles or any other community choices.</p>
    </section>

    {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}

    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Module & Placement</h2><div style={{ color: theme.mutedText }}>Using selectors: {usage.totalUsing}/{usage.totalMembers} · Groups: {groups.length}</div></div><button disabled={busy} onClick={() => saveConfig({ enabled: !data.enabled }, data.enabled ? 'Role Selector disabled.' : 'Role Selector enabled.')} style={btn(theme, 'primary')}>{data.enabled ? 'Disable' : 'Enable'}</button></div>
      <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontWeight: 900 }}>Role format</span><Input theme={theme} value={config.style?.format || `${E.ROLES} | {role}`} onChange={(event) => setData({ ...data, config: { ...config, style: { ...config.style, format: event.target.value } } })} onBlur={() => saveConfig({ style: config.style })} /></label>
      <RoleSelect theme={theme} resources={roles} value={config.style?.anchorRoleId || ''} onChange={(value) => saveConfig({ style: { ...config.style, anchorRoleId: value || null } }, 'Anchor saved.')} label="Divider / Anchor Role" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button disabled={busy} onClick={async () => { const name = await goliathDialog.prompt('Divider role name', { title: 'Create Divider Role', defaultValue: `${E.ROLES} | ROLE SELECTOR` }); if (name) run(() => api.request(`${baseApi(guildId)}/create-divider`, { method: 'POST', body: JSON.stringify({ name }) }), 'Divider created.'); }} style={btn(theme)}>Create Divider</button>
        <button disabled={busy} onClick={() => saveConfig({ style: { ...config.style, placement: config.style?.placement === 'above' ? 'below' : 'above' } }, 'Placement updated.')} style={btn(theme)}>{config.style?.placement === 'above' ? 'Switch to Below Anchor' : 'Switch to Above Anchor'}</button>
        <button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/scan-style`, { method: 'POST' }), 'Guild style scanned.')} style={btn(theme)}>Scan Guild Style</button>
        {config.style?.detectedFormat ? <button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/apply-style`, { method: 'POST' }), 'Suggested style applied.')} style={btn(theme)}>Apply Suggestion</button> : null}
      </div>
      <button disabled={busy} onClick={() => run(() => api.request(`${baseApi(guildId)}/repair`, { method: 'POST' }), 'Health repair complete.')} style={btn(theme)}>Health / Repair</button>
    </section>
    <section style={{...card,display:'grid',gap:12}}>
      <h2>Panel Publishing</h2>
      {(data.deployments || []).map(d => <div key={d.id} style={{borderBottom:`1px solid ${theme.cardBorder}`,padding:8}}>
        <strong>{channels.find(c=>String(c.id)===d.channelId)?.name || d.channelId || 'No channel'} · {d.messageId ? d.status : 'Unpublished'}</strong>
        <p>{d.groupIds.map(id=>groups.find(g=>g.id===id)?.name || id).join(', ')}</p>
        <button style={btn(theme)} onClick={()=>setPanelDraft({...d,optionIdsByGroup:{...d.optionIdsByGroup}})}>Edit</button>
        <button disabled={busy} style={btn(theme,'primary')} onClick={()=>run(()=>api.request(`${baseApi(guildId)}/deployments/${encodeURIComponent(d.id)}/publish`,{method:'POST'}),'Panel published.')}>{d.status==='retired'?'Reactivate':'Publish / Update'}</button>
        <button disabled={busy || d.status==='retired'} style={btn(theme)} onClick={async()=>{if(await goliathDialog.confirm('Retire this panel? Existing member roles are retained.',{title:'Retire panel?'})) await run(()=>api.request(`${baseApi(guildId)}/deployments/${encodeURIComponent(d.id)}/retire`,{method:'POST'}),'Panel retired.');}}>Retire</button>
        <button disabled={busy} style={btn(theme,'danger')} onClick={async()=>{if(await goliathDialog.confirm('Delete this panel? Existing member roles are retained.',{title:'Delete panel?',danger:true})) {const result=await run(()=>api.request(`${baseApi(guildId)}/deployments/${encodeURIComponent(d.id)}`,{method:'DELETE'}),'Panel deleted.');if(result && panelDraft.id===d.id)setPanelDraft({id:null,channelId:'',groupIds:[],optionIdsByGroup:{}});}}}>Delete</button>
      </div>)}
      <h3>{panelDraft.id ? 'Edit panel' : 'Create panel'}</h3>
      <ChannelSelect theme={theme} resources={channels} value={panelDraft.channelId || ''} onChange={channelId=>setPanelDraft(old=>({...old,channelId}))} label="Panel channel" />
      {groups.map(g=><div key={g.id}>
        <label><input type="checkbox" checked={panelDraft.groupIds.includes(g.id)} onChange={e=>{const checked=e.target.checked;setPanelDraft(old=>({...old,groupIds:checked?[...old.groupIds,g.id]:old.groupIds.filter(id=>id!==g.id)}));}}/> {g.name}</label>
        {panelDraft.groupIds.includes(g.id) && <div style={{paddingLeft:20}}>
          <label><input type="checkbox" checked={!Array.isArray(panelDraft.optionIdsByGroup[g.id])} onChange={e=>{const all=e.target.checked;setPanelDraft(old=>{const filters={...old.optionIdsByGroup};if(all)delete filters[g.id];else filters[g.id]=(g.palette || g.options || []).filter(o=>o.enabled!==false).map(o=>o.id);return {...old,optionIdsByGroup:filters};});}}/> All options</label>
          {Array.isArray(panelDraft.optionIdsByGroup[g.id]) && (g.palette || g.options || []).filter(o=>o.enabled!==false).map(o=><label key={o.id} style={{display:'block'}}><input type="checkbox" checked={panelDraft.optionIdsByGroup[g.id].includes(o.id)} onChange={e=>{const checked=e.target.checked;setPanelDraft(old=>({...old,optionIdsByGroup:{...old.optionIdsByGroup,[g.id]:checked?[...old.optionIdsByGroup[g.id],o.id]:old.optionIdsByGroup[g.id].filter(id=>id!==o.id)}}));}}/> {o.label}</label>)}
        </div>}
      </div>)}
      <div><button disabled={busy || !panelDraft.channelId || !panelDraft.groupIds.length} style={btn(theme,'primary')} onClick={async()=>{const result=await run(()=>api.request(`${baseApi(guildId)}/deployments${panelDraft.id?'/'+encodeURIComponent(panelDraft.id):''}`,{method:panelDraft.id?'PUT':'POST',body:JSON.stringify(panelDraft)}),'Panel configuration saved.');if(result)setPanelDraft({id:null,channelId:'',groupIds:[],optionIdsByGroup:{}});}}>Save panel</button> <button style={btn(theme)} onClick={()=>setPanelDraft({id:null,channelId:'',groupIds:[],optionIdsByGroup:{}})}>New / Reset</button></div>
    </section>

    <section style={{ ...card, display: 'grid', gap: 12 }}>
      <div><h2 style={{ margin: 0 }}>Selector Groups</h2><div style={{ color: theme.mutedText }}>Single-choice and multi-choice groups are isolated from each other.</div></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{groups.map((group) => <button key={group.id} onClick={() => chooseGroup(group)} style={btn(theme, group.id === selectedGroupId ? 'primary' : 'default')}>{group.emoji || E.ROLE_TAG} {group.name}</button>)}</div>
      {selectedGroup && <div style={{display:'grid',gap:8}}>
        <strong>Individual Embed Studio template</strong>
        <div>Current binding: {templatePayload.bindings?.role_selector?.['member_group_'+selectedGroup.id] || 'Shared template / default'}</div>
        <ThemedSelect theme={theme} value={templateChoice} onChange={e=>setTemplateChoice(e.target.value)}><option value="">Choose existing template</option>{Object.values(templatePayload.templates || {}).filter(t=>t?.templateId).map(t=><option key={t.templateId} value={t.templateId}>{t.name || t.templateId}</option>)}</ThemedSelect>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button disabled={busy || !templateChoice} style={btn(theme,'primary')} onClick={()=>run(async()=>{await api.bindEmbedTemplate(guildId,'role_selector','member_group_'+selectedGroup.id,templateChoice);setTemplatePayload(await api.getEmbedTemplates(guildId));return null;},'Individual selector template bound.')}>Bind template</button>
          <button disabled={busy} style={btn(theme)} onClick={async()=>{if(await goliathDialog.confirm('Restore the shared selector template?',{title:'Remove individual template binding'}))await run(async()=>{await api.unbindEmbedTemplate(guildId,'role_selector','member_group_'+selectedGroup.id);setTemplatePayload(await api.getEmbedTemplates(guildId));return null;},'Individual binding removed.');}}>Restore shared template</button>
          <button disabled={busy} style={btn(theme)} onClick={()=>run(async()=>{setTemplatePayload(await api.getEmbedTemplates(guildId));return null;},'Templates refreshed.')}>Refresh templates</button>
        </div>
      </div>}
      {selectedGroup?.id === 'colours' ? <div style={{ display: 'grid', gap: 10 }}>
        <strong>{E.COLOURS} Built-in Colours</strong>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={colours?.customHexEnabled !== false} onChange={(event) => run(() => api.request(`${baseApi(guildId)}/colours`, { method: 'PUT', body: JSON.stringify({ customHexEnabled: event.target.checked }) }), 'Colour settings saved.')} /> Allow custom HEX</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>{(colours?.palette || []).map((item) => <label key={item.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 9 }}><input type="checkbox" checked={item.enabled !== false} onChange={(event) => run(() => api.request(`${baseApi(guildId)}/colours`, { method: 'PUT', body: JSON.stringify({ palette: colours.palette.map((entry) => entry.id === item.id ? { ...entry, enabled: event.target.checked } : entry) }) }), 'Palette saved.')} /> {item.emoji} <strong>{item.label}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{item.hex}</div></label>)}</div>
        <div style={card}>
          <strong>Interactive colour preview — no roles assigned</strong>
          <ThemedSelect theme={theme} value={previewChoices[0] || ''} onChange={e=>setPreviewChoices(e.target.value ? [e.target.value] : [])}>
            <option value="">Choose a colour</option>
            {(colours?.palette || []).filter(o=>o.enabled!==false).map(o=><option key={o.id} value={o.hex}>{o.label} — {o.hex}</option>)}
            {previewChoices[0] && !(colours?.palette || []).some(o=>o.hex===previewChoices[0]) && <option value={previewChoices[0]}>{previewChoices[0]}</option>}
          </ThemedSelect>
          {colours?.customHexEnabled !== false && <label>Custom colour <input type="color" value={/^#[0-9a-f]{6}$/i.test(previewChoices[0] || '') ? previewChoices[0] : '#5865F2'} onChange={e=>setPreviewChoices([e.target.value.toUpperCase()])}/></label>}
          {previewChoices[0] && <p style={{color:previewChoices[0]}}>Selected colour: {previewChoices[0]}</p>}
          {colours?.allowRemove !== false && <button style={btn(theme)} onClick={()=>setPreviewChoices([])}>Clear selection</button>}
        </div>
      </div> : selectedGroup ? <div style={{ display: 'grid', gap: 9 }}>
        <Input theme={theme} value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} placeholder="Group name" />
        <Input theme={theme} value={editDraft.emoji} onChange={(event) => setEditDraft({ ...editDraft, emoji: event.target.value })} placeholder="Emoji" />
        <Input theme={theme} value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} placeholder="Description" />
        <ThemedSelect theme={theme} value={editDraft.selectionMode} onChange={(event) => setEditDraft({ ...editDraft, selectionMode: event.target.value })} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }}><option value="single">Single choice</option><option value="multiple">Multiple choices</option></ThemedSelect>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={editDraft.allowRemove} onChange={(event) => setEditDraft({ ...editDraft, allowRemove: event.target.checked })} /> Members can clear this category</label>
        <textarea value={editDraft.optionsText} onChange={(event) => setEditDraft({ ...editDraft, optionsText: event.target.value })} rows={7} placeholder={`${E.GAMEPAD} | Xbox | Xbox players |\n${E.JOYSTICK} | PlayStation | PlayStation players |\n${E.COMPUTER} | PC | PC players | 123456789012345678`} style={{ padding: 10, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText }} />
        <div style={{ color: theme.mutedText, fontSize: 12 }}>Format: emoji | label | description | optional existing role ID. Existing roles may have permissions, but must be manageable by Goliath.</div>
        <label>Minimum selections <Input theme={theme} type="number" min={0} max={editDraft.selectionMode==='single'?1:25} value={editDraft.minSelections || 0} onChange={e=>setEditDraft({...editDraft,minSelections:Number(e.target.value)})}/></label>
        <label>Maximum selections <Input theme={theme} type="number" min={1} max={editDraft.selectionMode==='single'?1:25} value={editDraft.selectionMode==='single'?1:editDraft.maxSelections || 25} onChange={e=>setEditDraft({...editDraft,maxSelections:Number(e.target.value)})}/></label>
        <label>Control style <ThemedSelect theme={theme} value={editDraft.controlMode || 'dropdown'} onChange={event => setEditDraft({...editDraft, controlMode: event.target.value})}><option value="dropdown">Dropdown</option><option value="buttons">Buttons</option></ThemedSelect></label>
        {['title','description','color','footer','image','thumbnail'].map(key => <label key={key}>Embed {key}<Input theme={theme} value={editDraft.appearance?.[key] || ''} onChange={event => setEditDraft({...editDraft, appearance: {...editDraft.appearance, [key]: event.target.value}})} /></label>)}
        <div style={{...card, borderLeft: '4px solid ' + (/^#[0-9a-f]{6}$/i.test(editDraft.appearance?.color || '') ? editDraft.appearance.color : '#5865F2')}}>
          <strong>Interactive preview — no roles assigned</strong>
          <h3>{editDraft.appearance?.title || editDraft.name}</h3>
          <p>{editDraft.appearance?.description || editDraft.description}</p>
          {editDraft.appearance?.thumbnail && /^https?:\/\//i.test(editDraft.appearance.thumbnail) && <img alt="Preview thumbnail" src={editDraft.appearance.thumbnail} style={{width:72,height:72,objectFit:'contain'}} />}
          {editDraft.appearance?.image && /^https?:\/\//i.test(editDraft.appearance.image) && <img alt="Preview banner" src={editDraft.appearance.image} style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}} />}
          {editDraft.controlMode !== 'buttons' ? <ThemedSelect theme={theme} value="" onChange={event => { const key = event.target.value; if (key) togglePreview(key); }}><option value="">Choose an option</option>{parseOptions(editDraft.optionsText, selectedGroup.options).filter(o => o.enabled).map((o,index) => <option key={o.id || String(index)} value={o.id || String(index)}>{previewChoices.includes(o.id || String(index)) ? E.SUCCESS + ' ' : ''}{o.label}</option>)}</ThemedSelect> : parseOptions(editDraft.optionsText, selectedGroup.options).filter(o => o.enabled).map((o,index) => {
            const key = o.id || String(index);
            return <button type="button" key={key} style={btn(theme,previewChoices.includes(key) ? 'primary' : 'default')} onClick={() => togglePreview(key)}>{o.emoji} {o.label}</button>;
          })}
          {editDraft.allowRemove && !Number(editDraft.minSelections) && <button type="button" style={btn(theme)} onClick={() => setPreviewChoices([])}>Clear selection</button>}
          <p>Selected: {previewChoices.length} · Minimum: {editDraft.minSelections || 0} · Maximum: {editDraft.selectionMode === 'single' ? 1 : editDraft.maxSelections || 25}</p>
          <p>{editDraft.appearance?.footer}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button disabled={busy || !editDraft.name.trim()} onClick={saveSelectedGroup} style={btn(theme, 'primary')}>Save Group</button><button disabled={busy} onClick={deleteSelectedGroup} style={btn(theme, 'danger')}>Delete Group</button></div>
      </div> : null}
    </section>

    <section style={{ ...card, display: 'grid', gap: 9 }}>
      <h2 style={{ margin: 0 }}>{E.ADD} New Custom Group</h2>
      <strong>Step {wizardStep + 1} of 5 — {['Configuration','Options','Appearance','Interactive Preview','Review'][wizardStep]}</strong>
      {wizardStep === 0 && <>
        <Input theme={theme} value={newDraft.name} onChange={e=>setNewDraft({...newDraft,name:e.target.value})} placeholder="Selector name" />
        <Input theme={theme} value={newDraft.emoji} onChange={e=>setNewDraft({...newDraft,emoji:e.target.value})} placeholder="Emoji" />
        <Input theme={theme} value={newDraft.description} onChange={e=>setNewDraft({...newDraft,description:e.target.value})} placeholder="Description" />
        <ThemedSelect theme={theme} value={newDraft.selectionMode} onChange={e=>setNewDraft({...newDraft,selectionMode:e.target.value})}><option value="single">Single choice</option><option value="multiple">Multiple choices</option></ThemedSelect>
      </>}
      {wizardStep === 1 && <>
        <textarea value={newDraft.optionsText} onChange={e=>setNewDraft({...newDraft,optionsText:e.target.value})} rows={7} placeholder="emoji | label | description | optional existing role ID" />
        <label><input type="checkbox" checked={newDraft.allowRemove} onChange={e=>setNewDraft({...newDraft,allowRemove:e.target.checked})}/> Allow clearing selections</label>
        {newDraft.selectionMode === 'multiple' && <><label>Minimum selections <Input theme={theme} type="number" min="0" max="25" value={newDraft.minSelections ?? 0} onChange={e=>setNewDraft({...newDraft,minSelections:Number(e.target.value)})}/></label><label>Maximum selections <Input theme={theme} type="number" min="1" max="25" value={newDraft.maxSelections ?? 25} onChange={e=>setNewDraft({...newDraft,maxSelections:Number(e.target.value)})}/></label></>}
      </>}
      {wizardStep === 2 && <>
        <ThemedSelect theme={theme} value={newDraft.controlMode || 'dropdown'} onChange={e=>setNewDraft({...newDraft,controlMode:e.target.value})}><option value="dropdown">Dropdown</option><option value="buttons">Buttons</option></ThemedSelect>
        {['title','description','color','footer','image','thumbnail'].map(key=><label key={key}>Embed {key}<Input theme={theme} value={newDraft.appearance?.[key] || ''} onChange={e=>setNewDraft({...newDraft,appearance:{...newDraft.appearance,[key]:e.target.value}})}/></label>)}
      </>}
      {wizardStep === 3 && <div style={card}><h3>{newDraft.appearance?.title || newDraft.name}</h3><p>{newDraft.appearance?.description || newDraft.description}</p><strong>Interactive simulation — no Discord roles assigned</strong><div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{parseOptions(newDraft.optionsText).map((o,index)=>{const key=String(index);return <button type="button" key={key} style={btn(theme,wizardPreviewChoices.includes(key)?'primary':'default')} onClick={()=>setWizardPreviewChoices(old=>{const next=newDraft.selectionMode==='single'?[key]:old.includes(key)?old.filter(x=>x!==key):[...old,key];const min=Number(newDraft.minSelections)||0;const max=newDraft.selectionMode==='single'?1:Number(newDraft.maxSelections)||25;return next.length<=max&&(next.length>=min||next.length>=old.length)&&(next.length||newDraft.allowRemove)?next:old;})}>{o.emoji} {o.label}</button>;})}</div><p>Selected: {wizardPreviewChoices.length} · Maximum: {newDraft.selectionMode==='single'?1:newDraft.maxSelections||25}</p>{newDraft.allowRemove && !Number(newDraft.minSelections) && <button type="button" style={btn(theme)} onClick={()=>setWizardPreviewChoices([])}>Clear preview</button>}</div>}
      {wizardStep === 4 && <div style={card}><h3>{newDraft.appearance?.title || newDraft.name}</h3><p>{newDraft.appearance?.description || newDraft.description}</p>{parseOptions(newDraft.optionsText).map((o,index)=><div key={index}>{o.emoji} {o.label}</div>)}<p>Create this selector, then select it in Panel Publishing to publish it.</p></div>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button disabled={wizardStep===0 || busy} style={btn(theme)} onClick={()=>setWizardStep(s=>s-1)}>Previous Step</button>
        {wizardStep < 4 ? <button disabled={busy || !newDraft.name.trim() || (wizardStep===1 && (!parseOptions(newDraft.optionsText).length || optionLineCount(newDraft.optionsText)>25 || (newDraft.selectionMode==='multiple' && (Number(newDraft.minSelections)<0 || Number(newDraft.maxSelections)<1 || Number(newDraft.minSelections)>Number(newDraft.maxSelections))))) || (wizardStep===2 && newDraft.controlMode==='buttons' && optionLineCount(newDraft.optionsText)>15)} style={btn(theme,'primary')} onClick={()=>setWizardStep(s=>s+1)}>Next Step</button> : <button disabled={busy || !newDraft.name.trim()} style={btn(theme,'primary')} onClick={createGroup}>Create Selector</button>}
      </div>
    </section>

    <section style={{ ...card, display: 'grid', gap: 10 }}>
      <h2 style={{ margin: 0 }}>{E.CHART} Selector Stats</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(usage.groups || []).map((group) => {
        const target = groups.find((item) => item.id === group.groupId);
        return <button key={group.groupId} onClick={() => chooseGroup(target)} style={btn(theme, group.groupId === selectedGroupId ? 'primary' : 'default')}>{group.emoji} {group.name}</button>;
      })}</div>
      {selectedUsage?.rows?.length ? selectedUsage.rows.map((item, index) => <div key={item.id} style={{ borderTop: index ? `1px solid ${theme.cardBorder}` : 'none', paddingTop: index ? 9 : 0 }}><strong>{index + 1}. {item.label} — {item.count}</strong>{item.members?.length ? <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{item.members.slice(0, 30).map((member) => member.name).join(', ')}{item.members.length > 30 ? ` +${item.members.length - 30} more` : ''}</div> : null}</div>) : <div style={{ color: theme.mutedText }}>No selections yet.</div>}
    </section>

    <section style={{ ...card, display: 'grid', gap: 8 }}>
      <h2 style={{ margin: 0 }}>Health & Acceptance</h2>
      <strong style={{ color: health.healthy ? '#86efac' : '#fbbf24' }}>{health.healthy ? `${E.SUCCESS} Healthy` : `${E.WARNING} Needs attention`}</strong>
      {(health.issues || []).map((item, index) => <div key={`i-${index}`} style={{ color: '#fca5a5' }}>• {item}</div>)}
      {(health.warnings || []).slice(0, 12).map((item, index) => <div key={`w-${index}`} style={{ color: '#fbbf24' }}>• {item}</div>)}
      <div style={{ borderTop: `1px solid ${theme.cardBorder}`, marginTop: 4, paddingTop: 10 }}>
        <strong style={{ color: acceptance.ready ? '#86efac' : '#fbbf24' }}>{acceptance.ready ? `${E.SUCCESS} Acceptance Ready` : `${E.WARNING} Acceptance Not Ready`}</strong>
        <div style={{ color: theme.mutedText, fontSize: 12, marginTop: 3 }}>{acceptance.ready ? 'The guild is configured for the manual Role Selector acceptance run.' : `${acceptance.failed?.length || 0} readiness check(s) still need attention.`}</div>
      </div>
      {(acceptance.checks || []).map((check) => <div key={check.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 6, alignItems: 'start' }}><span>{check.passed ? E.SUCCESS : E.ERROR}</span><div><strong>{String(check.id || '').replaceAll('_', ' ')}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{check.detail}</div></div></div>)}
    </section>
  </div>;
}
