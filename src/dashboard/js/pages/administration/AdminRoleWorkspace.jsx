import { goliathDialog } from '../../shared/GoliathDialogHost.jsx';
import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../../services/apiClient';
import PageShell, { EmptyState, LoadingPanel, Notice, SectionCard, StatGrid, SummaryStat } from '../../shared/PageShell';
import { PAGE_LAYOUTS } from '../../ui/layout';
import { createSharedComponentStyles } from '../../ui/components';
import AccessControlCard from './AccessControlCard';
import CommandAccessPanel, { COMMAND_ACCESS_ITEMS, getConfiguredCommandAccessCount } from './CommandAccessPanel';
import ModuleAccessPanel, { MODULE_ACCESS_ITEMS, getConfiguredModuleAccessCount } from './ModuleAccessPanel';
import PermissionPresetsPanel from './PermissionPresetsPanel';
import ProtectedActionsAccessPanel, { PROTECTED_ACTION_ITEMS, getConfiguredProtectedActionAccessCount } from './ProtectedActionsAccessPanel';
import RoleCreatorFull from './RoleCreatorFull';
import RoleEditorCard from './RoleEditorCardFull';

const DASHBOARD_ACCESS_ITEMS = [
  ['overview', 'Overview', 'Main server overview and live status.'],
  ['moderation', 'Moderation', 'Moderation tools and staff actions.'],
  ['cases', 'Cases', 'Moderation case history.'],
  ['logs', 'Logs', 'Dashboard and server log configuration.'],
  ['tickets', 'Tickets', 'Ticket queues, claims and transcripts.'],
  ['forms', 'Forms', 'Universal forms and submissions.'],
  ['billing', 'Billing', 'Subscription and entitlement details.'],
  ['translation', 'Translation', 'Translation settings and provider controls.'],
  ['security', 'Security', 'Security centre and protection overview.'],
  ['restore', 'Restore', 'Backup preview and restore controls.'],
];

function getGuildId(selectedGuild) {
  if (!selectedGuild) return '';
  if (typeof selectedGuild === 'string') return selectedGuild;
  return selectedGuild.id || selectedGuild.guildId || '';
}

function normalizeArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function defaultAccessControl() {
  return { commands: {}, dashboardPages: {}, modules: {}, protectedActions: {} };
}

function defaultPermissions() {
  return { accessControl: defaultAccessControl(), enabled: true, managerRoleIds: [], moduleAccess: {}, roleAccess: {}, roleOrder: [], syncDiscordRoles: false };
}

function normalizeAccess(access = {}) {
  return {
    roles: Array.isArray(access.roles) ? access.roles : [],
    users: Array.isArray(access.users) ? access.users : [],
  };
}

function addRoleToAccessGroup(group = {}, keys = [], roleId) {
  const next = { ...group };
  keys.forEach((key) => {
    const access = normalizeAccess(next[key]);
    next[key] = { ...access, roles: [...new Set([...access.roles, roleId])] };
  });
  return next;
}

function normalizeGeneral(config = {}) {
  const dashboardPermissions = { ...defaultPermissions(), ...(config.dashboardPermissions || {}), syncDiscordRoles: false };
  dashboardPermissions.accessControl = { ...defaultAccessControl(), ...(dashboardPermissions.accessControl || {}) };
  dashboardPermissions.accessControl.commands = dashboardPermissions.accessControl.commands || {};
  dashboardPermissions.accessControl.dashboardPages = dashboardPermissions.accessControl.dashboardPages || {};
  dashboardPermissions.accessControl.modules = dashboardPermissions.accessControl.modules || {};
  dashboardPermissions.accessControl.protectedActions = dashboardPermissions.accessControl.protectedActions || {};
  return { ...config, dashboardPermissions };
}

