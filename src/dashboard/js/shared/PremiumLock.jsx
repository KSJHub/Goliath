import { goDashboard } from '../services/dashboardPath.js';
import React from 'react';

function formatPlanName(plan = {}) {
  const id = String(plan.id || plan.plan || '').toLowerCase();
  const fallbackName = id === 'free' ? 'Basic' : 'Pro';
  const name = plan.name || plan.requiredPlanName || fallbackName;
  const icon = plan.icon || (id === 'free' ? '🆓' : '👑');
  return `${icon} ${name}`.trim();
}

export default function PremiumLock({
  theme,
  title = 'Premium Feature',
  featureKey = '',
  requiredPlan = null,
  currentPlan = null,
  message = '',
  unlocks = [],
  ctaLabel = 'Open Billing',
}) {
  const required = formatPlanName(requiredPlan || { name: 'Pro', icon: '👑' });
  const current = formatPlanName(currentPlan || { name: 'Basic', icon: '🆓' });
  const unlockList = Array.isArray(unlocks) ? unlocks.filter(Boolean) : [];

  return (
    <section
      style={{
        border: '1px solid rgba(250,204,21,0.35)',
        background: 'linear-gradient(135deg, rgba(250,204,21,0.14), rgba(15,23,42,0.75) 45%, rgba(59,130,246,0.12))',
        color: theme.cardText,
        borderRadius: 24,
        padding: 'clamp(18px, 3vw, 28px)',
        boxShadow: theme.shadow,
        display: 'grid',
        gap: 18,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ color: '#fde68a', fontSize: 13, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>🔒 Goliath Pro Feature</div>
        <h2 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 36px)', letterSpacing: '-0.04em' }}>{title}</h2>
        <p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6, maxWidth: 760 }}>
          {message || `This feature requires Goliath ${required}.`}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12 }}>
        <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.35)', borderRadius: 16, padding: 14 }}>
          <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Plan</div>
          <strong style={{ display: 'block', marginTop: 6, fontSize: 18 }}>{current}</strong>
        </div>
        <div style={{ border: '1px solid rgba(250,204,21,0.28)', background: 'rgba(250,204,21,0.09)', borderRadius: 16, padding: 14 }}>
          <div style={{ color: '#fde68a', fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Required Plan</div>
          <strong style={{ display: 'block', marginTop: 6, fontSize: 18 }}>{required}</strong>
        </div>
        {featureKey ? (
          <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.35)', borderRadius: 16, padding: 14 }}>
            <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Feature Key</div>
            <strong style={{ display: 'block', marginTop: 6, fontSize: 14, wordBreak: 'break-all' }}>{featureKey}</strong>
          </div>
        ) : null}
      </div>

      {unlockList.length ? (
        <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 18, padding: 16, display: 'grid', gap: 10 }}>
          <strong style={{ color: theme.cardText }}>Upgrade to unlock:</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
            {unlockList.map((item) => (
              <span key={item} style={{ color: theme.mutedText, fontSize: 13, fontWeight: 800 }}>✓ {item}</span>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => { goDashboard('/billing'); }}
        style={{
          justifySelf: 'start',
          border: '1px solid rgba(250,204,21,0.45)',
          background: 'rgba(250,204,21,0.14)',
          color: '#fde68a',
          borderRadius: 14,
          padding: '11px 14px',
          fontWeight: 950,
          cursor: 'pointer',
        }}
      >
        {ctaLabel}
      </button>
    </section>
  );
}
