import { DASHBOARD_LAYOUT } from './layout';

const buttonTones = (theme) => ({
  primary: { bg: theme.primarySoft, border: theme.primaryBorder, color: '#bfdbfe' },
  success: { bg: theme.successSoft, border: theme.successBorder, color: theme.successText },
  warning: { bg: theme.warningSoft, border: theme.warningBorder, color: theme.warningText },
  danger: { bg: theme.dangerSoft, border: theme.dangerBorder, color: theme.dangerText },
  soft: { bg: theme.softBg, border: theme.cardBorder, color: theme.cardText },
});

function makeButton(theme, tone = 'primary', disabled = false) {
  const tones = buttonTones(theme);
  const selected = tones[tone] || tones.primary;

  return {
    borderRadius: '12px',
    border: `1px solid ${selected.border}`,
    background: selected.bg,
    color: selected.color,
    padding: '10px 14px',
    fontWeight: 900,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    boxShadow: disabled ? 'none' : '0 8px 18px rgba(0,0,0,0.14)',
    whiteSpace: 'nowrap',
  };
}

function makeInput(theme) {
  return {
    width: '100%',
    padding: '11px 12px',
    borderRadius: '12px',
    border: `1px solid ${theme.inputBorder}`,
    background: theme.inputBg,
    color: theme.inputText,
    outline: 'none',
    fontSize: '14px',
    boxSizing: 'border-box',
  };
}

function makeTextarea(theme, minHeight = '96px') {
  return {
    ...makeInput(theme),
    minHeight,
    resize: 'vertical',
    lineHeight: 1.5,
    fontFamily: 'inherit',
  };
}

function makeSwitchTrack(theme, checked = false) {
  return {
    width: '48px',
    height: '26px',
    borderRadius: '999px',
    border: checked ? `1px solid ${theme.successBorder}` : `1px solid ${theme.cardBorder}`,
    background: checked ? theme.successSoft : 'rgba(148,163,184,0.18)',
    padding: '3px',
    display: 'flex',
    justifyContent: checked ? 'flex-end' : 'flex-start',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background 0.18s ease, border-color 0.18s ease',
  };
}

function makeSwitchThumb(theme, checked = false) {
  return {
    width: '18px',
    height: '18px',
    borderRadius: '999px',
    background: checked ? theme.success : theme.mutedText,
    display: 'block',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
  };
}

export function appBaseStyles(theme) {
  return {
    app: {
      minHeight: '100vh',
      background: theme.pageBg,
      color: theme.cardText,
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    globalCss: `
      * { box-sizing: border-box; }
      html, body, #root {
        margin: 0;
        padding: 0;
        min-height: 100%;
        width: 100%;
        background: ${theme.pageBg};
        overflow-x: hidden;
      }
      body {
        color: ${theme.cardText};
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button, input, select, textarea { font: inherit; }
      img { max-width: 100%; }
    `,
  };
}

export function shellStyles(theme, { navbarExpanded= true } = {}) {
  return {
    app: {
      minHeight: '100vh',
      background: theme.pageBg,
      color: theme.cardText,
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: `${
        navbarExpanded
          ? DASHBOARD_LAYOUT.navbarExpandedWidth
          : DASHBOARD_LAYOUT.navbarCollapsedWidth
      } minmax(0, 1fr)`,
      minHeight: '100vh',
      transition: 'grid-template-columns 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
    },
    mainColumn: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
    },
    main: {
      flex: 1,
      minWidth: 0,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    },
    pageLoader: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      padding: DASHBOARD_LAYOUT.cardPadding,
      color: theme.cardText,
      boxShadow: theme.shadow,
      display: 'grid',
      gap: '16px',
      alignContent: 'start',
    },
  };
}

export function navbarStyles(theme) {
  return {
    root: (expanded) => ({
  width: expanded ? 280 : 72,
  minWidth: expanded ? 280 : 72,
  maxWidth: expanded ? 280 : 72,

  height: '100vh',

  display: 'flex',
  flexDirection: 'column',

  background: theme.navbarBg,
  borderRight: `1px solid ${theme.navbarBorder}`,

  transition:
    'width 0.22s ease, min-width 0.22s ease, max-width 0.22s ease',

  overflow: 'hidden',

  position: 'sticky',
  top: 0,
}),
        top: {
      display: 'grid',
      gap: '14px',
      padding: '14px 12px 10px',
      alignItems: 'center',
      justifyItems: 'center',
    },
        middle: {
      flex: 1,
      minHeight: 0,

      display: 'flex',
      flexDirection: 'column',

      gap: '10px',

      overflow: 'hidden',

      padding: '6px 8px',
},
    bottom: {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',

  padding: '10px 0 18px',
},
    guildWrap: {
      display: 'grid',
      gap: '8px',
    },
    guildSelectWrap: {
      position: 'relative',
      width: '100%',
    },
    guildSelect(canPickGuild = true) {
      return {
        width: '100%',
        minHeight: '42px',
        padding: '10px 38px 10px 12px',
        borderRadius: '12px',
        border: `1px solid ${theme.inputBorder}`,
        background: theme.inputBg,
        color: theme.inputText,
        appearance: 'none',
        outline: 'none',
        cursor: canPickGuild ? 'pointer' : 'not-allowed',
      };
    },
    guildChevron: {
      position: 'absolute',
      top: '50%',
      right: '12px',
      transform: 'translateY(-50%)',
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1,
      pointerEvents: 'none',
    },
    guildMini: {
  width: '48px',
  height: '48px',

  borderRadius: '16px',

  background: theme.softBg,
  border: `1px solid ${theme.cardBorder}`,

  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',

  overflow: 'hidden',

  boxShadow: theme.shadow,

  margin: '0 auto',
},
    guildMiniAvatar: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    },
    guildMiniFallback: {
      fontWeight: 800,
      color: theme.cardText,
      fontSize: '14px',
    },
    guildError: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1.5,
      color: theme.dangerText,
    },
    nav: {
  display: 'grid',

  gap: '8px',

  alignContent: 'start',

  overflowY: 'auto',

  padding: '4px 0',
},
    navItem(
  active = false,
  expanded = true,
  canNavigate = true,
  isHovered = false,
  isPressed = false,
) {
  const interactive = canNavigate && (isHovered || isPressed);

  return {
    position: 'relative',

    width: '100%',

    minHeight: expanded ? '46px' : '50px',

    padding: expanded
      ? '10px 14px'
      : '10px',

    borderRadius: '16px',

    border:
      active || isHovered
        ? `1px solid ${theme.primaryBorder}`
        : '1px solid transparent',

    background: active
      ? theme.primarySoft
      : isHovered
        ? 'rgba(59,130,246,0.08)'
        : 'transparent',

    display: 'flex',

    alignItems: 'center',

    justifyContent: expanded
      ? 'flex-start'
      : 'center',

    gap: '12px',

    color:
      active || isHovered
        ? '#93c5fd'
        : theme.navbarText,

    cursor: canNavigate
      ? 'pointer'
      : 'not-allowed',

    textAlign: 'left',

    fontSize: '14px',

    fontWeight: active ? 800 : 700,

    opacity: canNavigate ? 1 : 0.5,

    transform: isPressed
      ? 'scale(0.97)'
      : interactive
        ? 'translateY(-1px)'
        : 'translateY(0)',

    boxShadow:
      active || isHovered
        ? theme.shadow
        : 'none',

    transition:
      'background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.12s ease, box-shadow 0.12s ease',

    outline: 'none',

    appearance: 'none',
  };
},
    navAccent(active = false) {
      return {
        position: 'absolute',
        left: 0,
        top: '8px',
        bottom: '8px',
        width: '4px',
        borderRadius: '4px',
        background: theme.primary,
        boxShadow: `0 0 12px ${theme.primary}`,
        opacity: active ? 1 : 0,
        transform: active ? 'scaleY(1)' : 'scaleY(0.35)',
        transformOrigin: 'center',
        transition: 'opacity 0.18s ease, transform 0.22s ease',
      };
    },
    collapseButton(isHovered = false) {
      return {
        width: '36px',
        height: '36px',
        borderRadius: '999px',
        border: `1px solid ${
        isHovered
          ? 'rgba(59,130,246,0.35)'
          : 'rgba(255,255,255,0.06)'
        }`,
        background: isHovered ? theme.softBg : theme.topbarSoft,
        color: theme.navbarText,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        boxShadow: 'none',
        transition:
          'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.18s ease',
        transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
      };
    },
    collapseButtonIcon(expanded = true) {
      return {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        lineHeight: 1,
        transform: expanded ? 'rotate(360deg)' : 'rotate(0deg)',
        transition: 'transform 1.50s ease',
      };
    },
    collapseButtonGlyph(expanded = true) {
      return expanded ? '🔓' : '🔒';
    },
  };
}

