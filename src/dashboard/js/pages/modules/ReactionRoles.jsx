import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import PageShell, { SectionCard, EmptyState, LoadingPanel, Notice, SecondaryButton, StatGrid, SummaryStat } from '../../shared/PageShell';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const getGuildId = (selectedGuild, selectedGuildData) => String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
const normalizeList = (payload, key) => Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : Array.isArray(payload?.data) ? payload.data : [];
const newMapping = () => ({ emoji: '', roleId: '', label: '', mode: 'toggle', removeOnUnreact: true, enabled: true });
const copyMapping = (mapping = {}) => ({ mappingId: mapping.mappingId, emoji: mapping.emoji || '', roleId: mapping.roleId || '', label: mapping.label || '', mode: mapping.mode || 'toggle', removeOnUnreact: mapping.removeOnUnreact !== false, enabled: mapping.enabled !== false });
const inputStyle = (theme) => ({ width: '100%', boxSizing: 'border-box', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.38)', color: theme.cardText, borderRadius: 12, padding: '11px 12px' });

function ActionButton({ theme, children, danger = false, success = false, ...props }) {
  const border = danger ? '#ef4444' : success ? '#22c55e' : theme.cardBorder;
  const background = danger ? 'rgba(239,68,68,0.14)' : success ? 'rgba(34,197,94,0.14)' : 'rgba(59,130,246,0.14)';
  const color = danger ? '#fca5a5' : success ? '#86efac' : theme.cardText;
  return <button type="button" {...props} style={{ border: `1px solid ${border}`, background, color, borderRadius: 12, padding: '10px 13px', fontWeight: 900, cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.55 : 1 }}>{children}</button>;
}

function DiscordEmbedPreview({ embed, theme }) {
  if (!embed) return null;
  const color = Number.isFinite(embed.color) ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865f2';
  return (
    <div style={{ borderLeft: `4px solid ${color}`, background: 'rgba(17,18,20,0.92)', borderRadius: 4, padding: '12px 14px', maxWidth: 620, display: 'grid', gap: 8 }}>
      {embed.author?.name ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800 }}>{embed.author.iconURL ? <img src={embed.author.iconURL} alt="" style={{ width: 22, height: 22, borderRadius: '50%' }} /> : null}{embed.author.name}</div> : null}
      {embed.title ? <div style={{ fontWeight: 950, fontSize: 16 }}>{embed.title}</div> : null}
      {embed.description ? <div style={{ whiteSpace: 'pre-wrap', color: theme.cardText, lineHeight: 1.5 }}>{embed.description}</div> : null}
      {embed.fields?.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>{embed.fields.map((field, index) => <div key={`${field.name}:${index}`} style={{ gridColumn: field.inline ? 'span 1' : '1 / -1' }}><div style={{ fontWeight: 900 }}>{field.name}</div><div style={{ whiteSpace: 'pre-wrap', color: theme.mutedText, marginTop: 3 }}>{field.value}</div></div>)}</div> : null}
      {embed.thumbnailURL ? <img src={embed.thumbnailURL} alt="" style={{ maxWidth: 80, maxHeight: 80, borderRadius: 8 }} /> : null}
      {embed.imageURL ? <img src={embed.imageURL} alt="" style={{ maxWidth: '100%', borderRadius: 8 }} /> : null}
      {embed.footer?.text ? <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: theme.mutedText, fontSize: 12 }}>{embed.footer.iconURL ? <img src={embed.footer.iconURL} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} /> : null}{embed.footer.text}</div> : null}
    </div>
  );
}

function DiscordMessagePreview({ theme, message, compact = false }) {
  if (!message) return null;
  return (
    <div style={{ background: 'rgba(43,45,49,0.96)', border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: compact ? 12 : 16, color: '#f2f3f5', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {message.authorAvatar ? <img src={message.authorAvatar} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} /> : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>{message.authorName || 'Unknown'}</strong>{message.bot ? <span style={{ background: '#5865f2', borderRadius: 4, padding: '1px 4px', fontSize: 10, fontWeight: 900 }}>BOT</span> : null}<span style={{ color: '#949ba4', fontSize: 12 }}>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</span></div>
          {message.content ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, marginTop: 4 }}>{message.content}</div> : null}
        </div>
      </div>
      {(message.embeds || []).map((embed, index) => <DiscordEmbedPreview key={index} embed={embed} theme={theme} />)}
      {message.reactions?.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{message.reactions.map((reaction, index) => <span key={`${reaction.emoji}:${index}`} style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '4px 8px' }}>{reaction.emoji} {reaction.count}</span>)}</div> : null}
      {!message.content && !message.embeds?.length ? <div style={{ color: '#949ba4' }}>Message with no text or embed preview.</div> : null}
    </div>
  );
}

