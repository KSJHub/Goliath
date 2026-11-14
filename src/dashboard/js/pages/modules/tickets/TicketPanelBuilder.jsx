import { DASHBOARD_EMOJIS as E } from '../../../shared/PageShell';
import React, { useMemo, useState } from 'react';

const DEFAULT_PANEL = {
  panelId: '',
  name: 'Support Panel',
  ticketType: 'support',
  ticketPriority: 'low',
  deployChannelId: '',
  outputCategoryId: '',
  archiveCategoryId: '',
  logsChannelId: '',
  transcriptsChannelId: '',
  staffRoleIds: [],
  maxOpenTicketsPerUser: 2,
  cooldownMs: 60000,
  oneActivePerType: true,
  notifyStaffOnOpen: true,
  appearance: {
    title: 'Need Support?',
    description: 'Press the button below to open a private support ticket.',
    color: '#5865F2',
    buttonLabel: 'Open Support Ticket',
    buttonEmoji: E.TICKETS,
    footerText: 'Goliath • Ticket System',
  },
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function fieldStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.55)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '10px 11px',
    fontWeight: 850,
    outline: 'none',
    width: '100%',
  };
}

function buttonStyle(theme, variant = 'soft', disabled = false) {
  const variants = {
    soft: { background: 'rgba(15,23,42,0.35)', color: theme.cardText, border: `1px solid ${theme.cardBorder}` },
    primary: { background: 'rgba(37,99,235,0.24)', color: theme.cardText, border: '1px solid rgba(147,197,253,0.35)' },
    success: { background: 'rgba(34,197,94,0.14)', color: '#86efac', border: '1px solid rgba(134,239,172,0.35)' },
    warning: { background: 'rgba(245,158,11,0.13)', color: '#fcd34d', border: '1px solid rgba(252,211,77,0.35)' },
  };

  return {
    ...variants[variant],
    borderRadius: 12,
    padding: '10px 12px',
    fontWeight: 950,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}

function SectionLabel({ theme, children }) {
  return <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{children}</div>;
}

function Field({ theme, label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <SectionLabel theme={theme}>{label}</SectionLabel>
      {children}
    </label>
  );
}

function Preview({ theme, panel }) {
  const appearance = panel.appearance || {};
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.30)', borderRadius: 18, padding: 16, display: 'grid', gap: 12 }}>
      <SectionLabel theme={theme}>Discord Preview</SectionLabel>
      <div style={{ borderLeft: `4px solid ${appearance.color || '#5865F2'}`, background: 'rgba(2,6,23,0.55)', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <strong style={{ color: theme.cardText, fontSize: 18 }}>{appearance.title || 'Open a Ticket'}</strong>
        <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{appearance.description || 'Need help? Open a ticket and staff will assist you.'}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 145px), 1fr))', gap: 8, color: theme.mutedText, fontSize: 12 }}>
          <span><strong style={{ color: theme.cardText }}>Type:</strong> {panel.ticketType}</span>
          <span><strong style={{ color: theme.cardText }}>Priority:</strong> {panel.ticketPriority}</span>
          <span><strong style={{ color: theme.cardText }}>Limit:</strong> {panel.maxOpenTicketsPerUser || 'Unlimited'}</span>
          <span><strong style={{ color: theme.cardText }}>Cooldown:</strong> {Math.round(Number(panel.cooldownMs || 0) / 1000)}s</span>
        </div>
        {appearance.footerText ? <span style={{ color: theme.mutedText, fontSize: 12 }}>{appearance.footerText}</span> : null}
      </div>
      <button type="button" disabled style={{ ...buttonStyle(theme, 'primary', true), justifySelf: 'start' }}>{appearance.buttonEmoji || E.TICKETS} {appearance.buttonLabel || 'Open Ticket'}</button>
    </div>
  );
}

