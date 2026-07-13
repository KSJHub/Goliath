import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  joinGuildRoom,
  listenForGuildUpdate,
} from "../../services/socketClient"
import { api } from '../../services/apiClient';
import PageShell, {
  LoadingPanel,
  Notice,
  PrimaryButton,
  SectionCard,
  StatGrid,
  SummaryStat,
} from '../../shared/PageShell';
import { PAGE_LAYOUTS } from "../../ui/layout";
import { createAutoModPageStyles } from "../../ui/components";

const PAGE_KEY = 'automod';

const DEFAULT_FORM = {
  antiSpam: {
    enabled: false,
    maxMessages: 6,
    intervalSeconds: 8,
    punishment: ['delete'],
  },
  antiLink: {
    enabled: false,
    punishment: ['delete'],
    allowedDomains: '',
    blockedDomains: '',
  },
  antiInvite: {
    enabled: false,
    punishment: ['delete'],
  },
  capsAbuse: {
    enabled: false,
    minLength: 10,
    percentage: 70,
    punishment: ['delete'],
  },
  badWords: {
    enabled: false,
    words: '',
    punishment: ['delete'],
  },
  repeatedMessages: {
    enabled: false,
    maxRepeats: 3,
    intervalSeconds: 10,
    punishment: ['delete'],
  },
  logs: {
    enabled: true,
    channelId: '',
  },
};

const RULE_KEYS = [
  'antiSpam',
  'antiLink',
  'antiInvite',
  'capsAbuse',
  'badWords',
  'repeatedMessages',
];

const PUNISHMENT_OPTIONS = [
  { value: 'delete', label: 'Delete message' },
  { value: 'warn', label: 'Warn user' },
  { value: 'dm', label: 'Warn user by DM' },
  { value: 'timeout', label: 'Timeout user' },
  { value: 'kick', label: 'Kick user' },
  { value: 'ban', label: 'Ban user' },
];

const PUNISHMENT_PAST_LABELS = {
  delete: 'Message deleted',
  warn: 'User warned',
  dm: 'User warned by DM',
  timeout: 'User timed out',
  kick: 'User kicked',
  ban: 'User banned',
};

function normalizePunishments(value) {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => (item === 'warn-dm' ? 'dm' : item))
      .filter(Boolean);

    return cleaned.length ? [...new Set(cleaned)] : ['delete'];
  }

  if (value === 'warn-dm') return ['dm'];

  return value ? [value] : ['delete'];
}

function getRulePunishments(rule = {}) {
  return normalizePunishments(rule?.punishments || rule?.punishment);
}

function formatPunishments(value) {
  return normalizePunishments(value)
    .map((item) => PUNISHMENT_PAST_LABELS[item] || item)
    .join(' • ');
}

function normalizeAutoModForm(data = {}) {
  return {
    antiSpam: {
      enabled: Boolean(data?.antiSpam?.enabled),
      maxMessages: Number(data?.antiSpam?.maxMessages ?? 6),
      intervalSeconds: Number(data?.antiSpam?.intervalSeconds ?? 8),
      punishment: getRulePunishments(data?.antiSpam),
    },
    antiLink: {
      enabled: Boolean(data?.antiLink?.enabled),
      punishment: getRulePunishments(data?.antiLink),
      allowedDomains: Array.isArray(data?.antiLink?.allowedDomains)
        ? data.antiLink.allowedDomains.join(', ')
        : data?.antiLink?.allowedDomains || '',
      blockedDomains: Array.isArray(data?.antiLink?.blockedDomains)
        ? data.antiLink.blockedDomains.join(', ')
        : data?.antiLink?.blockedDomains || '',
    },
    antiInvite: {
      enabled: Boolean(data?.antiInvite?.enabled),
      punishment: getRulePunishments(data?.antiInvite),
    },
    capsAbuse: {
      enabled: Boolean(data?.capsAbuse?.enabled),
      minLength: Number(data?.capsAbuse?.minLength ?? 10),
      percentage: Number(data?.capsAbuse?.percentage ?? 70),
      punishment: getRulePunishments(data?.capsAbuse),
    },
    badWords: {
      enabled: Boolean(data?.badWords?.enabled),
      words: Array.isArray(data?.badWords?.words)
        ? data.badWords.words.join(', ')
        : data?.badWords?.words || '',
      punishment: getRulePunishments(data?.badWords),
    },
    repeatedMessages: {
      enabled: Boolean(data?.repeatedMessages?.enabled),
      maxRepeats: Number(data?.repeatedMessages?.maxRepeats ?? 3),
      intervalSeconds: Number(data?.repeatedMessages?.intervalSeconds ?? 10),
      punishment: getRulePunishments(data?.repeatedMessages),
    },
    logs: {
      enabled: data?.logs?.enabled !== false,
      channelId: data?.logs?.channelId || '',
    },
  };
}

