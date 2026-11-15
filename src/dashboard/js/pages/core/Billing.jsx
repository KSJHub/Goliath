import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import PageShell, { EmptyState, LoadingPanel, Notice, SectionCard, StatGrid, SummaryStat } from '../../shared/PageShell.jsx';

const PLAN_COPY = {
  free: {
    headline: 'Perfect for small communities getting started with Goliath.',
    idealFor: 'Small communities, new servers and trial setups.',
    badge: 'Starter access',
    displayName: 'Basic',
    icon: '🆓',
    includes: 'Core Goliath access.',
  },
  plus: {
    headline: 'Includes Basic, plus higher limits and growth tools.',
    idealFor: 'Gaming communities, creators and active Discord servers.',
    badge: 'Recommended',
    displayName: 'Plus',
    icon: '⭐',
    includes: 'Includes Basic, plus:',
  },
  pro: {
    headline: 'Includes Plus, plus the complete premium platform.',
    idealFor: 'Large communities, businesses and professional Discord servers.',
    badge: 'Full platform',
    displayName: 'Pro',
    icon: E.CROWN,
    includes: 'Includes Plus, plus:',
  },
  lifetime: {
    headline: 'Includes Pro, with lifetime access controlled by KSJ Digital.',
    idealFor: 'Founders, beta testers, giveaways and owner-granted rewards.',
    badge: 'Limited availability',
    displayName: 'Lifetime',
    icon: E.DIAMOND,
    includes: 'Includes Pro, plus:',
  },
};

const PLAN_PRICING = {
  free: { price: '£0', cadence: 'Free', note: 'No payment required.' },
  plus: { price: '£4.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' },
  pro: { price: '£9.99', cadence: 'per month', note: 'Stripe and PayPal checkout coming soon.' },
  lifetime: { price: 'Not publicly sold', cadence: 'KSJ Digital controlled', note: 'Only appears when KSJ Digital makes Lifetime available.' },
};

const FEATURE_LABELS = {
  'tickets.basic': { icon: E.TICKETS, label: 'Ticket System', description: 'Create and manage support tickets.' },
  'tickets.advanced': { icon: E.PREMIUM_TICKET, label: 'Advanced Tickets', description: 'Higher limits and more flexible ticket workflows.' },
  'forms.basic': { icon: E.NOTE, label: 'Forms System', description: 'Applications, appeals, reports and custom forms.' },
  'forms.advanced': { icon: E.CLIPBOARD, label: 'Advanced Forms', description: 'Expanded form limits and workflows.' },
  'embeds.basic': { icon: '✨', label: 'Embed Builder', description: 'Create professional Discord embeds.' },
  'embeds.presets': { icon: E.SAVE, label: 'Embed Presets', description: 'Save reusable embed designs and templates.' },
  'moderation.basic': { icon: E.SECURITY, label: 'Moderation Tools', description: 'Core moderation utilities.' },
  'dashboard.basic': { icon: E.CHART, label: 'Dashboard Access', description: 'Manage Goliath from the web dashboard.' },
  'security.basic': { icon: E.PERMISSIONS, label: 'Basic Security', description: 'Essential server protection.' },
  'security.advanced': { icon: E.SECURITY, label: 'Advanced Security Center', description: 'Professional security and incident control.' },
  'backup.restore': { icon: E.RESTORE, label: 'Backup & Restore Center', description: 'Restore protected server configuration backups.' },
  'translation.hub': { icon: E.GLOBE, label: 'Translation Hub', description: 'Multilingual community tools and workflows.' },
  'analytics.basic': { icon: E.TREND, label: 'Basic Analytics', description: 'Simple community insights.' },
  'analytics.advanced': { icon: E.CHART, label: 'Advanced Analytics', description: 'Deeper premium reporting.' },
  'modules.premium': { icon: E.CROWN, label: 'Future Premium Modules', description: 'Access future Pro-level systems.' },
};

