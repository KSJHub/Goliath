import React, { useEffect, useRef, useState } from 'react';

let showDialog = null;
const waiting = [];
function requestDialog(options) {
  return new Promise((resolve) => {
    const entry = { options, resolve };
    waiting.push(entry);
    showDialog?.();
  });
}
export const goliathDialog = {
  confirm: (message, options = {}) => requestDialog({ ...options, message, kind: 'confirm' }),
  alert: (message, options = {}) => requestDialog({ ...options, message, kind: 'alert' }),
  prompt: (message, options = {}) => requestDialog({ ...options, message, kind: 'prompt' }),
};

export default function GoliathDialogHost() {
  const [current, setCurrent] = useState(null);
  const [input, setInput] = useState('');
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  useEffect(() => {
    showDialog = () => setCurrent((previous) => previous || waiting.shift() || null);
    showDialog();
    return () => { showDialog = null; };
  }, []);
  useEffect(() => {
    if (!current && waiting.length) setCurrent(waiting.shift());
  }, [current]);
  useEffect(() => {
    if (!current) return undefined;
    previousFocusRef.current = document.activeElement;
    setInput(current.options.defaultValue ?? '');
    const frame = requestAnimationFrame(() => {
      const focusTarget = dialogRef.current?.querySelector('[data-initial-focus]');
      focusTarget?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
    };
  }, [current]);
  function finish(value) {
    current?.resolve(value);
    setCurrent(null);
  }
  useEffect(() => {
    if (!current) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(current.options.kind === 'prompt' ? null : false); }
      if (event.key === 'Tab') {
        const items = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || [])];
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);
  if (!current) return null;
  const { options } = current;
  const destructive = options.danger === true;
  const title = options.title || (options.kind === 'confirm' ? 'Confirm Action' : options.kind === 'prompt' ? 'Enter Details' : 'Goliath Notification');
  return <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(2,6,23,.82)', display: 'grid', placeItems: 'center', padding: 20 }}>
    <div ref={dialogRef} role={options.kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="goliath-dialog-title" aria-describedby="goliath-dialog-message" style={{ width: 'min(470px,100%)', background: '#0b1427', border: '1px solid #263653', borderRadius: 18, padding: 24, color: '#f8fafc', boxShadow: '0 24px 80px rgba(0,0,0,.5)' }}>
      <div style={{ fontSize: 12, letterSpacing: 1.5, color: '#60a5fa', fontWeight: 800, marginBottom: 10 }}>GOLIATH</div>
      <h2 id="goliath-dialog-title" style={{ margin: '0 0 12px', fontSize: 22 }}>{title}</h2>
      <p id="goliath-dialog-message" style={{ lineHeight: 1.65, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{options.message}</p>
      {destructive && <p style={{ color: '#f87171', fontWeight: 800 }}>This action may be irreversible.</p>}
      {options.kind === 'prompt' && <input data-initial-focus value={input} onChange={(event) => setInput(event.target.value)} aria-label={options.inputLabel || title} style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 10, background: '#111e35', color: 'white', border: '1px solid #334155' }} />}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
        {options.kind !== 'alert' && <button type="button" data-initial-focus={destructive ? true : undefined} onClick={() => finish(options.kind === 'prompt' ? null : false)} style={{ padding: '10px 16px', borderRadius: 10, background: '#263349', color: 'white', border: 0, cursor: 'pointer' }}>Cancel</button>}
        <button type="button" data-initial-focus={!destructive && options.kind !== 'prompt' ? true : undefined} onClick={() => finish(options.kind === 'prompt' ? input : true)} style={{ padding: '10px 16px', borderRadius: 10, background: destructive ? '#dc2626' : '#1d4ed8', color: 'white', border: 0, cursor: 'pointer', fontWeight: 800 }}>{options.confirmLabel || (options.kind === 'alert' ? 'OK' : options.kind === 'prompt' ? 'Submit' : 'Confirm')}</button>
      </div>
    </div>
  </div>;
}
