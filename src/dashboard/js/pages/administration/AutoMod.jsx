import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import { joinGuildRoom, listenForGuildUpdate } from '../../services/socketClient';
import PageShell, {
  LoadingPanel,
  Notice,
  PrimaryButton,
  SectionCard,
  StatGrid,
  SummaryStat,
} from '../../shared/PageShell';
import { PAGE_LAYOUTS } from '../../ui/layout';
import { createAutoModPageStyles } from '../../ui/components';

const PAGE_KEY = 'automod';
const RULE_KEYS = ['antiSpam', 'antiLinks'];
const PUNISHMENT_OPTIONS = [
  ['delete', 'Delete message'],
  ['warn', 'Warn user'],
  ['dm', 'Warn user by DM'],
  ['timeout', 'Timeout user'],
  ['kick', 'Kick user'],
  ['ban', 'Ban user'],
];

const DEFAULT_FORM = Object.freeze({
  enabled: false,
  dmUser: true,
  dmMessages: {
    antiSpam: '⚠️ **{server} AutoMod**\nSpam Protection triggered: {reason}',
    antiLinks: '⚠️ **{server} AutoMod**\nLink Protection triggered: {reason}',
  },
  antiSpam: {
    enabled: false,
    maxMessages: 5,
    intervalSeconds: 10,
    actions: ['delete'],
  },
  antiLinks: {
    enabled: false,
    allowStaff: true,
    allowedDomains: '',
    deniedDomains: '',
    actions: ['delete'],
  },
  ignoredRoles: '',
  ignoredChannels: '',
});

function createDefaultForm() {
  return {
    ...DEFAULT_FORM,
    dmMessages: { ...DEFAULT_FORM.dmMessages },
    antiSpam: { ...DEFAULT_FORM.antiSpam, actions: [...DEFAULT_FORM.antiSpam.actions] },
    antiLinks: { ...DEFAULT_FORM.antiLinks, actions: [...DEFAULT_FORM.antiLinks.actions] },
  };
}

function normalizeActions(value) {
  const values = Array.isArray(value) ? value : value ? [value] : ['delete'];
  const cleaned = values
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => PUNISHMENT_OPTIONS.some(([option]) => option === item));

  if (cleaned.includes('ban')) {
    return [...new Set(cleaned.filter((item) => item !== 'kick'))];
  }

  return cleaned.length ? [...new Set(cleaned)] : ['delete'];
}

function listText(value) {
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function normalizeAutoModForm(data = {}) {
  return {
    enabled: data?.enabled === true,
    dmUser: data?.dmUser !== false,
    dmMessages: {
      antiSpam: String(data?.dmMessages?.antiSpam || DEFAULT_FORM.dmMessages.antiSpam),
      antiLinks: String(data?.dmMessages?.antiLinks || DEFAULT_FORM.dmMessages.antiLinks),
    },
    antiSpam: {
      enabled: data?.antiSpam?.enabled === true,
      maxMessages: Number(data?.antiSpam?.maxMessages ?? DEFAULT_FORM.antiSpam.maxMessages),
      intervalSeconds: Number(data?.antiSpam?.intervalSeconds ?? DEFAULT_FORM.antiSpam.intervalSeconds),
      actions: normalizeActions(data?.antiSpam?.actions || data?.antiSpam?.action),
    },
    antiLinks: {
      enabled: data?.antiLinks?.enabled === true,
      allowStaff: data?.antiLinks?.allowStaff !== false,
      allowedDomains: listText(data?.antiLinks?.allowedDomains),
      deniedDomains: listText(data?.antiLinks?.deniedDomains),
      actions: normalizeActions(data?.antiLinks?.actions || data?.antiLinks?.action),
    },
    ignoredRoles: listText(data?.ignoredRoles),
    ignoredChannels: listText(data?.ignoredChannels),
  };
}

function parseList(value, domainMode = false) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .map((item) => (
      domainMode
        ? item.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
        : item
    ))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        border: checked ? '1px solid rgba(34,197,94,.45)' : '1px solid rgba(239,68,68,.45)',
        background: checked ? 'rgba(34,197,94,.14)' : 'rgba(239,68,68,.14)',
        color: checked ? '#86efac' : '#fca5a5',
        borderRadius: 999,
        padding: '8px 12px',
        fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {checked ? 'Enabled' : 'Disabled'}
    </button>
  );
}

function Field({ label, value, onChange, type = 'text', min, max, styles }) {
  return (
    <label style={{ display: 'grid', gap: 7 }}>
      <span style={styles.label}>{label}</span>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, styles, rows = 3 }) {
  return (
    <label style={{ display: 'grid', gap: 7 }}>
      <span style={styles.label}>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={styles.textarea}
      />
    </label>
  );
}

