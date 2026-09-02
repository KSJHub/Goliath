# Timed Roles

Timed Roles awards Discord roles when a member reaches a configured amount of time in a guild. The member's real Discord join date is the source of tenure.

## Canonical files

```text
src/modules/roleStudio/timedRoles/
├── timedRoles.js
├── timedRolesService.js
├── timedRolesLocks.js
├── timedRolesCompat.js
├── timedRolesHealth.js
└── timedRolesPanel.js

src/server/routes/modules/roleStudio/timedRoles.js
src/events/client/timedRolesStartup.js
src/events/members/timedRolesMemberJoin.js
src/events/roles/timedRolesSync.js
src/dashboard/js/pages/modules/TimedRoles.jsx
```

`timedRoles.js` remains the canonical persistence and duration model. `timedRolesService.js` owns mutation safety, state convergence, scans and scheduler hardening. `timedRolesLocks.js` serializes conflicting guild mutations. `timedRolesCompat.js` safely routes legacy/live consumers through hardened operations and enforces Discord admin security without overwriting persistence primitives.

## Progression

Supported duration units are minutes, hours, days, weeks, months and years. Months and years use calendar-aware calculations.

Progression modes:

- `highest_only` — keep only the highest earned milestone role.
- `keep_all` — keep every earned milestone role.

A milestone may also remove cleanup roles. Cleanup never removes another role that is part of the desired current progression state.

Each Discord award role may belong to only one Timed Roles milestone. Duplicate target-role milestones are rejected because they make progression ambiguous.

## Runtime safety

Timed Roles scans existing members at startup, then checks each guild according to its configured scan interval. New members are checked on join. Bots are ignored unless explicitly enabled.

Progression mutations are serialized per guild. Before a Discord write, Goliath validates Manage Roles, target-role hierarchy, integration-managed roles, server-owner/member manageability and cleanup-role hierarchy. After the mutation, the member is refreshed and the desired final role state is verified. A second corrective pass is attempted before the operation is treated as failed.

Promotion announcements are sent only after confirmed role convergence, so a failed role mutation cannot produce a false success announcement.

## Simulation

Simulation uses the same desired-state model as live progression. It reports both award roles and cleanup/highest-only removals without changing Discord state.

## Discord administration

All `admin:timedRoles` interactions pass through central Goliath admin security. Role selections used to create milestones or configure cleanup roles are validated for safe manageability. Duration values are bounded and units must be supported.

The Discord panel supports milestone creation/editing, enable/disable, cleanup roles, progression mode, scan interval, announcements, member preview, apply-correct-roles, simulation, manual scan, repair and export.

## Dashboard

API base:

```text
/api/timed-roles/:guildId
```

Dashboard routes require an authenticated Discord session. The user must be Goliath's owner or hold Administrator/Manage Server in the target guild. Request-body actor IDs are not trusted. Rule-role selections are validated through the central Goliath permission guard, and scans use the hardened Timed Roles service.

## Role deletion reconciliation

When Discord deletes a configured target role, the corresponding Timed Roles rule is removed immediately. When a cleanup role is deleted, that stale cleanup reference is removed from affected rules.

## Health and Repair

Health checks Manage Roles, target-role existence/manageability, duplicate target bindings, cleanup-role existence/manageability, prior scan errors, announcement-channel validity, View Channel and Send Messages.

Warnings count as unhealthy rather than allowing a green status with known problems.

Repair runs inside the Timed Roles mutation lane. It removes rules whose target role no longer exists, removes invalid/unmanageable cleanup references, and disables/clears an unusable announcement channel.

## Analytics and Sentinel

Timed Roles records scans, simulations, members checked, awarded roles, removed roles, announcements, skipped operations, failed operations and last scan time.

Sentinel classifies Timed Roles as scheduled and covers runtime, interaction, scheduler, persistence and Discord-write signals.

## Source of truth

Configuration remains under:

```text
modules.timedRoles
```

No separate Timed Roles datastore is introduced. Legacy `modules.roles.timedRoles` migration remains owned by `src/core/guild/moduleSectionManager.js`.

## Acceptance

Before production lock, test at minimum:

- existing-member backfill;
- member join progression;
- highest-only and keep-all modes;
- cleanup-role removal;
- duplicate award-role rejection;
- role/member hierarchy failures;
- manual member apply;
- simulation parity;
- announcement success/failure permissions;
- manual and scheduled scan overlap;
- role deletion reconciliation;
- dashboard authorization;
- restart/startup scan recovery;
- Health/Repair.
