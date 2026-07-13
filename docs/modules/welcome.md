# Welcome

Welcome sends configurable public and direct-message onboarding messages when a member joins a Discord server.

## Design and delivery model

Embed Studio owns the full visual message design. Welcome owns delivery.

```text
Embed Studio
→ save the customised message as a template
→ bind the template to Welcome / welcome
→ Welcome sends it automatically when a member joins
```

The same template can still be previewed or posted manually from Embed Studio. Editing the saved template updates future Welcome deliveries without creating a second copy.

## Storage

Configuration is stored through GuildManager under:

```text
guild.modules.welcome
```

Embed templates and bindings are stored through GuildManager under:

```text
guild.embedStudio.templates
guild.embedStudio.bindings.welcome.welcome
```

No standalone module JSON files are used.

## Runtime

Welcome runs from the shared member join event. It supports:

- Public welcome messages
- Optional direct-message welcomes
- Member mentions
- Bot filtering
- Embed Studio template bindings
- Member and server template variables
- Delivery analytics

Supported Welcome variables include:

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
```

## Discord Admin panel

Open:

```text
/admin → Modules → Welcome
```

The panel provides:

- Enable and disable
- Welcome channel selector
- Embed Studio template selector and binding
- DM welcome toggle
- Member ping toggle
- Bot filtering toggle
- Preview delivery, including while the module is disabled
- Health repair
- JSON export
- Full reset

## Dashboard

The Welcome dashboard displays the active bound template, delivery settings, analytics and health. Selecting a template creates the same `welcome → welcome` binding used by Embed Studio.

## API

Base path:

```text
/api/welcome/:guildId
```

Endpoints:

- `GET /overview`
- `PUT /config`
- `PATCH /enabled`
- `POST /template`
- `POST /repair`
- `POST /test`
- `POST /reset`
- `GET /export`

## Preview delivery

A preview welcome uses the selected channel and active Embed Studio template even when Welcome is currently disabled. Preview sends do not increase live delivery analytics.

## Startup recovery and health

Startup validates:

- Welcome enabled state
- Configured channel existence
- View Channel permission
- Send Messages permission
- Embed Links permission
- Active template existence
- Explicit Embed Studio binding

Missing or unusable channels are reported through health warnings and can be cleared with the repair action.

## Doctor

```powershell
npm run audit:welcome
npm run doctor
```
