import { createPortal } from 'react-dom';
import React, { useEffect, useId, useRef, useState } from 'react';

function getResourceLabel(item, fallback = 'Unnamed') {
  return item?.name || item?.label || item?.id || fallback;
}


function SearchableResourceSelect({ theme, label, value, onChange, resources = [], placeholder = 'Choose an option', disabled = false, clearable = true }) {
  const id = useId();
  const popup = useRef(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, height: 340 });
  const root = useRef(null), trigger = useRef(null), search = useRef(null), options = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const selected = resources.find(item => item.id === value);
  const filtered = resources.filter(item => (getResourceLabel(item) + ' ' + (item.groupName || '')).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const choices = clearable ? [{ id: '', name: placeholder }, ...filtered] : filtered;
  const close = (restoreFocus = false) => { setOpen(false); setQuery(''); if (restoreFocus) trigger.current?.focus(); };
  const choose = item => { if (item) { onChange?.(item.id); close(true); } };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = event => { if (!root.current?.contains(event.target) && !popup.current?.contains(event.target)) close(); };
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upward = below < 220 && above > below;
      const height = Math.min(350, Math.max(140, upward ? above : below));
      setPlacement({ top: upward ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), width: Math.min(rect.width, window.innerWidth - 16), height });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open]);
  useEffect(() => { if (disabled) { setOpen(false); setQuery(''); } }, [disabled]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (open) options.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active, open]);
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (!choices.length) return; setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
    } else if (event.key === 'Enter') { event.preventDefault(); choose(choices[Math.min(active, choices.length - 1)]); }
  }
  const surface = theme.menuBg || theme.cardBgSolid || theme.cardBg;
  return <div ref={root} style={{ position: 'relative', minWidth: 0 }}>
    <span id={id + '-label'} style={{ display: 'block', marginBottom: 8, color: theme.textSoft || theme.cardText, fontSize: 13, fontWeight: 600 }}>{label}</span>
    <button ref={trigger} type="button" disabled={disabled} aria-labelledby={id + '-label ' + id + '-value'} aria-haspopup="listbox" aria-expanded={open} aria-controls={id + '-list'}
      onClick={() => { setOpen(!open); setQuery(''); setActive(Math.max(0, resources.findIndex(item => item.id === value) + (clearable ? 1 : 0))); }}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); setActive(Math.max(0, resources.findIndex(item => item.id === value) + 1)); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', width: '100%', boxSizing: 'border-box', textAlign: 'left', border: '1px solid ' + (open ? theme.primary : theme.inputBorder || theme.cardBorder), background: theme.inputBg || theme.softBg, color: theme.inputText || theme.cardText, borderRadius: 12, padding: '13px 16px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, font: 'inherit' }}>
      <span id={id + '-value'} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? getResourceLabel(selected) : value ? 'Unavailable selection — choose another' : placeholder}{selected?.groupName ? <span style={{ color: theme.mutedText, fontSize: 12 }}> · {selected.groupName}</span> : null}</span>
      <span aria-hidden="true" style={{ color: theme.mutedText }}>{open ? '▴' : '▾'}</span>
    </button>
    {open ? createPortal(<div ref={popup} style={{ position: 'fixed', top: placement.top, left: placement.left, width: placement.width, zIndex: 1000, background: surface, border: '1px solid ' + (theme.menuBorder || theme.cardBorder), borderRadius: 14, boxShadow: theme.shadow, overflow: 'hidden' }}>
      <div style={{ padding: 10, borderBottom: '1px solid ' + theme.cardBorder }}>
        <input ref={search} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={keys} role="combobox" aria-label={'Search ' + label} aria-expanded="true" aria-controls={id + '-list'} aria-autocomplete="list" aria-activedescendant={choices.length ? id + '-option-' + Math.min(active, choices.length - 1) : undefined} placeholder="Search by name or category…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9, border: '1px solid ' + (theme.inputBorder || theme.cardBorder), background: theme.inputBg || theme.softBg, color: theme.inputText || theme.cardText, font: 'inherit', fontSize: 14 }} />
      </div>
      <div ref={options} id={id + '-list'} role="listbox" aria-labelledby={id + '-label'} style={{ maxHeight: placement.height - 66, overflowY: 'auto', overscrollBehavior: 'contain', padding: 6 }}>
        {choices.map((item, index) => <React.Fragment key={item.id}>
          {item.groupName && item.groupId !== choices[index - 1]?.groupId ? <div role="presentation" style={{ padding: '12px 10px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.mutedText }}>{item.groupName}</div> : null}
          <div id={id + '-option-' + index} role="option" aria-selected={(value || '') === item.id} data-active={active === index} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}
            style={{ display: 'flex', gap: 10, justifyContent: 'space-between', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', color: (value || '') === item.id ? theme.primary : theme.cardText, background: active === index ? theme.softBg : (value || '') === item.id ? theme.primarySoft || theme.softBg : 'transparent', fontSize: 14, overflowWrap: 'anywhere' }}>
            <span>{getResourceLabel(item)}</span><span aria-hidden="true">{(value || '') === item.id ? '✓' : ''}</span>
          </div>
        </React.Fragment>)}
        {!filtered.length ? <p role="status" style={{ padding: '8px 12px', color: theme.mutedText, fontSize: 13 }}>No matching options.</p> : null}
      </div>
    </div>, document.body) : null}
  </div>;
}

export function DiscordResourceSelect({
  theme,
  label,
  value,
  onChange,
  resources = [],
  placeholder = 'Choose an option',
  disabled = false,
  searchable = false,
  clearable = true,
}) {
  if (searchable) return <SearchableResourceSelect {...{ theme, label, value, onChange, resources, placeholder, disabled, clearable }} />;
  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <span style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <select
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        style={{ width: '100%', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.55)', color: theme.cardText, borderRadius: 14, padding: '12px 14px', fontWeight: 800 }}
      >
        <option value="">{placeholder}</option>
        {resources.map((item) => (
          <option key={item.id} value={item.id}>{getResourceLabel(item)}</option>
        ))}
      </select>
    </label>
  );
}

export function ChannelSelect(props) {
  return <DiscordResourceSelect {...props} label={props.label || 'Channel'} placeholder={props.placeholder || 'Choose a channel'} />;
}

export function RoleSelect(props) {
  return <DiscordResourceSelect {...props} label={props.label || 'Role'} placeholder={props.placeholder || 'Choose a role'} />;
}

export function CategorySelect(props) {
  return <DiscordResourceSelect {...props} label={props.label || 'Category'} placeholder={props.placeholder || 'Choose a category'} />;
}

export function EmojiSelect(props) {
  return <DiscordResourceSelect {...props} label={props.label || 'Emoji'} placeholder={props.placeholder || 'Choose an emoji'} />;
}

export default DiscordResourceSelect;