function Punishments({ value, onChange, styles }) {
  const selected = normalizeActions(value);

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {PUNISHMENT_OPTIONS.map(([optionValue, label]) => {
        const active = selected.includes(optionValue);

        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => {
              let next = active
                ? selected.filter((item) => item !== optionValue)
                : [...selected, optionValue];

              if (optionValue === 'ban' && !active) next = next.filter((item) => item !== 'kick');
              if (optionValue === 'kick' && !active) next = next.filter((item) => item !== 'ban');
              onChange(next.length ? next : ['delete']);
            }}
            style={{
              ...styles.input,
              width: 'auto',
              cursor: 'pointer',
              background: active ? 'rgba(59,130,246,.16)' : styles.input.background,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function RuleCard({
  title,
  description,
  enabled,
  onEnabledChange,
  actions,
  onActionsChange,
  children,
  theme,
  styles,
}) {
  return (
    <div
      style={{
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 16,
        padding: 16,
        display: 'grid',
        gap: 14,
        background: theme.softBg,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: theme.cardText, fontSize: 16 }}>{title}</h3>
          <p style={{ margin: '5px 0 0', color: theme.mutedText, fontSize: 13 }}>{description}</p>
        </div>
        <Toggle checked={enabled} onChange={onEnabledChange} />
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <span style={styles.label}>Actions</span>
        <Punishments value={actions} onChange={onActionsChange} styles={styles} />
      </div>

      {children}
    </div>
  );
}

export default function AutoMod({ selectedGuild, theme }) {
  const styles = useMemo(() => createAutoModPageStyles(theme), [theme]);
  const page = PAGE_LAYOUTS[PAGE_KEY] || {
    title: 'AutoMod',
    description: 'Configure automated moderation rules.',
  };

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [form, setForm] = useState(createDefaultForm);

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!selectedGuild) {
        if (mounted) {
          setForm(createDefaultForm());
          setError('');
          setSaveMessage('');
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        setError('');
        setSaveMessage('');
        const data = await api.getAutoModConfig(selectedGuild);
        if (mounted) setForm(normalizeAutoModForm(data));
      } catch (loadError) {
        console.error(loadError);
        if (mounted) {
          setForm(createDefaultForm());
          setError('Could not load AutoMod config.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [selectedGuild]);

  useEffect(() => {
    if (!selectedGuild) return undefined;

    joinGuildRoom(selectedGuild);
    return listenForGuildUpdate('automod', (data, payload = {}) => {
      setForm(normalizeAutoModForm(data));
      setSaveMessage(
        payload.source === 'dashboard'
          ? '✅ AutoMod synced live.'
          : '🔄 AutoMod updated live.'
      );
    });
  }, [selectedGuild]);

  const updateSection = useCallback((section, field, value) => {
    setForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }));
  }, []);

  const enabledCount = RULE_KEYS.filter((key) => form[key]?.enabled).length;

  const handleSave = useCallback(async () => {
    if (!selectedGuild) {
      setSaveMessage('❌ Select a guild first.');
      return;
    }

    try {
      setSaving(true);
      setSaveMessage('');
      setError('');

      const payload = {
        enabled: form.enabled,
        dmUser: form.dmUser,
        dmMessages: {
          antiSpam: form.dmMessages.antiSpam,
          antiLinks: form.dmMessages.antiLinks,
        },
        antiSpam: {
          enabled: form.antiSpam.enabled,
          maxMessages: Number(form.antiSpam.maxMessages),
          intervalSeconds: Number(form.antiSpam.intervalSeconds),
          actions: normalizeActions(form.antiSpam.actions),
        },
        antiLinks: {
          enabled: form.antiLinks.enabled,
          allowStaff: form.antiLinks.allowStaff,
          allowedDomains: parseList(form.antiLinks.allowedDomains, true),
          deniedDomains: parseList(form.antiLinks.deniedDomains, true),
          actions: normalizeActions(form.antiLinks.actions),
        },
        ignoredRoles: parseList(form.ignoredRoles),
        ignoredChannels: parseList(form.ignoredChannels),
      };

      const saved = await api.saveAutoModConfig(selectedGuild, payload);
      if (saved?.config) setForm(normalizeAutoModForm(saved.config));
      setSaveMessage('✅ AutoMod config saved successfully.');
    } catch (saveError) {
      console.error(saveError);
      setSaveMessage('❌ Failed to save AutoMod config.');
    } finally {
      setSaving(false);
    }
  }, [form, selectedGuild]);

  return (
    <PageShell
      title={page.title || 'AutoMod'}
      subtitle={page.description || 'Configure automated moderation rules.'}
      theme={theme}
    >
      {!selectedGuild ? (
        <Notice theme={theme} tone="info">Select a guild to edit AutoMod settings.</Notice>
      ) : null}
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {saveMessage ? (
        <Notice theme={theme} tone={saveMessage.startsWith('❌') ? 'danger' : 'success'}>
          {saveMessage}
        </Notice>
      ) : null}

      <StatGrid>
        <SummaryStat
          theme={theme}
          label="Module"
          value={form.enabled ? 'Enabled' : 'Disabled'}
          accent={form.enabled ? theme.success : theme.danger}
        />
        <SummaryStat theme={theme} label="Enabled Rules" value={`${enabledCount}/2`} />
        <SummaryStat
          theme={theme}
          label="User DMs"
          value={form.dmUser ? 'Enabled' : 'Disabled'}
          accent={form.dmUser ? theme.success : theme.danger}
        />
      </StatGrid>

      <SectionCard
        theme={theme}
        title="Module Settings"
        subtitle="Control whether AutoMod runs and whether members receive direct-message notices."
        padding="20px"
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 7 }}>
            <span style={styles.label}>AutoMod Module</span>
            <Toggle
              checked={form.enabled}
              onChange={(value) => setForm((current) => ({ ...current, enabled: value }))}
            />
          </div>
          <div style={{ display: 'grid', gap: 7 }}>
            <span style={styles.label}>DM User</span>
            <Toggle
              checked={form.dmUser}
              onChange={(value) => setForm((current) => ({ ...current, dmUser: value }))}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard theme={theme} title="Rules" subtitle="Manage the AutoMod rules enforced by the live message runtime." padding="20px">
        {loading ? (
          <LoadingPanel theme={theme} text="Loading AutoMod config..." />
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <RuleCard
              title="Anti Spam"
              description="Stops users sending too many messages too quickly."
              enabled={form.antiSpam.enabled}
              onEnabledChange={(value) => updateSection('antiSpam', 'enabled', value)}
              actions={form.antiSpam.actions}
              onActionsChange={(value) => updateSection('antiSpam', 'actions', value)}
              theme={theme}
              styles={styles}
            >
              <div style={styles.ruleMiniGrid}>
                <Field
                  styles={styles}
                  label="Max Messages"
                  type="number"
                  min="2"
                  max="100"
                  value={form.antiSpam.maxMessages}
                  onChange={(value) => updateSection('antiSpam', 'maxMessages', value)}
                />
                <Field
                  styles={styles}
                  label="Interval Seconds"
                  type="number"
                  min="1"
                  max="3600"
                  value={form.antiSpam.intervalSeconds}
                  onChange={(value) => updateSection('antiSpam', 'intervalSeconds', value)}
                />
              </div>
              <TextArea
                styles={styles}
                label="DM Message"
                value={form.dmMessages.antiSpam}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  dmMessages: { ...current.dmMessages, antiSpam: value },
                }))}
                placeholder="Spam Protection triggered: {reason}"
              />
            </RuleCard>

            <RuleCard
              title="Anti Links"
              description="Controls posted links using allowed and denied domain lists."
              enabled={form.antiLinks.enabled}
              onEnabledChange={(value) => updateSection('antiLinks', 'enabled', value)}
              actions={form.antiLinks.actions}
              onActionsChange={(value) => updateSection('antiLinks', 'actions', value)}
              theme={theme}
              styles={styles}
            >
              <div style={{ display: 'grid', gap: 7, justifyItems: 'start' }}>
                <span style={styles.label}>Allow Management / Moderators</span>
                <Toggle
                  checked={form.antiLinks.allowStaff}
                  onChange={(value) => updateSection('antiLinks', 'allowStaff', value)}
                />
              </div>
              <TextArea
                styles={styles}
                label="Allowed Domains"
                value={form.antiLinks.allowedDomains}
                onChange={(value) => updateSection('antiLinks', 'allowedDomains', value)}
                placeholder="youtube.com, youtu.be"
              />
              <TextArea
                styles={styles}
                label="Denied Domains"
                value={form.antiLinks.deniedDomains}
                onChange={(value) => updateSection('antiLinks', 'deniedDomains', value)}
                placeholder="scam-site.example"
              />
              <TextArea
                styles={styles}
                label="DM Message"
                value={form.dmMessages.antiLinks}
                onChange={(value) => setForm((current) => ({
                  ...current,
                  dmMessages: { ...current.dmMessages, antiLinks: value },
                }))}
                placeholder="Link Protection triggered: {reason}"
              />
            </RuleCard>
          </div>
        )}
      </SectionCard>

      <SectionCard
        theme={theme}
        title="Ignored Discord IDs"
        subtitle="Comma-separated role and channel IDs that AutoMod should ignore."
        padding="20px"
      >
        <div style={styles.ruleMiniGrid}>
          <TextArea
            styles={styles}
            label="Ignored Role IDs"
            value={form.ignoredRoles}
            onChange={(value) => setForm((current) => ({ ...current, ignoredRoles: value }))}
            placeholder="123456789012345678, 234567890123456789"
          />
          <TextArea
            styles={styles}
            label="Ignored Channel IDs"
            value={form.ignoredChannels}
            onChange={(value) => setForm((current) => ({ ...current, ignoredChannels: value }))}
            placeholder="123456789012345678, 234567890123456789"
          />
        </div>
      </SectionCard>

      <div style={styles.saveRow}>
        <PrimaryButton onClick={handleSave} disabled={!selectedGuild || saving || loading}>
          {saving ? 'Saving...' : 'Save AutoMod Settings'}
        </PrimaryButton>
      </div>
    </PageShell>
  );
}
