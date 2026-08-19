# Welcome

Welcome is the canonical Goliath member-welcome module. It contains two delivery modes inside one Message Studio module: Instant Welcome and Scheduled Welcome.

## Canonical structure

The Welcome folder is intentionally capped at eight files:

```text
src/modules/messageStudio/welcome/
├── welcome.js
├── welcomePanel.js
├── welcomeAvatarSync.js
├── scheduledWelcome.js
├── scheduledWelcomeScheduler.js
├── scheduledWelcomeQueue.js
├── scheduledWelcomeMessage.js
└── scheduledWelcomeHealth.js
```

Responsibilities:

- `welcome.js` — existing Instant Welcome runtime, guild configuration, templates, delivery, analytics and instant health/repair.
- `welcomePanel.js` — the single Discord admin panel for the complete Welcome module, including Instant and Scheduled pages.
- `welcomeAvatarSync.js` — Instant Welcome avatar/message synchronisation.
- `scheduledWelcome.js` — Scheduled Welcome configuration, analytics and run orchestration.
- `scheduledWelcomeScheduler.js` — timezone-aware daily scheduler and missed-run recovery.
- `scheduledWelcomeQueue.js` — queue-role member discovery and safe queue-role removal.
- `scheduledWelcomeMessage.js` — scheduled batch variables, mention safety and Discord-length-aware batching.
- `scheduledWelcomeHealth.js` — Scheduled Welcome diagnostics and repair.

No second Welcome module, standalone Scheduled Welcome module, duplicate panel or standalone module JSON is used.

## Storage

All Welcome configuration remains under the guild JSON source of truth:

```text
guild.modules.welcome
```

Instant Welcome keeps its established fields directly in that section. Scheduled Welcome is nested at:

```text
guild.modules.welcome.scheduled
```

Embed templates and bindings remain under:

```text
guild.embedStudio.templates
guild.embedStudio.bindings.welcome.welcome
```

## Instant Welcome

Instant Welcome runs from the shared member join event. The join order is:

```text
Verification
→ Auto Roles
→ Instant Welcome
→ Admin join log
```

It supports:

- Public welcome messages
- Optional direct-message welcomes
- New-member mentions
- Configurable role notifications
- Bot filtering
- Embed Studio template bindings
- Member/server template variables
- Delivery analytics
- Health and repair

Instant role notifications use restricted Discord `allowedMentions`; unrestricted role, `@everyone` and `@here` parsing is never enabled.

Instant variables include:

```text
{user}
{userMention}
{username}
{userId}
{userAvatar}
{memberAvatar}
{guild}
{guildName}
{server}
{serverName}
{guildIcon}
{guildBanner}
{memberCount}
{createdAt}
{joinedAt}
{timestamp}
{welcomeRoles}
{welcomeRoleMentions}
{welcomeRolesNoPing}
```

## Scheduled Welcome

Scheduled Welcome is role-driven rather than join-event-driven.

```text
Any module or admin gives a member the configured queue role
→ member waits in the queue
→ configured local time is reached
→ Scheduled Welcome finds all waiting members
→ Goliath posts one or more safe welcome batches
→ successfully welcomed members have the queue role removed
```

The source of the queue role does not matter. It can come from:

- Verification
- Auto Roles
- Timed Roles
- Temporary Roles
- Manual Discord role assignment
- Future Goliath workflows

Scheduled Welcome therefore does not import or duplicate the role-assignment logic of those modules.

Scheduled settings include:

```text
enabled
queueRoleId
channelId
time
timezone
message
pingMembers
removeQueueRole
ignoreBots
batchSize
completedMemberIds
analytics
```

Scheduled message variables are:

```text
{members}
{memberNames}
{memberCount}
{server}
{guild}
{role}
{date}
```

### Delivery safety

Queue roles are removed only after the Discord message containing that member has been sent successfully.

If a message batch fails:

- that batch keeps its queue roles;
- successful batches are not repeated;
- the failed batch remains eligible for another scheduler check the same day.

If the message succeeds but a queue-role removal fails, the member is recorded in `completedMemberIds`. This prevents duplicate welcomes while Health/Repair retries the role cleanup. Once the role is gone, the completed marker is cleaned automatically.

Batch sizes are reduced automatically when necessary so rendered content never relies on truncation to fit Discord's 2,000-character message limit.

### Scheduling

The scheduler checks once per minute. It stores a local run date rather than running a simple 24-hour interval.

This provides:

- configured `HH:MM` local delivery;
- IANA timezone support such as `Europe/London`;
- daylight-saving-aware execution;
- no interval drift;
- missed-run recovery after restarts;
- one completed automatic run per local day unless failed batches remain to retry.

The scheduler is installed at client startup even when Welcome is currently disabled, so enabling Welcome later does not require a bot restart.

## Discord Admin panel

Open:

```text
/admin → Modules → Welcome
```

There is one panel implementation: `welcomePanel.js`.

Welcome Home links to:

- Instant Welcome
- Scheduled Welcome
- Instant mention settings

Instant controls include channel, Embed Studio template, DM, member/role pings, bot filtering, preview/test, repair and template assignment.

Scheduled controls include queue role, destination channel, daily time, timezone, message, member pings, queue-role cleanup, bot filtering, queue preview, Run Now and health/repair.

## Dashboard

The existing Welcome dashboard manages both modes on one page.

It exposes Instant settings and analytics plus Scheduled queue role, channel, time, timezone, message, queue preview, Run Now, cleanup controls, analytics and health.

## API

Base path:

```text
/api/welcome/:guildId
```

Instant/general endpoints:

```text
GET  /overview
PUT  /config
PATCH /enabled
POST /template
POST /repair
POST /test
POST /reset
GET  /export
```

Scheduled endpoints:

```text
GET  /scheduled
PUT  /scheduled
GET  /scheduled/queue
POST /scheduled/run
POST /scheduled/repair
```

## Health and repair

Instant health validates its configured channel, permissions, template bindings and notification roles.

Scheduled health validates:

- queue role existence;
- destination channel existence;
- View Channel / Send Messages permissions;
- Manage Roles when queue-role cleanup is enabled;
- role hierarchy/manageability;
- welcomed members whose queue role still needs cleanup.

Scheduled Repair clears dead channel/role references where appropriate and retries stuck post-welcome queue-role removals without re-welcoming those members.

## Verification

Use the repository-wide checks:

```powershell
npm run audit
npm run doctor
```

There is currently no dedicated `audit:welcome` npm script.
