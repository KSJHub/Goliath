import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { api } from '../../services/apiClient.js';
import ModuleCard from '../../ui/ModuleCard.jsx';
import { MODULE_STATUSES, moduleRegistry } from '../../shared/moduleRegistry.js';

function StatCard({ theme, label, value, hint }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.34)', borderRadius: 18, padding: 16 }}>
      <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, color: theme.cardText }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, color: theme.mutedText, fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

function getGuildId(selectedGuild, selectedGuildData) {
  const id = selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '';
  return String(id).split(':').pop().trim();
}

function mergeModuleState(registryModules, moduleState, features = []) {
  const featureSet = new Set(features);

  return registryModules.map((module) => {
    const saved = moduleState?.[module.key];
    const savedEnabled = typeof saved === 'boolean'
      ? saved
      : saved && typeof saved === 'object'
        ? saved.enabled !== false && (saved.enabled === true || module.enabled === true)
        : module.enabled === true;
    const locked = Boolean(module.requiredFeature && !featureSet.has(module.requiredFeature));

    return {
      ...module,
      enabled: savedEnabled,
      locked,
      savedConfig: saved && typeof saved === 'object' ? saved : {},
    };
  });
}

function EmojiBankPanel({ theme, guildId, onBack }) {
  const [overview, setOverview] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const cardStyle = {
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
  };

  async function loadOverview() {
    if (!guildId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.request(`/api/emojis/${guildId}/overview`);
      setOverview(data);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load Emoji Bank.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, [guildId]);

  const selected = useMemo(() => {
    const ids = new Set(overview?.favourites || []);
    return (overview?.bank || []).filter((emoji) => ids.has(emoji.id));
  }, [overview]);

  async function searchEmojiGG(event) {
    event?.preventDefault?.();
    const clean = query.trim();
    if (!clean) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.request(`/api/emojis/${guildId}/search?q=${encodeURIComponent(clean)}&limit=25`);
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (searchError) {
      setError(searchError.message || 'Emoji.gg search failed.');
    } finally {
      setLoading(false);
    }
  }

  async function importEmoji(entry) {
    const id = String(entry?.id || '');
    if (!id) return;
    setBusyId(`import:${id}`);
    setError('');
    try {
      const data = await api.request(`/api/emojis/${guildId}/import`, {
        method: 'POST',
        body: JSON.stringify({ emojiGgId: id, selectForGuild: true }),
      });
      setOverview(data);
    } catch (importError) {
      setError(importError.message || 'Failed to import emoji.');
    } finally {
      setBusyId('');
    }
  }

  async function setSelected(emojiId, value) {
    setBusyId(`select:${emojiId}`);
    setError('');
    try {
      const data = await api.request(`/api/emojis/${guildId}/favourites/${encodeURIComponent(emojiId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ selected: value }),
      });
      setOverview(data);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update this server Emoji Bank.');
    } finally {
      setBusyId('');
    }
  }

  if (!guildId) {
    return <section style={{ ...cardStyle, padding: 24 }}>Select a guild before opening Emoji Bank.</section>;
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...cardStyle, padding: 24, background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08) 48%, rgba(168,85,247,0.16))' }}>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <button type="button" onClick={onBack} style={{ border: 0, background: 'transparent', color: '#93c5fd', padding: 0, cursor: 'pointer', fontWeight: 900 }}>← Modules</button>
            <p style={{ margin: '18px 0 6px', color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Utility Studio</p>
            <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Emoji Bank</h1>
            <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 760 }}>Import from Emoji.gg directly into Goliath's Discord-hosted application emoji bank. No emoji image files are stored on Goliath.</p>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <StatCard theme={theme} label="Goliath Bank" value={`${overview?.capacity?.used || 0} / ${overview?.capacity?.max || 2000}`} hint="Hosted by Discord" />
          <StatCard theme={theme} label="This Guild" value={`${overview?.guildCapacity?.used || 0} / ${overview?.guildCapacity?.max || 100}`} hint="Selected references only" />
          <StatCard theme={theme} label="Goliath Storage" value="0 images" hint="No local emoji files" />
        </div>
      </section>

      {(error || loading) ? (
        <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : theme.mutedText, fontWeight: 850 }}>
          {error || 'Loading Emoji Bank...'}
        </section>
      ) : null}

      <section style={{ ...cardStyle, padding: 20 }}>
        <h2 style={{ margin: 0 }}>Search Emoji.gg</h2>
        <form onSubmit={searchEmojiGG} style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search emoji name or ID"
            style={{ flex: '1 1 260px', minWidth: 0, padding: '12px 14px', borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.35)', color: theme.cardText }}
          />
          <button type="submit" disabled={loading} style={{ padding: '12px 18px', borderRadius: 12, border: 0, cursor: 'pointer', fontWeight: 900 }}>Search</button>
        </form>

        {results.length ? (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12 }}>
            {results.map((entry) => {
              const image = entry.image || entry.url || entry.src || '';
              return (
                <div key={entry.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {image ? <img src={image} alt="" width="48" height="48" style={{ objectFit: 'contain' }} /> : null}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 950, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.title || entry.slug || `Emoji ${entry.id}`}</div>
                      <div style={{ color: theme.mutedText, fontSize: 12 }}>Emoji.gg #{entry.id}</div>
                    </div>
                  </div>
                  <button type="button" disabled={Boolean(busyId)} onClick={() => importEmoji(entry)} style={{ padding: '10px 12px', borderRadius: 10, border: 0, cursor: 'pointer', fontWeight: 900 }}>
                    {busyId === `import:${entry.id}` ? 'Importing...' : 'Import + Select'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section style={{ ...cardStyle, padding: 20 }}>
        <h2 style={{ margin: 0 }}>This Guild's Emoji Bank</h2>
        <p style={{ color: theme.mutedText, margin: '8px 0 0' }}>Up to 100 references. The actual emoji is held once by Discord for the Goliath application.</p>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          {selected.length ? selected.map((emoji) => (
            <div key={emoji.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {emoji.url ? <img src={emoji.url} alt="" width="42" height="42" style={{ objectFit: 'contain' }} /> : null}
                <div style={{ fontWeight: 900 }}>{emoji.name}</div>
              </div>
              <button type="button" disabled={Boolean(busyId)} onClick={() => setSelected(emoji.id, false)} style={{ padding: '9px 11px', borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: 'transparent', color: theme.cardText, cursor: 'pointer', fontWeight: 850 }}>
                {busyId === `select:${emoji.id}` ? 'Updating...' : 'Remove from Guild'}
              </button>
            </div>
          )) : <div style={{ color: theme.mutedText }}>No Goliath emojis selected for this guild yet.</div>}
        </div>
      </section>

      <section style={{ ...cardStyle, padding: 20 }}>
        <h2 style={{ margin: 0 }}>Goliath Application Bank</h2>
        <p style={{ color: theme.mutedText, margin: '8px 0 0' }}>Existing application emojis can be selected by any connected guild without another upload.</p>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          {(overview?.bank || []).map((emoji) => {
            const isSelected = (overview?.favourites || []).includes(emoji.id);
            return (
              <div key={emoji.id} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {emoji.url ? <img src={emoji.url} alt="" width="42" height="42" style={{ objectFit: 'contain' }} /> : null}
                  <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis' }}>{emoji.name}</div>
                </div>
                <button type="button" disabled={Boolean(busyId) || isSelected} onClick={() => setSelected(emoji.id, true)} style={{ padding: '9px 11px', borderRadius: 10, border: 0, cursor: isSelected ? 'default' : 'pointer', fontWeight: 850 }}>
                  {isSelected ? 'Selected' : busyId === `select:${emoji.id}` ? 'Updating...' : 'Select for Guild'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function Modules({ theme, selectedGuild, selectedGuildData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const panel = new URLSearchParams(location.search).get('panel');

  const [moduleState, setModuleState] = useState({});
  const [entitlementFeatures, setEntitlementFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');

  useEffect(() => {
    let active = true;

    async function loadModules() {
      if (!guildId) {
        setModuleState({});
        setEntitlementFeatures([]);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [modulesResult, entitlementsResult] = await Promise.all([
          api.getGuildModules(guildId),
          api.getBillingEntitlements(guildId).catch(() => ({ features: [] })),
        ]);
        if (!active) return;
        setModuleState(modulesResult.modules || {});
        setEntitlementFeatures(Array.isArray(entitlementsResult.features) ? entitlementsResult.features : []);
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message || 'Failed to load guild module states.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadModules();

    return () => {
      active = false;
    };
  }, [guildId]);

  const registryModules = useMemo(() => (
    [...moduleRegistry].sort((a, b) => a.name.localeCompare(b.name))
  ), []);

  const modules = useMemo(() => (
    mergeModuleState(registryModules, moduleState, entitlementFeatures).sort((a, b) => a.name.localeCompare(b.name))
  ), [registryModules, moduleState, entitlementFeatures]);

  const stats = useMemo(() => ({
    total: modules.length,
    enabled: modules.filter((module) => module.enabled).length,
    locked: modules.filter((module) => module.locked).length,
    dashboardReady: modules.filter((module) => module.status === MODULE_STATUSES.backendReady || module.status === MODULE_STATUSES.live).length,
  }), [modules]);

  const cardStyle = {
    border: `1px solid ${theme.cardBorder}`,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 22,
    boxShadow: theme.shadow,
  };

  function handleOpenModule(module) {
    if (!module?.route) return;

    if (module.locked) {
      setError(`${module.name} requires Goliath ${String(module.requiredPlan || 'pro').toUpperCase()}. Open Billing to unlock it.`);
      return;
    }

    if (module.enabled !== true) {
      setError(`Enable ${module.name} before opening its dashboard page.`);
      return;
    }

    setError('');
    navigate(module.route);
  }

  async function handleToggleModule(module, enabled) {
    if (!guildId || !module?.key) return;

    if (module.locked) {
      setError(`${module.name} requires Goliath ${String(module.requiredPlan || 'pro').toUpperCase()}. Open Billing to unlock it.`);
      return;
    }

    const previousState = moduleState;
    const nextModuleConfig = {
      ...(typeof previousState[module.key] === 'object' ? previousState[module.key] : {}),
      enabled,
    };

    setSavingKey(module.key);
    setError('');
    setModuleState({ ...previousState, [module.key]: nextModuleConfig });

    try {
      const result = await api.setGuildModuleEnabled(guildId, module.key, enabled);
      setModuleState(result.modules || { ...previousState, [module.key]: nextModuleConfig });
    } catch (saveError) {
      setModuleState(previousState);
      setError(saveError.message || 'Failed to save module state.');
    } finally {
      setSavingKey('');
    }
  }

  if (panel === 'emojis') {
    return <EmojiBankPanel theme={theme} guildId={guildId} onBack={() => navigate('/modules')} />;
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ ...cardStyle, padding: 24, position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.08) 46%, rgba(52,211,153,0.14))' }}>
        <div style={{ position: 'relative', display: 'grid', gap: 18 }}>
          <div>
            <p style={{ margin: '0 0 8px', color: '#93c5fd', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Goliath Modules Hub</p>
            <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em' }}>Modules</h1>
            <p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6, maxWidth: 840 }}>Enable a module, then open it from this grid. Premium modules are locked until the server has the required plan.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
            <StatCard theme={theme} label="Feature Modules" value={stats.total} hint="Grid launcher" />
            <StatCard theme={theme} label="Enabled" value={stats.enabled} hint="Saved to guild JSON" />
            <StatCard theme={theme} label="Locked" value={stats.locked} hint="Premium gated" />
            <StatCard theme={theme} label="Dashboard Ready" value={stats.dashboardReady} hint="Every module opens" />
          </div>
        </div>
      </section>

      {(error || loading) ? (
        <section style={{ ...cardStyle, padding: 16, color: error ? '#fca5a5' : theme.mutedText, fontWeight: 850 }}>
          {error || 'Loading module states...'}
        </section>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 14 }}>
        {modules.map((module) => (
          <ModuleCard
            key={module.key}
            module={module}
            theme={theme}
            onOpen={handleOpenModule}
            onToggle={handleToggleModule}
            saving={savingKey === module.key}
          />
        ))}
      </section>
    </div>
  );
}