function button(theme, tone = 'soft', disabled = false) {
  const tones = {
    success: ['rgba(34,197,94,0.13)', 'rgba(34,197,94,0.32)', '#86efac'],
    soft: ['rgba(148,163,184,0.10)', theme.cardBorder, theme.cardText],
  };
  const [background, border, color] = tones[tone] || tones.soft;
  return { border: `1px solid ${border}`, background, color, borderRadius: 12, padding: '10px 12px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, fontWeight: 950 };
}

function Panel({ action, children, open = true, subtitle, theme, title }) {
  return <SectionCard theme={theme}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', marginBottom: open ? 16 : 0 }}><div><h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>{subtitle ? <p style={{ margin: '7px 0 0', color: theme.mutedText, lineHeight: 1.55 }}>{subtitle}</p> : null}</div>{action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}</div>{open ? children : null}</SectionCard>;
}

function Pill({ active, label, onClick, theme }) {
  return <button type="button" onClick={onClick} style={button(theme, active ? 'success' : 'soft')}>{label}</button>;
}

function SyncStat({ label, theme, value }) {
  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.18)', borderRadius: 14, padding: 12 }}><div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div><strong style={{ display: 'block', marginTop: 4, fontSize: 20 }}>{value}</strong></div>;
}

export default function AdminRoleWorkspace({ selectedGuild, theme }) {
  const styles = useMemo(() => createSharedComponentStyles(theme), [theme]);
  const page = PAGE_LAYOUTS.admin || { title: 'Admin', emptyDescription: 'Select a server to manage admin settings.' };
  const guildId = getGuildId(selectedGuild);

  const [creatingRole, setCreatingRole] = useState(false);
  const [deletingRole, setDeletingRole] = useState(false);
  const [draggingRoleId, setDraggingRoleId] = useState('');
  const [error, setError] = useState('');
  const [general, setGeneral] = useState(normalizeGeneral());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [roleSyncReport, setRoleSyncReport] = useState(null);
  const [roles, setRoles] = useState([]);
  const [savingAccess, setSavingAccess] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const permissions = general.dashboardPermissions || defaultPermissions();
  const accessControl = permissions.accessControl || defaultAccessControl();
  const commandAccess = accessControl.commands || {};
  const dashboardPagesAccess = accessControl.dashboardPages || {};
  const modulesAccess = accessControl.modules || {};
  const protectedActionsAccess = accessControl.protectedActions || {};
  const fullAccessRoleIds = permissions.managerRoleIds || [];
  const configuredCommands = getConfiguredCommandAccessCount(commandAccess);
  const configuredDashboardPages = DASHBOARD_ACCESS_ITEMS.filter(([key]) => {
    const access = normalizeAccess(dashboardPagesAccess[key]);
    return access.roles.length || access.users.length;
  }).length;
  const configuredModules = getConfiguredModuleAccessCount(modulesAccess);
  const configuredProtectedActions = getConfiguredProtectedActionAccessCount(protectedActionsAccess);

  const orderedRoles = useMemo(() => {
    const order = permissions.roleOrder || [];
    return [...roles].sort((a, b) => {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 9999 : aIndex) - (bIndex === -1 ? 9999 : bIndex);
      return (b.position || 0) - (a.position || 0);
    });
  }, [permissions.roleOrder, roles]);
  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) || orderedRoles[0] || null, [orderedRoles, roles, selectedRoleId]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!guildId) return;
      try {
        setLoading(true);
        setError('');
        setNotice('');
        setRoleSyncReport(null);
        const [rolesRes, generalRes] = await Promise.all([api.getGuildRoles(guildId).catch(() => []), api.getGeneralSettings(guildId).catch(() => ({}))]);
        if (!mounted) return;
        const nextRoles = normalizeArray(rolesRes, 'roles');
        setRoles(nextRoles);
        setGeneral(normalizeGeneral(generalRes?.config || generalRes || {}));
        setSelectedRoleId(nextRoles[0]?.id || '');
      } catch (err) {
        console.error(err);
        if (mounted) setError('Failed to load admin role workspace.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [guildId]);

  function updatePermissions(updater) {
    setGeneral((current) => ({ ...current, dashboardPermissions: { ...updater(current.dashboardPermissions || defaultPermissions()), syncDiscordRoles: false } }));
  }

  function setFullAccessRole(roleId, enabled) {
    updatePermissions((current) => ({ ...current, managerRoleIds: enabled ? [...new Set([...(current.managerRoleIds || []), roleId])] : (current.managerRoleIds || []).filter((id) => id !== roleId) }));
  }

  function applyPermissionPreset(roleId, preset) {
    if (!roleId || !preset) return;
    updatePermissions((current) => {
      const nextAccessControl = { ...defaultAccessControl(), ...(current.accessControl || {}) };
      const nextManagerRoleIds = preset.fullAccess ? [...new Set([...(current.managerRoleIds || []), roleId])] : (current.managerRoleIds || []);
      return {
        ...current,
        accessControl: {
          ...nextAccessControl,
          commands: addRoleToAccessGroup(nextAccessControl.commands, preset.commands, roleId),
          dashboardPages: addRoleToAccessGroup(nextAccessControl.dashboardPages, preset.dashboardPages, roleId),
          modules: addRoleToAccessGroup(nextAccessControl.modules, preset.modules, roleId),
        },
        managerRoleIds: nextManagerRoleIds,
      };
    });
    const roleName = roles.find((role) => role.id === roleId)?.name || 'role';
    setNotice(`✅ Applied ${preset.label} preset to ${roleName}. Save Access to persist.`);
  }

  function setCommandAccess(commandKey, access) {
    updatePermissions((current) => {
      const nextAccessControl = { ...defaultAccessControl(), ...(current.accessControl || {}) };
      const commands = { ...(nextAccessControl.commands || {}) };
      commands[commandKey] = normalizeAccess(access);
      return { ...current, accessControl: { ...nextAccessControl, commands } };
    });
  }

  function setDashboardAccess(pageKey, access) {
    updatePermissions((current) => {
      const nextAccessControl = { ...defaultAccessControl(), ...(current.accessControl || {}) };
      const dashboardPages = { ...(nextAccessControl.dashboardPages || {}) };
      dashboardPages[pageKey] = normalizeAccess(access);
      return { ...current, accessControl: { ...nextAccessControl, dashboardPages } };
    });
  }

  function setModuleAccess(moduleKey, access) {
    updatePermissions((current) => {
      const nextAccessControl = { ...defaultAccessControl(), ...(current.accessControl || {}) };
      const modules = { ...(nextAccessControl.modules || {}) };
      modules[moduleKey] = normalizeAccess(access);
      return { ...current, accessControl: { ...nextAccessControl, modules } };
    });
  }

  function setProtectedActionAccess(actionKey, access) {
    updatePermissions((current) => {
      const nextAccessControl = { ...defaultAccessControl(), ...(current.accessControl || {}) };
      const protectedActions = { ...(nextAccessControl.protectedActions || {}) };
      protectedActions[actionKey] = normalizeAccess(access);
      return { ...current, accessControl: { ...nextAccessControl, protectedActions } };
    });
  }

  function reorderRole(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ids = orderedRoles.map((role) => role.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRoleSyncReport(null);
    updatePermissions((current) => ({ ...current, roleOrder: next }));
  }

  async function refreshGuildRoles() {
    try {
      setLoading(true);
      setError('');
      setRoleSyncReport(null);
      const rolesRes = await api.getGuildRoles(guildId);
      const nextRoles = normalizeArray(rolesRes, 'roles');
      setRoles(nextRoles);
      setSelectedRoleId((current) => current || nextRoles[0]?.id || '');
      setNotice('✅ Synced latest roles from Discord.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to sync roles from Discord.');
    } finally {
      setLoading(false);
    }
  }

  async function createRole(payload) {
    try {
      setCreatingRole(true);
      setError('');
      setRoleSyncReport(null);
      const response = await api.createGuildRole(guildId, payload);
      const role = response?.role;
      if (!role?.id) throw new Error('Discord did not return the created role.');
      setRoles((current) => [role, ...current.filter((item) => item.id !== role.id)]);
      updatePermissions((current) => ({ ...current, roleOrder: [role.id, ...(current.roleOrder || []).filter((id) => id !== role.id)] }));
      setSelectedRoleId(role.id);
      setFullAccessRole(role.id, true);
      setNotice(`✅ Created Discord role ${role.name}. Save order to persist hierarchy.`);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to create Discord role.');
    } finally {
      setCreatingRole(false);
    }
  }

  async function saveSelectedRole(draft) {
    if (!selectedRole?.id) return;
    try {
      setSavingRole(true);
      setError('');
      const response = await api.updateGuildRole(guildId, selectedRole.id, draft);
      if (Array.isArray(response?.roles)) setRoles(response.roles);
      else if (response?.role) setRoles((current) => current.map((role) => role.id === response.role.id ? response.role : role));
      setNotice(`✅ Updated Discord role ${response?.role?.name || draft.name}.`);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to update Discord role.');
    } finally {
      setSavingRole(false);
    }
  }

  async function removeSelectedRole(role) {
    if (!role?.id) return;
    const confirmed = await goliathDialog.confirm(`Remove Discord role "${role.name}"? This cannot be undone.`, { title: 'Delete Discord Role?', danger: true, confirmLabel: 'Delete Role' });
    if (!confirmed) return;
    try {
      setDeletingRole(true);
      setError('');
      const response = await api.deleteGuildRole(guildId, role.id);
      const nextRoles = Array.isArray(response?.roles) ? response.roles : roles.filter((item) => item.id !== role.id);
      setRoles(nextRoles);
      setSelectedRoleId(nextRoles[0]?.id || '');
      setNotice(`✅ Removed Discord role ${role.name}.`);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to remove Discord role.');
    } finally {
      setDeletingRole(false);
    }
  }

  async function saveAccessControl() {
    try {
      setSavingAccess(true);
      setError('');
      const nextPermissions = { ...permissions, accessControl, syncDiscordRoles: false };
      const saved = await api.saveGeneralSettings(guildId, { ...general, dashboardPermissions: nextPermissions });
      setGeneral(normalizeGeneral(saved?.config || { ...general, dashboardPermissions: nextPermissions }));
      setNotice('✅ Access control saved.');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to save access control.');
    } finally {
      setSavingAccess(false);
    }
  }

  async function saveOrder() {
    try {
      setSavingOrder(true);
      setError('');
      const orderedRoleIds = orderedRoles.map((role) => role.id);
      const nextPermissions = { ...permissions, roleOrder: orderedRoleIds, syncDiscordRoles: false };
      const saved = await api.saveGeneralSettings(guildId, { ...general, dashboardPermissions: nextPermissions });
      setGeneral(normalizeGeneral(saved?.config || { ...general, dashboardPermissions: nextPermissions }));
      const reordered = await api.reorderGuildRoles(guildId, orderedRoleIds);
      if (Array.isArray(reordered?.roles)) setRoles(reordered.roles);
      setRoleSyncReport(reordered?.diagnostics || null);
      const moved = reordered?.diagnostics?.appliedRoles?.length || 0;
      const skipped = reordered?.diagnostics?.skippedRoles?.length || 0;
      setNotice(skipped ? `⚠️ Saved. Discord moved ${moved} role${moved === 1 ? '' : 's'} and skipped ${skipped}.` : `✅ Saved. Discord moved ${moved} role${moved === 1 ? '' : 's'}.`);
    } catch (err) {
      console.error(err);
      setRoleSyncReport(err.diagnostics || null);
      setError(err.message || 'Failed to save role order.');
    } finally {
      setSavingOrder(false);
    }
  }

  function renderRoleSyncReport() {
    if (!roleSyncReport) return null;
    const applied = roleSyncReport.appliedRoles || [];
    const skipped = roleSyncReport.skippedRoles || [];
    const bot = roleSyncReport.bot || {};
    return <div style={{ border: `1px solid ${skipped.length ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.30)'}`, background: skipped.length ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.07)', borderRadius: 16, padding: 14, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}><div><strong>Discord Hierarchy Sync Report</strong><p style={{ margin: '6px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Discord only allows Goliath to move unmanaged roles below its own highest role.</p></div><span style={{ color: skipped.length ? '#fbbf24' : '#86efac', fontWeight: 950 }}>{skipped.length ? 'Action needed' : 'Synced'}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}><SyncStat theme={theme} label="Moved" value={applied.length} /><SyncStat theme={theme} label="Skipped" value={skipped.length} /><SyncStat theme={theme} label="Bot Top Role" value={bot.highestRoleName || 'Unknown'} /><SyncStat theme={theme} label="Manageable" value={bot.manageableRoleCount ?? 0} /></div>
      {skipped.length ? <div style={{ display: 'grid', gap: 8 }}><strong style={{ fontSize: 13 }}>Skipped Roles</strong>{skipped.slice(0, 6).map((role) => <div key={`${role.id}:${role.reason}`} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.22)', borderRadius: 12, padding: 10 }}><strong>{role.name}</strong><p style={{ margin: '4px 0 0', color: theme.mutedText, lineHeight: 1.45 }}>{role.reason}</p></div>)}</div> : null}
    </div>;
  }

  return <PageShell title={page.title} subtitle={selectedGuild ? 'Create, edit and sync Discord roles from one workspace.' : page.emptyDescription} theme={theme}>
    {!selectedGuild ? <EmptyState theme={theme} text="Select a server to manage admin settings." /> : null}
    {selectedGuild ? <div style={{ ...styles.futurePage, gap: 18 }}>
      {error ? <Notice theme={theme} tone="danger">{error}</Notice> : null}
      {notice ? <Notice theme={theme} tone="success">{notice}</Notice> : null}
      {loading ? <LoadingPanel theme={theme} text="Loading admin role workspace..." /> : null}
      {!loading ? <>
        <SectionCard theme={theme}><div style={{ display: 'grid', gap: 18, padding: 'clamp(18px,2.6vw,24px)', border: `1px solid ${theme.primaryBorder || theme.cardBorder}`, borderRadius: 18, background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(15,23,42,0.10) 55%, rgba(168,85,247,0.14))' }}><div><h2 style={{ margin: 0, fontSize: 'clamp(26px,3vw,38px)' }}>Admin Role Workspace</h2><p style={{ margin: '10px 0 0', color: theme.mutedText, lineHeight: 1.6 }}>Create roles, edit existing roles, apply permission presets, control access and sync hierarchy with Discord.</p></div><StatGrid min="min(170px,100%)"><SummaryStat theme={theme} label="Guild Roles" value={roles.length} accent="#c084fc" description="Available Discord roles" /><SummaryStat theme={theme} label="Page Access" value={`${configuredDashboardPages}/${DASHBOARD_ACCESS_ITEMS.length}`} accent="#34d399" description="Dashboard pages configured" /><SummaryStat theme={theme} label="Module Access" value={`${configuredModules}/${MODULE_ACCESS_ITEMS.length}`} accent="#60a5fa" description="Modules configured" /><SummaryStat theme={theme} label="Protected Actions" value={`${configuredProtectedActions}/${PROTECTED_ACTION_ITEMS.length}`} accent="#facc15" description="High-impact actions configured" /></StatGrid></div></SectionCard>
        <Panel theme={theme} title="Role Creator" subtitle="Create new Discord roles using the full permission matrix." open><RoleCreatorFull creating={creatingRole} onCreate={createRole} onSync={refreshGuildRoles} theme={theme} /></Panel>
        <Panel theme={theme} title="Permission Presets" subtitle="Apply a starter access profile to any Discord role, then tweak the cards below if needed." open action={<button type="button" onClick={saveAccessControl} disabled={savingAccess} style={button(theme, 'success', savingAccess)}>{savingAccess ? 'Saving...' : 'Save Access'}</button>}><PermissionPresetsPanel onApply={applyPermissionPreset} roles={orderedRoles} selectedRoleId={selectedRoleId} theme={theme} /></Panel>
        <Panel theme={theme} title="Dashboard Access" subtitle="Control which roles or specific Discord user IDs can access each dashboard page. Empty means guild owner only." open action={<button type="button" onClick={saveAccessControl} disabled={savingAccess} style={button(theme, 'success', savingAccess)}>{savingAccess ? 'Saving...' : 'Save Access'}</button>}>
          <div style={{ display: 'grid', gap: 12 }}>{DASHBOARD_ACCESS_ITEMS.map(([key, label, description]) => <AccessControlCard key={key} access={dashboardPagesAccess[key]} description={description} guildRoles={orderedRoles} onChange={(nextAccess) => setDashboardAccess(key, nextAccess)} theme={theme} title={label} />)}</div>
        </Panel>
        <Panel theme={theme} title="Module Access" subtitle="Control which roles or specific Discord user IDs can access each Goliath module. Empty means guild owner only." open action={<button type="button" onClick={saveAccessControl} disabled={savingAccess} style={button(theme, 'success', savingAccess)}>{savingAccess ? 'Saving...' : 'Save Access'}</button>}>
          <ModuleAccessPanel guildRoles={orderedRoles} modulesAccess={modulesAccess} onChange={setModuleAccess} theme={theme} />
        </Panel>
        <Panel theme={theme} title="Command Access" subtitle="Control which roles or specific Discord user IDs can use key Goliath commands. Empty means guild owner only." open action={<button type="button" onClick={saveAccessControl} disabled={savingAccess} style={button(theme, 'success', savingAccess)}>{savingAccess ? 'Saving...' : 'Save Access'}</button>}>
          <CommandAccessPanel commandAccess={commandAccess} guildRoles={orderedRoles} onChange={setCommandAccess} theme={theme} />
        </Panel>
        <Panel theme={theme} title="Protected Actions" subtitle="Control who can use high-impact dashboard actions. Empty means guild owner only." open action={<button type="button" onClick={saveAccessControl} disabled={savingAccess} style={button(theme, 'success', savingAccess)}>{savingAccess ? 'Saving...' : 'Save Access'}</button>}>
          <ProtectedActionsAccessPanel guildRoles={orderedRoles} onChange={setProtectedActionAccess} protectedActions={protectedActionsAccess} theme={theme} />
        </Panel>
        <Panel theme={theme} title="Role Hierarchy & Editor" subtitle="Drag roles to reorder. Select a role to edit its Discord settings." open action={<button type="button" onClick={saveOrder} disabled={savingOrder} style={button(theme, 'success', savingOrder)}>{savingOrder ? 'Saving...' : 'Save Order'}</button>}>
          <div style={{ display: 'grid', gap: 14 }}>{renderRoleSyncReport()}<div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,0.85fr) minmax(320px,1.15fr)', gap: 14, alignItems: 'start' }}><div style={{ display: 'grid', gap: 10 }}>{orderedRoles.length ? orderedRoles.map((role) => {
            const hasFullAccess = fullAccessRoleIds.includes(role.id);
            const isDragging = draggingRoleId === role.id;
            const isSelected = selectedRole?.id === role.id;
            return <div key={role.id} draggable onClick={() => setSelectedRoleId(role.id)} onDragStart={(event) => { setDraggingRoleId(role.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', role.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); reorderRole(event.dataTransfer.getData('text/plain') || draggingRoleId, role.id); setDraggingRoleId(''); }} onDragEnd={() => setDraggingRoleId('')} style={{ display: 'grid', gridTemplateColumns: '34px auto 1fr auto', gap: 10, alignItems: 'center', border: `1px solid ${isSelected ? 'rgba(96,165,250,0.55)' : hasFullAccess ? 'rgba(34,197,94,0.35)' : theme.cardBorder}`, background: isDragging ? 'rgba(59,130,246,0.18)' : isSelected ? 'rgba(59,130,246,0.12)' : hasFullAccess ? 'rgba(34,197,94,0.08)' : 'rgba(15,23,42,0.18)', borderRadius: 14, padding: 12, cursor: 'grab', opacity: isDragging ? 0.65 : 1 }}><span title="Drag to reorder" style={{ color: theme.mutedText, fontWeight: 950, letterSpacing: '-0.2em', userSelect: 'none' }}>⋮⋮</span><span style={{ width: 10, height: 10, borderRadius: 999, background: role.color || '#94a3b8', display: 'inline-block' }} /><strong>{role.name}</strong><Pill theme={theme} active={hasFullAccess} label="Full Access" onClick={() => setFullAccessRole(role.id, !hasFullAccess)} /></div>;
          }) : <div style={{ color: theme.mutedText }}>No Discord roles found.</div>}</div><RoleEditorCard role={selectedRole} theme={theme} onSave={saveSelectedRole} onDelete={removeSelectedRole} saving={savingRole} deleting={deletingRole} /></div></div>
        </Panel>
      </> : null}
    </div> : null}
  </PageShell>;
}
