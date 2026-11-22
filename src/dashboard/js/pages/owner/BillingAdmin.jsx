import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import BillingSettingsPanel, { normalizeBillingSettings } from './BillingSettingsPanel.jsx';

function card(theme, extra = {}) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
    minWidth: 0,
    overflow: 'hidden',
    ...extra,
  };
}

function inputStyle(theme) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(15,23,42,0.48)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '11px 12px',
    fontWeight: 900,
    minWidth: 0,
  };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function formatDuration(value) {
  if (!value || value === 'lifetime') return 'Lifetime';
  if (String(value) === '1m' || Number(value) === 30) return '1 Month';
  if (String(value) === '3m' || Number(value) === 90) return '3 Months';
  if (String(value) === '6m' || Number(value) === 180) return '6 Months';
  return `${value} Days`;
}

function statusFor(code) {
  if (code.revoked) return 'Revoked';
  if (code.used) return 'Redeemed';
  return 'Active';
}

function StatCard({ theme, label, value, detail, accent = '#93c5fd' }) {
  return (
    <section style={card(theme, { minHeight: 112, display: 'grid', gap: 8, alignContent: 'space-between' })}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: accent, fontSize: 30, fontWeight: 950, lineHeight: 1 }}>{value}</div>
      <div style={{ color: theme.mutedText, fontSize: 13 }}>{detail}</div>
    </section>
  );
}

function CodeRow({ theme, code, onRevoke, busy }) {
  const status = statusFor(code);
  const canRevoke = !code.used && !code.revoked;

  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ wordBreak: 'break-all' }}>{code.code}</strong>
        <span style={{ color: status === 'Active' ? '#86efac' : status === 'Redeemed' ? '#93c5fd' : '#fca5a5', fontWeight: 950, fontSize: 12 }}>{status}</span>
      </div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>
        Plan: <strong style={{ color: theme.cardText }}>{code.plan}</strong> • Duration: <strong style={{ color: theme.cardText }}>{formatDuration(code.duration)}</strong> • Created: {formatDate(code.createdAt)}
        {code.guildId ? <> • Guild: <strong style={{ color: theme.cardText }}>{code.guildId}</strong></> : null}
        {code.redeemedAt ? <> • Redeemed: {formatDate(code.redeemedAt)}</> : null}
      </div>
      {canRevoke ? (
        <button type="button" disabled={busy} onClick={() => onRevoke(code.code)} style={{ justifySelf: 'start', border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#fecaca', borderRadius: 10, padding: '8px 10px', fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer' }}>
          Revoke
        </button>
      ) : null}
    </div>
  );
}

function SubscriptionRow({ theme, item, onExtend, onRemove, busy }) {
  const subscription = item.subscription || {};
  const plan = item.plan || {};
  const premium = subscription.plan && subscription.plan !== 'free';

  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.22)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong>{item.guildName || item.guildId}</strong>
        <span style={{ color: premium ? '#86efac' : theme.mutedText, fontWeight: 950, fontSize: 12 }}>{plan.icon || ''} {plan.name || subscription.plan}</span>
      </div>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>
        Guild: <strong style={{ color: theme.cardText }}>{item.guildId}</strong> • Status: <strong style={{ color: theme.cardText }}>{subscription.status}</strong> • Source: <strong style={{ color: theme.cardText }}>{subscription.source}</strong> • Expires: <strong style={{ color: theme.cardText }}>{formatDate(subscription.expiresAt)}</strong>
      </div>
      {premium ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || subscription.plan === 'lifetime'} onClick={() => onExtend(item.guildId)} style={{ border: '1px solid rgba(59,130,246,0.35)', background: 'rgba(59,130,246,0.12)', color: '#bfdbfe', borderRadius: 10, padding: '8px 10px', fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer' }}>Extend 30d</button>
          <button type="button" disabled={busy} onClick={() => onRemove(item.guildId)} style={{ border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.12)', color: '#fecaca', borderRadius: 10, padding: '8px 10px', fontWeight: 900, cursor: busy ? 'not-allowed' : 'pointer' }}>Remove</button>
        </div>
      ) : null}
    </div>
  );
}

