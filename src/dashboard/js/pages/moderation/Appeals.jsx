import React, { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../services/apiClient';

const MAX_GROUNDS = 1500;
const MAX_RESOLUTION = 500;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function caseStatus(status) {
  const value = String(status || 'active').toLowerCase();
  if (value === 'reversed') return { label: '🔄 Case Reversed', color: '#67e8f9' };
  if (value === 'expired') return { label: '⌛ Case Expired', color: '#cbd5e1' };
  if (value === 'active') return { label: '⚠️ Case Active', color: '#fbbf24' };
  return { label: '📁 ' + value.replace(/[_-]/g, ' '), color: '#bfdbfe' };
}

function discordAvatar(user) {
  const id = String(user?.id || '');
  const hash = String(user?.avatar || '');
  return /^\d{16,20}$/.test(id) && /^[a-zA-Z0-9_]+$/.test(hash)
    ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
    : null;
}

function statusTone(status) {
  if (status === 'approved') return '#22c55e';
  if (status === 'denied') return '#ef4444';
  if (status === 'pending') return '#f59e0b';
  return '#60a5fa';
}

function statusLabel(status) {
  if (status === 'approved') return 'Appeal approved';
  if (status === 'denied') return 'Appeal not approved';
  if (status === 'pending') return 'Under review';
  return 'Update available';
}

function cleanEligibilityMessage(value) {
  return String(value || '')
    .replace(/<t:(\d+):F>/g, (_match, seconds) => new Date(Number(seconds) * 1000).toLocaleString());
}

function getDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const guildId = String(params.get('guild') || '').trim();
  const caseId = Number(params.get('case'));
  return {
    guildId: /^\d{16,20}$/.test(guildId) ? guildId : '',
    caseId: Number.isInteger(caseId) && caseId > 0 ? caseId : null,
  };
}

function currentReturnPath() {
  if (window.location.pathname.replace(/\/+$/, '') === '/portal') return '/portal';
  const deepLink = getDeepLink();
  const params = new URLSearchParams();
  if (deepLink.guildId) params.set('guild', deepLink.guildId);
  if (deepLink.caseId) params.set('case', String(deepLink.caseId));
  const query = params.toString();
  return query ? `/appeals?${query}` : '/appeals';
}

