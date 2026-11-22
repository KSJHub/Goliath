import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient.js';
import PageShell, { EmptyState, LoadingPanel, Notice, PrimaryButton, SectionCard, StatGrid, SummaryStat } from '../../shared/PageShell';
import PremiumLock from '../../shared/PremiumLock.jsx';
import TranslationThreadsPanel from './TranslationThreadsPanel.jsx';

const PROVIDER_OPTIONS = [
  { id: 'manual', label: 'Manual / Not configured' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepl', label: 'DeepL' },
  { id: 'google', label: 'Google Translate' },
];

const LANGUAGE_OPTIONS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'ar', 'hi', 'ja', 'ko', 'zh'];

function getGuildId(selectedGuild, selectedGuildData) {
  return String(selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '').split(':').pop().trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function flattenThreads(threadMappings = {}) {
  return Object.values(threadMappings || {}).flatMap((languageMap) => Object.values(languageMap || {}));
}

function formatDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function formatNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number.toLocaleString() : String(fallback);
}

function fieldStyle(theme) {
  return { border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.72)', color: theme.cardText, borderRadius: 12, padding: '11px 12px', fontWeight: 900, minWidth: 0, outline: 'none' };
}

function DetailRow({ theme, label, value, hint }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.28)', borderRadius: 14, padding: 13, display: 'grid', gap: 4 }}><div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div><div style={{ color: theme.cardText, fontWeight: 950, overflowWrap: 'anywhere', textTransform: typeof value === 'string' && value.includes('_') ? 'capitalize' : 'none' }}>{value || 'None'}</div>{hint ? <div style={{ color: theme.mutedText, fontSize: 12, overflowWrap: 'anywhere' }}>{hint}</div> : null}</div>;
}

function StatusPill({ enabled, label }) {
  const tone = enabled ? '#86efac' : '#fca5a5';
  return <span style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label || (enabled ? 'enabled' : 'disabled')}</span>;
}

function ReadinessBanner({ theme, enabled, providerReady, channels, threads, providerName, providerError }) {
  const ready = enabled && providerReady && channels.length > 0;
  const tone = ready ? '#86efac' : '#fcd34d';
  const title = ready ? 'Translation Hub is ready' : 'Translation Hub needs setup';
  const items = [
    enabled ? 'Hub enabled' : 'Enable the Translation Hub',
    providerReady ? `${providerName} provider ready` : 'Connect a provider API key',
    channels.length ? `${channels.length} channel${channels.length === 1 ? '' : 's'} configured` : 'Add a translation channel',
    threads.length ? `${threads.length} language thread${threads.length === 1 ? '' : 's'} mapped` : 'Recover/create language threads',
  ];

  return (
    <div style={{ border: `1px solid ${tone}`, background: ready ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)', borderRadius: 20, padding: 16, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: theme.cardText }}>{title}</h2>
          <p style={{ margin: '6px 0 0', color: theme.mutedText, lineHeight: 1.55 }}>{ready ? 'Provider, channels and thread mappings are in place.' : 'Finish the checklist below before expecting live thread translations.'}</p>
          {providerError ? <p style={{ margin: '6px 0 0', color: '#fca5a5', lineHeight: 1.45 }}>{providerError}</p> : null}
        </div>
        <StatusPill enabled={ready} label={ready ? 'Ready' : 'Setup'} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 8 }}>
        {items.map((item, index) => {
          const done = index === 0 ? enabled : index === 1 ? providerReady : index === 2 ? channels.length > 0 : threads.length > 0;
          return <div key={item} style={{ border: `1px solid ${done ? 'rgba(134,239,172,0.35)' : 'rgba(252,211,77,0.35)'}`, borderRadius: 12, padding: 10, color: done ? '#bbf7d0' : '#fde68a', fontWeight: 900 }}>{done ? E.SUCCESS : E.WARNING} {item}</div>;
        })}
      </div>
    </div>
  );
}