function HistoryRow({ theme, item }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.18)', display: 'grid', gap: 5 }}>
      <strong style={{ textTransform: 'capitalize' }}>{item.action} • {item.guildId}</strong>
      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>
        Plan: {item.plan || item.previousPlan || 'free'} • Actor: {item.actor || 'owner'} • {formatDate(item.timestamp)}
      </div>
    </div>
  );
}

export default function BillingAdmin({ theme }) {
  const [codes, setCodes] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(normalizeBillingSettings());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ plan: 'plus', duration: '1m', quantity: 1 });
  const [grantForm, setGrantForm] = useState({ guildId: '', plan: 'pro', duration: '30' });

  const activeCodes = useMemo(() => codes.filter((code) => !code.used && !code.revoked), [codes]);
  const redeemedCodes = useMemo(() => codes.filter((code) => code.used), [codes]);
  const revokedCodes = useMemo(() => codes.filter((code) => code.revoked), [codes]);
  const premiumSubscriptions = useMemo(() => subscriptions.filter((item) => item.subscription?.plan && item.subscription.plan !== 'free'), [subscriptions]);
  const plusSubscriptions = useMemo(() => subscriptions.filter((item) => item.subscription?.plan === 'plus'), [subscriptions]);
  const proSubscriptions = useMemo(() => subscriptions.filter((item) => item.subscription?.plan === 'pro'), [subscriptions]);
  const lifetimeSubscriptions = useMemo(() => subscriptions.filter((item) => item.subscription?.plan === 'lifetime'), [subscriptions]);

  async function loadBillingAdmin() {
    setLoading(true);
    setError('');

    try {
      const [codesPayload, subscriptionsPayload, settingsPayload] = await Promise.all([
        api.request('/api/billing/codes'),
        api.request('/api/billing/subscriptions'),
        api.request('/api/billing/settings'),
      ]);
      setCodes(Array.isArray(codesPayload.codes) ? codesPayload.codes : []);
      setSubscriptions(Array.isArray(subscriptionsPayload.subscriptions) ? subscriptionsPayload.subscriptions : []);
      setHistory(Array.isArray(subscriptionsPayload.history) ? subscriptionsPayload.history : []);
      setSettings(normalizeBillingSettings(settingsPayload.settings || {}));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load billing admin.');
      setCodes([]);
      setSubscriptions([]);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBillingAdmin();
  }, []);

  async function saveSettings() {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const payload = await api.request('/api/billing/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setSettings(normalizeBillingSettings(payload.settings || {}));
      setNotice('Billing settings saved.');
    } catch (settingsError) {
      setError(settingsError.message || 'Failed to save billing settings.');
    } finally {
      setBusy(false);
    }
  }

  async function generateCodes(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const payload = await api.request('/api/billing/codes/generate', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setNotice(`Generated ${payload.codes?.length || 0} billing code(s).`);
      await loadBillingAdmin();
    } catch (generateError) {
      setError(generateError.message || 'Failed to generate codes.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeCode(code) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api.request(`/api/billing/codes/${encodeURIComponent(code)}/revoke`, { method: 'POST' });
      setNotice('Code revoked.');
      await loadBillingAdmin();
    } catch (revokeError) {
      setError(revokeError.message || 'Failed to revoke code.');
    } finally {
      setBusy(false);
    }
  }

  async function grantSubscription(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api.request('/api/billing/subscriptions/grant', {
        method: 'POST',
        body: JSON.stringify(grantForm),
      });
      setNotice(`Subscription granted to ${grantForm.guildId}.`);
      await loadBillingAdmin();
    } catch (grantError) {
      setError(grantError.message || 'Failed to grant subscription.');
    } finally {
      setBusy(false);
    }
  }

  async function extendSubscription(guildId) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api.request('/api/billing/subscriptions/extend', {
        method: 'POST',
        body: JSON.stringify({ guildId, duration: 30 }),
      });
      setNotice(`Subscription extended for ${guildId}.`);
      await loadBillingAdmin();
    } catch (extendError) {
      setError(extendError.message || 'Failed to extend subscription.');
    } finally {
      setBusy(false);
    }
  }

  async function removeSubscription(guildId) {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await api.request('/api/billing/subscriptions/remove', {
        method: 'POST',
        body: JSON.stringify({ guildId }),
      });
      setNotice(`Subscription removed for ${guildId}.`);
      await loadBillingAdmin();
    } catch (removeError) {
      setError(removeError.message || 'Failed to remove subscription.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <section style={card(theme, { background: 'linear-gradient(135deg, rgba(250,204,21,0.14), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.12))', padding: 'clamp(18px, 2.4vw, 24px)' })}>
        <p style={{ margin: 0, color: '#fde68a', fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Owner Billing</p>
        <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em', lineHeight: 1 }}>{E.DIAMOND} Billing Admin</h1>
        <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 860 }}>
          Generate codes, grant plans directly, control Lifetime availability, update pricing and manage premium access for Goliath guilds.
        </p>
      </section>

      {error ? <section style={{ ...card(theme), color: '#fca5a5' }}>{error}</section> : null}
      {notice ? <section style={{ ...card(theme), color: '#86efac' }}>{notice}</section> : null}
      {loading ? <section style={card(theme)}>Loading billing admin...</section> : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 12 }}>
        <StatCard theme={theme} label="Total Codes" value={codes.length} detail="All generated codes" />
        <StatCard theme={theme} label="Active Codes" value={activeCodes.length} detail="Unused and available" accent="#86efac" />
        <StatCard theme={theme} label="Redeemed" value={redeemedCodes.length} detail="Applied to guilds" accent="#93c5fd" />
        <StatCard theme={theme} label="Premium Guilds" value={premiumSubscriptions.length} detail="Plus, Pro or Lifetime" accent="#fde68a" />
        <StatCard theme={theme} label="Plus Guilds" value={plusSubscriptions.length} detail="Growth plan guilds" accent="#facc15" />
        <StatCard theme={theme} label="Pro Guilds" value={proSubscriptions.length} detail="Full platform guilds" accent="#c084fc" />
        <StatCard theme={theme} label="Lifetime Guilds" value={lifetimeSubscriptions.length} detail="Owner-granted lifetime" accent="#67e8f9" />
      </section>

      <BillingSettingsPanel theme={theme} settings={settings} onChange={setSettings} onSave={saveSettings} busy={busy} card={card} />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 14 }}>
        <section style={card(theme)}>
          <h2 style={{ margin: '0 0 12px' }}>Grant Subscription</h2>
          <form onSubmit={grantSubscription} style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Guild ID
              <input value={grantForm.guildId} onChange={(event) => setGrantForm((current) => ({ ...current, guildId: event.target.value }))} placeholder="123456789012345678" style={inputStyle(theme)} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Plan
                <ThemedSelect theme={theme} value={grantForm.plan} onChange={(event) => setGrantForm((current) => ({ ...current, plan: event.target.value, duration: event.target.value === 'lifetime' ? 'lifetime' : current.duration }))} style={inputStyle(theme)}>
                  <option value="free">Basic</option>
                  <option value="plus">Plus</option>
                  <option value="pro">Pro</option>
                  <option value="lifetime">Lifetime</option>
                </ThemedSelect>
              </label>
              <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Duration
                <ThemedSelect theme={theme} value={grantForm.duration} disabled={grantForm.plan === 'lifetime' || grantForm.plan === 'free'} onChange={(event) => setGrantForm((current) => ({ ...current, duration: event.target.value }))} style={inputStyle(theme)}>
                  <option value="30">30 Days</option>
                  <option value="90">90 Days</option>
                  <option value="180">180 Days</option>
                  <option value="lifetime">Lifetime</option>
                </ThemedSelect>
              </label>
            </div>
            <button type="submit" disabled={busy || !grantForm.guildId.trim()} style={{ border: '1px solid rgba(250,204,21,0.42)', background: busy ? 'rgba(250,204,21,0.08)' : 'rgba(250,204,21,0.15)', color: '#fde68a', borderRadius: 12, padding: '12px 14px', fontWeight: 950, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Working...' : 'Apply Subscription'}
            </button>
          </form>
        </section>

        <section style={card(theme)}>
          <h2 style={{ margin: '0 0 12px' }}>Generate Codes</h2>
          <form onSubmit={generateCodes} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,130px),1fr))', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Plan
                <ThemedSelect theme={theme} value={form.plan} onChange={(event) => setForm((current) => ({ ...current, plan: event.target.value, duration: event.target.value === 'lifetime' ? 'lifetime' : current.duration }))} style={inputStyle(theme)}>
                  <option value="plus">Plus</option>
                  <option value="pro">Pro</option>
                  <option value="lifetime">Lifetime</option>
                </ThemedSelect>
              </label>
              <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Duration
                <ThemedSelect theme={theme} value={form.duration} disabled={form.plan === 'lifetime'} onChange={(event) => setForm((current) => ({ ...current, duration: event.target.value }))} style={inputStyle(theme)}>
                  <option value="1m">1 Month</option>
                  <option value="3m">3 Months</option>
                  <option value="6m">6 Months</option>
                  <option value="lifetime">Lifetime</option>
                </ThemedSelect>
              </label>
              <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Quantity
                <ThemedSelect theme={theme} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} style={inputStyle(theme)}>
                  {[1, 5, 10, 25, 100].map((value) => <option key={value} value={value}>{value}</option>)}
                </ThemedSelect>
              </label>
            </div>
            <button type="submit" disabled={busy} style={{ border: '1px solid rgba(34,197,94,0.42)', background: busy ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.18)', color: '#bbf7d0', borderRadius: 12, padding: '12px 14px', fontWeight: 950, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Working...' : 'Generate'}
            </button>
          </form>
        </section>
      </section>

      <section style={card(theme)}>
        <h2 style={{ marginTop: 0 }}>Premium Subscriptions</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {premiumSubscriptions.length ? premiumSubscriptions.map((item) => (
            <SubscriptionRow key={item.guildId} theme={theme} item={item} onExtend={extendSubscription} onRemove={removeSubscription} busy={busy} />
          )) : <p style={{ color: theme.mutedText }}>No premium subscriptions found.</p>}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 14 }}>
        <section style={card(theme)}>
          <h2 style={{ marginTop: 0 }}>Active Codes</h2>
          <div style={{ display: 'grid', gap: 10 }}>{activeCodes.length ? activeCodes.map((code) => <CodeRow key={code.code} theme={theme} code={code} onRevoke={revokeCode} busy={busy} />) : <p style={{ color: theme.mutedText }}>No active codes.</p>}</div>
        </section>
        <section style={card(theme)}>
          <h2 style={{ marginTop: 0 }}>Redeemed Codes</h2>
          <div style={{ display: 'grid', gap: 10 }}>{redeemedCodes.length ? redeemedCodes.map((code) => <CodeRow key={code.code} theme={theme} code={code} onRevoke={revokeCode} busy={busy} />) : <p style={{ color: theme.mutedText }}>No redeemed codes.</p>}</div>
        </section>
        <section style={card(theme)}>
          <h2 style={{ marginTop: 0 }}>Revoked Codes</h2>
          <div style={{ display: 'grid', gap: 10 }}>{revokedCodes.length ? revokedCodes.map((code) => <CodeRow key={code.code} theme={theme} code={code} onRevoke={revokeCode} busy={busy} />) : <p style={{ color: theme.mutedText }}>No revoked codes.</p>}</div>
        </section>
      </section>

      <section style={card(theme)}>
        <h2 style={{ marginTop: 0 }}>Subscription History</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {history.length ? history.slice(0, 30).map((item) => <HistoryRow key={item.id || `${item.timestamp}-${item.guildId}`} theme={theme} item={item} />) : <p style={{ color: theme.mutedText }}>No subscription history yet.</p>}
        </div>
      </section>
    </div>
  );
}
