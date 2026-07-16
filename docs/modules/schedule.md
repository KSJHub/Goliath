# Schedule

Schedule is Goliath's timezone-aware event planning and attendance module.

## Current foundation

The canonical implementation lives in `src/modules/schedule/`.

- `schedule.js` — storage, events, recurrence, RSVPs, waitlists, reminders, health, repair and startup processing
- `scheduleRoute.js` — module API
- `src/events/schedule/scheduleReady.js` — restart-safe reminder and completion processing

## Event model

An event supports:

- Title and description
- IANA timezone
- Start and end timestamps
- Announcement channel
- Optional voice channel
- Host
- Mention roles
- Capacity
- Going, maybe, declined and waitlist states
- Reminder offsets
- Daily, weekly and monthly recurrence
- Cancellation, duplication and completion state
- Optional future Discord Scheduled Event binding

## Recurrence

Supported recurrence types:

- None
- Daily
- Weekly
- Monthly

Each recurrence can define an interval, occurrence count and optional end date. A completed event creates its next occurrence once, with fresh RSVP and reminder state.

## RSVP and waitlist

When capacity is available, a `going` RSVP reserves a place. When the event is full and waitlists are enabled, additional `going` requests become `waitlist` automatically.

The module stores one RSVP state per Discord user and exposes current counts for every state.

## Reminders and recovery

The Schedule processor runs every minute and immediately after Discord becomes ready.

Reminder offsets are persisted per event. Sent reminder offsets are stored, preventing duplicate reminders after restart.

The processor also:

- Marks ended events complete
- Creates the next recurrence
- Records delivery failures on the event
- Updates module analytics

## Health and repair

Health checks validate:

- Announcement channels
- Timezones
- Send Messages permission
- Previous processing failures

Repair removes missing channel references and clears stale event errors without deleting valid events.

## API foundation

The module route supports:

- Module configuration
- Enable and disable
- Event create, update and delete
- Cancel and duplicate
- RSVP update and removal
- Manual processing
- Health and repair
- Export and reset

The route will be mounted with the dashboard and Discord administration slice.

## Completion state

Schedule is `IN_PROGRESS`.

The canonical runtime foundation is present. Remaining flagship work includes:

- Discord Schedule Studio
- RSVP message deployment and member buttons
- Dashboard calendar and event editor
- Event templates
- Native Discord Scheduled Event synchronisation
- Attendance history and analytics
- Reminder editor and delivery history
- Doctor integration
- Final API mount and acceptance testing
