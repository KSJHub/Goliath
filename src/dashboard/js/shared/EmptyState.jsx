import { DASHBOARD_EMOJIS as E } from './PageShell.jsx';
import React from 'react';

const fallback = {
  cardBorder: 'rgba(148,163,184,0.22)',
  cardBg: 'rgba(15,23,42,0.42)',
  cardText: '#e5e7eb',
  mutedText: '#94a3b8',
  shadow: '0 18px 50px rgba(0,0,0,0.25)',
};

function themeOf(theme) {
  return { ...fallback, ...(theme || {}) };
}

export default function EmptyState({
  theme,
  icon = E.SYSTEM,
  title = 'Nothing here yet',
  description,
  text,
  action = null,
}) {
  const t = themeOf(theme);
  const body = description || text || 'Items will appear here when there is activity.';

  return (
    <div style={{
      border: `1px dashed ${t.cardBorder}`,
      background: 'rgba(15,23,42,0.22)',
      color: t.cardText,
      borderRadius: 18,
      padding: '28px 18px',
      display: 'grid',
      placeItems: 'center',
      textAlign: 'center',
      gap: 10,
      minHeight: 180,
      boxShadow: t.shadow,
    }}>
      <div style={{
        width: 54,
        height: 54,
        borderRadius: 18,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${t.cardBorder}`,
        background: 'rgba(59,130,246,0.10)',
        fontSize: 26,
      }}>
        {icon}
      </div>
      <strong style={{ fontSize: 18 }}>{title}</strong>
      <p style={{ margin: 0, color: t.mutedText, lineHeight: 1.55, maxWidth: 520 }}>{body}</p>
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}
