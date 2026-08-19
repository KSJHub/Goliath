import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../services/apiClient';
import { joinGuildRoom, listenForGuildUpdate } from '../../services/socketClient';
import PageShell, {
  EmptyState,
  LoadingPanel,
  Notice,
  PrimaryButton,
  StatGrid,
  SummaryStat,
} from '../../shared/PageShell';

const SECTION_BLUEPRINTS = [
  ['adminLogs', 'Admin Logs', 'Configuration, permission, role, webhook, application and server management logs.', [
    ['applications', 'Applications', 'admin', ['App Add', 'App Command Permission Update', 'App Remove']],
    ['roles', 'Roles', 'admin', ['Role Color Update', 'Role Create', 'Role Delete', 'Role Name Update', 'Role Permissions Update', 'Role Position Update']],
    ['server', 'Server', 'admin', ['Server Banner Update', 'Server Boost Update', 'Server Icon Update', 'Server Name Update', 'Server Owner Update', 'Verification Level Update']],
    ['webhooks', 'Webhooks', 'admin', ['Webhook Avatar Update', 'Webhook Channel Update', 'Webhook Create', 'Webhook Delete', 'Webhook Name Update']],
  ]],
  ['discordLogs', 'Discord Logs', 'Native Discord activity such as channels, messages, members, voice and thread updates.', [
    ['channels', 'Channels', 'general', ['Channel Bitrate Update', 'Channel Create', 'Channel Default Archive Duration Update', 'Channel Default Reaction Emoji Update', 'Channel Default Sort Order Update', 'Channel Default Thread Slow Mode Update', 'Channel Delete', 'Channel Forum Layout Update', 'Channel Forum Tags Update', 'Channel Name Update', 'Channel NSFW Update', 'Channel Parent Update', 'Channel Permissions Update', 'Channel Pins Update', 'Channel RTC Region Update', 'Channel Slow Mode Update', 'Channel Topic Update', 'Channel Type Update', 'Channel User Limit Update', 'Channel Video Quality Update', 'Channel Voice Status Update']],
    ['emojis', 'Emojis', 'general', ['Emoji Create', 'Emoji Delete', 'Emoji Name Update', 'Emoji Roles Update']],
    ['events', 'Events', 'general', ['Event Create', 'Event Delete', 'Event Name Update', 'Event Status Update', 'Event User Add', 'Event User Remove']],
    ['invites', 'Invites', 'general', ['Invite Create', 'Invite Delete', 'Invite Use']],
    ['messages', 'Messages', 'messageDelete', ['Message Bulk Delete', 'Message Delete', 'Message Edit', 'Message Pin', 'Message Unpin']],
    ['polls', 'Polls', 'general', ['Poll Create', 'Poll Delete', 'Poll Vote Add', 'Poll Vote Remove']],
    ['soundboard', 'Soundboard', 'general', ['Soundboard Sound Create', 'Soundboard Sound Delete', 'Soundboard Sound Emoji Update', 'Soundboard Sound Name Update']],
    ['stage', 'Stage', 'voice', ['Stage Create', 'Stage Delete', 'Stage Privacy Level Update', 'Stage Topic Update']],
    ['threads', 'Threads', 'general', ['Thread Archive Update', 'Thread Create', 'Thread Delete', 'Thread Locked Update', 'Thread Member Add', 'Thread Member Remove', 'Thread Name Update']],
    ['users', 'Users', 'member', ['Member Join', 'Member Leave', 'Member Nickname Update', 'Member Roles Update', 'Member Timeout Update', 'User Avatar Update', 'Username Update']],
    ['voice', 'Voice', 'voice', ['Voice Deaf Update', 'Voice Join', 'Voice Leave', 'Voice Move', 'Voice Mute Update', 'Voice Stream Update', 'Voice Video Update']],
  ]],
  ['generalLogs', 'General Logs', 'General-purpose activity that does not need specialist moderation or admin routing.', [
    ['generalActivity', 'General Activity', 'general', ['General Activity', 'Guild Sync', 'Resource Update']],
  ]],
  ['modLogs', 'Mod Logs', 'Moderation, cases, warnings, lockdown and quarantine logs.', [
    ['moderation', 'Moderation', 'moderation', ['Case Create', 'Lockdown Start', 'Moderation Actions', 'Quarantine Add', 'Warning Create']],
  ]],
  ['moduleLogs', 'Module Logs', 'Goliath module output such as AutoMod, forms, tickets, sticky, translation and verification.', [
    ['automod', 'AutoMod', 'automod', ['Discord AutoMod Actions Update', 'Discord AutoMod Channels Update', 'Discord AutoMod Content Update', 'Discord AutoMod Name Update', 'Discord AutoMod Roles Update', 'Discord AutoMod Rule Create', 'Discord AutoMod Rule Delete', 'Discord AutoMod Rule Toggle', 'Discord AutoMod Whitelist Update', 'Goliath AutoMod Actions']],
    ['forms', 'Forms', 'admin', ['Form Created', 'Form Submitted', 'Form Updated']],
    ['giveaways', 'Giveaways', 'general', ['Giveaway Created', 'Giveaway Ended', 'Giveaway Rerolled']],
    ['sticky', 'Sticky Messages', 'general', ['Sticky Created', 'Sticky Deleted', 'Sticky Updated']],
    ['tickets', 'Tickets', 'moderation', ['Ticket Closed', 'Ticket Created', 'Ticket Deleted', 'Ticket Reopened', 'Ticket Updated']],
    ['translation', 'Translation', 'general', ['Translation Channel Updated', 'Translation Provider Updated', 'Translation Thread Created']],
    ['verification', 'Verification', 'admin', ['Verification Panel Deployed', 'Verification Settings Updated', 'Verification Success']],
  ]],
];

