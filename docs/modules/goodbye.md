# Goodbye

Goodbye sends a configurable public farewell message when a member leaves a Discord server.

## Architecture

Embed Studio owns the Discord-facing message design. The Goodbye module owns automatic delivery, channel selection, enable state, preview delivery, health, analytics, repair, export and reset.

Configuration is stored through GuildManager under:

```text
guild.modules.goodbye
```

No standalone module JSON files are used.

## Runtime

The shared `guildMemberRemove` event calls `goodbyeManager.sendGoodbye(member)`. Public Goodbye messages are separate from private member-removal logs for leaves, kicks, bans and prunes.

Supported variables include:

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
{leftAt}
{timestamp}
```

## Discord Admin panel

Open:

```text
/admin → Modules → Goodbye
```

The panel provides:

- Enable and disable
- Goodbye channel selector
- Embed Studio template selector
- Bot filtering
- Preview Goodbye while disabled
- Health repair
- JSON export
- Full reset

## Dashboard

Open the Goodbye module page from the dashboard Modules grid. It provides the same setup controls, analytics and diagnostics as the Discord Admin panel.

## Embed Studio

Create or save a fully customised template in Embed Studio, then bind it to:

```text
goodbye → goodbye
```

Legacy `welcome → leave` bindings remain readable during migration, but new configuration uses the dedicated Goodbye binding.

## API

Base path:

```text
/api/goodbye/:guildId
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

## Startup recovery and health

Startup validates the configured channel, Goliath's permission to view and send messages, Embed Links permission and the active Embed Studio template binding.

## Doctor

```powershell
npm run audit:goodbye
npm run doctor
```