export function botAvatarStyles(theme) {
  return {
    wrap(expanded = true) {
      return {
        width: '100%',
        minHeight: '44px',
        padding: expanded ? '10px 12px' : '8px',
        borderRadius: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: expanded ? 'flex-start' : 'center',
        gap: '10px',
        background: theme.topbarSoft,
        border: `1px solid ${theme.topbarSoftBorder}`,
        boxShadow: theme.shadow,
      };
    },
    avatar: {
      width: '28px',
      height: '28px',
      borderRadius: '8px',
      objectFit: 'cover',
      display: 'block',
      flexShrink: 0,
    },
    fallback: {
      width: '28px',
      height: '28px',
      borderRadius: '8px',
      background: theme.softBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 900,
      fontSize: '14px',
      color: theme.cardText,
      flexShrink: 0,
    },
    label: {
      minWidth: 0,
      fontWeight: 800,
      fontSize: '14px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: theme.navbarText,
    },
  };
}

export function topbarStyles(theme) {
  return {
    root: {
      position: 'sticky',
      top: 0,
      zIndex: 20,
      backdropFilter: 'blur(10px)',
      background: theme.topbarBg,
      borderBottom: `1px solid ${theme.topbarBorder}`,
    },
    inner: {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'center',
      gap: '14px',
      padding: '14px 24px',
    },
    left: {},
    actionsWrap: {
      justifySelf: 'end',
      position: 'relative',
      display: 'inline-grid',
      justifyItems: 'stretch',
    },
    userButton(isActive = false) {
      return {
        minWidth: '240px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minHeight: '46px',
        padding: '6px 10px 6px 12px',
        background: isActive ? theme.softBg : theme.topbarSoft,
        border: `1px solid ${
        isActive
          ? 'rgba(59,130,246,0.35)'
          : 'rgba(255,255,255,0.06)'
        }`,
        borderRadius: '14px',
        color: theme.cardText,
        cursor: 'pointer',
        transform: isActive ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: 'none',
        transition:
          'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
      };
    },
    userText: {
      textAlign: 'right',
      minWidth: 0,
      flex: 1,
    },
    userName: {
      fontSize: '14px',
      fontWeight: 700,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    chevron(isOpen = false) {
      return {
        color: theme.mutedText,
        fontSize: '13px',
        lineHeight: 1,
        flexShrink: 0,
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.18s ease, color 0.18s ease',
      };
    },
    avatar: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      objectFit: 'cover',
      flexShrink: 0,
    },
    avatarFallback: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: theme.softBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 800,
      flexShrink: 0,
    },
    menu: {
      position: 'absolute',
      top: '58px',
      right: 0,
      width: '100%',
      minWidth: '100%',
      background: theme.dropdownBg,
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '18px',
      boxShadow: theme.shadow,
      padding: '10px',
      display: 'grid',
      gap: '8px',
      backdropFilter: 'blur(12px)',
    },
    menuButton(isHovered = false) {
      return {
        width: '100%',
        minHeight: '44px',
        padding: '11px 12px',
        borderRadius: '13px',
        border: `1px solid ${isHovered ? theme.primaryBorder : 'transparent'}`,
        background: isHovered ? theme.primarySoft : 'transparent',
        color: isHovered ? '#bfdbfe' : theme.cardText,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        textAlign: 'left',
        fontSize: '14px',
        fontWeight: 800,
        transition:
          'background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease',
        transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
      };
    },
    menuButtonIcon: {
      width: '22px',
      height: '22px',
      borderRadius: '9px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'inherit',
      flexShrink: 0,
      background: theme.topbarSoft,
      border: `1px solid ${theme.topbarSoftBorder}`,
      fontSize: '13px',
    },
    menuButtonLabel: {
      minWidth: 0,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    themeRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '12px',
      borderRadius: '14px',
      border: `1px solid ${theme.topbarSoftBorder}`,
      background: theme.topbarSoft,
    },
    themeCopy: {
      display: 'grid',
      gap: '2px',
    },
    themeLabel: {
      fontSize: '14px',
      fontWeight: 800,
      color: theme.cardText,
    },
    themeSwitch(_isLight = false, isHovered = false) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: `1px solid ${
  isHovered
    ? 'rgba(59,130,246,0.35)'
    : 'rgba(255,255,255,0.06)'
}`,
        background: 'transparent',
        borderRadius: '999px',
        cursor: 'pointer',
        transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
        transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
        boxShadow: isHovered ? theme.shadow : 'none',
      };
    },
    themeSwitchTrack: {
      position: 'relative',
      width: '72px',
      height: '36px',
      borderRadius: '999px',
      background: theme.softBg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 10px',
      overflow: 'hidden',
    },
    themeIconLeft: {
      position: 'relative',
      zIndex: 2,
      fontSize: '14px',
      lineHeight: 1,
      color: theme.mutedText,
      userSelect: 'none',
      pointerEvents: 'none',
    },
    themeIconRight: {
      position: 'relative',
      zIndex: 2,
      fontSize: '14px',
      lineHeight: 1,
      color: theme.mutedText,
      userSelect: 'none',
      pointerEvents: 'none',
    },
    themeThumb(isLight = false) {
      return {
        position: 'absolute',
        top: '3px',
        left: isLight ? '39px' : '3px',
        width: '30px',
        height: '30px',
        borderRadius: '999px',
        background: theme.cardBg,
        border: `1px solid ${theme.topbarSoftBorder}`,
        boxShadow: theme.shadow,
        transition: 'left 0.22s ease, background 0.22s ease, border-color 0.22s ease',
      };
    },
    logoutButton(isHovered = false) {
      return {
        width: '100%',
        padding: '12px 14px',
        borderRadius: '14px',
        border: `1px solid ${theme.dangerBorder}`,
        background: isHovered ? 'rgba(239,68,68,0.2)' : theme.dangerSoft,
        color: theme.dangerText,
        cursor: 'pointer',
        fontWeight: 900,
        fontSize: '14px',
        transform: isHovered ? 'translateX(2px)' : 'translateX(0)',
        transition:
          'transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease',
        boxShadow: isHovered ? theme.shadow : 'none',
      };
    },
  };
}

export function createSharedComponentStyles(theme) {
  return {
    button: (variant = 'primary') => makeButton(theme, variant),

    input: makeInput(theme),

    card: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '18px',
      padding: '18px',
      boxShadow: theme.shadow,
    },

    emptyState: {
      textAlign: 'center',
      color: theme.mutedText,
      padding: '30px',
    },

    loading: {
      color: theme.mutedText,
      padding: '20px',
    },

    bluePanel: {
      background: 'rgba(59,130,246,0.04)',
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: '0 0 0 1px rgba(59,130,246,0.18)',
    },

    blueInnerPanel: {
      background: 'rgba(15,23,42,0.6)',
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '16px',
      boxShadow: '0 0 0 1px rgba(59,130,246,0.12)',
    },

    futurePage: {
      display: 'grid',
      gap: '16px',
    },

    futureGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
      alignItems: 'start',
    },

    futurePanel: {
      background: 'rgba(59,130,246,0.04)',
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '20px',
      boxShadow: '0 0 0 1px rgba(59,130,246,0.18)',
      overflow: 'hidden',
    },

    futureInnerPanel: {
      background: 'rgba(15,23,42,0.6)',
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '16px',
      padding: '16px 18px',
      display: 'grid',
      gap: '10px',
      boxShadow: '0 0 0 1px rgba(59,130,246,0.12)',
    },
  };
}

