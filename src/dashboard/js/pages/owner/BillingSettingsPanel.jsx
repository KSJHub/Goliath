import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React from 'react';

function panelInput(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.48)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '10px 11px',
    fontWeight: 900,
    minWidth: 0,
  };
}

export const DEFAULT_BILLING_SETTINGS = {
  publicLifetimeEnabled: false,
  pricing: {
    free: { price: '£0', cadence: 'Free', note: 'No payment required.' },
    plus: { price: '£4.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' },
    pro: { price: '£9.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' },
    lifetime: { price: 'Not publicly sold', cadence: 'KSJ Digital controlled', note: 'Only appears when KSJ Digital makes Lifetime available.' },
  },
};

export function normalizeBillingSettings(settings = {}) {
  return {
    ...DEFAULT_BILLING_SETTINGS,
    ...settings,
    publicLifetimeEnabled: settings.publicLifetimeEnabled === true,
    pricing: {
      free: { ...DEFAULT_BILLING_SETTINGS.pricing.free, ...(settings.pricing?.free || {}) },
      plus: { ...DEFAULT_BILLING_SETTINGS.pricing.plus, ...(settings.pricing?.plus || {}) },
      pro: { ...DEFAULT_BILLING_SETTINGS.pricing.pro, ...(settings.pricing?.pro || {}) },
      lifetime: { ...DEFAULT_BILLING_SETTINGS.pricing.lifetime, ...(settings.pricing?.lifetime || {}) },
    },
  };
}

export default function BillingSettingsPanel({ theme, settings, onChange, onSave, busy, card }) {
  const safeSettings = normalizeBillingSettings(settings);

  function updatePricing(planId, field, value) {
    onChange((current) => normalizeBillingSettings({
      ...current,
      pricing: {
        ...(current.pricing || {}),
        [planId]: {
          ...(current.pricing?.[planId] || {}),
          [field]: value,
        },
      },
    }));
  }

  return (
    <section style={card(theme)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Billing Settings</h2>
          <p style={{ margin: '8px 0 0', color: theme.mutedText, lineHeight: 1.55 }}>
            Control public Lifetime availability and pricing displayed on the client Billing page.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={onSave} style={{ border: '1px solid rgba(34,197,94,0.42)', background: busy ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.18)', color: '#bbf7d0', borderRadius: 12, padding: '10px 12px', fontWeight: 950, cursor: busy ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <label style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', border: `1px solid ${safeSettings.publicLifetimeEnabled ? 'rgba(250,204,21,0.55)' : theme.cardBorder}`, background: safeSettings.publicLifetimeEnabled ? 'rgba(250,204,21,0.12)' : 'rgba(15,23,42,0.22)', borderRadius: 14, padding: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={safeSettings.publicLifetimeEnabled} onChange={(event) => onChange((current) => normalizeBillingSettings({ ...current, publicLifetimeEnabled: event.target.checked }))} />
        <span>
          <strong style={{ color: theme.cardText }}>{E.DIAMOND} Public Lifetime Sales</strong>
          <span style={{ display: 'block', marginTop: 4, color: theme.mutedText, fontSize: 13 }}>
            {safeSettings.publicLifetimeEnabled ? 'Lifetime is visible on the client Billing page.' : 'Lifetime is hidden from clients and can only be granted by KSJ Digital.'}
          </span>
        </span>
      </label>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
        {['free', 'plus', 'pro', 'lifetime'].map((planId) => (
          <section key={planId} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.22)', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
            <strong style={{ textTransform: 'capitalize' }}>{planId === 'free' ? 'Basic' : planId}</strong>
            <input value={safeSettings.pricing[planId].price} onChange={(event) => updatePricing(planId, 'price', event.target.value)} placeholder="Price" style={panelInput(theme)} />
            <input value={safeSettings.pricing[planId].cadence} onChange={(event) => updatePricing(planId, 'cadence', event.target.value)} placeholder="Cadence" style={panelInput(theme)} />
            <input value={safeSettings.pricing[planId].note} onChange={(event) => updatePricing(planId, 'note', event.target.value)} placeholder="Note" style={panelInput(theme)} />
          </section>
        ))}
      </div>
    </section>
  );
}
