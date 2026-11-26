import React, { useState } from 'react';

export function appendVariable(value, token, limit) {
  const current = String(value ?? '');
  return current.length + token.length <= limit ? current + token : current;
}

export default function VariableReference({ theme, tokens = [], onInsert, note, remaining }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const list = [...new Set(Array.isArray(tokens) ? tokens.filter(token => typeof token === 'string' && /^\{(?:[a-zA-Z][a-zA-Z0-9_.-]*|[0-9]+)\}$/.test(token)) : [])];
  const filtered = list.filter(token => token.toLowerCase().includes(search.trim().toLowerCase()));
  function insert(token) {
    if (Number.isFinite(remaining) && token.length > remaining) { setStatus('Not enough space for this variable. Shorten the message first.'); return; }
    onInsert(token); setStatus('Variable inserted.');
  }
  const style = { color: theme.cardText, background: theme.softBg, border: '1px solid ' + theme.cardBorder, borderRadius: 8, padding: 8, cursor: 'pointer' };
  async function copy(value = list.join('\n')) {
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy('');
      setStatus('Copied to clipboard.');
    } catch {
      setManualCopy(value);
      setStatus('Clipboard unavailable. Select and copy the text below.');
    }
  }
  return <details style={{ minWidth: 0 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 900 }}>Variables</summary>
    <p style={{ color: theme.mutedText }}>{note || (onInsert ? 'Select a variable to insert it into your template.' : 'Select a variable to copy it.')}</p>
    {list.length ? <>
      <input aria-label="Search variables" placeholder="Search variables" value={search} onChange={event=>setSearch(event.target.value)} style={{...style,width:'100%',boxSizing:'border-box',cursor:'text'}} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight:240, overflowY:'auto' }}>
        {filtered.map(token => onInsert ? <button type="button" key={token} style={style} onClick={() => insert(token)}>{token}</button> : <button type="button" key={token} style={style} title="Copy variable" onClick={()=>copy(token)}>{token}</button>)}
      </div>
      {!filtered.length && <span>No matching variables.</span>}
      <button type="button" style={{ ...style, marginTop: 8 }} onClick={()=>copy()}>Copy all variables</button>
      {manualCopy && <textarea aria-label="Variables to copy manually" readOnly value={manualCopy} onFocus={event=>event.target.select()} style={{width:'100%',boxSizing:'border-box',color:theme.cardText,background:theme.softBg}} />}
      <span role="status" style={{ display: 'block', color: theme.mutedText }}>{status}</span>
    </> : <span>Variable list unavailable.</span>}
  </details>;
}