export function loginPageStyles(theme) {
  return {
    page: {
      minHeight: 'calc(100vh - 120px)',
      display: 'grid',
      placeItems: 'center',
      padding: '24px 0 8px',
    },
    card: {
      width: '100%',
      maxWidth: '920px',
      display: 'grid',
    },
    root: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '24px',
      padding: '18px 24px',
      boxShadow: theme.shadow,
      display: 'grid',
      gap: '12px',
      alignContent: 'center',
    },
    guildRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      minWidth: 0,
      flexWrap: 'wrap',
    },
    guildAvatar: {
      width: '56px',
      height: '56px',
      borderRadius: '18px',
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.cardText,
      fontWeight: 900,
      fontSize: '22px',
      flexShrink: 0,
      boxShadow: theme.shadow,
    },
    guildAvatarImage: {
      width: '56px',
      height: '56px',
      borderRadius: '18px',
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      objectFit: 'cover',
      display: 'block',
      flexShrink: 0,
      boxShadow: theme.shadow,
    },
    guildInfo: {
      minWidth: 0,
      display: 'grid',
      gap: '6px',
    },
    title: {
      fontSize: 'clamp(28px, 3.4vw, 38px)',
      lineHeight: 1.04,
      fontWeight: 900,
      letterSpacing: '-0.03em',
      color: theme.cardText,
      wordBreak: 'break-word',
      margin: 0,
    },
    metaRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    metaPill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      minHeight: '30px',
      padding: '6px 10px',
      borderRadius: '999px',
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      color: theme.mutedText,
      fontSize: '12px',
      fontWeight: 700,
      letterSpacing: '0.02em',
    },
    text: {
      maxWidth: '720px',
      fontSize: '15px',
      lineHeight: 1.6,
      color: theme.mutedText,
      margin: 0,
    },
    loginButton: {
      marginTop: '2px',
      padding: '14px 18px',
      borderRadius: '14px',
      border: `1px solid ${theme.primaryBorder}`,
      background: theme.primarySoft,
      color: '#ffffff',
      fontWeight: 800,
      cursor: 'pointer',
      transition: 'transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease',
      justifySelf: 'start',
    },
    loginButtonState(disabled = false) {
      return {
        opacity: disabled ? 0.7 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      };
    },
  };
}

export const OVERVIEW_UI = {
  hero: {
    fallbackTitle: 'KSJ DIAMOND GAMING',
    subtitle: 'Manage your server configurations.',
    minHeight: '142px',
  },

  cards: {
    statGridMin: '220px',
    snapshotGridMin: '210px',
    chartGridMin: '280px',
    topStatHeight: '92px',
    snapshotHeight: '82px',
  },

  labels: {
    guildId: 'Guild ID',
    overviewTitle: 'Overview',
    overviewSubtitle: 'Guild Stats',
    moderationTitle: 'Moderation Snapshot',
    moderationSubtitle:
      'A breakdown of current warning records and moderation activity for this guild.',
    chartsTitle: 'Live Charts',
    chartsSubtitle: 'Quick visual indicators for health, moderation, and performance.',
    totalCases: 'Total Cases',
    totalWarnings: 'Total Warnings',
    activeWarnings: 'Active Warnings',
    clearedWarnings: 'Cleared Warnings',
  },

  topStats: [
    {
      key: 'botStatus',
      label: 'Bot Status',
      type: 'status',
      onlineText: 'Online',
      offlineText: 'Offline',
      successColorKey: 'success',
      dangerColorKey: 'danger',
    },
    {
      key: 'backend',
      label: 'Backend',
      type: 'status',
      onlineText: 'Online',
      offlineText: 'Offline',
      successColorKey: 'success',
      dangerColorKey: 'danger',
    },
    {
      key: 'apiStatus',
      label: 'API Status',
      type: 'status',
      onlineText: 'Online',
      offlineText: 'Offline',
      successColorKey: 'success',
      dangerColorKey: 'danger',
    },
    {
      key: 'members',
      label: 'Members',
      type: 'metric',
      format: 'number',
    },
    {
      key: 'bots',
      label: 'Bots',
      type: 'metric',
      format: 'number',
    },
  ],

  chartGroups: [
    {
      key: 'system',
      title: 'System',
      subtitle: 'Backend, API, Bot',
      bars: [
        { key: 'backend', label: 'Backend', valueKey: 'backendScore', format: 'integer' },
        { key: 'api', label: 'API', valueKey: 'apiScore', format: 'integer' },
        { key: 'bot', label: 'Bot', valueKey: 'botScore', format: 'integer' },
      ],
    },
    {
      key: 'moderation',
      title: 'Moderation',
      subtitle: 'Cases and warnings',
      bars: [
        { key: 'cases', label: 'Cases', valueKey: 'totalCases', format: 'integer' },
        { key: 'warnings', label: 'Warnings', valueKey: 'totalWarnings', format: 'integer' },
        { key: 'active', label: 'Active', valueKey: 'activeWarnings', format: 'integer' },
        { key: 'cleared', label: 'Cleared', valueKey: 'clearedWarnings', format: 'integer' },
      ],
    },
    {
      key: 'performance',
      title: 'Performance',
      subtitle: 'Latency, request speed, humans, bots',
      bars: [
        { key: 'latency', label: 'Latency', valueKey: 'latencyMs', format: 'integer' },
        { key: 'request', label: 'Request', valueKey: 'requestRate', format: 'integer' },
        { key: 'members', label: 'Members', valueKey: 'members', format: 'integer' },
        { key: 'bots', label: 'Bots', valueKey: 'bots', format: 'integer' },
      ],
    },
  ],
};

function clampOverviewNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function truthyOnline(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['online', 'up', 'ok', 'healthy', 'connected', 'ready', 'true'].includes(normalized)) {
      return true;
    }

    if (['offline', 'down', 'error', 'disconnected', 'false'].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === 'number') return value > 0;

  return defaultValue;
}

export function buildOverviewMetrics({
  selectedGuild = '',
  selectedGuildData = null,
  statusData = null,
  casesData = null,
  warningsData = null,
} = {}) {
  const nestedGuildData =
    selectedGuild && statusData?.guilds && typeof statusData.guilds === 'object'
      ? statusData.guilds[selectedGuild] || null
      : null;

  const guildName =
    selectedGuildData?.name ||
    statusData?.guildName ||
    statusData?.guild?.name ||
    nestedGuildData?.name ||
    OVERVIEW_UI.hero.fallbackTitle;

  const guildId =
    selectedGuildData?.id ||
    statusData?.guildId ||
    statusData?.guild?.id ||
    nestedGuildData?.id ||
    selectedGuild ||
    '—';

  const members =
    clampOverviewNumber(statusData?.humans, NaN) ||
    clampOverviewNumber(statusData?.guild?.humans, NaN) ||
    clampOverviewNumber(nestedGuildData?.humans, NaN) ||
    clampOverviewNumber(statusData?.members, NaN) ||
    clampOverviewNumber(statusData?.memberCount, NaN) ||
    clampOverviewNumber(statusData?.guild?.memberCount, NaN) ||
    clampOverviewNumber(nestedGuildData?.memberCount, NaN) ||
    clampOverviewNumber(selectedGuildData?.approximateMemberCount, 0) ||
    0;

  const bots =
    clampOverviewNumber(statusData?.bots, NaN) ||
    clampOverviewNumber(statusData?.guild?.bots, NaN) ||
    clampOverviewNumber(nestedGuildData?.bots, 0) ||
    0;

  const totalCases = Array.isArray(casesData)
    ? casesData.length
    : Array.isArray(casesData?.cases)
      ? casesData.cases.length
      : clampOverviewNumber(casesData?.total, NaN) ||
        clampOverviewNumber(casesData?.count, 0);

  const warningsArray = Array.isArray(warningsData)
    ? warningsData
    : Array.isArray(warningsData?.warnings)
      ? warningsData.warnings
      : [];

  const totalWarnings = Array.isArray(warningsData)
    ? warningsData.length
    : Array.isArray(warningsData?.warnings)
      ? warningsData.warnings.length
      : clampOverviewNumber(warningsData?.total, NaN) ||
        clampOverviewNumber(warningsData?.count, 0);

  const activeWarnings =
    warningsArray.length > 0
      ? warningsArray.filter((warning) => warning?.cleared !== true).length
      : clampOverviewNumber(warningsData?.active, 0);

  const clearedWarnings =
    warningsArray.length > 0
      ? warningsArray.filter((warning) => warning?.cleared === true).length
      : clampOverviewNumber(warningsData?.cleared, 0);

  const latencyMs =
    clampOverviewNumber(statusData?.latency, NaN) ||
    clampOverviewNumber(statusData?.latencyMs, NaN) ||
    clampOverviewNumber(statusData?.botLatencyMs, NaN) ||
    clampOverviewNumber(statusData?.ping, NaN) ||
    clampOverviewNumber(statusData?.wsPing, 106) ||
    106;

  const requestRate =
    clampOverviewNumber(statusData?.requestRate, NaN) ||
    clampOverviewNumber(statusData?.requestsPerMinute, NaN) ||
    clampOverviewNumber(statusData?.apiRequests, NaN) ||
    clampOverviewNumber(statusData?.requests, 15) ||
    15;

  const botOnline = truthyOnline(
    statusData?.botOnline ?? statusData?.botStatus ?? statusData?.bot?.online,
    true,
  );

  const backendOnline = truthyOnline(
    statusData?.backendOnline ?? statusData?.backendStatus ?? statusData?.backend?.online,
    true,
  );

  const apiOnline = truthyOnline(
    statusData?.apiOnline ?? statusData?.apiStatus ?? statusData?.api?.online,
    true,
  );

  return {
    guildName,
    guildId,
    members,
    bots,
    botOnline,
    backendOnline,
    apiOnline,
    totalCases,
    totalWarnings,
    activeWarnings,
    clearedWarnings,
    latencyMs,
    requestRate,
    botScore: botOnline ? 100 : 0,
    backendScore: backendOnline ? 100 : 0,
    apiScore: apiOnline ? 100 : 0,
  };
}

