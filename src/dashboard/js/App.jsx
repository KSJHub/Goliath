import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { appBaseStyles, shellStyles } from './ui/components.js';
import { getTheme } from './ui/theme.js';
import { api } from './services/apiClient.js';
import { navItems, ROUTES } from './ui/layout.js';
import { getStorage, removeStorage, setStorage } from './storage.js';

import { useNavbar } from './hooks/useNavbar.js';
import { useBotStatus } from './hooks/useBotStatus.js';
import { useGuilds } from './hooks/useGuilds.js';
import { useAuthSession } from './hooks/useAuthSession.js';

import Navbar from './shared/Navbar.jsx';
import OwnerSidebar from './pages/owner/components/OwnerSidebar.jsx';
import Topbar from './shared/Topbar.jsx';
import Login from './pages/core/Login.jsx';
import DashboardErrorBoundary from './shared/DashboardErrorBoundary.jsx';

const OWNER_MANAGED_GUILD_KEY = 'owner_managed_guild';
const GUILD_STORAGE_KEY = 'selected_guild';
const ROUTE_PATHS = ROUTES.map((routeItem) => routeItem.path);
const GUILD_REQUIRED_ROUTES = new Set([
  'overview', 'billing', 'cases', 'warnings', 'automod', 'generalSettings',
  'messages', 'forms', 'modules', 'logs', 'admin', 'moderation',
  'embedStudio', 'freeGames',
]);

function normalizeOwnerGuilds(payload) {
  const guilds = Array.isArray(payload?.guilds) ? payload.guilds : [];
  return guilds.map((guild, index) => {
    const environment = String(guild.environment || guild.runtimeMode || '').toUpperCase();
    const guildId = String(guild.guildId || guild.id || index);
    const rawName = guild.rawName || guild.guildName || guild.name || 'Unknown Guild';
    const label = environment === 'PRODUCTION' ? 'PROD' : environment || 'ENV';
    return { ...guild, id: environment + ':' + guildId, guildId, rawName, name: label + ' - ' + rawName, guildName: rawName, environment, runtimeMode: environment, iconUrl: guild.iconUrl || guild.iconURL || guild.icon || '' };
  });
}

function normalizeManagedGuild(value) {
  if (!value || typeof value !== 'object') return null;
  const guildId = String(value.guildId || value.id || '').split(':').pop().trim();
  if (!guildId) return null;
  const guildName = value.rawName || value.guildName || value.name || 'Owner Managed Guild';
  const environment = String(value.environment || value.runtimeMode || '').toUpperCase();
  return { ...value, id: guildId, guildId, name: guildName, guildName, rawName: guildName, environment, runtimeMode: environment, iconUrl: value.iconUrl || value.iconURL || value.icon || value.avatarUrl || '', ownerManaged: true };
}

function managedGuildFromSearch(search) {
  const params = new URLSearchParams(search || '');
  const guildId = params.get('ownerGuildId');
  if (!guildId) return null;
  return normalizeManagedGuild({ guildId, name: params.get('ownerGuildName') || 'Owner Managed Guild', guildName: params.get('ownerGuildName') || 'Owner Managed Guild', environment: params.get('ownerGuildEnvironment') || '', runtimeMode: params.get('ownerGuildEnvironment') || '' });
}

