# Timed Roles

Timed Roles awards Discord roles when a member reaches a configured amount of time in a guild.

## Canonical module

```text
src/modules/timedroles/
├── timedRoles.js
├── timedRolesPanel.js
└── timedRolesRoute.js
```

`timedRoles.js` is the source of truth for storage, duration calculations, scans, health, repair, analytics and startup scheduling.

## Example

A guild can configure:

```text
Name: Veteran
Award role: @Veteran
Duration: 1 year
Remove roles: @Regular
```

Goliath uses the member's real Discord guild join date. Existing members who already meet the milestone are awarded the role during the next scan.

## Supported durations

- Minutes
- Hours
- Days
- Weeks
- Months
- Years

Months and years use calendar-aware date calculations.

## Runtime behaviour

- Scans all existing members at startup.
- Runs periodic scans using the guild's configured scan interval.
- Checks new members when they join.
- Ignores bots unless `includeBots` is enabled.
- Does not assign a role a member already has.
- Can remove earlier progression roles when a later milestone is reached.
- Validates `Manage Roles`, managed roles and Discord role hierarchy.

## Discord administration

Open **Admin → Modules → Timed Roles**.

Discord controls support:

- Creating a milestone with a native role selector.
- Editing milestone name and duration.
- Enabling or disabling individual milestones.
- Selecting cleanup roles.
- Changing the scan interval.
- Enabling or disabling the module.
- Including or excluding bots.
- Running a scan immediately.
- Health repair.
- Export and reset.

## Dashboard

The dashboard page is available at:

```text
/timed-roles
```

API base:

```text
/api/timed-roles
```

The dashboard supports configuration, milestone management, analytics, health, repair, manual scans and export.

## Health and repair

Health verifies:

- Goliath has `Manage Roles`.
- Target roles still exist.
- Target roles are below Goliath's highest role.
- Target roles are not managed integration roles.
- Cleanup roles still exist.
- Previous runtime failures are visible.

Repair removes rules whose target role no longer exists and removes invalid cleanup role references.

## Analytics

Timed Roles records:

- Scans
- Members checked
- Roles awarded
- Roles removed
- Skipped operations
- Failed operations
- Last scan time

## Legacy role migration

At startup, `src/core/guild/legacyRolesMigration.js` performs a one-time migration of the removed generic `roles` configuration section:

- Legacy timed rules are converted into canonical Timed Roles rules.
- Legacy join-role rules are merged into Auto Roles.
- Previously deployed button panels are preserved under Reaction Roles compatibility storage.
- The obsolete `modules.roles` section is deleted only after the conversion completes.
- Completion and item counts are recorded at `modules._migrations.legacyRolesV1`.

Invalid timed rules without a usable role ID are skipped and counted in the migration report.

## Startup

The canonical startup operation is:

```js
require('./src/modules/timedroles/timedRoles').startup(client)
```

Only the canonical Timed Roles scheduler should run. The deleted generic Roles module must not be reintroduced.