export default function TicketPanelBuilder({ theme, channels = [], roles = [], selectedPanel = null, busy = false, onSave, onDeploy, onRefreshPanel }) {
  const [panel, setPanel] = useState(() => ({ ...DEFAULT_PANEL, ...(selectedPanel || {}), appearance: { ...DEFAULT_PANEL.appearance, ...(selectedPanel?.appearance || {}) } }));
  const textChannels = useMemo(() => safeArray(channels).filter((channel) => [0, 5, 'GuildText', 'GuildAnnouncement', 'text'].includes(channel.type)), [channels]);
  const categories = useMemo(() => safeArray(channels).filter((channel) => [4, 'GuildCategory', 'category'].includes(channel.type)), [channels]);

  function update(field, value) {
    setPanel((current) => ({ ...current, [field]: value }));
  }

  function updateAppearance(field, value) {
    setPanel((current) => ({ ...current, appearance: { ...(current.appearance || {}), [field]: value } }));
  }

  function updateRoles(event) {
    const values = Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean);
    update('staffRoleIds', values);
  }

  async function savePanel(event) {
    event.preventDefault();
    await onSave?.(panel);
  }

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 20, boxShadow: theme.shadow, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <SectionLabel theme={theme}>Ticket Panel Builder</SectionLabel>
          <h3 style={{ margin: '6px 0 0' }}>Create & Deploy Panels</h3>
          <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Build support, appeal, report and application panels directly from the dashboard.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setPanel(DEFAULT_PANEL)} style={buttonStyle(theme, 'soft', busy)} disabled={busy}>New Panel</button>
          <button type="button" onClick={() => onRefreshPanel?.(panel)} style={buttonStyle(theme, 'warning', busy || !panel.panelId)} disabled={busy || !panel.panelId}>Refresh Deploy</button>
          <button type="button" onClick={() => onDeploy?.(panel)} style={buttonStyle(theme, 'success', busy || !panel.panelId)} disabled={busy || !panel.panelId}>Deploy</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(min(100%, 320px), 0.9fr)', gap: 16, alignItems: 'start' }}>
        <form onSubmit={savePanel} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <Field theme={theme} label="Panel Name"><input value={panel.name || ''} onChange={(event) => update('name', event.target.value)} style={fieldStyle(theme)} /></Field>
            <Field theme={theme} label="Ticket Type"><select value={panel.ticketType || 'support'} onChange={(event) => update('ticketType', event.target.value)} style={fieldStyle(theme)}><option value="support">Support</option><option value="appeal">Appeal</option><option value="report">Report</option><option value="application">Application</option><option value="billing">Billing</option><option value="bug">Bug Report</option></select></Field>
            <Field theme={theme} label="Priority"><select value={panel.ticketPriority || 'low'} onChange={(event) => update('ticketPriority', event.target.value)} style={fieldStyle(theme)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>
            <Field theme={theme} label="Deploy Channel"><select value={panel.deployChannelId || panel.channelId || ''} onChange={(event) => update('deployChannelId', event.target.value)} style={fieldStyle(theme)}><option value="">Select channel</option>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name || channel.id}</option>)}</select></Field>
            <Field theme={theme} label="Output Category"><select value={panel.outputCategoryId || ''} onChange={(event) => update('outputCategoryId', event.target.value)} style={fieldStyle(theme)}><option value="">Default / not set</option>{categories.map((channel) => <option key={channel.id} value={channel.id}>{channel.name || channel.id}</option>)}</select></Field>
            <Field theme={theme} label="Archive Category"><select value={panel.archiveCategoryId || ''} onChange={(event) => update('archiveCategoryId', event.target.value)} style={fieldStyle(theme)}><option value="">Default / not set</option>{categories.map((channel) => <option key={channel.id} value={channel.id}>{channel.name || channel.id}</option>)}</select></Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <Field theme={theme} label="Embed Title"><input value={panel.appearance?.title || ''} onChange={(event) => updateAppearance('title', event.target.value)} style={fieldStyle(theme)} /></Field>
            <Field theme={theme} label="Button Label"><input value={panel.appearance?.buttonLabel || ''} onChange={(event) => updateAppearance('buttonLabel', event.target.value)} style={fieldStyle(theme)} /></Field>
            <Field theme={theme} label="Button Emoji"><input value={panel.appearance?.buttonEmoji || ''} onChange={(event) => updateAppearance('buttonEmoji', event.target.value)} style={fieldStyle(theme)} /></Field>
            <Field theme={theme} label="Colour"><input value={panel.appearance?.color || '#5865F2'} onChange={(event) => updateAppearance('color', event.target.value)} style={fieldStyle(theme)} /></Field>
          </div>

          <Field theme={theme} label="Embed Description"><textarea rows={4} value={panel.appearance?.description || ''} onChange={(event) => updateAppearance('description', event.target.value)} style={fieldStyle(theme)} /></Field>
          <Field theme={theme} label="Footer Text"><input value={panel.appearance?.footerText || ''} onChange={(event) => updateAppearance('footerText', event.target.value)} style={fieldStyle(theme)} /></Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <Field theme={theme} label="Staff Roles"><select multiple value={panel.staffRoleIds || []} onChange={updateRoles} style={{ ...fieldStyle(theme), minHeight: 118 }}>{safeArray(roles).map((role) => <option key={role.id} value={role.id}>{role.name || role.id}</option>)}</select></Field>
            <Field theme={theme} label="Limit Per User"><input type="number" min="0" value={panel.maxOpenTicketsPerUser || 0} onChange={(event) => update('maxOpenTicketsPerUser', Number(event.target.value))} style={fieldStyle(theme)} /></Field>
            <Field theme={theme} label="Cooldown Seconds"><input type="number" min="0" value={Math.round(Number(panel.cooldownMs || 0) / 1000)} onChange={(event) => update('cooldownMs', Number(event.target.value) * 1000)} style={fieldStyle(theme)} /></Field>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: theme.mutedText, fontWeight: 850 }}>
            <label><input type="checkbox" checked={panel.oneActivePerType !== false} onChange={(event) => update('oneActivePerType', event.target.checked)} /> One active ticket per type</label>
            <label><input type="checkbox" checked={panel.notifyStaffOnOpen !== false} onChange={(event) => update('notifyStaffOnOpen', event.target.checked)} /> Notify staff on open</label>
          </div>

          <button type="submit" disabled={busy} style={{ ...buttonStyle(theme, 'primary', busy), justifySelf: 'start' }}>{busy ? 'Saving...' : 'Save Panel'}</button>
        </form>

        <Preview theme={theme} panel={panel} />
      </div>
    </section>
  );
}