const SETTINGS = [
  ['applyIgnoreToUsersInVoice', 'Apply ignore to users in voice', 'Voice logs are not sent when a user is ignored from logging.'],
  ['ignoreEmbeds', 'Ignore embeds', 'Messages containing embeds are ignored from logging.'],
  ['logDeletedForwardedMessages', 'Log deleted forwarded messages', 'Forwarded messages are logged by Message Delete.'],
  ['logDeletedPollsWithMessageDelete', 'Log deleted polls with Message Delete', 'If disabled, only poll-specific delete logs are used.'],
  ['logDeletedStickyMessages', 'Log deleted sticky messages', 'Disable this to avoid noisy sticky-message delete logs.'],
  ['logUnrecognizableMessageDeletions', 'Log unrecognizable message deletions', 'Logs old uncached deletions without a known executor.'],
  ['useWebhooks', 'Use webhooks', 'Use webhook-style messages for cleaner log output.'],
].sort((a, b) => a[1].localeCompare(b[1]));

const TEXT_CHANNEL_TYPES = new Set([0, 5, '0', '5', 'GuildText', 'GuildAnnouncement']);

function keyFromLabel(label = '') {
  return String(label)
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join('');
}

const LOG_SECTIONS = SECTION_BLUEPRINTS.map(([key, label, description, categories]) => ({
  key,
  label,
  description,
  categories: categories
    .map(([categoryKey, categoryLabel, defaultChannelKey, labels]) => ({
      key: categoryKey,
      label: categoryLabel,
      defaultChannelKey,
      items: labels
        .map((labelText) => ({
          label: labelText,
          eventKey: keyFromLabel(labelText),
          channelKey: keyFromLabel(labelText),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label)),
})).sort((a, b) => a.label.localeCompare(b.label));

const CATEGORY_DATA = LOG_SECTIONS.flatMap((section) => section.categories);
const ALL_ITEMS = CATEGORY_DATA.flatMap((category) => category.items);
const OPEN_DEFAULTS = Object.fromEntries([
  ...LOG_SECTIONS.map((section) => [section.key, false]),
  ...CATEGORY_DATA.map((category) => [category.key, false]),
]);

const CHANNEL_DEFAULTS = CATEGORY_DATA.reduce((result, category) => {
  result[category.defaultChannelKey] = null;
  category.items.forEach((item) => {
    result[item.channelKey] = null;
  });
  return result;
}, {
  admin: null,
  automod: null,
  general: null,
  member: null,
  messageDelete: null,
  messageEdit: null,
  moderation: null,
  voice: null,
});

const EVENT_DEFAULTS = Object.fromEntries(ALL_ITEMS.map((item) => [item.eventKey, true]));
const DEFAULT_SETTINGS = {
  applyIgnoreToUsersInVoice: false,
  ignoreEmbeds: false,
  ignoredChannels: [],
  ignoredRoles: [],
  ignoredUsers: [],
  logDeletedForwardedMessages: true,
  logDeletedPollsWithMessageDelete: true,
  logDeletedStickyMessages: true,
  logUnrecognizableMessageDeletions: false,
  useWebhooks: true,
};
const DEFAULT_LOGS = {
  enabled: true,
  channels: CHANNEL_DEFAULTS,
  events: EVENT_DEFAULTS,
  settings: DEFAULT_SETTINGS,
};

function normalizeGuildIdValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.includes(':') ? raw.split(':').pop() : raw;
}

function getGuildId(selectedGuild, selectedGuildId = '') {
  return normalizeGuildIdValue(
    selectedGuildId ||
      (typeof selectedGuild === 'string'
        ? selectedGuild
        : selectedGuild?.guildId || selectedGuild?.id || ''),
  );
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeLogs(config = {}) {
  const safe = config && typeof config === 'object' ? config : {};
  const channels = safe.channels && typeof safe.channels === 'object' ? safe.channels : {};
  const settings = safe.settings && typeof safe.settings === 'object' ? safe.settings : {};

  return {
    ...DEFAULT_LOGS,
    ...safe,
    enabled: safe.enabled !== false,
    channels: {
      ...CHANNEL_DEFAULTS,
      ...channels,
      messageDelete: channels.messageDelete || channels.message || null,
      messageEdit: channels.messageEdit || channels.message || null,
    },
    events: { ...EVENT_DEFAULTS, ...(safe.events || {}) },
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      ignoredChannels: list(settings.ignoredChannels),
      ignoredRoles: list(settings.ignoredRoles),
      ignoredUsers: list(settings.ignoredUsers),
    },
  };
}

function extractList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.resources?.[key])) return payload.resources[key];
  return [];
}

