# Embed Studio Variables

## Server name variables

- `{server}` — resolves to the live Discord server/guild name exactly as configured in Discord.
- `{guildName}` — resolves to the live Discord server/guild name exactly as configured in Discord.
- `{server.cleanName}` — resolves dynamically from the live Discord server/guild name while removing decorative emoji, symbols, punctuation, and surrounding whitespace from the beginning and end of the name.

Example:

```text
Discord server name: 💎・KSJ・💎
{server}           → 💎・KSJ・💎
{server.cleanName} → KSJ
```

If the Discord server is later renamed, `{server.cleanName}` is recalculated from the current live guild name when Embed Studio renders the variable.
