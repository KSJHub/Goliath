import { dashboardPath } from '../../services/dashboardPath.js';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';

const TOOLS = [
  {
    key: 'gif',
    label: 'GIF Maker',
    icon: '🎞️',
    description: 'Create Discord-ready GIFs from short videos or animated uploads.',
  },
  {
    key: 'emoji',
    label: 'Emoji Maker',
    icon: '😀',
    description: 'Create emoji and role-icon assets for Discord servers.',
  },
];

const cardStyle = {
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 22,
  background: 'rgba(15, 23, 42, 0.62)',
  boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getGuildId(props) {
  return String(props.selectedGuildId || props.selectedGuild || '').split(':').pop();
}

function lockedMessage(payload) {
  return payload?.upgradeHint || payload?.error || 'Upgrade to Goliath Plus or higher to unlock Media Tools.';
}

function processorBadge(processor) {
  return processor?.available ? 'Available' : 'Missing';
}

export default function MediaTools(props) {
  const guildId = getGuildId(props);
  const [activeTool, setActiveTool] = useState('gif');
  const [file, setFile] = useState(null);
  const [assetName, setAssetName] = useState('');
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [entitlements, setEntitlements] = useState(null);
  const [mediaStatus, setMediaStatus] = useState(null);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState('');
  const [options, setOptions] = useState({
    fps: 12,
    width: 480,
    start: 0,
    duration: 6,
    preset: 'emoji',
    size: 128,
    format: 'png',
  });

  const activeMeta = useMemo(() => TOOLS.find((tool) => tool.key === activeTool) || TOOLS[0], [activeTool]);
  const planName = entitlements?.entitlements?.plan?.name || entitlements?.entitlements?.subscription?.plan || 'Unknown';

  async function loadStatus() {
    if (!guildId) return;
    setStatusLoading(true);
    try {
      const payload = await api.request(`/api/media/${guildId}/status`);
      setMediaStatus(payload.status || null);
    } catch (error) {
      if (error.status === 403 || error.data?.code === 'FEATURE_LOCKED') {
        setLocked(true);
      } else {
        setMediaStatus(null);
      }
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadEntitlements() {
    if (!guildId) return;
    setEntitlementsLoading(true);
    try {
      const payload = await api.request(`/api/media/${guildId}/entitlements`);
      setEntitlements(payload);
      setLocked(!payload.unlocked);
      if (payload.unlocked) loadStatus();
    } catch (error) {
      setEntitlements(null);
      setLocked(error.status === 403 || error.data?.code === 'FEATURE_LOCKED');
      setNotice(lockedMessage(error.data));
    } finally {
      setEntitlementsLoading(false);
    }
  }

  async function loadLibrary() {
    if (!guildId) return;
    setLibraryLoading(true);
    try {
      const payload = await api.request(`/api/media/${guildId}/library`);
      setLibrary(Array.isArray(payload.assets) ? payload.assets : []);
      setLocked(false);
    } catch (error) {
      if (error.status === 403 || error.data?.code === 'FEATURE_LOCKED') {
        setLocked(true);
        setLibrary([]);
        setNotice(lockedMessage(error.data));
      } else {
        setNotice(error.message || 'Could not load media library.');
      }
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => {
    setNotice('');
    setLibrary([]);
    setMediaStatus(null);
    setLocked(false);
    if (!guildId) return;
    loadEntitlements();
    loadLibrary();
  }, [guildId]);

  async function createAsset(event) {
    event.preventDefault();
    if (!guildId) {
      setNotice('Select a guild first.');
      return;
    }
    if (locked) {
      setNotice('Upgrade to Goliath Plus or higher to create media assets.');
      return;
    }
    if (!file) {
      setNotice('Choose a file first.');
      return;
    }

    setLoading(true);
    setNotice('');

    try {
      const fileData = await fileToDataUrl(file);
      const payload = await api.request(`/api/media/${guildId}/${activeTool}/create`, {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          name: assetName || file.name,
          fileData,
          options,
        }),
      });

      setLibrary(Array.isArray(payload.library) ? payload.library : []);
      setFile(null);
      setAssetName('');
      setNotice(payload.asset?.warning || `${activeMeta.label} asset created.`);
      loadStatus();
    } catch (error) {
      if (error.status === 403 || error.data?.code === 'FEATURE_LOCKED') {
        setLocked(true);
        setNotice(lockedMessage(error.data));
      } else {
        setNotice(error.message || 'Media asset could not be created.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function deleteAsset(assetId) {
    if (!guildId || !assetId || locked) return;
    try {
      const payload = await api.request(`/api/media/${guildId}/assets/${assetId}`, { method: 'DELETE' });
      setLibrary(Array.isArray(payload.library) ? payload.library : []);
      setNotice('Asset deleted.');
    } catch (error) {
      if (error.status === 403 || error.data?.code === 'FEATURE_LOCKED') {
        setLocked(true);
        setNotice(lockedMessage(error.data));
      } else {
        setNotice(error.message || 'Could not delete asset.');
      }
    }
  }

  return (
    <main style={{ color: '#e5e7eb' }}>
      <section style={{ marginBottom: 22 }}>
        <div style={{ color: '#93c5fd', fontSize: 13, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Premium Utility
        </div>
        <h1 style={{ margin: '8px 0 8px', fontSize: 'clamp(28px, 4vw, 42px)', lineHeight: 1.05 }}>
          Media Tools
        </h1>
        <p style={{ margin: 0, color: '#94a3b8', maxWidth: 780, lineHeight: 1.65 }}>
          Create and store Discord-ready GIFs, emojis and role icons for the selected guild. Built as a separate utility workspace above Logs.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
        {TOOLS.map((tool) => {
          const active = activeTool === tool.key;
          return (
            <button
              key={tool.key}
              type="button"
              onClick={() => setActiveTool(tool.key)}
              style={{
                ...cardStyle,
                textAlign: 'left',
                padding: 18,
                cursor: 'pointer',
                color: '#e5e7eb',
                borderColor: active ? 'rgba(59, 130, 246, 0.85)' : 'rgba(148, 163, 184, 0.22)',
                background: active ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.32), rgba(15, 23, 42, 0.82))' : cardStyle.background,
              }}
            >
              <div style={{ fontSize: 30 }}>{tool.icon}</div>
              <div style={{ marginTop: 10, fontSize: 18, fontWeight: 950 }}>{tool.label} ⭐</div>
              <div style={{ marginTop: 6, color: '#94a3b8', lineHeight: 1.45 }}>{tool.description}</div>
            </button>
          );
        })}
      </section>

      {!locked && mediaStatus ? (
        <section style={{ ...cardStyle, padding: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: mediaStatus.ok ? '#86efac' : '#fde68a', fontWeight: 950, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 12 }}>
                {mediaStatus.ok ? 'Processing Ready' : 'Processing Fallback Active'}
              </div>
              <div style={{ marginTop: 4, color: '#cbd5e1' }}>
                {mediaStatus.ok ? 'FFmpeg and Sharp are available.' : 'Some processors are missing; fallback saving may be used.'}
              </div>
            </div>
            <button type="button" onClick={loadStatus} disabled={statusLoading} style={{ border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', borderRadius: 12, padding: '9px 12px', cursor: statusLoading ? 'not-allowed' : 'pointer', fontWeight: 900 }}>
              {statusLoading ? 'Checking…' : 'Recheck'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 14 }}>
            {(mediaStatus.processors || []).map((processor) => (
              <div key={processor.key} style={{ border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, padding: 12, background: 'rgba(2,6,23,.4)' }}>
                <div style={{ fontWeight: 950 }}>{processor.label}</div>
                <div style={{ color: processor.available ? '#86efac' : '#fca5a5', marginTop: 4, fontWeight: 900 }}>{processorBadge(processor)}</div>
                {processor.warning ? <div style={{ color: '#facc15', marginTop: 8, fontSize: 13, lineHeight: 1.45 }}>{processor.warning}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {locked ? (
        <section style={{ ...cardStyle, padding: 18, marginBottom: 18, borderColor: 'rgba(250, 204, 21, 0.45)', background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.14), rgba(15, 23, 42, 0.76))' }}>
          <div style={{ color: '#fde68a', fontWeight: 950, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 12 }}>Upgrade Required</div>
          <h2 style={{ margin: '6px 0 6px' }}>Media Tools requires Goliath Plus</h2>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.55 }}>
            This guild is currently on {planName}. Upgrade to Plus or higher to create GIFs, emojis, role icons and saved media assets.
          </p>
        </section>
      ) : null}

      {notice ? (
        <div style={{ ...cardStyle, padding: '12px 14px', marginBottom: 18, color: '#bfdbfe' }}>
          {notice}
        </div>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 420px)', gap: 18 }}>
        <form onSubmit={createAsset} style={{ ...cardStyle, padding: 20, opacity: locked ? 0.58 : 1 }}>
          <h2 style={{ margin: '0 0 6px' }}>{activeMeta.icon} {activeMeta.label}</h2>
          <p style={{ margin: '0 0 18px', color: '#94a3b8' }}>{activeMeta.description}</p>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Asset name</span>
            <input
              value={assetName}
              disabled={locked}
              onChange={(event) => setAssetName(event.target.value)}
              placeholder="Optional display name"
              style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', padding: '12px 14px' }}
            />
          </label>

          <label style={{ display: 'block', marginBottom: 16 }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Upload file</span>
            <input
              type="file"
              disabled={locked}
              accept={activeTool === 'gif' ? 'video/*,image/gif,image/webp,image/png,image/jpeg' : 'image/*'}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              style={{ width: '100%' }}
            />
          </label>

          {activeTool === 'gif' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                ['fps', 'FPS', 5, 30],
                ['width', 'Width', 64, 960],
                ['start', 'Start sec', 0, 3600],
                ['duration', 'Duration', 1, 15],
              ].map(([key, label, min, max]) => (
                <label key={key}>
                  <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>{label}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    disabled={locked}
                    value={options[key]}
                    onChange={(event) => setOptions((current) => ({ ...current, [key]: Number(event.target.value) }))}
                    style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', padding: '10px 12px' }}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              <label>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Preset</span>
                <select
                  value={options.preset}
                  disabled={locked}
                  onChange={(event) => setOptions((current) => ({ ...current, preset: event.target.value, size: event.target.value === 'roleIcon' ? 64 : 128 }))}
                  style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', padding: '10px 12px' }}
                >
                  <option value="emoji">Discord Emoji</option>
                  <option value="roleIcon">Role Icon</option>
                </select>
              </label>
              <label>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Size</span>
                <input
                  type="number"
                  min="32"
                  max="512"
                  disabled={locked}
                  value={options.size}
                  onChange={(event) => setOptions((current) => ({ ...current, size: Number(event.target.value) }))}
                  style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', padding: '10px 12px' }}
                />
              </label>
              <label>
                <span style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Format</span>
                <select
                  value={options.format}
                  disabled={locked}
                  onChange={(event) => setOptions((current) => ({ ...current, format: event.target.value }))}
                  style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', background: '#020617', color: '#e5e7eb', padding: '10px 12px' }}
                >
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !guildId || locked || entitlementsLoading}
            style={{ border: 0, borderRadius: 14, padding: '12px 16px', fontWeight: 950, color: 'white', background: loading || !guildId || locked ? '#334155' : 'linear-gradient(135deg, #2563eb, #7c3aed)', cursor: loading || !guildId || locked ? 'not-allowed' : 'pointer' }}
          >
            {locked ? 'Upgrade Required' : loading ? 'Creating…' : `Create ${activeMeta.label.replace(' Maker', '')}`}
          </button>
        </form>

        <aside style={{ ...cardStyle, padding: 20 }}>
          <h2 style={{ margin: '0 0 8px' }}>Guild Media Library</h2>
          <p style={{ margin: '0 0 14px', color: '#94a3b8' }}>
            {guildId ? `Guild: ${guildId}` : 'Select a guild to view saved assets.'}
          </p>

          {libraryLoading || entitlementsLoading ? <p>Loading…</p> : null}

          <div style={{ display: 'grid', gap: 10 }}>
            {library.length ? library.map((asset) => (
              <div key={asset.id} style={{ border: '1px solid rgba(148,163,184,.2)', borderRadius: 14, padding: 12, background: 'rgba(2,6,23,.45)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>{asset.name}</div>
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>
                      {asset.tool} · {formatBytes(asset.sizeBytes)} · {asset.discordReady ? 'Discord ready' : 'Too large'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a href={dashboardPath(asset.downloadUrl)} style={{ color: '#93c5fd', fontWeight: 900 }}>Download</a>
                    <button type="button" onClick={() => deleteAsset(asset.id)} disabled={locked} style={{ border: 0, background: 'transparent', color: '#fca5a5', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 900 }}>Delete</button>
                  </div>
                </div>
              </div>
            )) : (
              <p style={{ color: '#94a3b8' }}>{locked ? 'Upgrade to unlock the guild media library.' : 'No media assets saved yet.'}</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
