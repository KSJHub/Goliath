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
  const [blueprintText, setBlueprintText] = useState('');
  const [blueprintPlan, setBlueprintPlan] = useState(null);
  const [blueprintBusy, setBlueprintBusy] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newChannelLines, setNewChannelLines] = useState('');
  const [targetCategoryIndex, setTargetCategoryIndex] = useState('0');
  const [newSingleChannel, setNewSingleChannel] = useState('');
  const [newSingleType, setNewSingleType] = useState('text');
  const [aiLayoutRequest, setAiLayoutRequest] = useState('');
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [readiness, setReadiness] = useState(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [operationReviews, setOperationReviews] = useState(null);
  const [operationReviewBusy, setOperationReviewBusy] = useState(false);
  const bottom = useRef(null);
  useEffect(() => {
    let mounted = true;
    api.request('/api/owner/ai/status').then((value) => { if (mounted) setStatus(value); })
      .catch((err) => { if (mounted) setError(err.message); });
    api.request('/api/owner/ai/drafts').then(value => { if (mounted) setSavedDrafts(value.drafts || []); })
      .catch(() => { /* The draft library is optional until DEV deployment is verified. */ });
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
      setAudit(null); setPreview(null); replaceBlueprintText(''); setBlueprintPlan(null); setReadiness(null); setOperationReviews(null);
    } catch (err) { setError(err.message); }
  };
  const runAudit = async () => {
    if (!selectedGuild || auditing) return;
    setAuditing(true); setError(''); setAudit(null); setPreview(null); setBlueprintPlan(null); replaceBlueprintText(''); setReadiness(null); setOperationReviews(null);
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
      if (!['DEV', 'BETA', 'PRODUCTION'].includes(environment) || !/^\d{16,20}$/.test(guildId)) throw new Error('Invalid selected server.');
      const result = await api.request('/api/owner/ai/plan/' + environment + '/' + guildId);
      if (result.environment !== environment || result.guild?.id !== guildId || result.executable !== false) throw new Error('Preview validation failed.');
      setPreview(result);
    } catch (err) { setError(err.message); }
    finally { setPlanning(false); }
  };
  // Changing editor content invalidates previews and saved-plan diagnostics immediately.
  const replaceBlueprintText = value => {
    setBlueprintText(value);
    setBlueprintPlan(null);
    setReadiness(null);
    setOperationReviews(null);
  };
  const loadBlueprint = async () => {
    if (!audit || blueprintBusy) return;
    setBlueprintBusy(true); setError(''); setBlueprintPlan(null);
    try {
      const result = await api.request('/api/owner/ai/blueprint/' + audit.environment + '/' + audit.guild.id);
      if (!result.readOnly || result.environment !== audit.environment || result.guild?.id !== audit.guild.id) throw new Error('Blueprint target mismatch.');
      replaceBlueprintText(JSON.stringify(result.blueprint, null, 2));
    } catch (err) { setError(err.message); }
    finally { setBlueprintBusy(false); }
  };
  const generateLayoutDraft = async () => {
    if (!status?.enabled || !aiLayoutRequest.trim() || aiDraftBusy) return;
    setAiDraftBusy(true); setError(''); setBlueprintPlan(null);
    try {
      const result = await api.request('/api/owner/ai/blueprint/ai-draft', {
        method: 'POST', body: JSON.stringify({ description: aiLayoutRequest.trim() })
      });
      if (!result.readOnly || result.executable !== false || !Array.isArray(result.categories)) throw new Error('AI draft verification failed.');
      const raw = blueprintText.trim() ? JSON.parse(blueprintText) : { name: 'AI-assisted Discord rebuild', categories: [] };
      if (!Array.isArray(raw.categories)) throw new Error('Invalid current blueprint.');
      const existingNames = new Set(raw.categories.map(category => String(category.name || '').toLowerCase()));
      let added = 0;
      for (const category of result.categories) {
        if (existingNames.has(category.name.toLowerCase())) continue;
        existingNames.add(category.name.toLowerCase());
        raw.categories.push(category); added += 1;
      }
      if (!added) throw new Error('The AI only suggested categories already in your blueprint. No changes were made.');
      replaceBlueprintText(JSON.stringify(raw, null, 2));
      setAiLayoutRequest('');
    } catch (err) { setError(err.message); }
    finally { setAiDraftBusy(false); }
  };
  const categoriesForEditor = (() => {
    try {
      const parsed = JSON.parse(blueprintText);
      return Array.isArray(parsed?.categories) ? parsed.categories : [];
    } catch { return []; }
  })();
  const addChannelToExistingCategory = () => {
    setError(''); setBlueprintPlan(null);
    try {
      const name = newSingleChannel.trim();
      if (!name || name.length > 100) throw new Error('Enter a channel name of up to 100 characters.');
      const parsed = JSON.parse(blueprintText);
      const index = Number(targetCategoryIndex);
      if (!Array.isArray(parsed.categories) || !Number.isInteger(index) || index < 0 ||
          index >= parsed.categories.length) throw new Error('Select a valid category.');
      const category = parsed.categories[index];
      if (!Array.isArray(category.channels)) throw new Error('Selected category has an invalid channels list.');
      if (category.channels.some(item => item.name === name && (item.type || 'text') === newSingleType)) {
        throw new Error('A channel with that name and type is already in this category.');
      }
      category.channels.push({ name, type: newSingleType });
      replaceBlueprintText(JSON.stringify(parsed, null, 2));
      setNewSingleChannel('');
    } catch (err) { setError(err.message); }
  };
  const addCategoryToBlueprint = () => {
    setError(''); setBlueprintPlan(null);
    try {
      const name = newCategoryName.trim();
      if (!name || name.length > 100) throw new Error('Enter a category name of up to 100 characters.');
      const raw = blueprintText.trim() ? JSON.parse(blueprintText) : { name: 'Discord rebuild', categories: [] };
      if (!Array.isArray(raw.categories)) throw new Error('Blueprint categories must be an array.');
      if (raw.categories.some(category => category.name?.toLowerCase() === name.toLowerCase())) throw new Error('That category is already in your blueprint.');
      const channels = newChannelLines.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const parts = line.split('|').map(part => part.trim());
        if (parts.length > 2) throw new Error('Use one channel per line in the format: name | type.');
        const [channelName, channelType = 'text'] = parts;
        if (!channelName || channelName.length > 100) throw new Error('Channel names must be 1–100 characters.');
        if (!['text', 'voice', 'forum', 'announcement', 'stage'].includes(channelType)) throw new Error('Unsupported channel type: ' + channelType);
        return { name: channelName, type: channelType };
      });
      raw.categories.push({ name, channels });
      replaceBlueprintText(JSON.stringify(raw, null, 2));
      setNewCategoryName(''); setNewChannelLines('');
    } catch (err) { setError(err.message); }
  };
  const importBlueprint = async (file) => {
    if (!file) return;
    setError(''); setBlueprintPlan(null);
    try {
      if (file.size > 256000) throw new Error('Blueprint file is too large (256 KB maximum).');
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.categories)) throw new Error('Selected file is not a valid Goliath blueprint.');
      replaceBlueprintText(JSON.stringify(raw, null, 2));
    } catch (err) { setError(err.message); }
  };
  const exportBlueprint = () => {
    setError('');
    try {
      const parsed = JSON.parse(blueprintText);
      if (!parsed || !Array.isArray(parsed.categories)) throw new Error('A valid blueprint is required before export.');
      const json = JSON.stringify(parsed, null, 2);
      const file = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'goliath-ai-blueprint-' + (audit?.environment || 'dev').toLowerCase() + '-' + (audit?.guild?.id || 'guild') + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };
  const previewBlueprint = async () => {
    if (!audit || !blueprintText.trim() || blueprintBusy) return;
    setBlueprintBusy(true); setBlueprintPlan(null); setError('');
    try {
      let blueprint;
      try { blueprint = JSON.parse(blueprintText); } catch { throw new Error('Blueprint must be valid JSON.'); }
      const result = await api.request('/api/owner/ai/blueprint/' + audit.environment + '/' + audit.guild.id + '/preview', {
        method: 'POST', body: JSON.stringify({ blueprint })
      });
      if (result.environment !== audit.environment || result.guild?.id !== audit.guild.id || result.executable !== false) throw new Error('Preview target verification failed.');
      setBlueprintPlan(result);
    } catch (err) { setError(err.message); }
    finally { setBlueprintBusy(false); }
  };
  const refreshDrafts = async () => {
    const value = await api.request('/api/owner/ai/drafts');
    setSavedDrafts(value.drafts || []);
  };
  const saveCurrentDraft = async () => {
    if (!audit || !blueprintText.trim() || draftBusy) return;
    setDraftBusy(true); setDraftNotice(''); setError('');
    try {
      const blueprint = JSON.parse(blueprintText);
      const title = String(blueprint?.name || audit.guild.name + ' rebuild');
      const result = await api.request('/api/owner/ai/drafts', {
        method: 'POST',
        body: JSON.stringify({ environment: audit.environment, guildId: audit.guild.id,
          blueprint, title, auditDigest: blueprintPlan?.auditDigest || undefined })
      });
      if (result.draft?.environment !== audit.environment || result.draft?.guildId !== audit.guild.id)
        throw new Error('Saved draft target mismatch.');
      await refreshDrafts();
      setDraftNotice('Saved a private draft. It cannot modify the Discord server.');
    } catch (err) { setError(err.message); }
    finally { setDraftBusy(false); }
  };
  const openSavedDraft = async (id) => {
    if (!audit || draftBusy) return;
    setDraftBusy(true); setError(''); setDraftNotice('');
    try {
      const result = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id));
      const item = result.draft;
      if (!item || item.environment !== audit.environment || item.guildId !== audit.guild.id)
        throw new Error('Select and scan the draft’s original environment and server before opening it.');
      replaceBlueprintText(JSON.stringify(item.blueprint, null, 2));
      setBlueprintPlan(null);
      setDraftNotice('Draft loaded. Run a fresh preview before relying on any proposed change.');
    } catch (err) { setError(err.message); }
    finally { setDraftBusy(false); }
  };
  const reviewSavedDraft = async (id) => {
    if (!audit || draftBusy) return;
    setDraftBusy(true); setError(''); setDraftNotice('');
    try {
      const item = savedDrafts.find(value => value.id === id);
      if (!item || item.environment !== audit.environment || item.guildId !== audit.guild.id)
        throw new Error('Select the saved draft’s original server before reviewing it.');
      const result = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id) + '/review', {
        method: 'POST', body: JSON.stringify({})
      });
      await refreshDrafts();
      setDraftNotice(result.notice || 'Review recorded. This does not authorise execution.');
    } catch (err) { setError(err.message); }
    finally { setDraftBusy(false); }
  };
  const checkDraftReadiness = async (id) => {
    if (!audit || readinessBusy) return;
    setReadinessBusy(true); setError(''); setReadiness(null); setOperationReviews(null);
    try {
      const item = savedDrafts.find(value => value.id === id);
      if (!item || item.environment !== audit.environment || item.guildId !== audit.guild.id)
        throw new Error('Select and scan the exact environment and guild for this saved draft.');
      const result = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id) + '/readiness');
      if (result.draftId !== id || result.environment !== audit.environment ||
          result.guildId !== audit.guild.id || result.canExecute !== false || result.executable !== false)
        throw new Error('Execution readiness target validation failed.');
      setReadiness(result);
    } catch (err) { setError(err.message); }
    finally { setReadinessBusy(false); }
  };
  const inspectOperationReviews = async (id) => {
    if (!audit || operationReviewBusy) return;
    setOperationReviewBusy(true); setError(''); setOperationReviews(null); setReadiness(null);
    try {
      const result = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id) + '/operation-reviews');
      if (result.draftId !== id || result.environment !== audit.environment ||
          result.guildId !== audit.guild.id || result.canExecute !== false) throw new Error('Review target mismatch.');
      setOperationReviews(result);
    } catch (err) { setError(err.message); }
    finally { setOperationReviewBusy(false); }
  };
  const recordOperationReview = async (id, sequence, decision) => {
    if (operationReviewBusy) return;
    setOperationReviewBusy(true); setError('');
    try {
      const result = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id) + '/operation-reviews', {
        method: 'POST', body: JSON.stringify({ sequence, decision })
      });
      if (result.canExecute !== false || result.executable !== false) throw new Error('Review response unsafe.');
      const latest = await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id) + '/operation-reviews');
      setOperationReviews(latest);
      setDraftNotice(result.notice);
    } catch (err) { setError(err.message); }
    finally { setOperationReviewBusy(false); }
  };
  const removeSavedDraft = async (id) => {
    if (draftBusy || !window.confirm('Delete this saved Goliath AI blueprint draft? No Discord items will be deleted.')) return;
    setDraftBusy(true); setError(''); setDraftNotice('');
    try {
      await api.request('/api/owner/ai/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
      await refreshDrafts();
      setDraftNotice('Saved draft deleted; Discord was not changed.');
    } catch (err) { setError(err.message); }
    finally { setDraftBusy(false); }
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
        <select aria-label="Environment and server to audit" value={selectedGuild} onChange={(event) => { setSelectedGuild(event.target.value); setAudit(null); setPreview(null); setBlueprintPlan(null); replaceBlueprintText(''); setReadiness(null); setOperationReviews(null); }} style={{ padding: 10, borderRadius: 10, color: '#e5e7eb', background: '#111827', flex: '1 1 220px' }}>
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
        <section style={{ border: '1px solid rgba(148,163,184,.25)', borderRadius: 12, padding: 14, marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Server Layout Blueprint (preview only)</h3>
          <p style={{ color: theme?.mutedText || '#94a3b8' }}>Load the current server layout as editable JSON. Add or rename categories and channels in the blueprint, then generate a proposed change list. Existing content is preserved. Nothing can be applied from this screen.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={loadBlueprint} disabled={blueprintBusy} style={{ padding: '10px 14px', borderRadius: 10, color: 'white', background: '#1e293b', border: '1px solid #64748b' }}>{blueprintBusy ? 'Working…' : 'Load current layout'}</button>
            <label style={{ padding: '10px 14px', borderRadius: 10, color: 'white', background: '#1e293b', border: '1px solid #64748b', cursor: 'pointer' }}>
              Import JSON blueprint
              <input type="file" accept=".json,application/json" aria-label="Import a Goliath AI blueprint JSON file"
                onChange={event => { void importBlueprint(event.target.files?.[0]); event.target.value = ''; }}
                style={{ display: 'block', width: 140, marginTop: 6, fontSize: 11 }} />
            </label>
            <button type="button" onClick={exportBlueprint} disabled={!blueprintText.trim()} style={{ padding: '10px 14px', borderRadius: 10, color: 'white', background: '#1e293b', border: '1px solid #64748b' }}>Export JSON blueprint</button>
            <button type="button" onClick={previewBlueprint} disabled={blueprintBusy || !blueprintText.trim()} style={{ padding: '10px 14px', borderRadius: 10, color: 'white', background: '#2563eb', border: 'none' }}>Preview layout changes</button>
          </div>
          <div style={{ padding: 12, border: '1px solid rgba(148,163,184,.23)', borderRadius: 10, marginTop: 12 }}>
            <strong>Ask Goliath AI to draft new categories</strong>
            <p style={{ fontSize: 12, color: theme?.mutedText || '#94a3b8' }}>Describe the categories and channels you want. The AI will append suggestions to your blueprint, not your Discord server. This requires the free local model to be running.</p>
            <textarea value={aiLayoutRequest} onChange={event => setAiLayoutRequest(event.target.value.slice(0, 1200))}
              placeholder="Create a Community category with introductions and general chat, and a Gaming category with looking-for-group and a voice channel."
              rows={3} maxLength={1200} disabled={!status?.enabled || aiDraftBusy} aria-label="AI category draft request"
              style={{ boxSizing: 'border-box', width: '100%', padding: 10, borderRadius: 8, background: '#111827', color: '#e5e7eb', border: '1px solid #64748b' }}/>
            <button type="button" onClick={generateLayoutDraft} disabled={!status?.enabled || aiDraftBusy || !aiLayoutRequest.trim()}
              style={{ padding: '10px 14px', borderRadius: 10, background: '#334155', border: 0, color: 'white' }}>
              {aiDraftBusy ? 'Generating draft…' : 'Generate suggestions (no changes)'}
            </button>
          </div>
          <div style={{ padding: 12, border: '1px solid rgba(148,163,184,.23)', borderRadius: 10, marginTop: 12 }}>
            <strong>Add a new category to the blueprint</strong>
            <label htmlFor="goliath-ai-category" style={{ display: 'block', marginTop: 10 }}>Category name</label>
            <input id="goliath-ai-category" value={newCategoryName} maxLength={100}
              onChange={event => setNewCategoryName(event.target.value)} placeholder="e.g. The Rough"
              style={{ boxSizing: 'border-box', width: '100%', padding: 10, borderRadius: 8, background: '#111827', color: '#e5e7eb', border: '1px solid #64748b' }}/>
            <label htmlFor="goliath-ai-channels" style={{ display: 'block', marginTop: 10 }}>Channels (one per line, optional type after |)</label>
            <textarea id="goliath-ai-channels" value={newChannelLines} rows={4}
              onChange={event => setNewChannelLines(event.target.value)} placeholder={'general | text\nvoice-lounge | voice'}
              style={{ boxSizing: 'border-box', width: '100%', padding: 10, borderRadius: 8, background: '#111827', color: '#e5e7eb', border: '1px solid #64748b' }}/>
            <button type="button" onClick={addCategoryToBlueprint} disabled={!newCategoryName.trim()}
              style={{ padding: '10px 14px', background: '#334155', color: 'white', border: 0, borderRadius: 10 }}>Add to blueprint (not Discord)</button>
          </div>
          <section style={{ border: '1px solid rgba(148,163,184,.25)', padding: 12, borderRadius: 10, marginTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>Saved developer plans</h4>
            <p style={{ fontSize: 12, color: theme?.mutedText || '#94a3b8' }}>Private DEV storage · up to 30 drafts · accessible only to your two developer accounts · reviews do not execute changes</p>
            <button type="button" onClick={saveCurrentDraft} disabled={draftBusy || !blueprintText.trim()}
              style={{ padding: '10px 14px', border: 0, borderRadius: 9, background: '#334155', color: 'white' }}>
              {draftBusy ? 'Working…' : 'Save current blueprint'}
            </button>
            <button type="button" onClick={() => { void refreshDrafts().catch(err => setError(err.message)); }}
              style={{ padding: '10px 14px', border: '1px solid #64748b', marginLeft: 8, borderRadius: 9, background: '#1e293b', color: 'white' }}>
              Refresh drafts
            </button>
            {draftNotice && <p role="status" style={{ color: '#86efac' }}>{draftNotice}</p>}
            {savedDrafts.filter(item => item.environment === audit.environment && item.guildId === audit.guild.id).map(item =>
              <div key={item.id} style={{ borderTop: '1px solid rgba(148,163,184,.2)', padding: '12px 0', marginTop: 10 }}>
                <strong>{item.title}</strong>
                <p style={{ fontSize: 12, margin: '4px 0' }}>{item.review?.status === 'reviewed' ? 'Reviewed (not approved for execution)' : 'Draft'} · {new Date(item.updatedAt).toLocaleString()}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" disabled={draftBusy} onClick={() => openSavedDraft(item.id)}>Load</button>
                  <button type="button" disabled={draftBusy} onClick={() => reviewSavedDraft(item.id)}>Mark reviewed</button>
                  <button type="button" disabled={draftBusy || readinessBusy} onClick={() => checkDraftReadiness(item.id)}>Check execution readiness</button>
                  <button type="button" disabled={draftBusy || operationReviewBusy} onClick={() => inspectOperationReviews(item.id)}>Operation reviews</button>
                  <button type="button" disabled={draftBusy} onClick={() => removeSavedDraft(item.id)}>Delete draft</button>
                </div>
              </div>
            )}
            {operationReviews && <div style={{ border: '1px solid #64748b', borderRadius: 10, padding: 12, marginTop: 12 }}>
              <h4 style={{ marginTop: 0 }}>Operation review log — no Discord execution</h4>
              {operationReviews.stale && <p style={{ color: '#fbbf24' }}>This plan is stale. Save and review a fresh plan before acknowledging operations.</p>}
              {!operationReviews.stale && operationReviews.operations.map(item =>
                <div key={item.sequence} style={{ padding: '10px 0', borderTop: '1px solid rgba(148,163,184,.25)' }}>
                  <strong>{item.sequence}. {item.kind.replaceAll('_', ' ')} — {item.target?.name}</strong>
                  <p style={{ fontSize: 12 }}>{item.reviews.length
                    ? item.reviews.map(review => review.decision + ' by ' + review.reviewerId + ' (expires ' + new Date(review.expiresAt).toLocaleString() + ')').join(' · ')
                    : 'No current acknowledgement'}</p>
                  <button type="button" disabled={operationReviewBusy} onClick={() => recordOperationReview(operationReviews.draftId, item.sequence, 'acknowledged')}>Acknowledge review</button>
                  <button type="button" disabled={operationReviewBusy} style={{ marginLeft: 8 }} onClick={() => recordOperationReview(operationReviews.draftId, item.sequence, 'rejected')}>Reject proposal</button>
                </div>)}
              <details style={{ marginTop: 10 }}><summary>Review audit history ({operationReviews.events?.length || 0})</summary>
                {(operationReviews.events || []).map(event => <p key={event.id} style={{ fontSize: 12 }}>
                  {event.createdAt} · operation {event.sequence} · {event.decision} · reviewer {event.reviewerId}
                </p>)}
              </details>
              <p style={{ color: '#fbbf24', fontSize: 12 }}>Acknowledgements are for developer review only. They expire and never grant execution permission.</p>
            </div>}
            {readiness && <div style={{ border: '1px solid #64748b', borderRadius: 10, padding: 12, marginTop: 12 }}>
              <h4 style={{ marginTop: 0 }}>Execution safeguards — not ready to apply</h4>
              <p role="status">{readiness.operationCount} planned operations · {readiness.blockers.length} unresolved safeguards · execution disabled</p>
              <p style={{ fontSize: 12, color: '#fbbf24' }}>{readiness.notice}</p>
              {readiness.transactionManifest && <section style={{ border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <h5 style={{ margin: '0 0 8px' }}>Deterministic change manifest — preview only</h5>
                <p style={{ fontSize: 12, color: '#fbbf24' }}>
                  {readiness.transactionManifest.unavailable
                    ? 'Manifest unavailable: saved plan, scope or audit may be stale.'
                    : readiness.transactionManifest.operationCount + ' operations; all authorisations disabled.'}
                </p>
                {readiness.transactionManifest.fingerprint && <p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>
                  SHA-256 fingerprint: <code>{readiness.transactionManifest.fingerprint}</code>
                </p>}
                {(readiness.transactionManifest.entries || []).map(entry => <details
                  key={entry.sequence} style={{ borderTop: '1px solid rgba(148,163,184,.2)', padding: '8px 0' }}>
                  <summary>{entry.sequence}. {entry.kind.replaceAll('_', ' ')}
                    {entry.dependsOn.length ? ' · requires operation ' + entry.dependsOn.join(', ') : ''}
                    {entry.issues.length ? ' · needs attention' : ''}</summary>
                  <p style={{ overflowWrap: 'anywhere', fontSize: 12 }}>Operation SHA-256: {entry.operationFingerprint}</p>
                  {entry.issues.map((issue, index) => <p key={index} style={{ fontSize: 12, color: '#fbbf24' }}>{issue}</p>)}
                </details>)}
                <p style={{ fontSize: 12 }}>Fingerprints identify a saved proposal; they are not an approval token or permission to execute.</p>
              </section>}
              {readiness.recoveryPlan && <section style={{ border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <h5 style={{ margin: '0 0 8px' }}>Rollback planning (no automatic recovery)</h5>
                <p style={{ fontSize: 12, color: '#fbbf24' }}>
                  {readiness.recoveryPlan.stale ? 'Saved snapshot is stale. ' : ''}
                  {readiness.recoveryPlan.operationCount} recovery assessments · Restore test not performed · Rollback disabled
                </p>
                {readiness.recoveryPlan.items.map(item => <details key={item.sequence}
                  style={{ padding: '8px 0', borderTop: '1px solid rgba(148,163,184,.2)' }}>
                  <summary>{item.sequence}. {item.kind.replaceAll('_', ' ')} — {item.recoveryType.replaceAll('_', ' ')}</summary>
                  <p style={{ fontSize: 12 }}>{item.recoveryDescription}</p>
                  {(item.issues || []).map((warning, index) => <p key={index} style={{ color: '#fbbf24', fontSize: 12 }}>{warning}</p>)}
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>
                    {JSON.stringify({ original: item.before, proposed: item.proposed }, null, 2)}
                  </pre>
                </details>)}
                <details style={{ marginTop: 8 }}><summary>Required before execution is ever enabled</summary>
                  <ul>{readiness.recoveryPlan.requiredBeforeExecution.map((requirement, i) => <li key={i}>{requirement}</li>)}</ul>
                </details>
              </section>}
              {readiness.capabilityPreflight && <section style={{ border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <h5 style={{ margin: '0 0 8px' }}>Bot permission and rollback preflight</h5>
                <p style={{ fontSize: 12 }}>{readiness.capabilityPreflight.permissionsVerified ? 'Read-only permission snapshot obtained.' : 'Bot permissions could not be verified.'}
                  {' · '}{readiness.capabilityPreflight.counts?.blocked || 0} blocked
                  {' · '}{readiness.capabilityPreflight.counts?.unknown || 0} unknown
                  {' · '}{readiness.capabilityPreflight.counts?.permittedInPrinciple || 0} potentially permitted</p>
                {readiness.capabilityPreflight.operations.map(item => <details key={item.sequence} style={{ borderTop: '1px solid rgba(148,163,184,.2)', padding: '8px 0' }}>
                  <summary>{item.sequence}. {item.target?.name} · {item.permission}</summary>
                  {(item.warnings || []).map((warning, index) => <p key={index} style={{ fontSize: 12, color: '#fbbf24' }}>{warning}</p>)}
                  <p style={{ fontSize: 12 }}>Recovery: {item.recovery}</p>
                </details>)}
                <p style={{ color: '#fbbf24', fontSize: 12 }}>No rollback procedure has been verified, and no operation is executable.</p>
              </section>}
              {readiness.backupEvidence && <div style={{ border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <strong>Existing Goliath backup history</strong>
                <p style={{ fontSize: 12 }}>{readiness.backupEvidence.status === 'candidate-found'
                  ? 'Matching backup metadata found (not a verified restore point).'
                  : readiness.backupEvidence.status === 'none-found'
                    ? 'No matching backup found in the recent history returned by the existing Backup Center.'
                    : 'Backup history unavailable.'}</p>
                {(readiness.backupEvidence.candidates || []).map(candidate => <div key={candidate.backupId} style={{ fontSize: 12, paddingBottom: 6 }}>
                  {candidate.backupId} · {candidate.createdAt} · {candidate.backupType}
                  {' · '}Integrity metadata: {candidate.hasIntegrityMetadata ? 'present' : 'missing'}
                  {' · '}Validation: {candidate.validationReportedValid ? 'reported valid' : 'not established'}
                </div>)}
                <p style={{ fontSize: 12, color: '#fbbf24' }}>Existing backups have not been verified for restoration here. Execution remains disabled.</p>
              </div>}
              {readiness.checks.map(check => <div key={check.key} style={{ padding: '8px 0', borderTop: '1px solid rgba(148,163,184,.25)' }}>
                <strong>{check.state.toUpperCase()} · {check.label}</strong>
                <div style={{ fontSize: 12, color: theme?.mutedText || '#94a3b8' }}>{check.detail}</div>
              </div>)}
              <details style={{ marginTop: 10 }}><summary>View operations requiring explicit approval</summary>
                {readiness.operations.map(operation => <div key={operation.sequence} style={{ borderTop: '1px solid rgba(148,163,184,.2)', padding: '8px 0' }}>
                  <strong>{operation.sequence}. {operation.kind.replaceAll('_',' ')} — {operation.target?.name}</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify({ before: operation.before, proposed: operation.proposed }, null, 2)}</pre>
                </div>)}
              </details>
              <p style={{ fontSize: 12 }}>There is no Apply button or Discord mutation endpoint. A review is not execution approval.</p>
            </div>}
            {savedDrafts.filter(item => item.environment === audit.environment && item.guildId === audit.guild.id).length === 0 &&
              <p style={{ fontSize: 12 }}>No saved plans for this environment and server.</p>}
          </section>
          {categoriesForEditor.length > 0 && <div style={{ padding: 12, border: '1px solid rgba(148,163,184,.23)', borderRadius: 10, marginTop: 12 }}>
            <strong>Add a channel to an existing blueprint category</strong>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <select aria-label="Blueprint category" value={targetCategoryIndex} onChange={event => setTargetCategoryIndex(event.target.value)}
                style={{ flex: '1 1 160px', minWidth: 0, color: 'white', background: '#111827', borderRadius: 8, padding: 9 }}>
                {categoriesForEditor.map((category, index) => <option value={String(index)} key={index}>{category.name}</option>)}
              </select>
              <input aria-label="New channel name" value={newSingleChannel} maxLength={100} onChange={event => setNewSingleChannel(event.target.value)}
                placeholder="Channel name" style={{ flex: '1 1 160px', minWidth: 0, color: 'white', background: '#111827', borderRadius: 8, padding: 9 }}/>
              <select aria-label="New channel type" value={newSingleType} onChange={event => setNewSingleType(event.target.value)}
                style={{ background: '#111827', color: 'white', borderRadius: 8, padding: 9 }}>
                {['text', 'voice', 'forum', 'announcement', 'stage'].map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <button type="button" onClick={addChannelToExistingCategory} disabled={!newSingleChannel.trim()}
              style={{ marginTop: 10, background: '#334155', color: 'white', padding: '10px 14px', border: 0, borderRadius: 10 }}>Add channel to blueprint</button>
          </div>}
          {blueprintText && <>
            <label htmlFor="goliath-ai-blueprint" style={{ display: 'block', fontWeight: 700, margin: '12px 0 6px' }}>Editable server blueprint (JSON)</label>
            <textarea id="goliath-ai-blueprint" value={blueprintText} spellCheck={false}
              onChange={(event) => { replaceBlueprintText(event.target.value); setBlueprintPlan(null); }} rows={13}
              style={{ boxSizing: 'border-box', width: '100%', resize: 'vertical', color: '#e5e7eb', background: '#0f172a', border: '1px solid #64748b', borderRadius: 10, padding: 12, fontFamily: 'monospace', fontSize: 12 }} />
            <p style={{ fontSize: 12, color: theme?.mutedText || '#94a3b8' }}>Retain existing Discord IDs when renaming. For new categories or channels, omit the ID. Supported types: text, voice, forum, announcement and stage.</p>
          </>}
          {blueprintPlan && <div role="region" aria-label="Blueprint preview" style={{ marginTop: 14 }}>
            <strong>{blueprintPlan.operationCount} proposed operations · {blueprintPlan.untouchedCount} existing items unaffected</strong>
            <p style={{ color: '#fbbf24' }}>{blueprintPlan.notice}</p>
            {(blueprintPlan.warnings || []).map((warning, index) => <p key={index} style={{ color: '#fbbf24' }}>{warning}</p>)}
            {blueprintPlan.operations.length === 0 && <p>No changes needed for this blueprint.</p>}
            {blueprintPlan.operations.map((operation, index) => <details key={index} style={{ padding: '9px 0', borderTop: '1px solid rgba(148,163,184,.2)' }}>
              <summary>{operation.kind.replaceAll('_', ' ')} · {operation.target?.name}</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify({ before: operation.before, proposed: operation.after }, null, 2)}</pre>
            </details>)}
            <p style={{ fontSize: 12 }}>This is a planning document, not an approved or executable change set.</p>
          </div>}
        </section>
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