export function createOverviewPageStyles(theme) {
  const shared = createSharedComponentStyles(theme);

  return {
    page: {
      display: 'grid',
      gap: '20px',
    },
    hero: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      position: 'relative',
      overflow: 'hidden',
      minHeight: OVERVIEW_UI.hero.minHeight,
      padding: '22px 172px 22px 24px',
      display: 'grid',
      alignContent: 'center',
      gap: '10px',
    },
    heroGlow: {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 0,
      background: 'radial-gradient(circle at 85% 50%, rgba(96,165,250,0.18), transparent 34%)',
    },
    heroGuildLogo: {
      position: 'absolute',
      top: '50%',
      right: '20px',
      width: '125px',
      height: '125px',
      transform: 'translateY(-50%)',
      objectFit: 'contain',
      borderRadius: '30px',
      opacity: 0.35,
      filter: 'saturate(1.25) contrast(1.18)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: 1,
    },
    heroTitle: {
      margin: 0,
      position: 'relative',
      zIndex: 2,
      fontSize: 'clamp(30px, 4vw, 56px)',
      lineHeight: 0.94,
      fontWeight: 950,
      letterSpacing: '-0.045em',
      color: theme.cardText,
      textTransform: 'uppercase',
      textShadow: '0 3px 0 rgba(0,0,0,0.28)',
      wordBreak: 'break-word',
    },
    heroMeta: {
      position: 'relative',
      zIndex: 2,
      display: 'grid',
      gap: '8px',
    },
    heroMetaText: {
      margin: 0,
      fontSize: '15px',
      lineHeight: 1.45,
      color: theme.mutedText,
      fontWeight: 600,
    },
    sectionCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      padding: '20px',
      display: 'grid',
      gap: '18px',
    },
    sectionHeadingWrap: {
      display: 'grid',
      gap: '8px',
    },
    sectionTitle: {
      margin: 0,
      fontSize: '22px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
      color: theme.cardText,
    },
    sectionSubtitle: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.45,
      color: theme.mutedText,
      fontWeight: 600,
      maxWidth: '900px',
    },
    topStatsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '14px',
      alignItems: 'stretch',
    },
    topStatsGridItem: () => ({
      minWidth: 0,
      gridColumn: 'span 1',
    }),
    topStatCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      minHeight: '82px',
      padding: '16px',
      display: 'grid',
      alignContent: 'space-between',
      gap: '8px',
      boxShadow: theme.shadow,
    },
    topStatLabel: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: theme.mutedText,
    },
    topStatValueRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    statusDot: (color) => ({
      width: '10px',
      height: '10px',
      borderRadius: '999px',
      background: color,
      boxShadow: `0 0 0 4px ${color}22`,
      flexShrink: 0,
    }),
    topStatValue: (color = theme.cardText) => ({
      margin: 0,
      fontSize: '24px',
      lineHeight: 1,
      fontWeight: 950,
      color,
    }),
    snapshotGrid: {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${OVERVIEW_UI.cards.snapshotGridMin}, 1fr))`,
      gap: '14px',
    },
    snapshotCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      minHeight: '82px',
      padding: '16px',
      display: 'grid',
      gap: '8px',
      alignContent: 'space-between',
      boxShadow: theme.shadow,
    },
    snapshotLabel: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: theme.mutedText,
    },
    snapshotValue: {
      margin: 0,
      fontSize: '24px',
      lineHeight: 1,
      fontWeight: 950,
      color: theme.cardText,
    },
    chartsGrid: {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${OVERVIEW_UI.cards.chartGridMin}, 1fr))`,
      gap: '16px',
      alignItems: 'stretch',
    },
    chartCard: {
      ...shared.blueInnerPanel,
      padding: '16px',
      display: 'grid',
      gap: '16px',
      alignContent: 'start',
    },
    chartHeading: {
      display: 'grid',
      gap: '6px',
    },
    chartTitle: {
      margin: 0,
      fontSize: '17px',
      lineHeight: 1.1,
      fontWeight: 900,
      color: theme.cardText,
    },
    chartSubtitle: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.45,
      color: theme.mutedText,
    },
    barsWrap: {
      display: 'grid',
      gap: '14px',
      alignContent: 'end',
      minHeight: '170px',
    },
    barsRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(56px, 1fr))',
      gap: '10px',
      alignItems: 'end',
      minHeight: '126px',
    },
    barColumn: {
      display: 'grid',
      gap: '8px',
      alignItems: 'end',
      justifyItems: 'stretch',
    },
    barTrack: {
      height: '100px',
      display: 'flex',
      alignItems: 'flex-end',
      padding: '0 4px',
    },
    barFill: (heightPercent) => ({
      width: '100%',
      height: `${Math.max(14, Math.min(100, heightPercent))}%`,
      borderRadius: '10px',
      background:
        'linear-gradient(180deg, rgba(59,130,246,0.95) 0%, rgba(37,99,235,0.72) 100%)',
      border: '1px solid rgba(147,197,253,0.26)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
      transition: 'height 0.24s ease',
    }),
    barLabel: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1.2,
      fontWeight: 800,
      color: theme.cardText,
      textAlign: 'left',
    },
    barValue: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1.2,
      color: theme.mutedText,
      fontWeight: 700,
    },
  };
}

export function getOverviewChartValue(value, chartKey) {
  const safe = clampOverviewNumber(value, 0);

  if (chartKey === 'moderation') {
    return Math.max(0, Math.min(100, safe * 12));
  }

  if (chartKey === 'performance') {
    if (safe <= 0) return 12;
    return Math.max(12, Math.min(100, safe));
  }

  return Math.max(0, Math.min(100, safe));
}

export function formatOverviewDisplayValue(value, format = 'integer') {
  const safe = clampOverviewNumber(value, 0);

  if (format === 'number' || format === 'integer') {
    return String(Math.round(safe));
  }

  return String(safe);
}

export const CONFIG_UI = {
  sectionKeys: {
    general: 'general',
    commands: 'commands',
    errorMessages: 'errorMessages',
    permissions: 'permissions',
    data: 'data',
  },
};