const PLAN_FEATURE_GROUPS = {
  free: ['tickets.basic', 'forms.basic', 'embeds.basic', 'moderation.basic', 'dashboard.basic', 'security.basic'],
  plus: ['tickets.advanced', 'forms.advanced', 'embeds.presets', 'analytics.basic'],
  pro: ['translation.hub', 'security.advanced', 'backup.restore', 'analytics.advanced', 'modules.premium'],
  lifetime: ['modules.premium'],
};

const LIMIT_LABELS = {
  ticketPanels: 'Ticket Panels',
  forms: 'Forms',
  embedPresets: 'Embed Presets',
  activeTicketsPerUser: 'Active Tickets Per User',
  translationsPerMonth: 'Translations Per Month',
};

const COMPARISON_ROWS = [
  { label: 'Ticket Panels', basic: '2', plus: '15', pro: 'Unlimited' },
  { label: 'Forms', basic: '3', plus: '25', pro: 'Unlimited' },
  { label: 'Embed Presets', basic: '5', plus: '50', pro: 'Unlimited' },
  { label: 'Ticket System', basic: '✓', plus: '✓', pro: '✓' },
  { label: 'Forms System', basic: '✓', plus: '✓', pro: '✓' },
  { label: 'Embed Builder', basic: '✓', plus: '✓', pro: '✓' },
  { label: 'Translation Hub', basic: '—', plus: '—', pro: '✓' },
  { label: 'Backup & Restore', basic: '—', plus: '—', pro: '✓' },
  { label: 'Advanced Security', basic: '—', plus: '—', pro: '✓' },
  { label: 'Advanced Analytics', basic: '—', plus: '—', pro: '✓' },
];

function getGuildId(selectedGuild, selectedGuildData) {
  const id = selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '';
  return String(id).split(':').pop().trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function planCopy(planId) {
  return PLAN_COPY[planId] || PLAN_COPY.free;
}

function planDisplayName(plan = {}) {
  return planCopy(plan.id || plan.plan).displayName || plan.name || 'Basic';
}

function planDisplayIcon(plan = {}) {
  return planCopy(plan.id || plan.plan).icon || plan.icon || '';
}

function featureInfo(feature) {
  return FEATURE_LABELS[feature] || {
    icon: '✅',
    label: String(feature || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: 'Included with this Goliath plan.',
  };
}

function formatDate(value) {
  if (!value) return 'No expiry';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No expiry' : date.toLocaleString();
}

function formatLimit(value) {
  if (value == null) return 'Unlimited';
  return Number(value).toLocaleString();
}

function formatLimitLabel(key) {
  return LIMIT_LABELS[key] || String(key || '').replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function DetailCard({ theme, label, value, hint }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 14, padding: 13, display: 'grid', gap: 4 }}>
      <div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color: theme.cardText, fontWeight: 950, overflowWrap: 'anywhere' }}>{value || 'None'}</div>
      {hint ? <div style={{ color: theme.mutedText, fontSize: 12, overflowWrap: 'anywhere' }}>{hint}</div> : null}
    </div>
  );
}

function FeaturePill({ theme, feature }) {
  const info = featureInfo(feature);
  return (
    <span title={info.description} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.34)', color: theme.cardText, borderRadius: 999, padding: '7px 10px', fontSize: 12, fontWeight: 900 }}>
      {info.icon} {info.label}
    </span>
  );
}

function FeatureListItem({ theme, feature }) {
  const info = featureInfo(feature);
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.22)', borderRadius: 14, padding: 12, display: 'grid', gap: 5 }}>
      <strong style={{ color: theme.cardText }}>{info.icon} {info.label}</strong>
      <span style={{ color: theme.mutedText, fontSize: 12, lineHeight: 1.45 }}>{info.description}</span>
    </div>
  );
}

