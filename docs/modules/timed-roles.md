# Timed Roles

Timed Roles awards Discord roles when a member reaches a configured amount of time in a guild.

## Canonical module

```text
src/modules/roleStudio/timedRoles/
├── timedRoles.js
├── timedRolesHealth.js
└── timedRolesPanel.js

src/server/routes/modules/roleStudio/timedRoles.js
src/events/client/timedRolesStartup.js
src/events/timedroles/timedRolesMemberJoin.js
src/dashboard/js/pages/modules/TimedRoles.jsx
```

`timedRoles.js` is the source of truth for configuration storage, duration calculations, progression, scans, analytics and startup scheduling.

`timedRolesHealth.js` is the single health and repair service used by the Discord panel, Role Studio and dashboard API.

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

## Progression modes

Timed Roles supports two progression modes:

- `highest_only` — keep only the highest earned milestone role.
- `keep_all` — keep every earned milestone role.

A milestone can also define cleanup roles that are removed when that milestone is applied. The milestone's own award role is rejected from its cleanup-role set.

## Runtime behaviour

- Scans all existing members at startup.
- Runs periodic scans using the guild's configured scan interval.
- Checks new members when they join.
- Ignores bots unless `includeBots` is enabled.
- Does not assign a role a member already has.
- Can remove earlier progression roles when a later milestone is reached.
- Validates `Manage Roles`, managed roles and Discord role hierarchy.
- Can announce newly awarded milestones in a configured text channel.

## Promotion announcements

Promotion announcements are optional. When enabled, a guild can configure an announcement channel and message.

Supported placeholders:

- `{member}`
- `{role}`
- `{duration}`
- `{server}`

Allowed mentions are restricted to the promoted member and awarded role.

## Discord administration

Open **Admin → Modules → Timed Roles**.

Discord controls support:

- Creating a milestone with a native role selector.
- Editing milestone name and duration.
- Enabling or disabling individual milestones.
- Selecting cleanup roles.
- Choosing highest-only or keep-all progression.
- Changing the scan interval.
- Enabling or disabling the module.
- Including or excluding bots.
- Configuring promotion announcements.
- Previewing a member's current and next milestone.
- Applying the correct progression roles to a selected member.
- Simulating a guild scan without changing roles.
- Running a scan immediately.
- Health repair.
- Export.

## Dashboard

The dashboard page is available at:

```text
/timed-roles
```

API base:

```text
/api/timed-roles
```

The dashboard supports:

- Enable and disable.
- Milestone creation, editing, enabling, disabling and deletion.
- Award-role and cleanup-role selection.
- Minutes, hours, days, weeks, months and years.
- Highest-only and keep-all progression.
- Bot inclusion settings.
- Scan interval configuration.
- Promotion announcement channel and message configuration.
- Analytics and health status.
- Health repair.
- Manual scans.
- JSON export.

## Health and repair

Health verifies:

- Goliath has `Manage Roles`.
- Target roles still exist.
- Target roles are below Goliath's highest role.
- Target roles are not managed integration roles.
- Cleanup roles still exist.
- Cleanup roles are manageable by Goliath.
- Promotion announcement channels are valid.
- Goliath can send messages in the configured announcement channel.
- Previous runtime failures are visible.

Repair removes rules whose target role no longer exists, removes invalid cleanup-role references and clears invalid announcement-channel references.

## Analytics

Timed Roles records:

- Scans
- Simulations
- Members checked
- Roles awarded
- Roles removed
- Promotions announced
- Skipped operations
- Failed operations
- Last scan time

## Guild source of truth

Timed Roles persists through the canonical guild configuration system under:

```text
modules.timedRoles
```

Module enabled state is managed through the same guild source of truth. Timed Roles must not introduce a separate JSON store or database-backed configuration source.

## Legacy Role Studio compatibility

The old standalone migration runner has been retired. Compatibility for an older guild JSON that still contains `modules.roles` now lives in:

```text
src/core/guild/moduleSectionManager.js
```

When a canonical Role Studio module is first loaded, the manager can absorb the matching legacy payload:

- `modules.roles.timedRoles` → `modules.timedRoles.rules`
- `modules.roles.joinRoles` → `modules.autoRoles.joinRoles`
- `modules.roles.reactionPanels` → `modules.reactionRoles.panels`

The legacy `modules.roles` object is removed only after every non-empty legacy payload has a corresponding canonical module section. This preserves compatibility for old guild data while ensuring the retired generic role section does not remain after absorption.

The retired generic `modules.roles` section is no longer seeded by guild defaults and must not be reintroduced as an active source of truth.

## Startup

The canonical startup operation is registered by:

```text
src/events/client/timedRolesStartup.js
```

which calls:

```js
require('../../modules/roleStudio/timedRoles/timedRoles').startup(client)
```

Only the canonical Timed Roles scheduler should run.