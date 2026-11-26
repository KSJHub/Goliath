import React, { useState } from 'react';

export default function VariableReference({ theme, tokens = [], onInsert, note = 'Select a variable to insert it into your template.' }) {
  const [status, setStatus] = useState('');
  const list = [...new Set(Array.isArray(tokens) ? tokens.filter(token => typeof token === 'string') : [])];
  const style = { color: theme.cardText, background: theme.softBg, border: '1px solid ' + theme.cardBorder, borderRadius: 8, padding: 8, cursor: 'pointer' };
  async function copy() {
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      setStatus('Variables copied.');
    } catch {
      setStatus('Clipboard unavailable. Select and copy the variable text manually.');
    }
  }
  return <details style={{ minWidth: 0 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 900 }}>Variables</summary>
    <p style={{ color: theme.mutedText }}>{note}</p>
    {list.length ? <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {list.map(token => onInsert ? <button type="button" key={token} style={style} onClick={() => onInsert(token)}>{token}</button> : <code key={token} style={style}>{token}</code>)}
      </div>
      <button type="button" style={{ ...style, marginTop: 8 }} onClick={copy}>Copy all variables</button>
      <span role="status" style={{ display: 'block', color: theme.mutedText }}>{status}</span>
    </> : <span>Variable list unavailable.</span>}
  </details>;
}
