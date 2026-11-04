import { goDashboard } from '../services/dashboardPath.js';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/apiClient.js';
import { buildNotificationRoute } from '../utils/notificationLinks.js';
import { topbarStyles } from '../ui/components';

function getInitial(name = '') { return name.trim().charAt(0).toUpperCase() || '?'; }
function getOwnerManagedSearch() {
  if (typeof window === 'undefined') return '';
  const searchParams = new URLSearchParams(window.location.search || '');
  const ownerGuildId = searchParams.get('ownerGuildId');
  if (!ownerGuildId) return '';
  return '?' + searchParams.toString();
}
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < breakpoint);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function handleResize() { setIsMobile(window.innerWidth < breakpoint); }
    handleResize(); window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);
  return isMobile;
}
function tone(level) { return level === 'danger' ? '#fca5a5' : level === 'warning' ? '#fcd34d' : level === 'success' ? '#86efac' : '#93c5fd'; }

function Topbar({
  theme,
  authLoading = false,
  isAuthenticated = false,
  handleLogin = () => {},
  handleLogout = () => {},
  topbarUserName = 'User',
  currentUser = null,
  currentUserAvatar,
  darkMode = true,
  setDarkMode = () => {},
  loginPending = false,
  notificationSummary = null,
  selectedGuild = '',
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [isUserButtonHovered, setIsUserButtonHovered] = useState(false);
  const [hoveredMenuItem, setHoveredMenuItem] = useState('');
  const [bellHovered, setBellHovered] = useState(false);

  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const drawerRef = useRef(null);
  const bellRef = useRef(null);

  const isMobile = useIsMobile(768);
  const styles = useMemo(() => topbarStyles(theme), [theme]);
  const userInitial = getInitial(topbarUserName);
  const unreadNotifications = Number(notificationSummary?.unread || 0);
  const guildId = String(selectedGuild || '').split(':').pop().trim();
  const isOwner = currentUser?.isOwner === true;
  const isOwnerView = currentUser?.isOwner === true && typeof window !== 'undefined' && window.location.pathname.toLowerCase().includes('owner');

  const closeMenu = useCallback(() => { setMenuOpen(false); setHoveredMenuItem(''); setIsUserButtonHovered(false); }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleMenu = useCallback(() => { if (authLoading || !isAuthenticated) return; setDrawerOpen(false); setMenuOpen((prev) => !prev); }, [authLoading, isAuthenticated]);

  const loadDrawer = useCallback(async () => {
    if (!guildId) return;
    setDrawerLoading(true); setDrawerError('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}?limit=6`);
      setNotifications(payload.notifications || []);
    } catch (error) {
      setDrawerError(error.message || 'Could not load notifications.');
    } finally {
      setDrawerLoading(false);
    }
  }, [guildId]);

  const markAllRead = useCallback(async () => {
    if (!guildId) return;
    setDrawerLoading(true); setDrawerError('');
    try {
      const payload = await api.request(`/api/notifications/${guildId}/mark-all-read`, { method: 'POST' });
      setNotifications((payload.notifications || []).slice(0, 6));
    } catch (error) {
      setDrawerError(error.message || 'Could not mark notifications read.');
    } finally {
      setDrawerLoading(false);
    }
  }, [guildId]);

  const toggleDrawer = useCallback(() => { if (authLoading || !isAuthenticated) return; setMenuOpen(false); setDrawerOpen((open) => !open); }, [authLoading, isAuthenticated]);
  useEffect(() => { if (drawerOpen) loadDrawer(); }, [drawerOpen, loadDrawer]);

  useEffect(() => {
    if (!menuOpen && !drawerOpen) return undefined;
    function handleClickOutside(event) {
      const target = event.target;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target) || drawerRef.current?.contains(target) || bellRef.current?.contains(target)) return;
      closeMenu(); closeDrawer();
    }
    function handleEscape(event) { if (event.key === 'Escape') { closeMenu(); closeDrawer(); } }
    document.addEventListener('mousedown', handleClickOutside); document.addEventListener('touchstart', handleClickOutside); document.addEventListener('keydown', handleEscape);
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('touchstart', handleClickOutside); document.removeEventListener('keydown', handleEscape); };
  }, [menuOpen, drawerOpen, closeMenu, closeDrawer]);

  const handleThemeToggle = useCallback(() => setDarkMode((prev) => !prev), [setDarkMode]);
  const onLogoutClick = useCallback(() => { closeMenu(); handleLogout(); }, [closeMenu, handleLogout]);
  const goToPath = useCallback((path, { preserveOwnerQuery = false } = {}) => { closeMenu(); closeDrawer(); if (typeof window !== 'undefined') goDashboard(path + (preserveOwnerQuery ? getOwnerManagedSearch() : '')); }, [closeMenu, closeDrawer]);
  const openNotification = useCallback((item) => { closeMenu(); closeDrawer(); if (typeof window !== 'undefined') goDashboard(buildNotificationRoute(item)); }, [closeMenu, closeDrawer]);

  const rootStyle = { ...styles.root, width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'visible' };
  const innerStyle = { ...styles.inner, width: '100%', maxWidth: '100%', minWidth: 0, gap: isMobile ? 10 : styles.inner?.gap, paddingLeft: isMobile ? 64 : styles.inner?.paddingLeft, paddingRight: isMobile ? 12 : styles.inner?.paddingRight };
  const actionsWrapStyle = { ...styles.actionsWrap, minWidth: 0, maxWidth: '100%', marginLeft: 'auto', position: 'relative' };
  const userButtonStyle = { ...styles.userButton(isUserButtonHovered || menuOpen), opacity: authLoading ? 0.7 : 1, cursor: authLoading ? 'not-allowed' : 'pointer', maxWidth: isMobile ? 'calc(100vw - 138px)' : 320, minWidth: 0, overflow: 'hidden' };
  const loginButtonStyle = { ...styles.userButton(false), opacity: authLoading || loginPending ? 0.7 : 1, cursor: authLoading || loginPending ? 'not-allowed' : 'pointer', maxWidth: isMobile ? 'calc(100vw - 88px)' : 320, minWidth: 0, overflow: 'hidden' };
  const bellButtonStyle = { border: `1px solid ${unreadNotifications ? 'rgba(59,130,246,0.75)' : theme.cardBorder}`, background: bellHovered || drawerOpen || unreadNotifications ? 'rgba(59,130,246,0.16)' : 'rgba(15,23,42,0.30)', color: theme.cardText, borderRadius: 14, height: 42, minWidth: 42, padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontWeight: 950, position: 'relative', boxShadow: unreadNotifications ? '0 0 22px rgba(59,130,246,0.25)' : 'none' };
  const userTextStyle = { ...styles.userText, minWidth: 0, overflow: 'hidden' };
  const userNameStyle = { ...styles.userName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 132 : 220 };
  const menuStyle = { ...styles.menu, position: 'absolute', right: isMobile ? 8 : styles.menu?.right, left: isMobile ? 'auto' : styles.menu?.left, top: styles.menu?.top, width: isMobile ? 'min(320px, calc(100vw - 24px))' : styles.menu?.width, maxWidth: 'calc(100vw - 24px)', zIndex: 1200 };
  const drawerStyle = { position: 'absolute', top: 54, right: isMobile ? 0 : 88, width: 'min(390px, calc(100vw - 24px))', maxHeight: 'min(560px, calc(100dvh - 90px))', overflow: 'auto', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.96)', color: theme.cardText, borderRadius: 18, padding: 14, boxShadow: theme.shadow, zIndex: 1300, backdropFilter: 'blur(18px)' };
  const smallButton = { border: `1px solid ${theme.cardBorder}`, background: 'rgba(59,130,246,0.12)', color: '#93c5fd', borderRadius: 10, padding: '7px 9px', fontWeight: 900, cursor: 'pointer' };

  return (
    <header style={rootStyle}>
      <div style={innerStyle}>
        <div style={styles.left} />
        <div style={actionsWrapStyle}>
          {isAuthenticated ? (
            <>
              <button ref={bellRef} type="button" title="Notifications" aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ''}`} aria-expanded={drawerOpen} onClick={toggleDrawer} onMouseEnter={() => setBellHovered(true)} onMouseLeave={() => setBellHovered(false)} onBlur={() => setBellHovered(false)} style={bellButtonStyle}>
                <span aria-hidden="true">🔔</span>{unreadNotifications ? <span style={{ color: '#93c5fd' }}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</span> : null}
              </button>

              {drawerOpen ? (
                <div ref={drawerRef} style={drawerStyle} role="dialog" aria-label="Recent notifications">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                    <strong>Notifications</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" onClick={loadDrawer} disabled={drawerLoading} style={{ ...smallButton, opacity: drawerLoading ? 0.65 : 1 }}>Refresh</button>
                      <button type="button" onClick={markAllRead} disabled={drawerLoading || !notifications.length} style={{ ...smallButton, opacity: drawerLoading || !notifications.length ? 0.65 : 1 }}>Mark read</button>
                      <button type="button" onClick={() => goToPath('/notifications', { preserveOwnerQuery: true })} style={smallButton}>View all</button>
                    </div>
                  </div>
                  {drawerLoading ? <p style={{ color: theme.mutedText, margin: 0 }}>Loading...</p> : drawerError ? <p style={{ color: '#fca5a5', margin: 0 }}>{drawerError}</p> : notifications.length ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {notifications.slice(0, 6).map((item) => (
                        <button key={item.id} type="button" onClick={() => openNotification(item)} style={{ textAlign: 'left', border: `1px solid ${item.read ? theme.cardBorder : `${tone(item.level)}88`}`, background: item.read ? 'rgba(15,23,42,0.22)' : `${tone(item.level)}12`, color: theme.cardText, borderRadius: 12, padding: 10, cursor: 'pointer' }}>
                          <strong style={{ color: tone(item.level), display: 'block' }}>{item.title}</strong>
                          <span style={{ color: theme.mutedText, fontSize: 12 }}>{item.source} · {item.createdAt}</span>
                          <span style={{ color: theme.mutedText, fontSize: 13, display: 'block', marginTop: 5 }}>{item.message || 'No details.'}</span>
                        </button>
                      ))}
                    </div>
                  ) : <p style={{ color: theme.mutedText, margin: 0 }}>No notifications yet.</p>}
                </div>
              ) : null}

              <button ref={menuButtonRef} type="button" aria-haspopup="menu" aria-expanded={menuOpen} disabled={authLoading} onClick={toggleMenu} onMouseEnter={() => setIsUserButtonHovered(true)} onMouseLeave={() => setIsUserButtonHovered(false)} onBlur={() => setIsUserButtonHovered(false)} style={userButtonStyle}>
                {currentUserAvatar ? <img src={currentUserAvatar} alt={topbarUserName} style={{ ...styles.avatar, flex: '0 0 auto' }} /> : <div style={{ ...styles.avatarFallback, flex: '0 0 auto' }}>{userInitial}</div>}
                <div style={userTextStyle}><div style={userNameStyle}>{topbarUserName}</div></div>
                <span style={{ ...styles.chevron(menuOpen), flex: '0 0 auto' }}>▾</span>
              </button>

              {menuOpen ? (
                <div ref={menuRef} style={menuStyle} role="menu">
                  <MenuButton styles={styles} hovered={hoveredMenuItem === 'notifications'} onHover={() => setHoveredMenuItem('notifications')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/notifications', { preserveOwnerQuery: true })} icon="🔔" label="Notifications" />
                  <MenuButton styles={styles} hovered={hoveredMenuItem === 'timeline'} onHover={() => setHoveredMenuItem('timeline')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/timeline', { preserveOwnerQuery: true })} icon="🕘" label="Activity Timeline" />
                  <MenuButton styles={styles} hovered={hoveredMenuItem === 'billing'} onHover={() => setHoveredMenuItem('billing')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/billing')} icon="£" label="Billing" />
                  <MenuButton styles={styles} hovered={hoveredMenuItem === 'docs'} onHover={() => setHoveredMenuItem('docs')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/docs')} icon="?" label="Documentation" />
                  {isOwner ? (isOwnerView ? <MenuButton styles={styles} hovered={hoveredMenuItem === 'return'} onHover={() => setHoveredMenuItem('return')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/overview', { preserveOwnerQuery: true })} icon="🏠" label="Return" /> : <MenuButton styles={styles} hovered={hoveredMenuItem === 'owner'} onHover={() => setHoveredMenuItem('owner')} onLeave={() => setHoveredMenuItem('')} onClick={() => goToPath('/owner')} icon="👑" label="Owner View" />) : null}
                  <div style={styles.themeRow}><div style={styles.themeCopy}><span style={styles.themeLabel}>Dark mode</span></div><button type="button" role="switch" aria-checked={darkMode} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} onClick={handleThemeToggle} onMouseEnter={() => setHoveredMenuItem('theme')} onMouseLeave={() => setHoveredMenuItem('')} onBlur={() => setHoveredMenuItem('')} style={styles.themeSwitch(!darkMode, hoveredMenuItem === 'theme')}><span style={styles.themeSwitchTrack}><span style={styles.themeIconLeft}>☾</span><span style={styles.themeIconRight}>☀</span><span style={styles.themeThumb(!darkMode)} /></span></button></div>
                  <button type="button" role="menuitem" onClick={onLogoutClick} onMouseEnter={() => setHoveredMenuItem('logout')} onMouseLeave={() => setHoveredMenuItem('')} onBlur={() => setHoveredMenuItem('')} style={styles.logoutButton(hoveredMenuItem === 'logout')}>Log out</button>
                </div>
              ) : null}
            </>
          ) : (
            <button type="button" onClick={handleLogin} disabled={authLoading || loginPending} style={loginButtonStyle}><div style={userTextStyle}><div style={userNameStyle}>{loginPending ? 'Redirecting...' : 'Login'}</div></div><div style={{ ...styles.avatarFallback, flex: '0 0 auto' }}>↗</div></button>
          )}
        </div>
      </div>
    </header>
  );
}

const MenuButton = memo(function MenuButton({ styles, hovered = false, onHover, onLeave, onClick, icon, label }) {
  return <button type="button" role="menuitem" onClick={onClick} onMouseEnter={onHover} onMouseLeave={onLeave} onBlur={onLeave} style={styles.menuButton(hovered)}><span style={styles.menuButtonIcon}>{icon}</span><span style={styles.menuButtonLabel}>{label}</span></button>;
});

export default memo(Topbar);