export function createConfigPageStyles(theme) {
  const shared = createSharedComponentStyles(theme);

  return {
    dashboardToggleWrap: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    dashboardStatusText(enabled = false) {
      return {
        color: enabled ? theme.success : theme.danger,
        fontWeight: 800,
        fontSize: '18px',
      };
    },
    dashboardToggle(enabled = false) {
      return {
        width: '50px',
        height: '26px',
        borderRadius: '999px',
        border: `1px solid ${enabled ? theme.successBorder : theme.cardBorder}`,
        background: enabled ? theme.successSoft : 'rgba(148,163,184,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: enabled ? 'flex-end' : 'flex-start',
        padding: '3px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      };
    },
    dashboardToggleThumb(enabled = false) {
      return {
        width: '18px',
        height: '18px',
        borderRadius: '999px',
        background: enabled ? theme.success : theme.mutedText,
        transition: 'all 0.2s ease',
      };
    },
    pageSection: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '20px',
      boxShadow: theme.shadow,
      padding: '20px',
      display: 'grid',
      gap: '18px',
    },
    pageSectionHeader: {
      display: 'grid',
      gap: '8px',
    },
    pageSectionTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '22px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    pageSectionSubtitle: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    innerStack: {
      display: 'grid',
      gap: '14px',
    },
    innerStackSmall: {
      display: 'grid',
      gap: '8px',
    },
    actionInnerRow: {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '14px',
    },
    selectOption(selected = false) {
      return {
        width: '100%',
        borderRadius: '12px',
        border: selected ? `1px solid ${theme.primaryBorder}` : `1px solid ${theme.cardBorder}`,
        background: selected ? theme.primarySoft : theme.softBg,
        color: selected ? '#bfdbfe' : theme.cardText,
        padding: '11px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        fontWeight: 800,
        cursor: 'pointer',
        textAlign: 'left',
      };
    },
    toggleOffLabel: {
      order: 2,
    },
    minWidthZero: {
      minWidth: 0,
    },
    section: {
      ...shared.bluePanel,
      overflow: 'hidden',
    },
    sectionHeader: {
      width: '100%',
      border: 0,
      background: 'transparent',
      color: theme.cardText,
      padding: '20px',
      cursor: 'pointer',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '16px',
      textAlign: 'left',
    },
    sectionTitleWrap: {
      display: 'grid',
      gap: '7px',
      minWidth: 0,
    },
    sectionTitle: {
      fontSize: '19px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
      color: theme.cardText,
    },
    sectionSubtitle: {
      fontSize: '14px',
      lineHeight: 1.45,
      color: theme.mutedText,
      fontWeight: 600,
    },
    sectionBody: {
      borderTop: `1px solid ${theme.cardBorder}`,
      padding: '20px',
    },
    chevron(open = false) {
      return {
        width: '36px',
        height: '36px',
        borderRadius: '12px',
        display: 'grid',
        placeItems: 'center',
        border: `1px solid ${open ? theme.primaryBorder : theme.cardBorder}`,
        background: open ? theme.primarySoft : 'rgba(15,23,42,0.35)',
        color: open ? '#bfdbfe' : theme.mutedText,
        transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
      };
    },
    chevronIcon(open = false) {
      return {
        display: 'inline-block',
        fontSize: '14px',
        lineHeight: 1,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
        opacity: 0.85,
      };
    },
    grid: {
      display: 'grid',
      gap: '16px',
    },
    gridSmall: {
      display: 'grid',
      gap: '12px',
    },
    label: {
      margin: '0 0 6px 0',
      fontSize: '12px',
      fontWeight: 800,
      color: theme.mutedText,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    input: makeInput(theme),
    row: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
    },
    rowGrid: {
      ...shared.blueInnerPanel,
      padding: '16px 18px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '16px',
    },
    inlineTitle: {
      color: theme.cardText,
      fontWeight: 900,
      fontSize: '15px',
      lineHeight: 1.2,
    },
    inlineText: {
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    rowTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '18px',
      lineHeight: 1.15,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    rowText: {
      margin: '5px 0 0',
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.4,
      fontWeight: 600,
    },
    actionRow: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '18px 20px',
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '18px',
    },
    actionIcon: {
      width: '26px',
      height: '26px',
      display: 'grid',
      placeItems: 'center',
      color: theme.cardText,
      fontWeight: 900,
      fontSize: '18px',
    },
    actionTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '19px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    actionText: {
      margin: '6px 0 0',
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    rightIcon: {
      color: theme.cardText,
      fontSize: '30px',
      lineHeight: 1,
      fontWeight: 500,
    },
    prefixPanel: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '18px 20px',
      display: 'grid',
      gap: '14px',
    },
    prefixHeader: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: '16px',
      alignItems: 'start',
    },
    prefixTitleRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexWrap: 'wrap',
    },
    prefixTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '19px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    prefixCount: {
      padding: '3px 8px',
      borderRadius: '999px',
      background: theme.topbarSoft,
      border: `1px solid ${theme.cardBorder}`,
      color: theme.mutedText,
      fontSize: '12px',
      fontWeight: 900,
    },
    prefixText: {
      margin: '8px 0 0',
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    prefixChip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      padding: '9px 12px',
      borderRadius: '10px',
      background: theme.topbarSoft,
      border: `1px solid ${theme.cardBorder}`,
      color: theme.cardText,
      fontWeight: 900,
    },
    prefixDelete: {
      color: theme.mutedText,
    },
    infoRow: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '18px 20px',
      display: 'grid',
      gap: '10px',
    },
    chipsWrap: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
    },
    chip: {
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: '26px',
      padding: '5px 9px',
      borderRadius: '8px',
      background: theme.topbarSoft,
      border: `1px solid ${theme.cardBorder}`,
      color: theme.cardText,
      fontSize: '13px',
      fontWeight: 800,
    },
    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
    switchTrack(checked = false) {
      return makeSwitchTrack(theme, checked);
    },
    switchThumb(checked = false) {
      return makeSwitchThumb(theme, checked);
    },
    permissionOption(checked = false) {
      return {
        width: '100%',
        borderRadius: '12px',
        border: checked ? `1px solid ${theme.primaryBorder}` : `1px solid ${theme.cardBorder}`,
        background: checked ? theme.primarySoft : theme.softBg,
        color: checked ? '#bfdbfe' : theme.cardText,
        padding: '11px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        fontWeight: 800,
        cursor: 'pointer',
        textAlign: 'left',
      };
    },
    dashboardInlineToggle(enabled = false) {
      return {
        border: `1px solid ${enabled ? theme.successBorder : theme.cardBorder}`,
        background: enabled ? theme.successSoft : 'rgba(148,163,184,0.15)',
        color: enabled ? theme.success : theme.mutedText,
        padding: '6px 12px',
        borderRadius: '8px',
        fontWeight: 800,
        fontSize: '18px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      };
    },
  };
}