function managedGuildSearch(guild) {
  const managed = normalizeManagedGuild(guild);
  if (!managed?.guildId) return '';
  const params = new URLSearchParams();
  params.set('ownerGuildId', managed.guildId);
  params.set('ownerGuildName', managed.guildName || managed.name);
  if (managed.environment || managed.runtimeMode) params.set('ownerGuildEnvironment', managed.environment || managed.runtimeMode);
  return '?' + params.toString();
}

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' && window.innerWidth < breakpoint));
  useEffect(() => { if (typeof window === 'undefined') return undefined; const handleResize = () => setIsMobile(window.innerWidth < breakpoint); handleResize(); window.addEventListener('resize', handleResize); return () => window.removeEventListener('resize', handleResize); }, [breakpoint]);
  return isMobile;
}
function getRouteForPath(pathname) { const canonicalPath = pathname === '/free-games' ? '/games' : pathname; return ROUTES.find((routeItem) => routeItem.path === canonicalPath) || null; }
function isKnownPath(pathname) { return pathname === '/' || pathname === '/login' || pathname === '/free-games' || ROUTE_PATHS.includes(pathname); }
function CenterMessage({ theme, title, text }) { return <div style={{ minHeight: 'calc(100dvh - 180px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 3vw, 24px)' }}><div style={{ width: 'min(520px, 100%)', border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 24, padding: 'clamp(20px, 4vw, 28px)', textAlign: 'center', boxShadow: theme.shadow }}><h2 style={{ margin: '0 0 10px', fontSize: 'clamp(20px, 4vw, 24px)' }}>{title}</h2><p style={{ margin: 0, color: theme.mutedText, lineHeight: 1.6 }}>{text}</p></div></div>; }
function OwnerManagedBanner({ theme, guild, onReturn }) { if (!guild) return null; return <section style={{ border: '1px solid rgba(250,204,21,0.35)', background: 'linear-gradient(135deg, rgba(250,204,21,0.13), rgba(59,130,246,0.10))', color: theme.cardText, borderRadius: 18, padding: '14px 16px', marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', boxShadow: theme.shadow }}><div><div style={{ color: '#fde68a', fontWeight: 950, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12 }}>Owner Mode</div><div style={{ marginTop: 4, fontWeight: 900 }}>Managing {guild.name || guild.guildName || guild.guildId}</div><div style={{ marginTop: 2, color: theme.mutedText, fontSize: 13 }}>Environment: {guild.environment || guild.runtimeMode || 'CURRENT'} · Guild ID: {guild.guildId || guild.id}</div></div><button type="button" onClick={onReturn} style={{ border: '1px solid rgba(250,204,21,0.35)', background: 'rgba(15,23,42,0.55)', color: '#fde68a', borderRadius: 12, padding: '10px 12px', fontWeight: 900, cursor: 'pointer' }}>Return to Owner View</button></section>; }

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [darkMode, setDarkMode] = useState(true);
  const [notificationSummary, setNotificationSummary] = useState(null);
  const isMobile = useIsMobile(1024);
  const theme = useMemo(() => getTheme(darkMode), [darkMode]);
  const { navbarExpanded, toggleNavbar } = useNavbar();
  const guildState = useGuilds();
  const botState = useBotStatus();
  const authState = useAuthSession({ loadGuilds: guildState.loadGuilds, loadBotStatus: botState.refreshBotStatus, applyBotProfile: botState.applyBotProfile, clearGuilds: guildState.clearGuilds });
  const isOwner = authState.currentUser?.isOwner === true;
  const isOwnerRoute = location.pathname.toLowerCase().startsWith('/owner');
  const urlManagedGuild = useMemo(() => managedGuildFromSearch(location.search), [location.search]);
  const [ownerManagedGuild, setOwnerManagedGuild] = useState(() => (managedGuildFromSearch(typeof window !== 'undefined' ? window.location.search : '') || normalizeManagedGuild(getStorage(OWNER_MANAGED_GUILD_KEY, null))));
  const activeOwnerManagedGuild = urlManagedGuild || ownerManagedGuild;
  const ownerManageActive = Boolean(isOwner && !isOwnerRoute && activeOwnerManagedGuild?.guildId);
  const ownerManageSearch = managedGuildSearch(activeOwnerManagedGuild);
  const [ownerGuilds, setOwnerGuilds] = useState([]);
  const [ownerGuildError, setOwnerGuildError] = useState('');
  const [ownerGuildsLoading, setOwnerGuildsLoading] = useState(false);
  const [selectedOwnerGuild, setSelectedOwnerGuild] = useState('');
  const effectiveSelectedGuild = ownerManageActive ? activeOwnerManagedGuild.guildId : guildState.selectedGuild;
  const effectiveSelectedGuildData = ownerManageActive ? activeOwnerManagedGuild : guildState.selectedGuildData;
  const effectiveGuilds = useMemo(() => { if (!ownerManageActive || !activeOwnerManagedGuild) return guildState.guilds; const exists = guildState.guilds.some((guild) => String(guild.id) === String(activeOwnerManagedGuild.guildId)); return exists ? guildState.guilds : [activeOwnerManagedGuild, ...guildState.guilds]; }, [guildState.guilds, ownerManageActive, activeOwnerManagedGuild]);

  useEffect(() => {
    if (!authState.isAuthenticated || !effectiveSelectedGuild) { setNotificationSummary(null); return undefined; }
    let cancelled = false; let intervalId = null;
    async function loadNotificationsSummary() { try { const guildId = String(effectiveSelectedGuild).split(':').pop(); const payload = await api.request(`/api/notifications/${guildId}?limit=10`); if (!cancelled) setNotificationSummary(payload.summary || null); } catch { if (!cancelled) setNotificationSummary(null); } }
    loadNotificationsSummary(); intervalId = window.setInterval(loadNotificationsSummary, 30000);
    return () => { cancelled = true; if (intervalId) window.clearInterval(intervalId); };
  }, [authState.isAuthenticated, effectiveSelectedGuild, location.pathname]);

  useEffect(() => { if (!isOwnerRoute || !isOwner || !authState.isAuthenticated) return undefined; let cancelled = false; async function loadOwnerGuilds() { try { setOwnerGuildsLoading(true); setOwnerGuildError(''); const payload = await api.getOwnerGuilds(); const nextGuilds = normalizeOwnerGuilds(payload); if (cancelled) return; setOwnerGuilds(nextGuilds); setSelectedOwnerGuild((currentValue) => (nextGuilds.some((guild) => guild.id === currentValue) ? currentValue : nextGuilds[0]?.id || '')); } catch (error) { if (!cancelled) { setOwnerGuilds([]); setSelectedOwnerGuild(''); setOwnerGuildError(error.message || 'Could not load owner guilds.'); } } finally { if (!cancelled) setOwnerGuildsLoading(false); } } loadOwnerGuilds(); return () => { cancelled = true; }; }, [authState.isAuthenticated, isOwner, isOwnerRoute]);
  useEffect(() => { if (!urlManagedGuild) return; setOwnerManagedGuild(urlManagedGuild); setStorage(OWNER_MANAGED_GUILD_KEY, urlManagedGuild); setStorage(GUILD_STORAGE_KEY, urlManagedGuild.guildId); }, [urlManagedGuild]);
  useEffect(() => { function handleOwnerManagedGuildChange() { if (managedGuildFromSearch(window.location.search)) return; setOwnerManagedGuild(normalizeManagedGuild(getStorage(OWNER_MANAGED_GUILD_KEY, null))); } window.addEventListener('storage', handleOwnerManagedGuildChange); window.addEventListener('focus', handleOwnerManagedGuildChange); return () => { window.removeEventListener('storage', handleOwnerManagedGuildChange); window.removeEventListener('focus', handleOwnerManagedGuildChange); }; }, []);

  const clearOwnerManagedGuild = () => { removeStorage(OWNER_MANAGED_GUILD_KEY); setOwnerManagedGuild(null); };
  const returnToOwnerView = () => { clearOwnerManagedGuild(); navigate('/owner/servers'); };
  const openOwnerManagedGuild = (guild, path = '/overview') => { const managedGuild = normalizeManagedGuild(guild); if (!managedGuild?.guildId) return; setOwnerManagedGuild(managedGuild); setStorage(OWNER_MANAGED_GUILD_KEY, managedGuild); setStorage(GUILD_STORAGE_KEY, managedGuild.guildId); window.location.assign(path + managedGuildSearch(managedGuild)); };
  const setClientSelectedGuild = (value) => { if (ownerManageActive) { setStorage(GUILD_STORAGE_KEY, activeOwnerManagedGuild.guildId); return; } guildState.setSelectedGuild(value); };
  const navbarGuilds = isOwnerRoute && isOwner ? ownerGuilds : effectiveGuilds;
  const navbarSelectedGuild = isOwnerRoute && isOwner ? selectedOwnerGuild : effectiveSelectedGuild;
  const setNavbarSelectedGuild = isOwnerRoute && isOwner ? setSelectedOwnerGuild : setClientSelectedGuild;
  const navbarGuildError = isOwnerRoute && isOwner ? ownerGuildError : guildState.guildError;
  const navbarGuildsLoading = isOwnerRoute && isOwner ? ownerGuildsLoading : guildState.guildsLoading;
  const styles = useMemo(() => shellStyles(theme, { navbarExpanded }), [theme, navbarExpanded]);
  const responsiveStyles = useMemo(() => { const desktopGrid = styles.grid || {}; const desktopMainColumn = styles.mainColumn || {}; const desktopMain = styles.main || {}; const fixedShell = { height: '100dvh', minHeight: '100dvh', width: '100%', maxWidth: '100%', overflow: 'hidden', overflowX: 'hidden' }; return { app: { ...styles.app, ...fixedShell }, grid: isMobile ? { display: 'block', ...fixedShell } : { ...desktopGrid, ...fixedShell, minWidth: 0 }, mainColumn: isMobile ? { height: '100dvh', minHeight: '100dvh', width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : { ...desktopMainColumn, height: '100dvh', minHeight: '100dvh', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }, main: { ...desktopMain, width: '100%', maxWidth: '100%', minWidth: 0, flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', padding: isMobile ? '78px clamp(12px, 4vw, 18px) clamp(18px, 4vw, 28px)' : desktopMain.padding } }; }, [styles, isMobile]);
  const activeRoute = getRouteForPath(location.pathname);
  const ActivePage = activeRoute?.component || null;
  const routeNeedsGuild = Boolean(activeRoute?.key && GUILD_REQUIRED_ROUTES.has(activeRoute.key));
  useEffect(() => { if (authState.authLoading) return; const ownerSuffix = ownerManageActive ? ownerManageSearch : ''; if (!isKnownPath(location.pathname)) { navigate(authState.isAuthenticated ? '/overview' + ownerSuffix : '/login', { replace: true }); return; } if (location.pathname === '/') { navigate(authState.isAuthenticated ? '/overview' + ownerSuffix : '/login', { replace: true }); return; } if (!authState.isAuthenticated && location.pathname !== '/login') { navigate('/login', { replace: true }); return; } if (authState.isAuthenticated && location.pathname === '/login') { navigate('/overview' + ownerSuffix, { replace: true }); return; } if (authState.isAuthenticated && activeRoute?.ownerOnly && !isOwner) navigate('/overview' + ownerSuffix, { replace: true }); }, [activeRoute, authState.authLoading, authState.isAuthenticated, isOwner, location.pathname, navigate, ownerManageActive, ownerManageSearch]);
  const handleLogout = async () => { clearOwnerManagedGuild(); await authState.handleLogout(); navigate('/login', { replace: true }); };
  const pageProps = { selectedGuild: effectiveSelectedGuild, selectedGuildName: effectiveSelectedGuildData?.name || effectiveSelectedGuildData?.guildName || '', selectedGuildId: effectiveSelectedGuildData?.guildId || effectiveSelectedGuildData?.id || effectiveSelectedGuild || '', selectedGuildIcon: effectiveSelectedGuildData?.iconUrl || effectiveSelectedGuildData?.iconURL || effectiveSelectedGuildData?.avatarUrl || '', selectedGuildData: effectiveSelectedGuildData, guilds: effectiveGuilds, guildsLoading: guildState.guildsLoading, guildError: guildState.guildError, ownerManageActive, ownerManagedGuild: activeOwnerManagedGuild, clearOwnerManagedGuild, onSelectGuild: openOwnerManagedGuild, onReturnToDashboard: () => {}, theme, currentUser: authState.currentUser, isOwner, authLoading: authState.authLoading, isAuthenticated: authState.isAuthenticated, handleLogin: authState.handleLogin, loginPending: authState.loginPending, botName: botState.botName, botAvatar: botState.botAvatar, botData: botState.botData, refreshGuilds: guildState.refreshGuilds, refreshBotStatus: botState.refreshBotStatus };

  if (location.pathname === '/login') return <><style>{appBaseStyles(theme).globalCss}</style><div style={{ minHeight: '100dvh', background: theme.pageBg, color: theme.cardText, padding: 'clamp(16px, 4vw, 24px)', overflowX: 'hidden' }}><Login {...pageProps} /></div></>;

  return <><style>{appBaseStyles(theme).globalCss}</style><div style={responsiveStyles.app}><div style={responsiveStyles.grid}>{isOwnerRoute && isOwner ? <OwnerSidebar theme={theme} botName={botState.botName} botAvatar={botState.botAvatar} guilds={navbarGuilds} selectedGuild={navbarSelectedGuild} setSelectedGuild={setNavbarSelectedGuild} /> : <Navbar theme={theme} selectedGuild={navbarSelectedGuild} setSelectedGuild={setNavbarSelectedGuild} guilds={navbarGuilds} guildError={navbarGuildError} isAuthenticated={authState.isAuthenticated} authLoading={authState.authLoading} guildsLoading={navbarGuildsLoading} navItems={navItems} botName={botState.botName} botAvatar={botState.botAvatar} botData={botState.botData} expanded={navbarExpanded} onToggleCollapsed={toggleNavbar} />}<div style={responsiveStyles.mainColumn}><Topbar theme={theme} authLoading={authState.authLoading} isAuthenticated={authState.isAuthenticated} handleLogin={authState.handleLogin} handleLogout={handleLogout} topbarUserName={authState.currentUserName} currentUser={authState.currentUser} currentUserAvatar={authState.currentUserAvatar} darkMode={darkMode} setDarkMode={setDarkMode} loginPending={authState.loginPending} notificationSummary={notificationSummary} selectedGuild={effectiveSelectedGuild} /><main style={responsiveStyles.main}>{ownerManageActive ? <OwnerManagedBanner theme={theme} guild={activeOwnerManagedGuild} onReturn={returnToOwnerView} /> : null}{authState.authLoading ? <CenterMessage theme={theme} title="Loading dashboard..." text="Checking your Discord session and preparing your server tools." /> : !authState.isAuthenticated ? <CenterMessage theme={theme} title="Not signed in" text="Please login with Discord to access your dashboard." /> : activeRoute?.ownerOnly && !isOwner ? <CenterMessage theme={theme} title="Owner access required" text="This dashboard view is restricted to owner accounts." /> : guildState.guildsLoading && guildState.guilds.length === 0 && !ownerManageActive ? <CenterMessage theme={theme} title="Loading servers..." text="Fetching the Discord servers shared with Goliath." /> : routeNeedsGuild && !guildState.guildsLoading && !effectiveSelectedGuild ? <CenterMessage theme={theme} title="No server selected" text="Select a server from the navbar to continue." /> : ActivePage ? <DashboardErrorBoundary theme={theme} resetKey={location.pathname}><Suspense fallback={<CenterMessage theme={theme} title="Loading page..." text="Preparing this dashboard module." />}><ActivePage {...pageProps} /></Suspense></DashboardErrorBoundary> : <CenterMessage theme={theme} title="Page not found" text="That dashboard page does not exist." />}</main></div></div></div></>;
}
