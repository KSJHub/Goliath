import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient.js';

const panel = { border: '1px solid rgba(148,163,184,.24)', borderRadius: 16, background: 'rgba(15,23,42,.65)', padding: 16 };
const first = [{ role: 'assistant', content: 'Welcome to Goliath AI. This is your private developer chat. The free local model must be installed and enabled before I can reply.' }];
export default function GoliathAI({ theme }) {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [messages, setMessages] = useState(first);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [guilds, setGuilds] = useState([]);
  const [selectedGuild, setSelectedGuild] = useState('');
  const [environments, setEnvironments] = useState([]);
  const [audit, setAudit] = useState(null);
  const [auditing, setAuditing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [planning, setPlanning] = useState(false);
  const bottom = useRef(null);
  useEffect(() => {
    let mounted = true;
    api.request('/api/owner/ai/status').then((value) => { if (mounted) setStatus(value); })
      .catch((err) => { if (mounted) setError(err.message); });
    api.request('/api/owner/ai/guilds').then((value) => { if (mounted) { setGuilds(value.guilds || []); setEnvironments(value.environments || []); setSelectedGuild(value.guilds?.[0] ? (value.guilds[0].environment + ':' + value.guilds[0].id) : ''); } })
      .catch((err) => { if (mounted) setError(err.message); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages]);
  const checkAIHealth = async () => {
    if (checkingHealth) return;
    setCheckingHealth(true); setError('');
    try {
      const result = await api.request('/api/owner/ai/health');
      setHealth(result);
    } catch (err) { setError(err.message); }
    finally { setCheckingHealth(false); }
  };
  const refreshGuilds = async () => {
    setError('');
    try {
      const payload = await api.request('/api/owner/ai/guilds');
      const next = payload.guilds || [];
      setGuilds(next); setEnvironments(payload.environments || []);
      setSelectedGuild((previous) => next.some(g => g.environment + ':' + g.id === previous)
        ? previous : next[0] ? next[0].environment + ':' + next[0].id : '');
      setAudit(null); setPreview(null);
    } catch (err) { setError(err.message); }
  };
  const runAudit = async () => {
    if (!selectedGuild || auditing) return;
    setAuditing(true); setError(''); setAudit(null); setPreview(null);
    try {
      const [environment, guildId] = selectedGuild.split(':');
      if (!['DEV', 'BETA', 'PRODUCTION'].includes(environment) || !/^\d{16,20}$/.test(guildId || '')) throw new Error('Invalid environment or guild.');
      setAudit(await api.request('/api/owner/ai/audit/' + environment + '/' + guildId));
    }
    catch (err) { setError(err.message); }
    finally { setAuditing(false); }
  };
  const buildPlan = async () => {
    if (!audit || planning) return;
    setPlanning(true); setError(''); setPreview(null);
    try {
      const environment = String(audit.environment);
      const guildId = String(audit.guild.id);
      if (!['DEV', 'BETA', 'PRODUCTION'].includes(environment) || !/^\\d{16,20}$/.test(guildId)) throw new Error('Invalid selected server.');
      const result = await api.request('/api/owner/ai/plan/' + environment + '/' + guildId);
      if (result.environment !== environment || result.guild?.id !== guildId || result.executable !== false) throw new Error('Preview validation failed.');
      setPreview(result);
    } catch (err) { setError(err.message); }
    finally { setPlanning(false); }
  };
  const send = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy || !status?.enabled) return;
    const next = [...messages.filter((item, index) => index !== 0 || item.role !== 'assistant'), { role: 'user', content }];
    const history = next.slice(-16);
    setMessages(next); setDraft(''); setBusy(true); setError('');
    try {
      const result = await api.request('/api/owner/ai/chat', { method: 'POST', body: JSON.stringify({ messages: history, ...(audit && selectedGuild ? { guildContext: { environment: audit.environment, guildId: audit.guild.id } } : {}) }) });
      setMessages((items) => [...items, { role: 'assistant', content: result.reply }]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <section style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto', color: theme?.cardText || '#e5e7eb' }}>
    <header style={panel}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Goliath AI</h1>
      <p style={{ margin: 0, color: theme?.mutedText || '#94a3b8' }}>Developer-only · Global Discord auditing across DEV, BETA and PRODUCTION · Free local inference</p>
      <p role="status" style={{ marginBottom: 0, color: status?.enabled ? '#86efac' : '#fbbf24' }}>{status ? (status.enabled ? 'Local AI enabled' : 'Local AI not enabled') : 'Checking local AI…'}</p>
      {status?.notice && <p style={{ color: theme?.mutedText || '#94a3b8' }}>{status.notice}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <button type="button" onClick={checkAIHealth} disabled={checkingHealth}
          style={{ padding: '9px 13px', color: '#e5e7eb', background: '#1e293b', border: '1px solid #64748b', borderRadius: 10 }}>
          {checkingHealth ? 'Checking model…' : 'Check local AI connection'}
        </button>
        {health && <span role="status" style={{ color: health.ready ? '#86efac' : '#fbbf24' }}>
          {health.state === 'ready' ? 'Ready to test' : 'Not ready'} · {health.state}
        </span>}
      </div>
      {health && <p style={{ fontSize: 13, color: theme?.mutedText || '#94a3b8' }}>{health.reason}{health.models?.length ? ' Loaded model(s): ' + health.models.join(', ') : ''}</p>}
    </header>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>Discord Server Audit</h2>
      <p style={{ color: theme?.mutedText || '#94a3b8' }}>Read-only inventory of roles, categories, channels and permission overwrites. Available before AI chat is enabled. Connected servers across DEV, BETA and PRODUCTION can be inspected once the read-only service is deliberately deployed to each environment.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select aria-label="Environment and server to audit" value={selectedGuild} onChange={(event) => { setSelectedGuild(event.target.value); setAudit(null); setPreview(null); }} style={{ padding: 10, borderRadius: 10, color: '#e5e7eb', background: '#111827', flex: '1 1 220px' }}>
          {guilds.length ? guilds.map((guild) => <option key={guild.environment + ':' + guild.id} value={guild.environment + ':' + guild.id}>{guild.environment} — {guild.name}</option>) : <option value="">No servers available</option>}
        </select>
        <button type="button" onClick={refreshGuilds} style={{ border: '1px solid #64748b', borderRadius: 10, padding: '10px 16px', color: '#e5e7eb', background: '#1e293b' }}>Refresh servers</button>
        <button type="button" onClick={runAudit} disabled={!selectedGuild || auditing} style={{ border: 0, borderRadius: 10, padding: '10px 16px', background: '#2563eb', color: 'white' }}>{auditing ? 'Scanning…' : 'Scan permissions'}</button>
      </div>
      {environments.length > 0 && <p style={{ fontSize: 12, color: theme?.mutedText || '#94a3b8' }}>
        {environments.map(item => item.environment + ': ' + (item.available ? item.guildCount + ' servers' : 'not yet connected')).join(' · ')}
      </p>}
      {audit && <div style={{ marginTop: 16 }}>
        <strong>{audit.environment} — {audit.guild?.name}</strong>
        <p role="status">Found {audit.summary?.roles} roles, {audit.summary?.categories} categories, {audit.summary?.channels} channels and {audit.summary?.unsyncedChannels} unsynchronised child channels.</p>
        {audit.analysis && <div style={{ border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>Permission findings (read-only)</h3>
          <p style={{ marginTop: 0 }}>{audit.analysis.totals.high} high priority · {audit.analysis.totals.review} items to review · {audit.analysis.totals.info} informational</p>
          {(audit.analysis.findings || []).length === 0 && <p>No findings detected by the current rule set; this does not guarantee the server is secure.</p>}
          {(audit.analysis.findings || []).map((finding, index) => <div key={index} style={{ padding: '10px 0', borderTop: '1px solid rgba(148,163,184,.2)' }}>
            <strong>{finding.severity.toUpperCase()} · {finding.target?.name}</strong>
            <div>{finding.message}</div>
            <div style={{ color: theme?.mutedText || '#94a3b8', marginTop: 5 }}>Suggestion: {finding.recommendation}</div>
          </div>)}
          {audit.analysis.findingsTruncated && <p>Showing the first 200 findings. The totals include all findings.</p>}
          <p style={{ fontSize: 12, marginBottom: 0 }}>Findings are prompts for review, not confirmed vulnerabilities. No permissions are modified.</p>
        </div>}
        <button type="button" onClick={buildPlan} disabled={planning || auditing} style={{ padding: '10px 14px', border: '1px solid #64748b', borderRadius: 10, background: '#1e293b', color: '#e5e7eb' }}>{planning ? 'Preparing preview…' : 'Prepare proposed changes (preview only)'}</button>
        {preview && <section style={{ marginTop: 12, border: '1px solid #64748b', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Proposed Discord changes — no actions performed</h3>
          <p>{preview.totalProposals} suggestions · {preview.environment} · {preview.guild?.name}</p>
          <p style={{ color: '#fbbf24' }}>{preview.notice}</p>
          {preview.proposals.map(item => <details key={item.id} style={{ padding: '10px 0', borderTop: '1px solid rgba(148,163,184,.25)' }}>
            <summary>{item.risk.toUpperCase()} · {item.target.name} — {item.description}</summary>
            <p>{item.warning}</p>
            <div style={{ fontSize: 12 }}>Current</div>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(item.before, null, 2)}</pre>
            {item.proposed && <><div style={{ fontSize: 12 }}>Suggested</div><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(item.proposed, null, 2)}</pre></>}
          </details>)}
          {preview.truncated && <p>Showing first 100 suggestions. Additional reviews were detected.</p>}
          <p style={{ fontSize: 12 }}>No apply button exists. These are non-executable review proposals only.</p>
        </section>}
        <details><summary>View role and channel inventory</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, maxHeight: 360, overflowY: 'auto' }}>{JSON.stringify({ roles: audit.roles, channels: audit.channels }, null, 2)}</pre>
        </details>
      </div>}
    </section>
    {audit && <p style={{ color: theme?.mutedText || '#94a3b8', fontSize: 13, margin: 0 }}>When AI chat is enabled, replies will use a fresh read-only audit of <strong>{audit.environment} — {audit.guild?.name}</strong> for context. No changes can be made from chat.</p>}
    <div aria-label="Conversation" style={{ ...panel, minHeight: 280, maxHeight: '52vh', overflowY: 'auto', display: 'grid', alignContent: 'start', gap: 12 }}>
      {messages.map((message, index) => <div key={index} style={{ maxWidth: '94%', justifySelf: message.role === 'user' ? 'end' : 'start', padding: 12, borderRadius: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: message.role === 'user' ? 'rgba(37,99,235,.3)' : 'rgba(148,163,184,.14)' }}>
        <strong style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>{message.role === 'user' ? 'You' : 'Goliath AI'}</strong>{message.content}
      </div>)}
      <div ref={bottom} />
    </div>
    {error && <div role="alert" style={{ color: '#fca5a5' }}>{error}</div>}
    <form onSubmit={send} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <label htmlFor="goliath-ai-prompt" style={{ width: '100%', fontWeight: 700 }}>Your message</label>
      <textarea id="goliath-ai-prompt" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 4000))} rows={3} maxLength={4000} placeholder="Ask Goliath AI…" disabled={!status?.enabled || busy} style={{ flex: '1 1 240px', minWidth: 0, borderRadius: 12, padding: 12, color: '#e5e7eb', background: '#111827', border: '1px solid #475569', font: 'inherit' }} />
      <button type="submit" disabled={!status?.enabled || busy || !draft.trim()} style={{ alignSelf: 'end', padding: '12px 22px', borderRadius: 12, border: 0, background: '#2563eb', color: 'white', cursor: 'pointer', opacity: !status?.enabled || busy ? .5 : 1 }}>{busy ? 'Thinking…' : 'Send'}</button>
    </form>
    <p style={{ color: theme?.mutedText || '#94a3b8', fontSize: 12, margin: 0 }}>Conversations currently remain in this browser tab only. This first version cannot change Discord settings or control your PC.</p>
  </section>;
}