function getDisplayFeatures(plan) {
  const grouped = PLAN_FEATURE_GROUPS[plan.id];
  if (grouped?.length) return grouped;
  return asArray(plan.features);
}

function PlanCard({ theme, plan, current, onUpgrade }) {
  const copy = planCopy(plan.id);
  const pricing = { ...(PLAN_PRICING[plan.id] || PLAN_PRICING.free), ...(plan.pricing || {}) };
  const limits = plan.limits || {};
  const hidden = plan.public === false;
  const featured = plan.id === 'plus';
  const displayFeatures = getDisplayFeatures(plan);

  const border = current ? '#86efac' : featured ? '#facc15' : hidden ? 'rgba(250,204,21,0.42)' : theme.cardBorder;
  const background = current
    ? 'rgba(34,197,94,0.10)'
    : featured
      ? 'linear-gradient(180deg, rgba(250,204,21,0.16), rgba(15,23,42,0.26))'
      : hidden
        ? 'rgba(250,204,21,0.08)'
        : 'rgba(15,23,42,0.24)';

  return (
    <div style={{ border: `1px solid ${border}`, background, borderRadius: 18, padding: 16, display: 'grid', gap: 14, boxShadow: featured ? '0 0 34px rgba(250,204,21,0.14)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <strong style={{ color: theme.cardText, fontSize: 22 }}>{copy.icon} {copy.displayName}</strong>
          <div style={{ marginTop: 6, color: featured ? '#facc15' : current ? '#86efac' : '#fde68a', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{copy.badge}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {featured ? <span style={{ border: '1px solid rgba(250,204,21,0.45)', background: 'rgba(250,204,21,0.16)', color: '#fde68a', borderRadius: 999, padding: '5px 8px', fontWeight: 950, fontSize: 11, textTransform: 'uppercase' }}>Recommended</span> : null}
          {current ? <span style={{ color: '#86efac', fontWeight: 950, fontSize: 12, textTransform: 'uppercase' }}>Current</span> : null}
        </div>
      </div>

      <div style={{ border: `1px solid ${featured ? 'rgba(250,204,21,0.42)' : theme.cardBorder}`, background: 'rgba(15,23,42,0.30)', borderRadius: 14, padding: 13, display: 'grid', gap: 2 }}>
        <strong style={{ color: theme.cardText, fontSize: plan.id === 'lifetime' ? 20 : 28, lineHeight: 1 }}>{pricing.price}</strong>
        <span style={{ color: featured ? '#fde68a' : theme.mutedText, fontSize: 12, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{pricing.cadence}</span>
        <span style={{ color: theme.mutedText, fontSize: 12, lineHeight: 1.45 }}>{pricing.note}</span>
      </div>

      <div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.55 }}>{copy.headline}</div>

      <div style={{ display: 'grid', gap: 9 }}>
        <strong style={{ color: theme.cardText, fontSize: 13 }}>{copy.includes}</strong>
        {displayFeatures.map((feature) => <FeatureListItem key={feature} theme={theme} feature={feature} />)}
      </div>

      <div style={{ borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 12, display: 'grid', gap: 8 }}>
        <strong style={{ color: theme.cardText }}>Plan Limits</strong>
        <div style={{ display: 'grid', gap: 6 }}>
          {Object.entries(limits).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: theme.mutedText, fontSize: 13 }}>
              <span>{formatLimitLabel(key)}</span>
              <strong style={{ color: theme.cardText }}>{formatLimit(value)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div style={{ color: theme.mutedText, fontSize: 12, lineHeight: 1.45 }}>
        <strong style={{ color: theme.cardText }}>Ideal for:</strong> {copy.idealFor}
      </div>

      {!current && !hidden ? (
        <button type="button" onClick={() => onUpgrade?.(plan)} style={{ border: `1px solid ${featured ? 'rgba(250,204,21,0.55)' : 'rgba(250,204,21,0.45)'}`, background: featured ? 'rgba(250,204,21,0.22)' : 'rgba(250,204,21,0.14)', color: '#fde68a', borderRadius: 12, padding: '11px 13px', fontWeight: 950, cursor: 'pointer' }}>
          Upgrade to {copy.displayName}
        </button>
      ) : null}
    </div>
  );
}

function FeatureComparison({ theme }) {
  return (
    <SectionCard theme={theme} title="Plan Comparison" subtitle="A cleaner side-by-side view of what each public plan unlocks.">
      <div style={{ overflowX: 'auto', border: `1px solid ${theme.cardBorder}`, borderRadius: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
          <thead>
            <tr style={{ background: 'rgba(15,23,42,0.46)' }}>
              <th style={{ padding: 14, textAlign: 'left', color: theme.mutedText, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Feature</th>
              <th style={{ padding: 14, textAlign: 'center', color: '#93c5fd' }}>🆓 Basic</th>
              <th style={{ padding: 14, textAlign: 'center', color: '#facc15' }}>⭐ Plus</th>
              <th style={{ padding: 14, textAlign: 'center', color: '#c084fc' }}>{E.CROWN} Pro</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                <td style={{ padding: 13, color: theme.cardText, fontWeight: 900 }}>{row.label}</td>
                <td style={{ padding: 13, textAlign: 'center', color: row.basic === '—' ? theme.mutedText : theme.cardText, fontWeight: 900 }}>{row.basic}</td>
                <td style={{ padding: 13, textAlign: 'center', color: row.plus === '—' ? theme.mutedText : '#fde68a', fontWeight: 950 }}>{row.plus}</td>
                <td style={{ padding: 13, textAlign: 'center', color: row.pro === '—' ? theme.mutedText : '#ddd6fe', fontWeight: 950 }}>{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export default function Billing({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [plansPayload, setPlansPayload] = useState(null);
  const [subscriptionPayload, setSubscriptionPayload] = useState(null);
  const [entitlementsPayload, setEntitlementsPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const plans = useMemo(() => asArray(plansPayload?.plans), [plansPayload]);
  const subscription = subscriptionPayload?.subscription || entitlementsPayload?.subscription || {};
  const currentPlan = subscriptionPayload?.plan || entitlementsPayload?.plan || {};
  const features = asArray(entitlementsPayload?.features || currentPlan.features);
  const limits = entitlementsPayload?.limits || currentPlan.limits || {};

  const loadBilling = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    setError('');

    try {
      const [plansResult, subscriptionResult, entitlementResult] = await Promise.all([
        api.getBillingPlans(),
        api.getBillingSubscription(guildId),
        api.getBillingEntitlements(guildId),
      ]);

      setPlansPayload(plansResult);
      setSubscriptionPayload(subscriptionResult);
      setEntitlementsPayload(entitlementResult);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load billing details.');
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadBilling();
  }, [loadBilling]);

  async function handleRedeem(event) {
    event.preventDefault();
    if (!guildId || !redeemCode.trim()) return;

    setRedeeming(true);
    setError('');
    setNotice('');

    try {
      const result = await api.request(`/api/billing/redeem/${guildId}`, {
        method: 'POST',
        body: JSON.stringify({ code: redeemCode }),
      });

      setRedeemCode('');
      setNotice(`Code redeemed. ${result.subscription?.plan || 'Subscription'} is now active.`);
      await loadBilling();
    } catch (redeemError) {
      setError(redeemError.message || 'Failed to redeem code.');
    } finally {
      setRedeeming(false);
    }
  }

  function handleUpgrade(plan) {
    setNotice(`${planDisplayName(plan)} checkout is coming soon. Stripe and PayPal will both connect to this upgrade button.`);
  }

  if (!guildId) {
    return (
      <PageShell title="Billing" subtitle="Select a server to view its Goliath plan and entitlements." theme={theme}>
        <EmptyState theme={theme} text="Select a server to view billing." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Billing"
      subtitle="View this server's plan, subscription status, features and limits."
      theme={theme}
      guild={{ id: guildId, name: selectedGuildData?.name || selectedGuildData?.guildName || 'Selected Server', iconUrl: selectedGuildData?.iconUrl || selectedGuildData?.iconURL }}
    >
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {notice ? <Notice theme={theme} tone="success">{notice}</Notice> : null}
      {loading ? <LoadingPanel theme={theme} text="Loading billing..." /> : null}

      <StatGrid min="min(190px, 100%)">
        <SummaryStat theme={theme} label="Current Plan" value={`${planDisplayIcon(currentPlan)} ${planDisplayName(currentPlan)}`} accent="#86efac" description="Guild subscription plan" />
        <SummaryStat theme={theme} label="Status" value={subscription.status || 'active'} accent="#3b82f6" description="Subscription status" />
        <SummaryStat theme={theme} label="Source" value={subscription.source || 'system'} accent="#a855f7" description="How access was granted" />
        <SummaryStat theme={theme} label="Expires" value={formatDate(subscription.expiresAt)} accent="#f59e0b" description="Renewal or expiry date" />
      </StatGrid>

      <SectionCard theme={theme} title="Redeem Code" subtitle="Apply a Plus, Pro or Lifetime access code to this server.">
        <form onSubmit={handleRedeem} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={redeemCode}
            onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
            placeholder="GOL-PRO-3M-XXXXX"
            style={{ flex: '1 1 260px', minWidth: 0, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.48)', color: theme.cardText, borderRadius: 12, padding: '12px 14px', fontWeight: 800 }}
          />
          <button type="submit" disabled={redeeming || !redeemCode.trim()} style={{ border: '1px solid rgba(34,197,94,0.42)', background: redeeming ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.18)', color: '#bbf7d0', borderRadius: 12, padding: '12px 14px', fontWeight: 950, cursor: redeeming ? 'not-allowed' : 'pointer' }}>
            {redeeming ? 'Redeeming...' : 'Redeem Code'}
          </button>
        </form>
      </SectionCard>

      <SectionCard theme={theme} title="Unlocked Features" subtitle="Customer-facing features currently available for this server.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {features.length ? features.map((feature) => <FeaturePill key={feature} theme={theme} feature={feature} />) : <EmptyState theme={theme} text="No feature entitlements found." />}
        </div>
      </SectionCard>

      <SectionCard theme={theme} title="Current Limits" subtitle="Usage limits for this server's current Goliath plan.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12 }}>
          {Object.keys(limits).length ? Object.entries(limits).map(([key, value]) => (
            <DetailCard key={key} theme={theme} label={formatLimitLabel(key)} value={formatLimit(value)} />
          )) : <EmptyState theme={theme} text="No plan limits found." />}
        </div>
      </SectionCard>

      <SectionCard
        theme={theme}
        title="Choose Your Plan"
        subtitle="Lifetime only appears here when KSJ Digital makes it publicly available."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
          {plans.map((plan) => <PlanCard key={plan.id} theme={theme} plan={plan} current={plan.id === subscription.plan} onUpgrade={handleUpgrade} />)}
        </div>
      </SectionCard>

      <FeatureComparison theme={theme} />

      <SectionCard theme={theme} title="Payment Options" subtitle="Stripe and PayPal support will connect here in a later billing phase.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
          <DetailCard theme={theme} label="Card Payments" value="Stripe Coming Soon" hint="Debit card, credit card, Apple Pay and Google Pay." />
          <DetailCard theme={theme} label="PayPal" value="PayPal Coming Soon" hint="PayPal checkout will feed into the same subscription system." />
          <DetailCard theme={theme} label="Billing History" value="Coming Soon" hint="Invoices and subscription events after payment integration." />
        </div>
      </SectionCard>
    </PageShell>
  );
}