function ProviderHealthGrid({ theme, providerStatus }) {
  const providers = providerStatus?.supportedProviders || PROVIDER_OPTIONS.map((option) => ({ ...option, status: option.id === 'manual' ? 'not_configured' : 'unknown' }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 10 }}>
      {providers.map((provider) => {
        const isManual = provider.id === 'manual';
        const healthy = provider.healthy || provider.ready;
        const selected = provider.selected || providerStatus?.provider === provider.id;
        const tone = isManual ? '#94a3b8' : healthy ? '#86efac' : provider.apiKeyConfigured ? '#fcd34d' : '#fca5a5';
        const status = isManual ? 'Fallback only' : healthy ? 'Ready' : provider.apiKeyConfigured ? 'Check provider' : 'Missing key';

        return (
          <div key={provider.id} style={{ border: `1px solid ${selected ? tone : theme.cardBorder}`, background: selected ? 'rgba(15,23,42,0.42)' : 'rgba(15,23,42,0.22)', borderRadius: 15, padding: 13, display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <strong style={{ color: theme.cardText }}>{provider.label}</strong>
              {selected ? <span style={{ color: tone, fontSize: 11, fontWeight: 950 }}>SELECTED</span> : null}
            </div>
            <span style={{ color: tone, fontWeight: 950 }}>{status}</span>
            {provider.errorMessage ? <span style={{ color: theme.mutedText, fontSize: 12, lineHeight: 1.4 }}>{provider.errorMessage}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ChannelCard({ theme, channel, resourceChannel, onDisable, onRemove }) {
  const enabled = channel.enabled !== false;
  const name = resourceChannel?.name || channel.name || channel.channelName || channel.channelId || 'Translation Channel';
  const sourceLanguage = channel.sourceLanguage || channel.from || channel.language || 'auto';
  const targetLanguage = channel.targetLanguage || channel.to || channel.outputLanguage || channel.targetLanguages?.join?.(', ') || 'not set';

  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.26)', borderRadius: 18, padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{channel.channelId || channel.sourceChannelId || 'translation_channel'}</div>
          <h3 style={{ margin: '5px 0 0', color: theme.cardText }}>#{name}</h3>
        </div>
        <StatusPill enabled={enabled} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10 }}>
        <DetailRow theme={theme} label="Source" value={sourceLanguage} />
        <DetailRow theme={theme} label="Target" value={targetLanguage} />
        <DetailRow theme={theme} label="Mode" value={channel.mode || 'auto'} />
        <DetailRow theme={theme} label="Thread Mode" value={channel.threadMode || channel.threadsEnabled ? 'Enabled' : 'Disabled'} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => onDisable(channel.channelId || channel.sourceChannelId)} style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 11, padding: '9px 11px', fontWeight: 900 }}>{enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" onClick={() => onRemove(channel.channelId || channel.sourceChannelId)} style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.12)', color: '#fca5a5', borderRadius: 11, padding: '9px 11px', fontWeight: 900 }}>Remove</button>
      </div>
    </div>
  );
}

function PreferenceCard({ theme, preference }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.24)', borderRadius: 14, padding: 13, display: 'grid', gap: 8 }}><strong style={{ color: theme.cardText }}>{preference.userTag || preference.username || preference.userId || preference.id || 'Unknown user'}</strong><div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}><div><strong style={{ color: theme.cardText }}>Language:</strong> {preference.language || preference.locale || preference.preferredLanguage || 'Not set'}</div><div><strong style={{ color: theme.cardText }}>Updated:</strong> {formatDate(preference.updatedAt)}</div></div></div>;
}

export default function Translation({ theme, selectedGuild, selectedGuildData }) {
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [config, setConfig] = useState({});
  const [resources, setResources] = useState({ channels: [] });
  const [providerStatus, setProviderStatus] = useState(null);
  const [providerForm, setProviderForm] = useState({ provider: 'manual', defaultLanguage: 'en', sourceLanguage: 'auto' });
  const [channelForm, setChannelForm] = useState({ channelId: '', sourceLanguage: 'auto', targetLanguages: ['en'], mode: 'auto', threadMode: true });
  const [entitlements, setEntitlements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const settings = config.settings || {};
  const analytics = config.analytics || {};
  const channels = useMemo(() => asArray(config.channels || config.channelPairs || config.configuredChannels), [config]);
  const preferences = useMemo(() => asArray(config.userLanguages || config.preferences || config.userPreferences), [config]);
  const threads = useMemo(() => flattenThreads(config.threadMappings || config.threads || config.translationThreads), [config]);
  const activeThreads = useMemo(() => threads.filter((thread) => thread?.active !== false && !thread?.archived && !thread?.locked), [threads]);
  const textChannels = useMemo(() => (resources.channels || []).filter((channel) => channel.type === 0 || channel.type === 5 || channel.type === 'GuildText' || channel.type === 'GuildAnnouncement'), [resources]);
  const channelById = useMemo(() => Object.fromEntries(textChannels.map((channel) => [String(channel.id), channel])), [textChannels]);
  const hasTranslationAccess = Array.isArray(entitlements?.features) && entitlements.features.includes('translation.hub');

  async function load() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    setNotice('');

    try {
      const entitlementPayload = await api.getBillingEntitlements(guildId);
      setEntitlements(entitlementPayload);

      if (!Array.isArray(entitlementPayload.features) || !entitlementPayload.features.includes('translation.hub')) {
        setConfig({ enabled: false, settings: {}, channels: {}, userLanguages: {}, analytics: {} });
        setProviderStatus(null);
        return;
      }

      const [configPayload, providerPayload, resourcePayload] = await Promise.all([
        api.getTranslationConfig(guildId),
        api.getTranslationProvider(guildId),
        api.request(`/api/discord/${guildId}/resources`).catch(() => ({ channels: [] })),
      ]);

      const nextConfig = configPayload.config || { enabled: false, settings: {}, channels: {}, userLanguages: {}, analytics: {} };
      const nextProvider = providerPayload.provider || nextConfig.providerStatus || null;

      setConfig(nextConfig);
      setProviderStatus(nextProvider);
      setResources(resourcePayload || { channels: [] });
      setProviderForm({
        provider: nextProvider?.provider || nextConfig.provider || nextConfig.settings?.provider || 'manual',
        defaultLanguage: nextProvider?.defaultLanguage || nextConfig.settings?.defaultTargetLanguage || 'en',
        sourceLanguage: nextProvider?.sourceLanguage || nextConfig.settings?.defaultSourceLanguage || 'auto',
      });
      setChannelForm((current) => ({ ...current, targetLanguages: nextConfig.settings?.targetLanguages || current.targetLanguages || ['en'] }));
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Translation Hub.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [guildId]);

  async function toggleEnabled() {
    if (!guildId || !hasTranslationAccess) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const enabled = config.enabled !== true;
      const result = await api.setTranslationEnabled(guildId, enabled);
      setConfig(result.config || { ...config, enabled });
      setNotice(`Translation Hub ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update Translation Hub status.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProvider(event) {
    event.preventDefault();
    if (!guildId || !hasTranslationAccess) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api.saveTranslationProvider(guildId, providerForm);
      setConfig(result.config || config);
      setProviderStatus(result.provider || null);
      setNotice('Translation provider settings saved. API keys stay server-side.');
    } catch (saveError) {
      setError(saveError.message || 'Failed to save provider settings.');
    } finally {
      setSaving(false);
    }
  }

  async function saveChannel(event) {
    event.preventDefault();
    if (!guildId || !channelForm.channelId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        enabled: true,
        mode: channelForm.mode || 'auto',
        sourceLanguage: channelForm.sourceLanguage || 'auto',
        targetLanguages: channelForm.targetLanguages,
        targetLanguage: channelForm.targetLanguages?.[0] || 'en',
        threadMode: channelForm.threadMode !== false,
        autoCreateThreads: channelForm.threadMode !== false,
      };
      const result = channelForm.threadMode
        ? await api.request(`/api/translation/${guildId}/threads/channels/${channelForm.channelId}/enable`, { method: 'POST', body: JSON.stringify(payload) })
        : await api.request(`/api/translation/${guildId}/channels/${channelForm.channelId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setConfig(result.config || config);
      setNotice(channelForm.threadMode ? 'Translation channel saved and thread recovery started.' : 'Translation channel saved.');
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save translation channel.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleChannel(channelId) {
    if (!guildId || !channelId) return;
    const channel = (config.channels || {})[channelId] || {};
    setSaving(true);
    setError('');
    try {
      const enabled = channel.enabled === false;
      const result = enabled
        ? await api.request(`/api/translation/${guildId}/threads/channels/${channelId}/enable`, { method: 'POST', body: JSON.stringify({ ...channel, enabled: true }) })
        : await api.request(`/api/translation/${guildId}/threads/channels/${channelId}/disable`, { method: 'POST' });
      setConfig(result.config || config);
      setNotice(`Translation channel ${enabled ? 'enabled' : 'disabled'}.`);
      await load();
    } catch (saveError) {
      setError(saveError.message || 'Failed to update translation channel.');
    } finally {
      setSaving(false);
    }
  }

  async function removeChannel(channelId) {
    if (!guildId || !channelId) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.request(`/api/translation/${guildId}/channels/${channelId}`, { method: 'DELETE' });
      setConfig(result.config || config);
      setNotice('Translation channel removed.');
      await load();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to remove translation channel.');
    } finally {
      setSaving(false);
    }
  }

  if (!guildId) return <PageShell title="Translation Hub" subtitle="Select a server to manage translation settings." theme={theme}><EmptyState theme={theme} text="Select a server to manage Translation Hub." /></PageShell>;

  if (!loading && entitlements && !hasTranslationAccess) {
    return <PageShell title="Translation Hub" subtitle="Translation Hub is a premium Goliath Pro feature." theme={theme} guild={{ id: guildId, name: 'Translation Hub' }}><PremiumLock theme={theme} title="Translation Hub" featureKey="translation.hub" currentPlan={entitlements.plan} requiredPlan={{ name: 'Pro', icon: E.CROWN }} message="Realtime multilingual channels, provider integration and translation threads require Goliath Pro." unlocks={['OpenAI, DeepL or Google provider support', 'Realtime translation channels', 'User language profiles', 'Translation threads', 'Translation analytics']} /></PageShell>;
  }

  const providerName = providerStatus?.label || settings.provider || config.provider || 'Not configured';
  const providerReady = Boolean(providerStatus?.ready);
  const providerState = providerStatus?.status || (providerReady ? 'ready' : 'not_configured');
  const providerError = providerStatus?.errorMessage || (providerReady ? '' : providerState === 'missing_api_key' ? 'Selected provider is missing its server-side API key.' : 'Select and configure a provider before enabling live translations.');

  return (
    <PageShell title="Translation Hub" subtitle="Manage multilingual channels, providers, language threads and translation analytics." theme={theme} guild={{ id: guildId, name: 'Translation Hub' }} actions={<><button type="button" onClick={toggleEnabled} disabled={saving || loading || !hasTranslationAccess} style={{ border: config.enabled === true ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(239,68,68,0.45)', background: config.enabled === true ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)', color: config.enabled === true ? '#86efac' : '#fca5a5', borderRadius: 999, padding: '9px 13px', fontWeight: 950 }}>{config.enabled === true ? 'Enabled' : 'Disabled'}</button><PrimaryButton onClick={load} disabled={loading}>Refresh</PrimaryButton></>}>
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {notice ? <Notice theme={theme} tone="success">{notice}</Notice> : null}
      {loading ? <LoadingPanel theme={theme} text="Loading Translation Hub..." /> : null}

      <ReadinessBanner theme={theme} enabled={config.enabled === true} providerReady={providerReady} channels={channels} threads={activeThreads} providerName={providerName} providerError={providerError} />

      <StatGrid min="min(190px, 100%)">
        <SummaryStat theme={theme} label="Hub" value={config.enabled === true ? 'Enabled' : 'Disabled'} accent={config.enabled === true ? '#22c55e' : '#f59e0b'} description="modules.translation.enabled" />
        <SummaryStat theme={theme} label="Provider" value={providerReady ? 'Ready' : 'Needs Setup'} accent={providerReady ? '#22c55e' : '#f59e0b'} description={providerName} />
        <SummaryStat theme={theme} label="Channels" value={channels.length} accent="#3b82f6" description="Configured translation channels" />
        <SummaryStat theme={theme} label="Threads" value={`${activeThreads.length}/${threads.length}`} accent="#a855f7" description="Active / mapped language threads" />
        <SummaryStat theme={theme} label="Failures" value={formatNumber(analytics.failedTranslations ?? analytics.failed ?? analytics.failures ?? 0)} accent="#f97316" description="Provider or thread failures" />
      </StatGrid>

      <SectionCard theme={theme} title="Provider Configuration" subtitle="Choose the translation provider and default languages. API keys are configured on the server only.">
        <form onSubmit={saveProvider} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Provider<ThemedSelect theme={theme} value={providerForm.provider} onChange={(event) => setProviderForm((current) => ({ ...current, provider: event.target.value }))} style={fieldStyle(theme)}>{PROVIDER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</ThemedSelect></label>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Source Language<input value={providerForm.sourceLanguage} onChange={(event) => setProviderForm((current) => ({ ...current, sourceLanguage: event.target.value }))} placeholder="auto" style={fieldStyle(theme)} /></label>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Default Target<input value={providerForm.defaultLanguage} onChange={(event) => setProviderForm((current) => ({ ...current, defaultLanguage: event.target.value }))} placeholder="en" style={fieldStyle(theme)} /></label>
          </div>
          <ProviderHealthGrid theme={theme} providerStatus={providerStatus} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <DetailRow theme={theme} label="Selected Provider" value={providerName} />
            <DetailRow theme={theme} label="Provider Status" value={providerState.replace(/_/g, ' ')} hint={providerStatus?.errorMessage || ''} />
            <DetailRow theme={theme} label="API Key" value={providerStatus?.apiKeyConfigured ? 'Configured' : 'Missing'} hint="Set provider API keys in the VPS .env files. Secrets are never returned to the dashboard." />
          </div>
          <button type="submit" disabled={saving} style={{ justifySelf: 'start', border: '1px solid rgba(34,197,94,0.42)', background: saving ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.18)', color: '#bbf7d0', borderRadius: 12, padding: '11px 13px', fontWeight: 950, cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving...' : 'Save Provider Settings'}</button>
        </form>
      </SectionCard>

      <SectionCard theme={theme} title="Add Translation Channel" subtitle="Pick a Discord text channel, choose language behaviour, and optionally create language threads.">
        {!providerReady ? <Notice theme={theme} tone="warning">Provider is not ready yet. You can configure channels now, but live translations will fail until the selected provider has a valid API key.</Notice> : null}
        <form onSubmit={saveChannel} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Source Channel<ThemedSelect theme={theme} value={channelForm.channelId} onChange={(event) => setChannelForm((current) => ({ ...current, channelId: event.target.value }))} style={fieldStyle(theme)}><option value="">Select text channel</option>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</ThemedSelect></label>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Mode<ThemedSelect theme={theme} value={channelForm.mode} onChange={(event) => setChannelForm((current) => ({ ...current, mode: event.target.value }))} style={fieldStyle(theme)}><option value="auto">Auto translate</option><option value="manual">Manual commands only</option><option value="thread">Thread translation</option></ThemedSelect></label>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Source Language<input value={channelForm.sourceLanguage} onChange={(event) => setChannelForm((current) => ({ ...current, sourceLanguage: event.target.value }))} placeholder="auto" style={fieldStyle(theme)} /></label>
            <label style={{ display: 'grid', gap: 6, color: theme.mutedText, fontWeight: 900 }}>Target Languages<ThemedSelect theme={theme} multiple value={channelForm.targetLanguages} onChange={(event) => setChannelForm((current) => ({ ...current, targetLanguages: Array.from(event.target.selectedOptions).map((option) => option.value) }))} style={{ ...fieldStyle(theme), minHeight: 132 }}>{LANGUAGE_OPTIONS.map((language) => <option key={language} value={language}>{language}</option>)}</ThemedSelect></label>
          </div>
          <label style={{ color: theme.mutedText, fontWeight: 900 }}><input type="checkbox" checked={channelForm.threadMode} onChange={(event) => setChannelForm((current) => ({ ...current, threadMode: event.target.checked }))} /> Create/manage translation threads for selected languages</label>
          <button type="submit" disabled={saving || !channelForm.channelId} style={{ justifySelf: 'start', border: '1px solid rgba(59,130,246,0.42)', background: saving ? 'rgba(59,130,246,0.10)' : 'rgba(59,130,246,0.18)', color: '#bfdbfe', borderRadius: 12, padding: '11px 13px', fontWeight: 950, cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving...' : 'Save Translation Channel'}</button>
        </form>
      </SectionCard>

      <TranslationThreadsPanel theme={theme} guildId={guildId} config={config} onRefresh={load} />

      <SectionCard theme={theme} title="Translation Analytics" subtitle="Usage data from modules.translation.analytics.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <DetailRow theme={theme} label="Manual Translations" value={formatNumber(analytics.manualTranslations ?? 0)} />
          <DetailRow theme={theme} label="Auto Translations" value={formatNumber(analytics.autoTranslations ?? 0)} />
          <DetailRow theme={theme} label="Thread Translations" value={formatNumber(analytics.threadTranslations ?? 0)} />
          <DetailRow theme={theme} label="Threads Created" value={formatNumber(analytics.threadsCreated ?? 0)} />
          <DetailRow theme={theme} label="Failures" value={formatNumber(analytics.failedTranslations ?? analytics.failed ?? analytics.failures ?? 0)} />
          <DetailRow theme={theme} label="Last Translation" value={formatDate(analytics.lastTranslationAt || analytics.lastTranslatedAt)} />
        </div>
      </SectionCard>

      <SectionCard theme={theme} title="Channel Management" subtitle="Configured channel language pairs and output behaviour.">
        <div style={{ display: 'grid', gap: 12 }}>{channels.length ? channels.map((channel, index) => <ChannelCard key={channel.id || channel.channelId || channel.sourceChannelId || index} theme={theme} channel={channel} resourceChannel={channelById[String(channel.channelId || channel.sourceChannelId)]} onDisable={toggleChannel} onRemove={removeChannel} />) : <EmptyState theme={theme} text="No translation channels configured yet." />}</div>
      </SectionCard>

      <SectionCard theme={theme} title="User Language Preferences" subtitle="Stored user language preferences for automatic translation flows.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>{preferences.length ? preferences.slice(0, 12).map((preference, index) => <PreferenceCard key={preference.userId || preference.id || index} theme={theme} preference={preference} />) : <EmptyState theme={theme} text="No user language preferences stored yet." />}</div>
      </SectionCard>
    </PageShell>
  );
}