export default function Appeals() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [cases, setCases] = useState([]);
  const [restrictions, setRestrictions] = useState([]);
  const [portalTab, setPortalTab] = useState(window.location.pathname.replace(/\/+$/, '') === '/appeals' ? 'cases' : 'overview');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [grounds, setGrounds] = useState('');
  const [resolution, setResolution] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [deepLinkNotice, setDeepLinkNotice] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [expandedCases, setExpandedCases] = useState({});
  const appealFormRef = useRef(null);

  async function load({ preserveSuccess = true } = {}) {
    setLoading(true);
    setError('');
    if (!preserveSuccess) setSuccess('');
    try {
      const auth = await api.getAuthMe();
      if (!auth?.authenticated || !auth?.user) throw Object.assign(new Error('Authentication required.'), { status: 401 });
      setAuthenticated(true);
      setUser(auth.user);
      const payload = await api.request('/api/cases/member/me');
      setRestrictions(Array.isArray(payload?.restrictions) ? payload.restrictions : []);
      const nextCases = Array.isArray(payload?.cases) ? payload.cases : [];
      setCases(nextCases);

      const deepLink = getDeepLink();
      setSelected((current) => {
        if (deepLink.guildId && deepLink.caseId) {
          const linked = nextCases.find((item) => item.guildId === deepLink.guildId && item.caseId === deepLink.caseId) || null;
          if (linked) {
            setDeepLinkNotice(linked.eligible ? '' : cleanEligibilityMessage(linked.eligibilityMessage || 'This case cannot be appealed right now.'));
            return linked.eligible ? linked : null;
          }
          setDeepLinkNotice('We could not find that case for this Discord account. Make sure you are signed in with the account linked to the case.');
          return null;
        }
        if (current) return nextCases.find((item) => item.guildId === current.guildId && item.caseId === current.caseId) || null;
        return null;
      });
    } catch (loadError) {
      if (loadError?.status === 401) {
        setAuthenticated(false);
        setUser(null);
        setCases([]);
        setRestrictions([]);
      } else {
        setError(loadError?.message || 'We could not load your appeals right now. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (selected && appealFormRef.current) {
      appealFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const textarea = appealFormRef.current.querySelector('textarea');
      if (textarea) window.setTimeout(() => textarea.focus(), 250);
    }
  }, [selected?.guildId, selected?.caseId]);

  const timeline = useMemo(() => [...cases.flatMap(item => [
    ...(item.createdAt ? [{ date: item.createdAt, label: `${item.actionLabel} recorded`, guild: item.guildName, key: `case-${item.guildId}-${item.caseId}` }] : []),
    ...item.appeals.flatMap(appeal => [
      ...(appeal.submittedAt ? [{ date: appeal.submittedAt, label: 'Appeal submitted', guild: item.guildName, key: `submitted-${appeal.id}` }] : []),
      ...(appeal.reviewedAt ? [{ date: appeal.reviewedAt, label: `Appeal ${appeal.status}`, guild: item.guildName, key: `reviewed-${appeal.id}` }] : []),
    ]),
  ]), ...restrictions.filter(item => item.startedAt).map(item => ({ date: item.startedAt, label: 'Account restriction applied', guild: item.guildName, key: `restriction-${item.guildId}` }))].sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0)), [cases, restrictions]);

  const pendingCount = useMemo(
    () => cases.reduce((total, item) => total + item.appeals.filter((appeal) => appeal.status === 'pending').length, 0),
    [cases]
  );

  const resolvedCount = useMemo(() => cases.reduce((sum, item) => sum + item.appeals.filter(a => a.status === 'approved' || a.status === 'denied').length, 0), [cases]);
  const visibleCases = useMemo(() => cases.filter(item => {
    if (caseFilter === 'eligible') return item.eligible;
    if (caseFilter === 'pending') return item.appeals.some(a => a.status === 'pending');
    if (caseFilter === 'resolved') return item.appeals.some(a => a.status === 'approved' || a.status === 'denied');
    return true;
  }), [cases, caseFilter]);
  const appealableCount = useMemo(() => cases.filter((item) => item.eligible).length, [cases]);

  async function submitAppeal(event) {
    event.preventDefault();
    if (!selected || submitting) return;
    const trimmedGrounds = grounds.trim();
    if (!trimmedGrounds) {
      setError('Tell us why you believe this decision should be reviewed.');
      return;
    }
    if (grounds.length > MAX_GROUNDS || resolution.length > MAX_RESOLUTION) {
      setError('One of your answers is over the character limit.');
      return;
    }
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.request(`/api/cases/appeals/${encodeURIComponent(selected.guildId)}/${encodeURIComponent(selected.caseId)}`, {
        method: 'POST',
        body: JSON.stringify({ grounds: trimmedGrounds, requestedResolution: resolution.trim() }),
      });
      setSuccess('Your appeal has been submitted. You can come back to this page at any time to check its progress and outcome.');
      setGrounds('');
      setResolution('');
      setSelected(null);
      await load({ preserveSuccess: true });
    } catch (submitError) {
      setError(cleanEligibilityMessage(submitError?.message || 'We could not submit your appeal. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  function chooseCase(item) {
    if (!item?.eligible || submitting) return;
    setPortalTab('cases');
    setSelected(item);
    setGrounds('');
    setResolution('');
    setError('');
    setSuccess('');
    setDeepLinkNotice('');
    const params = new URLSearchParams();
    params.set('guild', item.guildId);
    params.set('case', String(item.caseId));
    window.history.replaceState({}, '', `/appeals?${params.toString()}`);
  }

  function cancelSelection() {
    setSelected(null);
    setGrounds('');
    setResolution('');
    window.history.replaceState({}, '', '/appeals');
  }

  const page = {
    minHeight: '100vh',
    background: 'radial-gradient(circle at top, #11234a 0, #07101f 34%, #030812 72%)',
    color: '#f8fafc',
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '24px 14px 54px',
  };
  const card = {
    background: 'linear-gradient(180deg, rgba(13,25,48,.96), rgba(7,16,31,.96))',
    border: '1px solid rgba(96,165,250,.18)',
    borderRadius: 20,
    padding: 20,
    boxShadow: '0 20px 55px rgba(0,0,0,.28)',
  };
  const muted = { color: '#a7b4c8', lineHeight: 1.6 };
  const input = {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 13,
    border: '1px solid rgba(148,163,184,.28)',
    background: '#08111f',
    color: '#f8fafc',
    padding: '13px 14px',
    font: 'inherit',
    resize: 'vertical',
    outlineColor: '#3b82f6',
  };
  const button = {
    border: 0,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    color: '#fff',
    padding: '12px 17px',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(37,99,235,.22)',
  };
  const secondaryButton = { ...button, background: '#18273c', boxShadow: 'none' };
  const pill = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    padding: '7px 11px',
    background: 'rgba(59,130,246,.12)',
    border: '1px solid rgba(96,165,250,.2)',
    color: '#bfdbfe',
    fontSize: 13,
    fontWeight: 800,
  };

  if (loading) {
    return (
      <main aria-busy="true" style={{ ...page, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>⚖️</div>
          <strong>Loading your appeals…</strong>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main style={{ ...page, display: 'grid', placeItems: 'center' }}>
        <section style={{ ...card, width: 'min(560px, 100%)', textAlign: 'center', padding: '30px 24px' }}>
          <div style={{ fontSize: 44 }}>⚖️</div>
          <div style={{ color: '#60a5fa', fontWeight: 900, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', marginTop: 10 }}>Member Portal</div>
          <h1 style={{ margin: '8px 0 10px', fontSize: 'clamp(30px, 8vw, 46px)' }}>Appeal a moderation decision</h1>
          <p style={{ ...muted, margin: '0 auto 22px', maxWidth: 470 }}>Sign in with Discord to see decisions linked to your account, submit an appeal when one is available, and check the outcome of appeals you have already sent.</p>
          <button style={button} onClick={() => { window.location.href = `/api/auth/login?next=${encodeURIComponent(currentReturnPath())}`; }}>Continue with Discord</button>
          <p style={{ ...muted, fontSize: 13, margin: '18px 0 0' }}>You can still use this page if you are no longer a member of the server.</p>
        </section>
      </main>
    );
  }

  const displayName = user?.global_name || user?.globalName || user?.username || 'Discord user';
  const avatarUrl = discordAvatar(user);

  return (
    <main style={page}>
      <div style={{ width: 'min(1040px, 100%)', margin: '0 auto', display: 'grid', gap: 18 }}>
        <header style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#60a5fa', fontWeight: 900, fontSize: 12, letterSpacing: '.13em', textTransform: 'uppercase' }}>Member Portal</div>
            <h1 style={{ margin: '6px 0 4px', fontSize: 'clamp(30px, 7vw, 44px)', lineHeight: 1.05 }}>💎 Member Portal</h1>
            <p style={{ ...muted, margin: 0 }}>Your account, community history and appeals.</p>
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            {avatarUrl ? <img src={avatarUrl} alt="" width="36" height="36" style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" /> : null}
            <strong style={{ fontSize: 14 }}>{displayName}</strong>
            <button style={secondaryButton} onClick={async () => { await api.logout().catch(() => null); window.location.reload(); }}>Sign out</button>
          </div>
        </header>

        <section style={{ ...card, borderColor: 'rgba(59,130,246,.38)' }}>
          <h2 style={{ margin: '0 0 5px', fontSize: 'clamp(22px, 4vw, 30px)' }}>Welcome back, {displayName}</h2>
          <p style={{ ...muted, margin: '0 0 18px' }}>Your personal space for community activity, account restrictions, case history and appeals.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[['📁 Cases', cases.length], ['🔒 Active Restrictions', restrictions.length], ['⏳ Under Review', pendingCount], ['✅ Resolved Appeals', resolvedCount]].map(([label, count]) => (
              <div key={label} style={{ padding: 14, borderRadius: 13, background: 'rgba(2,6,23,.35)', border: '1px solid rgba(148,163,184,.15)' }}>
                <div style={{ ...muted, fontSize: 13 }}>{label}</div><strong style={{ fontSize: 25 }}>{count}</strong>
              </div>
            ))}
          </div>
        </section>

        <nav aria-label="Member portal sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[['overview', '🏠 Overview'], ['cases', '⚖️ Cases & Appeals'], ['restrictions', '🔒 Restrictions'], ['timeline', '📅 Timeline'], ['profile', '👤 Profile']].map(([id, label]) => (
            <button key={id} type="button" aria-current={portalTab === id ? 'page' : undefined} style={{ ...secondaryButton, background: portalTab === id ? '#2563eb' : '#18273c' }} onClick={() => { if (id === 'cases') { window.location.assign('/appeals'); return; } if (window.location.pathname.replace(/\/+$/, '') === '/appeals') window.history.replaceState({}, '', '/portal'); setPortalTab(id); }}>{label}</button>
          ))}
        </nav>
        {(portalTab === 'overview' || portalTab === 'restrictions') ? (
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>🔒 Account Restrictions</h2>
            {restrictions.length ? restrictions.map(item => (
              <div key={item.guildId} style={{ border: '1px solid rgba(245,158,11,.3)', borderRadius: 12, padding: 14, marginTop: 10 }}>
                <strong>{item.guildName} · {item.mode === 'investigation' ? 'Investigation hold' : 'Security restriction'}</strong>
                <p style={{ ...muted, margin: '6px 0' }}>Status: Active{item.caseId ? ` · Case #${item.caseId}` : ''}</p>
                <small style={muted}>Started: {formatDate(item.startedAt)}. Contact the community's management team for further information.</small>
              </div>
            )) : <p style={muted}>No active restrictions are currently recorded for your account.</p>}
          </section>
        ) : null}
        {(portalTab === 'overview' || portalTab === 'timeline') ? (
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>📅 Personal Timeline</h2>
            {timeline.length ? <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 10 }}>
              {timeline.slice(0, portalTab === 'overview' ? 6 : 100).map(item => (
                <li key={item.key} style={{ borderLeft: '3px solid #60a5fa', padding: '4px 0 4px 13px' }}>
                  <strong>{item.label}</strong><div style={muted}>{item.guild || 'Community'} · {formatDate(item.date)}</div>
                </li>
              ))}
            </ol> : <p style={muted}>No activity is available to display yet.</p>}
          </section>
        ) : null}
        {portalTab === 'profile' ? <section style={card}><h2>👤 My Profile</h2><p style={muted}>Discord account: {displayName}</p><p style={muted}>This portal shows information linked to your signed-in Discord account.</p></section> : null}

        {error ? <div role="alert" style={{ ...card, borderColor: 'rgba(239,68,68,.5)', color: '#fecaca' }}>⚠️ {error}</div> : null}
        {success ? <div role="status" style={{ ...card, borderColor: 'rgba(34,197,94,.48)', color: '#bbf7d0' }}>✓ {success}</div> : null}
        {deepLinkNotice ? <div role="status" style={{ ...card, borderColor: 'rgba(245,158,11,.45)', color: '#fde68a' }}>ℹ️ {deepLinkNotice}</div> : null}

        {(portalTab === 'overview' || portalTab === 'cases') ? <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#60a5fa', fontWeight: 900, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Your account</div>
              <h2 style={{ margin: '5px 0 5px', fontSize: 26 }}>Your cases & appeals</h2>
              <p style={{ ...muted, margin: 0 }}>Only cases connected to this Discord account appear here.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select aria-label="Filter cases" value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)} style={{ ...input, width: 'auto', maxWidth: '100%', padding: '10px 12px' }}>
                <option value="all">All Cases</option>
                <option value="eligible">Eligible for Appeal</option>
                <option value="pending">Under Review</option>
                <option value="resolved">Resolved</option>
              </select>
              <span style={pill}>{appealableCount} available to appeal</span>
              <button style={secondaryButton} onClick={() => load({ preserveSuccess: true })}>Refresh</button>
            </div>
          </div>

          {!cases.length ? (
            <div style={{ marginTop: 20, border: '1px dashed rgba(148,163,184,.25)', borderRadius: 16, padding: '34px 20px', textAlign: 'center', background: 'rgba(2,6,23,.28)' }}>
              <div style={{ fontSize: 38, marginBottom: 8 }}>📄</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>No cases to display</h3>
              <p style={{ ...muted, maxWidth: 590, margin: '0 auto' }}>There are no member-visible cases or previous appeals to show for this Discord account.</p>
              <p style={{ ...muted, maxWidth: 590, margin: '10px auto 0', fontSize: 14 }}>If you expected to see a case here, check that you signed in with the same Discord account that received the moderation action.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {!visibleCases.length ? <p role="status" style={muted}>No cases match this filter.</p> : null}
              {visibleCases.map((item) => (
                <article key={`${item.guildId}:${item.caseId}`} style={{ border: selected?.guildId === item.guildId && selected?.caseId === item.caseId ? '1px solid rgba(96,165,250,.8)' : '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: 17, background: 'rgba(2,6,23,.42)', overflowWrap: 'anywhere' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#93c5fd', fontSize: 13, fontWeight: 800 }}>
                        {item.guildIconUrl ? <img src={item.guildIconUrl} alt="" width="28" height="28" style={{ borderRadius: 9 }} loading="lazy" /> : null}
                        <span>{item.guildName || 'Discord Server'}</span>
                      </div>
                      <strong style={{ display: 'block', marginTop: 3, fontSize: 18 }}>Case #{item.caseId} · {item.actionLabel}</strong>
                      <div style={{ marginTop: 5, color: '#94a3b8', fontSize: 13 }}>Decision recorded {formatDate(item.decisionAt || item.createdAt)}</div>
                    </div>
                    {item.eligible ? <span style={{ ...pill, color: '#bbf7d0' }}>✓ Eligible to Appeal</span> : null}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ ...pill, color: caseStatus(item.status).color }}>{caseStatus(item.status).label}</span>
                    {item.appeals.some(a => a.status === 'approved') ? <span style={{ ...pill, color: '#bbf7d0' }}>✅ Appeal Approved</span> : null}
                    {item.appeals.some(a => a.status === 'pending') ? <span style={{ ...pill, color: '#fde68a' }}>⏳ Under Review</span> : null}
                    {item.appeals.some(a => a.status === 'denied') ? <span style={{ ...pill, color: '#fca5a5' }}>❌ Appeal Denied</span> : null}
                  </div>
                  <button type="button" style={{ ...secondaryButton, marginTop: 12 }} aria-expanded={Boolean(expandedCases[`${item.guildId}:${item.caseId}`])} onClick={() => setExpandedCases(prev => ({ ...prev, [`${item.guildId}:${item.caseId}`]: !prev[`${item.guildId}:${item.caseId}`] }))}>
                    {expandedCases[`${item.guildId}:${item.caseId}`] ? 'Hide Details ▲' : 'View Case Details ▼'}
                  </button>
                  {expandedCases[`${item.guildId}:${item.caseId}`] ? (<>
                  <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: 'rgba(15,23,42,.65)' }}>
                    <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>What this case is about</div>
                    <p style={{ lineHeight: 1.6, margin: '6px 0 0' }}>{item.publicSummary || 'No additional public summary is available for this case.'}</p>
                  </div>

                  {!item.eligible && !item.appeals.length && item.eligibilityMessage ? <p style={{ color: '#a7b4c8', fontSize: 13, lineHeight: 1.55, margin: '12px 0 0' }}>{cleanEligibilityMessage(item.eligibilityMessage)}</p> : null}

                  {item.appeals.length ? (
                    <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                      <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>Appeal history</div>
                      {item.appeals.map((appeal) => (
                        <div key={appeal.id} style={{ borderLeft: `3px solid ${statusTone(appeal.status)}`, padding: '5px 0 5px 11px', lineHeight: 1.5 }}>
                          <strong style={{ color: statusTone(appeal.status) }}>{statusLabel(appeal.status)}</strong>
                          <div style={{ color: '#a7b4c8', fontSize: 13, marginTop: 5 }}>📝 Submitted: {formatDate(appeal.submittedAt)}</div>

                          {appeal.reviewedAt ? <div style={{ color: '#a7b4c8', fontSize: 13 }}>{appeal.status === 'approved' ? '✅' : appeal.status === 'denied' ? '❌' : '📋'} Reviewed: {formatDate(appeal.reviewedAt)}</div> : null}
                          {appeal.reviewNote ? <div style={{ color: '#d7e0ec', marginTop: 5 }}><strong>Review note:</strong> {appeal.reviewNote}</div> : null}
                          {appeal.remedyDetail ? <div style={{ color: '#d7e0ec', marginTop: 4 }}><strong>Outcome:</strong> {appeal.remedyDetail}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  </>) : null}
                  {item.eligible ? <button style={{ ...button, marginTop: 15 }} onClick={() => chooseCase(item)} disabled={submitting}>Start appeal</button> : null}
                </article>
              ))}
            </div>
          )}
        </section> : null}

        {selected ? (
          <section ref={appealFormRef} style={{ ...card, borderColor: 'rgba(59,130,246,.4)' }}>
            <div style={{ color: '#60a5fa', fontWeight: 900, fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Your appeal</div>
            <h2 style={{ margin: '5px 0 5px' }}>Appeal Case #{selected.caseId}</h2>
            <p style={{ ...muted, margin: '0 0 18px' }}>{selected.guildName} · {selected.actionLabel}</p>

            <div style={{ padding: 14, borderRadius: 13, background: 'rgba(59,130,246,.08)', border: '1px solid rgba(96,165,250,.15)', marginBottom: 18 }}>
              <strong>Before you submit</strong>
              <p style={{ ...muted, margin: '5px 0 0', fontSize: 14 }}>Keep your appeal clear and respectful. Focus on what you believe was wrong, what information should be reconsidered, or why you believe the outcome should change.</p>
            </div>

            <form onSubmit={submitAppeal} style={{ display: 'grid', gap: 16 }}>
              <label htmlFor="appeal-grounds" style={{ display: 'grid', gap: 7, fontWeight: 800 }}>
                Why should this decision be reviewed?
                <span style={{ ...muted, fontWeight: 500, fontSize: 13 }}>Tell us what happened from your point of view and what you would like the reviewer to consider.</span>
                <textarea id="appeal-grounds" style={input} rows={7} maxLength={MAX_GROUNDS} required value={grounds} onChange={(event) => setGrounds(event.target.value)} placeholder="Explain your appeal here…" disabled={submitting} />
                <span style={{ color: grounds.length >= MAX_GROUNDS ? '#fca5a5' : '#94a3b8', fontWeight: 500, fontSize: 12 }}>{grounds.length}/{MAX_GROUNDS} characters</span>
              </label>

              <label htmlFor="appeal-resolution" style={{ display: 'grid', gap: 7, fontWeight: 800 }}>
                What outcome are you asking for? <span style={{ color: '#94a3b8', fontWeight: 500 }}>(optional)</span>
                <span style={{ ...muted, fontWeight: 500, fontSize: 13 }}>For example, you might ask for a warning to be removed, a ban to be lifted, or the decision to be reconsidered.</span>
                <textarea id="appeal-resolution" style={input} rows={3} maxLength={MAX_RESOLUTION} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="What would you like to happen?" disabled={submitting} />
                <span style={{ color: resolution.length >= MAX_RESOLUTION ? '#fca5a5' : '#94a3b8', fontWeight: 500, fontSize: 12 }}>{resolution.length}/{MAX_RESOLUTION} characters</span>
              </label>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={{ ...button, opacity: submitting || !grounds.trim() ? .65 : 1, cursor: submitting || !grounds.trim() ? 'not-allowed' : 'pointer' }} type="submit" disabled={submitting || !grounds.trim()}>{submitting ? 'Sending your appeal…' : 'Submit appeal'}</button>
                <button style={secondaryButton} type="button" onClick={cancelSelection} disabled={submitting}>Cancel</button>
              </div>
            </form>
          </section>
        ) : null}

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div style={card}>
            <h3 style={{ marginTop: 0 }}>❓ Appeals Help</h3>
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>What can I appeal?</summary>
              <p style={{ ...muted, fontSize: 14 }}>Any case available for appeal will be clearly marked above. Some decisions may need to reach a particular stage before an appeal can be submitted.</p>
            </details>
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>How long will a review take?</summary>
              <p style={{ ...muted, fontSize: 14 }}>Review time can vary depending on the case. When there is an update, the latest status will appear on this page.</p>
            </details>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Can I appeal if I left or was removed from the server?</summary>
              <p style={{ ...muted, fontSize: 14 }}>Yes. If the case is linked to your Discord account and is eligible, you can use this portal even if you are no longer in the server.</p>
            </details>
          </div>

          <div style={card}>
            <h3 style={{ marginTop: 0 }}>🔒 Privacy & Security</h3>
            <p style={{ ...muted, marginBottom: 0 }}>This page only shows information that is appropriate for you to see about your own cases and appeals. Private moderator notes and internal review material remain private.</p>
            <div style={{ marginTop: 16, padding: 13, borderRadius: 12, background: 'rgba(34,197,94,.07)', border: '1px solid rgba(34,197,94,.14)', color: '#d1fae5', fontSize: 14, lineHeight: 1.55 }}>🔒 Your appeal is tied to the Discord account you are currently signed in with.</div>
          </div>
        </section>
      </div>
    </main>
  );
}
