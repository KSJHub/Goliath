import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function card(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, padding: 18, boxShadow: theme.shadow };
}

function field(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 12, padding: '10px 11px', fontWeight: 850, outline: 'none', width: '100%' };
}

function button(theme, disabled = false) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: theme.cardText, borderRadius: 12, padding: '9px 11px', fontWeight: 950, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 };
}

function automationRequest(path, options = {}) {
  return api.request(`/api/automation${path}`, options);
}

export default function Automation({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [registry, setRegistry] = useState({ triggers: [], actions: [] });
  const [rules, setRules] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [simulation, setSimulation] = useState(null);
  const [name, setName] = useState('New automation rule');
  const [trigger, setTrigger] = useState('form.submitted');
  const [action, setAction] = useState('log.event');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const safeActions = useMemo(() => registry.actions.filter((item) => item.safe !== false && item.disabled !== true), [registry.actions]);

  const load = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const [registryPayload, automationPayload] = await Promise.all([
        automationRequest('/registry'),
        automationRequest(`/${guildId}`),
      ]);
      setRegistry({ triggers: registryPayload.triggers || [], actions: registryPayload.actions || [] });
      setRules(automationPayload.rules || []);
      setExecutions(automationPayload.executions || []);
    } catch (err) {
      setError(err.message || 'Failed to load automation.');
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => { load(); }, [load]);

  async function saveRule() {
    if (!guildId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await automationRequest(`/${guildId}/rules`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          trigger,
          enabled: true,
          actions: [{ action, config: { message: 'Automation rule executed.' } }],
        }),
      });
      setRules(payload.rules || []);
      setNotice('Automation rule saved.');
    } catch (err) {
      setError(err.message || 'Failed to save automation rule.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(ruleId) {
    if (!guildId || !ruleId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await automationRequest(`/${guildId}/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
      setRules(payload.rules || []);
      setNotice('Automation rule deleted.');
    } catch (err) {
      setError(err.message || 'Failed to delete automation rule.');
    } finally {
      setSaving(false);
    }
  }

  async function testLog(rule = null) {
    if (!guildId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await automationRequest(`/${guildId}/test-log`, {
        method: 'POST',
        body: JSON.stringify({
          ruleId: rule?.ruleId || null,
          trigger: rule?.trigger || 'manual.test',
          message: rule ? `Manual test for ${rule.name}` : 'Manual automation dashboard test.',
        }),
      });
      setExecutions(payload.executions || []);
      setNotice('Test log written.');
    } catch (err) {
      setError(err.message || 'Failed to write test log.');
    } finally {
      setSaving(false);
    }
  }

  async function simulateRule(rule) {
    if (!guildId || !rule?.ruleId) return;
    setSaving(true);
    setError('');
    setNotice('');
    setSimulation(null);
    try {
      const payload = await api.simulateAutomationRule(guildId, rule.ruleId, {
        guildId,
        trigger: rule.trigger,
        source: 'dashboard.simulate',
        status: 'test',
      });
      setSimulation(payload.simulation || null);
      setExecutions(payload.executions || executions);
      setNotice('Simulation complete.');
    } catch (err) {
      setError(err.message || 'Failed to simulate automation rule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...card(theme), background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08), rgba(168,85,247,0.12))' }}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Automation Engine</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)' }}>Rules & Triggers</h1>
        <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.55 }}>Minimal foundation for future workflow automation. Only safe log actions are enabled right now.</p>
      </section>

      {(error || notice || loading) ? <section style={{ ...card(theme), color: error ? '#fca5a5' : notice ? '#86efac' : theme.mutedText, fontWeight: 850 }}>{error || notice || 'Loading automation...'}</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
        <Stat theme={theme} label="Triggers" value={registry.triggers.length} />
        <Stat theme={theme} label="Actions" value={registry.actions.length} />
        <Stat theme={theme} label="Rules" value={rules.length} />
        <Stat theme={theme} label="Executions" value={executions.length} />
      </section>

      <section style={{ ...card(theme), display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Create Safe Rule</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Name</span><input value={name} onChange={(event) => setName(event.target.value)} style={field(theme)} /></label>
          <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Trigger</span><ThemedSelect theme={theme} value={trigger} onChange={(event) => setTrigger(event.target.value)} style={field(theme)}>{registry.triggers.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</ThemedSelect></label>
          <label style={{ display: 'grid', gap: 6 }}><span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>Action</span><ThemedSelect theme={theme} value={action} onChange={(event) => setAction(event.target.value)} style={field(theme)}>{safeActions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</ThemedSelect></label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={saveRule} disabled={saving || !guildId} style={button(theme, saving || !guildId)}>Save Rule</button>
          <button type="button" onClick={() => testLog()} disabled={saving || !guildId} style={button(theme, saving || !guildId)}>Write Test Log</button>
          <button type="button" onClick={load} disabled={loading || !guildId} style={button(theme, loading || !guildId)}>Refresh</button>
        </div>
      </section>

      {simulation ? <SimulationPanel theme={theme} simulation={simulation} /> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
        <section style={{ ...card(theme), display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Rules</h3>
          {rules.length ? rules.map((rule) => <div key={rule.ruleId} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 7 }}><strong>{rule.name}</strong><span style={{ color: theme.mutedText, fontSize: 12 }}>{rule.trigger} · {rule.enabled ? 'Enabled' : 'Disabled'}</span><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => simulateRule(rule)} disabled={saving} style={button(theme, saving)}>Simulate</button><button type="button" onClick={() => testLog(rule)} disabled={saving} style={button(theme, saving)}>Test Log</button><button type="button" onClick={() => deleteRule(rule.ruleId)} disabled={saving} style={button(theme, saving)}>Delete</button></div></div>) : <span style={{ color: theme.mutedText }}>No automation rules yet.</span>}
        </section>

        <section style={{ ...card(theme), display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Recent Executions</h3>
          {executions.length ? executions.slice(0, 10).map((entry) => <div key={entry.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, display: 'grid', gap: 4 }}><strong>{entry.status}</strong><span style={{ color: theme.mutedText, fontSize: 12 }}>{entry.trigger || 'manual'} · {entry.createdAt}</span><span style={{ color: theme.mutedText, fontSize: 13 }}>{entry.message || 'No message'}</span></div>) : <span style={{ color: theme.mutedText }}>No executions logged yet.</span>}
        </section>
      </section>
    </div>
  );
}

function SimulationPanel({ theme, simulation }) {
  const statusTone = simulation.status === 'would_run' ? '#86efac' : simulation.status === 'conditions_failed' ? '#fcd34d' : '#fca5a5';
  return (
    <section style={{ ...card(theme), display: 'grid', gap: 12, borderColor: `${statusTone}88` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>Simulation Result</h3>
          <p style={{ margin: '6px 0 0', color: theme.mutedText }}>{simulation.name} · {simulation.trigger}</p>
        </div>
        <strong style={{ color: statusTone, textTransform: 'uppercase' }}>{simulation.status}</strong>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <strong>Conditions</strong>
        {simulation.conditions?.length ? simulation.conditions.map((condition, index) => <div key={`${condition.field}-${index}`} style={{ color: condition.passed ? '#86efac' : '#fca5a5', fontSize: 13 }}>{condition.passed ? '✓' : '×'} {condition.field || 'condition'} {condition.operator} {String(condition.expected ?? '')}</div>) : <span style={{ color: theme.mutedText }}>No conditions. Rule can continue.</span>}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <strong>Actions</strong>
        {simulation.actions?.length ? simulation.actions.map((item) => <div key={`${item.action}-${item.index}`} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 10 }}><strong>{item.wouldRun ? '✓' : '○'} {item.label}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{item.action} · {item.disabled ? 'disabled' : item.safe ? 'safe' : 'future action'}</div></div>) : <span style={{ color: theme.mutedText }}>No actions configured.</span>}
      </div>
    </section>
  );
}

function Stat({ theme, label, value }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, borderRadius: 18, padding: 16 }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ marginTop: 8, fontSize: 28, fontWeight: 950 }}>{value}</div></div>;
}