export function createDashboardControlStyles(theme) {
  return {
    sectionList: {
      display: 'grid',
      gap: '14px',
    },
    ruleCard(open = false) {
      return {
        background: open ? 'rgba(59,130,246,0.06)' : theme.softBg,
        border: `1px solid ${theme.primaryBorder}`,
        borderRadius: '16px',
        padding: open ? '18px 20px' : '16px 20px',
        display: 'grid',
        gap: open ? '16px' : '0',
        boxShadow: open ? '0 0 0 1px rgba(59,130,246,0.18)' : 'none',
        transition:
          'border-color 0.2s ease, background 0.2s ease, padding 0.2s ease, box-shadow 0.2s ease',
      };
    },
    ruleHeader: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '16px',
    },
    ruleTitleButton: {
      border: 0,
      background: 'transparent',
      padding: 0,
      textAlign: 'left',
      cursor: 'pointer',
      minWidth: 0,
    },
    ruleTitleRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    ruleTitle: {
      color: theme.cardText,
      fontWeight: 900,
      fontSize: '18px',
      lineHeight: 1.15,
      letterSpacing: '-0.03em',
    },
    ruleDescription: {
      margin: '6px 0 0',
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    ruleActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexShrink: 0,
    },
    statusPill(checked = false) {
      return {
        borderRadius: '999px',
        padding: '4px 9px',
        background: checked ? theme.successSoft : 'rgba(148,163,184,0.14)',
        border: checked ? `1px solid ${theme.successBorder}` : `1px solid ${theme.cardBorder}`,
        color: checked ? theme.success : theme.mutedText,
        fontSize: '11px',
        fontWeight: 900,
      };
    },
    toggleButton(checked = false) {
      return {
        minWidth: '58px',
        height: '34px',
        padding: checked ? '0 9px 0 13px' : '0 13px 0 9px',
        borderRadius: '999px',
        border: checked ? `1px solid ${theme.successBorder}` : `1px solid ${theme.cardBorder}`,
        background: checked ? 'rgba(34,197,94,0.28)' : theme.softBg,
        color: checked ? theme.success : theme.cardText,
        fontWeight: 900,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '6px',
        transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease',
      };
    },
    toggleDot(checked = false) {
      return {
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        background: '#ffffff',
        display: 'block',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        order: checked ? 2 : 1,
      };
    },
    chevron(open = false) {
      return {
        width: '36px',
        height: '36px',
        borderRadius: '12px',
        display: 'grid',
        placeItems: 'center',
        border: `1px solid ${open ? theme.primaryBorder : theme.cardBorder}`,
        background: open ? theme.primarySoft : 'rgba(15,23,42,0.35)',
        color: open ? '#bfdbfe' : theme.mutedText,
        cursor: 'pointer',
        transition: 'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
      };
    },
    chevronIcon(open = false) {
      return {
        display: 'inline-block',
        fontSize: '14px',
        lineHeight: 1,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
        opacity: 0.85,
      };
    },
    expandedPanel: {
      background: theme.inputBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '14px',
      padding: '16px',
      display: 'grid',
      gap: '14px',
    },
    input: makeInput(theme),
    textarea: makeTextarea(theme, '82px'),
    label: {
      margin: '0 0 6px 0',
      fontSize: '12px',
      fontWeight: 800,
      color: theme.mutedText,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    helpText: {
      margin: '6px 0 0',
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1.45,
    },
    twoColumnGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
    },
  };
}

export function createAutoModPageStyles(theme) {
  const controls = createDashboardControlStyles(theme);

  return {
    ...controls,
    ruleList: controls.sectionList,
    saveRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: '12px',
      flexWrap: 'wrap',
    },
    punishmentSelectWrap: {
      position: 'relative',
      width: '100%',
    },
    punishmentGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '10px',
    },
    punishmentOption(selected = false) {
      return {
        width: '100%',
        borderRadius: '12px',
        border: selected ? `1px solid ${theme.primaryBorder}` : `1px solid ${theme.cardBorder}`,
        background: selected ? theme.primarySoft : theme.softBg,
        color: selected ? '#bfdbfe' : theme.cardText,
        padding: '11px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '12px',
        fontWeight: 800,
        cursor: 'pointer',
        textAlign: 'left',
      };
    },
    actionSummary: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1.45,
      fontWeight: 700,
    },
    ruleMiniGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
    },
    miniField: {
      display: 'grid',
      gap: '6px',
    },
    dangerPanel: {
      background: theme.dangerSoft,
      border: `1px solid ${theme.dangerBorder}`,
      borderRadius: '14px',
      padding: '14px',
      color: theme.dangerText,
      fontWeight: 800,
      lineHeight: 1.45,
    },
    successPanel: {
      background: theme.successSoft,
      border: `1px solid ${theme.successBorder}`,
      borderRadius: '14px',
      padding: '14px',
      color: theme.successText,
      fontWeight: 800,
      lineHeight: 1.45,
    },
    punishmentTrigger: {
      width: '100%',
      minHeight: '43px',
      padding: '11px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.inputText,
      outline: 'none',
      fontSize: '14px',
      boxSizing: 'border-box',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '10px',
      textAlign: 'left',
      cursor: 'pointer',
    },
    punishmentTriggerText: {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontWeight: 800,
    },
    punishmentMenu: {
      position: 'absolute',
      zIndex: 30,
      top: 'calc(100% + 8px)',
      left: 0,
      right: 0,
      display: 'grid',
      gap: '8px',
      padding: '8px',
      background: theme.dropdownBg,
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '14px',
      boxShadow: theme.shadow,
    },
    toggleOffLabel: {
      order: 2,
    },
  };
}

export function createRecordPageStyles(theme) {
  const shared = createSharedComponentStyles(theme);

  return {
    page: {
      display: 'grid',
      gap: '16px',
    },
    toolbar: {
      ...shared.bluePanel,
      padding: '16px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: '14px',
      alignItems: 'center',
    },
    toolbarStack: {
      display: 'grid',
      gap: '6px',
      minWidth: 0,
    },
    toolbarTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '20px',
      fontWeight: 900,
    },
    toolbarText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      fontWeight: 600,
    },
    searchInput: {
      width: 'min(100%, 320px)',
      padding: '11px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.inputText,
      fontSize: '14px',
    },
    select: {
      minWidth: '180px',
      padding: '11px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.inputText,
      fontSize: '14px',
    },
    contentGrid: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 0.9fr)',
      gap: '16px',
      alignItems: 'start',
    },
    listCard: {
      ...shared.bluePanel,
      overflow: 'hidden',
    },
    listHeader: {
      padding: '16px 18px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    listTitle: {
      margin: 0,
      fontSize: '18px',
      fontWeight: 900,
      color: theme.cardText,
    },
    countPill: {
      padding: '5px 10px',
      borderRadius: '999px',
      background: theme.topbarSoft,
      border: `1px solid ${theme.cardBorder}`,
      fontSize: '12px',
      fontWeight: 900,
      color: theme.mutedText,
    },
    list: {
      display: 'grid',
    },
    recordButton(active = false) {
      return {
        width: '100%',
        border: 0,
        borderBottom: `1px solid ${theme.cardBorder}`,
        background: active ? theme.primarySoft : 'transparent',
        padding: '14px 16px',
        display: 'grid',
        gap: '8px',
        cursor: 'pointer',
      };
    },
    recordTop: {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '12px',
      alignItems: 'center',
    },
    recordTitle: {
      margin: 0,
      fontSize: '15px',
      fontWeight: 900,
      color: theme.cardText,
    },
    recordMeta: {
      margin: 0,
      fontSize: '12px',
      fontWeight: 700,
      color: theme.mutedText,
    },
    recordReason: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: theme.mutedText,
    },
    badge(tone = 'soft') {
      return createBadgeStyles(theme).badge(tone);
    },
    detailCard: {
      ...shared.bluePanel,
      overflow: 'hidden',
      position: 'sticky',
      top: '88px',
    },
    detailHeader: {
      padding: '18px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'grid',
      gap: '8px',
    },
    detailTitle: {
      margin: 0,
      fontSize: '21px',
      fontWeight: 950,
      color: theme.cardText,
    },
    detailSubtitle: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: theme.mutedText,
    },
    detailBody: {
      padding: '18px',
      display: 'grid',
      gap: '14px',
    },
    detailGrid: {
      display: 'grid',
      gap: '12px',
    },
    detailRow: {
      ...shared.blueInnerPanel,
      padding: '13px 14px',
      display: 'grid',
      gap: '6px',
    },
    detailLabel: {
      fontSize: '11px',
      fontWeight: 900,
      textTransform: 'uppercase',
      color: theme.mutedText,
    },
    detailValue: {
      fontSize: '14px',
      fontWeight: 800,
      color: theme.cardText,
    },
    emptyPanel: {
      ...shared.bluePanel,
      padding: '28px',
      textAlign: 'center',
      display: 'grid',
      gap: '10px',
    },
    emptyTitle: {
      fontSize: '20px',
      fontWeight: 900,
      color: theme.cardText,
    },
    emptyText: {
      fontSize: '14px',
      fontWeight: 600,
      color: theme.mutedText,
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '14px',
    },
    statCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'grid',
      gap: '8px',
      boxShadow: theme.shadow,
    },
    statLabel: {
      fontSize: '12px',
      fontWeight: 900,
      textTransform: 'uppercase',
      color: theme.mutedText,
    },
    statValue: {
      fontSize: '24px',
      fontWeight: 950,
      color: theme.cardText,
    },
    statValueWarning: {
      fontSize: '24px',
      fontWeight: 950,
      color: theme.warning,
    },
    statValueSuccess: {
      fontSize: '24px',
      fontWeight: 950,
      color: theme.success,
    },
  };
}

