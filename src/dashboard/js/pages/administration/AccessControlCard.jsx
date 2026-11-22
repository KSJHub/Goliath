import { ThemedSelect } from '../../ui/DiscordResourceSelects.jsx';
import React, { useMemo, useState } from 'react';

function input(theme) {
  return {
    width: '100%',
    border: `1px solid ${theme.inputBorder || theme.cardBorder}`,
    background: theme.inputBg || 'rgba(10,18,35,0.96)',
    color: theme.inputText || theme.cardText,
    borderRadius: 12,
    padding: '10px 12px',
    outline: 'none',
    fontWeight: 800,
    minWidth: 0,
  };
}

function actionButton(theme, disabled = false) {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: 'rgba(148,163,184,0.10)',
    color: theme.cardText,
    borderRadius: 12,
    padding: '10px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontWeight: 950,
  };
}

function normaliseAccess(access = {}) {
  return {
    roles: Array.isArray(access.roles) ? access.roles : [],
    users: Array.isArray(access.users) ? access.users : [],
  };
}

export default function AccessControlCard({ access, description, guildRoles = [], onChange, theme, title }) {
  const safeAccess = normaliseAccess(access);
  const [roleToAdd, setRoleToAdd] = useState('');
  const [userToAdd, setUserToAdd] = useState('');

  const availableRoles = useMemo(() => guildRoles.filter((role) => role?.id && !safeAccess.roles.includes(role.id)), [guildRoles, safeAccess.roles]);

  function setAccess(next) {
    onChange?.({
      roles: [...new Set(next.roles || [])],
      users: [...new Set((next.users || []).map((id) => String(id).trim()).filter(Boolean))],
    });
  }

  function roleName(roleId) {
    return guildRoles.find((role) => role.id === roleId)?.name || roleId;
  }

  function addRole() {
    if (!roleToAdd) return;
    setAccess({ ...safeAccess, roles: [...safeAccess.roles, roleToAdd] });
    setRoleToAdd('');
  }

  function addUser() {
    const cleanId = userToAdd.trim();
    if (!cleanId || safeAccess.users.includes(cleanId)) return;
    setAccess({ ...safeAccess, users: [...safeAccess.users, cleanId] });
    setUserToAdd('');
  }

  function removeRole(roleId) {
    setAccess({ ...safeAccess, roles: safeAccess.roles.filter((id) => id !== roleId) });
  }

  function removeUser(userId) {
    setAccess({ ...safeAccess, users: safeAccess.users.filter((id) => id !== userId) });
  }

  const configured = safeAccess.roles.length + safeAccess.users.length;

  return <div style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.18)', borderRadius: 16, padding: 14, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div>
        <strong style={{ fontSize: 17 }}>{title}</strong>
        {description ? <p style={{ margin: '6px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>{description}</p> : null}
      </div>
      <span style={{ border: `1px solid ${configured ? 'rgba(34,197,94,0.32)' : theme.cardBorder}`, background: configured ? 'rgba(34,197,94,0.09)' : 'rgba(15,23,42,0.22)', color: configured ? '#86efac' : theme.mutedText, borderRadius: 999, padding: '7px 10px', fontWeight: 950, fontSize: 12 }}>{configured ? `${configured} allowed` : 'Owner only'}</span>
    </div>

    <div style={{ display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 13 }}>Allowed Roles</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 10 }}>
        <ThemedSelect theme={theme} value={roleToAdd} onChange={(event) => setRoleToAdd(event.target.value)} style={input(theme)}>
          <option value="">+ Add role...</option>
          {availableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </ThemedSelect>
        <button type="button" onClick={addRole} disabled={!roleToAdd} style={actionButton(theme, !roleToAdd)}>Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {safeAccess.roles.length ? safeAccess.roles.map((roleId) => <button key={roleId} type="button" onClick={() => removeRole(roleId)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(59,130,246,0.12)', color: theme.cardText, borderRadius: 999, padding: '8px 11px', fontWeight: 900, cursor: 'pointer' }}>{roleName(roleId)} ×</button>) : <span style={{ color: theme.mutedText, fontWeight: 800 }}>No roles added.</span>}
      </div>
    </div>

    <div style={{ display: 'grid', gap: 10 }}>
      <strong style={{ fontSize: 13 }}>Allowed Users</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) auto', gap: 10 }}>
        <input value={userToAdd} onChange={(event) => setUserToAdd(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addUser(); }} placeholder="Discord user ID" style={input(theme)} />
        <button type="button" onClick={addUser} disabled={!userToAdd.trim()} style={actionButton(theme, !userToAdd.trim())}>Add</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {safeAccess.users.length ? safeAccess.users.map((userId) => <button key={userId} type="button" onClick={() => removeUser(userId)} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(168,85,247,0.12)', color: theme.cardText, borderRadius: 999, padding: '8px 11px', fontWeight: 900, cursor: 'pointer' }}>User {userId} ×</button>) : <span style={{ color: theme.mutedText, fontWeight: 800 }}>No users added.</span>}
      </div>
    </div>
  </div>;
}
