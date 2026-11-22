import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React, { useMemo, useState } from 'react';

export const PERMISSION_PRESETS = [
  {
    key: 'administrator',
    label: 'Administrator',
    description: 'Full dashboard, module and command coverage for trusted senior staff.',
    dashboardPages: ['overview', 'moderation', 'cases', 'logs', 'tickets', 'forms', 'billing', 'translation', 'security', 'restore'],
    modules: ['tickets', 'forms', 'verification', 'autoRoles', 'reactionRoles', 'welcome', 'leveling', 'giveaways', 'polls', 'translation', 'embedStudio', 'tempVoice', 'starboard', 'sticky', 'social', 'stats'],
    commands: ['ban', 'kick', 'timeout', 'mute', 'warn', 'purge', 'lock', 'unlock', 'slowmode', 'ticket', 'claim', 'close', 'forms', 'translate', 'backup', 'restore', 'deploy', 'publish'],
    fullAccess: true,
  },
  {
    key: 'moderator',
    label: 'Moderator',
    description: 'Moderation pages, logs and core staff commands.',
    dashboardPages: ['overview', 'moderation', 'cases', 'logs', 'tickets'],
    modules: ['tickets', 'stats'],
    commands: ['ban', 'kick', 'timeout', 'mute', 'warn', 'purge', 'lock', 'unlock', 'slowmode', 'ticket', 'claim', 'close'],
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Ticket and forms access for support teams.',
    dashboardPages: ['overview', 'tickets', 'forms', 'logs'],
    modules: ['tickets', 'forms'],
    commands: ['ticket', 'claim', 'close', 'forms'],
  },
  {
    key: 'botManager',
    label: 'Bot Manager',
    description: 'Module deployment and bot configuration coverage without billing.',
    dashboardPages: ['overview', 'logs', 'security'],
    modules: ['verification', 'autoRoles', 'reactionRoles', 'welcome', 'leveling', 'giveaways', 'polls', 'embedStudio', 'tempVoice', 'starboard', 'sticky', 'social', 'stats'],
    commands: ['deploy', 'publish', 'backup'],
  },
  {
    key: 'formsManager',
    label: 'Forms Manager',
    description: 'Forms workflow and form deployment access.',
    dashboardPages: ['overview', 'forms', 'tickets'],
    modules: ['forms', 'tickets'],
    commands: ['forms', 'ticket'],
  },
  {
    key: 'translator',
    label: 'Translator',
    description: 'Translation page, module and command access.',
    dashboardPages: ['overview', 'translation'],
    modules: ['translation'],
    commands: ['translate'],
  },
  {
    key: 'publisher',
    label: 'Publisher',
    description: 'Publish embeds, social alerts, polls and giveaway content.',
    dashboardPages: ['overview', 'logs'],
    modules: ['embedStudio', 'social', 'polls', 'giveaways'],
    commands: ['publish', 'deploy'],
  },
  {
    key: 'readOnly',
    label: 'Read Only',
    description: 'Basic overview, logs and statistics access.',
    dashboardPages: ['overview', 'logs'],
    modules: ['stats'],
    commands: [],
  },
];

function control(theme) {
  return {
    width: '100%',
    border: `1px solid ${theme.inputBorder || theme.cardBorder}`,
    background: theme.inputBg || 'rgba(10,18,35,0.96)',
    color: theme.inputText || theme.cardText,
    borderRadius: 12,
    padding: '10px 12px',
    outline: 'none',
    fontWeight: 850,
    minWidth: 0,
  };
}

function button(theme, disabled = false) {
  return {
    border: '1px solid rgba(34,197,94,0.32)',
    background: 'rgba(34,197,94,0.13)',
    color: '#86efac',
    borderRadius: 12,
    padding: '10px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontWeight: 950,
  };
}

export default function PermissionPresetsPanel({ onApply, roles = [], selectedRoleId = '', theme }) {
  const [presetKey, setPresetKey] = useState(PERMISSION_PRESETS[0]?.key || '');
  const [roleId, setRoleId] = useState(selectedRoleId || roles[0]?.id || '');
  const activePreset = useMemo(() => PERMISSION_PRESETS.find((preset) => preset.key === presetKey), [presetKey]);
  const activeRoleId = roleId || selectedRoleId || roles[0]?.id || '';

  return <div style={{ display: 'grid', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(180px,1fr) auto', gap: 10, alignItems: 'end' }}>
      <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Role<ThemedSelect theme={theme} value={activeRoleId} onChange={(event) => setRoleId(event.target.value)} style={control(theme)}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</ThemedSelect></label>
      <label style={{ display: 'grid', gap: 7, color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preset<ThemedSelect theme={theme} value={presetKey} onChange={(event) => setPresetKey(event.target.value)} style={control(theme)}>{PERMISSION_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</ThemedSelect></label>
      <button type="button" disabled={!activeRoleId || !activePreset} onClick={() => onApply?.(activeRoleId, activePreset)} style={button(theme, !activeRoleId || !activePreset)}>Apply</button>
    </div>
    {activePreset ? <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.18)', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
      <strong>{activePreset.label}</strong>
      <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.5 }}>{activePreset.description}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>
        <span>{activePreset.dashboardPages.length} pages</span>
        <span>•</span>
        <span>{activePreset.modules.length} modules</span>
        <span>•</span>
        <span>{activePreset.commands.length} commands</span>
        {activePreset.fullAccess ? <><span>•</span><span>full access role</span></> : null}
      </div>
    </div> : null}
  </div>;
}
