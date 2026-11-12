import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient.js';

const panel = { border: '1px solid rgba(148,163,184,.24)', borderRadius: 16, background: 'rgba(15,23,42,.65)', padding: 16 };
const first = [{ role: 'assistant', content: 'Welcome to Goliath AI. This is your private developer chat. The free local model must be installed and enabled before I can reply.' }];
export default function GoliathAI({ theme }) {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState(first);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [guilds, setGuilds] = useState([]);
  const [selectedGuild, setSelectedGuild] = useState('');
  const [audit, setAudit] = useState(null);
  const [auditing, setAuditing] = useState(false);
  const bottom = useRef(null);
  useEffect(() => {
    let mounted = true;
    api.request('/api/owner/ai/status').then((value) => { if (mounted) setStatus(value); })
      .catch((err) => { if (mounted) setError(err.message); });
    api.request('/api/owner/ai/guilds').then((value) => { if (mounted) { setGuilds(value.guilds || []); setSelectedGuild(value.guilds?.[0]?.id || ''); } })
      .catch((err) => { if (mounted) setError(err.message); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [messages]);
  const runAudit = async () => {
    if (!selectedGuild || auditing) return;
    setAuditing(true); setError(''); setAudit(null);
    try { setAudit(await api.request('/api/owner/ai/audit/' + encodeURIComponent(selectedGuild))); }
    catch (err) { setError(err.message); }
    finally { setAuditing(false); }
  };
  const send = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy || !status?.enabled) return;
    const next = [...messages.filter((item, index) => index !== 0 || item.role !== 'assistant'), { role: 'user', content }];
    const history = next.slice(-16);
    setMessages(next); setDraft(''); setBusy(true); setError('');
    try {
      const result = await api.request('/api/owner/ai/chat', { method: 'POST', body: JSON.stringify({ messages: history }) });
      setMessages((items) => [...items, { role: 'assistant', content: result.reply }]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <section style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto', color: theme?.cardText || '#e5e7eb' }}>
    <header style={panel}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Goliath AI</h1>
      <p style={{ margin: 0, color: theme?.mutedText || '#94a3b8' }}>Developer-only · Free local inference · No paid AI API · DEV environment</p>
      <p role="status" style={{ marginBottom: 0, color: status?.enabled ? '#86efac' : '#fbbf24' }}>{status ? (status.enabled ? 'Local AI enabled' : 'Local AI not enabled') : 'Checking local AI…'}</p>
      {status?.notice && <p style={{ color: theme?.mutedText || '#94a3b8' }}>{status.notice}</p>}
    </header>
    <section style={panel}>
      <h2 style={{ marginTop: 0, fontSize: 20 }}>Discord Server Audit</h2>
      <p style={{ color: theme?.mutedText || '#94a3b8' }}>Read-only inventory of roles, categories, channels and permission overwrites. Available before AI chat is enabled. Only servers connected to the DEV bot can be inspected here.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select aria-label="Server to audit" value={selectedGuild} onChange={(event) => { setSelectedGuild(event.target.value); setAudit(null); }} style={{ padding: 10, borderRadius: 10, color: '#e5e7eb', background: '#111827', flex: '1 1 220px' }}>
          {guilds.length ? guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>) : <option value="">No DEV servers connected</option>}
        </select>
        <button type="button" onClick={runAudit} disabled={!selectedGuild || auditing} style={{ border: 0, borderRadius: 10, padding: '10px 16px', background: '#2563eb', color: 'white' }}>{auditing ? 'Scanning…' : 'Scan permissions'}</button>
      </div>
      {audit && <div style={{ marginTop: 16 }}>
        <strong>{audit.guild?.name}</strong>
        <p role="status">Found {audit.summary?.roles} roles, {audit.summary?.categories} categories, {audit.summary?.channels} channels and {audit.summary?.unsyncedChannels} unsynchronised child channels.</p>
        <details><summary>View role and channel inventory</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, maxHeight: 360, overflowY: 'auto' }}>{JSON.stringify({ roles: audit.roles, channels: audit.channels }, null, 2)}</pre>
        </details>
      </div>}
    </section>
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
