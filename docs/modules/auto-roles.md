# Auto Roles

Auto Roles assigns configured roles to new members and, optionally, bots when they join a Discord server.

## Storage

All configuration is stored through GuildManager under:

```text
guild.modules.autoRoles
```

No standalone JSON files or separate module databases are used.

## Configuration

The module supports:

- Enable or disable Auto Roles
- Join roles for human members
- Bot roles for bot accounts
- Apply-to-bots behaviour
- Startup role reapplication
- Audit logging preference
- Assignment analytics

## Runtime

Auto Roles runs from the shared member-join event and does not create duplicate Discord listeners. Before assigning a role, Goliath verifies that:

- The role still exists
- The role is not managed by Discord or an integration
- Goliath has Manage Roles
- Goliath's highest role is above the configured role
- The target member is manageable

## Startup recovery

The startup service validates every configured role and reports:

- Missing roles
- Unmanageable roles
- Missing Manage Roles permission
- Servers with no configured roles

When `reapplyOnStartup` is enabled, Auto Roles can reapply configured roles to eligible existing members.

## Discord Admin panel

Open:

```text
/admin → Modules → Auto Roles
```

The panel provides:

- Join-role and bot-role selectors
- Enable and disable controls
- Apply-to-bots toggle
- Reapply-on-startup toggle
- Health and hierarchy warnings
- Repair configuration
- Reapply roles now
- JSON export
- Full reset

## Dashboard

The Auto Roles dashboard provides the same core controls as the Discord Admin panel, plus analytics and detailed role-health information.

## API

Base path:

```text
/api/auto-roles/:guildId
```

Available endpoints:

- `GET /overview`
- `PUT /config`
- `PATCH /enabled`
- `PATCH /settings`
- `PUT /roles/join`
- `PUT /roles/bots`
- `POST /repair`
- `POST /reapply`
- `POST /reset`
- `GET /export`

## Analytics

Stored analytics include:

- Roles assigned
- Failed assignments
- Skipped assignments
- Human members processed
- Bots processed
- Last processed time
- Last successful assignment
- Last failed assignment

## Health and repair

The health report validates configured roles against the live Discord guild. The repair action removes missing or unmanageable role references while preserving valid configuration.

## Doctor

Run the module audit directly:

```powershell
npm run audit:auto-roles
```

Run the complete project validation:

```powershell
npm run doctor
```
