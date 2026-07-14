# Tickets

Tickets is a flagship Goliath module. It keeps the standard module entry points while retaining focused internal files for complex runtime responsibilities.

## Canonical entry points

- `src/modules/tickets/tickets.js` — public runtime and business API
- `src/modules/tickets/ticketsPanel.js` — Discord `/admin` and `/ticket setup` UI
- `src/modules/tickets/ticketsRoute.js` — dashboard/API router

External code should import one of these three files instead of reaching directly into ticket internals.

## Preserved flagship capabilities

- Multiple ticket panels and ticket types
- Discord channel creation and ticket controls
- Claim, assign, close, reopen, archive and delete workflows
- Ticket numbering, priority, limits and cooldowns
- Staff, manager and viewer permissions
- Logs and transcripts
- Form submission integration
- Recovery and repair of missing channels
- Timeline and analytics
- Dashboard socket updates
- Startup recovery
- Embed Studio panel templates
- Existing-message attachment

## Redevelopment rules

1. Preserve production behaviour before deleting or merging files.
2. Migrate external imports to the canonical entry points first.
3. Merge only overlapping internal responsibilities.
4. Keep recovery, transcripts, analytics and channel operations separate where their complexity justifies it.
5. Store guild configuration in the established guild module data rather than standalone JSON files.
6. Keep Discord and dashboard capabilities aligned.
7. Validate the complete ticket lifecycle before removing compatibility files.

## Target internal structure

```text
src/modules/tickets/
├── tickets.js
├── ticketsPanel.js
├── ticketsRoute.js
├── ticketsChannels.js
├── ticketsRecovery.js
├── ticketsTranscripts.js
├── ticketsAnalytics.js
├── ticketsStartup.js
└── providers or focused helpers only where genuinely required
```

The final structure may retain additional focused files where combining them would reduce clarity or reliability.
