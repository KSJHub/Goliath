# Goodbye

Goodbye manages two separate member-departure surfaces:

- Staff departure logs rendered through Embed Studio
- Private, user-focused departure DMs

## Architecture

Embed Studio owns staff-log presentation only. The Goodbye module owns event detection, audit-log interpretation, variables, delivery, channel selection, DM behaviour, health, analytics, repair, export and reset.

Configuration is stored through GuildManager under:

```text
guild.modules.goodbye
```

Departure DM settings are stored inside the same canonical module section:

```text
guild.modules.goodbye.departureDm
```

No standalone module JSON files are used.

## Runtime

The shared `guildMemberRemove` event determines whether the member:

- Left voluntarily
- Was kicked
- Was banned
- Was removed during a prune

That resolved event is passed to both the staff log renderer and the departure DM service. DM delivery is best-effort and never blocks the staff audit log.

The staff log keeps the locked member-log layout:

```text
👤 MEMBER
📅 TIMELINE
📋 EVENT
📊 SERVER
```

Supported departure variables include:

```text
{departureIcon}
{departureLabel}
{departureReason}
{departureModerator}
{departureModeratorId}
{accountAge}
{membershipDuration}
{leftAt}
```

## Departure DM

The default DM uses the same Goliath visual standard but only includes information useful to the departing member:

```text
👤 YOUR ACCOUNT
📅 YOUR TIME HERE
📋 DEPARTURE
```

Voluntary leave:

- Shows the departure type
- Hides reason and moderator
- Uses a friendly farewell

Kick:

- Shows the departure type
- Shows reason when enabled
- Shows moderator when enabled

Ban:

- Shows the departure type
- Shows reason and moderator when enabled
- Can show an appeal link
- Can show a reference ID

Prune:

- Shows the prune departure type
- Hides moderator and appeal information

Configurable DM settings:

- Enable Departure DM
- DM on voluntary leave
- DM on kick
- DM on ban
- DM on prune
- Include join date
- Include membership duration
- Include reason
- Include moderator
- Include appeal link
- Include reference ID
- Appeal link
- Preview DM
- Send test DM
- Reset DM

DM analytics are tracked independently:

```text
sent
failed
skipped
lastSentAt
lastFailedAt
```

## Discord Admin panel

Open:

```text
/admin → Modules → Goodbye
```

The main panel provides:

- Enable and disable
- Staff log channel selector
- Embed Studio template selector and assignment
- Bot filtering
- Staff-log preview and test delivery
- Dedicated Departure DM settings panel
- Health repair
- JSON export
- Full module reset

The Departure DM panel provides all event and information toggles, preview, test delivery and reset.

## Dashboard

Open the Goodbye module page from the dashboard Modules grid. It provides:

- Staff-log configuration
- Embed Studio assignment
- Staff-log analytics
- Departure DM enable state
- All event toggles
- All included-information toggles
- Appeal link configuration
- DM analytics
- Test DM
- Reset DM
- Health and diagnostics

## Embed Studio

Create or save a customised staff-log template in Embed Studio, then bind it to:

```text
goodbye → goodbye
```

Embed Studio is not responsible for leave, kick, ban or prune logic.

## API

Base path:

```text
/api/goodbye/:guildId
```

Endpoints:

- `GET /overview`
- `PUT /config`
- `PUT /dm-config`
- `PATCH /enabled`
- `POST /template`
- `POST /repair`
- `POST /test`
- `POST /dm-test`
- `POST /dm-reset`
- `POST /reset`
- `GET /export`

## Startup recovery and health

Startup validates the configured log channel, Goliath's permission to view and send messages, Embed Links permission and the active Embed Studio template binding.

Departure DM failure is recorded in DM analytics but is not treated as a staff-log delivery failure because users may disable DMs.

## Doctor

```powershell
npm run audit:goodbye
npm run doctor
```