export const createCasesPageStyles = createRecordPageStyles;
export const createWarningsPageStyles = createRecordPageStyles;

export function createMessagesPageStyles(theme) {
  const shared = createSharedComponentStyles(theme);

  return {
    page: {
      display: 'grid',
      gap: '18px',
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: '14px',
    },
    statCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'grid',
      gap: '8px',
      minHeight: '82px',
      boxShadow: theme.shadow,
    },
    statLabel: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '12px',
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    statValue: {
      margin: 0,
      color: theme.cardText,
      fontSize: '24px',
      fontWeight: 950,
    },
    statValueSuccess: {
      margin: 0,
      color: theme.success,
      fontSize: '24px',
      fontWeight: 950,
    },
    statValueDanger: {
      margin: 0,
      color: theme.danger,
      fontSize: '24px',
      fontWeight: 950,
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: '16px',
    },
    panel: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '18px',
      padding: '18px',
      display: 'grid',
      gap: '14px',
      boxShadow: theme.shadow,
    },
    panelTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '16px',
      fontWeight: 800,
    },
    panelHeader: {
      padding: '18px 20px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'grid',
      gap: '7px',
    },
    panelText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    panelBody: {
      padding: '20px',
      display: 'grid',
      gap: '14px',
    },
    formGrid: {
      display: 'grid',
      gap: '14px',
    },
    twoColumnGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
    },
    label: {
      margin: '0 0 6px',
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    input: makeInput(theme),
    textarea: makeTextarea(theme, '132px'),
    previewCard: {
      ...shared.blueInnerPanel,
      padding: '16px',
      display: 'grid',
      gap: '12px',
    },
    previewTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '16px',
      lineHeight: 1.2,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    previewText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.55,
      fontWeight: 600,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    actionRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
    switchRow: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '14px 16px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '14px',
    },
    switchTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '15px',
      lineHeight: 1.2,
      fontWeight: 900,
    },
    switchText: {
      margin: '5px 0 0',
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    switchTrack(checked = false) {
      return makeSwitchTrack(theme, checked);
    },
    switchThumb(checked = false) {
      return makeSwitchThumb(theme, checked);
    },
  };
}

