import React, { useState } from 'react';

export default function VariableReference({ theme, tokens = [], onInsert, note }) {
  const [status, setStatus] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const list = [...new Set(Array.isArray(tokens) ? tokens.filter(token => typeof token === 'string' && /^\{(?:[a-zA-Z][a-zA-Z0-9_.-]*|[0-9]+)\}$/.test(token)) : [])];
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map(token => onInsert ? <button type="button" key={token} style={style} onClick={() => onInsert(token)}>{token}</button> : <button type="button" key={token} style={style} title="Copy variable" onClick={()=>copy(token)}>{token}</button>)}
      </div>
      <button type="button" style={{ ...style, marginTop: 8 }} onClick={()=>copy()}>Copy all variables</button>
      {manualCopy && <textarea aria-label="Variables to copy manually" readOnly value={manualCopy} onFocus={event=>event.target.select()} style={{width:'100%',boxSizing:'border-box',color:theme.cardText,background:theme.softBg}} />}
      <span role="status" style={{ display: 'block', color: theme.mutedText }}>{status}</span>
    </> : <span>Variable list unavailable.</span>}
  </details>;
}
