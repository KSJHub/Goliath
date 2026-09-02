# Temporary Roles

Temporary Roles is Goliath's time-limited role assignment system inside Role Studio.

Canonical guild state is stored in:

```text
guild.modules.temporaryRoles
```

The module uses the same environment-aware guild JSON source of truth as the rest of Goliath.

## Runtime files

```text
src/modules/roleStudio/temporaryRoles/
├── temporaryRoles.js
├── temporaryRolesHealth.js
├── temporaryRolesLocks.js
├── temporaryRolesPanel.js
└── temporaryRolesService.js
```

- `temporaryRoles.js` owns normalized persistence and compatibility helpers.
- `temporaryRolesService.js` is the live mutation boundary for assign, renew, remove, expiry and lifecycle reconciliation.
- `temporaryRolesLocks.js` serializes conflicting mutations per guild.
- `temporaryRolesHealth.js` owns diagnostics and repair.
- `temporaryRolesPanel.js` owns Discord administration.

Dashboard API:

```text
/api/temporary-roles/:guildId
```

## Assignment lifecycle

A temporary assignment records:

- assignment ID
- member ID
- role ID
- reason
- assigning administrator
- assignment time
- expiry time
- current status
- retry/backoff state when expiry fails
- removal source

Assigning the same active member/role pair renews the existing assignment instead of creating a duplicate.

Before a Discord role write, Goliath verifies:

- Temporary Roles is enabled for new assignments
- the role exists
- the role is not `@everyone`
- the role is not integration-managed
- Goliath has Manage Roles
- the role is below Goliath
- the member exists
- the member is not Goliath
- the member is not the server owner
- the member is manageable by Goliath

Discord state is re-fetched after assignment/removal. Persistence is only updated after Discord reaches the requested state. If persistence fails after a Discord write, Goliath attempts to roll the Discord change back so role state and stored assignment state do not silently diverge.

## Expiry scheduler

Temporary Roles registers a Sentinel scheduler and scans once per minute.

Expiry mutations share the same per-guild mutation lane as admin assign, renew and remove operations, preventing a role from being renewed while another path is simultaneously expiring it.

Failed expiry operations are recorded as `failed` and retried with bounded exponential backoff up to one hour instead of increasing the failed counter every minute indefinitely.

The `removeExpiredOnStartup` setting controls the startup sweep. Normal scheduled scans continue after startup while the module is enabled.

## Discord lifecycle reconciliation

Temporary Roles listens for:

- `guildMemberUpdate` — if a temporary role is manually removed, the active assignment is closed as externally removed.
- `guildMemberRemove` — active/failed assignments belonging to a departed member are closed.
- `roleDelete` — active/failed assignments referencing a deleted role are closed.

These hooks use the same mutation lane as normal Temporary Roles actions.

## Health and repair

Health checks include:

- Manage Roles permission
- missing members
- missing roles
- member manageability
- role hierarchy/manageability
- missing physical role on an active assignment
- invalid expiry timestamps
- overdue active assignments
- failed expiry operations and retry state
- duplicate active member/role pairs left by legacy race conditions

Health is considered healthy only when both hard issues and warnings are clear.

Repair can:

- archive orphaned assignments
- collapse legacy duplicate active assignments
- restore a missing role for an otherwise valid active assignment
- run the hardened expiry scanner

## Security

Discord Temporary Roles controls use Goliath's central admin interaction security boundary.

Dashboard routes require an authenticated Discord session. The authenticated user must be the Goliath bot owner or have Administrator / Manage Server in the target guild. Request-body actor IDs are not trusted for authorization.

## Analytics

Tracked counters include:

- assigned
- renewed
- expired
- removed early
- member departures
- external/manual role removals
- deleted referenced roles
- failed expiry operations
- last expiry scan

## Acceptance

Before live-locking Temporary Roles, real-guild acceptance should cover:

- assign a temporary role
- renew the same assignment without duplication
- manual early removal
- scheduled expiry
- expiry while simultaneously renewing
- member above/below Goliath hierarchy
- role above/below Goliath hierarchy
- member departure
- external/manual role removal
- role deletion
- failed expiry + retry backoff
- restart persistence of retry metadata
- Health/Repair duplicate cleanup
- dashboard authorization
- Discord admin authorization
- module disable/enable behavior
