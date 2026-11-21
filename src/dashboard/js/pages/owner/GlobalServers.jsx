import { goDashboard } from '../../services/dashboardPath.js';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import useOwnerGuilds from '../../hooks/useOwnerGuilds.js';
import { setStorage } from '../../storage.js';

const GUILD_STORAGE_KEY = 'selected_guild';
const OWNER_MANAGED_GUILD_KEY = 'owner_managed_guild';

function getGuildId(guild) {
  return String(guild?.guildId || guild?.id || '').split(':').pop();
}

function getGuildEnvironment(guild) {
  return String(guild?.environment || guild?.runtimeMode || '').toUpperCase();
}

function getGuildName(guild) {
  return guild?.rawName || guild?.guildName || guild?.name || 'Unknown Guild';
}

function getGuildIcon(guild) {
  return guild?.iconUrl || guild?.iconURL || guild?.icon || guild?.avatarUrl || '';
}

function createManagedGuildPayload(guild) {
  const guildId = getGuildId(guild);
  const guildName = getGuildName(guild);
  const environment = getGuildEnvironment(guild);

  return {
    id: guildId,
    guildId,
    name: guildName,
    guildName,
    rawName: guildName,
    environment,
    runtimeMode: environment,
    iconUrl: getGuildIcon(guild),
    memberCount: guild?.memberCount ?? null,
    status: guild?.status || 'Connected',
    ownerManaged: true,
  };
}

function createOwnerManagedPath(guild, path = '/overview') {
  const payload = createManagedGuildPayload(guild);
  const searchParams = new URLSearchParams();

  searchParams.set('ownerGuildId', payload.guildId);
  searchParams.set('ownerGuildName', payload.guildName);

  if (payload.environment) {
    searchParams.set('ownerGuildEnvironment', payload.environment);
  }

  return `${path}?${searchParams.toString()}`;
}

export default function GlobalServers({ theme, onSelectGuild }) {
  const navigate = useNavigate();
  const { guilds, loading, error } = useOwnerGuilds();

  function openGuildDashboard(guild, path = '/overview') {
  const guildId = getGuildId(guild);

  if (!guildId) return;

  const payload = createManagedGuildPayload(guild);

  setStorage(GUILD_STORAGE_KEY, guildId);
  setStorage(OWNER_MANAGED_GUILD_KEY, payload);

  goDashboard(createOwnerManagedPath(payload, path));
}

  function openOwnerRuntime(guild) {
    const guildId = getGuildId(guild);
    const environment = getGuildEnvironment(guild);
    const searchParams = new URLSearchParams();

    if (environment) searchParams.set('environment', environment);
    if (guildId) searchParams.set('guildId', guildId);

    navigate('/owner/runtime' + (searchParams.toString() ? '?' + searchParams.toString() : ''));
  }

  const card = {
    border: '1px solid ' + theme.cardBorder,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={card}>
        <p style={{ margin: 0, color: '#93c5fd', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Owner Registry
        </p>

        <h1 style={{ margin: '8px 0 0', fontSize: 34 }}>
          Global Servers
        </h1>

        <p style={{ margin: '8px 0 0', color: theme.mutedText }}>
          View every Discord guild connected to Goliath across DEV, BETA and PRODUCTION.
        </p>
      </section>

      {error ? (
        <section style={{ ...card, color: '#fca5a5' }}>
          {error}
        </section>
      ) : null}

      <section style={card}>
        <div style={{ marginBottom: 14, color: theme.mutedText, fontWeight: 800 }}>
          {loading ? 'Loading servers...' : guilds.length + ' connected server(s)'}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                {['Environment', 'Guild', 'Guild ID', 'Members', 'Bot Status', 'Actions'].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      textAlign: 'left',
                      color: theme.mutedText,
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      padding: '0 12px 12px',
                      borderBottom: '1px solid ' + theme.cardBorder,
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {guilds.map((guild) => {
                const environment =
                  guild.environment === 'PRODUCTION'
                    ? 'PROD'
                    : guild.environment || guild.runtimeMode || 'ENV';

                const guildId = getGuildId(guild);
                const rowKey = `${getGuildEnvironment(guild) || 'ENV'}-${guildId}`;

                return (
                  <tr key={rowKey}>
                    <td style={cellStyle(theme)}>{environment}</td>

                    <td style={cellStyle(theme)}>
                      <strong>{getGuildName(guild)}</strong>
                    </td>

                    <td style={cellStyle(theme)}>{guildId}</td>

                    <td style={cellStyle(theme)}>
                      {guild.memberCount ?? 'Unknown'}
                    </td>

                    <td style={cellStyle(theme)}>
                      <span style={{ color: '#86efac', fontWeight: 900 }}>
                        {guild.status || 'Connected'}
                      </span>
                    </td>

                    <td style={cellStyle(theme)}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <ActionButton
                          label="Open Guild"
                          theme={theme}
                          onClick={() => openGuildDashboard(guild, '/overview')}
                        />

                        <ActionButton
                          label="Manage Guild"
                          theme={theme}
                          onClick={() => openGuildDashboard(guild, '/modules')}
                        />

                        <ActionButton
                          label="Modules"
                          theme={theme}
                          onClick={() => openGuildDashboard(guild, '/modules')}
                        />

                        <ActionButton
                          label="Runtime"
                          theme={theme}
                          onClick={() => openOwnerRuntime(guild)}
                        />

                        <ActionButton
                          label="Security"
                          theme={theme}
                          onClick={() => openGuildDashboard(guild, '/security')}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && guilds.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...cellStyle(theme), color: theme.mutedText }}>
                    No global servers found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function cellStyle(theme) {
  return {
    padding: '14px 12px',
    borderBottom: '1px solid ' + theme.cardBorder,
    color: theme.cardText,
    fontSize: 13,
  };
}

function ActionButton({ label, theme, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: '1px solid rgba(59,130,246,0.32)',
        background: 'rgba(37,99,235,0.12)',
        color: '#bfdbfe',
        borderRadius: 10,
        padding: '7px 10px',
        cursor: 'pointer',
        fontWeight: 850,
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}