function buildRulePayload(rule) {
  const punishments = normalizePunishments(rule.punishment);

  return {
    ...rule,
    punishment: punishments[0],
    punishments,
  };
}

function parseDomainList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((domain) =>
      domain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, ''),
    )
    .filter(Boolean)
    .filter((domain, index, list) => list.indexOf(domain) === index);
}

function parseCsvList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

export default function AutoMod({ selectedGuild, theme }) {
  const styles = useMemo(() => createAutoModPageStyles(theme), [theme]);

  const page = PAGE_LAYOUTS[PAGE_KEY] || {
    title: 'AutoMod',
    description: 'Configure automated moderation rules and logging.',
  };

  const [loading, setLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [logChannels, setLogChannels] = useState([]);

  const [openSections, setOpenSections] = useState({
    antiSpam: true,
    antiLink: false,
    antiInvite: false,
    capsAbuse: false,
    badWords: false,
    repeatedMessages: false,
    logs: false,
  });

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      if (!selectedGuild) {
        if (mounted) {
          setForm(DEFAULT_FORM);
          setError('');
          setSaveMessage('');
          setLoading(false);
          setSaving(false);
        }

        return;
      }

      try {
        setLoading(true);
        setError('');
        setSaveMessage('');

        const data = await api.getAutoModConfig(selectedGuild);

        if (!mounted) return;

        setForm(normalizeAutoModForm(data));
      } catch (err) {
        console.error(err);

        if (!mounted) return;

        setForm(DEFAULT_FORM);
        setError('Could not load AutoMod config.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadConfig();

    return () => {
      mounted = false;
    };
  }, [selectedGuild]);

  useEffect(() => {
    let mounted = true;

    async function loadChannels() {
      if (!selectedGuild) {
        if (mounted) {
          setLogChannels([]);
          setChannelsLoading(false);
        }

        return;
      }

      try {
        setChannelsLoading(true);

        const channels = await api.getGuildChannels(selectedGuild);

        if (!mounted) return;

        setLogChannels(Array.isArray(channels) ? channels : []);
      } catch (err) {
        console.error(err);

        if (!mounted) return;

        setLogChannels([]);
      } finally {
        if (mounted) setChannelsLoading(false);
      }
    }

    loadChannels();

    return () => {
      mounted = false;
    };
  }, [selectedGuild]);

    useEffect(() => {
  if (!selectedGuild) return undefined;

  joinGuildRoom(selectedGuild);

  return listenForGuildUpdate(selectedGuild, 'automod', (data, payload) => {
    setForm(normalizeAutoModForm(data));

    setSaveMessage(
      payload.source === 'dashboard'
        ? '✅ AutoMod synced live.'
        : '🔄 AutoMod updated live.',
    );
  });
}, [selectedGuild]);

  const handleToggle = useCallback((section, field = 'enabled') => {
    setForm((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: !prev[section][field],
      },
    }));
  }, []);

  const handleChange = useCallback((section, field, value) => {
    setForm((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  }, []);

  const toggleSectionOpen = useCallback((section) => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const enabledCount = useMemo(
    () => RULE_KEYS.filter((key) => form[key]?.enabled).length,
    [form],
  );

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
        antiSpam: buildRulePayload({
          enabled: form.antiSpam.enabled,
          maxMessages: Number(form.antiSpam.maxMessages),
          intervalSeconds: Number(form.antiSpam.intervalSeconds),
          punishment: form.antiSpam.punishment,
        }),
        antiLink: buildRulePayload({
          enabled: form.antiLink.enabled,
          punishment: form.antiLink.punishment,
          allowedDomains: parseDomainList(form.antiLink.allowedDomains),
          blockedDomains: parseDomainList(form.antiLink.blockedDomains),
        }),
        antiInvite: buildRulePayload({
          enabled: form.antiInvite.enabled,
          punishment: form.antiInvite.punishment,
        }),
        capsAbuse: buildRulePayload({
          enabled: form.capsAbuse.enabled,
          minLength: Number(form.capsAbuse.minLength),
          percentage: Number(form.capsAbuse.percentage),
          punishment: form.capsAbuse.punishment,
        }),
        badWords: buildRulePayload({
          enabled: form.badWords.enabled,
          words: parseCsvList(form.badWords.words),
          punishment: form.badWords.punishment,
        }),
        repeatedMessages: buildRulePayload({
          enabled: form.repeatedMessages.enabled,
          maxRepeats: Number(form.repeatedMessages.maxRepeats),
          intervalSeconds: Number(form.repeatedMessages.intervalSeconds),
          punishment: form.repeatedMessages.punishment,
        }),
        logs: {
          enabled: form.logs.enabled,
          channelId: form.logs.channelId || '',
        },
      };

      const saved = await api.saveAutoModConfig(selectedGuild, payload);

      if (saved?.config) {
        setForm(normalizeAutoModForm(saved.config));
      }

      setSaveMessage('✅ AutoMod config saved successfully.');
    } catch (err) {
      console.error(err);
      setSaveMessage('❌ Failed to save AutoMod config.');
    } finally {
      setSaving(false);
    }
  }, [selectedGuild, form]);

  return (
    <PageShell
      title={page.title || 'AutoMod'}
      subtitle={page.description || 'Configure automated moderation rules and logging.'}
      theme={theme}
    >
      {!selectedGuild ? (
        <Notice theme={theme} tone="info">
          Select a guild to edit AutoMod settings.
        </Notice>
      ) : null}

      {error ? (
        <Notice theme={theme} tone="danger">
          {error}
        </Notice>
      ) : null}

      {saveMessage ? (
        <Notice theme={theme} tone={saveMessage.startsWith('❌') ? 'danger' : 'success'}>
          {saveMessage}
        </Notice>
      ) : null}

      <StatGrid>
        <SummaryStat theme={theme} label="Enabled Rules" value={`${enabledCount}/6`} />

        <SummaryStat
          theme={theme}
          label="Default Action"
          value={formatPunishments(form.antiSpam.punishment)}
        />

        <SummaryStat
          theme={theme}
          label="Logging"
          value={form.logs.enabled ? 'Enabled' : 'Disabled'}
          accent={form.logs.enabled ? theme.success : theme.danger}
        />
      </StatGrid>

      <SectionCard
        theme={theme}
        title="Rules"
        subtitle="Manage core AutoMod rules."
        padding="20px"
      >
        {loading ? (
          <LoadingPanel theme={theme} text="Loading AutoMod config..." />
        ) : (
          <div style={styles.ruleList}>
            <RuleCard
              styles={styles}
              title="Anti Spam"
              description="Stops users sending too many messages too quickly."
              checked={form.antiSpam.enabled}
              open={openSections.antiSpam}
              onToggle={() => handleToggle('antiSpam')}
              onOpenToggle={() => toggleSectionOpen('antiSpam')}
              punishment={form.antiSpam.punishment}
              onPunishmentChange={(value) => handleChange('antiSpam', 'punishment', value)}
            >
              <div style={styles.ruleMiniGrid}>
                <Field
                  styles={styles}
                  label="Max Messages"
                  type="number"
                  min="1"
                  value={form.antiSpam.maxMessages}
                  onChange={(value) => handleChange('antiSpam', 'maxMessages', value)}
                />

                <Field
                  styles={styles}
                  label="Interval Seconds"
                  type="number"
                  min="1"
                  value={form.antiSpam.intervalSeconds}
                  onChange={(value) => handleChange('antiSpam', 'intervalSeconds', value)}
                />
              </div>
            </RuleCard>

            <RuleCard
              styles={styles}
              title="Anti Link"
              description="Controls posted links with whitelist and blacklist checks."
              checked={form.antiLink.enabled}
              open={openSections.antiLink}
              onToggle={() => handleToggle('antiLink')}
              onOpenToggle={() => toggleSectionOpen('antiLink')}
              punishment={form.antiLink.punishment}
              onPunishmentChange={(value) => handleChange('antiLink', 'punishment', value)}
            >
              <div style={styles.sectionList}>
                <TextAreaField
                  styles={styles}
                  label="Allowed Domains / Whitelist"
                  value={form.antiLink.allowedDomains}
                  onChange={(value) => handleChange('antiLink', 'allowedDomains', value)}
                  placeholder="youtube.com, youtu.be, discord.gg"
                  help="Links matching these domains will be allowed. Separate domains with commas or new lines."
                />

                <TextAreaField
                  styles={styles}
                  label="Blocked Domains / Blacklist"
                  value={form.antiLink.blockedDomains}
                  onChange={(value) => handleChange('antiLink', 'blockedDomains', value)}
                  placeholder="scam-site.ru, badlink.xyz"
                  help="These domains are force-blocked before whitelist checks."
                />
              </div>
            </RuleCard>

            <RuleCard
              styles={styles}
              title="Anti Invite"
              description="Blocks Discord invite links from being posted."
              checked={form.antiInvite.enabled}
              open={openSections.antiInvite}
              onToggle={() => handleToggle('antiInvite')}
              onOpenToggle={() => toggleSectionOpen('antiInvite')}
              punishment={form.antiInvite.punishment}
              onPunishmentChange={(value) => handleChange('antiInvite', 'punishment', value)}
            />

            <RuleCard
              styles={styles}
              title="Caps Abuse"
              description="Detects messages with excessive capital letters."
              checked={form.capsAbuse.enabled}
              open={openSections.capsAbuse}
              onToggle={() => handleToggle('capsAbuse')}
              onOpenToggle={() => toggleSectionOpen('capsAbuse')}
              punishment={form.capsAbuse.punishment}
              onPunishmentChange={(value) => handleChange('capsAbuse', 'punishment', value)}
            >
              <div style={styles.ruleMiniGrid}>
                <Field
                  styles={styles}
                  label="Minimum Length"
                  type="number"
                  min="1"
                  value={form.capsAbuse.minLength}
                  onChange={(value) => handleChange('capsAbuse', 'minLength', value)}
                />

                <Field
                  styles={styles}
                  label="Caps Percentage"
                  type="number"
                  min="1"
                  max="100"
                  value={form.capsAbuse.percentage}
                  onChange={(value) => handleChange('capsAbuse', 'percentage', value)}
                />
              </div>
            </RuleCard>

            <RuleCard
              styles={styles}
              title="Bad Words"
              description="Blocks configured banned words and phrases."
              checked={form.badWords.enabled}
              open={openSections.badWords}
              onToggle={() => handleToggle('badWords')}
              onOpenToggle={() => toggleSectionOpen('badWords')}
              punishment={form.badWords.punishment}
              onPunishmentChange={(value) => handleChange('badWords', 'punishment', value)}
            >
              <TextAreaField
                styles={styles}
                label="Blocked Words"
                value={form.badWords.words}
                onChange={(value) => handleChange('badWords', 'words', value)}
                placeholder="word1, word2, phrase here"
                help="Separate words or phrases with commas or new lines."
              />
            </RuleCard>

            <RuleCard
              styles={styles}
              title="Repeated Messages"
              description="Stops users repeating the same message too many times."
              checked={form.repeatedMessages.enabled}
              open={openSections.repeatedMessages}
              onToggle={() => handleToggle('repeatedMessages')}
              onOpenToggle={() => toggleSectionOpen('repeatedMessages')}
              punishment={form.repeatedMessages.punishment}
              onPunishmentChange={(value) =>
                handleChange('repeatedMessages', 'punishment', value)
              }
            >
              <div style={styles.ruleMiniGrid}>
                <Field
                  styles={styles}
                  label="Max Repeats"
                  type="number"
                  min="1"
                  value={form.repeatedMessages.maxRepeats}
                  onChange={(value) =>
                    handleChange('repeatedMessages', 'maxRepeats', value)
                  }
                />

                <Field
                  styles={styles}
                  label="Interval Seconds"
                  type="number"
                  min="1"
                  value={form.repeatedMessages.intervalSeconds}
                  onChange={(value) =>
                    handleChange('repeatedMessages', 'intervalSeconds', value)
                  }
                />
              </div>
            </RuleCard>

            <RuleCard
              styles={styles}
              title="AutoMod Logs"
              description="Send AutoMod action logs to a Discord channel."
              checked={form.logs.enabled}
              open={openSections.logs}
              onToggle={() => handleToggle('logs')}
              onOpenToggle={() => toggleSectionOpen('logs')}
              hidePunishment
            >
              <div>
                <p style={styles.label}>Log Channel</p>

                <select
                  value={form.logs.channelId}
                  onChange={(event) => handleChange('logs', 'channelId', event.target.value)}
                  style={styles.input}
                  disabled={channelsLoading || logChannels.length === 0}
                >
                  <option value="">
                    {channelsLoading
                      ? 'Loading channels...'
                      : logChannels.length === 0
                        ? 'No text channels found'
                        : 'Select a log channel'}
                  </option>

                  {logChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
              </div>
            </RuleCard>

            <div style={styles.saveRow}>
              <PrimaryButton onClick={handleSave} disabled={!selectedGuild || saving}>
                {saving ? 'Saving...' : 'Save AutoMod Settings'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}

const RuleCard = memo(function RuleCard({
  title,
  description,
  checked,
  open,
  onToggle,
  onOpenToggle,
  punishment,
  onPunishmentChange,
  hidePunishment = false,
  children,
  styles,
}) {
  return (
    <div style={styles.ruleCard(open, checked)}>
      <div style={styles.ruleHeader}>
        <button type="button" onClick={onOpenToggle} style={styles.ruleTitleButton}>
          <div style={styles.ruleTitleRow}>
            <span style={styles.ruleTitle}>{title}</span>

            <span style={styles.statusPill(checked)}>
              {checked ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {description ? <p style={styles.ruleDescription}>{description}</p> : null}
        </button>

        <div style={styles.ruleActions}>
          <ToggleButton checked={checked} onClick={onToggle} styles={styles} />

          <button
            type="button"
            onClick={onOpenToggle}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            style={styles.chevron(open)}
          >
            <span style={styles.chevronIcon(open)}>⌄</span>
          </button>
        </div>
      </div>

      {open ? (
        <>
          {!hidePunishment ? (
            <div>
              <p style={styles.label}>Action</p>

              <MultiPunishmentSelect
                styles={styles}
                value={punishment}
                onChange={onPunishmentChange}
              />

              <p style={styles.actionSummary}>
                Current actions: {formatPunishments(punishment)}
              </p>
            </div>
          ) : null}

          {children ? <div style={styles.expandedPanel}>{children}</div> : null}
        </>
      ) : null}
    </div>
  );
});

const ToggleButton = memo(function ToggleButton({ checked, onClick, styles }) {
  return (
    <button type="button" onClick={onClick} style={styles.toggleButton(checked)}>
      {checked ? <span>On</span> : null}
      <span style={styles.toggleDot(checked)} />
      {!checked ? <span style={styles.toggleOffLabel}>Off</span> : null}
    </button>
  );
});

const Field = memo(function Field({
  label,
  value,
  onChange,
  styles,
  type = 'text',
  min,
  max,
}) {
  return (
    <div style={styles.miniField}>
      <p style={styles.label}>{label}</p>

      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
      />
    </div>
  );
});

const TextAreaField = memo(function TextAreaField({
  label,
  value,
  onChange,
  styles,
  placeholder,
  help,
}) {
  return (
    <div>
      <p style={styles.label}>{label}</p>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        style={styles.textarea}
      />

      {help ? <p style={styles.helpText}>{help}</p> : null}
    </div>
  );
});

const MultiPunishmentSelect = memo(function MultiPunishmentSelect({
  value,
  onChange,
  styles,
}) {
  const selected = normalizePunishments(value);
  const [open, setOpen] = useState(false);

  const toggleValue = useCallback(
    (optionValue) => {
      const next = selected.includes(optionValue)
        ? selected.filter((item) => item !== optionValue)
        : [...selected, optionValue];

      onChange(next.length > 0 ? next : ['delete']);
    },
    [onChange, selected],
  );

  return (
    <div style={styles.punishmentSelectWrap}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={styles.punishmentTrigger}
      >
        <span style={styles.punishmentTriggerText}>
          {formatPunishments(selected)}
        </span>

        <span style={styles.chevronIcon(open)}>⌄</span>
      </button>

      {open ? (
        <div style={styles.punishmentMenu}>
          <div style={styles.punishmentGrid}>
            {PUNISHMENT_OPTIONS.map((option) => {
              const checked = selected.includes(option.value);

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleValue(option.value)}
                  style={styles.punishmentOption(checked)}
                >
                  <span>{option.label}</span>
                  <span>{checked ? '✓' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
});