function cleanTextChannels(payload = []) {
  return extractList(payload, 'channels')
    .filter((channel) => channel?.id && channel?.name)
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .sort((a, b) => {
      const position = Number(a.position || 0) - Number(b.position || 0);
      return position || String(a.name).localeCompare(String(b.name));
    });
}

function normaliseResourcePayload(payload) {
  return { channels: cleanTextChannels(payload) };
}

function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        border: checked ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(239,68,68,0.45)',
        background: checked ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)',
        color: checked ? '#86efac' : '#fca5a5',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderRadius: 999,
        padding: '8px 12px',
        minWidth: 96,
        fontSize: 12,
        fontWeight: 900,
      }}
    >
      {checked ? 'Enabled' : 'Disabled'}
    </button>
  );
}

function Button({ theme, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${theme.cardBorder}`,
        background: disabled ? theme.softBg : 'rgba(15,23,42,0.82)',
        color: disabled ? theme.mutedText : theme.cardText,
        borderRadius: 10,
        padding: '10px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        fontWeight: 900,
      }}
    >
      {children}
    </button>
  );
}

function ChannelSelect({ theme, channels, value, onChange, disabled = false }) {
  return (
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
      disabled={disabled}
      style={{
        width: 230,
        maxWidth: '100%',
        minHeight: 42,
        border: `1px solid ${theme.cardBorder}`,
        background: 'rgba(15,23,42,0.95)',
        color: value ? theme.cardText : theme.mutedText,
        borderRadius: 10,
        padding: '9px 12px',
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      <option value="">No channel</option>
      {channels.map((channel) => (
        <option key={channel.id} value={channel.id}>#{channel.name}</option>
      ))}
    </select>
  );
}

function Card({ theme, children }) {
  return (
    <div style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, borderRadius: 18, padding: 16, display: 'grid', gap: 14, minWidth: 0 }}>
      {children}
    </div>
  );
}

export default function Logs({ selectedGuild, selectedGuildId, selectedGuildData, theme }) {
  const guildId = getGuildId(selectedGuildData || selectedGuild, selectedGuildId);
  const saveTimer = useRef(null);
  const loadedRef = useRef(false);

  const [channels, setChannels] = useState([]);
  const [logs, setLogs] = useState(DEFAULT_LOGS);
  const [search, setSearch] = useState('');
  const [bulkChannel, setBulkChannel] = useState('');
  const [open, setOpen] = useState(OPEN_DEFAULTS);
  const [ignoredUser, setIgnoredUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const saveNow = useCallback(async (nextLogs, quiet = false) => {
    if (!guildId) return;
    try {
      setSaving(true);
      setError('');
      const saved = await api.saveLogConfig(guildId, normalizeLogs(nextLogs));
      if (saved?.config) setLogs(normalizeLogs(saved.config));
      setSaveMessage(quiet ? '✅ Auto-saved.' : '✅ Logging saved successfully.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save logging.');
    } finally {
      setSaving(false);
    }
  }, [guildId]);

  const queueSave = useCallback((nextLogs) => {
    if (!loadedRef.current || !guildId) return;
    clearTimeout(saveTimer.current);
    setSaveMessage('Saving...');
    saveTimer.current = setTimeout(() => saveNow(nextLogs, true), 450);
  }, [guildId, saveNow]);

  const updateLogs = useCallback((updater) => {
    setLogs((previous) => {
      const next = normalizeLogs(typeof updater === 'function' ? updater(previous) : updater);
      queueSave(next);
      return next;
    });
  }, [queueSave]);

  const loadResources = useCallback(async () => {
    if (!guildId) return [];
    setLoadingChannels(true);
    try {
      const first = normaliseResourcePayload(await api.request(`/api/discord/${guildId}/resources`).catch(() => ({})));
      if (first.channels.length) return first.channels;
      const synced = normaliseResourcePayload(await api.request(`/api/discord/${guildId}/resources/sync`, { method: 'POST' }).catch(() => ({})));
      if (synced.channels.length) return synced.channels;
      return cleanTextChannels(await api.getGuildChannels(guildId).catch(() => []));
    } finally {
      setLoadingChannels(false);
    }
  }, [guildId]);

  const refreshResources = useCallback(async () => {
    const nextChannels = await loadResources();
    setChannels(nextChannels);
    if (!nextChannels.length) setSaveMessage('⚠️ No text channels returned. Check bot guild access.');
  }, [loadResources]);

  useEffect(() => {
    let mounted = true;
    loadedRef.current = false;
    clearTimeout(saveTimer.current);
    setOpen(OPEN_DEFAULTS);

    async function loadData() {
      if (!guildId) {
        if (mounted) {
          setLogs(DEFAULT_LOGS);
          setChannels([]);
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
        const [logsResponse, resourceList] = await Promise.all([
          api.getLogConfig(guildId),
          loadResources(),
        ]);
        if (!mounted) return;
        setLogs(normalizeLogs(logsResponse?.config || logsResponse || {}));
        setChannels(resourceList);
        loadedRef.current = true;
      } catch (err) {
        console.error(err);
        if (!mounted) return;
        setError(err.message || 'Failed to load logging settings.');
        setChannels([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();
    return () => {
      mounted = false;
      clearTimeout(saveTimer.current);
    };
  }, [guildId, loadResources]);

  useEffect(() => {
    if (!guildId) return undefined;
    joinGuildRoom(guildId);
    return listenForGuildUpdate('logs', (data, payload = {}) => {
      if (payload.source === 'dashboard') return;
      setLogs(normalizeLogs(data));
      setSaveMessage('🔄 Logs updated live.');
    });
  }, [guildId]);

  const filteredSections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return LOG_SECTIONS;
    return LOG_SECTIONS
      .map((section) => ({
        ...section,
        categories: section.categories
          .map((category) => ({
            ...category,
            items: category.items.filter((item) =>
              [section.label, category.label, item.label, item.eventKey]
                .some((value) => value.toLowerCase().includes(term))),
          }))
          .filter((category) => category.items.length || category.label.toLowerCase().includes(term)),
      }))
      .filter((section) => section.categories.length || section.label.toLowerCase().includes(term));
  }, [search]);

  const enabledEvents = ALL_ITEMS.filter((item) => logs.events?.[item.eventKey] !== false).length;
  const routedEvents = ALL_ITEMS.filter((item) => Boolean(logs.channels?.[item.channelKey])).length;
  const configuredCategories = CATEGORY_DATA.filter((category) => Boolean(logs.channels?.[category.defaultChannelKey])).length;

  const applyChannelToItems = useCallback((items, channelId) => {
    updateLogs((current) => ({
      ...current,
      channels: {
        ...current.channels,
        ...Object.fromEntries(items.map((item) => [item.channelKey, channelId || null])),
      },
    }));
  }, [updateLogs]);

  const setItemsEnabled = useCallback((items, enabled) => {
    updateLogs((current) => ({
      ...current,
      events: {
        ...current.events,
        ...Object.fromEntries(items.map((item) => [item.eventKey, enabled])),
      },
    }));
  }, [updateLogs]);

  const addIgnoredUser = useCallback(() => {
    const userId = ignoredUser.trim();
    if (!userId) return;
    updateLogs((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ignoredUsers: [...new Set([...current.settings.ignoredUsers, userId])],
      },
    }));
    setIgnoredUser('');
  }, [ignoredUser, updateLogs]);

  if (!guildId) {
    return (
      <PageShell title="Logging" subtitle="Select a server to configure logging." theme={theme}>
        <EmptyState theme={theme} title="No server selected" description="Choose a server to manage its logging configuration." />
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell title="Logging" subtitle="Loading logging configuration." theme={theme} guild={{ id: guildId, name: 'Logging' }}>
        <LoadingPanel theme={theme} label="Loading logging settings..." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Logging"
      subtitle="Route Discord and module events to channels and control what Goliath records."
      theme={theme}
      guild={{ id: guildId, name: 'Logging' }}
      actions={(
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button theme={theme} onClick={refreshResources} disabled={loadingChannels}>
            {loadingChannels ? 'Refreshing...' : 'Refresh Channels'}
          </Button>
          <PrimaryButton theme={theme} onClick={() => saveNow(logs)} disabled={saving}>
            {saving ? 'Saving...' : 'Save Now'}
          </PrimaryButton>
        </div>
      )}
    >
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
        {saveMessage ? <Notice theme={theme}>{saveMessage}</Notice> : null}

        <StatGrid>
          <SummaryStat theme={theme} label="Logging" value={logs.enabled ? 'Enabled' : 'Disabled'} />
          <SummaryStat theme={theme} label="Enabled Events" value={`${enabledEvents}/${ALL_ITEMS.length}`} />
          <SummaryStat theme={theme} label="Routed Events" value={routedEvents} />
          <SummaryStat theme={theme} label="Configured Categories" value={`${configuredCategories}/${CATEGORY_DATA.length}`} />
        </StatGrid>

        <Card theme={theme}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, color: theme.cardText, fontSize: 18 }}>Master Logging</h2>
              <p style={{ margin: '5px 0 0', color: theme.mutedText, fontSize: 13 }}>Enable or disable all logging for this server.</p>
            </div>
            <Toggle checked={logs.enabled} onChange={(enabled) => updateLogs((current) => ({ ...current, enabled }))} />
          </div>
        </Card>

        <Card theme={theme}>
          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0, color: theme.cardText, fontSize: 18 }}>Bulk Routing</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <ChannelSelect theme={theme} channels={channels} value={bulkChannel} onChange={setBulkChannel} disabled={!logs.enabled} />
              <Button theme={theme} onClick={() => applyChannelToItems(ALL_ITEMS, bulkChannel)} disabled={!logs.enabled}>Apply to All Events</Button>
              <Button theme={theme} onClick={() => setItemsEnabled(ALL_ITEMS, true)} disabled={!logs.enabled}>Enable All</Button>
              <Button theme={theme} onClick={() => setItemsEnabled(ALL_ITEMS, false)} disabled={!logs.enabled}>Disable All</Button>
            </div>
          </div>
        </Card>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search logging events..."
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 12, padding: '12px 14px', fontSize: 14 }}
        />

        {filteredSections.map((section) => {
          const sectionOpen = open[section.key] || Boolean(search.trim());
          const sectionItems = section.categories.flatMap((category) => category.items);
          return (
            <Card key={section.key} theme={theme}>
              <button
                type="button"
                onClick={() => setOpen((current) => ({ ...current, [section.key]: !sectionOpen }))}
                style={{ border: 0, background: 'transparent', padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 14 }}
              >
                <span>
                  <strong style={{ display: 'block', color: theme.cardText, fontSize: 17 }}>{section.label}</strong>
                  <span style={{ display: 'block', marginTop: 5, color: theme.mutedText, fontSize: 13 }}>{section.description}</span>
                </span>
                <span style={{ color: theme.mutedText }}>{sectionOpen ? '▲' : '▼'}</span>
              </button>

              {sectionOpen ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button theme={theme} onClick={() => setItemsEnabled(sectionItems, true)} disabled={!logs.enabled}>Enable Section</Button>
                    <Button theme={theme} onClick={() => setItemsEnabled(sectionItems, false)} disabled={!logs.enabled}>Disable Section</Button>
                  </div>

                  {section.categories.map((category) => {
                    const categoryOpen = open[category.key] || Boolean(search.trim());
                    const categoryChannel = logs.channels?.[category.defaultChannelKey] || '';
                    return (
                      <div key={category.key} style={{ border: `1px solid ${theme.cardBorder}`, borderRadius: 14, overflow: 'hidden' }}>
                        <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: theme.softBg }}>
                          <button
                            type="button"
                            onClick={() => setOpen((current) => ({ ...current, [category.key]: !categoryOpen }))}
                            style={{ border: 0, background: 'transparent', color: theme.cardText, fontWeight: 900, cursor: 'pointer', padding: 0 }}
                          >
                            {categoryOpen ? '▲' : '▼'} {category.label}
                          </button>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <ChannelSelect
                              theme={theme}
                              channels={channels}
                              value={categoryChannel}
                              disabled={!logs.enabled}
                              onChange={(channelId) => updateLogs((current) => ({
                                ...current,
                                channels: {
                                  ...current.channels,
                                  [category.defaultChannelKey]: channelId,
                                  ...Object.fromEntries(category.items.map((item) => [item.channelKey, channelId])),
                                },
                              }))}
                            />
                            <Button theme={theme} onClick={() => setItemsEnabled(category.items, true)} disabled={!logs.enabled}>Enable</Button>
                            <Button theme={theme} onClick={() => setItemsEnabled(category.items, false)} disabled={!logs.enabled}>Disable</Button>
                          </div>
                        </div>

                        {categoryOpen ? (
                          <div style={{ display: 'grid' }}>
                            {category.items.map((item) => (
                              <div key={item.eventKey} style={{ padding: 12, display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(180px, 230px) auto', gap: 10, alignItems: 'center', borderTop: `1px solid ${theme.cardBorder}` }}>
                                <span style={{ color: theme.cardText, fontSize: 13, fontWeight: 800 }}>{item.label}</span>
                                <ChannelSelect
                                  theme={theme}
                                  channels={channels}
                                  value={logs.channels?.[item.channelKey] || ''}
                                  disabled={!logs.enabled}
                                  onChange={(channelId) => updateLogs((current) => ({
                                    ...current,
                                    channels: { ...current.channels, [item.channelKey]: channelId },
                                  }))}
                                />
                                <Toggle
                                  checked={logs.events?.[item.eventKey] !== false}
                                  disabled={!logs.enabled}
                                  onChange={(enabled) => updateLogs((current) => ({
                                    ...current,
                                    events: { ...current.events, [item.eventKey]: enabled },
                                  }))}
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </Card>
          );
        })}

        <Card theme={theme}>
          <h2 style={{ margin: 0, color: theme.cardText, fontSize: 18 }}>Logging Settings</h2>
          {SETTINGS.map(([key, title, description]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ color: theme.cardText, fontSize: 14 }}>{title}</strong>
                <p style={{ margin: '4px 0 0', color: theme.mutedText, fontSize: 13 }}>{description}</p>
              </div>
              <Toggle
                checked={Boolean(logs.settings?.[key])}
                disabled={!logs.enabled}
                onChange={(enabled) => updateLogs((current) => ({
                  ...current,
                  settings: { ...current.settings, [key]: enabled },
                }))}
              />
            </div>
          ))}
        </Card>

        <Card theme={theme}>
          <h2 style={{ margin: 0, color: theme.cardText, fontSize: 18 }}>Ignored Users</h2>
          <p style={{ margin: 0, color: theme.mutedText, fontSize: 13 }}>Add Discord user IDs that should be excluded from logging.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={ignoredUser}
              onChange={(event) => setIgnoredUser(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addIgnoredUser();
              }}
              placeholder="Discord user ID"
              style={{ flex: '1 1 220px', border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 10, padding: '10px 12px' }}
            />
            <Button theme={theme} onClick={addIgnoredUser} disabled={!logs.enabled || !ignoredUser.trim()}>Add User</Button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {logs.settings.ignoredUsers.length ? logs.settings.ignoredUsers.map((userId) => (
              <button
                key={userId}
                type="button"
                onClick={() => updateLogs((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    ignoredUsers: current.settings.ignoredUsers.filter((id) => id !== userId),
                  },
                }))}
                style={{ border: `1px solid ${theme.cardBorder}`, background: theme.softBg, color: theme.cardText, borderRadius: 999, padding: '8px 11px', cursor: 'pointer' }}
                title="Remove ignored user"
              >
                {userId} ×
              </button>
            )) : <span style={{ color: theme.mutedText, fontSize: 13 }}>No ignored users configured.</span>}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
