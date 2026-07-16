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

Timeline does not duplicate this responsibility. Timeline is internal audit-history infrastructure used by modules to record administrative and system events. It remains available to internal callers but is no longer presented as a standalone dashboard module.

## Canonical files

- `src/modules/stats/stats.js` — canonical module entry
- `src/modules/stats/statsPanel.js` — Discord administration
- `src/modules/stats/statsRoute.js` — dashboard and API surface
- `src/modules/stats/statsHealth.js` — health, repair, export and reset
- `src/modules/stats/statsManager.js` — event tracking and counter refresh runtime
- `src/modules/stats/statsStore.js` — guild configuration and activity data
- `src/modules/stats/statsCounters.js` — Discord counter-channel lifecycle

`src/server/routes/stats.js` is temporarily a one-line compatibility shim until `server.js` is pointed directly at the canonical route.

## Runtime

Stats records configured message, voice and membership activity. Counter refreshes are queued after relevant activity and are also refreshed on a recurring schedule.

## Discord administration

The Stats panel supports:

- Enable and disable tracking
- Create the standard counter suite
- Refresh counter channels
- View activity totals
- List configured counters

## API

The module is mounted at `/api/stats` and exposes:

- Overview and live guild statistics
- Configuration read and update
- Counter-suite setup
- Manual counter refresh
- Health
- Repair
- Export
- Confirmed reset

## Health and repair

Health validates configured counter channels and retention settings. Repair recreates missing standard counters when required and refreshes every tracked counter channel.

## Completion state

Stats remains `IN_PROGRESS` until the compatibility route shim is removed and dashboard controls for health, repair, export and reset are verified. Timeline remains internal infrastructure and is not a standalone user-facing module.
