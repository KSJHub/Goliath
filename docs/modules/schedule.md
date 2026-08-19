# Schedule

Schedule is Goliath's timezone-aware event planning and attendance module. Its reference experience is the Sesh Discord bot, adapted to Goliath's three-command architecture.

Schedule does **not** register `/schedule`, `/event`, `/create`, `/list` or other module-specific slash commands. Administration lives under `/admin -> Utility Studio -> Schedule`; members interact with deployed event messages. Future personal event views belong under `/user`.

## Canonical implementation

The module remains in the existing seven-file folder:

```text
src/modules/utilityStudio/schedule/
├── schedule.js
├── scheduleDeployment.js
├── scheduleHealth.js
├── scheduleInteractions.js
├── schedulePanel.js
├── scheduleStartup.js
└── scheduleTracking.js
```

`guild.modules.schedule` is the only Schedule configuration/data source of truth. The normal runtime environment selects the correct guild JSON for dev, beta or production.

`schedule.js` is canonical for event state, recurrence, RSVP state, reminders and processing. `scheduleTracking.js` delegates to it rather than maintaining a second processor. `scheduleInteractions.js` is a compatibility surface that delegates to `scheduleDeployment.js`.

## Poll-powered event planning

Schedule integrates with the existing Community Studio Polls module rather than implementing a second voting engine.

Poll vote data remains canonical under:

```text
guild.modules.polls
```

Schedule stores only planning-session metadata and poll references under its own section, for example:

```text
guild.modules.schedule.planningGroups.<groupId>
├── dayPollId
├── timePollId
├── activityPollId
└── eventId
```

Planning polls carry `sourceModule: schedule`, a planning purpose (`schedule_day`, `schedule_time`, or `schedule_activity`) and the Schedule planning group ID.

From `/admin -> Utility Studio -> Schedule -> Plan Event`, admins can:

- Create a day-availability poll from `YYYY-MM-DD | label` options.
- Create a time-availability poll from `HH:mm | label` options.
- Create an optional game/activity poll.
- Deploy those polls to a selected channel.
- Refresh ranked results.
- View the strongest **same-member** day/time/activity combinations.
- Create a real Schedule event from the strongest combination.

The planner does not simply compare independent totals. Because Polls stores the Discord user IDs behind each option, Schedule calculates set intersections to show how many of the **same members** selected a particular day, time and activity.

Example:

```text
Saturday · 20:00 · Call of Duty — 12 shared members
Friday   · 21:00 · Call of Duty — 9 shared members
Saturday · 21:00 · Fortnite     — 8 shared members
```

### Multi-select polls

Polls now supports a `multi_select` render mode using a Discord select menu. A member can choose every option that applies in one interaction, such as Monday + Wednesday + Friday or several acceptable games.

Submitting the selector replaces that member's previous selection set atomically. The canonical Polls engine remains responsible for concurrency, persistence, live result rendering, close/repair behaviour and analytics.

Standard Polls button voting remains supported and unchanged for normal polls.

## Sesh-style event model

An event supports:

- Title, description and configurable embed colour
- IANA timezone
- Start/end time and duration
- Announcement/event channel
- Optional voice or stage channel
- Optional location
- Host
- Roles mentioned on deployment
- Roles allowed or blocked from RSVP
- Capacity and waitlist
- Custom RSVP options
- Optional attendee role per RSVP option
- RSVP close time
- Member personal reminder offsets
- Event/channel reminders
- Custom event notifications
- Hourly, daily, weekly, monthly and yearly recurrence
- Repeat interval, occurrence limit and end date
- Optional weekly day selection
- Auto Join Next for recurring attendees
- Optional event thread
- Optional Discord native scheduled-event mirror
- Cancellation, duplication and completion state
- Reusable event templates

## RSVP behaviour

The default options are Going, Maybe and Decline, but admins can define custom options. Each option can be marked as an attendee option and can optionally grant a Discord role.

