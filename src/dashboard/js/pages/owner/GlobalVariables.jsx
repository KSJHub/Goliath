import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient.js';

const EMPTY_FORM = { key: '', value: '', category: 'Custom', description: '', enabled: true };
const endpoint = '/api/owner/variables';

export default function GlobalVariables({ theme }) {
  const [data, setData] = useState({ system: [], custom: [], modules: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = await api.request(endpoint);
      setData({ system: payload.system || [], custom: payload.custom || [], modules: payload.modules || {} });
    } catch (err) { setError(err.message || 'Could not load global variables.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filteredSystem = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.system.filter((item) => String(item.token || item.key || '').toLowerCase().includes(q)) : data.system;
  }, [data.system, search]);
  const filteredCustom = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? data.custom.filter((item) => [item.token, item.key, item.value, item.category, item.description].some((value) => String(value || '').toLowerCase().includes(q))) : data.custom;
  }, [data.custom, search]);
  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(data.modules || {})
      .map(([name, variables]) => [name, Array.isArray(variables) ? variables : []])
      .filter(([name, variables]) => !q || name.toLowerCase().includes(q) || variables.some((token) => String(token).toLowerCase().includes(q)))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [data.modules, search]);

  const submit = async (event) => {
    event.preventDefault();
    try {
      setSaving(true); setError('');
      const url = editingKey ? `${endpoint}/${encodeURIComponent(editingKey)}` : endpoint;
      await api.request(url, { method: editingKey ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      setForm(EMPTY_FORM); setEditingKey('');
      await load();
    } catch (err) { setError(err.message || 'Could not save variable.'); }
    finally { setSaving(false); }
  };

  const edit = (item) => { setEditingKey(item.key); setForm({ key: item.key, value: item.value || '', category: item.category || 'Custom', description: item.description || '', enabled: item.enabled !== false }); };
  const toggle = async (item) => { try { await api.request(`${endpoint}/${encodeURIComponent(item.key)}`, { method: 'PATCH', body: JSON.stringify({ ...item, enabled: item.enabled === false }) }); await load(); } catch (err) { setError(err.message || 'Could not update variable.'); } };
  const remove = async (item) => { if (!window.confirm(`Delete ${item.token || `{${item.key}}`}?`)) return; try { await api.request(`${endpoint}/${encodeURIComponent(item.key)}`, { method: 'DELETE' }); if (editingKey === item.key) { setEditingKey(''); setForm(EMPTY_FORM); } await load(); } catch (err) { setError(err.message || 'Could not delete variable.'); } };

  const card = { border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, padding: 20, boxShadow: theme.shadow };
  const input = { width: '100%', boxSizing: 'border-box', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 10, padding: '10px 12px' };
  const button = { border: `1px solid ${theme.cardBorder}`, background: 'rgba(59,130,246,.15)', color: theme.cardText, borderRadius: 10, padding: '9px 12px', fontWeight: 800, cursor: 'pointer' };
  const token = { border: `1px solid ${theme.cardBorder}`, borderRadius: 8, padding: '6px 8px' };

  return <div style={{ display: 'grid', gap: 18 }}>
    <section style={card}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}><div><h1 style={{ margin: 0 }}>Global Variables</h1><p style={{ color: theme.mutedText, marginBottom: 0 }}>One central variable catalogue for Goliath. System variables are protected; custom variables can be changed without editing module code.</p></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search variables or modules…" style={{ ...input, width: 280 }} /></div></section>
    {error ? <section style={{ ...card, borderColor: 'rgba(239,68,68,.5)' }}>{error}</section> : null}
    <section style={card}><h2 style={{ marginTop: 0 }}>{editingKey ? `Edit {${editingKey}}` : 'Add Custom Variable'}</h2><form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}><input required disabled={Boolean(editingKey)} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/[{}]/g, '') })} placeholder="Variable name e.g. slogan" style={input} /><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Value" style={input} /><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" style={input} /><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" style={input} /><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label><div style={{ display: 'flex', gap: 8 }}><button disabled={saving} type="submit" style={button}>{saving ? 'Saving…' : editingKey ? 'Save Changes' : 'Add Variable'}</button>{editingKey ? <button type="button" onClick={() => { setEditingKey(''); setForm(EMPTY_FORM); }} style={button}>Cancel</button> : null}</div></form></section>
    <section style={card}><h2 style={{ marginTop: 0 }}>Module Coverage <span style={{ color: theme.mutedText, fontSize: 14 }}>({filteredModules.length})</span></h2><p style={{ color: theme.mutedText }}>Live view of the module helper lists supplied by the central guild variable registry. Global helpers and enabled custom variables are added by the resolver at runtime.</p>{loading ? <p>Loading…</p> : filteredModules.length === 0 ? <p style={{ color: theme.mutedText }}>No matching module variable groups.</p> : <div style={{ display: 'grid', gap: 12 }}>{filteredModules.map(([name, variables]) => <div key={name} style={{ borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}><strong>{name}</strong><span style={{ color: theme.mutedText, fontSize: 12 }}>{variables.length} module variable{variables.length === 1 ? '' : 's'}</span></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{variables.map((item) => <code key={`${name}:${item}`} style={token}>{item}</code>)}</div></div>)}</div>}</section>
    <section style={card}><h2 style={{ marginTop: 0 }}>Custom Variables <span style={{ color: theme.mutedText, fontSize: 14 }}>({filteredCustom.length})</span></h2>{loading ? <p>Loading…</p> : filteredCustom.length === 0 ? <p style={{ color: theme.mutedText }}>No custom variables yet.</p> : <div style={{ display: 'grid', gap: 8 }}>{filteredCustom.map((item) => <div key={item.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(180px,2fr) auto', gap: 10, alignItems: 'center', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 10 }}><div><strong>{item.token || `{${item.key}}`}</strong><div style={{ color: theme.mutedText, fontSize: 12 }}>{item.category || 'Custom'} · {item.enabled === false ? 'Disabled' : 'Enabled'}</div></div><div><div>{item.value || <span style={{ color: theme.mutedText }}>Empty value</span>}</div>{item.description ? <div style={{ color: theme.mutedText, fontSize: 12 }}>{item.description}</div> : null}</div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button style={button} onClick={() => edit(item)}>Edit</button><button style={button} onClick={() => toggle(item)}>{item.enabled === false ? 'Enable' : 'Disable'}</button><button style={button} onClick={() => remove(item)}>Delete</button></div></div>)}</div>}</section>
    <section style={card}><h2 style={{ marginTop: 0 }}>System Variables <span style={{ color: theme.mutedText, fontSize: 14 }}>({filteredSystem.length})</span></h2><p style={{ color: theme.mutedText }}>Built into Goliath and protected from editing or deletion.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{filteredSystem.map((item) => <code key={item.token || item.key} style={token}>{item.token || `{${item.key}}`}</code>)}</div></section>
  </div>;
}
