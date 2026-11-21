import React, { useState } from 'react';

import { api } from '../../../services/apiClient';
import { EmptyState, DASHBOARD_EMOJIS as E } from '../../../shared/PageShell';

function inputStyle(theme) {
  return {
    width: '100%',
    minWidth: 0,
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.9)',
    color: theme.cardText,
    borderRadius: 10,
    padding: '9px 10px',
    outline: 'none',
    fontWeight: 850,
  };
}

function buttonStyle(theme, tone = 'normal') {
  const good = tone === 'good';
  const danger = tone === 'danger';
  return {
    border: danger ? '1px solid rgba(248,113,113,0.35)' : good ? '1px solid rgba(34,197,94,0.35)' : `1px solid ${theme.cardBorder}`,
    background: danger ? 'rgba(248,113,113,0.12)' : good ? 'rgba(34,197,94,0.12)' : theme.softBg,
    color: danger ? '#fca5a5' : good ? '#86efac' : theme.cardText,
    borderRadius: 10,
    padding: '9px 11px',
    fontWeight: 900,
    cursor: 'pointer',
  };
}

export default function TempVoiceControlCentre({ theme, guildId, channels = [], saving = false, onRefresh, onMessage, onError }) {
  const [drafts, setDrafts] = useState({});

  function draftFor(channel) {
    return drafts[channel.channelId] || {
      name: channel.name || '',
      userLimit: channel.userLimit || 0,
      activityStatus: channel.activityStatus || '',
      ownerId: channel.ownerId || '',
      targetId: '',
    };
  }

  function updateDraft(channelId, patch) {
    setDrafts((current) => ({ ...current, [channelId]: { ...(current[channelId] || {}), ...patch } }));
  }

  async function runAction(label, request) {
    try {
      onError?.('');
      await request();
      onMessage?.(`${E.SUCCESS} ${label}`);
      await onRefresh?.();
    } catch (error) {
      onError?.(error.message || `${label} failed.`);
    }
  }

  async function updateChannel(channelId, controls, label) {
    return runAction(label, () => api.request(`/api/temp-voice/${guildId}/channels/${channelId}/controls`, {
      method: 'PATCH',
      body: JSON.stringify({ controls }),
    }));
  }

  async function claimChannel(channelId) {
    return runAction('Channel claimed.', () => api.request(`/api/temp-voice/${guildId}/channels/${channelId}/claim`, {
      method: 'POST',
      body: JSON.stringify({}),
    }));
  }

  async function moveMemberOut(channelId, targetId, restrict = false) {
    if (!targetId) {
      onError?.('Enter a target user ID first.');
      return;
    }

    return runAction(restrict ? 'User removed and restricted.' : 'User removed from channel.', () => api.request(`/api/temp-voice/${guildId}/channels/${channelId}/kick`, {
      method: 'POST',
      body: JSON.stringify({ targetId, block: restrict }),
    }));
  }

  async function closeChannel(channelId) {
    return runAction('Temporary channel closed.', () => api.request(`/api/temp-voice/${guildId}/channels/${channelId}`, {
      method: 'DELETE',
    }));
  }

  if (!channels.length) {
    return <EmptyState theme={theme} title="No active temporary channels" text="Created temporary channels will appear here." />;
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {channels.map((channel) => {
        const draft = draftFor(channel);
        return (
          <div key={channel.channelId} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.5)', borderRadius: 14, padding: 12, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span>
                <strong>{channel.name || channel.channelId}</strong><br />
                <small style={{ color: theme.mutedText }}>
                  Owner: {channel.ownerId} · Limit: {channel.userLimit || 'None'} · {channel.locked ? 'Locked' : 'Unlocked'} · {channel.hidden ? 'Hidden' : 'Visible'} · Status: {channel.activityStatus || 'None'} · Restricted: {channel.blockedUserIds?.length || 0}
                </small>
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" disabled={saving} onClick={() => claimChannel(channel.channelId)} style={buttonStyle(theme, 'good')}>Claim</button>
                <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { locked: !channel.locked }, channel.locked ? 'Channel unlocked.' : 'Channel locked.')} style={buttonStyle(theme)}>{channel.locked ? 'Unlock' : 'Lock'}</button>
                <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { hidden: !channel.hidden }, channel.hidden ? 'Channel shown.' : 'Channel hidden.')} style={buttonStyle(theme)}>{channel.hidden ? 'Show' : 'Hide'}</button>
                <button type="button" disabled={saving} onClick={() => closeChannel(channel.channelId)} style={buttonStyle(theme, 'danger')}>Close</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8 }}>
              <input value={draft.name} onChange={(event) => updateDraft(channel.channelId, { name: event.target.value })} placeholder="Channel name" style={inputStyle(theme)} />
              <input type="number" min="0" max="99" value={draft.userLimit} onChange={(event) => updateDraft(channel.channelId, { userLimit: event.target.value })} placeholder="User limit" style={inputStyle(theme)} />
              <input value={draft.activityStatus} onChange={(event) => updateDraft(channel.channelId, { activityStatus: event.target.value })} placeholder="Status/activity" style={inputStyle(theme)} />
              <input value={draft.ownerId} onChange={(event) => updateDraft(channel.channelId, { ownerId: event.target.value })} placeholder="Transfer owner ID" style={inputStyle(theme)} />
              <input value={draft.targetId} onChange={(event) => updateDraft(channel.channelId, { targetId: event.target.value })} placeholder="Target user ID" style={inputStyle(theme)} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { name: draft.name }, 'Channel renamed.')} style={buttonStyle(theme)}>Rename</button>
              <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { userLimit: draft.userLimit }, 'User limit updated.')} style={buttonStyle(theme)}>Set limit</button>
              <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { activityStatus: draft.activityStatus }, 'Status updated.')} style={buttonStyle(theme)}>Set status</button>
              <button type="button" disabled={saving} onClick={() => updateChannel(channel.channelId, { ownerId: draft.ownerId }, 'Ownership transferred.')} style={buttonStyle(theme)}>Transfer</button>
              <button type="button" disabled={saving} onClick={() => moveMemberOut(channel.channelId, draft.targetId, false)} style={buttonStyle(theme, 'danger')}>Remove user</button>
              <button type="button" disabled={saving} onClick={() => moveMemberOut(channel.channelId, draft.targetId, true)} style={buttonStyle(theme, 'danger')}>Restrict user</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