Only attendee options consume capacity. When an attendee tries to join a full event and waitlisting is enabled, that member is placed on the waitlist. When an attendee place becomes available, the oldest waitlisted member is promoted automatically.

Role restrictions can allow only selected roles or explicitly block selected roles from RSVPing.

Members can manage their RSVP from the deployed event message, including:

- Change or clear RSVP
- View attendees
- Configure personal reminders
- Enable/disable Auto Join Next on repeating events
- Add the event to Google Calendar through a generated calendar link

When overlap warnings are enabled, Goliath warns a member if an attendee RSVP overlaps another event they are already attending.

## Recurrence and timezone handling

Supported repeat types:

- None
- Hourly
- Daily
- Weekly
- Monthly
- Yearly

Recurrence stores the event timezone and advances the event using local-time parts, preserving the intended wall-clock time across daylight-saving changes where the IANA timezone applies.

Repeating events may define interval, occurrence count, end date, weekly day selection and Auto Join Next permission.

Members who enabled Auto Join Next carry their RSVP and personal reminder configuration to the next occurrence. Other RSVP state is reset.

## Reminders and notifications

The processor runs every minute and immediately after Discord becomes ready.

Schedule supports three notification layers:

1. Server/channel reminder offsets stored on the event.
2. Per-member reminder offsets delivered by DM to members who RSVP.
3. Custom event notifications with configurable fire time, title, description, channel and mention roles.

Sent reminder/notification state is persisted so restarts do not intentionally send the same reminder again.

Notification placeholders include `{event}`, `{relative}`, `{time}` and `{host}`.

## Event threads and Discord native events

Events can create a Discord thread from the deployed event message. Configuration includes a custom thread title, optional attendee auto-add behaviour, auto-archive duration and stored thread ID.

An event can optionally mirror to Discord's native Scheduled Events system. The module creates or updates the native event when the Goliath event is deployed/updated, provided Goliath has `Manage Events`.

The Goliath RSVP post remains canonical for Goliath attendance state.

## Event templates

Admins can save an event as a reusable template and create a fresh event from that template. New events reset runtime state such as RSVPs, reminder delivery state, deployment IDs, native-event IDs and event-thread IDs.

## Discord admin

Open:

```text
/admin -> Utility Studio -> Schedule
```

The Schedule Studio contains Home/event selector, Plan Event, Create/Edit Event, Event Setup, RSVP & Roles, Repeat & Reminders, Templates, deployment/native sync, cancel/duplicate and Health.

No standalone Schedule slash command is registered.

## Dashboard and API

Dashboard route:

```text
/schedule
```

API base:

```text
/api/schedule/:guildId
```

The API supports module settings, event CRUD, deployments, native sync, RSVP management, member reminders, templates, processing, health/repair, export and reset. Planning-group data is part of the canonical Schedule config returned by the existing Schedule API; poll votes remain in the Polls API/source of truth.

## Health and repair

Health validates event and voice channels, timezones, Send Messages / Embed Links, referenced roles, attendee role hierarchy/manageability, Manage Events for native mirroring, Create Public Threads for threads, stored native-event/thread references and previous processing errors.

Repair removes dead resource references, clears stale event errors and preserves valid event configuration.

## External Sesh features

Goliath matches the core Discord event/RSVP experience being used as the Sesh reference. Full OAuth-based Google Calendar bidirectional account synchronisation is not implemented; Goliath currently provides a member-facing Add to Calendar link instead.

Polls remain a separate Community Studio module, but Schedule now consumes them for Sesh-style availability/time/activity planning instead of duplicating the Polls engine.

## Acceptance state

Repository-side Schedule + Polls planning integration is implemented. Do not mark Schedule as fully working/locked until live-guild tests cover multi-select poll submission/editing, day/time/activity planning polls, same-member combination results, event creation from the winning combination, event creation/editing, deployment, custom RSVP options, attendee roles, role restrictions, capacity/waitlist promotion, personal reminders, recurrence/Auto Join Next, event threads, native event mirroring, templates, dashboard editing, restart recovery and health/repair.