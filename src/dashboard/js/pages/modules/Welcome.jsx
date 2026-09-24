import React, { useEffect, useMemo, useState } from 'react';

import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect } from '../../ui/DiscordResourceSelects.jsx';

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
  const colors = { primary: 'rgba(37,99,235,0.22)', success: 'rgba(22,163,74,0.22)', danger: 'rgba(220,38,38,0.22)', default: 'rgba(15,23,42,0.45)' };
  return { border: `1px solid ${theme.cardBorder}`, background: colors[tone] || colors.default, color: theme.cardText, borderRadius: 14, padding: '11px 14px', fontWeight: 950, cursor: 'pointer' };
}
function fieldStyle(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px', fontWeight: 800, width: '100%' };
}
function Stat({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.32)', borderRadius: 18, padding: 16 }}>
    <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ marginTop: 7, color: theme.cardText, fontSize: 27, fontWeight: 950 }}>{value}</div>
    {hint ? <div style={{ marginTop: 3, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}
  </div>;
}
function PreviewMessage({ theme, title, payload }) {
  if (!payload) return null;
  return <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, background: 'rgba(15,23,42,0.32)', display: 'grid', gap: 10 }}>
    <strong>{title}</strong>
    {payload.content ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{payload.content}</div> : null}
    {(payload.embeds || []).map((embed, index) => <div key={index} style={{ borderLeft: `4px solid ${embed.color ? `#${Number(embed.color).toString(16).padStart(6, '0')}` : '#5865f2'}`, background: 'rgba(2,6,23,0.48)', borderRadius: 8, padding: 14, display: 'grid', gap: 7 }}>
      {embed.author?.name ? <div style={{ fontSize: 12, fontWeight: 850 }}>{embed.author.name}</div> : null}
      {embed.title ? <strong style={{ fontSize: 16 }}>{embed.title}</strong> : null}
      {embed.description ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{embed.description}</div> : null}
      {(embed.fields || []).map((field, fieldIndex) => <div key={fieldIndex}><strong>{field.name}</strong><div style={{ whiteSpace: 'pre-wrap', color: theme.mutedText }}>{field.value}</div></div>)}
      {embed.footer?.text ? <div style={{ color: theme.mutedText, fontSize: 11 }}>{embed.footer.text}</div> : null}
    </div>)}
  </div>;
}

export default function Welcome({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState(null);
  const [scheduled, setScheduled] = useState(null);
  const [overview, setOverview] = useState({});
  const [templates, setTemplates] = useState([]);
  const [binding, setBinding] = useState(null);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [queue, setQueue] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const card = useMemo(() => ({ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, boxShadow: theme.shadow, padding: 22 }), [theme]);
  const analytics = overview.analytics || config?.analytics || {};
  const health = overview.health || null;
  const scheduledHealth = overview.scheduledHealth || null;
  const messageSource = overview.messageSource || config?.messageSource || 'preset';
  const dmMessageSource = overview.dmMessageSource || config?.dmMessageSource || 'inherit';
  const activeTemplateId = binding?.templateId || overview.templateId || config?.templateId || 'welcome_default';
  const activeTemplate = templates.find((template) => String(template.templateId) === String(activeTemplateId)) || binding || null;
  const dmTemplateId = overview.dmTemplateId || config?.dmTemplateId || (dmMessageSource === 'inherit' ? activeTemplateId : 'dm_welcome_default');
  const dmTemplate = templates.find((template) => String(template.templateId) === String(dmTemplateId)) || null;
  const selectedRoleIds = Array.isArray(config?.mentionRoleIds) ? config.mentionRoleIds : [];
  const selectableRoles = roles.filter((role) => String(role.id) !== String(guildId) && role.managed !== true);

  async function load() {
    if (!guildId) return;
    setBusy('load'); setError('');
    try {
      const [payload, channelPayload, rolePayload] = await Promise.all([
        api.request(`/api/welcome/${guildId}/overview`), api.getGuildChannels(guildId), api.getGuildRoles(guildId),
      ]);
      setConfig(payload.config || {}); setScheduled(payload.scheduled || {}); setOverview(payload.overview || {});
      setTemplates(Array.isArray(payload.templates) ? payload.templates : []); setBinding(payload.binding || null);
      setChannels(normalizeList(channelPayload, 'channels')); setRoles(normalizeList(rolePayload, 'roles'));
    } catch (loadError) { setError(loadError.message || 'Failed to load Welcome.'); }
    finally { setBusy(''); }
  }
  useEffect(() => { setPreview(null); load(); }, [guildId]);

  async function act(name, fn, successText) {
    setBusy(name); setError(''); setNotice('');
    try {
      const result = await fn();
      if (result?.config) setConfig(result.config); if (result?.scheduled) setScheduled(result.scheduled);
      if (result?.overview) setOverview(result.overview); if (result?.templates) setTemplates(result.templates);
      if (result?.binding) setBinding(result.binding); if (successText) setNotice(successText);
      await load(); return result;
    } catch (actionError) { setError(actionError.message || 'Welcome action failed.'); return null; }
    finally { setBusy(''); }
  }
  async function saveInstant(patch, message = 'Instant Welcome settings saved.') {
    setPreview(null); setConfig({ ...(config || {}), ...patch });
    return act('instant', () => api.request(`/api/welcome/${guildId}/config`, { method: 'PUT', body: JSON.stringify(patch) }), message);
  }
  async function saveScheduled(patch, message = 'Scheduled Welcome settings saved.') {
    setScheduled({ ...(scheduled || {}), ...patch });
    return act('scheduled', () => api.request(`/api/welcome/${guildId}/scheduled`, { method: 'PUT', body: JSON.stringify(patch) }), message);
  }
  async function setMessageSource(source, templateId = '') {
    setPreview(null);
    return act('messageSource', () => api.request(`/api/welcome/${guildId}/message-source`, { method: 'POST', body: JSON.stringify({ slot: 'welcome', source, templateId }) }), source === 'preset' ? 'Welcome preset selected.' : 'Welcome message source updated.');
  }
  async function setDmMessageSource(source, templateId = '') {
    setPreview(null);
    return act('dmMessageSource', () => api.request(`/api/welcome/${guildId}/message-source`, { method: 'POST', body: JSON.stringify({ slot: 'dm_welcome', source, templateId }) }), source === 'inherit' ? 'DM now uses the Public Welcome message.' : source === 'preset' ? 'DM Welcome preset selected.' : 'DM Welcome message source updated.');
  }
  async function previewWelcome() {
    setBusy('preview'); setError(''); setNotice('');
    try {
      const result = await api.request(`/api/welcome/${guildId}/preview`, { method: 'POST', body: JSON.stringify({ userId: selectedGuildData?.userId }) });
      setPreview(result.preview || null); setNotice('Private Welcome preview generated. Nothing was posted to Discord.');
    } catch (previewError) { setError(previewError.message || 'Failed to generate Welcome preview.'); }
    finally { setBusy(''); }
  }
  async function previewQueue() {
    setBusy('queue'); setError('');
    try { const result = await api.request(`/api/welcome/${guildId}/scheduled/queue`); setQueue(Array.isArray(result.members) ? result.members : []); setNotice(`Scheduled Welcome queue contains ${result.count || 0} member(s).`); }
    catch (queueError) { setError(queueError.message || 'Failed to load queue.'); } finally { setBusy(''); }
  }
  async function resetModule() {
    if (!window.confirm('Reset Instant and Scheduled Welcome settings and analytics?')) return;
    await act('reset', () => api.request(`/api/welcome/${guildId}/reset`, { method: 'POST' }), 'Welcome reset to defaults.'); setQueue([]); setPreview(null);
  }

  if (!guildId) return <EmptyState theme={theme} icon="👋" title="Select a server" description="Select a server to manage Welcome." />;

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={{ ...card, background: 'linear-gradient(135deg, rgba(52,211,153,0.18), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.14))' }}>
      <div style={{ color: '#86efac', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Goliath Message Studio</div>
      <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px,4vw,42px)' }}>Welcome</h1>
      <p style={{ color: theme.mutedText, lineHeight: 1.6 }}>Choose when Welcome runs and which saved message it delivers. Embed Studio remains the source for full message design.</p>
    </section>
    {(error || notice) ? <section style={{ ...card, color: error ? '#fca5a5' : '#86efac', fontWeight: 850 }}>{error || notice}</section> : null}
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}>
      <Stat theme={theme} label="Welcome" value={overview.enabled || config?.enabled ? 'Enabled' : 'Disabled'} />
      <Stat theme={theme} label="Instant Sent" value={analytics.publicSent || 0} hint={`${analytics.dmSent || 0} DM`} />
      <Stat theme={theme} label="Message Source" value={messageSource === 'embedStudio' ? 'Embed Studio' : messageSource === 'custom' ? 'Custom' : 'Preset'} />
      <Stat theme={theme} label="Scheduled" value={scheduled?.enabled ? 'Enabled' : 'Disabled'} hint={`${scheduledHealth?.waitingMembers || 0} waiting`} />
      <Stat theme={theme} label="Instant Health" value={health?.healthy ? 'Healthy' : 'Attention'} />
      <Stat theme={theme} label="Scheduled Health" value={scheduledHealth?.healthy ? 'Healthy' : 'Attention'} />
    </section>

    <section style={{ ...card, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>⚡ Instant Welcome</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Runs immediately from the Discord member-join event.</p></div>
        <button type="button" disabled={busy} onClick={() => saveInstant({ enabled: !(overview.enabled || config?.enabled) }, overview.enabled || config?.enabled ? 'Welcome disabled.' : 'Welcome enabled.')} style={buttonStyle(theme, 'primary')}>{overview.enabled || config?.enabled ? 'Disable Welcome' : 'Enable Welcome'}</button>
      </div>
      <ChannelSelect theme={theme} resources={channels} value={config?.channelId || ''} onChange={(value) => saveInstant({ channelId: value || null })} label="Instant Welcome Channel" />

      <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 18, padding: 16, display: 'grid', gap: 14 }}>
        <div><strong>💬 Welcome Message</strong><div style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>Choose where the message comes from. Every option uses the same shared delivery renderer.</div></div>
        <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Message Source</span>
          <select value={messageSource} onChange={(event) => {
            const source = event.target.value;
            if (source === 'embedStudio') {
              const first = templates.find((template) => !['welcome_default', 'dm_welcome_default'].includes(String(template.templateId)));
              if (!first) { setError('Create or save an Embed Studio message first.'); return; }
              setMessageSource('embedStudio', activeTemplateId !== 'welcome_default' ? activeTemplateId : first.templateId);
            } else if (source === 'preset') setMessageSource('preset');
            else setError('Custom Welcome editor is the next implementation stage. Use Embed Studio or Preset for now.');
          }} disabled={busy} style={fieldStyle(theme)}>
            <option value="embedStudio">💎 Embed Studio</option><option value="preset">📦 Welcome Preset</option><option value="custom">🛠 Custom Welcome</option>
          </select>
        </label>
        {messageSource === 'embedStudio' ? <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Saved Message</span>
          <select value={activeTemplateId} onChange={(event) => setMessageSource('embedStudio', event.target.value)} disabled={busy || templates.length === 0} style={fieldStyle(theme)}>
            {templates.length === 0 ? <option value="">No Embed Studio messages found</option> : null}
            {templates.filter((template) => String(template.templateId) !== 'dm_welcome_default').map((template) => <option key={template.templateId} value={template.templateId}>{template.name || template.templateId}</option>)}
          </select>
        </label> : null}
        {messageSource === 'preset' ? <div style={{ color: theme.mutedText }}><strong style={{ color: theme.cardText }}>📦 Goliath Welcome Preset</strong><br />Uses the built-in Welcome preset through the same canonical renderer.</div> : null}
        {messageSource === 'custom' ? <div style={{ color: '#fbbf24', fontWeight: 850 }}>🛠 Custom Welcome is reserved for the simplified Welcome editor. Existing custom bindings remain safe.</div> : null}
        {activeTemplate ? <div><span style={{ color: theme.mutedText, fontSize: 12 }}>ACTIVE MESSAGE</span><div style={{ marginTop: 4, fontWeight: 950 }}>{activeTemplate.name || activeTemplate.templateId}</div></div> : null}
      </div>

      <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 18, padding: 16, display: 'grid', gap: 14 }}>
        <div><strong>📨 Direct Message</strong><div style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>Choose whether DM Welcome follows the Public Welcome or uses its own message.</div></div>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.dmEnabled === true} onChange={(event) => saveInstant({ dmEnabled: event.target.checked })} /> Send DM Welcome</label>
        <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>DM Message Source</span>
          <select value={dmMessageSource} onChange={(event) => {
            const source = event.target.value;
            if (source === 'inherit') setDmMessageSource('inherit');
            else if (source === 'preset') setDmMessageSource('preset');
            else if (source === 'embedStudio') {
              const first = templates.find((template) => !['welcome_default', 'dm_welcome_default'].includes(String(template.templateId)));
              if (!first) { setError('Create or save an Embed Studio message first.'); return; }
              const current = templates.find((template) => String(template.templateId) === String(dmTemplateId));
              setDmMessageSource('embedStudio', current && !['welcome_default', 'dm_welcome_default'].includes(String(current.templateId)) ? current.templateId : first.templateId);
            } else setError('Custom Welcome editor is the next implementation stage. Use Same as Public, Embed Studio or Preset for now.');
          }} disabled={busy} style={fieldStyle(theme)}>
            <option value="inherit">↩ Same as Public</option><option value="embedStudio">💎 Embed Studio</option><option value="preset">📦 Welcome Preset</option><option value="custom">🛠 Custom Welcome</option>
          </select>
        </label>
        {dmMessageSource === 'embedStudio' ? <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>DM Saved Message</span>
          <select value={dmTemplateId} onChange={(event) => setDmMessageSource('embedStudio', event.target.value)} disabled={busy || templates.length === 0} style={fieldStyle(theme)}>
            {templates.length === 0 ? <option value="">No Embed Studio messages found</option> : null}
            {templates.filter((template) => !['welcome_default', 'dm_welcome_default'].includes(String(template.templateId))).map((template) => <option key={template.templateId} value={template.templateId}>{template.name || template.templateId}</option>)}
          </select>
        </label> : null}
        {dmMessageSource === 'inherit' ? <div style={{ color: theme.mutedText }}><strong style={{ color: theme.cardText }}>↩ Same as Public Welcome</strong><br />Future Public Welcome message changes automatically apply to DM Welcome too.</div> : null}
        {dmMessageSource === 'preset' ? <div style={{ color: theme.mutedText }}><strong style={{ color: theme.cardText }}>📦 Goliath DM Welcome Preset</strong><br />Uses the built-in DM-specific preset through the shared renderer.</div> : null}
        {dmMessageSource === 'custom' ? <div style={{ color: '#fbbf24', fontWeight: 850 }}>🛠 Custom DM Welcome is reserved for the simplified Welcome editor. Existing custom bindings remain safe.</div> : null}
        <div><span style={{ color: theme.mutedText, fontSize: 12 }}>ACTIVE DM MESSAGE</span><div style={{ marginTop: 4, fontWeight: 950 }}>{dmMessageSource === 'inherit' ? `Same as Public · ${activeTemplate?.name || activeTemplateId}` : overview.dmTemplateName || dmTemplate?.name || dmTemplateId || 'Not set'}</div></div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.allowUserPing !== false} onChange={(event) => saveInstant({ allowUserPing: event.target.checked })} /> Ping new member</label>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.allowRolePings === true} disabled={selectedRoleIds.length === 0} onChange={(event) => saveInstant({ allowRolePings: event.target.checked })} /> Ping selected roles</label>
        <label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={config?.ignoreBots !== false} onChange={(event) => saveInstant({ ignoreBots: event.target.checked })} /> Ignore bots</label>
      </div>
      <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Instant Notification Roles</span>
        <select multiple size={Math.min(8, Math.max(4, selectableRoles.length))} value={selectedRoleIds} onChange={(event) => { const mentionRoleIds = Array.from(event.target.selectedOptions).map((option) => option.value).slice(0, 10); saveInstant({ mentionRoleIds, ...(mentionRoleIds.length === 0 ? { allowRolePings: false } : {}) }, 'Instant notification roles saved.'); }} disabled={busy || selectableRoles.length === 0} style={{ ...fieldStyle(theme), minHeight: 120 }}>
          {selectableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={previewWelcome} style={buttonStyle(theme, 'primary')}>{busy === 'preview' ? 'Generating Preview...' : 'Preview'}</button>
        <button type="button" disabled={busy || (!config?.channelId && !config?.dmEnabled)} onClick={() => act('test', () => api.request(`/api/welcome/${guildId}/test`, { method: 'POST', body: JSON.stringify({ userId: selectedGuildData?.userId }) }), 'Test Welcome delivered.')} style={buttonStyle(theme, 'success')}>Send Test</button>
        <button type="button" disabled={busy} onClick={() => act('repair', () => api.request(`/api/welcome/${guildId}/repair`, { method: 'POST' }), 'Welcome configuration repaired.')} style={buttonStyle(theme, 'primary')}>Repair All</button>
      </div>
      {preview ? <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 18, padding: 16, display: 'grid', gap: 12 }}><div><strong>👁 Private Preview</strong><div style={{ color: theme.mutedText, fontSize: 12, marginTop: 4 }}>Rendered in the dashboard only. No Discord message or DM is sent, and analytics are untouched.</div></div><PreviewMessage theme={theme} title="Public Welcome" payload={preview.public} /><PreviewMessage theme={theme} title="DM Welcome" payload={preview.dm} /></div> : null}
    </section>

    <section style={{ ...card, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>📅 Scheduled Welcome</h2><p style={{ margin: '6px 0 0', color: theme.mutedText }}>Finds members by queue role, welcomes them in safe batches, then removes that role after successful delivery.</p></div><button type="button" disabled={busy || (!scheduled?.queueRoleId || !scheduled?.channelId)} onClick={() => saveScheduled({ enabled: !scheduled?.enabled }, scheduled?.enabled ? 'Scheduled Welcome disabled.' : 'Scheduled Welcome enabled.')} style={buttonStyle(theme, scheduled?.enabled ? 'default' : 'success')}>{scheduled?.enabled ? 'Disable Scheduled' : 'Enable Scheduled'}</button></div>
      <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Welcome Queue Role</span><select value={scheduled?.queueRoleId || ''} onChange={(event) => saveScheduled({ queueRoleId: event.target.value || null, completedMemberIds: [] })} style={fieldStyle(theme)}><option value="">Select a role</option>{selectableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <ChannelSelect theme={theme} resources={channels} value={scheduled?.channelId || ''} onChange={(value) => saveScheduled({ channelId: value || null })} label="Scheduled Welcome Channel" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}><label style={{ display: 'grid', gap: 7 }}><span style={{ color: theme.mutedText, fontWeight: 850 }}>Daily time</span><input value={scheduled?.time || '19:00'} onChange={(event) => setScheduled({ ...(scheduled || {}), time: event.target.value })} onBlur={(event) => saveScheduled({ time: event.target.value })} placeholder="19:00" style={fieldStyle(theme)} /></label><label style={{ display: 'grid', gap: 7 }}><span style={{ color: theme.mutedText, fontWeight: 850 }}>Timezone</span><input value={scheduled?.timezone || 'Europe/London'} onChange={(event) => setScheduled({ ...(scheduled || {}), timezone: event.target.value })} onBlur={(event) => saveScheduled({ timezone: event.target.value })} placeholder="Europe/London" style={fieldStyle(theme)} /></label></div>
      <label style={{ display: 'grid', gap: 8 }}><span style={{ color: theme.mutedText, fontWeight: 850 }}>Scheduled message</span><textarea value={scheduled?.message || ''} onChange={(event) => setScheduled({ ...(scheduled || {}), message: event.target.value })} onBlur={(event) => saveScheduled({ message: event.target.value })} rows={6} maxLength={1800} style={fieldStyle(theme)} /><span style={{ color: theme.mutedText, fontSize: 12 }}>Variables: {'{members}'} {'{memberNames}'} {'{memberCount}'} {'{server}'} {'{role}'} {'{date}'}</span></label>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={scheduled?.pingMembers !== false} onChange={(event) => saveScheduled({ pingMembers: event.target.checked })} /> Ping members</label><label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={scheduled?.removeQueueRole !== false} onChange={(event) => saveScheduled({ removeQueueRole: event.target.checked })} /> Remove queue role after send</label><label style={{ color: theme.mutedText, fontWeight: 850 }}><input type="checkbox" checked={scheduled?.ignoreBots !== false} onChange={(event) => saveScheduled({ ignoreBots: event.target.checked })} /> Ignore bots</label></div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" disabled={busy} onClick={previewQueue} style={buttonStyle(theme)}>Preview Queue</button><button type="button" disabled={busy || !scheduled?.queueRoleId || !scheduled?.channelId} onClick={() => act('run', () => api.request(`/api/welcome/${guildId}/scheduled/run`, { method: 'POST' }), 'Scheduled Welcome run complete.')} style={buttonStyle(theme, 'success')}>Run Now</button><button type="button" disabled={busy} onClick={() => act('scheduledRepair', () => api.request(`/api/welcome/${guildId}/scheduled/repair`, { method: 'POST' }), 'Scheduled Welcome repaired.')} style={buttonStyle(theme, 'primary')}>Repair Scheduled</button></div>
      {queue.length ? <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14 }}><strong>Waiting members ({queue.length})</strong><div style={{ marginTop: 8, color: theme.mutedText }}>{queue.slice(0, 50).map((member) => member.displayName || member.username).join(', ')}</div></div> : null}
      <div style={{ color: scheduledHealth?.healthy ? '#86efac' : '#fbbf24', fontWeight: 850 }}>{scheduledHealth?.healthy ? '✅ Scheduled Welcome is healthy.' : `⚠ ${(scheduledHealth?.issues || []).join(' · ') || 'Scheduled Welcome needs attention.'}`}</div>
    </section>
    <section style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap' }}><a href={`/api/welcome/${guildId}/export`} style={{ ...buttonStyle(theme), textDecoration: 'none' }}>Export Welcome JSON</a><button type="button" disabled={busy} onClick={resetModule} style={buttonStyle(theme, 'danger')}>Reset All Welcome</button><button type="button" disabled={busy === 'load'} onClick={load} style={buttonStyle(theme)}>{busy === 'load' ? 'Refreshing...' : 'Refresh'}</button></section>
  </div>;
}