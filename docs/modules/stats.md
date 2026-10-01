# Stats

Stats is Goliath's user-facing server reporting and counter-channel module.

## Scope

Stats owns:

- Message activity totals
- Voice activity totals
- Member join and leave totals
- Top users and channels
- Stat counter channels
- Scheduled counter refresh
- Dashboard reporting
- Discord administration
- Runtime health, targeted repair, export and reset

Timeline does not duplicate this responsibility. Timeline is internal audit-history infrastructure used by modules to record administrative and system events. It remains available to internal callers but is no longer presented as a standalone dashboard module.

## Canonical files

- `src/modules/utilityStudio/stats/stats.js` — canonical module entry/export surface
- `src/modules/utilityStudio/stats/statsPanel.js` — Discord administration
- `src/modules/utilityStudio/stats/statsManager.js` — event tracking, scheduler, health, repair, export and reset runtime
- `src/modules/utilityStudio/stats/statsStore.js` — guild configuration, retention and activity persistence
- `src/modules/utilityStudio/stats/statsCounters.js` — Discord counter-channel lifecycle and per-dock scheduling
- `src/server/routes/modules/utilityStudio/stats.js` — dashboard/API surface
- `src/dashboard/js/pages/modules/Stats.jsx` — dashboard UI

`server.js` mounts the live Stats API directly at `/api/stats`.

## Runtime

Stats records configured message, voice and membership activity. Voice sessions are attributed to their active channel, channel moves close the old session and open the new one, and startup reconciliation seeds sessions for users already visible in voice after Goliath reconnects. Historical message, voice and member-snapshot data is pruned according to the configured retention period.

Counter refreshes are queued after relevant activity. Counter docks also maintain their own configured refresh schedules, with in-flight protection to prevent overlapping refresh work.

## Discord administration

The Stats panel supports:

- Enable and disable tracking
- Create the standard counter suite
- Refresh counter channels
- View activity totals
- List configured counters
- Open health and settings controls

## API

The module is mounted at `/api/stats` and exposes:

- Overview and live guild statistics
- Configuration read and update
- Counter-suite setup
- Counter preview, create, update, toggle and delete
- Manual counter refresh
- Health
- Repair
- Export
- Confirmed reset

Stats API routes require an authenticated dashboard user. Bot owners are permitted directly; other users must be members of the target guild with Administrator or Manage Server permission. Audit actor IDs come from the authenticated session rather than request-body input.

## Health and repair

Health checks enabled counter resources, configured categories, counter permissions, deleted role/channel references, datetime timezone configuration, retention configuration and the global Stats scheduler state. Disabled counters do not create false missing-resource faults.

Repair is targeted: missing enabled counter channels are recreated from their stored dock configuration instead of invoking the unrelated default counter suite. Repair then refreshes counters and returns a post-repair health result.

## Completion state

Stats remains `IN_PROGRESS` until startup wiring, remaining failure-path/state-integrity checks, dashboard parity, repository validation and live DEV testing are complete.
