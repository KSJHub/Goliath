import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import PageShell, {
  EmptyState,
  LoadingPanel,
  Notice,
  StatGrid,
  SummaryStat,
} from '../../shared/PageShell';
import { PAGE_LAYOUTS } from '../../ui/layout';
import {
  createConfigPageStyles,
  createDashboardControlStyles,
} from '../../ui/components';

const PAGE_KEY = 'generalSettings';

const DEFAULT_FORM = {
  prefix: '/',
  appealUrl: '',
  dashboardEnabled: true,

  managerRoleIds: [],
  dashboardAccessRoleIds: [],
  commandManagerRoleIds: [],
  restrictedChannelIds: [],

  commandNotFoundEnabled: true,
  wrongCommandUsageEnabled: true,
  noCommandPermissionsEnabled: true,
  disabledInChannelEnabled: false,
  commandCooldownEnabled: true,

  instantDeleteDataEnabled: false,
};

const DEFAULT_OPEN_SECTIONS = {
  general: true,
  permissions: false,
  commands: false,
  errorMessages: false,
  data: false,
};

export default function GeneralSettings({ selectedGuild, theme }) {
  const configStyles = useMemo(() => createConfigPageStyles(theme), [theme]);
  const controlStyles = useMemo(() => createDashboardControlStyles(theme), [theme]);

  const styles = useMemo(
    () => ({
      ...configStyles,
      ...controlStyles,
    }),
    [configStyles, controlStyles],
  );

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN_SECTIONS);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);

  const page = PAGE_LAYOUTS[PAGE_KEY] || {
    title: 'General Settings',
    description: 'Manage dashboard and server configuration for the selected server.',
    emptyDescription: 'Select a server to manage settings.',
  };

  const loadDiscordData = useCallback(async () => {
    if (!selectedGuild) return;

    try {
      setSyncing(true);

      const channelsResult = await api.getGuildChannels(selectedGuild);
      setChannels(Array.isArray(channelsResult) ? channelsResult : []);

      if (typeof api.getGuildRoles === 'function') {
        const rolesResult = await api.getGuildRoles(selectedGuild);
        setRoles(Array.isArray(rolesResult) ? rolesResult : []);
      } else {
        setRoles([]);
      }

      setSaveMessage('✅ Roles/channels synced from Discord.');
    } catch (err) {
      console.error(err);
      setSaveMessage(`${E.ERROR} Failed to sync roles/channels.`);
    } finally {
      setSyncing(false);
    }
  }, [selectedGuild]);

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      if (!selectedGuild) {
        if (mounted) {
          setForm(DEFAULT_FORM);
          setError('');
          setSaveMessage('');
          setLoading(false);
          setChannels([]);
          setRoles([]);
        }
        return;
      }

      try {
        setLoading(true);
        setError('');
        setSaveMessage('');

        const [data, channelsResult] = await Promise.all([
          api.getGeneralSettings(selectedGuild),
          api.getGuildChannels(selectedGuild).catch(() => []),
        ]);

        if (!mounted) return;

        const config = data?.config || data || {};

        setChannels(Array.isArray(channelsResult) ? channelsResult : []);

        setForm({
          prefix: config?.prefix || '/',
          appealUrl: config?.appealUrl || '',
          dashboardEnabled: config?.dashboardEnabled !== false,

          managerRoleIds: safeArray(config?.managerRoleIds),
          dashboardAccessRoleIds: safeArray(config?.dashboardAccessRoleIds),
          commandManagerRoleIds: safeArray(config?.commandManagerRoleIds),
          restrictedChannelIds: safeArray(config?.restrictedChannelIds),

          commandNotFoundEnabled: config?.commandNotFoundEnabled !== false,
          wrongCommandUsageEnabled: config?.wrongCommandUsageEnabled !== false,
          noCommandPermissionsEnabled: config?.noCommandPermissionsEnabled !== false,
          disabledInChannelEnabled: config?.disabledInChannelEnabled === true,
          commandCooldownEnabled: config?.commandCooldownEnabled !== false,

          instantDeleteDataEnabled: config?.instantDeleteDataEnabled === true,
        });
      } catch (err) {
        console.error(err);
        if (!mounted) return;
        setForm(DEFAULT_FORM);
        setError('Could not load general settings.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadConfig();

    return () => {
      mounted = false;
    };
  }, [selectedGuild]);

  const handleChange = useCallback((field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const handleToggle = useCallback((field) => {
    setForm((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  }, []);

  const handleMultiToggle = useCallback((field, id) => {
    setForm((prev) => {
      const current = safeArray(prev[field]);
      const exists = current.includes(id);

      return {
        ...prev,
        [field]: exists ? current.filter((item) => item !== id) : [...current, id],
      };
    });
  }, []);

  const toggleSection = useCallback((sectionKey) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedGuild) {
      setSaveMessage(`${E.ERROR} Select a guild first.`);
      return;
    }

    try {
      setSaving(true);
      setSaveMessage('');
      setError('');

      await api.updateGeneralSettings(selectedGuild, {
        prefix: form.prefix || '/',
        appealUrl: form.appealUrl || '',
        dashboardEnabled: Boolean(form.dashboardEnabled),

        managerRoleIds: safeArray(form.managerRoleIds),
        dashboardAccessRoleIds: safeArray(form.dashboardAccessRoleIds),
        commandManagerRoleIds: safeArray(form.commandManagerRoleIds),
        restrictedChannelIds: safeArray(form.restrictedChannelIds),

        commandNotFoundEnabled: Boolean(form.commandNotFoundEnabled),
        wrongCommandUsageEnabled: Boolean(form.wrongCommandUsageEnabled),
        noCommandPermissionsEnabled: Boolean(form.noCommandPermissionsEnabled),
        disabledInChannelEnabled: Boolean(form.disabledInChannelEnabled),
        commandCooldownEnabled: Boolean(form.commandCooldownEnabled),

        instantDeleteDataEnabled: Boolean(form.instantDeleteDataEnabled),
      });

      setSaveMessage('✅ General settings saved successfully.');
    } catch (err) {
      console.error(err);
      setSaveMessage(`${E.ERROR} Failed to save general settings.`);
    } finally {
      setSaving(false);
    }
  }, [selectedGuild, form]);

  const enabledErrorMessages = useMemo(() => {
    return [
      form.commandNotFoundEnabled,
      form.wrongCommandUsageEnabled,
      form.noCommandPermissionsEnabled,
      form.disabledInChannelEnabled,
      form.commandCooldownEnabled,
    ].filter(Boolean).length;
  }, [form]);

  const textChannels = useMemo(() => channels.filter(isTextChannel), [channels]);

  const roleOptions = useMemo(() => {
    if (roles.length > 0) return roles;

    return [
      ...form.managerRoleIds.map((id) => ({ id, name: `Role ${id}` })),
      ...form.dashboardAccessRoleIds.map((id) => ({ id, name: `Role ${id}` })),
      ...form.commandManagerRoleIds.map((id) => ({ id, name: `Role ${id}` })),
    ].filter((role, index, arr) => arr.findIndex((item) => item.id === role.id) === index);
  }, [roles, form.managerRoleIds, form.dashboardAccessRoleIds, form.commandManagerRoleIds]);

  const permissionsEnabled =
    form.managerRoleIds.length > 0 ||
    form.dashboardAccessRoleIds.length > 0 ||
    form.commandManagerRoleIds.length > 0 ||
    form.restrictedChannelIds.length > 0;

  const commandsEnabled = Boolean(form.prefix);
  const errorsEnabled = enabledErrorMessages > 0;

  if (!selectedGuild) {
    return (
      <PageShell
        title={page.title || 'General Settings'}
        subtitle={page.emptyDescription || 'Select a server to manage settings.'}
        theme={theme}
      >
        <EmptyState theme={theme} text="Select a guild from the navbar to continue." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title={page.title || 'General Settings'}
      subtitle={page.description || 'Manage dashboard and server configuration for the selected server.'}
      theme={theme}
    >
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}

      {saveMessage ? (
        <Notice theme={theme} tone={saveMessage.startsWith(E.ERROR) ? 'danger' : 'success'}>
          {saveMessage}
        </Notice>
      ) : null}

      <StatGrid>
        <SummaryStat theme={theme} label="Prefix" value={form.prefix || '/'} />
        <SummaryStat theme={theme} label="Error Messages" value={`${enabledErrorMessages}/5`} />
        <SummaryStat
          theme={theme}
          label="Dashboard"
          value={form.dashboardEnabled ? 'Enabled' : 'Disabled'}
          accent={form.dashboardEnabled ? theme.success : theme.danger}
        />
      </StatGrid>

      {loading ? (
        <LoadingPanel theme={theme} text="Loading general settings..." />
      ) : (
        <>
          <section style={styles.pageSection}>
            <div style={styles.pageSectionHeader}>
              <h2 style={styles.pageSectionTitle}>General Config</h2>
              <p style={styles.pageSectionSubtitle}>
                Core dashboard, permissions, commands, and data behaviour.
              </p>
            </div>

            <div style={styles.sectionList}>
              <CollapsibleSection
                styles={styles}
                title="General Config"
                subtitle="Core dashboard and Discord sync settings."
                checked={form.dashboardEnabled}
                open={openSections.general}
                onToggle={() => handleToggle('dashboardEnabled')}
                onOpenToggle={() => toggleSection('general')}
              >
                <div style={styles.innerStack}>
                  <div style={styles.expandedPanel}>
                    <div style={styles.ruleHeader}>
                      <div style={styles.minWidthZero}>
                        <span style={styles.ruleTitle}>Sync Discord Data</span>
                        <p style={styles.ruleDescription}>
                          Refresh cached Discord roles and channels for dropdown menus.
                        </p>
                      </div>

                      <ThemeButton styles={styles} onClick={loadDiscordData} disabled={syncing}>
                        {syncing ? 'Syncing...' : 'Sync roles/channels'}
                      </ThemeButton>
                    </div>
                  </div>

                  <Field styles={styles} label="Appeal URL">
                    <input
                      value={form.appealUrl}
                      onChange={(e) => handleChange('appealUrl', e.target.value)}
                      style={styles.input}
                      placeholder="https://..."
                    />
                  </Field>
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                styles={styles}
                title="Roles & Permissions"
                subtitle="Choose which roles can access and manage dashboard features."
                checked={permissionsEnabled}
                open={openSections.permissions}
                onToggle={() => toggleSection('permissions')}
                onOpenToggle={() => toggleSection('permissions')}
              >
                <div style={styles.sectionList}>
                  <MultiSelectPanel
                    styles={styles}
                    title="Manager Roles"
                    description="Roles selected here can manage General Settings and bot features."
                    emptyText="No roles synced yet. Click Sync roles/channels in General Config."
                    options={roleOptions}
                    selectedIds={form.managerRoleIds}
                    onToggle={(id) => handleMultiToggle('managerRoleIds', id)}
                    type="role"
                  />

                  <MultiSelectPanel
                    styles={styles}
                    title="Dashboard Access Roles"
                    description="Roles selected here are allowed to access this dashboard."
                    emptyText="No roles synced yet. Click Sync roles/channels in General Config."
                    options={roleOptions}
                    selectedIds={form.dashboardAccessRoleIds}
                    onToggle={(id) => handleMultiToggle('dashboardAccessRoleIds', id)}
                    type="role"
                  />

                  <MultiSelectPanel
                    styles={styles}
                    title="Command Manager Roles"
                    description="Roles selected here can manage command permissions."
                    emptyText="No roles synced yet. Click Sync roles/channels in General Config."
                    options={roleOptions}
                    selectedIds={form.commandManagerRoleIds}
                    onToggle={(id) => handleMultiToggle('commandManagerRoleIds', id)}
                    type="role"
                  />

                  <MultiSelectPanel
                    styles={styles}
                    title="Restricted Command Channels"
                    description="Choose channels where command permissions should be restricted or reviewed."
                    emptyText="No text channels found. Click Sync roles/channels in General Config."
                    options={textChannels}
                    selectedIds={form.restrictedChannelIds}
                    onToggle={(id) => handleMultiToggle('restrictedChannelIds', id)}
                    type="channel"
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                styles={styles}
                title="Commands"
                subtitle="Manage command behaviour, prefixes, and command access."
                checked={commandsEnabled}
                open={openSections.commands}
                onToggle={() => toggleSection('commands')}
                onOpenToggle={() => toggleSection('commands')}
              >
                <div style={styles.sectionList}>
                  <ActionRow
                    styles={styles}
                    icon="⌘"
                    title="Custom Commands"
                    description="Create and manage your own commands."
                    actionLabel="Create new command"
                  />

                  <ActionRow
                    styles={styles}
                    icon="▦"
                    title="Default Commands"
                    description="Update permissions, aliases and more for all default commands. You can also enable or disable slash commands here."
                    rightIcon="›"
                  />

                  <PrefixPanel
                    styles={styles}
                    prefix={form.prefix || '/'}
                    onPrefixChange={(value) => handleChange('prefix', value)}
                    onAddPrefix={() =>
                      setSaveMessage(`${E.INFO} Multi-prefix support can be added in the next stage.`)
                    }
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                styles={styles}
                title="Error Messages"
                subtitle="Choose which command error responses the bot should send."
                checked={errorsEnabled}
                open={openSections.errorMessages}
                onToggle={() => toggleSection('errorMessages')}
                onOpenToggle={() => toggleSection('errorMessages')}
              >
                <div style={styles.sectionList}>
                  <SwitchRow
                    styles={styles}
                    title="Command not found"
                    description="Sent when an executed command doesn't exist."
                    checked={form.commandNotFoundEnabled}
                    onChange={() => handleToggle('commandNotFoundEnabled')}
                  />

                  <SwitchRow
                    styles={styles}
                    title="Wrong command usage"
                    description="Sent when an existing command is used incorrectly."
                    checked={form.wrongCommandUsageEnabled}
                    onChange={() => handleToggle('wrongCommandUsageEnabled')}
                  />

                  <SwitchRow
                    styles={styles}
                    title="No command permissions"
                    description='Sent when an unpermitted user is executing an existing command. If disabled, "Command not found" will be sent instead.'
                    checked={form.noCommandPermissionsEnabled}
                    onChange={() => handleToggle('noCommandPermissionsEnabled')}
                  />

                  <SwitchRow
                    styles={styles}
                    title="Disabled in channel"
                    description="Sent when an existing command is executed in channels where it's disabled."
                    checked={form.disabledInChannelEnabled}
                    onChange={() => handleToggle('disabledInChannelEnabled')}
                  />

                  <SwitchRow
                    styles={styles}
                    title="Command on cooldown"
                    description="Sent when an existing command is executed while the user is on cooldown."
                    checked={form.commandCooldownEnabled}
                    onChange={() => handleToggle('commandCooldownEnabled')}
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                styles={styles}
                title="Data Deletion Behaviour"
                subtitle="Choose what happens to configuration data if the bot is kicked."
                checked={form.instantDeleteDataEnabled}
                open={openSections.data}
                onToggle={() => handleToggle('instantDeleteDataEnabled')}
                onOpenToggle={() => toggleSection('data')}
              >
                <ToggleRow
                  styles={styles}
                  label="Instantly delete data when bot is kicked"
                  description="By default, data is kept temporarily so it can be restored. Enable this to delete configuration instantly."
                  checked={form.instantDeleteDataEnabled}
                  onChange={() => handleToggle('instantDeleteDataEnabled')}
                />
              </CollapsibleSection>
            </div>
          </section>

          <div>
            <ThemeButton styles={styles} onClick={handleSave} disabled={!selectedGuild || saving}>
              {saving ? 'Saving...' : 'Save General Settings'}
            </ThemeButton>
          </div>
        </>
      )}
    </PageShell>
  );
}

const CollapsibleSection = memo(function CollapsibleSection({
  styles,
  title,
  subtitle,
  checked,
  open,
  onToggle,
  onOpenToggle,
  children,
}) {
  return (
    <div style={styles.ruleCard(open, checked)}>
      <div style={styles.ruleHeader}>
        <button type="button" onClick={onOpenToggle} style={styles.ruleTitleButton}>
          <div style={styles.ruleTitleRow}>
            <span style={styles.ruleTitle}>{title}</span>
            <span style={styles.statusPill(checked)}>{checked ? 'Enabled' : 'Disabled'}</span>
          </div>

          {subtitle ? <p style={styles.ruleDescription}>{subtitle}</p> : null}
        </button>

        <div style={styles.ruleActions}>
          <ToggleSwitch checked={checked} onClick={onToggle} styles={styles} />

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

      {open ? children : null}
    </div>
  );
});

const ToggleSwitch = memo(function ToggleSwitch({ checked, onClick, styles }) {
  return (
    <button type="button" onClick={onClick} style={styles.toggleButton(checked)}>
      {checked ? <span>On</span> : null}
      <span style={styles.toggleDot(checked)} />
      {!checked ? <span style={styles.toggleOffLabel}>Off</span> : null}
    </button>
  );
});

const Field = memo(function Field({ styles, label, children }) {
  return (
    <div>
      <p style={styles.label}>{label}</p>
      {children}
    </div>
  );
});

const ToggleRow = memo(function ToggleRow({ styles, label, description, checked, onChange }) {
  return (
    <div style={styles.expandedPanel}>
      <div style={styles.ruleHeader}>
        <div style={styles.minWidthZero}>
          <span style={styles.ruleTitle}>{label}</span>
          {description ? <p style={styles.ruleDescription}>{description}</p> : null}
        </div>

        <ToggleSwitch checked={checked} onClick={onChange} styles={styles} />
      </div>
    </div>
  );
});

const SwitchRow = memo(function SwitchRow({ styles, title, description, checked, onChange }) {
  return (
    <div style={styles.expandedPanel}>
      <div style={styles.ruleHeader}>
        <div style={styles.minWidthZero}>
          <span style={styles.ruleTitle}>{title}</span>
          <p style={styles.ruleDescription}>{description}</p>
        </div>

        <ToggleSwitch checked={checked} onClick={onChange} styles={styles} />
      </div>
    </div>
  );
});

const ActionRow = memo(function ActionRow({
  styles,
  icon,
  title,
  description,
  actionLabel,
  rightIcon,
}) {
  return (
    <div style={styles.expandedPanel}>
      <div style={styles.actionInnerRow}>
        <div style={styles.actionIcon}>{icon}</div>

        <div style={styles.minWidthZero}>
          <span style={styles.ruleTitle}>{title}</span>
          <p style={styles.ruleDescription}>{description}</p>
        </div>

        {actionLabel ? (
          <ThemeButton styles={styles}>{actionLabel}</ThemeButton>
        ) : (
          <span style={styles.rightIcon}>{rightIcon}</span>
        )}
      </div>
    </div>
  );
});

const PrefixPanel = memo(function PrefixPanel({
  styles,
  prefix,
  onPrefixChange,
  onAddPrefix,
}) {
  return (
    <div style={styles.expandedPanel}>
      <div style={styles.ruleHeader}>
        <div style={styles.minWidthZero}>
          <div style={styles.ruleTitleRow}>
            <span style={styles.ruleTitle}>Prefixes</span>
            <span style={styles.statusPill(true)}>1/5</span>
          </div>

          <p style={styles.ruleDescription}>
            Put one of the following prefixes in front of your message to execute bot commands.
          </p>
        </div>

        <ThemeButton styles={styles} onClick={onAddPrefix}>
          Add prefix
        </ThemeButton>
      </div>

      <input
        value={prefix}
        onChange={(e) => onPrefixChange(e.target.value)}
        style={styles.input}
        placeholder="/"
        maxLength={5}
      />
    </div>
  );
});

const MultiSelectPanel = memo(function MultiSelectPanel({
  styles,
  title,
  description,
  emptyText,
  options,
  selectedIds,
  onToggle,
  type,
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div style={styles.expandedPanel}>
      <div>
        <div style={styles.ruleTitleRow}>
          <span style={styles.ruleTitle}>{title}</span>
          <span style={styles.statusPill(selectedIds.length > 0)}>
            {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'None'}
          </span>
        </div>

        <p style={styles.ruleDescription}>{description}</p>
      </div>

      {options.length === 0 ? (
        <p style={styles.helpText}>{emptyText}</p>
      ) : (
        <div style={styles.innerStack}>
          <div style={styles.chipsWrap}>
            {selectedIds.length === 0 ? (
              <span style={styles.chip(false)}>None selected</span>
            ) : (
              selectedIds.map((id) => {
                const item = options.find((option) => option.id === id);
                return (
                  <span key={id} style={styles.chip(true)}>
                    {formatOptionLabel(item, id, type)}
                  </span>
                );
              })
            )}
          </div>

          <div style={styles.innerStackSmall}>
            {options.map((option) => {
              const selected = selectedSet.has(option.id);

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggle(option.id)}
                  style={styles.selectOption(selected)}
                >
                  <span>{formatOptionLabel(option, option.id, type)}</span>
                  <span>{selected ? '✓' : '+'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

const ThemeButton = memo(function ThemeButton({
  styles,
  children,
  onClick,
  disabled = false,
  tone = 'primary',
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={styles.button(tone, disabled)}>
      {children}
    </button>
  );
});

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatOptionLabel(item, fallbackId, type) {
  if (!item) return type === 'channel' ? `#${fallbackId}` : `@${fallbackId}`;
  if (type === 'channel') return `#${item.name || item.id || fallbackId}`;
  return `@${item.name || item.id || fallbackId}`;
}

function isTextChannel(channel) {
  const type = channel?.type;
  return type === 0 || type === 'GUILD_TEXT' || type === 'text';
}
