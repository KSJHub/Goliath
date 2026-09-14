import React, { useMemo, useState } from 'react';

const MODULE_TEMPLATE_GROUPS = [
  {
    key: 'suggestions',
    label: 'Suggestions',
    description: 'Public suggestion panel, open suggestions and final decision messages.',
    slots: ['suggestion_panel', 'suggestion_pending', 'suggestion_accepted', 'suggestion_denied'],
  },
  {
    key: 'welcome',
    label: 'Welcome / Leave',
    description: 'Messages used when members join, leave or receive a welcome DM.',
    slots: ['welcome', 'leave', 'dm_welcome'],
  },
  {
    key: 'rules',
    label: 'Rules',
    description: 'Server rules, acknowledgement panels and policy messages.',
    slots: ['rules_panel', 'rules_acknowledged'],
  },
  {
    key: 'tickets',
    label: 'Tickets',
    description: 'Ticket panels and automatic ticket lifecycle messages.',
    slots: ['ticket_panel', 'ticket_created', 'ticket_closed', 'transcript_header'],
  },
  {
    key: 'verification',
    label: 'Verification',
    description: 'Verification panels, success messages and failed verification responses.',
    slots: ['verification_panel', 'verification_success', 'verification_failed'],
  },
  {
    key: 'forms',
    label: 'Forms',
    description: 'Form panels, submission receipts and review decision messages.',
    slots: ['form_panel', 'submission_received', 'submission_approved', 'submission_denied'],
  },
  {
    key: 'polls',
    label: 'Polls',
    description: 'Poll panels, option buttons and result messages.',
    slots: ['poll_panel', 'poll_results'],
  },
  {
    key: 'giveaways',
    label: 'Giveaways',
    description: 'Giveaway launch, winner and ended messages.',
    slots: ['giveaway_panel', 'giveaway_winner', 'giveaway_ended'],
  },
];

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function labelFromKey(value) {
  return String(value || '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultTemplateId(moduleKey, slot) {
  return `${moduleKey}_${slot}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

function makePreviewTemplate(moduleKey, slot) {
  const label = labelFromKey(slot || moduleKey);
  return {
    templateId: defaultTemplateId(moduleKey, slot),
    name: label,
    module: moduleKey,
    templateType: slot,
    version: 1,
    embed: {
      title: label,
      description: `This is the Discord-facing ${label.toLowerCase()} template for the ${labelFromKey(moduleKey)} module.`,
    },
    usedVariables: ['{server.name}', '{member.name}', '{channel.name}'],
  };
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

function Pill({ children, tone = '#93c5fd' }) {
  return <span style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</span>;
}

function MiniStat({ theme, label, value, accent = '#93c5fd' }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 14, padding: 12 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 950, color: accent }}>{value}</div>
    </div>
  );
}

function TemplateCard({ theme, template, active = false }) {
  const unsupported = safeArray(template.unsupportedVariables);
  return (
    <div style={{ border: `1px solid ${active ? 'rgba(147,197,253,0.65)' : theme.cardBorder}`, background: active ? 'rgba(37,99,235,0.16)' : 'rgba(15,23,42,0.24)', borderRadius: 16, padding: 13, display: 'grid', gap: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: theme.cardText }}>{template.name || template.templateId}</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pill>{template.module || 'global'}</Pill>
          <Pill tone={unsupported.length ? '#fca5a5' : '#86efac'}>{unsupported.length ? 'Check vars' : 'Ready'}</Pill>
        </div>
      </div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{template.embed?.title || template.title || 'Untitled embed'}</div>
      <div style={{ color: theme.mutedText, fontSize: 12 }}>Updated: {formatDate(template.updatedAt)} • Version {template.version || 1}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {safeArray(template.usedVariables).slice(0, 8).map((variable) => <span key={variable} style={{ color: theme.mutedText, border: `1px solid ${theme.cardBorder}`, borderRadius: 999, padding: '3px 7px', fontSize: 11 }}>{variable}</span>)}
      </div>
      {unsupported.length ? <div style={{ color: '#fca5a5', fontSize: 12 }}>Unsupported: {unsupported.join(', ')}</div> : null}
    </div>
  );
}

function ModuleSlotList({ theme, group, selectedSlot, bindings, onSelectSlot }) {
  const moduleBindings = safeObject(bindings[group.key]);
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.22)', borderRadius: 16, padding: 13, display: 'grid', gap: 10 }}>
      <div>
        <strong>{group.label}</strong>
        <p style={{ margin: '5px 0 0', color: theme.mutedText, fontSize: 12, lineHeight: 1.45 }}>{group.description}</p>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {group.slots.map((slotName) => {
          const active = selectedSlot === slotName;
          const bound = moduleBindings[slotName];
          return (
            <button
              key={slotName}
              type="button"
              onClick={() => onSelectSlot(group.key, slotName, bound || defaultTemplateId(group.key, slotName))}
              style={{
                border: `1px solid ${active ? '#93c5fd' : theme.cardBorder}`,
                background: active ? 'rgba(37,99,235,0.20)' : 'rgba(15,23,42,0.22)',
                color: theme.cardText,
                borderRadius: 12,
                padding: 10,
                textAlign: 'left',
                cursor: 'pointer',
                display: 'grid',
                gap: 4,
              }}
            >
              <span style={{ fontWeight: 950 }}>{labelFromKey(slotName)}</span>
              <span style={{ color: bound ? '#86efac' : theme.mutedText, fontSize: 12 }}>{bound ? `Bound to ${bound}` : 'No template bound yet'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function SharedEmbedTemplatesPanel({ theme, payload = {}, busy = false, onSaveTemplate, onBindTemplate, onReload }) {
  const templates = useMemo(() => Object.values(safeObject(payload.templates)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name))), [payload]);
  const bindings = safeObject(payload.bindings);
  const variables = safeObject(payload.variables);
  const summary = safeObject(payload.summary);
  const [moduleKey, setModuleKey] = useState('suggestions');
  const [slot, setSlot] = useState('suggestion_panel');
  const [templateId, setTemplateId] = useState('suggestions_suggestion_panel');

  const selectedTemplate = templates.find((template) => String(template.templateId || template.id) === String(templateId)) || makePreviewTemplate(moduleKey, slot);

  async function saveCurrentAsTemplate() {
    const draft = payload.draft || payload.builder?.draft || {};
    await onSaveTemplate?.({
      templateId,
      name: selectedTemplate.name || labelFromKey(slot),
      module: moduleKey,
      templateType: slot,
      content: draft.content || selectedTemplate.content || '',
      embed: draft.embed || selectedTemplate.embed || draft,
    });
  }

  async function bindTemplate() {
    await onBindTemplate?.(moduleKey, slot, templateId);
  }

  function selectSlot(nextModuleKey, nextSlot, nextTemplateId) {
    setModuleKey(nextModuleKey);
    setSlot(nextSlot);
    setTemplateId(nextTemplateId);
  }

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 20, boxShadow: theme.shadow, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Embed Studio</div>
          <h3 style={{ margin: '6px 0 0' }}>Module Message Templates</h3>
          <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.5, maxWidth: 880 }}>Modules keep their logic and interactive controls. Embed Studio owns the Discord-facing message content and template bindings used by those modules.</p>
        </div>
        <button type="button" onClick={onReload} style={buttonStyle(theme, 'soft', busy)} disabled={busy}>Reload</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10 }}>
        <MiniStat theme={theme} label="Templates" value={summary.templateCount ?? templates.length} />
        <MiniStat theme={theme} label="Bindings" value={summary.bindingCount ?? Object.keys(bindings).length} accent="#a855f7" />
        <MiniStat theme={theme} label="Modules" value={MODULE_TEMPLATE_GROUPS.length} accent="#22c55e" />
        <MiniStat theme={theme} label="Deployments" value={summary.deploymentCount ?? 0} accent="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(min(100%, 320px), 1fr) minmax(min(100%, 420px), 1.2fr)', gap: 14 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <strong>Module Template Slots</strong>
          {MODULE_TEMPLATE_GROUPS.map((group) => <ModuleSlotList key={group.key} theme={theme} group={group} selectedSlot={moduleKey === group.key ? slot : ''} bindings={bindings} onSelectSlot={selectSlot} />)}
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 16, padding: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>Editing: {labelFromKey(moduleKey)} / {labelFromKey(slot)}</strong>
                <p style={{ margin: '5px 0 0', color: theme.mutedText, fontSize: 13 }}>This template is used by the module when it posts to Discord.</p>
                {moduleKey === 'suggestions' ? <p style={{ margin: '6px 0 0', color: '#fde68a', fontSize: 12, lineHeight: 1.45 }}>Suggestions always keeps its yellow module colour and its Share, My Suggestions, voting and Team Review buttons. Templates control the message content, not the workflow.</p> : null}
              </div>
              <Pill tone="#86efac">Module Linked</Pill>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Module</span><select value={moduleKey} onChange={(event) => selectSlot(event.target.value, MODULE_TEMPLATE_GROUPS.find((group) => group.key === event.target.value)?.slots[0] || 'custom', defaultTemplateId(event.target.value, MODULE_TEMPLATE_GROUPS.find((group) => group.key === event.target.value)?.slots[0] || 'custom'))} style={fieldStyle(theme)}>{MODULE_TEMPLATE_GROUPS.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>
              <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Slot</span><select value={slot} onChange={(event) => selectSlot(moduleKey, event.target.value, defaultTemplateId(moduleKey, event.target.value))} style={fieldStyle(theme)}>{(MODULE_TEMPLATE_GROUPS.find((group) => group.key === moduleKey)?.slots || []).map((slotName) => <option key={slotName} value={slotName}>{labelFromKey(slotName)}</option>)}</select></label>
              <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Template</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} style={fieldStyle(theme)}><option value={defaultTemplateId(moduleKey, slot)}>Default: {labelFromKey(slot)}</option>{templates.map((template) => <option key={template.templateId || template.id} value={template.templateId || template.id}>{template.name}</option>)}</select></label>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" disabled={busy || !templateId} onClick={bindTemplate} style={buttonStyle(theme, 'success', busy || !templateId)}>Bind to Module</button>
              <button type="button" disabled={busy || !templateId} onClick={saveCurrentAsTemplate} style={buttonStyle(theme, 'primary', busy || !templateId)}>Save as Template</button>
            </div>
          </div>

          <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 16, padding: 14, display: 'grid', gap: 12 }}>
            <strong>Discord Preview</strong>
            <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.76))', borderRadius: 16, padding: 16, borderLeft: `4px solid ${moduleKey === 'suggestions' ? '#FEE75C' : '#7c3aed'}`, display: 'grid', gap: 10 }}>
              <strong>{selectedTemplate.embed?.title || selectedTemplate.title || labelFromKey(slot)}</strong>
              <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.5 }}>{selectedTemplate.embed?.description || selectedTemplate.description || `Preview for ${labelFromKey(slot)}.`}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ background: 'rgba(34,197,94,0.24)', color: '#86efac', border: '1px solid rgba(134,239,172,0.35)', borderRadius: 10, padding: '8px 10px', fontWeight: 900 }}>Primary Action</span>
                <span style={{ background: 'rgba(59,130,246,0.22)', color: '#bfdbfe', border: '1px solid rgba(147,197,253,0.35)', borderRadius: 10, padding: '8px 10px', fontWeight: 900 }}>Secondary</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', gap: 10 }}>
            {templates.length ? templates.map((template) => <TemplateCard key={template.templateId || template.id} theme={theme} template={template} active={String(template.templateId || template.id) === String(templateId)} />) : <TemplateCard theme={theme} template={selectedTemplate} active />}
          </div>

          <div style={{ borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 12, display: 'grid', gap: 8 }}>
            <strong>Current Bindings</strong>
            {Object.keys(bindings).length ? Object.entries(bindings).map(([moduleName, map]) => (
              <div key={moduleName} style={{ color: theme.mutedText, fontSize: 13 }}>{moduleName}: {Object.entries(safeObject(map)).map(([slotName, id]) => `${slotName} → ${id}`).join(', ')}</div>
            )) : <span style={{ color: theme.mutedText }}>No module bindings yet.</span>}
          </div>

          <div style={{ borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 12, display: 'grid', gap: 8 }}>
            <strong>Supported Variables</strong>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {safeArray(variables[moduleKey] || variables.global || selectedTemplate.usedVariables).map((variable) => <span key={variable} style={{ color: theme.mutedText, border: `1px solid ${theme.cardBorder}`, borderRadius: 999, padding: '3px 7px', fontSize: 11 }}>{variable}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}