export function createLogsPageStyles(theme) {
  const shared = createSharedComponentStyles(theme);

  return {
    page: {
      display: 'grid',
      gap: '16px',
    },
    toolbar: {
      background: 'rgba(59,130,246,0.05)',
      border: `1px solid ${theme.primaryBorder}`,
      borderRadius: '20px',
      boxShadow: '0 0 0 1px rgba(59,130,246,0.18)',
      padding: '18px 20px',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: '16px',
    },
    toolbarTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '20px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    toolbarText: {
      margin: '6px 0 0',
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    filterRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    select: {
      minWidth: '220px',
      padding: '11px 12px',
      borderRadius: '12px',
      border: `1px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.inputText,
      outline: 'none',
      fontSize: '14px',
      boxSizing: 'border-box',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '16px',
      alignItems: 'start',
    },
    logCard: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      overflow: 'hidden',
    },
    logHeader: {
      padding: '16px 18px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'grid',
      gap: '7px',
    },
    logTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '18px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    logDescription: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    logBody: {
      padding: '20px',
      display: 'grid',
      gap: '16px',
    },
    row: {
      ...shared.blueInnerPanel,
      padding: '16px 18px',
      display: 'grid',
      gap: '10px',
    },
    rowHeader: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: '12px',
      alignItems: 'center',
    },
    rowTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '15px',
      lineHeight: 1.2,
      fontWeight: 900,
    },
    rowText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    channelSelect: makeInput(theme),
    badge(enabled = false) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '24px',
        padding: '4px 9px',
        borderRadius: '999px',
        background: enabled ? theme.successSoft : 'rgba(148,163,184,0.14)',
        border: enabled ? `1px solid ${theme.successBorder}` : `1px solid ${theme.cardBorder}`,
        color: enabled ? theme.successText : theme.mutedText,
        fontSize: '11px',
        lineHeight: 1,
        fontWeight: 900,
        whiteSpace: 'nowrap',
      };
    },
    actionRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
    emptyPanel: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      padding: '28px',
      display: 'grid',
      gap: '10px',
      justifyItems: 'center',
      textAlign: 'center',
      color: theme.mutedText,
    },
  };
}

export function createPageShellStyles(theme) {
  return {
    shell: {
      display: 'grid',
      gap: DASHBOARD_LAYOUT.pageGap,
    },
    header: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      padding: DASHBOARD_LAYOUT.cardPadding,
      boxShadow: theme.shadow,
      display: 'grid',
      gap: '8px',
      height: 'auto',
      minHeight: '140px',
      boxSizing: 'border-box',
      alignContent: 'center',
      minWidth: 0,
    },
    eyebrow: {
      margin: 0,
      color: theme.primary,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
    },
    title: {
      margin: 0,
      color: theme.cardText,
      fontSize: 'clamp(28px, 4vw, 46px)',
      lineHeight: 1.15,
      overflowWrap: 'anywhere',
      fontWeight: 950,
      letterSpacing: '-0.045em',
      textShadow: '0 3px 0 rgba(0,0,0,0.22)',
    },
    description: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '15px',
      lineHeight: 1.55,
      fontWeight: 600,
      maxWidth: '900px',
    },
    content: {
      display: 'grid',
      gap: '16px',
    },
    sectionCard: {
      ...createSharedComponentStyles(theme).bluePanel,
      padding: DASHBOARD_LAYOUT.cardPadding,
      display: 'grid',
      gap: '16px',
    },
    sectionHeader: {
      display: 'grid',
      gap: '7px',
    },
    sectionTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '22px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    sectionDescription: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    notice(tone = 'soft') {
      const tones = {
        soft: { bg: theme.softBg, border: theme.cardBorder, color: theme.mutedText },
        primary: { bg: theme.primarySoft, border: theme.primaryBorder, color: '#bfdbfe' },
        success: { bg: theme.successSoft, border: theme.successBorder, color: theme.successText },
        warning: { bg: theme.warningSoft, border: theme.warningBorder, color: theme.warningText },
        danger: { bg: theme.dangerSoft, border: theme.dangerBorder, color: theme.dangerText },
      };

      const selected = tones[tone] || tones.soft;

      return {
        background: selected.bg,
        border: `1px solid ${selected.border}`,
        borderRadius: '14px',
        padding: '13px 14px',
        color: selected.color,
        fontSize: '14px',
        lineHeight: 1.45,
        fontWeight: 700,
      };
    },
    loadingPanel: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      padding: DASHBOARD_LAYOUT.cardPadding,
      boxShadow: theme.shadow,
      color: theme.mutedText,
      display: 'grid',
      gap: '12px',
      alignContent: 'center',
      minHeight: '140px',
    },
    emptyPanel: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      padding: DASHBOARD_LAYOUT.cardPadding,
      boxShadow: theme.shadow,
      color: theme.mutedText,
      textAlign: 'center',
      display: 'grid',
      gap: '10px',
      justifyItems: 'center',
    },
    statGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '14px',
    },
    statCard: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'grid',
      gap: '8px',
      minHeight: '86px',
    },
    statLabel: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    statValue: {
      margin: 0,
      color: theme.cardText,
      fontSize: '24px',
      lineHeight: 1,
      fontWeight: 950,
      letterSpacing: '-0.04em',
    },
    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
  };
}

export const createPageShellComponentStyles = createPageShellStyles;
export const createSharedDashboardStyles = createPageShellStyles;

export function createFormStyles(theme) {
  return {
    grid: {
      display: 'grid',
      gap: '14px',
    },
    twoColumnGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
    },
    label: {
      margin: '0 0 6px',
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    input: makeInput(theme),
    select: makeInput(theme),
    textarea: makeTextarea(theme),
    helpText: {
      margin: '6px 0 0',
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    actionRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },
    fieldCard: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'grid',
      gap: '10px',
    },
    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
  };
}

export function createListStyles(theme) {
  return {
    card: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      overflow: 'hidden',
    },
    header: {
      padding: '16px 18px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'grid',
      gap: '6px',
    },
    title: {
      margin: 0,
      color: theme.cardText,
      fontSize: '18px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },
    text: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },
    body: {
      display: 'grid',
      gap: 0,
    },
    item(active = false) {
      return {
        width: '100%',
        border: 0,
        borderBottom: `1px solid ${theme.cardBorder}`,
        background: active ? theme.primarySoft : 'transparent',
        color: theme.cardText,
        cursor: 'pointer',
        padding: '14px 16px',
        display: 'grid',
        gap: '8px',
        textAlign: 'left',
        transition: 'background 0.16s ease',
      };
    },
    itemTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '15px',
      fontWeight: 900,
      lineHeight: 1.2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    itemMeta: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1.35,
      fontWeight: 700,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    itemText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '13px',
      lineHeight: 1.45,
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  };
}

export function createBadgeStyles(theme) {
  return {
    badge(tone = 'soft') {
      const tones = {
        soft: {
          bg: theme.topbarSoft,
          border: theme.cardBorder,
          color: theme.mutedText,
        },
        success: {
          bg: theme.successSoft,
          border: theme.successBorder,
          color: theme.successText,
        },
        warning: {
          bg: theme.warningSoft,
          border: theme.warningBorder,
          color: theme.warningText,
        },
        danger: {
          bg: theme.dangerSoft,
          border: theme.dangerBorder,
          color: theme.dangerText,
        },
        primary: {
          bg: theme.primarySoft,
          border: theme.primaryBorder,
          color: '#bfdbfe',
        },
      };

      const selected = tones[tone] || tones.soft;

      return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '24px',
        padding: '4px 9px',
        borderRadius: '999px',
        background: selected.bg,
        border: `1px solid ${selected.border}`,
        color: selected.color,
        fontSize: '11px',
        lineHeight: 1,
        fontWeight: 900,
        whiteSpace: 'nowrap',
      };
    },
  };
}

export const createTableStyles = createRecordPageStyles;
export const createCasePageStyles = createRecordPageStyles;
export const createWarningPageStyles = createRecordPageStyles;

export function createRestorePageStyles(theme) {
  return {
    page: {
      display: 'grid',
      gap: '20px',
    },

    hero: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      padding: DASHBOARD_LAYOUT.cardPadding,
      boxShadow: theme.shadow,
      display: 'grid',
      gap: '10px',
    },

    heroTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: 'clamp(28px, 4vw, 46px)',
      lineHeight: 0.96,
      fontWeight: 950,
      letterSpacing: '-0.045em',
      textShadow: '0 3px 0 rgba(0,0,0,0.22)',
    },

    heroText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '15px',
      lineHeight: 1.55,
      fontWeight: 600,
      maxWidth: '900px',
    },

    grid: {
      display: 'grid',
      gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
      gap: '16px',
      alignItems: 'start',
    },

    panel: {
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: DASHBOARD_LAYOUT.cardRadius,
      boxShadow: theme.shadow,
      overflow: 'hidden',
    },

    panelHeader: {
      padding: '18px 20px',
      borderBottom: `1px solid ${theme.cardBorder}`,
      display: 'grid',
      gap: '7px',
    },

    panelTitle: {
      margin: 0,
      color: theme.cardText,
      fontSize: '18px',
      lineHeight: 1.1,
      fontWeight: 900,
      letterSpacing: '-0.03em',
    },

    panelText: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.45,
      fontWeight: 600,
    },

    panelBody: {
      padding: '20px',
      display: 'grid',
      gap: '16px',
    },

    backupList: {
      display: 'grid',
      gap: '10px',
    },

    backupButton(active = false) {
      return {
        width: '100%',
        borderRadius: '16px',
        border: active
          ? `1px solid ${theme.primaryBorder}`
          : `1px solid ${theme.cardBorder}`,
        background: active ? theme.primarySoft : theme.softBg,
        color: active ? '#bfdbfe' : theme.cardText,
        padding: '14px',
        cursor: 'pointer',
        display: 'grid',
        gap: '6px',
        textAlign: 'left',
        transition:
          'background 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
      };
    },

    backupTitle: {
      fontWeight: 900,
      fontSize: '15px',
      color: theme.cardText,
    },

    backupMeta: {
      fontSize: '12px',
      color: theme.mutedText,
      fontWeight: 700,
      lineHeight: 1.35,
    },

    summaryRow: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: '12px',
      padding: '12px 0',
      borderBottom: `1px solid ${theme.cardBorder}`,
      color: theme.cardText,
      fontWeight: 800,
    },

    summaryLabel: {
      color: theme.mutedText,
      fontSize: '13px',
      fontWeight: 800,
    },

    statGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
    },

    statCard: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'grid',
      gap: '8px',
    },

    statLabel: {
      margin: 0,
      fontSize: '12px',
      lineHeight: 1,
      fontWeight: 900,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      color: theme.mutedText,
    },

    statValue: {
      margin: 0,
      color: theme.cardText,
      fontSize: '24px',
      lineHeight: 1,
      fontWeight: 950,
      letterSpacing: '-0.04em',
    },

    actionRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
    },

    warningBox: {
      background: theme.warningSoft,
      border: `1px solid ${theme.warningBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.warningText,
      fontWeight: 700,
      lineHeight: 1.5,
    },

    dangerBox: {
      background: theme.dangerSoft,
      border: `1px solid ${theme.dangerBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.dangerText,
      fontWeight: 700,
      lineHeight: 1.5,
    },

    successBox: {
      background: theme.successSoft,
      border: `1px solid ${theme.successBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.successText,
      fontWeight: 700,
      lineHeight: 1.5,
    },

    emptyPanel: {
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '24px',
      color: theme.mutedText,
      textAlign: 'center',
      display: 'grid',
      gap: '8px',
    },

    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
  };
}

export function createRestoreModalStyles(theme) {
  return {
    backdrop: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(10px)',
      zIndex: 999,
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
    },

    modal: {
      width: 'min(620px, 100%)',
      maxHeight: '92vh',
      overflow: 'auto',
      background: theme.cardBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '24px',
      padding: '24px',
      boxShadow: theme.shadow,
      display: 'grid',
      gap: '18px',
    },

    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
    },

    title: {
      margin: 0,
      color: theme.cardText,
      fontSize: '24px',
      lineHeight: 1.05,
      fontWeight: 950,
      letterSpacing: '-0.04em',
    },

    text: {
      margin: 0,
      color: theme.mutedText,
      fontSize: '14px',
      lineHeight: 1.5,
      fontWeight: 600,
    },

    closeButton: {
      border: `1px solid ${theme.cardBorder}`,
      background: theme.softBg,
      color: theme.cardText,
      borderRadius: '12px',
      width: '38px',
      height: '38px',
      cursor: 'pointer',
      fontWeight: 900,
    },

    dangerBox: {
      background: theme.dangerSoft,
      border: `1px solid ${theme.dangerBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.dangerText,
      fontWeight: 700,
      lineHeight: 1.5,
    },

    sectionTitle: {
      margin: '0 0 8px',
      color: theme.cardText,
      fontSize: '16px',
      fontWeight: 900,
    },

    miniGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: '10px 16px',
      background: theme.softBg,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.cardText,
      fontWeight: 700,
    },

    cleanupToggle: {
      display: 'flex',
      gap: '12px',
      background: theme.warningSoft,
      border: `1px solid ${theme.warningBorder}`,
      borderRadius: '16px',
      padding: '14px',
      color: theme.warningText,
      lineHeight: 1.45,
      cursor: 'pointer',
    },

    smallText: {
      display: 'block',
      marginTop: '4px',
      color: theme.mutedText,
      fontSize: '12px',
      lineHeight: 1.4,
      fontWeight: 600,
    },

    label: {
      display: 'block',
      marginBottom: '8px',
      color: theme.cardText,
      fontWeight: 800,
    },

    input: {
      width: '100%',
      padding: '12px 14px',
      borderRadius: '14px',
      border: `1px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.inputText,
      outline: 'none',
      boxSizing: 'border-box',
      fontWeight: 800,
    },

    actionRow: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      flexWrap: 'wrap',
    },

    button(tone = 'primary', disabled = false) {
      return makeButton(theme, tone, disabled);
    },
  };
}
