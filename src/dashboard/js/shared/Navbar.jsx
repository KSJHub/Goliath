import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import BotAvatar from './BotAvatar';
import { NAV_BOTTOM } from '../ui/layout';
import { navbarStyles } from '../ui/components';

function getNameInitial(name = '') {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function getGuildAvatar(guild) {
  return guild?.iconUrl || guild?.iconURL || guild?.avatarUrl || guild?.image || '';
}

function normalizePath(path = '') {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function getOwnerManagedSearch(search = '') {
  const params = new URLSearchParams(search || '');
  const ownerGuildId = params.get('ownerGuildId');

  if (!ownerGuildId) return '';

  return `?${params.toString()}`;
}

function isActivePath(currentPath, itemPath) {
  const normalizedCurrent = normalizePath(currentPath);
  const normalizedItem = normalizePath(itemPath);

  if (normalizedItem === '/') return normalizedCurrent === '/';

  return (
    normalizedCurrent === normalizedItem ||
    normalizedCurrent.startsWith(`${normalizedItem}/`)
  );
}

function itemHasActiveChild(currentPath, item) {
  if (!item?.children?.length) return false;
  return item.children.some((child) => isActivePath(currentPath, child.path || '/'));
}

function useIsMobile(breakpoint = 1024) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function handleResize() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

function NavbarIcon({ type, active, color }) {
  const stroke = active ? '#93c5fd' : color;

  const baseProps = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    style: { display: 'block' },
  };

  switch (type) {
    case 'admin':
      return (
        <svg {...baseProps}>
          <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
          <path d="M9.5 12.5 11 14l3.5-4" />
        </svg>
      );

    case 'overview':
      return (
        <svg {...baseProps}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      );

    case 'modules':
      return (
        <svg {...baseProps}>
          <rect x="3" y="4" width="8" height="8" rx="2" />
          <rect x="13" y="4" width="8" height="8" rx="2" />
          <rect x="8" y="14" width="8" height="7" rx="2" />
        </svg>
      );

    case 'cases':
      return (
        <svg {...baseProps}>
          <path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3z" />
        </svg>
      );

    case 'warnings':
      return (
        <svg {...baseProps}>
          <path d="M12 4 21 20H3L12 4z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );

    case 'automod':
      return (
        <svg {...baseProps}>
          <rect x="5" y="8" width="14" height="10" rx="3" />
          <path d="M12 4v4" />
          <path d="M9 12h.01" />
          <path d="M15 12h.01" />
          <path d="M8 18v2" />
          <path d="M16 18v2" />
        </svg>
      );

    case 'generalSettings':
    case 'config':
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" />
        </svg>
      );

    case 'messages':
      return (
        <svg {...baseProps}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="m4 8 8 6 8-6" />
        </svg>
      );

    case 'logs':
      return (
        <svg {...baseProps}>
          <path d="M6 4h12" />
          <path d="M6 9h12" />
          <path d="M6 14h8" />
          <path d="M6 19h10" />
        </svg>
      );

    default:
      return (
        <svg {...baseProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}

function NavbarSectionLabel({ expanded, children, theme }) {
  if (!expanded) return null;

  return (
    <div
      style={{
        margin: '14px 8px 4px',
        color: theme.navbarMuted,
        fontSize: '10px',
        fontWeight: 900,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        opacity: 0.72,
      }}
    >
      {children}
    </div>
  );
}

function NavbarGroup({
  item,
  expanded,
  canNavigate,
  location,
  hoveredNavKey,
  pressedNavKey,
  theme,
  styles,
  handleToggleGroup,
  handleNavigate,
  getNavInteractionProps,
  openGroups,
}) {
  const groupOpen = Boolean(openGroups[item.key]);
  const hasActiveChild = itemHasActiveChild(location.pathname, item);
  const groupHovered = hoveredNavKey === item.key;
  const groupPressed = pressedNavKey === item.key;

  return (
    <div key={item.key} style={{ display: 'grid', gap: '8px' }}>
      <button
        type="button"
        onClick={() => handleToggleGroup(item.key)}
        style={styles.navItem(
          hasActiveChild,
          expanded,
          canNavigate,
          groupHovered,
          groupPressed,
        )}
        title={expanded ? undefined : item.label}
        aria-expanded={groupOpen}
        {...getNavInteractionProps(item.key)}
      >
        <span style={styles.navAccent(hasActiveChild)} />

        <span style={styles.navIcon}>
          <NavbarIcon
            type={item.icon}
            active={hasActiveChild || groupHovered}
            color={theme.navbarText}
          />
        </span>

        {expanded ? <span style={styles.navLabel}>{item.label}</span> : null}
      </button>

      <div
        style={{
          display: 'grid',
          gap: '8px',
          overflow: 'hidden',
          maxHeight: groupOpen && expanded ? `${item.children.length * 58}px` : '0px',
          opacity: groupOpen && expanded ? 1 : 0,
          transform: groupOpen && expanded ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'max-height 0.24s ease, opacity 0.18s ease, transform 0.2s ease',
        }}
      >
        {item.children.map((child) => {
          const childKey = `${item.key}-${child.key}`;
          const childActive = isActivePath(location.pathname, child.path || '/');
          const childHovered = hoveredNavKey === childKey;
          const childPressed = pressedNavKey === childKey;

          const baseChildStyle = styles.navItem(
            childActive,
            expanded,
            canNavigate,
            childHovered,
            childPressed,
          );

          return (
            <button
              key={child.key}
              type="button"
              onClick={() => handleNavigate(child)}
              style={{
                ...baseChildStyle,
                paddingTop: baseChildStyle.paddingTop || '12px',
                paddingRight: baseChildStyle.paddingRight || '12px',
                paddingBottom: baseChildStyle.paddingBottom || '12px',
                paddingLeft: '38px',
                padding: undefined,
              }}
              title={expanded ? undefined : child.label}
              disabled={!canNavigate || !child.path}
              aria-current={childActive ? 'page' : undefined}
              tabIndex={groupOpen && expanded ? 0 : -1}
              {...getNavInteractionProps(childKey)}
            >
              <span style={styles.navAccent(childActive)} />

              <span style={styles.navIcon}>
                <NavbarIcon
                  type={child.icon}
                  active={childActive || childHovered}
                  color={theme.navbarText}
                />
              </span>

              <span style={styles.navLabel}>{child.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavbarItem({
  item,
  itemKey,
  expanded,
  canNavigate,
  location,
  hoveredNavKey,
  pressedNavKey,
  theme,
  styles,
  handleNavigate,
  getNavInteractionProps,
}) {
  const active = isActivePath(location.pathname, item.path || '/');
  const hovered = hoveredNavKey === itemKey;
  const pressed = pressedNavKey === itemKey;

  return (
    <button
      key={item.key}
      type="button"
      onClick={() => handleNavigate(item)}
      style={styles.navItem(active, expanded, canNavigate, hovered, pressed)}
      title={expanded ? undefined : item.label}
      disabled={!canNavigate || !item.path}
      aria-current={active ? 'page' : undefined}
      {...getNavInteractionProps(itemKey)}
    >
      <span style={styles.navAccent(active)} />

      <span style={styles.navIcon}>
        <NavbarIcon
          type={item.icon}
          active={active || hovered}
          color={theme.navbarText}
        />
      </span>

      {expanded ? <span style={styles.navLabel}>{item.label}</span> : null}
    </button>
  );
}

function Navbar({
  theme,
  selectedGuild,
  setSelectedGuild,
  guilds = [],
  guildError = '',
  isAuthenticated = true,
  authLoading = false,
  navItems = [],
  allowedPaths = null,
  botAvatar,
  botName,
  botData,
  expanded = true,
  onToggleCollapsed = () => {},
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const styles = useMemo(() => navbarStyles(theme), [theme]);

  const isMobile = useIsMobile(1024);
  const mobileExpanded = isMobile ? true : expanded;

  const safeNavItems = Array.isArray(navItems) ? navItems : [];
  const safeBottomItems = useMemo(() => (Array.isArray(NAV_BOTTOM) ? NAV_BOTTOM : []).filter((item) => !allowedPaths || allowedPaths.includes(item.path)), [allowedPaths]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({});
  const [collapseHover, setCollapseHover] = useState(false);
  const [hoveredNavKey, setHoveredNavKey] = useState('');
  const [pressedNavKey, setPressedNavKey] = useState('');

  const selectedGuildData = useMemo(
    () => guilds.find((guild) => String(guild.id) === String(selectedGuild)) || null,
    [guilds, selectedGuild],
  );

  const selectedGuildAvatar = getGuildAvatar(selectedGuildData);
  const selectedGuildInitial = getNameInitial(selectedGuildData?.name || '');

  const canNavigate = isAuthenticated;
  const canPickGuild = isAuthenticated && !authLoading && guilds.length > 0;

  const guildOptions = useMemo(() => {
    if (authLoading) return [{ id: '', name: 'Loading guilds...' }];
    if (!guilds.length) return [{ id: '', name: 'No guilds found' }];
    return guilds;
  }, [authLoading, guilds]);

  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };

      [...safeNavItems, ...safeBottomItems].forEach((item) => {
        if (!item?.children?.length) return;

        if (typeof next[item.key] !== 'boolean') {
          next[item.key] = false;
        }

        if (itemHasActiveChild(location.pathname, item)) {
          next[item.key] = true;
        }
      });

      return next;
    });
  }, [location.pathname, safeNavItems, safeBottomItems]);

  useEffect(() => {
    if (!isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    if (isMobile && mobileOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    return undefined;
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return undefined;

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setMobileOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);

    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileOpen]);

  const closeMobileNav = useCallback(() => {
    if (isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile]);

  const handleNavigate = useCallback(
    (item) => {
      if (!canNavigate || !item?.path) return;

      navigate(normalizePath(item.path) + getOwnerManagedSearch(location.search));
      closeMobileNav();
    },
    [canNavigate, navigate, closeMobileNav, location.search],
  );

  const handleToggleGroup = useCallback((groupKey) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const getNavInteractionProps = useCallback(
    (key) => ({
      onMouseEnter: () => {
        if (!canNavigate) return;
        setHoveredNavKey(key);
      },
      onMouseLeave: () => {
        setHoveredNavKey((current) => (current === key ? '' : current));
        setPressedNavKey((current) => (current === key ? '' : current));
      },
      onMouseDown: () => {
        if (!canNavigate) return;
        setPressedNavKey(key);
      },
      onMouseUp: () => {
        setPressedNavKey((current) => (current === key ? '' : current));
      },
      onBlur: () => {
        setHoveredNavKey((current) => (current === key ? '' : current));
        setPressedNavKey((current) => (current === key ? '' : current));
      },
    }),
    [canNavigate],
  );

  const renderNavEntry = useCallback(
    (item, itemKeyPrefix = '') => {
      if (item?.children?.length) {
        return (
          <NavbarGroup
            key={item.key}
            item={item}
            expanded={mobileExpanded}
            canNavigate={canNavigate}
            location={location}
            hoveredNavKey={hoveredNavKey}
            pressedNavKey={pressedNavKey}
            theme={theme}
            styles={styles}
            handleToggleGroup={handleToggleGroup}
            handleNavigate={handleNavigate}
            getNavInteractionProps={getNavInteractionProps}
            openGroups={openGroups}
          />
        );
      }

      const itemKey = itemKeyPrefix ? `${itemKeyPrefix}-${item.key}` : item.key;

      return (
        <NavbarItem
          key={item.key}
          item={item}
          itemKey={itemKey}
          expanded={mobileExpanded}
          canNavigate={canNavigate}
          location={location}
          hoveredNavKey={hoveredNavKey}
          pressedNavKey={pressedNavKey}
          theme={theme}
          styles={styles}
          handleNavigate={handleNavigate}
          getNavInteractionProps={getNavInteractionProps}
        />
      );
    },
    [
      canNavigate,
      mobileExpanded,
      getNavInteractionProps,
      handleNavigate,
      handleToggleGroup,
      hoveredNavKey,
      location,
      openGroups,
      pressedNavKey,
      styles,
      theme,
    ],
  );

  const mobileButtonStyle = {
    position: 'fixed',
    top: 14,
    left: 14,
    zIndex: 1002,
    width: 44,
    height: 44,
    borderRadius: 14,
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(8,15,30,0.94)',
    color: theme.cardText || '#fff',
    display: isMobile ? 'inline-flex' : 'none',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(14px)',
  };

  const mobileOverlayStyle = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(0,0,0,0.56)',
    opacity: mobileOpen ? 1 : 0,
    pointerEvents: mobileOpen ? 'auto' : 'none',
    transition: 'opacity 0.22s ease',
    display: isMobile ? 'block' : 'none',
  };

  const baseRootStyle = styles.root(mobileExpanded);

  const rootStyle = isMobile
    ? {
        ...baseRootStyle,
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 1001,
        width: 'min(86vw, 320px)',
        maxWidth: '320px',
        height: '100dvh',
        transform: mobileOpen ? 'translateX(0)' : 'translateX(-110%)',
        transition: 'transform 0.24s ease',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        borderTopRightRadius: '22px',
        borderBottomRightRadius: '22px',
        boxShadow: mobileOpen ? '24px 0 70px rgba(0,0,0,0.45)' : 'none',
      }
    : baseRootStyle;

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen((prev) => !prev)}
        style={mobileButtonStyle}
        aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? '✕' : '☰'}
      </button>

      <div
        style={mobileOverlayStyle}
        onClick={() => setMobileOpen(false)}
        role="presentation"
      />

      <aside style={rootStyle}>
        <div style={styles.top}>
          <BotAvatar
            theme={theme}
            botAvatar={botAvatar}
            botName={botName}
            botData={botData}
            expanded={mobileExpanded}
          />
        </div>

        <div style={styles.middle}>
          {isAuthenticated ? (
            <div style={styles.guildWrap}>
              {mobileExpanded ? (
                <div style={styles.guildSelectWrap}>
                  <select
                    value={selectedGuild || ''}
                    onChange={(event) => {
                      const guildId = event.target.value || '';
                      setSelectedGuild(guildId);
                    }}
                    disabled={!canPickGuild}
                    style={styles.guildSelect(canPickGuild)}
                  >
                    {guildOptions.map((guild) => (
                      <option key={guild.id || guild.name} value={guild.id}>
                        {guild.name}
                      </option>
                    ))}
                  </select>

                  <span style={styles.guildChevron}>▾</span>
                </div>
              ) : (
                <div style={styles.guildMini}>
                  {selectedGuildAvatar ? (
                    <img
                      src={selectedGuildAvatar}
                      alt={selectedGuildData?.name || 'Guild'}
                      style={styles.guildMiniAvatar}
                    />
                  ) : (
                    <div style={styles.guildMiniFallback}>{selectedGuildInitial}</div>
                  )}
                </div>
              )}

              {guildError && mobileExpanded ? <p style={styles.guildError}>{guildError}</p> : null}
            </div>
          ) : null}

          <nav style={styles.nav}>
            <NavbarSectionLabel expanded={mobileExpanded} theme={theme}>
              Dashboard
            </NavbarSectionLabel>

            {safeNavItems.map((item) => renderNavEntry(item))}

            {safeBottomItems.length ? (
              <>
                {safeBottomItems.map((item) => renderNavEntry(item, 'bottom'))}
              </>
            ) : null}
          </nav>
        </div>

        {!isMobile ? (
          <div style={styles.bottom}>
            <button
              type="button"
              onClick={onToggleCollapsed}
              onMouseEnter={() => setCollapseHover(true)}
              onMouseLeave={() => setCollapseHover(false)}
              style={styles.collapseButton(collapseHover)}
              title={expanded ? 'Collapse Navbar' : 'Expand Navbar'}
              aria-label={expanded ? 'Collapse Navbar' : 'Expand Navbar'}
            >
              <span style={styles.collapseButtonIcon(expanded)}>
                {styles.collapseButtonGlyph(expanded)}
              </span>
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

export default memo(Navbar);

