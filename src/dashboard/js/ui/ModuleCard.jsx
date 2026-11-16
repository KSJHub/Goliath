import { DASHBOARD_EMOJIS as E } from '../shared/PageShell.jsx';
import React, { memo, useState } from 'react';

import { getModuleStatusMeta } from '../shared/moduleRegistry.js';

const STATUS_STYLES = {
  success: { border: '#34d39966', bg: 'rgba(34,197,94,0.10)', text: '#86efac', glow: '#34d39922' },
  info: { border: '#38bdf866', bg: 'rgba(14,165,233,0.10)', text: '#7dd3fc', glow: '#38bdf822' },
  warning: { border: '#facc1566', bg: 'rgba(250,204,21,0.10)', text: '#fde68a', glow: '#facc1522' },
  muted: { border: '#64748b55', bg: 'rgba(100,116,139,0.10)', text: '#cbd5e1', glow: '#64748b22' },
};

function ModuleToggle({ enabled, disabled, onToggle }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.(!enabled);
      }}
      aria-pressed={enabled}
      style={{
        width: 48,
        height: 26,
        borderRadius: 999,
        border: `1px solid ${enabled ? '#34d39988' : '#64748b66'}`,
        background: enabled ? 'rgba(34,197,94,0.28)' : 'rgba(100,116,139,0.20)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        padding: 3,
        opacity: disabled ? 0.55 : 1,
        flex: '0 0 auto',
      }}
      title={enabled ? 'Disable module' : 'Enable module'}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: enabled ? 25 : 3,
          width: 18,
          height: 18,
          borderRadius: 999,
          background: enabled ? '#86efac' : '#cbd5e1',
          transition: 'left 0.18s ease',
          boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
        }}
      />
    </button>
  );
}

function ModuleCard({ module, theme, onOpen, onToggle, saving }) {
  const [hovered, setHovered] = useState(false);
  const enabled = module?.enabled === true;
  const locked = module?.locked === true;
  const statusMeta = getModuleStatusMeta(module?.status);
  const statusStyle = locked ? STATUS_STYLES.warning : STATUS_STYLES[statusMeta.tone] || STATUS_STYLES.muted;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${locked ? '#facc1566' : enabled ? statusStyle.border : theme.cardBorder}`,
        background: locked
          ? 'linear-gradient(135deg, rgba(250,204,21,0.10), rgba(15,23,42,0.58))'
          : enabled
            ? 'linear-gradient(135deg, rgba(15,23,42,0.78), rgba(15,23,42,0.34))'
            : theme.cardBg,
        color: theme.cardText,
        borderRadius: 22,
        boxShadow: hovered ? '0 22px 60px rgba(0,0,0,0.32)' : theme.shadow,
        padding: 18,
        minHeight: 172,
        textAlign: 'left',
        display: 'grid',
        gap: 16,
        alignContent: 'space-between',
        opacity: locked ? 0.92 : enabled ? 1 : 0.84,
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, opacity 0.18s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      aria-label={`${module.name} module`}
    >
      <span
        style={{
          position: 'absolute',
          right: -34,
          bottom: -42,
          width: 118,
          height: 118,
          borderRadius: 999,
          background: locked ? '#facc1522' : enabled ? statusStyle.glow : '#64748b18',
          filter: 'blur(4px)',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 15,
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${locked ? '#facc1566' : enabled ? statusStyle.border : '#64748b55'}`,
            background: locked ? 'rgba(250,204,21,0.12)' : enabled ? statusStyle.bg : 'rgba(100,116,139,0.10)',
            color: locked ? '#fde68a' : enabled ? statusStyle.text : theme.mutedText,
            fontWeight: 950,
            fontSize: 13,
          }}
        >
          {locked ? E.LOCK : module.icon}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {enabled && !locked ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen?.(module);
              }}
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                border: `1px solid ${statusStyle.border}`,
                background: statusStyle.bg,
                color: statusStyle.text,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 950,
                display: 'grid',
                placeItems: 'center',
                lineHeight: 1,
              }}
              title={`Configure ${module.name}`}
              aria-label={`Configure ${module.name}`}
            >
              {E.SETTINGS_PLAIN}
            </button>
          ) : null}

          <ModuleToggle enabled={enabled} disabled={saving || locked} onToggle={(nextEnabled) => onToggle?.(module, nextEnabled)} />
        </div>
      </div>

      <div style={{ position: 'relative', display: 'grid', gap: 8 }}>
        <div>
          <strong style={{ display: 'block', fontSize: 17 }}>{module.name}</strong>
          <span style={{ display: 'block', color: locked ? '#fde68a' : theme.mutedText, fontSize: 12, fontWeight: 850, marginTop: 5 }}>
            {locked ? `Requires ${String(module.requiredPlan || 'pro').toUpperCase()}` : module.category}
          </span>
        </div>

        <p style={{ margin: 0, color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>
          {locked ? `Unlock ${module.name} from Billing to use ${module.requiredFeature}.` : module.summary || 'Module dashboard page pending.'}
        </p>

        {saving ? (
          <span style={{ color: statusStyle.text, fontSize: 12, fontWeight: 950 }}>
            Saving...
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default memo(ModuleCard);
