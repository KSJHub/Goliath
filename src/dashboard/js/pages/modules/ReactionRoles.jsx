import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import PageShell, { SectionCard, EmptyState, LoadingPanel, Notice, SecondaryButton, StatGrid, SummaryStat } from '../../shared/PageShell';

function getGuildId(selectedGuild, selectedGuildData) {
  const id = selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '';
  return String(id).split(':').pop().trim();
}

function inputStyle(theme) {
  return {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.38)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '11px 12px',
  };
}

function ActionButton({ theme, children, danger = false, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        border: `1px solid ${danger ? '#ef4444' : theme.cardBorder}`,
        background: danger ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)',
        color: danger ? '#fca5a5' : theme.cardText,
        borderRadius: 12,
        padding: '10px 13px',
        fontWeight: 900,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function ReactionRoles({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState({ enabled: true, panels: {}, analytics: {} });
  const [health, setHealth] = useState({ healthy: true, panels: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    name: 'Reaction Roles',
    messageReference: '',
    emoji: '⭐',
    roleId: '',
    mode: 'toggle',
  });

  const panels = useMemo(() => Object.values(config.panels || {}), [config]);
  const mappings = useMemo(() => panels.flatMap((panel) => panel.mappings || []), [panels]);

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const payload = await api.request(`/api/reaction-roles/${guildId}/overview`);
      setConfig(payload.config || { enabled: true, panels: {}, analytics: {} });
      setHealth(payload.health || { healthy: true, panels: [] });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Reaction Roles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function attach() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const payload = await api.request(`/api/reaction-roles/${guildId}/attach`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          messageReference: form.messageReference,
          mappings: [{
            emoji: form.emoji,
            roleId: form.roleId,
            mode: form.mode,
            removeOnUnreact: form.mode === 'toggle',
            enabled: true,
          }],
        }),
      });
      setConfig(payload.config || config);
      setNotice('Reaction Role attached. The existing message content was not changed.');
      setForm((current) => ({ ...current, messageReference: '', roleId: '' }));
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Failed to attach Reaction Role.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled() {
    setLoading(true);
    try {
      const payload = await api.request(`/api/reaction-roles/${guildId}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: config.enabled === false }),
      });
      setConfig(payload.config || config);
      setNotice(`Reaction Roles ${config.enabled === false ? 'enabled' : 'disabled'}.`);
    } catch (saveError) { setError(saveError.message); }
    finally { setLoading(false); }
  }

  async function repair(panelId = null) {
    setLoading(true);
    setError('');
    try {
      const path = panelId
        ? `/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panelId)}/repair`
        : `/api/reaction-roles/${guildId}/repair`;
      await api.request(path, { method: 'POST' });
      setNotice(panelId ? 'Message reactions repaired.' : 'All tracked messages checked and repaired.');
      await load();
    } catch (repairError) { setError(repairError.message); }
    finally { setLoading(false); }
  }

  async function detach(panelId, clearReactions = false) {
    setLoading(true);
    setError('');
    try {
      await api.request(`/api/reaction-roles/${guildId}/panels/${encodeURIComponent(panelId)}?clearReactions=${clearReactions}`, { method: 'DELETE' });
      setNotice('Reaction-role function detached. The original message was not deleted or edited.');
      await load();
    } catch (detachError) { setError(detachError.message); }
    finally { setLoading(false); }
  }

  if (!guildId) {
    return <PageShell title="Reaction Roles" subtitle="Attach self-service roles to any Discord message." theme={theme}><EmptyState theme={theme} text="Select a server first." /></PageShell>;
  }

  return (
    <PageShell
      title="Reaction Roles"
      subtitle="Attach emoji-to-role functions to any existing message or embed without replacing its content."
      theme={theme}
      guild={{ id: guildId, name: 'Reaction Roles' }}
      actions={<SecondaryButton theme={theme} onClick={toggleEnabled} disabled={loading}>{config.enabled === false ? 'Enable' : 'Disable'}</SecondaryButton>}
    >
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {notice ? <Notice theme={theme} tone="success">{notice}</Notice> : null}
      {loading ? <LoadingPanel theme={theme} text="Updating Reaction Roles..." /> : null}

      <StatGrid min="min(180px, 100%)">
        <SummaryStat theme={theme} label="Status" value={config.enabled === false ? 'Disabled' : 'Enabled'} accent={config.enabled === false ? '#f59e0b' : '#22c55e'} />
        <SummaryStat theme={theme} label="Messages" value={panels.length} accent="#3b82f6" />
        <SummaryStat theme={theme} label="Mappings" value={mappings.length} accent="#a855f7" />
        <SummaryStat theme={theme} label="Health" value={health.healthy ? 'Healthy' : 'Attention'} accent={health.healthy ? '#22c55e' : '#ef4444'} />
        <SummaryStat theme={theme} label="Assigned" value={config.analytics?.assigned || 0} accent="#22c55e" />
      </StatGrid>

      <SectionCard theme={theme} title="Attach to Existing Message" subtitle="Paste a Discord message link. Goliath adds reactions and tracking only; it does not edit the message or embed.">
        <div style={{ display: 'grid', gap: 12 }}>
          <input style={inputStyle(theme)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tracking name" />
          <input style={inputStyle(theme)} value={form.messageReference} onChange={(event) => setForm({ ...form, messageReference: event.target.value })} placeholder="https://discord.com/channels/server/channel/message" />
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 0.4fr) 1fr minmax(130px, 0.6fr)', gap: 10 }}>
            <input style={inputStyle(theme)} value={form.emoji} onChange={(event) => setForm({ ...form, emoji: event.target.value })} placeholder="Emoji" />
            <input style={inputStyle(theme)} value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })} placeholder="Role ID" />
            <select style={inputStyle(theme)} value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
              <option value="toggle">Add + remove on unreact</option>
              <option value="add">Add only</option>
              <option value="remove">Remove role</option>
            </select>
          </div>
          <div><ActionButton theme={theme} onClick={attach} disabled={loading || !form.messageReference || !form.emoji || !form.roleId}>Attach Reaction Role</ActionButton></div>
        </div>
      </SectionCard>

      <SectionCard theme={theme} title="Tracked Messages" subtitle="Repair or detach functionality without deleting the original Discord message.">
        <div style={{ display: 'grid', gap: 12 }}>
          {panels.length ? panels.map((panel) => {
            const panelHealth = health.panels?.find((item) => item.panelId === panel.panelId);
            return (
              <div key={panel.panelId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
                <div><strong style={{ color: theme.cardText }}>{panel.name}</strong> <span style={{ color: panelHealth?.healthy === false ? '#fca5a5' : '#86efac' }}>{panelHealth?.healthy === false ? 'Needs attention' : 'Healthy'}</span></div>
                <div style={{ color: theme.mutedText, fontSize: 13 }}>Channel: {panel.channelId} · Message: {panel.messageId} · {panel.mappings?.length || 0} mapping(s)</div>
                {panelHealth?.issues?.length ? <div style={{ color: '#fca5a5' }}>{panelHealth.issues.join(' · ')}</div> : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionButton theme={theme} onClick={() => repair(panel.panelId)} disabled={loading}>Repair</ActionButton>
                  <ActionButton theme={theme} danger onClick={() => detach(panel.panelId, false)} disabled={loading}>Detach</ActionButton>
                  <ActionButton theme={theme} danger onClick={() => detach(panel.panelId, true)} disabled={loading}>Detach + Remove Bot Reactions</ActionButton>
                </div>
              </div>
            );
          }) : <EmptyState theme={theme} text="No messages attached yet." />}
        </div>
      </SectionCard>

      <SectionCard theme={theme} title="Maintenance" subtitle="Re-add missing reactions and re-check messages and roles.">
        <ActionButton theme={theme} onClick={() => repair()} disabled={loading}>Repair All</ActionButton>
      </SectionCard>
    </PageShell>
  );
}
