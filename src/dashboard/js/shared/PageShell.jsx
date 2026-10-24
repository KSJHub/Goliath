import React, { memo } from 'react';

/**
 * Shared dashboard page shell + reusable UI system.
 * Keeps page titles readable while still showing selected guild context.
 */
function PageShell({
  title,
  subtitle,
  theme,
  children,
  actions = null,
  guild = null,
}) {
  const guildIcon = guild?.iconUrl || guild?.iconURL || guild?.avatarUrl || guild?.image || null;
  const guildName = guild?.name || guild?.guildName || '';
  const guildId = guild?.id || guild?.guildId || '';

  return (
    <div
      style={{
        display: 'grid',
        gap: 'clamp(16px, 2vw, 24px)',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        overflowX: 'hidden',
      }}
    >
      <header
        style={{
          position: 'relative',
          overflow: 'hidden',
          background:
            'linear-gradient(135deg, rgba(17,24,39,0.98) 0%, rgba(9,18,40,0.98) 45%, rgba(15,23,42,0.98) 100%)',
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: 'clamp(18px, 2vw, 24px)',
          padding: 'clamp(18px, 3vw, 26px)',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'clamp(16px, 2vw, 24px)',
          flexWrap: 'wrap',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: 10,
            minWidth: 0,
            flex: '1 1 360px',
            zIndex: 2,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(28px, 5vw, 46px)',
              lineHeight: 1.05,
              fontWeight: 950,
              letterSpacing: '-0.045em',
              textTransform: 'uppercase',
              color: '#ffffff',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {title}
          </h1>

          {guildName || guildId ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              {guildName ? (
                <span
                  style={{
                    color: '#dbeafe',
                    fontSize: 13,
                    fontWeight: 850,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {guildName}
                </span>
              ) : null}

              {guildName && guildId ? (
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.25)',
                  }}
                />
              ) : null}

              {guildId ? (
                <span
                  style={{
                    color: theme.mutedText,
                    fontSize: 13,
                    fontWeight: 700,
                    overflowWrap: 'anywhere',
                  }}
                >
                  Guild ID: {guildId}
                </span>
              ) : null}
            </div>
          ) : null}

          {subtitle ? (
            <p
              style={{
                margin: 0,
                color: theme.mutedText,
                fontSize: 14,
                lineHeight: 1.65,
                maxWidth: 900,
                overflowWrap: 'break-word',
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 14,
            flexWrap: 'wrap',
            zIndex: 2,
            minWidth: 0,
          }}
        >
          {actions ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 10,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              {actions}
            </div>
          ) : null}

          {guildIcon ? (
            <img
              src={guildIcon}
              alt={guildName || title}
              style={{
                width: 'clamp(54px, 10vw, 76px)',
                height: 'clamp(54px, 10vw, 76px)',
                borderRadius: 'clamp(14px, 2vw, 20px)',
                objectFit: 'cover',
                border: `1px solid ${theme.cardBorder}`,
                boxShadow:
                  '0 10px 40px rgba(0,0,0,0.45), 0 0 30px rgba(59,130,246,0.08)',
                background: '#0b1120',
                flex: '0 0 auto',
              }}
            />
          ) : null}
        </div>

        <div
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-120px',
            width: 320,
            height: 320,
            background: 'rgba(37,99,235,0.12)',
            filter: 'blur(80px)',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
      </header>

      <div
        style={{
          display: 'grid',
          gap: 'clamp(16px, 2vw, 24px)',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const SectionCard = memo(function SectionCard({
  theme,
  themed = false,
  title,
  subtitle,
  actions = null,
  padding = 'clamp(16px, 2vw, 20px)',
  minHeight = null,
  children,
}) {
  return (
    <section
      style={{
        background: themed ? theme.cardBgSolid || theme.cardBg : 'linear-gradient(180deg, rgba(8,15,30,0.98), rgba(6,12,24,0.98))',
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 22,
        padding,
        minHeight,
        boxShadow:
          themed ? theme.softShadow : '0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.03)',
        display: 'grid',
        gap: 16,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {(title || subtitle || actions) ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'grid', gap: 6, minWidth: 0, flex: '1 1 240px' }}>
            {title ? (
              <h2
                style={{
                  margin: 0,
                  fontSize: 'clamp(18px, 2vw, 20px)',
                  fontWeight: themed ? 650 : 900,
                  letterSpacing: '-0.03em',
                  color: themed ? theme.cardText : '#ffffff',
                  overflowWrap: 'break-word',
                }}
              >
                {title}
              </h2>
            ) : null}

            {subtitle ? (
              <p
                style={{
                  margin: 0,
                  color: theme.mutedText,
                  fontSize: 14,
                  lineHeight: 1.6,
                  overflowWrap: 'break-word',
                }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          {actions ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                minWidth: 0,
              }}
            >
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}

      {children}
    </section>
  );
});

export const StatGrid = memo(function StatGrid({ children, min = 'min(220px, 100%)' }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))`,
        gap: 16,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
});

export const SummaryStat = memo(function SummaryStat({
  theme,
  label,
  value,
  description = null,
  accent = null,
  minHeight = '118px',
}) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(10,18,35,0.96), rgba(6,12,24,0.98))',
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 18,
        padding: 'clamp(14px, 2vw, 18px)',
        minHeight,
        display: 'grid',
        gap: 9,
        alignContent: 'space-between',
        boxShadow: '0 10px 30px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.02)',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          color: theme.mutedText,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          overflowWrap: 'break-word',
        }}
      >
        {label}
      </div>

      <div
        style={{
          color: accent || '#ffffff',
          fontWeight: 900,
          fontSize: 'clamp(26px, 5vw, 36px)',
          lineHeight: 1,
          letterSpacing: '-0.04em',
          textTransform: typeof value === 'string' ? 'capitalize' : 'none',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>

      {description ? (
        <div
          style={{
            color: theme.mutedText,
            fontSize: 14,
            lineHeight: 1.45,
            overflowWrap: 'break-word',
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
});

export const EmptyState = memo(function EmptyState({ theme, text, title = 'Nothing here yet' }) {
  return (
    <div
      style={{
        background: theme.cardBg,
        border: `1px dashed ${theme.cardBorder}`,
        borderRadius: 18,
        padding: 'clamp(16px, 2vw, 22px)',
        color: theme.mutedText,
        textAlign: 'center',
        boxShadow: theme.shadow,
        display: 'grid',
        gap: 6,
        minWidth: 0,
        overflowWrap: 'break-word',
      }}
    >
      <strong style={{ color: theme.cardText }}>{title}</strong>
      <span>{text}</span>
    </div>
  );
});

export const LoadingPanel = memo(function LoadingPanel({ theme, text = 'Loading...' }) {
  return (
    <div
      style={{
        background: theme.softBg,
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 14,
        padding: 16,
        color: theme.mutedText,
        fontWeight: 700,
        minWidth: 0,
        overflowWrap: 'break-word',
      }}
    >
      {text}
    </div>
  );
});

export const Notice = memo(function Notice({ theme, tone = 'info', children }) {
  const tones = {
    info: { bg: theme.softBg, border: theme.cardBorder, text: theme.cardText },
    success: { bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.26)', text: theme.successText || '#86efac' },
    danger: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.28)', text: theme.dangerText || '#fca5a5' },
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.26)', text: theme.warningText || '#fcd34d' },
  };
  const current = tones[tone] || tones.info;

  return (
    <div
      style={{
        background: current.bg,
        border: `1px solid ${current.border}`,
        borderRadius: 14,
        padding: '14px 16px',
        color: current.text,
        fontWeight: 700,
        lineHeight: 1.5,
        minWidth: 0,
        overflowWrap: 'break-word',
      }}
    >
      {children}
    </div>
  );
});

export const DetailGrid = memo(function DetailGrid({ children, min = 'min(180px, 100%)' }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))`,
        gap: 12,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
});

export const DetailRow = memo(function DetailRow({ theme, label, value }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        padding: '12px 14px',
        borderRadius: 14,
        background: theme.softBg,
        border: `1px solid ${theme.cardBorder}`,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: theme.mutedText,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          overflowWrap: 'break-word',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: theme.cardText, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
});

export const PrimaryButton = memo(function PrimaryButton({ children, onClick, disabled = false, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: '1px solid rgba(59,130,246,0.28)',
        background: disabled ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.16)',
        color: '#ffffff',
        padding: '10px 14px',
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 900,
        opacity: disabled ? 0.7 : 1,
        maxWidth: '100%',
        overflowWrap: 'break-word',
      }}
    >
      {children}
    </button>
  );
});

export const SecondaryButton = memo(function SecondaryButton({ children, onClick, disabled = false, type = 'button', theme }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${theme.cardBorder}`,
        background: theme.softBg,
        color: theme.cardText,
        padding: '10px 14px',
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 900,
        opacity: disabled ? 0.7 : 1,
        maxWidth: '100%',
        overflowWrap: 'break-word',
      }}
    >
      {children}
    </button>
  );
});

export default memo(PageShell);