function MessageCard({ theme, message, selected, onSelect }) {
  return (
    <div style={{ border: `1px solid ${selected ? '#60a5fa' : theme.cardBorder}`, background: selected ? 'rgba(59,130,246,0.10)' : 'rgba(15,23,42,0.22)', borderRadius: 18, padding: 14, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><div><strong>#{message.channelName || message.channelId}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{message.id} · {message.pinned ? 'Pinned · ' : ''}{message.embedCount || 0} embed(s) · {message.reactionCount || 0} reaction(s)</div></div><ActionButton theme={theme} success={selected} onClick={() => onSelect(message)}>{selected ? 'Selected ✓' : 'Select Message'}</ActionButton></div>
      <DiscordMessagePreview theme={theme} message={message} compact />
      {message.jumpUrl ? <a href={message.jumpUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontWeight: 800, textDecoration: 'none' }}>Open in Discord ↗</a> : null}
    </div>
  );
}

function MappingEditor({ theme, mappings, roles, onChange, onRemove }) {
  return <div style={{ display: 'grid', gap: 10 }}>{mappings.map((mapping, index) => <div key={mapping.mappingId || index} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}><div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,.35fr) minmax(180px,1fr) minmax(180px,.7fr)', gap: 10 }}><input style={inputStyle(theme)} value={mapping.emoji} onChange={(event) => onChange(index, { emoji: event.target.value })} placeholder="Emoji" /><RoleSelect theme={theme} resources={roles} value={mapping.roleId} onChange={(value) => onChange(index, { roleId: value || '' })} label="Role" /><select style={inputStyle(theme)} value={mapping.mode} onChange={(event) => onChange(index, { mode: event.target.value, removeOnUnreact: event.target.value === 'toggle' })}><option value="toggle">Add + remove on unreact</option><option value="add">Add only</option><option value="remove">Remove role</option></select></div><div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}><input style={inputStyle(theme)} value={mapping.label} onChange={(event) => onChange(index, { label: event.target.value })} placeholder="Optional label" /><label style={{ color: theme.mutedText, fontWeight: 800 }}><input type="checkbox" checked={mapping.enabled !== false} onChange={(event) => onChange(index, { enabled: event.target.checked })} /> Enabled</label>{mappings.length > 1 ? <ActionButton theme={theme} danger onClick={() => onRemove(index)}>Remove</ActionButton> : null}</div></div>)}</div>;
}

export default function ReactionRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState({ enabled: true, panels: {}, analytics: {} });
  const [health, setHealth] = useState({ healthy: true, panels: [] });
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [results, setResults] = useState([]);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [previewByPanel, setPreviewByPanel] = useState({});
  const [editingPanelId, setEditingPanelId] = useState('');
  const [editingMappings, setEditingMappings] = useState([]);
  const [filters, setFilters] = useState({ channelId: '', query: '', messageId: '', authorId: '', botsOnly: false, embedsOnly: false, pinnedOnly: false });
  const [form, setForm] = useState({ name: 'Reaction Roles', mappings: [newMapping()] });
  const panels = useMemo(() => Object.values(config.panels || {}), [config]);
  const mappings = useMemo(() => panels.flatMap((panel) => panel.mappings || []), [panels]);

  async function load() {
    if (!guildId) return;
    setLoading(true); setError('');
    try {
      const [payload, channelPayload, rolePayload] = await Promise.all([api.request(`/api/reaction-roles/${guildId}/overview`), api.getGuildChannels(guildId), api.getGuildRoles(guildId)]);
      setConfig(payload.config || { enabled: true, panels: {}, analytics: {} }); setHealth(payload.health || { healthy: true, panels: [] }); setChannels(normalizeList(channelPayload, 'channels')); setRoles(normalizeList(rolePayload, 'roles'));
    } catch (loadError) { setError(loadError.message || 'Failed to load Reaction Roles.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [guildId]);

  async function searchMessages(extra = {}) {
    setSearching(true); setError(''); setNotice('');
    try {
      const values = { ...filters, ...extra };
      const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== '' && value !== false) params.set(key, String(value)); });
      params.set('scanLimit', values.channelId ? '200' : '75'); params.set('resultLimit', '50');
      const payload = await api.request(`/api/reaction-roles/${guildId}/messages/search?${params.toString()}`);
      setResults(payload.messages || []); setNotice(`${payload.messages?.length || 0} message(s) found across ${payload.scannedChannels || 0} channel(s).`);
      return payload.messages || [];
    } catch (searchError) { setError(searchError.message || 'Message search failed.'); return []; } finally { setSearching(false); }
  }

  async function previewPanel(panel) {
    if (previewByPanel[panel.panelId]) { setPreviewByPanel((current) => ({ ...current, [panel.panelId]: null })); return; }
    const messages = await searchMessages({ channelId: panel.channelId, messageId: panel.messageId });
    setPreviewByPanel((current) => ({ ...current, [panel.panelId]: messages[0] || { missing: true } }));
  }

  const updateFormMapping = (index, patch) => setForm((current) => ({ ...current, mappings: current.mappings.map((mapping, i) => i === index ? { ...mapping, ...patch } : mapping) }));
  const updateEditingMapping = (index, patch) => setEditingMappings((current) => current.map((mapping, i) => i === index ? { ...mapping, ...patch } : mapping));

  async function attach() {
    const validMappings = form.mappings.filter((mapping) => mapping.emoji.trim() && mapping.roleId); if (!selectedMessage || !validMappings.length) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const payload = await api.request(`/api/reaction-roles/${guildId}/attach`, { method: 'POST', body: JSON.stringify({ name: form.name, channelId: selectedMessage.channelId, messageId: selectedMessage.id, mappings: validMappings.map((mapping) => ({ ...mapping, removeOnUnreact: mapping.mode === 'toggle' })) }) });
      setConfig(payload.config || config); setNotice(`Attached ${validMappings.length} reaction role(s) without changing the message.`); setSelectedMessage(null); setResults([]); setForm({ name: 'Reaction Roles', mappings: [newMapping()] }); await load();
    } catch (saveError) { setError(saveError.message || 'Failed to attach Reaction Roles.'); } finally { setLoading(false); }
  }

  async function call(path, options, successText) { setLoading(true); setError(''); try { await api.request(path, options); if (successText) setNotice(successText); await load(); } catch (actionError) { setError(actionError.message || 'Reaction Roles action failed.'); } finally { setLoading(false); } }
  const toggleEnabled = () => call(`/api/reaction-roles/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: config.enabled === false }) }, `Reaction Roles ${config.enabled === false ? 'enabled' : 'disabled'}.`);
  const repair = (panelId = null) => call(panelId ? `/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panelId)}/repair` : `/api/reaction-roles/${guildId}/repair`, { method: 'POST' }, panelId ? 'Message reactions repaired.' : 'All tracked messages checked and repaired.');
  const togglePanel = (panel) => call(`/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panel.panelId)}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: panel.enabled === false }) }, `${panel.name} ${panel.enabled === false ? 'enabled' : 'disabled'}.`);

  function beginEditing(panel) { setEditingPanelId(panel.panelId); setEditingMappings((panel.mappings || []).map(copyMapping)); setError(''); setNotice(''); }
  async function saveEditing(panel) {
    const valid = editingMappings.filter((mapping) => mapping.emoji.trim() && mapping.roleId); if (!valid.length) return setError('Add at least one complete emoji-to-role mapping.');
    await call(`/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panel.panelId)}`, { method: 'PUT', body: JSON.stringify({ mappings: valid.map((mapping) => ({ ...mapping, removeOnUnreact: mapping.mode === 'toggle' })) }) }, `${panel.name} mappings updated and reactions synchronised.`); setEditingPanelId(''); setEditingMappings([]);
  }
  function duplicateIntoBuilder(panel) { setForm({ name: `${panel.name} Copy`, mappings: (panel.mappings || []).map((mapping) => ({ ...copyMapping(mapping), mappingId: undefined })) }); setSelectedMessage(null); setResults([]); setNotice('Mappings copied. Find and select the destination message.'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  async function removeDeployment(panel, action) { const labels = { detach: 'detach this deployment', clear: 'detach it and remove Goliath reactions', delete: 'delete the Goliath-created message' }; if (!window.confirm(`Are you sure you want to ${labels[action]}?`)) return; await call(`/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panel.panelId)}?action=${action}`, { method: 'DELETE' }, action === 'delete' ? 'Deployment message deleted.' : action === 'clear' ? 'Deployment detached and reactions removed.' : 'Deployment detached.'); }

  if (!guildId) return <PageShell title="Reaction Roles" subtitle="Attach self-service roles to any Discord message." theme={theme}><EmptyState theme={theme} text="Select a server first." /></PageShell>;
  return <PageShell title="Reaction Roles" subtitle="Find any accessible message or embed and attach emoji-to-role functions without replacing its content." theme={theme} guild={{ id: guildId, name: 'Reaction Roles' }} actions={<SecondaryButton theme={theme} onClick={toggleEnabled} disabled={loading}>{config.enabled === false ? 'Enable' : 'Disable'}</SecondaryButton>}>
    {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}{notice ? <Notice theme={theme} tone="success">{notice}</Notice> : null}{loading ? <LoadingPanel theme={theme} text="Updating Reaction Roles..." /> : null}
    <StatGrid min="min(180px,100%)"><SummaryStat theme={theme} label="Status" value={config.enabled === false ? 'Disabled' : 'Enabled'} accent={config.enabled === false ? '#f59e0b' : '#22c55e'} /><SummaryStat theme={theme} label="Messages" value={panels.length} accent="#3b82f6" /><SummaryStat theme={theme} label="Mappings" value={mappings.length} accent="#a855f7" /><SummaryStat theme={theme} label="Health" value={health.healthy ? 'Healthy' : 'Attention'} accent={health.healthy ? '#22c55e' : '#ef4444'} /><SummaryStat theme={theme} label="Roles Added" value={config.analytics?.assigned || 0} accent="#22c55e" /><SummaryStat theme={theme} label="Roles Removed" value={config.analytics?.removed || 0} accent="#f59e0b" /><SummaryStat theme={theme} label="Failures" value={config.analytics?.failed || 0} accent="#ef4444" /></StatGrid>

    <SectionCard theme={theme} title="1. Find a Message" subtitle="Search one channel or the entire guild, then inspect the real Discord-style preview before selecting it."><div style={{ display: 'grid', gap: 12 }}><ChannelSelect theme={theme} resources={channels} value={filters.channelId} onChange={(value) => setFilters({ ...filters, channelId: value || '' })} label="Channel (optional)" /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}><input style={inputStyle(theme)} value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Contains text" /><input style={inputStyle(theme)} value={filters.messageId} onChange={(event) => setFilters({ ...filters, messageId: event.target.value })} placeholder="Exact message ID" /><input style={inputStyle(theme)} value={filters.authorId} onChange={(event) => setFilters({ ...filters, authorId: event.target.value })} placeholder="Author ID" /></div><div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: theme.mutedText }}><label><input type="checkbox" checked={filters.embedsOnly} onChange={(event) => setFilters({ ...filters, embedsOnly: event.target.checked })} /> Embeds only</label><label><input type="checkbox" checked={filters.botsOnly} onChange={(event) => setFilters({ ...filters, botsOnly: event.target.checked })} /> Bot messages only</label><label><input type="checkbox" checked={filters.pinnedOnly} onChange={(event) => setFilters({ ...filters, pinnedOnly: event.target.checked })} /> Pinned only</label></div><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><ActionButton theme={theme} onClick={() => searchMessages()} disabled={searching}>{searching ? 'Searching…' : 'Search Messages'}</ActionButton><ActionButton theme={theme} onClick={() => { setResults([]); setSelectedMessage(null); setFilters({ channelId: '', query: '', messageId: '', authorId: '', botsOnly: false, embedsOnly: false, pinnedOnly: false }); }}>Clear Search</ActionButton></div><div style={{ display: 'grid', gap: 12 }}>{results.map((message) => <MessageCard key={`${message.channelId}:${message.id}`} theme={theme} message={message} selected={selectedMessage?.id === message.id && selectedMessage?.channelId === message.channelId} onSelect={setSelectedMessage} />)}</div></div></SectionCard>

    <SectionCard theme={theme} title="2. Attach Reaction Roles" subtitle={selectedMessage ? `Selected message in #${selectedMessage.channelName || selectedMessage.channelId}.` : 'Select a message above first.'}><div style={{ display: 'grid', gap: 12 }}>{selectedMessage ? <DiscordMessagePreview theme={theme} message={selectedMessage} /> : null}<input style={inputStyle(theme)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tracking name" /><MappingEditor theme={theme} mappings={form.mappings} roles={roles} onChange={updateFormMapping} onRemove={(index) => setForm((current) => ({ ...current, mappings: current.mappings.filter((_, i) => i !== index) }))} /><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><ActionButton theme={theme} onClick={() => setForm((current) => ({ ...current, mappings: [...current.mappings, newMapping()] }))}>+ Add Emoji → Role</ActionButton><ActionButton theme={theme} success onClick={attach} disabled={loading || !selectedMessage || !form.mappings.some((mapping) => mapping.emoji.trim() && mapping.roleId)}>Attach to Selected Message</ActionButton></div></div></SectionCard>

    <SectionCard theme={theme} title="Tracked Messages" subtitle="Preview, edit, duplicate, repair, disable or detach each deployment."><div style={{ display: 'grid', gap: 12 }}>{panels.length ? panels.map((panel) => { const panelHealth = health.panels?.find((item) => item.panelId === panel.panelId); const isEditing = editingPanelId === panel.panelId; const preview = previewByPanel[panel.panelId]; return <div key={panel.panelId} style={{ border: `1px solid ${panelHealth?.healthy === false ? '#ef4444' : theme.cardBorder}`, borderRadius: 18, padding: 16, display: 'grid', gap: 12, background: panel.enabled === false ? 'rgba(245,158,11,.06)' : 'rgba(15,23,42,.22)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong style={{ fontSize: 17 }}>{panel.name}</strong><div style={{ color: theme.mutedText, marginTop: 4 }}>{panel.enabled === false ? 'Disabled' : panelHealth?.healthy === false ? 'Needs attention' : 'Healthy'} · {panel.source === 'template' ? 'Goliath-created message' : 'Existing message'}</div></div><a href={`https://discord.com/channels/${guildId}/${panel.channelId}/${panel.messageId}`} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontWeight: 900, textDecoration: 'none' }}>Open in Discord ↗</a></div><div style={{ color: theme.mutedText, fontSize: 13 }}>Channel: {panel.channelId} · Message: {panel.messageId}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(panel.mappings || []).map((mapping) => <span key={mapping.mappingId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 999, padding: '6px 10px', color: mapping.enabled === false ? theme.mutedText : theme.cardText }}>{mapping.emoji} → {roles.find((role) => String(role.id) === String(mapping.roleId))?.name || mapping.label || mapping.roleId}</span>)}</div>{panelHealth?.issues?.length ? <div style={{ color: '#fca5a5', fontWeight: 800 }}>{panelHealth.issues.join(' · ')}</div> : null}{preview?.missing ? <Notice theme={theme} tone="danger">The tracked message could not be loaded.</Notice> : preview ? <DiscordMessagePreview theme={theme} message={preview} /> : null}{isEditing ? <div style={{ borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 12, display: 'grid', gap: 10 }}><h3 style={{ margin: 0 }}>Edit mappings</h3><MappingEditor theme={theme} mappings={editingMappings} roles={roles} onChange={updateEditingMapping} onRemove={(index) => setEditingMappings((current) => current.filter((_, i) => i !== index))} /><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><ActionButton theme={theme} onClick={() => setEditingMappings((current) => [...current, newMapping()])}>+ Add Mapping</ActionButton><ActionButton theme={theme} success onClick={() => saveEditing(panel)} disabled={loading}>Save & Sync</ActionButton><ActionButton theme={theme} onClick={() => { setEditingPanelId(''); setEditingMappings([]); }}>Cancel</ActionButton></div></div> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><ActionButton theme={theme} onClick={() => previewPanel(panel)} disabled={searching}>{preview ? 'Hide Preview' : 'Preview'}</ActionButton><ActionButton theme={theme} onClick={() => beginEditing(panel)} disabled={loading}>Edit</ActionButton><ActionButton theme={theme} onClick={() => repair(panel.panelId)} disabled={loading || panel.enabled === false}>Repair</ActionButton><ActionButton theme={theme} onClick={() => duplicateIntoBuilder(panel)} disabled={loading}>Duplicate</ActionButton><ActionButton theme={theme} onClick={() => togglePanel(panel)} disabled={loading}>{panel.enabled === false ? 'Enable' : 'Disable'}</ActionButton><ActionButton theme={theme} danger onClick={() => removeDeployment(panel, 'detach')} disabled={loading}>Detach</ActionButton><ActionButton theme={theme} danger onClick={() => removeDeployment(panel, 'clear')} disabled={loading}>Detach + Clear</ActionButton>{panel.source === 'template' ? <ActionButton theme={theme} danger onClick={() => removeDeployment(panel, 'delete')} disabled={loading}>Delete Message</ActionButton> : null}</div>}</div>; }) : <EmptyState theme={theme} text="No messages attached yet." />}</div></SectionCard>

    <SectionCard theme={theme} title="Maintenance" subtitle="Re-add missing reactions and re-check tracked messages, roles and templates."><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><ActionButton theme={theme} onClick={() => repair()} disabled={loading}>Repair All</ActionButton><a href={`/api/reaction-roles/${guildId}/export`} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(59,130,246,.14)', color: theme.cardText, borderRadius: 12, padding: '10px 13px', fontWeight: 900, textDecoration: 'none' }}>Export JSON</a></div></SectionCard>
  </PageShell>;
}